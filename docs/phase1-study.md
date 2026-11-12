# Phase 1 study

2026-11-12. Answers Phase 1 of `docs/brief.md`. "Measured" means run that day from one Windows machine whose Hugging Face edge is London (`X-Amz-Cf-Pop: LHR3-P3`). "Read" means found in source at the cited path. "Unverified" means not checked. Scripts and raw output are in `docs/phase1/evidence/`.

## Answer

The brief's design holds, with five changes forced by evidence.

1. Only a runner that carries the bytes can promise integrity. No Hugging Face client except Ollama checks content after a download. A hub that redirects cannot protect them.
2. Hologram cannot serve or store multi-gigabyte tensors today, and its crates are not on crates.io. This repository forbids git dependencies in shipped code, so the local runner is blocked on upstream work.
3. A model's facts do not always fit one kernel request. The kernel must work on one file row at a time; list-shaped answers are built page by page.
4. The live hub's ETag for small files differs from Hugging Face's. Switching `HF_ENDPOINT` today changes cache blob names.
5. The edge latency target in the brief was below the network floor. It is restated as server time.

## 1. Repository layout: one repository

`template-contract.json` binds seven universal paths (`.devcontainer/devcontainer.json`, `.github/workflows/bootstrap.yml`, `AGENTS.md`, `VERIFICATION.md`, `prismpm.lock`, `template-contract.json`, `template.lock`). `TEMPLATE-CONTRACT.md` lines 26 to 36 say product source, workflows and deployment targets are project content. Runner, edge, web and ingest code may live here.

What that costs:

- R6 (`AGENTS.md`) and `deny.toml` refuse git and path-only dependencies and any registry but crates.io. Licences allowed today: Apache-2.0, MIT, Unicode-3.0.
- Rust code joins the workspace (`crates/*`) under `clippy -D warnings`, `missing_docs = "deny"` and `cargo deny`.
- R3: each capability starts as a registered ID, a scenario and a failing test. R4: nothing stubbed.
- `xtask/src/audit.rs:165` scans `crates/`, `xtask/` and every root-level Markdown file for deferral markers. Documents under `docs/` are not scanned.
- `just vv` runs only inside the SDK image pinned by `prismpm.lock`. It was not run here.

`npx prism-code@latest setup --dry-run` (0.7.2), measured: node ok, line endings ok, GitHub ok with `build.yml` present, `lexlean` and `prism` servers already configured for Claude Code.

Dependabot opened two pull requests on the new repository within a minute of creation (pinned actions, build policy). They are untouched.

## 2. What clients verify (measured)

Tested with huggingface_hub 2.4.0, hf-xet 1.8.0, Python 3.13, against a fake hub on `127.0.0.1` that redirects to a second port acting as an untrusted host. No real token was used.

| Client | Follows a redirect to another host | Verifies content | Evidence |
|---|---|---|---|
| huggingface_hub 2.4.0, plain HTTP | Yes; token not sent there | Size only. One flipped byte is accepted and cached; later calls are cache hits | `out_fact1.txt`; `file_download.py` L490-495 |
| same, no `X-Linked-Size` | Yes | Nothing. A truncated file is cached | `out_fact1.txt` case C3 |
| same, resumed by `Range` | Yes | Garbage in the resumed tail is accepted | `out_range_xet.txt` |
| hf_xet 1.8.0 | Yes | Lengths only. A fake store with invented file, xorb and chunk hashes is accepted on both reconstruction versions | `out_fact2.txt`; xet-core `deserialize_async.rs` L25-45 |
| `snapshot_download` | Yes | Accepts a corrupted file although the tree listed the true SHA-256 | `out_fact1.txt` |
| llama.cpp `-hf` (ab4a77b) | Yes; sends `HEAD` to the target too | No content hash | read: `common/download.cpp` L345, L873 |
| Rust hf-hub 0.5.0 | Yes | None. It also sends the user's token to the redirect target | read: `src/api/sync.rs` L67-72, L559-579 |
| transformers.js 4.3.2, `@huggingface/hub` 2.17.11 | Yes, with CORS on both hops | None | read |
| `HfFileSystem`, datasets | Yes, on every ranged read | None; a target that ignores `Range` corrupts reads silently | read: `hf_file_system.py` L1576-1584 |
| Ollama (8a89b76) | Only to the same host or Hugging Face hosts on `HEAD`; blob parts go anywhere | Yes, SHA-256 per layer | read: `server/images.go` L1870-1888 |

The fix upstream was declined: huggingface/xet-core#967, which re-hashed each downloaded file, was closed unmerged on 2026-09-17. `HfApi.verify_repo_checksums` exists but no download calls it.

Consequences for the design:

