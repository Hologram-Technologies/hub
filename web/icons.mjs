// The house icon set (gethologram.ai src/render.mjs): 1.5 strokes on a 24 grid; size comes from CSS.
const I = (d) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const ICON = {
  heart: I('<path d="M19.5 12.6 12 20l-7.5-7.4A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 7.5 6Z"/>'),
  down: I('<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>'),
  calendar: I('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4m6-4v4"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  chevron: I('<path d="m6 9 6 6 6-6"/>'),
  left: I('<path d="m15 6-6 6 6 6"/>'),
  right: I('<path d="m9 6 6 6-6 6"/>'),
  copy: I('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  check: I('<path d="m5 12 5 5 9-10"/>'),
  sliders: I('<path d="M4 7h10m4 0h2M4 17h2m4 0h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
  reset: I('<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/>'),
  moon: I('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>'),
  sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
  image: I('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="m3 17 5.5-5.5 4 4L15 13l6 6"/><circle cx="15.5" cy="8.5" r="1.5"/>'),
  nodes: I('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.5 6h7M7.3 8.2l3.4 7.6M16.7 8.2l-3.4 7.6"/>'),
  user: I('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'),
  close: I('<path d="m6 6 12 12M18 6 6 18"/>'),
  menu: I('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  star: I('<path d="M12 4 14.12 9.09 19.61 9.53 15.42 13.11 16.7 18.47 12 15.6 7.3 18.47 8.58 13.11 4.39 9.53 9.88 9.09Z"/>'),
  github: '<svg class="i mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.68 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.82 1.19 3.08 0 4.41-2.7 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>',
  external: I('<path d="M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  grid: I('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
  tag: I('<path d="M3 12V4h8l9 9-8 8-9-9Z"/><circle cx="7.5" cy="8" r="1.2"/>'),
  layers: I('<path d="m12 4 9 5-9 5-9-5 9-5Z"/><path d="m3 14 9 5 9-5"/>'),
  seal: I('<path d="M12 3 20 7v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4Z"/><path d="m9 12 2 2 4-4"/>'),
  cpu: I('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M10 10h4v4h-4zM9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/>'),
  globe: I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
  file: I('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'),
  box: I('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  bucket: I('<path d="M4.5 7.5h15l-1.4 11.2a1.5 1.5 0 0 1-1.5 1.3H7.4a1.5 1.5 0 0 1-1.5-1.3Z"/><path d="M4.5 7.5c0-1.7 3.4-3 7.5-3s7.5 1.3 7.5 3"/>'),
  scale: I('<path d="M12 4v16M7 20h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7Zm14 0-3 7a3 3 0 0 0 6 0l-3-7Z"/>'),
  sortAz: I('<path d="M4 8h9M4 12h6M4 16h3M17 5v14m-3-3 3 3 3-3"/>'),
  sortCount: I('<path d="M4 8h3M4 12h6M4 16h9M17 5v14m-3-3 3 3 3-3"/>'),
};


// The mesh behind every catalogue card (gethologram.ai src/card-art.mjs): a faceted surface seeded by
// the entry's own address, 260x200 px to match .art in hub.css, so the same entry draws the same surface.
export const ART_W = 260, ART_H = 200;
const COLS = 9, ROWS = 6; // 32.5 x 40 px cells

export function art(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const r = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  const f = (n) => n.toFixed(1);
  const gx = ART_W / (COLS - 1), gy = ART_H / (ROWS - 1), p = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    p.push([x * gx + (r() - 0.5) * gx * 0.5, y * gy + (y && y < ROWS - 1 ? (r() - 0.5) * gy * 0.5 : 0)]);
  }
  let edges = "", faces = "";
  for (let y = 0; y < ROWS - 1; y++) for (let x = 0; x < COLS - 1; x++) {
    const a = p[y * COLS + x], b = p[y * COLS + x + 1], c = p[(y + 1) * COLS + x], d = p[(y + 1) * COLS + x + 1];
    for (const t of [[a, b, d], [a, d, c]]) {
      const path = `M${t.map((q) => `${f(q[0])} ${f(q[1])}`).join("L")}Z`;
      edges += path;
      const v = r();
      if (v < 0.35) faces += `<path d="${path}" opacity="${f(0.02 + v * 0.12)}"/>`;
    }
  }
  return `<svg class="art" viewBox="0 0 ${ART_W} ${ART_H}" preserveAspectRatio="xMaxYMin slice" aria-hidden="true"><g class="facets">${faces}</g><path class="edges" d="${edges}"/></svg>`;
}
