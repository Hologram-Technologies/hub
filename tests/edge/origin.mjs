// Checks the other half of HK-20 end to end: a record names where its own
// bytes come from, and the edge's own redirect for a file is that base with
// the file's path appended. The field is only worth reading if the hub uses
// it itself; a record whose `origin` disagreed with the edge would send a
// reader somewhere the hub does not go.
//
//   node tests/edge/origin.mjs <holo url> <index dir>
//
// Every record today names Hugging Face, which is also what the edge's own
// constant says, so checking real records alone would pass even if the edge
// ignored the field entirely. The second half of this test therefore moves
// one record's origin to a base the constant could never produce, and that
// is the check that can actually fail.
//
// Hugging Face is switched off, so every answer here comes from the index.
// The index may be unsigned: this is a test of the rule, not of the
// signature, which `edge/edge.mjs` checks on every real start.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, normalize } from "node:path";
import { start, handle, adoptUnsignedIndexForTests } from "../../edge/edge.mjs";

const [holo, indexDir] = process.argv.slice(2);
if (!holo || !indexDir) {
  console.error("usage: node tests/edge/origin.mjs <holo url> <index dir>");
  process.exit(64);
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const MIRROR = "https://mirror.invalid/held/";

// A copy, so one record can be moved to a mirror without touching the index
// the rest of the run reads.
const work = join(indexDir, "..", "index-origin");
await rm(work, { recursive: true, force: true });
await cp(indexDir, work, { recursive: true });
const root = JSON.parse(await readFile(join(work, "root.json"), "utf8"));
if (!root.records.length) {
  console.error("the index needs at least one record");
  process.exit(64);
}

// Node's fetch has no file scheme, so the copy is served here.
const server = createServer((request, response) => {
  const asked = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname)).replace(/^[\/]+/, "");
  const stream = createReadStream(join(work, asked));
  stream.once("error", () => response.writeHead(404).end());
  stream.once("open", () => {
    response.writeHead(200, { "content-type": "application/json" });
    stream.pipe(response);
  });
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const failures = [];
const check = (name, ok, saw) => (ok ? console.log(`ok   ${name}`) : failures.push(`${name}: ${saw}`));
const read = async (repo) => JSON.parse(await readFile(join(work, "models", `${repo}.json`), "utf8"));
const usable = (rec) => rec.files?.find((f) => f.path && !f.path.includes("%"));

// Move the first usable record to a mirror, so the edge has something to
// follow that its own constant could not have produced.
let moved = null;
for (const entry of root.records) {
  const rec = await read(entry.repo);
  if (!usable(rec) || rec.origin?.kind !== "huggingface.co") continue;
  rec.origin = { ...rec.origin, resolve: MIRROR };
  const bytes = Buffer.from(JSON.stringify(rec));
  await writeFile(join(work, "models", `${entry.repo}.json`), bytes);
  entry.sha256 = sha256(bytes);
  moved = rec;
  break;
}
await writeFile(join(work, "root.json"), JSON.stringify(root));

const ready = await start({ holo, index: base, huggingFace: false });
await adoptUnsignedIndexForTests(base);
console.log(`edge: ${ready.examples} examples replayed, ${root.records.length} records`);

const redirect = async (rec, file) => {
  const response = await handle(new Request(`http://edge/${rec.repo}/resolve/${rec.revision}/${file.path}`));
  return { status: response.status, location: response.headers.get("location") };
};

// Every record names an origin, and the edge agrees with it.
let checked = 0;
for (const entry of root.records.slice(0, 8)) {
  const rec = await read(entry.repo);
  const file = usable(rec);
  if (!file) continue;
  check(`${rec.repo} names an origin`, Boolean(rec.origin), JSON.stringify(rec.origin ?? null));
  if (!rec.origin) continue;
  check(`${rec.repo}'s origin names a kind and a resolve base`,
    Boolean(rec.origin.kind) && String(rec.origin.resolve ?? "").endsWith("/"),
    JSON.stringify(rec.origin));
  const got = await redirect(rec, file);
  check(`${rec.repo} redirects for ${file.path}`, got.status === 302, String(got.status));
  check(`and the redirect is ${rec.repo}'s own origin`,
    got.location === `${rec.origin.resolve}${file.path}`,
    `${got.location} is not ${rec.origin.resolve}${file.path}`);
  checked += 1;
}
check("some record was checked", checked > 0, `${checked} records had a usable file`);

// The check that can fail: the moved record must be followed to the mirror,
// not to the host the edge would have named by itself.
if (!moved) {
  failures.push("no record could be moved to a mirror, so nothing here could fail");
} else {
  const file = usable(moved);
  const got = await redirect(moved, file);
  check("a record whose origin is a mirror is followed to the mirror",
    got.location === `${MIRROR}${file.path}`,
    `${got.location} is not ${MIRROR}${file.path}`);
  check("and the edge does not fall back to its own constant",
    !String(got.location).startsWith("https://huggingface.co/"),
    String(got.location));
}

console.log(failures.length ? `\n${failures.map((f) => `FAIL ${f}`).join("\n")}` : "\nall checks passed");
server.close();
process.exit(failures.length ? 1 : 0);
