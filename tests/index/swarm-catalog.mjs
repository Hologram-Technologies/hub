// The swarm catalog is shards a page reads one at a time, so what has to hold
// is narrower than for the index and more exacting: a reader who searches for
// a model the catalog holds must be given the one shard it is in, because no
// other shard will be read.
//
// Three things decide that, and each is checked here against the built
// artifact rather than against the builder's intentions:
//
//   - the bytes are the ones the root names, so a shard can be refused the
//     way `HK-10` refuses any other addressed blob;
//   - every row is filed under the key `web/swarmkey.mjs` gives for it, which
//     is the rule the page resolves a query with;
//   - every row carries the fields the page draws, and says what it is.
//
// A row here is Pirate Face's claim and nothing more. The test holds the
// catalog to saying that of itself.
//
//   node tests/index/swarm-catalog.mjs <catalog dir>
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { swarmKey, swarmKeyOf } from "../../web/swarmkey.mjs";

const [dir] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node tests/index/swarm-catalog.mjs <catalog dir>");
  process.exit(64);
}

let failed = 0;
const check = (name, run) => {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.message}`);
  }
};

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const read = async (path) => readFile(join(dir, path));

const root = JSON.parse(await read("root.json"));
const shards = new Map();
for (const s of [...(root.name ?? []), ...(root.rank ?? [])]) shards.set(s.path, await read(s.path));

check("the root is a swarm catalog and names where it came from", () => {
  assert.equal(root.format, "hologram.hub.swarmcatalog/v1");
  assert.match(root.catalog, /^https:\/\//);
  assert.match(root.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof root.rules, "string");
  // The page prints this under the rows, so a reader is told whose claims
  // these are without having to know.
  assert.ok(root.note.length > 40, "the root carries no note about what these rows are");
});

check("every shard is the bytes the root names", () => {
  for (const s of [...root.name, ...root.rank]) {
    assert.equal(sha256(shards.get(s.path)), s.sha256, `${s.path} is not what the root names`);
  }
});

const rows = new Map();
for (const s of root.name) rows.set(s.prefix, JSON.parse(shards.get(s.path).toString()));
const every = [...rows.values()].flat();

check("the root counts what the shards hold", () => {
  for (const s of root.name) assert.equal(rows.get(s.prefix).length, s.rows, `${s.path} holds a different number of rows`);
  assert.equal(every.length, root.models, "the root's model count is not the number of rows");
  assert.ok(root.scanned >= root.models, "more rows were kept than were scanned");
});

// The one that matters. A search reads a single shard, so a row filed
// anywhere else is a row the page can never return.
check("every row is in the shard the page will look in", () => {
  for (const [prefix, list] of rows) {
    for (const row of list) {
      assert.equal(swarmKey(row.name), prefix, `${row.id} is filed under ${prefix}, but its name belongs in ${swarmKey(row.name)}`);
      assert.equal(swarmKeyOf(row.id), prefix, `${row.id} is filed under ${prefix}, but its id resolves to ${swarmKeyOf(row.id)}`);
    }
  }
});

check("a shard name is a name a web server will serve", () => {
  for (const s of root.name) {
    assert.match(s.prefix, /^[a-z0-9_]{2}$/, `${s.prefix} is not a safe shard key`);
    assert.equal(s.path, `name/${s.prefix}.json`);
  }
});

check("every row carries what the page draws", () => {
  for (const row of every) {
    assert.match(row.id, /\S/);
    assert.equal(typeof row.org, "string");
    assert.equal(typeof row.name, "string");
    assert.ok(row.id.endsWith(row.name), `${row.id} does not end in its own name`);
    assert.ok(Number.isInteger(row.seeders) && row.seeders >= 0, `${row.id} has no seeder count`);
    assert.ok(row.params === null || row.params > 0, `${row.id} has a parameter count of ${row.params}`);
    assert.equal(typeof row.format, "string");
  }
});

// A row the swarm listed is not a row this hub checked, and the difference is
// the whole reason these shards are separate from the index. If a row ever
// claimed otherwise the page would draw it beside signed rows as an equal.
check("no row claims to be more than a listing", () => {
  for (const row of every) {
    assert.equal(row.state, "listed", `${row.id} says its state is ${row.state}`);
    assert.deepEqual([...new Set(row.sources ?? [])].filter((k) => k !== "pirateface"), [], `${row.id} claims a source other than the swarm`);
    assert.equal(row.observed.source, root.catalog, `${row.id} attributes its traffic elsewhere`);
  }
});

check("the rank pages are the catalog in seeder order", () => {
  let last = Infinity;
  let rank = 0;
  for (const s of root.rank) {
    const page = JSON.parse(shards.get(s.path).toString());
    assert.equal(page.length, s.rows, `${s.path} holds a different number of rows`);
    for (const row of page) {
      rank += 1;
      assert.equal(row.rank, rank, `${row.id} is numbered ${row.rank} at position ${rank}`);
      assert.ok(row.seeders <= last, `${row.id} has more seeders than the row above it`);
      last = row.seeders;
    }
  }
});

const bytes = [...shards.values()].reduce((a, b) => a + b.length, 0);
const biggest = root.name.reduce((a, s) => Math.max(a, shards.get(s.path).length), 0);
console.log(`     ${root.models} rows of ${root.scanned} scanned, ${root.name.length} name shards, ${root.rank.length} rank pages`);
console.log(`     ${bytes} bytes in all, largest shard ${biggest} bytes, which is what a search costs`);

if (failed) {
  console.log(`tests/index/swarm-catalog: ${failed} check(s) failed`);
  process.exit(1);
}
console.log("tests/index/swarm-catalog: all checks passed");
