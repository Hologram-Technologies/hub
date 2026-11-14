// Bencode, the encoding BitTorrent metadata and tracker answers use. Enough of
// it to read a `.torrent` and a tracker's reply, and to re-encode a dictionary
// byte for byte so an infohash can be recomputed rather than believed.
//
// The decoder reports where every value ended, because the infohash is the
// SHA-1 of the *bytes* of the `info` dictionary as they arrived, not of
// anything re-serialised. A torrent whose `info` we re-encoded might differ
// from the one the swarm agreed on, and then every piece hash would be checked
// against the wrong commitment.
//
// Byte strings stay Buffers. Keys become strings, because every key BitTorrent
// defines is ASCII.

const COLON = 0x3a;
const E = 0x65; // "e"
const I = 0x69; // "i"
const L = 0x6c; // "l"
const D = 0x64; // "d"
const ZERO = 0x30;
const NINE = 0x39;

class BencodeError extends Error {}

function digits(bytes, at) {
  let end = at;
  if (bytes[end] === 0x2d) end += 1; // a leading minus, for negative integers
  while (end < bytes.length && bytes[end] >= ZERO && bytes[end] <= NINE) end += 1;
  if (end === at) throw new BencodeError(`no number at ${at}`);
  return end;
}

// Returns [value, end]. `end` is one past the last byte this value occupies.
export function decodeAt(bytes, at = 0) {
  if (at >= bytes.length) throw new BencodeError(`ran out of bytes at ${at}`);
  const tag = bytes[at];
  if (tag === I) {
    const end = digits(bytes, at + 1);
    if (bytes[end] !== E) throw new BencodeError(`unterminated integer at ${at}`);
    return [Number(bytes.toString("ascii", at + 1, end)), end + 1];
  }
  if (tag === L) {
    const list = [];
    let pos = at + 1;
    while (bytes[pos] !== E) {
      if (pos >= bytes.length) throw new BencodeError(`unterminated list at ${at}`);
      const [value, end] = decodeAt(bytes, pos);
      list.push(value);
      pos = end;
    }
    return [list, pos + 1];
  }
  if (tag === D) {
    const map = {};
    let pos = at + 1;
    while (bytes[pos] !== E) {
      if (pos >= bytes.length) throw new BencodeError(`unterminated dictionary at ${at}`);
      const [key, afterKey] = decodeAt(bytes, pos);
      if (!Buffer.isBuffer(key)) throw new BencodeError(`dictionary key at ${pos} is not a string`);
      const [value, end] = decodeAt(bytes, afterKey);
      // The byte range matters for `info`, so every value carries one.
      map[key.toString("latin1")] = value;
      Object.defineProperty(map, `${key.toString("latin1")}@range`, {
        value: [afterKey, end], enumerable: false,
      });
      pos = end;
    }
    return [map, pos + 1];
  }
  if (tag >= ZERO && tag <= NINE) {
    const end = digits(bytes, at);
    if (bytes[end] !== COLON) throw new BencodeError(`unterminated string length at ${at}`);
    const length = Number(bytes.toString("ascii", at, end));
    const start = end + 1;
    if (start + length > bytes.length) throw new BencodeError(`string at ${at} runs past the end`);
    return [bytes.subarray(start, start + length), start + length];
  }
  throw new BencodeError(`byte 0x${tag.toString(16)} at ${at} starts no bencoded value`);
}

export function decode(bytes) {
  const [value, end] = decodeAt(bytes, 0);
  if (end !== bytes.length) throw new BencodeError(`${bytes.length - end} trailing bytes`);
  return value;
}

// The byte range a decoded dictionary's entry occupied in the original bytes,
// or null when the dictionary has no such key.
export function rangeOf(map, key) {
  const range = Object.getOwnPropertyDescriptor(map, `${key}@range`);
  return range ? range.value : null;
}
