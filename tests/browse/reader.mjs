// The reader the page uses (`web/browse.mjs`) against a real index over real
// HTTP, because its whole job is ranged reads and a test that bypasses them
// would be testing something else.
//
//   node tests/browse/reader.mjs <browse index dir>
//
// The server here answers exactly what GitHub Pages answers: a 206 with
// Content-Range for a Range request, a 200 otherwise, and nothing clever.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, normalize } from "node:path";
import { EXACT, openBrowse } from "../../web/browse.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node tests/browse/reader.mjs <browse index dir>");
  process.exit(64);
}
// The index points into the roll beside it, so the server has to serve both.
// It serves their parent, and the reader is opened at the index's own folder,
// which is how a deployed site is laid out.
const site = dirname(dir);
const here = `${basename(dir)}/`;
const failures = [];
const check = (name, ok, saw) => (ok ? console.log(`ok   ${name}`) : failures.push(`${name}: ${saw}`));

let served = 0, bytesServed = 0;
// Every path the reader asked for, so a check can say which files it went to
// and not only what it returned.
const asked = [];
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname))
    .split(/[\\/]+/).filter((p) => p && p !== "." && p !== "..").join("/");
  let body;
  try { body = await readFile(join(site, rel)); } catch { res.writeHead(404).end(); return; }
  served += 1;
  asked.push(rel);
  const r = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
  if (r) {
    const from = Number(r[1]), to = Math.min(Number(r[2]), body.length - 1);
    const slice = body.subarray(from, to + 1);
    bytesServed += slice.length;
    res.writeHead(206, { "content-range": `bytes ${from}-${to}/${body.length}`, "content-length": slice.length });
    res.end(slice);
    return;
  }
  bytesServed += body.length;
  res.writeHead(200, { "content-length": body.length }).end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/${here}`;

const index = await openBrowse(base);
check("the index opens", Boolean(index), "it did not");
check("and does not claim its bytes were checked", index.checked === false, String(index?.checked));

// The slow, obvious answer, from the files directly.
const root = JSON.parse(await readFile(join(dir, "root.json"), "utf8"));
// An order entry says where a row is; the shard names are a pattern where the
// roll follows one, and a list otherwise.
const shardSpec = root.rows.shards;
const shardName = (i) => (Array.isArray(shardSpec)
  ? shardSpec[i]
  : shardSpec.name.replace("{label}", shardSpec.labels.slice(i * shardSpec.width, (i + 1) * shardSpec.width)));
const shardCount = Array.isArray(shardSpec) ? shardSpec.length : shardSpec.labels.length / shardSpec.width;
const shards = await Promise.all(Array.from({ length: shardCount }, (_, i) => readFile(join(dir, root.rows.from, shardName(i)))));
const body = { length: shards.reduce((a, b) => a + b.length, 0) };
const firstSort = Object.keys(root.orders)[0];
const firstStep = root.orders[firstSort].stride ?? 8;
const orderBytes = await readFile(join(dir, root.orders[firstSort].path));
const ov = new DataView(orderBytes.buffer, orderBytes.byteOffset, orderBytes.byteLength);
// Every row, read through the first sort's order, which names each exactly
// once.
const all = Array.from({ length: root.rows.count }, (_, pos) => {
  const shard = shards[ov.getUint16(pos * firstStep)];
  const at = ov.getUint32(pos * firstStep + 2), len = ov.getUint16(pos * firstStep + 6);
  return JSON.parse(shard.subarray(at, at + len).toString("utf8"));
});
// Back into the order the builder numbers rows in - created, then id - which
// is the order a sort's ties fall in. Reading them through a sort's order file
// would otherwise break ties differently from the index and fail a comparison
// that is actually in agreement.
all.sort((x, y) => x[2] - y[2] || (x[0] < y[0] ? -1 : 1));


const F = index.field;
const first = await index.page({ sort: "downloads", page: 1 });
check("an unfiltered page has a full page of rows", first.rows.length === root.pageSize, String(first.rows.length));
check("and the whole catalogue as its total", first.total === root.rows.count, `${first.total} of ${root.rows.count}`);
const byHand = [...all].sort((a, b) => (b[6]?.[F.downloads] ?? 0) - (a[6]?.[F.downloads] ?? 0)).slice(0, root.pageSize).map((r) => r[0]);
check("it is the page sorting the lot would give", JSON.stringify(first.rows.map((r) => r[0])) === JSON.stringify(byHand),
  `${first.rows[0]?.[0]} against ${byHand[0]}`);

const bytesForAPage = bytesServed;
check("a page costs kilobytes, not the catalogue", bytesForAPage < 1e6, `${(bytesForAPage / 1e3).toFixed(0)} kB`);

// What an unfiltered page costs in round trips, which is the thing this
// layout is for. A page is a contiguous run of a sort's order, so finding
// where its rows live is one read of one file; the rows themselves are one
// read each because they sit in the shards the roll's root names.
//
// It used to be two hops - 42 row numbers out of the order, then 42 ranges
// out of a separate 37.8 MB locator table - which measured 2,129 ms of a
// 4,365 ms page against the live site. Nothing about the answer changed when
// that went away, so only a check that counts reads can tell the difference.
{
  const fresh = await openBrowse(base);
  asked.length = 0;
  const p = await fresh.page({ sort: "downloads", page: 1 });
  const orderReads = asked.filter((x) => x.includes("/order/")).length;
  const rowReads = asked.filter((x) => x.includes("/shards/")).length;
  check("an unfiltered page finds its rows in one read", orderReads === 1, `${orderReads} reads of the order`);
  check("and asks for no row twice", rowReads <= p.rows.length, `${rowReads} shard reads for ${p.rows.length} rows`);
  check("and nothing else is fetched to place them", !asked.some((x) => x.includes("rows.loc")),
    "it still read a locator table");
}

// A filter, taken from whatever the counts say is busiest.
const taskCounts = await index.counts("downloads", "task");
const [task] = [...taskCounts].sort((a, b) => b[1] - a[1])[0];
const filtered = await index.page({ sort: "downloads", filters: { task: [task] }, page: 1 });
const holdsTask = (r) => r[6]?.[F.task] === task;
check("a filtered page holds only matching rows", filtered.rows.every(holdsTask), "a row did not");
check("and its total is the count the header gave", filtered.total === taskCounts.get(task),
  `${filtered.total} against ${taskCounts.get(task)}`);
check("which is what counting by hand gives", filtered.total === all.filter(holdsTask).length,
  `${filtered.total} against ${all.filter(holdsTask).length}`);

// Two values of one facet are a union, not an intersection: chips in a group
// read as "any of these".
const [a, b] = [...taskCounts].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([v]) => v);
const either = await index.page({ sort: "downloads", filters: { task: [a, b] }, page: 1 });
check("two chips in one group are a union", either.total === taskCounts.get(a) + taskCounts.get(b),
  `${either.total} against ${taskCounts.get(a) + taskCounts.get(b)}`);

// Two facets are an intersection.
const licenceCounts = await index.counts("downloads", "license");
const [licence] = [...licenceCounts].sort((x, y) => y[1] - x[1])[0];
const both = await index.page({ sort: "downloads", filters: { task: [task], license: [licence] }, page: 1 });
check("two groups intersect", both.rows.every((r) => holdsTask(r) && r[6]?.[F.license] === licence), "a row did not hold both");
check("and give no more than either alone", both.total <= filtered.total, `${both.total} against ${filtered.total}`);

// Paging through a filter.
if (filtered.total > root.pageSize) {
  const second = await index.page({ sort: "downloads", filters: { task: [task] }, page: 2 });
  check("the second page follows the first", (second.rows[0]?.[3]?.[F.downloads] ?? 0) <= (filtered.rows.at(-1)?.[3]?.[F.downloads] ?? 0),
    `${second.rows[0]?.[3]?.[F.downloads]} after ${filtered.rows.at(-1)?.[3]?.[F.downloads]}`);
  check("and repeats none of it", !second.rows.some((r) => filtered.rows.some((x) => x[0] === r[0])), "a row appeared twice");
}

// A page past the end is clamped rather than empty, which is what the pager
// needs when a filter narrows under the reader's feet.
const far = await index.page({ sort: "likes", page: 10_000_000 });
check("a page past the end is clamped", far.page === far.pages && far.rows.length > 0, `page ${far.page} of ${far.pages}`);

const none = await index.page({ sort: "downloads", filters: { task: [999999] }, page: 1 });
check("a value nothing holds gives nothing", none.total === 0 && none.rows.length === 0, `${none.total}`);

// ---- search
const { words } = await import("../../web/browse.mjs");
const term = "qwen";
const found = await index.page({ sort: "downloads", q: term });
const byHandSearch = all.filter((r) => words(r[0]).includes(term));
check("a search finds rows", found.total > 0, String(found.total));
check("and exactly the rows whose name holds the word", found.total === byHandSearch.length,
  `${found.total} against ${byHandSearch.length}`);
check("every row it returns holds it", found.rows.every((r) => words(r[0]).includes(term)),
  found.rows.find((r) => !words(r[0]).includes(term))?.[0] ?? "");
const searchByHand = [...byHandSearch].sort((a, b) => (b[6]?.[F.downloads] ?? 0) - (a[6]?.[F.downloads] ?? 0))
  .slice(0, root.pageSize).map((r) => r[0]);
check("in the order the slow way gives", JSON.stringify(found.rows.map((r) => r[0])) === JSON.stringify(searchByHand),
  `${found.rows[0]?.[0]} against ${searchByHand[0]}`);

// Two words must both match, not either.
const second = words(byHandSearch.find((r) => words(r[0]).length > 1)?.[0] ?? "").find((w) => w !== term);
if (second) {
  const both = await index.page({ sort: "downloads", q: `${term} ${second}` });
  check("two words both have to match", both.rows.every((r) => words(r[0]).includes(term) && words(r[0]).includes(second)),
    "a row held only one");
  check("and that is no wider than one of them", both.total <= found.total, `${both.total} against ${found.total}`);
}

const nothing = await index.page({ sort: "downloads", q: "zzzznosuchwordzzzz" });
check("a word nothing holds finds nothing", nothing.total === 0 && nothing.rows.length === 0, String(nothing.total));

// Search and a filter together.
const withFilter = await index.page({ sort: "downloads", q: term, filters: { task: [task] } });
check("a search and a filter intersect", withFilter.rows.every((r) => words(r[0]).includes(term) && r[6]?.[F.task] === task),
  "a row did not hold both");
check("and are no wider than either", withFilter.total <= Math.min(found.total, filtered.total),
  `${withFilter.total} against ${found.total} and ${filtered.total}`);

// ---- one model by name, and what reaching it costs
// `find` is how a model page opens a model the index never addressed, so it
// runs on a click and its cost is a reader's wait. The buckets it may look in
// are nothing like the same size, and the first version looked in all of
// them: on the live site that was 2.27 MB and 11.1 s for one name, nearly all
// of it a bucket that settled nothing. So this checks the answer and the
// route to it, because the answer alone was already right.
const sizes = root.search?.words?.sizes ?? {};
const bucketFor = (w) => w.slice(0, 2);
// How many rows hold a word is how far the walk gets on one: a word held by
// more rows than `find` will read exactly cannot settle a name by itself, and
// the walk rightly goes on to the next bucket. Counting it here rather than
// assuming it is the difference between checking the rule and checking the
// sample - an earlier version of this check assumed one bucket always
// sufficed, passed on 711 models and failed on 418.
const holders = new Map();
for (const r of all) for (const w of words(r[0])) holders.set(w, (holders.get(w) ?? 0) + 1);
// The buckets a name's words fall in, cheapest first, which is the order
// `find` must walk them in.
const routeOf = (id) => [...new Set(words(id).map(bucketFor))]
  .filter((k) => sizes[k] !== undefined).sort((a, b) => sizes[a] - sizes[b]);
const lookedAt = () => [...new Set(asked.filter((p) => p.includes("search/words/"))
  .map((p) => p.split("/").pop().replace(".bin", "")))];

// A name whose words span buckets of different sizes; on a name whose words
// all share one bucket there is no cheaper route and nothing to check.
const spread = all.find((r) => {
  const keys = routeOf(r[0]);
  return keys.length > 1 && new Set(keys.map((k) => sizes[k])).size > 1;
});
if (!spread) {
  check("a name whose words span buckets of different sizes exists to test", false,
    "every name's words shared one bucket, so the cheapest-first rule went unchecked");
} else {
  // A reader of its own, because the one above has these buckets cached and a
  // cached bucket is not fetched, which would read as thrift that never ran.
  const fresh = await openBrowse(base);
  asked.length = 0;
  const got = await fresh.find(spread[0]);
  check("a model is found by name", got?.id === spread[0], `${got?.id} against ${spread[0]}`);
  check("and carries the row the roll holds", got?.revision === spread[1], `${got?.revision} against ${spread[1]}`);

  // However far it walked, it walked the cheap end first. This holds whatever
  // the data is: it is the ordering rule itself.
  const route = routeOf(spread[0]);
  const looked = lookedAt();
  check("the buckets it looked in are the cheapest ones",
    JSON.stringify(looked) === JSON.stringify(route.slice(0, looked.length)),
    `looked in ${looked.join(", ") || "none"} when cheapest first is ${route.join(", ")}`);

  const absent = await fresh.find("zzzznosuchownerzzzz/zzzznosuchmodelzzzz");
  check("a name nothing holds finds nothing", absent === undefined, String(absent));

  // And where the cheapest word is rare enough to settle the name on its own,
  // one bucket is all it may read. This is the check the 2.27 MB defect fails:
  // the answer was right, only the route was wrong.
  const alone = all.find((r) => {
    const keys = routeOf(r[0]);
    if (keys.length < 2) return false;
    const first = words(r[0]).filter((w) => bucketFor(w) === keys[0]);
    return first.some((w) => (holders.get(w) ?? Infinity) <= EXACT);
  });
  if (!alone) {
    check("a name its rarest word settles on its own exists to test", false,
      "no name had a cheapest-bucket word held by few enough rows");
  } else {
    const solo = await openBrowse(base);
    asked.length = 0;
    const one = await solo.find(alone[0]);
    check("a name its rarest word settles is found", one?.id === alone[0], `${one?.id} against ${alone[0]}`);
    check("and settled in one bucket, not every bucket of its name",
      lookedAt().length === 1, `${lookedAt().join(", ") || "none"} of ${routeOf(alone[0]).join(", ")}`);
  }
}

server.close();
console.log(`\n${served} requests, ${(bytesServed / 1e3).toFixed(0)} kB served in all, out of a ${(body.length / 1e6).toFixed(0)} MB catalogue`);
console.log(failures.length ? `\n${failures.map((f) => `FAIL ${f}`).join("\n")}` : "\ntests/browse/reader: all checks passed");
process.exit(failures.length ? 1 : 0);
