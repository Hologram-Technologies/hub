// The words a model can be found by, and which bucket a word falls in.
//
// This is the whole of the agreement between the index builder and the page.
// `tools/browse-index.mjs` files a model under every word this returns, and
// the page resolves a query by the same call; a second spelling of either rule
// means a word the index was written under is a word the page never asks for,
// and the model silently stops being findable. It lives here, imported by
// both, so the agreement cannot drift - the same reason `web/swarmkey.mjs`
// exists for the swarm catalog's shards.
//
// `Qwen/Qwen3.8-27B` is found by qwen, 27b and 8: owner and name together, cut
// at anything that is not a letter or a digit, lowercased. Measured
// 2026-11-14 over 103,000 models: 5.5 words each, 79,561 distinct, and 60 per
// cent of those held by a single model.
//
// Two characters is the shortest worth keeping - one letter matches too much
// to narrow anything - and twenty-four the longest, past which a token is a
// hash somebody pasted into a name.
export const words = (text) => [...new Set(String(text ?? "").toLowerCase()
  .split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && w.length <= 24))];

// Which file a word's postings live in. Two characters gives about 1,300
// buckets, so a bucket holds a couple of thousand words at three million
// models and a search term is one fetch of some tens of kilobytes.
export const bucketOf = (word) => word.slice(0, 2);

// How many names the header's suggestion list holds for one bucket. The file
// is fetched whole on the first keystroke that names the bucket and then
// answers every keystroke after it without another request, so this number is
// the trade twice over: the names a visitor can be offered instantly, against
// the bytes they wait for once, and against what the published site weighs.
//
// 512 because the site has to fit. Measured from the deploy of 2026-11-16:
// 863 MB of the 1024 MB GitHub publishes, and this build refuses its own
// output over 950 MB, so there is about 87 MB of room and the roll takes more
// of it every day. At 1,296 buckets and about 40 bytes a name, 2,048 rows a
// bucket came to roughly 106 MB and would have broken the deploy; 512 comes
// to about 26 MB. Everything past it is still found by the full search, which
// reads the complete index - the number costs suggestions, never answers.
export const QUICK_ROWS = 512;

// How many of them the panel shows at once. Hugging Face's own quicksearch
// answers with six models, read 2026-11-16.
export const QUICK_SHOWN = 6;

// The words the suggestion index files a model under. Its own words, less the
// long runs of digits that generated names carry: ids like
// `0xfaskety/Qwen-Qwen1.5-7B-1717558334` put a unix timestamp in the `17`
// bucket, which is 2.27 MB of the full index and the largest bucket on the
// site by a wide margin. Nobody types a timestamp into a search box.
//
// The full search index keeps them, so nothing becomes unfindable; it stops
// being suggested. `27b` and `3b` are not digits alone and are untouched.
export const quickWords = (id) => words(id).filter((w) => !/^[0-9]{4,}$/.test(w));

// Does this model answer what has been typed? Every word of the query must be
// the start of some word of the id, so `qwen 27b` finds `Qwen/Qwen3.8-27B`
// and `wen` finds nothing - a search box completes words, it does not match
// the middles of them.
export const suggests = (id, terms) => {
  const held = quickWords(id);
  return terms.every((t) => held.some((w) => w.startsWith(t)));
};
