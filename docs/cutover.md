# Publishing this repository as gethologram.ai

Decided 2026-11-16: one domain. Every name a tool has been given keeps
working: `HF_ENDPOINT=https://gethologram.ai`, `ollama pull
gethologram.ai/...`, the MCP address, the agent page. The VPS's front Caddy
stays the only thing the apex points at, and it sends path groups to this
repository's runners one at a time, while the rest keeps answering from
`Hologram-Technologies/hologram-live` until it moves. DNS does not change.

This replaces the plan of 2026-11-14, which moved the apex to this
repository's GitHub Pages site and the running hub to `api.gethologram.ai`.
That plan was sound about Pages (below), but it changed every published name
at once. Any client still configured with the old name would have broken on
the day the record changed. Here no client has to change anything.

## Why Pages cannot be the apex

Measured 2026-11-14 with `huggingface_hub` 1.17.0 against a host that serves
bytes and sets nothing else, as GitHub Pages does: `hf_hub_download` fails with
`LocalEntryNotFoundError`, because the resolve answer carries no
`X-Repo-Commit`; a POST answers 405; and Pages sends `Vary: Accept-Encoding`
only, so the agent page the apex serves to `Accept: text/plain` cannot come
from it. The apex has to be a server that answers HTTP. It already is one.

## The api name

`app/tools/site_spec.py` names `api.gethologram.ai` as the endpoint (`API_HOST`),
and every command, link and endpoint the site prints is built from it. The name
does not resolve: measured 2026-11-16, `nslookup` answers "Non-existent
domain" (TEMPLATE-VERIFICATION.md has the screens it leaves dead). Under one
domain it becomes an alias, not a separate service. It is one `A api
217.216.66.62` record at Key-Systems and `api.gethologram.ai` added to the
site block's name line in the front Caddyfile. Caddy issues the certificate
itself, and the name then answers exactly what the apex answers. `API_HOST`
moves to the apex in the model when the site does (step 3), so the alias is
then only kept for whoever copied a command in between.

## Where each path is answered

| Paths | Answered by | Since |
| --- | --- | --- |
| `/{repo}/resolve/…`, `/api/models…` | this repository's edge (`edge/`) | 2026-11-16 |
| `/via/<source>/{repo}/resolve/…` and `/via/<source>/api/…` (all but `SHA256SUMS`) | the edge | 2026-11-16 |
| the site: `/`, `/models`, `/registry`, `/spaces`, `/buckets` | hologram-live; this repository's `web/` next | |
| `/docs/*`, `/agent.md`, `/llms.txt`, `/openapi.json`, `/.well-known/*` | hologram-live; not yet here | |
| `/v2/` (OCI, Ollama), `/mcp`, `/api/account/*`, `/api/v1/objects*`, `/healthz`, `/api/hub/health`, `/archive.json`, `/pins.json` | hologram-live and the services it runs | |

The routes this repository answers are written in
`deploy/caddy/gethologram.ai.caddy` and applied to the VPS by hand. The edge
is deployed by `deploy/edge/deploy.sh <commit>`. It builds that commit,
checks the new container through Caddy, and puts the previous image back on
any failure.

## The order

1. Done: the edge answers the Hugging Face dialect. A Hugging Face client
   sees no difference against huggingface.co (`tests/edge/observe.py`, 14 of
   14, measured on the public name).
2. Done: `/via/<source>/` to the edge, all but `SHA256SUMS`.
3. The site: Caddy serves this repository's built `web/` at the apex for
   browsers. The docs, the agent page, `llms.txt` and `/openapi.json` move
   here with the checks that keep them honest (`bind`, `conformance` and
   `stress` in hologram-live's `apps/model-hub/web/qa/openapi/`).
4. A product decision for each surface this repository has no answer for,
   each one of: move it here, keep it as a service whose configuration lives
   here, or retire it. The surfaces are the OCI registry, MCP, accounts and
   buckets, the object API, Spaces, the archive and the pins, and
   `SHA256SUMS` under `/via/`.
5. The VPS configuration for every path the apex answers lives in `deploy/`.
   This repository's index stops reading `gethologram.ai/data/files` at build
   time.
6. `apps/model-hub` in hologram-live is retired once the conformance suite,
   run from here, passes every path with nothing answered by its code.

## Rollback

Each step is one Caddy block, removed and reloaded. The services it replaced
keep running until step 6, so removing a block puts the old answer back at
once.
