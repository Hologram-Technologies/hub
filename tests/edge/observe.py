"""What a Hugging Face client sees from one endpoint, as JSON.

Run once with HF_ENDPOINT unset (huggingface.co) and once pointing at the edge;
`compare.py` requires the two observations to be equal. Run it a third time
with HF_ENDPOINT=<edge>/via/ipfs: a client follows a redirect to Hugging Face
during its HEAD and then reads Hugging Face's own headers, so only a source it
does not follow tests the edge's headers. With PINNED=1 the tiny model, which
the IPFS copy does not hold, is left out. huggingface_hub reads
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
if os.environ.get("PINNED") != "1":
    seen["lfs download"] = sha(hf.hf_hub_download(TINY, "model.safetensors"))
    seen["cache blob names"] = {REPO: blobs(REPO), TINY: blobs(TINY)}
else:
    seen["cache blob names"] = {REPO: blobs(REPO)}
    seen["pinned"] = True
seen["search"] = sorted(m.id for m in hf.list_models(search="gpt2", author="openai-community", limit=10))
seen["missing repository"] = error_of(lambda: hf.hf_hub_download("nobody-xyz-123/does-not-exist", "config.json"))
seen["missing file"] = error_of(lambda: hf.hf_hub_download(REPO, "nope.bin"))
seen["missing revision"] = error_of(lambda: hf.hf_hub_download(REPO, "config.json", revision="not-a-branch"))
seen["gated repository"] = error_of(lambda: hf.hf_hub_download("meta-llama/Llama-3.1-8B", "config.json"))
json.dump(seen, sys.stdout, indent=1, sort_keys=True)
