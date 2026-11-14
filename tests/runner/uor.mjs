// The UOR layer: a BLAKE3 address per tensor, over the tensor's own raw bytes.
//
// A file address says the file arrived intact. A tensor address says which
// tensor is intact, and checks it against a manifest this repository signed
// after downloading and re-hashing the bytes itself. This checks that a single
// flipped byte is caught, that it is attributed to the right tensor, and that
// a file the manifest says nothing about is reported as unwitnessed rather
// than counted as a pass.
//
//   node tests/runner/uor.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkTensors, checkTensorsOfFile, gitBlobSha1, readSafetensors, sha256, tensorAddresses } from "../../runner/uor.mjs";

let checks = 0;
const ok = (what) => { checks += 1; console.log(`  ok  ${what}`); };

function safetensors(tensors) {
  let at = 0;
  const header = {};
  const parts = [];
  for (const [name, bytes] of tensors) {
    header[name] = { dtype: "F32", shape: [bytes.length / 4], data_offsets: [at, at + bytes.length] };
    parts.push(bytes);
    at += bytes.length;
  }
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  return new Uint8Array(Buffer.concat([length, json, ...parts]));
}

const alpha = Buffer.alloc(16, 1);
const beta = Buffer.alloc(8, 2);
const file = safetensors([["alpha", alpha], ["beta", beta]]);

const declared = readSafetensors(file);
assert.deepEqual(declared.map((t) => t.name), ["alpha", "beta"]);
assert.equal(declared[0].end - declared[0].begin, 16);
ok("the safetensors header declares two tensors at the offsets it says");

const addresses = tensorAddresses(file);
assert.equal(addresses.size, 2);
for (const address of addresses.values()) assert.match(address, /^blake3:[0-9a-f]{64}$/);
// The same bytes under another name have the same address: a UOR address is
// over content, not over where the content sits.
const renamed = tensorAddresses(safetensors([["gamma", alpha]]));
assert.equal(renamed.get("gamma"), addresses.get("alpha"));
ok("a tensor's address follows its bytes, not its name or its file");

const manifest = {
  tensors: [...addresses].map(([name, blake3]) => ({ file: "model.safetensors", name, dtype: "F32", shape: [1], blake3 })),
};
const whole = checkTensors(manifest, "model.safetensors", file);
assert.deepEqual(whole, { witnessed: true, total: 2, matched: 2, mismatched: [] });
ok("an untouched file matches every witnessed tensor");

// One byte, inside beta.
const damaged = new Uint8Array(file);
damaged[damaged.length - 1] ^= 0x01;
assert.equal(sha256(damaged) === sha256(file), false);
const after = checkTensors(manifest, "model.safetensors", damaged);
assert.equal(after.matched, 1);
assert.equal(after.mismatched.length, 1);
assert.equal(after.mismatched[0].name, "beta");
ok("one flipped byte is caught and attributed to the tensor that holds it");

const unknown = checkTensors(manifest, "other.safetensors", file);
assert.deepEqual(unknown, { witnessed: false, total: 0, matched: 0, mismatched: [] });
ok("a file the manifest does not name is unwitnessed, not a pass");

// A weight shard is gigabytes, so the runner checks tensors by reading each
// one's byte range rather than holding the file. It must agree with the
// in-memory check, down to which tensor is wrong, and with a chunk smaller
// than a tensor so the range is read in several reads.
const work = await mkdtemp(join(tmpdir(), "hub-uor-test-"));
const onDisk = join(work, "model.safetensors");
await writeFile(onDisk, file);
assert.deepEqual(await checkTensorsOfFile(manifest, "model.safetensors", onDisk, { chunk: 5 }), whole);
await writeFile(onDisk, damaged);
const streamed = await checkTensorsOfFile(manifest, "model.safetensors", onDisk, { chunk: 5 });
assert.equal(streamed.matched, 1);
assert.deepEqual(streamed.mismatched.map((m) => m.name), ["beta"]);
assert.deepEqual(await checkTensorsOfFile(manifest, "other.safetensors", onDisk),
                 { witnessed: false, total: 0, matched: 0, mismatched: [] });
await rm(work, { recursive: true, force: true });
ok("the same answer comes from the file without holding it");

// The git blob identity Hugging Face gives a small file, and the ETag HK-08
// hands back for one.
assert.equal(gitBlobSha1(Buffer.from("hello\n")), "ce013625030ba8dba906f756967f9e9ca394464a");
ok("the git blob identity of a small file matches git's own");

console.log(`tests/runner/uor: ${checks} checks passed`);
