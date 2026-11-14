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
// operator turns that off. Those two are the only hosts it calls: it reads no
// other hub, so no unsigned answer from a third host reaches the kernel.
//
// The handler is a standard fetch handler: `edge/serve.mjs` runs it on Node,
// and the same module runs on any runtime with fetch and WebAssembly.
import { createHash } from "node:crypto";
import { load } from "../try/vendor/prism-code/src/browser.mjs";
import { verifyBundle } from "../web/sigstore.mjs";

const HF = "https://huggingface.co";
// Source slots, in the order the kernel prefers them when all are healthy.
export const SOURCES = ["huggingface.co", "modelscope.cn", "ipfs"];
const TTL = 60_000;

let kernel = null;
let dialect = null;
let recordFields = [];
let partialHeader = "X-Hub-Partial";
let index = null;
// The browse rows the listing answers from, and the query the kernel says it
// takes.
let browse = [];
let listQuery = { sorts: [], limit: 1000 };
let useHuggingFace = true;
// The Sigstore policy screen 3 pins, kept so a runner beside this one checks a
// witnessed manifest against the same roots.
let trust = null;
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
  listQuery = { sorts: docs.listSorts ?? [], limit: docs.listLimit ?? 1000 };
  const record = docs.record ?? { fields: [], partialHeader: "X-Hub-Partial" };
  recordFields = record.fields.map(([id]) => id);
  partialHeader = record.partialHeader;
  const policy = (await screen(3)).trust?.policy;
  trust = policy ?? null;
  let state = "none";
  if (indexUrl && policy?.indexPredicateType) {
    try {
      index = await openIndex(indexUrl, policy);
      browse = await openBrowse(indexUrl, index.root);
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

// The browse rows: the same shards the page draws, read the same way. A shard
// counts only if its bytes are the ones the signed root names, so the listing
// an agent gets and the listing a person sees are one set of facts.
async function openBrowse(base, root) {
  const rows = [];
  for (const shard of root.browse ?? []) {
    const bytes = new Uint8Array(await (await fetch(new URL(shard.path, base))).arrayBuffer());
    if (sha256(bytes) !== shard.sha256) throw new Error(`index shard ${shard.path} does not match the signed root`);
    rows.push(...JSON.parse(new TextDecoder().decode(bytes)));
  }
  return rows;
}

// For tests of the index logic before a signature exists (the signature is
// made in CI). serve.mjs never calls it: the server opens only a signed index.
export async function adoptUnsignedIndexForTests(base) {
  const root = await (await fetch(new URL("root.json", base))).json();
  index = { base, root, records: new Map(root.records.map((r) => [r.repo.toLowerCase(), r])), loaded: new Map() };
  browse = await openBrowse(base, root);
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
// The SHA-256 a file's bytes can be checked against: the release's own, or a
// second witness that named the same revision. `files[].sha256` is
// deliberately not filled from a witness, because the edge reads that field
// to decide which ETag a Hugging Face client is given and that wire must not
// move. This is the same fact for a different purpose, so it is a different
// function rather than a second meaning for one field.
// Whether this file can be checked against an address the serving source did
// not supply. Only the release's own addresses count: the git blob identity,
// which every file a record carries has, and the SHA-256 where the origin
// published one. A witness's address is deliberately not enough on its own -
// a witness that is also a source would then be supplying both the bytes and
// the number they are checked against, and the hub would call that verified.
// The runner checks every address the record carries, so a witness address
// can corroborate but can never be the only thing checked.
export function checkable(record, path) {
  const file = record?.files?.find((f) => f.path === path);
  return Boolean(file && (file.gitSha1 || file.sha256));
}

// The SHA-256 to compare bytes against, which may come from a witness. This
// is what the runner verifies with, beside the git blob identity; it is not
// what decides whether an unvetted source may be chosen. See `checkable`.
export function addressOf(record, path) {
  const own = record?.files?.find((f) => f.path === path)?.sha256;
  if (own) return own;
  for (const witness of record?.witnesses ?? []) {
    const seen = witness.addresses?.find((a) => a.path === path)?.sha256;
    if (seen) return seen;
  }
  return null;
}

const indexedRevision = (rec, revision) => revision === "main" || revision === rec.revision
  || (/^[0-9a-f]{7,39}$/.test(revision) && rec.revision.startsWith(revision));

// Repository state the kernel reads: 0 public, 1 missing, 2 private, 3 gated, 4 disabled.
export async function release(repo, revision) {
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

// Which second sources hold a file is a fact the kernel acts on, so it comes
// from the signed index and from nowhere else: those bytes were hashed against
// the root this edge verified at start. A repository the index does not hold
// has no second source here, and the kernel is left with the one source the
// client's own dialect names. Exported because the local runner asks the same
// question of the same index.
export function holders(info) {
  return info.record ? { revision: info.record.revision, sources: info.record.sources } : null;
}

export function healthy(source) {
  const h = health.get(source);
  return !h || (!h.drained && h.until < Date.now());
}
// What a runner beside this one needs: the loaded kernel, the pinned trust
// policy, the dialect that turns a kernel answer into HTTP, and the index.
export const loaded = () => ({ kernel, dialect, trust, index, useHuggingFace });

export function report(source, ok) {
  const h = health.get(source);
  if (!h) return;
  if (ok) { h.failures = 0; h.until = 0; return; }
  h.failures += 1;
  if (h.failures >= 3) h.until = Date.now() + 60_000;
}

const enc = new TextEncoder();
function resolveRequest({ repo, revisionKind, refFound, requested, commit, entry, addressed, pin, slots }) {
  const b = new Uint8Array(105);
  b.set([1, 0, repo, revisionKind, refFound, revisionKind === 1 ? requested.length : 0, entry, pin]);
  slots.forEach((s, i) => b.set([s.holds, s.healthy, s.vetted, s.failed], 8 + 4 * i));
  if (revisionKind === 1) b.set(enc.encode(requested).subarray(0, 40), 24);
  if (commit) b.set(enc.encode(commit).subarray(0, 40), 64);
  // Whether the record addresses this file, which decides which sources may
  // serve it. `entry` at byte 6 decides the ETag instead; the two coincided
  // only while both came from the LFS pointer.
  b[104] = addressed;
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
  const held = info.state === 0 && info.revision ? holders(info) : null;
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
    addressed: checkable(info.record, path) ? 1 : 0,
    pin,
    slots,
  }));
  const [answer, slot, etagKind] = plan;
  if (answer !== 1) return refuse(answer, method);
  const source = slots[slot].kind;
  const etag = etagKind === 2 ? lfs.sha256 : sibling.blobId;
  // The record names where its own bytes come from, so the redirect and the
  // record agree by construction rather than by two copies of one host name.
  // A record written before `origin` existed leaves it unset and the
  // constant answers, which is what every record did until HK-20.
  const origin = info.record?.origin;
  const fromRecord = origin?.kind === source ? origin.resolve : null;
  const target = fromRecord
    ? `${fromRecord}${path}`
    : source === "huggingface.co"
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
  const m = path.match(/^api\/models\/([\w.-]+\/[\w.-]+)(?:\/(revision|tree|paths-info|refs|commits)(?:\/([^/]+))?(?:\/(.*))?)?$/);
  if (!m) return null;
  const [, repo, kind, revision = "main", rest = ""] = m;
  const rec = await record(repo);
  if (!rec) return null;
  if (kind === "refs") return json({ branches: [{ name: "main", ref: "refs/heads/main", targetCommit: rec.revision }], converts: [], tags: [], pullRequests: [] });
  // The index holds a release, not a history, so the hub answers with the one
  // commit it knows and says the answer is partial rather than implying the
  // repository has had one commit.
  if (kind === "commits") {
    return json([{ id: rec.revision, title: "The release this index holds", message: "", authors: [], date: rec.info?.lastModified ?? rec.info?.createdAt ?? null }],
                200, { [partialHeader]: "history" });
  }
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
// The listing, answered from the index the way Hugging Face answers it: the
// same query names, the same row shape, the same refusals, and a cursor in a
// Link header. The query the hub accepts is the kernel's (screen 4), so the
// docs page and this answer cannot disagree about it.
const listSorts = () => listQuery.sorts;
const SORT_KEY = {
  downloads: (r) => r.observed?.downloads ?? 0,
  likes: (r) => r.observed?.likes ?? 0,
  createdAt: (r) => Date.parse(r.created ?? 0) || 0,
  lastModified: (r) => Date.parse(r.modified ?? r.created ?? 0) || 0,
  trendingScore: (r) => -(r.rank ?? 0),
};
// A row as Hugging Face writes it with no expansion: eleven fields, in its
// order.
function listRow(r) {
  return {
    _id: r.revision?.slice(0, 24) ?? r.id, id: r.id, likes: r.observed?.likes ?? 0,
    trendingScore: Math.max(0, 1000 - (r.rank ?? 0)), private: false,
    downloads: r.observed?.downloads ?? 0, tags: listTags(r), pipeline_tag: r.task ?? null,
    library_name: r.library ?? null, createdAt: r.created ? `${r.created}T00:00:00.000Z` : null,
    modelId: r.id,
  };
}
// The tags a row carries: what the publisher wrote, which is what `filter`
// matches on.
const listTags = (r) => [
  ...(r.task ? [r.task] : []), ...(r.library ? [r.library] : []),
  ...(r.format && r.format !== "Other" ? [r.format.toLowerCase()] : []),
  ...(r.languages ?? []), ...(r.license ? [`license:${r.license}`] : []),
  ...(r.arch ? [r.arch] : []),
];
// Everything a record holds, for `full=true`: Hugging Face's sixteen fields,
// in its order (measured 2026-11-13).
function fullRow(r) {
  return {
    _id: r.revision?.slice(0, 24) ?? r.id, id: r.id, author: r.org, gated: Boolean(r.gated),
    lastModified: r.modified ? `${r.modified}T00:00:00.000Z` : null, likes: r.observed?.likes ?? 0,
    trendingScore: Math.max(0, 1000 - (r.rank ?? 0)), private: false, sha: r.revision,
    downloads: r.observed?.downloads ?? 0, tags: listTags(r), pipeline_tag: r.task ?? null,
    library_name: r.library ?? null, createdAt: r.created ? `${r.created}T00:00:00.000Z` : null,
    modelId: r.id, siblings: null,
  };
}

function searchIndex(url) {
  const p = url.searchParams;
  const sort = p.get("sort");
  const direction = p.get("direction");
  // Hugging Face refuses these, so the hub refuses them too rather than
  // answering something else and calling it a result.
  if (sort !== null && !listSorts().includes(sort)) return refuse(0, "GET");
  if (direction !== null && direction !== "-1") return refuse(0, "GET");
  const limit = Math.min(Math.max(1, Number(p.get("limit") ?? listQuery.limit) || listQuery.limit), listQuery.limit);
  const q = (p.get("search") ?? "").toLowerCase();
  const author = p.get("author");
  const want = (p.get("filter") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const expand = p.getAll("expand[]").concat(p.getAll("expand")).filter(Boolean);

  let rows = browse.filter((r) => (!q || r.id.toLowerCase().includes(q))
    && (!author || r.org === author)
    && want.every((t) => listTags(r).includes(t)));
  const key = SORT_KEY[sort ?? "trendingScore"];
  rows = [...rows].sort((a, b) => key(b) - key(a));

  // The cursor is this hub's own and opaque, as Hugging Face's is: a client
  // follows the Link header and never reads it.
  const from = Number(Buffer.from(p.get("cursor") ?? "", "base64url").toString("utf8") || 0) || 0;
  const page = rows.slice(from, from + limit);
  const body = page.map((r) => {
    if (expand.length) {
      // Hugging Face answers an expansion with the identity, the key it sorted
      // by, and the fields asked for that the model has; a field it has not is
      // left out rather than sent as null (measured 2026-11-13).
      const whole = { ...fullRow(r), downloadsAllTime: r.observed?.downloads ?? 0, safetensors: r.params ? { total: r.params } : null, gguf: null };
      const key = sort ?? "trendingScore";
      const wanted = ["_id", "id", key, ...expand].filter((f) => whole[f] !== null && whole[f] !== undefined);
      // The keys come back in the record's own order, which is the order
      // `full=true` answers in; a field that order does not name follows it.
      const order = Object.keys(whole);
      const row = {};
      for (const field of [...new Set(wanted)].sort((a, b) => {
        const i = order.indexOf(a), j = order.indexOf(b);
        return (i < 0 ? order.length + expand.indexOf(a) : i) - (j < 0 ? order.length + expand.indexOf(b) : j);
      })) row[field] = whole[field];
      return row;
    }
    const row = p.get("full") === "true" ? fullRow(r) : listRow(r);
    if (p.get("config") === "true") row.config = { model_type: r.arch ?? null, architectures: r.arch ? [r.arch] : [] };
    return row;
  });
  const headers = {};
  if (from + limit < rows.length) {
    const next = new URL(url);
    next.searchParams.set("cursor", Buffer.from(String(from + limit), "utf8").toString("base64url"));
    headers.link = `<${next.href}>; rel="next"`;
  }
  return json(body, 200, headers);
}

// Every tag the listed models carry, by kind, the way Hugging Face groups
// them. The hub answers for what it holds, not for the whole of Hugging Face.
function tagsByType() {
  const kinds = { pipeline_tag: new Set(), library: new Set(), language: new Set(), license: new Set(), other: new Set() };
  for (const r of browse) {
    if (r.task) kinds.pipeline_tag.add(r.task);
    if (r.library) kinds.library.add(r.library);
    for (const l of r.languages ?? []) kinds.language.add(l);
    if (r.license) kinds.license.add(`license:${r.license}`);
    if (r.arch) kinds.other.add(r.arch);
  }
  return json(Object.fromEntries(Object.entries(kinds).map(([type, set]) => [
    type, [...set].sort().map((id) => ({ type, id, label: id })),
  ])));
}

// The search box's answer: names that match, nothing else.
function quicksearch(url) {
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  const type = url.searchParams.get("type");
  const models = type && type !== "model" ? [] : browse
    .filter((r) => q && r.id.toLowerCase().includes(q)).slice(0, 10)
    .map((r) => ({ id: r.id, _id: r.revision?.slice(0, 24) ?? r.id, private: false, authorType: "org" }));
  return json({ models, modelsCount: models.length, datasets: [], datasetsCount: 0, spaces: [], spacesCount: 0, orgs: [], users: [], q: url.searchParams.get("q") ?? "" });
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
    if (path === "api/models-tags-by-type" && browse.length) return tagsByType();
    if (path === "api/quicksearch" && browse.length) return quicksearch(url);
    if ((path === "api/models-tags-by-type" || path === "api/quicksearch") && useHuggingFace) {
      return await passthrough(request, url, `/${path}`);
    }
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
