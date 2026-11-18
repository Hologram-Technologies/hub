// The initializers of an ONNX graph, read from the bytes as they stream past,
// each with the file and byte range its data lies in and the BLAKE3 of exactly
// that range.
//
// Why a reader here and not uor-addr's ONNX realization: that realization
// addresses a tensor kept in an external file by the BLAKE3 of the reference
// (location, offset, length), not of the bytes, by design (`onnx/value.rs`,
// `onnx:external-data:v1`). Most graphs Hologram AI loads keep their weights
// that way, so its leaf could not be checked against a ranged read of the
// weights. The address published here is the BLAKE3 of the stored bytes and
// nothing else, the same rule as a GGUF or safetensors leaf.
//
// Only what ONNX's own protobuf schema says is read: ModelProto field 7 is the
// graph, GraphProto field 5 an initializer, and in a TensorProto 1 is dims, 2
// data_type, 8 name, 9 raw_data, 13 external_data and 14 data_location
// (onnx/onnx.proto3). Anything that would need a guess is refused rather than
// addressed: a typed-data field, whose stored bytes are protobuf varints and
// not the tensor; a segmented or sparse initializer; a length that is not the
// dims times the type's width.
import { posix } from "node:path";

import { blake3Stream } from "./blake3.mjs";

// TensorProto.DataType, with each element's width in bits. STRING (8) has no
// width and is refused.
export const ONNX_TYPES = new Map([
  [1, ["FLOAT", 32]], [2, ["UINT8", 8]], [3, ["INT8", 8]], [4, ["UINT16", 16]], [5, ["INT16", 16]],
  [6, ["INT32", 32]], [7, ["INT64", 64]], [9, ["BOOL", 8]], [10, ["FLOAT16", 16]], [11, ["DOUBLE", 64]],
  [12, ["UINT32", 32]], [13, ["UINT64", 64]], [14, ["COMPLEX64", 64]], [15, ["COMPLEX128", 128]],
  [16, ["BFLOAT16", 16]], [17, ["FLOAT8E4M3FN", 8]], [18, ["FLOAT8E4M3FNUZ", 8]], [19, ["FLOAT8E5M2", 8]],
  [20, ["FLOAT8E5M2FNUZ", 8]], [21, ["UINT4", 4]], [22, ["INT4", 4]], [23, ["FLOAT4E2M1", 4]],
]);
const TYPED_DATA = new Set([4, 5, 6, 7, 10, 11]);

// Bytes in order from an async iterable, with every chunk also handed to
// `tap` exactly once, so the whole file is hashed in the same pass.
class Reader {
  constructor(chunks, tap) {
    this.it = chunks[Symbol.asyncIterator]();
    this.tap = tap;
    this.buf = Buffer.alloc(0);
    this.at = 0;
    this.pos = 0;
  }
  async more() {
    const { value, done } = await this.it.next();
    if (done) return false;
    const chunk = Buffer.from(value);
    this.tap(chunk);
    this.buf = Buffer.concat([this.buf.subarray(this.at), chunk]);
    this.at = 0;
    return true;
  }
  async atEnd() {
    while (this.at >= this.buf.length) if (!(await this.more())) return true;
    return false;
  }
  async byte() {
    if (await this.atEnd()) throw new Error(`onnx: the file ends inside a field at byte ${this.pos}`);
    this.pos += 1;
    return this.buf[this.at++];
  }
  async varint() {
    let value = 0;
    for (let scale = 1, i = 0; i < 10; i++, scale *= 128) {
      const b = await this.byte();
      value += (b & 127) * scale;
      if (b < 128) {
        if (!Number.isSafeInteger(value)) throw new Error(`onnx: a varint past 2^53 at byte ${this.pos}`);
        return value;
      }
    }
    throw new Error(`onnx: a varint longer than ten bytes at byte ${this.pos}`);
  }
  async take(n) {
    while (this.buf.length - this.at < n) if (!(await this.more())) throw new Error(`onnx: the file ends inside a field at byte ${this.pos}`);
    const out = Buffer.from(this.buf.subarray(this.at, this.at + n));
    this.at += n;
    this.pos += n;
    return out;
  }
  // `n` bytes handed to `sink` and not kept: a raw_data field can be the
  // whole model.
  async pass(n, sink) {
    let left = n;
    while (left > 0) {
      if (this.at >= this.buf.length && !(await this.more())) throw new Error(`onnx: the file ends inside a field at byte ${this.pos}`);
      const part = this.buf.subarray(this.at, this.at + Math.min(left, this.buf.length - this.at));
      sink?.(part);
      this.at += part.length;
      this.pos += part.length;
      left -= part.length;
    }
  }
  async skip(wire) {
    if (wire === 0) return void (await this.varint());
    if (wire === 1) return this.pass(8);
    if (wire === 5) return this.pass(4);
    if (wire === 2) return this.pass(await this.varint());
    throw new Error(`onnx: wire type ${wire} at byte ${this.pos}`);
  }
}

