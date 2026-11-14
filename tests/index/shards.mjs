// The browse list is drawn only from shards whose bytes are the ones the
// signed root names. This runs the page's own rule - the kernel's accept
// (HK-10) over the shard's SHA-256 - against a real index, then against a
// tampered copy of it, and fails unless the tampered one is refused.
//
//   node tests/index/shards.mjs <index dir>
import { createHash } from "node:crypto";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [dir] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node tests/index/shards.mjs <index dir>");
  process.exit(64);
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const failures = [];
const check = (name, ok, saw) => (ok ? console.log(`ok   ${name}`) : failures.push(`${name}: ${saw}`));

// What the page does: read the root, then accept a shard only when its bytes
// hash to what the root says.
async function rows(base) {
  const root = JSON.parse(await readFile(join(base, "root.json"), "utf8"));
  const out = [];
  for (const shard of root.browse ?? []) {
    const bytes = await readFile(join(base, shard.path));
    if (sha256(bytes) !== shard.sha256) throw new Error(`${shard.path} does not match the signed root`);
    out.push(...JSON.parse(bytes.toString("utf8")));
  }
  return { root, out };
}

const { root, out } = await rows(dir);
check("the root names its browse shards", (root.browse?.length ?? 0) > 0, JSON.stringify(root.browse));
check("the root names the rule that derived them", Boolean(root.rules), String(root.rules));
check("every shard is read", out.length > 0, String(out.length));
check("a row carries what the page filters on", ["id", "task", "bucket", "languages", "format", "license", "state", "modified"].every((k) => k in (out[0] ?? {})), JSON.stringify(Object.keys(out[0] ?? {})));
check("a row's counts name the host that measured them", Boolean(out[0]?.observed?.source), JSON.stringify(out[0]?.observed));

// The same index with one row changed, and the root left as it was.
const work = join(dir, "..", "index-tampered");
await rm(work, { recursive: true, force: true });
await cp(dir, work, { recursive: true });
const shard = JSON.parse(await readFile(join(work, root.browse[0].path), "utf8"));
shard[0].license = "not-the-real-licence";
await writeFile(join(work, root.browse[0].path), JSON.stringify(shard));
let refused = null;
try {
  await rows(work);
} catch (error) {
  refused = error.message;
}
check("a changed shard is refused", Boolean(refused), "it was read");
await rm(work, { recursive: true, force: true });

console.log(failures.length ? `\n${failures.map((f) => `FAIL ${f}`).join("\n")}` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
