#!/usr/bin/env bash
# Builds web/piece-hash.wasm from crates/piece-hash, the same bytes on any
# machine: a pinned toolchain, the locked dependencies, and every source path
# rewritten to a fixed name, since the module carries the paths of its panic
# locations and they would otherwise differ from one checkout to the next
# (and publish the builder's home directory).
#
#   tools/build-piece-hash.sh            write web/piece-hash.wasm
#   tools/build-piece-hash.sh --check    fail if the committed module differs
#
# PIECE_HASH_TOOLCHAIN overrides the toolchain name (for a host whose default
# triple cannot link build scripts); the version must stay the one below.
set -euo pipefail
cd "$(dirname "$0")/.."

toolchain=${PIECE_HASH_TOOLCHAIN:-1.100.0}
case "$toolchain" in 1.100.0|1.100.0-*) ;; *) echo "the module is built with Rust 1.100.0, not $toolchain" >&2; exit 64 ;; esac

# Where cargo unpacked blake3 is where every dependency's source lives.
registry=$(cargo "+$toolchain" metadata --locked --format-version 1 | python3 -c '
import json, os, sys
d = json.load(sys.stdin)
p = next(p["manifest_path"] for p in d["packages"] if p["name"] == "blake3")
print(os.path.dirname(os.path.dirname(p)))')

export CARGO_TARGET_DIR="$PWD/target/piece-hash"
RUSTFLAGS="-C target-feature=+simd128 --remap-path-prefix=$registry=/registry --remap-path-prefix=$PWD=/hub" \
  cargo "+$toolchain" build --locked --release -p piece-hash --target wasm32-unknown-unknown

built="$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/piece_hash.wasm"
if LC_ALL=C grep -a -q -F -e "$registry" -e "$PWD" "$built"; then
  echo "the module still carries a local path" >&2
  exit 1
fi
if [[ ${1:-} == --check ]]; then
  if ! cmp -s "$built" web/piece-hash.wasm; then
    echo "web/piece-hash.wasm is not what crates/piece-hash builds; run tools/build-piece-hash.sh" >&2
    exit 1
  fi
  echo "web/piece-hash.wasm is what crates/piece-hash builds"
else
  cp "$built" web/piece-hash.wasm
  echo "wrote web/piece-hash.wasm ($(wc -c < web/piece-hash.wasm) bytes)"
fi
