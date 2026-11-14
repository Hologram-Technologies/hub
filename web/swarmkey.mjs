// Which shard of the swarm catalog a model's name belongs to.
//
// The catalog is about 300 MB of rows, so the page reads one shard and never
// the set. That only finds a model if the shard the builder wrote it to is
// the shard the page looks in, which makes this rule the whole of the
// agreement between them. It lives here, imported by both, so the agreement
// cannot drift: `tools/swarm-catalog.mjs` files a row by it and the page
// resolves a query by it.
//
// Two lowercased characters of the model's name, with anything outside
// `a-z0-9` folded to `_` so a shard is always a legal file name. A name of
// one character pads with `_`; a name starting outside printable ASCII lands
// in `__` with the other unusual ones.
export const swarmKey = (name) => {
  const two = `${name[0] ?? "_"}${name[1] ?? "_"}`.toLowerCase();
  return /^[\x20-\x7e]{2}$/.test(two) ? two.replace(/[^a-z0-9]/g, "_") : "__";
};

// The same rule applied to a model id, which is a name with its organisation
// sometimes in front. A reader searching for `llama` means the name.
export const swarmKeyOf = (id) => swarmKey(id.slice(id.indexOf("/") + 1) || id);
