// The hub's renderer. It decides nothing about the hub: every label, route,
// link, facet, sort and command comes from the proved kernel, which serves each
// screen from `app/src/Site.lex.tex`. This file loads that kernel's holo,
// checks it, asks it for screens, reads the catalog, and draws. The markup and
// classes are gethologram.ai's, so the two sites look and behave alike.

import { load } from "./app/vendor/prism-code/src/browser.mjs";
import { blake3Hex } from "./app/vendor/prism-code/src/blake3.mjs";
import { verifyBundle } from "./sigstore.mjs";
import { openBrowse } from "./browse.mjs";
import { ICON, art } from "./icons.mjs";
import { swarmKeyOf } from "./swarmkey.mjs";

const root = new URL(".", import.meta.url);
const html = document.documentElement;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fill = (t, vars) => String(t).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const marked = (svg, attrs) => svg.replace('class="i"', `class="i ${attrs}"`);

// ---------------------------------------------------------------- the kernel
let kernel, chrome;
const screens = {};
const decoder = new TextDecoder();

async function boot() {
  kernel = await load(new URL("app/app.holo", root).href);
  if (!kernel.identities.verified) throw new Error("the kernel's holo failed its identity check");
  const routes = ["chrome", "home", "models", "model", "docs", "registry", "apps", "buckets"];
  for (const [i, name] of routes.entries()) screens[name] = JSON.parse(decoder.decode(await kernel.dispatch(new Uint8Array([3, i]))));
  chrome = screens.chrome;
  drawChrome();
  addEventListener("popstate", route);
  document.addEventListener("click", onClick);
  await route();
  // Every example the holo carries is replayed here, after first paint.
  const run = await kernel.acceptance();
  const status = $("#proof");
  status.classList.remove("wait");
  status.classList.toggle("bad", run.passed !== run.total);
  $("#proof-text").textContent = `${chrome.proof} · ${fill(chrome.proofDetail, run)}`;
}

// ---------------------------------------------------------------- numbers
const trim = (n) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ""));
// The source the roll's models come from. Named here rather than written out
// at the one place that asks it, so a reader can see what the page calls.
const HF_API = "https://huggingface.co";
const count = (n = 0) => (n >= 1e6 ? `${trim(n / 1e6)}M` : n >= 1e3 ? `${trim(n / 1e3)}k` : String(n));
const params = (n) => (!n ? "" : n >= 1e12 ? `${trim(n / 1e12)}T` : n >= 1e9 ? `${trim(n / 1e9)}B` : n >= 1e6 ? `${Math.round(n / 1e6)}M` : `${Math.round(n / 1e3)}K`);
const context = (n) => (!n ? "" : n >= 1048576 ? `${trim(n / 1048576)}M` : `${Math.round(n / 1024)}K`);
const bytes = (n = 0) => (n >= 1e12 ? `${trim(n / 1e12)} TB` : n >= 1e9 ? `${trim(n / 1e9)} GB` : n >= 1e6 ? `${trim(n / 1e6)} MB` : n >= 1e3 ? `${trim(n / 1e3)} kB` : `${n} B`);
const month = (d) => (d ? new Date(d).toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" }) : "");
const words = (s) => String(s ?? "").replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
// A facet's value is the one a link carries, which is Hugging Face's:
// `text-generation`, `en`. The page says it the way a reader would.
const LANGUAGE = new Intl.DisplayNames(["en"], { type: "language" });
const titled = (s) => String(s).replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bTo\b/g, "to");
// The name a reader knows a source by. The screen carries the pairs, so
// the page invents none: a kind it has no name for is shown as it is.
let sourceNames;
function sourceName(kind) {
  sourceNames ??= new Map(screens.models?.sourceNames ?? []);
  return sourceNames.get(kind) ?? kind;
}

function said(key, value) {
  if (key === "task") return titled(value);
  // A source is shown by the name a reader knows it by, not by the kind the
  // wire uses. A kind the screen has no name for is shown as it is.
  if (key === "sources") return sourceName(value);
  if (key === "languages") { try { return titled(LANGUAGE.of(value)); } catch { return value; } }
  return value;
}

// ---------------------------------------------------------------- data
// The browse list comes from the signed index, the same one an agent reads
// through the edge, so a model is listed here exactly when a tool can fetch
// it. The root names each shard by the hash of its bytes; a shard is drawn
// only when the bytes agree, judged by the kernel's accept rule (HK-10). The
// signature over the root is checked when the deploy left one, and the page
// says which of the two it is holding.
let catalogRequest;
let listing = { signed: false, rows: 0, shards: 0, rules: "" };
function catalog() {
  catalogRequest ??= readIndex();
  return catalogRequest;
}
const indexUrl = (path) => new URL(`data/index/${path}`, root);

// ---------------------------------------------------------------- the swarm
// Models the swarm lists that this hub does not index. There are far more of
// them than the hub holds - about 300 MB of rows against the index's 263 KB -
// so they are never all loaded. They are sharded by the first two characters
// of the model's name and a search reads the one shard its query begins with,
// about 450 KB. A shard is used only when its bytes are the ones the root
// names, judged by the same accept rule the browse shards are (`HK-10`).
//
// None of it is checked by this hub and the page says so. A row here means
// the swarm listed it, nothing more.
const swarmUrl = (path) => new URL(`data/swarm/catalog/${path}`, root);
let swarmRequest;
const swarmShards = new Map();
function swarmCatalog() {
  swarmRequest ??= (async () => {
    try {
      const r = await fetch(swarmUrl("root.json"));
      if (!r.ok) return null;
      const json = await r.json();
      return json?.format === "hologram.hub.swarmcatalog/v1" ? json : null;
    } catch {
      return null;
    }
  })();
  return swarmRequest;
}


// One shard, checked against the root before a row of it is used, the same
// accept rule a browse shard goes through.
function swarmShard(shard) {
  if (!swarmShards.has(shard.path)) {
    swarmShards.set(shard.path, (async () => {
      const body = new Uint8Array(await (await fetch(swarmUrl(shard.path))).arrayBuffer());
      if (!(await addressed(body, shard.sha256))) throw new Error(`the swarm shard ${shard.path} does not match its root`);
      return JSON.parse(new TextDecoder().decode(body));
    })());
  }
  return swarmShards.get(shard.path);
}

// The most seeded page, read once. This is what a reader sees of the swarm
// before they have asked for anything, and it is about the size of this hub's
// own index shard rather than the whole 300 MB catalog.
async function swarmTop() {
  const cat = await swarmCatalog();
  if (!cat?.rank?.length) return [];
  return swarmShard(cat.rank[0]);
}

// The shard a query belongs to. `swarmKeyOf` is the builder's own filing
// rule, imported rather than restated: a shard is only worth reading if it is
// the one the row was written to, and two spellings of the rule would lose
// rows silently.
async function swarmByName(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const cat = await swarmCatalog();
  const shard = (cat?.name ?? []).find((x) => x.prefix === swarmKeyOf(q));
  return shard ? swarmShard(shard) : [];
}

async function readIndex() {
  const bytes = new Uint8Array(await (await fetch(indexUrl("root.json"))).arrayBuffer());
  const rootJson = JSON.parse(new TextDecoder().decode(bytes));
  listing.rules = rootJson.rules ?? "";
  listing.signed = await indexSigned(bytes);
  const rows = [];
  for (const shard of rootJson.browse ?? []) {
    const body = new Uint8Array(await (await fetch(indexUrl(shard.path))).arrayBuffer());
    if (!(await addressed(body, shard.sha256))) throw new Error(`the index shard ${shard.path} does not match the signed root`);
    rows.push(...JSON.parse(new TextDecoder().decode(body)));
    listing.shards += 1;
  }
  // Counted before the swarm is merged: this is what the signed root covers,
  // and the pill that reports it would otherwise claim rows no signature
  // stands behind.
  listing.rows = rows.length;
  // Pirate Face's most seeded, merged in as ordinary rows. A release this hub
  // has indexed wins: its row is the one with addresses and signatures behind
  // it, and the swarm's copy of the same id would say less.
  await mergeSwarm(rows, await swarmTop().catch(() => []));
  const faces = await fetch(new URL("data/avatars/index.json", root)).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  for (const m of rows) {
    m.avatar = faces[m.org] ?? null;
    dress(m);
  }
  return rows;
}

// Rows the swarm lists, added to the hub's own. Returns how many were new, so
// a caller can tell whether anything changed and avoid a redraw that would
// move the page under someone's cursor.
const swarmSeen = new Set();
async function mergeSwarm(rows, found) {
  const known = new Set(rows.map((m) => m.id.toLowerCase()));
  let added = 0;
  for (const m of found) {
    const key = m.id.toLowerCase();
    if (known.has(key) || swarmSeen.has(key)) continue;
    swarmSeen.add(key);
    rows.push(m);
    added += 1;
  }
  return added;
}

// What `catalog()` does to every row after loading. A shard read later must
// go through the same thing, or a row added by a search would be missing the
// fields the card and the sorts read.
function dress(m) {
  const s = screens.models;
  const label = Object.fromEntries(s.statuses);
  const now = Date.now();
  m.likes = m.observed?.likes ?? 0;
  m.downloads = m.observed?.downloads ?? 0;
  m.status = label[m.state] ?? label.pending;
  const age = m.created ? (now - Date.parse(m.created)) / 864e5 : Infinity;
  m.recency = s.recency.filter(([, days]) => age <= days).map(([l]) => l);
  m.isNew = age <= s.newDays;
  return m;
}

// The whole roll, read a page at a time. The index's browse shards are the
// addressed models and fit in memory; the roll is every model Hugging Face has
// ever listed and does not, so when it is published the catalogue comes from
// there instead and the interface asks for one page at a time.
//
// A roll row knows less than an addressed one, and the difference is shown
// rather than smoothed over: no manifest, no sources, and the status is
// Unverified, because knowing a model exists is not the same as having
// checked a byte of it.
let rollSource;
async function openRoll() {
  if (rollSource !== undefined) return rollSource;
  rollSource = null;
  try {
    const index = await openBrowse(new URL("data/browse/", root).href);
    if (index) rollSource = index;
  } catch {
    // No roll published, or it could not be read: the addressed index below
    // is the catalogue, which is what every deploy before this one shipped.
  }
  return rollSource;
}

