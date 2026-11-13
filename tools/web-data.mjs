// Copies the catalog, the registry and the apps list from the live hub into
// the site, because the live hub does not let another origin read them (no
// CORS on these files). Each copy records its source, the time it was taken
// and the SHA-256 of the bytes it was made from, and the pages show all three.
//
// The catalog's rows carry the facets the browse page filters by, and every
// owner's avatar is fetched once at its original size from Hugging Face's
// avatar CDN, so the marks on the cards and the landing strip are the orgs'
// own artwork rather than letters.
//
//   node tools/web-data.mjs <site dir> <hub origin>
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [site, origin] = process.argv.slice(2);
if (!site || !origin) {
  console.error("usage: node tools/web-data.mjs <site dir> <hub origin>");
  process.exit(64);
}
await mkdir(join(site, "data"), { recursive: true });

async function take(path) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${path}: the hub answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    data: JSON.parse(bytes.toString("utf8")),
    from: { source: new URL(path, origin).href, date: new Date().toISOString().slice(0, 10), hash: createHash("sha256").update(bytes).digest("hex") },
  };
}

// ---- the catalog
// The rows the browse page draws, in the shape it filters on. The facets a
// Hugging Face row does not carry (modality, bucket, family, format) are read
// off the row's own fields and tags, so one row describes itself completely.
const MODALITY = Object.fromEntries(Object.entries({
  Text: ["text-generation", "text2text-generation", "text-classification", "token-classification", "translation", "summarization", "question-answering", "table-question-answering", "fill-mask"],
  Vision: ["image-text-to-text", "any-to-any", "image-to-text", "video-text-to-text", "image-classification", "object-detection", "image-segmentation", "depth-estimation", "zero-shot-image-classification", "zero-shot-object-detection", "mask-generation", "visual-question-answering", "keypoint-detection"],
  Image: ["text-to-image", "image-to-image", "unconditional-image-generation"],
  Audio: ["text-to-speech", "text-to-audio", "automatic-speech-recognition", "audio-to-audio", "audio-classification", "voice-activity-detection"],
  Video: ["image-to-video", "text-to-video"],
  Embedding: ["feature-extraction", "sentence-similarity"],
}).flatMap(([label, tasks]) => tasks.map((t) => [t, label])));
const FORMAT = [["gguf", "GGUF"], ["safetensors", "Safetensors"], ["onnx", "ONNX"], ["mlx", "MLX"]];
const BUCKETS = [[1, "Under 1B"], [4, "1 to 3B"], [10, "4 to 9B"], [21, "10 to 20B"], [41, "21 to 40B"], [101, "41 to 100B"], [301, "101 to 300B"], [Infinity, "Over 300B"]];
// Languages arrive as tags; the hub writes them capitalised and a bare two
// letter code is a language tag too.
const LANGUAGE = new Intl.DisplayNames(["en"], { type: "language" });

const modality = (task) => MODALITY[task] ?? "Other";
const bucket = (n) => (n ? BUCKETS.find(([hi]) => n / 1e9 < hi)[1] : null);
const words = (s) => String(s).replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// What a reader calls the model: its name, and its version when the name
// carries one. "Qwen3.8-27B-Instruct" is Qwen 3.8, "DeepSeek-V4-Pro" is
// DeepSeek V4, "MiniMax-H3-Image" is MiniMax.
const VERSION = /^v?\d+(\.\d+)*$/i;
function family(id) {
  const parts = (id.split("/")[1] ?? id).split(/[-_]/).filter(Boolean);
  const head = parts[0] ?? id;
  // A version glued to the name ("Qwen3.8") is split off and kept.
  const glued = head.match(/^(.*?[A-Za-z])(\d+(?:\.\d+)*)$/);
  const stem = glued ? [glued[1], glued[2]] : [head, ...(VERSION.test(parts[1] ?? "") ? [parts[1].toUpperCase()] : [])];
  return stem.join(" ").replace(/\b[a-z]/, (c) => c.toUpperCase());
}
// The model's architecture is a bare lowercase tag beside the library and
// format tags; these are the ones that are not one ("other" names nothing).
const NOT_ARCH = new Set(["safetensors", "gguf", "onnx", "mlx", "pytorch", "tensorboard", "transformers", "diffusers", "sentence-transformers",
  "peft", "timm", "other", "conversational", "endpoints_compatible", "autotrain_compatible", "text-generation-inference", "custom_code", "code"]);
const architecture = (tags, task) => tags.find((t) => /^[a-z][a-z0-9_]*$/.test(t) && !NOT_ARCH.has(t) && t !== task && !t.startsWith("region")) ?? null;

// A language is kept as its code, because that is what a link carries
// (`language=en`); the page turns it into a name when it draws the chip.
const CODE = new Map();
function language(tag) {
  if (/^[a-z]{2,3}$/.test(tag)) {
    try { return LANGUAGE.of(tag) === tag ? null : tag; } catch { return null; }
  }
  if (!CODE.size) {
    for (const code of ["en", "zh", "es", "fr", "de", "ja", "ko", "ru", "pt", "it", "ar", "hi", "nl", "pl", "tr", "vi", "th", "id", "sv", "cs", "uk", "fa", "he", "el", "da", "fi", "no", "hu", "ro", "bg"]) {
      try { CODE.set(LANGUAGE.of(code), code); } catch {}
    }
  }
  return CODE.get(tag) ?? null;
}