// The two fields of a StringStringEntryProto.
function entry(bytes) {
  const out = {};
  let p = 0;
  const varint = () => {
    let v = 0;
    for (let scale = 1; ; scale *= 128) {
      const b = bytes[p++];
      v += (b & 127) * scale;
      if (b < 128) return v;
    }
  };
  while (p < bytes.length) {
    const tag = varint();
    if ((tag & 7) !== 2) throw new Error("onnx: an external_data entry that is not two strings");
    const n = varint();
    out[tag >> 3] = bytes.subarray(p, p + n).toString("utf8");
    p += n;
  }
  return { key: out[1], value: out[2] };
}

async function tensor(r, end, graphPath, tables) {
  const t = { name: null, type: null, shape: [], raw: null, external: null, location: 0 };
  while (r.pos < end) {
    const tag = await r.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 0) t.shape.push(await r.varint());
    else if (field === 1 && wire === 2) {
      const n = await r.varint();
      const stop = r.pos + n;
      while (r.pos < stop) t.shape.push(await r.varint());
    } else if (field === 2 && wire === 0) t.type = await r.varint();
    else if (field === 8 && wire === 2) t.name = (await r.take(await r.varint())).toString("utf8");
    else if (field === 9 && wire === 2) {
      const length = await r.varint();
      const hash = blake3Stream();
      t.raw = { offset: r.pos, length };
      await r.pass(length, (part) => hash.update(part));
      t.raw.hash = hash.finish();
    } else if (field === 13 && wire === 2) {
      (t.external ??= []).push(entry(await r.take(await r.varint())));
    } else if (field === 14 && wire === 0) t.location = await r.varint();
    else if (TYPED_DATA.has(field)) throw new Error(`onnx: ${t.name ?? "an initializer"} keeps its data in typed field ${field}, whose stored bytes are not the tensor's`);
    else if (field === 3) throw new Error(`onnx: ${t.name ?? "an initializer"} is segmented`);
    else await r.skip(wire);
  }
  if (r.pos !== end) throw new Error(`onnx: an initializer overruns its own length at byte ${r.pos}`);
  if (!t.name) throw new Error("onnx: an initializer with no name");
  const type = ONNX_TYPES.get(t.type);
  if (!type) throw new Error(`onnx: ${t.name} has data type ${t.type}, which has no fixed width`);
  const [dtype, bits] = type;
  const count = t.shape.reduce((n, d) => n * d, 1);
  const expected = Math.ceil((count * bits) / 8);
  const row = { name: t.name, dtype, shape: t.shape };
  if (t.location === 1) {
    if (t.raw) throw new Error(`onnx: ${t.name} is external and inline at once`);
    const ext = Object.fromEntries((t.external ?? []).map(({ key, value }) => [key, value]));
    const location = ext.location;
    // A location is relative to the graph and must stay in its repository.
    if (!location || location.startsWith("/") || location.split(/[\\/]/).includes("..")) {
      throw new Error(`onnx: ${t.name} names external location ${JSON.stringify(location)}`);
    }
    const offset = Number(ext.offset ?? 0);
    const length = ext.length === undefined ? expected : Number(ext.length);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length)) throw new Error(`onnx: ${t.name} has an unreadable external range`);
    if (length !== expected) throw new Error(`onnx: ${t.name} is ${length} bytes, its dims and ${dtype} make ${expected}`);
    return { ...row, file: posix.join(posix.dirname(graphPath), location), offset, length, address: null };
  }
  if (!t.raw) throw new Error(`onnx: ${t.name} has no raw_data and is not external`);
  if (t.raw.length !== expected) throw new Error(`onnx: ${t.name} is ${t.raw.length} bytes, its dims and ${dtype} make ${expected}`);
  const address = `blake3:${t.raw.hash.blake3}`;
  if (t.raw.hash.table) tables.set(t.raw.hash.blake3, t.raw.hash.table.toString("hex"));
  return { ...row, file: graphPath, offset: t.raw.offset, length: t.raw.length, address };
}

