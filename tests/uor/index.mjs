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
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { instantiate } from "../../web/piece-hash.mjs";
import { PIECE_LEN, decodeTable, foldTable } from "../../web/pieces.mjs";
import { UOR_LABEL, uorAxis, uorShardOf } from "../../web/uorkey.mjs";
import { blake3Hex } from "../../tools/blake3.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node tests/uor/index.mjs <uor dir>");
  process.exit(64);
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
let checks = 0;
// Every tensor of every row, for the piece-table check below.
const longTensors = [];
const ok = (what) => { checks += 1; console.log(`  ok  ${what}`); };

const root = JSON.parse(await readFile(join(dir, "root.json"), "utf8"));
assert.equal(root.format, "hologram.hub.uor/v3");
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

// HK-52: an ONNX row has no κ-label. It names every file its tensors lie in by
// the BLAKE3 its record names, and every tensor names one of those files and a
// range inside it.
const onnxRows = [];
function checkOnnx(row) {
  assert.equal(row.label, undefined, `${row.repo}/${row.path} is ONNX and carries a κ-label it was not minted with`);
  assert.equal(row.sha256, undefined, `${row.repo}/${row.path} names content by SHA-256`);
  assert.equal(root.onnx?.axis, "blake3", "the root must say ONNX tensors are addressed on the blake3 axis");
  assert.ok(row.resolve?.startsWith("https://") && row.revision, `${row.repo}/${row.path} does not say where its bytes came from`);
  const sizes = new Map(row.files.map((f) => [f.path, f.size]));
  assert.equal(row.files[0]?.path, row.path, `${row.repo}/${row.path} does not name its own graph first`);
  for (const f of row.files) assert.match(f.blake3 ?? "", /^[0-9a-f]{64}$/, `${row.repo}/${f.path} carries no BLAKE3`);
  assert.ok(row.tensors.length, `${row.repo}/${row.path} has no tensors`);
  for (const t of row.tensors) {
    longTensors.push(t);
    assert.ok(t.name && t.dtype && Array.isArray(t.shape), `${row.repo}/${row.path}: a tensor without a name, type or shape`);
    assert.equal(uorAxis(t.address), "blake3", `${row.repo}/${row.path}:${t.name} is not addressed on the blake3 axis`);
    assert.match(t.address, UOR_LABEL, `${row.repo}/${row.path}:${t.name} has no address`);
    assert.ok(sizes.has(t.file), `${row.repo}/${row.path}:${t.name} lies in ${t.file}, which the row does not name`);
    assert.ok(Number.isInteger(t.offset) && t.offset >= 0 && Number.isInteger(t.length) && t.offset + t.length <= sizes.get(t.file),
              `${row.repo}/${row.path}:${t.name} runs past the end of ${t.file}`);
  }
  onnxRows.push(row);
}

