// The edge is deployed apart from the kernel, so it must start against a holo
// older than itself. This checks that: the published kernel, whatever it
// knows, must let the edge answer an indexed model.
//
//   node tests/edge/older-kernel.mjs <holo url> <index url>
//
// It is the regression test for a start that read the record block from a
// screen that did not carry one and threw before the first request.
import { start, handle } from "../../edge/edge.mjs";

const [holo, indexUrl] = process.argv.slice(2);
if (!holo || !indexUrl) {
  console.error("usage: node tests/edge/older-kernel.mjs <holo url> <index url>");
  process.exit(64);
}
const failures = [];
const check = (name, ok, saw) => (ok ? console.log(`ok   ${name}`) : failures.push(`${name}: ${saw}`));

let ready;
try {
  ready = await start({ holo, index: indexUrl, huggingFace: false, drain: ["huggingface.co"] });
  check("the edge starts against the published kernel", true, "");
} catch (error) {
  failures.push(`the edge starts against the published kernel: ${error.message}`);
}
if (ready) {
  check("and opens the signed index", ready.index.includes("models"), ready.index);
  const health = await handle(new Request("http://edge/health"));
  const body = await health.json();
  check("and answers health", health.status === 200 && body.kernel === true, `${health.status} ${JSON.stringify(body)}`);
}
console.log(failures.length ? `\n${failures.map((f) => `FAIL ${f}`).join("\n")}` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
