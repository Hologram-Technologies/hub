// The witness: builds one manifest per model in a list, with every file's
// address and a BLAKE3 address for every tensor, from bytes it downloaded and
// hashed itself. It refuses to write a manifest if any file it downloaded does
// not hash to the address Hugging Face gives for it. pages.yml signs what it
// writes with this repository's workflow identity (Sigstore, keyless).
//
//   node tools/manifest.mjs <model list> <out dir>
//
// A manifest already in <out dir> for the same revision is kept, so a cache of
// <out dir> spares the downloads when nothing upstream changed. The manifest
// holds no dates: the same release always gives the same bytes and digest.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Blake3 } from "../try/vendor/prism-code/src/blake3.mjs";

const [list, out] = process.argv.slice(2);
if (!list || !out) {
  console.error("usage: node tools/manifest.mjs <model list> <out dir>");
  process.exit(64);
}
const HF = "https://huggingface.co";
const SMALL = 10 * 1024 * 1024;
const hex = (b) => Buffer.from(b).toString("hex");

async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

// Streams one file, hashing all of it with SHA-256 (and, for a small file, as a
// git blob with SHA-1) and each safetensors tensor with BLAKE3.
async function witness(repo, revision, file) {
  const started = Date.now();
  process.stdout.write(`  ${repo}/${file.path} (${file.size} bytes) `);
  const r = await fetch(`${HF}/${repo}/resolve/${revision}/${file.path}`, { signal: AbortSignal.timeout(30 * 60000) });
  if (!r.ok) throw new Error(`${repo}/${file.path}: ${r.status}`);
  const sha256 = createHash("sha256");
  const sha1 = file.lfs ? null : createHash("sha1").update(`blob ${file.size}\0`);
  const safetensors = file.path.endsWith(".safetensors");
  let seen = 0;
  let head = Buffer.alloc(0);
  let tensors = null;
  let dataStart = 0;
  const open = [];
  for await (const chunk of r.body) {
    const bytes = Buffer.from(chunk);
    sha256.update(bytes);
    sha1?.update(bytes);
    if (safetensors) {
      if (!tensors) {
        head = Buffer.concat([head, bytes]);
        if (head.length >= 8) {
          const n = Number(head.readBigUInt64LE(0));
          if (head.length >= 8 + n) {
            const header = JSON.parse(head.subarray(8, 8 + n).toString("utf8"));
            dataStart = 8 + n;
            tensors = Object.entries(header).filter(([k]) => k !== "__metadata__")
              .map(([name, t]) => ({ name, dtype: t.dtype, shape: t.shape, begin: dataStart + t.data_offsets[0], end: dataStart + t.data_offsets[1], hash: new Blake3() }))
              .sort((a, b) => a.begin - b.begin);
            open.push(...tensors);
          }
        }
      }
      if (tensors) {
        const from = seen;
        const to = seen + bytes.length;
        for (const t of open) {
          const a = Math.max(t.begin, from);
          const b = Math.min(t.end, to);
          if (a < b) t.hash.update(bytes.subarray(a - from, b - from));
        }
      }
    }
    seen += bytes.length;
  }
  if (seen !== file.size) throw new Error(`${repo}/${file.path}: ${seen} bytes, Hugging Face says ${file.size}`);
  const got256 = sha256.digest("hex");
  if (file.lfs && got256 !== file.lfs.oid) throw new Error(`${repo}/${file.path}: sha256 ${got256}, Hugging Face says ${file.lfs.oid}`);
  const got1 = sha1?.digest("hex");
  if (sha1 && got1 !== file.oid) throw new Error(`${repo}/${file.path}: git blob ${got1}, Hugging Face says ${file.oid}`);
  console.log(`ok in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return {
    sha256: got256,
    tensors: (tensors ?? []).map((t) => ({ file: file.path, name: t.name, dtype: t.dtype, shape: t.shape, length: t.end - t.begin, blake3: `blake3:${hex(t.hash.digest())}` })),
  };
}

const repos = (await readFile(list, "utf8")).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const index = [];
for (const repo of repos) {
  const path = join(out, `${repo}.json`);
  const { sha: revision } = await json(`${HF}/api/models/${repo}`);
  let manifest = null;
  try {
    const kept = JSON.parse(await readFile(path, "utf8"));
    if (kept.revision === revision) manifest = kept;
  } catch {}
  if (!manifest) {
    const tree = (await json(`${HF}/api/models/${repo}/tree/${revision}?recursive=true`)).filter((f) => f.type === "file");
    const files = [];
    const tensors = [];
    for (const f of tree.sort((a, b) => a.path.localeCompare(b.path))) {
      const entry = { path: f.path, size: f.size };
      if (f.lfs) entry.sha256 = f.lfs.oid; else entry.gitSha1 = f.oid;
      entry.witnessed = false;
      if (f.path.endsWith(".safetensors") || f.size <= SMALL) {
        const seen = await witness(repo, revision, f);
        entry.sha256 = seen.sha256;
        entry.witnessed = true;
        tensors.push(...seen.tensors);
      }
      files.push(entry);
    }
    manifest = { format: "hologram.hub.manifest/v1", repo, revision, source: HF, files, tensors };
  }
  await mkdir(dirname(path), { recursive: true });
  const bytes = JSON.stringify(manifest);
  await writeFile(path, bytes);
  index.push({ repo, revision, sha256: createHash("sha256").update(bytes).digest("hex"), tensors: manifest.tensors.length, files: manifest.files.length });
  console.log(`manifest: ${repo}@${revision.slice(0, 12)}: ${manifest.files.length} files (${manifest.files.filter((f) => f.witnessed).length} re-hashed), ${manifest.tensors.length} tensors`);
}
await writeFile(join(out, "index.json"), JSON.stringify({ format: "hologram.hub.manifests/v1", manifests: index }));
