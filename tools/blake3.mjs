// BLAKE3 over a stream, in 1 MiB pieces, by the same hasher every reader of
// this hub uses (`web/piece-hash.wasm`, built from `crates/piece-hash`) and the
// same fold (`web/pieces.mjs`). A build that hashed with a second
// implementation could publish an address no reader re-derives; this one
// cannot, because there is only the one.
//
// The pieces are kept, not only the root: a tensor longer than a piece is
// published with its piece table (HK-44), and the table is these chaining
// values. Holding them costs 32 bytes a MiB.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { instantiate } from "../web/piece-hash.mjs";
import { PIECE_LEN, encodeTable, foldTable } from "../web/pieces.mjs";

export const hasher = await instantiate(await readFile(fileURLToPath(new URL("../web/piece-hash.wasm", import.meta.url))));

const hex = (bytes) => Buffer.from(bytes).toString("hex");

// One BLAKE3 in progress. `update` takes bytes in order; `finish` gives the
// hex digest, the length hashed and the piece table when there is more than
// one piece.
export function blake3Stream() {
  const piece = Buffer.alloc(PIECE_LEN);
  let held = 0;
  let index = 0;
  let length = 0;
  const cvs = [];
  return {
    update(bytes) {
      let at = 0;
      while (at < bytes.length) {
        // A full piece is hashed only when more bytes follow it, because the
        // last piece of a one-piece blob is the root and is hashed as one.
        if (held === PIECE_LEN) {
          cvs.push(hasher.piece(piece, index, false));
          index += 1;
          held = 0;
        }
        const take = Math.min(PIECE_LEN - held, bytes.length - at);
        piece.set(bytes.subarray(at, at + take), held);
        held += take;
        at += take;
      }
      length += bytes.length;
    },
    finish() {
      const last = piece.subarray(0, held);
      if (index === 0) return { blake3: hex(hasher.piece(last, 0, true)), length, table: null };
      cvs.push(hasher.piece(last, index, false));
      return { blake3: hex(foldTable(cvs, hasher.parent)), length, table: Buffer.from(encodeTable({ length, cvs })) };
    },
  };
}

export const blake3Hex = (bytes) => {
  const stream = blake3Stream();
  stream.update(Buffer.from(bytes));
  return stream.finish().blake3;
};
