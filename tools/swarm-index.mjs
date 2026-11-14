// The address snapshot: what the swarm's models should hash to, taken from
// Hugging Face while Hugging Face still answers.
//
//   node tools/swarm-index.mjs <out dir> [--pages N] [--models N]
//
// This is deliberately not an index of Pirate Face. Its catalog is 669k models
// and a seeder count that changes by the minute, and copying either buys
// nothing: both can be asked for live, and `runner/discover.mjs` does.
//
// What cannot be asked for later is the address. A model is self-verifying
// only against a digest from somewhere other than the party serving the bytes,
// so an address from Pirate Face cannot check bytes from Pirate Face's swarm.
// Hugging Face is that other party today, and for a model it has removed there
// is no third. So the one thing worth a build is a copy of Hugging Face's
// addresses for the models that have a torrent, made before it stops giving
// them out. 25,825 models have one, measured 2026-11-14, against 669k listed.
//
// A row is the smallest thing that keeps a release verifiable:
//
//   { repo, revision, files: [ { path, size, sha256 | gitSha1 } ] }
//
// A large file carries Hugging Face's SHA-256; a small one carries its git
// blob identity, because Hugging Face publishes no SHA-256 for those and the
// git blob is then the only independent address there is.
//
// No magnet and no infohash: those are fetched live when a file is actually
// pulled, they change when a torrent is rebuilt, and recording them would
// double the build for something that is not lost when Hugging Face goes.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const out = args.shift();
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
if (!out) {
  console.error("usage: node tools/swarm-index.mjs <out dir> [--pages N] [--models N]");
  process.exit(64);
}
const maxPages = option("--pages", Infinity);
const maxModels = option("--models", Infinity);

const PF = "https://pirateface.co";
const HF = "https://huggingface.co";
const SHARDS = 256;
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const shardOf = (repo) => sha256(repo).slice(0, 2);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const SHA256 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;

// Hugging Face allows anonymous clients 500 calls per 5 minutes; this makes at
// most one a second and backs off when told to.
let lastHf = 0;
async function hf(path) {
  const wait = lastHf + 1100 - Date.now();
  if (wait > 0) await pause(wait);
  lastHf = Date.now();
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${HF}${path}`, { signal: AbortSignal.timeout(30000) });
    if (r.status === 429 && attempt < 4) { await pause(Number(r.headers.get("retry-after") ?? 30) * 1000); continue; }
    if (r.status === 401 || r.status === 404 || r.status === 403) return null;
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
}

// `/api/models` is cursor-paginated and hard-capped at 30 rows; `limit`,
// `seeded`, `filter`, `sort` and `hasTorrent` are accepted and ignored
// (measured 2026-11-14), so the only way to the models with torrents is
// through all of them.
async function* catalog() {
  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    const url = `${PF}/api/models${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const body = await r.json();
    for (const row of body.models ?? []) yield row;
    cursor = body.nextCursor;
    if (!cursor) return;
  }
}

// What was kept last time, so a release whose revision has not moved is not
// fetched again. After the first build this is almost all of them.
const kept = new Map();
for (let i = 0; i < SHARDS; i += 1) {
  const name = i.toString(16).padStart(2, "0");
  try {
    for (const row of JSON.parse(await readFile(join(out, "shards", `${name}.json`), "utf8"))) {
      kept.set(row.repo, row);
    }
  } catch { /* a shard that is not there yet */ }
}

const rows = new Map();
let seen = 0;
let seeded = 0;
let masked = 0;
let reused = 0;
let fetched = 0;
let gone = 0;
for await (const row of catalog()) {
  seen += 1;
  if (!row.seeded || !row.id || !row.revision) continue;
  seeded += 1;
  if (rows.size >= maxModels) break;
  const was = kept.get(row.id);
  if (was && was.revision === row.revision) {
    rows.set(row.id, was);
    reused += 1;
    continue;
  }
  let tree;
  try {
    tree = await hf(`/api/models/${row.id}/tree/${row.revision}?recursive=true`);
  } catch (error) {
    console.warn(`swarm-index: ${row.id} skipped (${error.message})`);
    continue;
  }
  if (!tree) {
    // Hugging Face no longer answers for it. There is no second independent
    // address, so the honest record is none: a reader must not be handed
    // Pirate Face's own digest as though this hub had checked it.
    gone += 1;
    continue;
  }
  // Weights and everything else. A snapshot of 25,825 models' weights without
  // their `config.json` and tokenizer keeps the bytes and loses the models,
  // and the small files are the ones Hugging Face gives no SHA-256 for, so
  // their git blob identity is the only independent address that will exist
  // once it stops answering. Recording an address nothing acts on yet costs a
  // few bytes; not recording it means a later decision cannot be acted on
  // backwards.
  //
  // What is recorded has to be an address. Hugging Face answers for a gated
  // repository with the shape of a digest and none of the digest - sixty-four
  // asterisks where the LFS oid goes - and written down unchecked that is a
  // row claiming an address this hub can never verify anything against. So
  // the oid is matched before it is kept, and a file whose digest Hugging
  // Face will not give has no address here. That is the true answer: for a
  // gated model there is no second independent digest to have.
  //
  // An LFS file falls back to nothing rather than to `oid`, because for an
  // LFS file git holds a 134-byte pointer and `oid` is the hash of that
  // pointer, not of the bytes anyone wants to check.
  const files = tree
    .filter((f) => f.type === "file")
    .map((f) => {
      if (SHA256.test(f.lfs?.oid ?? "")) return { path: f.path, size: f.size, sha256: f.lfs.oid };
      if (!f.lfs && SHA1.test(f.oid ?? "")) return { path: f.path, size: f.size, gitSha1: f.oid };
      masked += 1;
      return null;
    })
    .filter(Boolean);
  if (!files.length) continue;
  rows.set(row.id, { repo: row.id, revision: row.revision, files });
  fetched += 1;
  if (fetched % 50 === 0) console.log(`swarm-index: ${rows.size} models, ${fetched} fetched, ${seen} scanned`);
}

await mkdir(join(out, "shards"), { recursive: true });
const shards = [];
for (let i = 0; i < SHARDS; i += 1) {
  const name = i.toString(16).padStart(2, "0");
  const page = [...rows.values()].filter((r) => shardOf(r.repo) === name)
    .sort((a, b) => a.repo.localeCompare(b.repo));
  if (!page.length) continue;
  const bytes = JSON.stringify(page);
  await writeFile(join(out, "shards", `${name}.json`), bytes);
  shards.push({ path: `shards/${name}.json`, rows: page.length, sha256: sha256(bytes) });
}

const root = {
  format: "hologram.hub.swarm/v1",
  // What this is and is not, carried with it rather than only in the docs.
  addresses: HF,
  catalog: PF,
  note: "Addresses are Hugging Face's, for models Pirate Face lists with a torrent. A model Hugging Face no longer answers for is absent rather than addressed by the party serving its bytes.",
  date: new Date().toISOString().slice(0, 10),
  models: rows.size,
  shards,
};
await writeFile(join(out, "root.json"), JSON.stringify(root));
console.log(`swarm-index: ${rows.size} models addressed in ${shards.length} shards`);
console.log(`swarm-index: ${seen} scanned, ${seeded} with a torrent, ${reused} reused, ${fetched} fetched, ${gone} no longer on Hugging Face`);
console.log(`swarm-index: ${masked} file(s) left unaddressed because Hugging Face would not give a digest for them`);
