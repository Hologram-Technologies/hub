# Publishing this repository as gethologram.ai

Decided 2026-11-14. The apex serves this repository's GitHub Pages site, the
way `UOR-Foundation/website` is served as `uor.foundation`, and the hub that
answers the apex today keeps answering on the same machine at
`api.gethologram.ai`. Nothing is switched off; the name a tool is given
changes.

## The precedent, read rather than assumed

`UOR-Foundation/website` holds `public/CNAME` containing `uor.foundation`,
which its workflow copies into the Pages artifact. Its Pages configuration
reads `build_type: workflow`, `cname: uor.foundation`,
`protected_domain_state: verified`, and a GitHub certificate covering
`uor.foundation` and `www.uor.foundation` with HTTPS enforced. Measured
2026-11-14: `uor.foundation` resolves to `185.199.108.153`, `.109`, `.110` and
`.111`; `www.uor.foundation` is a CNAME to `uor-foundation.github.io`; the site
answers `Server: GitHub.com`.

Here the file is `web/CNAME`, because `pages.yml` copies `web/.` to the
artifact root the way that repository copies `public/`.

## Why the apex cannot answer a tool

GitHub Pages serves bytes with `Content-Type`, `Content-Length`, `ETag` and
`Last-Modified`, and sets nothing else. Measured 2026-11-14 on a host built to
do exactly that and no more, with `huggingface_hub` 1.17.0: `model_info` reads
fine from a static JSON file, `get_hf_file_metadata` comes back with
`commit_hash=None`, and `hf_hub_download` fails with
`LocalEntryNotFoundError`, because the resolve answer carries no
`X-Repo-Commit`. A POST to Pages answers 405. Pages sends
`Vary: Accept-Encoding` only, so the agent page the apex serves today to
`Accept: text/plain` cannot come from it either.

That is 43 of the 51 paths in the live `/openapi.json`, and it is why they move
to a name of their own rather than being dropped.

## The records

Measured 2026-11-14 by resolving `hologram-technologies.github.io`. Applied at
Key-Systems, whose nameservers are `ns1-3.rrpproxy.net`. They are the
operator's to apply; nothing in this repository changes DNS.

First, and safe on its own, because it changes nothing anyone sees:

| Type | Name | Value |
| --- | --- | --- |
| A | `api` | `217.216.66.62` |

Then, once the site has been proved against that name:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |

The apex A record to `217.216.66.62` is removed, and `www` changes from a CNAME
to the apex into a CNAME to `hologram-technologies.github.io`. If GitHub asks
to verify the domain for the organization it names a
`_github-pages-challenge-hologram-technologies` TXT record, whose value exists
only once that flow is started.

## The VPS

`apps/model-hub/deploy/Caddyfile.hub` in `Hologram-Technologies/hologram-live`
opens its site block with `gethologram.ai, gethologram.ai {`, the name twice.
Adding `api.gethologram.ai` to that line is the whole change: Caddy gets a
certificate for it itself, and every route answers under it unchanged.

Worth checking afterwards, because it cannot be seen from outside: whether
`hub-resolve` builds absolute URLs from the request's `Host` header or from a
configured name. `curl -sI "https://api.gethologram.ai/api/models?limit=2"` and
read the `Link` header. If it names `api.gethologram.ai`, nothing else is
needed. If it names the apex, a client following the next page lands on the
static site after the cutover and that setting needs the new name too.

## The order

1. Operator: the `api` record, and the Caddy line. The apex is untouched and
   nothing changes for anyone.
2. Here: `API` in `app/tools/site_spec.py` becomes `https://api.gethologram.ai`,
   the kernel is regenerated, the gate runs, the site deploys. Proved by
   opening a model page: the Files tab, Verify and the Buckets check.
3. Operator: the apex records.
4. Here: `web/CNAME`, and the deploy's own URLs. GitHub serves the custom
   domain and issues the certificate.

Step 4 follows step 3, not the other way round. A `CNAME` file makes GitHub set
the Pages custom domain as soon as it deploys, and
`hologram-technologies.github.io/hub/` then redirects to it — which, while the
apex still points at the VPS, breaks the deploy's own smoke job, since
`pages.yml` checks the github.io URL. Going in this order leaves the apex
answering GitHub's 404 for the few minutes between the record change and the
deploy, which is the shorter window and the one that breaks nothing in CI.

## What step 4 changes besides adding the file

Seven places name the Pages address directly. None of them breaks when the
custom domain is set, because GitHub redirects
`hologram-technologies.github.io/hub/<path>` to `gethologram.ai/<path>` and
both `fetch` and Playwright follow a redirect. They are changed anyway, so that
nothing in the repository depends on a redirect continuing to exist:

| Where | What it names |
| --- | --- |
| `.github/workflows/pages.yml` | the smoke job's URL, built from the owner and repository name |
| `.github/workflows/pages.yml` | the holo and index for `tests/edge/listing.mjs` |
| `.github/workflows/pages.yml` | the index base the incomplete-record job copies from |
| `.github/workflows/pages.yml` | the holo for `tests/edge/complete.mjs` |
| `.github/workflows/edge.yml` | the holo and index for `tests/edge/older-kernel.mjs` |
| `edge/serve.mjs` | `SITE`, the default `HOLO_URL` and `INDEX_URL` |
| `tools/smoke.mjs` | the usage line |

## Rollback

Before step 3 there is nothing to undo; the apex is untouched. After step 3,
put the apex A record back to `217.216.66.62` and remove the AAAA records.
After step 4, the same, and remove `web/CNAME` and redeploy. DNS propagation
is the only delay.

## What the site keeps

Nothing in `web/` names a mount point. Every path is relative,
`web/index.html` computes its own base from the URL, and
`tools/web-routes.mjs` writes a `<base>` per route, so the same artifact serves
correctly at `hologram-technologies.github.io/hub/` and at the root of a
domain, with no change.
