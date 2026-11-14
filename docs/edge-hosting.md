# What it takes to host the edge runner

One small Node process, no database, no disk, and almost no bandwidth, because
it redirects weights rather than carrying them. The thing that rules hosts out
is not size: it is that the process compiles WebAssembly from bytes at run
time.

Written 2026-11-14 from `edge/serve.mjs`, `edge/edge.mjs` and `edge/Dockerfile`
as they stand. Figures marked measured were measured; the rest is read from the
code and marked unverified until someone runs it in anger.

## What the host must provide

Node 22. `edge/Dockerfile` pins
`docker.io/library/node:22-slim` by digest. Nothing is installed at build time:
the image copies `edge/`, the vendored `prism-code` runtime and
`web/sigstore.mjs`, and runs `node edge/serve.mjs`. There is no package
install, no native module, no build step.

**Runtime WebAssembly compilation.** This is the hard requirement. The edge
loads the kernel's `.holo` over HTTP and compiles the guest it contains, so the
host must allow `WebAssembly.compile` on bytes the process fetched. That is
ordinary on a server and forbidden on Cloudflare Workers, which requires every
module to be part of the deployed bundle. Cloudflare Workers is therefore out,
and so is anything else with the same rule. Fly.io, Render, Railway, a
container on any cloud, a VPS, or a laptop all qualify.

Outbound HTTPS to four places: the Pages site that publishes the holo and the
signed index, `huggingface.co` and `modelscope.cn` for the API and the
redirect targets, and whatever IPFS gateway a release names. No inbound
anything except the one port it listens on.

No state. No volume, no database, no cache that must survive a restart. Two
processes behind a load balancer need nothing shared. The in-memory cache is
`cache` in `edge/edge.mjs`, capped at 2000 entries and dropped on restart.

## What it does at start, and what that costs

`start()` fetches the holo, checks its identities, replays every acceptance
vector the holo carries, then fetches the signed index root, checks its
Sigstore bundle against the pinned Fulcio and Rekor roots, and reads every
browse shard, refusing any whose bytes do not hash to what the signed root
names. Measured on a laptop against the live Pages site on 2026-11-14: the
edge reported `73 examples replayed; index 400 models` and was answering in a
few seconds. Unverified: the same on a cold container in a datacentre.

Memory is dominated by the index it holds: 400 records plus one browse shard,
read as JSON. The published index is about 2.4 MB of JSON today. Unverified:
resident size under load; nobody has measured it.

## What it costs to run

Weights never pass through it. A file request is answered with a 302 to a
source, so the bytes go from Hugging Face, ModelScope or an IPFS gateway
straight to the client. Bandwidth is therefore metadata only: a few kilobytes
per request, plus the index at start.

That makes the smallest tier of any host a plausible fit, and makes bandwidth
pricing almost irrelevant. The one thing to watch is Hugging Face's anonymous
rate limit, 500 API calls per five minutes per IP, which applies when the edge
passes a request through rather than answering from the index. A busy edge
behind one IP will meet it. Unverified: at what request rate, because nobody
has run it under load.

## Settings

Environment, from `edge/serve.mjs`:

- `PORT` (8787) and `HOST` (127.0.0.1, or 0.0.0.0 when `PORT` is set).
- `HOLO_URL` - the kernel holo. Defaults to this repository's published one.
- `INDEX_URL` - the signed index. Defaults to the same site's.
- `HF_API=off` - answer from the signed index alone, asking Hugging Face
  nothing. This is the mode the "Hugging Face client works with Hugging Face
  switched off" job tests on every deploy.
- `DRAIN` - sources to take out of rotation, comma separated, for example
  `huggingface.co`.

A client points at it with `HF_ENDPOINT=https://<host>`, which is the whole
integration for anything built on `huggingface_hub`.

## What is not settled

The edge is not deployed anywhere, so everything above is how it behaves when
run locally and in CI, not in production. Specifically unverified: cold start
time on a real host, memory under load, behaviour when the Pages site is slow
or unavailable at start, and whether one instance is enough for any particular
traffic.

Two deployment-shaped decisions are open and belong to whoever operates it:
which host, and whether it runs with `HF_API` on, which makes it a transparent
mirror of Hugging Face for repositories the index does not hold, or off, which
makes it answer only for the 400 releases the index carries.
