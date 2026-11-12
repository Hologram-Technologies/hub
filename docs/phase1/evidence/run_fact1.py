"""FACT 1 driver: runs hf_hub_download / snapshot_download against fakehub.py and prints what happened.

Usage: venv\\Scripts\\python.exe run_fact1.py [tls_cert tls_key]
HF_HOME is forced inside this folder. The token used is a dummy string, sent only to 127.0.0.1.
"""
import hashlib
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fakehub  # noqa: E402

cert = sys.argv[1] if len(sys.argv) > 2 else None
key = sys.argv[2] if len(sys.argv) > 2 else None
st = fakehub.start(cert, key)

HF_HOME = HERE / "hf_home"
shutil.rmtree(HF_HOME, ignore_errors=True)
os.environ["HF_HOME"] = str(HF_HOME)
os.environ["HF_ENDPOINT"] = f"http://127.0.0.1:{st['hub_port']}"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ.pop("HF_TOKEN", None)
if cert:
    os.environ["SSL_CERT_FILE"] = cert

import huggingface_hub  # noqa: E402
from huggingface_hub import hf_hub_download, snapshot_download  # noqa: E402
from huggingface_hub.utils._runtime import is_xet_available  # noqa: E402

FAKE_TOKEN = "hf_FAKE_not_a_real_token"
print("huggingface_hub", huggingface_hub.__version__, "| xet available:", is_xet_available())
print("endpoint", os.environ["HF_ENDPOINT"], "| blob host port", st["blob_port"], "| tls port", st["tls_port"])
print("true sha256", fakehub.SHA, "size", len(fakehub.TRUE))


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def tree():
    root = HF_HOME / "hub"
    out = []
    for p in sorted(root.rglob("*")):
        if p.is_file() or p.is_symlink():
            rel = p.relative_to(root).as_posix()
            if rel.startswith(".locks") or rel.endswith("CACHEDIR.TAG"):
                continue
            out.append(f"{rel} ({'link' if p.is_symlink() else 'file'}, {p.stat().st_size}B)")
    return out


def show_log():
    for server, method, path, h in fakehub.take_log():
        auth = "auth=YES" if "authorization" in h else "auth=no"
        rng = f" range={h['range']}" if "range" in h else ""
        print(f"    [{server}] {method} {path} {auth}{rng}")


def case(name, filename, **kw):
    print(f"\n=== {name}: {filename}")
    before = set(tree())
    try:
        p = hf_hub_download("acme/tiny", filename, token=FAKE_TOKEN, **kw)
        s = sha(p)
        verdict = "MATCHES true sha256" if s == fakehub.SHA else "DIFFERS from true sha256"
        print(f"  RESULT: success -> {Path(p).relative_to(HF_HOME).as_posix()}")
        print(f"  size={os.path.getsize(p)} sha256={s[:16]}... {verdict}")
    except BaseException as e:  # noqa: BLE001
        cause = f" <- {type(e.__cause__).__name__}: {str(e.__cause__)[:160]}" if e.__cause__ else ""
        print(f"  RESULT: {type(e).__module__}.{type(e).__name__}: {str(e)[:260]}{cause}")
    show_log()
    new = [t for t in tree() if t not in before]
    print("  new cache entries:", new if new else "none")


case("A correct bytes", "model.bin")
case("B one byte flipped, same length", "flip.bin")
case("C1 truncated (honest Content-Length 60000, X-Linked-Size 65536)", "trunc.bin")
case("C2 longer (+5 bytes)", "long.bin")
case("C3 truncated AND Hub sends no X-Linked-Size", "nosize.bin")
case("D connection cut mid-body, correct bytes (Range resume?)", "drop.bin")
case("D2 connection cut mid-body, flipped byte", "dropflip.bin")
case("E HEAD lacks X-Repo-Commit", "nocommit.bin")
case("F HEAD lacks ETag and X-Linked-Etag", "noetag.bin")
case("G small file: 200 + ETag, no X-Linked-*", "small.json")
case("G2 small file: body differs from ETag (git sha1 of other content)", "smallbad.json")
case("H 307 to relative /api/resolve-cache, body corrupted", "rel.bin")
if cert:
    case("I redirect to https://127.0.0.1 (self-signed cert trusted via SSL_CERT_FILE), flipped", "https.bin")
case("J same blob requested again (cache hit, corrupted flip.bin)", "flip.bin")

print("\n=== snapshot_download acme/tiny (small.json, model.bin, flip.bin; tree API advertises lfs.oid = true sha256)")
shutil.rmtree(HF_HOME, ignore_errors=True)
try:
    d = snapshot_download("acme/tiny", token=FAKE_TOKEN)
    print("  RESULT: success ->", Path(d).relative_to(HF_HOME).as_posix())
    for f in sorted(Path(d).iterdir()):
        s = sha(f)
        print(f"   {f.name}: size={f.stat().st_size} sha256={s[:16]}... "
              f"{'ok' if s == fakehub.SHA or f.suffix == '.json' else 'CORRUPTED, accepted'}")
except BaseException as e:  # noqa: BLE001
    print(f"  RESULT: {type(e).__name__}: {str(e)[:300]}")
show_log()
print("  cache:", tree())

print("\n=== opt-in verification: HfApi().verify_repo_checksums / `hf cache verify`")
try:
    from huggingface_hub import HfApi
    r = HfApi().verify_repo_checksums("acme/tiny", token=FAKE_TOKEN)
    print("  ", r)
except BaseException as e:  # noqa: BLE001
    print(f"  {type(e).__name__}: {str(e)[:300]}")
show_log()
