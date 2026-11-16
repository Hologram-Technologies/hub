//! `uor-label` --- the canonical UOR address of one model file, and the
//! per-tensor leaf each address binds.
//!
//! The address is not this repository's. `uor-addr` publishes a canonical form
//! per format and mints a 71-byte κ-label `sha256:<64hex>` from it, with the
//! property that two files decoding to the same logical content --- modulo
//! metadata-key order, tensor order and tensor-data layout --- canonicalize to
//! byte-identical skeletons and so to the same label. This binary calls that
//! entry point. It reproduces the label; it does not establish it.
//!
//! What it adds is the part a reader can check without it. The canonical form
//! represents every variable-length leaf by the streamed SHA-256 of its own
//! bytes, so a tensor's leaf is the SHA-256 of that tensor's data region and
//! nothing else. That is the number a client can re-derive from a ranged read
//! of one tensor, with neither the whole file nor this hub's word for it.
//! Printing the leaves is therefore not extra metadata: it is what makes a
//! model-level label falsifiable one tensor at a time.
//!
//! Two checks guard against misreading the skeleton, not against `uor-addr`.
//! Hashing the skeleton must reproduce the label `uor-addr` returned, and
//! every tensor-info entry must name a tensor the file itself declares. Either
//! failing is this binary's bug, and it then exits non-zero rather than
//! printing an address.
//!
//!     uor-label <file.gguf>

use std::fmt::Write as _;
use std::process::ExitCode;

use sha2::{Digest, Sha256};

/// GGUF's own header is read for the tensor names, because the canonical form
/// carries `sha256(name)` rather than the name: a skeleton alone cannot say
/// which tensor a leaf belongs to.
const GGUF_MAGIC: u32 = 0x4655_4747;

/// A reader over a byte slice that refuses to run past the end, so a truncated
/// or misread input is an error rather than a panic.
struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.at.checked_add(n).ok_or("length overflow")?;
        let slice = self
            .bytes
            .get(self.at..end)
            .ok_or_else(|| format!("wanted {n} bytes at {} of {}", self.at, self.bytes.len()))?;
        self.at = end;
        Ok(slice)
    }

    fn u32(&mut self) -> Result<u32, String> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn u64(&mut self) -> Result<u64, String> {
        let b = self.take(8)?;
        Ok(u64::from_le_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ]))
    }

    fn done(&self) -> bool {
        self.at == self.bytes.len()
    }
}

/// The bytes a GGUF metadata value of this type occupies in the canonical
/// skeleton. `None` for the two whose canonical form is not a fixed width: a
/// string (`LE_u64(len) || sha256`) and an array
/// (`LE_u32(elem) || LE_u64(len) || sha256`).
fn scalar_width(tag: u32) -> Option<usize> {
    match tag {
        0 | 1 | 7 => Some(1),
        2 | 3 => Some(2),
        4..=6 => Some(4),
        10..=12 => Some(8),
        _ => None,
    }
}

/// One tensor as the canonical skeleton records it.
struct Entry {
    name_sha256: [u8; 32],
    dims: Vec<u64>,
    ggml_type: u32,
    offset: u64,
    leaf: [u8; 32],
}

