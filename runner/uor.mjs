// Content addresses, and what they are each good for.
//
// The hub carries three addresses for the same bytes, because three different
// readers need three different ones:
//
//   sha256     the address a Hugging Face client knows a large file by, and
//              the one `HK-10` decides on. This is what makes a copy from an
//              untrusted source safe to serve: the bytes either hash to the
//              address the signed index names, or they are refused.
//   git blob   SHA-1 over `blob <size>\0<bytes>`, the identity Hugging Face
//              gives a small file and the ETag `HK-08` hands back for one.
//   blake3     the UOR address, taken per tensor over the tensor's own raw
//              little-endian bytes. A file address says the file is intact; a
//              tensor address says *which* tensor is intact, survives
//              re-packing into another container, and lets two models that
//              share a tensor be seen to share it.
//
// The file address is the gate. The tensor addresses are the authentication:
// they come from a manifest this repository signed after downloading and
// re-hashing the bytes itself, so a model that matches them was not merely
// delivered intact, it is the model this repository witnessed.
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { Blake3 } from "../try/vendor/prism-code/src/blake3.mjs";
import { verifyBundle } from "../web/sigstore.mjs";

const hex = (bytes) => Buffer.from(bytes).toString("hex");

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const gitBlobSha1 = (bytes) =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

// The tensors a safetensors file declares: an 8-byte little-endian header
// length, that many bytes of JSON, then the data. Offsets in the header are
// relative to the start of the data.
export function readSafetensors(bytes) {
  if (bytes.length < 8) throw new Error("too short to be safetensors");
  const headerLength = Number(Buffer.from(bytes.buffer, bytes.byteOffset, 8).readBigUInt64LE(0));
  if (headerLength <= 0 || 8 + headerLength > bytes.length) throw new Error("the safetensors header runs past the end");
  const header = JSON.parse(Buffer.from(bytes.subarray(8, 8 + headerLength)).toString("utf8"));
  const dataStart = 8 + headerLength;
  return Object.entries(header)
    .filter(([name]) => name !== "__metadata__")
    .map(([name, t]) => ({
      name, dtype: t.dtype, shape: t.shape,
      begin: dataStart + t.data_offsets[0], end: dataStart + t.data_offsets[1],
    }))
    .sort((a, b) => a.begin - b.begin);
}

// The UOR address of every tensor in a safetensors file.
export function tensorAddresses(bytes) {
  const out = new Map();
  for (const tensor of readSafetensors(bytes)) {
    if (tensor.end > bytes.length) throw new Error(`tensor ${tensor.name} runs past the end of the file`);
    const hash = new Blake3();
    hash.update(bytes.subarray(tensor.begin, tensor.end));
    out.set(tensor.name, `blake3:${hex(hash.digest())}`);
  }
  return out;
}

// Checks one file's tensors against a witnessed manifest. A tensor the
// manifest does not name is reported as unwitnessed rather than counted as a
// pass, so "every tensor matched" never means "the manifest named none".
export function checkTensors(manifest, path, bytes) {
  const expected = (manifest.tensors ?? []).filter((t) => t.file === path);
  if (!expected.length) return { witnessed: false, total: 0, matched: 0, mismatched: [] };
  const found = tensorAddresses(bytes);
  const mismatched = [];
  let matched = 0;
  for (const tensor of expected) {
    const address = found.get(tensor.name);
    if (address === tensor.blake3) matched += 1;
    else mismatched.push({ name: tensor.name, expected: tensor.blake3, found: address ?? null });
  }
  return { witnessed: true, total: expected.length, matched, mismatched };
}

// The same check, reading the file rather than holding it. A weight shard is
// gigabytes; a tensor's address is taken over its own byte range, so each
// range is read in chunks and nothing larger than a chunk is kept.
export async function checkTensorsOfFile(manifest, path, filePath, { chunk = 4 << 20 } = {}) {
  const expected = (manifest.tensors ?? []).filter((t) => t.file === path);
  if (!expected.length) return { witnessed: false, total: 0, matched: 0, mismatched: [] };
  const handle = await open(filePath, "r");
  try {
    const head = Buffer.alloc(8);
    await handle.read(head, 0, 8, 0);
    const headerLength = Number(head.readBigUInt64LE(0));
    const header = Buffer.alloc(headerLength);
    await handle.read(header, 0, headerLength, 8);
    const declared = JSON.parse(header.toString("utf8"));
    const dataStart = 8 + headerLength;
    const buffer = Buffer.alloc(chunk);
    const mismatched = [];
    let matched = 0;
    for (const tensor of expected) {
      const entry = declared[tensor.name];
      if (!entry) {
        mismatched.push({ name: tensor.name, expected: tensor.blake3, found: null });
        continue;
      }
      const begin = dataStart + entry.data_offsets[0];
      const end = dataStart + entry.data_offsets[1];
      const hash = new Blake3();
      for (let at = begin; at < end; at += chunk) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(chunk, end - at), at);
        if (bytesRead <= 0) break;
        hash.update(buffer.subarray(0, bytesRead));
      }
      const address = `blake3:${hex(hash.digest())}`;
      if (address === tensor.blake3) matched += 1;
      else mismatched.push({ name: tensor.name, expected: tensor.blake3, found: address });
    }
    return { witnessed: true, total: expected.length, matched, mismatched };
  } finally {
    await handle.close();
  }
}

// The signed manifest for one model, or null when this repository has not
// witnessed it. The signature is checked against the same pinned Sigstore
// roots the browse page uses, so a manifest served by any host is believed
// only if this repository's workflow signed those exact bytes.
export async function loadManifest(base, repo, policy, { timeoutMs = 20000 } = {}) {
  if (!base || !policy?.witnessPredicateType) return null;
  let bytes;
  try {
    const response = await fetch(new URL(`${repo}.json`, base), { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
  const bundleResponse = await fetch(new URL("witness.sigstore.json", base), { signal: AbortSignal.timeout(timeoutMs) });
  if (!bundleResponse.ok) return null;
  const facts = await verifyBundle(await bundleResponse.json(), bytes, {
    ...policy, predicateType: policy.witnessPredicateType,
  }).catch(() => null);
  const failed = facts
    ? ["chain", "time", "log", "signature", "identity", "subject", "predicate"].filter((k) => !facts[k])
    : ["bundle"];
  if (failed.length) throw new Error(`the manifest for ${repo} failed its signature check: ${failed.join(", ")}`);
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}
