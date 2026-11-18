#!/usr/bin/env python3
"""uor-verify.py: check downloaded model files against their UOR addresses.

Why: a Hugging Face client does not check the bytes it downloads, and the hub
only redirects, so it never sees them. A content address is only worth
something if the reader recomputes it. This does, with nothing but the Python
standard library, so the check depends on no code from this hub except the
index it compares against.

How: for each file of REPO that the hub's UOR index addresses and that is
present under DIR, it

  1. recomputes the file's canonical label from the bytes, under uor-addr's
     canonical form for its format, and compares it with the index's
     `label`, which binds every tensor and every metadata value;
  2. recomputes every tensor's address, the BLAKE3 of that tensor's own byte
     range, and compares it with the index's `address`, naming each tensor
     that differs.

The index is fetched from the hub (or read from --index), and each shard is
refused unless it hashes to the digest the signed root names. The root itself
is signed by the hub's workflow; its SHA-256 is printed so it can be checked
with `gh attestation verify`.

Usage:
    python3 uor-verify.py REPO DIR [--hub https://gethologram.ai] [--index DIR] [--fast]

BLAKE3 is not in the standard library, so by default it is computed by the
pure-Python port of BLAKE3's reference implementation below: correct, and
about a minute per 50 MB. `--fast` uses the official `blake3` package instead
(`pip install blake3`), which is thousands of times faster but is code from a
package index; the run says which one it used.

DIR is where the files were downloaded, with the repository's own paths
beneath it: a `huggingface_hub` snapshot directory or a `local_dir`.

Exit status: 0 every addressed file present matched; 1 a file did not match;
2 the index could not be read, or nothing could be checked.

The two canonical forms below are uor-addr's executable specifications,
`tools/canonical-safetensors.py` and `tools/canonical-gguf.py` at tag v0.4.0
(Apache-2.0, https://github.com/UOR-Foundation/uor-addr), with the file read
through a memory map instead of into memory. The BLAKE3 port is uor-addr's
`tools/blake3_ref.py` at the same tag, after BLAKE3's `reference_impl.py`
(CC0 / Apache-2.0, https://github.com/BLAKE3-team/BLAKE3). Nothing in them is
this hub's.
"""
import hashlib
import json
import math
import mmap
import os
import struct
import sys
import urllib.request

HUB = "https://gethologram.ai"


# ----------------------------------------------------------------- BLAKE3

OUT_LEN = 32
BLOCK_LEN = 64
CHUNK_LEN = 1024
CHUNK_START = 1 << 0
CHUNK_END = 1 << 1
PARENT = 1 << 2
ROOT = 1 << 3
IV = (0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
      0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19)
MSG_PERMUTATION = (2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8)
M32 = 0xFFFFFFFF


def _g(s, a, b, c, d, mx, my):
    s[a] = (s[a] + s[b] + mx) & M32
    x = s[d] ^ s[a]
    s[d] = ((x >> 16) | (x << 16)) & M32
    s[c] = (s[c] + s[d]) & M32
    x = s[b] ^ s[c]
    s[b] = ((x >> 12) | (x << 20)) & M32
    s[a] = (s[a] + s[b] + my) & M32
    x = s[d] ^ s[a]
    s[d] = ((x >> 8) | (x << 24)) & M32
    s[c] = (s[c] + s[d]) & M32
    x = s[b] ^ s[c]
    s[b] = ((x >> 7) | (x << 25)) & M32


def _compress(cv, m, counter, block_len, flags):
    s = [cv[0], cv[1], cv[2], cv[3], cv[4], cv[5], cv[6], cv[7],
         IV[0], IV[1], IV[2], IV[3],
         counter & M32, (counter >> 32) & M32, block_len, flags]
    m = list(m)
    for r in range(7):
        _g(s, 0, 4, 8, 12, m[0], m[1])
        _g(s, 1, 5, 9, 13, m[2], m[3])
        _g(s, 2, 6, 10, 14, m[4], m[5])
        _g(s, 3, 7, 11, 15, m[6], m[7])
        _g(s, 0, 5, 10, 15, m[8], m[9])
        _g(s, 1, 6, 11, 12, m[10], m[11])
        _g(s, 2, 7, 8, 13, m[12], m[13])
        _g(s, 3, 4, 9, 14, m[14], m[15])
        if r < 6:
            m = [m[i] for i in MSG_PERMUTATION]
    for i in range(8):
        s[i] ^= s[i + 8]
        s[i + 8] ^= cv[i]
    return s


