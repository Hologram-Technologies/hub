// What a torrent's checksums prove, and what a tensor address proves.
//
//   node tests/uor/addressing.mjs [--live]
//
// Pirate Face distributes models as BitTorrent v1. That gives a reader real
// integrity: the infohash is SHA-1 over the bencoded `info` dictionary, which
// commits to every piece hash, so a client that recomputes the infohash can
// then trust the piece hashes and check each piece it receives. None of that
// is in doubt and none of it is being argued against here.
//
// What is in question is what those checksums are evidence *of*. This builds
// real torrents over real safetensors bytes and runs both schemes against the
// same four situations, so the difference is measured rather than asserted:
//
//   A  granularity    one byte of one tensor is flipped. Which scheme can say
//                     what broke?
//   B  repackaging    the same weights, packaged differently. Which address
//                     survives?
//   C  substitution   a torrent of different weights, internally perfect.
//                     Which scheme refuses it?
//   D  duplication    the same tensor in two models. Which scheme can see
//                     that they share it?
//
// `--live` adds a fifth: recompute a published manifest's tensor addresses
// from the bytes Hugging Face serves today and check they still agree.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Blake3 } from "../../try/vendor/prism-code/src/blake3.mjs";
import { piecesOf, readTorrent } from "../../runner/torrent.mjs";
import { readSafetensors, tensorAddresses } from "../../runner/uor.mjs";

const live = process.argv.includes("--live");
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

// ---------------------------------------------------------------- bencode
// Only what a torrent needs, and only for writing: the reader under test is
// `runner/bencode.mjs`, which must stay the one that parses.
function bencode(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  if (typeof value === "string") return bencode(Buffer.from(value, "utf8"));
  if (typeof value === "number") return Buffer.from(`i${value}e`);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from("l"), ...value.map(bencode), Buffer.from("e")]);
  const keys = Object.keys(value).sort();
  return Buffer.concat([Buffer.from("d"), ...keys.flatMap((k) => [bencode(k), bencode(value[k])]), Buffer.from("e")]);
}

// A v1 torrent over a set of named byte buffers, with the piece length the
// caller chooses so a piece can be made to straddle a file boundary.
function makeTorrent(name, files, pieceLength) {
  const all = Buffer.concat(files.map((f) => f.bytes));
  const hashes = [];
  for (let at = 0; at < all.length; at += pieceLength) {
    hashes.push(createHash("sha1").update(all.subarray(at, Math.min(at + pieceLength, all.length))).digest());
  }
  const info = {
    name,
    "piece length": pieceLength,
    pieces: Buffer.concat(hashes),
    files: files.map((f) => ({ length: f.bytes.length, path: f.path.split("/") })),
  };
  const encoded = bencode({ announce: "http://tracker.invalid/announce", info });
  return { bytes: encoded, infohash: createHash("sha1").update(bencode(info)).digest("hex"), all };
}

// Which pieces a torrent says are wrong, given the bytes actually held.
function badPieces(torrent, all) {
  const out = [];
  for (let i = 0; i < torrent.pieceCount; i += 1) {
    const start = i * torrent.pieceLength;
    const slice = all.subarray(start, Math.min(start + torrent.pieceLength, all.length));
    if (!createHash("sha1").update(slice).digest().equals(torrent.pieceHash(i))) out.push(i);
  }
  return out;
}

// Which tensors a set of addresses says are wrong.
function badTensors(expected, bytes) {
  const found = tensorAddresses(bytes);
  return [...expected].filter(([name, address]) => found.get(name) !== address).map(([name]) => name);
}

