# Independent verifier: recomputes sha256, git-blob sha1 and per-tensor blake3
# without any hub code, and compares to a manifest and the HF tree.
import sys, json, hashlib, struct, blake3, urllib.request
path, manifest_path, repo, rev, fname = sys.argv[1:6]
data = open(path, 'rb').read()
out = {"file": fname, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(),
       "gitSha1": hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()}
m = json.load(open(manifest_path))
mf = next((f for f in m["files"] if f["path"] == fname), None)
tree = json.load(urllib.request.urlopen(f"https://huggingface.co/api/models/{repo}/tree/{rev}"))
hf = next((t for t in tree if t["path"] == fname), None)
out["hf_sha256"] = (hf.get("lfs") or {}).get("oid"); out["hf_oid"] = hf["oid"]
out["manifest_sha256"] = mf and mf.get("sha256")
out["sha256_matches_hf"] = out["sha256"] == out["hf_sha256"] if out["hf_sha256"] else None
out["gitSha1_matches_hf"] = out["gitSha1"] == out["hf_oid"] if not out["hf_sha256"] else None
out["sha256_matches_manifest"] = out["sha256"] == out["manifest_sha256"] if out["manifest_sha256"] else None
if fname.endswith(".safetensors"):
    n = struct.unpack("<Q", data[:8])[0]; hdr = json.loads(data[8:8+n]); base = 8 + n
    want = {t["name"]: t["blake3"] for t in m["tensors"] if t["file"] == fname}
    ok = bad = unaddr = 0; bads = []
    for name, t in hdr.items():
        if name == "__metadata__": continue
        a, b = t["data_offsets"]; addr = "blake3:" + blake3.blake3(data[base+a:base+b]).hexdigest()
        if name not in want: unaddr += 1
        elif want[name] == addr: ok += 1
        else: bad += 1; bads.append(name)
    out["tensors"] = {"declared": len([k for k in hdr if k != "__metadata__"]), "matched": ok, "mismatched": bad, "unaddressed": unaddr, "bad": bads[:5]}
print(json.dumps(out, indent=1))
