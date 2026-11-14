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
import { openBrowse } from "../../web/browse.mjs";

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
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname))
    .split(/[\\/]+/).filter((p) => p && p !== "." && p !== "..").join("/");
  let body;
  try { body = await readFile(join(site, rel)); } catch { res.writeHead(404).end(); return; }
  served += 1;
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
const locBytes = await readFile(join(dir, root.rows.locator));
const lv = new DataView(locBytes.buffer, locBytes.byteOffset, locBytes.byteLength);
const shards = await Promise.all(root.rows.shards.map((p) => readFile(join(dir, root.rows.from, p))));
const body = shards.reduce((a, b) => a + b.length, 0) ? { length: shards.reduce((a, b) => a + b.length, 0) } : { length: 0 };
const all = Array.from({ length: root.rows.count }, (_, n) => {
  const shard = shards[lv.getUint32(n * 12)];
  const at = lv.getUint32(n * 12 + 4), len = lv.getUint32(n * 12 + 8);
  return JSON.parse(shard.subarray(at, at + len).toString("utf8"));
});

const F = index.field;
const first = await index.page({ sort: "downloads", page: 1 });
check("an unfiltered page has a full page of rows", first.rows.length === root.pageSize, String(first.rows.length));
check("and the whole catalogue as its total", first.total === root.rows.count, `${first.total} of ${root.rows.count}`);
const byHand = [...all].sort((a, b) => (b[6]?.[F.downloads] ?? 0) - (a[6]?.[F.downloads] ?? 0)).slice(0, root.pageSize).map((r) => r[0]);
check("it is the page sorting the lot would give", JSON.stringify(first.rows.map((r) => r[0])) === JSON.stringify(byHand),
  `${first.rows[0]?.[0]} against ${byHand[0]}`);

const bytesForAPage = bytesServed;
check("a page costs kilobytes, not the catalogue", bytesForAPage < 1e6, `${(bytesForAPage / 1e3).toFixed(0)} kB`);

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

server.close();
console.log(`\n${served} requests, ${(bytesServed / 1e3).toFixed(0)} kB served in all, out of a ${(body.length / 1e6).toFixed(0)} MB catalogue`);
console.log(failures.length ? `\n${failures.map((f) => `FAIL ${f}`).join("\n")}` : "\ntests/browse/reader: all checks passed");
process.exit(failures.length ? 1 : 0);
