#!/usr/bin/env bash
# Deploy the edge runner at one exact commit of this repository, on the gethologram.ai VPS.
#
#   deploy/edge/deploy.sh <commit or ref>        run on the VPS, from /root/hub-edge
#
# The image is built from that commit's edge/Dockerfile and tagged with the commit, so the running edge always names
# the source it came from. The new container is checked through the Caddy container before the old one is forgotten:
# health, a resolve that must redirect with Hugging Face's headers, and a tree whose oid is a git blob SHA-1. Any
# failure puts the previous image back. Nothing here touches Caddy; routing is deploy/caddy/gethologram.ai.caddy.
set -euo pipefail
REF=${1:?usage: deploy.sh <commit or ref>}
DIR=${EDGE_DIR:-/root/hub-edge}
REPO=https://github.com/Hologram-Technologies/hub.git
CADDY=${CADDY_CONTAINER:-twenty-caddy-1}
MODEL=openai-community/gpt2

cd "$DIR"
[ -d src/.git ] || git clone -q --depth 1 "$REPO" src
git -C src fetch -q --depth 1 origin "$REF"
git -C src checkout -q FETCH_HEAD
rev=$(git -C src rev-parse --short=12 HEAD)
image=hub-edge:$rev
docker build -q -f src/edge/Dockerfile -t "$image" src >/dev/null

previous=$(sed -n 's/^EDGE_IMAGE=//p' .env 2>/dev/null || true)
echo "EDGE_IMAGE=$image" > .env
docker compose up -d >/dev/null

probe() { docker exec "$CADDY" wget -q -S -O "${2:--}" "http://hub-edge:8787$1" 2>&1; }
ok=1
for _ in $(seq 1 60); do probe /health /dev/null >/dev/null && break; sleep 1; done
# Each answer is read whole before it is searched: under pipefail, `grep -q` closing the pipe early would fail the
# pipeline on a correct answer.
health=$(probe /health || true)
resolve=$(probe "/$MODEL/resolve/main/config.json" /dev/null || true)
tree=$(probe "/api/models/$MODEL/tree/main" || true)
grep -q '"kernel":true' <<<"$health" || { echo "FAIL health"; ok=0; }
grep -qi 'x-repo-commit' <<<"$resolve" || { echo "FAIL resolve headers"; ok=0; }
grep -qE '"oid":"[0-9a-f]{40}"' <<<"$tree" || { echo "FAIL tree oid"; ok=0; }

if [ "$ok" = 1 ]; then
  echo "edge at $rev (was ${previous:-none})"
  exit 0
fi
if [ -n "$previous" ]; then
  echo "EDGE_IMAGE=$previous" > .env
  docker compose up -d >/dev/null
  echo "rolled back to $previous"
fi
exit 1
