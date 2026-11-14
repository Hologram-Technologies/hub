// Builds the hub's roll: one line for every model Hugging Face has ever
// listed, and for every model it has stopped listing. The roll says what
// exists and at what revision. It does not say what any file weighs or what
// its address is - that is the index (`tools/index.mjs`), which costs one call
// per model where this costs one per thousand. `docs/model-roll.md` has the
// arithmetic and why the two are separate.
//
//   node tools/roll.mjs <out dir> [--from <ISO>] [--to <ISO>] [--sweep]
//
// Default is the tail: everything created since the newest row the roll
// already holds, which after a first build is a handful of calls. `--sweep`
// walks the whole history from 2022-03-02, about 3,076 calls. `--from` and
// `--to` walk one window, which is how the sweep is cut into parallel jobs:
// the windows partition a total order, so no worker can duplicate or skip a
// row another worker takes.
//
// A record is never deleted. A model that stops answering keeps its line and
// gains a state, so the roll holds models Hugging Face no longer lists. That
// is the one thing here Hugging Face cannot do for you.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const HF = "https://huggingface.co";
// The collection begins here: `bert-base-uncased` and `openai-community/gpt2`
// both carry this instant, with adjacent `_id`s, the signature of a bulk
// migration. A cursor for anything earlier returns an empty array.
const ORIGIN = "2022-03-02T23:29:04Z";
// Hugging Face allows an anonymous client 500 API calls per five minutes.
// One call a second leaves most of that for everything else the build does.
const PACE = 1100;
const PAGE = 1000;
// Named fields rather than `full=true`, for two reasons measured on
// 2026-11-14. It is the only way to get `safetensors`, which is the parameter
// count the interface's Parameters slider filters on: `full=true` does not
// return it and naming it is the documented way to ask. And `full=true`
// returns `siblings`, every filename of every model, which is most of a
// 4.08 kB row and which the roll does not store - the index holds filenames,
// with the sizes and addresses that make them worth having.
const FIELDS = ["sha", "createdAt", "lastModified", "tags", "pipeline_tag", "library_name",
  "safetensors", "downloads", "likes", "gated", "private"].map((f) => `expand[]=${f}`).join("&");
// 11 bits of the id's digest: 2,048 shards, about 1,500 rows each at today's
// three million models, which is where a cold lookup is cheapest once a row's
// real size is measured rather than estimated. The working, and the estimate
// it corrects, are in `docs/model-roll.md`.
const SHARD_BITS = 11;
const SHARDS = 1 << SHARD_BITS;
// What a line means in position 5. A model that is gone and a model that is
// private are not the same thing and Hugging Face tells them apart, so the
// roll does too.
const LISTED = 0, GONE = 1, WITHHELD = 2;

// ------------------------------------------------------- the browse fields
// Everything the interface's filter panel reads is already in the listing:
// `pipeline_tag` is the task, `library_name` the library, and the tags carry
// the licence and the languages. None of it costs an extra call.
//
// They are stored as indices into dictionaries published in the root, not as
// strings. Measured 2026-11-14 on 500 real rows: 79 B a row coded against
// 635 B for the row the interface publishes today, which is the difference
// between 245 MB for three million models and 1,955 MB - between fitting in a
// GitHub Pages site and not. A tag repeated three million times should be
// written down once.
const DICTS = ["task", "library", "license", "language"];
const dict = Object.fromEntries(DICTS.map((d) => [d, new Map()]));
const code = (d, v) => {
  if (v == null || v === "") return null;
  if (!dict[d].has(v)) dict[d].set(v, dict[d].size);
  return dict[d].get(v);
};
// Days rather than seconds: the interface groups by day and never shows a
// time, and four fewer digits over three million rows is 12 MB.
const days = (iso) => (iso ? Math.floor(new Date(iso).getTime() / 86400000) : null);
// A language tag is two or three lower-case letters. Hugging Face's tags mix
// languages, licences, libraries and free text in one list, so this is a
// filter and not a parse; anything it misses is simply not offered as a
// language, which is how the interface already treats a missing facet.
const LANG = /^[a-z]{2,3}$/;
const browseOf = (m) => {
  const tags = Array.isArray(m.tags) ? m.tags : [];
  const licence = tags.find((t) => t.startsWith("license:"))?.slice(8) ?? null;
  return [
    days(m.lastModified),
    code("task", m.pipeline_tag),
    code("library", m.library_name),
    code("license", licence),
    tags.filter((t) => LANG.test(t)).slice(0, 8).map((t) => code("language", t)),
    m.safetensors?.total ?? null,
    m.downloads ?? 0,
    m.likes ?? 0,
  ];
};

