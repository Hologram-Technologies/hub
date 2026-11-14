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
// Facet postings are not here. This is the half that makes paging work at all;
// filtering over three million rows is the half after it, and it belongs in
// its own change with its own gate.
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
const orders = {};
for (const [name, compare] of Object.entries(SORTS)) {
  const numbers = rows.map((_, n) => n).sort((x, y) => compare(rows[x], rows[y]));
  const buf = new DataView(new ArrayBuffer(numbers.length * 4));
  numbers.forEach((n, i) => buf.setUint32(i * 4, n));
  const bytes = Buffer.from(buf.buffer);
  await writeFile(join(out, "order", `${name}.u32`), bytes);
  orders[name] = { path: `order/${name}.u32`, rows: numbers.length, sha256: sha256(bytes) };
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
  rows: { count: rows.length, body: "rows.ndjson", index: "rows.idx", bodySha256: sha256(body), indexSha256: sha256(Buffer.from(idx.buffer)) },
  orders,
}));

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
console.log(`browse-index: ${rows.length} rows | body ${mb(body.length)} | index ${mb(idx.byteLength)} `
  + `| ${Object.keys(orders).length} orders ${mb(rows.length * 4 * Object.keys(orders).length)} `
  + `| total ${mb(body.length + idx.byteLength + rows.length * 4 * Object.keys(orders).length)}`);
