// Runs the edge runner on Node: `node edge/serve.mjs [port] [holo URL]`.
// The holo defaults to the one this repository's Pages site publishes; pass a
// local file URL to test a holo you just built.
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { start, handle } from "./edge.mjs";

const port = Number(process.argv[2] ?? 8787);
const holo = process.argv[3] ?? "https://hologram-technologies.github.io/hub/app/app.holo";
const ready = await start(holo);
console.log(`edge: kernel ${ready.fingerprint.slice(0, 16)}, ${ready.examples} examples replayed`);

createServer(async (req, res) => {
  const body = req.method === "POST" ? Readable.toWeb(req) : undefined;
  const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body, duplex: "half" });
  const response = await handle(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) Readable.fromWeb(response.body).pipe(res);
  else res.end();
}).listen(port, "127.0.0.1", () => console.log(`edge: listening on http://127.0.0.1:${port}`));
