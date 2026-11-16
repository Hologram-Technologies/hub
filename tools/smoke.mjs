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
  ["", ".land-title"],
  ["models/", ".card"],
  ["models/openai-community/gpt2/", ".model-head h1"],
  ["docs/", "#answers table"],
  ["spaces/", ".grid.spaces .card"],
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
// The theme panel, which is the one place on the site where a control's label
// has to fit a box that does not grow with it. "Immersive" was drawn "Immer.."
// until 2026-11-16, at which point the word naming what the pictures below are
// for could not be read. A width is a thing that drifts, so this measures the
// words rather than trusting the stylesheet: every label must fit the box it is
// in, at the narrowest width the panel is drawn at and at the widest.
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const where = `${new URL("", base).href} at ${w}x${h}`;
  try {
    await page.goto(new URL("", base).href, { waitUntil: "domcontentloaded" });
    // Narrow, the whole group folds into a panel behind the menu button, and
    // the theme control is inside it: it has to be opened before the control
    // it holds exists to be clicked.
    await page.waitForSelector("#theme-menu", { state: "attached", timeout: 30000 });
    if (await page.isVisible("#menu-button")) await page.click("#menu-button");
    await page.waitForSelector("#theme-button", { state: "visible", timeout: 30000 });
    await page.click("#theme-button");
    await page.waitForSelector("#theme-menu .mode", { state: "visible", timeout: 30000 });
    const clipped = await page.$$eval("#theme-menu .mode span, #theme-menu .panel-head, .credit", (els) => els
      .filter((el) => el.getBoundingClientRect().width > 0)
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.textContent.trim()} (${el.scrollWidth} into ${el.clientWidth})`));
    if (clipped.length) failures.push(`${where}: clipped: ${clipped.join(", ")}`);
    else console.log(`ok   ${where}: every theme label fits`);
    // And the panel offers what the spec says it offers, drawn from the kernel.
    const tiles = await page.$$eval("#photos .photo", (els) => els.length);
    if (tiles !== 6) failures.push(`${where}: ${tiles} pictures in the panel, expected 6`);
    else console.log(`ok   ${where}: six pictures`);
    // Every picture is an Unsplash photo, so the credit must name someone.
    const credit = (await page.textContent(".credit"))?.trim() ?? "";
    if (!/^Photo by \S.*on\s+Unsplash$/.test(credit.replace(/\s+/g, " "))) failures.push(`${where}: credit reads ${JSON.stringify(credit)}`);
    else console.log(`ok   ${where}: ${credit.replace(/\s+/g, " ")}`);
  } catch (error) {
    failures.push(`${where}: ${error.message.split("\n")[0]}`);
  }
  await page.close();
}

await browser.close();
for (const failure of failures) console.error(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
