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
// Either address will do and neither will not: a large file has Hugging
// Face's SHA-256, a small one its git blob identity, and a file with no
// address at all is the one thing a snapshot must never carry, because the
// runner would have nothing to check its bytes against.
const digests = out.flatMap((r) => r.files);
// A size of zero is a size. An empty file - `.gitkeep`, `.nojekyll`, an empty
// `__init__.py` - is addressable like any other, and git gives it the one
// blob hash every empty file has, so what is required is a size that is a
// whole number of bytes rather than one above zero.
const EMPTY_BLOB = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
const bad = digests.filter((f) => !Number.isInteger(f.size) || f.size < 0
  || !(/^[0-9a-f]{64}$/.test(f.sha256 ?? "") || /^[0-9a-f]{40}$/.test(f.gitSha1 ?? "")));
check("every file carries an address and a size", bad.length === 0, `${bad.length} do not`);
// The size and the address have to agree, which is what the old check was
// reaching for. An empty file whose address is not git's empty blob is a
// record of something other than the file it names.
const empty = digests.filter((f) => f.size === 0);
const mismatched = empty.filter((f) => f.gitSha1 !== EMPTY_BLOB);
check("an empty file carries the address an empty file has", mismatched.length === 0,
  `${mismatched.length} of ${empty.length} do not`);
const large = digests.filter((f) => f.sha256).length;
console.log(`     ${out.length} releases, ${digests.length} addressed files (${large} by SHA-256, ${digests.length - large} by git blob)`);

// Planted defect: one byte of one shard. The snapshot still parses, still
// describes the same releases, and must be refused.
if (root.shards?.length) {
  const work = join(dir, "..", "swarm-tampered");
  await rm(work, { recursive: true, force: true });
  await cp(dir, work, { recursive: true });
  const path = join(work, root.shards[0].path);
  const bytes = await readFile(path);
  let at = bytes.indexOf(Buffer.from('"sha256":"'));
  at = at >= 0 ? at + 10 : bytes.indexOf(Buffer.from('"gitSha1":"')) + 11;
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
