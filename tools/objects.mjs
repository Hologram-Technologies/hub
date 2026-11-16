// Files every object this hub publishes under the SHA-256 of its bytes, so the Buckets page (and anyone) can fetch an
// object by its address and check it (HK-28).
//
//   node tools/objects.mjs <release dir>
//
// Run after tools/spaces.mjs on the same release: every file under <release>/spaces is an object, each Space's
// manifest among them (its address is the Space's root). An object's name is computed here from its bytes and nothing
// else, so the store cannot hold bytes under an address they do not have. The store is <release>/objects/sha256/<hex>,
// hard links to the published files, so it costs no second copy on disk; Caddy answers /api/v1/objects/sha256:<hex>
// from it (deploy/caddy/gethologram.ai.caddy).
import { createHash } from "node:crypto";
import { copyFile, link, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const release = process.argv[2];
if (!release) {
  console.error("usage: node tools/objects.mjs <release dir>");
  process.exit(64);
}

async function filesUnder(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

const store = join(release, "objects", "sha256");
await rm(join(release, "objects"), { recursive: true, force: true });
await mkdir(store, { recursive: true });
const names = new Set();
let bytes = 0;
for (const file of await filesUnder(join(release, "spaces"))) {
  const name = createHash("sha256").update(await readFile(file)).digest("hex");
  if (names.has(name)) continue;
  names.add(name);
  bytes += (await stat(file)).size;
  try {
    await link(file, join(store, name));
  } catch {
    await copyFile(file, join(store, name));
  }
}
console.log(`objects: ${names.size} objects, ${Math.round(bytes / 1048576)} MB, each under the SHA-256 of its bytes`);
