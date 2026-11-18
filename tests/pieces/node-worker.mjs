// The piece worker on Node's worker_threads, for tests/pieces/fetch.mjs: the
// same hasher and the same messages as web/piece-worker.mjs, with the module's
// bytes read from disk instead of fetched.
import { readFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";

import { instantiate } from "../../web/piece-hash.mjs";

const hasher = instantiate(await readFile(workerData.wasm));

parentPort.on("message", async (data) => {
  try {
    const h = await hasher;
    const cv = h.piece(new Uint8Array(data.bytes, 0, data.length), data.index, data.root);
    parentPort.postMessage({ id: data.id, cv, bytes: data.bytes }, [data.bytes, cv.buffer]);
  } catch (error) {
    parentPort.postMessage({ id: data.id, error: String(error?.message ?? error), bytes: data.bytes }, [data.bytes]);
  }
});
