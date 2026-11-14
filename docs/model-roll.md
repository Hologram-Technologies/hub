# Tracking every model, including the ones that are deleted

Written 2026-11-14. Every figure marked measured was measured on that date
against huggingface.co from one anonymous client; the rate ceiling is read from
`docs/brief.md`, not measured here; everything else is read from an API answer
and said to be. Nothing here is built yet. This is the design and the arithmetic
behind it.

## The answer first

Hugging Face's model list is one time-ordered log, and the cursor that pages it
is a pure function of a timestamp. So enumerating every model it has ever listed
costs about 3,076 calls and half an hour, needs no stored state, and can be cut
into windows and run in parallel. That is the whole basis of the design.

Addresses are a different matter: they cost one call per model, four orders of
magnitude more. So the hub should keep two things, not one. A **roll** of every
model that has ever existed, cheap and total. An **index** of addresses, built
on top of it by priority, which is what `tools/index.mjs` already does for 500.

A model that is uploaded and deleted before anybody looks cannot be recovered by
any amount of polling. It can be recovered three other ways, and the honest
claim is not "we have everything" but "we have everything listed, everything
created since we started watching, and everything deleted since the oldest dated
snapshot anyone published — and here is how wide the remaining window is."

## How the list works

`GET /api/models`, keyset-paginated, with the next page named in a
`Link: <…>; rel="next"` header. The cursor is base64 JSON over the sort key and
the row's `_id`.

Measured. For the default trending sort the cursor decodes to

    {"$or":[{"trendingScore":3666,"_id":{"$gt":"6ae46fa9d8b12585e6480c02"}},
            {"trendingScore":{"$lt":3666}},{"trendingScore":null}]}

and for `sort=createdAt&direction=-1` it decodes to the much simpler

    {"_id":{"$lt":"6af76c32ced10d8fb2d9c7c8"}}

because creation order *is* `_id` order. `_id` is a MongoDB ObjectId whose
leading four bytes are the creation time in seconds. Measured: the newest row's
`_id` began `6af7d200`, which is 2026-11-14T03:14:08Z, and its `createdAt` read
2026-11-14T03:14:08.000Z — the same second.

That holds for the oldest rows too, which is the part that could have broken it.
Measured: `bert-base-uncased` and `openai-community/gpt2` both report
`createdAt` 2022-03-02T23:29:04Z with adjacent `_id`s (`621ffdc0…174338` and
`…17434d`), the signature of a bulk migration. Nothing in the collection
predates that instant: a cursor for 2022-01-01 returns an empty array. So the
collection is one unbroken `_id`-ordered log with a known origin, and the sort
key and the pagination key never disagree.

## A cursor is a pure function of an instant

Given a time, the cursor for it is the base64 of

    {"_id":{"$lt":"<seconds as 8 hex digits><16 zeros>"}}

Measured, against `sort=createdAt&direction=-1&limit=3`:

| Asked for, before | First row returned |
| --- | --- |
| 2026-01-01T00:00:00Z | 2025-12-31T23:55:36Z |
| 2023-06-01T00:00:00Z | 2023-05-31T23:57:02Z |
| 2022-06-01T00:00:00Z | 2022-05-31T23:31:21Z |
| 2022-01-01T00:00:00Z | none; the log starts 2022-03-02 |

Three consequences, and they are the reason to prefer this over a crawl.

No state. A sweep that dies resumes from a timestamp, not from a saved cursor.

Parallel without coordination. Cut the timeline into windows, give one to each
worker, and each derives its own cursor. No worker needs to know about another,
and no row can be fetched twice or skipped, because the windows partition a
total order.

Auditable. "Every model created between A and B" is a claim a reader can check
by constructing the same two cursors.

## How big the job is

Measured, by taking 1,000 rows at ten points in the timeline and dividing by the
span they cover:

| Date | Models a day | 1,000 rows span |
| --- | --- | --- |
| 2022-04-01 | 116 | 206.8 h |
| 2022-10-01 | 273 | 87.8 h |
| 2023-04-01 | 698 | 34.4 h |
| 2023-10-01 | 745 | 32.2 h |
| 2024-04-01 | 1,144 | 21.0 h |
| 2024-10-01 | 3,599 | 6.7 h |
| 2025-04-01 | 2,769 | 8.7 h |
| 2025-10-01 | 2,484 | 9.7 h |
| 2026-04-01 | 2,601 | 9.2 h |
| 2026-11-14 | 3,482 | 6.9 h |

Integrating over the timeline gives about **3.08 million models** since
2022-03-02. That agrees with the "about 3 million public models" in
`docs/brief.md`, which came from a secondary source on 2026-08-22, so two
independent readings now say the same thing.

A separate direct measurement of today's rate: the 1,000 newest models spanned
7 h 14 m, which is 138 an hour or 3,315 a day. That agrees with the 3,482 above
to within five per cent.

