// tools/onnx.mjs against graphs built here byte by byte, so every offset and
// every refusal is known before the reader runs (HK-52).
//
//   node tests/uor/onnx.mjs
//
// Each address is checked against a second BLAKE3, the vendored pure-JS one,
// over the same bytes taken by offset and length from the file: what a reader
// with a ranged read would compute. The graphs are streamed in small uneven
// chunks, so a field split across chunks is read as one.
import assert from "node:assert/strict";

import { addressRanges, readGraph } from "../../tools/onnx.mjs";
import { blake3Hex } from "../../tools/blake3.mjs";
import { Blake3 } from "../../try/vendor/prism-code/src/blake3.mjs";

const reference = (bytes) => `blake3:${Buffer.from(new Blake3().update(bytes).digest()).toString("hex")}`;
let checks = 0;
const ok = (what) => { checks += 1; console.log(`  ok  ${what}`); };

// Protobuf, as ONNX writes it.
const varint = (n) => { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; out.push(b); } while (n); return Buffer.from(out); };
const field = (number, wire, body) => Buffer.concat([varint(number * 8 + wire), wire === 2 ? Buffer.concat([varint(body.length), body]) : body]);
const str = (number, s) => field(number, 2, Buffer.from(s, "utf8"));
const num = (number, n) => field(number, 0, varint(n));
const entry = (key, value) => field(13, 2, Buffer.concat([str(1, key), str(2, value)]));
const tensor = (parts) => field(5, 2, Buffer.concat(parts));
const model = (initializers, extra = []) => Buffer.concat([num(1, 9), str(2, "test"), field(7, 2, Buffer.concat([str(2, "g"), ...initializers, ...extra]))]);
const pattern = (n, seed) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 131 + seed + (i >> 10)) & 255));
async function* chunks(bytes, size = 777) { for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size); }

async function read(bytes, path = "onnx/model.onnx") {
  let tapped = 0;
  const tables = new Map();
  const graph = await readGraph(chunks(bytes), path, (c) => { tapped += c.length; }, tables);
  assert.equal(tapped, bytes.length, "every byte of the graph is handed to the file's hasher once");
  return { ...graph, tables };
}
async function refused(bytes, why) {
  await assert.rejects(read(bytes), (e) => e.message.includes(why), `expected a refusal naming "${why}"`);
}

// Inline raw_data: a FLOAT matrix over three pieces, an INT4 vector whose
// last byte is half used, and a scalar with no dims.
const big = pattern(3 * (1 << 20) + 12, 7);
const int4 = pattern(5, 3);
const scalar = pattern(8, 9);
const inline = model([
  tensor([num(1, 3), num(1, 262145), num(2, 1), str(8, "w"), field(9, 2, big)]),
  tensor([field(1, 2, Buffer.concat([varint(9)])), num(2, 22), str(8, "q"), field(9, 2, int4)]),
  tensor([num(2, 7), str(8, "s"), field(9, 2, scalar)]),
]);
const g = await read(inline);
assert.deepEqual(g.initializers.map((t) => [t.name, t.dtype, t.shape]), [["w", "FLOAT", [3, 262145]], ["q", "INT4", [9]], ["s", "INT64", []]]);
for (const t of g.initializers) {
  assert.equal(t.file, "onnx/model.onnx");
  assert.equal(t.address, reference(inline.subarray(t.offset, t.offset + t.length)), `${t.name}: the address is the BLAKE3 of its range`);
}
assert.equal(g.size, inline.length);
ok("inline raw_data: name, type, shape, offset and length, and the address is the BLAKE3 of exactly that range");
const [w] = g.initializers;
assert.ok(g.tables.has(w.address.slice(7)) && g.tables.size === 1, "the one tensor over a piece has a piece table, and only it");
ok("a tensor over 1 MiB comes with its piece table");

// External data: two ranges in one data file, one of them past a piece, and
// the data file hashed whole in the same pass.
const data = Buffer.concat([pattern(4096, 1), pattern(2 * (1 << 20) + 1, 2), pattern(100, 3)]);
const external = model([
  tensor([num(1, 1024), num(2, 1), str(8, "a"), entry("location", "model.onnx_data"), entry("offset", "0"), entry("length", "4096"), num(14, 1)]),
  tensor([num(1, 2 * (1 << 20) + 1), num(2, 2), str(8, "b"), entry("location", "model.onnx_data"), entry("offset", "4096"), entry("length", String(2 * (1 << 20) + 1)), num(14, 1)]),
]);
const e = await read(external);
assert.ok(e.initializers.every((t) => t.file === "onnx/model.onnx_data" && t.address === null));
let whole = 0;
await addressRanges(chunks(data, 65537), e.initializers, (c) => { whole += c.length; }, e.tables);
assert.equal(whole, data.length);
for (const t of e.initializers) assert.equal(t.address, reference(data.subarray(t.offset, t.offset + t.length)), `${t.name}: external address`);
assert.ok(e.tables.has(e.initializers[1].address.slice(7)));
ok("external data: the file is the graph's sibling, and each range's address is the BLAKE3 of those bytes");
assert.equal(blake3Hex(data), reference(data).slice(7));
ok("the streaming hasher and the reference agree on the whole data file");

// What would need a guess is refused.
await refused(model([tensor([num(1, 2), num(2, 1), str(8, "f"), field(4, 2, pattern(8, 1))])]), "typed field 4");
await refused(model([tensor([num(1, 2), num(2, 7), str(8, "i"), field(7, 2, Buffer.from([1, 2]))])]), "typed field 7");
ok("typed data, whose stored bytes are not the tensor, is refused");
await refused(model([tensor([num(1, 3), num(2, 1), str(8, "short"), field(9, 2, pattern(8, 1))])]), "its dims and FLOAT make 12");
ok("a length the dims and type do not make is refused");
await refused(model([tensor([num(1, 1), num(2, 1), str(8, "x"), entry("location", "../../elsewhere"), num(14, 1)])]), "names external location");
await refused(model([tensor([num(1, 1), num(2, 1), str(8, "x"), entry("location", "/etc/passwd"), num(14, 1)])]), "names external location");
ok("an external location outside the repository is refused");
await refused(model([tensor([num(1, 1), num(2, 8), str(8, "t"), field(9, 2, pattern(1, 1))])]), "no fixed width");
ok("a type with no fixed width is refused");
await refused(model([], [field(15, 2, Buffer.from([]))]), "sparse initializer");
ok("a sparse initializer is refused");
await refused(inline.subarray(0, inline.length - 5), "the file ends inside a field");
ok("a truncated graph is refused");
await assert.rejects(addressRanges(chunks(data.subarray(0, 5000)), e.initializers.map((t) => ({ ...t })), () => {}, new Map()), /runs past the end/);
ok("a range past the end of its data file is refused");

console.log(`tests/uor/onnx: ${checks} checks passed`);