// Reads a graph from `chunks`. Inline initializers come back addressed; an
// external one comes back with `address: null`, to be hashed from its file by
// `addressRanges`. `tap` sees every byte of the graph once.
export async function readGraph(chunks, graphPath, tap, tables) {
  const r = new Reader(chunks, tap);
  const initializers = [];
  let graphs = 0;
  while (!(await r.atEnd())) {
    const tag = await r.varint();
    if (tag >> 3 !== 7 || (tag & 7) !== 2) {
      await r.skip(tag & 7);
      continue;
    }
    graphs += 1;
    // The length is read before the position it is measured from.
    const length = await r.varint();
    const end = r.pos + length;
    while (r.pos < end) {
      const inner = await r.varint();
      const field = inner >> 3;
      if (field === 5 && (inner & 7) === 2) {
        const length = await r.varint();
        initializers.push(await tensor(r, r.pos + length, graphPath, tables));
      }
      else if (field === 15) throw new Error("onnx: a sparse initializer, which is not read here");
      else await r.skip(inner & 7);
    }
  }
  if (graphs !== 1) throw new Error(`onnx: ${graphs} graphs in a model, not one`);
  return { size: r.pos, initializers };
}

// Hashes each range of a data file as the file streams past. A range's hasher
// exists only while the stream is inside it, so the memory held is a piece per
// range open at once, not per tensor.
export async function addressRanges(chunks, ranges, tap, tables) {
  const order = [...ranges].sort((a, b) => a.offset - b.offset);
  const open = new Map();
  let next = 0;
  let pos = 0;
  for await (const value of chunks) {
    const chunk = Buffer.from(value);
    tap(chunk);
    const end = pos + chunk.length;
    while (next < order.length && order[next].offset < end) {
      open.set(order[next], blake3Stream());
      next += 1;
    }
    for (const [range, hash] of open) {
      const a = Math.max(range.offset, pos);
      const b = Math.min(range.offset + range.length, end);
      if (a < b) hash.update(chunk.subarray(a - pos, b - pos));
      if (range.offset + range.length <= end) {
        const done = hash.finish();
        range.address = `blake3:${done.blake3}`;
        if (done.table) tables.set(done.blake3, done.table.toString("hex"));
        open.delete(range);
      }
    }
    pos = end;
  }
  // An empty range and one that starts at the end of the file are finished
  // here, and a range past the end is refused.
  for (const range of order.slice(next).concat([...open.keys()])) {
    if (range.offset + range.length > pos) throw new Error(`onnx: ${range.name} runs past the end of ${range.file}, ${pos} bytes`);
    range.address = `blake3:${blake3Stream().finish().blake3}`;
  }
  return pos;
}
