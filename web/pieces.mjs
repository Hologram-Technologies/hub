// Verified, serverless fetching of a `blake3:` address in 1 MiB pieces.
//
// Why: a model's bytes can come from any host that answers a Range request,
// and none of them has to be trusted, because every piece is checked against
// the address before it is used. Hashing is not the bottleneck: one worker
// hashes about 1.2 GB/s (BLAKE3 with WebAssembly SIMD), and several run at
// once, so the network sets the speed.
//
// How: a `blake3:` address is the root of BLAKE3's tree over 1 KiB chunks. Its
// 1 MiB pieces are complete subtrees, so each piece's chaining value is
// computed on its own, on any worker, and a piece table (one 32-byte value
// per piece, `HPTREE01` as hologram-space encodes it) folds back to the
// address. With a table, each piece is checked as it arrives. Without one,
// the pieces' own values are folded and checked against the address at the
// end, so nothing is delivered before the whole has been checked.
//
// What decides: `pieceDecision`, the kernel's `Pieces::pieceDecision`
// (app/src/Pieces.lex.tex), transcribed. Lean proves four things of the
// kernel's rule for every input (HK-39 to HK-42): bytes are delivered only
// when the table folds to the address and the bytes match their entry; a
// stored piece is reused only when it matches; a matching stored piece is
// always reused; and a piece is refused only when no source is left. This
// file is held to the same rule by tests/pieces/fetch.mjs, over every input.

import { PIECE_LEN, instantiate } from "./piece-hash.mjs";

export { PIECE_LEN };

export const ANSWER = Object.freeze({ reuse: 30, deliver: 31, retry: 32, refuse: 33 });

// The kernel's `pieceDecision`, transcribed: the table first, then the stored
// copy, then the received bytes; otherwise another source while one is left.
export function pieceDecision({ tableHolds, held, cachedMatches, observedMatches, lengthMatches, sourcesLeft }) {
  const fallback = sourcesLeft > 0 ? ANSWER.retry : ANSWER.refuse;
  if (!tableHolds) return fallback;
  if (held && cachedMatches) return ANSWER.reuse;
  if (observedMatches && lengthMatches) return ANSWER.deliver;
  return fallback;
}

export function pieceCount(length) {
  return length === 0 ? 1 : Math.ceil(length / PIECE_LEN);
}

export function pieceLength(length, index) {
  return Math.min(PIECE_LEN, length - index * PIECE_LEN);
}

