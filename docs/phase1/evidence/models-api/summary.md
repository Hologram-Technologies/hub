# Models catalog API, summary

Measured on 2026-11-13 against https://huggingface.co (A), the edge with Hugging Face reachable on 127.0.0.1:8789 (B), and the same edge answering from the signed index alone on 127.0.0.1:8788 (C).
Every row below was measured; the requests and recorded values are in `transcript.md`.
Of 30 rows, 3 are missing, 23 are different, and 4 are identical.
Missing and different rows come first.

| Route | Parameter | A | B | C | Verdict | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/models-tags-by-type` | none | 200, 9 key arrays, 619 KB | 400 `BadRequest` | 400 `BadRequest` | missing | Path falls outside the `api/models` prefix the edge claims, so it is refused before any passthrough. |
| `/api/quicksearch` | `q`, `type=model` | 200, 21 keys, `models` rows | 400 `BadRequest` | 400 `BadRequest` | missing | Same cause; the route is not claimed at all. |
| `/api/models/{repo}/commits/{rev}` | none | 200, 26 commits, `x-total-count: 26` | 200, identical | 401 `RepoNotFound` | missing | B passes through. C has no commit list in the index and refuses as if the repository did not exist. |
| `/api/models` | none | 200, 1000 rows, 11 keys, `Link` next | 200, identical | 200, 50 rows, 7 keys, no `Link` | different | C caps at 50, drops `downloads`, `likes`, `tags`, `pipeline_tag`, `library_name`, `createdAt` and `trendingScore`, and adds `author` and `sha`. |
| `/api/models` | `limit` | 200, n rows | 200, identical | 200, n rows, reduced shape | different | The count is honoured; the row shape and the absent `Link` are not. |
| `/api/models` | `search` | 200, 3 gpt2 repos | 200, identical | 200, 1 row | different | C substring-matches repository ids across its 400 records only. |
| `/api/models` | `author` | 200, 3 rows | 200, identical | 200, 1 row | different | Same cause as `search`. |
| `/api/models` | `filter` | 200, filtered rows | 200, identical | 200, unfiltered default rows | different | C ignores `filter` and answers as if it were absent. |
| `/api/models` | `sort` | 200, five keys accepted, order and shape vary | 200, identical | 200, default order | different | Accepted names are `downloads`, `likes`, `createdAt`, `lastModified`, `trendingScore`. C ignores all five. |
| `/api/models` | `sort`, unknown value | 400, `* Invalid sort parameter: ...` | 400, identical | 200, rows | different | `trending` is not a name Hugging Face accepts; C accepts it and anything else. |
| `/api/models` | `direction` | 400, descending only for `downloads` | 400, identical | 200, rows | different | C accepts a request Hugging Face rejects. |
| `/api/models` | `full=true` | 200, 16-key rows with `siblings` | 200, identical | 200, 7-key rows | different | C ignores `full`. |
| `/api/models` | `config=true` | 200, rows gain `config` | 200, identical | 200, no `config` | different | C ignores `config`. |
| `/api/models` | `expand[]` | 200, rows reduced to the named fields | 200, identical | 200, fixed 7-key row | different | Tested with `downloadsAllTime` alone and with `safetensors`, `gguf`, `lastModified` and `trendingScore` together. C ignores both forms. |
| `/api/models` | cursor, `Link: rel="next"` | 200, `Link` present, next page follows | 200, `Link` rewritten to B, next page follows | 200, no `Link`, cursor ignored | different | A client paging through C sees page one for ever and never learns there is more. |
| `/api/models/{repo}` | none | 200, 24 keys | 200, 15 keys, stale counters | 200, 15 keys, stale counters | different | B and C lose `lastModified`, `config`, `cardData`, `transformersInfo`, `safetensors`, `widgetData`, `model-index`, `spaces` and `usedStorage`; `downloads`, `likes`, `createdAt`, `_id` and `tags` differ. B matches A byte for byte for a repository the index does not hold. |
| `/api/models/{repo}/revision/{rev}` | `main`, full SHA | 200, same body as the plain route | 200, 15-key body | 200, 15-key body | different | Routing and SHA matching are correct; the body carries the gaps of the plain route. |
| `/api/models/{repo}/tree/{rev}` | none | 200, 17 entries, directories first, `xetHash` on LFS | 200, 17 entries, name order, no `xetHash` | 200, identical to B | different | File `oid`, `size`, `type` and `lfs` all match A; the directory `oid` is synthesised and does not. |
| `/api/models/{repo}/tree/{rev}` | `expand=true` | 200, adds `lastCommit` and `securityFileStatus` | 200, four keys only | 200, four keys only | different | The parameter is accepted and ignored. |
| `/api/models/{repo}/paths-info/{rev}` | `expand=True` | 200, adds `lastCommit` and `securityFileStatus` | 200, four keys only | 200, four keys only | different | `huggingface_hub` sends this on every `paths-info` call. |
| `/api/models/{repo}/refs` | none | 200, `tags`, `branches`, `converts` | 200, plus an empty `pullRequests` | 200, identical to B | different | One extra key; the branch name and `targetCommit` match. |
| `/api/models/{repo}` | missing repository | 401, no `x-error-code`, "Invalid username or password." | 401, identical | 401, `RepoNotFound`, "Repository not found" | different | Status matches. C adds an error code where anonymous Hugging Face sends none, and the body text differs. |
| `/api/models/{repo}/revision/{rev}` | missing revision | 404, `RevisionNotFound`, rev id echoed | 404, identical | 404, `RevisionNotFound`, "Revision not found" | different | Status and code match; only the message differs. Same on the `tree` route. |
| `/{repo}/resolve/{rev}/{path}` | missing file | 404, `EntryNotFound`, `x-repo-commit` set | 404, `EntryNotFound`, no `x-repo-commit` | 404, identical to B | different | The refusal drops `x-repo-commit` and answers `application/json` where A answers `text/plain`. |
| `/api/models/{repo}` and `/tree` | gated repository | 200 for metadata and tree, anonymous | 200, identical apart from stripped `xetHash` | 401 `RepoNotFound` | different | A gated repository is readable anonymously; C reports it as not found because the index does not hold it. |
| `/{repo}/resolve/{rev}/{path}` | gated repository | 401, `GatedRepo`, long message | 401, `GatedRepo`, "Access to this repository is gated" | 401, `RepoNotFound` | different | B classifies the gate; C misreports it as a missing repository. |
| `/api/models/{repo}` | `blobs=true` | 200, siblings gain `blobId`, `size`, `lfs` | 200, same fields and values | 200, same fields and values | identical | `blobId`, `size`, `lfs.sha256` and `lfs.pointerSize` all equal A's for `model.safetensors`. |
| `/api/models/{repo}/tree/{rev}` | `recursive=true` | 200, 27 entries | 200, 27 entries, same paths | 200, identical to B | identical | The parameter is honoured; the ordering and directory-`oid` differences of the base route still apply. |
| `/api/models/{repo}/paths-info/{rev}` | `paths` | 200, 3 entries for 2 files and 1 directory | 200, same entries, types, `oid`, `size` | 200, identical to B | identical | Repeated form values and a directory path are both handled. Measured only with `expand=True`. |
| `/api/models/{repo}/paths-info/{rev}` | missing file | 200, `[]` | 200, `[]` | 200, `[]` | identical | No error for an unknown path, on any of the three. |
