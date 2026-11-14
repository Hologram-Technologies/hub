# Models catalog API, measured against the edge runner

Measured on 2026-11-13.

Three servers answered the same request in each case.
A is `https://huggingface.co`, the reference.
B is `http://127.0.0.1:8789`, this hub's edge with Hugging Face reachable.
C is `http://127.0.0.1:8788`, the same edge with `HF_API=off DRAIN=huggingface.co`, answering from the signed index alone.
Both B and C reported `index: 400` models at `/health`, so they hold the same index and differ only in whether they may call Hugging Face.

## Method

Each case was issued to all three servers by a short Node script using `fetch`, with `accept: application/json`, redirects not followed, and at least 1.1 s between calls to A.
The curl command shown for each case issues the same request; two cases (the missing repository, and the commit SHA used below) were also run through curl directly and agreed.
No call was answered with 429, so no rate-limit wait was needed.
Header names are recorded in lower case; only `link`, `x-error-code`, `x-error-message`, `x-repo-commit`, `x-linked-etag`, `x-linked-size`, `x-total-count` and `content-type` were read.
Bodies are recorded as shapes: top-level keys for an object, length and first-element keys for an array.
Small reference bodies from A are kept under `raw/`.

The index holds `openai-community/gpt2` and `MiniMaxAI/MiniMax-H3-Image`.
It does not hold `openai-community/gpt2-xl` or `meta-llama/Llama-3.1-8B-Instruct`.
This matters throughout: B answers an indexed repository from the index, and reaches Hugging Face only for a repository the index does not hold.
`edge/edge.mjs` claims `/api/models`, `/api/models/{repo}`, and the `revision`, `tree`, `paths-info` and `refs` sub-routes from the index, with everything else under `/api/models/...` passed through to Hugging Face when it is reachable.
Routes that do not start with `api/models/` or equal `api/models` are refused; `api/models-tags-by-type` and `api/quicksearch` fall outside that prefix.
The edge strips `xetHash` and `xetEnabled` from every passthrough body, by design.

## 1. GET /api/models

### 1.1 No parameters

    curl -s -D - "$BASE/api/models"

A: 200, `link: <...cursor=...>; rel="next"`, array of 1000, first element keys `_id, id, likes, trendingScore, private, downloads, tags, pipeline_tag, library_name, createdAt, modelId`.
B: 200, the same `link` with the origin rewritten to B, array of 1000, same keys, same first five ids as A.
C: 200, no `link`, array of 50, first element keys `_id, id, modelId, author, sha, private, gated`.
Verdict: different. C caps at 50 rather than 1000, drops nine of the eleven list fields, adds `author` and `sha`, and offers no next page.

### 1.2 limit

    curl -s -D - "$BASE/api/models?limit=3"

A: 200, 3 rows, `link` present.
B: 200, identical to A, row for row.
C: 200, 3 rows, the reduced seven-key row, no `link`.
Verdict: different. `limit` itself is honoured by C; the row shape and the missing `link` are the difference.
Reference body: `raw/raw-list-limit.json`.

### 1.3 search

    curl -s -D - "$BASE/api/models?search=gpt2&limit=3"

A: 200, 3 rows, ids `openai-community/gpt2`, `openai-community/gpt2-xl`, `openai-community/gpt2-large`.
B: 200, identical to A.
C: 200, 1 row, id `openai-community/gpt2`.
Verdict: different. C matches a case-insensitive substring of the repository id against the 400 indexed records only, so it finds one of the three.
Reference body: `raw/raw-list-search.json`.

### 1.4 author

    curl -s -D - "$BASE/api/models?author=openai-community&limit=3"

A: 200, 3 rows, ids `openai-community/gpt2`, `openai-community/gpt2-xl`, `openai-community/openai-gpt`.
B: 200, identical to A.
C: 200, 1 row, `openai-community/gpt2`.
Verdict: different, for the same reason as search.
Reference body: `raw/raw-list-author.json`.

