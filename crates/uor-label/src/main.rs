//! `uor-label` --- the canonical UOR address of one model file, and the
//! per-tensor leaf each address binds.
//!
//! The address is not this repository's. `uor-addr` publishes a canonical form
//! per format and mints a 71-byte κ-label `blake3:<64hex>` from it, with the
//! property that two files decoding to the same logical content --- modulo
//! metadata-key order, tensor order and tensor-data layout --- canonicalize to
//! byte-identical skeletons and so to the same label. This binary calls that
//! entry point. It reproduces the label; it does not establish it.
//!
//! What it adds is the part a reader can check without it. The canonical form
//! represents every variable-length leaf by the BLAKE3 of its own bytes, so a
//! tensor's leaf is the BLAKE3 of that tensor's data region and nothing else:
//! the same 32 bytes as the tensor's own `blake3:` address. That is the number a client can re-derive from a ranged read
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
//!     uor-label <file.gguf | file.safetensors>

use std::fmt::Write as _;
use std::process::ExitCode;

use uor_addr::gguf::GgmlType;

/// GGUF's own header is read for the tensor names, because the canonical form
/// carries `blake3(name)` rather than the name: a skeleton alone cannot say
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
/// string (`LE_u64(len) || blake3`) and an array
/// (`LE_u32(elem) || LE_u64(len) || blake3`).
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
    name_digest: [u8; 32],
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
        let mut name_digest = [0u8; 32];
        name_digest.copy_from_slice(c.take(32).map_err(|e| format!("tensor {i} name: {e}"))?);
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
            name_digest,
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

/// What the GGUF file itself declares about a tensor: where its bytes actually
/// are, which the canonical skeleton deliberately does not say.
///
/// The skeleton's offset is the *recomputed canonical* position in
/// sorted-tensor order, which is what makes two differently laid-out files
/// canonicalize alike. It is therefore no use for finding bytes. The file's own
/// stored offset is, and it lives here.
struct Declared {
    name: String,
    offset: u64,
    length: u64,
}

