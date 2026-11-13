// Serves an assembled hub for a local look: the same files the Pages workflow
// deploys, with deep links falling back to 404.html the way Pages does.
//
//   node tools/preview.mjs [port] [dir]
//
// The directory defaults to ./preview, which tools/assemble.mjs writes.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const [portArg, dirArg] = process.argv.slice(2);
const port = Number(portArg ?? 4321);
const root = dirArg ?? process.env.HUB_PREVIEW ?? "preview";
const TYPE = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".holo": "application/octet-stream", ".wasm": "application/wasm", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

async function file(path) {
  try { return (await stat(path)).isFile() ? path : null; } catch { return null; }
}

createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const asked = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const path = (await file(join(root, asked)))
    ?? (await file(join(root, asked, "index.html")))
    ?? (await file(join(root, "404.html")));
  if (!path) { response.writeHead(404).end("not found"); return; }
  response.writeHead(path.endsWith("404.html") && !asked.endsWith("404.html") ? 404 : 200, {
    "content-type": TYPE[extname(path)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(path).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`preview: http://127.0.0.1:${port}/ serving ${root}`));
