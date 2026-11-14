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
  const type = TYPE[extname(path)] ?? "application/octet-stream";
  const missing = path.endsWith("404.html") && !asked.endsWith("404.html");
  // Ranged reads, because GitHub Pages serves them and the browse index is
  // built on them: a page of the catalogue is a few hundred bytes out of a
  // file of hundreds of megabytes. A preview that answered 200 to every
  // request would work and would hide what the real thing does.
  const asking = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
  if (asking && !missing) {
    const size = (await stat(path)).size;
    const from = asking[1] ? Number(asking[1]) : Math.max(0, size - Number(asking[2]));
    const to = asking[1] && asking[2] ? Math.min(Number(asking[2]), size - 1) : size - 1;
    if (!(from <= to && from < size)) {
      response.writeHead(416, { "content-range": `bytes */${size}` }).end();
      return;
    }
    response.writeHead(206, {
      "content-type": type,
      "content-range": `bytes ${from}-${to}/${size}`,
      "content-length": to - from + 1,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    });
    createReadStream(path, { start: from, end: to }).pipe(response);
    return;
  }
  response.writeHead(missing ? 404 : 200, {
    "content-type": type,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  });
  createReadStream(path).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`preview: http://127.0.0.1:${port}/ serving ${root}`));