/// Every tensor the GGUF file declares, plus where its data section starts.
///
/// Only the names, offsets and lengths are wanted, but reaching them means
/// walking the metadata, so the walk has the same shape as the skeleton's and
/// fails the same way. The alignment is read from `general.alignment` when the
/// file sets it, because the data section starts at the first aligned byte
/// after the tensor info.
fn declared_of_gguf(raw: &[u8]) -> Result<(Vec<Declared>, u64), String> {
    let mut c = Cursor::new(raw);
    if c.u32()? != GGUF_MAGIC {
        return Err("not a GGUF file".into());
    }
    let _version = c.u32()?;
    let tensor_count = c.u64()?;
    let kv_count = c.u64()?;

    let mut alignment: u64 = 32;
    for i in 0..kv_count {
        let n = c.u64().map_err(|e| format!("kv {i} key length: {e}"))?;
        let key = c
            .take(usize::try_from(n).map_err(|_| "key too long")?)
            .map_err(|e| format!("kv {i} key: {e}"))?;
        let tag = c.u32().map_err(|e| format!("kv {i} tag: {e}"))?;
        if key == b"general.alignment" {
            alignment = match tag {
                4 => u64::from(c.u32().map_err(|e| format!("alignment: {e}"))?),
                10 => c.u64().map_err(|e| format!("alignment: {e}"))?,
                _ => return Err(format!("general.alignment has metadata type {tag}")),
            };
            if alignment == 0 || !alignment.is_power_of_two() {
                return Err(format!("general.alignment is {alignment}"));
            }
        } else {
            skip_value(&mut c, tag).map_err(|e| format!("kv {i} value: {e}"))?;
        }
    }

    let mut declared = Vec::with_capacity(usize::try_from(tensor_count).unwrap_or_default());
    for i in 0..tensor_count {
        let n = c
            .u64()
            .map_err(|e| format!("tensor {i} name length: {e}"))?;
        let bytes = c
            .take(usize::try_from(n).map_err(|_| "name too long")?)
            .map_err(|e| format!("tensor {i} name: {e}"))?;
        let name = String::from_utf8_lossy(bytes).into_owned();
        let n_dims = c.u32().map_err(|e| format!("tensor {i} rank: {e}"))?;
        let mut elements: u64 = 1;
        for d in 0..n_dims {
            let dim = c.u64().map_err(|e| format!("tensor {i} dim {d}: {e}"))?;
            elements = elements
                .checked_mul(dim)
                .ok_or_else(|| format!("tensor {i} has more elements than fit a u64"))?;
        }
        let type_id = c.u32().map_err(|e| format!("tensor {i} type: {e}"))?;
        let offset = c.u64().map_err(|e| format!("tensor {i} offset: {e}"))?;
        // The byte count is upstream's arithmetic, not this binary's: the
        // dtype alphabet calls itself the single source of truth for it, and
        // a quantized type's block structure is exactly the part worth not
        // re-deriving by hand.
        let dtype = GgmlType::from_u32(type_id)
            .ok_or_else(|| format!("tensor {i} has ggml type {type_id}, which uor-addr rejects"))?;
        let block_elems = u64::try_from(dtype.block_elems()).map_err(|_| "block elements")?;
        let block_bytes = u64::try_from(dtype.block_bytes()).map_err(|_| "block bytes")?;
        if block_elems == 0 || !elements.is_multiple_of(block_elems) {
            return Err(format!(
                "tensor {i} has {elements} elements, which is not a whole number of {block_elems}-element blocks"
            ));
        }
        let length = elements / block_elems * block_bytes;
        declared.push(Declared {
            name,
            offset,
            length,
        });
    }

    let end_of_info = u64::try_from(c.at).map_err(|_| "header too long")?;
    let data_start = end_of_info
        .checked_add(alignment - 1)
        .ok_or("alignment overflow")?
        / alignment
        * alignment;
    Ok((declared, data_start))
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
///
/// The file's own first bytes choose the realization, never its name: a GGUF
/// file begins with the GGUF magic, and anything else is offered to the
/// safetensors realization, which refuses what is not one.
fn run(path: &str) -> Result<String, String> {
    let raw = std::fs::read(path).map_err(|e| format!("{path}: {e}"))?;
    if raw.get(..4) == Some(&GGUF_MAGIC.to_le_bytes()[..]) {
        run_gguf(path, &raw)
    } else {
        run_safetensors(path, &raw)
    }
}

/// The skeleton's first bytes under the safetensors realization, which differ
/// from GGUF's so the two can never mint one label from two files.
const SAFETENSORS_TAG: &[u8; 4] = b"SAFE";

/// One tensor as the safetensors skeleton records it.
struct SafeEntry {
    name_digest: [u8; 32],
    dtype_id: u32,
    dims: Vec<u64>,
    offset: u64,
    leaf: [u8; 32],
}

/// Walks the safetensors canonical skeleton, whose layout is `uor-addr`'s and
/// is documented in `uor_addr::safetensors::value`. As for GGUF, it is walked
/// rather than assumed, and must be consumed exactly.
fn tensors_of_safetensors_skeleton(skeleton: &[u8]) -> Result<Vec<SafeEntry>, String> {
    let mut c = Cursor::new(skeleton);
    let tag = c.take(4)?;
    if tag != SAFETENSORS_TAG {
        return Err(format!(
            "skeleton starts {tag:02x?}, not the safetensors tag"
        ));
    }
    let version = c.u32()?;
    if version != uor_addr::safetensors::CANONICAL_FORM_VERSION {
        return Err(format!(
            "skeleton is canonical form {version}, this binary reads {}",
            uor_addr::safetensors::CANONICAL_FORM_VERSION
        ));
    }
    let tensor_count = c.u64()?;
    let metadata_count = c.u64()?;
    for i in 0..metadata_count {
        c.take(32 + 8 + 32)
            .map_err(|e| format!("metadata {i}: {e}"))?;
    }
    let mut out = Vec::with_capacity(usize::try_from(tensor_count).unwrap_or_default());
    for i in 0..tensor_count {
        let mut name_digest = [0u8; 32];
        name_digest.copy_from_slice(c.take(32).map_err(|e| format!("tensor {i} name: {e}"))?);
        let dtype_id = c.u32().map_err(|e| format!("tensor {i} dtype: {e}"))?;
        let rank = c.u32().map_err(|e| format!("tensor {i} rank: {e}"))?;
        let mut dims = Vec::with_capacity(usize::try_from(rank).unwrap_or_default());
        for d in 0..rank {
            dims.push(c.u64().map_err(|e| format!("tensor {i} dim {d}: {e}"))?);
        }
        let offset = c.u64().map_err(|e| format!("tensor {i} offset: {e}"))?;
        let mut leaf = [0u8; 32];
        leaf.copy_from_slice(c.take(32).map_err(|e| format!("tensor {i} leaf: {e}"))?);
        out.push(SafeEntry {
            name_digest,
            dtype_id,
            dims,
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

/// What the safetensors file itself declares about each tensor: its name and
/// where its bytes are, which the skeleton deliberately does not say. Read
/// only after `uor-addr` has admitted the file, so the header is already known
/// to be one JSON object with exactly the fields the format allows.
fn declared_of_safetensors(raw: &[u8]) -> Result<(Vec<Declared>, u64), String> {
    let len_bytes: [u8; 8] = raw
        .get(..8)
        .and_then(|b| b.try_into().ok())
        .ok_or("shorter than the 8-byte header length")?;
    let header_len = u64::from_le_bytes(len_bytes);
    let data_start = header_len.checked_add(8).ok_or("header length overflow")?;
    let header = raw
        .get(8..usize::try_from(data_start).map_err(|_| "header too long")?)
        .ok_or("the header runs past the file")?;
    let object: serde_json::Map<String, serde_json::Value> =
        serde_json::from_slice(header).map_err(|e| format!("header: {e}"))?;
    let mut declared = Vec::with_capacity(object.len());
    for (name, entry) in object {
        if name == "__metadata__" {
            continue;
        }
        let offsets = entry
            .get("data_offsets")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| format!("tensor {name} has no data_offsets"))?;
        let [begin, end] = offsets.as_slice() else {
            return Err(format!("tensor {name} has {} data offsets", offsets.len()));
        };
        let (Some(begin), Some(end)) = (begin.as_u64(), end.as_u64()) else {
            return Err(format!("tensor {name} has a data offset that is not a u64"));
        };
        let length = end
            .checked_sub(begin)
            .ok_or_else(|| format!("tensor {name} ends before it begins"))?;
        declared.push(Declared {
            name,
            offset: begin,
            length,
        });
    }
    Ok((declared, data_start))
}

/// The safetensors counterpart of [`run_gguf`]: the same three checks, over
/// the same promise that a leaf is the BLAKE3 of exactly the published range.
fn run_safetensors(path: &str, raw: &[u8]) -> Result<String, String> {
    let label = uor_addr::safetensors::address(raw)
        .map_err(|e| {
            format!("{path} is neither a GGUF v3 nor a safetensors file uor-addr will address: {e:?}")
        })?
        .address
        .as_str()
        .to_owned();
    let skeleton = uor_addr::safetensors::canonicalize(raw)
        .map_err(|e| format!("{path} did not canonicalize: {e:?}"))?;

    let restated = format!("blake3:{}", hex(&b3(&skeleton)));
    if restated != label {
        return Err(format!(
            "hashing the canonical skeleton gives {restated}, but uor-addr's label is {label}"
        ));
    }

    let entries = tensors_of_safetensors_skeleton(&skeleton)?;
    let (declared, data_start) = declared_of_safetensors(raw)?;
    let mut by_digest: Vec<([u8; 32], &Declared)> = declared
        .iter()
        .map(|d| {
            let mut digest = [0u8; 32];
            digest.copy_from_slice(&b3(d.name.as_bytes()));
            (digest, d)
        })
        .collect();

    let mut rows = Vec::with_capacity(entries.len());
    for entry in &entries {
        let Some(index) = by_digest.iter().position(|(d, _)| *d == entry.name_digest) else {
            return Err(format!(
                "a tensor entry names blake3:{}, which no tensor in the file is called",
                hex(&entry.name_digest)
            ));
        };
        let (_, tensor) = by_digest.remove(index);
        let begin = data_start
            .checked_add(tensor.offset)
            .ok_or("tensor offset overflow")?;
        let end = begin
            .checked_add(tensor.length)
            .ok_or("tensor length overflow")?;
        let range = raw
            .get(
                usize::try_from(begin).map_err(|_| "offset too large")?
                    ..usize::try_from(end).map_err(|_| "offset too large")?,
            )
            .ok_or_else(|| {
                format!(
                    "tensor {} runs past the {} bytes of the file",
                    tensor.name,
                    raw.len()
                )
            })?;
        let over_range = b3(range);
        if over_range.as_slice() != entry.leaf {
            return Err(format!(
                "tensor {}: the canonical leaf is blake3:{}, but bytes {begin}..{end} hash to blake3:{}",
                tensor.name,
                hex(&entry.leaf),
                hex(&over_range)
            ));
        }
        let dtype = uor_addr::safetensors::SafetensorsDtype::all()
            .find(|d| d.id() == entry.dtype_id)
            .ok_or_else(|| {
                format!(
                    "tensor {} has dtype id {}, which uor-addr does not name",
                    tensor.name, entry.dtype_id
                )
            })?;
        let dims = entry
            .dims
            .iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join(",");
        rows.push(format!(
            "{{\"name\":{},\"dtype\":{},\"shape\":[{}],\"begin\":{},\"length\":{},\"canonicalOffset\":{},\"address\":\"blake3:{}\"}}",
            json_string(&tensor.name),
            json_string(dtype.name()),
            dims,
            begin,
            tensor.length,
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
        "{{\"format\":\"hologram.hub.uorlabel/v3\",\"file\":{},\"bytes\":{},\"realization\":\"safetensors\",\"canonicalForm\":{},\"label\":{},\"skeletonBytes\":{},\"dataStart\":{},\"tensors\":[{}]}}",
        json_string(path),
        raw.len(),
        uor_addr::safetensors::CANONICAL_FORM_VERSION,
        json_string(&label),
        skeleton.len(),
        data_start,
        rows.join(",")
    ))
}

/// The GGUF realization's label and leaves.
fn run_gguf(path: &str, raw: &[u8]) -> Result<String, String> {
    // The label comes from `uor-addr` and from nowhere else. Everything below
    // only explains it.
    let label = uor_addr::gguf::address(raw)
        .map_err(|e| format!("{path} is not a GGUF v3 file uor-addr will address: {e:?}"))?
        .address
        .as_str()
        .to_owned();

    let skeleton = uor_addr::gguf::canonicalize(raw)
        .map_err(|e| format!("{path} did not canonicalize: {e:?}"))?;

    // The first check: κ is the σ-axis applied to the canonical form, so
    // hashing the skeleton must give the label back. Without it, the leaves
    // walked below might not be the ones the label was taken over, and no leaf read out of them would mean anything.
    let restated = format!("blake3:{}", hex(&b3(&skeleton)));
    if restated != label {
        return Err(format!(
            "hashing the canonical skeleton gives {restated}, but uor-addr's label is {label}"
        ));
    }

    let entries = tensors_of_skeleton(&skeleton)?;
    let (declared, data_start) = declared_of_gguf(raw)?;

    // The second check: the skeleton carries `blake3(name)`, so a leaf is tied
    // to a tensor only by matching that digest. A digest no tensor matches, or
    // a tensor with no entry, is refused rather than guessed at.
    let mut by_digest: Vec<([u8; 32], &Declared)> = declared
        .iter()
        .map(|d| {
            let mut digest = [0u8; 32];
            digest.copy_from_slice(&b3(d.name.as_bytes()));
            (digest, d)
        })
        .collect();

    let mut rows = Vec::with_capacity(entries.len());
    for entry in &entries {
        let found = by_digest.iter().position(|(d, _)| *d == entry.name_digest);
        let Some(index) = found else {
            return Err(format!(
                "a tensor-info entry names blake3:{}, which no tensor in the file is called",
                hex(&entry.name_digest)
            ));
        };
        let (_, tensor) = by_digest.remove(index);
        let begin = data_start
            .checked_add(tensor.offset)
            .ok_or("tensor offset overflow")?;
        let end = begin
            .checked_add(tensor.length)
            .ok_or("tensor length overflow")?;
        if end > u64::try_from(raw.len()).map_err(|_| "file too long")? {
            return Err(format!(
                "tensor {} runs to {end}, past the {} bytes of the file",
                tensor.name,
                raw.len()
            ));
        }
        let dims = entry
            .dims
            .iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join(",");
        // `begin` and `length` are the file's own, from its stored offset and
        // upstream's dtype arithmetic. `canonicalOffset` is the skeleton's
        // recomputed position in sorted-tensor order, which is what makes two
        // differently laid-out files address alike and is no use for finding
        // bytes. Both are printed because confusing them would send a reader
        // to the wrong range.
        rows.push(format!(
            "{{\"name\":{},\"ggmlType\":{},\"shape\":[{}],\"begin\":{},\"length\":{},\"canonicalOffset\":{},\"address\":\"blake3:{}\"}}",
            json_string(&tensor.name),
            entry.ggml_type,
            dims,
            begin,
            tensor.length,
            entry.offset,
            hex(&entry.leaf)
        ));

        // The third check, and the one a reader of the index actually relies
        // on: the leaf must be the BLAKE3 of exactly this byte range. If it
        // is not, the range published beside it would send a client to bytes
        // that cannot match, and the whole point of the row is lost.
        let over_range = b3(
            raw.get(
                usize::try_from(begin).map_err(|_| "offset too large")?
                    ..usize::try_from(end).map_err(|_| "offset too large")?,
            )
            .ok_or("tensor range outside the file")?,
        );
        if over_range.as_slice() != entry.leaf {
            return Err(format!(
                "tensor {}: the canonical leaf is blake3:{}, but bytes {begin}..{end} hash to blake3:{}",
                tensor.name,
                hex(&entry.leaf),
                hex(&over_range)
            ));
        }
    }
    if !by_digest.is_empty() {
        return Err(format!(
            "{} tensors the file declares have no entry in the canonical skeleton",
            by_digest.len()
        ));
    }

    Ok(format!(
        "{{\"format\":\"hologram.hub.uorlabel/v3\",\"file\":{},\"bytes\":{},\"realization\":\"gguf\",\"canonicalForm\":{},\"label\":{},\"skeletonBytes\":{},\"dataStart\":{},\"tensors\":[{}]}}",
        json_string(path),
        raw.len(),
        uor_addr::gguf::CANONICAL_FORM_VERSION,
        json_string(&label),
        skeleton.len(),
        data_start,
        rows.join(",")
    ))
}

/// The BLAKE3 of `bytes`: the hash `uor-addr` folds every leaf, name and
/// skeleton through.
fn b3(bytes: &[u8]) -> [u8; 32] {
    *blake3::hash(bytes).as_bytes()
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [path] = args.as_slice() else {
        eprintln!("usage: uor-label <file.gguf | file.safetensors>");
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