- The local runner is the product. It is the only place every byte can be checked before a tool reads it, and Hugging Face itself does not offer that.
- The edge runner must always send `X-Linked-Size`, must never send `X-Xet-Hash`, and must leave `xetHash` out of tree answers, so clients stay on plain HTTP (measured: omitting the header keeps hf_xet 1.8.0 off the Xet path).
- The kernel's source choice needs two classes. Vetted sources may be redirect targets. Unvetted sources (peers, unknown hosts) are used only by the local runner, which verifies. One reason is the hf-hub 0.5.0 token leak.
- Every redirect target must honour `Range`, answer `HEAD`, and send CORS headers exposing `Content-Range`, `ETag` and `Content-Length`.
- A Xet-compatible read path is cheap to serve (token route, `/v2/reconstructions`, chunk-framed ranges; `run_fact2_fakecas.py` is a working minimal store) but needs sources that hold chunk-framed bytes. It stays an option for hub-run nodes, not for arbitrary hosts.

## 3. The live hub: inventory (read at `hologram-live` cbbf97b)

Twenty decisions were found in `deploy/hub-resolve.mjs`, `deploy/tensor-mirror.mjs` and siblings. Seventeen are pure given facts: route order, repository id normalisation, revision resolution, source choice, gating, ETag choice, Range arithmetic, error vocabulary, Ollama tag to file, OCI manifest construction, search and tree semantics, tensor blob plan, assembly plan. Three hold state or I/O: health probing (process-local, 30 s), the account rate limiter, the publish chain walk.

Sizes that constrain the kernel (measured live):

- Files per model, 402 addressed models: p50 22, p90 87, p99 231, max 784 (`burner22/numbat`). The 784-file model is 92 KB as compact JSON, over the 64 KiB request cap. About 11 models exceed it (estimate).
- Largest answers today: tree 208 KB, ModelPack manifest 388 KB, list at `limit=500` 313 KB, tensor records 690 KB (878 tensors). All under 1 MiB, none bounded by construction.

Gaps against the Hugging Face contract:

| Gap | Effect |
|---|---|
| ETag for small files is SHA-256; Hugging Face sends the git blob SHA-1 (measured: `config.json` of `openai-community/gpt2` is `10c66461…` there, `0daed774…` here) | Cache blob names differ; a user switching endpoints re-downloads small files. Tree `oid` has the same fault |
| `paths-info`, `commits`, `whoami-v2`, safetensors metadata, `/api/datasets`, `/api/spaces`, all upload routes are missing | `HfFileSystem`, datasets and `hf upload` fail |
| `datasets/x/resolve/…` is parsed as a model named `datasets/x` | Wrong answers for dataset requests |
| Refs list `main` only; other revisions answer 404 | Pinned revisions and tags fail |
| Tree has no pagination and ignores `expand` | Large repositories, `HfFileSystem` |
| Model info has empty `tags`, zero `downloads`, no `cardData`, `lastModified` or `pipeline_tag` | Library auto-detection, model cards |
| Small files answer `302`; Hugging Face answers `307` to a relative path | Works in huggingface_hub (measured on the fake hub); costs one extra cross-host hop |
| Errors are cacheable for 60 s | A fixed model keeps failing for a minute |
| Four sources of truth with a precedence order; tensor-indexed models shadow the ModelPack answer on `/v2/<org>/<name>` | The first job of the kernel is one truth |
| The tensor index holds 19 models and is dated 2026-09-25; the nightly job is proposed, not scheduled | Tensor addressing is a pilot |

Reusable as the conformance seed: `deploy/qa/shim-contract.mjs`, `deploy/qa/records-dialects.mjs`, `tensors/check-dialects.mjs`, `web/qa/hf-dialect/matrix.sh` and `recorder.mjs`, `web/qa/openapi/evidence.json`, `deploy/qa/verify-edge.mjs`. None was run here.

## 4. Hologram: what the runner can use (read at b6d9a76)

Ready: the κ-label type and its five axes (`uor-addr` 0.2.0, on crates.io), `verify_kappa` for blobs that fit in memory, the `KappaStore` and `KappaSync` contracts, the redb store for small objects, the frame codec, browser `opfs_put/get/gc` for small blobs.

Not ready for tensors:

| Need | State | Where |
|---|---|---|
| Crates on crates.io | `uor-hologram`, `hologram-space`, `-store`, `-net` are not published (registry 404). Release notes point to git | `.github/workflows/publish.yml:166-168` |
| Streaming hash and verify | `verify_kappa` takes the whole blob as one slice | `hologram-space/src/substrate.rs:181` |
| Verified byte ranges | None. BLAKE3 is pinned at 1.5.5 | `Cargo.lock:275` |
| Large-blob store | redb, 64 KiB shards, one write transaction per shard, whole-blob reads at about twice the blob in memory. No file-per-κ backend, no mmap in use | `hologram-store/src/native.rs:465-529` |
| HTTP serving | One thread, serial connections. No `Range`, `HEAD`, `ETag`, CORS, keep-alive or TLS | `hologram-net/src/http/live.rs:64-160` |
| Fetch | Sources tried one after another, whole blob, no resume | `substrate.rs:1279-1324` |
| Who holds κ | The DHT stores provider records but lookup is private, records are unsigned and never expire, and there is no NAT traversal or bootstrap node | `hologram-net/src/tcp/mod.rs:152-154, 477` |
| Browser peer fetch | One 256 KiB frame per blob, manual signaling, no STUN or TURN | `holospaces-browser/src/lib.rs:653`, `webrtc.rs:156-163` |
| safetensors | Not parsed in Hologram; only in hologram-ai, which depends on a fork by git | `hologram-ai/Cargo.toml:42-54` |
| Serving benchmarks | None for hashing, store or fetch throughput | `BENCHMARKS.md` |