const catalog = await take("/api/models?limit=500");
const models = catalog.data.map((row, i) => {
  const [org, name] = row.id.split("/");
  const tags = row.tags ?? [];
  const h = row.hologram ?? {};
  return {
    // `author` is the owner under Hugging Face's own name for it, so the
    // browse page's `author=` filter means what a copied link means.
    id: row.id, org, author: org, name, rank: i + 1,
    likes: row.likes ?? 0, downloads: row.downloads ?? 0, created: (row.createdAt ?? "").slice(0, 10) || null,
    modality: modality(row.pipeline_tag), task: row.pipeline_tag ?? null,
    params: h.parameters ?? null, bucket: bucket(h.parameters), context: h.context ?? null,
    arch: architecture(tags, row.pipeline_tag),
    family: family(row.id),
    languages: [...new Set(tags.map(language).filter(Boolean))],
    library: row.library_name ?? null,
    format: FORMAT.find(([t]) => tags.includes(t))?.[1] ?? "Other",
    license: tags.find((t) => t.startsWith("license:"))?.slice(8) ?? null,
    state: (h.files ?? 0) > 0 ? "addressed" : "pending",
    sources: h.sources ?? [], revision: row.sha ?? null, manifest: h.manifest ?? null,
    files: h.files ?? null, weightBytes: h.weight_bytes ?? null,
    gated: Boolean(row.gated), avatar: null,
  };
});

// ---- the owners' own marks
// Hugging Face names each organization's avatar; the CDN serves one original
// per owner (200px, the size it stores) and that file is copied whole, so the
// mark is never a re-encoded or scaled copy.
// One spelling per family: owners capitalise the same name differently
// ("MiniMax", "Minimax"), and two spellings would be two facets.
const spellings = new Map();
for (const m of models) {
  const key = m.family.toLowerCase();
  const seen = spellings.get(key) ?? new Map();
  seen.set(m.family, (seen.get(m.family) ?? 0) + 1);
  spellings.set(key, seen);
}
for (const m of models) m.family = [...spellings.get(m.family.toLowerCase())].sort((a, b) => b[1] - a[1])[0][0];

await mkdir(join(site, "data", "avatars"), { recursive: true });
const EXT = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg" };
const owners = [...new Set(models.map((m) => m.org))];
const faces = new Map();
let bytesWritten = 0;
await Promise.all(owners.map(async (owner) => {
  for (const kind of ["organizations", "users"]) {
    try {
      const named = await fetch(`https://huggingface.co/api/${kind}/${encodeURIComponent(owner)}/avatar`, { signal: AbortSignal.timeout(20000) });
      if (!named.ok) continue;
      const { avatarUrl } = await named.json();
      if (!avatarUrl) continue;
      const image = await fetch(avatarUrl, { signal: AbortSignal.timeout(30000) });
      if (!image.ok) continue;
      const type = image.headers.get("content-type")?.split(";")[0] ?? "";
      const ext = EXT[type];
      if (!ext) continue;
      const body = Buffer.from(await image.arrayBuffer());
      const file = `${owner.replace(/[^\w.-]/g, "_")}.${ext}`;
      await writeFile(join(site, "data", "avatars", file), body);
      faces.set(owner, file);
      bytesWritten += body.length;
      return;
    } catch {
      // An owner without a mark keeps its initials; nothing else depends on it.
    }
  }
}));
for (const m of models) m.avatar = faces.get(m.org) ?? null;
await writeFile(join(site, "data", "models.json"), JSON.stringify({ snapshot: new Date().toISOString(), from: catalog.from, models }));

// ---- the registry
// Only the fields the screen reads. Logos and covers are dropped; they are
// most of the 3 MB and the screen draws its own marks.
const KEEP = ["id", "registry", "org", "name", "tag", "kind", "description", "pulls", "stars", "updated", "size", "sizeBucket",
  "updatedBucket", "license", "digest", "home", "trust", "held", "verified", "official"];
const registry = await take("/registry/data/images.json");
const images = registry.data.images.map((row) => Object.fromEntries(KEEP.map((k) => [k, row[k] ?? null])));
for (const row of images) {
  if (typeof row.description === "string") row.description = row.description.replace(/<[^>]*>/g, "").trim().slice(0, 160);
}
await writeFile(join(site, "data", "registry.json"), JSON.stringify({ from: registry.from, images }));

const apps = await take("/spaces/spaces.json");
await writeFile(join(site, "data", "apps.json"), JSON.stringify({ from: apps.from, apps: apps.data.spaces }));

console.log(`web-data: ${models.length} models, ${faces.size} avatars (${Math.round(bytesWritten / 1024)} kB), ${images.length} registry entries, ${apps.data.spaces.length} apps`);
