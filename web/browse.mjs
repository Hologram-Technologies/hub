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

import { QUICK_ROWS, QUICK_SHOWN, bucketOf, suggests, words } from "./browsekey.mjs";

export { words };

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

// The cut the builder makes and the bucket it files under are
// `./browsekey.mjs`, imported above. There is one copy of that rule on
// purpose: a second spelling here would be a word the index was written
// under that this file never asks for.

// How many candidate rows `find` will read to settle a name exactly. It is
// both the point at which the word walk stops and the number of rows read
// after it, and those two have to be one number: stopping with more rows than
// are then read would drop the row that was being looked for.
export const EXACT = 64;

// Bytes an order entry takes: shard, first byte, length. The root states it
// too, and the root wins, so a reader built against one stride still reads an
// index written with another.
const STRIDE = 8;

// The shard a number names. The root gives either the labels, three
// characters each, or the full paths if the roll ever stops naming them that
// way.
const shardNameFrom = (spec) => (Array.isArray(spec)
  ? (i) => spec[i]
  : (i) => spec.name.replace("{label}", spec.labels.slice(i * spec.width, (i + 1) * spec.width)));
const shardCountOf = (spec) => (Array.isArray(spec) ? spec.length : spec.labels.length / spec.width);

export async function openBrowse(base) {
  const url = (path) => new URL(path, base).href;
  const root = await fetch(url("root.json")).then((r) => (r.ok ? r.json() : null));
  if (!root || root.format !== "hologram.hub.browse/v2") return null;

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

  // The rows live in the roll, not here, and an order entry says where: which
  // shard, which bytes. The bytes stay in the shards the roll's root names -
  // the only copy a reader can check.
  //
  // The root gives the shard labels, three characters each, or the full paths
  // if the roll ever stops naming them that way.
  const rollBase = new URL(root.rows.from, base);
  const nameOf = shardNameFrom(root.rows.shards);
  const shardUrl = (i) => new URL(nameOf(i), rollBase).href;

  const stride = (sort) => root.orders[sort].stride ?? STRIDE;
  const placeAt = (view, i, step) => ({
    shard: view.getUint16(i * step),
    at: view.getUint32(i * step + 2),
    len: view.getUint16(i * step + 6),
  });

  // One contiguous run of the order - a page, in other words - is one read.
  async function placesInRun(sort, from, count) {
    if (!count) return [];
    const step = stride(sort);
    const b = await range(await order(sort), from * step, count * step);
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return Array.from({ length: Math.floor(b.byteLength / step) }, (_, i) => placeAt(v, i, step));
  }

  // Scattered positions - what a filter or a search leaves - are one small
  // read each. Still one read a row rather than the two a separate locator
  // table cost.
  async function placesAt(sort, at) {
    const step = stride(sort);
    const path = await order(sort);
    return Promise.all(at.map(async (pos) => {
      const b = await range(path, pos * step, step);
      return placeAt(new DataView(b.buffer, b.byteOffset, b.byteLength), 0, step);
    }));
  }

  async function rowsFrom(places) {
    if (!places.length) return [];
    // Forty-two small ranged reads to one origin is what HTTP/2 is for.
    const bodies = await Promise.all(places.map((w) => range(shardUrl(w.shard), w.at, w.len)));
    const decoder = new TextDecoder();
    return bodies.map((b) => JSON.parse(decoder.decode(b)));
  }

  // Which words a bucket holds, in the order its postings are stored in. One
  // small file a bucket, fetched whole and kept, because every search term
  // beginning with those two characters needs the same list.
  // One file a bucket, fetched whole the first time its two characters are
  // typed and kept for the session; see `suggest` below.
  const quickNames = new Map();

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
    // One model by name. The word index already knows which rows hold every
    // word of its id, so one selective word is a short list to look through -
    // no separate index, and no walk over three million rows.
    //
    // Which word, though, decides what this costs. Looking every word up is
    // what the first version did, and an id like
    // `0xfaskety/Qwen-Qwen1.5-7B-1717558334` then paid for the `17` bucket,
    // 2.27 MB of unix timestamps, to learn nothing the 5 kB `0x` bucket had
    // not already settled. Measured 2026-11-14 against the live index from
    // Node, each request a real round trip: 15 requests, 2,644.5 kB, 8,114 ms
    // for every word, against 3 requests, 5.5 kB, 1,099 ms for the cheapest
    // word alone. The cost here is round trips, not bytes.
    //
    // So the words are tried cheapest bucket first and the walk stops as soon
    // as few enough rows are left to name exactly. Stopping early widens the
    // candidate list rather than narrowing it - every word still to come
    // could only remove rows - and the exact comparison below decides, so a
    // shorter walk cannot change the answer, only what it costs.
    async find(id) {
      const use = Object.keys(root.orders)[0];
      if (!root.search?.[use]) return undefined;
      const sizes = root.search.words?.sizes ?? {};
      const cost = (w) => sizes[bucketOf(w)] ?? Number.MAX_SAFE_INTEGER;
      const terms = words(id).sort((a, b) => cost(a) - cost(b));
      if (!terms.length) return undefined;
      let hits = null;
      for (const word of terms) {
        const found = await wordPositions(use, word);
        hits = hits === null ? found : intersect(hits, found);
        if (!hits.length) return undefined;
        // Few enough to name exactly; every further word costs a fetch and
        // can only remove rows this one already holds.
        if (hits.length <= EXACT) break;
      }
      const rows = await rowsFrom(await placesAt(use, hits.slice(0, EXACT)));
      const row = rows.find((r) => r[0].toLowerCase() === id.toLowerCase());
      return row && { id: row[0], revision: row[1], created: row[2], browse: row[6] ?? null };
    },
    // ------------------------------------------------------ quicksearch
    // What the header's box offers while somebody is typing. One fetch the
    // first time two characters name a bucket, then every keystroke after it
    // is answered from memory without a request.
    //
    // The file is the bucket's most trending names, one per line, and nothing
    // else: the words to match are read back out of each name by the same
    // rule that filed it (`./browsekey.mjs`), so there is no second table to
    // keep in step.
    //
    // `complete` is false when the head of the catalogue did not fill the
    // panel. The caller then runs the full search, which reads the whole
    // index - the suggestion list is the fast path, never the only one.
    async suggest(query, want = QUICK_SHOWN) {
      const terms = words(query);
      if (!terms.length || !root.search?.quick) return { rows: [], complete: true };
      const key = bucketOf(terms[0]);
      if (!root.search.quick.sizes?.[key]) return { rows: [], complete: false };
      if (!quickNames.has(key)) {
        quickNames.set(key, (async () => {
          const r = await fetch(url(`${root.search.quick.path}${key}.bin`));
          if (!r.ok) return [];
          return (await r.text()).split("\n").filter(Boolean);
        })());
      }
      const names = await quickNames.get(key);
      const rows = [];
      for (const id of names) {
        if (suggests(id, terms)) rows.push(id);
        if (rows.length >= want) break;
      }
      // The head held enough, or it held everything there was to hold. Either
      // way there is nothing the full search would add above these.
      return { rows, complete: rows.length >= want || names.length < QUICK_ROWS };
    },
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
      // Unfiltered, a page is a contiguous run of the order, so it is one
      // read. Filtered, the positions are scattered and it is one small read
      // each.
      const places = hits === null
        ? await placesInRun(use, from, Math.min(root.pageSize, total - from))
        : await placesAt(use, hits.slice(from, from + root.pageSize));
      return { total, pages, page: at + 1, rows: await rowsFrom(places) };
    },
  };
}
