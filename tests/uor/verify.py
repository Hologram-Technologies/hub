"""The standalone verifier, against files whose rows the real minter wrote.

    python3 tests/uor/verify.py <uor-label binary>

A safetensors file and a GGUF file are written here, minted by `uor-label`
(which calls uor-addr), and filed in a one-shard index by the rule
`web/uorkey.mjs` uses. `web/uor-verify.py` must then accept both, and refuse
each planted change naming what changed: one byte of a tensor, one byte of a
metadata value the tensors do not cover, and one byte of the shard itself.
"""
import hashlib
import json
import os
import struct
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
VERIFY = os.path.join(HERE, "..", "..", "web", "uor-verify.py")
REPO = "testing/verify"
checks = 0


def ok(what):
    global checks
    checks += 1
    print(f"  ok  {what}")


def safetensors_file():
    a = struct.pack("<4f", 1.0, 2.0, 3.0, 4.0)
    b = struct.pack("<2H", 0x3F80, 0x4000)
    header = {
        "__metadata__": {"format": "pt"},
        "b.weight": {"dtype": "BF16", "shape": [2], "data_offsets": [0, 4]},
        "a.weight": {"dtype": "F32", "shape": [2, 2], "data_offsets": [4, 20]},
    }
    text = json.dumps(header).encode()
    return struct.pack("<Q", len(text)) + text + b + a


def gguf_file():
    def string(s):
        return struct.pack("<Q", len(s)) + s
    kv = string(b"general.name") + struct.pack("<I", 8) + string(b"verify")
    data = struct.pack("<4f", 5.0, 6.0, 7.0, 8.0)
    info = string(b"w") + struct.pack("<I", 1) + struct.pack("<Q", 4) + struct.pack("<I", 0) + struct.pack("<Q", 0)
    head = struct.pack("<IIQQ", 0x46554747, 3, 1, 1) + kv + info
    pad = (-len(head)) % 32
    return head + b"\0" * pad + data


def mint(label_bin, path, name, size):
    out = json.loads(subprocess.run([label_bin, path], check=True, capture_output=True).stdout)
    assert out["bytes"] == size
    return {
        "repo": REPO, "revision": "a" * 40, "path": name, "size": size,
        "label": out["label"],
        "canonicalForm": out["canonicalForm"], "realization": out["realization"],
        "resolve": "https://example.invalid/", "dataStart": out["dataStart"],
        "sha256": None, "tensors": out["tensors"],
    }


def write_index(directory, rows):
    shard_bits = 4
    lead = int(hashlib.sha256(REPO.lower().encode()).hexdigest()[:4], 16)
    path = f"shards/{lead >> (16 - shard_bits):03x}.json"
    shard = json.dumps(rows).encode()
    os.makedirs(os.path.join(directory, "shards"), exist_ok=True)
    with open(os.path.join(directory, *path.split("/")), "wb") as f:
        f.write(shard)
    root = {"format": "hologram.hub.uor/v3", "addresser": {"crate": "uor-addr", "version": "0.4.0"},
            "shardBits": shard_bits, "shards": [{"path": path, "rows": len(rows), "sha256": hashlib.sha256(shard).hexdigest()}]}
    with open(os.path.join(directory, "root.json"), "w") as f:
        json.dump(root, f)
    return os.path.join(directory, *path.split("/"))


def verify(index, files):
    run = subprocess.run([sys.executable, "-I", VERIFY, REPO, files, "--index", index], capture_output=True, text=True)
    return run.returncode, run.stdout + run.stderr


def flip(path, at):
    with open(path, "r+b") as f:
        f.seek(at)
        byte = f.read(1)[0]
        f.seek(at)
        f.write(bytes([byte ^ 1]))


def main(label_bin):
    with tempfile.TemporaryDirectory() as work:
        files = os.path.join(work, "files")
        index = os.path.join(work, "index")
        os.makedirs(os.path.join(files, "sub"))
        st, gg = safetensors_file(), gguf_file()
        st_path, gg_path = os.path.join(files, "model.safetensors"), os.path.join(files, "sub", "model.gguf")
        for path, body in ((st_path, st), (gg_path, gg)):
            with open(path, "wb") as f:
                f.write(body)
        rows = [mint(label_bin, st_path, "model.safetensors", len(st)), mint(label_bin, gg_path, "sub/model.gguf", len(gg))]
        assert {r["realization"] for r in rows} == {"safetensors", "gguf"}
        shard = write_index(index, rows)

        code, said = verify(index, files)
        assert code == 0, said
        assert "2 of 2 files match" in said, said
        ok("both realizations' files match the addresses the minter wrote")

        # One byte inside tensor a.weight.
        a = next(t for t in rows[0]["tensors"] if t["name"] == "a.weight")
        flip(st_path, a["begin"] + 3)
        code, said = verify(index, files)
        assert code == 1, said
        assert "tensor a.weight: expected" in said and "tensor b.weight" not in said, said
        assert "label: expected" in said, said
        ok("a flipped tensor byte is refused, naming that tensor and only that tensor")
        flip(st_path, a["begin"] + 3)

        # One byte of a metadata value, which no tensor covers: only the label
        # catches it.
        at = st.index(b'"pt"') + 2
        flip(st_path, at)
        code, said = verify(index, files)
        assert code == 1, said
        assert "label: expected" in said and "tensor " not in said, said
        ok("a changed metadata value is refused by the label, with every tensor still matching")
        flip(st_path, at)

        # One byte of the GGUF file's tensor.
        w = rows[1]["tensors"][0]
        flip(gg_path, w["begin"])
        code, said = verify(index, files)
        assert code == 1 and "tensor w: expected" in said, said
        ok("a flipped GGUF tensor byte is refused, naming the tensor")
        flip(gg_path, w["begin"])

        # The shard is not the bytes the root names.
        with open(shard, "ab") as f:
            f.write(b" ")
        code, said = verify(index, files)
        assert code == 2 and "not the bytes the signed root names" in said, said
        ok("a shard that is not the bytes the root names is refused before anything is compared")

    print(f"tests/uor/verify: {checks} checks passed")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        sys.exit(64)
    main(sys.argv[1])
