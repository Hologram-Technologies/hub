// The UOR address index: one row per model file this build addressed, with the
// canonical κ-label and the leaf of every tensor inside it.
//
//   node tools/uor-index.mjs <index dir> <out dir> [--max-bytes N]
//
// Where the addresses come from, and why that is the point. Every address the
// hub has carried until now came from Hugging Face: the LFS `sha256` for a
// weight file and the git blob OID for a small one. That makes Hugging Face
// the only party who can say what a file's bytes should hash to, and no number
// of extra sources changes it -- `docs/hippius-source-study.md` measured a
// mirror whose digests agreed exactly and which therefore added nothing,
// because Hugging Face had already named them.
//
// `uor-addr` removes the question. It publishes a canonical form per format and
// mints a 71-byte κ-label `sha256:<64hex>` from it, under which two files that
// decode to the same logical content -- modulo metadata-key order, tensor order
// and tensor-data layout -- canonicalize to byte-identical skeletons and so to
// the same label. Anyone holding the bytes computes it; nobody is asked. That
// property is upstream's, cited and not restated here; what this build does is
// run it over bytes it streamed itself.
//
// The leaves are the half a reader can use. The canonical form represents every
// variable-length leaf by the streamed SHA-256 of its own bytes, so a tensor's
// leaf is the SHA-256 of that tensor's data region and nothing else. A client
// with the row can therefore fetch one tensor's byte range from any source and
// check it, with neither the whole file nor this hub's word for it. Measured
// 2026-11-16: 10,240 bytes of a 483,520-byte file, 206, 0.537 s, exact.
//
// GGUF only. `uor-addr 0.2.0` also ships an ONNX realization, but its skeleton
// is protobuf and the layout its leaves sit in has not been read here, so an
// ONNX file is reported as unaddressed rather than addressed by guesswork.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, open as openFile, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";

import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import { Blake3 } from "../try/vendor/prism-code/src/blake3.mjs";
import { uorBucket, uorShardPath } from "../web/uorkey.mjs";

const run = promisify(execFile);
const HF = "https://huggingface.co";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Sixteen shards for the few hundred files addressed today. The rule is
// `web/uorkey.mjs`'s and does not move; the width is data, published in the
// root, so widening it when the index grows is a rebuild and not a second
// rule.
const SHARD_BITS = 4;
// A file is read whole, because `uor_addr::gguf::address` takes a slice. The
// runner that builds this has about fourteen gigabytes of disk and sixteen of
// memory, so a file past this is left unaddressed and said to be, rather than
// failing the build or quietly vanishing from the count.
const MAX_BYTES = 3 * 1024 * 1024 * 1024;
const LABEL = process.env.UOR_LABEL ?? "./target/release/uor-label";

const [indexDir, out, ...rest] = process.argv.slice(2);
if (!indexDir || !out) {
  console.error("usage: node tools/uor-index.mjs <index dir> <out dir> [--max-bytes N]");
  process.exit(64);
}
const maxBytes = (() => {
  const at = rest.indexOf("--max-bytes");
  if (at < 0) return MAX_BYTES;
  const value = Number(rest[at + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`--max-bytes wants a positive number, not ${rest[at + 1]}`);
    process.exit(64);
  }
  return value;
})();