def _words(block):
    return struct.unpack("<16I", bytes(block).ljust(BLOCK_LEN, b"\0"))


class _Output:
    def __init__(self, cv, block_words, counter, block_len, flags):
        self.cv, self.m, self.counter, self.block_len, self.flags = cv, block_words, counter, block_len, flags

    def chaining_value(self):
        return _compress(self.cv, self.m, self.counter, self.block_len, self.flags)[:8]

    def root_bytes(self):
        words = _compress(self.cv, self.m, 0, self.block_len, self.flags | ROOT)
        return struct.pack("<16I", *words)[:OUT_LEN]


class _Chunk:
    def __init__(self, counter):
        self.cv = IV
        self.counter = counter
        self.block = bytearray()
        self.blocks_compressed = 0

    def length(self):
        return BLOCK_LEN * self.blocks_compressed + len(self.block)

    def _start(self):
        return CHUNK_START if self.blocks_compressed == 0 else 0

    def update(self, data):
        at = 0
        while at < len(data):
            if len(self.block) == BLOCK_LEN:
                self.cv = _compress(self.cv, _words(self.block), self.counter, BLOCK_LEN, self._start())[:8]
                self.blocks_compressed += 1
                self.block = bytearray()
            take = min(BLOCK_LEN - len(self.block), len(data) - at)
            self.block += data[at:at + take]
            at += take

    def output(self):
        return _Output(self.cv, _words(self.block), self.counter, len(self.block), self._start() | CHUNK_END)


def _parent(left, right):
    return _Output(IV, tuple(left) + tuple(right), 0, BLOCK_LEN, PARENT)


class Blake3Reference:
    """hashlib-style BLAKE3 in pure Python."""

    name = "blake3"
    digest_size = OUT_LEN

    def __init__(self, data=b""):
        self._chunk = _Chunk(0)
        self._stack = []
        if data:
            self.update(data)

    def update(self, data):
        data = memoryview(bytes(data))
        at = 0
        while at < len(data):
            if self._chunk.length() == CHUNK_LEN:
                cv = self._chunk.output().chaining_value()
                total = self._chunk.counter + 1
                while total & 1 == 0:
                    cv = _parent(self._stack.pop(), cv).chaining_value()
                    total >>= 1
                self._stack.append(cv)
                self._chunk = _Chunk(self._chunk.counter + 1)
            take = min(CHUNK_LEN - self._chunk.length(), len(data) - at)
            self._chunk.update(data[at:at + take])
            at += take
        return self

    def digest(self):
        out = self._chunk.output()
        for cv in reversed(self._stack):
            out = _parent(cv, out.chaining_value())
        return out.root_bytes()

    def hexdigest(self):
        return self.digest().hex()


# The official package, when `--fast` asked for it; the port above otherwise.
_FAST = None


def blake3(b):
    if _FAST is not None:
        return _FAST.blake3(b).digest()
    return Blake3Reference(b).digest()


# ------------------------------------------------ safetensors, canonical form 2

ST_TAG = b"SAFE"
ST_VERSION = 2
ST_MAX_HEADER = 100_000_000
ST_DTYPES = {
    "BOOL": (0, 8), "U8": (1, 8), "I8": (2, 8), "I16": (3, 16), "U16": (4, 16),
    "F16": (5, 16), "BF16": (6, 16), "I32": (7, 32), "U32": (8, 32),
    "F32": (9, 32), "F64": (10, 64), "I64": (11, 64), "U64": (12, 64),
    "F8_E5M2": (13, 8), "F8_E4M3": (14, 8), "F8_E8M0": (15, 8),
    "F8_E4M3FNUZ": (16, 8), "F8_E5M2FNUZ": (17, 8), "C64": (18, 64),
    "F4": (19, 4), "F6_E2M3": (20, 6), "F6_E3M2": (21, 6),
}


def _no_duplicates(pairs):
    keys = [k for k, _ in pairs]
    if len(keys) != len(set(keys)):
        raise ValueError("duplicate key")
    return dict(pairs)


