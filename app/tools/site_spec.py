"""The hub's site and Hugging Face dialect, as data the generator writes into
`app/src/Site.lex.tex`.

This file is authoring input, like `gen_kernel.py`: the generated LexLean
module is the model, the guest serves each screen from it, and the renderer in
`web/` draws only what the guest returns. Change the hub's words here, then
run `python app/tools/gen_kernel.py`.
"""

# Two hosts, because they are two things. HOST is where this site is served
# from: the static interface, published from this repository. API_HOST is the
# hub that answers a tool - the Hugging Face dialect, the OCI registry, MCP,
# accounts and buckets - which a static host cannot do, since it has to set
# `X-Repo-Commit` on a HEAD and redirect with headers. They were one name until
# 2026-11-14, when the apex became this repository's Pages site and the hub
# moved to a name of its own on the same machine. Every command, link and
# endpoint a tool is given below names API_HOST; only the brand in the header
# names HOST. `docs/cutover.md` has the records and the order.
HOST = "gethologram.ai"
API_HOST = "api.gethologram.ai"
API = f"https://{API_HOST}"

# Routes the guest renders, by number. Request `03 nn` asks for route nn.
ROUTES = ["chrome", "home", "models", "model", "docs", "registry", "apps", "buckets"]
ROUTE = {name: i for i, name in enumerate(ROUTES)}

# The header. `route` is internal (the renderer asks the guest for that
# screen); `href` leaves the hub for a page milestone 1 does not rebuild.
NAV = [
    {"label": "Models", "icon": "grid", "route": "models"},
    {"label": "Registry", "icon": "box", "route": "registry"},
    {"label": "Apps", "icon": "cpu", "route": "apps"},
    {"label": "Buckets", "icon": "bucket", "route": "buckets"},
    {"label": "Docs", "icon": "file", "route": "docs"},
]

# Every link a screen can follow inside the hub, with the route it opens.
LINKS = [
    ("home", "cta", "models"),
    ("home", "family", "models"),
    ("models", "card", "model"),
    ("model", "back", "models"),
    ("docs", "models", "models"),
    ("buckets", "docs", "docs"),
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
    ("GET", "/api/models/{repo}/commits/{revision}", "The commits the index knows; partial, because it holds the release"),
    ("GET", "/api/models-tags-by-type", "Every tag the listed models carry, by kind"),
    ("GET", "/api/quicksearch", "Models whose name matches, for a search box"),
    ("GET", "/api/whoami-v2", "Who the token belongs to"),
]

# The query a client may put to /api/models, and what the hub does with it.
# The names and the accepted values are Hugging Face's; anything else is a
# request the hub does not understand, and the kernel's answer for that is a
# 400 with BadRequest, the same as any other malformed request.
LIST_QUERY = [
    ("search", "Match the repository name"),
    ("author", "One owner"),
    ("filter", "Every tag that must be present, comma separated"),
    ("sort", "One of downloads, likes, createdAt, lastModified, trendingScore"),
    ("direction", "-1, the only direction Hugging Face accepts"),
    ("limit", "How many rows, at most 1000"),
    ("cursor", "The next page, from the Link header"),
    ("full", "true adds every field a record holds"),
    ("config", "true adds the model configuration"),
    ("expand[]", "Name a field to add it; naming any field drops the rest"),
]
LIST_SORTS = ["downloads", "likes", "createdAt", "lastModified", "trendingScore"]

