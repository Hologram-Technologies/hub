# Phase 1: what Hugging Face's Models surface does, and what this hub answers

The inventory `docs/models-brief.md` asks for, before any design. Three
tables — the browse page, a model's page, the wire — then the question that
decides the design: who owns each fact.

Measured on 2026-11-13 against <https://huggingface.co> and this hub's live
page <https://hologram-technologies.github.io/hub/models/>. The hub's wire was
measured against `edge/edge.mjs` on `127.0.0.1`, run twice: once with Hugging
Face reachable, once with `HF_API=off DRAIN=huggingface.co`, answering from
the signed index alone (400 records).

Hugging Face lists 3,234,881 models. This hub's page draws 500 rows copied at
deploy; its index holds 400 releases.

## The one measurement that frames the rest

A Hugging Face browse link with the host changed loses everything it carries.
Opening

    .../hub/models/?pipeline_tag=text-generation&num_parameters=6B,32B&sort=modified&p=2

leaves the hub showing all 500 rows, no filter pressed, sort Trending, page 1,
and rewrites the address bar to `/models/` with no query at all. The hub reads
a different vocabulary (`tasks`, `params`, `page`) and silently drops what it
does not know. Nothing else in this document matters as much: the names are
the compatibility surface.

## Table 1 — the browse page

Hugging Face's controls, the URL parameter each one writes, and what this hub
does with it. The parameter names are from the page's own hydration props
(`activeFilters`, read 2026-11-13): `inference`, `pipeline_tag`,
`num_parameters`, `library`, `apps`, `inference_provider`, `hardware`,
`language`, `license`, `other`, `deploy`, `base_model_relation`.

| Control | Hugging Face parameter | Values | This hub | Verdict |
| --- | --- | --- | --- | --- |
| Filter by name | `search` | free text | `q`, matched in the browser over the 500 copied rows | different: name and reach |
| Tasks | `pipeline_tag` | tag ids, repeatable | `tasks`, over the task label | different: name and value shape |
| Parameters | `num_parameters` | a pair of stop labels, `6B,32B` | `params`, a pair of stop indices, `1-3` | different: name and value shape |
| Libraries | `library` | `pytorch`, `gguf`, `transformers`, … | `libraries` | different: name |
| Apps | `other` | `vllm`, `llama.cpp`, `mlx-lm`, … | — | missing |
| Inference Providers | `inference_provider` | `all`, or a provider id | — | cut: the hub runs no inference |
| Hardware | `hardware` | a hardware id | — | cut: the hub knows no hardware |
| Languages | `language` | `en`, `ja`, … | `language` | same name, values to check |
| Licenses | `license` | `mit`, … | `license` | same name, values to check |
| Base only | `base_model_relation` | `base` | — | missing: the relation is not in the index |
| Inference Available | `inference_provider=all` | — | — | cut, with the control above |
| Datasets | `dataset` | a dataset id | — | missing |
| Deploy | `deploy` | a target id | — | cut |
| Sort | `sort` | `trending`, `likes`, `downloads`, `created`, `modified` | `sort`: `trending`, `downloads`, `likes`, `newest`, `size` | different: two values renamed, one added |
| Page | `p` | 1…n, numbered | `page` | different: name |
| Author | `author` | an owner | — | missing |
| Filter tabs | — | Main, Tasks, Libraries, Languages, Licenses, Other | Main, Libraries, Languages, Licenses, Other | different: no Tasks tab, so the task list is only ever the short one |
| — | — | — | `status` (Verified, Queued, Unverified) | hub only: what the index knows about the bytes |
| — | — | — | `source` (which hosts hold it) | hub only |
| — | — | — | `format`, `family`, `arch`, `modality`, `released` | hub only, derived at deploy |

Two more differences that are not controls:

- Hugging Face's parameter slider has eleven stops under six labels. The hub's
  has five stops and five labels, so the same drag cannot express the same
  range.
- Hugging Face answers the browse page server-side and pages through 3.2
  million models. The hub filters 500 rows in the browser, so `p=2` of
  anything larger has nothing to show, and search cannot reach a model the
  copy left out even when the index holds it.

## Table 2 — a model's page

Measured on `openai-community/gpt2` on both sites.