At `limit=1000`, 3.08 million rows is about **3,076 calls**. `docs/brief.md`
records the anonymous ceiling as 500 API calls per five minutes, which is 100 a
minute, so a full sweep is about **half an hour**. Not measured here: whether a
sustained sweep at that rate is throttled in practice.

## Existence is cheap; addresses are not

`full=true` on the listing returns, per row: `id`, `sha`, `author`, `tags`,
`pipeline_tag`, `library_name`, `createdAt`, `lastModified`, `likes`,
`downloads`, `gated`, `private`, and `siblings`.

Measured, and this is the limitation that shapes everything: a sibling object
carries `rfilename` and nothing else. No size, no `lfs.oid`. `blobs=true` does
not change that on a listing — I asked for it and the sibling keys were still
`rfilename` alone. Sizes and SHA-256 come only from
`/api/models/{repo}/tree/{revision}`, one call per model.

So:

| What | Calls | Time, anonymous | JSON |
| --- | --- | --- | --- |
| every model's id, revision, times, tags, filenames | ~3,076 | ~30 min | ~12.6 GB |
| the same without `full=true` (no `sha`, no filenames) | ~3,076 | ~30 min | ~1.7 GB |
| every model's file sizes and SHA-256 | ~3,080,000 | ~21 days | much larger |

The payload figures are measured: 500 rows with `full=true` came to 2,041,226
bytes, 4.08 kB a row; without it, 279,221 bytes, 558 B a row.

Four orders of magnitude between existence and addresses is not a detail to
optimise away. It is the reason the design has two layers.

## Two layers

**The roll.** One record per model that has ever been seen: id, revision at
first sight and at last sight, created, first seen, last seen, filenames, and
the state it was last in — listed, gone, private or gated. Append-only: a
record is never removed, only marked. Built by the sweep above, kept current by
polling the newest page.

Polling cost, measured against today's rate: one 1,000-row page covers seven
hours, so a poll every five minutes costs twelve calls an hour — two-tenths of
one per cent of the anonymous budget. A five-minute poll overflows its page only
when more than 1,000 models are created in five minutes, which is 12,000 an hour
against today's 138: the rate would have to rise eighty-seven-fold.

**The index.** What `tools/index.mjs` builds today: the ten fields the kernel
calls a complete record, every file with its size, git blob SHA-1 and SHA-256,
the sources that hold it, and now the witnesses that attest to it. This stays
expensive and therefore stays prioritised. The roll is what tells it what
exists; it decides what to address first.

The split also answers the coverage question `docs/brief.md` raised under "lazy
and total". A request for a model the index has not addressed can still be
answered, because the roll knows the model exists and at what revision, and the
edge can ask Hugging Face for the rest. A request for a model that is in the
roll and gone from Hugging Face can be answered truthfully: this existed, here
is when, here is what it held, and here is why we cannot serve it.

## Models uploaded briefly and then deleted

Three mechanisms. The first bounds the problem, the second fixes the future, the
third is the one that reaches backwards.

### Catch it at creation

Polling the newest page bounds the blind window to the poll interval. At five
minutes and today's rate that is about eleven models. Tightening the interval
tightens the window linearly and the cost rises linearly, and both stay
negligible against the budget. What it cannot do is reach zero: a model created
and deleted inside one interval is never listed while we are looking.

### Never forget

A record in the roll is never deleted. When a model stops answering, the roll
records when and how, and the distinction is available: Hugging Face answers 404
for a repository that is not there and 401 with `WWW-Authenticate: Bearer` for
one that is private or gated, which `docs/brief.md` records and `edge/edge.mjs`
already relies on. So "deleted" and "made private" are not conflated.

This makes the hub's catalogue strictly larger than Hugging Face's own listing,
and it is the first thing in this design that Hugging Face cannot do for you.
The live hub already keeps a ledger of this shape: `/archive.json` is a dated,
hash-chained list of daily snapshots back to 2026-09-17, each with its model and
file counts, an IPFS CID and a BLAKE3 index address, linked by `prev`.

### Difference other people's dated dumps

This is the mechanism that recovers models deleted before we ever looked, and it
needs no watching at all.

Several people publish periodic dumps of the Hub's own metadata as Hugging Face
datasets, and Hugging Face keeps the git history of a dataset. So the dumps are
not one snapshot; they are a time series, and every past revision stays
fetchable after the models it names are gone.

Measured. `cfahlgren1/hub-stats` holds `models.parquet` alongside
`datasets.parquet`, `spaces.parquet` and others; `lastModified`
2026-11-13T13:46:30Z, 19,339 downloads.
`GET /api/datasets/cfahlgren1/hub-stats/commits/main` returned 50 commits, the
most recent being `Upload models.parquet with huggingface_hub` at
2026-11-13T13:39:37Z. Each revision is fetchable at
`/datasets/cfahlgren1/hub-stats/resolve/<commit>/models.parquet`.

