"""Fake Hugging Face Hub (port 1) + fake third-party blob host (port 2, optional TLS port 3).

Stdlib only. Imported by the experiment drivers; every request is appended to LOG.
File behaviour is chosen by FILES[filename]["mode"].
"""
import hashlib
import json
import ssl
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

COMMIT = "a" * 40
REPO = "acme/tiny"
LOG = []  # (server, method, path, {selected headers})
LOCK = threading.Lock()
STATE = {"hub_port": 0, "blob_port": 0, "tls_port": 0, "drop_done": set()}

TRUE = bytes(range(256)) * 256  # 65536 bytes, the "true" content of every big file
SHA = hashlib.sha256(TRUE).hexdigest()
FLIP = bytearray(TRUE)
FLIP[1000] ^= 0xFF
FLIP = bytes(FLIP)
SMALL = b'{"hello": "world"}\n'


def git_sha1(b):
    return hashlib.sha1(b"blob %d\0" % len(b) + b).hexdigest()


# mode -> how the Hub answers /resolve; served -> what the blob host returns
FILES = {
    "model.bin": dict(mode="redirect", served=TRUE),            # case A
    "flip.bin": dict(mode="redirect", served=FLIP),             # case B
    "trunc.bin": dict(mode="redirect", served=TRUE[:60000]),    # case C1 honest Content-Length, short
    "long.bin": dict(mode="redirect", served=TRUE + b"EXTRA"),  # case C2 honest Content-Length, long
    "drop.bin": dict(mode="redirect", served=TRUE, drop=True),  # connection cut mid-body -> Range resume
    "dropflip.bin": dict(mode="redirect", served=FLIP, drop=True),
    "nosize.bin": dict(mode="redirect", served=TRUE[:60000], no_size=True),  # no X-Linked-Size
    "nocommit.bin": dict(mode="redirect", served=TRUE, no_commit=True),
    "noetag.bin": dict(mode="redirect", served=TRUE, no_etag=True),
    "https.bin": dict(mode="redirect", served=FLIP, tls=True),
    "small.json": dict(mode="direct", served=SMALL),            # 200 + ETag, no X-Linked-*
    "smallbad.json": dict(mode="direct", served=b'{"hello": "w0rld"}\n', etag_of=SMALL),
    "rel.bin": dict(mode="relative", served=FLIP),              # 307 -> /api/resolve-cache/...
    "xet.bin": dict(mode="redirect", served=TRUE, xet=True),    # advertises X-Xet-Hash
}
SNAPSHOT_FILES = ["small.json", "model.bin", "flip.bin"]


def _log(server, h):
    keep = {k.lower(): v for k, v in h.headers.items() if k.lower() in ("authorization", "range", "host", "user-agent")}
    if "user-agent" in keep:
        keep["user-agent"] = keep["user-agent"][:40]
    with LOCK:
        LOG.append((server, h.command, h.path, keep))