/// Walks the canonical skeleton and returns its tensor-info entries.
///
/// The layout is `uor-addr`'s, documented in `uor_addr::gguf::value`. It is
/// walked rather than assumed: the header's counts must be consumed exactly
/// and the skeleton must end where the last entry ends, so a layout change
/// upstream surfaces here as an error instead of as a plausible wrong answer.
fn tensors_of_skeleton(skeleton: &[u8]) -> Result<Vec<Entry>, String> {
    let mut c = Cursor::new(skeleton);
    let magic = c.u32()?;
    if magic != GGUF_MAGIC {
        return Err(format!("skeleton starts {magic:#x}, not the GGUF magic"));
    }
    let _version = c.u32()?;
    let tensor_count = c.u64()?;
    let kv_count = c.u64()?;
    let _alignment = c.u64()?;

    for i in 0..kv_count {
        c.take(32).map_err(|e| format!("kv {i} key: {e}"))?;
        let tag = c.u32().map_err(|e| format!("kv {i} tag: {e}"))?;
        match tag {
            8 => {
                c.u64().map_err(|e| format!("kv {i} string length: {e}"))?;
                c.take(32).map_err(|e| format!("kv {i} string: {e}"))?;
            }
            9 => {
                c.u32().map_err(|e| format!("kv {i} element type: {e}"))?;
                c.u64().map_err(|e| format!("kv {i} array length: {e}"))?;
                c.take(32).map_err(|e| format!("kv {i} array: {e}"))?;
            }
            _ => {
                let width = scalar_width(tag)
                    .ok_or_else(|| format!("kv {i} has metadata type {tag}, which has no width"))?;
                c.take(width).map_err(|e| format!("kv {i} value: {e}"))?;
            }
        }
    }

    let mut out = Vec::with_capacity(usize::try_from(tensor_count).unwrap_or_default());
    for i in 0..tensor_count {
        let mut name_sha256 = [0u8; 32];
        name_sha256.copy_from_slice(c.take(32).map_err(|e| format!("tensor {i} name: {e}"))?);
        let n_dims = c.u32().map_err(|e| format!("tensor {i} rank: {e}"))?;
        let mut dims = Vec::with_capacity(usize::try_from(n_dims).unwrap_or_default());
        for d in 0..n_dims {
            dims.push(c.u64().map_err(|e| format!("tensor {i} dim {d}: {e}"))?);
        }
        let ggml_type = c.u32().map_err(|e| format!("tensor {i} type: {e}"))?;
        let offset = c.u64().map_err(|e| format!("tensor {i} offset: {e}"))?;
        let mut leaf = [0u8; 32];
        leaf.copy_from_slice(c.take(32).map_err(|e| format!("tensor {i} leaf: {e}"))?);
        out.push(Entry {
            name_sha256,
            dims,
            ggml_type,
            offset,
            leaf,
        });
    }

    if !c.done() {
        return Err(format!(
            "the skeleton has {} bytes left over, so the layout walked here is not the one it was given",
            skeleton.len() - c.at
        ));
    }
    Ok(out)
}

/// Skips one GGUF metadata value, whatever its type. Arrays nest, so this
/// recurses on the element type the array declares.
fn skip_value(c: &mut Cursor<'_>, tag: u32) -> Result<(), String> {
    match tag {
        8 => {
            let n = c.u64()?;
            c.take(usize::try_from(n).map_err(|_| "string too long")?)?;
        }
        9 => {
            let elem = c.u32()?;
            let n = c.u64()?;
            for _ in 0..n {
                skip_value(c, elem)?;
            }
        }
        _ => {
            let width =
                scalar_width(tag).ok_or_else(|| format!("metadata type {tag} has no width"))?;
            c.take(width)?;
        }
    }
    Ok(())
}

/// Every tensor name the GGUF file itself declares, in the file's own order.
///
/// Only the names are wanted, but reaching them means walking the metadata, so
/// the walk has the same shape as the skeleton's and fails the same way.
fn names_of_gguf(raw: &[u8]) -> Result<Vec<String>, String> {
    let mut c = Cursor::new(raw);
    if c.u32()? != GGUF_MAGIC {
        return Err("not a GGUF file".into());
    }
    let _version = c.u32()?;
    let tensor_count = c.u64()?;
    let kv_count = c.u64()?;

    for i in 0..kv_count {
        let n = c.u64().map_err(|e| format!("kv {i} key length: {e}"))?;
        c.take(usize::try_from(n).map_err(|_| "key too long")?)
            .map_err(|e| format!("kv {i} key: {e}"))?;
        let tag = c.u32().map_err(|e| format!("kv {i} tag: {e}"))?;
        skip_value(&mut c, tag).map_err(|e| format!("kv {i} value: {e}"))?;
    }

    let mut names = Vec::with_capacity(usize::try_from(tensor_count).unwrap_or_default());
    for i in 0..tensor_count {
        let n = c
            .u64()
            .map_err(|e| format!("tensor {i} name length: {e}"))?;
        let bytes = c
            .take(usize::try_from(n).map_err(|_| "name too long")?)
            .map_err(|e| format!("tensor {i} name: {e}"))?;
        names.push(String::from_utf8_lossy(bytes).into_owned());
        let n_dims = c.u32().map_err(|e| format!("tensor {i} rank: {e}"))?;
        c.take(8 * usize::try_from(n_dims).unwrap_or_default())
            .map_err(|e| format!("tensor {i} dims: {e}"))?;
        c.u32().map_err(|e| format!("tensor {i} type: {e}"))?;
        c.u64().map_err(|e| format!("tensor {i} offset: {e}"))?;
    }
    Ok(names)
}

