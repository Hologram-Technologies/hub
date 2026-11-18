# Can a tensor be pulled from gethologram.ai without trusting the source?

Audited 2026-11-17 against hub `origin/main` at `8a0daaa`, the live edge at https://gethologram.ai, kernel fingerprint `30e144e921931985`, index of 448 models. Everything below is measured in this run unless marked "code reading". Nothing here is proved; no Lean was run.

## Answer

Only on the local runner, and only partly. When the runner fetches bytes from a source, every corrupted byte was refused: flipped, truncated, extended and swapped tensors from Hugging Face, ModelScope and IPFS were all rejected, and nothing bad was written to the cache. But the runner serves its own cache without re-hashing it, so a corrupted cache entry reached the client in two of three tests. The public edge checks nothing, because it never sees the bytes. A stock `huggingface_hub` client pointed at gethologram.ai accepted tampered bytes from a redirect target without complaint. And the address every check compares against is ultimately Hugging Face's own hash, so Hugging Face is still trusted as the authority on what the right bytes are. Per-tensor UOR addresses exist for 3 models.

## Verdicts

| Capability | Verdict | Evidence |
| --- | --- | --- |
| Browse (`/api/models`, info, tree, commits, tags) | works | live probes below |
| Search (`/api/models?search=`, `/api/quicksearch`) | works | live probes below |
| Swarm search (`/api/swarm/search`) | not on the edge; local runner only | edge returns Hugging Face's 401 |
| Pull through the edge with a stock client | works | `hf_hub_download`, bytes equal Hugging Face's |
| Edge refuses bad bytes | fails by design | test 7 |
| Runner refuses bad bytes from a source | works | tests 1, 3, 4 |
| Runner refuses a corrupted cache entry | fails | test 2 |
| Per-tensor UOR address on every downloaded tensor | fails at scale | 3 of 448 indexed models; no GGUF or ONNX |
| Address independent of Hugging Face | fails | trust boundary below |

## Endpoint map (live edge)

| Request | Status | Notes |
| --- | --- | --- |
| `GET /api/models?limit=3&sort=downloads&direction=-1` | 200 | `Link` cursor rewritten to gethologram.ai; cursor body is Hugging Face's |
| `GET /api/models?search=gpt2` | 200 | same shape |
| `GET /api/models?sort=bogus` | 400 | `{"error":"✖ Invalid sort parameter: bogus"}`, Hugging Face's text |
| `GET /api/models/openai-community/gpt2` | 200 | from the signed index, `sha` 607a30d7 |
| `GET /api/models/{repo}/tree/main` | 200 | `oid`, `size`, `lfs.oid` per file |
| `GET /api/models/{repo}/commits/main` | 200 | one commit, title "The release this index holds" |
| `GET /api/quicksearch?q=qwen` | 200 | `{"models":[...]}` |
| `GET /api/models-tags-by-type` | 200 | tag catalogue |
| `HEAD /{repo}/resolve/main/config.json` | 302 | to huggingface.co at the pinned commit, ETag = git blob SHA-1 |
| `HEAD /{repo}/resolve/main/model.safetensors` | 302 | ETag = SHA-256 |
| `GET /via/ipfs/{repo}/resolve/main/config.json` | 302 | to `ipfs.filebase.io/ipfs/bafybei.../config.json`, a public gateway |
| `GET /via/modelscope.cn/...` | 302 | to `modelscope.cn/.../resolve/master/...`, a moving branch, not a commit |
| `GET /via/pirateface/...` | 404 | site HTML; the swarm is never offered by the edge (HK-04) |
| missing file / repo / revision | 404 `EntryNotFound`-style, 401 `RepoNotFound`, 404 revision | named `x-error-code` |
| `GET /api/swarm/search?q=gpt2` | 401 | not an edge route |

## Independent address check (honest bytes)

`sentence-transformers/all-MiniLM-L6-v2` at `1110a243`, downloaded with `huggingface_hub` 1.17.0 and `HF_ENDPOINT=https://gethologram.ai`, then recomputed by `hub-trustless-pull/verify.py`. That script imports no hub code and uses the PyPI `blake3` package.

| File | Bytes | Result |
| --- | --- | --- |
| `config.json` | 612 | git blob `72b987fd` equals Hugging Face; SHA-256 equals manifest |
| `model.safetensors` | 90,868,376 | SHA-256 `53aa5117...` equals Hugging Face and manifest; 104 of 104 tensors match the manifest's BLAKE3, 0 unaddressed |

The hub's vendored BLAKE3 agrees with an independent implementation on all 104 tensors.

## Tamper tests

Harness: `hub-trustless-pull/tamper.mjs` loads the real `runner/local.mjs`, the published holo, index and manifests, and wraps `fetch` so only file bytes from a source are altered. Command: `node tamper.mjs <hub checkout> <cache dir>`.

