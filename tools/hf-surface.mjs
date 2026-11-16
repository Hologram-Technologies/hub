// Writes `docs/hf-surface.md`: every operation Hugging Face documents in its
// own machine-readable specification, against what this hub does with it.
//
// The map has three inputs and no fourth:
//
//   tools/hf-surface/inventory.json  the operations, reduced from Hugging
//                                    Face's published openapi.json and pinned
//                                    by that file's sha256
//   tools/hf-surface/policy.json     the verdict for every tag, the overrides,
//                                    and the spelling each declared hub route
//                                    has in the specification
//   app/tools/site_spec.py           ENDPOINTS: what the hub says it answers
//
// `site_spec.py` stays the one source for the hub's own surface (R1): this
// tool reads that list rather than restating it, so a route added there with
// no mapping in `policy.json` fails the gate instead of quietly vanishing from
// the map.
//
// Usage:
//   node tools/hf-surface.mjs --refresh   download the live specification and
//                                         rewrite inventory.json; prints
//                                         whether the digest moved
//   node tools/hf-surface.mjs             write docs/hf-surface.md
//   node tools/hf-surface.mjs --check     regenerate in memory and exit 65
//                                         unless the committed file matches
//                                         byte for byte
//
// What the map proves and what it does not: `--check` proves the document was
// generated from these inputs and is not stale. It cannot prove the inventory
// still matches huggingface.co, because a gate that reached the network would
// fail on an outage rather than on a defect. `--refresh` is how that is
// checked, and `inventory.json` records the date and digest of the last run,
// so the claim the map makes is "as Hugging Face published it on that date".

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const INVENTORY = join(root, "tools", "hf-surface", "inventory.json");
const POLICY = join(root, "tools", "hf-surface", "policy.json");
const SITE_SPEC = join(root, "app", "tools", "site_spec.py");
const OUT = join(root, "docs", "hf-surface.md");
const SPEC_URL = "https://huggingface.co/.well-known/openapi.json";

const METHODS = ["get", "put", "post", "delete", "patch", "head"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
// The digest that is a pin. Hugging Face's published file embeds the time of
// the request as a query parameter's default, so its bytes differ between two
// downloads a second apart while the surface is identical. The operations,
// reduced and ordered, are what this map claims against, so they are what is
// digested, printed, and checked.
const surfaceDigest = (operations) => sha256(operations.map((o) => `${o.method} ${o.path} ${o.tag}\n`).join(""));
const die = (message) => {
  console.error(`hf-surface: ${message}`);
  process.exit(65);
};

// The operations, reduced from the published specification. Only what the map
// draws is kept: a 1.2 MB schema document in the tree would be a second copy
// of someone else's model, and the digest is what makes the reduction
// checkable.
function reduce(spec) {
  const operations = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (!METHODS.includes(method)) continue;
      operations.push({
        method: method.toUpperCase(),
        path,
        tag: (operation.tags ?? ["(untagged)"])[0],
        summary: (operation.summary ?? "").trim(),
      });
    }
  }
  operations.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.method < b.method ? -1 : 1));
  return operations;
}

