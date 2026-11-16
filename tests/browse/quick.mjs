// The built quicksearch index, against the rule that wrote it.
//
//   node tests/browse/quick.mjs <browse index dir>
//
// `crates/conformance/tests/index.rs` (HK-23) checks that the builder and the
// page share one rule by reading both files. This checks the other half: that
// the artifact on disk obeys it. A rule both sides agree on is no use if what
// was written does not follow it.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { QUICK_ROWS, bucketOf, quickWords, suggests } from "../../web/browsekey.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node tests/browse/quick.mjs <browse index dir>");
  process.exit(64);
}
const failures = [];
const check = (name, ok, saw) => (ok ? console.log(`ok   ${name}`) : failures.push(`${name}: ${saw}`));

const root = JSON.parse(await readFile(join(dir, "root.json"), "utf8"));
const quick = root.search?.quick;
check("the root names a quicksearch index", Boolean(quick), "it does not");
if (!quick) { console.error(failures.join("\n")); process.exit(1); }

check("ranked by the order the Models page shows first", quick.sort === "trending", quick.sort);
check("the cap it was built with is the cap the page reads", quick.rows === QUICK_ROWS, `${quick.rows} against ${QUICK_ROWS}`);

const files = (await readdir(join(dir, "search", "quick"))).filter((f) => f.endsWith(".bin"));
check("every bucket the root sizes has a file", files.length === Object.keys(quick.sizes).length,
  `${files.length} files against ${Object.keys(quick.sizes).length} sized`);

// Every name in a bucket's file must have a word that falls in that bucket.
// A name that does not is a name the page will never look for there.
let rows = 0, misfiled = 0, over = 0, firstMisfiled = "";
for (const file of files) {
  const key = file.slice(0, -4);
  const names = (await readFile(join(dir, "search", "quick", file), "utf8")).split("\n").filter(Boolean);
  rows += names.length;
  if (names.length > QUICK_ROWS) over += 1;
  for (const id of names) {
    if (!quickWords(id).some((w) => bucketOf(w) === key)) {
      misfiled += 1;
      if (!firstMisfiled) firstMisfiled = `${id} is in ${key}`;
    }
  }
}
check("no bucket holds more than the cap", over === 0, `${over} buckets do`);
check("every name is filed under a word of its own", misfiled === 0, firstMisfiled || `${misfiled} are not`);

// The rule the page resolves by must find, in the bucket it reads, the names
// the builder put there. One exact id is the sharpest case: its own bucket has
// to hold it, or the box cannot offer a model by its own name.
const sizes = Object.entries(quick.sizes).sort((a, b) => b[1] - a[1]);
const [biggest] = sizes[0];
const names = (await readFile(join(dir, "search", "quick", `${biggest}.bin`), "utf8")).split("\n").filter(Boolean);
const sample = names.slice(0, 25);
let found = 0;
for (const id of sample) {
  const terms = quickWords(id).filter((w) => bucketOf(w) === biggest);
  if (terms.length && suggests(id, [terms[0]]) && bucketOf(terms[0]) === biggest) found += 1;
}
check("the page's own rule finds them where the builder put them", found === sample.length,
  `${found} of ${sample.length} in ${biggest}`);

console.log(`quick: ${files.length} buckets, ${rows} names, ${(quick.bytes / 1e6).toFixed(1)} MB, largest ${(quick.largest / 1e3).toFixed(0)} kB`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
