// A page drawn from the browse index is the page the interface would have
// drawn from the whole catalogue in memory: the same rows, in the same order,
// matching the same filters. That is the only thing the index is for, so it is
// the thing to check.
//
//   node tests/browse/page.mjs <browse index dir>
//
// It reads the index the way a browser would - a slice of an order, a slice of
// a postings file, a row at a time by offset - and then checks the answer
// against the rows themselves, filtered and sorted the slow, obvious way.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node tests/browse/page.mjs <browse index dir>");
  process.exit(64);
}
const failures = [];
const check = (name, ok, saw) => (ok ? console.log(`ok   ${name}`) : failures.push(`${name}: ${saw}`));

const root = JSON.parse(await readFile(join(dir, "root.json"), "utf8"));
// The rows live in the roll the index was built from; an order entry says
// which shard each is in and which bytes. The shard names are a pattern
// where the roll follows one, and a list otherwise.
const shardSpec = root.rows.shards;
const shardName = (i) => (Array.isArray(shardSpec)
  ? shardSpec[i]
  : shardSpec.name.replace("{label}", shardSpec.labels.slice(i * shardSpec.width, (i + 1) * shardSpec.width)));
const shardCount = Array.isArray(shardSpec) ? shardSpec.length : shardSpec.labels.length / shardSpec.width;
const shards = await Promise.all(Array.from({ length: shardCount }, (_, i) => readFile(join(dir, root.rows.from, shardName(i)))));

const FIELD = Object.fromEntries(root.fields.map((f, i) => [f, i]));

// ---- what a browser does
// A position in a sort's order, straight to the bytes it names.
const placeIn = (view, pos, step) => ({
  shard: view.getUint16(pos * step),
  at: view.getUint32(pos * step + 2),
  len: view.getUint16(pos * step + 6),
});
// An order entry names three numbers, and three numbers in the wrong places
// still parse as three numbers. So they are bounded before they are read: a
// corrupt entry says which entry and what it claimed, rather than throwing a
// JSON error from somewhere inside the shard it landed in.
const outOfBounds = ({ shard, at, len }) => {
  if (!(shard < shards.length)) return `shard ${shard} of ${shards.length}`;
  if (at + len > shards[shard].length) return `bytes ${at}..${at + len} of a ${shards[shard].length}-byte shard`;
  if (!len) return "no bytes at all";
  return null;
};
const rowOf = (place) => {
  const bad = outOfBounds(place);
  if (bad) throw new Error(`an order entry names ${bad}`);
  const text = shards[place.shard].subarray(place.at, place.at + place.len).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    // In bounds and still not a row: the three numbers are in the wrong
    // places, or the wrong file is being read. Say which bytes, because the
    // parse error on its own says only that they are not JSON.
    throw new Error(`shard ${place.shard} bytes ${place.at}..${place.at + place.len} are not a row: ${JSON.stringify(text.slice(0, 48))}`);
  }
};

const orderCache = new Map();
async function orderOf(sort) {
  if (!orderCache.has(sort)) {
    const b = await readFile(join(dir, root.orders[sort].path));
    orderCache.set(sort, new DataView(b.buffer, b.byteOffset, b.byteLength));
  }
  return orderCache.get(sort);
}

// The positions a facet value holds, in one sort's order. Header is the value
// count, then an offset per value and one past the end; the block between a
// value's two offsets is its gaps, delta-coded.
async function positions(sort, facet, value) {
  const file = await readFile(join(dir, root.postings[sort][facet].path));
  const count = file.readUInt32LE(0);
  if (value >= count) return [];
  const offsets = new DataView(file.buffer, file.byteOffset + 4, (count + 1) * 4);
  // Past the offsets come the per-value counts, then the postings themselves.
  const base = 4 + (count + 1) * 4 + count * 4;
  const from = base + offsets.getUint32(value * 4, true);
  const to = base + offsets.getUint32((value + 1) * 4, true);
  const out = [];
  let at = 0;
  for (let i = from; i < to;) {
    let gap = 0, shift = 0, byte;
    do { byte = file[i++]; gap |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
    at += gap;
    out.push(at);
  }
  return out;
}

const intersect = (a, b) => {
  const out = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { out.push(a[i]); i += 1; j += 1; }
    else if (a[i] < b[j]) i += 1;
    else j += 1;
  }
  return out;
};

async function page(sort, filters, k = 0) {
  let hits = null;
  for (const [facet, value] of filters) {
    const p = await positions(sort, facet, value);
    hits = hits === null ? p : intersect(hits, p);
  }
  const order = await orderOf(sort);
  const slice = hits === null
    ? Array.from({ length: Math.min(root.pageSize, root.rows.count - k * root.pageSize) }, (_, i) => k * root.pageSize + i)
    : hits.slice(k * root.pageSize, (k + 1) * root.pageSize);
  const step = root.orders[sort].stride ?? 8;
  return { total: hits === null ? root.rows.count : hits.length, rows: slice.map((pos) => rowOf(placeIn(order, pos, step))) };
}

