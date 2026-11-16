# Prompt: the hub as a drop-in Hugging Face, with every tensor named by its content

Companion to [brief.md](brief.md), which started this repository. That brief
asked for a decentralized Hugging Face and got a proved kernel, an addressed
index of every public model, and a dialect that answers eleven read routes.
This brief asks for the rest: the whole surface mapped, every tensor addressed,
and the LexLean model updated so "drop-in replacement" is something a gate can
reject rather than something a page asserts.

## Role

You are a principal systems architect who works from first principles and
recommends one design with evidence. You know the Hugging Face Hub wire
protocol, Xet and LFS, safetensors and GGUF, content addressing, Sigstore and
in-toto, Rust, WebAssembly, Lean 4, LexLean and PrismPM.

Every claim names a file, a command you ran, or a page you read, with the date.
Use four words and no others: **proved** for what Lean proved in your own run,
**tested** for what acceptance vectors or conformance transcripts cover,
**measured** for what you timed yourself, **unverified** for everything else.
A number without one of those four words is a defect in your answer.

## Mission

Make the hub a drop-in replacement for Hugging Face, where "drop-in" is
measured against the authority rather than asserted, and where every open
model's tensors are indexed by the content address of their own bytes, so a
byte that arrives can be checked by whoever receives it and a byte that repeats
is stored once.

Three outcomes, in priority order:

1. **A complete map.** One row per Hugging Face operation, with a verdict from
   a closed vocabulary, derived from the published specification rather than
   written by hand, and wrong in a way a gate catches.
2. **Tensor-level content addressing.** A model release names every tensor by a
   κ over its bytes and a layout that rebuilds each file from them byte for
   byte, so identical tensors across fine-tunes are one object, a range can be
   checked without the whole file, and the identities Hugging Face clients
   expect still appear where they expect them.
3. **The model updated, not the prose.** Every new behaviour arrives as a row
   in `model/ids.toml`, a scenario, a failing test, a LexLean decision proved
   in Lean, and a planted defect the gate rejects. `CONFORMANCE.md` is
   regenerated, never argued with.

## What is true in this repository today (verify, do not assume)

Read and measured on 2026-11-15 in this worktree.

| | |
| --- | --- |
| Proved decisions | `HK-01` to `HK-22` in `model/ids.toml`, 22 rows, every one `level = "build"` |
| Proof modules | 22 under `app/src/Proofs/` |
| Acceptance vectors | 79 in `app/tools/vectors.json` |
| Claims cited, not proved | none: `model/authorities.toml` and `model/ledger.toml` are both empty |
| Generator chain | `app/tools/site_spec.py` plus `gen_kernel.py` write `app/src/Site.lex.tex`, `app/src/Kernel.lex.tex` and `app/tools/vectors.json`; nothing else may name a screen or a route |
| Dialect answered | 11 read routes in `site_spec.py` `ENDPOINTS`, with an 11-entry `X-Error-Code` vocabulary in `ERROR_CODES` |
| Runners | `edge/edge.mjs` redirects only and `runner/local.mjs` serves only (`HK-03`); `web/` is the interface, with `web/sw.js` |
| Catalogue | 3,152,295 model rows, sharded by the first 11 bits of `sha256(id)` into 2,048 NDJSON shards under `data/roll/shards/%03x.ndjson` |
| Browse index | `hologram.hub.browse/v2`: per-sort order files of 8-byte entries holding shard, offset and length; per-facet posting lists; a word index bucketed by a word's first two characters |
| Page cost, live | measured 2026-11-15 from Node against the published site: one unfiltered page of 42 rows costs 1,740 ms over 3 serial stages and 44 requests, against 4,365 ms over 4 stages and 86 requests before the order layout changed |
| Release record | `hologram.hub.release/v4`, carrying `repo`, `revision`, `origin{kind,resolve}`, `files[]{path,size,gitSha1,sha256?}` and `sources[]` |
| Acceptance gate | `just vv` = `fmt-check model template-check lint test deny app`, inside `ghcr.io/uor-foundation/prismpm-sdk-candidate@sha256:cd3b47d7a370c4a26b8285f5e9c3bb15e639973c55505c3809ddbe55352fea58` |

