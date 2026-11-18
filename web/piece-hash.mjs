// One instance of the piece hasher, `piece-hash.wasm`: the BLAKE3 chaining
// value of a 1 MiB piece of a `blake3:` address, and the parent rule that
// folds pieces back into the address. Built from `crates/piece-hash` (BLAKE3
// 1.8.7, `wasm32_simd`); it imports nothing and allocates nothing.
//
// It answers only "what does this piece hash to". Whether a piece may be used
// is `pieceDecision` in `web/pieces.mjs`, the kernel's rule.

export const PIECE_LEN = 1 << 20;
// BLAKE3 chunks are 1 KiB, so piece i starts at chunk i * 1024.
const CHUNKS_PER_PIECE = PIECE_LEN / 1024;
const TWO_32 = 2 ** 32;

// `source` is the module's bytes, or a Response for them, or a promise of
// either (such as `fetch(...)`).
export async function instantiate(pending) {
  const source = await pending;
  if (typeof Response !== "undefined" && source instanceof Response && !source.ok) {
    throw new Error(`piece-hash.wasm: ${source.status}`);
  }
  let instance;
  if (typeof Response !== "undefined" && source instanceof Response) {
    const bytes = await source.arrayBuffer();
    ({ instance } = await WebAssembly.instantiate(bytes));
  } else {
    ({ instance } = await WebAssembly.instantiate(source));
  }
  const e = instance.exports;
  const input = e.input();
  const cv = e.cv();
  // The memory never grows (nothing allocates), but a view is taken per call
  // so a grown memory could never leave a stale one behind.
  const memory = () => new Uint8Array(e.memory.buffer);
  return {
    // The chaining value of piece `index`, or the root hash when the address
    // is this one piece.
    piece(bytes, index, root) {
      if (bytes.length > PIECE_LEN) throw new RangeError(`a piece is at most ${PIECE_LEN} bytes, not ${bytes.length}`);
      if (bytes.length === 0 && !root) throw new RangeError("an empty piece exists only as a whole, empty address");
      const m = memory();
      m.set(bytes, input);
      const chunk = index * CHUNKS_PER_PIECE;
      e.hash_piece(bytes.length, chunk % TWO_32, Math.floor(chunk / TWO_32), root ? 1 : 0);
      return m.slice(cv, cv + 32);
    },
    // The parent of two chaining values, the root hash when `root`.
    parent(left, right, root) {
      const m = memory();
      m.set(left, cv);
      m.set(right, cv + 32);
      e.merge(root ? 1 : 0);
      return m.slice(cv, cv + 32);
    },
  };
}