/// Lowercase hex, because every address this repository prints is lowercase hex.
fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(s, "{b:02x}");
    }
    s
}

/// A JSON string. Tensor names come from the file, so they are escaped rather
/// than trusted to be printable.
fn json_string(value: &str) -> String {
    let mut s = String::with_capacity(value.len() + 2);
    s.push('"');
    for ch in value.chars() {
        match ch {
            '"' => s.push_str("\\\""),
            '\\' => s.push_str("\\\\"),
            '\n' => s.push_str("\\n"),
            '\r' => s.push_str("\\r"),
            '\t' => s.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(s, "\\u{:04x}", c as u32);
            }
            c => s.push(c),
        }
    }
    s.push('"');
    s
}

/// The label and its leaves for one file, as JSON, or why neither can be given.
fn run(path: &str) -> Result<String, String> {
    let raw = std::fs::read(path).map_err(|e| format!("{path}: {e}"))?;

    // The label comes from `uor-addr` and from nowhere else. Everything below
    // only explains it.
    let outcome = uor_addr::gguf::address(&raw)
        .map_err(|e| format!("{path} is not a GGUF v3 file uor-addr will address: {e:?}"))?;
    let label = outcome.address.as_str().to_owned();

    let skeleton = uor_addr::gguf::canonicalize(&raw)
        .map_err(|e| format!("{path} did not canonicalize: {e:?}"))?;

    // The first check: κ is the σ-axis applied to the canonical form, so
    // hashing the skeleton must give the label back. If it does not, the bytes
    // walked below are not the bytes the label was taken over, and no leaf read
    // out of them would mean anything.
    let restated = format!("sha256:{}", hex(&Sha256::digest(&skeleton)));
    if restated != label {
        return Err(format!(
            "hashing the canonical skeleton gives {restated}, but uor-addr's label is {label}"
        ));
    }

    let entries = tensors_of_skeleton(&skeleton)?;
    let names = names_of_gguf(&raw)?;

    // The second check: the skeleton carries `sha256(name)`, so a leaf is tied
    // to a name only by matching that digest. A digest no name matches, or a
    // name with no entry, is refused rather than guessed at.
    let mut by_digest: Vec<(String, [u8; 32])> = names
        .iter()
        .map(|n| {
            let mut d = [0u8; 32];
            d.copy_from_slice(&Sha256::digest(n.as_bytes()));
            (n.clone(), d)
        })
        .collect();

    let mut rows = Vec::with_capacity(entries.len());
    for entry in &entries {
        let found = by_digest.iter().position(|(_, d)| *d == entry.name_sha256);
        let Some(index) = found else {
            return Err(format!(
                "a tensor-info entry names sha256:{}, which no tensor in the file is called",
                hex(&entry.name_sha256)
            ));
        };
        let (name, _) = by_digest.remove(index);
        let dims = entry
            .dims
            .iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join(",");
        rows.push(format!(
            "{{\"name\":{},\"ggmlType\":{},\"shape\":[{}],\"offset\":{},\"leaf\":\"sha256:{}\"}}",
            json_string(&name),
            entry.ggml_type,
            dims,
            entry.offset,
            hex(&entry.leaf)
        ));
    }
    if !by_digest.is_empty() {
        return Err(format!(
            "{} tensors the file declares have no entry in the canonical skeleton",
            by_digest.len()
        ));
    }

    Ok(format!(
        "{{\"format\":\"hologram.hub.uorlabel/v1\",\"file\":{},\"bytes\":{},\"realization\":\"gguf\",\"canonicalForm\":{},\"label\":{},\"skeletonBytes\":{},\"tensors\":[{}]}}",
        json_string(path),
        raw.len(),
        uor_addr::gguf::CANONICAL_FORM_VERSION,
        json_string(&label),
        skeleton.len(),
        rows.join(",")
    ))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [path] = args.as_slice() else {
        eprintln!("usage: uor-label <file.gguf>");
        return ExitCode::from(64);
    };
    match run(path) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("uor-label: {message}");
            ExitCode::FAILURE
        }
    }
}
