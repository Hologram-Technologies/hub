// The verified piece fetcher (web/pieces.mjs), against real Range requests.
//
//   node tests/pieces/fetch.mjs [--bench]
//
// A local server answers Range requests the way a static host does, and can be
// told to lie, to truncate or to fail. The fetcher's decision function is held
// to the kernel's four piece guarantees (HK-39 to HK-42) over every input, and
// each guarantee is then exercised end to end: lying bytes are never
// delivered, a stored piece that matches is reused and one that does not is
// fetched again, and a piece is refused only when no source is left.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { instantiate } from "../../web/piece-hash.mjs";
import {
  ANSWER,
  PIECE_LEN,
  Refused,
  createPool,
  decodeTable,
  encodeTable,
  foldTable,
  pieceCount,
  pieceDecision,
  pieceLength,
  verifiedFetch,
} from "../../web/pieces.mjs";

const WASM = fileURLToPath(new URL("../../web/piece-hash.wasm", import.meta.url));
const WORKER = new URL("./node-worker.mjs", import.meta.url);
let checks = 0;
const ok = (what) => {
  checks += 1;
  console.log(`  ok  ${what}`);
};

const local = await instantiate(await readFile(WASM));
const makeWorker = () => {
  const w = new Worker(WORKER, { workerData: { wasm: WASM } });
  const port = { postMessage: (m, t) => w.postMessage(m, t), terminate: () => w.terminate(), onmessage: null };
  w.on("message", (data) => port.onmessage({ data }));
  return port;
};
const poolOf = (size) => ({ ...createPool({ size, makeWorker, local }), parent: local.parent });

// ------------------------------------------------ the rule, over every input

const bools = [false, true];
let cases = 0;
for (const tableHolds of bools)
  for (const held of bools)
    for (const cachedMatches of bools)
      for (const observedMatches of bools)
        for (const lengthMatches of bools)
          for (const sourcesLeft of [0, 1, 2]) {
            const input = { tableHolds, held, cachedMatches, observedMatches, lengthMatches, sourcesLeft };
            const d = pieceDecision(input);
            cases += 1;
            assert.ok(Object.values(ANSWER).includes(d), `an answer outside the four: ${JSON.stringify(input)}`);
            // HK-39: delivered only when the table holds and the bytes match.
            if (d === ANSWER.deliver) assert.ok(tableHolds && observedMatches && lengthMatches, JSON.stringify(input));
            // HK-40: reused only when the table holds and the stored copy matches.
            if (d === ANSWER.reuse) assert.ok(tableHolds && held && cachedMatches, JSON.stringify(input));
            // HK-41: a matching stored copy under a holding table is always reused.
            if (tableHolds && held && cachedMatches) assert.equal(d, ANSWER.reuse, JSON.stringify(input));
            // HK-42: refused only with no source left, retried only with one.
            if (d === ANSWER.refuse) assert.equal(sourcesLeft, 0, JSON.stringify(input));
            if (d === ANSWER.retry) assert.ok(sourcesLeft > 0, JSON.stringify(input));
          }
ok(`pieceDecision keeps the kernel's four piece guarantees on all ${cases} inputs`);

// ------------------------------------------------- the hasher, against BLAKE3

const blobOf = (len, seed = 0) => {
  const b = new Uint8Array(len);
  for (let i = 0; i < len; i++) b[i] = (i * 31 + seed) % 251;
  return b;
};
const tableOf = (bytes) => {
  const n = pieceCount(bytes.length);
  const cvs = [];
  for (let i = 0; i < n; i++) cvs.push(local.piece(bytes.subarray(i * PIECE_LEN, i * PIECE_LEN + pieceLength(bytes.length, i)), i, n === 1));
  return { length: bytes.length, cvs };
};
const hex = (b) => Buffer.from(b).toString("hex");
const kappaOf = (bytes) => `blake3:${hex(foldTable(tableOf(bytes).cvs, local.parent))}`;

// Node's crypto has no BLAKE3; the hub's vendored reference implementation
// does, and it is independent of the module under test.
const { Blake3 } = await import("../../try/vendor/prism-code/src/blake3.mjs");
const reference = (bytes) => {
  const h = new Blake3();
  h.update(bytes);
  return `blake3:${hex(h.digest())}`;
};
for (const len of [0, 1, 1024, PIECE_LEN - 1, PIECE_LEN, PIECE_LEN + 1, 3 * PIECE_LEN + 5]) {
  assert.equal(kappaOf(blobOf(len)), reference(blobOf(len)), `${len} bytes`);
}
ok("pieces hashed apart and folded give the reference BLAKE3 at 0 B to 3 MiB");

