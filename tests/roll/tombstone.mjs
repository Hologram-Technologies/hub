// A model the roll holds and the listing no longer names is marked gone, not
// dropped, and a shard the root does not name is refused rather than read.
// Those two are the whole reason the roll is worth keeping: without the first
// it is only a slower copy of Hugging Face's own listing, and without the
// second a reader has no reason to believe a row of it.
//
//   node tests/roll/tombstone.mjs
//
// It walks one hour of the Hub, which is one call, and then a second time
// after planting a model that never existed inside that hour.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const failures = [];
const check = (name, ok, saw) => (ok ? console.log(`ok   ${name}`) : failures.push(`${name}: ${saw}`));

const dir = await mkdtemp(join(tmpdir(), "roll-"));
const to = new Date(Date.now() - 5 * 60_000);
const from = new Date(to.getTime() - 60 * 60_000);
const run = () => spawnSync(process.execPath, ["tools/roll.mjs", dir, "--from", from.toISOString(), "--to", to.toISOString()], { encoding: "utf8" });

const first = run();
check("the roll builds", first.status === 0, first.stderr?.slice(0, 200));
if (first.status !== 0) { console.log(first.stdout, first.stderr); process.exit(1); }

const root = () => readFile(join(dir, "root.json"), "utf8").then(JSON.parse);
const rowsOf = async (r) => {
  const out = new Map();
  for (const shard of r.shards) {
    const bytes = await readFile(join(dir, shard.path));
    if (sha256(bytes) !== shard.sha256) throw new Error(`${shard.path} does not match the root`);
    for (const line of bytes.toString("utf8").split("\n")) if (line) { const row = JSON.parse(line); out.set(row[0], row); }
  }
  return out;
};

const r1 = await root();
const rows1 = await rowsOf(r1);
check("it holds the hour's models", rows1.size > 0, String(rows1.size));
check("every row is listed", [...rows1.values()].every((r) => r[5] === 0 || r[5] === 2), "a row was already marked gone");
check("the root says what window it covered", Boolean(r1.window?.from && r1.window?.to), JSON.stringify(r1.window));

// A model that never existed, planted in the shard its id hashes to, with a
// creation time inside the window so the next walk is entitled to judge it.
const PLANTED = "nobody/this-model-never-existed";
const inWindow = Math.floor((from.getTime() + to.getTime()) / 2000);
const bucket = parseInt(sha256(PLANTED).slice(0, 4), 16) >>> (16 - r1.shardBits);
const path = `shards/${bucket.toString(16).padStart(3, "0")}.ndjson`;
const existing = await readFile(join(dir, path), "utf8").catch(() => "");
const planted = JSON.stringify([PLANTED, "0".repeat(40), inWindow, inWindow, inWindow, 0]);
const merged = [...existing.split("\n").filter(Boolean), planted].sort().join("\n");
await writeFile(join(dir, path), merged);
// The root is updated too, because this is a test of the tombstone and not of
// the digest; the digest is tested on its own below.
const r1b = await root();
const entry = r1b.shards.find((s) => s.path === path);
if (entry) { entry.sha256 = sha256(Buffer.from(merged, "utf8")); entry.rows += 1; }
else r1b.shards.push({ path, rows: 1, sha256: sha256(Buffer.from(merged, "utf8")) });
await writeFile(join(dir, "root.json"), JSON.stringify(r1b));

const second = run();
check("the roll rebuilds over the same window", second.status === 0, second.stderr?.slice(0, 200));

const r2 = await root();
const rows2 = await rowsOf(r2);
const ghost = rows2.get(PLANTED);
check("the planted model is still there", Boolean(ghost), "it was dropped, not tombstoned");
check("and it is marked gone", ghost?.[5] === 1, `state ${ghost?.[5]}`);
check("and it kept the day it was first seen", ghost?.[3] === inWindow, String(ghost?.[3]));
const stillListed = [...rows2.values()].filter((r) => r[0] !== PLANTED && r[5] === 1).length;
check("a model the listing still names is not tombstoned", stillListed === 0, `${stillListed} real models were marked gone`);
check("the root counts the gone one", r2.counts?.gone === 1, JSON.stringify(r2.counts));

// The digest rule, on its own: a shard changed without the root is refused.
const victim = r2.shards[0];
const bytes = await readFile(join(dir, victim.path), "utf8");
await writeFile(join(dir, victim.path), `${bytes}\n["tampered/row","${"0".repeat(40)}",1,1,1,0]`);
let refused = null;
try { await rowsOf(await root()); } catch (error) { refused = error.message; }
check("a shard the root does not name is refused", Boolean(refused), "it was read");

await rm(dir, { recursive: true, force: true });
console.log(failures.length ? `\n${failures.map((f) => `FAIL ${f}`).join("\n")}` : "\ntests/roll/tombstone: all checks passed");
process.exit(failures.length ? 1 : 0);
