# Every model Pirate Face has, and what "self-verifying" costs

Indexing all 669k is the wrong goal, and the measurement says why. The thing
worth capturing is not what Pirate Face has; it is the part that disappears
when Hugging Face does. There are 25,825 of those, not 669k, and the index
that matters is roughly a thousandth of the size of the obvious one.

Measured 2026-11-14 against <https://pirateface.co>.

## What is actually there

| | Count | Where measured |
| --- | --- | --- |
| Models in the catalog | 669k+ | the browse page and the homepage |
| With a magnet | 25,825 | the homepage counter |
| Seeding | 38,257 | the homepage counter |
| In this hub's signed index | 415 | `data/index/root.json` |

So 3.9 per cent of what Pirate Face lists has a torrent. The other 96 per cent
is a link to Hugging Face and a checksum, and both of those end when Hugging
Face does. That is the same shape `docs/comparison-pirateface.md` measured on
2026-11-13, and the counts have moved by about fourteen magnets in a day.

## How the catalog can be read

`GET /api/models` is a real JSON API, cursor-paginated, and the rows carry
everything discovery needs: `id`, `revision`, `seed`, `leech`, `seeded`,
`task`, `license`, `params`, `sizeBytes`, `format`, `downloads`, `likes`,
`hfBacked`. It is hard-capped at **30 rows a page**; `limit`, `seeded`,
`filter`, `sort` and `hasTorrent` were all passed and all ignored. So a full
sweep is 669,000 ÷ 30 ≈ **22,300 requests**, and there is no way to ask only
for the models with torrents.

`GET /s/<query>` returns plain text, and returns *only* models with a magnet,
which makes it a magnet-only view of the catalog but a query-driven one.
`GET /api/torrents?repo=<repo>` gives one model's magnet, infohash and a
SHA-256 per file. `sitemap.xml` has 42 entries and lists no models.

## The constraint that decides the design

A model cannot be made self-verifying by the party that serves its bytes.

Pirate Face publishes a SHA-256 per file. For bytes that arrive from Pirate
Face's swarm, that number proves nothing: it is the same party on both sides.
`HK-19` already says this in the kernel's own terms - a source that is not
vetted is chosen only for a file whose address *the record* names - and the
record's address has to come from somewhere independent.

Today there are exactly two independent sources for it:

1. **Hugging Face**, live, for any model: the LFS `sha256` in its tree API.
   This already works, with no indexing at all. The runner asks Hugging Face
   what the file should hash to and the swarm for the bytes, and the two are
   different parties. Measured: `openai-community/gpt2`, 125,162,496 bytes
   from 7 peers in 42 seconds, served to an unmodified `huggingface_hub`.
2. **This repository's witness**, for the models it downloads and re-hashes
   itself, which is currently three.

So the honest statement of the goal is not "index 669k models". It is: *for
how many models will an independent address still exist after Hugging Face
stops answering?* Right now the answer is 415, and none of the work below
changes that by indexing more of Pirate Face. It changes it by copying
Hugging Face's addresses while Hugging Face is still there.

## Three things that are usually run together and should not be

**Discovery** - what exists, how many seeders, how big. This is Pirate Face's
own data, it changes by the minute, and nothing is gained by snapshotting it.
Ask live. 100 per cent of the catalog, instantly, no index, no build, no
staleness. It is not signed by this hub and must not be presented as though it
were: it is Pirate Face's claim, labelled.

**Addressing** - what the bytes should hash to. This is what expires, and it
is the only thing worth a build. It comes from Hugging Face, not from Pirate
Face, and it is useless if collected after the thing it describes is gone.

**Serving** - deciding and carrying bytes. Already built, already proved, and
unchanged by any of this.

Running them together is what makes "index everything" look necessary. Split
apart, discovery needs no index and addressing needs a small one.

## What to build

### 1. Live federated discovery, now

The runner answers `/api/swarm/search?q=` from `/s/<query>` and
`/api/swarm/{repo}` from `/api/torrents`. Real time, no build, no storage, and
every one of the 669k models is reachable the moment Pirate Face lists it. The
answer says plainly which parts are Pirate Face's claims and which this hub can
check.

This is the whole of "seamless discovery", and it costs one endpoint.

### 2. An address snapshot, nightly

A scheduled workflow walks `/api/models` by cursor, keeps the rows where
`seeded` is true, and for each one records what Hugging Face says the files
should hash to. The output is not a release record; it is the smallest thing
that preserves verifiability:

    { repo, revision, infohash, files: [ { path, size, sha256 } ] }

25,825 models at roughly a kilobyte is about 25 MB, sharded by the hash of the
repository name so a reader fetches one shard, and signed in the root the way
every other shard already is.

Cost: 22,300 paged requests to Pirate Face plus up to 25,825 tree requests to
Hugging Face, which allows anonymous clients 500 calls per 5 minutes. One job
would take about nine hours; a matrix of twenty shards on separate runners
takes under an hour. Both are serverless in the sense that matters - nothing to
operate, no host, no daemon - and the artifact is static files.

### 3. Nothing in the kernel

`HK-19` already decides this correctly and needs no change. A model with an
address is servable from the swarm; one without is refused. Growing the set of
addressed models is an index question, not a kernel question.

## What this does not achieve, said plainly

It does not make 669k models self-verifying. It makes 25,825 of them
*candidates*, and each one becomes verifiable only if Hugging Face answers for
it before it stops answering. Models that Pirate Face lists but Hugging Face
has already removed cannot be addressed independently at all, and the right
answer for those is to serve them with the address missing and say so, never to
quietly accept Pirate Face's own number.

It also does not make the fourteen witness-only files per model servable. That
is the separate `addressed` fact, 104 bytes to 108, and it is unrelated to
catalog size.

## The first milestone

The search endpoint and the CLI, against the live catalog, with the labelling
that keeps Pirate Face's claims and this hub's checks apart. That is discovery
across all 669k models with no index at all, and it is what makes the address
snapshot worth building afterwards rather than before.
