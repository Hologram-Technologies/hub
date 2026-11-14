// Turns the roll into something a browser can page through without holding it.
//
//   node tools/browse-index.mjs <roll dir> <out dir>
//
// The interface reads its catalogue by fetching every browse shard and
// filtering the array in memory. At 440 models that is fine. At the roll's
// three million it is about 474 MB of JSON and something near 1.9 GB of heap,
// against a tab usually capped at 2 to 4 GB and a phone far lower: it would
// not be slow, it would stop.
//
// So the ordering moves out of the browser and into the build. This writes:
//
//   rows.ndjson     every row once, in creation order, newline-delimited
//   rows.idx        where each row starts and how long it is, fixed width
//   order/<sort>    the row numbers of every model in that sort's order
//   root.json       what the numbers mean, and the digest of every file
//
// A page of the interface is then two reads: a slice of an order file, which
// says which rows to draw, and the rows themselves. Both are ranged reads, and
// GitHub Pages serves ranges - measured 2026-11-14, `206 Partial Content` with
// `Content-Range` over the uncompressed length. Nothing fetches the whole
// catalogue, so nothing has to hold it.
//
// Filtering works the same way. For each sort and each facet value there is a
// list of positions in that sort's order, ascending. Two filters are the
// intersection of two ascending lists, which is a walk, and the page is a
// slice of the result. The lists are delta-coded varints, so a value nothing
// has costs almost nothing and a value everything has costs about a byte a
// row.
//
// The parameter and recency filters are ranges in the interface and buckets
// here, cut at the stops the interface already draws, because a range over a
// bucketed facet is a union of buckets and a union of ascending lists is
// another walk. Nothing else would be gained by storing the numbers.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [rollDir, out] = process.argv.slice(2);
if (!rollDir || !out) {
  console.error("usage: node tools/browse-index.mjs <roll dir> <out dir>");
  process.exit(64);
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// A row's browse fields, by position, as `tools/roll.mjs` writes them.
const MODIFIED = 0, TASK = 1, LIBRARY = 2, LICENSE = 3, LANGUAGES = 4, PARAMS = 5, DOWNLOADS = 6, LIKES = 7;

// The sorts the interface offers, in its own words. `created` is the order the
// rows are already in, so it is the file's own order reversed and is written
// like any other rather than special-cased: a reader should not have to know
// that one of them is free.
const SORTS = {
  downloads: (a, b) => (b.b?.[DOWNLOADS] ?? 0) - (a.b?.[DOWNLOADS] ?? 0),
  likes: (a, b) => (b.b?.[LIKES] ?? 0) - (a.b?.[LIKES] ?? 0),
  createdAt: (a, b) => b.created - a.created,
  lastModified: (a, b) => (b.b?.[MODIFIED] ?? 0) - (a.b?.[MODIFIED] ?? 0),
  // Hugging Face's trending score is not in the listing this roll reads, so
  // the hub derives one rather than inventing a number and calling it theirs:
  // likes and downloads against how long the model has had to collect them.
  trending: (a, b) => trend(b) - trend(a),
};
const DAY = 86400;
const trend = (r) => {
  const age = Math.max(1, (Date.now() / 1000 - r.created) / DAY);
  return ((r.b?.[LIKES] ?? 0) * 10 + (r.b?.[DOWNLOADS] ?? 0)) / Math.sqrt(age);
};

// The stops the interface draws, from `app/tools/site_spec.py`. A parameter
// count is put in the bucket of the largest stop it reaches, and a release in
// the first recency band it falls inside, so the interface's own ranges are
// unions of these and nothing has to be recomputed per request.
const PARAM_STOPS = [0, 6e9, 12e9, 32e9, 128e9, 500e9];
const RECENCY_DAYS = [30, 90, 183, 365];
const paramBucket = (n) => {
  if (n == null) return null;
  let b = 0;
  for (const [i, stop] of PARAM_STOPS.entries()) if (n >= stop) b = i;
  return b;
};
const recencyBucket = (modifiedDays) => {
  if (modifiedDays == null) return null;
  const age = Math.floor(Date.now() / 86400000) - modifiedDays;
  for (const [i, days] of RECENCY_DAYS.entries()) if (age <= days) return i;
  return RECENCY_DAYS.length;
};

// Which facets are indexed, and how a row answers each. `many` says a row can
// hold more than one value, which only languages does.
const FACETS = [
  { key: "task", of: (r) => r.b?.[TASK] ?? null },
  { key: "library", of: (r) => r.b?.[LIBRARY] ?? null },
  { key: "license", of: (r) => r.b?.[LICENSE] ?? null },
  { key: "language", of: (r) => r.b?.[LANGUAGES] ?? [], many: true },
  { key: "parameters", of: (r) => paramBucket(r.b?.[PARAMS]) },
  { key: "recency", of: (r) => recencyBucket(r.b?.[MODIFIED]) },
];

// A varint, little end first, seven bits at a time. Positions in a sort's
// order only ever increase, so what is written is the gap from the last one:
// a facet half the catalogue holds costs about a byte a row, and a rare one
// costs a handful of bytes in total.
function varints(values) {
  const out = [];
  let previous = 0;
  for (const v of values) {
    let gap = v - previous;
    previous = v;
    while (gap >= 0x80) { out.push((gap & 0x7f) | 0x80); gap >>>= 7; }
    out.push(gap);
  }
  return Buffer.from(out);
}

// ------------------------------------------------------------------- read
const root = JSON.parse(await readFile(join(rollDir, "root.json"), "utf8"));
if (root.format !== "hologram.hub.roll/v1") throw new Error(`unexpected roll format ${root.format}`);

const rows = [];
for (const shard of root.shards) {
  const bytes = await readFile(join(rollDir, shard.path));
  // The roll's own rule: a shard counts only if its root names these bytes.
  if (sha256(bytes) !== shard.sha256) throw new Error(`${shard.path} does not match the roll's root`);
  for (const line of bytes.toString("utf8").split("\n")) {
    if (!line) continue;
    const [id, revision, created, , , state, b] = JSON.parse(line);
    // A model Hugging Face no longer lists is kept in the roll and left out of
    // the catalogue: the interface browses what exists. The roll is still
    // where a reader goes to ask what used to.
    if (state !== 0) continue;
    rows.push({ id, revision, created, b: b ?? null });
  }
}
// Creation order, oldest first, so a row's number never changes as the roll
// grows: tomorrow's models are appended and today's keep their numbers. Every
// order file and every future posting list is a list of these numbers, so they
// have to be stable or nothing else is.
rows.sort((x, y) => x.created - y.created || (x.id < y.id ? -1 : 1));

// ------------------------------------------------------------------ write
await mkdir(join(out, "order"), { recursive: true });

// rows.ndjson, and the fixed-width table that says where each row is. The
// table is what makes a row a ranged read rather than a search: row n starts
// at the 8 bytes at offset n*8 of rows.idx, and runs for the 4 bytes after.
const encoder = new TextEncoder();
const lines = rows.map((r) => encoder.encode(JSON.stringify([r.id, r.revision, r.created, r.b])));
const idx = new DataView(new ArrayBuffer(rows.length * 12));
let at = 0;
for (const [n, line] of lines.entries()) {
  idx.setBigUint64(n * 12, BigInt(at));
  idx.setUint32(n * 12 + 8, line.length);
  at += line.length + 1;
}
const body = Buffer.concat(lines.flatMap((l) => [Buffer.from(l), Buffer.from("\n")]));
await writeFile(join(out, "rows.ndjson"), body);
await writeFile(join(out, "rows.idx"), Buffer.from(idx.buffer));

// One file per sort: the row numbers, in that order, four bytes each. Page k
// of a sort is the 168 bytes at offset k*42*4 - one ranged read, whatever the
// catalogue's size.
// Which rows hold each facet value, once, since it does not depend on a sort.
const members = Object.fromEntries(FACETS.map((f) => [f.key, new Map()]));
for (const [n, row] of rows.entries()) {
  for (const facet of FACETS) {
    const got = facet.of(row);
    for (const v of facet.many ? got : [got]) {
      if (v == null) continue;
      const m = members[facet.key];
      if (!m.has(v)) m.set(v, []);
      m.get(v).push(n);
    }
  }
}

const orders = {};
const postings = {};
for (const [name, compare] of Object.entries(SORTS)) {
  const numbers = rows.map((_, n) => n).sort((x, y) => compare(rows[x], rows[y]));
  const buf = new DataView(new ArrayBuffer(numbers.length * 4));
  numbers.forEach((n, i) => buf.setUint32(i * 4, n));
  const bytes = Buffer.from(buf.buffer);
  await writeFile(join(out, "order", `${name}.u32`), bytes);
  orders[name] = { path: `order/${name}.u32`, rows: numbers.length, sha256: sha256(bytes) };

  // Where each row sits in this order, so a member list becomes a position
  // list and a filtered page is a slice rather than a search.
  const at = new Uint32Array(rows.length);
  numbers.forEach((n, i) => { at[n] = i; });

  await mkdir(join(out, "postings", name), { recursive: true });
  postings[name] = {};
  for (const facet of FACETS) {
    const values = [...members[facet.key].keys()].sort((a, b) => a - b);
    const top = values.length ? values[values.length - 1] + 1 : 0;
    // One file a facet, not one a value: a value is a ranged read into it, and
    // thirty thousand small files would be a worse site than a large one.
    // Header is the value count, then an offset for each value and one past
    // the end, so a reader takes the pair it needs and asks for that range.
    const blocks = [];
    const offsets = new Uint32Array(top + 1);
    let cursor = 0;
    for (let v = 0; v < top; v++) {
      offsets[v] = cursor;
      const held = members[facet.key].get(v);
      if (held) {
        const block = varints(held.map((n) => at[n]).sort((a, b) => a - b));
        blocks.push(block);
        cursor += block.length;
      }
    }
    offsets[top] = cursor;
    const header = Buffer.alloc(4);
    header.writeUInt32LE(top, 0);
    const bytes = Buffer.concat([header, Buffer.from(offsets.buffer), ...blocks]);
    await writeFile(join(out, "postings", name, `${facet.key}.bin`), bytes);
    postings[name][facet.key] = { path: `postings/${name}/${facet.key}.bin`, values: top, sha256: sha256(bytes) };
  }
}

await writeFile(join(out, "root.json"), JSON.stringify({
  format: "hologram.hub.browse/v1",
  built: new Date().toISOString(),
  // Named so a reader can check this index against the roll it came from
  // rather than taking it on trust.
  roll: { window: root.window, counts: root.counts, built: root.built },
  dictionaries: root.dictionaries,
  // What a row's browse array means, by position, so a reader need not read
  // this file's source to understand its output.
  fields: ["modified", "task", "library", "license", "languages", "parameters", "downloads", "likes"],
  pageSize: 42,
  // The buckets the parameter and recency filters are cut at, so a reader
  // turns the interface's range back into a union of values without guessing.
  buckets: { parameters: PARAM_STOPS, recencyDays: RECENCY_DAYS },
  rows: { count: rows.length, body: "rows.ndjson", index: "rows.idx", bodySha256: sha256(body), indexSha256: sha256(Buffer.from(idx.buffer)) },
  orders,
  postings,
}));

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const orderBytes = rows.length * 4 * Object.keys(orders).length;
let postingBytes = 0;
for (const sort of Object.values(postings)) for (const f of Object.values(sort)) postingBytes += (await readFile(join(out, f.path))).length;
const values = Object.values(postings[Object.keys(postings)[0]]).reduce((a, f) => a + f.values, 0);
console.log(`browse-index: ${rows.length} rows | body ${mb(body.length)} | index ${mb(idx.byteLength)} `
  + `| ${Object.keys(orders).length} orders ${mb(orderBytes)} | postings ${mb(postingBytes)} over ${values} values `
  + `| total ${mb(body.length + idx.byteLength + orderBytes + postingBytes)}`);
