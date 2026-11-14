// Discovery, against a swarm index standing right here.
//
// Finding a model and being able to check it are different questions, and the
// point of these checks is that the answer never conflates them: a torrent
// whose metadata does not hash to the infohash it was fetched as is refused
// outright, and a revision that is not the one the index knows is reported as
// such rather than quietly used.
//
//   node tests/runner/discover.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { holdings, search } from "../../runner/discover.mjs";

let checks = 0;
const ok = (what) => { checks += 1; console.log(`  ok  ${what}`); };

// A bencode encoder, for this test only.
function encode(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  if (typeof value === "string") return encode(Buffer.from(value, "utf8"));
  if (typeof value === "number") return Buffer.from(`i${value}e`);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from("l"), ...value.map(encode), Buffer.from("e")]);
  const keys = Object.keys(value).sort();
  return Buffer.concat([Buffer.from("d"), ...keys.flatMap((k) => [encode(k), encode(value[k])]), Buffer.from("e")]);
}

const PIECE = 32;
const files = [{ path: ["model.safetensors"], length: 64 }];
const pieces = Buffer.concat([0, 1].map((i) => createHash("sha1").update(Buffer.alloc(PIECE, i)).digest()));
const info = { name: "tiny", "piece length": PIECE, pieces, files };
const torrent = encode({ info });
const infohash = createHash("sha1").update(encode(info)).digest("hex");
const REPO = "testing/tiny";
const REVISION = "b".repeat(40);
let serveTampered = false;

const port = await new Promise((resolve) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (status, body, type) => {
      res.writeHead(status, { "content-type": type, "content-length": body.length });
      res.end(body);
    };
    if (url.pathname.startsWith("/s/")) {
      // Padded columns, a header line and a blank line, as the real one has.
      return send(200, Buffer.from([
        "# models with torrents",
        `${REPO}                                   64 B     7 seeds  magnet:?xt=urn:btih:${infohash}&tr=http%3A%2F%2Ft.example%2Fannounce`,
        "not a row at all",
        "",
      ].join("\n")), "text/plain");
    }
    if (url.pathname === "/api/torrents") {
      if (url.searchParams.get("repo") !== REPO) return send(404, Buffer.from("{}"), "application/json");
      return send(200, Buffer.from(JSON.stringify({
        repoId: REPO, revision: REVISION, seeders: 7, leechers: 1, infohash,
        files: [{ path: "model.safetensors", sha256: "a".repeat(64) }],
        magnet: `magnet:?xt=urn:btih:${infohash}&tr=http%3A%2F%2Ft.example%2Fannounce`,
        torrent: `/api/torrents/${infohash}.torrent`,
      })), "application/json");
    }
    if (url.pathname.endsWith(".torrent")) {
      const body = Buffer.from(torrent);
      if (serveTampered) body[body.indexOf(pieces)] ^= 0x01;
      return send(200, body, "application/x-bittorrent");
    }
    return send(404, Buffer.from("{}"), "application/json");
  }).listen(0, "127.0.0.1", () => resolve(server.address().port));
});
const host = `http://127.0.0.1:${port}`;

const rows = await search("tiny", { host });
assert.equal(rows.length, 1);
assert.deepEqual({ repo: rows[0].repo, size: rows[0].size, seeders: rows[0].seeders }, { repo: REPO, size: "64 B", seeders: 7 });
assert.ok(rows[0].magnet.startsWith("magnet:?xt=urn:btih:"));
ok("the plain-text catalog parses, and a line that is not a row is not one");

const held = await holdings(REPO, { host, revision: REVISION });
assert.equal(held.infohash, infohash);
assert.equal(held.matchesIndex, true);
assert.equal(held.checked, true);
assert.equal(held.files, 1);
assert.equal(held.seeders, 7);
assert.equal(held.addresses, 1);
ok("a repository's holdings are read, and the infohash recomputed from the metadata");

const other = await holdings(REPO, { host, revision: "c".repeat(40) });
assert.equal(other.matchesIndex, false);
ok("a torrent of another revision is reported as not matching, not silently used");

assert.equal(await holdings("nobody/at-all", { host }), null);
ok("a repository with no torrent is absent rather than empty");

// The metadata is the only thing a caller could be deceived by, so it is the
// thing that must be checked rather than believed.
serveTampered = true;
await assert.rejects(() => holdings(REPO, { host, revision: REVISION }), /hashes to/);
ok("metadata that does not hash to the infohash it was fetched as is refused");

console.log(`tests/runner/discover: ${checks} checks passed`);
process.exit(0);