Closest working pieces outside the engine: `kappa-registry` already stores a file per digest and serves `HEAD`, `ETag`, CORS and single `Range` (`kappa-module-oci/src/blob.rs:243-275`), with a 256 MiB cap, in-memory 206 bodies and git dependencies of its own. hologram-ai's `DirKappaStore` (`materialize.rs:92-145`) is a file-per-κ store. hologram-ai's browser worker already hashes tensors incrementally with BLAKE3 and records κ to URL and byte range (`download.worker.ts:83-139`).

Licences that a Hologram dependency would add beyond today's allow-list: BSD-2-Clause, BSD-3-Clause, ISC, Zlib. No copyleft.

## 5. Baseline (measured, `baseline.json`)

Thirty requests on one warm connection per case, `openai-community/gpt2`.

| Case | huggingface.co p50 / p99 | gethologram.ai p50 / p99 |
|---|---|---|
| `HEAD` resolve, small file | 110 / 129 ms | 91 / 104 ms |
| `HEAD` resolve, weights | 105 / 178 ms | 93 / 122 ms |
| `GET /api/models/{repo}` | 108 / 130 ms | 96 / 421 ms |
| `GET` tree | 106 / 135 ms | 93 / 124 ms |
| `GET /api/models?search` | 109 / 136 ms | 89 / 104 ms |

TCP connect: 21 ms to Hugging Face's edge, 41 ms to the hub's single host. So Hugging Face spends about 85 ms of server time per metadata call and the hub about 50 ms. First request on a new connection: 190 to 380 ms there, 310 to 730 ms here.

Throughput, 64 MiB ranged read, one stream, two runs each: 44 MB/s direct, 39 MB/s through the hub. The hub's path is two redirects (hub, Hugging Face, CDN) and costs about 0.2 s per file.

Not measured: a second region, a 15 GB model, `hf_xet` parallel throughput, warm `from_pretrained` re-check time.

## 6. Decisions changed by the evidence

| Brief | Now | Why |
|---|---|---|
| Edge metadata p50 under 20 ms | Server time under 5 ms; wall time is one round trip plus that | The round trip alone is 21 ms from here |
| Tensor κ in BLAKE3, ranges verified by Bao | Tensor κ in BLAKE3, ranges verified by a list of 1 MiB piece hashes whose own κ is in the manifest; Bao when Hologram's BLAKE3 pin moves | The hub's 1 MiB piece lists already work; Hologram pins BLAKE3 1.5.5; hologram-ai and `WeightStore` already address tensors by BLAKE3 of raw bytes |
| Local runner built on Hologram crates | Blocked until `hologram-space`, `-store`, `-net` are published with streaming, a file-per-κ store and ranged HTTP. Until then the existing Node hub is the only runner | R6 and `deny.toml` |
| Kernel takes a model's facts | Kernel takes one file row, or one page of rows, per request; the runner joins pages | 784-file model exceeds 64 KiB |
| Edge may redirect to any verified source | Edge redirects only to vetted sources; unvetted sources are local-runner only | No client verifies; one client leaks tokens to targets |
| Manifest carries SHA-256 per file | Also the git blob SHA-1 and an LFS flag per file, recorded at ingest | Hugging Face's ETag and tree `oid` for small files |
| Xet compatibility as a late milestone | Unchanged in order, but known to be cheap to serve and to add no integrity | `out_fact2.txt` |

## 7. Order of work this implies

1. Kernel v0 in this repository: `resolve`, `revision`, `select`, `accept` over one file row, proved, with acceptance vectors taken from the recorded Hugging Face answers. No Hologram dependency.
2. Wire the existing hub to call the kernel and close the contract gaps in section 3, ETag first. Conformance suite from the hub's QA scripts plus `fakehub.py`.
3. Upstream to Hologram, in this order: publish the three crates; streaming verify; `len`, `get_range`, `put_stream` on `KappaStore`; a file-per-κ backend; ranged, concurrent HTTP-CAS; parallel multi-source fetch with per-piece verification.
4. Local runner on those crates. This is where the integrity promise becomes true.

## 8. Not done in Phase 1

- Full client transcripts against huggingface.co (transformers, diffusers, sentence-transformers, datasets, vLLM, `hf upload`). Only `hf_hub_download` and `snapshot_download` request sequences were observed, on the fake hub.
- Baseline from a second region and for a 15 GB model.
- `just vv` and any build in the SDK image.
- The hub's own QA scripts.
- Which hf-hub version TGI, candle and text-embeddings-inference pin.
- Whether LM Studio honours any endpoint setting.
