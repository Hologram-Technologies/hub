"""Fails unless a Hugging Face client sees the same from the edge as from
huggingface.co. Usage: python tests/edge/compare.py <reference.json> <edge.json>
"""
import json
import sys

reference, edge = (json.load(open(p, encoding="utf-8")) for p in sys.argv[1:3])
# Every key the edge reports must equal the reference; a pinned run reports a
# subset (see observe.py), and the reference must hold every key it reports.
REF_ONLY_OK = set()
# Datasets, Spaces and the anonymous refusals are observed only where the edge
# can ask Hugging Face and no file is pinned to a second source (observe.py).
BEYOND_MODELS = {k for k in reference if k.startswith(("dataset ", "missing dataset", "space "))} | {"whoami", "anonymous write", "model by its old name"}
if edge.get("pinned"):
    REF_ONLY_OK |= {"lfs download"} | BEYOND_MODELS
if edge.get("offline"):
    REF_ONLY_OK |= {"lfs download", "gated repository", "search"} | BEYOND_MODELS
keys = sorted((set(edge) | (set(reference) - REF_ONLY_OK)) - {"pinned", "offline"})
failures = [k for k in keys if k not in reference or k not in edge or reference.get(k) != edge.get(k)
            and not (k == "cache blob names" and all(edge[k].get(r) == reference[k].get(r) for r in edge[k]))]
for k in keys:
    print(("FAIL " if k in failures else "ok   ") + k)
for k in failures:
    print(f"  huggingface.co: {json.dumps(reference.get(k))[:300]}")
    print(f"  edge:           {json.dumps(edge.get(k))[:300]}")
sys.exit(1 if failures else 0)
