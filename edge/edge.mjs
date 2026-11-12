// The hub's edge runner: a stateless HTTP handler that answers the Hugging Face
// Hub's read surface, so `HF_ENDPOINT=<this origin>` works for every Hugging
// Face tool. It decides nothing itself. For a file it gathers facts (the
// release, the file, which sources hold it, which are healthy) and asks the
// proved kernel; it turns the kernel's plan into HTTP with the kernel's own
// dialect table. It never carries model bytes: it redirects, and only to
// vetted sources (HK-03, HK-04). Metadata routes are Hugging Face's own
// answers, passed through without the Xet fields, so clients download over
// plain HTTP from the sources the kernel chose.
//
// The handler is a standard fetch handler: `edge/serve.mjs` runs it on Node,
// and the same module runs on any runtime with fetch and WebAssembly.
import { load } from "../try/vendor/prism-code/src/browser.mjs";

const HF = "https://huggingface.co";
const INDEX = "https://gethologram.ai/data/files";
// Source slots, in the order the kernel prefers them when all are healthy.
const SOURCES = ["huggingface.co", "modelscope.cn", "ipfs"];
const TTL = 60_000;

let kernel = null;
let dialect = null;
const cache = new Map();
const health = new Map(SOURCES.map((s) => [s, { failures: 0, until: 0 }]));
const quarantined = new Set();

export async function start(holoUrl) {
  kernel = await load(holoUrl);
  if (!kernel.identities.verified) throw new Error("the kernel's holo failed its identity check");
  const run = await kernel.acceptance();
  if (run.passed !== run.total) throw new Error(`the kernel replayed ${run.passed} of ${run.total} examples`);
  // Route 4 is the docs screen; its answers table is the dialect: kernel answer
  // -> HTTP status, X-Error-Code, message.
  const docs = JSON.parse(new TextDecoder().decode(await kernel.dispatch(new Uint8Array([3, 4]))));
  dialect = new Map(docs.answers.filter(([code]) => typeof code === "number").map(([code, status, error, message]) => [code, { status, error: error === "none" ? "" : error, message }]));
  dialect.set("other", Object.fromEntries(["status", "error", "message"].map((k, i) => [k, docs.answers.find(([c]) => typeof c !== "number")[i + 1]])));
  return { examples: run.total, fingerprint: kernel.identities.archiveFingerprint };
}

async function cached(key, make) {
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - TTL) return hit.value;
  const value = await make();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return value;
}

// ---------------------------------------------------------------- facts
// Repository state the kernel reads: 0 public, 1 missing, 2 private, 3 gated, 4 disabled.
async function release(repo, revision) {
  return cached(`info:${repo}@${revision}`, async () => {
    const r = await fetch(`${HF}/api/models/${repo}/revision/${encodeURIComponent(revision)}?blobs=true`, { signal: AbortSignal.timeout(15000) });
    if (r.status === 401 || r.status === 404) {
      const code = r.headers.get("x-error-code");
      if (code === "RevisionNotFound") return { state: 0, revision: false };
      if (code === "GatedRepo") return { state: 3 };
      return { state: r.status === 401 ? 2 : 1 };
    }
    if (r.status === 403) return { state: 4 };
    if (!r.ok) throw new Error(`Hugging Face answered ${r.status}`);
    const info = await r.json();
    if (info.gated) return { state: 3 };
    if (info.disabled) return { state: 4 };
    return { state: 0, revision: true, sha: info.sha, siblings: new Map(info.siblings.map((s) => [s.rfilename, s])) };
  });
}