// ------------------------------------------------------------ safetensors
// Deterministic so a run is reproducible, and shaped like a real file: an
// 8-byte header length, a JSON header, then the tensor data.
function tensorBytes(seed, length) {
  const out = Buffer.alloc(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

function safetensors(tensors) {
  const header = {};
  let at = 0;
  const blocks = [];
  for (const t of tensors) {
    header[t.name] = { dtype: "F32", shape: [t.bytes.length / 4], data_offsets: [at, at + t.bytes.length] };
    blocks.push(t.bytes);
    at += t.bytes.length;
  }
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  return Buffer.concat([length, json, ...blocks]);
}

const TENSORS = [
  { name: "encoder.embed.weight", bytes: tensorBytes(1, 4096) },
  { name: "encoder.layer.0.attn.q", bytes: tensorBytes(2, 8192) },
  { name: "encoder.layer.0.attn.k", bytes: tensorBytes(3, 8192) },
  { name: "pooler.dense.bias", bytes: tensorBytes(9, 1536) },
];
const WEIGHTS = safetensors(TENSORS);
const CONFIG = Buffer.from(JSON.stringify({ architectures: ["TestModel"], hidden_size: 16 }), "utf8");
const TOKENIZER = Buffer.from(JSON.stringify({ version: "1.0", model: { vocab: {} } }), "utf8");

// The addresses a signed manifest would carry for this model: taken once,
// from the bytes as published, by the party doing the witnessing.
const WITNESSED = tensorAddresses(WEIGHTS);

const FILES = [
  { path: "config.json", bytes: CONFIG },
  { path: "model.safetensors", bytes: WEIGHTS },
  { path: "tokenizer.json", bytes: TOKENIZER },
];
// Deliberately smaller than the weights file, which is what a real torrent
// does too: 256 KiB to 4 MiB pieces across files of wildly different sizes.
const PIECE = 4096;

console.log(`     model: ${TENSORS.length} tensors, ${WEIGHTS.length} bytes of safetensors`);
console.log(`     torrent: ${FILES.length} files, ${PIECE}-byte pieces\n`);

// ------------------------------------------------- A. what broke, exactly
const original = makeTorrent("test-model", FILES, PIECE);
const torrent = readTorrent(original.bytes, original.infohash);

check("the torrent is well formed and verifies against its own infohash", () => {
  assert.equal(torrent.infohash, original.infohash);
  assert.deepEqual(badPieces(torrent, original.all), [], "an untouched torrent must have no bad pieces");
  assert.deepEqual(badTensors(WITNESSED, WEIGHTS), [], "untouched weights must match every address");
});

// One byte, in the middle of the third tensor.
const target = TENSORS[2];
const header = readSafetensors(WEIGHTS).find((t) => t.name === target.name);
const tampered = Buffer.from(WEIGHTS);
const flipAt = header.begin + Math.floor((header.end - header.begin) / 2);
tampered[flipAt] ^= 0x01;
const tamperedAll = Buffer.concat([CONFIG, tampered, TOKENIZER]);

check("a flipped bit is caught by both schemes", () => {
  assert.ok(badPieces(torrent, tamperedAll).length > 0, "the torrent must notice");
  assert.ok(badTensors(WITNESSED, tampered).length > 0, "the addresses must notice");
});

// The difference is what each one can say about it.
check("only the tensor address says which tensor broke", () => {
  const bad = badTensors(WITNESSED, tampered);
  assert.deepEqual(bad, [target.name], `expected exactly ${target.name}, got ${JSON.stringify(bad)}`);

  const pieces = badPieces(torrent, tamperedAll);
  assert.equal(pieces.length, 1, "one byte should spoil exactly one piece");

  // What the torrent can say is "piece N is wrong", which is a byte range of
  // everything concatenated. Whether that range happens to sit inside one
  // tensor is an accident of sizes; what is never true is that the range IS a
  // tensor. Going from the piece to the tensor needs the safetensors header,
  // which is layout the torrent does not carry and cannot check.
  const weightsFrom = CONFIG.length;
  const layout = readSafetensors(WEIGHTS);
  const spanOf = (i) => {
    const from = i * torrent.pieceLength;
    const to = from + torrent.pieceLength;
    return layout.filter((h) => weightsFrom + h.begin < to && weightsFrom + h.end > from);
  };
  const from = pieces[0] * torrent.pieceLength;
  const covered = spanOf(pieces[0]);
  const exact = layout.some((h) => weightsFrom + h.begin === from && h.end - h.begin === torrent.pieceLength);
  assert.ok(!exact, "a piece boundary must not be assumed to coincide with a tensor");

  // And in general one bad piece implicates several tensors: across this
  // torrent, some pieces cover more than one.
  const multi = [...Array(torrent.pieceCount).keys()].filter((i) => spanOf(i).length > 1);
  assert.ok(multi.length > 0,
    "at least one piece must cover more than one tensor, or the layout is too neat to be a fair test");
  console.log(`     torrent: piece ${pieces[0]} is wrong - a ${torrent.pieceLength}-byte range covering ${covered.length} tensor(s)`);
  console.log(`     ${multi.length} of ${torrent.pieceCount} pieces cover more than one tensor, so a piece cannot name one`);
  console.log(`     addresses: 1 tensor named outright - ${bad[0]}`);
});

check("a piece can straddle two files, so it cannot even name a file", () => {
  const weightsFile = torrent.files.find((f) => f.path.endsWith("model.safetensors"));
  const shared = piecesOf(torrent, weightsFile).filter((i) => {
    const from = i * torrent.pieceLength;
    const to = from + torrent.pieceLength;
    return torrent.files.filter((f) => f.offset < to && f.offset + f.length > from).length > 1;
  });
  assert.ok(shared.length > 0, "with these sizes at least one piece must cover two files");
  console.log(`     ${shared.length} piece(s) cover more than one file`);
});

// ------------------------------------------------------- B. repackaging
check("repackaging changes every torrent address and no tensor address", () => {
  const withReadme = makeTorrent("test-model", [...FILES, { path: "README.md", bytes: Buffer.from("# Test model\n") }], PIECE);
  const biggerPieces = makeTorrent("test-model", FILES, PIECE * 4);
  const renamed = makeTorrent("test-model-v2", FILES, PIECE);

  for (const [what, t] of [["a file added", withReadme], ["the piece length changed", biggerPieces], ["the torrent renamed", renamed]]) {
    assert.notEqual(t.infohash, original.infohash, `${what} must change the infohash`);
  }
  // The weights are byte-identical in all of them, so every address holds.
  assert.deepEqual(badTensors(WITNESSED, WEIGHTS), [],
    "the same weights must keep the same addresses however they are packaged");
  console.log(`     3 repackagings, 3 different infohashes, 0 changed tensor addresses`);
});

// --------------------------------------------------------- C. substitution
// The claim this is really testing: a torrent commits to the bytes its
// publisher chose, so "every checksum passed" is a statement about delivery
// and never about which model was delivered.
check("a torrent of the wrong weights verifies perfectly, and the addresses refuse it", () => {
  const other = safetensors([
    { name: "encoder.embed.weight", bytes: tensorBytes(101, 4096) },
    { name: "encoder.layer.0.attn.q", bytes: tensorBytes(102, 8192) },
    { name: "encoder.layer.0.attn.k", bytes: tensorBytes(103, 8192) },
    { name: "pooler.dense.bias", bytes: tensorBytes(109, 1536) },
  ]);
  const swapped = [{ path: "config.json", bytes: CONFIG }, { path: "model.safetensors", bytes: other }, { path: "tokenizer.json", bytes: TOKENIZER }];
  const fake = makeTorrent("test-model", swapped, PIECE);
  const read = readTorrent(fake.bytes, fake.infohash);

  // Internally flawless: the infohash is its own, every piece matches.
  assert.equal(read.infohash, fake.infohash);
  assert.deepEqual(badPieces(read, fake.all), [],
    "the substituted torrent is self-consistent, which is the whole point");

  // Same tensor names, same shapes, same file size - and different bytes.
  assert.equal(other.length, WEIGHTS.length, "the substitute is the same size, so size tells you nothing");
  const bad = badTensors(WITNESSED, other);
  assert.equal(bad.length, TENSORS.length, "every tensor must be refused");
  console.log(`     torrent: 0 bad pieces of ${read.pieceCount}. addresses: ${bad.length} of ${TENSORS.length} tensors refused`);
});

// --------------------------------------------------------- D. duplication
check("two models that share a tensor share its address", () => {
  // A different model that happens to reuse one tensor, as a fine-tune or a
  // sibling architecture does.
  const sibling = safetensors([
    { name: "embeddings.word", bytes: tensorBytes(77, 2048) },
    { name: "pooler.dense.bias", bytes: TENSORS[3].bytes },
  ]);
  const a = tensorAddresses(WEIGHTS);
  const b = tensorAddresses(sibling);
  const shared = [...b].filter(([, address]) => [...a.values()].includes(address));
  assert.equal(shared.length, 1, "exactly the reused tensor should be shared");
  assert.equal(shared[0][1], a.get("pooler.dense.bias"), "and it should be the same address");

  // The torrents of the two models share nothing a reader could act on.
  const siblingTorrent = makeTorrent("sibling", [{ path: "model.safetensors", bytes: sibling }], PIECE);
  assert.notEqual(siblingTorrent.infohash, original.infohash);
  console.log(`     ${shared[0][1].slice(0, 26)}… held by both models, ${TENSORS[3].bytes.length} bytes`);
});

// -------------------------------------------------------------- E. live
if (live) {
  const BASE = "https://hologram-technologies.github.io/hub/data/manifests/";
  const HF = "https://huggingface.co";
  const index = await (await fetch(BASE + "index.json")).json();
  const smallest = index.manifests.slice().sort((x, y) => x.tensors - y.tensors)[0];
  const manifest = await (await fetch(`${BASE}${smallest.repo}.json`)).json();
  const file = manifest.tensors[0].file;
  const url = `${HF}/${smallest.repo}/resolve/${manifest.revision}/${file}`;
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());

  check(`the published addresses for ${smallest.repo} still match the bytes Hugging Face serves`, () => {
    const found = tensorAddresses(bytes);
    const expected = manifest.tensors.filter((t) => t.file === file);
    const wrong = expected.filter((t) => found.get(t.name) !== t.blake3);
    assert.deepEqual(wrong.map((t) => t.name), [],
      `${wrong.length} of ${expected.length} tensors did not match`);
    console.log(`     ${expected.length} tensors recomputed from ${bytes.length} bytes, all matching`);
  });
}

console.log();
if (failed) {
  console.log(`tests/uor/addressing: ${failed} check(s) failed`);
  process.exit(1);
}
console.log("tests/uor/addressing: all checks passed");
