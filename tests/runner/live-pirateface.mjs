// A live check that the swarm path works end to end, against Pirate Face.
//
//   node tests/runner/live-pirateface.mjs [repo] [pieces]
//
// It needs the network and real peers, so it is not part of `just vv`. It
// fetches one repository's torrent, recomputes the infohash from the metadata
// rather than believing it, asks the tracker for peers, and downloads the
// first few pieces over the peer wire protocol. Every piece is checked against
// the hash the infohash committed to; a piece that does not match is never
// counted.
//
// Downloading a whole weight file would be hundreds of megabytes, so this
// takes a few pieces. What it establishes is the part that could be wrong:
// that the metadata checks out, that peers answer, and that the bytes they
// send hash to what the torrent said they would.
import assert from "node:assert/strict";
import { lookup, fetchTorrent } from "../../runner/pirateface.mjs";
import { announce, fetchPieces, peerId } from "../../runner/swarm.mjs";
import { pieceSize } from "../../runner/torrent.mjs";

const repo = process.argv[2] ?? "openai-community/gpt2";
const want = Number(process.argv[3] ?? 2);

const found = await lookup(repo);
if (!found) {
  console.log(`live-pirateface: ${repo} has no torrent listed; nothing to check`);
  process.exit(0);
}
console.log(`live-pirateface: ${repo} at ${found.revision?.slice(0, 12)}, ${found.seeders} seeders, infohash ${found.infohash}`);
console.log(`live-pirateface: ${found.addresses.size} files carry a SHA-256, trackers ${found.trackers.join(" ")}`);

const torrent = await fetchTorrent(found);
assert.equal(torrent.infohash, found.infohash);
console.log(`live-pirateface: the info dictionary hashes to the infohash it was fetched as`);
console.log(`live-pirateface: ${torrent.files.length} files, ${torrent.pieceCount} pieces of ${torrent.pieceLength} bytes, ${torrent.totalLength} bytes in all`);

const http = found.trackers.filter((t) => /^https?:\/\//.test(t));
if (!http.length) {
  console.log("live-pirateface: no HTTP tracker, and this runner speaks no UDP tracker or DHT");
  process.exit(0);
}
let peers = [];
for (const tracker of http) {
  try {
    const got = await announce({ tracker, infohashBytes: torrent.infohashBytes, id: peerId(), left: torrent.totalLength });
    console.log(`live-pirateface: ${tracker} named ${got.length} peers`);
    peers = peers.concat(got);
  } catch (error) {
    console.log(`live-pirateface: ${tracker} refused: ${error.message}`);
  }
}
if (!peers.length) {
  console.log("live-pirateface: no peers were named, so no bytes can be checked now");
  process.exit(0);
}

const wanted = [...Array(Math.min(want, torrent.pieceCount)).keys()];
const expected = wanted.reduce((a, i) => a + pieceSize(torrent, i), 0);
let got = 0;
const started = Date.now();
await fetchPieces(torrent, wanted, peers, {
  deadlineMs: 5 * 60000,
  onNote: (line) => console.log(`live-pirateface: ${line}`),
  onPiece: (index, bytes) => { got += bytes.length; console.log(`live-pirateface: piece ${index} verified, ${bytes.length} bytes`); },
});
assert.equal(got, expected);
const seconds = (Date.now() - started) / 1000;
console.log(`live-pirateface: ${got} bytes from the swarm, every piece matching the infohash's commitment, in ${seconds.toFixed(1)} s`);