SCREENS = {
    "registry": {
        "title": "Registry",
        "lead": "Every image and artifact the hub can name: models, runtimes and indexes from Docker Hub, GitHub, Quay and the hub itself, each pinned by its digest.",
        "search": "Search the registry",
        "facets": [["registry", "Registry"], ["kind", "Kind"], ["sizeBucket", "Size"], ["updatedBucket", "Updated"], ["license", "License"]],
        "sorts": [["pulls", "Most pulled"], ["stars", "Most starred"], ["name", "Name"]],
        "pageSize": 42,
        "empty": "Nothing matches those filters.",
        "clear": "Clear filters",
        "reset": "Reset",
        "more": "+{n} more",
        "less": "Show less",
        "previous": "Previous",
        "next": "Next",
        "pulls": "pulls",
        "stars": "stars",
        "digest": "Digest",
        "open": "Open on source",
        # Each command names the registry it applies to; "*" is any entry with a digest.
        "commands": [["Docker Hub", "docker pull {ref}:{tag}"], ["*", "crane manifest {ref}@{digest}"]],
        "snapshot": "Copied from {source} on {date}. sha256 {hash}",
    },
    "apps": {
        "title": "Apps",
        "lead": "Apps that run entirely in your browser, every file and every model weight named by its hash.",
        "sorts": [["featured", "Featured"], ["name", "Name"], ["smallest", "Smallest model"], ["largest", "Largest model"]],
        "open": "Open",
        "source": "View the source",
        "copy": "Copy its address",
        "requires": "Needs",
        "files": "{n} files",
        "model": "Model",
        "openBase": f"{API}/spaces/",
        "snapshot": "Copied from {source} on {date}. sha256 {hash}",
    },
    "buckets": {
        "title": "Buckets",
        "lead": f"A bucket is a named place for your own objects, each stored and fetched by its address. Writing to a bucket needs an account on {API_HOST}; reading and checking any object needs nothing.",
        "manage": "Open buckets on the hub",
        "manageHref": f"{API}/buckets/",
        "command": "buckets create <owner>/<name>",
        "checkTitle": "Check an object",
        "checkLead": "Paste an address. The page fetches the object, hashes it here with the address's own hash, and asks the kernel whether these are the addressed bytes.",
        "placeholder": "blake3:... or sha256:...",
        "example": "blake3:5d168520ffb44368dc65fd00adc4543e57e7aebfa2d048192d152f46f86e18fc",
        "exampleLabel": "Try the hub's catalog",
        "check": "Check",
        "verdicts": {
            "20": "These {size} are exactly the addressed object.",
            "21": "The bytes received do not match the address. Do not use them.",
            "0": "The object could not be fetched.",
            "invalid": "An address is blake3: or sha256: followed by 64 hexadecimal digits.",
        },
        "docs": "How addresses work",
        "docsRoute": ROUTE["docs"],
    },
    "chrome": {
        "brand": "Hologram",
        "host": HOST,
        "api": API,
        "nav": [dict(n, route=ROUTE[n["route"]]) if "route" in n else n for n in NAV],
        "theme": "Theme",
        "themes": [["immersive", "Immersive", "image"], ["dark", "Dark", "moon"], ["light", "Light", "sun"]],
        # The wallpapers this site ships, shown first in the panel. Everything
        # else comes from Unsplash through the Prism frame's worker, which
        # holds the one key every Prism app shares, so no page carries a key.
        "wallpapers": [["alps", "Alpine Dawn"], ["galaxy", "Galaxy"], ["aurora", "Aurora"]],
        "photos": {
            "proxy": "https://prism-unsplash.trinity-03d.workers.dev/",
            "utm": "utm_source=prism&utm_medium=referral",
            "site": "https://unsplash.com/",
            "search": "Search Unsplash",
            "query": "landscape",
            "by": "Photo by {name} on",
            "source": "Unsplash",
            "unavailable": "Search is unavailable right now.",
            "label": "Photos",
        },
        "menu": "Menu",
        "signIn": "Sign in",
        "signInHref": f"{API}/",
        "proof": "Proved by Lean",
        "proofDetail": "{passed} of {total} examples hold",
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
        "command": f"curl {API_HOST}",
        "families": [
            ["Llama", "meta-llama"], ["Qwen", "Qwen"], ["DeepSeek", "deepseek-ai"],
            ["Mistral AI", "mistralai"], ["Gemma", "google"], ["Phi", "microsoft"],
            ["Whisper", "openai"], ["NVIDIA", "nvidia"], ["Stability AI", "stabilityai"],
            ["FLUX", "black-forest-labs"], ["BGE", "BAAI"],
            ["Sentence Transformers", "sentence-transformers"],
        ],
        "familyTitle": "{label}: {n} models on Hologram",
        "stars": "{n} stars",
    },
    "models": {
        "title": "Models",
        "command": f"curl {API_HOST}/models",
        "search": "Search models",
        "filters": "Filters",
        "close": "Close filters",
        # The sort names are Hugging Face's own, so a link carries across.
        "sorts": [["trending", "Trending"], ["downloads", "Most downloads"], ["likes", "Most likes"],
                  ["created", "Recently created"], ["modified", "Recently updated"]],
        # What the page says about the list it is showing: where the rows came
        # from, how many shards they were read from, and the rule that derived
        # them. A reader can tell a signed listing from one that is not.
        "listing": {
            "signed": "Signed listing",
            "unsigned": "Unsigned listing",
            "detail": "{n} models, {shards} shards, {rules}",
        },
        "searchParam": "search",
        "pageParam": "p",
        "tabs": [["main", "Main", "sliders"], ["libraries", "Libraries", "box"], ["languages", "Languages", "globe"],
                 ["licenses", "Licenses", "scale"], ["other", "Other", "cpu"]],
        # key (the catalog field), URL name, label, the tabs it appears on,
        # icon, kind: "fixed" keeps the order given below, "search" adds a
        # filter box, "plain" drops the counts, "range" is the slider.
        # key (the catalog field), the query parameter, label, the tabs it
        # appears on, icon, kind. The first eight parameters are Hugging
        # Face's; the four after them name facets Hugging Face does not have,
        # so they cannot collide with a link copied from it.
        "facets": [["task", "pipeline_tag", "Tasks", ["main"], "grid", ""],
                   ["params", "num_parameters", "Parameters", ["main"], "tag", "range"],
                   ["library", "library", "Libraries", ["main", "libraries"], "box", "search"],
                   ["languages", "language", "Languages", ["languages"], "globe", "search"],
                   ["license", "license", "Licenses", ["licenses"], "scale", "search"],
                   ["author", "author", "Owner", ["other"], "user", "search"],
                   ["status", "hub_status", "Status", ["main"], "seal", "fixed"],
                   ["sources", "hub_source", "Source", ["main"], "nodes", ""],
                   ["format", "hub_format", "Formats", ["libraries"], "file", ""],
                   ["family", "hub_family", "Model family", ["other"], "layers", "search"],
                   ["arch", "hub_arch", "Architecture", ["other"], "cpu", "search"],
                   ["modality", "hub_modality", "Modality", ["other"], "image", ""],
                   ["recency", "hub_released", "Release recency", ["other"], "calendar", "plain"]],
        # The parameter slider's stops, in billions: a model is kept when its
        # count falls between the chosen stops, and the last stop means no
        # upper limit. Models whose count is unknown are kept until the slider
        # is moved.
        # Hugging Face's own stops and labels: the slider writes a pair of
        # labels, `num_parameters=6B,32B`, and reads the same.
        "stops": [[0, "< 1B"], [6, "6B"], [12, "12B"], [32, "32B"], [128, "128B"], [500, "> 500B"]],
        "parameterRange": "Parameters, {low} to {high}",
        "statuses": [["addressed", "Verified"], ["pending", "Queued"], ["skipped", "Unverified"]],
        "recency": [["Last 30 days", 30], ["90 days", 90], ["6 months", 183], ["1 year", 365]],
        "newDays": 14,
        "new": "New",
        "pageSize": 42,
        "filterBy": "Filter {label}",
        "sortAz": "Sort A to Z",
        "sortCount": "Sort by count",
        "none": "No values",
        "empty": "No models match these filters.",
        "clear": "Clear filters",
        "reset": "Reset",
        "more": "+{n} more",
        "less": "Show less",
        "show": "Show {n} models",
        "held": "Identical bytes on {sources}",
        "previous": "Previous page",
        "next": "Next page",
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
        # Signatures. The page checks a manifest's Sigstore bundle against these
        # pinned trust roots (public-good Fulcio intermediate and Rekor key, from
        # Sigstore's trusted root as `gh attestation trusted-root` gave it on
        # 2026-11-12); the kernel's trust rule decides the label.
        "trust": {
            "row": "Signed",
            "labels": {"0": "Not signed yet", "1": "Witnessed", "2": "Published by {owner}", "3": "Signature does not check out"},
            "witness": "This repository's workflow downloaded these bytes from Hugging Face, hashed every file and tensor itself and signed what it saw.",
            "logged": "Signed {when}, recorded in the public Sigstore log.",
            "manifest": "Manifest",
            "checks": {"chain": "certificate from Sigstore", "time": "valid when signed", "log": "in the transparency log", "signature": "signature", "identity": "signed by this hub's workflow", "subject": "matches this manifest", "predicate": "a witness statement"},
            "policy": {
                "identity": "https://github.com/Hologram-Technologies/hub/.github/workflows/pages.yml@refs/heads/main",
                "issuer": "https://token.actions.githubusercontent.com",
                "predicateType": "https://hologram.foundation/hub/witness/v1",
                "indexPredicateType": "https://hologram.foundation/hub/index/v1",
                "fulcioIntermediate": "MIICGjCCAaGgAwIBAgIUALnViVfnU0brJasmRkHrn/UnfaQwCgYIKoZIzj0EAwMwKjEVMBMGA1UEChMMc2lnc3RvcmUuZGV2MREwDwYDVQQDEwhzaWdzdG9yZTAeFw0yMjA0MTMyMDA2MTVaFw0zMTEwMDUxMzU2NThaMDcxFTATBgNVBAoTDHNpZ3N0b3JlLmRldjEeMBwGA1UEAxMVc2lnc3RvcmUtaW50ZXJtZWRpYXRlMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE8RVS/ysH+NOvuDZyPIZtilgUF9NlarYpAd9HP1vBBH1U5CV77LSS7s0ZiH4nE7Hv7ptS6LvvR/STk798LVgMzLlJ4HeIfF3tHSaexLcYpSASr1kS0N/RgBJz/9jWCiXno3sweTAOBgNVHQ8BAf8EBAMCAQYwEwYDVR0lBAwwCgYIKwYBBQUHAwMwEgYDVR0TAQH/BAgwBgEB/wIBADAdBgNVHQ4EFgQU39Ppz1YkEZb5qNjpKFWixi4YZD8wHwYDVR0jBBgwFoAUWMAeX5FFpWapesyQoZMi0CrFxfowCgYIKoZIzj0EAwMDZwAwZAIwPCsQK4DYiZYDPIaDi5HFKnfxXx6ASSVmERfsynYBiX2X6SJRnZU84/9DZdnFvvxmAjBOt6QpBlc4J/0DxvkTCqpclvziL6BCCPnjdlIB3Pu3BxsPmygUY7Ii2zbdCdliiow=",
                "rekorKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2G2Y+2tabdTV5BcGiBIx0a9fAFwrkBbmLSGtks4L3qX6yYY0zufBnhC8Ur/iy55GhWP/9A/bY2LhC30M9+RYtw==",
                "rekorLogId": "c0d23d6ad406973f9559f3ba2d1ca01f84147d8ffc5b8445c224f98b9591801d",
            },
            "tensorsTab": "Tensors",
            "tensorsNote": "{n} tensors, each named by the BLAKE3 hash of its bytes.",
            "tensorColumns": ["Tensor", "Type", "Shape", "Address"],
            "witnessed": "re-hashed by the witness",
        },
        # Two witnesses may name an address for the same file. The kernel's
        # concur rule decides whether it may be used; these are the words the
        # page says about what it found.
        "witnesses": {
            "row": "Addresses",
            "lead": "{addressed} of {files} files carry an address a reader can check.",
            "both": "{n} agreed by {first} and {second}",
            "one": "{n} from {source} alone",
            "none": "{n} with no address",
            "conflict": "{n} where the witnesses disagree, so the file has no address",
            "read": "{source}, read {date}",
        },
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
        "command": f"export HF_ENDPOINT={API}",
        "endpointsTitle": "Routes",
        "endpoints": [list(e) for e in ENDPOINTS],
        "answersTitle": "Answers",
        "answers": [[code, status, ERROR_CODES[err] or "none", msg] for code, (status, err, msg) in sorted(DIALECT.items())]
                   + [["any other", BAD_REQUEST[0], ERROR_CODES[BAD_REQUEST[1]], BAD_REQUEST[2]]],
        "record": {
            "title": "What a release record holds",
            "lead": "A record is complete when it holds every field below. The kernel decides what to do when one is missing: ask the source dialect if it can be reached, and otherwise answer from the index and say the answer is partial. An incomplete record is never served as though it were whole.",
            # The order is the kernel's: request `06` carries one byte per
            # field, in this order, then one byte for whether the source
            # dialect can be asked.
            "fields": [
                ["revision", "The commit this release names"],
                ["siblings", "Every file, with its size and address"],
                ["tags", "The tags as the publisher wrote them"],
                ["pipelineTag", "The task"],
                ["libraryName", "The library that loads it"],
                ["config", "The model configuration"],
                ["cardData", "The card's front matter and its address"],
                ["safetensors", "Parameter counts by type"],
                ["lastModified", "When the release was last changed"],
                ["gated", "Whether the publisher gates access"],
            ],
            "plans": [
                [1, "Answer from the index"],
                [2, "Ask the source dialect"],
                [3, "Answer from the index, partial"],
            ],
            "partialHeader": "X-Hub-Partial",
        },
        "listTitle": "Listing models",
        "listLead": "The query /api/models takes, in Hugging Face's own names. A value the hub does not understand is a bad request, not a quiet default: an unknown sort, or a direction other than -1, is refused the way Hugging Face refuses it.",
        "listQuery": [list(q) for q in LIST_QUERY],
        "listSorts": LIST_SORTS,
        "listLimit": 1000,
        "columnsQuery": ["Parameter", "What it does"],
        "columnsRoutes": ["Method", "Path", "What it returns"],
        "columnsAnswers": ["Kernel answer", "HTTP status", "X-Error-Code", "Meaning"],
        "sections": [
            {"id": "quickstart", "title": "Quickstart",
             "body": ["Point the tools you already use at the hub. Nothing else changes: the cache layout, revisions and errors are the ones Hugging Face tools expect."],
             "commands": [f"export HF_ENDPOINT={API}",
                          "hf download openai-community/gpt2",
                          "vllm serve openai-community/gpt2",
                          f"MODEL_ENDPOINT={API}/ llama-cli -hf bartowski/MiniCPM5-2B-GGUF:IQ2_M"]},
            {"id": "verification", "title": "Verification",
             "body": ["Every file has an address: the SHA-256 of its bytes. Verify on a model page fetches one file from each source that holds it, hashes each copy in your browser and asks the hub's kernel two questions: does this copy match its address, and what is the verdict across all copies.",
                      "Both answers are proved in Lean for every possible input: a copy is accepted exactly when its digest and size are the expected ones, and the page says Verified only when at least one source delivered and none sent other bytes.",
                      "Hugging Face clients check a download's length, not its content. A runner that carries the bytes can check every byte before a tool reads it; that is the hub's local runner, the next milestone that serves files."]},
            {"id": "sources", "title": "Sources and failover",
             "body": ["A file can come from Hugging Face, ModelScope or IPFS. The kernel chooses: never a source that does not hold the file or failed verification for it, a healthy one whenever a usable one exists, and only the source you pin when you pin one with /via/<source>.",
                      "On the edge the hub only redirects, and only to vetted sources. A local runner serves the bytes itself, after checking them."],
             "commands": [f"curl -I {API}/via/ipfs/openai-community/gpt2/resolve/main/config.json"]},
            {"id": "limits", "title": "Limits and scope",
             "body": ["Open-weight models only: gated and private repositories are refused, and a missing repository and a private one get the same answer, so the hub never tells them apart.",
                      "Reads only for now. Uploads, discussions, Spaces and inference are not part of the hub."]},
        ],
        "back": "Browse models",
        "backRoute": ROUTE["models"],
    },
}
