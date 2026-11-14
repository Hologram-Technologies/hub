// The address snapshot, and the one thing it is for.
//
// A release that neither the signed index nor Hugging Face can describe is not
// servable, because `HK-19` will not let the swarm serve a file the record
// gives no address for - and it is right not to, since the only digest left
// would belong to whoever is serving the bytes. The snapshot is Hugging Face's
// own address written down earlier, so the question still has an independent
// answer after Hugging Face stops giving one.
//
//   node tests/runner/snapshot.mjs <holo url>
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forget, handle, start } from "../../runner/local.mjs";

const [holo] = process.argv.slice(2);
if (!holo) {
  console.error("usage: node tests/runner/snapshot.mjs <holo url>");
  process.exit(64);
}

let checks = 0;
const ok = (what) => { checks += 1; console.log(`  ok  ${what}`); };
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

const REPO = "gone/from-hugging-face";
const REVISION = "e".repeat(40);
const WEIGHTS = { path: "model.safetensors", size: 2048, sha256: "f".repeat(64) };
const shardName = sha256(REPO).slice(0, 2);
const shard = Buffer.from(JSON.stringify([{ repo: REPO, revision: REVISION, files: [WEIGHTS] }]));
let corrupt = false;

const port = await new Promise((resolve) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json", "content-length": body.length });
      res.end(body);
    };
    if (url.pathname === "/swarm/root.json") {
      return send(200, Buffer.from(JSON.stringify({
        format: "hologram.hub.swarm/v1",
        addresses: "https://huggingface.co",
        date: "2026-11-14",
        models: 1,
        shards: [{ path: `shards/${shardName}.json`, rows: 1, sha256: sha256(shard) }],
      })));
    }
    if (url.pathname === `/swarm/shards/${shardName}.json`) {
      const body = Buffer.from(shard);
      if (corrupt) body[body.length - 2] = 0x20;
      return send(200, body);
    }
    return send(404, Buffer.from("{}"));
  }).listen(0, "127.0.0.1", () => resolve(server.address().port));
});
const base = `http://127.0.0.1:${port}`;

// Hugging Face unreachable and no signed index at all: the snapshot is the
// only thing that can describe this release.
const open = async () => start({
  holo, huggingFace: false, swarmIndex: `${base}/swarm/`, swarmSigned: false,
  cacheDir: await mkdtemp(join(tmpdir(), "hub-snap-")),
});
await open();
forget();
const get = (p) => handle(new Request(`http://127.0.0.1${p}`));

// Without the snapshot this is a repository that does not exist, answered 401
// the way a missing and a private repository both are (`HK-01`).
let response = await get(`/${REPO}/resolve/main/${WEIGHTS.path}`);
assert.notEqual(response.status, 401);
assert.notEqual(response.status, 404);
ok("a release only the snapshot knows is no longer answered as missing");

// It is addressed, so the kernel is willing to name a source for it; there is
// simply no source here that holds it, which is a different answer.
assert.equal(response.status, 503);
assert.equal(response.headers.get("x-error-code"), "NoSource");
ok("it reaches the question of which source holds it, rather than failing before");

// A HEAD is answered from the snapshot alone, with the SHA-256 ETag `HK-08`
// gives an addressed file, and the revision the snapshot recorded.
response = await handle(new Request(`http://127.0.0.1/${REPO}/resolve/main/${WEIGHTS.path}`, { method: "HEAD" }));
assert.equal(response.status, 200);
assert.equal(response.headers.get("etag"), `"${WEIGHTS.sha256}"`);
assert.equal(response.headers.get("x-repo-commit"), REVISION);
assert.equal(response.headers.get("content-length"), String(WEIGHTS.size));
ok("the snapshot answers a HEAD with the address and revision it recorded");

// A file the snapshot does not list is still not found, and a repository it
// does not hold is still missing.
assert.equal((await get(`/${REPO}/resolve/main/absent.bin`)).status, 404);
assert.equal((await get("/nobody/at-all/resolve/main/model.safetensors")).status, 401);
ok("a file it does not list and a repository it does not hold are unchanged");

// A shard whose bytes are not the ones the root names is refused outright,
// not read and used anyway.
corrupt = true;
await open();
forget();
assert.equal((await get(`/${REPO}/resolve/main/${WEIGHTS.path}`)).status, 401);
ok("a shard that does not match the root is refused, and the release is missing again");

console.log(`tests/runner/snapshot: ${checks} checks passed`);
process.exit(0);
