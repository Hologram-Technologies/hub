// web/hub-client.mjs against the published index and against a planted defect
// for every refusal it names (HK-54).
//
//   node tests/index/client.mjs <holo url> <index url>
//
// The trust policy is the one the hub's model pins, read from the kernel as
// the edge reads it, so the check uses no second copy of it.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { start, loaded } from "../../edge/edge.mjs";
import { blake3Hex } from "../../tools/blake3.mjs";
import { CODES, SIGSTORE_BLAKE3, checkFile, fileBlake3, openIndex, readRecord } from "../../web/hub-client.mjs";

const [holo, base] = process.argv.slice(2);
if (!holo || !base) {
  console.error("usage: node tests/index/client.mjs <holo url> <index url>");
  process.exit(64);
}
let checks = 0;
const ok = (what) => { checks += 1; console.log(`ok   ${what}`); };
const refused = async (promise, code, what) => {
  await assert.rejects(promise, (e) => e.code === code, `${what}: expected ${code}`);
  ok(what);
};

const sigstore = await readFile(fileURLToPath(new URL("../../web/sigstore.mjs", import.meta.url)));
assert.equal(blake3Hex(sigstore), SIGSTORE_BLAKE3, "web/sigstore.mjs is not the version hub-client.mjs names; test hub-client against it and update SIGSTORE_BLAKE3");
ok("the sigstore.mjs beside it is the one it names");

await start({ holo, huggingFace: false });
const policy = loaded().trust;
assert.ok(policy?.indexPredicateType && policy?.identity, "the kernel pins no index trust policy");

// The published index, as a page reads it.
const index = await openIndex(base, policy);
assert.ok(Object.values(index.facts).every(Boolean));
ok(`the published root is proven by its signature (${index.root.records.length} records)`);
const repo = "Xenova/all-MiniLM-L6-v2";
const record = await readRecord(index, repo);
ok(`${repo}'s record is the bytes the signed root names by BLAKE3`);
const path = "config.json";
assert.match(fileBlake3(record, path), /^[0-9a-f]{64}$/);
const response = await fetch(`${record.origin.resolve}${path}`);
const file = new Uint8Array(await response.arrayBuffer());
const checked = await checkFile(index, record, path, response.ok ? [file] : []);
assert.equal(checked.length, file.length);
ok(`${repo}/${path}, fetched from its origin, is the BLAKE3 its record names`);

// A caller's own hasher is used for every hash, and nothing else is loaded.
let calls = 0;
const own = async (input) => {
  calls += 1;
  const parts = [];
  for await (const c of input instanceof Uint8Array ? [input] : input) parts.push(c);
  return blake3Hex(Buffer.concat(parts));
};
const mine = await openIndex(base, policy, { hash: own });
await checkFile(mine, await readRecord(mine, repo), path, [file]);
assert.equal(calls, 2, "the caller's hasher must hash the record and the file");
ok("a caller's own BLAKE3 hasher is the one used");

// Plants: each refusal by its code.
const tamper = (name, change) => async (url, init) => {
  const response = await fetch(url, init);
  if (!String(url).endsWith(name)) return response;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return new Response(change(bytes), { status: 200 });
};
const flip = (bytes) => { const out = bytes.slice(); out[out.length - 2] ^= 1; return out; };
await refused(openIndex(base, policy, { fetch: tamper("root.json", flip) }), CODES.RootUnverified, "a changed root is refused as RootUnverified");
await assert.rejects(openIndex(base, policy, { fetch: tamper("root.json", flip) }), (e) => e.failed.includes("subject"));
ok("and the refusal names the check that failed");
await refused(openIndex(base, { ...policy, identity: `${policy.identity}x` }), CODES.RootUnverified, "a root signed by another workflow is refused");
await refused(openIndex(base, policy, { fetch: async () => { throw new TypeError("offline"); } }), CODES.RootUnreachable, "an unreachable root is RootUnreachable");
await refused(readRecord(index, "nobody/no-such-model"), CODES.RecordUnknown, "a repository the root does not name is RecordUnknown");
const lying = await openIndex(base, policy, { fetch: tamper(`models/${repo}.json`, flip) });
await refused(readRecord(lying, repo), CODES.RecordMismatch, "a changed record is RecordMismatch");
const bare = { ...index, root: { ...index.root, records: index.root.records.map((r) => ({ ...r, blake3: undefined })) } };
await refused(readRecord(bare, repo), CODES.RecordUnaddressed, "a root entry with no BLAKE3 is RecordUnaddressed");
await refused(checkFile(index, record, path, [flip(file)]), CODES.FileMismatch, "a changed file is FileMismatch");
await refused(checkFile(index, record, path, [file.subarray(0, file.length - 1)]), CODES.FileMismatch, "a short file is FileMismatch");
await refused(checkFile(index, record, "no/such/file", [file]), CODES.FileUnaddressed, "a file the record gives no BLAKE3 is FileUnaddressed");

console.log(`tests/index/client: ${checks} checks passed`);
process.exit(0);
