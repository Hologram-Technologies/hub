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
// Three lists name what is indexed: the catalog of trending models, the
// witnessed models in `manifests/models.txt`, and the owners in
// `manifests/owners.txt`, each of which is indexed whole - every public model
// Hugging Face lists under that name. The build line says how many records
// each list contributed. `[limit]` caps the catalog only; the other two lists
// are indexed entire, because a list a person wrote is not a ranking to cut.
//
// All three lists, and every fact in a record, come from Hugging Face. The one
// thing still asked of gethologram.ai is which other sources hold a release's
// bytes, because nobody else has hashed them; a release it does not answer for
// is indexed with no second source.
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
// A second witness: Pirate Face publishes a SHA-256 per weight file for the
// models it indexes. Hugging Face publishes one only for LFS files, so this
// fills the gaps for small files and gives a second opinion on the rest.
// Nothing here is believed on its own: a value is kept only with the name of
// the witness that gave it and the day it was read, and only when the witness
// names the same revision the release does.
const WITNESS = "https://pirateface.co/api/torrents";
const HF = "https://huggingface.co";
const limit = Number(limitArg ?? 500);
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
  console.error(`index: the limit is a whole number from 1 to 1000, not ${JSON.stringify(limitArg)}`);
  process.exit(64);
}
// The models to index: Hugging Face's own trending list, asked of Hugging
// Face. It used to be asked of gethologram.ai, which reports the same list,
// and that made this hub's index a copy of the hub it means to replace.
// Measured 2026-11-14: the two lists agree on 367 of 500 ids and on the whole
// head of the order, and Hugging Face carries `sha` on all 500 rows against
// gethologram.ai's 399, so the seed is a longer one as well as a first-hand
// one. `full=true` is what carries `sha`; without it no row does.
const CATALOG = `${HF}/api/models?sort=trendingScore&direction=-1&limit=${limit}&full=true`;
// Which other sources hold a release's bytes. This is the one thing the build
// still asks of the live hub, because nothing here re-derives it: a claim that
// ModelScope or IPFS holds the same bytes has to be made by whoever hashed
// them. A release it does not answer for is indexed with no second source,
// which costs the model page its cross-source check and nothing else.
//
// Seeding from Hugging Face rather than from the live hub makes that a third
// of the catalog rather than a handful. That is a decision taken on
// 2026-11-14, not an oversight, and these are the numbers it was taken on:
// the two 500-row lists agree on 367 ids, and of 20 sampled ids both hold, 20
// have a record here, against none of 20 that only Hugging Face holds. So
// about 133 rows arrive with no second source. What was weighed was 399
// records nearly all with one, against about 500 of which roughly 73 per cent
// can have one.
const SOURCES = "https://gethologram.ai/data/files";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, timeout = 30000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

// One call per release. A witness that names a different revision is ignored
// outright: its hashes would be for other bytes.
async function secondWitness(repo, revision) {
  try {
    const answer = await json(`${WITNESS}?repo=${encodeURIComponent(repo)}`, 20000);
    const entry = Array.isArray(answer) ? answer[0] : answer;
    if (!entry || entry.revision !== revision) return [];
    const addresses = (entry.files ?? [])
      .filter((f) => f.path && /^[0-9a-f]{64}$/.test(f.sha256 ?? ""))
      .map((f) => ({ path: f.path, sha256: f.sha256 }));
    if (!addresses.length) return { witnesses: [], infohash: null };
    return {
      witnesses: [{ source: "pirateface.co", date: new Date().toISOString().slice(0, 10), revision: entry.revision, addresses }],
      // A torrent makes it a source, not merely a witness: the bytes can
      // be fetched from the swarm and not only described by it.
      infohash: /^[0-9a-f]{40}$/.test(entry.infohash ?? "") ? entry.infohash : null,
    };
  } catch {
    // A witness that cannot be reached is simply absent; the release still
    // carries what Hugging Face published.
    return { witnesses: [], infohash: null };
  }
}