async function holders(repo) {
  return cached(`index:${repo}`, async () => {
    try {
      const r = await fetch(`${INDEX}/${repo}.json`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  });
}

function healthy(source) {
  const h = health.get(source);
  return !h || h.until < Date.now();
}
export function report(source, ok) {
  const h = health.get(source);
  if (!h) return;
  if (ok) { h.failures = 0; h.until = 0; return; }
  h.failures += 1;
  if (h.failures >= 3) h.until = Date.now() + 60_000;
}

const enc = new TextEncoder();
function resolveRequest({ repo, revisionKind, refFound, requested, commit, entry, pin, slots }) {
  const b = new Uint8Array(104);
  b.set([1, 0, repo, revisionKind, refFound, revisionKind === 1 ? requested.length : 0, entry, pin]);
  slots.forEach((s, i) => b.set([s.holds, s.healthy, s.vetted, s.failed], 8 + 4 * i));
  if (revisionKind === 1) b.set(enc.encode(requested).subarray(0, 40), 24);
  if (commit) b.set(enc.encode(commit).subarray(0, 40), 64);
  return b;
}

// ---------------------------------------------------------------- HTTP
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "x-repo-commit, x-linked-etag, x-linked-size, etag, x-error-code, x-error-message, x-hub-source, link, accept-ranges, content-range, x-xet-cas-url, x-xet-access-token, x-xet-token-expiration",
};
function refuse(answer, method) {
  const d = dialect.get(answer) ?? dialect.get("other");
  const headers = { ...CORS, "content-type": "application/json", "cache-control": "no-store", "x-error-message": d.message };
  if (d.error) headers["x-error-code"] = d.error;
  if (answer === 10 || answer === 13) headers["www-authenticate"] = "Bearer";
  return new Response(method === "HEAD" ? null : JSON.stringify({ error: d.message }), { status: d.status, headers });
}

async function resolve(method, via, repo, revision, path) {
  const info = await release(repo, revision);
  const commitKind = /^[0-9a-f]{7,40}$/.test(revision) ? 1 : 0;
  const index = info.state === 0 && info.revision ? await holders(repo) : null;
  const sibling = info.siblings?.get(path);
  const lfs = sibling?.lfs;
  const slots = SOURCES.map((kind) => {
    let holds = 0;
    if (kind === "huggingface.co") holds = sibling ? 1 : 0;
    else {
      const s = index?.sources?.find((x) => x.kind === kind);
      // The hub's index knows which source holds which file, for the revision it indexed.
      holds = s?.resolve && index.revision === info.sha && sibling && !s.missing?.includes(path) ? 1 : 0;
    }
    const failed = quarantined.has(`${kind}:${lfs?.sha256 ?? sibling?.blobId}`) ? 1 : 0;
    return { kind, holds, healthy: healthy(kind) ? 1 : 0, vetted: 1, failed };
  });
  slots.push({ kind: null, holds: 0, healthy: 0, vetted: 0, failed: 0 });
  const pin = via === null ? 0 : SOURCES.indexOf(via) >= 0 ? SOURCES.indexOf(via) + 1 : 5;
  const plan = await kernel.dispatch(resolveRequest({
    repo: info.state,
    revisionKind: commitKind,
    refFound: info.revision ? 1 : 0,
    requested: revision,
    commit: info.sha ?? "",
    entry: info.state === 0 && info.revision ? (sibling ? (lfs ? 2 : 1) : 0) : 0,
    pin,
    slots,
  }));
  const [answer, slot, etagKind] = plan;
  if (answer !== 1) return refuse(answer, method);
  const source = slots[slot].kind;
  const etag = etagKind === 2 ? lfs.sha256 : sibling.blobId;
  const target = source === "huggingface.co"
    ? `${HF}/${repo}/resolve/${info.sha}/${path}`
    : `${index.sources.find((x) => x.kind === source).resolve}${path}`;
  return new Response(null, {
    status: 302,
    headers: {
      ...CORS,
      location: target,
      "x-repo-commit": info.sha,
      "x-linked-etag": `"${etag}"`,
      etag: `"${etag}"`,
      "x-linked-size": String(sibling.size),
      "accept-ranges": "bytes",
      "x-hub-source": source,
      "cache-control": "no-store",
    },
  });
}

// Hugging Face's own answer, without the fields that would let a client skip
// the resolve call (and so the kernel's choice of source), and with its
// next-page links pointing here. A Xet read token is passed through: a client
// only asks for one after its HEAD followed the kernel's redirect to Hugging
// Face, so the bytes still come from the source the kernel chose.
async function passthrough(request, url, upstreamPath) {
  const target = `${HF}${upstreamPath}${url.search}`;
  const init = { method: request.method, headers: { accept: request.headers.get("accept") ?? "application/json" } };
  if (request.method === "POST") {
    init.body = await request.text();
    init.headers["content-type"] = request.headers.get("content-type") ?? "application/x-www-form-urlencoded";
  }
  const r = await fetch(target, init);
  const headers = { ...CORS, "content-type": r.headers.get("content-type") ?? "application/json", "cache-control": "no-store" };
  for (const h of ["x-error-code", "x-error-message", "x-total-count", "x-xet-cas-url", "x-xet-access-token", "x-xet-token-expiration"]) {
    if (r.headers.get(h)) headers[h] = r.headers.get(h);
  }
  const link = r.headers.get("link");
  if (link) headers.link = link.replaceAll(HF, url.origin);
  let body = await r.text();
  if (r.ok && headers["content-type"].includes("json")) {
    body = JSON.stringify(JSON.parse(body), (k, v) => (k === "xetHash" || k === "xetEnabled" ? undefined : v));
  }
  return new Response(request.method === "HEAD" ? null : body, { status: r.status, headers });
}

export async function handle(request) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...CORS, "access-control-allow-methods": "GET, HEAD, POST", "access-control-allow-headers": "*" } });
  let path = url.pathname.replace(/^\/+/, "");
  let via = null;
  const pinned = path.match(/^via\/([^/]+)\/(.*)$/);
  if (pinned) { via = pinned[1]; path = pinned[2]; }
  try {
    const file = path.match(/^([\w.-]+\/[\w.-]+)\/resolve\/([^/]+)\/(.+)$/);
    if (file && (request.method === "GET" || request.method === "HEAD")) {
      return await resolve(request.method, via, file[1], decodeURIComponent(file[2]), decodeURIComponent(file[3]));
    }
    if (path === "api/whoami-v2") return refuse(10, request.method);
    if (/^api\/models(\/|$)/.test(path) && !/\/(preupload|commit|xet-write-token)\//.test(path)) {
      if (request.method === "POST" && !/\/paths-info\//.test(path)) return refuse(0, request.method);
      return await passthrough(request, url, `/${path}`);
    }
    if (path === "" || path === "health") return Response.json({ runner: "edge", examples: kernel ? true : false }, { headers: CORS });
    return refuse(0, request.method);
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error?.message ?? error) }), { status: 502, headers: { ...CORS, "content-type": "application/json", "x-error-message": "The edge could not reach an upstream" } });
  }
}
