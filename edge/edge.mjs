// The hub's edge runner: a stateless HTTP handler that answers the Hugging Face
// Hub's read surface, so `HF_ENDPOINT=<this origin>` works for every Hugging
// Face tool. It decides nothing itself. For a file it gathers facts (the
// release, the file, which sources hold it, which are healthy) and asks the
// proved kernel; it turns the kernel's plan into HTTP with the kernel's own
// dialect table. It never carries model bytes: it redirects, and only to
// vetted sources (HK-03, HK-04).
//
// Facts come first from the hub's signed index (tools/index.mjs): a root,
// signed by this repository's workflow, names every model record by SHA-256,
// so an indexed model is answered with no call to Hugging Face. Only a model
// the index does not hold is asked of Hugging Face, and not at all when the
// operator turns that off.
//
// The handler is a standard fetch handler: `edge/serve.mjs` runs it on Node,
// and the same module runs on any runtime with fetch and WebAssembly.
import { createHash } from "node:crypto";
import { load } from "../try/vendor/prism-code/src/browser.mjs";
import { verifyBundle } from "../web/sigstore.mjs";

const HF = "https://huggingface.co";
const SOURCE_INDEX = "https://gethologram.ai/data/files";
// Source slots, in the order the kernel prefers them when all are healthy.
const SOURCES = ["huggingface.co", "modelscope.cn", "ipfs"];
const TTL = 60_000;

let kernel = null;
let dialect = null;
let recordFields = [];
let partialHeader = "X-Hub-Partial";
let index = null;
let useHuggingFace = true;
const cache = new Map();
const health = new Map(SOURCES.map((s) => [s, { failures: 0, until: 0, drained: false }]));
const quarantined = new Set();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function start({ holo, index: indexUrl, huggingFace = true, drain = [] }) {
  useHuggingFace = huggingFace;
  for (const s of drain) if (health.has(s)) health.get(s).drained = true;
  kernel = await load(holo);
  if (!kernel.identities.verified) throw new Error("the kernel's holo failed its identity check");
  const run = await kernel.acceptance();
  if (run.passed !== run.total) throw new Error(`the kernel replayed ${run.passed} of ${run.total} examples`);
  const screen = async (n) => JSON.parse(new TextDecoder().decode(await kernel.dispatch(new Uint8Array([3, n]))));
  // Route 4 is the docs screen; its answers table is the dialect: kernel answer
  // -> HTTP status, X-Error-Code, message. Route 3's trust policy pins the
  // Sigstore roots and the identity that signs the index.
  const docs = await screen(4);
  dialect = new Map(docs.answers.filter(([code]) => typeof code === "number").map(([code, status, error, message]) => [code, { status, error: error === "none" ? "" : error, message }]));
  dialect.set("other", Object.fromEntries(["status", "error", "message"].map((k, i) => [k, docs.answers.find(([c]) => typeof c !== "number")[i + 1]])));
  // The edge is deployed apart from the kernel, so it must start against a
  // holo older than itself: a kernel with no record block answers operation 6
  // as invalid, and the edge then answers from the index as it did before.
  const record = docs.record ?? { fields: [], partialHeader: "X-Hub-Partial" };
  recordFields = record.fields.map(([id]) => id);
  partialHeader = record.partialHeader;
  const policy = (await screen(3)).trust?.policy;
  let state = "none";
  if (indexUrl && policy?.indexPredicateType) {
    try {
      index = await openIndex(indexUrl, policy);
      state = `${index.records.size} models`;
    } catch (error) {
      state = `refused (${error.message})`;
    }
  }
  return { examples: run.total, fingerprint: kernel.identities.archiveFingerprint, index: state };
}