What is **not** built, and has no row because it is not built: upload and
commit, datasets, Spaces, inference, accounts, discussions, collections, gated
and private repositories, and anything per-tensor. The index addresses whole
files. No tensor in this repository has an address.

Read before designing: `AGENTS.md` for the six universal rules,
`VERIFICATION.md` and `TEMPLATE-VERIFICATION.md` for what each gate has been
shown to reject, then `docs/brief.md`, `docs/model-roll.md`,
`docs/phase1-study.md` and `docs/cutover.md`.

## What Hugging Face is, and where its own authority stops

Hugging Face publishes a machine-readable surface. Downloaded 2026-11-15:

- `https://huggingface.co/.well-known/openapi.json` — **379 operations across
  310 paths in 28 tags**, `info.version` `0.0.1`, one server
  (`https://huggingface.co`), one security scheme (`bearerAuth`). A Markdown
  rendering is at `/.well-known/openapi.md`.
  `https://huggingface.co/docs/hub/api` now says the specification, not the
  page, is the reference.

  That file's own digest is not a pin. Measured 2026-11-15: two downloads
  seconds apart differ, because the document carries the time of the request as
  a query parameter's default. Its byte length moves between clients too
  (1,227,789 from `fetch`, 1,227,297 from `curl` within the hour). So the pin is
  a digest over the operations themselves —
  `d3acb92cb9ba07c23e09fe8b950013c8f7b1b0d4af5e7536b12dc8d129ac57f4` on that
  date — and `node tools/hf-surface.mjs --refresh` is what reports whether the
  surface, rather than the clock, has moved.

The operations, their tags and what this hub does with each are in
[hf-surface.md](hf-surface.md), generated from the pinned inventory. This brief
does not repeat that table: it would be a second copy of the same claim.

**The authority is incomplete in exactly the place that matters.** Four of the
twelve operations this hub declares are absent from `paths`: `HEAD` on the
resolve route, `GET /api/models` for list and search, `GET /api/models/{repo}`
for model information, and the same at a named revision. The first is what
every `huggingface_hub` download begins with, and the next two are what every
client and every page reads most. So the specification bounds the *breadth* of
the map and cannot settle the *shape* of a response. Recorded client
transcripts are the authority for shape, as `docs/brief.md` Phase 1 item 4
already required.

Beyond the wire, the surfaces a user touches, from `https://huggingface.co/docs`
on 2026-11-15: Hub, Hub Python Library, CLI, Huggingface.js, Tasks, Dataset
viewer; Inference Providers, Inference Endpoints, Text Embeddings Inference;
Transformers, Diffusers, Datasets, Transformers.js, Tokenizers, timm, Sentence
Transformers, Kernels; PEFT, Accelerate, Optimum, TRL, OpenEnv, Safetensors,
Bitsandbytes, Lighteval; Gradio, Trackio, smolagents, LeRobot, Chat UI,
Leaderboards, Xet.

Three facts about reach, from `docs/brief.md`, to be re-verified before coding:
the shared cache layout (`models--{org}--{name}/blobs/{etag}`,
`snapshots/{commit}/{path}`, `refs/`, `.no_exist/`) forces SHA-256 and
git-blob-SHA-1 identities to survive at the edge whatever the internal κ is;
`HF_ENDPOINT` does not reach Ollama `hf.co/...` names, `@huggingface/hub`
without `hubUrl`, Docker Model Runner, the dataset viewer, or the Inference
Providers router; anonymous limits are 3,000 resolver and 500 API calls per five
minutes per IP.

## The Q engine, the inference plane

`C:/hl/src/prism-hologram-ai-q`, which is
`Hologram-Technologies/prism-hologram-ai`, read 2026-11-15 on branch
`q-engine-qwen2` at `6db8f9b`.

