"""The hub's site and Hugging Face dialect, as data the generator writes into
`app/src/Site.lex.tex`.

This file is authoring input, like `gen_kernel.py`: the generated LexLean
module is the model, the guest serves each screen from it, and the renderer in
`web/` draws only what the guest returns. Change the hub's words here, then
run `python app/tools/gen_kernel.py`.
"""

HOST = "gethologram.ai"
API = "https://gethologram.ai"

# Routes the guest renders, by number. Request `03 nn` asks for route nn.
ROUTES = ["chrome", "home", "models", "model", "docs"]
ROUTE = {name: i for i, name in enumerate(ROUTES)}

# The header. `route` is internal (the renderer asks the guest for that
# screen); `href` leaves the hub for a page milestone 1 does not rebuild.
NAV = [
    {"label": "Models", "icon": "grid", "route": "models"},
    {"label": "Registry", "icon": "box", "href": "https://gethologram.ai/registry/"},
    {"label": "Apps", "icon": "cpu", "href": "https://gethologram.ai/spaces/"},
    {"label": "Buckets", "icon": "bucket", "href": "https://gethologram.ai/buckets/"},
    {"label": "Docs", "icon": "file", "route": "docs"},
]

# Every link a screen can follow inside the hub, with the route it opens.
LINKS = [
    ("home", "cta", "models"),
    ("home", "family", "models"),
    ("models", "card", "model"),
    ("model", "back", "models"),
    ("docs", "models", "models"),
]

# Kernel answer code -> (HTTP status, X-Error-Code index, message). Index 0 is
# no X-Error-Code. The vocabulary is Hugging Face's where it has a name for the case
# (huggingface_hub `utils/_http.py`), and the hub's own otherwise.
ERROR_CODES = ["", "RepoNotFound", "RevisionNotFound", "EntryNotFound", "GatedRepo",
               "DisabledRepo", "UnknownSource", "SourceHasNotGotIt", "NoSource",
               "Quarantined", "BadRequest"]
DIALECT = {
    1: (302, 0, "Redirect to the chosen source"),
    2: (200, 0, "Serve the verified bytes"),
    20: (200, 0, "Deliver the received bytes"),
    10: (401, 1, "Repository not found"),
    11: (404, 2, "Revision not found"),
    12: (404, 3, "Entry not found"),
    13: (401, 4, "Access to this repository is gated"),
    14: (403, 5, "Access to this resource is disabled."),
    15: (404, 6, "No source of that name"),
    16: (404, 7, "That source does not hold this file"),
    17: (503, 8, "No source can serve this file now"),
    21: (502, 9, "The source sent bytes that do not match the address"),
}
BAD_REQUEST = (400, 10, "The request is not one the hub understands")

# The read surface of the Hugging Face Hub API a drop-in hub answers.
ENDPOINTS = [
    ("HEAD, GET", "/{repo}/resolve/{revision}/{path}", "Resolve one file: a redirect, or the bytes, with X-Repo-Commit, X-Linked-Etag and X-Linked-Size"),
    ("GET", "/api/models", "Search and list models; the next page is in the Link header"),
    ("GET", "/api/models/{repo}", "Model information: sha, siblings, tags, card data"),
    ("GET", "/api/models/{repo}/revision/{revision}", "Model information at a revision"),
    ("GET", "/api/models/{repo}/tree/{revision}/{path}", "Files and folders, with sizes and LFS addresses"),
    ("POST", "/api/models/{repo}/paths-info/{revision}", "Information for named paths"),
    ("GET", "/api/models/{repo}/refs", "Branches and tags"),
    ("GET", "/api/whoami-v2", "Who the token belongs to"),
]

