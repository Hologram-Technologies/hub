// Assembles every Space the catalog names into <out>/spaces/<id>/, exactly as it was sealed, and refuses to finish
// unless each one is (HK-27).
//
//   node tools/spaces.mjs <out dir>
//
// A Space is a sealed artifact: spaces/<id>/holospace.lock.json names every file it is made of by SHA-256 and size,
// and its root is the SHA-256 of its manifest.json, which the catalog repeats. This repository carries each Space's
// own files and the small shared runtime (spaces/runtime/). The ONNX Runtime files the Spaces load are the exact
// files npm publishes in the packages spaces/sources.json pins, so they are taken from those packages, each tarball
// checked against its integrity before a byte of it is used. Whatever the source, a file is published only if it
// hashes to its lock entry; a Space with a missing, extra or different file, or a manifest that is not its root, stops
// the build.
//
// The three style files the Spaces were sealed to load from the hub's origin (/kit/... and /tokens.css) are written
// to <out>/kit/ and <out>/spaces-compat/, the way spaces/sources.json records them.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const out = process.argv[2];
if (!out) {
  console.error("usage: node tools/spaces.mjs <out dir>");
  process.exit(64);
}
const SPACES = fileURLToPath(new URL("../spaces/", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const catalog = JSON.parse(await readFile(join(SPACES, "catalog.json"), "utf8"));
const sources = JSON.parse(await readFile(join(SPACES, "sources.json"), "utf8"));

// The files of one npm tarball, by path inside it, taken only after the tarball matches its integrity.
const packages = new Map();
async function packageFiles(pin) {
  if (packages.has(pin)) return packages.get(pin);
  const p = sources.runtime[pin];
  if (!p) throw new Error(`no package is pinned for runtime ${pin}`);
  const response = await fetch(p.tarball, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${p.tarball}: ${response.status}`);
  const tgz = Buffer.from(await response.arrayBuffer());
  const [algorithm, expected] = p.integrity.split("-");
  const got = createHash(algorithm).update(tgz).digest("base64");
  if (got !== expected) throw new Error(`${p.package}@${p.version}: the tarball is not the one its integrity names`);
  const files = untar(gunzipSync(tgz));
  packages.set(pin, files);
  return files;
}

// A ustar reader: npm tarballs are ustar with an occasional pax header, which is skipped.
function untar(tar) {
  const files = new Map();
  let at = 0;
  while (at + 512 <= tar.length) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const field = (from, length) => header.subarray(from, from + length).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1);
    const prefix = field(345, 155);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    if (type === "0" || type === "") files.set(name.replace(/^package\//, ""), tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

// Where one lock entry's bytes come from.
async function bytesFor(id, path) {
  const ort = path.match(/^runtime\/ort\/([^/]+)\/([^/]+)$/);
  if (ort) {
    const carried = join(SPACES, "runtime", "ort", ort[1], ort[2]);
    try {
      return await readFile(carried);
    } catch {
      const entry = sources.runtime[ort[1]]?.files.find((f) => f.to === ort[2]);
      if (!entry) throw new Error(`${id}: ${path} is neither carried here nor pinned to a package`);
      const bytes = (await packageFiles(ort[1])).get(entry.path);
      if (!bytes) throw new Error(`${id}: ${sources.runtime[ort[1]].package} has no ${entry.path}`);
      return bytes;
    }
  }
  if (path.startsWith("runtime/")) return readFile(join(SPACES, path));
  return readFile(join(SPACES, id, path));
}

async function filesUnder(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(path)));
    else found.push(path);
  }
  return found;
}

const problems = [];
await rm(join(out, "spaces"), { recursive: true, force: true });
for (const space of catalog.spaces) {
  const lock = JSON.parse(await readFile(join(SPACES, space.id, "holospace.lock.json"), "utf8"));
  const dir = join(out, "spaces", space.id);
  for (const [path, want] of Object.entries(lock.files)) {
    const bytes = await bytesFor(space.id, path);
    if (bytes.length !== want.bytes || sha256(bytes) !== want.sha256) {
      problems.push(`${space.id}/${path}: not the bytes its lock names`);
      continue;
    }
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), bytes);
  }
  // The lock names its own manifest; the manifest and the lock themselves are the seal, not entries of it.
  for (const seal of ["manifest.json", "holospace.lock.json"]) await writeFile(join(dir, seal), await readFile(join(SPACES, space.id, seal)));
  const root = `sha256:${sha256(await readFile(join(dir, "manifest.json")))}`;
  if (root !== lock.root || root !== space.root) problems.push(`${space.id}: the manifest hashes to ${root}, the lock says ${lock.root}, the catalog ${space.root}`);
  const allowed = new Set([...Object.keys(lock.files), "manifest.json", "holospace.lock.json"]);
  for (const file of await filesUnder(dir)) {
    const path = relative(dir, file).split("\\").join("/");
    if (!allowed.has(path)) problems.push(`${space.id}/${path}: published but not in the lock`);
  }
}
for (const c of sources.compat) {
  const bytes = await readFile(join(SPACES, c.to));
  if (sha256(bytes) !== c.sha256) problems.push(`${c.to}: not the bytes spaces/sources.json records`);
  const target = c.served.startsWith("/kit/") ? join(out, c.served) : join(out, "spaces-compat", c.served);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
await writeFile(join(out, "spaces", "spaces.json"), JSON.stringify(catalog));

if (problems.length) {
  console.error(problems.map((p) => `spaces: ${p}`).join("\n"));
  process.exit(1);
}
console.log(`spaces: ${catalog.spaces.length} Spaces, each the artifact its root names`);
