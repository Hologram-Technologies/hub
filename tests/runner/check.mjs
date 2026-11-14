// What `check` compares, and what it refuses.
//
// This is the one place every address a record carries is checked, and the
// combinations it has to get right cannot all be produced through a record:
// a witness address never lands in `files[].sha256`, by design, so a small
// file with a SHA-256 beside its git blob identity is unreachable from the
// serve path. So `check` is exercised directly.
//
// The property the kernel relies on: where a file has both addresses, both
// are checked, and either failing refuses. A SHA-256 may come from a witness
// and a witness may also be a source, so a digest that agrees proves nothing
// on its own; the git blob identity is the one only the origin published.
//
// The trap it must avoid: `gitSha1` is the git blob of whatever git holds,
// and for an LFS file git holds a 134-byte pointer. Comparing it to the
// content would refuse every weight file.
//
//   node tests/runner/check.mjs <holo url>
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../../try/vendor/prism-code/src/browser.mjs";
import { check } from "../../runner/local.mjs";

const [holo] = process.argv.slice(2);
if (!holo) {
  console.error("usage: node tests/runner/check.mjs <holo url>");
  process.exit(64);
}

let checks = 0;
const ok = (what) => { checks += 1; console.log(`  ok  ${what}`); };
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const gitBlob = (b) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");

const kernel = await load(holo);
const work = await mkdtemp(join(tmpdir(), "hub-check-"));
const BYTES = Buffer.from("the bytes a source handed over".repeat(40));
// The same length, different bytes, so a size comparison cannot catch it.
const OTHER = Buffer.from(BYTES);
OTHER[0] ^= 0xff;
const file = join(work, "bytes");
await writeFile(file, BYTES);
const WRONG_SHA = "f".repeat(64);
const WRONG_BLOB = "0".repeat(40);
const run = (fields) => check(kernel, file, { size: BYTES.length, ...fields });

// A small file: git holds the bytes, so the git blob identity describes them.
assert.deepEqual((await run({ entry: 1, blobId: gitBlob(BYTES) })).ok, true);
assert.equal((await run({ entry: 1, blobId: WRONG_BLOB })).ok, false);
ok("a small file is checked against its git blob identity");

// Both addresses, both describing these bytes.
let seen = await run({ entry: 1, blobId: gitBlob(BYTES), address: sha256(BYTES) });
assert.equal(seen.ok, true);
assert.equal(seen.by, "git blob and sha256");
ok("where a file has both addresses, both are checked");

// The case the kernel leans on: a digest that agrees with the bytes, from a
// party that could also have served them, while the address only the origin
// published does not. Refused.
seen = await run({ entry: 1, blobId: WRONG_BLOB, address: sha256(BYTES) });
assert.equal(seen.ok, false);
assert.match(seen.why, /git blob/);
ok("bytes matching the digest but not the origin's git blob are refused");

// And the other way: the git blob agrees and the digest does not.
seen = await run({ entry: 1, blobId: gitBlob(BYTES), address: WRONG_SHA });
assert.equal(seen.ok, false);
assert.match(seen.why, /sha256/);
ok("bytes matching the git blob but not the digest are refused");

// An LFS file: git holds a 134-byte pointer, so `gitSha1` says nothing about
// the content and must not be compared to it. Measured on
// `openai-community/gpt2`, where `64-8bits.tflite` is 125,162,496 bytes and
// its `gitSha1` hashes the pointer.
const POINTER = Buffer.from([
  "version https://git-lfs.github.com/spec/v1",
  `oid sha256:${sha256(BYTES)}`,
  `size ${BYTES.length}`,
  "",
].join("\n"));
seen = await run({ entry: 2, blobId: gitBlob(POINTER), address: sha256(BYTES) });
assert.equal(seen.ok, true);
assert.equal(seen.by, "sha256");
ok("an LFS file is checked against its digest, not against the pointer's hash");

// Nothing passes for want of something to check it against.
assert.equal((await run({ entry: 1 })).ok, false);
assert.equal((await run({ entry: 2, blobId: gitBlob(POINTER) })).ok, false);
ok("a file with no address, and a large file with no digest, are refused");

// Bytes of the right length that are not the right bytes.
await writeFile(file, OTHER);
assert.equal(OTHER.length, BYTES.length);
assert.equal((await run({ entry: 1, blobId: gitBlob(BYTES) })).ok, false);
assert.equal((await run({ entry: 2, address: sha256(BYTES) })).ok, false);
ok("a file of the right length holding other bytes is refused either way");

await rm(work, { recursive: true, force: true });
console.log(`tests/runner/check: ${checks} checks passed`);
process.exit(0);