### 1.5 filter

    curl -s -D - "$BASE/api/models?filter=text-generation&limit=3"

A: 200, 3 rows, all tagged for text generation.
B: 200, identical to A.
C: 200, 3 rows, the same first rows it returns with no parameters at all, including an image model.
Verdict: different. C ignores `filter`.

### 1.6 sort

Hugging Face accepts five sort keys. Measured one at a time:

    curl -s "$BASE/api/models?sort=downloads&limit=5"
    curl -s "$BASE/api/models?sort=likes&limit=5"
    curl -s "$BASE/api/models?sort=createdAt&limit=5"
    curl -s "$BASE/api/models?sort=lastModified&limit=5"
    curl -s "$BASE/api/models?sort=trendingScore&limit=5"

A answered 200 for each, with a visibly different ordering per key, and varied the row shape: `trendingScore` is present only when sorting by it or by default, `lastModified` only when sorting by it, and `pipeline_tag` or `library_name` are absent from rows that have none.
B answered 200 with the same ordering and the same shape for every key.
The one exception is `sort=lastModified`, where B's first row was a model pushed between the two calls, so B's list was one row ahead of A's; the key sets matched apart from `library_name`, which that extra model carries. This is live-data drift between two calls, not an edge difference.
C answered 200 for every key with its own default ordering, unchanged by the sort key.

The name `trending` is not accepted:

    curl -s -D - "$BASE/api/models?sort=trending&limit=5"

A: 400, `x-error-message: * Invalid sort parameter: trending`, body `{error}`.
B: 400, identical body and header.
C: 200, 5 rows.
An unknown key behaves the same way: `sort=notARealSort` gives A and B 400 with the name echoed, and C 200.
Verdict: different. C ignores every sort key and accepts a value Hugging Face rejects.

### 1.7 direction

    curl -s -D - "$BASE/api/models?sort=downloads&direction=1&limit=5"

A: 400, `x-error-message: Invalid sort direction, only descending sort is supported for downloads`.
B: 400, identical.
C: 200, 5 rows in its default order.
Verdict: different. C accepts a request Hugging Face rejects.

### 1.8 full=true

    curl -s "$BASE/api/models?limit=2&full=true"

A: 200, rows gain `author, gated, lastModified, sha, siblings` on top of the default row, 16 keys in all.
B: 200, identical.
C: 200, the same seven-key row as with no parameters, no `siblings`.
Verdict: different. C ignores `full`.
Reference body: `raw/raw-full-true.json`.

### 1.9 config=true

    curl -s "$BASE/api/models?limit=2&config=true"

A: 200, rows gain a `config` object.
B: 200, identical.
C: 200, unchanged seven-key row, no `config`.
Verdict: different. C ignores `config`.
Reference body: `raw/raw-config-true.json`.

### 1.10 expand[], one value

    curl -s "$BASE/api/models?limit=2&expand%5B%5D=downloadsAllTime"

A: 200, rows reduced to `_id, id, trendingScore, downloadsAllTime`.
B: 200, identical.
C: 200, the seven-key index row, no `downloadsAllTime`.
Verdict: different. C ignores `expand[]`.
Reference body: `raw/raw-expand-one.json`.

### 1.11 expand[], several values

    curl -s "$BASE/api/models?limit=2&expand%5B%5D=downloadsAllTime&expand%5B%5D=safetensors&expand%5B%5D=gguf&expand%5B%5D=lastModified&expand%5B%5D=trendingScore"

A: 200, rows `_id, id, lastModified, trendingScore, downloadsAllTime, safetensors`. `gguf` is accepted and simply absent from rows with no GGUF file.
B: 200, identical.
C: 200, unchanged index row.
Verdict: different, as above.
Reference body: `raw/raw-expand-many.json`.

