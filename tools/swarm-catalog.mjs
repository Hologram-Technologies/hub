// Pirate Face's catalog as browse rows, sharded so a page can load a slice of
// it rather than all of it.
//
//   node tools/swarm-catalog.mjs <out dir> [--pages N] [--all]
//
// The hub's own index is 415 models in one shard of 263,532 bytes, and the
// page loads every shard it names and hashes each before drawing a row. That
// is why this is a separate set of shards rather than more of those: at 635
// bytes a row the whole catalog is 405 MB, and even a lean row is about 200
// MB. Measured 2026-11-14. Nothing is gained by making the first paint wait
// for 669k models nobody asked for.
//
// So the rows are lean and they are sharded by the first two characters of
// the model's name, lowercased. A search for `llama` reads the shards for
// `ll`; browsing by seeders reads `rank/0.json`. Neither reads the whole
// thing.
//
// Only what Pirate Face already knows is recorded. There are no Hugging Face
// calls here at all: `/api/models` carries the task, licence, parameter
// count, size, format, downloads, likes, revision and seeder count, which is
// everything a browse row needs. Addresses are a different artifact with a
// different purpose - `tools/swarm-index.mjs` - because a row you can list is
// not a file you can check.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { swarmKeyOf } from "../web/swarmkey.mjs";
import { bucket, family, modality, rulesVersion } from "./facets.mjs";

const args = process.argv.slice(2);
const out = args.shift();
const all = args.includes("--all");
const at = args.indexOf("--pages");
const maxPages = at >= 0 ? Number(args[at + 1]) : Infinity;
if (!out) {
  console.error("usage: node tools/swarm-catalog.mjs <out dir> [--pages N] [--all]");
  process.exit(64);
}

const PF = "https://pirateface.co";
const RANK_ROWS = 500;
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

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

// A browse row in the same shape `tools/facets.mjs` writes for an indexed
// model, because the page draws both with the same card and opens both with
// the same model page. A field Pirate Face cannot fill is null, which is the
// absence the page already knows how to draw; what it must never be is a
// guess, so nothing here is filled from anywhere but this listing.
//
// `state` is what tells the two apart, and it is the row's own word for
// itself: `listed` by the swarm, not addressed by this hub. `sources` is what
// the kernel would be offered, which is the swarm and nothing else until the
// address snapshot says otherwise.
function row(m, rank) {
  const id = m.id;
  // Pirate Face sends 0 for a model whose size it does not know. Kept as 0 it
  // would read as a model with no parameters, so it becomes the absence it
  // is; everything downstream already treats null as "not known".
  const params = m.params || m.activeParams || null;
  const org = m.author ?? id.split("/")[0];
  return {
    id,
    org,
    author: org,
    name: m.name ?? id.split("/")[1] ?? id,
    rank,
    created: (m.createdAt ?? "").slice(0, 10) || null,
    modified: (m.lastModified ?? m.updatedAt ?? "").slice(0, 10) || null,
    task: m.task ?? null,
    modality: modality(m.task ?? ""),
    params,
    bucket: bucket(params),
    // Pirate Face sends no tags, and these three are read off tags. A guess
    // would filter models into the wrong facet, which is worse than a row
    // that simply does not answer that filter.
    arch: null,
    languages: [],
    library: null,
    family: family(id),
    format: m.format ? m.format.toUpperCase() : "Other",
    license: m.license ?? null,
    revision: m.revision ?? null,
    // A file list is what this hub builds from a release it has read. Nothing
    // here has been read, so there is no count to give.
    files: null,
    weightBytes: m.sizeBytes ?? null,
    gated: false,
    state: "listed",
    sources: m.seeded ? ["pirateface"] : [],
    seeders: m.seed ?? 0,
    // Another host's traffic, named as such, the way the hub's own rows do it.
    observed: { source: PF, date: new Date().toISOString().slice(0, 10), downloads: m.downloads ?? 0, likes: m.likes ?? 0 },
    avatar: null,
  };
}

const byShard = new Map();
const ranked = [];
let seen = 0;
let kept = 0;
for await (const m of catalog()) {
  seen += 1;
  if (!m.id) continue;
  if (!all && !m.seeded) continue;
  const r = row(m, kept + 1);
  kept += 1;
  const name = swarmKeyOf(m.id);
  if (!byShard.has(name)) byShard.set(name, []);
  byShard.get(name).push(r);
  ranked.push(r);
  if (kept % 2000 === 0) console.log(`swarm-catalog: ${kept} rows kept, ${seen} scanned`);
}

await mkdir(join(out, "name"), { recursive: true });
await mkdir(join(out, "rank"), { recursive: true });
const name = [];
for (const [key, rows] of [...byShard].sort(([a], [b]) => a.localeCompare(b))) {
  rows.sort((a, b) => b.seeders - a.seeders || a.id.localeCompare(b.id));
  const bytes = JSON.stringify(rows);
  await writeFile(join(out, "name", `${key}.json`), bytes);
  name.push({ path: `name/${key}.json`, prefix: key, rows: rows.length, sha256: sha256(bytes) });
}

// The first page of a browse, by seeders, so the page has something to draw
// without reading every prefix.
const rank = [];
ranked.sort((a, b) => b.seeders - a.seeders || a.id.localeCompare(b.id));
for (let i = 0; i * RANK_ROWS < Math.min(ranked.length, RANK_ROWS * 20); i += 1) {
  const page = ranked.slice(i * RANK_ROWS, (i + 1) * RANK_ROWS).map((r, j) => ({ ...r, rank: i * RANK_ROWS + j + 1 }));
  const bytes = JSON.stringify(page);
  await writeFile(join(out, "rank", `${i}.json`), bytes);
  rank.push({ path: `rank/${i}.json`, rows: page.length, sha256: sha256(bytes) });
}

const root = {
  format: "hologram.hub.swarmcatalog/v1",
  catalog: PF,
  rules: rulesVersion,
  note: "Pirate Face's own listing, relayed. Seeder counts are its claims and nothing here is checked by this hub; whether a file's bytes can be checked is decided per file against an address from somewhere else.",
  date: new Date().toISOString().slice(0, 10),
  models: kept,
  scanned: seen,
  name,
  rank,
};
await writeFile(join(out, "root.json"), JSON.stringify(root));
const bytes = name.reduce((a, s) => a + s.rows, 0);
console.log(`swarm-catalog: ${kept} rows of ${seen} scanned, ${name.length} name shards, ${rank.length} rank pages (${bytes} rows indexed)`);