// Which models to address, as a list a reviewer can read, the way
// `manifests/models.txt` names the witnessed ones. A model named here that the
// index does not hold is a build failure: the list and the index must agree, or
// the list is a wish.
async function named(file) {
  const text = await readFile(join("manifests", file), "utf8");
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

const root = JSON.parse(await readFile(join(indexDir, "root.json"), "utf8"));
const held = new Map(root.records.map((r) => [r.repo.toLowerCase(), r]));
const wanted = await named("uor.txt");
const missing = wanted.filter((r) => !held.has(r.toLowerCase()));
if (missing.length) throw new Error(`uor-index: models named in manifests/uor.txt that the index does not hold: ${missing.join(", ")}`);

// One file's label and leaves, from bytes this process streamed and hashed.
// The file is written to disk because it is read whole, and removed straight
// after: nothing here keeps a weight file.
// A tensor's canonical address: BLAKE3 over the tensor's own raw bytes.
//
// This is the hub's number, not `uor-addr`'s. The canonical form fixes its own
// leaves to SHA-256 by definition -- `address_blake3` folds a skeleton whose
// leaves are still SHA-256 -- so the leaf cannot be BLAKE3 and is published
// beside this as `uorLeaf`, labelled as uor-addr's. BLAKE3 over the raw bytes
// is what `runner/uor.mjs` already emits per tensor, what hologram's
// substrate.rs calls the leaf identity, and what the Q engine names blocks by.
// One tensor, one identity, across the three.
//
// Read in chunks, because a tensor is gigabytes and the address must not need
// the tensor in memory any more than a reader checking it does.
async function blake3OfRange(handle, begin, length, buffer) {
  const hash = new Blake3();
  for (let at = 0; at < length; at += buffer.length) {
    const want = Math.min(buffer.length, length - at);
    const { bytesRead } = await handle.read(buffer, 0, want, begin + at);
    if (bytesRead !== want) throw new Error(`read ${bytesRead} of ${want} bytes at ${begin + at}`);
    hash.update(buffer.subarray(0, want));
  }
  return `blake3:${Buffer.from(hash.digest()).toString("hex")}`;
}

async function addressOne(repo, revision, file, work) {
  const url = `${HF}/${repo}/resolve/${revision}/${file.path}`;
  const local = join(work, "subject.gguf");
  const started = Date.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(60 * 60000) });
  if (!response.ok) throw new Error(`${repo}/${file.path}: ${response.status}`);
  await pipeline(response.body, createWriteStream(local));
  const seen = (await stat(local)).size;
  if (seen !== file.size) throw new Error(`${repo}/${file.path}: ${seen} bytes, the record says ${file.size}`);
  // The label and the leaves come from `uor-label`, which calls `uor-addr`.
  // Its JSON is this build's only source for either.
  const { stdout } = await run(LABEL, [local], { maxBuffer: 256 * 1024 * 1024 });
  const minted = JSON.parse(stdout);
  if (minted.bytes !== file.size) throw new Error(`${repo}/${file.path}: uor-label read ${minted.bytes} bytes, the record says ${file.size}`);
  // The canonical address of each tensor, taken here from the same bytes
  // `uor-label` just read, while the file is still on disk. `uor-label` gave
  // the ranges; this gives the addresses over them.
  const handle = await openFile(local, "r");
  try {
    const buffer = Buffer.alloc(4 << 20);
    for (const tensor of minted.tensors) {
      tensor.address = await blake3OfRange(handle, tensor.begin, tensor.length, buffer);
    }
  } finally {
    await handle.close();
  }
  await rm(local, { force: true });
  console.log(`  ${repo}/${file.path}: ${minted.label.slice(0, 23)}... ${minted.tensors.length} tensors in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return { minted, seconds: (Date.now() - started) / 1000 };
}

const rows = [];
const unaddressed = [];
for (const repo of wanted) {
  const record = JSON.parse(await readFile(join(indexDir, "models", `${held.get(repo.toLowerCase()).repo}.json`), "utf8"));
  const gguf = record.files.filter((f) => f.path.toLowerCase().endsWith(".gguf"));
  const other = record.files.filter((f) => /\.(onnx|safetensors)$/i.test(f.path));
  for (const file of other) {
    unaddressed.push({ repo: record.repo, path: file.path, size: file.size, why: "no canonical form is read here for this format" });
  }
  console.log(`${record.repo}@${record.revision.slice(0, 8)}: ${gguf.length} GGUF file${gguf.length === 1 ? "" : "s"}`);
  if (!gguf.length) continue;
  for (const file of gguf) {
    if (file.size > maxBytes) {
      unaddressed.push({ repo: record.repo, path: file.path, size: file.size, why: `larger than the ${maxBytes} bytes this build reads whole` });
      console.log(`  ${record.repo}/${file.path}: ${file.size} bytes, left unaddressed`);
      continue;
    }
    const work = await mkdtemp(join(tmpdir(), "uor-"));
    try {
      let minted;
      try {
        ({ minted } = await addressOne(record.repo, record.revision, file, work));
      } catch (error) {
        // `uor-addr` addresses GGUF v3 and refuses anything else, including
        // the two deprecated tensor types and any version before 3. A file it
        // will not address has no canonical address, which is a fact about
        // the file and not a reason to abandon the index: it is recorded, with
        // what was said about it, and the build goes on.
        // `uor-label` says why on stderr when it refuses; anything else that
        // went wrong says it in the error. An empty stderr is not a reason, so
        // it is not reported as one.
        const said = String(error?.stderr ?? "").trim();
        const why = (said ? said.split(String.fromCharCode(10)).pop() : String(error?.message ?? error)).trim();
        unaddressed.push({ repo: record.repo, path: file.path, size: file.size, why });
        console.log(`  ${record.repo}/${file.path}: left unaddressed (${why})`);
        continue;
      }
      rows.push({
        repo: record.repo,
        revision: record.revision,
        path: file.path,
        size: file.size,
        // The address, and the form that produced it. A label without its
        // canonical-form version is ambiguous the moment upstream bumps one,
        // so the two travel together and never apart.
        label: minted.label,
        // uor-addr's own sha256-axis label over the same skeleton. Published
        // beside the blake3 one because they name the same bytes, and a reader
        // who has only ever seen sha256 labels should be able to tell that
        // rather than guess at it.
        sha256Label: minted.sha256Label,
        canonicalForm: minted.canonicalForm,
        realization: minted.realization,
        // Where these exact bytes were streamed from, so a client checking a
        // leaf fetches from the place the label was taken over rather than
        // from a host name the page carries. `HK-20` is the same principle for
        // a release record: the record names where its own bytes come from.
        resolve: `${HF}/${record.repo}/resolve/${record.revision}/`,
        // The first byte of the data section. A tensor's `begin` is absolute
        // already; this is published so a reader can see the layout the ranges
        // were taken from.
        dataStart: minted.dataStart,
        // The address of the file's own bytes stays beside it, because that is
        // what a Hugging Face client knows the file by and what the record
        // already carries. The κ-label is the content's identity; this is the
        // container's.
        sha256: file.sha256 ?? null,
        tensors: minted.tensors,
      });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}

// Filed by the one rule, which the page imports from the same module.
const shards = new Map();
for (const row of rows) {
  const bucket = await uorBucket(row.repo, SHARD_BITS);
  if (!shards.has(bucket)) shards.set(bucket, []);
  shards.get(bucket).push(row);
}

await mkdir(join(out, "shards"), { recursive: true });
for (const name of await readdir(join(out, "shards")).catch(() => [])) {
  await rm(join(out, "shards", name), { force: true });
}
const written = [];
for (const bucket of [...shards.keys()].sort((a, b) => a - b)) {
  // Sorted, so two builds of the same rows give the same bytes and the same
  // digest.
  const page = shards.get(bucket).sort((a, b) => (a.repo === b.repo ? a.path.localeCompare(b.path) : a.repo.localeCompare(b.repo)));
  const path = uorShardPath(bucket);
  const bytes = JSON.stringify(page);
  await mkdir(dirname(join(out, path)), { recursive: true });
  await writeFile(join(out, path), bytes);
  written.push({ path, bucket, rows: page.length, sha256: sha256(bytes) });
}

const manifest = {
  format: "hologram.hub.uor/v2",
  // Which released code minted these labels, which canonical form it used, and
  // which axis the label is on. An address is only an address while all three
  // are fixed, so all three are published beside it. Both axes are 71 bytes, so
  // a reader tells them apart by the prefix and never by the length.
  addresser: { crate: "uor-addr", version: "0.2.0", realization: "gguf", axis: "blake3" },
  // A tensor's address is this hub's own: BLAKE3 over the tensor's raw bytes,
  // the same number runner/uor.mjs emits. `uorLeaf` beside it is uor-addr's
  // canonical-form leaf, which is SHA-256 by the form's definition and is what
  // the model label binds. They are different numbers for the same bytes, so
  // each says whose it is.
  tensorAddress: { axis: "blake3", over: "the tensor's raw bytes", by: "runner/uor.mjs" },
  canonicalForm: rows.length ? rows[0].canonicalForm : null,
  shardBits: SHARD_BITS,
  counts: {
    models: new Set(rows.map((r) => r.repo)).size,
    files: rows.length,
    tensors: rows.reduce((n, r) => n + r.tensors.length, 0),
    unaddressed: unaddressed.length,
  },
  // What was not addressed, and why, named file by file. A count of what is
  // covered means nothing without it.
  unaddressed,
  shards: written,
};
await writeFile(join(out, "root.json"), JSON.stringify(manifest));
console.log(`uor-index: ${manifest.counts.files} files, ${manifest.counts.tensors} tensors, ${manifest.counts.models} models, ${written.length} shards, ${unaddressed.length} unaddressed`);
