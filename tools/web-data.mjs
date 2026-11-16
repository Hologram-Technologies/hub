// Writes what the hub's pages need and the signed index does not carry: the
// list of Spaces, from this repository's own catalog (spaces/catalog.json,
// whose every Space HK-27 checks), and one avatar per owner, because a picture
// is decoration rather than a fact about the bytes.
//
// The models the browse page lists are NOT here. They come from the signed
// index (`tools/index.mjs`, `data/index/`), so the page and the wire read one
// set of facts and a reader can check them. The owners whose marks are fetched
// are read from that same index rather than asked of the live hub, so the
// marks match the rows the page draws.
//
//   node tools/web-data.mjs <site dir>
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [site] = process.argv.slice(2);
if (!site) {
  console.error("usage: node tools/web-data.mjs <site dir>");
  process.exit(64);
}
await mkdir(join(site, "data"), { recursive: true });

// The catalog as this repository carries it. `from` names where its Spaces were imported from and when, which is
// what the Spaces screen says under the list.
async function catalog() {
  const bytes = await readFile(new URL("../spaces/catalog.json", import.meta.url));
  const { imported } = JSON.parse(await readFile(new URL("../spaces/sources.json", import.meta.url), "utf8"));
  return {
    data: JSON.parse(bytes.toString("utf8")),
    from: { source: `${imported.repository}@${imported.commit.slice(0, 7)}`, date: imported.date, hash: createHash("sha256").update(bytes).digest("hex") },
  };
}

// ---- the owners' own marks
// Hugging Face names each organization's avatar; the CDN serves one original
// per owner (200px, the size it stores) and that file is copied whole, so the
// mark is never a re-encoded or scaled copy. The page reads the map by owner.
const EXT = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg" };
let owners = [];
try {
  const { records } = JSON.parse(await readFile(join(site, "data", "index", "root.json"), "utf8"));
  owners = [...new Set(records.map(({ repo }) => repo.split("/")[0]))];
} catch (error) {
  console.warn(`web-data: no owner marks (${error.message}); every owner keeps its initials`);
}
await mkdir(join(site, "data", "avatars"), { recursive: true });
const faces = new Map();
let bytesWritten = 0;
await Promise.all(owners.map(async (owner) => {
  for (const kind of ["organizations", "users"]) {
    try {
      const named = await fetch(`https://huggingface.co/api/${kind}/${encodeURIComponent(owner)}/avatar`, { signal: AbortSignal.timeout(20000) });
      if (!named.ok) continue;
      const { avatarUrl } = await named.json();
      if (!avatarUrl) continue;
      const image = await fetch(avatarUrl, { signal: AbortSignal.timeout(30000) });
      if (!image.ok) continue;
      const type = image.headers.get("content-type")?.split(";")[0] ?? "";
      const ext = EXT[type];
      if (!ext) continue;
      const body = Buffer.from(await image.arrayBuffer());
      const file = `${owner.replace(/[^\w.-]/g, "_")}.${ext}`;
      await writeFile(join(site, "data", "avatars", file), body);
      faces.set(owner, file);
      bytesWritten += body.length;
      return;
    } catch {
      // An owner without a mark keeps its initials; nothing else depends on it.
    }
  }
}));
await writeFile(join(site, "data", "avatars", "index.json"), JSON.stringify(Object.fromEntries([...faces].sort())));

// ---- the Spaces
const spaces = await catalog();
await writeFile(join(site, "data", "spaces.json"), JSON.stringify({ from: spaces.from, spaces: spaces.data.spaces }));

console.log(`web-data: ${faces.size} avatars (${Math.round(bytesWritten / 1024)} kB), ${spaces.data.spaces.length} Spaces`);
