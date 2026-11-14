// The hub's local runner: the same Hugging Face read surface the edge answers,
// except that it carries the bytes instead of redirecting to them.
//
// `HF_ENDPOINT=http://127.0.0.1:8788` and an unmodified `huggingface_hub`,
// `hf`, transformers or llama.cpp downloads through it. The difference a user
// gets is that every byte is checked against a content address from the hub's
// signed index before it reaches them, whoever served it, and that a source
// which cannot be reached over HTTP at all - a BitTorrent swarm - becomes
// usable, because a runner that holds bytes can speak a protocol a `302`
// cannot.
//
// It decides nothing. It gathers the same facts the edge gathers, asks the
// same proved kernel with `runner` set to 1, and carries out the plan:
//
//   HK-03  a local runner is answered `serve`, never `redirect`
//   HK-05  the source it is given holds the file and has not failed for it
//   HK-07  a healthy source is chosen whenever a usable one exists
//   HK-19  a source nobody vetted is chosen only for a file the record
//          addresses, so bytes from the swarm are always checkable
//   HK-10  the bytes are delivered exactly when their digest and size match
//
// The fourth source slot is `pirateface`, and it is never vetted. That is not
// a judgement about Pirate Face; it is what the word means here. A vetted
// source is one the edge may redirect a client to, and no client can be
// redirected to a magnet link. `HK-04` therefore keeps the swarm off the edge
// for every input, and `HK-19` keeps it off any file whose bytes we could not
// check afterwards - both proved, neither enforced by this file.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import * as edge from "../edge/edge.mjs";
import { holdings, search } from "./discover.mjs";
import * as snapshot from "./snapshot.mjs";
import { lookup, fetchTorrent } from "./pirateface.mjs";
import { announce, fetchPieces, peerId } from "./swarm.mjs";
import { findFile, piecesOf, readMagnet } from "./torrent.mjs";
import { checkTensorsOfFile, loadManifest } from "./uor.mjs";

const HF = "https://huggingface.co";
// The edge's three, and the swarm as the fourth. The kernel has exactly four
// slots, so this list is full; a fifth source would move the resolve request
// from 105 bytes to 109 and re-prove every theorem that names the slots.
export const SOURCES = [...edge.SOURCES, "pirateface"];
const UNVETTED = new Set(["pirateface"]);
const LOOKUP_TTL = 300_000;

let settings = {
  cacheDir: join(tmpdir(), "hologram-hub-cache"), manifests: null, drain: new Set(),
  // Overridable so a test can stand a swarm index in front of the runner.
  piratefaceHost: undefined,
};
let addresses = null;
let manifestCache = new Map();
const lookups = new Map();
const torrents = new Map();
// One fetch per file in flight at a time. A client that gives up and retries
// would otherwise start a second download of the same file, and two downloads
// of one torrent compete for the same peers and both go slower. Measured: a
// `huggingface_hub` retry loop started four concurrent swarm fetches and none
// of them finished.
const inflight = new Map();
const quarantined = new Set();
const id = peerId();

export async function start({ holo, index, manifests = null, huggingFace = true, drain = [], cacheDir, piratefaceHost, swarmIndex = null, swarmSigned = true } = {}) {
  const ready = await edge.start({ holo, index, huggingFace, drain });
  addresses = null;
  if (swarmIndex) {
    try {
      // Checked against the same pinned roots the index is, when the
      // kernel's trust policy is available to check against.
      addresses = await snapshot.open(swarmIndex, {
        policy: edge.loaded().trust,
        required: swarmSigned,
      });
    } catch (error) {
      addresses = null;
      console.error(`runner: the swarm address snapshot was refused (${error.message})`);
    }
  }
  settings = {
    cacheDir: cacheDir ?? settings.cacheDir,
    manifests,
    drain: new Set(drain),
    piratefaceHost,
  };
  await mkdir(settings.cacheDir, { recursive: true });
  return {
    ...ready, runner: "local", sources: SOURCES, cache: settings.cacheDir,
    addressed: snapshot.count(addresses),
  };
}

