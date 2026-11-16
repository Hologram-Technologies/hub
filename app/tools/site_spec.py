"""The hub's site and Hugging Face dialect, as data the generator writes into
`app/src/Site.lex.tex`.

This file is authoring input, like `gen_kernel.py`: the generated LexLean
module is the model, the guest serves each screen from it, and the renderer in
`web/` draws only what the guest returns. Change the hub's words here, then
run `python app/tools/gen_kernel.py`.
"""

# One host appears in this file, and that is the point. API_HOST is the hub
# that answers a tool - the Hugging Face dialect, the OCI registry, MCP and
# buckets - which a static host cannot do, since it has to set `X-Repo-Commit`
# on a HEAD and redirect with headers. Every command, link and endpoint a
# tool is given names API_HOST.
#
# It is the apex. Decided 2026-11-16 (`docs/cutover.md`): gethologram.ai stays
# one name on the VPS, whose Caddy answers tools and serves this site to
# browsers from the same host, so the name a reader sees in the address bar
# is the name every command gives a tool, and the names already published
# (`HF_ENDPOINT=https://gethologram.ai`) keep working. Since the cutover the
# apex answers only from this repository, so OCI and Ollama, which speak
# /v2/, are no longer offered (HK-30). The plan this replaces put the site on Pages at the apex and
# the hub on `api.gethologram.ai`, a name that was never given a DNS record:
# measured 2026-11-16, nslookup answers "Non-existent domain", so every
# command this site printed was dead.
API_HOST = "gethologram.ai"
API = f"https://{API_HOST}"

# The object the Buckets page offers to check: a Space's manifest, whose address is that Space's root. It is read
# from the Spaces catalog this repository carries (spaces/catalog.json), so the example cannot name an object the
# store does not hold (HK-28): tools/objects.mjs files every published Space file, the manifest among them.
import json as _json
from pathlib import Path as _Path
EXAMPLE_SPACE = "kokoro-tts"
EXAMPLE_OBJECT = next(s["root"] for s in _json.loads((_Path(__file__).resolve().parents[2] / "spaces" / "catalog.json")
                                                     .read_text(encoding="utf-8"))["spaces"] if s["id"] == EXAMPLE_SPACE)

# Routes the guest renders, by number. Request `03 nn` asks for route nn.
ROUTES = ["chrome", "home", "models", "model", "docs", "spaces", "buckets"]
ROUTE = {name: i for i, name in enumerate(ROUTES)}

# The header. `route` is internal: the renderer asks the guest for that
# screen. The items and their order are Hugging Face's own header, read
# 2026-11-16 - Models, Datasets, Spaces, Buckets, Docs - minus Datasets,
# which this hub does not index, so a reader who knows one header knows this
# one. Nothing sits here that a reader cannot use: there is no Log In,
# because the hub has no accounts.
NAV = [
    {"label": "Models", "icon": "grid", "route": "models"},
    {"label": "Spaces", "icon": "cpu", "route": "spaces"},
    {"label": "Buckets", "icon": "bucket", "route": "buckets"},
    {"label": "Docs", "icon": "file", "route": "docs"},
]

