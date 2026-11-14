// Reads the browse index (`tools/browse-index.mjs`) from the page, a range at
// a time, so the interface can draw a catalogue of three million models
// without holding one. A page is a slice of an order and a row apiece by
// offset; a filtered page is the intersection of ascending position lists
// before the slice.
//
// What this cannot do, and says so rather than implying otherwise: check the
// bytes. The hub's rule everywhere else is that a reader hashes what it is
// given and compares with a signed root, which needs the whole file. A ranged
// read is a few hundred bytes out of 400 MB, so a page drawn this way is the
// host's word. `checked` on the handle is false for exactly that reason, and
// the interface says "Unsigned listing" when it is drawing from here.
//
// The roll itself stays checkable: its shards are small, named by its root,
// and `tests/roll/published.mjs` refuses to publish one that is not.

const u32 = (view, at) => view.getUint32(at, true);

async function range(url, from, length) {
  if (length <= 0) return new Uint8Array(0);
  const r = await fetch(url, { headers: { Range: `bytes=${from}-${from + length - 1}` } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  // A host that ignores Range answers 200 with the whole file. Taking the
  // slice ourselves keeps the reader correct on one that does, at the cost of
  // the download it was trying to avoid.
  return r.status === 206 ? bytes : bytes.subarray(from, from + length);
}

// The gaps a facet value holds, delta-coded, as positions in one sort's order.
function varints(bytes) {
  const out = [];
  let at = 0;
  for (let i = 0; i < bytes.length;) {
    let gap = 0, shift = 0, byte;
    do { byte = bytes[i++]; gap |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
    at += gap;
    out.push(at);
  }
  return out;
}

const intersect = (a, b) => {
  const out = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { out.push(a[i]); i += 1; j += 1; }
    else if (a[i] < b[j]) i += 1;
    else j += 1;
  }
  return out;
};

const union = (lists) => {
  if (lists.length === 1) return lists[0];
  const seen = new Set();
  for (const list of lists) for (const v of list) seen.add(v);
  return [...seen].sort((a, b) => a - b);
};

// The same cut the builder makes, and it has to stay the same cut: a word the
// index was written under is the only word that will find it.
export const words = (text) => [...new Set(String(text ?? "").toLowerCase()
  .split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && w.length <= 24))];
const bucketOf = (word) => word.slice(0, 2);

export async function openBrowse(base) {
  const url = (path) => new URL(path, base).href;
  const root = await fetch(url("root.json")).then((r) => (r.ok ? r.json() : null));
  if (!root || root.format !== "hologram.hub.browse/v1") return null;

  const field = Object.fromEntries(root.fields.map((f, i) => [f, i]));
  const headers = new Map();
  const orders = new Map();

  // A postings file opens with the value count, an offset per value and one
  // past the end, then a count per value. All of it is small, so the header is
  // fetched once and kept; the postings themselves are never fetched whole.
  async function header(sort, facet) {
    const key = `${sort}/${facet}`;
    if (!headers.has(key)) {
      headers.set(key, (async () => {
        const path = url(root.postings[sort][facet].path);
        const first = await range(path, 0, 4);
        const values = new DataView(first.buffer, first.byteOffset).getUint32(0, true);
        const rest = await range(path, 4, (values + 1) * 4 + values * 4);
        const view = new DataView(rest.buffer, rest.byteOffset, rest.byteLength);
        return { path, values, base: 4 + (values + 1) * 4 + values * 4, view };
      })());
    }
    return headers.get(key);
  }

  async function positions(sort, facet, value) {
    const h = await header(sort, facet);
    if (!(value >= 0) || value >= h.values) return [];
    const from = u32(h.view, value * 4);
    const to = u32(h.view, (value + 1) * 4);
    if (to <= from) return [];
    return varints(await range(h.path, h.base + from, to - from));
  }

  async function order(sort) {
    if (!orders.has(sort)) orders.set(sort, url(root.orders[sort].path));
    return orders.get(sort);
  }

  // What each facet value holds, for the number beside a chip. Straight out of
  // the header, so it costs nothing beyond the header itself.
  async function counts(sort, facet) {
    const h = await header(sort, facet);
    const out = new Map();
    for (let v = 0; v < h.values; v += 1) {
      const n = u32(h.view, (h.values + 1) * 4 + v * 4);
      if (n > 0) out.set(v, n);
    }
    return out;
  }

  // The rows live in the roll, not here. The locator says which shard a row is
  // in and which bytes, so a row is two ranged reads and the bytes stay in the
  // shards the roll's root names - the only copy a reader can check.
  const locUrl = url(root.rows.locator);
  const shardUrl = (i) => new URL(root.rows.shards[i], new URL(root.rows.from, base)).href;

  async function rowsAt(numbers) {
    if (!numbers.length) return [];
    // Forty-two small ranged reads to one origin is what HTTP/2 is for.
    const where = await Promise.all(numbers.map(async (n) => {
      const b = await range(locUrl, n * 12, 12);
      const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      return { shard: v.getUint32(0), at: v.getUint32(4), len: v.getUint32(8) };
    }));
    const bodies = await Promise.all(where.map((w) => range(shardUrl(w.shard), w.at, w.len)));
    const decoder = new TextDecoder();
    return bodies.map((b) => JSON.parse(decoder.decode(b)));
  }

  // Which words a bucket holds, in the order its postings are stored in. One
  // small file a bucket, fetched whole and kept, because every search term
  // beginning with those two characters needs the same list.
  const bucketWords = new Map();
  async function wordsIn(key) {
    if (!bucketWords.has(key)) {
      bucketWords.set(key, (async () => {
        const r = await fetch(url(`search/words/${key}.bin`));
        if (!r.ok) return [];
        const b = new Uint8Array(await r.arrayBuffer());
        const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        const count = v.getUint32(0, true), length = v.getUint32(4, true);
        if (!count) return [];
        return new TextDecoder().decode(b.subarray(8, 8 + length)).split("\n");
      })());
    }
    return bucketWords.get(key);
  }

  // Where one word's rows are, in one sort's order. The bucket's offsets come
  // first, so the word's block is one ranged read into the rest.
  async function wordPositions(sort, word) {
    const key = bucketOf(word);
    const names = await wordsIn(key);
    const i = names.indexOf(word);
    if (i < 0) return [];
    const path = url(`search/${sort}/${key}.bin`);
    const head = await range(path, i * 4, 8);
    const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const from = hv.getUint32(0, true), to = hv.getUint32(4, true);
    if (to <= from) return [];
    const base = (names.length + 1) * 4;
    return varints(await range(path, base + from, to - from));
  }

  return {
    checked: false,
    total: root.rows.count,
    pageSize: root.pageSize,
    dictionaries: root.dictionaries,
    buckets: root.buckets,
    field,
    roll: root.roll,
    counts,
    // `filters` is a map of facet to the values selected for it. Values within
    // one facet are a union - the interface treats chips in a group as "any of
    // these" - and the facets are intersected.
    words,
    async page({ sort, filters = {}, page = 1, q = "" }) {
      const use = root.orders[sort] ? sort : Object.keys(root.orders)[0];
      let hits = null;
      // Every word typed has to match, so the terms intersect. A word the
      // index has never seen matches nothing, which is the honest answer
      // rather than quietly dropping it and widening the search.
      for (const word of words(q)) {
        if (!root.search?.[use]) break;
        const found = await wordPositions(use, word);
        hits = hits === null ? found : intersect(hits, found);
        if (!hits.length) break;
      }
      for (const [facet, values] of Object.entries(filters)) {
        if (!values?.length || !root.postings[use]?.[facet]) continue;
        const lists = await Promise.all(values.map((v) => positions(use, facet, v)));
        const any = union(lists.filter((l) => l.length));
        hits = hits === null ? any : intersect(hits, any);
        if (!hits.length) break;
      }
      const total = hits === null ? root.rows.count : hits.length;
      const pages = Math.max(1, Math.ceil(total / root.pageSize));
      const at = Math.min(Math.max(1, page), pages) - 1;
      const from = at * root.pageSize;
      let numbers;
      if (hits === null) {
        const slice = await range(await order(use), from * 4, Math.min(root.pageSize, total - from) * 4);
        const v = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
        numbers = Array.from({ length: slice.byteLength / 4 }, (_, i) => v.getUint32(i * 4));
      } else {
        const wanted = hits.slice(from, from + root.pageSize);
        const path = await order(use);
        numbers = await Promise.all(wanted.map(async (pos) => {
          const b = await range(path, pos * 4, 4);
          return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0);
        }));
      }
      return { total, pages, page: at + 1, rows: await rowsAt(numbers) };
    },
  };
}
