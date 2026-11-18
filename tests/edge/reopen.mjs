// A deploy replaces the index under a running edge. The edge must read the
// root again rather than refuse every record the deploy changed, and must
// still refuse a record no root names. On 2026-11-18 the edge kept the root it
// started with and answered 502 for four models until it was restarted.
//
//   node tests/edge/reopen.mjs <holo url> <index url>
//
// The index may be unsigned here: this is a test of when the root is read,
// not of the signature, which `edge/edge.mjs` checks on every real open.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { start, handle, adoptUnsignedIndexForTests } from "../../edge/edge.mjs";

const [holo, indexUrl] = process.argv.slice(2);
if (!holo || !indexUrl) {
  console.error("usage: node tests/edge/reopen.mjs <holo url> <index url>");
  process.exit(64);
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const fetchBytes = async (path) => {
  const r = await fetch(new URL(path, indexUrl));
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

// A copy of the root, its browse shards and three records, served from here so
// the test can deploy over it.
const work = await mkdtemp(join(tmpdir(), "edge-reopen-"));
const put = async (path, bytes) => { await mkdir(dirname(join(work, path)), { recursive: true }); await writeFile(join(work, path), bytes); };
const root = JSON.parse(await fetchBytes("root.json"));
for (const shard of root.browse ?? []) await put(shard.path, await fetchBytes(shard.path));
const [changed, asked, third] = root.records;
for (const entry of [changed, asked, third]) await put(`models/${entry.repo}.json`, await fetchBytes(`models/${entry.repo}.json`));
await put("root.json", JSON.stringify(root));

const server = createServer((request, response) => {
  const asked = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname)).replace(/^[\\/]+/, "");
  const stream = createReadStream(join(work, asked));
  stream.once("error", () => response.writeHead(404).end());
  stream.once("open", () => { response.writeHead(200, { "content-type": "application/json" }); stream.pipe(response); });
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
await start({ holo, index: base, huggingFace: false, drain: ["huggingface.co"] });
await adoptUnsignedIndexForTests(base);
const ask = (repo) => handle(new Request(`http://edge/api/models/${repo}`));

try {
  // The edge is answering; the record the deploy will change has not been
  // asked for yet, as for the four models on 2026-11-18.
  assert.equal((await ask(asked.repo)).status, 200, "the edge answers before the deploy");

  // The deploy: the record changes, and the new root names its new bytes.
  const path = `models/${changed.repo}.json`;
  const record = JSON.parse(await readFile(join(work, path), "utf8"));
  record.deployedAfterStart = true;
  const bytes = Buffer.from(JSON.stringify(record));
  await put(path, bytes);
  root.records.find((r) => r.repo === changed.repo).sha256 = sha256(bytes);
  await put("root.json", JSON.stringify(root));
  const after = await ask(changed.repo);
  assert.equal(after.status, 200, `a record a deploy changed is refused: ${await after.text()}`);
  console.log("ok   a record a deploy changed answers once the root is read again");

  // Bytes no root names are still refused, after reading the root again. The
  // record is a third one, not yet loaded, so the refusal is the check's.
  await put(`models/${third.repo}.json`, Buffer.from(JSON.stringify({ repo: third.repo, files: [] })));
  const refused = await ask(third.repo);
  assert.equal(refused.status, 502, "a record no root names must be refused");
  assert.match(await refused.text(), /does not match the signed root/);
  console.log("ok   a record no root names is still refused");

  // A refusal is not remembered: once the bytes are right again, it answers.
  await put(`models/${third.repo}.json`, await fetchBytes(`models/${third.repo}.json`));
  assert.equal((await ask(third.repo)).status, 200, "a record refused once must answer when its bytes match again");
  console.log("ok   a refusal is not remembered");
} finally {
  server.close();
  await rm(work, { recursive: true, force: true });
}
console.log("tests/edge/reopen: all checks passed");
