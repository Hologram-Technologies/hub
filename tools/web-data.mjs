// Copies the registry and apps lists from the live hub into the site, because
// the live hub does not let another origin read them (no CORS on these files).
// Each copy records its source, the time it was taken and the SHA-256 of the
// bytes it was made from, and the pages show all three.
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

// The registry: only the fields the screen reads. Logos and covers are
// dropped; they are most of the 3 MB and the screen draws its own marks.
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

console.log(`web-data: ${images.length} registry entries, ${apps.data.spaces.length} apps`);
