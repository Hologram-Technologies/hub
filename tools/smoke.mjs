// Opens the published interface in a real browser and fails unless each page
// loads the kernel, replays every example the holo carries, and draws its
// screen. Run after each deploy:
//
//   node tools/smoke.mjs https://hologram-technologies.github.io/hub/
//
// Needs playwright with Chromium (npm install -g playwright, playwright install chromium).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const base = process.argv[2];
if (!base) {
  console.error("usage: node tools/smoke.mjs <site URL>");
  process.exit(64);
}
const playwright = await import("playwright").catch(() =>
  import(pathToFileURL(join(execSync("npm root -g").toString().trim(), "playwright", "index.mjs")).href));
const examples = JSON.parse(readFileSync(new URL("../app/tools/vectors.json", import.meta.url), "utf8")).length;

// Each page, and the element that shows its screen was drawn from the kernel.
const pages = [
  ["", ".hero h1"],
  ["models/", ".card"],
  ["models/openai-community/gpt2/", ".head h1"],
  ["docs/", "#answers table"],
  ["registry/", ".card.entry"],
  ["apps/", ".card.app"],
  ["buckets/", "#check"],
  // A witnessed model: its signature, made by this deploy, must check out.
  ["models/BAAI/bge-small-en-v1.5/", "#signed.s1"],
];
const browser = await playwright.chromium.launch();
const failures = [];
for (const [path, drawn] of pages) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const url = new URL(path, base).href;
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (response.status() !== 200) failures.push(`${url}: HTTP ${response.status()}`);
    await page.waitForSelector(drawn, { timeout: 30000 });
    await page.waitForFunction(() => /of \d+ examples hold/.test(document.querySelector("#proof-text")?.textContent ?? ""), null, { timeout: 30000 });
    const chip = await page.textContent("#proof-text");
    const [, passed, total] = chip.match(/(\d+) of (\d+) examples hold/);
    if (+passed !== examples || +total !== examples) failures.push(`${url}: ${chip}, expected ${examples} of ${examples}`);
    else console.log(`ok   ${url}: ${chip}`);
  } catch (error) {
    failures.push(`${url}: ${error.message.split("\n")[0]}`);
  }
  for (const message of errors) failures.push(`${url}: page error: ${message}`);
  await page.close();
}
await browser.close();
for (const failure of failures) console.error(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