It is this same template in three planes: a LexLean kernel proved by Lean, a
Rust-to-WebAssembly engine tested against external authorities, and a page
tested by browser journeys. 51 registered IDs — 17 `KN-` kernel decisions, 28
`EN-` engine capabilities, 6 `GP-` GPU capabilities — 50 `build` and one
`some-true`, with 17 proof modules. It runs GGUF and ternary models in a
browser tab on WebGPU, admits every weight block by its BLAKE3 label before use
(`KN-05`), checks each tensor byte range against the file (`KN-06`), chooses the
backend from the adapter and its binding limit (`KN-12`), and derives a block's
required length from its format and shape (`KN-13`).

Read `docs/Q_ENGINE_PLAN.md` first. Two of its decisions are this repository's
work, and are why the Q engine is in this brief:

- **Decision 9.** Models are pulled from the decentralised hub as easily as
  from Hugging Face: the loader takes a base URL plus repo, revision and path
  in Hugging Face's resolve form, never a fixed host.
- **Decision 10.** The page does the hub runner's job itself. It checks the
  hub's signed index and the model's record **with the hub's own code, reused by
  agreement rather than rewritten**, asks the hub kernel's resolve decision
  (104 bytes) which source to use, range-fetches from it, and asks the hub
  kernel's accept decision (81 bytes) on the whole file's SHA-256 and size.

Its blocked item 5 is owed by this repository: *an importable module for
reading the index and record — `web/client.mjs`, proposed, not started. Only
`web/sigstore.mjs` is importable today. Without it, checkpoint 1 would have to
read the record itself, which duplicates the hub's code, so it waits.* That
duplication is what `AGENTS.md` R1 forbids, so the module is not a convenience.
It is the only way the Q page can read a hub record without giving the record a
second source.

"A drop-in replacement for the transformers.js engine" means the surface of
`@huggingface/transformers`, verified on its documentation page on 2026-11-15:
`pipeline(task, model, { device, dtype })`, with `device: 'webgpu'` or the
default WASM path over ONNX Runtime, and dtypes `fp32`, `fp16`, `q8`, `q4`.
Verify the rest — the `Auto*` classes, the `env` object and its remote-host and
backend fields — from the API reference before mapping it; this brief has not
verified them. Then say which part of that surface the Q engine can present
today, which part needs ONNX import (`KN-10`, `EN-04`, `EN-05`), and which part
is honestly out of reach, with the one line a caller writes instead.

## Phase 1 — Map the surface, mechanically

**Done on 2026-11-15, except the transcripts.** `docs/hf-surface.md` is
generated, and `node tests/surface/map.mjs` gates it. Of 379 operations: 6
`answered` from the index, 1 `partial`, 25 `passthrough`, 36 `refused`, 9
`unreachable`, 302 `out-of-scope`. The hub declares 12 operations and 4 of them
Hugging Face does not document. What is still owed is the second half: the
recorded client transcripts, and with them the traffic fraction and the proof
that a client cannot tell the difference on any operation the map calls
`answered`. Until those exist, `answered` means "built from the index and read
from the source", not "tested".

Produce `docs/hf-surface.md`, **generated** by a new `tools/hf-surface.mjs` from
a committed reduction of `openapi.json` pinned by a digest over the operations
themselves, plus the set of operations this repository claims to answer,
declared in `site_spec.py` beside `ENDPOINTS`. Handwriting the table is
forbidden: the map must be re-derivable, and a route that changes on either side
must change the generated file. Do not pin the published file by its own sha256
— it carries the time of the request, so that digest moves between two
downloads a second apart and a gate built on it fails on Hugging Face's clock.

One row per operation — method, path, tag — with a verdict from exactly this
vocabulary:

| Verdict | Means |
| --- | --- |
| `answered` | The hub answers it today, and a conformance transcript shows a client cannot tell the difference |
| `partial` | Answered, with named fields absent; the response says so rather than inventing a value (`HK-15`) |
| `refused` | Not answered, and refused with the code Hugging Face uses for that case, never a success with no effect |
| `unreachable` | Cannot be answered through `HF_ENDPOINT` at all, with the one line a user writes instead |
| `out-of-scope` | Deliberately not a hub concern, with the reason in one sentence |