A model present in revision A and absent from a later revision B was deleted
between them. That is a dated deletion log, free, retrospective, and reaching
further back than our own first poll.

`librarian-bots/model_cards_with_metadata` is a second, independent series
(`lastModified` 2026-11-13T03:19:17Z, 914 downloads), which matters because two
unrelated publishers agreeing is better evidence than one.

Unverified, and the first thing to check before relying on this: how far back
each series' history actually reaches, how complete each dump is, and whether a
dump is a full listing or a filtered one. The commit list returned 50 entries,
which is a page and not necessarily the whole history.

### What stays unrecoverable

A model created and deleted entirely between two snapshots that nobody held. No
mechanism here recovers it, and no polling rate removes the possibility.

What the design does instead is make the gap measurable: for any window, the
roll can state the poll interval in force, which third-party series covered it
and at what cadence, and therefore the width of the blind window in minutes. An
honest index says how incomplete it is. That is the difference between this and
a claim of totality nobody can check.

## A dead end, measured

Worth recording so nobody builds it twice.

An ObjectId ends in a three-byte counter. If the counter were dense, a gap
between two observed ids would be proof that a row had existed and was gone —
deletion detection for free, with no polling.

Measured: 1,000 consecutive models carried 75 distinct five-byte process
prefixes, and within the busiest prefix 38 rows spanned 819,523 counter values,
a density of 0.0 per cent. The counters are not dense. A gap proves nothing.

## What this would add to the repository

Not decided here; this is the shape, and the sizing is the point of the
document.

A roll builder, beside `tools/index.mjs` rather than inside it, because the two
have different budgets and different failure modes. It writes the roll as
content-addressed shards named by a signed root, the way the index already is,
so a reader checks it before believing it.

A backfill tool that reads a third-party series' commit history, differences
consecutive revisions, and writes tombstones for the models that disappeared,
naming the series and the two revisions as the authority for each — an imported
fact, reproduced from its named source, not restated as a local one.

A poller, which is the only part that must run on a schedule rather than at
deploy time.

Open questions that are the user's, not mine. Whether the roll is signed as one
object or per shard. Whether a tombstone is a claim the kernel reasons about,
which would make it a registered capability with a scenario and a failing test,
or build-tool data like `manifests/owners.txt`, which carries no ID.

The third question - how much of the roll belongs in the published site - is
settled below.

## How much of it the site can publish

All of it, without the file names, in 2,048 shards. That is 367 MB, thirty-six
per cent of what GitHub Pages allows, and it answers any lookup in one fetch of
65 kB. `tools/roll.mjs` builds it; measured 2026-11-14, a day of the Hub is
3,969 models from four calls in a few seconds.

### What a record costs

These figures replace an earlier estimate in this document that was wrong by
about a factor of two, and the reason is worth keeping. The estimate was taken
from a sample of listing rows fetched *without* `full=true`, so every row's
`sha` was absent and serialised as `null` - four characters where a real row
carries a forty-character hash. On a sixty-byte record that is a thirty-six
byte error. The numbers below come from running `tools/roll.mjs` over a real
day, 3,969 models, rather than from projecting a sample.

| | Raw | Gzipped | 3.08 million, raw | Gzipped |
| --- | --- | --- | --- | --- |
| a roll line, measured | 119.1 B | 42.9 B | 367 MB | 132 MB |
| the earlier estimate | 60 B | 17 B | 185 MB | 52 MB |
| with the file names | 2,683 B | 476 B | 8.3 GB | 1.5 GB |

A line is `[id, revision, created, first seen, last seen, state]`; measured mean
id length in that day was 36.9 characters, and the forty-character revision is
the single largest field.

Sorting by id rather than creation order changes the compressed size by less
than one per cent, so sorting is free and worth doing for the lookup. It also
makes a build deterministic: the shard's bytes are a function of its rows and
not of the order they were met in.

The file names are the whole difference, and they settle their own question:
8.3 GB is eight times the published-site limit. They belong in the index, where
they arrive with the sizes and addresses that make them useful, one model at a
time. The 2,683 B figure comes from a trending sample averaging 56.9 files a
model, which is biased high because popular models carry many files, so the real
figure across three million is lower - but not by the factor of eight it would
need to be.

### What the site allows

From GitHub's own limits page, read 2026-11-14: a published Pages site "may be
no larger than 1 GB"; source repositories have a recommended limit of 1 GB;
there is a soft bandwidth limit of 100 GB a month; and the soft limit of ten
builds an hour "does not apply if you build and publish your site with a custom
GitHub Actions workflow", which `pages.yml` is.

