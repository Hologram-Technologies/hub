// The built UOR address index, checked against its own root.
//
//   node tests/uor/index.mjs <uor dir>
//
// `crates/conformance/tests/index.rs` holds the promise in the source: that the
// builder and the page share one filing rule and that a row carries its address
// and the form that minted it. This checks the artifact that promise produced,
// because a rule honoured in the source and broken in the output would pass the
// first and fail every reader.
//
// Three things are checked, and they are the three a client depends on. A shard
// is the bytes the root names, so the page's kernel check will accept it. A row
// is filed where `web/uorkey.mjs` says to look, so the page finds it at all. And
// every tensor carries the byte range its address was taken over, so a reader
// can fetch one tensor and check it without the file.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { UOR_LABEL, uorAxis, uorShardOf } from "../../web/uorkey.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node tests/uor/index.mjs <uor dir>");
  process.exit(64);
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
let checks = 0;
const ok = (what) => { checks += 1; console.log(`  ok  ${what}`); };

const root = JSON.parse(await readFile(join(dir, "root.json"), "utf8"));
assert.equal(root.format, "hologram.hub.uor/v2");
assert.equal(typeof root.shardBits, "number");
assert.ok(root.shardBits >= 1 && root.shardBits <= 16, "shardBits is 1 to 16");
assert.equal(root.addresser?.crate, "uor-addr");
assert.equal(root.addresser?.axis, "blake3", "the root must say which axis its labels are on");
assert.equal(root.tensorAddress?.axis, "blake3", "the root must say which axis a tensor is addressed on");
assert.ok(root.addresser.version, "the root names which release minted its labels");
ok("the root names the addresser, its version and the shard width");

// An empty index is a legitimate build --- no model in `manifests/uor.txt` may
// have had a file this addresser would take --- but it must then say so rather
// than look like a full one.
if (!root.shards.length) {
  assert.equal(root.counts.files, 0, "no shards means no addressed files");
  assert.ok(root.unaddressed.length, "an index with nothing addressed must say what it could not address");
  ok("an empty index says it is empty");
  console.log(`tests/uor/index: ${checks} checks passed (nothing addressed)`);
  process.exit(0);
}

let files = 0;
let tensors = 0;
for (const shard of root.shards) {
  const bytes = await readFile(join(dir, shard.path));
  assert.equal(sha256(bytes), shard.sha256, `${shard.path} is not the bytes the root names`);
  const rows = JSON.parse(bytes.toString("utf8"));
  assert.equal(rows.length, shard.rows, `${shard.path} holds ${rows.length} rows, the root says ${shard.rows}`);
  for (const row of rows) {
    // Filed where the page will look, by the page's own rule.
    assert.equal(await uorShardOf(row.repo, root.shardBits), shard.path,
                 `${row.repo} is filed in ${shard.path}, which is not where the page looks`);
    // An address, and the form that minted it. Either alone is ambiguous.
    assert.match(row.label, UOR_LABEL, `${row.repo}/${row.path} has no canonical address`);
    assert.equal(typeof row.canonicalForm, "number", `${row.repo}/${row.path} does not say which canonical form minted it`);
    assert.equal(row.canonicalForm, root.canonicalForm, `${row.repo}/${row.path} was minted under a different form than the root names`);
    // Where the bytes came from, so a reader checks at the place the label was
    // taken over rather than at a host name the page carries.
    assert.ok(row.resolve?.startsWith("https://"), `${row.repo}/${row.path} does not say where its bytes came from`);
    assert.ok(row.revision, `${row.repo}/${row.path} names no revision`);
    assert.ok(row.tensors.length, `${row.repo}/${row.path} has no tensors`);
    for (const t of row.tensors) {
      // Two numbers for the same bytes, each saying whose it is: the hub's
      // blake3 address and uor-addr's sha256 canonical-form leaf. A row that
      // carried only one of them, or the same number twice, would have lost
      // the distinction the whole arrangement rests on.
      assert.equal(uorAxis(t.address), "blake3", `${row.repo}/${row.path}:${t.name} is not addressed on the blake3 axis`);
      assert.equal(uorAxis(t.uorLeaf), "sha256", `${row.repo}/${row.path}:${t.name} has no uor-addr leaf`);
      assert.notEqual(t.address.slice(7), t.uorLeaf.slice(7), `${row.repo}/${row.path}:${t.name} gives one digest two axes`);
      assert.match(t.uorLeaf, UOR_LABEL, `${row.repo}/${row.path}:${t.name} has no address`);
      // The range a reader needs. Without it the only way to check a tensor is
      // to take the whole file, which is the cost this index exists to avoid.
      assert.ok(Number.isInteger(t.begin) && t.begin >= row.dataStart,
                `${row.repo}/${row.path}:${t.name} begins before the data section`);
      assert.ok(Number.isInteger(t.length) && t.length > 0,
                `${row.repo}/${row.path}:${t.name} has no length`);
      assert.ok(t.begin + t.length <= row.size,
                `${row.repo}/${row.path}:${t.name} runs past the end of the file`);
    }
    files += 1;
    tensors += row.tensors.length;
  }
}
ok(`every shard is the bytes the root names, and every row is filed where the page looks`);
ok(`every row carries an address, its canonical form and where its bytes came from`);
ok(`every tensor carries the byte range its address was taken over`);

assert.equal(files, root.counts.files, `the root counts ${root.counts.files} files, the shards hold ${files}`);
assert.equal(tensors, root.counts.tensors, `the root counts ${root.counts.tensors} tensors, the shards hold ${tensors}`);
ok("the root's counts are the shards' own");

// What was not addressed is named, file by file, with a reason. A coverage
// figure without this is a claim about the part nobody listed.
for (const entry of root.unaddressed) {
  // A file this build could not address names its path; a model the index no
  // longer holds has no file to name, and says that instead.
  assert.ok(entry.repo, "an unaddressed entry names its repository");
  assert.ok(entry.path !== undefined, "an unaddressed entry says which file, or says there is none");
  assert.ok(entry.why, `${entry.repo}/${entry.path} is unaddressed with no reason given`);
}
assert.equal(root.unaddressed.length, root.counts.unaddressed);
ok(`${root.unaddressed.length} unaddressed files each name a reason`);

console.log(`tests/uor/index: ${checks} checks passed (${files} files, ${tensors} tensors)`);
