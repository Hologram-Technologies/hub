// Nothing is published that the root does not name. The roll's value rests on
// a reader being able to check a shard before believing a row of it, so this
// does what a reader does, before the bytes leave the runner.
//
//   node check.mjs <roll dir>
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node check.mjs <roll dir>");
  process.exit(64);
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const root = JSON.parse(await readFile(join(dir, "root.json"), "utf8"));

if (root.format !== "hologram.hub.roll/v1") throw new Error(`unexpected format ${root.format}`);
if (!Array.isArray(root.shards) || root.shards.length === 0) throw new Error("the root names no shards");

let rows = 0;
const named = new Set();
for (const shard of root.shards) {
  const bytes = await readFile(join(dir, shard.path));
  if (sha256(bytes) !== shard.sha256) throw new Error(`${shard.path} does not match the root`);
  const lines = bytes.toString("utf8").split("\n").filter(Boolean);
  if (lines.length !== shard.rows) throw new Error(`${shard.path} holds ${lines.length} rows, the root says ${shard.rows}`);
  rows += lines.length;
  named.add(shard.path);
}

// A file the root does not name would be served and believed by nobody, but it
// would still be published, and a reader counting bytes would be owed an
// explanation. So there is to be nothing here the root does not account for.
const onDisk = await readdir(join(dir, "shards"));
for (const name of onDisk) {
  if (!named.has(`shards/${name}`)) throw new Error(`shards/${name} is on disk and not in the root`);
}

const counted = root.counts.listed + root.counts.gone + root.counts.withheld;
if (counted !== rows) throw new Error(`the root counts ${counted} and the shards hold ${rows}`);

console.log(`check: ${rows} rows across ${root.shards.length} shards, every one named by the root`);
console.log(`       ${root.counts.listed} listed, ${root.counts.gone} gone, ${root.counts.withheld} withheld`);
console.log(`       window ${root.window.from} to ${root.window.to}`);
