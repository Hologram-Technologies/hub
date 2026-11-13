// Copies what the hub's pages need and the signed index does not carry: the
// registry and the apps list, because the live hub does not let another origin
// read them, and one avatar per owner, because a picture is decoration rather
// than a fact about the bytes.
//
// The models the browse page lists are NOT here. They come from the signed
// index (`tools/index.mjs`, `data/index/`), so the page and the wire read one
// set of facts and a reader can check them.
//
//   node tools/web-data.mjs <site dir> <hub origin>
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [site, origin] = process.argv.slice(2);
if (!site || !origin) {
  console.error("usage: node tools/web-data.mjs <site dir> <hub origin>");
  process.exit(64);
}
await mkdir(join(site, "data"), { recursive: true });

async function take(path) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${path}: the hub answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    data: JSON.parse(bytes.toString("utf8")),
    from: { source: new URL(path, origin).href, date: new Date().toISOString().slice(0, 10), hash: createHash("sha256").update(bytes).digest("hex") },
  };
}

// ---- the owners' own marks
// Hugging Face names each organization's avatar; the CDN serves one original
// per owner (200px, the size it stores) and that file is copied whole, so the
// mark is never a re-encoded or scaled copy. The page reads the map by owner.
const EXT = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg" };
const catalog = await take("/api/models?limit=500");
const owners = [...new Set(catalog.data.map((row) => row.id.split("/")[0]))];
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

// ---- the registry
// Only the fields the screen reads. Logos and covers are dropped; they are
// most of the 3 MB and the screen draws its own marks.
const KEEP = ["id", "registry", "org", "name", "tag", "kind", "description", "pulls", "stars", "updated", "size", "sizeBucket",
  "updatedBucket", "license", "digest", "home", "trust", "held", "verified", "official"];
const registry = await take("/registry/data/images.json");
const images = registry.data.images.map((row) => Object.fromEntries(KEEP.map((k) => [k, row[k] ?? null])));
for (const row of images) {
  if (typeof row.description === "string") row.description = row.description.replace(/<[^>]*>/g, "").trim().slice(0, 160);
}
await writeFile(join(site, "data", "registry.json"), JSON.stringify({ from: registry.from, images }));

const apps = await take("/spaces/spaces.json");
await writeFile(join(site, "data", "apps.json"), JSON.stringify({ from: apps.from, apps: apps.data.spaces }));

console.log(`web-data: ${faces.size} avatars (${Math.round(bytesWritten / 1024)} kB), ${images.length} registry entries, ${apps.data.spaces.length} apps`);