// A roll row as the cards and the filters want it. The dictionaries turn the
// numbers back into the words the panel shows.
function fromRoll(r, index, faces, s, now) {
  // A roll row: id, revision, created, first seen, last seen, state, browse.
  const [id, revision, created, , , , b] = r;
  const d = index.dictionaries;
  const F = index.field;
  const at = (name, dict) => (b?.[F[name]] == null ? null : dict[b[F[name]]] ?? null);
  const day = (n) => (n == null ? null : new Date(n * 864e5).toISOString().slice(0, 10));
  const org = id.slice(0, id.indexOf("/"));
  const createdAt = new Date(created * 1000).toISOString().slice(0, 10);
  const age = (now - created * 1000) / 864e5;
  return {
    id, org, author: org, name: id.slice(org.length + 1), revision,
    manifest: null, sources: [], files: 0, weightBytes: 0, gated: false,
    created: createdAt,
    modified: day(b?.[F.modified]) ?? createdAt,
    task: at("task", d.task),
    library: at("library", d.library),
    license: at("license", d.license),
    languages: (b?.[F.languages] ?? []).map((v) => d.language[v]).filter(Boolean),
    params: b?.[F.parameters] ?? 0,
    likes: b?.[F.likes] ?? 0,
    downloads: b?.[F.downloads] ?? 0,
    trending: b?.[F.trending] ?? 0,
    // Every facet the roll does not carry is absent rather than guessed.
    modality: null, arch: null, family: null, format: null, bucket: null,
    state: "skipped",
    status: Object.fromEntries(s.statuses).skipped ?? "Unverified",
    avatar: faces[org] ?? null,
    isNew: age <= s.newDays,
    recency: s.recency.filter(([, days]) => age <= days).map(([l]) => l),
    observed: { source: "https://huggingface.co", downloads: b?.[F.downloads] ?? 0, likes: b?.[F.likes] ?? 0 },
  };
}

// The kernel decides whether these are the addressed bytes, the same rule a
// download goes through.
async function addressed(body, expected) {
  if (!/^[0-9a-f]{64}$/.test(expected ?? "")) return false;
  const observed = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
  const request = new Uint8Array(81);
  request.set([2]); request.set(hex(expected), 1); request.set(observed, 33);
  request.set(u64(body.length), 65); request.set(u64(body.length), 73);
  return (await kernel.dispatch(request))[0] === 20;
}

// The signature over the root, checked the way a model's manifest is: the
// pinned Sigstore roots from screen 3, then the kernel's trust rule.
async function indexSigned(bytes) {
  const t = screens.model.trust;
  const bundle = await fetch(indexUrl("index.sigstore.json")).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!bundle) return false;
  const facts = await verifyBundle(bundle, bytes, { ...t.policy, predicateType: t.policy.indexPredicateType }).catch(() => null);
  const request = new Uint8Array(11);
  request[0] = 5;
  request[1] = 1;
  CHECKS.forEach((c, i) => { request[2 + i] = facts?.[c] ? 1 : 0; });
  request[9] = 1;
  request[10] = 0;
  return (await kernel.dispatch(request))[0] === 1;
}

// A model outside the copied catalog, from the hub's own API, in the catalog's shape.
function fromApi(row) {
  const [org, name] = row.id.split("/");
  const h = row.hologram ?? {};
  return {
    id: row.id, org, name, likes: row.likes ?? 0, downloads: row.downloads ?? 0, created: row.createdAt,
    task: row.pipeline_tag, library: row.library_name, license: (row.tags ?? []).find((t) => t.startsWith("license:"))?.slice(8),
    params: h.parameters, context: h.context, sources: h.sources ?? [], manifest: h.manifest, files: h.files,
    weightBytes: h.weight_bytes, revision: row.sha, gated: row.gated, state: (h.files ?? 0) > 0 ? "addressed" : "pending",
  };
}
const verified = (m) => m.state === "addressed";
const statusLabel = (m) => Object.fromEntries(screens.models.statuses)[m.state] ?? "";

// ---------------------------------------------------------------- routing
const href = (path) => new URL(path, root).pathname;
function path() {
  const base = root.pathname;
  return location.pathname.startsWith(base) ? location.pathname.slice(base.length) : "";
}
function go(to) {
  history.pushState(null, "", to);
  route();
  scrollTo(0, 0);
}
function onClick(event) {
  const a = event.target.closest("a[data-in]");
  if (a && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
    event.preventDefault();
    closeMenus();
    go(a.getAttribute("href"));
    return;
  }
  const copy = event.target.closest("[data-copy]");
  if (copy) {
    navigator.clipboard?.writeText(copy.dataset.copy);
    copy.classList.add("copied");
    const icon = copy.querySelector(".i:last-child");
    const was = icon?.outerHTML;
    icon?.replaceWith(document.createRange().createContextualFragment(ICON.check));
    setTimeout(() => {
      copy.classList.remove("copied");
      if (was) copy.querySelector(".i:last-child")?.replaceWith(document.createRange().createContextualFragment(was));
    }, 1300);
  }
}
async function route() {
  const parts = path().replace(/\/+$/, "").split("/").filter(Boolean);
  const main = $("#main");
  let section = parts[0] ?? "";
  html.dataset.page = parts.length ? "page" : "landing";
  main.className = "";
  try {
    if (!parts.length) await drawHome(main);
    else if (section === "models" && parts.length === 1) await drawModels(main);
    else if (section === "models" && parts.length >= 3) await drawModel(main, `${parts[1]}/${parts[2]}`);
    else if (section === "docs") drawDocs(main);
    else if (section === "registry") await drawRegistry(main);
    else if (section === "apps") await drawApps(main);
    else if (section === "buckets") drawBuckets(main);
    else { section = ""; html.dataset.page = "landing"; await drawHome(main); }
  } catch (error) {
    main.innerHTML = `<section class="panel note-panel">${esc(error.message)}</section>`;
  }
  for (const a of $$(".top-nav a")) {
    if (a.dataset.section === section) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

// ---------------------------------------------------------------- chrome
const ROUTE_PATH = { 1: "", 2: "models/", 3: "models/", 4: "docs/", 5: "registry/", 6: "apps/", 7: "buckets/" };
// The switch carries all three marks and CSS draws the one in use.
const forTheme = (icon, mode) => ICON[icon].replace('class="i"', `class="i" data-for="${mode}"`);
function drawChrome() {
  // The footer says what the page proved, and links to the proof itself.
  $("#proof").href = href(chrome.proofHref);
  $("#proof-text").textContent = chrome.proof;
  const nav = chrome.nav.map((n) => {
    const icon = ICON[n.icon] ?? "";
    if (n.route === undefined) return `<a href="${esc(n.href)}">${esc(n.label)}${icon}</a>`;
    const to = ROUTE_PATH[n.route];
    return `<a data-in data-section="${esc(to.replace(/\/$/, ""))}" href="${href(to)}">${esc(n.label)}${icon}</a>`;
  }).join("");
  const modes = chrome.themes.map(([key, label, ic]) => `<button type="button" class="mode" role="radio" aria-checked="false" data-theme-mode="${esc(key)}">${ICON[ic]}<span>${esc(label)}</span></button>`).join("");
  const lockup = (tone, cls) => `<img class="mark ${cls}" src="logos/Hologram_Logomark_${tone}.svg" alt="" width="32" height="32" /><img class="word ${cls}" src="logos/Hologram_Wordmark_${tone}.svg" alt="${esc(chrome.brand)}" width="172" height="16" />`;
  const p = chrome.photos;
  $("#chrome").innerHTML = `
    <a class="brand" data-in href="${href("")}" aria-label="${esc(chrome.brand)}">${lockup("White", "on-dark")}${lockup("Black", "on-light")}</a>
    <div class="top-end">
      <div class="top-menu" id="top-menu">
        <nav class="top-nav" aria-label="Sections">${nav}</nav>
        <div class="top-tools">
          <div class="appearance">
            <button type="button" id="theme-button" aria-haspopup="menu" aria-expanded="false" aria-controls="theme-menu" aria-label="${esc(chrome.theme)}" title="${esc(chrome.theme)}">${forTheme("image", "immersive")}${forTheme("moon", "dark")}${forTheme("sun", "light")}</button>
            <div class="menu theme-panel" id="theme-menu" role="menu" aria-label="${esc(chrome.theme)}" hidden>
              <h3 class="panel-head">${esc(chrome.theme)}</h3>
              <div class="seg" role="radiogroup" aria-label="${esc(chrome.theme)}">${modes}</div>
              <div class="photos-part" id="photos-part">
                <label class="field compact find">${ICON.search}<input id="find" type="search" placeholder="${esc(p.search)}" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-label="${esc(p.search)}" /></label>
                <div class="photos" id="photos" role="listbox" aria-label="${esc(p.label)}"></div>
                <p class="credit" id="credit" hidden>${esc(p.by.split("{name}")[0])}<a id="credit-name" target="_blank" rel="noopener"></a>${esc(p.by.split("{name}")[1])} <a href="${esc(`${p.site}?${p.utm}`)}" target="_blank" rel="noopener">${esc(p.source)}</a></p>
              </div>
            </div>
          </div>
          <div class="account"><a class="sign-in" id="sign-in-button" href="${esc(chrome.signInHref)}">${ICON.user}<span class="label">${esc(chrome.signIn)}</span></a></div>
        </div>
      </div>
      <button type="button" class="menu-button" id="menu-button" aria-expanded="false" aria-controls="top-menu" aria-label="${esc(chrome.menu)}" title="${esc(chrome.menu)}">${ICON.menu}${ICON.close}</button>
    </div>`;
  const themeButton = $("#theme-button");
  const themeMenu = $("#theme-menu");
  themeButton.addEventListener("click", (e) => {
    e.stopPropagation();
    themeMenu.hidden = !themeMenu.hidden;
    themeButton.setAttribute("aria-expanded", String(!themeMenu.hidden));
    if (!themeMenu.hidden && !$("#photos").children.length) photoGrid(firstPhotos());
  });
  themeMenu.addEventListener("click", (e) => {
    const mode = e.target.closest("[data-theme-mode]");
    if (mode) setTheme(mode.dataset.themeMode, picture());
  });
  let typing;
  $("#find").addEventListener("input", (e) => { clearTimeout(typing); typing = setTimeout(() => searchPhotos(e.target.value), 350); });
  $("#find").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { clearTimeout(typing); searchPhotos(e.target.value); }
    if (e.key === "Escape" && e.target.value) { e.target.value = ""; searchPhotos(""); e.stopPropagation(); }
  });
  $("#menu-button").addEventListener("click", () => {
    const open = !$("#chrome").classList.contains("menu-open");
    $("#chrome").classList.toggle("menu-open", open);
    $("#menu-button").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".appearance")) closeThemeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });
  matchMedia("(min-width: 1101px)").addEventListener("change", (e) => { if (e.matches) closeMenus(); });
  setTheme(html.dataset.theme, picture());
}
function closeThemeMenu() {
  const menu = $("#theme-menu");
  if (menu && !menu.hidden) { menu.hidden = true; $("#theme-button").setAttribute("aria-expanded", "false"); }
}
function closeMenus() {
  closeThemeMenu();
  $("#chrome")?.classList.remove("menu-open");
  $("#menu-button")?.setAttribute("aria-expanded", "false");
}