async function openIndex(base, policy) {
  const [rootBytes, bundle] = await Promise.all([
    fetch(new URL("root.json", base)).then((r) => { if (!r.ok) throw new Error(`root ${r.status}`); return r.arrayBuffer(); }).then((b) => new Uint8Array(b)),
    fetch(new URL("index.sigstore.json", base)).then((r) => { if (!r.ok) throw new Error(`signature ${r.status}`); return r.json(); }),
  ]);
  const facts = await verifyBundle(bundle, rootBytes, { ...policy, predicateType: policy.indexPredicateType });
  const failed = ["chain", "time", "log", "signature", "identity", "subject", "predicate"].filter((k) => !facts[k]);
  if (failed.length) throw new Error(`signature check failed: ${failed.join(", ")}`);
  const root = JSON.parse(new TextDecoder().decode(rootBytes));
  return { base, root, records: new Map(root.records.map((r) => [r.repo.toLowerCase(), r])), loaded: new Map() };
}

// For tests of the index logic before a signature exists (the signature is
// made in CI). serve.mjs never calls it: the server opens only a signed index.
export async function adoptUnsignedIndexForTests(base) {
  const root = await (await fetch(new URL("root.json", base))).json();
  index = { base, root, records: new Map(root.records.map((r) => [r.repo.toLowerCase(), r])), loaded: new Map() };
}

async function record(repo) {
  const entry = index?.records.get(repo.toLowerCase());
  if (!entry) return null;
  if (!index.loaded.has(entry.repo)) {
    index.loaded.set(entry.repo, (async () => {
      const bytes = new Uint8Array(await (await fetch(new URL(`models/${entry.repo}.json`, index.base))).arrayBuffer());
      // A record counts only if the signed root names exactly these bytes.
      if (sha256(bytes) !== entry.sha256) throw new Error(`index record for ${entry.repo} does not match the signed root`);
      return JSON.parse(new TextDecoder().decode(bytes));
    })());
  }
  return index.loaded.get(entry.repo);
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
const siblingsOf = (rec) => new Map(rec.files.map((f) => [f.path, {
  rfilename: f.path, size: f.size, blobId: f.gitSha1,
  ...(f.sha256 ? { lfs: { sha256: f.sha256, size: f.size, pointerSize: f.pointerSize ?? 134 } } : {}),
}]));
const indexedRevision = (rec, revision) => revision === "main" || revision === rec.revision
  || (/^[0-9a-f]{7,39}$/.test(revision) && rec.revision.startsWith(revision));

// Repository state the kernel reads: 0 public, 1 missing, 2 private, 3 gated, 4 disabled.
async function release(repo, revision) {
  const rec = await record(repo);
  if (rec && (indexedRevision(rec, revision) || !useHuggingFace)) {
    if (!indexedRevision(rec, revision)) return { state: 0, revision: false };
    return { state: 0, revision: true, sha: rec.revision, siblings: siblingsOf(rec), record: rec };
  }
  if (!useHuggingFace) return { state: 1 };
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

async function holders(repo, info) {
  if (info.record) return { revision: info.record.revision, sources: info.record.sources };
  return cached(`index:${repo}`, async () => {
    try {
      const r = await fetch(`${SOURCE_INDEX}/${repo}.json`, { signal: AbortSignal.timeout(10000) });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  });
}

function healthy(source) {
  const h = health.get(source);
  return !h || (!h.drained && h.until < Date.now());
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
  "access-control-expose-headers": "x-repo-commit, x-linked-etag, x-linked-size, etag, x-error-code, x-error-message, x-hub-source, x-hub-partial, link, accept-ranges, content-range, x-xet-cas-url, x-xet-access-token, x-xet-token-expiration",
};
function refuse(answer, method) {
  const d = dialect.get(answer) ?? dialect.get("other");
  const headers = { ...CORS, "content-type": "application/json", "cache-control": "no-store", "x-error-message": d.message };
  if (d.error) headers["x-error-code"] = d.error;
  if (answer === 10 || answer === 13) headers["www-authenticate"] = "Bearer";
  return new Response(method === "HEAD" ? null : JSON.stringify({ error: d.message }), { status: d.status, headers });
}
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...CORS, ...extra, "content-type": "application/json", "cache-control": "no-store" } });

