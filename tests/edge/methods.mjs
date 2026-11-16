// The edge is read-only, and must say so the same way on every route: a write
// is refused with the kernel's invalid-request answer, never answered as if it
// were a read. And a HEAD on a passed-through route answers what its GET does,
// without a body.
//
//   node tests/edge/methods.mjs <holo url> <index url>
//
// Regression test for PUT, DELETE and PATCH on /api/models/... answering 200
// with the model (huggingface.co answers 404), and for HEAD on a passed-through
// model list answering 502 because the edge parsed an empty body as JSON.
import { start, handle } from "../../edge/edge.mjs";

const [holo, indexUrl] = process.argv.slice(2);
if (!holo || !indexUrl) {
  console.error("usage: node tests/edge/methods.mjs <holo url> <index url>");
  process.exit(64);
}
const failures = [];
const check = (name, ok, saw) => (ok ? console.log(`ok   ${name}`) : failures.push(`${name}: ${saw}`));

await start({ holo, index: indexUrl, huggingFace: true, drain: [] });
const MODEL = "openai-community/gpt2";
const routes = [
  `/api/models/${MODEL}`,
  `/api/models/${MODEL}/tree/main`,
  `/api/models/${MODEL}/refs`,
  `/api/models?search=gpt2&limit=1`,
  `/${MODEL}/resolve/main/config.json`,
];
for (const path of routes) {
  for (const method of ["PUT", "DELETE", "PATCH", "POST"]) {
    const r = await handle(new Request(`http://edge${path}`, { method, body: method === "DELETE" ? undefined : "{}" }));
    check(`${method} ${path} is refused`, r.status === 400, `${r.status} ${r.headers.get("x-error-code") ?? ""}`);
  }
}
const post = await handle(new Request(`http://edge/api/models/${MODEL}/paths-info/main`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "paths=config.json" }));
check("POST paths-info, the one read Hugging Face sends as a POST, still answers", post.status === 200, `${post.status}`);

for (const path of [`/api/models?search=gpt2&limit=1`, `/api/models/${MODEL}`]) {
  const get = await handle(new Request(`http://edge${path}`));
  const head = await handle(new Request(`http://edge${path}`, { method: "HEAD" }));
  const body = head.body ? await head.arrayBuffer() : new ArrayBuffer(0);
  check(`HEAD ${path} answers as GET does, without a body`, head.status === get.status && body.byteLength === 0, `HEAD ${head.status}, GET ${get.status}, ${body.byteLength} bytes`);
}
console.log(failures.length ? `\n${failures.map((f) => `FAIL ${f}`).join("\n")}` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