// ---------------------------------------------------------------- wallpaper
// The picture behind the page is one this site ships (a file) or one from
// Unsplash (a photo and its photographer). Either is kept here, so a page turn
// and the next visit draw the same wall without asking anyone.
const PICTURE_KEY = "hologram-hub.picture";
const shipped = (file) => chrome.wallpapers.some(([k]) => k === file);
const firstPhotos = () => chrome.wallpapers.map(([file, alt]) => ({ file, alt }));
function picture() {
  try {
    const kept = JSON.parse(localStorage.getItem(PICTURE_KEY) ?? "null");
    if (kept?.file && shipped(kept.file)) return kept;
    if (kept?.id && kept?.image) return kept;
  } catch {}
  return firstPhotos()[0];
}
// Unsplash reaches this page through the Prism frame's worker, which holds the
// one key every Prism app shares: the search, a tile for the panel, and a copy
// as wide as this screen can actually show.
const SIDES = [1280, 1920, 2560, 3200, 3840];
function wallWidth() {
  const dpr = Math.min(Math.max(devicePixelRatio || 1, 1), 3);
  const want = Math.max(screen.width, screen.height * 1.5) * dpr;
  return SIDES.find((w) => w >= want) ?? SIDES.at(-1);
}
const proxied = (photo, size) => `${chrome.photos.proxy}image?${new URLSearchParams({ src: photo.image, ...size })}`;
const wallOf = (photo) => (photo.file ? new URL(`wallpapers/${photo.file}.jpg`, root).href : proxied(photo, { w: String(wallWidth()), q: "85" }));
const tileOf = (photo) => (photo.file ? new URL(`wallpapers/${photo.file}-thumb.jpg`, root).href : proxied(photo, { w: "480", h: "300", q: "75" }));
const same = (a, b) => Boolean(a && b && (a.file ? a.file === b.file : a.id === b.id));

function setTheme(mode, photo) {
  const wall = wallOf(photo);
  html.dataset.theme = mode;
  html.classList.toggle("dark", mode !== "light");
  html.style.setProperty("--hh-wallpaper", `url(${JSON.stringify(wall)})`);
  for (const b of $$("[data-theme-mode]")) b.setAttribute("aria-checked", String(b.dataset.themeMode === mode));
  $("#photos-part").hidden = mode !== "immersive";
  credit(photo);
  for (const [i, b] of $$("#photos .photo").entries()) b.setAttribute("aria-selected", String(same(shownPhotos[i], photo)));
  try {
    localStorage.setItem("hologram-hub.theme", mode);
    // The wall's own address is kept beside the photo, so the next visit can
    // draw it before any script of ours has run.
    localStorage.setItem(PICTURE_KEY, JSON.stringify({ ...photo, wall }));
  } catch {}
}
// A shipped wallpaper names no photographer, so it gets no line; a photo from
// Unsplash always carries its own, as the licence asks.
function credit(photo) {
  const p = chrome.photos;
  const line = $("#credit");
  line.hidden = !photo.name;
  if (!photo.name) return;
  const who = $("#credit-name");
  who.textContent = photo.name;
  who.href = `${p.site}@${photo.user}?${p.utm}`;
}
let shownPhotos = [];
function photoGrid(photos) {
  shownPhotos = photos.slice(0, 9);
  const now = picture();
  $("#photos").innerHTML = shownPhotos.map((photo) => {
    const alt = photo.alt ?? photo.name ?? "";
    const tile = `background-image:url(${JSON.stringify(tileOf(photo))})${photo.color ? `;background-color:${photo.color}` : ""}`;
    return `<button type="button" class="photo" role="option" aria-selected="${same(photo, now)}" title="${esc(alt)}" aria-label="${esc(alt)}" style="${esc(tile)}"></button>`;
  }).join("");
  for (const [i, b] of $$("#photos .photo").entries()) b.addEventListener("click", () => choose(shownPhotos[i]));
}
function choose(photo) {
  // Unsplash asks that a photo count as used once it is set; a shipped
  // wallpaper is this site's own file and tells nobody.
  if (!photo.file) fetch(`${chrome.photos.proxy}use?id=${encodeURIComponent(photo.id)}`, { method: "POST" }).catch(() => {});
  setTheme("immersive", photo);
  // The tile is already here, so the wall changes on the click; the copy this
  // screen deserves takes its place as soon as it has decoded.
  if (!photo.file) sharpen(photo);
}
const decoded = new Map();
function sharpen(photo) {
  const wall = wallOf(photo);
  html.style.setProperty("--hh-wallpaper", `url(${JSON.stringify(tileOf(photo))})`);
  if (!decoded.has(wall)) {
    const image = new Image();
    image.decoding = "async";
    image.src = wall;
    decoded.set(wall, image.decode().catch(() => {}));
  }
  decoded.get(wall).then(() => {
    if (same(picture(), photo)) html.style.setProperty("--hh-wallpaper", `url(${JSON.stringify(wall)})`);
  });
}
let searching;
async function searchPhotos(words) {
  const p = chrome.photos;
  searching?.abort();
  if (!words.trim()) { photoGrid(firstPhotos()); return; }
  const control = (searching = new AbortController());
  try {
    const r = await fetch(`${p.proxy}search?${new URLSearchParams({ q: words.trim(), page: "1" })}`, { signal: control.signal });
    if (!r.ok) throw new Error(String(r.status));
    const found = await r.json();
    if (searching === control) photoGrid(found.photos ?? []);
  } catch (error) {
    if (error.name !== "AbortError" && searching === control) $("#photos").innerHTML = `<p class="none">${esc(p.unavailable)}</p>`;
  }
}

const avatar = (m, cls = "avatar") => (m.avatar
  ? `<img class="${cls}" src="${esc(href(`data/avatars/${m.avatar}`))}" alt="" loading="lazy" decoding="async" width="48" height="48" />`
  : `<span class="${cls} initials" aria-hidden="true">${esc((m.org ?? "").slice(0, 2).toUpperCase())}</span>`);
const copyLine = (command, cls = "endpoint section-tag copy") => `<button type="button" class="${cls}" data-copy="${esc(command)}" title="${esc(command)}"><span class="prompt" aria-hidden="true">$</span><span class="line">${esc(command)}</span>${ICON.copy}</button>`;

