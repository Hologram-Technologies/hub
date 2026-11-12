"""FACT 2: minimal fake Xet CAS. Does hf_xet accept bytes that match NO hash it was given?

The Hub side advertises X-Xet-Hash = "c"*64 (not the real merkle hash of anything), the reconstruction names
a xorb "d"*64, and the untrusted host serves one uncompressed chunk whose bytes are chosen by the mode:
  good  -> the true content          (sha256 == X-Linked-Etag)
  flip  -> one byte flipped           (same length)
  short -> chunk header claims 65536 bytes but term/file size disagree (60000-byte chunk)
If "flip" succeeds, no file/xorb/chunk hash is recomputed on download.

Usage: venv\\Scripts\\python.exe run_fact2_fakecas.py good|flip|short [v1]
"""
import hashlib
import json
import os
import shutil
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
mode = sys.argv[1]
api = sys.argv[2] if len(sys.argv) > 2 else "v2"

COMMIT = "a" * 40
FILE_HASH = "c" * 64
XORB_HASH = "d" * 64
TRUE = bytes(range(256)) * 256
SHA = hashlib.sha256(TRUE).hexdigest()
payload = {"good": TRUE, "flip": TRUE[:1000] + bytes([TRUE[1000] ^ 0xFF]) + TRUE[1001:], "short": TRUE[:60000]}[mode]


def chunk(data):  # XorbChunkHeader: version u8, compressed_len u24le, scheme u8 (0 = none), uncompressed_len u24le
    n = len(data).to_bytes(3, "little")
    return bytes([0]) + n + bytes([0]) + n + data


XORB = chunk(payload)
LOG = []
PORTS = {}


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    role = "hub"

    def log_message(self, *a):
        pass

    def _send(self, code, headers, body=b""):
        self.send_response(code)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        LOG.append(f"[{self.role}] {self.command} {self.path} auth={self.headers.get('Authorization', 'no')[:22]} "
                   f"range={self.headers.get('Range')}")
        path = urlsplit(self.path).path
        hub = f"http://127.0.0.1:{PORTS['hub']}"
        if path.startswith("/acme/tiny/resolve/"):
            return self._send(302, {
                "X-Repo-Commit": COMMIT, "X-Linked-Etag": f'"{SHA}"', "X-Linked-Size": str(len(TRUE)),
                "X-Xet-Hash": FILE_HASH,
                "Link": f'<{hub}/api/models/acme/tiny/xet-read-token/{COMMIT}>; rel="xet-auth"',
                "Location": f"http://127.0.0.1:{PORTS['blob']}/plain-http-fallback"})
        if path.startswith("/api/models/acme/tiny/xet-read-token/"):
            body = json.dumps({"accessToken": "fake-xet-token", "exp": 4102444800, "casUrl": hub + "/cas"}).encode()
            return self._send(200, {"X-Xet-Cas-Url": hub + "/cas", "X-Xet-Access-Token": "fake-xet-token",
                                    "X-Xet-Token-Expiration": "4102444800", "Content-Type": "application/json"}, body)
        xorb_url = f"http://127.0.0.1:{PORTS['blob']}/xorb/{XORB_HASH}"
        term = {"hash": XORB_HASH, "unpacked_length": len(TRUE), "range": {"start": 0, "end": 1}}
        if path == f"/cas/v2/reconstructions/{FILE_HASH}":
            if api == "v1":
                return self._send(404, {})
            body = json.dumps({"offset_into_first_range": 0, "terms": [term], "xorbs": {XORB_HASH: [{
                "url": xorb_url,
                "ranges": [{"chunks": {"start": 0, "end": 1}, "bytes": {"start": 0, "end": len(XORB) - 1}}]}]}}).encode()
            return self._send(200, {"Content-Type": "application/json"}, body)
        if path == f"/cas/v1/reconstructions/{FILE_HASH}":
            body = json.dumps({"offset_into_first_range": 0, "terms": [term], "fetch_info": {XORB_HASH: [{
                "range": {"start": 0, "end": 1}, "url": xorb_url,
                "url_range": {"start": 0, "end": len(XORB) - 1}}]}}).encode()
            return self._send(200, {"Content-Type": "application/json"}, body)
        if path.startswith("/xorb/"):
            return self._send(206, {"Content-Range": f"bytes 0-{len(XORB) - 1}/{len(XORB)}",
                                    "Content-Type": "application/octet-stream"}, XORB)
        self._send(404, {})


class B(H):
    role = "untrusted"


for name, cls in (("hub", H), ("blob", B)):
    s = ThreadingHTTPServer(("127.0.0.1", 0), cls)
    PORTS[name] = s.server_address[1]
    threading.Thread(target=s.serve_forever, daemon=True).start()

HF_HOME = HERE / f"hf_home_cas_{mode}_{api}"
shutil.rmtree(HF_HOME, ignore_errors=True)
os.environ.update(HF_HOME=str(HF_HOME), HF_ENDPOINT=f"http://127.0.0.1:{PORTS['hub']}",
                  HF_HUB_DISABLE_TELEMETRY="1", HF_HUB_DISABLE_PROGRESS_BARS="1", HF_HUB_DISABLE_SYMLINKS_WARNING="1")
os.environ.pop("HF_TOKEN", None)

import hf_xet  # noqa: E402
import huggingface_hub  # noqa: E402
from importlib.metadata import version  # noqa: E402

print(f"mode={mode} api={api} huggingface_hub={huggingface_hub.__version__} hf_xet={version('hf_xet')}")
try:
    p = huggingface_hub.hf_hub_download("acme/tiny", "model.bin", token="hf_FAKE_not_a_real_token")
    s = hashlib.sha256(Path(p).read_bytes()).hexdigest()
    print(f"RESULT: success size={os.path.getsize(p)} sha256 {'MATCHES' if s == SHA else 'DIFFERS from'} X-Linked-Etag")
except BaseException as e:  # noqa: BLE001
    print(f"RESULT: {type(e).__module__}.{type(e).__name__}: {str(e)[:500]}")
for line in LOG:
    print("  ", line)
root = HF_HOME / "hub"
print("   cache:", [p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and ".locks" not in p.parts])
