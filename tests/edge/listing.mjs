// The listing answers from the index the way Hugging Face answers it. This
// runs the edge with Hugging Face unreachable and checks the query it claims
// to take: the row shape, the sorts, the filter, full, config, expand, the
// cursor, and the refusals Hugging Face makes.
//
//   node tests/edge/listing.mjs <holo url> <index url>
//
// The index may be unsigned here: this is a test of the answer, not of the
// signature, which `edge/edge.mjs` checks on every real start.
import { start, handle, adoptUnsignedIndexForTests } from "../../edge/edge.mjs";

const [holo, indexUrl] = process.argv.slice(2);
if (!holo || !indexUrl) {
  console.error("usage: node tests/edge/listing.mjs <holo url> <index url>");
  process.exit(64);
}
const ready = await start({ holo, index: indexUrl, huggingFace: false, drain: ["huggingface.co"] });
await adoptUnsignedIndexForTests(indexUrl);
console.log(`edge: ${ready.examples} examples replayed`);

const ask = async (path) => {
  const response = await handle(new Request(`http://edge/${path}`));
  return { status: response.status, link: response.headers.get("link"), code: response.headers.get("x-error-code"), body: await response.json().catch(() => null) };
};
const failures = [];
const check = (name, ok, saw) => (ok ? console.log(`ok   ${name}`) : failures.push(`${name}: ${saw}`));

// Hugging Face's own row, with no expansion: eleven fields, in its order.
const SHAPE = ["_id", "id", "likes", "trendingScore", "private", "downloads", "tags", "pipeline_tag", "library_name", "createdAt", "modelId"];
const plain = await ask("api/models?limit=3");
check("the listing answers", plain.status === 200 && Array.isArray(plain.body), `${plain.status}`);
check("a row is Hugging Face's row", JSON.stringify(Object.keys(plain.body?.[0] ?? {})) === JSON.stringify(SHAPE), JSON.stringify(Object.keys(plain.body?.[0] ?? {})));
check("limit is honoured", plain.body?.length === 3, String(plain.body?.length));

const sorted = await ask("api/models?sort=likes&limit=5");
const likes = (sorted.body ?? []).map((r) => r.likes);
check("sort=likes orders by likes", likes.every((n, i) => i === 0 || likes[i - 1] >= n), JSON.stringify(likes));
for (const name of ["downloads", "createdAt", "lastModified", "trendingScore"]) {
  const r = await ask(`api/models?sort=${name}&limit=2`);
  check(`sort=${name} is accepted`, r.status === 200, String(r.status));
}
const badSort = await ask("api/models?sort=trending");
check("an unknown sort is refused", badSort.status === 400 && badSort.code === "BadRequest", `${badSort.status} ${badSort.code}`);
const badDirection = await ask("api/models?direction=1");
check("direction=1 is refused", badDirection.status === 400, String(badDirection.status));
check("direction=-1 is accepted", (await ask("api/models?direction=-1&limit=1")).status === 200, "");

const filtered = await ask("api/models?filter=text-generation&limit=50");
check("filter keeps only rows with the tag", (filtered.body ?? []).length > 0 && filtered.body.every((r) => r.tags.includes("text-generation")), JSON.stringify((filtered.body ?? [])[0]?.tags));
const author = (plain.body ?? [])[0]?.id.split("/")[0];
const byAuthor = await ask(`api/models?author=${encodeURIComponent(author)}`);
check("author keeps only that owner", (byAuthor.body ?? []).every((r) => r.id.startsWith(`${author}/`)), String(byAuthor.body?.length));

const full = await ask("api/models?full=true&limit=1");
const FULL = ["_id", "id", "author", "gated", "lastModified", "likes", "trendingScore", "private", "sha", "downloads", "tags", "pipeline_tag", "library_name", "createdAt", "modelId", "siblings"];
check("full=true answers Hugging Face's sixteen fields, in its order", JSON.stringify(Object.keys(full.body?.[0] ?? {})) === JSON.stringify(FULL), JSON.stringify(Object.keys(full.body?.[0] ?? {})));
const config = await ask("api/models?config=true&limit=1");
check("config=true adds the configuration", "config" in (config.body?.[0] ?? {}), JSON.stringify(Object.keys(config.body?.[0] ?? {})));
const expanded = await ask("api/models?expand[]=downloadsAllTime&expand[]=lastModified&limit=1");
// Hugging Face answers an expansion with the identity, the key it sorted by
// and the fields asked for, in the record's own order (measured 2026-11-13).
check("expand names the fields, the sort key and nothing else", JSON.stringify(Object.keys(expanded.body?.[0] ?? {})) === JSON.stringify(["_id", "id", "lastModified", "trendingScore", "downloadsAllTime"]), JSON.stringify(Object.keys(expanded.body?.[0] ?? {})));

// The cursor: one page, then the next, with no row seen twice.
const first = await ask("api/models?limit=2");
check("a first page links to the next", Boolean(first.link?.includes('rel="next"')), String(first.link));
const next = first.link?.match(/<([^>]+)>/)?.[1];
const second = next ? await ask(next.replace("http://edge/", "")) : { body: [] };
const ids = new Set([...(first.body ?? []), ...(second.body ?? [])].map((r) => r.id));
check("the next page is new rows", ids.size === (first.body?.length ?? 0) + (second.body?.length ?? 0), `${ids.size} of ${(first.body?.length ?? 0) + (second.body?.length ?? 0)}`);

const tags = await ask("api/models-tags-by-type");
check("the tag taxonomy answers", tags.status === 200 && Array.isArray(tags.body?.pipeline_tag), `${tags.status} ${JSON.stringify(Object.keys(tags.body ?? {}))}`);
const quick = await ask(`api/quicksearch?q=${encodeURIComponent((plain.body?.[0]?.id ?? "").split("/")[1] ?? "a")}&type=model`);
check("quicksearch answers", quick.status === 200 && Array.isArray(quick.body?.models), `${quick.status}`);

const repo = plain.body?.[0]?.id;
const commits = await ask(`api/models/${repo}/commits/main`);
check("commits answers with the release", commits.status === 200 && commits.body?.[0]?.id?.length === 40, `${commits.status} ${JSON.stringify(commits.body?.[0])}`);

console.log(failures.length ? `\n${failures.map((f) => `FAIL ${f}`).join("\n")}` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