| Block | Hugging Face | This hub | Verdict |
| --- | --- | --- | --- |
| Owner and name | `owner / name`, owner avatar | same, with the owner's avatar | identical |
| Likes, follow | like count, follow button | like count shown, no follow | different: no account to follow with |
| Tag row | task, libraries, formats, languages, DOI, arXiv, licence | task, library, licence in the facts panel | different: no DOI, arXiv or language tags |
| Model card | `README.md` rendered, with its own contents list | — | missing: the card's bytes are not in the index |
| Files and versions | file list with sizes, LFS and Xet badges | Files tab: path, size, address | different: no badges, no per-file link |
| Per-file links | `/{repo}/blob/{rev}/{path}` viewer, `/{repo}/resolve/{rev}/{path}?download=true` | — | missing: no human URL for one file |
| Revisions | branch and tag picker, `/commits/{rev}`, `/commit/{sha}` | one revision, the release | missing: no history |
| Community | discussions and pull requests | — | cut: out of scope in `docs/brief.md` |
| Deploy | inference endpoints and providers | — | cut |
| Use this model | per-library snippets | `Get it`: Hugging Face, OCI, Ollama commands | different: fewer libraries, same purpose |
| Copy to bucket | copies into the user's bucket | Buckets page checks an object by address | different |
| Downloads | last month, with a sparkline | a total, no history | different: no series behind it |
| Safetensors block | model size in parameters, tensor type, files info | parameters, weights, files in the facts panel | different: no dtype |
| Model tree | adapters, finetunes, merges, quantizations, each counted and linked | — | missing: the relation is not in the index |
| Spaces using | a list | — | cut |
| Address and sources | — | the address, every source that holds it, `/via/<source>` | hub only |
| Signature | — | the witness's Sigstore bundle, seven checks, the kernel's label | hub only |
| Tensors | — | every tensor's name, dtype, shape and BLAKE3 address | hub only |
| Verify | — | fetches one file per source, hashes it in the browser, the kernel judges | hub only |

## Table 3 — the wire

Thirty rows, one per route and parameter, each sent to all three servers:
huggingface.co (A), the edge with Hugging Face reachable (B), and the edge
answering from the signed index alone (C). The table is
`docs/phase1/evidence/models-api/summary.md`; the commands and recorded
values are in `transcript.md` beside it, with sixteen small fixtures under
`raw/`. Of the thirty rows, 4 are identical, 23 differ and 3 are missing.

Six findings carry the rest. Each was measured again by hand before it was
written here.

**Indexing a model makes its metadata worse.** `GET /api/models/openai-community/gpt2`
gives A twenty-four keys and both edges fifteen. Absent on the edge:
`lastModified`, `config`, `cardData`, `transformersInfo`, `safetensors`,
`widgetData`, `model-index`, `spaces`, `usedStorage`. The numbers that remain
disagree — downloads 32,892,223 against 33,264,897, likes 3,931 against
3,934 — and `tags` is six against eighteen, with `English` where Hugging Face
writes `en`. The same request for `openai-community/gpt2-xl`, which the index
does not hold, returns the same twenty-four keys as Hugging Face, byte for
byte. The edge answers an indexed repository from the index and passes
everything else through, so the models the hub knows best are the ones it
describes worst.

**`expand` is accepted and ignored.** On `tree` and on `paths-info`, Hugging
Face adds `lastCommit` and `securityFileStatus`; the edge returns the four
plain keys and no error. `huggingface_hub` sends `expand` on every
`paths-info` call, so every client meets this on every download.

**With Hugging Face off, the list endpoint is a different endpoint.** C
answers fifty rows of seven keys with no `Link: rel="next"`, ignores the
cursor, and ignores `filter`, `sort`, `direction`, `full`, `config` and
`expand[]`. B matches A exactly, including a correct second page. Hugging
Face's accepted sort names, measured, are `downloads`, `likes`, `createdAt`,
`lastModified` and `trendingScore` — `trending`, which this hub's page uses,
is rejected by Hugging Face with 400.

**C accepts what Hugging Face rejects.** An unknown `sort` and
`direction=1` are 400 on A and B, 200 on C. A client that relies on the error
to catch a typo gets silence and the wrong rows.

**Three routes are not answered at all.** `/api/models-tags-by-type` and
`/api/quicksearch` return 400 `BadRequest` on both edges, because the edge
only claims the `api/models` prefix. `/api/models/{repo}/commits/{rev}`
passes through on B and is 401 `RepoNotFound` on C.