const args = process.argv.slice(2);
const out = args[0];
if (!out || out.startsWith("--")) {
  console.error("usage: node tools/roll.mjs <out dir> [--from <ISO>] [--to <ISO>] [--sweep | --tail]");
  process.exit(64);
}
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? null : args[i + 1] ?? true;
};
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (iso) => Math.floor(new Date(iso).getTime() / 1000);

// The whole design rests on this: `_id` is a MongoDB ObjectId whose leading
// four bytes are the creation time in seconds, `createdAt` order is `_id`
// order, and the cursor for a `createdAt` sort is `{"_id":{"$lt":<id>}}`. So
// the cursor for any instant is a pure function of that instant, with no
// paging to get there and nothing to store between runs.
const cursorAt = (iso) =>
  Buffer.from(JSON.stringify({ _id: { $lt: secs(iso).toString(16).padStart(8, "0") + "0".repeat(16) } }), "utf8")
    .toString("base64");

let calls = 0;
let last = 0;
async function listing(cursor) {
  const wait = last + PACE - Date.now();
  if (wait > 0) await pause(wait);
  last = Date.now();
  const url = `${HF}/api/models?sort=createdAt&direction=-1&limit=${PAGE}&${FIELDS}`
    + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
    calls += 1;
    if (r.status === 429 && attempt < 4) { await pause(Number(r.headers.get("retry-after") ?? 30) * 1000); continue; }
    if (!r.ok) throw new Error(`listing: ${r.status}`);
    return r.json();
  }
}

// ------------------------------------------------------------------- shards
const bucket = (id) => parseInt(sha256(id).slice(0, 4), 16) >>> (16 - SHARD_BITS);
const shardPath = (n) => `shards/${n.toString(16).padStart(3, "0")}.ndjson`;

async function readRoll(dir) {
  const rows = new Map();
  let root = null;
  try {
    root = JSON.parse(await readFile(join(dir, "root.json"), "utf8"));
  } catch {
    return { rows, root: null };
  }
  for (const shard of root.shards ?? []) {
    const bytes = await readFile(join(dir, shard.path));
    // A shard counts only if the root names exactly these bytes. The root is
    // what a reader checks the signature of, so a shard that does not match it
    // is not the hub's answer, whatever it says.
    if (sha256(bytes) !== shard.sha256) throw new Error(`${shard.path} does not match the root`);
    for (const line of bytes.toString("utf8").split("\n")) {
      if (!line) continue;
      const row = JSON.parse(line);
      rows.set(row[0], row);
    }
  }
  return { rows, root };
}

async function writeRoll(dir, rows) {
  const buckets = new Map();
  for (const row of rows.values()) {
    const n = bucket(row[0]);
    if (!buckets.has(n)) buckets.set(n, []);
    buckets.get(n).push(row);
  }
  await mkdir(join(dir, "shards"), { recursive: true });
  const shards = [];
  let bytesWritten = 0;
  for (const n of [...buckets.keys()].sort((a, b) => a - b)) {
    // Sorted by id inside the shard, so the bytes are a function of the rows
    // and not of the order they were met in. Two builds of the same roll give
    // the same digest.
    const lines = buckets.get(n).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const bytes = Buffer.from(lines.map((r) => JSON.stringify(r)).join("\n"), "utf8");
    await writeFile(join(dir, shardPath(n)), bytes);
    shards.push({ path: shardPath(n), rows: lines.length, sha256: sha256(bytes) });
    bytesWritten += bytes.length;
  }
  return { shards, bytesWritten };
}

