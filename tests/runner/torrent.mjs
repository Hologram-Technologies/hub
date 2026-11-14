// The one property BitTorrent adds here is that the infohash commits to every
// piece hash. It is worth nothing unless the client recomputes it, so this
// checks that `readTorrent` refuses metadata that does not hash to the
// infohash it was fetched as, and that a single flipped byte in a piece hash
// is enough to make it refuse.
//
//   node tests/runner/torrent.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { decode } from "../../runner/bencode.mjs";
import { findFile, piecesOf, pieceSize, readMagnet, readTorrent } from "../../runner/torrent.mjs";

let checks = 0;
const ok = (what) => { checks += 1; console.log(`  ok  ${what}`); };

// A bencode encoder, for this test only: the runner never writes bencode.
function encode(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  if (typeof value === "string") return encode(Buffer.from(value, "utf8"));
  if (typeof value === "number") return Buffer.from(`i${value}e`);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from("l"), ...value.map(encode), Buffer.from("e")]);
  const keys = Object.keys(value).sort();
  return Buffer.concat([Buffer.from("d"), ...keys.flatMap((k) => [encode(k), encode(value[k])]), Buffer.from("e")]);
}

const PIECE = 32;
const files = [
  { path: ["config.json"], length: 40 },
  { path: ["model.safetensors"], length: 50 },
];
const total = files.reduce((a, f) => a + f.length, 0);
const data = Buffer.alloc(total);
for (let i = 0; i < total; i += 1) data[i] = (i * 7) % 251;
const pieceHashes = [];
for (let at = 0; at < total; at += PIECE) {
  pieceHashes.push(createHash("sha1").update(data.subarray(at, Math.min(at + PIECE, total))).digest());
}
const info = { name: "gpt2", "piece length": PIECE, pieces: Buffer.concat(pieceHashes), files };
const torrentBytes = encode({ announce: "http://tracker.example/announce", info });
const infohash = createHash("sha1").update(encode(info)).digest("hex");

// The decoder must report where `info` sat, or the infohash would be taken
// over bytes we re-serialised rather than the bytes that arrived.
const top = decode(torrentBytes);
assert.equal(Object.keys(top.info).length, 4);
ok("the torrent decodes");

const torrent = readTorrent(torrentBytes, infohash);
assert.equal(torrent.infohash, infohash);
assert.equal(torrent.pieceCount, pieceHashes.length);
assert.equal(torrent.totalLength, total);
ok(`the info dictionary hashes to the infohash it was fetched as (${infohash.slice(0, 12)})`);

assert.throws(() => readTorrent(torrentBytes, "0".repeat(40)), /hashes to .*, not to the 0{40}/);
ok("metadata that does not hash to the infohash asked for is refused");

// The planted defect: one byte of one piece hash. The torrent still parses,
// still describes the same files, and is still refused, because the infohash
// is over the whole info dictionary.
const tampered = Buffer.from(torrentBytes);
const at = tampered.indexOf(pieceHashes[0]);
assert.ok(at > 0, "the piece hashes are in the bytes");
tampered[at] ^= 0x01;
assert.throws(() => readTorrent(tampered, infohash), /hashes to/);
ok("one flipped byte in a piece hash makes the torrent refuse to load");
// ... and with no expectation to check against, the tampered file loads with a
// different infohash, which is exactly why the expectation is not optional.
assert.notEqual(readTorrent(tampered, null).infohash, infohash);
ok("the tampered torrent has a different infohash");

const config = findFile(torrent, "config.json");
assert.equal(config.length, 40);
assert.equal(config.offset, 0);
const weights = findFile(torrent, "model.safetensors");
assert.equal(weights.offset, 40);
assert.equal(findFile(torrent, "missing.json"), null);
ok("a file is found by its repository path, and a path the torrent lacks finds nothing");

// Some torrents repeat the repository name inside each path. A caller still
// asks for the repository's own path, and gets the same file.
const nested = { ...info, files: files.map((f) => ({ ...f, path: ["gpt2", ...f.path] })) };
const nestedTorrent = readTorrent(encode({ info: nested }), createHash("sha1").update(encode(nested)).digest("hex"));
assert.equal(findFile(nestedTorrent, "config.json").path, "gpt2/config.json");
ok("a torrent that repeats the repository name in each path still resolves");

// config.json is 40 bytes over 32-byte pieces, so it needs pieces 0 and 1, and
// piece 1 also holds the first bytes of the weights.
assert.deepEqual(piecesOf(torrent, config), [0, 1]);
assert.deepEqual(piecesOf(torrent, weights), [1, 2]);
assert.equal(pieceSize(torrent, 0), 32);
assert.equal(pieceSize(torrent, torrent.pieceCount - 1), total - (torrent.pieceCount - 1) * PIECE);
ok("a file's pieces include the ones it shares with its neighbours");

const magnet = readMagnet(`magnet:?xt=urn:btih:${infohash}&tr=${encodeURIComponent("http://tracker.example/announce")}&ws=${encodeURIComponent("https://example/ws/")}&dn=gpt2`);
assert.equal(magnet.infohash, infohash);
assert.deepEqual(magnet.trackers, ["http://tracker.example/announce"]);
assert.deepEqual(magnet.webSeeds, ["https://example/ws/"]);
ok("a magnet's infohash, trackers and web seeds are read");

assert.throws(() => readMagnet("magnet:?xt=urn:btmh:1220abcd&dn=x"), /BitTorrent v2/);
ok("a v2-only magnet is refused rather than treated as v1");

console.log(`tests/runner/torrent: ${checks} checks passed`);
