# Hippius: a real mirror the edge cannot redirect to

`https://hub.hippius.com/` holds byte-exact copies of Hugging Face model files
and publishes a SHA-256 for each one that agrees with what this hub's own
signed index already says. That is the good half. The other half is that no
anonymous client can fetch a byte from it with one HTTP request, and the files
worth having cannot be fetched with any number of them, so the edge cannot
redirect to it and `SOURCES` does not get a fourth entry.

Measured 2026-11-16 from a Windows machine on a domestic connection, against
`hub.hippius.com`, `registry.hippius.com` and `huggingface.co`. "Measured"
means this session timed it on that date. Anything Hippius says about itself
that is not checked below is unverified.

## What it is

A [Harbor](https://goharbor.io/) registry with a web front end.
`hub.hippius.com` is the browsing surface; `registry.hippius.com` serves the
bytes and answers both the OCI distribution API (`/v2/`) and Harbor's own REST
API (`/api/v2.0/`). The homepage advertises `registry.hippius.com` as the pull
endpoint and names `docker`, `oras` and `hippius-hub` as the clients.

| | Count | Where measured |
| --- | --- | --- |
| Public models, as the homepage counts them | 11,646 | `hub.hippius.com` homepage |
| Containers / OCI artifacts | 1,766 | same |
| Projects, all of them public | 202 | `/api/v2.0/projects`, `x-total-count` |
| Repositories across those projects | 11,508 | sum of `repo_count` |
| Repositories that mirror Hugging Face | 62 | the `archive` project |

The shape matters more than the total. 8,832 of the 11,508 repositories sit in
one project, `cascade`, and they are training checkpoints from what reads as a
Bittensor-style competition: names like
`cascade/ckpt-r824229856147703689-challenger-cascade-moe-v2-120m-kingkey`,
files `model.py`, `weights.safetensors`, `optimizer.safetensors`,
`training_measurement.json`. Spot checks in `jan`, `mastertensor` and
`superstar` found the same: original uploads, miner artifacts and fine-tunes,
no Hugging Face provenance.

So Hippius is **an independent upload surface with one curated mirror shelf
inside it**, not a mirror of Hugging Face. The shelf is the project named
`archive`, and it is the only part of Hippius this hub could ever use.

## It does hold real model files

Named with the sizes the registry reports:

| Repository | Size | Layers | Mirrors |
| --- | --- | --- | --- |
| `archive/qwen3.8-27b` | 55.59 GB | 831 (18 tensor shards) | `Qwen/Qwen3.8-27B` |
| `archive/qwen3-8b` | 16,398,133,820 B (16.40 GB) | 251 (5 tensor shards) | `Qwen/Qwen3-8B` @ `b968826` |
| `archive/mistral-7b-instruct-v0.3` | 14.50 GB | 222 (3 tensor shards) | `mistralai/Mistral-7B-Instruct-v0.3` |
| `archive/t5-small` | 0.24 GB, `model.safetensors` 242,043,056 B | 8 | `google-t5/t5-small` @ `df1b051` |

Each mirrored repository ships a `hippius-provenance.json` blob naming the
Hugging Face repository, the commit, the mirror date and a per-file SHA-256 for
its large files. That is what makes the mapping back to a Hugging Face
repository exact rather than guessed from the lowercased, org-stripped
repository name.

## What it publishes about the bytes, and whether it is true

This is the question that decides everything, and Hippius answers it better
than any third-party host this repository has measured.

Every file is content-addressed, because OCI layers are. There are two
layouts:

- **flat** (no `com.hippius.layout` annotation): every file is one
  `application/octet-stream` blob whose `digest` is the SHA-256 of that file's
  own bytes. `archive/t5-small`, `archive/all-minilm-l6-v2` and
  `archive/bge-small-en-v1.5` are like this.
- **chunked-v2**: small files stay raw blobs; each large file becomes an
  `application/vnd.hippius.pointer.v2` blob carrying
  `com.hippius.file.size`, `com.hippius.file.digest` and
  `com.hippius.chunk.count`, with its bytes in
  `application/vnd.hippius.pack.v1` blobs.

Of the 62 mirrored repositories, 5 are flat and 57 are chunked, and all 62
carry a provenance blob. Both layouts carry a per-file SHA-256, and it is the
right number. Four checks, all exact:

| File | What Hippius says | What the other party says |
| --- | --- | --- |
| `Qwen/Qwen3-8B` `model-00001-of-00005.safetensors` | `com.hippius.file.digest` `31d6a825…cbf5f`, 3,996,250,744 B | HF `X-Linked-ETag` `31d6a825…cbf5f`, `X-Linked-Size` 3,996,250,744 |
| `Qwen/Qwen3-8B` `model-00005-of-00005.safetensors` | `20c2d636…542ff`, 1,244,659,840 B | HF `X-Linked-ETag` `20c2d636…542ff` |
| `google-t5/t5-small` `model.safetensors` | blob digest `bd944e5f…842bc`, 242,043,056 B | HF `X-Linked-ETag` `bd944e5f…842bc` |
| `sentence-transformers/all-MiniLM-L6-v2` `model.safetensors` | blob digest `53aa5117…8d9db`, 90,868,376 B | **this hub's signed record** `files[].sha256` `53aa5117…8d9db` |

The last row is the one that counts: agreement not with Hippius's upstream but
with what this hub already holds. The revision agrees too — the provenance
names commit `1110a243fdf4706b3f48f1d95db1a4f5529b4d41` and
`data/index/models/sentence-transformers/all-MiniLM-L6-v2.json` names the same
one.

Bytes were then fetched from Hippius and re-hashed here, against this hub's
record for that revision:

| File | Fetched from Hippius | Git blob SHA-1 computed here | This hub's record | |
| --- | --- | --- | --- | --- |
| `config.json` | 612 B | `72b987fd…5a00` | `72b987fd…5a00` | match |
| `tokenizer.json` | 466,247 B | `cb202bfe…3c02` | `cb202bfe…3c02` | match |
| `README.md` | 10,977 B | `eaed6dbf…3904` | `44af2e3b…fde0`, 10,502 B | **mismatch** |

So a mirrored repository is accurate file by file for tensors and configs, and
its model card is not the card at the commit it names. The same gap shows in
`archive/qwen3-8b`, where `hippius-provenance.json` records `README.md` as
16,660 bytes while the manifest beside it ships 17,061. `HK-19` handles that
correctly — the file fails its address check and is refused — but it rules out
treating a Hippius repository as "Hugging Face at commit X". Each file has to
be checked on its own, and `hippius-provenance.json` is not an authority: it
disagrees with the manifest it is packaged with.

## Reading bytes: what works, and the three things that stop it

Ranged reads work, once a token is in hand. Measured 2026-11-16T09:35Z: a
1 MiB range, `bytes=104857600-105906175`, of `model.safetensors` from
`archive/t5-small`, against the same file at `huggingface.co`, three
consecutive requests each.

| | Status | Bytes | TTFB | Total |
| --- | --- | --- | --- | --- |
| Hippius, 1 | 206 | 1,048,576 | 2.265 s | 2.644 s |
| Hippius, 2 | 206 | 1,048,576 | 0.680 s | 1.135 s |
| Hippius, 3 | 206 | 1,048,576 | 0.709 s | 1.546 s |
| huggingface.co, 1 | 206 | 1,048,576 | 0.627 s | 0.963 s |
| huggingface.co, 2 | 206 | 1,048,576 | 0.389 s | 0.786 s |
| huggingface.co, 3 | 206 | 1,048,576 | 0.395 s | 0.989 s |

`HEAD`: Hippius 200 in 0.443 s; Hugging Face 200 in 1.698 s following its
redirect to the CDN. The range response is correct in every detail —
`accept-ranges: bytes`,
`content-range: bytes 104857600-105906175/242043056`,
`etag: "sha256:bd944e5f…"`, `cache-control: public, max-age=31536000`. Warm,
Hippius is 1.4× to 2.7× slower than Hugging Face on the same megabyte from
this machine. That is a usable difference, and it is not what disqualifies it.

**1. Every byte is behind a token.** `/v2/`, every manifest and every blob
answer `401` with
`www-authenticate: Bearer realm="https://registry.hippius.com/service/token",service="harbor-registry"`
when no `Authorization` header is sent. The token is free, anonymous and needs
no account —
`GET /service/token?service=harbor-registry&scope=repository:<name>:pull`
returns one — but obtaining it is a second request, to a second path, scoped
to one repository. `HK-03` says the edge runner only ever redirects. A `302` to
a Hippius blob URL lands an unmodified `huggingface_hub`, `curl -L` or a
browser on `401`. A redirect cannot carry a token exchange.

**2. No CORS on the response.** The preflight is fine: `OPTIONS` on a blob
returns `204` with `access-control-allow-origin: *`,
`access-control-allow-methods: GET,POST,PUT,OPTIONS` and
`access-control-allow-headers: Content-Type,Range,User-Agent,X-Requested-With`.
The actual `GET` carries no `access-control-*` header at all. Checked in a real
browser, from `hub.hippius.com`'s own origin, with a token and without: both
`fetch` calls fail with `TypeError: Failed to fetch`. The hub's page could not
read a Hippius byte even if the token problem went away.

**3. Large files have no URL.** This is the one that cannot be patched around
from this side. Under `chunked-v2` a big tensor is a pointer blob, and the
pointer is a JSON list of chunks:

```
{"chunks":[{"digest":"sha256:e9e5a8ea…","offset":0,
            "pack":"sha256:b218d9ef…","size":6417032}, …]}
```

`archive/qwen3-8b` is 251 layers: 10 raw files, 5 pointers, **236 pack blobs**;
one shard, `model-00001-of-00005.safetensors`, is 778 chunks.
`archive/qwen3.8-27b` is 831 layers with 18 pointers. No request returns
`model-00001-of-00005.safetensors`; a client reassembles it from hundreds of
ranged reads into pack blobs, and the convention that locates a chunk inside
its pack is not documented anywhere the site publishes — the pointer gives the
chunk's offset in the finished file and the digest of the pack holding it, not
its offset within that pack. Every repository whose tensors are large is
chunked. The flat repositories, the ones with one URL per file, are the small
ones.

## Enumeration is the easy part

Harbor's REST API is open to an anonymous client with no token at all,
paginated, and reports `x-total-count` and a `link: rel="next"` header:
`/api/v2.0/projects`, `/api/v2.0/projects/{project}/repositories`,
`/api/v2.0/projects/{project}/repositories/{repo}/artifacts`, and
`/api/v2.0/search?q=` across both. Only the `/v2/` manifest and blob paths need
the Bearer token.

No rate limit was reached and none is advertised: 25 consecutive
`/api/v2.0/projects` calls all returned `200`, 12.1 s for the batch, and no
`RateLimit` or `Retry-After` header appears on any response. A full sweep of
the mirror shelf is roughly 250 requests.

**Cost and requirements: none.** No account, no key of one's own, no wallet, no
payment anywhere in the read path. The Bearer token is issued to anyone who
asks for it.

## The decision

**Not a source.** Not on trust — on the wire.

Against the three outcomes:

- It is **not a vetted source**, and does not ask to be. It publishes digests
  that agree with Hugging Face's and with this hub's record, which is exactly
  right, and which also means it adds nothing as an address authority: every
  number it publishes, Hugging Face published first.
- It would make a good **unvetted source** under `HK-19` and `HK-22` — its
  files are checkable against addresses the record already carries, which is
  the whole requirement — if a client could fetch one. A client cannot.
- So it is **not a source** today. `SOURCES` feeds the edge's redirect slots,
  and the edge cannot redirect to a `401`, cannot hand a browser a response the
  browser is allowed to read, and cannot name a URL for a tensor at all.

The overlap is thin even setting the wire aside. All 62 repositories on the
mirror shelf carry a provenance blob, and 5 of the 62 are flat while 57 are
chunked. This hub's signed index holds 441 release records, and 17 of the 62
map onto one of them. The edge requires the revision to agree as well
(`held.revision === info.sha` in `edge/edge.mjs`), and the hub's nightly roll
has moved past Hippius's mirror on four of the seventeen:

| Hugging Face repository | Layout | Size | Revision |
| --- | --- | --- | --- |
| `sentence-transformers/all-MiniLM-L6-v2` | flat | 0.09 GB | agrees |
| `BAAI/bge-small-en-v1.5` | flat | 0.13 GB | agrees |
| `BAAI/bge-m3` | chunked, 33 packs | 2.30 GB | agrees |
| `google/embeddinggemma-2` | chunked, 22 packs | 1.53 GB | agrees |
| `google/gemma-4-26B-A4B-it` | chunked, 737 packs | 51.65 GB | agrees |
| `google/gemma-4-31B-it` | chunked, 891 packs | 62.58 GB | agrees |
| `openai-community/gpt2` | chunked, 16 packs | 1.42 GB | agrees |
| `hexgrad/Kokoro-82M` | chunked, 5 packs | 0.36 GB | agrees |
| `nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB` | chunked, 89 packs | 6.21 GB | agrees |
| `Qwen/Qwen3-0.6B` | chunked, 18 packs | 1.22 GB | agrees |
| `Qwen/Qwen3.5-4B` | chunked, 133 packs | 9.34 GB | agrees |
| `Qwen/Qwen3.5-9B` | chunked, 276 packs | 19.33 GB | agrees |
| `openai/whisper-large-v3-turbo` | chunked, 23 packs | 1.62 GB | agrees |
| `google/gemma-4-E2B-it` | chunked, 147 packs | 10.28 GB | hub `4adf1574`, Hippius `3e22461f` |
| `LiquidAI/LFM3-1.7B` | chunked, 50 packs | 3.48 GB | hub `1da06bec`, Hippius `ac2586a3` |
| `Qwen/Qwen3.6-35B-A3B` | chunked, 1,036 packs | 71.93 GB | hub `345d467b`, Hippius `995ad96e` |
| `Qwen/Qwen3.8-27B` | chunked, 799 packs | 55.59 GB | hub `37561816`, Hippius `1d4bf0f2` |

Thirteen agree on the revision. Two of those thirteen are flat, and so have a
URL per file: `sentence-transformers/all-MiniLM-L6-v2` and
`BAAI/bge-small-en-v1.5`, 0.09 GB and 0.13 GB. **Two models.** That is the
whole immediately reachable intersection, and both are small embedding models
already served quickly by two other hosts. The other 11,446 repositories on
Hippius are original uploads with no Hugging Face provenance, so the record
carries no address for them and `HK-19` refuses them however the bytes arrive.

Adding a fourth entry to `SOURCES` would tell the kernel a source holds a file
and then send clients to an error. Adding a runner that speaks Harbor's token
protocol and reverse-engineers `pointer.v2`/`pack.v1` would be real work to
reach a handful of models already served by two faster, CORS-clean hosts.
Neither earns a row in `model/ids.toml`, so neither got one. Nothing in `app/`,
`edge/`, `runner/`, `model/`, `features/` or `tools/` changed.

## What would change the answer

Three changes on Hippius's side, two of them configuration.

1. Serve public-project blobs and manifests without requiring a token, or
   accept an unscoped anonymous one. Then a single redirect reaches the bytes.
2. Put `access-control-allow-origin: *` and
   `access-control-expose-headers: etag, accept-ranges, content-range, docker-content-digest`
   on the blob **response**, not only on the preflight. The preflight already
   allows `Range`, so this is a response-header change.
3. Mirror with the flat layout, or publish the convention that locates a chunk
   inside its pack, so a large file has a URL.

With 1 and 2 the flat mirror repositories become a straightforward unvetted
source: `sources[]` gains a
`{"kind": "hippius.com", "resolve": "…/v2/archive/<repo>/blobs/", "missing": […]}`
entry keyed by blob digest rather than by path, and `HK-19` already permits it
because the record addresses the files. That is worth doing when it reaches
more than two models; with 3 as well, the whole shelf follows and it is worth
doing at once. Until then, this document is the entry.

A note on coverage inside a repository, because it would shape that
`missing` list: Hippius mirrors a subset of each repository's files. This
hub's record for `sentence-transformers/all-MiniLM-L6-v2` names 30 files;
Hippius holds 14 of them, with no `onnx/`, no `openvino/`, no
`pytorch_model.bin`, `tf_model.h5` or `rust_model.ot`. That is the same
partial-mirror shape `modelscope.cn` already has in the records, and it is
handled.

One thing is worth saying plainly, because it is why the mirror shelf is
interesting at all. Hippius is the first third-party host measured here whose
published digests agreed with this hub's own record on first contact.
`docs/pirateface-catalog.md` records a tracker that publishes a SHA-256 worth
nothing as a check, because the same party serves the bytes. Hippius publishes
a SHA-256 that Hugging Face published first, and that one is worth a great
deal: it settles that the mirror is real. The mirror simply cannot be read.
