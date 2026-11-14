# Prompt: the Models surface, feature complete, for humans and agents

A companion to `docs/brief.md`. That prompt built the hub; this one closes one
surface: everything a person or an agent does with **models** on Hugging Face,
answered by this hub instead, decided by the LexLean kernel and proved.

## Role

You are a principal engineer who knows the Hugging Face Hub's model surface —
the `/models` browse page, a model's own page, and the `/api/models*` family —
and who writes LexLean specifications that Lean proves and PrismPM ships as a
`.holo`. You think from first principles. Every claim names a file, a command
you ran, or a page you read, with the date. Say "proved" only for what Lean
proved in your own run, "tested" for what acceptance vectors or the
conformance suite cover, "measured" for what you timed, "unverified"
otherwise.

## Mission

Make this hub's Models surface a drop-in replacement for Hugging Face's, for a
person in a browser and for an agent on the wire, with no central host.

- Live now: <https://hologram-technologies.github.io/hub/models/> (the page),
  `edge/edge.mjs` (the wire), `app/src/Site.lex.tex` (what either may say).
- The thing being replaced: <https://huggingface.co/models> and
  `https://huggingface.co/api/models*`.

**The difference that shapes every answer: this is a decentralized Hugging
Face.** Hugging Face answers from one database it owns. This hub answers from a
signed, content-addressed index that anyone may copy, and from sources that
hold the bytes. So a feature is not "ported" until you have said where its
facts come from when nobody is running a server: which signed object carries
them, who may write it, what a reader checks before believing it, and what the
page says when nobody has published them yet. A feature that cannot be
decentralized is cut and named, not faked.

## What is true today (verify, do not assume)

Measured on 2026-11-13 unless noted.

Hugging Face's `/models` page: 3,234,881 models. One filter-by-name box, two
toggles (`Base only`, `Inference Available`), a sort menu (Trending, Most
likes, Most downloads, Recently created, Recently updated) and six filter tabs
— Main, Tasks, Libraries, Languages, Licenses, Other. Main holds Tasks chips,
a two-handle **Parameters** slider (`< 1B`, `6B`, `12B`, `32B`, `128B`,
`> 500B`), Libraries, Apps, Inference Providers and Hardware. Each filter is a
URL parameter the page can be deep-linked with: `pipeline_tag`, `library`,
`other`, `language`, `license`, `sort`, `search`, `p`. Numbered pagination,
not infinite scroll. A card shows the owner's avatar, `owner/name`, task,
parameter count, how long ago it was updated, downloads and likes.

A model's own page: the owner and name, likes, follow, a tag row (task,
libraries, formats, languages, DOI, arXiv, licence), and three tabs — Model
card, Files and versions (with a Xet badge), Community. Actions: Deploy, Copy
to bucket, Use this model. The sidebar: downloads last month with a sparkline,
a Safetensors block (model size in parameters, tensor type, files info),
Inference Providers, a **model tree** (adapters, finetunes, merges,
quantizations, each a count and a link), and Spaces using the model. The body
is the rendered `README.md` with its own table of contents.

The endpoints an agent uses, beyond the resolve and tree routes the hub already
answers (`docs/brief.md` has those): `GET /api/models` with `search`, `author`,
`filter`, `sort`, `direction`, `limit`, `full`, `config`, `expand[]` and cursor
pagination through a `Link: rel="next"` header; `GET /api/models/{id}`;
`/revision/{rev}`; `/tree/{rev}?recursive`; `POST /paths-info/{rev}`; `/refs`;
`/commits/{rev}`; `GET /api/models-tags-by-type` (the whole tag taxonomy,
619,219 bytes, keyed `region`, `library`, `other`, `license`, `language`,
`deploy`, `dataset`, `bucket`, `pipeline_tag`); `GET /api/quicksearch?q=&type=model`
(models, datasets, orgs, users, papers, collections, buckets, containers,
kernels, blogs, each with a count). `expand[]` is how a client asks for
`downloadsAllTime`, `safetensors`, `gguf`, `lastModified`, `trendingScore`
without the whole record.

