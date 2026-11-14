// The address snapshot is read only from shards whose bytes are the ones its
// root names, and a snapshot is worth nothing if it quietly carries an address
// from the party that will be serving the bytes. This checks both against a
// real snapshot, then plants a defect in a copy and fails unless it is caught.
//
//   node tests/index/swarm-shards.mjs <snapshot dir>
import { createHash } from "node:crypto";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [dir] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node tests/index/swarm-shards.mjs <snapshot dir>");
  process.exit(64);
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const failures = [];
const check = (name, ok, saw) => (ok ? console.log(`ok   ${name}`) : failures.push(`${name}: ${saw}`));

// What `runner/snapshot.mjs` does: read the root, then accept a shard only
// when its bytes hash to what the root says.
async function rows(base) {
  const root = JSON.parse(await readFile(join(base, "root.json"), "utf8"));
  const out = [];
  for (const shard of root.shards ?? []) {
    const bytes = await readFile(join(base, shard.path));
    if (sha256(bytes) !== shard.sha256) throw new Error(`${shard.path} does not match the root`);
    out.push(...JSON.parse(bytes.toString("utf8")));
  }
  return { root, out };
}

const { root, out } = await rows(dir);
check("every shard is the bytes the root names", true, "");
check("the root counts what the shards hold", root.models === out.length, `${root.models} named, ${out.length} found`);
check("the snapshot says whose addresses these are",
  root.addresses === "https://huggingface.co",
  `addresses: ${root.addresses}`);

// The claim this artifact exists to support: every address came from
// somewhere other than the swarm that will serve the bytes. A row with no
// address is useless and a row addressed by the swarm would be worse than
// useless, so neither is allowed.
const shapes = out.filter((r) => !r.repo || !r.revision || !Array.isArray(r.files) || !r.files.length);
check("every release names a revision and at least one addressed file", shapes.length === 0, `${shapes.length} do not`);
const digests = out.flatMap((r) => r.files);
const bad = digests.filter((f) => !/^[0-9a-f]{64}$/.test(f.sha256 ?? "") || !(f.size > 0));
check("every file carries a SHA-256 and a size", bad.length === 0, `${bad.length} do not`);
console.log(`     ${out.length} releases, ${digests.length} addressed files`);

// Planted defect: one byte of one shard. The snapshot still parses, still
// describes the same releases, and must be refused.
if (root.shards?.length) {
  const work = join(dir, "..", "swarm-tampered");
  await rm(work, { recursive: true, force: true });
  await cp(dir, work, { recursive: true });
  const path = join(work, root.shards[0].path);
  const bytes = await readFile(path);
  const at = bytes.indexOf(Buffer.from('"sha256":"')) + 10;
  bytes[at] = bytes[at] === 0x61 ? 0x62 : 0x61;
  await writeFile(path, bytes);
  let refused = false;
  try {
    await rows(work);
  } catch {
    refused = true;
  }
  await rm(work, { recursive: true, force: true });
  check("a shard with one byte changed is refused", refused, "it was read anyway");
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log("swarm-shards: the snapshot is what its root says it is");
