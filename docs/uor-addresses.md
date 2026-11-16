# A canonical address for a tensor, and what it costs to check one

Every address this hub carried before now came from Hugging Face: the LFS
`sha256` for a weight file, the git blob OID for a small one. That makes Hugging
Face the only party able to say what a file's bytes should hash to, and adding
sources does not touch it. `docs/hippius-source-study.md` measured the shape of
the problem on 2026-11-16: a mirror whose digests agreed with this hub's record
exactly, and which therefore added nothing as an authority, because Hugging Face
had already named every number it published.

A content-derived address removes the question rather than answering it. Hold
the bytes, compute the address, compare. Nobody is asked.

Measured 2026-11-16 from a Windows machine on a domestic connection. "Measured"
means this session timed it on that date; "proved" is reserved for what Lean
proved in a run here, and nothing below is proved.

## What the address is, and whose it is

`uor-addr 0.2.0` (crates.io, 2026-05-24, Apache-2.0) publishes a canonical form
per format and mints a 71-byte κ-label `sha256:<64hex>` from it. For GGUF v3 the
canonical form is canonical form 2 under ADR-060: a flat Merkle skeleton of the
header, the metadata keys sorted by key bytes and the tensor info sorted by name
bytes with recomputed offsets, in which **every variable-length leaf is
represented by the streamed SHA-256 of its own bytes**.

Two consequences, both upstream's and neither established here. They are cited
in `model/authorities.toml` as `UOR-ADDR-0-2-0`.

- Two files that decode to the same logical content — modulo metadata-key order,
  tensor order and tensor-data layout — canonicalize to byte-identical skeletons
  and so to the same label. The same tensors have the same address wherever they
  come from.
- A tensor's leaf is the SHA-256 of that tensor's own data region and nothing
  else. It is not a hash of a hash, and it does not depend on the file around it.

The second is the one that pays. It means a reader can check one tensor from a
ranged read, and the skeleton stays small whatever the model weighs.

## Measured, on a real file

`Cudecnik/Qwen3.8-Flash-Next-refusal-projection` at commit `1886570b`, file
`Qwen3.8-Flash-Next-refusal-projection.gguf`, 483,520 bytes, GGUF v3, 47 tensors,
3 metadata keys.

| | |
| --- | --- |
| κ-label | `sha256:cef511af809a72bd9a826959c1e91757618dae8903d9aabf5d87258ff947f7a3` |
| canonical form | 2 |
| skeleton | 4,360 bytes |
| data section starts at | byte 2,240 |

The skeleton is the thing hashed, and it is 4,360 bytes for a 483,520-byte file
because its size grows with the tensor and key **counts**, never with the model.
`manuelgscom/dale-0.8b-GGUF`, 529,297,952 bytes and 320 tensors, addressed in
421.4 s — all of it the download.

Then the check that matters. Tensor `direction.1`, 2,560 elements of ggml type 0,
is bytes 2,240 to 12,479 of the file:

| How the 10,240 bytes were got | Result |
| --- | --- |
| read from the local file | `sha256:e1786cdbca6a909eb764566a745ecb21aaa30b7f39f956b7f31b003baff87e1e` |
| `curl` with `Range: bytes=2240-12479` | 206, 10,240 bytes, 0.537 s, same digest |
| a browser's `fetch`, cross-origin from an unrelated site | 206, `type: "cors"`, 763 ms, same digest |

All three equal the leaf the canonical form publishes. So a visitor's own browser
can check a tensor's canonical address against the source, over one ranged read,
without the file and without this hub's word for anything. That is what the
model page's address tab offers, and the verdict it shows is the kernel's accept
rule (`HK-25`), not a comparison the page made.

Two of the files addressed in the same run are worth a line. The `additive` and
`projection` GGUFs of that release are different file names and the same 483,520
bytes of logical content, and they minted the **same** label. The address follows
the content, not the name.

## What it costs

A model-level label needs the whole file streamed once, because
`uor_addr::gguf::address` takes the file as a slice. That is the binding cost:

| | |
| --- | --- |
| GGUF and ONNX releases in the signed index | 150 of 440 |
| All of them, by weight | 38.5 TB |
| The five smallest releases in `manifests/uor.txt` | 681 MB |
| Index size, measured | 63 KB for 298 tensors, about 212 bytes a tensor |
| Projected at 150 releases | roughly 9.5 MB |

The published site is already 885 MB of GitHub Pages' 1,024 MB and
`.github/workflows/pages.yml` refuses a deploy over 950 MB, so the headroom is
about 65 MB. 9.5 MB fits; the ceiling is in the low thousands of models. Shards
are keyed by the leading bits of `sha256(repo)` — `web/uorkey.mjs`, the same rule
`tools/roll.mjs` uses for the roll's 2,048 shards — with the width in the root,
so widening it is a rebuild and not a second rule.

Addressing all 150 is a matrix sweep across runners, the shape
`.github/workflows/roll-sweep.yml` already uses. The list in
`manifests/uor.txt` is how it grows, and it is a list rather than "every GGUF in
the index" so that what a build will spend is readable before it spends it.

## What is not addressed, and why

The root names every file it did not address, with a reason, because a coverage
count means nothing without it. Three reasons occur:

- **Not a format read here.** Safetensors is 196 of the 440 addressed records and
  `uor-addr 0.2.0` has no safetensors realization. Inventing one locally would
  mint labels that a later upstream realization would contradict, so none is
  minted. Those records keep the per-tensor BLAKE3 address `runner/uor.mjs`
  defines, which is this repository's own and is labelled as such. ONNX has an
  upstream realization, but its skeleton is protobuf and the layout its leaves
  sit in has not been read here, so its 5 records are left alone rather than
  addressed by guesswork.
- **Larger than the build reads whole.** A file past the limit is named with its
  size.
- **Refused by the addresser.** `uor-addr` addresses GGUF v3 and refuses anything
  else, including two deprecated tensor types. Measured: of six GGUF files in the
  five listed releases, `HOLOGRAMTECH/q-bitnet-2b-b3/tokenizer.gguf` is refused
  with `InvalidGguf`. The reason it gives is recorded verbatim; the build goes on.

## What the page does not check yet

The page verifies every address shard against the root with the kernel's accept
rule, the same way it verifies a browse shard. It does **not** yet check the
root's own signature, though the deploy attests it under
`https://hologram.foundation/hub/uor/v1`. Until it does, a reader who distrusts
the host should take the attestation rather than the page's word that the root is
this repository's. That is a gap in the page, not in the artifact, and it is the
next thing to close.