### 1.12 Cursor pagination

    curl -s -D - "$BASE/api/models?limit=2&sort=createdAt"
    # then follow the URL inside <...> from the Link header

A: page one 200, `link: <https://huggingface.co/api/models?limit=2&sort=createdAt&cursor=...>; rel="next"`; following it gives 200, two further ids, and a fresh `link`.
B: page one 200 with the same cursor and the origin rewritten to `http://127.0.0.1:8789`; following it gives 200, the same two ids as A's page two, and a fresh `link` also pointing at B.
C: page one 200 with no `link` at all, so there is nothing to follow. Passing a cursor explicitly is ignored: C returns its first page again with 200.
A also returns 400 for a cursor minted under a different sort, and B returns the same 400, so that is not a difference.
Verdict: different. Pagination works through B and stops after one page on C.

## 2. GET /api/models/{repo}

Repository `openai-community/gpt2`, commit `607a30d783dfa663caf39e06633721c8d4cfcd7e`.

### 2.1 Plain

    curl -s "$BASE/api/models/openai-community/gpt2"

A: 200, 24 top-level keys, `siblings` 26 entries of `rfilename` only.
B: 200, 15 keys. Absent against A: `lastModified, widgetData, model-index, config, cardData, transformersInfo, spaces, safetensors, usedStorage`. No extra keys.
C: 200, the same 15 keys as B.
Equal to A on B and C: `sha`, `author`, `pipeline_tag`, `library_name`, the set of sibling filenames, and the sibling shape.
Unequal on B and C: `downloads` (32,892,223 against A's 33,264,897), `likes` (3,931 against 3,934), `createdAt` (`2022-03-02T00:00:00.000Z` against `2022-03-02T23:29:04.000Z`), `_id` (the first 24 characters of the commit, not Hugging Face's own object id), and `tags` (6 index tags against A's 18, with `English` where A has `en`, and without the `doi:`, `region:`, `endpoints_compatible` and framework tags).
Verdict: different, on both B and C, for any repository the index holds.
Reference body: `raw/raw-repo-plain.json`.

For a repository the index does not hold, B is byte-identical to A:

    curl -s "$BASE/api/models/openai-community/gpt2-xl"

A: 200, 4362 bytes, 24 keys. B: 200, 4362 bytes, no key missing or added. C: 401 `RepoNotFound`.

### 2.2 blobs=true

    curl -s "$BASE/api/models/openai-community/gpt2?blobs=true"

A: 200, siblings gain `blobId`, `size` and, for LFS files, `lfs: {sha256, size, pointerSize}`.
B and C: 200, siblings gain `size`, `blobId` and the same `lfs` object. For `model.safetensors` the `blobId`, `size`, `lfs.sha256` and `lfs.pointerSize` (134) all equal A's.
Verdict: identical for the parameter itself; the surrounding object still carries the differences of 2.1.
Reference body: `raw/raw-repo-blobs.json`.

### 2.3 /revision/{sha} and /revision/main

    curl -s "$BASE/api/models/openai-community/gpt2/revision/main"
    curl -s "$BASE/api/models/openai-community/gpt2/revision/607a30d783dfa663caf39e06633721c8d4cfcd7e"

On A both bodies are byte-identical to the plain repository body: the three saved files share one MD5.
B and C: 200 for both forms, the same 15-key body as 2.1.
Verdict: different, with the same missing and stale fields as 2.1; the revision routing itself resolves correctly, including the full SHA.

## 3. GET /api/models/{repo}/tree/{rev}

    curl -s "$BASE/api/models/openai-community/gpt2/tree/main"

A: 200, 17 entries, `directory:onnx` first and then files in name order, file keys `type, oid, size, path`, with `lfs: {oid, size, pointerSize}` and `xetHash` on LFS files.
B and C: 200, 17 entries, the same paths, and every file's `oid`, `size` and `type` equal to A's. Order is plain name order, so `onnx` falls between `merges.txt` and `pytorch_model.bin` rather than leading. `xetHash` is absent. The `onnx` directory's `oid` does not match A's: the edge synthesises it from the revision and the folder name.
Verdict: different. Entry order, the directory `oid`, and the absent `xetHash`.
Reference body: `raw/raw-tree-main.json`.

### 3.1 recursive=true

    curl -s "$BASE/api/models/openai-community/gpt2/tree/main?recursive=true"

A: 200, 27 entries. B and C: 200, 27 entries, the same path set.
Verdict: different only by the ordering and directory `oid` of the base case; the parameter itself is honoured.
Reference body: `raw/raw-tree-recursive.json`.

### 3.2 expand=true

    curl -s "$BASE/api/models/openai-community/gpt2/tree/main?expand=true"

A: 200, 17 entries, each gaining `lastCommit`; files also carry `securityFileStatus`.
B and C: 200, 17 entries with the plain four keys. Neither `lastCommit` nor `securityFileStatus` appears.
Verdict: different. `expand` is accepted and ignored.
Reference body: `raw/raw-tree-expand.json`.

## 4. POST /api/models/{repo}/paths-info/{rev}

Form-encoded, as `huggingface_hub` sends it.

    curl -s -X POST "$BASE/api/models/openai-community/gpt2/paths-info/main" \
      -d "paths=config.json" -d "paths=model.safetensors" -d "paths=onnx" -d "expand=True"

A: 200, 3 entries. `config.json` has `type, oid, size, path, lastCommit, securityFileStatus`; `model.safetensors` adds `lfs` and `xetHash`; `onnx` is `type: directory` with `lastCommit`.
B and C: 200, 3 entries, the same paths and types, keys `type, oid, size, path`, and `lfs` where applicable.
Verdict: different. Both repeated `paths` values and a directory path are handled; `expand=True` is ignored, so `lastCommit` and `securityFileStatus` are absent, and `xetHash` is stripped.
Reference body: `raw/raw-paths-info.json`.

## 5. refs and commits

### 5.1 refs

    curl -s "$BASE/api/models/openai-community/gpt2/refs"

A: 200, keys `tags, branches, converts`; one branch, `main`, with the correct `targetCommit`.
B and C: 200, keys `branches, converts, tags, pullRequests`; the same single branch and `targetCommit`.
Verdict: different, mildly. An extra empty `pullRequests` array, which `huggingface_hub` reads as optional.
Reference body: `raw/raw-refs.json`.

### 5.2 commits/{rev}

    curl -s -D - "$BASE/api/models/openai-community/gpt2/commits/main"

A: 200, `x-total-count: 26`, array of 26, keys `id, title, message, authors, date`.
B: 200, `x-total-count: 26`, identical array.
C: 401, `x-error-code: RepoNotFound`, body `{"error":"Repository not found"}`.
Verdict: missing on C. The route is not derived from the index, so with Hugging Face off there is nothing to answer with, and the refusal names the repository rather than the route.
Reference body: `raw/raw-commits-main.json`.

## 6. Tag list and quick search

### 6.1 models-tags-by-type

    curl -s -D - "$BASE/api/models-tags-by-type"

A: 200, 618,864 bytes, nine top-level keys, each an array: `region` 2, `library` 55, `other` 8, `license` 82, `language` 5650, `deploy` 3, `dataset` 3042, `bucket` 6, `pipeline_tag` 52.
The body is not kept, by instruction.
B and C: 400, `x-error-code: BadRequest`, `x-error-message: The request is not one the hub understands`.
Verdict: missing. The path does not start with `api/models/`, so the edge refuses it before any passthrough.

### 6.2 quicksearch

    curl -s -D - "$BASE/api/quicksearch?q=qwen&type=model"

A: 200, keys `datasets, datasetsCount, models, modelsCount, orgs, q, spaces, spacesCount, users, papers, papersCount, collections, collectionsCount, buckets, bucketsCount, containers, containersCount, kernels, kernelsCount, blogs, blogsCount`; `models` rows carry `id, _id, private, authorType`.
B and C: 400, `x-error-code: BadRequest`, the same message as above.
Verdict: missing, for the same reason.
Reference body: `raw/raw-quicksearch.json`.

## 7. Error shapes

### 7.1 Model that does not exist

    curl -s -D - "$BASE/api/models/openai-community/definitely-not-a-model-xyz9"

A: 401, no `x-error-code` header at all, `x-error-message: Invalid username or password.`, body `{"error":"Invalid username or password."}`. Confirmed with curl directly.
B: 401, identical, header for header.
C: 401, `x-error-code: RepoNotFound`, `x-error-message: Repository not found`, body `{"error":"Repository not found"}`.
Verdict: different on C. The status matches, but the body text differs and C sets an `x-error-code` where Hugging Face sets none for an anonymous caller.

### 7.2 Revision that does not exist

    curl -s -D - "$BASE/api/models/openai-community/gpt2/revision/0123456789abcdef0123456789abcdef01234567"

A: 404, `x-error-code: RevisionNotFound`, `x-error-message: Invalid rev id: 0123456789abcdef0123456789abcdef01234567`, body echoing that message.
B: 404, identical.
C: 404, `x-error-code: RevisionNotFound`, `x-error-message: Revision not found`, body `{"error":"Revision not found"}`.
The tree route behaves the same way: A and B 404 with the echoed rev id, C 404 with its own message.
Verdict: different on C in the message only; status and error code match.

### 7.3 File that does not exist

Through `paths-info`:

    curl -s -X POST "$BASE/api/models/openai-community/gpt2/paths-info/main" -d "paths=no-such-file.bin" -d "expand=True"

A, B and C: 200, empty array.
Verdict: identical.

Through the resolve route:

    curl -s -I "$BASE/openai-community/gpt2/resolve/main/no-such-file.bin"

A: 404, `x-error-code: EntryNotFound`, `x-error-message: Entry not found`, `x-repo-commit: 607a30d783dfa663caf39e06633721c8d4cfcd7e`, `content-type: text/plain`.
B and C: 404, `x-error-code: EntryNotFound`, `x-error-message: Entry not found`, no `x-repo-commit`, `content-type: application/json`.
Verdict: different. The status and error code match; `x-repo-commit` is absent on the refusal.

### 7.4 Gated model

    curl -s -D - "$BASE/api/models/meta-llama/Llama-3.1-8B-Instruct"
    curl -s -D - "$BASE/api/models/meta-llama/Llama-3.1-8B-Instruct/tree/main"
    curl -s -I "$BASE/meta-llama/Llama-3.1-8B-Instruct/resolve/main/config.json"

Metadata, anonymous: A 200 with 25 keys, including `gated` and `inference`; B 200 with the same byte length and the same keys. C 401 `RepoNotFound`, because the index does not hold the repository.
Tree, anonymous: A 200, 15 entries with `lfs` and `xetHash` on the shards. B 200, the same 15 entries with `xetHash` stripped. C 401 `RepoNotFound`.
Resolve: A 401, `x-error-code: GatedRepo`, `x-error-message: Access to model meta-llama/Llama-3.1-8B-Instruct is restricted. You must have access to it and be authenticated to access it. Please log in.`, `content-type: text/plain`. B 401, `x-error-code: GatedRepo`, `x-error-message: Access to this repository is gated`, `content-type: application/json`. C 401, `x-error-code: RepoNotFound`.
Verdict: different. B classifies the gate correctly and differs only in the message text; C cannot see a gated repository at all and reports it as not found.

## What was not measured

No authenticated call was made, so every status above is the anonymous one.
Datasets and spaces were out of scope and were not called.
`models-tags-by-type` was read once, for its key counts only.