// ---------------------------------------------------------------- home
async function drawHome(main) {
  const s = screens.home;
  // The call to action counts the catalogue, so it counts whatever the
  // catalogue is: the roll when one is published, and the addressed index when
  // not. It used to round the index down to a hundred and add a plus, which
  // reads as a hedge once the number is three million; `count` is the same
  // formatter the Models page's own pill uses, so the two agree.
  const source = await openRoll();
  const list = await catalog().catch(() => []);
  const models = source?.total ?? list.length;
  const total = models ? count(models) : "";
  const marks = s.families.map(([label, org]) => {
    const theirs = list.filter((m) => m.org === org);
    const face = theirs.find((m) => m.avatar);
    const img = face ? `<img src="${esc(href(`data/avatars/${face.avatar}`))}" alt="" width="40" height="40" loading="lazy" decoding="async" />` : "";
    return `<li><a data-in href="${href(`models/?author=${encodeURIComponent(org)}`)}" title="${esc(fill(s.familyTitle, { label, n: theirs.length }))}">${img}<span>${esc(label)}</span></a></li>`;
  }).join("");
  main.className = "land";
  main.innerHTML = `
    <div class="land-copy">
      <a class="land-badge" href="https://github.com/${esc(s.repo)}" rel="noopener">
        <span class="lockup">${ICON.github}<span class="label">${esc(s.badge)}</span></span>
        <span class="tally">${marked(ICON.star, "star")}<b class="n" id="gh-stars"></b></span>
      </a>
      <h1 class="land-title">${s.headline.map((l) => `<span>${esc(l)}</span>`).join(" ")}</h1>
      <p class="land-sub">${esc(s.lead)} <b class="hl">${esc(s.accent)}</b><span class="hl-seal">${ICON.seal}</span> ${esc(s.tail)}</p>
      <div class="land-actions">
        <a class="button primary" data-in href="${href(ROUTE_PATH[s.ctaRoute])}">${esc(fill(s.cta, { count: total }).replace(/\s+/g, " "))}${ICON.right}</a>
        ${copyLine(s.command, "land-second copy")}
      </div>
    </div>
    <div class="land-marquee" aria-label="Model families"><div class="land-track"><ul>${marks}</ul><ul aria-hidden="true">${marks.replace(/<a /g, '<a tabindex="-1" ')}</ul></div></div>`;
  stars(s);
}
// The badge's count, from GitHub, kept for the session so a page turn costs no request.
async function stars(s) {
  const key = `hologram-hub.stars.${s.repo}`;
  let n = null;
  try { n = sessionStorage.getItem(key); } catch {}
  if (n === null) {
    n = await fetch(`https://api.github.com/repos/${s.repo}`, { headers: { accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : null)).then((j) => (j ? String(j.stargazers_count) : "")).catch(() => "");
    try { sessionStorage.setItem(key, n); } catch {}
  }
  const el = $("#gh-stars");
  // The tally hides itself while the count is empty, so a repository with no
  // stars, and a page that could not reach GitHub, show the label alone.
  if (el && +n > 0) { el.textContent = count(+n); el.closest(".land-badge").setAttribute("aria-label", `${s.badge}, ${fill(s.stars, { n })}`); }
}

// ---------------------------------------------------------------- catalog
const facetDefs = () => screens.models.facets.map(([key, param, label, tabs, icon, kind]) => ({ key, param, label, tabs, icon, kind }));
const chipFacets = () => facetDefs().filter((f) => f.kind !== "range");
const fixedValues = (f) => (f.key === "status" ? screens.models.statuses.map(([, l]) => l)
  : f.key === "recency" ? screens.models.recency.map(([l]) => l) : null);
const stops = () => screens.models.stops;
const fullRange = () => [0, stops().length - 1];
const valuesOf = (m, key) => { const v = m[key]; return Array.isArray(v) ? v : v == null || v === "" ? [] : [String(v)]; };

function readState() {
  const s = screens.models;
  const p = new URLSearchParams(location.search);
  const st = {
    q: p.get(s.searchParam) ?? "",
    sort: p.get("sort") ?? "trending",
    page: Math.max(1, +(p.get(s.pageParam) ?? 1) || 1),
    tab: p.get("tab") ?? "main",
    f: {},
  };
  if (!s.sorts.some(([k]) => k === st.sort)) st.sort = "trending";
  if (!s.tabs.some(([k]) => k === st.tab)) st.tab = "main";
  for (const f of chipFacets()) { const v = p.get(f.param); if (v) st.f[f.key] = v.split(",").filter(Boolean); }
  // The parameter range is a pair of the stops' own labels, as Hugging Face
  // writes it: `num_parameters=6B,32B`.
  const last = s.stops.length - 1;
  const asked = (p.get(rangeFacetDef().param) ?? "").split(",").map((label) => s.stops.findIndex(([, l]) => l === label.trim()));
  st.range = asked.length === 2 && asked.every((i) => i >= 0) && asked[0] < asked[1] ? asked : [0, last];
  return st;
}
const rangeFacetDef = () => facetDefs().find((f) => f.kind === "range");
function writeState(st) {
  const s = screens.models;
  const p = new URLSearchParams();
  if (st.q) p.set(s.searchParam, st.q);
  if (st.sort !== "trending") p.set("sort", st.sort);
  for (const f of chipFacets()) if (st.f[f.key]?.length) p.set(f.param, st.f[f.key].join(","));
  const [low, high] = fullRange();
  if (st.range[0] !== low || st.range[1] !== high) {
    p.set(rangeFacetDef().param, st.range.map((i) => s.stops[i][1]).join(","));
  }
  if (st.tab !== "main") p.set("tab", st.tab);
  if (st.page > 1) p.set(s.pageParam, st.page);
  const q = p.toString().replace(/%2C/g, ",");
  history.replaceState(null, "", `${href("models/")}${q ? `?${q}` : ""}`);
}
function matches(m, st, skip) {
  if (st.q) {
    const hay = `${m.id} ${m.arch ?? ""} ${m.family ?? ""} ${m.task ?? ""}`.toLowerCase();
    if (!st.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (skip !== "params" && !inRange(m, st)) return false;
  for (const f of chipFacets()) {
    if (f.key === skip) continue;
    const want = st.f[f.key];
    if (want?.length && !valuesOf(m, f.key).some((v) => want.includes(v))) return false;
  }
  return true;
}
// The slider at its ends asks nothing, so a model whose parameter count is
// unknown is still listed; once it is moved, a count is what it filters on.
function inRange(m, st) {
  const [low, high] = fullRange();
  if (st.range[0] === low && st.range[1] === high) return true;
  const billions = (m.params ?? 0) / 1e9;
  if (!m.params) return false;
  const from = stops()[st.range[0]][0];
  const to = st.range[1] === high ? Infinity : stops()[st.range[1]][0];
  return billions >= from && billions <= to;
}
// The names are Hugging Face's, so a link that carries one means the same here.
const SORTERS = {
  trending: (a, b) => a.rank - b.rank,
  downloads: (a, b) => b.downloads - a.downloads,
  likes: (a, b) => b.likes - a.likes,
  created: (a, b) => String(b.created ?? "").localeCompare(String(a.created ?? "")),
  modified: (a, b) => String(b.modified ?? b.created ?? "").localeCompare(String(a.modified ?? a.created ?? "")),
};

function tags(m, { full = false } = {}) {
  const s = screens.models;
  return [
    full ? "" : `<span class="tag">${esc(m.org)}</span>`,
    `<span class="tag state ${esc(m.state)}">${esc(statusLabel(m))}</span>`,
    m.isNew ? `<span class="tag new">${esc(s.new)}</span>` : "",
    m.params ? `<span class="tag">${params(m.params)}</span>` : "",
    m.context ? `<span class="tag">${context(m.context)}</span>` : "",
    full && m.task ? `<span class="tag">${esc(titled(m.task))}</span>` : "",
    m.modality && m.modality !== "Other" && (full || m.modality !== "Text") ? `<span class="tag">${esc(m.modality)}</span>` : "",
    full && m.format && m.format !== "Other" ? `<span class="tag">${esc(m.format)}</span>` : "",
  ].join("");
}
function meta(m) {
  const s = screens.models;
  const spans = [`<span>${ICON.heart}${count(m.likes)}</span>`, `<span>${ICON.down}${count(m.downloads)}</span>`];
  if ((m.sources?.length ?? 0) > 1) spans.push(`<span title="${esc(fill(s.held, { sources: m.sources.map(sourceName).join(" and ") }))}">${ICON.nodes}${m.sources.length}</span>`);
  if (m.created) spans.push(`<span>${ICON.calendar}${esc(month(m.created))}</span>`);
  return spans.join("");
}
const card = (m) => `<a class="card" data-in href="${href(`models/${m.id}/`)}" title="${esc(m.id)}">${art(m.manifest || m.id)}
  <span class="tags">${tags(m)}</span><span class="title">${esc(m.name)}</span><span class="meta">${meta(m)}</span>${avatar(m)}</a>`;

// The filter panel, the search, the sort listbox and the pager: one page of the
// catalog, its state in the URL.
async function drawModels(main) {
  const s = screens.models;
  const source = await openRoll();
  // The addressed index is still read when there is no roll, and is still what
  // the model pages and Verify use either way.
  const list = source ? [] : await catalog();
  const faces = await fetch(new URL("data/avatars/index.json", root)).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  if (source) { listing.signed = false; listing.rows = source.total; listing.shards = 0; listing.rules = "roll"; }
  const st = readState();
  const order = {};
  main.innerHTML = `
    <div class="lead"><h1>${esc(s.title)}</h1><span class="pill" id="count"></span>${copyLine(s.command)}
      <span class="status listing ${listing.signed ? "" : "bad"}" title="${esc(fill(s.listing.detail, { n: listing.rows, shards: listing.shards, rules: listing.rules }))}">${esc(listing.signed ? s.listing.signed : s.listing.unsigned)}</span></div>
    <div class="browse">
      <aside class="panel filters" id="filters" aria-label="${esc(s.filters)}">
        <button type="button" class="control square close-filters" id="close-filters" aria-label="${esc(s.close)}">${ICON.close}</button>
        <div id="filters-body"></div>
      </aside>
      <section class="results">
        <div class="results-head"><div class="bar">
          <label class="field search">${ICON.search}<input id="q" type="search" placeholder="${esc(s.search)}" autocomplete="off" aria-label="${esc(s.search)}" /></label>
          <button type="button" class="open-filters" id="open-filters">${ICON.sliders}${esc(s.filters)}</button>
          ${sortControl(s.sorts, st.sort)}
        </div></div>
        <p class="note" id="partial" hidden></p>
        <div class="grid" id="cards"></div>
        <nav class="pager" id="pager" aria-label="Pages"></nav>
      </section>
      <div class="sheet-footer" id="sheet-footer" hidden><button type="button" class="button primary" id="show"></button></div>
    </div>`;
  $("#q").value = st.q;
  // Which of the interface's sorts and facets the roll can answer. The rest
  // are the index's: they come from a model's tags and its files, and the roll
  // carries neither, so they are left out rather than drawn empty.
  const ROLL_SORT = { trending: "trending", downloads: "downloads", likes: "likes", created: "createdAt", modified: "lastModified" };
  const ROLL_FACET = { task: "task", library: "library", license: "license", languages: "language" };
  const codesOf = (key, labels) => {
    const dict = source?.dictionaries[ROLL_FACET[key]] ?? [];
    return (labels ?? []).map((l) => dict.indexOf(l)).filter((i) => i >= 0);
  };

  const draw = async () => {
    writeState(st);
    // A query that arrived in the URL deserves the same shard a typed one
    // gets, and this is the first chance to ask for it.
    pullSwarm(st.q);
    let shown, total, pages, pre = null;
    if (source) {
      const filters = {};
      for (const [key, facet] of Object.entries(ROLL_FACET)) {
        const codes = codesOf(key, st.f[key]);
        if (codes.length) filters[facet] = codes;
      }
      const sort = ROLL_SORT[st.sort] ?? "downloads";
      const got = await source.page({ sort, filters, page: st.page, q: st.q });
      st.page = got.page;
      total = got.total;
      pages = got.pages;
      shown = got.rows.map((r) => fromRoll(r, source, faces, s, Date.now()));
      // The chip counts come from the postings header, so each is what that
      // value holds in the catalogue rather than under the other filters. The
      // interface used to narrow them as you chose; over three million rows
      // that is a walk per chip, and a number honest about what it counts
      // beats one that is not there.
      pre = {};
      for (const [key, facet] of Object.entries(ROLL_FACET)) {
        const dict = source.dictionaries[facet] ?? [];
        const counted = await source.counts(sort, facet);
        pre[key] = new Map([...counted].map(([v, n]) => [dict[v], n]).filter(([label]) => label));
      }
    } else {
      const results = list.filter((m) => matches(m, st)).sort(SORTERS[st.sort]);
      total = results.length;
      pages = Math.max(1, Math.ceil(total / s.pageSize));
      st.page = Math.min(st.page, pages);
      shown = results.slice((st.page - 1) * s.pageSize, st.page * s.pageSize);
    }
    $("#count").textContent = count(total);
    $("#show").textContent = fill(s.show, { n: count(total) });
    $("#filters-body").innerHTML = filtersHtml(list, st, order, pre);
    clampChips();
    $("#cards").innerHTML = shown.length ? shown.map(card).join("")
      : `<div class="empty"><p>${esc(s.empty)}</p><button type="button" class="link" data-clear>${esc(s.clear)}</button></div>`;
    $("#pager").innerHTML = pagerHtml(st.page, pages, s);
    showPartial(st);
  };

  // How much of the swarm's catalog is in front of the reader. Without this a
  // count of a few hundred would read as all Pirate Face has, when the page
  // has deliberately loaded one slice of it.
  async function showPartial(st) {
    const el = $("#partial");
    const w = s.swarm;
    const cat = await swarmCatalog().catch(() => null);
    const asked = st.f.sources?.includes("pirateface");
    if (!el || !w || !cat || !asked) { if (el) el.hidden = true; return; }
    const have = list.filter((m) => m.state === "listed").length;
    if (have >= cat.models) { el.hidden = true; return; }
    el.textContent = fill(w.partial, { n: count(have), total: count(cat.models), source: w.source });
    el.hidden = false;
  }

  // Reading one more shard, then drawing once. The query a reader typed
  // decides which shard, so this runs on search and not on a filter.
  let pulled = "";
  async function pullSwarm(query) {
    const key = query.trim().toLowerCase().slice(0, 2);
    if (key.length < 2 || pulled === key) return;
    pulled = key;
    const found = await swarmByName(query).catch(() => []);
    const added = await mergeSwarm(list, found);
    if (!added) return;
    for (const m of list) if (!m.status) dress(m);
    draw();
  }

  let timer;
  $("#q").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => { st.q = e.target.value.trim(); st.page = 1; draw(); pullSwarm(st.q); }, 144); });
  wireSort(main, (key) => { st.sort = key; st.page = 1; draw(); });
  const sheet = (open) => { document.body.classList.toggle("sheet", open); $("#sheet-footer").hidden = !open; };
  $("#open-filters").addEventListener("click", () => sheet(true));
  $("#close-filters").addEventListener("click", () => sheet(false));
  $("#show").addEventListener("click", () => sheet(false));
  main.querySelector(".browse").addEventListener("click", (e) => {
    const t = e.target.closest("button, a[data-page]");
    if (!t) return;
    if (t.dataset.facet) {
      const vs = (st.f[t.dataset.facet] ??= []);
      const i = vs.indexOf(t.dataset.value);
      i < 0 ? vs.push(t.dataset.value) : vs.splice(i, 1);
      st.page = 1;
    } else if (t.dataset.tab) st.tab = t.dataset.tab;
    else if (t.dataset.reset === "params") { st.range = fullRange(); st.page = 1; }
    else if (t.dataset.reset) { st.f[t.dataset.reset] = []; st.page = 1; }
    else if (t.dataset.order) order[t.dataset.order] = order[t.dataset.order] === "az" ? "" : "az";
    else if (t.dataset.more) { const chips = t.previousElementSibling; const open = chips.classList.toggle("clamped"); t.textContent = open ? t.dataset.more : s.less; return; }
    else if (t.dataset.page) { e.preventDefault(); st.page = +t.dataset.page; draw(); main.scrollIntoView(); return; }
    else if ("clear" in t.dataset) { st.f = {}; st.q = ""; $("#q").value = ""; }
    else return;
    draw();
  });
  // The two handles cannot cross: whichever is dragged pushes the other back
  // by one stop, so the bar always reads low to high.
  main.querySelector(".filters").addEventListener("input", (e) => {
    const which = e.target.dataset.range;
    if (which) {
      const value = +e.target.value;
      const last = s.stops.length - 1;
      if (which === "from") st.range = [Math.min(value, last - 1), Math.max(st.range[1], Math.min(value, last - 1) + 1)];
      else st.range = [Math.min(st.range[0], Math.max(value, 1) - 1), Math.max(value, 1)];
      st.page = 1;
      draw();
      main.querySelector(`.handle.${which}`)?.focus();
      return;
    }
    const key = e.target.dataset.facetSearch;
    if (!key) return;
    const w = e.target.value.trim().toLowerCase();
    const section = e.target.closest(".facet");
    for (const chip of $$(".chip", section)) {
      const hay = `${chip.dataset.value} ${chip.querySelector(".label")?.textContent ?? ""}`.toLowerCase();
      chip.hidden = Boolean(w) && !hay.includes(w);
    }
    const chips = $(".chips", section);
    chips.classList.toggle("clamped", !w);
    $(".more", section).hidden = Boolean(w) || chips.scrollHeight <= chips.clientHeight;
  });
  // Awaited, so a failure to read the roll surfaces instead of leaving an
  // empty grid behind a silently rejected promise.
  await draw();
}
function filtersHtml(list, st, order, pre) {
  const s = screens.models;
  const tabs = s.tabs.map(([k, label, ic]) => `<button type="button" class="tab" role="tab" data-tab="${esc(k)}" aria-selected="${st.tab === k}">${ICON[ic] ?? ""}<span>${esc(label)}</span></button>`).join("");
  // When the caller brought counts, those are the facets there are: the rest
  // are the addressed index's and the roll cannot answer them, so they are not
  // offered rather than offered empty.
  const can = (f) => (pre ? Object.hasOwn(pre, f.key) : true);
  const sections = facetDefs().filter((f) => f.tabs.includes(st.tab) && can(f))
    .map((f) => (f.kind === "range" ? rangeFacet(st) : chipFacet(f, list, st, order, pre))).join("");
  return `<div class="tabs" role="tablist">${tabs}</div><div class="sections">${sections}</div>`;
}
function chipFacet(f, list, st, order, pre) {
  const s = screens.models;
  const fixed = fixedValues(f);
  // Counts the caller already has - from the roll's postings header, where
  // a value's total is a number to read rather than a walk over rows.
  const counts = pre?.[f.key] ?? new Map(fixed ? fixed.map((v) => [v, 0]) : []);
  for (const m of (pre?.[f.key] ? [] : list)) {
    const hit = matches(m, st, f.key);
    for (const v of valuesOf(m, f.key)) {
      if (f.key === "modality" && v === "Other") continue;
      counts.set(v, (counts.get(v) ?? 0) + (hit ? 1 : 0));
    }
  }
  const active = st.f[f.key] ?? [];
  const rows = [...counts].filter(([v, n]) => n > 0 || active.includes(v));
  if (fixed) rows.sort((a, b) => fixed.indexOf(a[0]) - fixed.indexOf(b[0]));
  else if (order[f.key] === "az") rows.sort((a, b) => a[0].localeCompare(b[0]));
  else rows.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const plain = f.kind === "plain";
  const chips = rows.map(([v, n]) => `<button type="button" class="chip${plain ? " plain" : ""}" data-facet="${esc(f.key)}" data-value="${esc(v)}" aria-pressed="${active.includes(v)}">${ICON[f.icon] ?? ""}<span class="label">${esc(said(f.key, v))}</span>${plain ? "" : `<span class="n">${count(n)}</span>`}</button>`).join("");
  const placeholder = fill(s.filterBy, { label: f.label.toLowerCase() });
  const az = order[f.key] === "az";
  const tools = f.kind === "search" ? `<div class="facet-tools"><label class="field compact">${ICON.search}<input type="search" placeholder="${esc(placeholder)}" data-facet-search="${esc(f.key)}" autocomplete="off" aria-label="${esc(placeholder)}" /></label><button type="button" class="control square" data-order="${esc(f.key)}" aria-label="${esc(az ? s.sortCount : s.sortAz)}" title="${esc(az ? s.sortCount : s.sortAz)}">${az ? ICON.sortCount : ICON.sortAz}</button></div>` : "";
  return `<section class="facet" data-key="${esc(f.key)}">
    <header><h2>${esc(f.label)}</h2><button type="button" class="control reset" data-reset="${esc(f.key)}"${active.length ? "" : " disabled"}>${ICON.reset}${esc(s.reset)}</button></header>
    ${tools}<div class="chips clamped">${chips || `<p class="none">${esc(s.none)}</p>`}</div><button type="button" class="control more" hidden></button></section>`;
}
// Parameter count as one bar with two handles, the way a reader expects to say
// "between these two sizes". The stops are the screen's, evenly spaced on the
// bar, so the common sizes each get room rather than crowding the left end.
function rangeFacet(st) {
  const s = screens.models;
  const last = s.stops.length - 1;
  const [from, to] = st.range;
  const marks = s.stops.map(([, label], i) => `<span class="stop${i === from || i === to ? " on" : ""}" style="--at:${(i / last) * 100}%">${esc(label)}</span>`).join("");
  const slider = (which, value, label) => `<input type="range" class="handle ${which}" data-range="${which}" min="0" max="${last}" step="1" value="${value}" aria-label="${esc(label)}" aria-valuetext="${esc(s.stops[value][1])}" />`;
  return `<section class="facet range" data-key="params">
    <header><h2>${esc(s.facets.find(([k]) => k === "params")[2])}</h2><button type="button" class="control reset" data-reset="params"${from === 0 && to === last ? " disabled" : ""}>${ICON.reset}${esc(s.reset)}</button></header>
    <div class="marks">${marks}</div>
    <div class="bar-track" style="--from:${(from / last) * 100}%;--to:${(to / last) * 100}%">
      <span class="rail"></span><span class="span"></span>
      ${slider("from", from, fill(s.parameterRange, { low: s.stops[from][1], high: s.stops[to][1] }))}
      ${slider("to", to, fill(s.parameterRange, { low: s.stops[from][1], high: s.stops[to][1] }))}
    </div></section>`;
}
// Three rows of chips, then "+N more": the hidden count is what lies past the third row.
function clampChips() {
  const more = screens.models.more;
  for (const chips of $$(".filters .chips.clamped")) {
    const button = chips.nextElementSibling;
    const limit = chips.clientHeight;
    const hidden = $$(".chip", chips).filter((c) => c.offsetTop - chips.offsetTop >= limit).length;
    button.hidden = !hidden;
    button.dataset.more = fill(more, { n: hidden });
    button.textContent = button.dataset.more;
  }
}
function sortControl(sorts, current) {
  const label = sorts.find(([k]) => k === current)?.[1] ?? sorts[0][1];
  const options = sorts.map(([k, l]) => `<div role="option" data-sort="${esc(k)}" aria-selected="${k === current}">${esc(l)}${ICON.check}</div>`).join("");
  return `<div class="sort"><button type="button" id="sort-button" aria-haspopup="listbox" aria-expanded="false"><span id="sort-label">${esc(label)}</span>${ICON.chevron}</button><div role="listbox" id="sort-list" hidden>${options}</div></div>`;
}
function wireSort(main, pick) {
  const button = $("#sort-button", main);
  const list = $("#sort-list", main);
  const open = (yes) => { list.hidden = !yes; button.setAttribute("aria-expanded", String(yes)); };
  button.addEventListener("click", (e) => { e.stopPropagation(); open(list.hidden); });
  list.addEventListener("click", (e) => {
    const o = e.target.closest("[data-sort]");
    if (!o) return;
    for (const x of $$("[role=option]", list)) x.setAttribute("aria-selected", String(x === o));
    $("#sort-label", main).textContent = o.textContent;
    open(false);
    pick(o.dataset.sort);
  });
  document.addEventListener("click", () => open(false));
}
function pagerHtml(page, pages, s) {
  if (pages < 2) return "";
  const link = (p, label, extra = "") => `<a href="?page=${p}" data-page="${p}"${extra}>${label}</a>`;
  const nums = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums.at(-1) !== "gap") nums.push("gap");
  }
  return [
    page > 1 ? link(page - 1, ICON.left, ` aria-label="${esc(s.previous)}"`) : `<span class="off">${ICON.left}</span>`,
    ...nums.map((p) => (p === "gap" ? `<span class="gap">...</span>` : p === page ? `<span class="now" aria-current="page">${p}</span>` : link(p, p))),
    page < pages ? link(page + 1, ICON.right, ` aria-label="${esc(s.next)}"`) : `<span class="off">${ICON.right}</span>`,
  ].join("");
}

