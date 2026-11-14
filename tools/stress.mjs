// A report on what the hub can actually prove about one model, for someone
// stress-testing it. Not a gate: it asserts nothing and fails nothing. It
// asks the real kernel through the real edge against the live signed index,
// and prints what came back, so a claim about the hub can be read off
// measurements rather than from this repository's prose.
//
//   node tools/stress.mjs <holo url> <index url> [repo]
//
// It answers four questions. How much of this model is addressed at all, and
// by whom. Where the hub sends a client, and whether the bytes there are the
// size the record says. Whether a second source exists, and what the kernel
// does when the first is taken away. And what two witnesses add up to, file
// by file.
import { start, handle } from "../edge/edge.mjs";

const [holo, indexUrl, repoArg] = process.argv.slice(2);
if (!holo || !indexUrl) {
  console.error("usage: node tools/stress.mjs <holo url> <index url> [repo]");
  process.exit(64);
}
const repo = repoArg ?? "openai-community/gpt2";
const line = (k, v) => console.log(`${k.padEnd(34)} ${v}`);

const record = await (await fetch(new URL(`models/${repo}.json`, indexUrl))).json()
  .catch(() => null);
if (!record?.files) {
  console.error(`no record for ${repo} in ${indexUrl}`);
  process.exit(1);
}

console.log(`\n== ${repo} ==`);
line("revision", record.revision);
line("record format", record.format);
line("files", String(record.files.length));

// 1. How much is addressed, and by whom.
const witnessed = new Map((record.witnesses ?? [])
  .flatMap((w) => w.addresses.map((a) => [a.path, w.source])));
const selfAttested = record.files.filter((f) => f.sha256).length;
line("addressed by the source itself", `${selfAttested} of ${record.files.length} (Hugging Face publishes one only for LFS files)`);
line("addressed by a second witness", `${witnessed.size} of ${record.files.length}` +
  (record.witnesses?.length ? ` (${record.witnesses.map((w) => w.source).join(", ")})` : " (none)"));
const unaddressed = record.files.filter((f) => !f.sha256 && !witnessed.has(f.path)).length;
line("no address at all", `${unaddressed} of ${record.files.length}`);
line("origin", record.origin ? `${record.origin.kind} at ${record.origin.resolve}` : "not named (record predates HK-20)");
line("other sources", record.sources?.length ? record.sources.map((s) => s.kind).join(", ") : "none");

// 2. Where the hub sends a client, and is what is there the size it says.
const ask = async (path) => {
  const r = await handle(new Request(`http://edge/${repo}/resolve/${record.revision}/${path}`, { method: "HEAD" }));
  return { status: r.status, location: r.headers.get("location"), etag: r.headers.get("x-linked-etag"), size: r.headers.get("x-linked-size") };
};
const sample = record.files.slice(0, 4);

await start({ holo, index: indexUrl, huggingFace: false });
console.log("\n-- with every source available --");
for (const f of sample) {
  const got = await ask(f.path);
  let actual = "not checked";
  if (got.location) {
    try {
      const head = await fetch(got.location, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(20000) });
      const len = head.headers.get("content-length");
      actual = len === String(f.size) ? `${len} bytes, as the record says` : `${len} bytes, the record says ${f.size}`;
    } catch (e) { actual = `unreachable (${e.message})`; }
  }
  console.log(`  ${f.path}`);
  line("    answer", got.status === 302 ? `302 to ${new URL(got.location).host}` : String(got.status));
  line("    etag the client is given", got.etag ?? "none");
  line("    bytes at that address", actual);
}

// 3. What the kernel does when the first source is taken away.
console.log("\n-- with huggingface.co drained --");
await start({ holo, index: indexUrl, huggingFace: false, drain: ["huggingface.co"] });
for (const f of sample) {
  const got = await ask(f.path);
  line(`  ${f.path}`, got.status === 302
    ? `302 to ${new URL(got.location).host} (failed over)`
    : `${got.status} (refused: no other source holds it)`);
}

// 4. What two witnesses add up to, file by file.
console.log("\n-- what the witnesses say --");
const tally = { agree: 0, oursAlone: 0, theirsAlone: 0, disagree: 0, neither: 0 };
for (const f of record.files) {
  const ours = f.sha256 ?? null;
  const theirs = (record.witnesses ?? []).flatMap((w) => w.addresses).find((a) => a.path === f.path)?.sha256 ?? null;
  if (ours && theirs) tally[ours === theirs ? "agree" : "disagree"] += 1;
  else if (ours) tally.oursAlone += 1;
  else if (theirs) tally.theirsAlone += 1;
  else tally.neither += 1;
}
line("both name it and agree", String(tally.agree));
line("the release alone names it", String(tally.oursAlone));
line("the witness alone names it", String(tally.theirsAlone));
line("they disagree (treated as no address)", String(tally.disagree));
line("neither names it", String(tally.neither));
console.log("");
