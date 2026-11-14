// The answers the local runner depends on, asked of the real kernel.
//
// Lean proves these properties for every input; this pins the answers for the
// handful of inputs the runner is built around, so a kernel that still
// verified but decided something else would fail here rather than silently
// change what the runner does.
//
//   node tests/runner/kernel.mjs <holo url>
import assert from "node:assert/strict";
import { load } from "../../try/vendor/prism-code/src/browser.mjs";

const [holo] = process.argv.slice(2);
if (!holo) {
  console.error("usage: node tests/runner/kernel.mjs <holo url>");
  process.exit(64);
}

let checks = 0;
const ok = (what) => { checks += 1; console.log(`  ok  ${what}`); };

const kernel = await load(holo);
if (!kernel.identities.verified) throw new Error("the kernel's holo failed its identity check");
const replay = await kernel.acceptance();
assert.equal(replay.passed, replay.total);
ok(`the holo replayed all ${replay.total} of its examples`);

const COMMIT = "607a30d783dfa663caf39e06633721c8d4cfcd7e";
const enc = new TextEncoder();

// runner 0 edge, 1 local. entry 0 missing, 1 small, 2 large - which decides the
// ETag, not eligibility. `addressed` is the separate fact that decides whether a
// source nobody vetted may serve the file; it defaults to what `entry` used to
// imply, so a case that does not mention it means what it always meant.
// Each source is [holds, healthy, vetted, failed].
function resolve({ runner = 1, repo = 0, refFound = 1, entry = 2, pin = 0, sources = [], addressed = null }) {
  const b = new Uint8Array(105);
  b.set([1, runner, repo, 0, refFound, 0, entry, pin]);
  b[104] = addressed === null ? (entry === 2 ? 1 : 0) : addressed;
  sources.forEach((s, i) => b.set(s, 8 + 4 * i));
  b.set(enc.encode(COMMIT), 64);
  return b;
}
const answer = async (request) => [...(await kernel.dispatch(request))];

const VETTED = [1, 1, 1, 0];
const UNVETTED = [1, 1, 0, 0];
const EMPTY = [0, 0, 0, 0];

// HK-03: a local runner is told to serve, never to redirect; the edge the
// opposite. The runner's whole file path rests on this.
assert.deepEqual(await answer(resolve({ runner: 1, sources: [VETTED] })), [2, 0, 2]);
assert.deepEqual(await answer(resolve({ runner: 0, sources: [VETTED] })), [1, 0, 2]);
ok("HK-03: the local runner is answered serve and the edge redirect");

// HK-04: the edge is never given an unvetted source, whatever it holds.
assert.deepEqual(await answer(resolve({ runner: 0, sources: [UNVETTED] })), [17, 4, 0]);
ok("HK-04: the edge is refused an unvetted source rather than redirected to it");

// HK-19: the local runner may use an unvetted source, but only for a file the
// record addresses. This is what makes the swarm safe to fetch from: whatever
// arrives can be checked.
assert.deepEqual(await answer(resolve({ runner: 1, entry: 2, sources: [UNVETTED] })), [2, 0, 2]);
assert.deepEqual(await answer(resolve({ runner: 1, entry: 1, sources: [UNVETTED] })), [17, 4, 0]);
ok("HK-19: an unvetted source serves an addressed file and is refused an unaddressed one");

// A vetted source is unaffected by the address: a small file still comes from
// one, with the git blob ETag.
assert.deepEqual(await answer(resolve({ runner: 1, entry: 1, sources: [VETTED] })), [2, 0, 1]);
ok("HK-08: a vetted source still serves a small file, with the git blob ETag");

// HK-05: a source that failed verification for this file is never chosen
// again, which is how the runner fails over after bad bytes.
assert.deepEqual(await answer(resolve({ sources: [[1, 1, 1, 1], VETTED] })), [2, 1, 2]);
assert.deepEqual(await answer(resolve({ sources: [[1, 1, 1, 1]] })), [17, 4, 0]);
ok("HK-05: a source that failed for this file is passed over, and refused when it is the only one");

// HK-07: a healthy source is preferred, and an unhealthy one is still used
// when nothing healthy is left.
assert.deepEqual(await answer(resolve({ sources: [[1, 0, 1, 0], VETTED] })), [2, 1, 2]);
assert.deepEqual(await answer(resolve({ sources: [[1, 0, 1, 0], EMPTY] })), [2, 0, 2]);
ok("HK-07: a healthy source is preferred, and an unhealthy one is a last resort");

// HK-06: a pin is the only source that may be chosen, and the swarm pinned for
// a file with no address is refused rather than quietly served from elsewhere.
assert.deepEqual(await answer(resolve({ pin: 2, sources: [VETTED, VETTED] })), [2, 1, 2]);
assert.deepEqual(await answer(resolve({ pin: 1, sources: [UNVETTED, VETTED], entry: 1 })), [17, 4, 0]);
assert.deepEqual(await answer(resolve({ pin: 5, sources: [VETTED] })), [15, 4, 0]);
ok("HK-06: a pin is the only source the kernel may choose, and an unknown one is named as such");

// The fourth slot exists and is reachable, which is what makes room for the
// swarm without widening the request.
assert.deepEqual(await answer(resolve({ sources: [EMPTY, EMPTY, EMPTY, UNVETTED] })), [2, 3, 2]);
ok("the fourth source slot is reachable, so the swarm needs no new slot");

console.log(`tests/runner/kernel: ${checks} checks passed`);
