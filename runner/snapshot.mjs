// Reading the address snapshot `tools/swarm-index.mjs` writes.
//
// This is what the snapshot is for. While Hugging Face answers, the runner
// asks it what a file should hash to and the swarm for the bytes, and the two
// are different parties. When Hugging Face stops answering, that question has
// no live answer and `HK-19` refuses the swarm - correctly, because the only
// digest left would be the one belonging to whoever is serving the bytes.
//
// A snapshot taken while Hugging Face was still answering is the same
// independent address, written down earlier. It does not make the hub trust
// Pirate Face; it keeps Hugging Face's answer available after Hugging Face is
// not.
//
// A shard counts only if its bytes are the ones the root names, the same rule
// the browse shards are read by.
import { createHash } from "node:crypto";
import { verifyBundle } from "../web/sigstore.mjs";

// The snapshot root is the trust anchor: the shards are checked against it,
// so a host that could swap the root could swap everything. It is signed by
// the workflow that writes it, keylessly, and checked here against the same
// pinned Sigstore roots and workflow identity the kernel's trust policy
// names for the index. The predicate type is the one constant not yet in
// that policy; moving it there is a model change and is recorded as owed.
const PREDICATE = "https://hologram.foundation/hub/swarm/v1";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function open(base, { timeoutMs = 20000, policy = null, required = true } = {}) {
  const response = await fetch(new URL("root.json", base), { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`swarm snapshot root ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (policy) {
    const signature = await fetch(new URL("swarm.sigstore.json", base), { signal: AbortSignal.timeout(timeoutMs) });
    if (!signature.ok) {
      if (required) throw new Error(`the snapshot is not signed (${signature.status})`);
    } else {
      const facts = await verifyBundle(await signature.json(), bytes, { ...policy, predicateType: PREDICATE });
      const failed = ["chain", "time", "log", "signature", "identity", "subject", "predicate"].filter((k) => !facts[k]);
      if (failed.length) throw new Error(`the snapshot's signature failed: ${failed.join(", ")}`);
    }
  }
  const root = JSON.parse(new TextDecoder().decode(bytes));
  if (root.format !== "hologram.hub.swarm/v1") throw new Error(`unknown snapshot format ${root.format}`);
  return { base, root, shards: new Map((root.shards ?? []).map((s) => [s.path.slice(-7, -5), s])), loaded: new Map() };
}

const shardOf = (repo) => sha256(repo).slice(0, 2);

// The addressed release for one repository, or null. Returns the same shape
// `edge.release` does for a public repository at a resolved revision, so the
// caller can use it without knowing where it came from.
export async function release(snapshot, repo) {
  if (!snapshot) return null;
  const name = shardOf(repo);
  const shard = snapshot.shards.get(name);
  if (!shard) return null;
  if (!snapshot.loaded.has(name)) {
    snapshot.loaded.set(name, (async () => {
      const bytes = new Uint8Array(await (await fetch(new URL(shard.path, snapshot.base))).arrayBuffer());
      if (sha256(bytes) !== shard.sha256) throw new Error(`snapshot shard ${shard.path} does not match the root`);
      const rows = JSON.parse(new TextDecoder().decode(bytes));
      return new Map(rows.map((r) => [r.repo.toLowerCase(), r]));
    })());
  }
  const rows = await snapshot.loaded.get(name);
  const row = rows.get(repo.toLowerCase());
  if (!row) return null;
  return {
    state: 0,
    revision: true,
    sha: row.revision,
    fromSnapshot: true,
    siblings: new Map(row.files.map((f) => [f.path, {
      rfilename: f.path,
      size: f.size,
      // A file Hugging Face gave a SHA-256 for is an LFS file and takes the
      // SHA-256 ETag; one it gave only a git blob identity for is small and
      // takes the git blob ETag. That is `HK-08`, and reading a snapshot must
      // not move it.
      ...(f.sha256
        ? { lfs: { sha256: f.sha256, size: f.size, pointerSize: 134 } }
        : { blobId: f.gitSha1 }),
    }])),
  };
}

export const count = (snapshot) => (snapshot ? snapshot.root.models ?? 0 : 0);