So 367 MB is 35.8 per cent of the hard limit, next to the 2.4 MB the index
publishes today. It fits, with room, but not with the margin the first estimate
suggested. The bandwidth limit is the one that binds in practice: 100 GB a
month is about 760 downloads of the whole roll, or about 1.5 million
single-model lookups if the roll is sharded. That is the argument for sharding,
rather than cache-friendliness.

### How many shards

Arithmetic over the measured row size: a shard holds 3.08 million over the
shard count at 42.9 B compressed a row, and the root names each shard by path
and SHA-256, measured at 115 B an entry, compressing to roughly a third.

| Shards | Shard, gzipped | Root, gzipped | Cold lookup | Warm lookup |
| --- | --- | --- | --- | --- |
| 256 | 517 kB | 10 kB | 527 kB | 517 kB |
| 512 | 258 kB | 21 kB | 279 kB | 258 kB |
| 1,024 | 129 kB | 41 kB | 170 kB | 129 kB |
| **2,048** | **65 kB** | **82 kB** | **147 kB** | **65 kB** |
| 4,096 | 32 kB | 165 kB | 197 kB | 32 kB |

2,048 is the minimum for a cold lookup, and the curve is flat between 1,024 and
4,096, so the choice is not delicate. Fewer shards and the shard dominates; more
and the root does, because every reader fetches the root first. The correction
to the row size moved this optimum from 1,024 to 2,048, which is the one place
the earlier error changed a decision rather than only a number.

Key by the first eleven bits of the SHA-256 of the model id, which gives 2,048
buckets of about 1,504 rows each, evenly filled whatever the distribution of
owner names. Each shard is named in the signed root by the hash of its bytes, so
a reader checks a shard before believing a row of it - the same rule the browse
shards already follow, and the same kernel accept rule (`HK-10`) judges it.

Measured caution for anyone reproducing this: a shard's compression ratio
depends on how full it is. In a day-sized build each shard holds about two rows
and compresses to 76 B a row; at three million the shards hold 1,504 rows each
and compress like the whole roll, at 42.9 B. The table uses the latter, which
is the figure that applies when the roll is complete.

### The alternative, which also works

One sorted file and HTTP Range, no shards. Measured 2026-11-14 against the
published site: a ranged request answered `206 Partial Content` with
`Content-Range: bytes 100-199/71782` and returned exactly 100 bytes, and the
range was over the uncompressed length, because the client did not ask for
gzip. Pages also compresses on the wire when asked - the same file came back
`Content-Encoding: gzip` at 34,593 bytes against 71,782 raw.

So a binary search over a fixed-width key table is possible on Pages today, in
about twenty-two ranged reads of a few bytes each, which is far less traffic
than a 51 kB shard. It is not the recommendation, for two reasons. A ranged read
cannot be checked against a hash without fetching the whole file, so it trades
away the one property the index is built on. And the shard layout already
exists here, with a signed root and a kernel rule that judges it.

Worth keeping in mind for the edge rather than the browser: a runner that has
already verified a shard can serve ranges out of it.

## What runs on its own, and what does not yet

The hub is meant to track Hugging Face. Until 2026-11-14 nothing here did:
`pages.yml` ran on a push to main and on a manual dispatch, so the published
catalogue moved when somebody committed and not when Hugging Face published.
That is now a `schedule:` of `17 */6 * * *` - four runs a day, at seventeen
minutes past, offset from the hour because GitHub's scheduler is busiest there.

Six hours rather than something shorter, for a measured reason: a run of that
workflow took 19 to 33 minutes over the five runs before that date, and
`concurrency: pages` does not cancel a run in progress, so a shorter period
would queue runs behind one another rather than refresh anything sooner.

Staleness in the published index is therefore a floor of about six hours, plus
whatever GitHub's scheduler adds, which under load can be considerable. It does
not need to be better than that, and this is the part worth understanding: the
published index is a cache, not the only path. A model it does not hold is
still answered, because `edge/edge.mjs` asks Hugging Face for anything it
cannot answer from the index. The cadence decides how often an answer is cheap,
not whether it is right.

What does not run on its own yet is the roll. `tools/roll.mjs` exists and is
gated, but nothing publishes its output, because 367 MB would ride in every
deploy of the site whether or not a shard changed, and the Pages action uploads
the whole artifact each time. The open decision is where the roll lives: in
this site, accepting slower deploys; or on a site of its own with its own
schedule, which the edge would read by URL the way it already reads the index.

## Sources

Everything above marked measured was obtained with `curl` and `node` against
these endpoints on 2026-11-14:
`/api/models`, `/api/models/{repo}`, `/api/datasets`,
`/api/datasets/{repo}/commits/main`, and `https://gethologram.ai/archive.json`.
The anonymous rate ceiling is from `docs/brief.md`. The three-million figure in
`docs/brief.md` came from a secondary source on 2026-08-22 and is corroborated
here by measurement.