// ---------------------------------------------------------------- witnesses
// A release record, fetched and checked against the hash the signed root
// names for it, the same accept rule a download goes through.
const records = new Map();
async function release(repo) {
  if (!records.has(repo)) {
    records.set(repo, (async () => {
      const root = JSON.parse(new TextDecoder().decode(new Uint8Array(await (await fetch(indexUrl("root.json"))).arrayBuffer())));
      const entry = root.records?.find((r) => r.repo.toLowerCase() === repo.toLowerCase());
      if (!entry) return null;
      const bytes = new Uint8Array(await (await fetch(indexUrl(`models/${entry.repo}.json`))).arrayBuffer());
      if (!(await addressed(bytes, entry.sha256))) throw new Error(`the record for ${entry.repo} does not match the signed root`);
      return JSON.parse(new TextDecoder().decode(bytes));
    })().catch(() => null));
  }
  return records.get(repo);
}

// What the witnesses say about each file, and what the kernel makes of it.
// `first` is what the release itself carries, from Hugging Face; `second` is
// another party's. The kernel's concur rule (HK-17) decides whether the
// address may be used, so the page never resolves a disagreement itself.
async function addresses(record) {
  const out = new Map();
  if (!record) return out;
  const second = new Map((record.witnesses ?? []).flatMap((w) => w.addresses.map((a) => [a.path, a.sha256])));
  for (const file of record.files ?? []) {
    const first = file.sha256 ?? null;
    const other = second.get(file.path) ?? null;
    const plan = (await kernel.dispatch(new Uint8Array([7, first ? 1 : 0, other ? 1 : 0, first && other && first === other ? 1 : 0])))[0];
    out.set(file.path, { plan, sha256: plan === 1 || plan === 2 ? (first ?? other) : null, size: file.size });
  }
  return out;
}

