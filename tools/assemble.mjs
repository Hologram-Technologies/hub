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
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const [out = "preview", origin = "https://gethologram.ai"] = process.argv.slice(2);
const builds = join("app", ".prism", "build");
let holo;
try {
  for (const dir of await readdir(builds)) {
    for (const file of await readdir(join(builds, dir))) if (file.endsWith(".holo")) holo = join(builds, dir, file);
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

for (const tool of ["web-data.mjs", "web-routes.mjs"]) {
  const run = spawnSync(process.execPath, [join("tools", tool), out, origin], { stdio: "inherit" });
  if (run.status !== 0) process.exit(run.status ?? 70);
}
console.log(`assemble: ${out} ready from ${holo}`);