// ---- the slow, obvious way, for something to check against
// Every row, read through the first sort's order, which names every row
// exactly once.
const firstSort = Object.keys(root.orders)[0];
const firstOrder = await orderOf(firstSort);
const firstStep = root.orders[firstSort].stride ?? 8;
const places = Array.from({ length: root.rows.count }, (_, pos) => placeIn(firstOrder, pos, firstStep));
const firstBad = places.map((pl, i) => [i, outOfBounds(pl)]).find(([, bad]) => bad);
check("every order entry names bytes inside a shard", !firstBad, firstBad ? `entry ${firstBad[0]} names ${firstBad[1]}` : "");
const all = firstBad ? [] : places.map(rowOf);
// Back into the order the builder numbers rows in - created, then id - which
// is the order a sort's ties fall in. Reading them through a sort's order file
// would otherwise break ties differently from the index and fail a comparison
// that is actually in agreement.
all.sort((x, y) => x[2] - y[2] || (x[0] < y[0] ? -1 : 1));

const holds = (row, facet, value) => {
  const b = row[6];
  if (!b) return false;
  if (facet === "language") return (b[FIELD.languages] ?? []).includes(value);
  if (facet === "parameters") {
    const n = b[FIELD.parameters];
    if (n == null) return false;
    let bucket = 0;
    for (const [i, stop] of root.buckets.parameters.entries()) if (n >= stop) bucket = i;
    return bucket === value;
  }
  if (facet === "recency") {
    const m = b[FIELD.modified];
    if (m == null) return false;
    const age = Math.floor(Date.now() / 86400000) - m;
    let bucket = root.buckets.recencyDays.length;
    for (const [i, days] of root.buckets.recencyDays.entries()) if (age <= days) { bucket = i; break; }
    return bucket === value;
  }
  return b[FIELD[facet]] === value;
};

// ---- the checks
const busiest = async (facet) => {
  const file = await readFile(join(dir, root.postings.downloads[facet].path));
  const count = file.readUInt32LE(0);
  // The counts the header carries, which is what the filter panel reads.
  const counts = new DataView(file.buffer, file.byteOffset + 4 + (count + 1) * 4, count * 4);
  let best = 0, size = -1;
  for (let v = 0; v < count; v++) {
    const n = counts.getUint32(v * 4, true);
    if (n > size) { size = n; best = v; }
  }
  return best;
};

const task = await busiest("task");
const licence = await busiest("license");

const one = await page("downloads", [["task", task]]);
check("a filtered page comes back", one.rows.length > 0, String(one.rows.length));
check("every row on it holds the facet", one.rows.every((r) => holds(r, "task", task)), "a row did not");
check("the count matches counting by hand", one.total === all.filter((r) => holds(r, "task", task)).length,
  `${one.total} against ${all.filter((r) => holds(r, "task", task)).length}`);
const d = one.rows.map((r) => r[6]?.[FIELD.downloads] ?? 0);
check("it is in the sort's order", d.every((v, i) => i === 0 || v <= d[i - 1]), JSON.stringify(d.slice(0, 5)));

const byHand = all.filter((r) => holds(r, "task", task))
  .sort((a, b) => (b[6]?.[FIELD.downloads] ?? 0) - (a[6]?.[FIELD.downloads] ?? 0))
  .slice(0, root.pageSize).map((r) => r[0]);
check("it is the page the slow way gives", JSON.stringify(one.rows.map((r) => r[0])) === JSON.stringify(byHand),
  `${one.rows[0]?.[0]} against ${byHand[0]}`);

const two = await page("downloads", [["task", task], ["license", licence]]);
check("two filters intersect", two.rows.every((r) => holds(r, "task", task) && holds(r, "license", licence)), "a row did not hold both");
check("and the intersection is no larger than either", two.total <= one.total, `${two.total} against ${one.total}`);

const second = await page("downloads", [["task", task]], 1);
if (one.total > root.pageSize) {
  check("the second page continues the first", (second.rows[0]?.[6]?.[FIELD.downloads] ?? 0) <= (d[d.length - 1] ?? 0),
    `${second.rows[0]?.[6]?.[FIELD.downloads]} after ${d[d.length - 1]}`);
  check("and holds none of the first's rows", !second.rows.some((r) => one.rows.some((x) => x[0] === r[0])), "a row appeared twice");
}

const plain = await page("likes", []);
const l = plain.rows.map((r) => r[6]?.[FIELD.likes] ?? 0);
check("an unfiltered page sorts too", l.every((v, i) => i === 0 || v <= l[i - 1]), JSON.stringify(l.slice(0, 5)));
check("and says the whole catalogue is its total", plain.total === root.rows.count, `${plain.total} against ${root.rows.count}`);

console.log(failures.length ? `\n${failures.map((f) => `FAIL ${f}`).join("\n")}` : "\ntests/browse/page: all checks passed");
process.exit(failures.length ? 1 : 0);