Then make the map a gate rather than a document. A new check fails when
`site_spec.py` claims an operation the conformance suite does not cover, when
the suite covers an operation the map calls `refused`, or when the pinned
snapshot's digest does not match the file. Per `AGENTS.md` that check is
evidence only after you plant the defect — mark one `refused` route `answered`
— and record the failing command, its diagnostic and the restored result in
`TEMPLATE-VERIFICATION.md`.

Alongside it, record the transcripts that are the authority for shape:
`hf download`, `snapshot_download` with patterns,
`AutoConfig`/`AutoTokenizer`/`from_pretrained` for a sharded model,
`HfApi.list_models`, `model_info`, `list_repo_tree`, `get_paths_info`,
llama.cpp `-hf`, a vLLM load, and `@huggingface/transformers` in a browser.
Record the versions. Strip the tokens.

Deliver one number at the end of Phase 1: **of 379 operations, how many are
`answered`, and what fraction of real client traffic those cover.** The second
number matters more than the first, and needs the transcripts to compute.

## Phase 2 — Decide the tensor layer

The product sentence is "every open model tensor indexed by its unique content,
giving it a self-verifying hash". Decide and justify each of these, with
measurement wherever measurement is possible:

1. **What a tensor κ is over.** Recommendation to test: `blake3:<hex>` over the
   tensor's raw little-endian bytes alone, so dtype, shape, model, file and
   position change nothing, and BLAKE3's tree mode lets a receiver check any
   range without the whole file. State what `uor-addr` gives today in
   `Hologram-Technologies/hologram` — the 71-byte `KappaLabel71`, the `blake3:`
   default, `verify_kappa` on receipt — and whether a range proof exists or is
   owed upstream.
2. **The layout.** Per file, the header bytes plus an ordered list of tensor κs
   that rebuild the file byte for byte. safetensors first, then GGUF, then the
   `HOLK1` weight container the Q engine already reads.
3. **Both identities, side by side.** SHA-256 per file and git blob SHA-1 for
   small files stay the compatibility identity the shared cache and the ETag
   need (`HK-08`); the κ is the internal identity. Say exactly where each
   appears, and prove a κ is never emitted where a client expects the other.
4. **What dedup is worth.** Measure it: across one base model and three
   fine-tunes, how many bytes do tensor-level κs save, and how does that compare
   with Xet's content-defined chunks at 8 KiB minimum, 64 KiB target, 128 KiB
   maximum. Report both. Recommend on the numbers, not on the architecture.
5. **Index cost at scale.** 3,152,295 models at tens to thousands of tensors
   each is the largest object in this system by orders of magnitude. Decide the
   shard layout, the published size, and what a page or an engine must fetch to
   check one tensor. The published-site limit is 1 GB and every file is served
   with `max-age=600`, so immutability has to be asserted by the client, not the
   host. Say whether the tensor index belongs on Pages at all.
6. **Coverage that is lazy and total.** A tensor nobody has addressed yet must
   still be fetchable. Decide how the index grows from use, what a witness
   record is, and what it reveals about whoever contributed it.

## Phase 3 — Update the model

This is the deliverable the brief is named for. Follow `AGENTS.md`'s workflow
exactly, one capability at a time: the row in `model/ids.toml` with its honesty
level, the scenario in `features/suites/`, the failing test, the LexLean
decision and its proof module, `just model-write`, the planted defect, then
`just vv` in the pinned image.

Draft statements for the next rows, to be sharpened before registration. Each
must be a decision a pure guest can make — small facts in, a plan out, inside
the 64 KiB request and 1 MiB response caps. Do not register a row you cannot
prove, and do not register one whose behaviour is not built.

**Tensor addressing**

- A file's layout rebuilds it exactly: for every layout the kernel accepts, the
  header bytes followed by each tensor's bytes in order have the file's length
  and the file's address, and a layout that does not is refused.
- A tensor's address depends only on its bytes: the same bytes in two models,
  two files or two positions give one address, and nothing about dtype, shape or
  name enters it.
- A byte range is admitted against the tensor it falls in, never against the
  whole file, and a range crossing a tensor boundary is refused by name.
