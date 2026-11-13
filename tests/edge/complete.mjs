// Checks the kernel's completeness rule end to end on the edge (HK-15): a
// record holding all ten fields answers from the index, and one missing a
// field, with Hugging Face unreachable, answers and says the answer is
// partial rather than passing the gap off as whole.
//
//   node tests/edge/complete.mjs <holo url> <index dir>
//
// The index may be unsigned here: this is a test of the rule, not of the
// signature, which `edge/edge.mjs` checks on every real start.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, normalize } from "node:path";
import { start, handle, adoptUnsignedIndexForTests } from "../../edge/edge.mjs";

const [holo, indexDir] = process.argv.slice(2);
if (!holo || !indexDir) {
  console.error("usage: node tests/edge/complete.mjs <holo url> <index dir>");
  process.exit(64);
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// A copy of the index with one record's config removed, so one repository is
// complete and one is not.
const work = join(indexDir, "..", "index-partial");
await rm(work, { recursive: true, force: true });
await cp(indexDir, work, { recursive: true });
const root = JSON.parse(await readFile(join(work, "root.json"), "utf8"));
if (root.records.length < 2) {
  console.error("the index needs at least two records");
  process.exit(64);
}
const [whole, broken] = root.records;
const path = join(work, "models", `${broken.repo}.json`);
const record = JSON.parse(await readFile(path, "utf8"));
delete record.config;
const bytes = Buffer.from(JSON.stringify(record));
await writeFile(path, bytes);
broken.sha256 = sha256(bytes);
await writeFile(join(work, "root.json"), JSON.stringify(root));

// Node's fetch has no file scheme, so the doctored copy is served here.
const server = createServer((request, response) => {
  const asked = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname)).replace(/^[\\/]+/, "");
  const file = join(work, asked);
  const stream = createReadStream(file);
  stream.once("error", () => response.writeHead(404).end());
  stream.once("open", () => {
    response.writeHead(200, { "content-type": "application/json" });
    stream.pipe(response);
  });
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const ready = await start({ holo, index: base, huggingFace: false, drain: ["huggingface.co"] });
await adoptUnsignedIndexForTests(base);
console.log(`edge: ${ready.examples} examples replayed, ${root.records.length} records`);

const ask = async (p) => {
  const response = await handle(new Request(`http://edge/${p}`));
  return { status: response.status, partial: response.headers.get("x-hub-partial"), body: await response.json().catch(() => null) };
};
const failures = [];
const check = (name, ok, saw) => (ok ? console.log(`ok   ${name}`) : failures.push(`${name}: ${saw}`));

const full = await ask(`api/models/${whole.repo}`);
check("a complete record answers from the index", full.status === 200 && !full.partial, `${full.status} partial=${full.partial}`);
for (const key of ["config", "cardData", "safetensors", "lastModified", "tags", "siblings"]) {
  check(`the answer carries ${key}`, full.body?.[key] !== undefined, "absent");
}
check("downloads come from the observation", typeof full.body?.downloads === "number", String(full.body?.downloads));

const partial = await ask(`api/models/${broken.repo}`);
check("an incomplete record still answers", partial.status === 200, String(partial.status));
check("and names the field that was removed", (partial.partial ?? "").split(",").includes("config"), String(partial.partial));
check("and does not invent the field", partial.body?.config === undefined, "present");

console.log(failures.length ? `\n${failures.map((f) => `FAIL ${f}`).join("\n")}` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
