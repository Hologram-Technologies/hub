#!/usr/bin/env bash
# Publish the Spaces at one exact commit of this repository, on the gethologram.ai VPS.
#
#   deploy/spaces/deploy.sh <commit or ref>        run on the VPS, from /root/hub-spaces
#
# tools/spaces.mjs assembles every Space the catalog names and refuses to finish unless each is the artifact its root
# names (HK-27), so a site that fails the check is never swapped in: the server keeps answering from the previous one.
# Nothing here touches Caddy; routing is deploy/caddy/gethologram.ai.caddy.
set -euo pipefail
REF=${1:?usage: deploy.sh <commit or ref>}
DIR=${SPACES_DIR:-/root/hub-spaces}
REPO=https://github.com/Hologram-Technologies/hub.git

cd "$DIR"
[ -d src/.git ] || git clone -q --depth 1 "$REPO" src
git -C src fetch -q --depth 1 origin "$REF"
git -C src checkout -q FETCH_HEAD
rev=$(git -C src rev-parse --short=12 HEAD)

mkdir -p releases
rm -rf "releases/$rev.new"
node src/tools/spaces.mjs "releases/$rev.new"
echo "$rev" > "releases/$rev.new/REVISION"
rm -rf "releases/$rev"
mv "releases/$rev.new" "releases/$rev"

# The swap is one rename of a symlink, so a reader sees the old release or the new one, never half of each.
previous=$(readlink releases/current 2>/dev/null || true)
ln -sfn "$rev" releases/current.next
mv -T releases/current.next releases/current
docker compose up -d >/dev/null
# Keep the release this one replaced, for a rollback by symlink; drop anything older.
for old in releases/*/; do
  name=$(basename "$old")
  # `current` is the live symlink, which the glob also matches; it is never a release to drop.
  [ "$name" = current ] || [ "$name" = "$rev" ] || [ "$name" = "$previous" ] || rm -rf "releases/$name"
done
echo "spaces at $rev (was ${previous:-none})"
