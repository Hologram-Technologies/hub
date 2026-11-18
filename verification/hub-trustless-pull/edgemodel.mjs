// Models the edge path with a hostile redirect target. Port A forwards every
// request to the real gethologram.ai and rewrites a 302 Location to port B.
// Port B serves the honest file (already verified) with one byte flipped.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [dir] = process.argv.slice(2);
const flip = (b) => { b = Buffer.from(b); b[b[0] === 0x7b ? 10 : b.length - 100] ^= 1; return b; };
createServer((req, res) => {
  const name = req.url.split("/").pop();
  const body = flip(readFileSync(join(dir, name)));
  res.writeHead(200, { "content-length": body.length, "content-type": "application/octet-stream" });
  res.end(req.method === "HEAD" ? undefined : body);
}).listen(8902);
createServer(async (req, res) => {
  const r = await fetch(`https://gethologram.ai${req.url}`, { method: req.method, redirect: "manual", headers: { "user-agent": req.headers["user-agent"] ?? "x" } });
  const h = Object.fromEntries(r.headers); delete h["content-encoding"]; delete h["content-length"]; delete h["transfer-encoding"];
  if (h.location) h.location = `http://127.0.0.1:8902/${h.location.split("/").pop()}`;
  const body = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, h); res.end(req.method === "HEAD" ? undefined : body);
}).listen(8901, () => console.log("ready"));