// ---------------------------------------------------------------- model
// A model the roll knows and the index has not addressed. What the roll holds
// is its name and release; what makes a page worth opening - the files, their
// sizes, their addresses - comes from Hugging Face, named as its answer and
// not as something this hub derived.
async function fromRollAndSource(id) {
  const source = await openRoll();
  if (!source) return undefined;
  const hit = await source.find?.(id);
  const about = await fetch(`${HF_API}/api/models/${id}?blobs=true`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!hit && !about) return undefined;
  const [org, name] = id.split("/");
  const files = (about?.siblings ?? []).map((f) => ({
    path: f.rfilename, size: f.size ?? 0, gitSha1: f.blobId ?? null, sha256: f.lfs?.oid ?? null,
  }));
  const tags = about?.tags ?? [];
  return {
    id: about?.id ?? id, org, name,
    revision: about?.sha ?? hit?.revision ?? null,
    created: about?.createdAt ?? (hit?.created ? new Date(hit.created * 1000).toISOString() : null),
    modified: about?.lastModified ?? null,
    task: about?.pipeline_tag ?? null, library: about?.library_name ?? null,
    license: tags.find((t) => t.startsWith("license:"))?.slice(8) ?? null,
    languages: tags.filter((t) => /^[a-z]{2,3}$/.test(t)),
    params: about?.safetensors?.total ?? 0, context: 0,
    likes: about?.likes ?? 0, downloads: about?.downloads ?? 0,
    gated: Boolean(about?.gated), manifest: null,
    // No source of ours has hashed these bytes, so the page says so instead of
    // offering a check it cannot make.
    sources: [], fileList: files, files: files.length,
    weightBytes: files.reduce((a, f) => a + (f.size ?? 0), 0),
    state: "skipped", observed: { source: HF_API, downloads: about?.downloads ?? 0, likes: about?.likes ?? 0 },
  };
}

async function drawModel(main, id) {
  const s = screens.model;
  const list = await catalog().catch(() => []);
  // The catalog holds the trending models; any other indexed model is found
  // through the hub's search.
  const same = (x) => x.id.toLowerCase() === id.toLowerCase();
  let m = list.find(same);
  if (!m) {
    const row = await fetch(`${chrome.api}/api/models?search=${encodeURIComponent(id.split("/")[1] ?? id)}&limit=50`)
      .then((r) => (r.ok ? r.json() : [])).then((found) => found.find(same)).catch(() => undefined);
    if (row) m = fromApi(row);
  }
  // Still nothing, and the swarm may list it. One shard, the one this model's
  // own name is filed under, so a link to any of the catalog's models opens
  // rather than reporting it missing.
  if (!m) {
    const found = await swarmByName(id.split("/")[1] ?? id).catch(() => []);
    const row = found.find(same);
    if (row) m = dress(row);
  }
  // Still nothing, and the roll holds every model Hugging Face has ever
  // listed. Browsing three million of them and then saying "no model of that
  // name is indexed" when one is opened would make the catalogue a list of
  // dead ends, so the page asks Hugging Face for what the roll does not keep:
  // the files, their sizes and their addresses.
  if (!m) m = await fromRollAndSource(id).catch(() => undefined);
  const back = `<div class="back-row"><a class="back" data-in href="${href("models/")}">${ICON.left}${esc(s.back)}</a></div>`;
  if (!m) { main.innerHTML = `${back}<section class="panel note-panel">${esc(s.missing)}</section>`; return; }
  document.title = `${m.name} · ${chrome.brand}`;
  // Where this model can actually be fetched from. For an indexed release
  // that is this hub; for one the swarm merely lists, this hub would answer
  // nothing, and saying otherwise would be the one claim a reader cannot
  // check for themselves.
  const w = screens.models.swarm;
  const listed = m.state === "listed" && Boolean(w);
  const host = listed ? w.host : chrome.host;
  const command = (i) => (listed ? fill(w.command, { host, id: m.id }) : fill(s.tools[i][1], { host, repo: m.id }));
  const status = `<span class="${verified(m) ? "ok" : "dim"}">${esc(statusLabel(m))}</span>`;
  const facts = {
    status, revision: m.revision ? `<code>${esc(m.revision.slice(0, 12))}</code>` : "", files: m.files ? esc(m.files) : "",
    weights: m.weightBytes ? esc(bytes(m.weightBytes)) : "", params: m.params ? esc(params(m.params)) : "",
    task: m.task ? esc(titled(m.task)) : "", library: esc(m.library ?? ""), license: esc(m.license ?? ""),
  };
  const factRows = (keys) => keys.filter(([k]) => facts[k]).map(([k, l]) => `<div><dt>${esc(l)}</dt><dd>${facts[k]}</dd></div>`).join("");
  const sub = [m.org, m.params ? `${params(m.params)} parameters` : "", m.weightBytes ? bytes(m.weightBytes) : "", m.license ?? ""].filter(Boolean);
  main.innerHTML = `${back}
    <section class="panel model-head">
      <div class="hero">${avatar(m)}
        <div class="who">
          <div class="title-row"><h1>${esc(m.name)}</h1><span class="stats"><span>${ICON.down}<b>${count(m.downloads)}</b></span><span>${ICON.heart}<b>${count(m.likes)}</b></span></span></div>
          <p class="org">${sub.map(esc).join(" · ")}</p>
        </div>
        <div class="actions">${verified(m) ? `<button type="button" class="button" id="verify">${ICON.seal}${esc(s.verify.label)}</button>` : ""}</div>
      </div>
      <div class="verdict" id="verdict" hidden></div>
      <dl class="rows">
        <div><dt>${esc(s.address)}</dt><dd>${copyLine(`${host}/${m.id}`, "endpoint section-tag copy")}${m.manifest ? `<code class="addr">${esc(m.manifest.slice(0, 22))}...</code>` : ""}</dd></div>
        <div><dt>${esc(s.held)}</dt><dd class="held">${(m.sources ?? []).map((x) => `<span class="pill">${ICON.seal}${esc(sourceName(x))}</span>`).join("") || "<span class=\"dim\">-</span>"}</dd></div>
        <div><dt>${esc(s.get)}</dt><dd>${listed ? `<p class="note">${esc(w.get)}</p>`
          : `<div class="ptabs" role="tablist">${s.tools.map(([tool], i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-tool="${i}">${esc(tool)}</button>`).join("")}</div>`}
          <div class="get">${copyLine(command(0), "command copy")}</div></dd></div>
        <div><dt>${esc(s.witnesses.row)}</dt><dd id="witnesses" class="witnesses">...</dd></div>
        <div><dt>${esc(s.trust.row)}</dt><dd id="signed" class="signed">...</dd></div>
      </dl>
    </section>
    <div class="detail">
      <aside class="panel facts"><dl>${factRows(s.facts)}</dl></aside>
      <section class="panel body">
        <div class="ptabs" role="tablist">${s.tabs.map((t, i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-tab="${i}">${esc(t)}</button>`).join("")}<button type="button" role="tab" aria-selected="false" data-tab="2" id="tensors-tab" hidden>${esc(s.trust.tensorsTab)}</button></div>
        <div id="tab"></div>
      </section>
    </div>`;
  main.querySelector(".rows").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tool]");
    if (!t) return;
    for (const b of t.parentElement.children) b.setAttribute("aria-selected", String(b === t));
    $(".get", main).innerHTML = copyLine(command(+t.dataset.tool), "command copy");
  });
  const overview = `<div class="tags">${tags(m, { full: true })}</div><h2>${esc(s.glance)}</h2><dl class="facts glance">${factRows(s.facts)}</dl>`;
  let treeRequest;
  // A model the roll knows and the index has not addressed brought its files
  // with it, from Hugging Face. Asking this hub's API for them would be asking
  // the wrong host: it does not hold a model it never indexed.
  const tree = () => (treeRequest ??= m.fileList
    ? Promise.resolve(m.fileList.map((f) => ({ path: f.path, size: f.size, oid: f.gitSha1, lfs: f.sha256 ? { oid: f.sha256 } : undefined })))
    : fetch(`${chrome.api}/api/models/${m.id}/tree/${m.revision ?? "main"}?recursive=true`)
      .then((r) => (r.ok ? r.json() : [])).then((all) => all.filter((f) => f.type === "file")).catch(() => []));
  $("#verify")?.addEventListener("click", () => verify(m, s.verify, tree));
  const filesTab = async () => {
    if (m.gated) return `<p class="note">${esc(s.gated)}</p>`;
    // Files the hub has not addressed are still worth listing: a reader came
    // here to see what a model holds. The sizes and names are Hugging Face's
    // answer, the status above the list already says Unverified, and nothing
    // here claims a hash of ours.
    if (!verified(m) && !m.fileList) return `<p class="note">${esc(s.queued)}</p>`;
    const files = await tree();
    if (!files.length) return `<p class="note">${esc(s.queued)}</p>`;
    const total = files.reduce((a, f) => a + (f.size ?? 0), 0);
    return `<p class="note">${esc(fill(s.filesNote, { n: files.length, size: bytes(total) }))}</p>
      <div class="scroll"><table><thead><tr><th>${esc(s.columns[0])}</th><th class="size">${esc(s.columns[1])}</th><th>${esc(s.columns[2])}</th></tr></thead><tbody>
      ${files.map((f) => `<tr><td class="path">${esc(f.path)}</td><td class="size">${esc(bytes(f.size ?? 0))}</td><td class="addr">${esc(((f.lfs?.oid ?? f.oid) || "").slice(0, 16))}</td></tr>`).join("")}
      </tbody></table></div>`;
  };
  drawWitnesses(m, s.witnesses);
  const signed = signature(m, s.trust);
  signed.then(({ manifest }) => { if (manifest) $("#tensors-tab").hidden = false; });
  const tensorsTab = async () => {
    const { manifest } = await signed;
    if (!manifest) return "";
    return `<p class="note">${esc(fill(s.trust.tensorsNote, { n: manifest.tensors.length }))}</p>
      <div class="scroll"><table><thead><tr>${s.trust.tensorColumns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
      ${manifest.tensors.map((t) => `<tr><td class="path">${esc(t.name)}</td><td>${esc(t.dtype)}</td><td>${esc(`[${t.shape.join(", ")}]`)}</td><td class="addr">${esc(t.blake3.slice(0, 23))}...</td></tr>`).join("")}
      </tbody></table></div>`;
  };
  const show = async (i) => {
    $("#tab").innerHTML = i ? `<p class="note">...</p>` : overview;
    if (i === 1) $("#tab").innerHTML = await filesTab();
    if (i === 2) $("#tab").innerHTML = await tensorsTab();
  };
  main.querySelector(".body .ptabs").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]");
    if (!t) return;
    for (const b of t.parentElement.children) b.setAttribute("aria-selected", String(b === t));
    show(+t.dataset.tab);
  });
  show(0);
}

