// Runs the local runner on Node: `node runner/serve.mjs [port]`.
//
// Point any Hugging Face tool at it and nothing else changes:
//
//     node runner/serve.mjs 8788
//     HF_ENDPOINT=http://127.0.0.1:8788 hf download openai-community/gpt2
//
// Settings, from the environment (an argument wins for the port):
//   PORT           where to listen (8788)
//   HOST           interface (127.0.0.1; 0.0.0.0 in a container)
//   HOLO_URL       the kernel holo (this repository's published one)
//   INDEX_URL      the signed index (this repository's published one)
//   MANIFESTS_URL  the signed witness manifests, for tensor addresses
//   SWARM_URL      the address snapshot, so a release Hugging Face no longer
//                  answers for can still be checked against its own digest
//   HF_API         "off" answers from the signed index alone
//   DRAIN          sources to take out of rotation, comma-separated
//   CACHE_DIR      where verified bytes are kept, addressed by their SHA-256
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { start, handle, SOURCES } from "./local.mjs";

const SITE = "https://hologram-technologies.github.io/hub";
const port = Number(process.argv[2] ?? process.env.PORT ?? 8788);
const host = process.env.HOST ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const ready = await start({
  holo: process.env.HOLO_URL ?? `${SITE}/app/app.holo`,
  index: process.env.INDEX_URL ?? `${SITE}/data/index/`,
  manifests: process.env.MANIFESTS_URL ?? `${SITE}/data/manifests/`,
  huggingFace: process.env.HF_API !== "off",
  drain: (process.env.DRAIN ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  cacheDir: process.env.CACHE_DIR,
  swarmIndex: process.env.SWARM_URL ?? `${SITE}/data/swarm/`,
  swarmSigned: process.env.SWARM_UNSIGNED !== "1",
});
console.log(`runner: kernel ${ready.fingerprint.slice(0, 16)}, ${ready.examples} examples replayed; index ${ready.index}`);
console.log(`runner: sources ${SOURCES.join(", ")}; verified bytes cached in ${ready.cache}`);
console.log(`runner: ${ready.addressed} releases addressed by the swarm snapshot`);

const note = (line) => console.log(`runner: ${line}`);

createServer(async (req, res) => {
  const body = req.method === "POST" ? Readable.toWeb(req) : undefined;
  const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body, duplex: "half" });
  const response = await handle(request, { onNote: note });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) Readable.fromWeb(response.body).pipe(res);
  else res.end();
}).listen(port, host, () => console.log(`runner: listening on http://${host}:${port}`));
