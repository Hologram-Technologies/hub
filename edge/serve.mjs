// Runs the edge runner on Node: `node edge/serve.mjs [port]`.
//
// Settings, from the environment (an argument wins for the port):
//   PORT       where to listen (8787)
//   HOST       interface (127.0.0.1; 0.0.0.0 in a container)
//   HOLO_URL   the kernel holo (this repository's published one)
//   INDEX_URL  the signed index (this repository's published one)
//   HF_API     "off" makes the edge answer from the signed index alone
//   DRAIN      sources to take out of rotation, comma-separated
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { start, handle } from "./edge.mjs";

const SITE = "https://hologram-technologies.github.io/hub";
const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);
const host = process.env.HOST ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const ready = await start({
  holo: process.env.HOLO_URL ?? `${SITE}/app/app.holo`,
  index: process.env.INDEX_URL ?? `${SITE}/data/index/`,
  huggingFace: process.env.HF_API !== "off",
  // Sources taken out of rotation, comma-separated (for example "huggingface.co").
  drain: (process.env.DRAIN ?? "").split(",").map((s) => s.trim()).filter(Boolean),
});
console.log(`edge: kernel ${ready.fingerprint.slice(0, 16)}, ${ready.examples} examples replayed; index ${ready.index}`);

createServer(async (req, res) => {
  const body = req.method === "POST" ? Readable.toWeb(req) : undefined;
  const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body, duplex: "half" });
  const response = await handle(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) Readable.fromWeb(response.body).pipe(res);
  else res.end();
}).listen(port, host, () => console.log(`edge: listening on http://${host}:${port}`));
