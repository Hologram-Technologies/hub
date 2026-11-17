// A Web Worker that hashes pieces. The page transfers each piece's buffer in
// and gets it back with the chaining value, so nothing is copied and no
// SharedArrayBuffer (and so no cross-origin isolation) is needed: this runs on
// any static host.
import { instantiate } from "./piece-hash.mjs";

const hasher = instantiate(fetch(new URL("./piece-hash.wasm", import.meta.url)));

self.onmessage = async ({ data }) => {
  try {
    const h = await hasher;
    const cv = h.piece(new Uint8Array(data.bytes, 0, data.length), data.index, data.root);
    self.postMessage({ id: data.id, cv, bytes: data.bytes }, [data.bytes, cv.buffer]);
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error?.message ?? error), bytes: data.bytes }, [data.bytes]);
  }
};