def _is_uint(v):
    return isinstance(v, int) and not isinstance(v, bool) and 0 <= v < 2**64


def safetensors_skeleton(raw):
    if len(raw) < 8:
        raise ValueError("truncated")
    n = struct.unpack_from("<Q", raw, 0)[0]
    if n > ST_MAX_HEADER:
        raise ValueError("header too large")
    if 8 + n > len(raw):
        raise ValueError("truncated")
    text = raw[8:8 + n].decode("utf-8")
    header = json.loads(text, object_pairs_hook=_no_duplicates,
                        parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)),
                        parse_float=lambda f: (_ for _ in ()).throw(ValueError(f)))
    if not isinstance(header, dict):
        raise ValueError("header is not an object")
    base = 8 + n
    size = len(raw) - base

    meta = header.pop("__metadata__", {})
    if not isinstance(meta, dict) or not all(isinstance(v, str) for v in meta.values()):
        raise ValueError("bad __metadata__")

    tensors = []
    for name, info in header.items():
        if not isinstance(info, dict) or set(info) != {"dtype", "shape", "data_offsets"}:
            raise ValueError(f"bad tensor info {name}")
        if info["dtype"] not in ST_DTYPES:
            raise ValueError(f"unknown dtype {info['dtype']}")
        shape, offs = info["shape"], info["data_offsets"]
        if not isinstance(shape, list) or not all(_is_uint(d) for d in shape):
            raise ValueError("bad shape")
        if not isinstance(offs, list) or len(offs) != 2 or not all(_is_uint(o) for o in offs):
            raise ValueError("bad data_offsets")
        dtype_id, bits = ST_DTYPES[info["dtype"]]
        if bits * math.prod(d for d in shape if d) >= 2**64:
            raise ValueError("size overflow")
        nbits = bits * math.prod(shape)
        if nbits % 8:
            raise ValueError("misaligned slice")
        if offs[1] < offs[0] or offs[1] - offs[0] != nbits // 8:
            raise ValueError("tensor size does not match dtype and shape")
        tensors.append((name.encode("utf-8"), dtype_id, shape, offs[0], offs[1]))

    at = 0
    for t in sorted(tensors, key=lambda t: (t[3], t[4])):
        if t[3] != at:
            raise ValueError("invalid offset")
        at = t[4]
    if at != size:
        raise ValueError("buffer not fully covered")

    out = bytearray(ST_TAG + struct.pack("<I", ST_VERSION))
    out += struct.pack("<QQ", len(tensors), len(meta))
    for key in sorted(meta, key=lambda k: k.encode("utf-8")):
        value = meta[key].encode("utf-8")
        out += blake3(key.encode("utf-8")) + struct.pack("<Q", len(value)) + blake3(value)
    offset = 0
    for name, dtype_id, shape, s, e in sorted(tensors, key=lambda t: t[0]):
        out += blake3(name) + struct.pack("<II", dtype_id, len(shape))
        out += b"".join(struct.pack("<Q", d) for d in shape)
        out += struct.pack("<Q", offset) + blake3(raw[base + s:base + e])
        offset += e - s
    return bytes(out)


# ------------------------------------------------------- GGUF, canonical form 3

GGUF_MAGIC = 0x46554747
GGUF_VERSION = 3
GGUF_DEFAULT_ALIGNMENT = 32
T_STRING, T_ARRAY, T_UINT32 = 8, 9, 4
SCALAR_WIDTH = {0: 1, 1: 1, 7: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 10: 8, 11: 8, 12: 8}
GGML = {
    0: (4, 1), 1: (2, 1), 2: (18, 32), 3: (20, 32), 6: (22, 32), 7: (24, 32),
    8: (34, 32), 9: (36, 32), 10: (84, 256), 11: (110, 256), 12: (144, 256),
    13: (176, 256), 14: (210, 256), 15: (292, 256), 16: (66, 256), 17: (74, 256),
    18: (98, 256), 19: (50, 256), 20: (18, 32), 21: (110, 256), 22: (82, 256),
    23: (136, 256), 24: (1, 1), 25: (2, 1), 26: (4, 1), 27: (8, 1), 28: (8, 1),
    29: (56, 256), 30: (2, 1),
}


def _align_up(o, a):
    r = o % a
    return o if r == 0 else o + (a - r)