// ------------------------------------------------------------------ facts
// What Pirate Face holds for a repository, cached, and never used unless its
// revision is the revision the hub's own record names.
async function swarmHolding(repo, revision) {
  const hit = lookups.get(repo);
  if (hit && hit.at > Date.now() - LOOKUP_TTL) return match(hit.value, revision);
  let value = null;
  try {
    value = await lookup(repo, swarmHost());
  } catch {
    value = null;
  }
  lookups.set(repo, { at: Date.now(), value });
  return match(value, revision);
}
const swarmHost = () => (settings.piratefaceHost ? { host: settings.piratefaceHost } : {});
const match = (found, revision) => (found && revision && found.revision === revision ? found : null);

const enc = new TextEncoder();
// Same discovery the edge makes, for the same reason: this runner can be
// newer than the holo it loads.
let resolveWidth = 105;
async function decide(kernel, facts) {
  const plan = await kernel.dispatch(resolveRequest(facts, resolveWidth));
  if (plan[0] !== 0 || resolveWidth === 104) return plan;
  const older = await kernel.dispatch(resolveRequest(facts, 104));
  if (older[0] === 0) return plan;
  resolveWidth = 104;
  return older;
}
function resolveRequest({ repo, revisionKind, refFound, requested, commit, entry, addressed, pin, slots }, width) {
  const b = new Uint8Array(width);
  // Byte 1 is the runner: 1 says this one serves bytes rather than redirecting.
  b.set([1, 1, repo, revisionKind, refFound, revisionKind === 1 ? requested.length : 0, entry, pin]);
  slots.forEach((s, i) => b.set([s.holds, s.healthy, s.vetted, s.failed], 8 + 4 * i));
  if (revisionKind === 1) b.set(enc.encode(requested).subarray(0, 40), 24);
  if (commit) b.set(enc.encode(commit).subarray(0, 40), 64);
  // Byte 104 is whether the record addresses this file, which is what decides
  // whether the swarm may serve it. Byte 6 decides the ETag instead. A kernel
  // from before that field is asked the shorter request and decides as it did,
  // which for the swarm means weights only.
  if (width > 104) b[104] = addressed;
  return b;
}

// ------------------------------------------------------------------ bytes
const cachePath = (address) => join(settings.cacheDir, address.slice(0, 2), address);

async function cached(address) {
  if (!address) return null;
  try {
    const path = cachePath(address);
    const info = await stat(path);
    return info.isFile() ? { path, size: info.size } : null;
  } catch {
    return null;
  }
}

async function fetchHttp(url, destination, timeoutMs = 30 * 60000) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  await mkdir(dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

// One file out of the swarm. Every piece is checked against the torrent's own
// commitment before it is written, and the pieces at either end hold bytes of
// neighbouring files which are written and then ignored.
async function fetchSwarm(found, path, destination, onNote) {
  if (!torrents.has(found.infohash)) torrents.set(found.infohash, await fetchTorrent(found, swarmHost()));
  const torrent = torrents.get(found.infohash);
  const file = findFile(torrent, path);
  if (!file) throw new Error(`${path} is not in torrent ${torrent.infohash}`);
  const wanted = piecesOf(torrent, file);
  const http = found.trackers.filter((t) => /^https?:\/\//.test(t));
  if (!http.length) throw new Error("this torrent names no HTTP tracker, and this runner speaks no UDP tracker or DHT");
  let peers = [];
  for (const tracker of http) {
    try {
      peers = peers.concat(await announce({ tracker, infohashBytes: torrent.infohashBytes, id, left: file.length }));
    } catch (error) {
      onNote(`tracker ${tracker}: ${error.message}`);
    }
  }
  if (!peers.length) throw new Error("no tracker named a peer");
  onNote(`${peers.length} peers, ${wanted.length} pieces for ${path}`);

  // Pieces arrive in whatever order peers give them. Each is written straight
  // to its own offset in the file, so nothing is held in memory waiting for
  // the piece before it.
  await mkdir(dirname(destination), { recursive: true });
  const out = await open(destination, "w");
  try {
    await fetchPieces(torrent, wanted, peers, {
      id, onNote,
      onPiece: async (index, bytes) => {
        const pieceStart = index * torrent.pieceLength;
        const from = Math.max(0, file.offset - pieceStart);
        const to = Math.min(bytes.length, file.offset + file.length - pieceStart);
        if (from < to) await out.write(bytes, from, to - from, pieceStart + from - file.offset);
      },
    });
  } finally {
    await out.close();
  }
}

// ------------------------------------------------------------------ HTTP
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "x-repo-commit, x-linked-etag, x-linked-size, etag, x-error-code, x-error-message, x-hub-source, x-hub-runner, x-hub-tensors, x-hub-partial, link, accept-ranges, content-range",
};

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 1), {
  status, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
});

