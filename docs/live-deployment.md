# How this repository's work reaches gethologram.ai

Written 2026-11-14. Measurements are dated; everything else is read from code
or from a page, and said to be.

## What gethologram.ai is today

A running service on one Contabo VPS, not a static site and not GitHub Pages.
Measured 2026-11-14: `gethologram.ai` resolves to `217.216.66.62`, whose
reverse name is `vmi3460776.contaboserver.net` and whose RIPE range is held by
Contabo GmbH; `www` is a CNAME to the same name; the response headers at `/`
carry `Server: Caddy` and `Via: 1.1 Caddy` and no CDN header of any kind.
`/openapi.json` declares 51 paths and 53 operations against one server,
described there as production with no staging surface. `/healthz` answers
`{"status":"ready","version":"1.0.0","role":"node","modules_ready":2}`.

It is built from `Hologram-Technologies/hologram-live` at `apps/model-hub`,
which `Hologram-Technologies/hologram-website`'s README says in as many words
and whose `deploy/` directory holds the Caddyfiles, the compose file and the
cutover script. Neither repository has a GitHub Pages custom domain: the Pages
API answers `"cname": null` for both. No repository owns the name. The A record
does, at Key-Systems, and it points at the VPS.

## Why this repository cannot simply take the name

It answers 8 of those 51 paths. `edge/edge.mjs` routes exactly
`/{repo}/resolve/{revision}/{path}`, the same under `/via/<source>/`,
`/api/models…` with the tree, paths-info, refs and commits beneath it,
`/api/models-tags-by-type`, `/api/quicksearch`, `/api/whoami-v2` as a refusal,
`/` and `/health`. Everything else is a 400. Measured 2026-11-14 against a
local `node edge/serve.mjs`: `/api/hub/health`, `/v2/_catalog`, `/mcp`,
`/spaces/spaces.json`, `/registry/data/images.json`, `/api/v1/objects/{addr}`,
`/data/files/{repo}.json`, `/openapi.json`, `/agent.md` and `/llms.txt` each
answered 400.

Pointing the name here would retire the OCI registry, MCP, the account and
bucket surface, the docs, the apps and the agent page, all of which answer
today.

## The order that does not break anything

1. Run the edge somewhere and prove it, at a hostname of its own. It is one
   stateless Node 22 process with no disk and no database, and weights never
   pass through it; the one hard requirement is that it compiles WebAssembly
   from bytes at run time, which rules out Cloudflare Workers.
   `docs/edge-hosting.md` has the rest.
2. Measure it against the clients, not against a test: `HF_ENDPOINT` at the new
   host and at the live hub, same downloads, same hashes, same cache layout.
3. Cut what this repository reads from the live hub, so the old one can one day
   be switched off. Below.
4. Have the live Caddy send path groups here, one at a time, and leave the rest
   where it answers. Rollback is one Caddy block. Moving DNS is not part of it.

Steps 1, 2 and 4 need an account, a host or a DNS record, which are the
operator's and not this repository's.

## What was read from the live hub, and what is left

Cut on 2026-11-14:

- The list of models to index. `tools/index.mjs` asked
  `gethologram.ai/api/models?limit=500`, which made this hub's index a copy of
  the hub it means to replace. It now asks Hugging Face
  (`sort=trendingScore&direction=-1&full=true`). Measured the same day: the two
  lists agree on 367 of 500 ids and on the head of the order, and Hugging Face
  carries `sha` on all 500 rows against the live hub's 399, so the seed is
  longer as well as first-hand. The catalog written to the index is this
  repository's own projection of thirteen fields, not whatever shape the list
  arrived in, because the signed root names those bytes.
- The search used to place a witnessed model outside the trending list. It is
  now asked of Hugging Face by name, which was already the fallback.
- The edge's run-time call for source records. `holders()` fetched
  `gethologram.ai/data/files/{repo}.json` for a repository the index did not
  hold, and fed an unsigned answer from a third host to the kernel. It now
  reads the signed index and nothing else. Measured: `/via/ipfs/` and
  `/via/modelscope.cn/` on an indexed model still redirect to Filebase and
  ModelScope; the same on a model outside the index answers 404
  `SourceHasNotGotIt` instead.
- The model list the page tools worked from. `tools/web-routes.mjs` and
  `tools/web-data.mjs` asked the live hub which models exist; both now read the
  index being assembled beside them, so the route pages, the owner marks and
  the browse rows name one set. `pages.yml` copies the index into the site
  before those two run.

Left, and why:

- `gethologram.ai/data/files/{repo}.json` at build time, in `tools/index.mjs`.
  It says which other sources hold a release's bytes, and nothing here
  re-derives it: a claim that ModelScope or IPFS holds the same bytes has to
  come from whoever hashed them. A release it does not answer for is indexed
  with no second source, which costs the model page its cross-source check and
  nothing else. The index signature's predicate names this source apart from
  Hugging Face for that reason.

  Seeding from Hugging Face makes that a third of the catalog rather than a
  handful, and that was decided on 2026-11-14 on these numbers: the two
  500-row lists agree on 367 ids, and of 20 sampled ids both hold, 20 have a
  record, against none of 20 that only Hugging Face holds — so about 133 rows
  arrive with no second source. What was weighed was 399 records nearly all
  with one against about 500 of which roughly 73 per cent can have one, and
  the longer, first-hand list was preferred. It is a chosen cost, not a
  defect. What it does not cost is the download: the Hugging Face slot is
  filled from the file's presence in the tree, so a record with an empty
  `sources[]` still resolves.
- `gethologram.ai/registry/data/images.json` and `/spaces/spaces.json`, in
  `tools/web-data.mjs`. The Registry and Apps screens are copies of the live
  hub's own product surfaces and this repository has no replacement for them.
- `gethologram.ai/api/v1/objects/{address}`, called by the Buckets screen in
  the browser. Buckets is account storage behind a publisher token; there is no
  account system here, and the screen already says so.

The last two are product decisions — keep copying, keep pointing at the old
service, or drop the screens — and not technical ones.
