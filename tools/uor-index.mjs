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
// mints a 71-byte κ-label `blake3:<64hex>` from it, under which two files that
// decode to the same logical content -- modulo metadata-key order, tensor order
// and tensor-data layout -- canonicalize to byte-identical skeletons and so to
// the same label. Anyone holding the bytes computes it; nobody is asked. That
// property is upstream's, cited and not restated here; what this build does is
// run it over bytes it streamed itself.
//
// The leaves are the half a reader can use. The canonical form represents every
// variable-length leaf by the BLAKE3 of its own bytes, so a tensor's leaf is the
// BLAKE3 of that tensor's data region and nothing else: the tensor's address,
// the same number `runner/uor.mjs` emits and hologram's substrate.rs calls the
// leaf identity. One tensor, one identity. A client
// with the row can therefore fetch one tensor's byte range from any source and
// check it, with neither the whole file nor this hub's word for it. Measured
// 2026-11-16: 10,240 bytes of a 483,520-byte file, 206, 0.537 s, exact.
//
// GGUF and safetensors. `uor-addr 0.4.0` also ships an ONNX realization, but its
// skeleton is protobuf and the layout its leaves sit in has not been read here,
// so an ONNX file is reported as unaddressed rather than addressed by guesswork.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";

import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

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
const listed = await named("uor.txt");
// A model on the list that the index does not hold is recorded, not fatal.
//
// The index is rebuilt from a live catalogue on every run, so a model can
// leave it between one build and the next with nobody editing this list. That
// is what happened the first time this ran in CI: `Cudecnik/Qwen3.8-Flash-Next-
// refusal-projection` was in the index when the list was written and gone a few
// hours later, and refusing to go on meant the whole site did not deploy. A
// name the catalogue has lost is a fact about the catalogue. It goes in
// `unaddressed` with every other thing this build could not address, where a
// reader sees it, rather than stopping the build that would have told them.
const rows = [];
// Each tensor longer than one piece has a piece table: BLAKE3's tree over its
// bytes cut at 1 MiB, one 32-byte chaining value per piece, which folds back
// to the tensor's address. With it a reader checks any byte range of the
// tensor piece by piece as it arrives (web/pieces.mjs) instead of only at the
// end. It certifies itself against the address, so it is published by that
// address and any host may serve it.
const tables = new Map();
const unaddressed = [];
const wanted = listed.filter((repo) => held.has(repo.toLowerCase()));
for (const repo of listed.filter((r) => !held.has(r.toLowerCase()))) {
  unaddressed.push({ repo, path: null, size: null, why: "named in manifests/uor.txt, but the signed index no longer holds it" });
  console.log(`${repo}: the index does not hold it, left unaddressed`);
}

// One file's label and tensor addresses, from bytes this process streamed and
// hashed. The file is written to disk because it is read whole, and removed
// straight after: nothing here keeps a weight file.
async function addressOne(repo, revision, file, work) {
  const url = `${HF}/${repo}/resolve/${revision}/${file.path}`;
  const local = join(work, "subject");
  const started = Date.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(60 * 60000) });
  if (!response.ok) throw new Error(`${repo}/${file.path}: ${response.status}`);
  await pipeline(response.body, createWriteStream(local));
  const seen = (await stat(local)).size;
  if (seen !== file.size) throw new Error(`${repo}/${file.path}: ${seen} bytes, the record says ${file.size}`);
  // The label and the tensor addresses come from `uor-label`, which calls
  // `uor-addr` and refuses to print a leaf that is not the BLAKE3 of exactly
  // the byte range beside it. Its JSON is this build's only source for either.
  const { stdout } = await run(LABEL, [local], { maxBuffer: 256 * 1024 * 1024 });
  const minted = JSON.parse(stdout);
  if (minted.bytes !== file.size) throw new Error(`${repo}/${file.path}: uor-label read ${minted.bytes} bytes, the record says ${file.size}`);
  await rm(local, { force: true });
  console.log(`  ${repo}/${file.path}: ${minted.label.slice(0, 23)}... ${minted.tensors.length} tensors in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return { minted, seconds: (Date.now() - started) / 1000 };
}

for (const repo of wanted) {
  const record = JSON.parse(await readFile(join(indexDir, "models", `${held.get(repo.toLowerCase()).repo}.json`), "utf8"));
  // The extension only chooses which files to fetch. `uor-label` decides the
  // realization from the bytes, so a misnamed file is refused, not misread.
  const weights = record.files.filter((f) => /\.(gguf|safetensors)$/i.test(f.path));
  const other = record.files.filter((f) => /\.onnx$/i.test(f.path));
  for (const file of other) {
    unaddressed.push({ repo: record.repo, path: file.path, size: file.size, why: "no canonical form is read here for this format" });
  }
  console.log(`${record.repo}@${record.revision.slice(0, 8)}: ${weights.length} weight file${weights.length === 1 ? "" : "s"}`);
  if (!weights.length) continue;
  for (const file of weights) {
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
        // `uor-addr` addresses GGUF v3 and safetensors and refuses anything
        // else, including the two deprecated GGUF tensor types, any GGUF
        // version before 3, and a safetensors header it cannot bind. A file it
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
        tensors: minted.tensors.map(({ pieces, ...tensor }) => {
          if (pieces) tables.set(tensor.address.slice(7), pieces);
          return tensor;
        }),
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

await mkdir(join(out, "pieces"), { recursive: true });
for (const name of await readdir(join(out, "pieces")).catch(() => [])) {
  await rm(join(out, "pieces", name), { force: true });
}
for (const [hex, table] of [...tables].sort(([a], [b]) => a.localeCompare(b))) {
  await writeFile(join(out, "pieces", hex), Buffer.from(table, "hex"));
}
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
  format: "hologram.hub.uor/v3",
  // Which released code minted these labels, which canonical form it used, and
  // which axis the label is on. An address is only an address while all three
  // are fixed, so all three are published beside it.
  addresser: { crate: "uor-addr", version: "0.4.0", realizations: ["gguf", "safetensors"], axis: "blake3" },
  // A tensor's address is uor-addr's canonical-form leaf: BLAKE3 over the
  // tensor's raw bytes, which the model label binds and runner/uor.mjs emits.
  tensorAddress: { axis: "blake3", over: "the tensor's raw bytes", by: "uor-addr canonical-form leaf" },
  // Where a tensor's piece table is: named by the tensor's address, in
  // hologram-space's HPTREE01 encoding, for every tensor longer than 1 MiB.
  pieceTables: { path: "pieces/{address hex}", encoding: "HPTREE01", pieceLength: 1048576, count: tables.size },
  // One form per realization, because each realization numbers its own: GGUF
  // is on form 3 and safetensors on form 2. A row's form is read against the
  // entry for its realization, never against a single number for the index.
  canonicalForms: Object.fromEntries([...new Set(rows.map((r) => r.realization))].sort().map((r) => [r, rows.find((x) => x.realization === r).canonicalForm])),
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