// What the page says about who addressed this release's files. The counts are
// the kernel's answers, not the page's opinion.
async function drawWitnesses(m, w) {
  const cell = $("#witnesses");
  if (!cell) return;
  const record = await release(m.id);
  const known = await addresses(record);
  if (!known.size) { cell.textContent = ""; cell.closest("div")?.remove(); return; }
  const tally = { 1: 0, 2: 0, 3: 0, 0: 0 };
  for (const { plan } of known.values()) tally[plan] = (tally[plan] ?? 0) + 1;
  const sources = (record.witnesses ?? []).map((x) => x.source);
  const addressedCount = tally[1] + tally[2];
  const lines = [
    tally[1] ? fill(w.both, { n: tally[1], first: new URL(chrome.api).host, second: sources[0] ?? "" }) : "",
    tally[2] ? fill(w.one, { n: tally[2], source: sources[0] ?? new URL(chrome.api).host }) : "",
    tally[3] ? fill(w.conflict, { n: tally[3] }) : "",
    tally[0] ? fill(w.none, { n: tally[0] }) : "",
  ].filter(Boolean);
  cell.innerHTML = `<strong>${esc(fill(w.lead, { addressed: addressedCount, files: known.size }))}</strong>
    <ul class="checks">${lines.map((l, i) => `<li class="${i === 2 && tally[3] ? "no" : "ok"}">${esc(l)}</li>`).join("")}</ul>
    ${(record.witnesses ?? []).map((x) => `<p><code>${esc(fill(w.read, { source: x.source, date: x.date }))}</code></p>`).join("")}`;
}

// ---------------------------------------------------------------- registry
// The registry and apps lists are copies of the live hub's, taken when the
// site was built (tools/web-data.mjs); each page says when, from where, and
// the SHA-256 of what was copied.
const copied = (s, from) => `<p class="copied-from">${esc(fill(s.snapshot, { source: from.source, date: from.date, hash: from.hash.slice(0, 16) }))}...</p>`;
let registryData, appsData;
async function drawRegistry(main) {
  const s = screens.registry;
  registryData ??= fetch(new URL("data/registry.json", root)).then((r) => r.json());
  const { from, images } = await registryData;
  const q = new URLSearchParams(location.search);
  const st = { q: q.get("q") ?? "", sort: q.get("sort") ?? "pulls", page: 1, picked: Object.fromEntries(s.facets.map(([k]) => [k, q.getAll(k)])) };
  main.innerHTML = `
    <div class="lead"><h1>${esc(s.title)}</h1><span class="pill" id="count"></span></div>
    <p class="intro">${esc(s.lead)}</p>
    <div class="browse">
      <aside class="panel filters" id="filters"><div class="sections" id="filters-body"></div></aside>
      <section class="results">
        <div class="results-head"><div class="bar">
          <label class="field search">${ICON.search}<input id="q" type="search" placeholder="${esc(s.search)}" autocomplete="off" aria-label="${esc(s.search)}" /></label>
          ${sortControl(s.sorts, st.sort)}
        </div></div>
        <div class="grid" id="cards"></div>
        <nav class="pager" id="pager" aria-label="Pages"></nav>
        ${copied(s, from)}
      </section>
    </div>`;
  $("#q").value = st.q;
  const value = (row, key) => (row[key] == null ? [] : [String(row[key])]);
  const match = (row, skip) => {
    const hay = `${row.id} ${row.description ?? ""}`.toLowerCase();
    if (st.q && !st.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    return s.facets.every(([key]) => key === skip || !st.picked[key].length || st.picked[key].some((v) => value(row, key).includes(v)));
  };
  const order = { pulls: (r) => r.pulls ?? -1, stars: (r) => r.stars ?? -1 };
  const draw = () => {
    const shown = images.filter((r) => match(r));
    if (st.sort === "name") shown.sort((a, b) => a.id.localeCompare(b.id));
    else shown.sort((a, b) => order[st.sort](b) - order[st.sort](a));
    $("#count").textContent = count(shown.length);
    $("#filters-body").innerHTML = s.facets.map(([key, label]) => {
      const counts = new Map();
      for (const r of images) if (match(r, key)) for (const v of value(r, key)) counts.set(v, (counts.get(v) ?? 0) + 1);
      const rows = [...counts].sort((a, b) => b[1] - a[1]);
      const chips = rows.map(([v, n]) => `<button type="button" class="chip" data-facet="${esc(key)}" data-value="${esc(v)}" aria-pressed="${st.picked[key].includes(v)}"><span class="label">${esc(v)}</span><span class="n">${count(n)}</span></button>`).join("");
      return rows.length ? `<section class="facet"><header><h2>${esc(label)}</h2><button type="button" class="control reset" data-reset="${esc(key)}"${st.picked[key].length ? "" : " disabled"}>${ICON.reset}${esc(s.reset)}</button></header><div class="chips clamped">${chips}</div><button type="button" class="control more" hidden></button></section>` : "";
    }).join("");
    clampChips();
    const pages = Math.max(1, Math.ceil(shown.length / s.pageSize));
    st.page = Math.min(st.page, pages);
    const slice = shown.slice((st.page - 1) * s.pageSize, st.page * s.pageSize);
    $("#cards").innerHTML = slice.length ? slice.map((r) => {
      const commands = r.digest ? s.commands.filter(([reg]) => reg === "*" || reg === r.registry).map(([, t]) => fill(t, { ref: r.id, tag: r.tag ?? "latest", digest: r.digest })) : [];
      const facts = [r.pulls != null ? `<span>${ICON.down}${count(r.pulls)} ${esc(s.pulls)}</span>` : "", r.stars != null ? `<span>${ICON.star}${count(r.stars)}</span>` : "", r.size ? `<span>${esc(bytes(r.size))}</span>` : ""].join("");
      return `<article class="card entry">${art(r.digest || r.id)}
        <span class="tags"><span class="tag">${esc(r.registry)}</span>${r.kind ? `<span class="tag">${esc(r.kind)}</span>` : ""}${r.official ? `<span class="tag state addressed">official</span>` : ""}</span>
        <span class="title">${esc(r.org ? `${r.org}/` : "")}${esc(r.name)}${r.tag ? `:${esc(r.tag)}` : ""}</span>
        ${r.description ? `<span class="desc">${esc(r.description)}</span>` : ""}
        <span class="meta">${facts}</span>
        <span class="entry-actions">${commands.map((c) => copyLine(c, "endpoint section-tag copy")).join("")}${r.home ? `<a class="control" href="${esc(r.home)}" rel="noopener">${esc(s.open)}${ICON.external}</a>` : ""}</span>
      </article>`;
    }).join("") : `<div class="empty"><p>${esc(s.empty)}</p><button type="button" class="link" data-clear>${esc(s.clear)}</button></div>`;
    $("#pager").innerHTML = pagerHtml(st.page, pages, { previous: s.previous, next: s.next });
    const url = new URLSearchParams();
    if (st.q) url.set("q", st.q);
    if (st.sort !== "pulls") url.set("sort", st.sort);
    for (const [k, vs] of Object.entries(st.picked)) for (const v of vs) url.append(k, v);
    history.replaceState(null, "", `${href("registry/")}${url.size ? `?${url}` : ""}`);
  };
  let timer;
  $("#q").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => { st.q = e.target.value.trim(); st.page = 1; draw(); }, 144); });
  wireSort(main, (key) => { st.sort = key; st.page = 1; draw(); });
  main.querySelector(".browse").addEventListener("click", (e) => {
    const t = e.target.closest("button, a[data-page]");
    if (!t || t.dataset.copy !== undefined) return;
    if (t.dataset.facet) { const vs = st.picked[t.dataset.facet]; const i = vs.indexOf(t.dataset.value); i < 0 ? vs.push(t.dataset.value) : vs.splice(i, 1); st.page = 1; }
    else if (t.dataset.reset) st.picked[t.dataset.reset] = [];
    else if (t.dataset.more) { const chips = t.previousElementSibling; const open = chips.classList.toggle("clamped"); t.textContent = open ? t.dataset.more : s.less; return; }
    else if (t.dataset.page) { e.preventDefault(); st.page = +t.dataset.page; }
    else if ("clear" in t.dataset) { for (const k in st.picked) st.picked[k] = []; st.q = ""; $("#q").value = ""; }
    else return;
    draw();
  });
  draw();
}

// ---------------------------------------------------------------- apps
async function drawApps(main) {
  const s = screens.apps;
  appsData ??= fetch(new URL("data/apps.json", root)).then((r) => r.json());
  const { from, apps } = await appsData;
  main.innerHTML = `
    <div class="lead"><h1>${esc(s.title)}</h1><span class="pill">${apps.length}</span><div class="lead-end">${sortControl(s.sorts, "featured")}</div></div>
    <p class="intro">${esc(s.lead)}</p>
    <div class="grid apps" id="cards"></div>
    ${copied(s, from)}`;
  const draw = (sort) => {
    const list = [...apps];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "smallest") list.sort((a, b) => (a.modelBytes ?? 0) - (b.modelBytes ?? 0));
    if (sort === "largest") list.sort((a, b) => (b.modelBytes ?? 0) - (a.modelBytes ?? 0));
    $("#cards").innerHTML = list.map((a) => `<article class="card entry">${art(a.root || a.id)}
      <span class="tags">${a.task ? `<span class="tag">${esc(a.task)}</span>` : ""}<span class="tag">${esc(fill(s.files, { n: a.files ?? 0 }))}</span><span class="tag">${esc(bytes(a.bytes ?? 0))}</span></span>
      <span class="title">${esc(a.name)}</span>
      <span class="desc">${esc(a.tagline ?? "")}</span>
      ${(a.models ?? []).length ? `<span class="meta"><span>${esc(s.model)}: ${a.models.map((m) => `<a class="link" data-in href="${href(`models/${m}/`)}">${esc(m)}</a>`).join(", ")}</span>${a.modelBytes ? `<span>${esc(bytes(a.modelBytes))}</span>` : ""}</span>` : ""}
      ${(a.requires ?? []).length ? `<span class="meta"><span>${esc(s.requires)}: ${a.requires.map(esc).join(", ")}</span></span>` : ""}
      <span class="entry-actions">
        <a class="button primary" href="${esc(s.openBase + (a.entry ?? `${a.id}/`))}" rel="noopener">${esc(s.open)}${ICON.right}</a>
        ${a.root ? `<button type="button" class="control" data-copy="${esc(a.root)}">${esc(s.copy)}${ICON.copy}</button>` : ""}
        ${a.source ? `<a class="control" href="${esc(a.source)}" rel="noopener">${esc(s.source)}${ICON.external}</a>` : ""}
      </span>
    </article>`).join("");
  };
  wireSort(main, draw);
  draw("featured");
}

