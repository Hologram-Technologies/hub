// Gives every route of the hub's interface its own page, so a deep link is
// answered 200 with the interface rather than by the 404 fallback. Each page is
// the same shell (web/index.html); the renderer reads the route from the URL.
//
//   node tools/web-routes.mjs <site dir>
//
// The model pages are the ones this hub's own signed index holds, read from
// <site dir>/data/index/root.json, which is the same set the browse page draws
// and the edge answers for. It used to be whatever gethologram.ai's catalog
// listed, which meant the pages and the index could disagree. A model the
// index does not hold still opens, through 404.html.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [site] = process.argv.slice(2);
if (!site) {
  console.error("usage: node tools/web-routes.mjs <site dir>");
  process.exit(64);
}
const shell = await readFile(join(site, "index.html"), "utf8");
const routes = ["models", "docs", "registry", "apps", "buckets"];
try {
  const { records } = JSON.parse(await readFile(join(site, "data", "index", "root.json"), "utf8"));
  for (const { repo } of records) {
    if (/^[\w.-]+\/[\w.-]+$/.test(repo)) routes.push(`models/${repo}`);
  }
} catch (error) {
  console.warn(`web-routes: no model pages (${error.message}); deep links to models use 404.html`);
}
// Witnessed models get a page too, whether or not the index lists them.
try {
  const { manifests } = JSON.parse(await readFile(join(site, "data", "manifests", "index.json"), "utf8"));
  for (const { repo } of manifests) if (!routes.includes(`models/${repo}`)) routes.push(`models/${repo}`);
} catch {}
// Each page says where the hub's root is, in the markup. The shell works out
// the same base for a deep link that arrives through 404.html, but the
// browser's preload scanner reads the <link> tags before any script runs, so a
// page without a written base fetches its stylesheet and holo once from the
// wrong depth and then again from the right one.
const base = (route) => `<base href="${"../".repeat(route.split("/").length)}" />\n    `;
for (const route of routes) {
  await mkdir(join(site, route), { recursive: true });
  await writeFile(join(site, route, "index.html"), shell.replace("<script>", `${base(route)}<script>`));
}
console.log(`web-routes: ${routes.length} route pages`);