let files = 0;
let tensors = 0;
for (const shard of root.shards) {
  const bytes = await readFile(join(dir, shard.path));
  assert.equal(sha256(bytes), shard.sha256, `${shard.path} is not the bytes the root names`);
  assert.equal(blake3Hex(bytes), shard.blake3, `${shard.path} is not the bytes the root names by BLAKE3`);
  const rows = JSON.parse(bytes.toString("utf8"));
  assert.equal(rows.length, shard.rows, `${shard.path} holds ${rows.length} rows, the root says ${shard.rows}`);
  for (const row of rows) {
    // Filed where the page will look, by the page's own rule.
    assert.equal(await uorShardOf(row.repo, root.shardBits), shard.path,
                 `${row.repo} is filed in ${shard.path}, which is not where the page looks`);
    if (row.realization === "onnx") {
      checkOnnx(row);
      files += 1;
      tensors += row.tensors.length;
      continue;
    }
    // An address, and the form that minted it. Either alone is ambiguous.
    assert.match(row.label, UOR_LABEL, `${row.repo}/${row.path} has no canonical address`);
    assert.equal(typeof row.canonicalForm, "number", `${row.repo}/${row.path} does not say which canonical form minted it`);
    assert.ok(root.addresser.realizations.includes(row.realization), `${row.repo}/${row.path} is a ${row.realization} row, which the root's addresser does not name`);
    assert.equal(row.canonicalForm, root.canonicalForms[row.realization], `${row.repo}/${row.path} was minted under a different form than the root names for ${row.realization}`);
    // Where the bytes came from, so a reader checks at the place the label was
    // taken over rather than at a host name the page carries.
    assert.ok(row.resolve?.startsWith("https://"), `${row.repo}/${row.path} does not say where its bytes came from`);
    assert.ok(row.revision, `${row.repo}/${row.path} names no revision`);
    assert.ok(row.tensors.length, `${row.repo}/${row.path} has no tensors`);
    for (const t of row.tensors) {
      longTensors.push(t);
      // One number per tensor: the BLAKE3 of its bytes, which is uor-addr's
      // canonical-form leaf and what the model label binds. A second number
      // beside it would be a second identity for the same bytes.
      assert.equal(uorAxis(t.address), "blake3", `${row.repo}/${row.path}:${t.name} is not addressed on the blake3 axis`);
      assert.match(t.address, UOR_LABEL, `${row.repo}/${row.path}:${t.name} has no address`);
      assert.equal(t.uorLeaf, undefined, `${row.repo}/${row.path}:${t.name} carries a second tensor address`);
      // The range a reader needs. Without it the only way to check a tensor is
      // to take the whole file, which is the cost this index exists to avoid.
      assert.ok(Number.isInteger(t.begin) && t.begin >= row.dataStart,
                `${row.repo}/${row.path}:${t.name} begins before the data section`);
      // safetensors admits a tensor with a zero dimension, whose range is
      // empty and whose leaf is the BLAKE3 of no bytes; GGUF has none.
      assert.ok(Number.isInteger(t.length) && (t.length > 0 || row.realization === "safetensors"),
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

// Every tensor longer than one piece has a piece table under its address that
// decodes, is the tensor's length and folds to the tensor's address; no other
// table is published. A table that did not fold would be refused by every
// reader (HK-39), so publishing one would only cost them a request.
const hasher = await instantiate(await readFile(fileURLToPath(new URL("../../web/piece-hash.wasm", import.meta.url))));
assert.equal(root.pieceTables?.path, "pieces/{address hex}", "the root must say where piece tables are");
assert.equal(root.pieceTables?.encoding, "HPTREE01");
const published = new Set(await readdir(join(dir, "pieces")).catch(() => []));
let tables = 0;
for (const t of longTensors) {
  const hex = t.address.slice(7);
  if (t.length <= PIECE_LEN) {
    assert.ok(!published.has(hex) || longTensors.some((u) => u.address === t.address && u.length > PIECE_LEN),
              `${t.name} is one piece and needs no table`);
    continue;
  }
  assert.ok(published.has(hex), `${t.name}, ${t.length} bytes, has no piece table at pieces/${hex}`);
  const table = decodeTable(await readFile(join(dir, "pieces", hex)));
  assert.equal(table.length, t.length, `the piece table of ${t.name} is for ${table.length} bytes, the tensor has ${t.length}`);
  assert.equal(`blake3:${Buffer.from(foldTable(table.cvs, hasher.parent)).toString("hex")}`, t.address,
               `the piece table of ${t.name} does not fold to its address`);
  tables += 1;
}
assert.equal(published.size, root.pieceTables.count, `the root counts ${root.pieceTables.count} piece tables, ${published.size} are published`);
ok(`${tables} tensors over 1 MiB each have a piece table that folds to their address`);

assert.equal(files, root.counts.files, `the root counts ${root.counts.files} files, the shards hold ${files}`);
assert.equal(tensors, root.counts.tensors, `the root counts ${root.counts.tensors} tensors, the shards hold ${tensors}`);
ok("the root's counts are the shards' own");

// The check a reader makes, made here once per ONNX file: one tensor's bytes,
// fetched by a ranged read from where the row says they came from, hash to the
// tensor's address. The tensor is the last small one in each file, so the
// read is short and lies far from the start of the file.
for (const row of onnxRows) {
  for (const { path } of row.files) {
    const t = row.tensors.filter((x) => x.file === path && x.length > 0 && x.length <= PIECE_LEN).at(-1);
    if (!t) continue;
    const response = await fetch(`${row.resolve}${t.file}`, { headers: { range: `bytes=${t.offset}-${t.offset + t.length - 1}` } });
    assert.equal(response.status, 206, `${row.repo}/${t.file}: a ranged read answered ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(`blake3:${blake3Hex(bytes)}`, t.address, `${row.repo}/${t.file}:${t.name}, read by range, is not its address`);
  }
}
if (onnxRows.length) ok(`${onnxRows.length} ONNX graphs: in every file, one tensor read by range hashes to its address`);

// Every graph manifests/onnx.txt lists is a row, or is unaddressed with the
// reader's own refusal: none is dropped, and none is left to the old "no
// canonical form" reason.
const listedGraphs = (await readFile(fileURLToPath(new URL("../../manifests/onnx.txt", import.meta.url)), "utf8"))
  .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && /\.onnx$/i.test(l));
for (const line of listedGraphs) {
  const [repo, path] = line.split(/\s+/);
  const row = onnxRows.some((r) => r.repo === repo && r.path === path);
  const refused = root.unaddressed.find((u) => u.repo === repo && u.path === path);
  assert.ok(row || refused?.why?.startsWith("onnx:"), `${repo}/${path} is listed in manifests/onnx.txt and is neither addressed nor refused by the reader`);
}
if (listedGraphs.length) ok(`${listedGraphs.length} listed ONNX graphs are each addressed or refused by name`);

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