function refuse(answer, method) {
  const { dialect } = edge.loaded();
  const d = dialect.get(answer) ?? dialect.get("other");
  const headers = { ...CORS, "content-type": "application/json", "cache-control": "no-store", "x-error-message": d.message };
  if (d.error) headers["x-error-code"] = d.error;
  if (answer === 10 || answer === 13) headers["www-authenticate"] = "Bearer";
  return new Response(method === "HEAD" ? null : JSON.stringify({ error: d.message }), { status: d.status, headers });
}

function served(method, file, head, range) {
  const headers = {
    ...CORS,
    "content-type": "application/octet-stream",
    etag: `"${head.etag}"`,
    "x-linked-etag": `"${head.etag}"`,
    "x-linked-size": String(head.size),
    "x-repo-commit": head.commit,
    "x-hub-source": head.source,
    "x-hub-runner": "local",
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  };
  if (head.tensors) headers["x-hub-tensors"] = head.tensors;
  if (!range) {
    headers["content-length"] = String(head.size);
    return new Response(method === "HEAD" ? null : Readable.toWeb(createReadStream(file)), { status: 200, headers });
  }
  const { start, end } = range;
  headers["content-length"] = String(end - start + 1);
  headers["content-range"] = `bytes ${start}-${end}/${head.size}`;
  return new Response(method === "HEAD" ? null : Readable.toWeb(createReadStream(file, { start, end })), { status: 206, headers });
}

function wantedRange(request, size) {
  const header = request.headers.get("range");
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (!Number.isFinite(start) || start > end || start < 0) return null;
  return { start, end };
}

