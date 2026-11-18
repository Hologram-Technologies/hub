// Tamper harness: runs the hub's real local runner (runner/local.mjs at hub
// main) in-process, and stands a hostile network between it and every source
// by wrapping fetch. Metadata, holo, index and manifests pass untouched; only
// file bytes from a source are altered, per test mode.
import { createHash } from "node:crypto";
import { readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
const [hub, cacheDir] = process.argv.slice(2);
const { pathToFileURL } = await import("node:url"); const local = await import(pathToFileURL(join(hub, "runner", "local.mjs")).href);
const SITE = "https://hologram-technologies.github.io/hub";
const REPO = "sentence-transformers/all-MiniLM-L6-v2";

let mode = "clean";
const real = new Map();
const realFetch = globalThis.fetch;
const isFileFetch = (u) => /\/resolve\/[^/]+\/.+|ipfs\.filebase\.io\/ipfs\//.test(u) && !/\/api\//.test(u);
const tensorsOf = (b) => { const n = Number(b.readBigUInt64LE(0)); const h = JSON.parse(b.subarray(8, 8 + n).toString()); return { n, h, base: 8 + n }; };
function alter(b) {
  b = Buffer.from(b);
  if (mode === "clean") return b;
  if (mode === "truncate") return b.subarray(0, b.length - 1);
  if (mode === "extend") return Buffer.concat([b, Buffer.from([0])]);
  if (mode === "flip") { const at = b[0] === 0x7b ? 10 : b.length - 100; b[at] ^= 1; return b; }
  if (mode === "swap") {
    const { h, base } = tensorsOf(b);
    const byLen = {}; for (const [k, t] of Object.entries(h)) if (k !== "__metadata__") (byLen[t.data_offsets[1] - t.data_offsets[0]] ??= []).push(t);
    const pair = Object.values(byLen).find((l) => l.length > 1);
    const [x, y] = pair; const xs = Buffer.from(b.subarray(base + x.data_offsets[0], base + x.data_offsets[1]));
    b.copy(b, base + x.data_offsets[0], base + y.data_offsets[0], base + y.data_offsets[1]); xs.copy(b, base + y.data_offsets[0]);
    return b;
  }
  throw new Error(mode);
}
globalThis.fetch = async (input, init) => {
  const u = String(input?.url ?? input);
  if (!isFileFetch(u)) return realFetch(input, init);
  if (!real.has(u)) { const r = await realFetch(u, { redirect: "follow" }); if (!r.ok) return r; real.set(u, Buffer.from(await r.arrayBuffer())); }
  return new Response(alter(real.get(u)), { status: 200 });
};

await rm(cacheDir, { recursive: true, force: true });
const ready = await local.start({ holo: `${SITE}/app/app.holo`, index: `${SITE}/data/index/`, manifests: `${SITE}/data/manifests/`, cacheDir });
console.log(`runner up: kernel ${ready.fingerprint.slice(0, 16)}, index ${ready.index}`);

const sha = (b) => createHash("sha256").update(b).digest("hex");
async function ask(path, label) {
  const notes = [];
  const r = await local.handle(new Request(`http://127.0.0.1/${path}`), { onNote: (n) => notes.push(n) });
  const body = Buffer.from(await r.arrayBuffer());
  const row = { test: label, mode, path, status: r.status, code: r.headers.get("x-error-code"), message: r.headers.get("x-error-message"),
    source: r.headers.get("x-hub-source"), tensors: r.headers.get("x-hub-tensors"), bytes: body.length, sha256: r.ok ? sha(body) : null, notes };
  console.log(JSON.stringify(row));
  return { row, body };
}
async function cacheFiles() { const out = []; async function walk(d) { for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) { const p = join(d, e.name); if (e.isDirectory()) await walk(p); else out.push(p); } } await walk(cacheDir); return out; }
const reset = async () => { local.forget(); await rm(cacheDir, { recursive: true, force: true }); };

const ST = `${REPO}/resolve/main/model.safetensors`, CFG = `${REPO}/resolve/main/config.json`;
// Baseline: honest bytes.
mode = "clean"; const good = (await ask(ST, "baseline")).row.sha256; const goodCfg = (await ask(CFG, "baseline")).row.sha256;
// 1, 3, 4: hostile source, pinned so the cache is not consulted.
for (const m of ["flip", "truncate", "extend", "swap"]) { await reset(); mode = m; await ask(`via/huggingface.co/${ST}`, `source-${m}`); console.log(`  cache after: ${(await cacheFiles()).length} files`); }
for (const m of ["flip", "truncate", "extend"]) { await reset(); mode = m; await ask(`via/ipfs/${CFG}`, `source-${m}`); console.log(`  cache after: ${(await cacheFiles()).length} files`); }
// Hostile source, unpinned: every source sends bad bytes.
await reset(); mode = "flip"; await ask(ST, "all-sources-flip");
// 2: tampered cache.
async function cacheTamper(path, label, edit, expectGood) {
  await reset(); mode = "clean"; await ask(path, `${label}-fill`);
  const [file] = (await cacheFiles()).filter((f) => !f.includes("partial"));
  const b = await readFile(file); edit(b); await writeFile(file, b);
  const { row } = await ask(path, label);
  console.log(`  served bytes equal honest bytes: ${row.sha256 === expectGood}; served tampered: ${row.status === 200 && row.sha256 !== expectGood}`);
}
await cacheTamper(CFG, "cache-flip-config", (b) => { b[10] ^= 1; }, goodCfg);
await cacheTamper(ST, "cache-flip-tensor", (b) => { b[b.length - 100] ^= 1; }, good);
await cacheTamper(ST, "cache-flip-header", (b) => { const { n } = tensorsOf(b); const s = b.subarray(8, 8 + n).toString(); const i = s.indexOf('"pt"'); if (i < 0) throw new Error("no format pt"); b[8 + i + 2] = 0x75; }, good);
process.exit(0);
