// Builds the hub's index: everything an edge needs to answer the Hugging Face
// read surface for a model without asking Hugging Face. One record per model
// (its release commit, every file with its size and hashes, which sources hold
// it), a catalog of the models, and a root that names the catalog and every
// record by SHA-256. Only the root is signed (pages.yml); a record is trusted
// because the signed root names its hash.
//
//   node tools/index.mjs <out dir> [limit]
//
// A record already in <out dir> for the same revision is reused, so a cache of
// <out dir> means only changed releases are fetched again. Hugging Face's API
// allows anonymous clients 500 calls per 5 minutes; this makes at most one a
// second.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const [out, limitArg] = process.argv.slice(2);
if (!out) {
  console.error("usage: node tools/index.mjs <out dir> [limit]");
  process.exit(64);
}
const CATALOG = "https://gethologram.ai/api/models?limit=500";
const SOURCES = "https://gethologram.ai/data/files";
const HF = "https://huggingface.co";
const limit = Number(limitArg ?? 500);
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, timeout = 30000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

let lastHf = 0;
async function hf(path) {
  const wait = lastHf + 1100 - Date.now();
  if (wait > 0) await pause(wait);
  lastHf = Date.now();
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${HF}${path}`, { signal: AbortSignal.timeout(30000) });
    if (r.status === 429 && attempt < 4) { await pause(Number(r.headers.get("retry-after") ?? 30) * 1000); continue; }
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
}

const rows = (await json(CATALOG, 60000)).filter((m) => !m.gated && !m.private && m.sha && /^[\w.-]+\/[\w.-]+$/.test(m.id)).slice(0, limit);
// Witnessed models are always indexed, trending or not.
const witnessed = (await readFile(new URL("../manifests/models.txt", import.meta.url), "utf8"))
  .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
for (const repo of witnessed.filter((r) => !rows.some((m) => m.id === r))) {
  const found = (await json(`https://gethologram.ai/api/models?search=${encodeURIComponent(repo.split("/")[1])}&limit=50`)).find((m) => m.id === repo);
  if (found?.sha) { rows.push(found); continue; }
  // The catalog's search does not reach every model, so ask Hugging Face directly.
  const m = await hf(`/api/models/${repo}`);
  rows.push({ id: m.id, sha: m.sha, author: m.author, tags: m.tags, pipeline_tag: m.pipeline_tag, library_name: m.library_name, createdAt: m.createdAt, likes: m.likes, downloads: m.downloads });
}
const missing = witnessed.filter((r) => !rows.some((m) => m.id === r));
if (missing.length) throw new Error(`index: witnessed models without a release: ${missing.join(", ")}`);
const records = [];
let fetched = 0;
for (const row of rows) {
  const path = join(out, "models", `${row.id}.json`);
  let record = null;
  try {
    const kept = JSON.parse(await readFile(path, "utf8"));
    if (kept.revision === row.sha) record = kept;
  } catch {}
  if (!record) {
    try {
      const tree = await hf(`/api/models/${row.id}/tree/${row.sha}?recursive=true`);
      let sources = [];
      try {
        const held = await json(`${SOURCES}/${row.id}.json`);
        if (held.revision === row.sha) sources = held.sources.filter((s) => s.resolve).map((s) => ({ kind: s.kind, resolve: s.resolve, missing: s.missing ?? [] }));
      } catch {}
      record = {
        format: "hologram.hub.release/v1",
        repo: row.id,
        revision: row.sha,
        info: {
          author: row.author, tags: row.tags ?? [], pipeline_tag: row.pipeline_tag ?? null, library_name: row.library_name ?? null,
          createdAt: row.createdAt ?? null, likes: row.likes ?? 0, downloads: row.downloads ?? 0,
        },
        files: tree.filter((f) => f.type === "file").map((f) => ({
          path: f.path, size: f.size, gitSha1: f.oid, ...(f.lfs ? { sha256: f.lfs.oid, pointerSize: f.lfs.pointerSize } : {}),
        })),
        sources,
      };
      fetched += 1;
    } catch (error) {
      console.warn(`index: ${row.id} skipped (${error.message})`);
      continue;
    }
  }
  const bytes = JSON.stringify(record);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  records.push({ repo: record.repo, revision: record.revision, sha256: sha256(bytes) });
}

const catalog = JSON.stringify(rows.filter((r) => records.some((x) => x.repo === r.id)));
await writeFile(join(out, "catalog.json"), catalog);
const root = { format: "hologram.hub.index/v1", catalog: sha256(catalog), records };
await writeFile(join(out, "root.json"), JSON.stringify(root));
console.log(`index: ${records.length} records (${fetched} fetched, ${records.length - fetched} reused)`);
