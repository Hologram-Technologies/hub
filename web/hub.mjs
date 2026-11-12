// The hub's renderer. It decides nothing about the hub: every label, route,
// link, facet, sort, size bucket and command comes from the proved kernel,
// which serves each screen from `app/src/Site.lex.tex`. This file loads that
// kernel's holo, checks it, asks it for screens, fetches catalog data from the
// hub's own Hugging Face API, and draws.

import { load } from "./app/vendor/prism-code/src/browser.mjs";
import { blake3Hex } from "./app/vendor/prism-code/src/blake3.mjs";
import { verifyBundle } from "./sigstore.mjs";

const root = new URL(".", import.meta.url);
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fill = (t, vars) => t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

const I = (d) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  grid: I('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
  box: I('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  cpu: I('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M10 10h4v4h-4zM9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/>'),
  bucket: I('<path d="M4.5 7.5h15l-1.4 11.2a1.5 1.5 0 0 1-1.5 1.3H7.4a1.5 1.5 0 0 1-1.5-1.3Z"/><path d="M4.5 7.5c0-1.7 3.4-3 7.5-3s7.5 1.3 7.5 3"/>'),
  file: I('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  copy: I('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  check: I('<path d="m5 12 5 5 9-10"/>'),
  back: I('<path d="M19 12H5m6-6-6 6 6 6"/>'),
  next: I('<path d="m9 6 6 6-6 6"/>'),
  sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  seal: I('<path d="m12 3 2.4 1.7 2.9-.2.9 2.8 2.4 1.7-.9 2.8.9 2.8-2.4 1.7-.9 2.8-2.9-.2L12 21l-2.4-1.7-2.9.2-.9-2.8-2.4-1.7.9-2.8-.9-2.8 2.4-1.7.9-2.8 2.9.2Z"/><path d="m9 12 2 2 4-4"/>'),
  heart: I('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>'),
  down: I('<path d="M12 4v12m-5-5 5 5 5-5M5 20h14"/>'),
  github: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.7s.8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .4 1 .4 2 .1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2Z"/></svg>',
};

// ---------------------------------------------------------------- the kernel
let kernel, chrome, screens = {};
const decoder = new TextDecoder();

async function boot() {
  kernel = await load(new URL("app/app.holo", root).href);
  if (!kernel.identities.verified) throw new Error("the kernel's holo failed its identity check");
  const routes = ["chrome", "home", "models", "model", "docs", "registry", "apps", "buckets"];
  for (const [i, name] of routes.entries()) {
    const bytes = await kernel.dispatch(new Uint8Array([3, i]));
    screens[name] = JSON.parse(decoder.decode(bytes));
  }
  chrome = screens.chrome;
  drawChrome();
  addEventListener("popstate", route);
  document.addEventListener("click", onClick);
  await route();
  // Every example the holo carries is replayed here, after first paint.
  const run = await kernel.acceptance();
  const chip = $("#proof");
  if (chip) {
    chip.classList.toggle("bad", run.passed !== run.total);
    $("#proof-text").textContent = `${chrome.proof} · ${run.passed} of ${run.total} examples hold`;
  }
}

// ---------------------------------------------------------------- data
let catalog;
async function models() {
  catalog ??= fetch(`${chrome.api}/api/models?limit=500`).then((r) => {
    if (!r.ok) throw new Error(`the hub answered ${r.status}`);
    return r.json();
  });
  return catalog;
}
const license = (m) => (m.tags ?? []).find((t) => t.startsWith("license:"))?.slice(8) ?? "";
const params = (m) => m.hologram?.parameters ?? m.safetensors?.total ?? 0;
// Verified: the index holds an address for every file (an unlisted row has a
// manifest name but no files yet).
const verified = (m) => (m.hologram?.files ?? 0) > 0;
const sources = (m) => m.hologram?.sources ?? [];
const words = (s) => String(s ?? "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
function sizeOf(m, spec) {
  const b = params(m) / 1e9;
  if (!b) return spec.unknownSize;
  return spec.sizes.find(([, lo, hi]) => b >= lo && b < hi)?.[0] ?? spec.unknownSize;
}
const FACET = {
  modality: (m) => (m.pipeline_tag ? [words(m.pipeline_tag)] : []),
  size: (m, s) => [sizeOf(m, s)],
  status: (m, s) => [verified(m) ? s.verified : s.unverified],
  source: (m) => sources(m),
  library: (m) => (m.library_name ? [m.library_name] : []),
  license: (m) => (license(m) ? [license(m)] : []),
};
const SORT = {
  trending: (m) => m.trendingScore ?? 0,
  downloads: (m) => m.downloads ?? 0,
  likes: (m) => m.likes ?? 0,
  created: (m) => Date.parse(m.createdAt ?? 0) || 0,
  params: (m) => params(m),
};
const short = (n) => (n >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n ?? 0));
const bytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} kB` : `${n} B`);
const month = (d) => (d ? new Date(d).toLocaleDateString("en", { month: "short", year: "numeric" }) : "");

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
    go(a.getAttribute("href"));
    return;
  }
  const copy = event.target.closest("[data-copy]");
  if (copy) {
    navigator.clipboard?.writeText(copy.dataset.copy);
    copy.classList.add("done");
    copy.querySelector(".i")?.replaceWith(document.createRange().createContextualFragment(ICON.check));
    setTimeout(() => copy.classList.remove("done"), 1300);
  }
  const theme = event.target.closest("[data-theme-set]");
  if (theme) setTheme(theme.dataset.themeSet);
}
async function route() {
  const p = path().replace(/\/+$/, "");
  const main = $("#main");
  const parts = p.split("/").filter(Boolean);
  let section = "";
  try {
    if (!parts.length) { section = ""; await drawHome(main); }
    else if (parts[0] === "models" && parts.length === 1) { section = "models"; await drawModels(main); }
    else if (parts[0] === "models" && parts.length >= 3) { section = "models"; await drawModel(main, `${parts[1]}/${parts[2]}`); }
    else if (parts[0] === "docs") { section = "docs"; drawDocs(main); }
    else if (parts[0] === "registry") { section = "registry"; await drawRegistry(main); }
    else if (parts[0] === "apps") { section = "apps"; await drawApps(main); }
    else if (parts[0] === "buckets") { section = "buckets"; drawBuckets(main); }
    else { section = ""; await drawHome(main); }
  } catch (error) {
    main.innerHTML = `<section class="panel note">${esc(error.message)}</section>`;
  }
  document.body.dataset.section = section || "home";
  for (const a of document.querySelectorAll(".nav a")) a.toggleAttribute("aria-current", a.dataset.section === section);
}

// ---------------------------------------------------------------- chrome
const ROUTE_PATH = { 1: "", 2: "models/", 3: "models/", 4: "docs/", 5: "registry/", 6: "apps/", 7: "buckets/" };
function drawChrome() {
  const nav = chrome.nav.map((n) => {
    const icon = ICON[n.icon] ?? "";
    if (n.route !== undefined) {
      const section = ROUTE_PATH[n.route].replace(/\/$/, "");
      return `<a data-in data-section="${esc(section)}" href="${href(ROUTE_PATH[n.route])}">${esc(n.label)} ${icon}</a>`;
    }
    return `<a href="${esc(n.href)}">${esc(n.label)} ${icon}</a>`;
  }).join("");
  const themes = chrome.themes.map((t) => `<button type="button" role="menuitem" data-theme-set="${esc(t.toLowerCase())}">${esc(t)}</button>`).join("");
  $("#chrome").innerHTML = `
    <a class="brand" data-in href="${href("")}" aria-label="${esc(chrome.brand)} home"><img src="app/favicon.svg" alt="" width="28" height="28" /><span>${esc(chrome.brand)}</span></a>
    <nav class="nav" aria-label="Main">${nav}</nav>
    <div class="tools">
      <a class="proof" id="proof" href="${esc(chrome.proofHref)}">${ICON.seal}<span id="proof-text">${esc(chrome.proof)}</span></a>
      <div class="theme"><button type="button" class="round" aria-haspopup="menu" aria-label="Theme">${ICON.sun}</button><div class="menu" role="menu">${themes}</div></div>
      <a class="signin" href="${esc(chrome.signInHref)}">${esc(chrome.signIn)}</a>
    </div>`;
}
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  document.documentElement.className = t === "light" ? "" : "dark";
  try { localStorage.setItem("hologram-hub.theme", t); } catch {}
}

// ---------------------------------------------------------------- home
async function drawHome(main) {
  const s = screens.home;
  const list = await models().catch(() => []);
  const count = list.length ? `${Math.floor(list.length / 100) * 100}+` : "";
  const fams = s.families.map(([label, q]) => `<a data-in href="${href(`models/?q=${encodeURIComponent(q)}`)}"><span class="dot">${esc(label[0])}</span>${esc(label)}</a>`).join("");
  main.innerHTML = `
    <section class="hero">
      <a class="badge" href="https://github.com/${esc(s.repo)}">${ICON.github}<span>${esc(s.badge)}</span></a>
      <h1>${s.headline.map(esc).join("<br />")}</h1>
      <p class="sub">${esc(s.lead)} <strong>${esc(s.accent)}</strong> ${ICON.seal} ${esc(s.tail)}</p>
      <div class="cta">
        <a class="button primary" data-in href="${href(ROUTE_PATH[s.ctaRoute])}">${esc(fill(s.cta, { count }).replace("  ", " "))} ${ICON.next}</a>
        <button type="button" class="command" data-copy="${esc(s.command)}"><span>$ ${esc(s.command)}</span>${ICON.copy}</button>
      </div>
    </section>
    <div class="strip" aria-label="Model families"><div class="track">${fams}${fams}</div></div>`;
}

// ---------------------------------------------------------------- catalog
function state() {
  const q = new URLSearchParams(location.search);
  const picked = {};
  for (const [key] of screens.models.facets) picked[key] = q.getAll(key);
  return { q: q.get("q") ?? "", sort: q.get("sort") ?? "trending", page: Math.max(1, +(q.get("page") ?? 1)), picked };
}
function setState(st) {
  const q = new URLSearchParams();
  if (st.q) q.set("q", st.q);
  if (st.sort !== "trending") q.set("sort", st.sort);
  for (const [k, vs] of Object.entries(st.picked)) for (const v of vs) q.append(k, v);
  if (st.page > 1) q.set("page", st.page);
  history.replaceState(null, "", `${href("models/")}${q.size ? `?${q}` : ""}`);
}
function matches(m, st, skip) {
  const s = screens.models;
  const hay = `${m.id} ${m.pipeline_tag ?? ""} ${m.library_name ?? ""}`.toLowerCase();
  if (st.q && !st.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  for (const [key] of s.facets) {
    if (key === skip || !st.picked[key].length) continue;
    const have = FACET[key](m, s);
    if (!st.picked[key].some((v) => have.includes(v))) return false;
  }
  return true;
}
async function drawModels(main) {
  const s = screens.models;
  const list = await models();
  main.innerHTML = `
    <div class="title"><h1>${esc(s.title)}</h1><span class="pill" id="count"></span><button type="button" class="chip" data-copy="${esc(s.command)}">$ ${esc(s.command)} ${ICON.copy}</button></div>
    <div class="browse">
      <aside class="panel filters" id="filters" aria-label="${esc(s.filters)}"></aside>
      <section class="results">
        <div class="bar">
          <label class="search">${ICON.search}<input id="q" type="search" placeholder="${esc(s.search)}" autocomplete="off" /></label>
          <select id="sort" aria-label="Sort">${s.sorts.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join("")}</select>
        </div>
        <div class="cards" id="cards"></div>
        <nav class="pager" id="pager" aria-label="Pages"></nav>
      </section>
    </div>`;
  const st = state();
  $("#q").value = st.q;
  $("#sort").value = st.sort;
  const open = {};
  const draw = () => {
    setState(st);
    const shown = list.filter((m) => matches(m, st)).sort((a, b) => SORT[st.sort](b) - SORT[st.sort](a));
    $("#count").textContent = shown.length;
    $("#filters").innerHTML = s.facets.map(([key, label]) => {
      const counts = new Map();
      for (const m of list) if (matches(m, st, key)) for (const v of FACET[key](m, s)) counts.set(v, (counts.get(v) ?? 0) + 1);
      for (const v of st.picked[key]) if (!counts.has(v)) counts.set(v, 0);
      let rows = [...counts].sort((a, b) => b[1] - a[1]);
      if (key === "size") rows = [...s.sizes.map(([l]) => l), s.unknownSize].filter((l) => counts.has(l)).map((l) => [l, counts.get(l)]);
      const limit = open[key] ? rows.length : 8;
      const chips = rows.slice(0, limit).map(([v, n]) => `<button type="button" class="tag${st.picked[key].includes(v) ? " on" : ""}" data-facet="${esc(key)}" data-value="${esc(v)}">${esc(v)} <span>${n}</span></button>`).join("");
      const more = rows.length > 8 ? `<button type="button" class="more" data-more="${esc(key)}">${esc(open[key] ? s.less : fill(s.more, { n: rows.length - 8 }))}</button>` : "";
      const reset = st.picked[key].length ? `<button type="button" class="reset" data-reset="${esc(key)}">${esc(s.reset)}</button>` : "";
      return `<section class="facet"><header><h2>${esc(label)}</h2>${reset}</header><div class="tags">${chips}</div>${more}</section>`;
    }).join("");
    const pages = Math.max(1, Math.ceil(shown.length / s.pageSize));
    st.page = Math.min(st.page, pages);
    const slice = shown.slice((st.page - 1) * s.pageSize, st.page * s.pageSize);
    $("#cards").innerHTML = slice.length ? slice.map((m) => card(m, s)).join("")
      : `<div class="empty"><p>${esc(s.empty)}</p><button type="button" class="button" data-clear>${esc(s.clear)}</button></div>`;
    $("#pager").innerHTML = pages > 1 ? `
      <button type="button" data-page="${st.page - 1}" ${st.page === 1 ? "disabled" : ""}>${esc(s.previous)}</button>
      <span>${st.page} / ${pages}</span>
      <button type="button" data-page="${st.page + 1}" ${st.page === pages ? "disabled" : ""}>${esc(s.next)}</button>` : "";
  };
  let timer;
  $("#q").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => { st.q = e.target.value.trim(); st.page = 1; draw(); }, 144); });
  $("#sort").addEventListener("change", (e) => { st.sort = e.target.value; st.page = 1; draw(); });
  main.querySelector(".browse").addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.facet) {
      const vs = st.picked[t.dataset.facet];
      const i = vs.indexOf(t.dataset.value);
      i < 0 ? vs.push(t.dataset.value) : vs.splice(i, 1);
      st.page = 1;
    } else if (t.dataset.reset) st.picked[t.dataset.reset] = [];
    else if (t.dataset.more) open[t.dataset.more] = !open[t.dataset.more];
    else if (t.dataset.page) st.page = +t.dataset.page;
    else if ("clear" in t.dataset) { for (const k in st.picked) st.picked[k] = []; st.q = ""; $("#q").value = ""; }
    else return;
    draw();
  });
  draw();
}
function card(m, s) {
  const [org, name] = m.id.split("/");
  const tags = [esc(org), verified(m) ? `<b class="ok">${esc(s.verified)}</b>` : `<b class="no">${esc(s.unverified)}</b>`];
  if (params(m)) tags.push(esc(short(params(m))));
  if (m.pipeline_tag) tags.push(esc(words(m.pipeline_tag)));
  return `<a class="card" data-in href="${href(`models/${m.id}/`)}">
    <span class="tags">${tags.map((t) => `<span>${t}</span>`).join("")}</span>
    <span class="name">${esc(name)}</span>
    <span class="meta">${ICON.heart} ${short(m.likes)} · ${ICON.down} ${short(m.downloads)} · ${esc(sources(m).length)} sources · ${esc(month(m.createdAt))}</span>
  </a>`;
}

// ---------------------------------------------------------------- model
async function drawModel(main, id) {
  const s = screens.model;
  const list = await models();
  // The catalog holds the 500 trending models; any other indexed model is found
  // through the hub's search.
  const same = (x) => x.id.toLowerCase() === id.toLowerCase();
  const m = list.find(same) ?? await fetch(`${chrome.api}/api/models?search=${encodeURIComponent(id.split("/")[1] ?? id)}&limit=50`)
    .then((r) => (r.ok ? r.json() : [])).then((found) => found.find(same)).catch(() => undefined);
  if (!m) {
    main.innerHTML = `<a class="back" data-in href="${href("models/")}">${ICON.back} ${esc(s.back)}</a><section class="panel note">${esc(s.missing)}</section>`;
    return;
  }
  const [org, name] = m.id.split("/");
  const host = chrome.host;
  const tools = s.tools.map(([tool, t], i) => `<button type="button" role="tab" class="${i ? "" : "on"}" data-tool="${i}">${esc(tool)}</button>`).join("");
  const command = (i) => fill(s.tools[i][1], { host, repo: m.id });
  const facts = {
    status: verified(m) ? `<b class="ok">${esc(s.verified)}</b>` : `<b class="no">${esc(s.unverified)}</b>`,
    revision: m.sha ? `<code>${esc(m.sha.slice(0, 12))}</code>` : "",
    files: m.hologram?.files ?? "",
    weights: m.hologram?.weight_bytes ? bytes(m.hologram.weight_bytes) : "",
    params: params(m) ? short(params(m)) : "",
    task: m.pipeline_tag ? words(m.pipeline_tag) : "",
    library: m.library_name ?? "",
    license: license(m),
  };
  main.innerHTML = `
    <a class="back" data-in href="${href("models/")}">${ICON.back} ${esc(s.back)}</a>
    <section class="panel head">
      <div class="who"><span class="avatar">${esc(org[0]?.toUpperCase())}</span>
        <div><h1>${esc(name)} <small>${ICON.down} ${short(m.downloads)} · ${ICON.heart} ${short(m.likes)}</small></h1>
        <p class="dim">${esc(org)}${params(m) ? ` · ${short(params(m))} parameters` : ""}${m.hologram?.weight_bytes ? ` · ${bytes(m.hologram.weight_bytes)}` : ""}${license(m) ? ` · ${esc(license(m))}` : ""}</p></div>
        ${verified(m) ? `<button type="button" class="button verify" id="verify">${ICON.seal} ${esc(s.verify.label)}</button>` : ""}</div>
      <div class="verdict" id="verdict" hidden></div>
      <dl class="rows">
        <dt>${esc(s.address)}</dt><dd><code>${esc(host)}/${esc(m.id)}</code>${m.hologram?.manifest ? ` <code class="dim">${esc(m.hologram.manifest.slice(0, 22))}…</code>` : ""}</dd>
        <dt>${esc(s.held)}</dt><dd class="pills">${sources(m).map((x) => `<span class="pill">${esc(x)}</span>`).join("")}</dd>
        <dt>${esc(s.get)}</dt><dd><div class="tabs small" role="tablist">${tools}</div>
          <button type="button" class="command wide" id="cmd" data-copy="${esc(command(0))}"><span>$ ${esc(command(0))}</span>${ICON.copy}</button></dd>
        <dt>${esc(s.trust.row)}</dt><dd id="signed" class="dim">…</dd>
      </dl>
    </section>
    <div class="split">
      <aside class="panel facts"><dl>${s.facts.map(([k, l]) => `<dt>${esc(l)}</dt><dd>${typeof facts[k] === "string" && facts[k].startsWith("<") ? facts[k] : esc(facts[k] || "—")}</dd>`).join("")}</dl></aside>
      <section class="panel body">
        <div class="tabs" role="tablist">${s.tabs.map((t, i) => `<button type="button" role="tab" class="${i ? "" : "on"}" data-tab="${i}">${esc(t)}</button>`).join("")}<button type="button" role="tab" data-tab="2" id="tensors-tab" hidden>${esc(s.trust.tensorsTab)}</button></div>
        <div id="tab"></div>
      </section>
    </div>`;
  main.querySelector(".head").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tool]");
    if (!t) return;
    for (const b of t.parentElement.children) b.classList.toggle("on", b === t);
    const c = command(+t.dataset.tool);
    const cmd = $("#cmd");
    cmd.dataset.copy = c;
    cmd.querySelector("span").textContent = `$ ${c}`;
  });
  const overview = `<h2>${esc(s.glance)}</h2><dl class="glance">${s.facts.filter(([k]) => facts[k]).map(([k, l]) => `<dt>${esc(l)}</dt><dd>${typeof facts[k] === "string" && facts[k].startsWith("<") ? facts[k] : esc(facts[k])}</dd>`).join("")}</dl>`;
  let treeRequest;
  const tree = () => (treeRequest ??= fetch(`${chrome.api}/api/models/${m.id}/tree/${m.sha ?? "main"}?recursive=true`)
    .then((r) => (r.ok ? r.json() : [])).then((all) => all.filter((f) => f.type === "file")).catch(() => []));
  $("#verify")?.addEventListener("click", () => verify(m, s.verify, tree));
  const filesTab = async () => {
    if (m.gated) return `<p class="note">${esc(s.gated)}</p>`;
    if (!verified(m)) return `<p class="note">${esc(s.queued)}</p>`;
    const files = await tree();
    if (!files.length) return `<p class="note">${esc(s.queued)}</p>`;
    const total = files.reduce((a, f) => a + (f.size ?? 0), 0);
    return `<p class="dim">${esc(fill(s.filesNote, { n: files.length, size: bytes(total) }))}</p>
      <div class="scroll"><table><thead><tr>${s.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
      ${files.map((f) => `<tr><td>${esc(f.path)}</td><td>${esc(bytes(f.size ?? 0))}</td><td><code>${esc(((f.lfs?.oid ?? f.oid) || "").slice(0, 16))}</code></td></tr>`).join("")}
      </tbody></table></div>`;
  };
  const signed = signature(m, s.trust);
  signed.then(({ manifest }) => { if (manifest) $("#tensors-tab").hidden = false; });
  const tensorsTab = async () => {
    const { manifest } = await signed;
    if (!manifest) return "";
    return `<p class="dim">${esc(fill(s.trust.tensorsNote, { n: manifest.tensors.length }))}</p>
      <div class="scroll"><table><thead><tr>${s.trust.tensorColumns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
      ${manifest.tensors.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.dtype)}</td><td>${esc(`[${t.shape.join(", ")}]`)}</td><td><code>${esc(t.blake3.slice(0, 23))}…</code></td></tr>`).join("")}
      </tbody></table></div>`;
  };
  const show = async (i) => {
    $("#tab").innerHTML = i ? `<p class="dim">…</p>` : overview;
    if (i === 1) $("#tab").innerHTML = await filesTab();
    if (i === 2) $("#tab").innerHTML = await tensorsTab();
  };
  main.querySelector(".body .tabs").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]");
    if (!t) return;
    for (const b of t.parentElement.children) b.classList.toggle("on", b === t);
    show(+t.dataset.tab);
  });
  show(0);
}