// ----------------------------------------------------------------- resolve
async function serveFile(request, via, repo, revision, path, onNote) {
  const { kernel } = edge.loaded();
  const method = request.method;
  let info = await edge.release(repo, revision);
  // Neither the signed index nor Hugging Face can describe this release.
  // The snapshot holds Hugging Face's own addresses for it, written down
  // while Hugging Face was still answering, so the swarm's bytes can still
  // be checked against a digest that is not the swarm's own.
  if (info.state !== 0 || !info.revision) {
    const kept = await snapshot.release(addresses, repo).catch(() => null);
    if (kept && (revision === "main" || revision === kept.sha || kept.sha.startsWith(revision))) info = kept;
  }
  const commitKind = /^[0-9a-f]{7,40}$/.test(revision) ? 1 : 0;
  const held = info.state === 0 && info.revision ? edge.holders(info) : null;
  const sibling = info.siblings?.get(path);
  const lfs = sibling?.lfs;
  const entry = info.state === 0 && info.revision ? (sibling ? (lfs ? 2 : 1) : 0) : 0;
  const swarm = info.state === 0 && info.revision ? await swarmHolding(repo, info.sha) : null;
  // A second witness can address a file Hugging Face never did. Taking the
  // address from it keeps `check` on its SHA-256 path, which is what makes a
  // source nobody vetted safe to use for this file; the git blob identity
  // below is a SHA-1 and is not a check to put in front of a hostile source.
  // `edge.addressOf` is the same function the edge fills `addressed` from, so
  // the kernel never permits a file this cannot then verify.
  const address = lfs?.sha256 ?? edge.addressOf(info.record, path);

  // A source this request already asked and could not get the file from. The
  // kernel reads two different facts here and the runner must not confuse
  // them: `failed` means the source sent bytes that are not this file, which
  // is a lasting judgement about that copy, while a source that timed out or
  // answered 404 has simply not got it now. The second is `holds`, for this
  // request only.
  const silent = new Set();
  const build = () => SOURCES.map((kind) => {
    let holds = 0;
    if (silent.has(kind)) return { kind, holds: 0, healthy: 0, vetted: UNVETTED.has(kind) ? 0 : 1, failed: 0 };
    if (kind === "huggingface.co") holds = sibling ? 1 : 0;
    else if (kind === "pirateface") holds = swarm?.addresses.has(path) ? 1 : 0;
    else {
      const s = held?.sources?.find((x) => x.kind === kind);
      holds = s?.resolve && held.revision === info.sha && sibling && !s.missing?.includes(path) ? 1 : 0;
    }
    const vetted = UNVETTED.has(kind) ? 0 : 1;
    const fresh = kind === "pirateface"
      ? (!settings.drain.has(kind) && (swarm?.seeders ?? 0) > 0 ? 1 : 0)
      : (edge.healthy(kind) ? 1 : 0);
    const failed = quarantined.has(`${kind}:${address ?? sibling?.blobId}`) ? 1 : 0;
    return { kind, holds, healthy: fresh, vetted, failed };
  });

  const pin = via === null ? 0 : SOURCES.indexOf(via) >= 0 ? SOURCES.indexOf(via) + 1 : 5;
  const manifest = await witnessed(repo);

  // One attempt per source the kernel is willing to name. A source that sends
  // other bytes is quarantined for this address, which makes `failed` 1 for
  // it, and `HK-05` then keeps the kernel from choosing it again.
  for (let attempt = 0; attempt < SOURCES.length; attempt += 1) {
    const slots = build();
    const plan = await decide(kernel, {
      repo: info.state, revisionKind: commitKind, refFound: info.revision ? 1 : 0,
      requested: revision, commit: info.sha ?? "", entry,
      addressed: edge.checkable(info.record, path) ? 1 : 0, pin, slots,
    });
    const [answer, slot, etagKind] = plan;
    // HK-03 proves a local runner is never told to redirect, for every input.
    if (answer !== 2) return refuse(answer, method);
    const source = slots[slot].kind;
    const etag = etagKind === 2 ? lfs.sha256 : sibling.blobId;

    // A HEAD asks what the file is, not for it. Everything the answer carries
    // - the ETag, the size, the commit, the source the kernel chose - comes
    // from facts the record already holds, so fetching bytes to answer one
    // would download a whole weight file to describe it. `huggingface_hub`
    // sends a HEAD before every download.
    if (method === "HEAD") {
      return served(method, null, { etag, size: sibling.size, commit: info.sha, source, tensors: null }, null);
    }

    // The cache is addressed by whatever address the record names, so a hit
    // needs no source at all. A pinned request skips it, because asking for
    // `/via/<source>` is asking to exercise that source.
    const key = address ?? sibling.blobId;
    const hit = pin === 0 ? await cached(key) : null;
    let file = hit?.path ?? null;
    let tensors = null;

    if (!file) {
      // One fetch per file at a time, and the fetch verifies before it
      // returns. Both matter: a waiter must never be handed a path the owner
      // is about to move, and a client that gives up and retries must not
      // start a second download that competes with the first for the same
      // peers.
      const job = inflight.get(key) ?? (() => {
        const made = (async () => {
          const into = join(settings.cacheDir, "partial", `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
          try {
            if (source === "pirateface") await fetchSwarm(swarm, path, into, onNote);
            else {
              const target = source === "huggingface.co"
                ? `${HF}/${repo}/resolve/${info.sha}/${path}`
                : `${held.sources.find((x) => x.kind === source).resolve}${path}`;
              await fetchHttp(target, into);
            }
          } catch (error) {
            await unlink(into).catch(() => {});
            throw Object.assign(error, { unreachable: true });
          }
          const verdict = await check(kernel, into, { address, size: sibling.size, blobId: sibling.blobId, entry });
          if (!verdict.ok) {
            await unlink(into).catch(() => {});
            throw new Error(verdict.why);
          }
          // Verified, so it may be named by its address. Every consumer of
          // this job gets the same settled path.
          const destination = cachePath(key);
          await mkdir(dirname(destination), { recursive: true });
          await rename(into, destination).catch(() => {});
          return (await cached(key))?.path ?? into;
        })();
        inflight.set(key, made);
        made.catch(() => {}).then(() => inflight.delete(key));
        return made;
      })();
      try {
        file = await job;
      } catch (error) {
        if (error.unreachable) {
          onNote(`${source} could not deliver ${repo}/${path}: ${error.message}`);
          silent.add(source);
        } else {
          onNote(`${source} sent bytes that are not ${repo}/${path}: ${error.message}`);
          quarantined.add(`${source}:${key}`);
        }
        edge.report(source, false);
        continue;
      }
    }

    // The UOR check: the file is intact, and these are the tensors this
    // repository witnessed. A file that passes its address but fails a
    // witnessed tensor means two signed artifacts disagree, which is reported
    // rather than served.
    if (manifest && path.endsWith(".safetensors")) {
      const seen = await checkTensorsOfFile(manifest, path, file);
      if (seen.witnessed && seen.mismatched.length) {
        onNote(`${repo}/${path}: ${seen.mismatched.length} tensors do not match the signed manifest`);
        quarantined.add(`${source}:${key}`);
        continue;
      }
      if (seen.witnessed) tensors = `${seen.matched}/${seen.total}`;
    }

    if (!hit) edge.report(source, true);
    const size = sibling.size;
    // A cache hit is named as one rather than credited to the source the
    // kernel would have used, because no source was asked.
    return served(method, file, {
      etag, size, commit: info.sha, source: hit ? "cache" : source, tensors,
    }, wantedRange(request, size));
  }
  // Every source the kernel would name has now failed for this file.
  return refuse(17, method);
}

// Every address the record has, not the first one it has.
//
// `HK-10` decides the SHA-256, from the expected and observed digest and size.
// The git blob identity is compared here instead - tested, not proved - and
// for a small file it is the only address Hugging Face publishes at all.
//
// Both are checked when both exist, and either failing refuses. That is not
// belt and braces; the two differ in who chose them. A SHA-256 may come from
// a second witness, and a witness can also be a source: `pirateface.co`
// witnesses addresses and `pirateface` serves bytes. Checking bytes from a
// source against a digest that source supplied proves nothing, so the git
// blob - which only Hugging Face ever published, and which this repository
// signed into the record - is what actually stands between an unvetted source
// and a client. Taking the SHA-256 as sufficient would replace an independent
// check with a circular one, which is strictly worse than having only the
// independent one.
//
// A file with neither is refused. Nothing passes for want of something to
// check it against.
export async function check(kernel, file, { address, size, blobId, entry }) {
  const info = await stat(file);
  if (!address && !blobId) return { ok: false, why: "the record names no address for this file at all" };
  if (entry === 2 && !address) return { ok: false, why: "the record names no digest for a file it calls large" };

  // One pass over the bytes for both digests. The git blob prefix carries the
  // length actually read, so a file of the wrong size fails it without a
  // separate comparison.
  // `gitSha1` is the git blob of whatever git holds for the file, and for an
  // LFS entry git holds a 134-byte pointer rather than the bytes. Measured on
  // `openai-community/gpt2`: `64-8bits.tflite` is 125,162,496 bytes and its
  // `gitSha1` hashes the pointer. So it checks the content only where the file
  // is not LFS - which is exactly where Hugging Face publishes no SHA-256 and
  // the git blob is the only address there is.
  const whole = entry !== 2 && Boolean(blobId);
  const sha = createHash("sha256");
  const blob = whole ? createHash("sha1").update(`blob ${info.size}\0`) : null;
  for await (const chunk of createReadStream(file)) {
    sha.update(chunk);
    blob?.update(chunk);
  }

  if (blob) {
    const found = blob.digest("hex");
    if (found !== blobId) return { ok: false, why: `git blob ${found}, the record says ${blobId}` };
  }

  if (address) {
    const observed = sha.digest("hex");
    const request = new Uint8Array(81);
    request[0] = 2;
    request.set(Buffer.from(address, "hex"), 1);
    request.set(Buffer.from(observed, "hex"), 33);
    new DataView(request.buffer).setBigUint64(65, BigInt(size));
    new DataView(request.buffer).setBigUint64(73, BigInt(info.size));
    if ((await kernel.dispatch(request))[0] !== 20) {
      return { ok: false, why: `sha256 ${observed} and ${info.size} bytes, the record says ${address} and ${size}` };
    }
  }

  return { ok: true, by: blob && address ? "git blob and sha256" : blob ? "git blob" : "sha256" };
}

async function witnessed(repo) {
  if (!settings.manifests) return null;
  if (manifestCache.has(repo)) return manifestCache.get(repo);
  const { trust } = edge.loaded();
  const manifest = await loadManifest(settings.manifests, repo, trust).catch(() => null);
  manifestCache.set(repo, manifest);
  return manifest;
}

export async function handle(request, { onNote = () => {} } = {}) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...CORS, "access-control-allow-methods": "GET, HEAD, POST", "access-control-allow-headers": "*" } });
  }
  let path = url.pathname.replace(/^\/+/, "");
  let via = null;
  const pinned = path.match(/^via\/([^/]+)\/(.*)$/);
  if (pinned) { via = pinned[1]; path = pinned[2]; }
  const file = path.match(/^([\w.-]+\/[\w.-]+)\/resolve\/([^/]+)\/(.+)$/);
  if (file && (request.method === "GET" || request.method === "HEAD")) {
    try {
      return await serveFile(request, via, file[1], decodeURIComponent(file[2]), decodeURIComponent(file[3]), onNote);
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error?.message ?? error) }), {
        status: 502, headers: { ...CORS, "content-type": "application/json", "x-error-message": "The runner could not reach a source" },
      });
    }
  }
  // Every model the swarm lists, answered live. There are far more of them
  // than this hub indexes - 669k listed against 415 indexed, measured
  // 2026-11-14 - and nothing is gained by snapshotting a seeder count that
  // changes by the minute. What this cannot do is vouch for any of it: these
  // are Pirate Face's claims, and whether a model's bytes can be checked is a
  // different question, answered per file by `HK-19`.
  if (path === "api/swarm/search" && (request.method === "GET" || request.method === "HEAD")) {
    const q = url.searchParams.get("q") ?? "";
    if (!q) return json({ error: "ask for something: /api/swarm/search?q=<query>" }, 400);
    let rows;
    try {
      rows = await search(q, swarmHost());
    } catch (error) {
      return json({ query: q, error: String(error?.message ?? error) }, 502);
    }
    return json({
      query: q,
      found: rows.length,
      claimedBy: "pirateface.co",
      checked: false,
      note: "Pirate Face's own listing, relayed unchecked. Seeder counts are its claims. Whether a file's bytes can be checked is decided per file against an address from somewhere else (HK-19); ask /api/swarm/{repo} for that.",
      models: rows.map((r) => ({
        repo: r.repo,
        size: r.size,
        seeders: r.seeders,
        infohash: (() => { try { return readMagnet(r.magnet).infohash; } catch { return null; } })(),
      })),
    });
  }

  // What the swarm holds for one model, and how much of it this hub could
  // actually check. The two are different questions and the answer keeps them
  // apart: peers decide whether bytes can be got, addresses decide whether
  // they can be believed, and `HK-19` refuses a file that has no address
  // however many peers hold it.
  const swarm = path.match(/^api\/swarm\/([\w.-]+\/[\w.-]+)$/);
  if (swarm && (request.method === "GET" || request.method === "HEAD")) {
    const repo = swarm[1];
    const rec = await edge.release(repo, "main").catch(() => null);
    const addressed = rec?.siblings ? [...rec.siblings.values()].filter((s) => s.lfs?.sha256).length : null;
    let held = null;
    try {
      held = await holdings(repo, { ...swarmHost(), revision: rec?.sha ?? null });
    } catch (error) {
      return json({ repo, error: String(error?.message ?? error) }, 502);
    }
    if (!held) return json({ repo, swarm: null, why: "no torrent is listed for this repository" }, 404);
    return json({
      ...held,
      servable: addressed === null ? null : { addressed, files: rec.siblings.size },
    });
  }

  if (path === "" || path === "health") {
    const { kernel, index, useHuggingFace } = edge.loaded();
    return new Response(JSON.stringify({
      runner: "local", kernel: Boolean(kernel), index: index ? index.records.size : 0,
      huggingFace: useHuggingFace, sources: SOURCES, cache: settings.cacheDir,
      addressed: snapshot.count(addresses),
    }), { status: 200, headers: { ...CORS, "content-type": "application/json" } });
  }
  // Everything that is not a file request is metadata, and the edge already
  // answers it from the same signed index.
  return edge.handle(request);
}

// For tests: forget what a source did, so a case starts clean.
export function forget() {
  quarantined.clear();
  lookups.clear();
  torrents.clear();
  manifestCache = new Map();
}
