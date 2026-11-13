// Builds the hub's index: everything an edge needs to answer the Hugging Face
// read surface for a model without asking Hugging Face. One record per model
// (its release commit, every file with its size and hashes, which sources hold
// it, and the ten fields the kernel calls a complete record), a catalog of the
// models, and a root that names the catalog and every record by SHA-256. Only
// the root is signed (pages.yml); a record is trusted because the signed root
// names its hash.
//
// A record holds two kinds of thing, and says which is which. Facts about the
// bytes - the files, their hashes, the config, the card, the tensor counts -
// anyone holding the bytes can re-derive. Counts of other people's traffic -
// downloads and likes - nobody can, so they are kept under `observed`, with
// the host that measured them and the day they were read.
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
import { browseRow, rulesVersion } from "./facets.mjs";

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
    if (kept.revision === row.sha && kept.format === "hologram.hub.release/v2") record = kept;
  } catch {}
  if (!record) {
    try {
      // Two calls per release: the repository, which carries the fields a
      // client reads, and the tree, which carries each file's size and
      // address. The repository's own answer is preferred over the catalog
      // row for everything both hold, because it is the publisher's.
      const about = await hf(`/api/models/${row.id}?blobs=false`);
      const tree = await hf(`/api/models/${row.id}/tree/${row.sha}?recursive=true`);
      let sources = [];
      try {
        const held = await json(`${SOURCES}/${row.id}.json`);
        if (held.revision === row.sha) sources = held.sources.filter((s) => s.resolve).map((s) => ({ kind: s.kind, resolve: s.resolve, missing: s.missing ?? [] }));
      } catch {}
      const files = tree.filter((f) => f.type === "file").map((f) => ({
        path: f.path, size: f.size, gitSha1: f.oid, ...(f.lfs ? { sha256: f.lfs.oid, pointerSize: f.lfs.pointerSize } : {}),
      }));
      // The card is not copied into the record. The record names the file and
      // the address its bytes must have, so a reader fetches it from any
      // source and checks it for itself.
      const card = files.find((f) => f.path.toLowerCase() === "readme.md");
      record = {
        format: "hologram.hub.release/v2",
        repo: row.id,
        revision: row.sha,
        info: {
          author: about.author ?? row.author ?? null,
          tags: about.tags ?? row.tags ?? [],
          pipeline_tag: about.pipeline_tag ?? row.pipeline_tag ?? null,
          library_name: about.library_name ?? row.library_name ?? null,
          createdAt: about.createdAt ?? row.createdAt ?? null,
          lastModified: about.lastModified ?? null,
          gated: about.gated ?? false,
          private: about.private ?? false,
          disabled: about.disabled ?? false,
        },
        config: about.config ?? null,
        cardData: about.cardData ?? null,
        card: card ? { path: card.path, gitSha1: card.gitSha1 } : null,
        safetensors: about.safetensors ?? null,
        transformersInfo: about.transformersInfo ?? null,
        // Measurements of another host's traffic, named as such.
        observed: {
          source: HF,
          date: new Date().toISOString().slice(0, 10),
          downloads: about.downloads ?? row.downloads ?? 0,
          likes: about.likes ?? row.likes ?? 0,
        },
        files,
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

// The browse shards: what the page lists, derived once from the records by
// the same rule the page filters by (`tools/facets.mjs`). A shard is named in
// the root by the hash of its bytes, so a reader checks it before drawing a
// row of it, and the signature over the root covers the listing as well as
// the releases.
const SHARD_ROWS = 500;
await mkdir(join(out, "browse"), { recursive: true });
const browse = [];
const ordered = [];
for (const [rank, { repo }] of records.entries()) {
  try {
    ordered.push(browseRow(JSON.parse(await readFile(join(out, "models", `${repo}.json`), "utf8")), rank + 1));
  } catch {}
}
for (let i = 0; i * SHARD_ROWS < ordered.length; i++) {
  const page = ordered.slice(i * SHARD_ROWS, (i + 1) * SHARD_ROWS);
  const bytes = JSON.stringify(page);
  await writeFile(join(out, "browse", `${i}.json`), bytes);
  browse.push({ path: `browse/${i}.json`, rows: page.length, sha256: sha256(bytes) });
}

const root = {
  format: "hologram.hub.index/v2",
  catalog: sha256(catalog),
  // The rule that produced the browse rows, published with them.
  rules: rulesVersion,
  browse,
  records,
};
await writeFile(join(out, "root.json"), JSON.stringify(root));
// The kernel calls a record complete when it holds all ten fields; the build
// says how many do, because an incomplete record makes the edge ask the
// source dialect instead of answering from the index.
const whole = (r) => Boolean(r.revision && r.files?.length && r.info?.tags && r.info?.pipeline_tag
  && r.info?.library_name && r.config && r.cardData && r.safetensors && r.info?.lastModified
  && r.info?.gated !== undefined);
let complete = 0;
for (const { repo } of records) {
  try {
    if (whole(JSON.parse(await readFile(join(out, "models", `${repo}.json`), "utf8")))) complete += 1;
  } catch {}
}
console.log(`index: ${records.length} records (${fetched} fetched, ${records.length - fetched} reused), ${complete} complete, ${browse.length} browse shards holding ${ordered.length} rows`);