- A κ is never emitted where a client expects a git or SHA-256 identity, and a
  file is delivered only when the identity the client will cache it under is the
  identity the record names.
- A release whose layout and whose compatibility digest disagree has no address,
  and the page says which of the two is missing rather than choosing one.

**Drop-in honesty**

- A response the hub builds carries every key the client reads for that
  operation, and a key the record cannot supply makes the answer partial —
  extending `HK-15` from the listing to every mapped operation.
- A write the hub cannot perform is refused with Hugging Face's own code for
  that case, and no refusal is ever reported as a success.
- A cursor names a position in one order, and following cursors from the first
  visits every row exactly once: the property the 8-byte order entry now makes
  checkable.
- A request naming a repository kind the hub does not serve is refused by name,
  never answered as a model.

**One reader, one record**

- The record the importable client module reads is the record the kernel is
  asked about: for the same bytes, the module's answer and the kernel's facts
  agree, so a second reader cannot disagree with the first.
- For the same file facts, the hub's accept decision and the Q kernel's `KN-05`
  admission give the same verdict.

Ship `web/client.mjs` in this phase: index root, browse index and release record
reading, importable with no page state, exporting the exact request bytes the
hub kernel's resolve and accept decisions take. It unblocks the Q engine's
checkpoint 1 item 5, and it is the only way two pages read one record without
giving it two sources.

## Phase 4 — Deliverables

1. `docs/hf-surface.md`, generated, with the answered count and the traffic
   fraction, and the gate that rejects a false claim in it.
2. The decision record for Phase 2: the κ definition, the layout, the dedup
   measurement against Xet, the index shard design, and what was rejected and
   why.
3. The registered capabilities, with `CONFORMANCE.md` regenerated and every
   planted defect recorded in `TEMPLATE-VERIFICATION.md`: the command, the
   diagnostic, and the restored result.
4. `web/client.mjs`, with the Q engine's own session confirming it unblocks
   item 5.
5. The conformance suite built from the recorded transcripts, run against
   huggingface.co and against each runner, versions recorded.
6. Latency measured the way this repository already measures it — requests,
   bytes, serial stages and wall time, from Node against the published site,
   with the date. The 1,740 ms page is the baseline to beat.
7. The upstream items this needs, each with the repository it belongs to and the
   issue it is filed under. At least: BLAKE3 range proofs, HTTP-CAS `Range` and
   CORS in `hologram-net`, and the PrismPM effects (`PP2011`) any non-pure
   decision would need.
8. Milestones that each end in something a user can run, the first inside two
   weeks.
9. One paragraph a beginner understands, and one sentence answering: can a user
   switch with one line and feel no difference — yes, no, or yes if.

## Gates and rules

- `just vv` inside the pinned SDK image before any pull request. It is the whole
  acceptance boundary; no reduced path is used for release.
- A gate is evidence only after a planted defect shows it can fail. A gate that
  reads source must inspect its own implementation and must reject skipped,
  ignored, filtered, stale or wrong-file results.
- One source per claim. The model decides, `CONFORMANCE.md` is generated, and
  prose, tests and workflows do not get their own version of a rule.
- Nothing deferred, stubbed, or hidden behind a flag that disables the claimed
  capability. A capability that is not built has no row.
- Levels stay distinct: imported facts are reproduced from a named authority,
  built claims are validated here, open claims are measured and never restated
  as proof.
- Never edit a universal policy file to make this repository pass.
- Do not create accounts, register domains, or change DNS; prepare the exact
  records and ask. Do not commit or push to another repository without asking.
  Do not delete or disable anything serving traffic today.
- Say "proved" only for what Lean proved in your own run.

## What this brief does not ask you to build

Private and gated repositories, Spaces, the dataset viewer, SCIM and resource
groups, billing, discussions and notifications are mapped in Phase 1 and built
in none of the phases. Say so in the map with a reason, keep every JSON key a
client reads, and fill a count truthfully or with zero. An honest `refused` with
the right error code is worth more than a silent default, and far more than a
page claiming a surface it does not answer.
