// Fetch a file into the verified cache, before a client asks for it.
//
//   CACHE_DIR=~/.hologram node runner/pull.mjs openai-community/gpt2 64-8bits.tflite
//   CACHE_DIR=~/.hologram node runner/pull.mjs openai-community/gpt2 --via pirateface
//
// This exists because of a timeout, and the timeout is not a bug to route
// around. A file is served only after every byte of it has been checked, so a
// cold fetch from the swarm returns nothing until the whole file has arrived
// and hashed - measured at 48 seconds for 125 MB from four seeders.
// `huggingface_hub` gives up long before that: its read timeout is ten
// seconds, and it sees silence, not progress.
//
// The fix is not to stream pieces as they arrive. BitTorrent checks each piece
// against the infohash, so streamed bytes would be intact, but the infohash
// comes from the swarm's own index; only the address in this hub's signed
// record says the torrent is the file it claims to be. Streaming would send
// bytes before that question was settled, which is the one thing `HK-19`
// exists to prevent. So the wait stays, and it moves here, where something
// that is not a Hugging Face client is doing the waiting.
//
// Afterwards the bytes are in the cache under their SHA-256, and a client
// asking the runner for that file is answered from it at once.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { handle, start } from "./local.mjs";

const SITE = "https://hologram-technologies.github.io/hub";

export async function pull(repo, paths, { via = null, port = null, onNote = () => {} } = {}) {
  const done = [];
  for (const path of paths) {
    const url = `http://127.0.0.1${via ? `/via/${via}` : ""}/${repo}/resolve/main/${path}`;
    const started = Date.now();
    const response = port
      ? await fetch(url.replace("http://127.0.0.1", `http://127.0.0.1:${port}`))
      : await handle(new Request(url), { onNote });
    if (!response.ok) {
      done.push({ path, ok: false, status: response.status, error: response.headers.get("x-error-message") ?? "" });
      continue;
    }
    // Draining the body is what makes the bytes land: the runner verifies
    // before it answers, so a response at all means the check passed.
    const bytes = (await response.arrayBuffer()).byteLength;
    done.push({
      path, ok: true, bytes, seconds: (Date.now() - started) / 1000,
      source: response.headers.get("x-hub-source"),
      etag: (response.headers.get("etag") ?? "").replace(/"/g, ""),
    });
  }
  return done;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const viaAt = args.indexOf("--via");
  const via = viaAt >= 0 ? args.splice(viaAt, 2)[1] : null;
  const portAt = args.indexOf("--port");
  const port = portAt >= 0 ? Number(args.splice(portAt, 2)[1]) : null;
  const [repo, ...paths] = args;
  if (!repo) {
    console.error("usage: node runner/pull.mjs <repo> [file ...] [--via <source>] [--port <n>]");
    process.exit(64);
  }
  const note = (line) => console.error(`  ${line}`);
  if (!port) {
    const ready = await start({
      holo: process.env.HOLO_URL ?? `${SITE}/app/app.holo`,
      index: process.env.INDEX_URL ?? `${SITE}/data/index/`,
      manifests: process.env.MANIFESTS_URL ?? `${SITE}/data/manifests/`,
      huggingFace: process.env.HF_API !== "off",
      cacheDir: process.env.CACHE_DIR,
    });
    console.error(`pull: kernel ${ready.fingerprint.slice(0, 16)}, index ${ready.index}, cache ${ready.cache}`);
  }

  let wanted = paths;
  if (!wanted.length) {
    // Every file the release addresses, which is every file the swarm may
    // serve: one with no address is refused rather than fetched (`HK-19`).
    const info = await (await fetch(`${port ? `http://127.0.0.1:${port}` : SITE.replace(/.*/, "")}/api/models/${repo}?blobs=true`)
      .catch(() => null))?.json?.() ?? null;
    wanted = info?.siblings?.filter((s) => s.lfs?.sha256).map((s) => s.rfilename) ?? [];
    if (!wanted.length) {
      console.error("pull: name the files to fetch; this release addresses none that could be listed here");
      process.exit(65);
    }
  }

  const results = await pull(repo, wanted, { via, port, onNote: note });
  let bytes = 0;
  for (const r of results) {
    if (r.ok) {
      bytes += r.bytes;
      console.log(`ok      ${r.path}  ${r.bytes} bytes from ${r.source} in ${r.seconds.toFixed(1)} s`);
    } else {
      console.log(`refused ${r.path}  ${r.status} ${r.error}`);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed} of ${results.length} in the verified cache, ${bytes} bytes`);
  process.exit(failed ? 1 : 0);
}