**Errors are classified differently, and one header is lost.** A gated
repository is 200 on A and B — Hugging Face serves gated metadata anonymously
— and 401 `RepoNotFound` on C. On the resolve route, `EntryNotFound` from both
edges drops `X-Repo-Commit`, which A sets.

Smaller, recorded in the transcript: tree entries come back in name order
rather than directories first, a directory's `oid` is synthesised from the
revision, `xetHash` and `xetEnabled` are stripped by design, and `refs` gains
an empty `pullRequests` key. A file's `oid`, `size`, `lfs.sha256` and
`pointerSize` all match Hugging Face.

## What a release record holds today

Every "missing" row above is a field the signed index does not carry. The
record for `openai-community/gpt2`
(`data/index/models/openai-community/gpt2.json`, 4,221 bytes, read
2026-11-13) holds exactly:

    format, repo, revision,
    info { author, tags, pipeline_tag, library_name, createdAt, likes, downloads },
    files [ { path, size, gitSha1 } … 26 ],
    sources [ modelscope.cn, ipfs ]

Absent, and needed by Tables 1 and 2: the card (`cardData`, the README's
bytes), `siblings`, `config`, `gated` and `private`, `lastModified`, the
base-model relation, the model tree, branches and tags, and the safetensors
metadata the Safetensors block reads. A file carries its git blob SHA-1 and,
for an LFS file, its SHA-256; nothing else about it.

Two things stand out. The record is small enough that adding these fields is a
question of ingest cost, not of design. And `likes` and `downloads` are
already inside it — the hub signs Hugging Face's measurements as if they were
facts about the bytes, which is the next section's problem.

## Who owns each fact

The question that decides what can be decentralized. Three kinds.

**Facts the publisher owns.** The files and their sizes, the hashes, the
config, the licence, the model card, the tensor shapes and dtypes, the
revision a release names. These are facts about bytes: anybody who holds the
bytes can re-derive them, and this hub already does for 400 releases, which is
why they can be signed and mirrored. Everything missing from Tables 1 and 2 in
this group — the model card, per-file links, revisions, the base-model
relation — is missing only because the index does not carry it yet. No new
authority is needed, only a bigger record.

**Facts the host owns.** Downloads, likes, trending rank, inference
availability, what hardware a model runs on. These are measurements of
Hugging Face's own traffic and estimate, not properties of the bytes. A
decentralized hub cannot re-derive them and must not restate them as its own.
The hub shows downloads, likes and a trending order today, copied from
gethologram.ai without saying so on the page, and signs two of them into the
release record; that is the one honesty gap this inventory found, and
`docs/models-brief.md` asks for a decision on it.

**Facts that are derived.** Tasks, libraries, formats, languages, parameter
counts, the model family, the architecture. Hugging Face derives them from the
repository's tags and config; the hub derives them again at deploy in
`tools/web-data.mjs`. Both derivations are opinions about published bytes, so
they can live in the signed record — but then the rule the derivation used has
to be published with them, or two hubs will disagree and neither will be
wrong.

The shape of the answer follows: carry the first group in the signed record
and grow it until Tables 1 and 2 have no "missing" rows; publish the
derivation rules with the third; and for the second, either name the source
and date on the page or drop the number.

## What the three tables agree on

Ranked by how much each blocks a drop-in replacement.

1. **The record is too thin.** The same cause produces the page's missing
   model card, files-and-versions tab and model tree, and the wire's missing
   `config`, `cardData`, `safetensors`, `lastModified` and `siblings`. Today
   the hub describes an indexed model worse than it describes one it has never
   seen, because a passthrough carries everything and the index carries seven
   fields. Everything else waits on this.
2. **The vocabulary is ours, not Hugging Face's.** The browse page reads
   `tasks`, `params` and `page` where the world writes `pipeline_tag`,
   `num_parameters` and `p`; the page's `sort=trending` is a value Hugging
   Face answers 400 to. A link does not survive the host swap, in either
   direction.
3. **With Hugging Face off, the hub is a smaller, laxer service.** Fifty rows
   instead of a thousand, no cursor, six query parameters ignored, requests
   accepted that should be refused, a gated repository reported as missing,
   and three routes not answered at all. The signed index is the only part of
   this hub that is actually decentralized, and it is the part that behaves
   least like Hugging Face.