let lastHf = 0;
async function hfFetch(path) {
  const wait = lastHf + 1100 - Date.now();
  if (wait > 0) await pause(wait);
  lastHf = Date.now();
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${HF}${path}`, { signal: AbortSignal.timeout(30000) });
    if (r.status === 429 && attempt < 4) { await pause(Number(r.headers.get("retry-after") ?? 30) * 1000); continue; }
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r;
  }
}
const hf = async (path) => (await hfFetch(path)).json();
// A listing answers one page and names the next in a Link header. The link is
// followed, so an owner with more models than one page holds is indexed whole
// rather than silently cut at the page size.
async function hfList(path) {
  const r = await hfFetch(path);
  const next = /<([^>]+)>;\s*rel="next"/.exec(r.headers.get("link") ?? "")?.[1];
  return { rows: await r.json(), next: next?.startsWith(HF) ? next.slice(HF.length) : null };
}

const listable = (m) => !m.gated && !m.private && m.sha && /^[\w.-]+\/[\w.-]+$/.test(m.id);
const named = async (file) => (await readFile(new URL(`../manifests/${file}`, import.meta.url), "utf8"))
  .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
// A catalog row is this hub's own shape, not whatever the list it came from
// happened to carry: the root names the catalog by the hash of its bytes, so
// those bytes are decided here. Hugging Face's `full=true` also returns every
// file of every model, which the record already holds, so this drops it.
const CATALOG_FIELDS = ["id", "sha", "author", "tags", "pipeline_tag", "library_name", "createdAt", "lastModified",
  "likes", "downloads", "trendingScore", "gated", "private"];
const asRow = (m) => Object.fromEntries(CATALOG_FIELDS.map((k) => [k, m[k] ?? null]));

const rows = (await json(CATALOG, 60000)).filter(listable).slice(0, limit).map(asRow);
// Which list named each row, so the build line can say where the index came
// from. A model two lists name is indexed once, under the first that named it.
const from = new Map(rows.map((m) => [m.id, "the catalog"]));
const add = (m, source) => { if (!from.has(m.id)) { rows.push(asRow(m)); from.set(m.id, source); } };

// Witnessed models are always indexed, trending or not.
const witnessed = await named("models.txt");
for (const repo of witnessed.filter((r) => !from.has(r))) {
  // Asked of Hugging Face by name. The live hub's search used to come first
  // and this was its fallback; the search did not reach every model anyway.
  add(await hf(`/api/models/${repo}`), "witnessed");
}
const missing = witnessed.filter((r) => !from.has(r));
if (missing.length) throw new Error(`index: witnessed models without a release: ${missing.join(", ")}`);

// Owners the hub indexes whole. Hugging Face lists an owner's models under
// `author`, which is its own spelling letter for letter, and `full=true`
// carries the release commit, so one call lists however many models a page
// holds. An owner that lists nothing fails the build: an empty answer is a
// misspelled owner far more often than an owner with no model, and indexing
// nothing quietly would read as though the owner had been indexed.
const owners = await named("owners.txt");
for (const owner of owners) {
  let path = `/api/models?author=${encodeURIComponent(owner)}&full=true&limit=100`;
  let listed = 0;
  while (path) {
    const page = await hfList(path);
    for (const m of page.rows.filter(listable)) { listed += 1; add(m, owner); }
    path = page.next;
  }
  if (!listed) throw new Error(`index: ${owner} lists no public model with a release; check the name in manifests/owners.txt`);
}
const records = [];
let fetched = 0;
for (const row of rows) {
  const path = join(out, "models", `${row.id}.json`);
  let record = null;
  try {
    const kept = JSON.parse(await readFile(path, "utf8"));
    if (kept.revision === row.sha && kept.format === "hologram.hub.release/v4") record = kept;
    // A v3 record holds everything a v4 record does except `origin`, and this
    // builder has only ever read Hugging Face, so a v3 record's origin is not a
    // guess: it is the string this builder would write for it. Upgrading in
    // place keeps the first run after the format moved as cheap as any other,
    // rather than refetching every record to add a field already implied by the
    // two fields beside it.
    else if (kept.revision === row.sha && kept.format === "hologram.hub.release/v3") {
      record = { ...kept, format: "hologram.hub.release/v4", origin: { kind: "huggingface.co", resolve: `${HF}/${kept.repo}/resolve/${kept.revision}/` } };
    }
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
      const second = await secondWitness(row.id, row.sha);
      // Pirate Face is a source for this release when it has a torrent of
      // it. There is no HTTP prefix to put in `resolve`, which is the
      // point of it: the edge cannot redirect a client to a magnet, so
      // the entry carries the infohash and a runner that speaks the
      // protocol finds the rest.
      if (second.infohash) sources.push({ kind: "pirateface", infohash: second.infohash, missing: [] });
      // The card is not copied into the record. The record names the file and
      // the address its bytes must have, so a reader fetches it from any
      // source and checks it for itself.
      const card = files.find((f) => f.path.toLowerCase() === "readme.md");
      record = {
        format: "hologram.hub.release/v4",
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
        // What a second witness says about the same release. Addresses stay
        // out of `files[].sha256`: the edge reads that field to decide
        // whether a file is an LFS file, and so which ETag a Hugging Face
        // client is given, and that wire must not move.
        witnesses: second.witnesses,
        // Measurements of another host's traffic, named as such.
        observed: {
          source: HF,
          date: new Date().toISOString().slice(0, 10),
          downloads: about.downloads ?? row.downloads ?? 0,
          likes: about.likes ?? row.likes ?? 0,
        },
        // Where this record's own bytes come from. `sources` names the other
        // places that hold them; this names the one the record was built from,
        // so a reader that is not the edge can fetch a file without knowing
        // which hub built the record or hardcoding a host. Same shape as a
        // source entry, and like one it is good only for this revision.
        origin: { kind: "huggingface.co", resolve: `${HF}/${row.id}/resolve/${row.sha}/` },
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
// What the second witness was worth, counted rather than claimed: how many
// releases it covered, how many addresses it gave to files that had none, and
// where the two witnesses named different bytes for the same file.
let secondWitnessed = 0;
let filled = 0;
let conflicts = 0;
for (const { repo } of records) {
  try {
    const r = JSON.parse(await readFile(join(out, "models", `${repo}.json`), "utf8"));
    if (whole(r)) complete += 1;
    const addresses = new Map((r.witnesses ?? []).flatMap((w) => w.addresses.map((a) => [a.path, a.sha256])));
    if (!addresses.size) continue;
    secondWitnessed += 1;
    for (const f of r.files ?? []) {
      const theirs = addresses.get(f.path);
      if (!theirs) continue;
      if (!f.sha256) filled += 1;
      else if (f.sha256 !== theirs) conflicts += 1;
    }
  } catch {}
}
const counted = (source) => records.filter((r) => from.get(r.repo) === source).length;
const where = ["the catalog", "witnessed", ...owners]
  .map((s) => (s === "witnessed" ? `${counted(s)} witnessed` : `${counted(s)} from ${s}`)).join(", ");
console.log(`index: ${records.length} records (${where}; ${fetched} fetched, ${records.length - fetched} reused), ${complete} complete, `
  + `${secondWitnessed} with a Pirate Face witness filling ${filled} addresses (${conflicts} disagreements), `
  + `${browse.length} browse shards holding ${ordered.length} rows`);

