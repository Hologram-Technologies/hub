"""What a Hugging Face client sees from one endpoint, as JSON.

Run once with HF_ENDPOINT unset (huggingface.co) and once pointing at the edge;
`compare.py` requires the two observations to be equal. Run it a third time
with HF_ENDPOINT=<edge>/via/ipfs: a client follows a redirect to Hugging Face
during its HEAD and then reads Hugging Face's own headers, so only a source it
does not follow tests the edge's headers. With PINNED=1 the tiny model, which
the IPFS copy does not hold, is left out. With OFFLINE=1 (an edge that answers
from its signed index alone, Hugging Face drained) the checks that need a
model outside the index are left out too: the tiny model, the gated model and
the search. huggingface_hub reads
HF_ENDPOINT at import, so each endpoint is its own process. Uses no token.

    python tests/edge/observe.py <cache dir> > observation.json
"""
import hashlib
import json
import os
import sys

cache = sys.argv[1]
os.environ["HF_HOME"] = cache
os.environ.pop("HF_TOKEN", None)

import huggingface_hub as hf  # noqa: E402
from huggingface_hub import errors  # noqa: E402

REPO = "openai-community/gpt2"
COMMIT = "607a30d783dfa663caf39e06633721c8d4cfcd7e"
TINY = "hf-internal-testing/tiny-random-gpt2"


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def blobs(repo):
    folder = os.path.join(cache, "hub", "models--" + repo.replace("/", "--"), "blobs")
    return sorted(os.listdir(folder)) if os.path.isdir(folder) else []


def error_of(call):
    try:
        call()
        return "no error"
    except errors.HfHubHTTPError as e:
        return type(e).__name__
    except Exception as e:  # the class is what a tool branches on
        return type(e).__name__


def answer_of(call):
    # The status and error code a refusal arrived with. huggingface_hub names a
    # 401 with no X-Error-Code RepositoryNotFoundError only for an https://
    # endpoint (REPO_API_REGEX in utils/_http.py), so against a local edge the
    # class says how it was reached, not what it was told; the answer does not.
    try:
        call()
        return "no error"
    except errors.HfHubHTTPError as e:
        return [e.response.status_code, e.response.headers.get("x-error-code")]


seen = {}
seen["small file"] = sha(hf.hf_hub_download(REPO, "config.json"))
meta = hf.get_hf_file_metadata(hf.hf_hub_url(REPO, "model.safetensors"))
seen["large file metadata"] = [meta.commit_hash, meta.etag, meta.size]
small = hf.get_hf_file_metadata(hf.hf_hub_url(REPO, "config.json"))
seen["small file metadata"] = [small.commit_hash, small.etag, small.size]
seen["pinned commit prefix"] = sha(hf.hf_hub_download(REPO, "config.json", revision=COMMIT[:7]))
seen["model sha"] = hf.model_info(REPO).sha
seen["files"] = sorted(hf.list_repo_files(REPO))
snap = hf.snapshot_download(REPO, allow_patterns=["*.json"])
seen["snapshot"] = sorted((os.path.relpath(os.path.join(d, f), snap).replace(os.sep, "/"), sha(os.path.join(d, f)))
                          for d, _, fs in os.walk(snap) for f in fs)
LIMITED = os.environ.get("PINNED") == "1" or os.environ.get("OFFLINE") == "1"
if not LIMITED:
    seen["lfs download"] = sha(hf.hf_hub_download(TINY, "model.safetensors"))
    seen["cache blob names"] = {REPO: blobs(REPO), TINY: blobs(TINY)}
else:
    seen["cache blob names"] = {REPO: blobs(REPO)}
    seen["pinned"] = True
if os.environ.get("OFFLINE") != "1":
    seen["search"] = sorted(m.id for m in hf.list_models(search="gpt2", author="openai-community", limit=10))
seen["missing repository"] = error_of(lambda: hf.hf_hub_download("nobody-xyz-123/does-not-exist", "config.json"))
seen["missing file"] = error_of(lambda: hf.hf_hub_download(REPO, "nope.bin"))
seen["missing revision"] = error_of(lambda: hf.hf_hub_download(REPO, "config.json", revision="not-a-branch"))
if os.environ.get("OFFLINE") != "1":
    seen["gated repository"] = error_of(lambda: hf.hf_hub_download("meta-llama/Llama-3.1-8B", "config.json"))
else:
    seen["offline"] = True

# Datasets and Spaces, read the way `datasets` and `gradio_client` read them
# (HK-31), and the refusals a client with no token gets (HK-32). Skipped when
# the edge answers from its index alone, or every file is pinned to a second
# source: the index and the second sources hold models.
DATASET = "stanfordnlp/imdb"
SPACE = "gradio/hello_world"
if os.environ.get("OFFLINE") != "1" and os.environ.get("PINNED") != "1":
    seen["dataset sha"] = hf.dataset_info(DATASET, revision="main").sha
    seen["dataset files"] = sorted(hf.list_repo_files(DATASET, repo_type="dataset"))
    seen["dataset readme"] = sha(hf.hf_hub_download(DATASET, "README.md", repo_type="dataset"))
    seen["dataset parquet file"] = sha(hf.hf_hub_download(
        DATASET, "plain_text/test-00000-of-00001.parquet", repo_type="dataset"))
    seen["dataset tree"] = sorted(e.path for e in hf.list_repo_tree(DATASET, "plain_text", repo_type="dataset"))
    seen["dataset paths info"] = sorted(e.path for e in hf.get_paths_info(DATASET, ["README.md"], repo_type="dataset"))
    seen["dataset refs"] = sorted(b.name for b in hf.list_repo_refs(DATASET, repo_type="dataset").branches)
    seen["dataset search"] = sorted(d.id for d in hf.list_datasets(author="stanfordnlp", search="imdb", limit=5))
    seen["missing dataset"] = answer_of(lambda: hf.dataset_info("nobody-xyz-123/no-such-dataset"))
    seen["missing dataset file"] = error_of(lambda: hf.hf_hub_download(DATASET, "nope.txt", repo_type="dataset"))
    seen["space sha"] = hf.space_info(SPACE).sha
    seen["space files"] = sorted(hf.list_repo_files(SPACE, repo_type="space"))
    seen["space app"] = sha(hf.hf_hub_download(SPACE, "app.py", repo_type="space"))
    seen["space search"] = sorted(s.id for s in hf.list_spaces(author="gradio", search="hello_world", limit=5))
    seen["model by its old name"] = [hf.model_info("gpt2").id, sha(hf.hf_hub_download("gpt2", "config.json"))]
    seen["dataset by its old name"] = sha(hf.hf_hub_download("imdb", "README.md", repo_type="dataset"))
    seen["whoami"] = error_of(lambda: hf.whoami())
    seen["anonymous write"] = error_of(lambda: hf.create_repo("nobody-xyz-123/should-not-exist"))
json.dump(seen, sys.stdout, indent=1, sort_keys=True)