SCREENS = {
    "chrome": {
        "brand": "HOLOGRAM",
        "host": HOST,
        "api": API,
        "nav": [dict(n, route=ROUTE[n["route"]]) if "route" in n else n for n in NAV],
        "themes": ["Immersive", "Dark", "Light"],
        "signIn": "Sign in",
        "signInHref": "https://gethologram.ai/",
        "proof": "Proved by Lean",
        "proofHref": "app/",
    },
    "home": {
        "badge": "Star on GitHub",
        "repo": "Hologram-Technologies/hub",
        "headline": ["The Open Platform", "for Sovereign AI"],
        "lead": "Discover, use and share",
        "accent": "self-verifying",
        "tail": "models, skills and artifacts.",
        "cta": "Browse {count} models",
        "ctaRoute": ROUTE["models"],
        "command": "curl gethologram.ai",
        "families": [
            ["Llama", "meta-llama"], ["Qwen", "Qwen"], ["DeepSeek", "deepseek-ai"],
            ["Mistral AI", "mistralai"], ["Gemma", "google"], ["Phi", "microsoft"],
            ["Whisper", "openai"], ["NVIDIA", "nvidia"], ["Stability AI", "stabilityai"],
            ["FLUX", "black-forest-labs"], ["BGE", "BAAI"], ["Cohere", "CohereLabs"],
            ["Sentence Transformers", "sentence-transformers"],
        ],
    },
    "models": {
        "title": "Models",
        "command": "curl gethologram.ai/models",
        "search": "Search models",
        "filters": "Filters",
        "sorts": [["trending", "Trending"], ["downloads", "Downloads"], ["likes", "Likes"],
                  ["created", "Newest"], ["params", "Parameters"]],
        "facets": [["modality", "Modality"], ["size", "Parameter count"], ["status", "Status"],
                   ["source", "Source"], ["library", "Library"], ["license", "License"]],
        "pageSize": 42,
        # Parameter-count buckets: label, then the bounds in billions, lower
        # inclusive, upper exclusive.
        "sizes": [["Under 1B", 0, 1], ["1 to 3B", 1, 4], ["4 to 9B", 4, 10], ["10 to 20B", 10, 21],
                  ["21 to 40B", 21, 41], ["41 to 100B", 41, 101], ["Over 100B", 101, 1000000]],
        "unknownSize": "Unknown",
        "sourceHub": "Hologram",
        "empty": "No models match these filters.",
        "clear": "Clear filters",
        "reset": "Reset",
        "more": "+{n} more",
        "less": "Show less",
        "verified": "Verified",
        "unverified": "Unverified",
        "show": "Show {n} models",
        "previous": "Previous",
        "next": "Next",
    },
    "model": {
        "back": "Models",
        "address": "Address",
        "held": "Held on",
        "get": "Get it",
        "copy": "Copy",
        "copied": "Copied",
        "tools": [
            ["Hugging Face", "HF_ENDPOINT=https://{host} hf download {repo}"],
            ["OCI", "oras pull {host}/{repo}"],
            ["Ollama", "ollama run {host}/{repo}"],
        ],
        "facts": [["status", "Status"], ["revision", "Revision"], ["files", "Files"],
                  ["weights", "Weights"], ["params", "Parameters"], ["task", "Task"],
                  ["library", "Library"], ["license", "License"]],
        "tabs": ["Overview", "Files"],
        "glance": "At a glance",
        "filesNote": "{n} files, {size}. Every download is checked against its address.",
        "columns": ["Path", "Size", "Address"],
        "gated": "This model is gated on Hugging Face, so the hub does not index its files.",
        "queued": "This model is queued. Its files are not addressed yet.",
        "missing": "No model of that name is indexed.",
        "verified": "Verified",
        "unverified": "Unverified",
        # Verify: the page fetches one addressed file from each source through
        # the hub's /via/<source> route, hashes it, asks the kernel's accept
        # rule about each copy and its verdict rule about all of them.
        "verify": {
            "label": "Verify",
            "checking": "Checking {file} from {n} sources",
            "sources": [["Hugging Face", "huggingface.co"], ["ModelScope", "modelscope.cn"], ["IPFS", "ipfs"]],
            "timeoutMs": 8000,
            "verdicts": {
                "1": "Verified in {ms} ms. Identical bytes from {sources}.",
                "2": "{sources} served different bytes. Do not use that copy.",
                "3": "No source could be reached.",
                "0": "The kernel refused the check.",
            },
            "rows": {"20": "matches its address", "21": "different bytes", "0": "unreachable"},
            "note": "Each copy is hashed in your browser and judged by the proved kernel.",
        },
    },
    "docs": {
        "title": "The Hugging Face dialect",
        "lead": "Set HF_ENDPOINT to a hub and every Hugging Face tool talks to it unchanged. These are the routes it answers, and every answer the hub's kernel can give, with the status and error code a tool receives. Both tables are served by the proved kernel itself.",
        "command": "export HF_ENDPOINT=https://gethologram.ai",
        "endpointsTitle": "Routes",
        "endpoints": [list(e) for e in ENDPOINTS],
        "answersTitle": "Answers",
        "answers": [[code, status, ERROR_CODES[err] or "none", msg] for code, (status, err, msg) in sorted(DIALECT.items())]
                   + [["any other", BAD_REQUEST[0], ERROR_CODES[BAD_REQUEST[1]], BAD_REQUEST[2]]],
        "columnsRoutes": ["Method", "Path", "What it returns"],
        "columnsAnswers": ["Kernel answer", "HTTP status", "X-Error-Code", "Meaning"],
        "sections": [
            {"id": "quickstart", "title": "Quickstart",
             "body": ["Point the tools you already use at the hub. Nothing else changes: the cache layout, revisions and errors are the ones Hugging Face tools expect."],
             "commands": ["export HF_ENDPOINT=https://gethologram.ai",
                          "hf download openai-community/gpt2",
                          "vllm serve openai-community/gpt2",
                          "MODEL_ENDPOINT=https://gethologram.ai/ llama-cli -hf bartowski/MiniCPM5-2B-GGUF:IQ2_M"]},
            {"id": "verification", "title": "Verification",
             "body": ["Every file has an address: the SHA-256 of its bytes. Verify on a model page fetches one file from each source that holds it, hashes each copy in your browser and asks the hub's kernel two questions: does this copy match its address, and what is the verdict across all copies.",
                      "Both answers are proved in Lean for every possible input: a copy is accepted exactly when its digest and size are the expected ones, and the page says Verified only when at least one source delivered and none sent other bytes.",
                      "Hugging Face clients check a download's length, not its content. A runner that carries the bytes can check every byte before a tool reads it; that is the hub's local runner, the next milestone that serves files."]},
            {"id": "sources", "title": "Sources and failover",
             "body": ["A file can come from Hugging Face, ModelScope or IPFS. The kernel chooses: never a source that does not hold the file or failed verification for it, a healthy one whenever a usable one exists, and only the source you pin when you pin one with /via/<source>.",
                      "On the edge the hub only redirects, and only to vetted sources. A local runner serves the bytes itself, after checking them."],
             "commands": ["curl -I https://gethologram.ai/via/ipfs/openai-community/gpt2/resolve/main/config.json"]},
            {"id": "limits", "title": "Limits and scope",
             "body": ["Open-weight models only: gated and private repositories are refused, and a missing repository and a private one get the same answer, so the hub never tells them apart.",
                      "Reads only for now. Uploads, discussions, Spaces and inference are not part of the hub."]},
        ],
        "back": "Browse models",
        "backRoute": ROUTE["models"],
    },
}