class _Cur:
    def __init__(self, buf):
        self.b, self.p = buf, 0

    def take(self, n):
        if self.p + n > len(self.b):
            raise ValueError("truncated")
        s = self.b[self.p:self.p + n]
        self.p += n
        return s

    def u32(self):
        return struct.unpack_from("<I", self.take(4))[0]

    def u64(self):
        return struct.unpack_from("<Q", self.take(8))[0]


def _measure_value(c, type_tag):
    start = c.p
    if type_tag in SCALAR_WIDTH:
        c.take(SCALAR_WIDTH[type_tag])
    elif type_tag == T_STRING:
        c.take(c.u64())
    elif type_tag == T_ARRAY:
        elem = c.u32()
        n = c.u64()
        for _ in range(n):
            _measure_value(c, elem)
    else:
        raise ValueError(f"unknown type tag {type_tag}")
    return c.p - start


def _canonical_value(raw, off, span, type_tag):
    payload = raw[off:off + span]
    if type_tag in SCALAR_WIDTH:
        return payload
    if type_tag == T_STRING:
        ln = struct.unpack_from("<Q", payload, 0)[0]
        return struct.pack("<Q", ln) + blake3(payload[8:])
    if type_tag == T_ARRAY:
        elem = struct.unpack_from("<I", payload, 0)[0]
        ln = struct.unpack_from("<Q", payload, 4)[0]
        return struct.pack("<I", elem) + struct.pack("<Q", ln) + blake3(payload[12:])
    raise ValueError("unknown type tag")


