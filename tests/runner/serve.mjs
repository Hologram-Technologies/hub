// The local runner, end to end, against sources that are standing right here.
//
// One source serves the bytes the record addresses and one serves something
// else. The runner must carry the good bytes to the client, and must never
// carry the others - not when they are all that is pinned, and not when the
// good source has been drained.
//
//   node tests/runner/serve.mjs <holo url>
//
// The index is unsigned here: this is a test of what the runner does with a
// record, not of the signature, which `edge/edge.mjs` checks on every real
// start.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptUnsignedIndexForTests } from "../../edge/edge.mjs";
import { forget, handle, start } from "../../runner/local.mjs";

const [holo] = process.argv.slice(2);
if (!holo) {
  console.error("usage: node tests/runner/serve.mjs <holo url>");
  process.exit(64);
}

let checks = 0;
const ok = (what) => { checks += 1; console.log(`  ok  ${what}`); };
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const gitBlob = (b) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");

const REPO = "testing/model";
const ONLY_BAD = "testing/only-bad";
const REVISION = "a".repeat(40);
const WEIGHTS = Buffer.from("the bytes the record addresses, several times over".repeat(40));
const CARD = Buffer.from("# a small file with no sha256 in the index\n");
const OTHER = Buffer.from("these are not those bytes".repeat(40));

const work = await mkdtemp(join(tmpdir(), "hub-runner-test-"));
const cacheDir = join(work, "cache");
const files = [
  { path: "model.safetensors", size: WEIGHTS.length, gitSha1: gitBlob(WEIGHTS), sha256: sha256(WEIGHTS), pointerSize: 134 },
  { path: "README.md", size: CARD.length, gitSha1: gitBlob(CARD) },
];

// The static files the runner reads: an index root, one record, and the two
// sources the record names.
const port = await new Promise((resolve) => {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (status, body, type = "application/json") => {
      res.writeHead(status, { "content-type": type, "content-length": body.length });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    if (url.pathname === "/index/root.json") return send(200, Buffer.from(JSON.stringify(root)));
    const wanted = url.pathname.match(/^\/index\/models\/(.+)\.json$/);
    if (wanted && records[decodeURIComponent(wanted[1])]) {
      return send(200, Buffer.from(JSON.stringify(records[decodeURIComponent(wanted[1])])));
    }
    const good = url.pathname.match(/^\/good\/(.+)$/);
    const bad = url.pathname.match(/^\/bad\/(.+)$/);
    if (good) {
      const name = decodeURIComponent(good[1]);
      const body = name === "README.md" ? CARD : WEIGHTS;
      return send(200, body, "application/octet-stream");
    }
    if (bad) return send(200, OTHER, "application/octet-stream");
    return send(404, Buffer.from("{}"));
  }).listen(0, "127.0.0.1", () => resolve(server.address().port));
});
const base = `http://127.0.0.1:${port}`;

const record = {
  format: "hologram.hub.release/v2",
  repo: REPO,
  revision: REVISION,
  info: { author: "testing", tags: [], pipeline_tag: null, library_name: null, createdAt: null, lastModified: null, gated: false, private: false, disabled: false },
  config: null, cardData: null, card: null, safetensors: null, transformersInfo: null,
  observed: { source: base, date: "2026-11-14", downloads: 0, likes: 0 },
  files,
  sources: [
    { kind: "modelscope.cn", resolve: `${base}/good/`, missing: [] },
    { kind: "ipfs", resolve: `${base}/bad/`, missing: [] },
  ],
};
// The same release, but the only source it names is the one that serves
// something else.
const lonely = { ...record, repo: ONLY_BAD, sources: [record.sources[1]] };
const records = { [REPO]: record, [ONLY_BAD]: lonely };
const root = {
  format: "hologram.hub.index/v2",
  catalog: sha256(Buffer.from("[]")),
  rules: "test",
  browse: [],
  records: Object.entries(records).map(([repo, r]) => ({
    repo, revision: REVISION, sha256: sha256(Buffer.from(JSON.stringify(r))),
  })),
};
await mkdir(cacheDir, { recursive: true });

// Hugging Face is unreachable and drained, so the record is the only authority
// and the two local sources are the only candidates.
await start({ holo, huggingFace: false, drain: ["huggingface.co"], cacheDir });
await adoptUnsignedIndexForTests(`${base}/index/`);
forget();

// `say` prints what the runner did, for the cases where failing over is the
// point and the reader wants to see it happen.
const get = (path, headers = {}, say = false) =>
  handle(new Request(`http://127.0.0.1${path}`, { headers }),
         { onNote: (line) => { if (say) console.log(`      ${line}`); } });
const file = (p) => `/${REPO}/resolve/main/${p}`;

// The bytes themselves, from the source that has them.
let response = await get(file("model.safetensors"));
assert.equal(response.status, 200);
const served = Buffer.from(await response.arrayBuffer());
assert.equal(sha256(served), sha256(WEIGHTS));
assert.equal(response.headers.get("x-hub-source"), "modelscope.cn");
assert.equal(response.headers.get("x-hub-runner"), "local");
assert.equal(response.headers.get("etag"), `"${sha256(WEIGHTS)}"`);
assert.equal(response.headers.get("x-repo-commit"), REVISION);
ok("the runner carries the bytes itself, with the SHA-256 ETag a large file takes");