const equal = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function digestOf(kappa) {
  if (typeof kappa !== "string" || !/^blake3:[0-9a-f]{64}$/.test(kappa)) {
    throw new TypeError(`not a blake3: address: ${kappa}`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(kappa.slice(7 + 2 * i, 9 + 2 * i), 16);
  return out;
}

const MAGIC = new TextEncoder().encode("HPTREE01");

// A piece table as hologram-space's `PieceTree::encode` writes it: the magic,
// the blob's length and the piece length (u64 little-endian), then one 32-byte
// chaining value per piece.
export function decodeTable(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 24 || !equal(b.subarray(0, 8), MAGIC)) throw new Error("not a piece table");
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const length = Number(view.getBigUint64(8, true));
  if (view.getBigUint64(16, true) !== BigInt(PIECE_LEN)) throw new Error("a piece table of another piece length");
  const n = pieceCount(length);
  if (b.length !== 24 + 32 * n) throw new Error("a piece table of the wrong size");
  const cvs = [];
  for (let i = 0; i < n; i++) cvs.push(b.slice(24 + 32 * i, 56 + 32 * i));
  return { length, cvs };
}

export function encodeTable({ length, cvs }) {
  const out = new Uint8Array(24 + 32 * cvs.length);
  out.set(MAGIC, 0);
  const view = new DataView(out.buffer);
  view.setBigUint64(8, BigInt(length), true);
  view.setBigUint64(16, BigInt(PIECE_LEN), true);
  cvs.forEach((cv, i) => out.set(cv, 24 + 32 * i));
  return out;
}

// BLAKE3's fold over pieces: split at the largest power of two below the
// count. A one-piece table's only entry is already the root hash.
export function foldTable(cvs, parent) {
  const fold = (lo, hi, root) => {
    if (hi - lo === 1) return cvs[lo];
    const left = 2 ** Math.floor(Math.log2(hi - lo - 1));
    return parent(fold(lo, lo + left, false), fold(lo + left, hi, false), root);
  };
  return fold(0, cvs.length, true);
}

// Workers that hash pieces, each with its own hasher. `makeWorker` returns
// something with postMessage and onmessage (a Web Worker, or an adapter).
// With no workers the hashing runs here, on `local`.
export function createPool({ size, makeWorker, local }) {
  const idle = [];
  const queue = [];
  const waiting = new Map();
  let next = 0;
  for (let i = 0; i < size; i++) {
    const worker = makeWorker();
    worker.onmessage = ({ data }) => {
      const job = waiting.get(data.id);
      waiting.delete(data.id);
      idle.push(worker);
      pump();
      if (data.error) job.reject(new Error(data.error));
      else job.resolve({ cv: new Uint8Array(data.cv), bytes: new Uint8Array(data.bytes, 0, job.length) });
    };
    idle.push(worker);
  }
  const pump = () => {
    while (idle.length && queue.length) {
      const job = queue.shift();
      const worker = idle.pop();
      waiting.set(job.id, job);
      // The buffer is transferred, not copied: a piece is owned by one side at
      // a time, and it comes back with its chaining value.
      const buffer = job.bytes.byteOffset === 0 && job.bytes.byteLength === job.bytes.buffer.byteLength
        ? job.bytes.buffer
        : job.bytes.slice().buffer;
      worker.postMessage({ id: job.id, bytes: buffer, length: job.bytes.length, index: job.index, root: job.root }, [buffer]);
    }
  };
  return {
    size,
    // The chaining value of `bytes` as piece `index`, and the bytes back.
    hash(bytes, index, root) {
      if (!size) return Promise.resolve({ cv: local.piece(bytes, index, root), bytes });
      return new Promise((resolve, reject) => {
        queue.push({ id: next++, bytes, length: bytes.length, index, root, resolve, reject });
        pump();
      });
    },
    terminate() {
      for (const w of idle) w.terminate?.();
    },
  };
}

// A pool of Web Workers, one per core the browser reports, at most `max`.
export async function browserPool({ max = 16 } = {}) {
  const local = await instantiate(fetch(new URL("./piece-hash.wasm", import.meta.url)));
  const size = Math.max(1, Math.min(max, (globalThis.navigator?.hardwareConcurrency ?? 4) - 1));
  return {
    ...createPool({ size, makeWorker: () => new Worker(new URL("./piece-worker.mjs", import.meta.url), { type: "module" }), local }),
    parent: local.parent,
  };
}

// The bytes [begin, end) of a source, by one Range request. A source is
// { url, offset }: where the address's first byte sits in that URL's bytes.
export async function fetchRange(source, begin, end, fetchImpl = fetch) {
  if (end === begin) return new Uint8Array(0);
  const from = source.offset + begin;
  const response = await fetchImpl(source.url, { headers: { Range: `bytes=${from}-${source.offset + end - 1}` } });
  // A host that ignores Range answers 200 with the whole file, and a weight
  // file is gigabytes, so anything but a partial answer is no answer: its
  // body is cancelled, never read.
  if (response.status !== 206) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`${source.url}: ${response.status} for a range`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export class Refused extends Error {
  constructor(message, piece) {
    super(message);
    this.piece = piece;
  }
}

// Fetch `length` bytes addressed by `kappa` from `sources`, in pieces, each
// used only when `pieceDecision` says reuse or deliver.
//
// `tables`: candidate piece tables (decoded), from any host; the first whose
// root folds to the address is used, and the rest are the sources left.
// Without one, the pieces' own chaining values are folded at the end.
// `store`: optional { get(kappa, index), put(kappa, index, bytes) }.
// `onPiece(index, bytes)`: called as each piece is delivered or reused.
// `inflight`: how many ranges are requested at once; `span`: how many
// pieces one range covers, at most (8 MiB by default).
// `observed`: filled with each used piece's chaining value as hashed here, so
// a caller can fold them into the BLAKE3 of the bytes it got and have its own
// judge rule on that (the hub's page asks the kernel).
export async function verifiedFetch({ kappa, length, sources, tables = [], store, pool, inflight = 8, span = 8, onPiece, fetchImpl = fetch, stats = {}, observed = [] }) {
  const digest = digestOf(kappa);
  const n = pieceCount(length);
  const root = n === 1;
  stats.reused = stats.reused ?? 0;
  stats.delivered = stats.delivered ?? 0;
  stats.retried = stats.retried ?? 0;
  stats.fetched = stats.fetched ?? 0;
  const out = new Uint8Array(length);

  // The table: the first candidate whose root folds to the address. Each one
  // that does not is a source spent, as the kernel's fallback treats it.
  let table = null;
  for (let t = 0; t < tables.length && !table; t++) {
    const candidate = tables[t];
    const holds = candidate.length === length && candidate.cvs.length === n && equal(foldTable(candidate.cvs, pool.parent), digest);
    const decision = pieceDecision({ tableHolds: holds, held: false, cachedMatches: false, observedMatches: false, lengthMatches: false, sourcesLeft: tables.length - t - 1 });
    if (holds) table = candidate;
    else if (decision === ANSWER.refuse) throw new Refused(`no piece table folds to ${kappa}`, null);
  }

  if (table) {
    // A stored copy, checked as fresh bytes are (HK-40) and used only on a
    // reuse answer (HK-41).
    const reused = async (index) => {
      const held = store ? await store.get(kappa, index) : null;
      if (!held) return false;
      // The store owns its copy; the pool transfers what it hashes, so it
      // gets one of its own.
      const { cv, bytes } = await pool.hash(held.slice(), index, root);
      const d = pieceDecision({ tableHolds: true, held: true, cachedMatches: equal(cv, table.cvs[index]), observedMatches: false, lengthMatches: false, sourcesLeft: sources.length });
      if (d !== ANSWER.reuse) return false;
      observed[index] = cv;
      out.set(bytes, index * PIECE_LEN);
      stats.reused += 1;
      onPiece?.(index, bytes);
      return true;
    };
    // One piece, from source `s0` on: `first` is what `s0` already sent for
    // it (null when that request failed), so only a piece that fails is
    // requested again, alone, from the next source.
    const settle = async (index, s0, first) => {
      const want = pieceLength(length, index);
      for (let s = s0; s < sources.length; s++) {
        let received = s === s0 ? first : undefined;
        if (received === undefined) {
          try {
            received = await fetchRange(sources[s], index * PIECE_LEN, index * PIECE_LEN + want, fetchImpl);
            stats.fetched += received.length;
          } catch {
            received = null;
          }
        }
        let observedMatches = false;
        let lengthMatches = false;
        let bytes = received;
        let cv = null;
        if (received) {
          lengthMatches = received.length === want;
          if (lengthMatches) {
            const hashed = await pool.hash(received, index, root);
            cv = hashed.cv;
            observedMatches = equal(cv, table.cvs[index]);
            bytes = hashed.bytes;
          }
        }
        const d = pieceDecision({ tableHolds: true, held: false, cachedMatches: false, observedMatches, lengthMatches, sourcesLeft: sources.length - s - 1 });
        if (d === ANSWER.deliver) {
          observed[index] = cv;
          out.set(bytes, index * PIECE_LEN);
          stats.delivered += 1;
          await store?.put(kappa, index, bytes);
          onPiece?.(index, bytes);
          return;
        }
        if (d === ANSWER.refuse) throw new Refused(`piece ${index} of ${kappa}: no source sent bytes that match the table`, index);
        stats.retried += 1;
      }
      throw new Refused(`piece ${index} of ${kappa}: no source`, index);
    };
    // Groups of `span` pieces: the ones not reused are requested from the
    // first source as one range per contiguous run, then each piece is hashed
    // and decided on its own. Fewer, larger requests are what keep the
    // network busy; the rule is still applied piece by piece.
    let cursor = 0;
    const lane = async () => {
      while (cursor < n) {
        const first = cursor;
        // Piece 0 goes alone, so the first verified bytes arrive after one
        // piece rather than after a whole group; every later group is large.
        const last = Math.min(n, first === 0 ? 1 : first + span);
        cursor = last;
        const need = [];
        for (let i = first; i < last; i++) if (!(await reused(i))) need.push(i);
        for (let r = 0; r < need.length; ) {
          let e = r;
          while (e + 1 < need.length && need[e + 1] === need[e] + 1) e += 1;
          const from = need[r];
          const to = need[e];
          const end = to * PIECE_LEN + pieceLength(length, to);
          let run = null;
          if (sources.length) {
            try {
              run = await fetchRange(sources[0], from * PIECE_LEN, end, fetchImpl);
              stats.fetched += run.length;
            } catch {
              run = null;
            }
          }
          await Promise.all(
            need.slice(r, e + 1).map((index) => {
              const at = (index - from) * PIECE_LEN;
              // Each piece gets its own buffer, since the pool transfers it.
              const piece = run ? run.slice(at, Math.min(run.length, at + pieceLength(length, index))) : null;
              return settle(index, 0, piece);
            }),
          );
          r = e + 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(inflight, Math.ceil(n / span)) }, lane));
    return out;
  }

  // No table: take every piece from one source, fold the pieces' own values,
  // and deliver only when the fold is the address.
  for (let s = 0; s < sources.length; s++) {
    const cvs = new Array(n);
    let cursor = 0;
    let failed = false;
    const lane = async () => {
      while (cursor < n && !failed) {
        const index = cursor++;
        const want = pieceLength(length, index);
        try {
          const received = await fetchRange(sources[s], index * PIECE_LEN, index * PIECE_LEN + want, fetchImpl);
          stats.fetched += received.length;
          if (received.length !== want) {
            failed = true;
            return;
          }
          const { cv, bytes } = await pool.hash(received, index, root);
          cvs[index] = cv;
          out.set(bytes, index * PIECE_LEN);
        } catch {
          failed = true;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(inflight, n) }, lane));
    const holds = !failed && equal(root ? cvs[0] : foldTable(cvs, pool.parent), digest);
    const d = pieceDecision({ tableHolds: holds, held: false, cachedMatches: false, observedMatches: holds, lengthMatches: holds, sourcesLeft: sources.length - s - 1 });
    if (d === ANSWER.deliver) {
      cvs.forEach((cv, i) => (observed[i] = cv));
      for (let i = 0; i < n; i++) {
        const bytes = out.subarray(i * PIECE_LEN, i * PIECE_LEN + pieceLength(length, i));
        stats.delivered += 1;
        await store?.put(kappa, i, bytes.slice());
        onPiece?.(i, bytes);
      }
      return out;
    }
    if (d === ANSWER.refuse) throw new Refused(`no source sent bytes that fold to ${kappa}`, null);
    stats.retried += 1;
  }
  throw new Refused(`no source for ${kappa}`, null);
}

// A store in the browser's origin-private file system: one file per piece,
// named by the address and the piece. Read back through the same check as
// fresh bytes (HK-40), so a changed file is fetched again, never used.
export async function opfsStore() {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("pieces", { create: true });
  const name = (kappa, index) => `${kappa.slice(7)}.${index}`;
  return {
    async get(kappa, index) {
      try {
        const file = await (await dir.getFileHandle(name(kappa, index))).getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch {
        return null;
      }
    },
    async put(kappa, index, bytes) {
      try {
        const writable = await (await dir.getFileHandle(name(kappa, index), { create: true })).createWritable();
        await writable.write(bytes);
        await writable.close();
      } catch {
        // A full or unavailable store loses a cache entry, never a piece.
      }
    },
  };
}