// ---------------------------------------------------------------- registry
// The registry and apps lists are copies of the live hub's, taken when the
// site was built (tools/web-data.mjs); each page says when, from where, and
// the SHA-256 of what was copied.
const copied = (s, from) => `<p class="dim small">${esc(fill(s.snapshot, { source: from.source, date: from.date, hash: from.hash.slice(0, 16) }))}…</p>`;
let registryData, appsData;
async function drawRegistry(main) {
  const s = screens.registry;
  registryData ??= fetch(new URL("data/registry.json", root)).then((r) => r.json());
  const { from, images } = await registryData;
  const q = new URLSearchParams(location.search);
  const st = { q: q.get("q") ?? "", sort: q.get("sort") ?? "pulls", page: 1, picked: Object.fromEntries(s.facets.map(([k]) => [k, q.getAll(k)])) };
  main.innerHTML = `
    <div class="title"><h1>${esc(s.title)}</h1><span class="pill" id="count"></span></div>
    <p class="lead">${esc(s.lead)}</p>
    <div class="browse">
      <aside class="panel filters" id="filters"></aside>
      <section class="results">
        <div class="bar">
          <label class="search">${ICON.search}<input id="q" type="search" placeholder="${esc(s.search)}" autocomplete="off" /></label>
          <select id="sort" aria-label="Sort">${s.sorts.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join("")}</select>
        </div>
        <div class="cards" id="cards"></div>
        <nav class="pager" id="pager" aria-label="Pages"></nav>
        ${copied(s, from)}
      </section>
    </div>`;
  $("#q").value = st.q;
  $("#sort").value = st.sort;
  const open = {};
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
    $("#count").textContent = shown.length;
    $("#filters").innerHTML = s.facets.map(([key, label]) => {
      const counts = new Map();
      for (const r of images) if (match(r, key)) for (const v of value(r, key)) counts.set(v, (counts.get(v) ?? 0) + 1);
      const rows = [...counts].sort((a, b) => b[1] - a[1]);
      const limit = open[key] ? rows.length : 8;
      const chips = rows.slice(0, limit).map(([v, n]) => `<button type="button" class="tag${st.picked[key].includes(v) ? " on" : ""}" data-facet="${esc(key)}" data-value="${esc(v)}">${esc(v)} <span>${n}</span></button>`).join("");
      const more = rows.length > 8 ? `<button type="button" class="more" data-more="${esc(key)}">${esc(open[key] ? s.less : fill(s.more, { n: rows.length - 8 }))}</button>` : "";
      const reset = st.picked[key].length ? `<button type="button" class="reset" data-reset="${esc(key)}">${esc(s.reset)}</button>` : "";
      return rows.length ? `<section class="facet"><header><h2>${esc(label)}</h2>${reset}</header><div class="tags">${chips}</div>${more}</section>` : "";
    }).join("");
    const pages = Math.max(1, Math.ceil(shown.length / s.pageSize));
    st.page = Math.min(st.page, pages);
    const slice = shown.slice((st.page - 1) * s.pageSize, st.page * s.pageSize);
    $("#cards").innerHTML = slice.length ? slice.map((r) => {
      const ref = r.id;
      const commands = r.digest ? s.commands.filter(([reg]) => reg === "*" || reg === r.registry).map(([, t]) => fill(t, { ref, tag: r.tag ?? "latest", digest: r.digest })) : [];
      return `<article class="card entry">
        <span class="tags"><span>${esc(r.registry)}</span><span>${esc(r.kind ?? "")}</span>${r.official ? `<b class="ok">official</b>` : ""}</span>
        <span class="name">${esc(r.org ? `${r.org}/` : "")}${esc(r.name)}${r.tag ? `:${esc(r.tag)}` : ""}</span>
        ${r.description ? `<span class="desc">${esc(r.description)}</span>` : ""}
        <span class="meta">${r.pulls != null ? `${ICON.down} ${short(r.pulls)} ${esc(s.pulls)}` : ""}${r.stars != null ? ` · ${short(r.stars)} ${esc(s.stars)}` : ""}${r.size ? ` · ${esc(bytes(r.size))}` : ""}</span>
        ${r.digest ? `<span class="meta"><code>${esc(s.digest)} ${esc(r.digest.slice(0, 19))}…</code></span>` : ""}
        <span class="actions">${commands.map((c) => `<button type="button" class="chip" data-copy="${esc(c)}">$ ${esc(c.length > 46 ? `${c.slice(0, 45)}…` : c)} ${ICON.copy}</button>`).join("")}
          ${r.home ? `<a class="chip" href="${esc(r.home)}" rel="noopener">${esc(s.open)} ${ICON.next}</a>` : ""}</span>
      </article>`;
    }).join("") : `<div class="empty"><p>${esc(s.empty)}</p><button type="button" class="button" data-clear>${esc(s.clear)}</button></div>`;
    $("#pager").innerHTML = pages > 1 ? `<button type="button" data-page="${st.page - 1}" ${st.page === 1 ? "disabled" : ""}>${esc(s.previous)}</button><span>${st.page} / ${pages}</span><button type="button" data-page="${st.page + 1}" ${st.page === pages ? "disabled" : ""}>${esc(s.next)}</button>` : "";
    const url = new URLSearchParams();
    if (st.q) url.set("q", st.q);
    if (st.sort !== "pulls") url.set("sort", st.sort);
    for (const [k, vs] of Object.entries(st.picked)) for (const v of vs) url.append(k, v);
    history.replaceState(null, "", `${href("registry/")}${url.size ? `?${url}` : ""}`);
  };
  let timer;
  $("#q").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => { st.q = e.target.value.trim(); st.page = 1; draw(); }, 144); });
  $("#sort").addEventListener("change", (e) => { st.sort = e.target.value; st.page = 1; draw(); });
  main.querySelector(".browse").addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t || t.dataset.copy !== undefined) return;
    if (t.dataset.facet) { const vs = st.picked[t.dataset.facet]; const i = vs.indexOf(t.dataset.value); i < 0 ? vs.push(t.dataset.value) : vs.splice(i, 1); st.page = 1; }
    else if (t.dataset.reset) st.picked[t.dataset.reset] = [];
    else if (t.dataset.more) open[t.dataset.more] = !open[t.dataset.more];
    else if (t.dataset.page) st.page = +t.dataset.page;
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
    <div class="title"><h1>${esc(s.title)}</h1><span class="pill">${apps.length}</span>
      <select id="sort" aria-label="Sort" class="sort">${s.sorts.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join("")}</select></div>
    <p class="lead">${esc(s.lead)}</p>
    <div class="cards apps" id="cards"></div>
    ${copied(s, from)}`;
  const draw = (sort) => {
    const list = [...apps];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "smallest") list.sort((a, b) => (a.modelBytes ?? 0) - (b.modelBytes ?? 0));
    if (sort === "largest") list.sort((a, b) => (b.modelBytes ?? 0) - (a.modelBytes ?? 0));
    $("#cards").innerHTML = list.map((a) => `<article class="card app">
      <span class="tags"><span>${esc(a.task ?? "")}</span><span>${esc(fill(s.files, { n: a.files ?? 0 }))}</span><span>${esc(bytes(a.bytes ?? 0))}</span></span>
      <span class="name">${esc(a.name)}</span>
      <span class="desc">${esc(a.tagline ?? "")}</span>
      ${(a.models ?? []).length ? `<span class="meta">${esc(s.model)}: ${a.models.map((m) => `<a data-in href="${href(`models/${m}/`)}">${esc(m)}</a>`).join(", ")}${a.modelBytes ? ` · ${esc(bytes(a.modelBytes))}` : ""}</span>` : ""}
      ${(a.requires ?? []).length ? `<span class="meta">${esc(s.requires)}: ${a.requires.map(esc).join(", ")}</span>` : ""}
      <span class="actions">
        <a class="button primary" href="${esc(s.openBase + (a.entry ?? `${a.id}/`))}" rel="noopener">${esc(s.open)} ${ICON.next}</a>
        ${a.root ? `<button type="button" class="chip" data-copy="${esc(a.root)}">${esc(s.copy)} ${ICON.copy}</button>` : ""}
        ${a.source ? `<a class="chip" href="${esc(a.source)}" rel="noopener">${esc(s.source)}</a>` : ""}
      </span>
    </article>`).join("");
  };
  $("#sort").addEventListener("change", (e) => draw(e.target.value));
  draw("featured");
}

// ---------------------------------------------------------------- buckets
// Check an object: the page fetches it from the hub's object store, hashes it
// with the address's own hash, and the kernel's accept rule (HK-10) says
// whether these are the addressed bytes.
function drawBuckets(main) {
  const s = screens.buckets;
  main.innerHTML = `
    <article class="panel doc buckets">
      <h1>${esc(s.title)}</h1>
      <p>${esc(s.lead)}</p>
      <p><a class="button" href="${esc(s.manageHref)}" rel="noopener">${esc(s.manage)} ${ICON.next}</a></p>
      <button type="button" class="command block" data-copy="${esc(s.command)}"><span>$ ${esc(s.command)}</span>${ICON.copy}</button>
      <section><h2>${esc(s.checkTitle)}</h2><p>${esc(s.checkLead)}</p>
        <form class="check" id="check"><label class="search">${ICON.search}<input id="address" spellcheck="false" autocomplete="off" placeholder="${esc(s.placeholder)}" /></label>
          <button type="submit" class="button primary">${esc(s.check)}</button></form>
        <button type="button" class="more" id="example">${esc(s.exampleLabel)}</button>
        <div class="verdict" id="object" hidden></div>
      </section>
      <p><a class="button" data-in href="${href(ROUTE_PATH[s.docsRoute])}">${esc(s.docs)} ${ICON.next}</a></p>
    </article>`;
  $("#example").addEventListener("click", () => { $("#address").value = s.example; $("#check").requestSubmit(); });
  $("#check").addEventListener("submit", async (event) => {
    event.preventDefault();
    const box = $("#object");
    const address = $("#address").value.trim();
    const m = address.match(/^(blake3|sha256):([0-9a-f]{64})$/);
    box.hidden = false;
    box.className = "verdict";
    if (!m) { box.innerHTML = `<p>${esc(s.verdicts.invalid)}</p>`; return; }
    box.innerHTML = "<p>…</p>";
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
    box.className = `verdict ${code === 20 ? "v1" : code === 21 ? "v2" : ""}`;
    box.innerHTML = `<p><strong>${esc(fill(s.verdicts[code] ?? s.verdicts[0], { size: bytes(size) }))}</strong></p>`;
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
    const [bytes, bundle] = await Promise.all([
      fetch(new URL(`data/manifests/${entry.repo}.json`, root)).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
      witnessBundle,
    ]);
    manifest = JSON.parse(new TextDecoder().decode(bytes));
    facts = bundle ? await verifyBundle(bundle, bytes, t.policy) : null;
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
  const when = facts?.signedAt ? new Date(facts.signedAt * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "";
  cell.className = `signed s${label}`;
  cell.innerHTML = `<strong>${esc(fill(t.labels[label] ?? t.labels[3], { owner: m.id.split("/")[0] }))}</strong>${
    entry ? `<p class="dim">${esc(t.witness)} ${when ? esc(fill(t.logged, { when })) : ""}</p>
      <ul class="checks">${CHECKS.map((c) => `<li class="${facts?.[c] ? "ok" : "no"}">${facts?.[c] ? ICON.check : "×"} ${esc(t.checks[c])}</li>`).join("")}</ul>
      <p class="dim"><code>${esc(t.manifest)} sha256:${esc(entry.sha256.slice(0, 16))}…</code> · ${esc(String(entry.files))} files (${esc(String(manifest.files.filter((f) => f.witnessed).length))} ${esc(t.witnessed)}) · ${esc(String(entry.tensors))} tensors</p>` : ""}`;
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
  const files = (await tree()).filter((f) => /^[0-9a-f]{64}$/.test(f.lfs?.oid ?? f.oid ?? "") && f.size > 0);
  const file = files.sort((a, b) => a.size - b.size)[0];
  const held = new Set(sources(m));
  const pick = v.sources.filter(([label]) => held.has(label)).slice(0, 4);
  if (!file || !pick.length) return;
  const expected = hex(file.lfs?.oid ?? file.oid);
  button.disabled = true;
  box.hidden = false;
  box.className = "verdict";
  box.innerHTML = `<p>${esc(fill(v.checking, { file: file.path, n: pick.length }))}</p>`;
  const started = performance.now();
  const results = await Promise.all(pick.map(async ([label, via]) => {
    try {
      const r = await fetch(`${chrome.api}/via/${via}/${m.id}/resolve/${m.sha ?? "main"}/${file.path}`, { signal: AbortSignal.timeout(v.timeoutMs) });
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
  box.className = `verdict v${verdict}`;
  box.innerHTML = `<p><strong>${esc(text)}</strong></p>
    <ul>${results.map(([label, c]) => `<li class="r${c}"><span>${esc(label)}</span><span>${esc(v.rows[c] ?? v.rows[0])}</span></li>`).join("")}</ul>
    <p class="dim">${esc(file.path)} · ${esc(bytes(file.size))} · <code>${esc((file.lfs?.oid ?? file.oid).slice(0, 16))}</code> · ${esc(v.note)}</p>`;
  button.disabled = false;
}

// ---------------------------------------------------------------- docs
function drawDocs(main) {
  const s = screens.docs;
  const table = (cols, rows, code) => `<div class="scroll"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
    ${rows.map((r) => `<tr>${r.map((v, i) => `<td>${code.includes(i) ? `<code>${esc(v)}</code>` : esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const cmd = (c) => `<button type="button" class="command block" data-copy="${esc(c)}"><span>$ ${esc(c)}</span>${ICON.copy}</button>`;
  const sections = s.sections.map((x) => `<section id="${esc(x.id)}"><h2>${esc(x.title)}</h2>
    ${x.body.map((p) => `<p>${esc(p)}</p>`).join("")}${(x.commands ?? []).map(cmd).join("")}</section>`).join("");
  const toc = [...s.sections.map((x) => [x.id, x.title]), ["routes", s.endpointsTitle], ["answers", s.answersTitle]];
  main.innerHTML = `
    <div class="docs">
      <nav class="panel toc" aria-label="On this page">${toc.map(([id, t]) => `<a href="${href("docs/")}#${esc(id)}">${esc(t)}</a>`).join("")}</nav>
      <article class="panel doc">
        <h1>${esc(s.title)}</h1>
        <p>${esc(s.lead)}</p>
        ${cmd(s.command)}
        ${sections}
        <section id="routes"><h2>${esc(s.endpointsTitle)}</h2>${table(s.columnsRoutes, s.endpoints, [1])}</section>
        <section id="answers"><h2>${esc(s.answersTitle)}</h2>${table(s.columnsAnswers, s.answers, [2])}</section>
        <p><a class="button" data-in href="${href(ROUTE_PATH[s.backRoute])}">${esc(s.back)} ${ICON.next}</a></p>
      </article>
    </div>`;
}

boot().catch((error) => {
  $("#main").innerHTML = `<section class="panel note">The hub could not start: ${esc(error.message)}</section>`;
});
