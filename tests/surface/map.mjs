// The gate over `docs/hf-surface.md`: a second reader of the same three
// inputs, so a defect in the generator cannot pass by agreeing with itself.
//
// It reads the inventory, the policy and `site_spec.py` directly and checks
// the rules the map's honesty rests on, then runs the generator's own
// `--check` for staleness. The two are deliberately different kinds of check:
// `--check` compares bytes, and everything here compares claims.
//
//   node tests/surface/map.mjs
//
// Exits 65 with every failure named. What it cannot check is whether the
// inventory still matches huggingface.co; `node tools/hf-surface.mjs --refresh`
// is what checks that, and the inventory records the date it was last run.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p) => readFileSync(join(root, ...p), "utf8");
const inventory = JSON.parse(read("tools", "hf-surface", "inventory.json"));
const policy = JSON.parse(read("tools", "hf-surface", "policy.json"));
const spec = read("app", "tools", "site_spec.py");
const map = read("docs", "hf-surface.md");

let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) return;
  failed += 1;
  console.error(`not ok ${name}${detail ? `: ${detail}` : ""}`);
};

// The hub's own surface, from the file that owns it. Read the same way the
// generator reads it, because a second spelling of this regex would be a
// second source for what the hub answers.
const block = /^ENDPOINTS = \[\r?\n([\s\S]*?)^\]/m.exec(spec);
check("site_spec.py still holds an ENDPOINTS list", Boolean(block));
const declared = [...(block?.[1] ?? "").matchAll(/\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,/g)]
  .flatMap(([, methods, path]) => methods.split(",").map((m) => `${m.trim()} ${path}`));
check("and it declares at least one operation", declared.length > 0);

const ops = inventory.operations ?? [];
const byOp = new Map(ops.map((o) => [`${o.method} ${o.path}`, o]));

check("the inventory names the specification's digest", /^[0-9a-f]{64}$/.test(inventory.source?.sha256 ?? ""), String(inventory.source?.sha256));
check("and the date it was read", /^\d{4}-\d{2}-\d{2}$/.test(inventory.source?.fetched ?? ""), String(inventory.source?.fetched));
check("and how many bytes it was", Number.isInteger(inventory.source?.bytes) && inventory.source.bytes > 0);
check("the inventory holds operations", ops.length > 0);
check("the inventory's surface digest is the digest of its own operations",
  inventory.surface === createHash("sha256").update(ops.map((o) => `${o.method} ${o.path} ${o.tag}
`).join("")).digest("hex"),
  `it records ${inventory.surface}`);

check("each with a method, a path, a tag and Hugging Face's own name for it",
  ops.every((o) => o.method && o.path?.startsWith("/") && o.tag && typeof o.summary === "string"));
check("and names none of them twice", byOp.size === ops.length, `${ops.length - byOp.size} repeated`);

const vocabulary = policy.vocabulary ?? {};
check("the vocabulary is closed and described", Object.keys(vocabulary).length > 0
  && Object.values(vocabulary).every((v) => typeof v === "string" && v.length > 20));

const tags = new Set(ops.map((o) => o.tag));
for (const tag of [...tags].sort()) {
  const entry = policy.tags?.[tag];
  check(`the tag ${tag} has a verdict`, Boolean(entry) && Boolean(vocabulary[entry?.verdict]), entry ? `verdict ${entry.verdict}` : "no entry");
  check(`and a reason`, (entry?.reason ?? "").length > 20, tag);
}
for (const tag of Object.keys(policy.tags ?? {})) {
  check(`the tag ${tag} is one the specification still carries`, tags.has(tag), "a tag the policy judges and the specification dropped");
}

const overrides = new Map();
for (const entry of policy.overrides ?? []) {
  check(`the override ${entry.op} names an operation the specification holds`, byOp.has(entry.op));
  check(`the override ${entry.op} has a verdict in the vocabulary`, Boolean(vocabulary[entry.verdict]), String(entry.verdict));
  check(`the override ${entry.op} says why`, (entry.reason ?? "").length >= 5, "no reason given");
  check(`the override ${entry.op} appears once`, !overrides.has(entry.op));
  overrides.set(entry.op, entry);
}

const verdictOf = (op) => overrides.get(`${op.method} ${op.path}`)?.verdict ?? policy.tags?.[op.tag]?.verdict;
const notAnAnswer = new Set(["out-of-scope", "unreachable"]);
const owned = new Set(["answered", "partial"]);

// Both directions of the one rule that gives this map teeth.
const routes = new Map((policy.routes ?? []).map((r) => [r.hub, r]));
check("every operation the hub declares is mapped", declared.every((d) => routes.has(d)),
  declared.filter((d) => !routes.has(d)).join(", "));
check("and nothing is mapped that the hub no longer declares", [...routes.keys()].every((k) => declared.includes(k)),
  [...routes.keys()].filter((k) => !declared.includes(k)).join(", "));

const targets = new Set();
for (const [hub, entry] of routes) {
  if (entry.spec === "not-in-spec") {
    check(`${hub} is absent from the specification and still has a verdict`, Boolean(vocabulary[entry.verdict]), String(entry.verdict));
    check(`${hub} is not declared and dismissed at once`, !notAnAnswer.has(entry.verdict), String(entry.verdict));
    continue;
  }
  const op = byOp.get(entry.spec);
  check(`${hub} is mapped to an operation the specification holds`, Boolean(op), entry.spec);
  if (!op) continue;
  targets.add(entry.spec);
  check(`${hub} is not declared and dismissed at once`, !notAnAnswer.has(verdictOf(op)), `the map calls it ${verdictOf(op)}`);
}
for (const op of ops) {
  const key = `${op.method} ${op.path}`;
  if (!owned.has(verdictOf(op))) continue;
  check(`the map calls ${key} ${verdictOf(op)} only because the hub declares it`, targets.has(key));
}

// The document must hold every operation, so a renderer that filtered,
// truncated or sorted rows away cannot pass.
const rowCount = [...map.matchAll(/^\| `[a-z-]+` \| `(?:GET|PUT|POST|DELETE|PATCH|HEAD) /gm)].length;
check("the map draws a row for every operation", rowCount === ops.length, `${rowCount} rows for ${ops.length} operations`);
check("the map names the digest it was built from", map.includes(inventory.source.sha256));
check("and the number of operations it covers", map.includes(`${ops.length} operations`));
for (const verdict of Object.keys(vocabulary)) {
  const n = ops.filter((o) => verdictOf(o) === verdict).length;
  check(`the map's count for ${verdict} is the count in its inputs`, map.includes(`| \`${verdict}\` | ${n} |`), `expected ${n}`);
}

// Staleness, by bytes, from the generator itself.
const regenerated = spawnSync(process.execPath, [join(root, "tools", "hf-surface.mjs"), "--check"], { encoding: "utf8" });
check("the committed map is what its inputs generate", regenerated.status === 0,
  `${(regenerated.stderr || regenerated.stdout || "").trim()}`);

if (failed) {
  console.error(`\nsurface map: ${failed} check${failed === 1 ? "" : "s"} failed`);
  process.exit(65);
}
console.log(`ok surface map: ${ops.length} operations, ${declared.length} declared by the hub, ${ops.filter((o) => owned.has(verdictOf(o))).length} answered from the index`);