# Every link a screen can follow inside the hub, with the route it opens.
LINKS = [
    # The header's search panel: a suggestion opens a model, a Space opens
    # the Spaces screen, and "View all results" hands the query to the full
    # catalogue. HK-11 covers them the way it covers the nav.
    ("chrome", "searchAll", "models"),
    ("chrome", "searchModel", "model"),
    ("chrome", "searchSpace", "spaces"),
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
    # `/api/models-tags-by-type` and `/api/quicksearch` were listed here until
    # 2026-11-16 and are not, because the host this page tells a tool to point
    # at does not answer them. Measured against API_HOST that day: both 404 in
    # every form, with and without Hugging Face's own parameters, and neither
    # appears among the 51 paths of its `/openapi.json`.
    #
    # `edge/edge.mjs` does answer them, which is what made the rows look true:
    # the edge runner is this repository's own implementation, and the hub the
    # apex serves is another. This table says what a tool gets when it is
    # pointed at API_HOST, so a route only the edge answers does not belong in
    # it - the same rule that took the Sign in button off the header.
    # The hub has no accounts, so this is a refusal and nothing else:
    # `edge/edge.mjs` answers 10 for it, which the Answers table below reads
    # as 401 RepoNotFound. The row says what a tool receives, not what the
    # route is called on a hub that does have accounts.
    ("GET", "/api/whoami-v2", "Always refused: the hub has no accounts, so no token belongs to anyone"),
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
    # Hugging Face calls these Spaces and so does this hub: every entry here
    # is a Hugging Face Space, re-hosted so that each file and each model
    # weight is named by its hash. The screen's key, its route and its URL are
    # all `spaces`, so a reader who knows /spaces on Hugging Face is already
    # at home.
    "spaces": {
        "title": "Spaces",
        "lead": "Spaces that run entirely in your browser, every file and every model weight named by its hash.",
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
        "lead": "A bucket is a named place for objects, each stored and fetched by its address. Reading any object, and checking it against its address yourself, needs nothing at all.",
        "command": f"curl -s {API}/api/v1/objects/{EXAMPLE_OBJECT} | sha256sum",
        "checkTitle": "Check an object",
        "checkLead": "Paste an address. The page fetches the object, hashes it here with the address's own hash, and asks the kernel whether these are the addressed bytes.",
        "placeholder": "blake3:... or sha256:...",
        "example": EXAMPLE_OBJECT,
        "exampleLabel": "Try a Space's manifest",
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
        "api": API,
        "nav": [dict(n, route=ROUTE[n["route"]]) if "route" in n else n for n in NAV],
        "theme": "Theme",
        "themes": [["immersive", "Immersive", "image"], ["dark", "Dark", "moon"], ["light", "Light", "sun"]],
        # The wallpapers this site ships, shown in the panel before anything is
        # searched. They are Prism AI Foundry's own six, read off its Appearance
        # panel 2026-11-16, so a reader moving between the two sees one set of
        # pictures rather than two.
        #
        # Each carries its photographer, because every one is an Unsplash photo
        # and the licence asks for the credit whether this site copied the file
        # or fetched it. `image` is the photo itself: the file beside it is the
        # copy that paints first, and the page asks the proxy for one as wide as
        # the screen can actually show, so a 4K display is not given a 1080p
        # picture because that was what shipped.
        # The picture a visitor who has chosen none sees. Named rather than
        # taken from the head of the list below, so the order the panel draws
        # them in - Foundry's own - and the one the site opens on are two
        # decisions rather than one accident of position.
        "wallpaper": "Q1p7bh3SHj8",
        "wallpapers": [
            {"file": 'E0AHdsENmDg', "id": 'E0AHdsENmDg', "alt": 'The Milky Way in blue and violet',
             "name": 'Jeremy Thomas', "user": 'jeremythomasphoto', "color": '#0c2659',
             "image": 'https://images.unsplash.com/photo-1464802686167-b939a6910659?ixid=M3w4OTc5NTl8MHwxfHNlYXJjaHwyfHxtaWxreSUyMHdheXxlbnwxfDB8fHwxNzk0ODI5MTYxfDA&ixlib=rb-4.1.0'},
            {"file": 'qtRF_RxCAo0', "id": 'qtRF_RxCAo0', "alt": 'A nebula in blue, gold and rust',
             "name": 'Aldebaran S', "user": 'aldebarans', "color": '#262626',
             "image": 'https://images.unsplash.com/photo-1610296669228-602fa827fc1f?ixid=M3w4OTc5NTl8MHwxfHNlYXJjaHwyfHxuZWJ1bGF8ZW58MXwwfHx8MTc5NDgyOTE2Mnww&ixlib=rb-4.1.0'},
            {"file": 'RF4p4rTM-2s', "id": 'RF4p4rTM-2s', "alt": 'The Andromeda galaxy among stars',
             "name": 'Bryan Goff', "user": 'bryangoffphoto', "color": '#262626',
             "image": 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?ixid=M3w4OTc5NTl8MHwxfHNlYXJjaHw1fHxtaWxreSUyMHdheXxlbnwxfDB8fHwxNzk0ODI5MTYxfDA&ixlib=rb-4.1.0'},
            {"file": 'Q1p7bh3SHj8', "id": 'Q1p7bh3SHj8', "alt": 'City lights across Earth at night, from orbit',
             "name": 'NASA', "user": 'nasa', "color": '#0c2626',
             "image": 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?ixid=M3w4OTc5NTl8MHwxfHNlYXJjaHw0fHxzcGFjZXxlbnwxfDB8fHwxNzk0ODI5MTI5fDA&ixlib=rb-4.1.0'},
            {"file": 't7EL2iG3jMc', "id": 't7EL2iG3jMc', "alt": "Earth's blue horizon against space",
             "name": 'ActionVance', "user": 'actionvance', "color": '#59598c',
             "image": 'https://images.unsplash.com/photo-1534996858221-380b92700493?ixid=M3w4OTc5NTl8MHwxfHNlYXJjaHw5fHxzcGFjZXxlbnwxfDB8fHwxNzk0ODI5MTI5fDA&ixlib=rb-4.1.0'},
            {"file": '9wH624ALFQA', "id": '9wH624ALFQA', "alt": 'The Milky Way rising over mountains',
             "name": 'Dns Dgn', "user": 'dnsdgn', "color": '#0c2640',
             "image": 'https://images.unsplash.com/photo-1515705576963-95cad62945b6?ixid=M3w4OTc5NTl8MHwxfHNlYXJjaHwxfHxtaWxreSUyMHdheXxlbnwxfDB8fHwxNzk0ODI5MTYxfDA&ixlib=rb-4.1.0'},
        ],
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
        # The search box, beside the lockup, where Hugging Face puts its own
        # (read 2026-11-16: "Search models, datasets, users...", a Ctrl K chip,
        # and a panel of sections under the header). This hub indexes models and
        # ships Spaces and says only those two: a box offering to search datasets
        # it does not hold would be the promise the Sign in button was.
        #
        # What makes it instant is `data/browse/search/quick/`: one fetch the
        # first time two characters name a bucket, then every keystroke after it
        # answered in the page without a request. `web/browsekey.mjs` holds the
        # rule the builder files by and the page resolves by.
        "search": {
            "placeholder": "Search models and Spaces",
            "label": "Search",
            "hint": "Ctrl K",
            "hintMac": "\u2318 K",
            "models": "Models",
            "spaces": "Spaces",
            # Said while the head of the catalogue is being fetched, and again
            # when a query is rare enough that the full index has to be read.
            "looking": "Looking\u2026",
            "deeper": "Searching the whole catalogue\u2026",
            "empty": "Nothing matches that.",
            "all": "View all results for \u201c{q}\u201d",
            "allRoute": ROUTE["models"],
            "spacesRoute": ROUTE["spaces"],
            "navigate": "Navigate",
            "select": "Select",
            "close": "esc",
        },
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
        # What a tool gets at the apex is the Hugging Face API; the agent page that answered a bare `curl` is retired.
        "command": f"curl {API}/api/models?limit=3",
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
        "command": f"curl {API}/api/models?search=gpt2",
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
        # Models the swarm lists that this hub does not index. They are read
        # a slice at a time - the whole catalog is about 300 MB and the page
        # loads shards it names and hashes them, so it reads only the one
        # whose prefix a search matches. Nothing here is checked by this hub,
        # and the words say so rather than leaving a reader to assume the row
        # carries the same weight as a signed one.
        # Models Pirate Face lists. They are rows in the same grid as every
        # other model, with the same card and the same model page, and they
        # are told apart by what each row says of itself - its status is
        # `listed`, its source is Pirate Face - rather than by being put
        # somewhere else on the page. A reader filters by source like any
        # other facet.
        #
        # The catalog is far larger than this hub's index and is never loaded
        # whole: the most seeded page is read at first paint and a search
        # reads the one shard its query begins with. `partial` is how the page
        # says so instead of letting a count imply the whole catalog.
        "swarm": {
            # What a reader calls it. The wire name stays `pirateface`: it is a path
            # in `/via/<source>` and the name of a source slot, and a space in
            # either would be a different change.
            "source": "Pirate Face",
            "seeders": "{n} seeding",
            "partial": "Showing {n} of the {total} models {source} lists. Search by name to reach the rest.",
            "get": "This hub has not checked these bytes. A local runner fetches them from the swarm and checks each file against an address of its own:",
            # The address row and the command name the same endpoint, because
            # they are the same claim about where this model can be got.
            "host": "127.0.0.1:8788",
            "command": "HF_ENDPOINT=http://{host} hf download {id}",
        },
        # What a reader calls each source. The kinds themselves stay as they
        # are: they are paths in `/via/<source>` and the names of source
        # slots, and a space in one would be a different change.
        "sourceNames": [["huggingface.co", "Hugging Face"], ["modelscope.cn", "ModelScope"],
                        ["ipfs", "IPFS"], ["pirateface", "Pirate Face"]],
        "searchParam": "search",
        "pageParam": "p",
        "tabs": [["main", "Main", "sliders"], ["sources", "Sources", "nodes"], ["tasks", "Tasks", "grid"],
                 ["libraries", "Libraries", "box"], ["languages", "Languages", "globe"],
                 ["licenses", "Licenses", "scale"], ["other", "Other", "cpu"]],
        # key (the catalog field), URL name, label, the tabs it appears on,
        # icon, kind: "fixed" keeps the order given below, "search" adds a
        # filter box, "plain" drops the counts, "range" is the slider.
        # key (the catalog field), the query parameter, label, the tabs it
        # appears on, icon, kind. The first eight parameters are Hugging
        # Face's; the four after them name facets Hugging Face does not have,
        # so they cannot collide with a link copied from it.
        "facets": [["sources", "hub_source", "Sources", ["main", "sources"], "nodes", "plain"],
                   ["task", "pipeline_tag", "Tasks", ["main", "tasks"], "grid", ""],
                   ["params", "num_parameters", "Parameters", ["main"], "tag", "range"],
                   ["library", "library", "Libraries", ["main", "libraries"], "box", "search"],
                   ["languages", "language", "Languages", ["languages"], "globe", "search"],
                   ["license", "license", "Licenses", ["licenses"], "scale", "search"],
                   ["author", "author", "Owner", ["other"], "user", "search"],
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
        "statuses": [["addressed", "Verified"], ["pending", "Queued"], ["skipped", "Unverified"], ["listed", "Listed only"]],
        "recency": [["Last 30 days", 30], ["90 days", 90], ["6 months", 183], ["1 year", 365]],
        "newDays": 14,
        "new": "New",
        "pageSize": 42,
        "filterBy": "Filter {label}",
        "sortAz": "Sort A to Z",
        "sortCount": "Sort by count",
        "none": "No values",
        "empty": "No models match these filters.",
        # A first search for a term reads that term's own slice of the
        # index, which on a cold edge took 8 to 31 seconds measured
        # 2026-11-14. The results area said nothing for all of it, which
        # reads as a catalogue holding nothing rather than as a page
        # still fetching.
        "searching": "Looking through the catalogue…",
        "clear": "Clear filters",
        "reset": "Reset",
        "more": "+ {n}",
        "less": "Show less",
        "show": "Show {n} models",
        "held": "Identical bytes on {sources}",
        "previous": "Previous page",
        "next": "Next page",
    },
    "model": {
        "back": "Models",
        # The host the address line and the three Get-it commands name. It is
        # the hub that answers a tool, never the apex this site is served
        # from: a static host cannot answer `HF_ENDPOINT`, so a command naming
        # the apex would be an instruction that stops working at the cutover.
        "endpoint": API_HOST,
        "address": "Address",
        "held": "Held on",
        "get": "Get it",
        "copy": "Copy",
        "copied": "Copied",
        "tools": [
            ["Hugging Face", "HF_ENDPOINT=https://{host} hf download {repo}"],
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
        # The canonical UOR address. `uor-addr` publishes a canonical form per
        # format and mints a kappa-label from it, under which two files that
        # decode to the same logical content -- modulo metadata-key order,
        # tensor order and tensor-data layout -- address alike, so the same
        # tensors have the same address wherever they come from.
        #
        # Two numbers travel per tensor, because they answer different
        # questions. The address is BLAKE3 over the tensor's own raw bytes:
        # the identity hologram's substrate and the Q engine use, and the one
        # runner/uor.mjs already emits. uor-addr's canonical-form leaf is
        # SHA-256 by the form's own definition -- the axis is applied to the
        # finished skeleton, so address_blake3 still folds SHA-256 leaves --
        # and it is published beside the address as what the model label
        # binds. Both are over one tensor's byte range, which is why a reader
        # can check one from a ranged read and needs neither the file nor this
        # hub's word for it. The verdict below is the kernel's accept rule;
        # the page only says what the kernel answered.
        "uor": {
            "tab": "Canonical",
            "note": "{n} files carry a canonical UOR address, minted by {addresser} under canonical form {form}. A tensor's address is the BLAKE3 of its own bytes, so a reader can check one without the file.",
            "fileLabel": "Address",
            "columns": ["Tensor", "Shape", "Bytes", "Address", ""],
            "derive": "Check",
            "deriving": "Reading {size}",
            "accepted": "these bytes have that address",
            "refused": "these bytes have a different address",
            "unreachable": "the source did not answer",
            "unchecked": "not checked here",
            "none": "This model has no canonical UOR address yet.",
            "shardRefused": "The address shard is not the bytes the signed root names, so nothing from it is shown.",
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
                      "Reads only for now. Uploads, discussions and inference are not part of the hub, and neither is publishing a Space: the Spaces it lists are re-hosted to run in your browser."]},
        ],
        "back": "Browse models",
        "backRoute": ROUTE["models"],
    },
}