// ---------------------------------------------------------------- buckets
// Check an object: the page fetches it from the hub's object store, hashes it
// with the address's own hash, and the kernel's accept rule (HK-10) says
// whether these are the addressed bytes.
function drawBuckets(main) {
  const s = screens.buckets;
  main.innerHTML = `
    <div class="lead"><h1>${esc(s.title)}</h1>${copyLine(s.command)}</div>
    <div class="doc-grid">
      <article class="panel doc">
        <p class="intro">${esc(s.lead)}</p>
        <p><a class="button" href="${esc(s.manageHref)}" rel="noopener">${esc(s.manage)}${ICON.external}</a></p>
        <section><h2>${esc(s.checkTitle)}</h2><p>${esc(s.checkLead)}</p>
          <form class="check" id="check"><label class="field search">${ICON.search}<input id="address" spellcheck="false" autocomplete="off" placeholder="${esc(s.placeholder)}" aria-label="${esc(s.placeholder)}" /></label>
            <button type="submit" class="button primary">${esc(s.check)}</button></form>
          <button type="button" class="link" id="example">${esc(s.exampleLabel)}</button>
          <div class="verdict" id="object" hidden></div>
        </section>
        <p><a class="button" data-in href="${href(ROUTE_PATH[s.docsRoute])}">${esc(s.docs)}${ICON.right}</a></p>
      </article>
    </div>`;
  $("#example").addEventListener("click", () => { $("#address").value = s.example; $("#check").requestSubmit(); });
  $("#check").addEventListener("submit", async (event) => {
    event.preventDefault();
    const box = $("#object");
    const address = $("#address").value.trim();
    const m = address.match(/^(blake3|sha256):([0-9a-f]{64})$/);
    box.hidden = false;
    box.className = "verdict";
    if (!m) { box.innerHTML = `<p>${esc(s.verdicts.invalid)}</p>`; return; }
    box.innerHTML = "<p>...</p>";
    let code = 0;
    let size = 0;
    try {
      const r = await fetch(`${chrome.api}/api/v1/objects/${address}`, { signal: AbortSignal.timeout(20000) });
      if (r.ok) {
        const body = new Uint8Array(await r.arrayBuffer());
        size = body.length;
        const observed = m[1] === "blake3" ? blake3Hex(body) : [...new Uint8Array(await crypto.subtle.digest("SHA-256", body))].map((b) => b.toString(16).padStart(2, "0")).join("");
        const request = new Uint8Array(81);
        request.set([2]); request.set(hex(m[2]), 1); request.set(hex(observed), 33);
        request.set(u64(size), 65); request.set(u64(size), 73);
        code = (await kernel.dispatch(request))[0];
      }
    } catch {
      code = 0;
    }
    box.className = `verdict ${code === 20 ? "ok" : code === 21 ? "bad" : ""}`;
    box.innerHTML = `<p>${esc(fill(s.verdicts[code] ?? s.verdicts[0], { size: bytes(size) }))}</p>`;
  });
}

// ---------------------------------------------------------------- signature
// The page fetches the model's manifest and the witness's Sigstore bundle,
// checks the bundle against the trust roots the model pins (sigstore.mjs), and
// the kernel's trust rule (HK-14) decides the label from those checks.
const CHECKS = ["chain", "time", "log", "signature", "identity", "subject", "predicate"];
let manifestIndex, witnessBundle;
async function signature(m, t) {
  const cell = $("#signed");
  manifestIndex ??= fetch(new URL("data/manifests/index.json", root)).then((r) => (r.ok ? r.json() : { manifests: [] })).catch(() => ({ manifests: [] }));
  const entry = (await manifestIndex).manifests.find((x) => x.repo.toLowerCase() === m.id.toLowerCase());
  let facts = null;
  let manifest = null;
  if (entry) {
    witnessBundle ??= fetch(new URL("data/manifests/witness.sigstore.json", root)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [body, bundle] = await Promise.all([
      fetch(new URL(`data/manifests/${entry.repo}.json`, root)).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
      witnessBundle,
    ]);
    manifest = JSON.parse(new TextDecoder().decode(body));
    facts = bundle ? await verifyBundle(bundle, body, t.policy) : null;
  }
  const request = new Uint8Array(11);
  request[0] = 5;
  // A manifest that claims a witness but has no bundle counts as signed and
  // failing, so the kernel says it does not check out rather than unsigned.
  request[1] = entry ? 1 : 0;
  CHECKS.forEach((c, i) => { request[2 + i] = facts?.[c] ? 1 : 0; });
  request[9] = 1;
  request[10] = 0;
  const label = (await kernel.dispatch(request))[0];
  const when = facts?.signedAt ? `${new Date(facts.signedAt * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC` : "";
  cell.className = `signed s${label}`;
  cell.innerHTML = `<strong>${esc(fill(t.labels[label] ?? t.labels[3], { owner: m.id.split("/")[0] }))}</strong>${
    entry ? `<p>${esc(t.witness)} ${when ? esc(fill(t.logged, { when })) : ""}</p>
      <ul class="checks">${CHECKS.map((c) => `<li class="${facts?.[c] ? "ok" : "no"}">${facts?.[c] ? ICON.check : ICON.close}${esc(t.checks[c])}</li>`).join("")}</ul>
      <p><code>${esc(t.manifest)} sha256:${esc(entry.sha256.slice(0, 16))}...</code> · ${esc(String(entry.files))} files (${esc(String(manifest.files.filter((f) => f.witnessed).length))} ${esc(t.witnessed)}) · ${esc(String(entry.tensors))} tensors</p>` : ""}`;
  return { manifest, label };
}

// ---------------------------------------------------------------- verify
// The page measures and the kernel judges: for each source the page fetches
// one addressed file through the hub's /via/<source> route and hashes it; the
// kernel's accept rule (HK-10) says whether that copy matches its address, and
// its verdict rule (HK-13) turns the copies' results into what the page says.
const hex = (s) => Uint8Array.from(s.match(/../g).map((b) => parseInt(b, 16)));
const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };
async function verify(m, v, tree) {
  const button = $("#verify");
  const box = $("#verdict");
  // Every file a witness addressed, not only the ones Hugging Face published
  // an address for: the smallest is usually a few hundred bytes.
  const known = await addresses(await release(m.id));
  const files = (await tree())
    .map((f) => ({ ...f, address: f.lfs?.oid ?? f.oid, usable: known.get(f.path)?.sha256 ?? null }))
    .filter((f) => f.size > 0 && (/^[0-9a-f]{64}$/.test(f.address ?? "") || f.usable));
  const file = files.sort((a, b) => a.size - b.size)[0];
  const held = new Set(m.sources ?? []);
  const pick = v.sources.filter(([label]) => held.has(label)).slice(0, 4);
  if (!file || !pick.length) return;
  const expected = hex(/^[0-9a-f]{64}$/.test(file.address ?? "") ? file.address : file.usable);
  button.disabled = true;
  box.hidden = false;
  box.className = "verdict";
  box.innerHTML = `<p>${esc(fill(v.checking, { file: file.path, n: pick.length }))}</p>`;
  const started = performance.now();
  const results = await Promise.all(pick.map(async ([label, via]) => {
    try {
      const r = await fetch(`${chrome.api}/via/${via}/${m.id}/resolve/${m.revision ?? "main"}/${file.path}`, { signal: AbortSignal.timeout(v.timeoutMs) });
      if (!r.ok) return [label, 0];
      const body = new Uint8Array(await r.arrayBuffer());
      const observed = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
      const request = new Uint8Array(81);
      request.set([2]); request.set(expected, 1); request.set(observed, 33);
      request.set(u64(file.size), 65); request.set(u64(body.length), 73);
      return [label, (await kernel.dispatch(request))[0]];
    } catch {
      return [label, 0];
    }
  }));
  const codes = results.map(([, c]) => c);
  const verdict = (await kernel.dispatch(new Uint8Array([4, ...codes, 0, 0, 0, 0].slice(0, 5))))[0];
  const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
  const named = (code) => list(results.filter(([, c]) => c === code).map(([l]) => l));
  const text = fill(v.verdicts[verdict] ?? v.verdicts[0], { ms: Math.round(performance.now() - started), sources: named(verdict === 2 ? 21 : 20) });
  box.className = `verdict ${verdict === 1 ? "ok" : verdict === 2 ? "bad" : ""}`;
  box.innerHTML = `<p><strong>${esc(text)}</strong></p>
    <ul>${results.map(([label, c]) => `<li class="r${c}"><span>${esc(label)}</span><span>${esc(v.rows[c] ?? v.rows[0])}</span></li>`).join("")}</ul>
    <p class="note">${esc(file.path)} · ${esc(bytes(file.size))} · <code>${esc((/^[0-9a-f]{64}$/.test(file.address ?? "") ? file.address : file.usable).slice(0, 16))}</code> · ${esc(v.note)}</p>`;
  button.disabled = false;
}

// ---------------------------------------------------------------- docs
function drawDocs(main) {
  const s = screens.docs;
  const table = (cols, rows, code) => `<div class="scroll"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
    ${rows.map((r) => `<tr>${r.map((v, i) => `<td${code.includes(i) ? "" : ' class="prose"'}>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const cmd = (c) => `<div class="get">${copyLine(c, "command copy")}</div>`;
  const sections = s.sections.map((x) => `<section id="${esc(x.id)}"><h2>${esc(x.title)}</h2>
    ${x.body.map((p) => `<p>${esc(p)}</p>`).join("")}${(x.commands ?? []).map(cmd).join("")}</section>`).join("");
  const toc = [...s.sections.map((x) => [x.id, x.title]), ["record", s.record.title], ["routes", s.endpointsTitle], ["answers", s.answersTitle]];
  main.innerHTML = `
    <div class="lead"><h1>${esc(s.title)}</h1>${copyLine(s.command)}</div>
    <div class="doc-grid">
      <nav class="panel toc" aria-label="On this page">${toc.map(([id, t]) => `<a href="${href("docs/")}#${esc(id)}">${esc(t)}</a>`).join("")}</nav>
      <article class="panel doc">
        <p class="intro">${esc(s.lead)}</p>
        ${sections}
        <section id="record"><h2>${esc(s.record.title)}</h2><p>${esc(s.record.lead)}</p>
          ${table(["Field", "What it holds"], s.record.fields, [0])}
          ${table(["Plan", "What the kernel decides"], s.record.plans.map(([n, t]) => [String(n), t]), [0])}</section>
        <section id="routes"><h2>${esc(s.endpointsTitle)}</h2>${table(s.columnsRoutes, s.endpoints, [0, 1])}</section>
        <section id="answers"><h2>${esc(s.answersTitle)}</h2>${table(s.columnsAnswers, s.answers, [0, 1, 2])}</section>
        <p><a class="button" data-in href="${href(ROUTE_PATH[s.backRoute])}">${esc(s.back)}${ICON.right}</a></p>
      </article>
    </div>`;
}

boot().catch((error) => {
  $("#main").innerHTML = `<section class="panel note-panel">The hub could not start: ${esc(error.message)}</section>`;
});
