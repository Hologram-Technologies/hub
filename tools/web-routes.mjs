// Gives every route of the hub's interface its own page, so a deep link is
// answered 200 with the interface rather than by the 404 fallback. Each page is
// the same shell (web/index.html); the renderer reads the route from the URL.
//
//   node tools/web-routes.mjs <site dir> <hub API origin>
//
// The model pages are the ones the hub's catalog lists when the site is built.
// A model added later still opens, through 404.html.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [site, api] = process.argv.slice(2);
if (!site || !api) {
  console.error("usage: node tools/web-routes.mjs <site dir> <hub API origin>");
  process.exit(64);
}
const shell = await readFile(join(site, "index.html"));
const routes = ["models", "docs", "registry", "apps", "buckets"];
try {
  const response = await fetch(`${api}/api/models?limit=500`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`the hub answered ${response.status}`);
  for (const { id } of await response.json()) {
    if (/^[\w.-]+\/[\w.-]+$/.test(id)) routes.push(`models/${id}`);
  }
} catch (error) {
  console.warn(`web-routes: no model pages (${error.message}); deep links to models use 404.html`);
}
// Witnessed models get a page too, whether or not the catalog lists them.
try {
  const { manifests } = JSON.parse(await readFile(join(site, "data", "manifests", "index.json"), "utf8"));
  for (const { repo } of manifests) if (!routes.includes(`models/${repo}`)) routes.push(`models/${repo}`);
} catch {}
for (const route of routes) {
  await mkdir(join(site, route), { recursive: true });
  await writeFile(join(site, route, "index.html"), shell);
}
console.log(`web-routes: ${routes.length} route pages`);
