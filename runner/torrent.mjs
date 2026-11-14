// A torrent, read and checked rather than believed.
//
// The one thing that makes BitTorrent worth using here is that the infohash
// commits to every piece hash, so a client checks each piece it receives
// against a commitment it can recompute. That property is only worth anything
// if the client recomputes the infohash from the metadata it was handed. We
// fetch `.torrent` bytes from a host we do not trust; `readTorrent` hashes the
// `info` dictionary's own bytes and refuses the file unless the result is the
// infohash the magnet named. After that, the piece hashes are the host's claim
// no longer - they are what the swarm agreed on.
//
// BitTorrent v1 only. A `urn:btmh:` (v2) magnet is reported as unsupported
// rather than silently treated as v1, because a v2 infohash commits through a
// different tree and checking it against v1 piece hashes would prove nothing.
import { createHash } from "node:crypto";
import { decode, rangeOf } from "./bencode.mjs";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// A magnet's base32 infohash, for the trackers that still hand them out.
function fromBase32(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const character of text.toUpperCase()) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error(`"${character}" is not base32`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return Buffer.from(out).toString("hex");
}

// What a magnet link says: the v1 infohash, the trackers to ask, any web
// seeds, and the display name. Nothing here is trusted; the infohash is the
// only field that can be checked, and everything else is a hint about where to
// look.
export function readMagnet(uri) {
  if (!uri.startsWith("magnet:?")) throw new Error("not a magnet link");
  const parameters = new URLSearchParams(uri.slice("magnet:?".length));
  const topics = parameters.getAll("xt");
  const v1 = topics.find((t) => t.startsWith("urn:btih:"));
  if (!v1) {
    const v2 = topics.find((t) => t.startsWith("urn:btmh:"));
    throw new Error(v2 ? "this magnet is BitTorrent v2 only, which this runner does not read" : "this magnet names no infohash");
  }
  const raw = v1.slice("urn:btih:".length);
  const infohash = raw.length === 40 ? raw.toLowerCase() : fromBase32(raw);
  if (!/^[0-9a-f]{40}$/.test(infohash)) throw new Error(`"${raw}" is not an infohash`);
  return {
    infohash,
    trackers: parameters.getAll("tr"),
    webSeeds: parameters.getAll("ws"),
    name: parameters.get("dn") ?? null,
  };
}

// Reads `.torrent` bytes and refuses them unless the `info` dictionary hashes
// to `expectedInfohash`. The returned pieces are then a commitment, not a
// claim.
export function readTorrent(bytes, expectedInfohash) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const top = decode(buffer);
  const range = rangeOf(top, "info");
  if (!range) throw new Error("this torrent has no info dictionary");
  const infohash = createHash("sha1").update(buffer.subarray(range[0], range[1])).digest("hex");
  if (expectedInfohash && infohash !== expectedInfohash.toLowerCase()) {
    throw new Error(`the torrent's info dictionary hashes to ${infohash}, not to the ${expectedInfohash} it was fetched as`);
  }
  const info = top.info;
  const pieceLength = info["piece length"];
  const pieces = info.pieces;
  if (!Buffer.isBuffer(pieces) || pieces.length % 20 !== 0) throw new Error("the piece hashes are not a run of SHA-1 digests");
  if (!Number.isInteger(pieceLength) || pieceLength <= 0) throw new Error("the piece length is not a positive integer");
  const name = info.name.toString("utf8");

  const files = [];
  let offset = 0;
  if (info.files) {
    for (const entry of info.files) {
      const path = entry.path.map((p) => p.toString("utf8")).join("/");
      files.push({ path, length: entry.length, offset });
      offset += entry.length;
    }
  } else {
    files.push({ path: name, length: info.length, offset: 0 });
    offset = info.length;
  }
  const totalLength = offset;
  const pieceCount = Math.ceil(totalLength / pieceLength);
  if (pieceCount !== pieces.length / 20) {
    throw new Error(`the torrent claims ${pieces.length / 20} pieces but its files need ${pieceCount}`);
  }
  return {
    infohash,
    infohashBytes: Buffer.from(infohash, "hex"),
    name,
    pieceLength,
    pieceCount,
    pieceHash: (index) => pieces.subarray(index * 20, index * 20 + 20),
    files,
    totalLength,
    private: info.private === 1,
  };
}

// The file a repository path names, inside a torrent that may or may not put
// everything under a directory of its own. Both spellings are tried so a
// torrent built either way resolves, and nothing else is guessed.
export function findFile(torrent, path) {
  const wanted = path.replace(/^\/+/, "");
  return torrent.files.find((f) => f.path === wanted)
    ?? torrent.files.find((f) => f.path === `${torrent.name}/${wanted}`)
    ?? torrent.files.find((f) => f.path.split("/").slice(1).join("/") === wanted)
    ?? null;
}

// Every piece that holds a byte of this file. A piece at either end also holds
// bytes of its neighbours; it is still downloaded and still checked whole,
// because the commitment is over the piece, not over the file.
export function piecesOf(torrent, file) {
  const first = Math.floor(file.offset / torrent.pieceLength);
  const last = Math.floor((file.offset + file.length - 1) / torrent.pieceLength);
  const out = [];
  for (let index = first; index <= last; index += 1) out.push(index);
  return out;
}

export function pieceSize(torrent, index) {
  const start = index * torrent.pieceLength;
  return Math.min(torrent.pieceLength, torrent.totalLength - start);
}