def gguf_skeleton(raw):
    c = _Cur(raw)
    if c.u32() != GGUF_MAGIC:
        raise ValueError("bad magic")
    if c.u32() != GGUF_VERSION:
        raise ValueError("unsupported version")
    tensor_count = c.u64()
    kv_count = c.u64()
    kvs = []
    alignment = GGUF_DEFAULT_ALIGNMENT
    for _ in range(kv_count):
        key = c.take(c.u64())
        type_tag = c.u32()
        val_off = c.p
        span = _measure_value(c, type_tag)
        if key == b"general.alignment" and type_tag == T_UINT32:
            alignment = struct.unpack_from("<I", raw, val_off)[0]
        kvs.append((key, type_tag, val_off, span))
    tensors = []
    for _ in range(tensor_count):
        name = c.take(c.u64())
        dims = [c.u64() for _ in range(c.u32())]
        type_id = c.u32()
        offset = c.u64()
        nelem = math.prod(dims)
        bb, be = GGML[type_id]
        if nelem % be != 0:
            raise ValueError("bad tensor element count")
        tensors.append((name, dims, type_id, offset, (nelem // be) * bb))
    data_start = _align_up(c.p, alignment)
    out = bytearray(struct.pack("<IIQQQ", GGUF_MAGIC, GGUF_VERSION, tensor_count, kv_count, alignment))
    for key, type_tag, val_off, span in sorted(kvs, key=lambda e: e[0]):
        out += blake3(key) + struct.pack("<I", type_tag) + _canonical_value(raw, val_off, span, type_tag)
    canonical_offset = 0
    for name, dims, type_id, offset, data_bytes in sorted(tensors, key=lambda t: t[0]):
        out += blake3(name) + struct.pack("<I", len(dims))
        out += b"".join(struct.pack("<Q", d) for d in dims)
        out += struct.pack("<IQ", type_id, canonical_offset)
        start = data_start + offset
        out += blake3(raw[start:start + data_bytes])
        canonical_offset = _align_up(canonical_offset + data_bytes, alignment)
    return bytes(out)


SKELETONS = {"safetensors": safetensors_skeleton, "gguf": gguf_skeleton}


# ------------------------------------------------------------------ the index

def _read(index, hub, relative):
    if index:
        with open(os.path.join(index, *relative.split("/")), "rb") as f:
            return f.read()
    request = urllib.request.Request(f"{hub}/data/uor/{relative}", headers={"user-agent": "uor-verify"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def shard_path(repo, shard_bits):
    # The rule `web/uorkey.mjs` files rows by: the leading bits of the SHA-256
    # of the lowercased repository name.
    lead = int(hashlib.sha256(repo.lower().encode("utf-8")).hexdigest()[:4], 16)
    return f"shards/{lead >> (16 - shard_bits):03x}.json"


def rows_for(repo, index, hub):
    root_bytes = _read(index, hub, "root.json")
    root = json.loads(root_bytes)
    path = shard_path(repo, root["shardBits"])
    named = next((s for s in root["shards"] if s["path"] == path), None)
    if named is None:
        return root, hashlib.sha256(root_bytes).hexdigest(), []
    shard = _read(index, hub, path)
    if hashlib.sha256(shard).hexdigest() != named["sha256"]:
        raise ValueError(f"{path} is not the bytes the signed root names")
    rows = [r for r in json.loads(shard) if r["repo"].lower() == repo.lower()]
    return root, hashlib.sha256(root_bytes).hexdigest(), rows


# ---------------------------------------------------------------- the check

def verify_file(row, local):
    """The reasons this file is not the one the row addresses; empty if it is."""
    problems = []
    size = os.path.getsize(local)
    if size != row["size"]:
        return [f"{size} bytes, the index says {row['size']}"]
    with open(local, "rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) if size else _Empty() as raw:
        for t in row["tensors"]:
            found = "blake3:" + blake3(raw[t["begin"]:t["begin"] + t["length"]]).hex()
            if found != t["address"]:
                problems.append(f"tensor {t['name']}: expected {t['address']}, got {found}")
        skeleton_of = SKELETONS.get(row["realization"])
        if skeleton_of is None:
            problems.append(f"no canonical form is known here for {row['realization']}")
        else:
            try:
                label = "blake3:" + blake3(skeleton_of(raw)).hex()
            except (ValueError, KeyError, UnicodeDecodeError, struct.error) as error:
                label = f"none (the file is not a {row['realization']} file uor-addr admits: {error})"
            if label != row["label"]:
                problems.append(f"label: expected {row['label']}, got {label}")
    return problems


class _Empty(bytes):
    def __enter__(self):
        return b""

    def __exit__(self, *_):
        return False


def main(argv):
    global _FAST
    args = [a for a in argv[1:]]
    if "--fast" in args:
        args.remove("--fast")
        try:
            _FAST = __import__("blake3")
        except ImportError:
            print("--fast needs the blake3 package: pip install blake3", file=sys.stderr)
            return 2
    hub, index = HUB, None
    for flag in ("--hub", "--index"):
        if flag in args:
            at = args.index(flag)
            value = args[at + 1] if at + 1 < len(args) else None
            if not value:
                print(f"{flag} needs a value", file=sys.stderr)
                return 2
            hub, index = (value.rstrip("/"), index) if flag == "--hub" else (hub, value)
            del args[at:at + 2]
    if len(args) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    repo, directory = args
    try:
        root, root_sha256, rows = rows_for(repo, index, hub)
    except (OSError, ValueError, KeyError) as error:
        print(f"uor-verify: the index could not be read: {error}", file=sys.stderr)
        return 2
    addresser = root.get("addresser", {})
    print(f"index: {addresser.get('crate')} {addresser.get('version')}, root sha256:{root_sha256}")
    if _FAST is not None:
        print(f"hash: BLAKE3 from the blake3 package {getattr(_FAST, '__version__', '')} (--fast)")
    else:
        print("hash: BLAKE3 in pure Python, standard library only (--fast is quicker)")
    if not rows:
        print(f"uor-verify: the index addresses no file of {repo}", file=sys.stderr)
        return 2
    checked = failed = 0
    for row in sorted(rows, key=lambda r: r["path"]):
        local = os.path.join(directory, *row["path"].split("/"))
        if not os.path.isfile(local):
            print(f"  skip  {row['path']}: not downloaded")
            continue
        checked += 1
        problems = verify_file(row, local)
        if problems:
            failed += 1
            print(f"  FAIL  {row['path']} (revision {row['revision'][:12]}): {len(problems)} problem(s)")
            for p in problems:
                print(f"          {p}")
        else:
            print(f"  ok    {row['path']}: {row['label']}, {len(row['tensors'])} of {len(row['tensors'])} tensors")
    if not checked:
        print(f"uor-verify: none of the {len(rows)} addressed files of {repo} is under {directory}", file=sys.stderr)
        return 2
    print(f"{checked - failed} of {checked} files match their UOR addresses")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