| # | Planted defect | Result | Diagnostic |
| --- | --- | --- | --- |
| 1 | One bit flipped in a tensor, from huggingface.co (pinned) | refused, 503 `NoSource`, cache empty | `sha256 0ad1c195... the record says 53aa5117...` |
| 1 | One bit flipped in `config.json`, from ipfs | refused, 503 `NoSource`, cache empty | `git blob efbfaf20..., the record says 72b987fd...` |
| 1 | Every source sends flipped bytes (unpinned) | refused, 503 `NoSource` | modelscope.cn and huggingface.co quarantined in turn |
| 2a | Bit flipped in cached `config.json` | **served tampered**, 200, `x-hub-source: cache` | none; SHA-256 of reply `1374e053...` |
| 2b | Bit flipped in a cached tensor | refused, 503 `NoSource` | `1 tensors do not match the signed manifest`; the bad entry stays and the file is unservable until the cache is cleared by hand |
| 2c | `__metadata__` `"pt"` changed to `"pu"` in cached safetensors | **served tampered**, 200, `x-hub-tensors: 104/104` | none; header reports a full match on altered bytes |
| 3 | Truncated by 1 byte / extended by 1 byte, both sources | refused, 503 `NoSource`, cache empty | size and digest differ |
| 4 | Two equal-length tensors swapped | refused, 503 `NoSource` | the file SHA-256 catches it before the tensor check runs |
| 5 | `sha256:` label read as `blake3:` | refused by `web/uorkey.mjs` | `uorAxis` reads the prefix; a 71-char non-label is rejected |
| 6 | Two witnesses name different SHA-256 | not refused | `addressOf` returns the first witness; `tools/index.mjs` counts the conflict and moves on (code reading plus a direct call) |
| 7 | Edge path, redirect target flips one bit (`edgemodel.mjs`, a local proxy that forwards to the live edge and rewrites `Location`) | **accepted** by `hf_hub_download` for both files | independent check: 103 of 104 tensors match, SHA-256 differs from Hugging Face |

There is no distinct refusal for "bytes do not match". A mismatch surfaces as 503 `NoSource`, "No source can serve this file now", the same answer as every source being offline. Kernel code 21 (quarantine) exists but never reaches the client.

Test 7 models the edge. The live edge was not altered. What it shows is that `huggingface_hub` 1.17.0 does not compare the bytes it downloads to the SHA-256 ETag the edge gives it.

## Trust boundary

Who sets the address: for the 448 indexed models, the signed index carries Hugging Face's LFS SHA-256 and git blob SHA-1, copied from Hugging Face's API (`edge.release`, `tools/index.mjs`). For any other model the runner asks Hugging Face's live API, unsigned (`edge.release`, `useHuggingFace` branch). The tensor manifests are signed by this repository's workflow, but `tools/manifest.mjs` builds them from bytes downloaded from huggingface.co and refuses unless they hash to Hugging Face's address. Every address therefore traces to Hugging Face. The system removes trust in the transport and in mirrors; it does not remove trust in Hugging Face as the authority on what the right bytes are.

Which path checks bytes: only `runner/local.mjs`, and only on a fresh fetch. The edge redirects (HK-03) and cannot check. The runner's cache is trusted as written.

UOR coverage: tensor addresses exist for `openai-community/gpt2`, `sentence-transformers/all-MiniLM-L6-v2` and `BAAI/bge-small-en-v1.5`. Three ONNX manifests carry 0 tensors. `checkTensors` reads safetensors only, so GGUF has no tensor check. Every other model is checked at file level by SHA-256 or git blob, which is still a content address, but not a UOR one.

## Open gaps, by risk

1. Edge clients are unprotected. Anyone using `HF_ENDPOINT=https://gethologram.ai` trusts whichever source they are redirected to, including a public IPFS gateway and a ModelScope branch that can move. Fix candidates: hash-checking in a client shim, or stop offering unpinned and gateway targets on the edge.
2. Cache hits are not re-hashed (`serveFile`, the `hit` path skips `check`). The code comment that every response is hashed is false for the cache. Fix: run `check` on a hit, and on failure delete the entry and fetch again.
3. A corrupted cache entry blocks the file forever and wrongly quarantines an innocent source. Same fix as 2.
4. Every address comes from Hugging Face. A real second authority would mean computing uor-addr canonical labels independently and requiring witnesses to agree before use (the HK-17 intent), not taking the first.
5. Mismatch is indistinguishable from an outage (`NoSource`). A named refusal, such as `ContentMismatch`, would let clients and monitoring tell an attack from downtime.
6. Tensor addresses cover 3 models and no GGUF.

Per AGENTS.md R3, each fix starts as a registered ID, a scenario, and the failing test above. Nothing was changed in the hub.

## Reproduce

```
node verification/hub-trustless-pull/tamper.mjs <hub checkout> <empty cache dir>
node verification/hub-trustless-pull/edgemodel.mjs <dir with verified files>   # then hf_hub_download with HF_ENDPOINT=http://127.0.0.1:8901
python -I verification/hub-trustless-pull/verify.py <file> <manifest.json> <repo> <revision> <path>
```