async function refresh() {
  const response = await fetch(SPEC_URL);
  if (!response.ok) die(`${SPEC_URL} answered ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = sha256(bytes);
  const spec = JSON.parse(new TextDecoder().decode(bytes));
  const before = await readFile(INVENTORY, "utf8").then((t) => JSON.parse(t)).catch(() => null);
  const operations = reduce(spec);
  const surface = surfaceDigest(operations);
  const inventory = {
    source: {
      url: SPEC_URL,
      fetched: new Date().toISOString().slice(0, 10),
      bytes: bytes.length,
      sha256: digest,
      version: spec.info?.version ?? "",
      paths: Object.keys(spec.paths ?? {}).length,
    },
    surface,
    operations,
  };
  await writeFile(INVENTORY, `${JSON.stringify(inventory, null, 2)}\n`);
  const was = before?.surface;
  console.log(was === surface
    ? `hf-surface: the surface is unchanged, ${operations.length} operations, surface ${surface}`
    : `hf-surface: the surface moved from ${was ?? "nothing"} to ${surface}; ${operations.length} operations, ${inventory.source.paths} paths`);
  if (before && before.source?.sha256 !== digest && was === surface) {
    console.log("hf-surface: the published file's own bytes moved without the surface moving, which is what that file does: it carries the time of the request as a query parameter's default, so its digest records one response and is never a pin.");
  }
}

// The hub's own surface, read from the generator input that owns it. One
// ENDPOINTS row with two methods is two operations, because a client asks for
// one method at a time and Hugging Face documents them separately.
function hubRoutes(text) {
  const block = /^ENDPOINTS = \[\r?\n([\s\S]*?)^\]/m.exec(text);
  if (!block) die("ENDPOINTS is not a list in app/tools/site_spec.py; the map cannot read the hub's own surface");
  const rows = [...block[1].matchAll(/\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g)];
  if (!rows.length) die("ENDPOINTS holds no rows the map can read");
  const routes = [];
  for (const [, methods, path, description] of rows) {
    for (const method of methods.split(",").map((m) => m.trim()).filter(Boolean)) {
      routes.push({ op: `${method} ${path}`, method, path, description });
    }
  }
  return routes;
}

const NOT_IN_SPEC = "not-in-spec";

function assemble(inventory, policy, routes) {
  const operations = inventory.operations;
  const byOp = new Map(operations.map((o) => [`${o.method} ${o.path}`, o]));
  if (byOp.size !== operations.length) die("the inventory names one operation twice");

  const overrides = new Map();
  for (const entry of policy.overrides ?? []) {
    if (overrides.has(entry.op)) die(`two overrides name ${entry.op}`);
    if (!byOp.has(entry.op)) die(`the override ${entry.op} names an operation the inventory does not hold; the specification moved under it`);
    overrides.set(entry.op, entry);
  }

  const mapped = new Map();
  for (const entry of policy.routes ?? []) {
    if (mapped.has(entry.hub)) die(`two route mappings name ${entry.hub}`);
    mapped.set(entry.hub, entry);
  }
  for (const route of routes) {
    if (!mapped.has(route.op)) die(`site_spec.py answers ${route.op} and policy.json does not say where it lives in the specification`);
  }
  for (const [hub] of mapped) {
    if (!routes.some((r) => r.op === hub)) die(`policy.json maps ${hub}, which site_spec.py no longer answers`);
  }

  // Two rules with teeth, in both directions. A route the hub declares may not
  // be one the map calls none of the hub's business, and an operation the map
  // calls answered must be one the hub declares. A refusal is an answer a
  // client can act on, so declaring one is honest; `out-of-scope` and
  // `unreachable` are not answers at all.
  const notAnAnswer = new Set(["out-of-scope", "unreachable"]);
  const owned = new Set(["answered", "partial"]);
  const rows = operations.map((o) => {
    const key = `${o.method} ${o.path}`;
    const override = overrides.get(key);
    const tag = policy.tags?.[o.tag];
    if (!tag) die(`the tag ${o.tag} has no verdict in policy.json`);
    const verdict = override?.verdict ?? tag.verdict;
    if (!policy.vocabulary?.[verdict]) die(`${key} has the verdict ${verdict}, which is not in the vocabulary`);
    return { ...o, verdict, reason: override?.reason ?? tag.reason, note: override?.note ?? "", declared: false };
  });
  const rowOf = new Map(rows.map((r) => [`${r.method} ${r.path}`, r]));

  const absent = [];
  for (const route of routes) {
    const entry = mapped.get(route.op);
    if (entry.spec === NOT_IN_SPEC) {
      if (notAnAnswer.has(entry.verdict)) die(`site_spec.py answers ${route.op}, and the map calls it ${entry.verdict}`);
      if (!policy.vocabulary?.[entry.verdict]) die(`${route.op} has the verdict ${entry.verdict}, which is not in the vocabulary`);
      absent.push({ ...route, verdict: entry.verdict, reason: entry.reason ?? "", note: entry.note ?? "" });
      continue;
    }
    const row = rowOf.get(entry.spec);
    if (!row) die(`${route.op} is mapped to ${entry.spec}, which the specification does not hold`);
    if (notAnAnswer.has(row.verdict)) die(`site_spec.py answers ${route.op}, and the map calls ${entry.spec} ${row.verdict}`);
    row.declared = true;
  }
  for (const row of rows) {
    if (owned.has(row.verdict) && !row.declared) {
      die(`the map calls ${row.method} ${row.path} ${row.verdict}, and site_spec.py does not answer it`);
    }
  }
  return { rows, absent };
}

const esc = (s) => s.replace(/\|/g, "\\|");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function render(inventory, policy, { rows, absent }) {
  const counts = new Map();
  for (const row of rows) counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1);
  const order = Object.keys(policy.vocabulary);
  const answered = ["answered", "partial", "passthrough"].reduce((n, v) => n + (counts.get(v) ?? 0), 0);

  const byTag = new Map();
  for (const row of rows) {
    if (!byTag.has(row.tag)) byTag.set(row.tag, []);
    byTag.get(row.tag).push(row);
  }
  const tags = [...byTag].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));

  const out = [];
  out.push("<!-- Generated by tools/hf-surface.mjs. Do not edit: `node tools/hf-surface.mjs --check` rejects a hand-edited file. -->");
  out.push("");
  out.push("# The Hugging Face surface, and what this hub does with it");
  out.push("");
  out.push(`Every operation Hugging Face documents in [its own machine-readable specification](${inventory.source.url}), with one verdict each. The specification is the authority for how wide the surface is. It is not the authority for the shape of a response, and it cannot be: the two routes clients ask for most, \`GET /api/models\` and \`GET /api/models/{repo}\`, are not in it. Recorded client transcripts are the authority for shape, and this map does not stand in for them.`);
  out.push("");
  out.push("| | |");
  out.push("| --- | --- |");
  out.push(`| Specification | \`${inventory.source.url}\` |`);
  out.push(`| Read on | ${inventory.source.fetched} |`);
  out.push(`| The surface it describes | sha256 \`${inventory.surface}\`, over every operation's method, path and tag |`);
  out.push(`| The response it was read from | ${inventory.source.bytes} bytes, sha256 \`${inventory.source.sha256}\`, which is not a pin: the file carries the time of the request as a query parameter's default, so two downloads a second apart differ |`);
  out.push(`| Its version | \`${inventory.source.version}\` |`);
  out.push(`| What it holds | ${plural(rows.length, "operation", "operations")} across ${plural(inventory.source.paths, "path", "paths")}, in ${plural(tags.length, "tag", "tags")} |`);
  out.push(`| What the hub declares | ${plural(absent.length + rows.filter((r) => r.declared).length, "operation", "operations")} in \`app/tools/site_spec.py\`, ${plural(absent.length, "of which is", "of which are")} absent from the specification |`);
  out.push(`| Answered in some form | ${answered} of ${rows.length} |`);
  out.push("");
  out.push("## The verdicts");
  out.push("");
  out.push("| Verdict | Count | Means |");
  out.push("| --- | --- | --- |");
  for (const verdict of order) {
    out.push(`| \`${verdict}\` | ${counts.get(verdict) ?? 0} | ${esc(policy.vocabulary[verdict])} |`);
  }
  out.push("");
  out.push(`There is no verdict for "answered, but narrower than Hugging Face's answer and silent about it". That is a defect rather than a position, so where the hub does it the row carries a note and the note is collected under [Findings](#findings).`);
  out.push("");
  if (policy.read) {
    out.push("## What these verdicts are worth");
    out.push("");
    out.push(policy.read);
    out.push("");
  }

  out.push("## What the hub says it answers");
  out.push("");
  out.push(`\`site_spec.py\` holds the hub's own list, and the kernel's documentation screen is generated from it. Four of its operations have no entry in the specification, so no client library's own reference documents them either, and only a recorded transcript settles their shape.`);
  out.push("");
  out.push("| The hub's spelling | In the specification | Verdict |");
  out.push("| --- | --- | --- |");
  const spelling = new Map((policy.routes ?? []).map((r) => [r.hub, r.spec]));
  for (const row of rows.filter((r) => r.declared)) {
    const hub = [...spelling].find(([, spec]) => spec === `${row.method} ${row.path}`)?.[0] ?? "";
    out.push(`| \`${esc(hub)}\` | \`${esc(`${row.method} ${row.path}`)}\` | \`${row.verdict}\` |`);
  }
  for (const route of absent) {
    out.push(`| \`${esc(route.op)}\` | not documented | \`${route.verdict}\` |`);
  }
  out.push("");

  const noted = [...rows.filter((r) => r.note), ...absent.filter((r) => r.note)];
  const findings = policy.findings ?? [];
  out.push("## Findings");
  out.push("");
  if (!noted.length && !findings.length) out.push("None.");
  for (const row of noted) {
    out.push(`- **\`${esc(row.op ?? `${row.method} ${row.path}`)}\`** — ${esc(row.note)}`);
  }
  for (const finding of findings) out.push(`- ${esc(finding)}`);
  out.push("");

  out.push("## Every operation, by tag");
  out.push("");
  for (const [tag, group] of tags) {
    const policyTag = policy.tags[tag];
    out.push(`### ${tag} (${group.length})`);
    out.push("");
    out.push(`${esc(policyTag.reason)} Default verdict \`${policyTag.verdict}\`.`);
    out.push("");
    out.push("| Verdict | Operation | What Hugging Face calls it |");
    out.push("| --- | --- | --- |");
    for (const row of group) {
      out.push(`| \`${row.verdict}\` | \`${esc(`${row.method} ${row.path}`)}\` | ${esc(row.summary)} |`);
    }
    out.push("");
  }
  return `${out.join("\n")}`;
}

const args = process.argv.slice(2);
if (args.includes("--refresh")) {
  await refresh();
} else {
  const inventory = JSON.parse(await readFile(INVENTORY, "utf8"));
  const policy = JSON.parse(await readFile(POLICY, "utf8"));
  const routes = hubRoutes(await readFile(SITE_SPEC, "utf8"));
  const text = render(inventory, policy, assemble(inventory, policy, routes));
  if (args.includes("--check")) {
    const have = await readFile(OUT, "utf8").catch(() => null);
    if (have === null) die(`${OUT} is missing; run \`node tools/hf-surface.mjs\``);
    if (have !== text) {
      const h = sha256(Buffer.from(have)), w = sha256(Buffer.from(text));
      die(`docs/hf-surface.md is not what these inputs generate: it is sha256 ${h}, they generate ${w}. Run \`node tools/hf-surface.mjs\`.`);
    }
    console.log(`hf-surface: the map matches its inputs, ${inventory.operations.length} operations`);
  } else {
    await writeFile(OUT, text);
    console.log(`hf-surface: wrote docs/hf-surface.md, ${inventory.operations.length} operations`);
  }
}
