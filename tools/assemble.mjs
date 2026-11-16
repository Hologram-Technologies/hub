// Assembles the whole site the way the Pages workflow does, for a local look:
// the interface at the root, the proof page under app/ with the holo this
// repository just built, a page per route, and the copied catalog, registry
// and apps lists.
//
//   node tools/assemble.mjs [out dir] [hub origin]
//
// The witnessed manifests and the signed index are not built here: they take a
// long download and a signature this workflow alone can make, so a model page
// previewed locally says it is not signed yet.
import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const [out = "preview", origin = "https://gethologram.ai"] = process.argv.slice(2);
const builds = join("app", ".prism", "build");
// The newest holo, by when it was written. A build directory is named by the
// digest of its inputs, so proving a changed model leaves the previous build
// beside the new one; taking whichever name happened to come last would hand
// the preview a stale kernel and no error, which is the one failure a preview
// must not have. Measured once the hard way: a page drawn from a holo built
// before the screen it was meant to show.
let holo = null;
let newest = -1;
try {
  for (const dir of await readdir(builds)) {
    for (const file of await readdir(join(builds, dir))) {
      if (!file.endsWith(".holo")) continue;
      const path = join(builds, dir, file);
      const at = (await stat(path)).mtimeMs;
      if (at > newest) { newest = at; holo = path; }
    }
  }
} catch {}
if (!holo) {
  console.error("assemble: no holo in app/.prism/build; run the app's build first (just app, in the SDK image)");
  process.exit(69);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp("web", out, { recursive: true });
await cp("site", join(out, "app"), { recursive: true });
await cp(holo, join(out, "app", "app.holo"));
await cp(join("try", "vendor"), join(out, "app", "vendor"), { recursive: true });
await rm(join(out, "app", "vendor", "prism-code", "fixtures"), { recursive: true, force: true });

// Both tools read the signed index from <out>/data/index, which this preview
// does not build, so they say so and the preview shows no owner marks and no
// model pages. Only web-data still needs an origin, for the registry and the
// apps list.
for (const [tool, args] of [["web-data.mjs", [out, origin]], ["web-routes.mjs", [out]]]) {
  const run = spawnSync(process.execPath, [join("tools", tool), ...args], { stdio: "inherit" });
  if (run.status !== 0) process.exit(run.status ?? 70);
}
console.log(`assemble: ${out} ready from ${holo}`);