// The cache is addressed by content, not by repository, so another release
// naming the same file is already holding it. No source is asked, and the
// answer says cache rather than crediting one.
response = await get(`/${ONLY_BAD}/resolve/main/model.safetensors`);
assert.equal(response.status, 200);
assert.equal(response.headers.get("x-hub-source"), "cache");
assert.deepEqual(Buffer.from(await response.arrayBuffer()), WEIGHTS);
ok("another release naming the same file is served from the content-addressed cache");

// A HEAD asks what the file is, not for it. `huggingface_hub` sends one
// before every download, and answering it by fetching would mean downloading a
// whole weight file to describe it. Nothing may reach the cache.
forget();
await rm(cacheDir, { recursive: true, force: true });
await mkdir(cacheDir, { recursive: true });
response = await handle(new Request(`http://127.0.0.1${file("model.safetensors")}`, { method: "HEAD" }));
assert.equal(response.status, 200);
assert.equal(response.headers.get("etag"), `"${sha256(WEIGHTS)}"`);
assert.equal(response.headers.get("content-length"), String(WEIGHTS.length));
assert.equal(response.headers.get("x-repo-commit"), REVISION);
assert.equal(await response.text(), "");
assert.deepEqual(await readdir(cacheDir), [], "a HEAD must not fetch the bytes");
ok("a HEAD is answered from the record alone, with nothing fetched");

// Warm the cache again for the cases below.
await get(file("model.safetensors"));

// A range, because that is how a Hugging Face client resumes.
response = await get(file("model.safetensors"), { range: "bytes=10-19" });
assert.equal(response.status, 206);
assert.equal(response.headers.get("content-range"), `bytes 10-19/${WEIGHTS.length}`);
assert.deepEqual(Buffer.from(await response.arrayBuffer()), WEIGHTS.subarray(10, 20));
ok("a range request is answered with exactly that range");

// A small file: no SHA-256 in the index, so its git blob identity is what is
// checked, and the ETag is the git blob one (HK-08).
response = await get(file("README.md"));
assert.equal(response.status, 200);
assert.deepEqual(Buffer.from(await response.arrayBuffer()), CARD);
assert.equal(response.headers.get("etag"), `"${gitBlob(CARD)}"`);
ok("a small file is checked by its git blob identity and carries the git blob ETag");

// Pinned to the source that serves something else. The bytes do not match the
// address, so nothing is served: HK-06 says the pin is the only source the
// kernel may choose, and HK-05 says a source that failed for this file is
// never chosen again.
forget();
await rm(cacheDir, { recursive: true, force: true });
await mkdir(cacheDir, { recursive: true });
response = await get(`/via/ipfs${file("model.safetensors")}`);
assert.equal(response.status, 503);
assert.equal(response.headers.get("x-error-code"), "NoSource");
ok("a pinned source that sends other bytes is refused, not served");

// Drained is a last resort, not a removal. With the good source drained the
// kernel reaches for the healthy one first, the runner refuses its bytes, and
// `HK-05` then sends it back to the drained source, which has them. The client
// sees one answer and the right bytes.
forget();
await rm(cacheDir, { recursive: true, force: true });
await mkdir(cacheDir, { recursive: true });
await start({ holo, huggingFace: false, drain: ["huggingface.co", "modelscope.cn"], cacheDir });
await adoptUnsignedIndexForTests(`${base}/index/`);
response = await get(file("model.safetensors"), {}, true);
assert.equal(response.status, 200);
assert.equal(response.headers.get("x-hub-source"), "modelscope.cn");
assert.deepEqual(Buffer.from(await response.arrayBuffer()), WEIGHTS);
ok("bad bytes from the healthy source send the runner back to the drained one, which has them");

// The cache is a shortcut, never an override. These exact bytes are in it and
// they match the address, and the kernel still refuses, because the one source
// this request may use has failed verification for them (`HK-05`, `HK-06`).
// A delivered file always has a source (`HK-02`); a cache hit is not one.
response = await get(`/via/ipfs/${ONLY_BAD}/resolve/main/model.safetensors`);
assert.equal(response.status, 503);
assert.equal(response.headers.get("x-error-code"), "NoSource");
ok("the kernel's refusal stands while the runner holds bytes that match the address");

// Unpinned, the same request is served, because Hugging Face is a candidate
// for any file an index record lists, whatever sources that record names. The
// bytes come from the cache rather than from it, and the answer says so.
response = await get(`/${ONLY_BAD}/resolve/main/model.safetensors`);
assert.equal(response.status, 200);
assert.equal(response.headers.get("x-hub-source"), "cache");
ok("unpinned, the same file is served from the cache without asking a source");

// And a file no source holds is an entry that is not found, not a 503.
response = await get(file("absent.bin"));
assert.equal(response.status, 404);
ok("a file the record does not list is not found");

await rm(work, { recursive: true, force: true });
console.log(`tests/runner/serve: ${checks} checks passed`);
process.exit(0);
