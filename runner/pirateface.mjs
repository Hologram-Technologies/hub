// Where Pirate Face says the bytes are. Nothing it says is taken on trust.
//
// Measured 2026-11-14: `GET /api/torrents?repo=<author>/<model>` answers with
// the repository's revision, a seeder and leecher count, a SHA-256 for every
// file, an infohash, a magnet link, and the path of the `.torrent`. The
// catalog is far larger than the set with magnets, so a repository with no
// torrent answers without one and this module reports that plainly.
//
// Two checks turn its answer into something usable:
//
//   1. The revision must equal the revision the hub's own signed record names.
//      A torrent of some other commit is a different model, however right its
//      hashes are for that other commit.
//   2. The `.torrent` must hash to the infohash it was fetched as
//      (`readTorrent`). After that the piece hashes are a commitment the swarm
//      agreed on rather than a number this host served us.
//
// What remains untrusted after both checks is provenance. An infohash binds
// bytes to a torrent; only an address from the hub's signed index binds the
// torrent to a Hugging Face release. So the runner never serves a byte on the
// strength of a Pirate Face hash alone: the address it checks against comes
// from the index, and `HK-10` decides.
import { readMagnet, readTorrent } from "./torrent.mjs";

const HOST = "https://pirateface.co";

async function ask(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response;
}

// What Pirate Face holds for one repository, or null when it holds nothing
// with a magnet.
export async function lookup(repo, { host = HOST, timeoutMs = 20000 } = {}) {
  const response = await ask(`${host}/api/torrents?repo=${encodeURIComponent(repo)}`, timeoutMs);
  if (!response) return null;
  const body = await response.json();
  if (!body?.infohash || !body?.magnet) return null;
  const magnet = readMagnet(body.magnet);
  if (magnet.infohash !== String(body.infohash).toLowerCase()) {
    throw new Error(`${repo}: the magnet names infohash ${magnet.infohash} but the record says ${body.infohash}`);
  }
  return {
    repo: body.repoId ?? repo,
    revision: body.revision ?? null,
    infohash: magnet.infohash,
    trackers: magnet.trackers,
    seeders: body.seeders ?? 0,
    leechers: body.leechers ?? 0,
    // The second witness's addresses, by path. Used to cross-check, never on
    // its own.
    addresses: new Map((body.files ?? []).filter((f) => f.sha256).map((f) => [f.path, f.sha256])),
    torrentPath: body.torrent ?? `/api/torrents/${magnet.infohash}.torrent`,
  };
}

// The torrent itself, refused unless its info dictionary hashes to the
// infohash the magnet named.
export async function fetchTorrent(found, { host = HOST, timeoutMs = 60000 } = {}) {
  const url = found.torrentPath.startsWith("http") ? found.torrentPath : `${host}${found.torrentPath}`;
  const response = await ask(url, timeoutMs);
  if (!response) throw new Error(`${url}: the torrent is gone`);
  return readTorrent(Buffer.from(await response.arrayBuffer()), found.infohash);
}