This hub today. The page draws 500 rows copied at deploy
(`data/models.json`, `tools/web-data.mjs`), filters them in the browser, and
offers Tasks, Parameters, Libraries, Status, Source, Formats, Languages,
Licenses, Model family, Architecture, Modality and Release recency, grouped
Main / Libraries / Languages / Licenses / Other. The model page shows the
address, the sources that hold it, three `Get it` commands, the signature and
its checks, the facts panel, and Overview, Files and Tensors tabs. The edge
answers `/api/models` (from the signed index), `/api/models/{repo}`,
`/revision`, `/tree`, `/paths-info`, `/refs` and the resolve route. The signed
index holds 399 records.

So, before any work: the page is a browser over a 500-row copy, the index is a
few hundred releases, and `/api/models` on the edge takes none of Hugging
Face's query parameters. Those three are the gap, not the styling.

## Phase 1 — Inventory (before you change anything)

Produce one table per surface. No prose until all three exist.

1. **The browse page.** Every control on <https://huggingface.co/models>: what
   it is, what it changes in the URL, what the server must know to answer it,
   and what it would take to answer it here from signed data. Include the two
   toggles, every filter tab, the sort menu, the parameter slider's stops and
   the pagination. Say for each: present here, missing here, or cut (with the
   reason).
2. **The model page.** The same, for every block listed above, including the
   model card, the model tree, the files-and-versions tab with its revisions,
   the Xet badge and the downloads sparkline.
3. **The wire.** Every `/api/models*` route and every query parameter, with a
   recorded request and response from huggingface.co and the matching one from
   `edge/edge.mjs` (run it with `HF_API=off` so you are testing the index, not
   a passthrough). Mark each: identical, different, missing. `huggingface_hub`
   and `hf` are the clients that matter; name the version you ran.

Then answer, with evidence: which of Hugging Face's own answers are facts the
publisher owns (files, sizes, hashes, config, licence, card), which are facts
the host owns (downloads, likes, trending, inference availability), and which
are derived (tasks, libraries, parameter counts, the model tree). The second
group is the one that cannot simply be mirrored; propose where each lives in a
decentralized hub, or cut it.

## Phase 2 — Specify in LexLean, then implement

Everything the page and the wire may say is already the kernel's
(`app/tools/site_spec.py` → `app/src/Site.lex.tex`). Extend it; do not add a
second source in `web/` or `edge/`. The rule from `AGENTS.md` holds: a
capability starts as a registered ID, a scenario and a failing test.

1. **Make the hub's query language Hugging Face's.** The browse page's URL
   parameters and the edge's `/api/models` parameters must be the same names
   and the same values Hugging Face uses (`pipeline_tag`, `library`, `other`,
   `language`, `license`, `search`, `author`, `sort`, `direction`, `limit`,
   `p`/cursor). A link copied from huggingface.co, with the host changed, must
   open the same filtered view here. Put the mapping in the kernel: each facet
   names its parameter and its values, and the renderer and the edge both read
   it. Prove the mapping is injective both ways, so no two facets claim one
   parameter and no parameter is dropped.
2. **One index, two readers.** The page must stop being a 500-row copy: the
   browse page and the edge must answer from the same signed index
   (`tools/index.mjs`, `data/index/`), so a model is listed in the browser
   exactly when an agent can fetch it. Design the index for browsing — shards
   small enough for a first paint, a facet counts object, and a search shard —
   each named by its hash in the signed root. Say how a shard is found, what a
   reader checks before trusting it, and what the page shows while a shard is
   missing.
3. **Cover the records a reader needs.** At least: the model card's bytes
   (addressed, so the page can prove what it renders), `config.json`-derived
   facts, the tag list as published, the revision list (`/refs`, `/commits`),
   and the base-model relation that makes the model tree and `Base only`
   possible. Each is a field in the release record, witnessed when it is
   re-hashed. Nothing enters the page that is not named by the signed root.
4. **The counts nobody owns.** Downloads, likes and trending are Hugging
   Face's measurements, not facts about the bytes. Decide and defend one of:
   carry them as a dated, signed observation naming its source; derive a hub
   number from what the hub itself can count; or drop them from the page. Do
   not show another host's number as if it were the hub's.
