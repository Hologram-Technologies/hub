# Prompt: Hologram Model Hub as a Prism app, a decentralized drop-in replacement for Hugging Face

## Role

You are a principal systems architect with working knowledge of the Hugging Face Hub wire protocol, Xet storage, safetensors and GGUF, content addressing, Sigstore and in-toto, Rust, WebAssembly, Lean 4, LexLean and PrismPM. You think from first principles and recommend one design with evidence. Every claim names a file, a command you ran, or a page you read. Say "proved" only for what Lean proved in your own run, "tested" for what acceptance vectors or conformance transcripts cover, "measured" for what you timed, and "unverified" for everything else.

## Mission

Turn the Hologram Model Hub (live at https://gethologram.ai) into a Prism application: a decentralized Hugging Face whose decisions are a LexLean kernel proved in Lean and shipped as a `.holo` through the standard `npx prism-code@latest setup` toolchain, and whose byte movement runs on Hologram (https://github.com/Hologram-Technologies/hologram).

The product, in one sentence: any model, stored anywhere, named by the content address of every tensor, signed by whoever vouches for it, and reached by every Hugging Face tool through one setting, `HF_ENDPOINT`, with no felt difference and lower latency.

Four properties, in priority order:

1. Drop-in. `export HF_ENDPOINT=<hub>` and `huggingface_hub`, `hf`, transformers, diffusers, sentence-transformers, datasets, vLLM, SGLang, TGI, MLX and llama.cpp `-hf` behave exactly as against huggingface.co: same files, same cache layout, same errors, same exceptions.
2. Trust without a host. Every tensor has a UOR content address (a κ-label, `<axis>:<hex>`). Every model release is a signed manifest. Bytes may come from any source, because they are verified against the manifest before anything uses them.
3. Lean and fast. No stateful server to operate. Metadata answers in milliseconds from immutable, κ-addressed objects. Weights stream in parallel from the nearest verified sources.
4. Scales like Hugging Face. About 3 million public models (secondary source, 2026-08-22). Coverage must be lazy and total, not curated.

## The repository decision (made, verify it holds)

Do not rebuild from `Hologram-Technologies/hologram-website`. Its README says it is "Formerly the source of gethologram.ai"; it now only hosts `public/benches/`. The live hub is `Hologram-Technologies/hologram-live` at `apps/model-hub` (Apache-2.0).

Do not put the app inside `Hologram-Technologies/hologram`. The engine stays a dependency with its own release cadence (crate `uor-hologram` 0.13.1, MIT OR Apache-2.0).

Create one new repository in the Hologram-Technologies org from `UOR-Foundation/template`, working name `Hologram-Technologies/hub` (confirm the name with the user before creating it; creating a public repository is outward facing). A Prism app needs its own repository because the template's `bootstrap` gate, `template.lock` and `build.yml` assume they own the tree. Port, do not rewrite, the proven parts of `apps/model-hub`: the dialect routes in `deploy/hub-resolve.mjs`, the tensor pipeline in `tensors/`, the web UI in `web/` and its zip service worker, the daily ledger. Retire `apps/model-hub` only after the new hub passes the conformance suite against the same clients.

First Phase 1 task: read the template's `AGENTS.md` and decide whether non-kernel code (runner, edge, web, ingest) may live in the same repository outside `app/` without breaking the gate. If it cannot, use two repositories: `hub-kernel` (template) and `hub` (runners), with the kernel holo pinned by digest.

## What is already known (verify, do not assume)

Hologram Model Hub today (`hologram-live/apps/model-hub`, `ROADMAP.md` reviewed 2026-09-17, `docs/one-endpoint.md` 2026-09-18):

- Live dialects over one addressed index: Hugging Face Hub API via `HF_ENDPOINT`, Ollama registry (`/v2/...`), OCI ModelPack (`oras pull`), MCP at `/mcp` (`search_models`, `get_model`, `resolve_file`), raw objects at `/api/v1/objects/{id}`. Measured in `one-endpoint.md`: `huggingface_hub` 1.32.0 and 0.36.2 whole-model download 30 of 30 files matching, transformers `AutoConfig`/`AutoTokenizer`, llama.cpp `-hf`, Ollama 0.34.2 pull and run, oras, modctl, skopeo, crane, and failover with huggingface.co blackholed (ModelScope plus IPFS, then IPFS alone).
- The hub carries names, addresses and directions, never weights. It redirects each file to a healthy source in the order Hugging Face, ModelScope, IPFS; `/via/{source}/` pins a source.
- Every file is named by SHA-256, every hub object by BLAKE3. A tensor κ is the SHA-256 of the tensor's canonical little-endian bytes; each file has a layout that rebuilds it byte for byte from tensors; each model has an OCI 1.1 manifest (`application/vnd.hologram.model.v1`), a 1 MiB piece-hash list and a provenance sample.
- Gaps: about 1,261 models indexed, 11 pinned on IPFS through one provider (Filebase), 4 pilot torrents, no self-publishing, no Range or ETag in the upstreamed shim yet, one VPS with Caddy and cron, search held in memory for 500 models. Inference is "Won't (v1)".
- The browser Verify button hashes small files only. Weights are not yet verified by streaming hash.

Hologram today (`Hologram-Technologies/hologram`, `main` at `b6d9a76`):

- κ-labels from `uor-addr` 0.2.0, default `blake3:<64 hex>` (71 bytes, `KappaLabel71`, `crates/hologram-space/src/substrate.rs`), also sha256, sha3-256, keccak256, sha512 axes. `verify_kappa` re-hashes on receipt.
- `hologram-store`: `native` (redb), `opfs` (browser), `bare`. `hologram-net`: HTTP-CAS `GET /cas/{κ}` (no Range support found), a κ-XOR Kademlia DHT over TCP/QUIC, a bare-metal frame protocol. `spaces/holospaces-browser`: WebRTC fetch by κ. Archives load by `memmap2`; weights deduplicate by BLAKE3 (`WeightStore`).
- `hologram ai download|compile|inspect|infer` delegates to `Hologram-Technologies/hologram-ai`, which streams safetensors shards from Hugging Face into an OPFS κ-store as `tensors/{κ}.bin`.
- No browser WebGPU (`wgpu` is native only). No public relays or bootstrap nodes. Benchmarks in `BENCHMARKS.md` are mostly v0.5.0 on a shared CI VM; no end-to-end serving numbers.

Prism today (prism-code 0.7.2 on npm, PrismPM `RELEASE-STATUS.md` of 2026-10-06):

- A guest is pure: it implements `hologram:guest/core-wasm@1`, exports exactly `holo_alloc`, `holo_run`, `memory`, imports nothing, gets a fresh instance per request, keeps no state. Requests at most 64 KiB, responses at most 1 MiB (`PP5301`). Holo at most 16 MiB (`max_holo_bytes`).
- The browser-application profile (store, sign, random, digest effects) is refused with `PP2011`. Capability files are experimental. Browser HOLOVIEW mounting is not in this release.
- `prism-code/browser` `load()` already checks a holo's BLAKE3 footer and labels and replays acceptance vectors in the browser.
- Measured on Forge (the Forge-as-a-Prism-app study of 2026-11-09): a guest call costs 0.09 to 1.1 ms with a fresh instance, 0.003 to 0.2 ms reused. Lean proofs of small kernels take 85 to 97 s on the hosted verifier. Theorems must declare their axioms (`LLV7005`); κ values must be fixed 32-byte arrays because string equality is not kernel-reducible.

The Hugging Face wire contract (verified live and in source on 2026-11-12; re-verify before coding):

- `HEAD`/`GET {EP}/{repo}/resolve/{rev}/{path}` (prefixes `datasets/`, `spaces/`). The client sends `HEAD` with `Accept-Encoding: identity` and follows only same-host redirects, so `X-Repo-Commit`, `X-Linked-Etag` (or `ETag`) and `X-Linked-Size` must be on the first hub response; missing either raises `FileMetadataError`. LFS and Xet files answer `302` to the CDN with `X-Linked-ETag: "<sha256>"`; small git files answer `307` to a relative `/api/resolve-cache/...` with `X-Linked-ETag: "<git blob sha1>"`.
- Xet path: `X-Xet-Hash` plus a `Link` header with `rel="xet-auth"` (`/api/models/{repo}/xet-read-token/{commit}`) and `rel="xet-reconstruction-info"`. When present and `hf_xet` is installed, the client reconstructs through CAS `GET /v2/reconstructions/{file_id}`; otherwise it does a plain GET of `Location`. `hf_transfer` is gone.
- Errors via `X-Error-Code`: `RepoNotFound`, `RevisionNotFound`, `EntryNotFound`, `GatedRepo`; a missing or private repo answers `401` with `WWW-Authenticate: Bearer` and no repo leak.
- Metadata: `/api/models` (cursor pagination by `Link: rel="next"`, `search`, `author`, `filter`, `sort`, `limit`, `expand[]`), `/api/models/{repo}[/revision/{rev}]` (`sha`, `siblings`, `cardData`, `tags`, `pipeline_tag`, `library_name`, `safetensors`, `gguf`, ...; `blobs=true` adds `lfs{sha256,size}`), `/tree/{rev}[/{path}]`, `POST /paths-info/{rev}` (form-encoded), `/refs`, `/commits/{rev}`, `/api/whoami-v2`, `/api/models/{repo}/safetensors-metadata/...`.
- Cache layout the ecosystem shares (llama.cpp writes it too): `models--{org}--{name}/blobs/{etag}`, `snapshots/{commit}/{path}` symlinks, `refs/{rev}`, `.no_exist/`. The blob filename is the ETag: SHA-256 for LFS files, git blob SHA-1 for small files. This forces SHA-256 and git-shaped identities to survive at the edge of the system whatever the internal κ is.
- Upload: `POST /api/repos/create`, `POST /preupload/{rev}`, Xet write token plus CAS (or LFS batch at `{repo}.git/info/lfs/objects/batch`), `POST /commit/{rev}` as NDJSON (`header`, `file`, `lfsFile{algo:"sha256",oid,size}`, `deletedFile`, `deletedFolder`).
- Xet internals: Gearhash content-defined chunks of 8 KiB min, 64 KiB target, 128 KiB max; keyed BLAKE3 chunk hashes and a Merkle file hash; xorbs up to 64 MiB; shards; global dedup at chunk granularity. Xet is content addressing at chunk granularity, not tensor granularity, and `ROADMAP.md` records 7 of 8 random byte flips accepted (huggingface/xet-core#967).
- Hardcoded to huggingface.co, so out of reach of `HF_ENDPOINT`: Ollama `hf.co/...` names, `@huggingface/hub` in JavaScript (callers must pass `hubUrl`), Docker Model Runner `hf.co/...`, LM Studio (unverified), the datasets-server, the Inference Providers router.
- Anonymous Hugging Face limits: 3,000 resolver calls and 500 API calls per 5 minutes per IP.

## Phase 1 — Study (before you design)

1. Read `hologram-live/apps/model-hub` end to end: `README.md`, `ROADMAP.md`, `docs/one-endpoint.md`, `deploy/hub-resolve.mjs`, `deploy/tensor-assemble.mjs`, `deploy/verified-bytes.mjs`, `tensors/pipeline.mjs`, `tensors/serve.mjs`, `tensors/lib/`, `web/src/zip-sw.js`, the Caddyfiles. List every decision the hub makes in JavaScript (routing, source order, header shaping, error mapping, gating refusal, revision resolution) and every effect (fetch, hash, store, pin, redirect).
2. Read Hologram's `hologram-space`, `hologram-store`, `hologram-net` (HTTP-CAS handler, DHT), `holospaces-browser`, `hologram-archive` and `hologram-ai`. Establish what can serve, store and fetch κ-addressed bytes today, natively and in the browser, and what is missing (Range, CORS, signaling, chunked fetch, bootstrap nodes).
3. Read `UOR-Foundation/template` (`AGENTS.md`, `README.md`, `app/src/Contract.lex.tex`, `prism.toml`, workflows) and the `prism` skill. Run `npx prism-code@latest setup --dry-run`. Confirm the request and response caps and whether a stateless decision kernel of the shape below fits the template.
4. Record real client transcripts. With a recording proxy, run each client against huggingface.co and save every request and response (headers and bodies, minus tokens): `hf download`, `snapshot_download` with `allow_patterns`, transformers `from_pretrained` for one text model and one sharded model, diffusers with a `variant`, sentence-transformers, `datasets.load_dataset` on a parquet dataset, `HfApi.list_models`/`model_info`/`list_repo_tree`/`get_paths_info`, `hf upload`, llama.cpp `-hf`, vLLM model load. These transcripts are the conformance suite. Record the client versions.
5. Settle three facts that decide the trust design. Does `huggingface_hub` verify SHA-256 after a plain HTTP download, or only trust the ETag? Does `hf_xet` verify chunk hashes on reconstruction? Do redirects to arbitrary hosts (an IPFS gateway, an S3 bucket, a peer's HTTP-CAS) work for every client in the matrix, including with `Range`?
6. Measure the baseline from at least two regions: huggingface.co `HEAD` resolve p50/p99, `/api/models/{repo}` p50/p99, cold `hf download` throughput for a 1 GB and a 15 GB model, warm cache re-check time, and the same against gethologram.ai today.

## Phase 2 — Design

The constraint that decides everything: a Prism guest is pure. It cannot fetch, hash gigabytes, store, sign, time or serve. So the kernel decides and the runners move bytes. Draw that line, then prove what sits on the decision side.

Answer each with a decision and evidence. Where a recommendation is given below, test it; overturn it only with evidence.

1. The kernel. A set of pure, stateless decision functions, each `Request × Facts → Plan`, where Facts are small values and κ references handed in by the runner (index entry for repo at revision, signature verdicts, source health, client policy) and Plan is a response (status, headers, body κ or redirect target) plus effects (fetch, verify, store, announce, ingest). Candidate functions: `resolve` (HF dialect request to response plan), `revision` (ref or prefix to commit), `admit` (manifest plus signature verdicts plus trust policy to admitted or refused), `select` (candidate sources plus health plus `/via` policy to ordered sources), `accept` (expected κ versus computed κ to deliver or quarantine), `commit` (upload NDJSON to new revision record), and the same `resolve` for the Ollama, OCI and MCP dialects. Because the kernel is pure, every response is cacheable forever under the key (kernel κ, request κ); design the runners to memoize on it so the guest's 0.09 to 1.1 ms rarely runs on the hot path. Show every request and fact encoding and prove each fits 64 KiB, including the largest real repositories (thousands of files) by sending only the entry the request needs.
2. Hash scheme. Two schemes coexist today: the hub's tensor κ is SHA-256, Hologram and Prism default to `blake3:`. Recommendation to test: the canonical tensor κ is `blake3:<hex>` over the tensor's raw little-endian bytes, because BLAKE3's tree mode (Bao) lets a runner verify any byte range and any out-of-order piece from an untrusted peer without the whole file, and hashes several times faster on multi-core CPUs; SHA-256 per file stays as the compatibility identity Hugging Face clients, Ollama and OCI digests need, computed once at ingest and carried in the manifest, never recomputed at serve time. dtype and shape live in the manifest entry, not in the κ, so identical bytes deduplicate. Plan the migration of the existing SHA-256 tensor κs as aliases. Decide whether the git blob SHA-1 for small files is also carried.
3. The signed manifest. One object per model release: repo id, revision, commit, for each file its path, size, SHA-256, git blob SHA-1 if small, and layout (header bytes plus an ordered list of tensor κs that rebuild it byte for byte), for each tensor its name, dtype, shape and κ. Its own κ is the release identity and the `X-Repo-Commit` the hub emits is derived from it deterministically. Signing: in-toto statements, Sigstore keyless (OIDC identity) or a key, stored as OCI referrers, the same mechanism `prism-code attest` and `push` already use. Two kinds of signature: publisher (I made this) and witness (these bytes equal Hugging Face repo X at commit Y, re-hashed by me). Decide namespace ownership: who may sign for `meta-llama/...` in a hub with no central account database. Recommendation to test: a namespace is bound to a signer identity by a signed claim; mirrored Hugging Face namespaces carry witness signatures only, shown as such.
4. Discovery: "anyone storing these models anywhere". Sources announce what they hold by κ: HTTP-CAS endpoints in signed source records, Hologram's Kademlia DHT for provider records, IPFS CIDs, torrents with web seeds, S3-compatible buckets, ModelScope, and Hugging Face itself as one source among many. The catalog is a κ-addressed, signed, hash-chained object (the daily ledger already is), found from `/.well-known/model-hub.json`, so any mirror can serve it. Search becomes static κ-addressed shards. Decide how health and latency facts are gathered without a central probe.
5. Coverage that is total. A request for a model not yet indexed must still work. Recommendation to test: on a miss, answer from the Hugging Face origin (redirect plus metadata passthrough), and let whichever runner downloads the bytes hash them in-stream and offer a witness record, so the index grows from use. Make contribution opt-in and say what it reveals about the user's downloads.
6. Three runners, one kernel. Static hosting cannot answer `HF_ENDPOINT`: it cannot set `X-Repo-Commit` on a `HEAD` or redirect with custom headers. So "serverless" means no stateful server, not no HTTP. Recommendation to test:
   - Local runner: one Rust binary on Hologram (`hologram hub`, or a `hub` binary), serving the HF dialect on `127.0.0.1`, store in redb, peers over DHT and QUIC, every byte verified against the manifest before it enters the shared HF cache. It is the only runner that can guarantee integrity for every client, because it proxies the bytes. Lowest latency after first use.
   - Edge runner: a stateless worker anyone can deploy (Cloudflare Workers or equivalent), reading κ-addressed catalog shards and redirecting to verified sources. Zero install, used by `HF_ENDPOINT=https://gethologram.ai`. Integrity depends on source reputation and client-side checks; say so in the UI.
   - Browser runner: a service worker over OPFS for the web UI, transformers.js and browser verification, loading the kernel holo with `prism-code/browser` `load()`, which checks it and replays its vectors at boot.
   Decide whether the edge can run the holo itself (WebAssembly in the worker), or must run a generated, conformance-checked port of the kernel. Measure it.
7. Throughput. Match or beat `hf_xet`. Options: parallel multi-source `Range` reads verified per Bao piece (Ollama already does 16 parallel ranges against the hub), Xet compatibility by emitting `X-Xet-Hash` and serving `/v2/reconstructions` whose terms point at tensor-aligned ranges on any source, or both. Decide with measurement. Note that Xet chunks are content-defined and tensors are not, so state exactly what dedup each gives across fine-tunes of one base model.
8. Upload and publish. `hf upload` and `HfApi.create_commit` to the hub: `repos/create`, `preupload`, LFS batch or Xet write path, NDJSON `commit`, all producing a signed manifest. Decide what an account is (a signer identity) and where uploaded bytes go (the publisher's own storage, a pinning provider, peers).
9. What is out of scope, honestly. Private and gated repositories (gated mirrors are refused today), Spaces, Inference Providers (hardcoded router), discussions, likes, collections, webhooks. Keep every JSON key clients read; fill counts truthfully or with zero. Name every tool that cannot be reached through `HF_ENDPOINT` and the one line that reaches it instead (for Ollama, `ollama pull gethologram.ai/<org>/<name>:<quant>`).

Generate at least three materially different architectures, for example: (A) keep the Node hub and its dialects, add the kernel as a checked library; (B) stateless kernel plus three thin runners on Hologram, as above; (C) native Xet CAS reimplementation with tensor-aligned xorbs and the kernel only for admission. Kill all but one with evidence. For the survivor give the component diagram, the request and fact encodings, the sequence for `from_pretrained` of a sharded model on a cold machine and on a warm one, and the exact files that change in each repository.

## Proof plan

Prove universally, not on one example. Rank by harm prevented and by Lean cost (keep each entrypoint under the 600 s Lean stage; put proofs in sibling modules).

- Delivery: for every expected and computed κ, bytes are delivered only when they are equal.
- Admission: for every manifest and verdict set, nothing is admitted without a signature that the trust policy accepts for that namespace; a witness signature is never presented as a publisher signature.
- Headers: every 2xx or 3xx resolve plan carries a commit and an ETag; every error plan carries a code from the closed set.
- Privacy: a missing repository and a private repository produce byte-identical responses.
- Source choice: `select` is total, honors `/via` and `only`, and never returns a source that failed verification for that κ.
- Revisions: resolution is deterministic, and a tag or commit never maps to two manifests.
- Commit: a new revision's parent is the current head, and the revision record is hash-chained.

The runners' hashing and signature checking stay audited, not proved, until `PP2011` opens; the conformance suite replays recorded transcripts through kernel and runners and checks the runners' effects match the kernel's plans.

## Performance budget (targets to confirm against the Phase 1 baseline)

- Metadata at the edge: `HEAD` resolve and `/api/models/{repo}` p50 under 20 ms, p99 under 80 ms from a cache hit.
- Local runner: `HEAD` resolve under 2 ms on a warm cache; a warm `from_pretrained` re-check adds under 50 ms over offline mode.
- Kernel: under 0.05 ms per request on the memoized path; under 1.1 ms on a miss.
- Cold download throughput at least equal to `hf_xet` from the same region, and higher where two or more verified sources exist.
- Verification adds under 5 % to download wall time.
- Web UI first paint under 1 MB and under 1 s on a mid-range phone.

## Phase 3 — Deliverables

1. Fact sheet: every Hugging Face feature a user touches, whether the hub supports it, where it lives, how it is verified.
2. Decision record: three architectures, why two died, the winner, trade-offs after the recommendation.
3. Specifications: the manifest schema, the signature statements, the source record, the catalog and search shards, the HF dialect contract as response tables per endpoint.
4. The kernel: LexLean modules through the `lexlean` MCP (`lexlean_profiles` with `prism-app`, `lexlean_draft_assemble`, `lexlean_check`, `lexlean_verify`), built from the template by `npx prism-code build --remote github`, with every proved theorem listed.
5. The conformance suite from the recorded transcripts, run against huggingface.co, today's gethologram.ai and each runner. A runner ships only when it matches huggingface.co on every transcript.
6. Benchmarks against the Phase 1 baseline, per region, published at `gethologram.ai/benches/`.
7. Upstream changes, ordered, with the issue each is filed under: Hologram (HTTP-CAS `Range` and CORS, Bao verified streaming, provider records on the DHT, bootstrap nodes, wasm bindings for the store), PrismPM (`PP2011` effects for fetch, store, digest and sign), the template (in-holo provenance so `check` reaches P1 and P2).
8. Milestones that each end in something a user can run, the first in two weeks: (1) kernel v0 with `resolve`, `revision` and `accept` proved, loaded by the existing hub, conformance suite green for `hf download` and `from_pretrained`; (2) local runner with verified multi-source download into the shared HF cache; (3) signed manifests, publisher and witness signatures, verified badge in the UI; (4) lazy total coverage and opt-in witness contribution; (5) edge runner and static search shards replacing the VPS; (6) `hf upload` publishing; (7) Xet-compatible reconstruction if measurement justifies it.
9. Risks with the experiment that settles each and its cost in days. At least: the 64 KiB request cap on huge repositories; the edge cannot run the holo; clients reject cross-host redirects for some sources; tensor-level dedup is worse than Xet chunk dedup on fine-tunes; nobody runs sources, so Hugging Face stays the only real source; namespace squatting.
10. One paragraph a beginner understands, and one sentence answering: can a user switch with one line and feel no difference, yes, no, or yes if.

## Rules

- Lead with the answer, reasoning second. Recommend, then qualify.
- No jargon without a five-word definition. No analogies. No hedging where you hold a view.
- Never edit files under `prism/` by hand. Never claim a proof you did not run.
- Never create a repository, push, publish, pin or post without the user's approval in chat.
- Put no tokens or private data in LexLean drafts; the hosted verifier's drafts are unlisted, not private.
- Keep the conformance transcripts free of tokens and personal data before committing them.
- Prefer cutting a feature over keeping it unverified only when no user would notice; otherwise keep it and mark it tested.