class Hub(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, headers=None, body=b""):
        self.send_response(code)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        if "Content-Length" not in (headers or {}):
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code=200, headers=None):
        h = {"Content-Type": "application/json"}
        h.update(headers or {})
        self._send(code, h, json.dumps(obj).encode())

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        _log("hub", self)
        path = unquote(urlsplit(self.path).path)
        if path.startswith(f"/api/models/{REPO}/revision/"):
            return self._json({
                "_id": "0" * 24, "id": REPO, "modelId": REPO, "sha": COMMIT, "private": False,
                "gated": False, "disabled": False, "tags": [], "downloads": 0, "likes": 0,
                "siblings": [{"rfilename": f} for f in SNAPSHOT_FILES],
            })
        if path.startswith(f"/api/models/{REPO}/tree/"):
            out = []
            for f in SNAPSHOT_FILES:
                spec = FILES[f]
                if spec["mode"] == "direct":
                    out.append({"type": "file", "oid": git_sha1(spec["served"]), "size": len(spec["served"]), "path": f})
                else:
                    out.append({"type": "file", "oid": "b" * 40, "size": len(TRUE), "path": f,
                                "lfs": {"oid": SHA, "size": len(TRUE), "pointerSize": 134}})
            return self._json(out)
        if path.startswith(f"/api/models/{REPO}/xet-read-token/"):
            cas = f"http://127.0.0.1:{STATE['hub_port']}/fakecas"
            return self._json({"accessToken": "fake-xet-token", "exp": 4102444800, "casUrl": cas}, headers={
                "X-Xet-Cas-Url": cas, "X-Xet-Access-Token": "fake-xet-token", "X-Xet-Token-Expiration": "4102444800"})
        if path.startswith("/fakecas/"):
            return self._json({"error": "fake CAS: not implemented"}, code=404)
        if path.startswith(f"/api/resolve-cache/models/{REPO}/{COMMIT}/"):
            f = path.rsplit("/", 1)[1]
            body = FILES[f]["served"]
            return self._send(200, {"ETag": f'"{git_sha1(TRUE)}"', "X-Repo-Commit": COMMIT,
                                    "Content-Type": "application/octet-stream"}, body)
        prefix = f"/{REPO}/resolve/"
        if path.startswith(prefix):
            f = path[len(prefix):].split("/", 1)[1]
            spec = FILES.get(f)
            if spec is None:
                return self._json({"error": "Entry not found"}, code=404,
                                  headers={"X-Error-Code": "EntryNotFound", "X-Repo-Commit": COMMIT})
            if spec["mode"] == "direct":
                etag = git_sha1(spec.get("etag_of", spec["served"]))
                return self._send(200, {"ETag": f'"{etag}"', "X-Repo-Commit": COMMIT,
                                        "Content-Type": "application/json"}, spec["served"])
            if spec["mode"] == "relative":
                return self._send(307, {"Location": f"/api/resolve-cache/models/{REPO}/{COMMIT}/{f}",
                                        "X-Repo-Commit": COMMIT})
            h = {}
            if not spec.get("no_commit"):
                h["X-Repo-Commit"] = COMMIT
            if not spec.get("no_etag"):
                h["X-Linked-Etag"] = f'"{SHA}"'
                h["ETag"] = f'"{SHA}"'
            if not spec.get("no_size"):
                h["X-Linked-Size"] = str(len(TRUE))
            if spec.get("xet"):
                h["X-Xet-Hash"] = "c" * 64
                h["X-Xet-Refresh-Route"] = f"http://127.0.0.1:{STATE['hub_port']}/api/models/{REPO}/xet-read-token/{COMMIT}"
            if spec.get("tls"):
                h["Location"] = f"https://127.0.0.1:{STATE['tls_port']}/blob/{f}"
            else:
                h["Location"] = f"http://127.0.0.1:{STATE['blob_port']}/blob/{f}"
            return self._send(302, h)
        self._json({"error": "not found"}, code=404)

    do_POST = do_GET


class Blob(BaseHTTPRequestHandler):
    """The untrusted third-party host."""
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        _log("blob", self)
        f = self.path.rsplit("/", 1)[1]
        spec = FILES[f]
        body = spec["served"]
        rng = self.headers.get("Range")
        if rng:
            start = int(rng.split("=")[1].split("-")[0])
            part = body[start:]
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{len(body) - 1}/{len(body)}")
            self.send_header("Content-Length", str(len(part)))
            self.end_headers()
            self.wfile.write(part)
            return
        if spec.get("drop") and f not in STATE["drop_done"]:
            STATE["drop_done"].add(f)
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body[:30000])
            self.wfile.flush()
            self.close_connection = True
            self.connection.close()
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("ETag", '"cdn-etag-ignored"')
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


def start(tls_cert=None, tls_key=None):
    hub = ThreadingHTTPServer(("127.0.0.1", 0), Hub)
    blob = ThreadingHTTPServer(("127.0.0.1", 0), Blob)
    STATE["hub_port"] = hub.server_address[1]
    STATE["blob_port"] = blob.server_address[1]
    servers = [hub, blob]
    if tls_cert:
        tls = ThreadingHTTPServer(("127.0.0.1", 0), Blob)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(tls_cert, tls_key)
        tls.socket = ctx.wrap_socket(tls.socket, server_side=True)
        STATE["tls_port"] = tls.server_address[1]
        servers.append(tls)
    for s in servers:
        threading.Thread(target=s.serve_forever, daemon=True).start()
    return STATE


def take_log():
    with LOCK:
        out = list(LOG)
        LOG.clear()
    return out
