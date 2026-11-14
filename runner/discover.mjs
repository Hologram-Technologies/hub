// What the swarm has, and which of it this hub could actually serve.
//
//   node runner/discover.mjs <query>
//
// Pulling a model is only half of it. Pirate Face indexes far more than this
// hub does - a catalog in the hundreds of thousands against this hub's
// hundreds - so the question "what can I get from the swarm" cannot be
// answered from the hub's own index alone.
//
// Two different facts come back, and they are kept apart on purpose:
//
//   seeders    what Pirate Face reports. Reported, not measured: this asks a
//              tracker for peers to measure it, and says which it is.
//   addressed  whether this hub holds an address for the file, which is what
//              decides whether the bytes can be checked after they arrive.
//              Without one, `HK-19` refuses the swarm and the runner will not
//              serve the file however many peers have it.
//
// A row with peers and no address is a model you can download and cannot
// check. This prints that as what it is rather than as a result.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { lookup, fetchTorrent } from "./pirateface.mjs";
import { announce, peerId } from "./swarm.mjs";

const HOST = "https://pirateface.co";

// Pirate Face's plain-text search: one line per model, name, size, seeder
// count and magnet. Measured 2026-11-14; it is the simplest interface either
// project offers and needs no key.
export async function search(query, { host = HOST, timeoutMs = 25000 } = {}) {
  const response = await fetch(`${host}/s/${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${host}/s/${query} answered ${response.status}`);
  const rows = [];
  for (const line of (await response.text()).split("\n")) {
    // Trimmed, because a carriage return would stop the magnet ending the line.
    const m = line.trimEnd().match(/^(\S+)\s+(.+?)\s{2,}(\d+)\s+seeds?\s+(magnet:\S+)$/);
    if (m) rows.push({ repo: m[1], size: m[2].trim(), seeders: Number(m[3]), magnet: m[4] });
  }
  return rows;
}

// What the swarm holds for one repository, checked rather than relayed: the
// torrent must hash to the infohash the magnet named, and the revision is
// reported so a caller can see whether it is the one their index knows.
export async function holdings(repo, { host = HOST, revision = null, withTorrent = true } = {}) {
  const found = await lookup(repo, { host });
  if (!found) return null;
  const out = {
    repo: found.repo,
    revision: found.revision,
    matchesIndex: revision ? found.revision === revision : null,
    seeders: found.seeders,
    leechers: found.leechers,
    infohash: found.infohash,
    addresses: found.addresses.size,
    trackers: found.trackers,
    files: null,
    checked: false,
  };
  if (!withTorrent) return out;
  const torrent = await fetchTorrent(found, { host });
  out.files = torrent.files.length;
  out.bytes = torrent.totalLength;
  out.pieces = torrent.pieceCount;
  // The infohash was recomputed from the metadata's own bytes to get here.
  out.checked = true;
  return out;
}

// Whether anyone is actually there, as opposed to reported to be.
export async function peers(repo, { host = HOST, timeoutMs = 15000 } = {}) {
  const found = await lookup(repo, { host });
  if (!found) return null;
  const torrent = await fetchTorrent(found, { host });
  const http = found.trackers.filter((t) => /^https?:\/\//.test(t));
  if (!http.length) return { reported: found.seeders, measured: null, why: "no HTTP tracker" };
  let measured = 0;
  for (const tracker of http) {
    try {
      measured += (await announce({ tracker, infohashBytes: torrent.infohashBytes, id: peerId(), left: torrent.totalLength, timeoutMs })).length;
    } catch { /* a tracker that will not answer is not a peer count of zero */ }
  }
  return { reported: found.seeders, measured };
}

// Run directly rather than imported. Resolved paths are compared, not URL
// strings, because a Windows path spells the two differently.
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const query = process.argv.slice(2).join(" ");
  if (!query) {
    console.error("usage: node runner/discover.mjs <query>");
    process.exit(64);
  }
  const rows = await search(query);
  if (!rows.length) {
    console.log(`no model matching "${query}" has a torrent listed`);
    process.exit(0);
  }
  console.log(`${rows.length} models with a torrent, by seeders reported:`);
  for (const row of rows.slice(0, 20)) {
    console.log(`  ${row.repo.padEnd(56)} ${row.size.padStart(8)}  ${String(row.seeders).padStart(4)} seeds`);
  }
  console.log("\nseeders are Pirate Face's own count; `peers()` asks a tracker.");
  console.log("A model is only servable here for files this hub holds an address for (HK-19).");
}