5. **Extend the dialect table** in the kernel with every route Phase 1 found
   missing — `/commits/{rev}`, `quicksearch`, `models-tags-by-type`, `expand[]`,
   cursor pagination — each with its status and error code, so the docs page
   and the edge keep one answer table. Prove the table is total: every route
   the kernel names has exactly one answer code, and every answer code maps to
   one HTTP status and one `X-Error-Code`.
6. **Make it usable by an agent without a browser.** Three things, each
   tested: the root answers a plain-text description of the endpoints when a
   client asks for `text/plain` (gethologram.ai already does this; read it
   before designing yours), an OpenAPI document that matches the kernel's own
   route table, and an MCP endpoint whose tools are the kernel's operations
   (search, get model, resolve file). All three generated from the kernel, so
   they cannot drift from it.
7. **Accessibility and the page itself.** Keyboard reachable filters, a result
   count a screen reader announces, deep-linkable state, and no control that
   needs a pointer. The proof page's Lighthouse budget (122,880 bytes of
   transfer, 100 ms of total blocking time) still applies; a bigger index must
   not be paid for at first paint.

## Proof plan

Each theorem in its own module, axioms declared, under the Lean stage's time.
Register each as an `HK-` claim with a scenario and a failing test first.

- **Query mapping.** For every facet and every value, parameter name and value
  round-trip; two different facet states never produce the same query string.
- **Paging.** For every result set and page size, the pages partition the set:
  no row is seen twice, none is lost, and the last page is the only short one.
- **Filtering.** A row is shown exactly when it satisfies every chosen facet;
  an empty choice constrains nothing.
- **Index integrity.** A shard is read only when its hash is the one the signed
  root names; a record is shown only when its hash is the one its shard names.
- **Card integrity.** The rendered card is the bytes the record addresses, or
  the page says it has none. No path from unaddressed bytes to the page.
- **Answer totality.** Every route in the table has one answer code; every
  answer code has one status and one error code; a missing model and a private
  one are still byte-identical.
- **Attribution.** A count carried from another host is displayed only with its
  source and its date.

## Deliverables

1. The three Phase 1 tables, with transcripts in `docs/phase1/evidence/`.
2. A decision record for the four questions in Phase 2.2 and 2.4, each with the
   option taken and the two rejected.
3. The changed kernel: `app/tools/site_spec.py`, the generated
   `app/src/Site.lex.tex` and the new proof modules, with every theorem named
   and its axioms listed from your own `#print axioms`.
4. `model/ids.toml` entries for each new claim, their scenarios in
   `features/suites/`, and the failing test that preceded each implementation.
5. The index builder and its shards, the edge's new routes, and the page
   reading both.
6. A conformance run: the same request to huggingface.co, to the edge with
   Hugging Face on, and to the edge with `HF_API=off`, for every route and
   parameter in the inventory. A row ships only when the last two agree with
   the first, or when the difference is recorded as a cut.
7. One planted defect per new gate, with the failing command and its
   diagnostic, in `TEMPLATE-VERIFICATION.md`.
8. `just vv` green in the pinned SDK, the smoke test green on every page, and
   the Lighthouse budget still met, each with its own output.
9. Milestones that each end in something a person can use: (1) the hub's query
   language is Hugging Face's, deep links included; (2) the page and the edge
   read one signed index; (3) model cards, revisions and the model tree;
   (4) agent surfaces — plain text, OpenAPI, MCP; (5) the counts decision,
   implemented.
10. One paragraph a beginner understands, and one sentence answering: can
    someone move their models workflow here, browser and scripts both, and feel
    no difference — yes, no, or yes if.

## Rules

- Lead with the answer. Recommend one option, then qualify.
- Never edit files under `prism/` by hand. Never claim a proof you did not run.
- Never create an account, publish a package or push a tag without the user's
  approval in chat.
- No feature is "done" because it renders. It is done when a test fails
  without it.
- Where Hugging Face's behaviour and a decentralized hub's honesty disagree,
  keep the honesty and say so on the page.
