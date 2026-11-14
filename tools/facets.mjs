// How a browse row is read off a release: the one place the hub decides what
// a model's task, size, family, architecture, languages, format and licence
// are. The index builder writes these into the signed browse shards and the
// page filters on them, so both readers of the index agree by construction.
//
// Every facet value is Hugging Face's own where Hugging Face has one
// (`text-generation`, `en`, `mit`); the page says them a reader's way when it
// draws a chip. The derivation is an opinion about published bytes, so
// `rulesVersion` is published beside the values: a reader can tell which rule
// produced the row it is looking at.
export const rulesVersion = "hologram.hub.facets/1";

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
const LANGUAGE = new Intl.DisplayNames(["en"], { type: "language" });

export const modality = (task) => MODALITY[task] ?? "Other";
export const bucket = (n) => (n ? BUCKETS.find(([hi]) => n / 1e9 < hi)[1] : null);

// What a reader calls the model: its name, and its version when the name
// carries one. "Qwen3.8-27B-Instruct" is Qwen 3.8, "DeepSeek-V4-Pro" is
// DeepSeek V4, "MiniMax-H3-Image" is MiniMax.
const VERSION = /^v?\d+(\.\d+)*$/i;
export function family(id) {
  const parts = (id.split("/")[1] ?? id).split(/[-_]/).filter(Boolean);
  const head = parts[0] ?? id;
  // A version glued to the name ("Qwen3.8") is split off and kept.
  const glued = head.match(/^(.*?[A-Za-z])(\d+(?:\.\d+)*)$/);
  const stem = glued ? [glued[1], glued[2]] : [head, ...(VERSION.test(parts[1] ?? "") ? [parts[1].toUpperCase()] : [])];
  return stem.join(" ").replace(/\b[a-z]/, (c) => c.toUpperCase());
}

// The architecture is a bare lowercase tag beside the library and format
// tags; these are the ones that are not one ("other" names nothing).
const NOT_ARCH = new Set(["safetensors", "gguf", "onnx", "mlx", "pytorch", "tensorboard", "transformers", "diffusers", "sentence-transformers",
  "peft", "timm", "other", "conversational", "endpoints_compatible", "autotrain_compatible", "text-generation-inference", "custom_code", "code"]);
export const architecture = (tags, task) => tags.find((t) => /^[a-z][a-z0-9_]*$/.test(t) && !NOT_ARCH.has(t) && t !== task && !t.startsWith("region")) ?? null;

// A language is kept as its code, because that is what a link carries
// (`language=en`); the page turns it into a name when it draws the chip.
const CODE = new Map();
export function language(tag) {
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
export const format = (tags) => FORMAT.find(([t]) => tags.includes(t))?.[1] ?? "Other";
export const licence = (tags) => tags.find((t) => t.startsWith("license:"))?.slice(8) ?? null;

// One browse row, from a release record (`hologram.hub.release/v2`) and the
// rank the catalog gave it. Everything here is either a fact about the bytes
// or a derivation of one; the counts another host measured stay under
// `observed`, named as such.
export function browseRow(record, rank) {
  const [org, name] = record.repo.split("/");
  const tags = record.info?.tags ?? [];
  const params = record.safetensors?.total ?? null;
  return {
    id: record.repo, org, author: org, name, rank,
    created: (record.info?.createdAt ?? "").slice(0, 10) || null,
    modified: (record.info?.lastModified ?? "").slice(0, 10) || null,
    task: record.info?.pipeline_tag ?? null,
    modality: modality(record.info?.pipeline_tag),
    params, bucket: bucket(params),
    arch: architecture(tags, record.info?.pipeline_tag),
    family: family(record.repo),
    languages: [...new Set(tags.map(language).filter(Boolean))],
    library: record.info?.library_name ?? null,
    format: format(tags),
    license: licence(tags),
    state: (record.files?.length ?? 0) > 0 ? "addressed" : "pending",
    // The origin counts: a release is held wherever its bytes can be got,
    // and the host the record was built from is one of those. Leaving it
    // out made the one source every model has the only one not shown.
    sources: [...new Set([
      ...(record.origin?.kind ? [record.origin.kind] : []),
      ...(record.sources ?? []).map((s) => s.kind),
    ])],
    revision: record.revision ?? null,
    files: record.files?.length ?? null,
    weightBytes: record.files?.reduce((a, f) => a + (f.size ?? 0), 0) ?? null,
    gated: Boolean(record.info?.gated),
    observed: record.observed ?? null,
    avatar: null,
  };
}