// --------------------------------------------------------------------- walk
// Pages backwards through creation time from `to` until it passes `from` or
// the listing runs out. Backwards because that is the direction the cursor
// goes, and because the newest rows are the ones a tail run wants first.
async function walk(from, to, onRow) {
  let cursor = cursorAt(to);
  const floor = secs(from);
  let seen = 0;
  for (;;) {
    const rows = await listing(cursor);
    if (!Array.isArray(rows) || rows.length === 0) return seen;
    let oldest = Infinity;
    for (const m of rows) {
      const created = secs(m.createdAt);
      oldest = Math.min(oldest, created);
      if (created < floor) continue;
      onRow(m, created);
      seen += 1;
    }
    if (oldest < floor) return seen;
    if (rows.length < PAGE) return seen;
    cursor = cursorAt(new Date(oldest * 1000).toISOString());
  }
}

// --------------------------------------------------------------------- main
const now = Math.floor(Date.now() / 1000);
const { rows, root } = await readRoll(out);
const before = rows.size;

// The dictionaries are restored before anything is walked. A code is an index,
// so renumbering them would silently change what every existing row says: the
// same number would mean a different licence. They only ever grow.
for (const d of DICTS) for (const value of root?.dictionaries?.[d] ?? []) code(d, value);

const to = flag("to") ?? new Date(Date.now() + 60_000).toISOString();
let from = flag("from");
if (!from) {
  // `--tail` refuses to sweep rather than quietly doing one. A sweep is about
  // an hour of listing, and the job that asks for a tail is one whose timeout
  // assumes minutes. A cold cache should stop that job loudly, not run it for
  // an hour and then be killed with nothing published.
  if (args.includes("--tail") && !root) {
    console.error("roll: --tail was asked for and there is no roll in the output directory to continue from."
      + " Run a sweep first; this would have walked the whole history.");
    process.exit(69);
  }
  if (args.includes("--sweep") || !root) from = ORIGIN;
  // A tail run starts a little before the newest row the roll already holds,
  // because a page boundary is not a moment: two models can share a second.
  else from = new Date((root.newest - 120) * 1000).toISOString();
}

let newest = root?.newest ?? 0;
let added = 0, updated = 0;
await walk(from, to, (m, created) => {
  newest = Math.max(newest, created);
  const was = rows.get(m.id);
  const state = m.gated || m.private ? WITHHELD : LISTED;
  if (was) {
    was[1] = m.sha ?? was[1];
    was[4] = now;
    was[5] = state;
    was[6] = browseOf(m);
    updated += 1;
  } else {
    // [ id, revision, created, first seen, last seen, state, browse ]
    // where browse is [ modified, task, library, licence, languages,
    // parameters, downloads, likes ], each name an index into the root's
    // dictionary. A row with no browse is one this build did not see listed.
    rows.set(m.id, [m.id, m.sha ?? null, created, now, now, state, browseOf(m)]);
    added += 1;
  }
});

// Anything the window should have listed and did not is gone. Only rows whose
// creation falls inside the window are judged, because a row outside it was
// never going to be listed by this walk and its absence says nothing.
const lo = secs(from), hi = secs(to);
let tombstoned = 0;
for (const row of rows.values()) {
  if (row[5] !== LISTED) continue;
  if (row[2] < lo || row[2] > hi) continue;
  if (row[4] === now) continue;
  row[5] = GONE;
  tombstoned += 1;
}

const { shards, bytesWritten } = await writeRoll(out, rows);
const counts = { listed: 0, gone: 0, withheld: 0 };
for (const row of rows.values()) counts[row[5] === LISTED ? "listed" : row[5] === GONE ? "gone" : "withheld"] += 1;
await writeFile(join(out, "root.json"), JSON.stringify({
  format: "hologram.hub.roll/v1",
  shardBits: SHARD_BITS,
  // What this build looked at, so a reader can say what the roll does and does
  // not cover rather than having to assume it covers everything.
  window: { from, to },
  newest,
  built: new Date().toISOString(),
  source: `${HF}/api/models`,
  counts,
  // What a browse row's numbers mean. Published here rather than beside each
  // row because three million rows saying "apache-2.0" should say it once.
  dictionaries: Object.fromEntries(DICTS.map((d) => [d, [...dict[d].keys()]])),
  shards,
}));

console.log(`roll: ${rows.size} models (${added} new, ${updated} seen again, ${tombstoned} newly gone), `
  + `${counts.listed} listed, ${counts.gone} gone, ${counts.withheld} withheld; `
  + `${shards.length} shards holding ${(bytesWritten / 1e6).toFixed(1)} MB; ${calls} calls; was ${before}`);