async function resolve(method, via, repo, revision, path) {
  const info = await release(repo, revision);
  const commitKind = /^[0-9a-f]{7,40}$/.test(revision) ? 1 : 0;
  const held = info.state === 0 && info.revision ? await holders(repo, info) : null;
  const sibling = info.siblings?.get(path);
  const lfs = sibling?.lfs;
  const slots = SOURCES.map((kind) => {
    let holds = 0;
    if (kind === "huggingface.co") holds = sibling ? 1 : 0;
    else {
      const s = held?.sources?.find((x) => x.kind === kind);
      // The index knows which source holds which file, for the revision it indexed.
      holds = s?.resolve && held.revision === info.sha && sibling && !s.missing?.includes(path) ? 1 : 0;
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
    : `${held.sources.find((x) => x.kind === source).resolve}${path}`;
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

// ---------------------------------------------------------------- metadata from the index
// The shapes huggingface_hub reads (hf_api.py: ModelInfo, RepoFile, RepoFolder,
// GitRefs), built from an index record.
function modelInfo(rec, blobs) {
  const siblings = [...siblingsOf(rec).values()].map((s) => (blobs ? s : { rfilename: s.rfilename }));
  const observed = rec.observed ?? {};
  return {
    _id: rec.revision.slice(0, 24), id: rec.repo, modelId: rec.repo, author: rec.info.author, sha: rec.revision,
    private: rec.info.private ?? false, gated: rec.info.gated ?? false, disabled: rec.info.disabled ?? false,
    downloads: observed.downloads ?? 0, likes: observed.likes ?? 0,
    tags: rec.info.tags, pipeline_tag: rec.info.pipeline_tag, library_name: rec.info.library_name,
    createdAt: rec.info.createdAt, lastModified: rec.info.lastModified ?? null,
    config: rec.config ?? undefined, cardData: rec.cardData ?? undefined,
    safetensors: rec.safetensors ?? undefined, transformersInfo: rec.transformersInfo ?? undefined,
    siblings,
  };
}

// The ten facts the kernel reads about a record, in the order operation 6
// names them (the `record` block of screen 4). The runner measures; the
// kernel decides whether this record may answer at all.
const RECORD_FACTS = [
  (r) => Boolean(r.revision),
  (r) => (r.files?.length ?? 0) > 0,
  (r) => Array.isArray(r.info?.tags),
  (r) => Boolean(r.info?.pipeline_tag),
  (r) => Boolean(r.info?.library_name),
  (r) => Boolean(r.config),
  (r) => Boolean(r.cardData),
  (r) => Boolean(r.safetensors),
  (r) => Boolean(r.info?.lastModified),
  (r) => r.info?.gated !== undefined,
];
// 1 answer from this record, 2 ask Hugging Face, 3 answer from it and say the
// answer is partial.
async function completeness(rec) {
  const request = new Uint8Array(12);
  request[0] = 6;
  RECORD_FACTS.forEach((held, i) => { request[1 + i] = held(rec) ? 1 : 0; });
  request[11] = useHuggingFace ? 1 : 0;
  const plan = (await kernel.dispatch(request))[0];
  const missing = RECORD_FACTS.map((held, i) => (held(rec) ? null : recordFields[i])).filter(Boolean);
  // 1, 2 and 3 are the kernel's plans; anything else is a kernel that does not
  // know this operation, and the index answers as it used to.
  return { plan: plan === 2 || plan === 3 ? plan : 1, missing };
}
function treeEntries(rec, dir, recursive) {
  const prefix = dir ? `${dir.replace(/\/+$/, "")}/` : "";
  const files = rec.files.filter((f) => f.path.startsWith(prefix));
  const out = [];
  const folders = new Set();
  for (const f of files) {
    const rest = f.path.slice(prefix.length);
    const parts = rest.split("/");
    for (let i = 1; i < parts.length; i++) {
      const folder = prefix + parts.slice(0, i).join("/");
      if ((recursive || i === 1) && !folders.has(folder)) {
        folders.add(folder);
        out.push({ type: "directory", oid: sha256(`dir:${rec.revision}:${folder}`).slice(0, 40), size: 0, path: folder });
      }
    }
    if (recursive || parts.length === 1) {
      out.push({ type: "file", oid: f.gitSha1, size: f.size, path: f.path, ...(f.sha256 ? { lfs: { oid: f.sha256, size: f.size, pointerSize: f.pointerSize ?? 134 } } : {}) });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
async function fromIndex(request, url, path) {
  const m = path.match(/^api\/models\/([\w.-]+\/[\w.-]+)(?:\/(revision|tree|paths-info|refs)(?:\/([^/]+))?(?:\/(.*))?)?$/);
  if (!m) return null;
  const [, repo, kind, revision = "main", rest = ""] = m;
  const rec = await record(repo);
  if (!rec) return null;
  if (kind === "refs") return json({ branches: [{ name: "main", ref: "refs/heads/main", targetCommit: rec.revision }], converts: [], tags: [], pullRequests: [] });
  const rev = decodeURIComponent(revision);
  if (kind && !indexedRevision(rec, rev)) return useHuggingFace ? null : refuse(11, request.method);
  if (!kind || kind === "revision") {
    // An incomplete record never answers as though it were whole: where
    // Hugging Face can be asked it is asked, and where it cannot the answer
    // carries the header that says which fields are absent.
    const { plan, missing } = await completeness(rec);
    if (plan === 2) return null;
    const headers = plan === 3 && missing.length ? { [partialHeader]: missing.join(",") } : {};
    return json(modelInfo(rec, url.searchParams.get("blobs") === "true"), 200, headers);
  }
  if (kind === "tree") return json(treeEntries(rec, decodeURIComponent(rest), url.searchParams.get("recursive") === "true"));
  if (kind === "paths-info") {
    const form = new URLSearchParams(await request.text());
    const wanted = new Set(form.getAll("paths"));
    const all = treeEntries(rec, "", true);
    return json(all.filter((e) => wanted.has(e.path)));
  }
  return null;
}
function searchIndex(url) {
  const q = (url.searchParams.get("search") ?? "").toLowerCase();
  const author = url.searchParams.get("author");
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const rows = [...index.records.values()]
    .filter((r) => (!q || r.repo.toLowerCase().includes(q)) && (!author || r.repo.split("/")[0] === author))
    .slice(0, limit)
    .map((r) => ({ _id: r.revision.slice(0, 24), id: r.repo, modelId: r.repo, author: r.repo.split("/")[0], sha: r.revision, private: false, gated: false }));
  return json(rows);
}

// Hugging Face's own answer, for a model the index does not hold, without the
// fields that would let a client skip the resolve call (and so the kernel's
// choice of source), and with its next-page links pointing here. A Xet read
// token is passed through: a client only asks for one after its HEAD followed
// the kernel's redirect to Hugging Face, so the bytes still come from the
// source the kernel chose.
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
      const local = index ? await fromIndex(request.clone(), url, path) : null;
      if (local) return local;
      if (useHuggingFace) return await passthrough(request, url, `/${path}`);
      if (path === "api/models" && index) return searchIndex(url);
      return refuse(10, request.method);
    }
    if (path === "" || path === "health") {
      return json({ runner: "edge", kernel: Boolean(kernel), index: index ? index.records.size : 0, huggingFace: useHuggingFace });
    }
    return refuse(0, request.method);
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error?.message ?? error) }), { status: 502, headers: { ...CORS, "content-type": "application/json", "x-error-message": "The edge could not reach an upstream" } });
  }
}
