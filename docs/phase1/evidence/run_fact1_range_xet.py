"""FACT 1 (Range resume on a >10 MB file) and FACT 2 (which headers trigger the Xet path).

Usage: venv\\Scripts\\python.exe run_fact1_range_xet.py range|xet|xet_disabled
"""
import hashlib
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fakehub  # noqa: E402

mode = sys.argv[1]
st = fakehub.start()
HF_HOME = HERE / f"hf_home_{mode}"
shutil.rmtree(HF_HOME, ignore_errors=True)
os.environ["HF_HOME"] = str(HF_HOME)
os.environ["HF_ENDPOINT"] = f"http://127.0.0.1:{st['hub_port']}"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ.pop("HF_TOKEN", None)
if mode == "xet_disabled":
    os.environ["HF_HUB_DISABLE_XET"] = "1"

if mode == "range":
    # 12 MiB file; the blob host cuts the connection after 11 MiB, then answers the Range request with
    # 206 whose bytes are GARBAGE (0xEE). X-Linked-Etag/X-Linked-Size still describe the true content.
    big = os.urandom(1024) * (12 * 1024)
    fakehub.TRUE = big
    fakehub.SHA = hashlib.sha256(big).hexdigest()
    tail_garbage = big[: 11 * 1024 * 1024] + b"\xee" * (1024 * 1024)

    class Blob(fakehub.Blob):
        def do_GET(self):
            fakehub._log("blob", self)
            rng = self.headers.get("Range")
            if rng:
                start = int(rng.split("=")[1].split("-")[0])
                part = tail_garbage[start:]
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{len(big) - 1}/{len(big)}")
                self.send_header("Content-Length", str(len(part)))
                self.end_headers()
                self.wfile.write(part)
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(big)))
            self.end_headers()
            self.wfile.write(big[: 11 * 1024 * 1024])
            self.wfile.flush()
            self.connection.close()

    import threading
    from http.server import ThreadingHTTPServer
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Blob)
    fakehub.STATE["blob_port"] = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()

import huggingface_hub  # noqa: E402
from huggingface_hub import hf_hub_download  # noqa: E402
from huggingface_hub.utils._runtime import is_xet_available  # noqa: E402

print("mode", mode, "| huggingface_hub", huggingface_hub.__version__, "| xet available:", is_xet_available())
filename = "model.bin" if mode == "range" else "xet.bin"
try:
    p = hf_hub_download("acme/tiny", filename, token="hf_FAKE_not_a_real_token")
    s = hashlib.sha256(Path(p).read_bytes()).hexdigest()
    print("RESULT: success size", os.path.getsize(p), "sha256", "MATCHES" if s == fakehub.SHA else "DIFFERS")
except BaseException as e:  # noqa: BLE001
    print(f"RESULT: {type(e).__module__}.{type(e).__name__}: {str(e)[:600]}")
for server, method, path, h in fakehub.take_log():
    print(f"  [{server}] {method} {path} auth={h.get('authorization', 'no')[:24]} range={h.get('range')} ua={h.get('user-agent')}")