const sample = blobOf(3 * PIECE_LEN + 5);
const table = tableOf(sample);
const round = decodeTable(encodeTable(table));
assert.equal(round.length, table.length);
assert.ok(round.cvs.every((cv, i) => hex(cv) === hex(table.cvs[i])));
ok("a piece table survives HPTREE01 encoding and decoding");

// --------------------------------------------------------- a static host

const files = new Map();
let hits = 0;
const hitsBy = new Map();
const server = createServer((req, res) => {
  const [, name] = req.url.split("/");
  const file = files.get(name);
  hits += 1;
  hitsBy.set(name, (hitsBy.get(name) ?? 0) + 1);
  if (!file || file.mode === "down") {
    res.writeHead(503).end();
    return;
  }
  const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? "");
  if (!m || file.mode === "norange") {
    res.writeHead(200, { "content-length": file.bytes.length }).end(Buffer.from(file.bytes));
    return;
  }
  const begin = Number(m[1]);
  const end = Math.min(Number(m[2]) + 1, file.bytes.length);
  let body = file.bytes.subarray(begin, end);
  if (file.mode === "short") body = body.subarray(0, Math.max(0, body.length - 1));
  res.writeHead(206, { "content-range": `bytes ${begin}-${end - 1}/${file.bytes.length}`, "content-length": body.length });
  res.end(Buffer.from(body));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const host = (name, bytes, mode = "ok") => {
  files.set(name, { bytes, mode });
  return { url: `${base}/${name}`, offset: 0 };
};

const kappa = kappaOf(sample);
const lying = sample.slice();
lying[PIECE_LEN + 7] ^= 1; // one byte of piece 1
const pool = poolOf(4);

{
  const stats = {};
  hitsBy.clear();
  const got = await verifiedFetch({ kappa, length: sample.length, sources: [host("good", sample)], tables: [table], pool, stats });
  assert.equal(reference(got), kappa);
  assert.equal(stats.delivered, 4);
  assert.equal(hitsBy.get("good"), 2, "four pieces, two requests: the first alone, the rest together");
  ok("with a table: every piece from a good host is delivered, the first alone and the rest in one request");
  hitsBy.clear();
  await verifiedFetch({ kappa, length: sample.length, sources: [host("good", sample)], tables: [table], pool, span: 1 });
  assert.equal(hitsBy.get("good"), 4, "span 1 asks once per piece");
  ok("span bounds how many pieces one request covers");
}
{
  const stats = {};
  const got = await verifiedFetch({ kappa, length: sample.length, sources: [host("liar", lying), host("good", sample)], tables: [table], pool, stats });
  assert.equal(reference(got), kappa);
  assert.equal(stats.retried, 1, "only the lying piece is fetched again");
  ok("HK-39, HK-42: a lying host's piece is not delivered; it is fetched from the next host, the rest are kept");
}
{
  await assert.rejects(
    verifiedFetch({ kappa, length: sample.length, sources: [host("liar", lying)], tables: [table], pool }),
    (e) => e instanceof Refused && e.piece === 1,
  );
  ok("HK-42: with no host left, the piece is refused, naming piece 1 and only it");
}
{
  await assert.rejects(
    verifiedFetch({ kappa, length: sample.length, sources: [host("short", sample, "short")], tables: [table], pool }),
    (e) => e instanceof Refused,
  );
  ok("HK-39: bytes one short of the piece are not delivered, even if their prefix matches");
}
{
  hitsBy.clear();
  const got = await verifiedFetch({ kappa, length: sample.length, sources: [host("down", sample, "down"), host("good", sample)], tables: [table], pool });
  assert.equal(reference(got), kappa);
  assert.ok(hitsBy.get("down") >= 1 && hitsBy.get("good") === 4, "the down host was asked, and the good one sent each piece");
  ok("HK-42: an unreachable host is skipped while another remains");
}
{
  const observed = [];
  await verifiedFetch({ kappa, length: sample.length, sources: [host("good", sample)], tables: [table], pool, observed });
  assert.equal(`blake3:${hex(foldTable(observed, local.parent))}`, kappa);
  ok("the chaining values observed for the bytes used fold to the address, for a judge of the caller's own");
}
{
  hitsBy.clear();
  const got = await verifiedFetch({ kappa, length: sample.length, sources: [host("whole", sample, "norange"), host("good", sample)], tables: [table], pool });
  assert.equal(reference(got), kappa);
  await assert.rejects(verifiedFetch({ kappa, length: sample.length, sources: [host("whole", sample, "norange")], tables: [table], pool }), Refused);
  ok("a host that ignores Range is no answer: its whole-file reply is never used, and the next host is");
}
{
  const forged = { length: table.length, cvs: table.cvs.map((cv, i) => (i === 2 ? new Uint8Array(32) : cv)) };
  await assert.rejects(
    verifiedFetch({ kappa, length: sample.length, sources: [host("good", sample)], tables: [forged], pool }),
    (e) => e instanceof Refused && e.piece === null,
  );
  const got = await verifiedFetch({ kappa, length: sample.length, sources: [host("good", sample)], tables: [forged, table], pool });
  assert.equal(reference(got), kappa);
  ok("HK-39: a table that does not fold to the address is never used; the next table is");
}
{
  const store = new Map();
  const memory = {
    get: async (k, i) => store.get(`${k}.${i}`) ?? null,
    put: async (k, i, b) => void store.set(`${k}.${i}`, b.slice()),
  };
  await verifiedFetch({ kappa, length: sample.length, sources: [host("good", sample)], tables: [table], pool, store: memory });
  const before = hits;
  const stats = {};
  const got = await verifiedFetch({ kappa, length: sample.length, sources: [host("good", sample)], tables: [table], pool, store: memory, stats });
  assert.equal(reference(got), kappa);
  assert.equal(stats.reused, 4);
  assert.equal(hits - before, 0, "nothing is fetched");
  ok("HK-41: stored pieces that match are reused, and no host is asked");

  const tampered = store.get(`${kappa}.2`);
  tampered[9] ^= 1;
  const stats2 = {};
  const again = await verifiedFetch({ kappa, length: sample.length, sources: [host("good", sample)], tables: [table], pool, store: memory, stats: stats2 });
  assert.equal(reference(again), kappa);
  assert.equal(stats2.reused, 3);
  assert.equal(stats2.delivered, 1);
  ok("HK-40: a stored piece changed on disk is not reused; it is fetched and checked again");
}
{
  const stats = {};
  const got = await verifiedFetch({ kappa, length: sample.length, sources: [host("liar", lying), host("good", sample)], pool, stats });
  assert.equal(reference(got), kappa);
  assert.equal(stats.retried, 1);
  await assert.rejects(verifiedFetch({ kappa, length: sample.length, sources: [host("liar", lying)], pool }), Refused);
  ok("without a table: nothing is delivered until the pieces fold to the address; a lying host is replaced whole");
}
{
  for (const len of [0, 5, PIECE_LEN]) {
    const bytes = blobOf(len, 7);
    const k = kappaOf(bytes);
    const got = await verifiedFetch({ kappa: k, length: len, sources: [host(`one${len}`, bytes)], tables: [tableOf(bytes)], pool });
    assert.equal(reference(got), k, `${len} bytes`);
  }
  ok("a one-piece address, empty included, is its own table");
}

// --------------------------------------------------------------- throughput

if (process.argv.includes("--bench")) {
  const big = blobOf(256 * PIECE_LEN, 3);
  const pieces = Array.from({ length: 256 }, (_, i) => big.subarray(i * PIECE_LEN, (i + 1) * PIECE_LEN));
  console.log(`  bench: ${cpus().length} cores, 256 MiB in 1 MiB pieces`);
  for (const size of [0, 1, 2, 4, 8, 16].filter((s) => s <= cpus().length)) {
    const p = poolOf(size);
    await Promise.all(pieces.slice(0, 8).map((b, i) => p.hash(b.slice(), i, false)));
    const t = performance.now();
    await Promise.all(pieces.map((b, i) => p.hash(b.slice(), i, false)));
    const s = (performance.now() - t) / 1000;
    console.log(`  bench: ${size ? `${size} workers` : "main thread"}`.padEnd(30), `${((256 * PIECE_LEN) / s / 1e9).toFixed(2)} GB/s (copy into each piece included)`);
    p.terminate();
  }
  const k = kappaOf(big);
  const t = performance.now();
  const p8 = poolOf(Math.min(8, cpus().length));
  const got = await verifiedFetch({ kappa: k, length: big.length, sources: [host("big", big)], tables: [tableOf(big)], pool: p8, inflight: 16 });
  const s = (performance.now() - t) / 1000;
  assert.equal(got.length, big.length);
  console.log(`  bench: verified fetch over loopback HTTP, 8 workers, 16 in flight, 8 MiB per request: ${((256 * PIECE_LEN) / s / 1e9).toFixed(2)} GB/s`);
  p8.terminate();
}

pool.terminate();
server.close();
console.log(`tests/pieces/fetch: ${checks} checks passed`);
