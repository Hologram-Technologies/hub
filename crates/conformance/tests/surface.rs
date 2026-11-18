//! The `surface` suite: one test per scenario in `features/suites/surface.feature`.
//!
//! Two readers that do not share code. Hugging Face's own published surface,
//! pinned in `tools/hf-surface/inventory.json`, says which read operations
//! exist; the measured list below says which of them Hugging Face answers only
//! to a repository's owner. The site model as generated (the docs screen in
//! `app/tools/vectors.json`) says what the hub declares, and the kernel's
//! `route` definition says how it answers each one. Lean proves the route
//! decision over every request; these tests check that what Lean proves is
//! the surface Hugging Face publishes.

use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

fn read(path: &str) -> String {
    let full = repo_model::repo_root().join(path);
    std::fs::read_to_string(&full).unwrap_or_else(|e| panic!("reading {}: {e}", full.display()))
}

const KINDS: [&str; 3] = ["models", "datasets", "spaces"];

/// Read operations Hugging Face answers only to the repository's owner: each
/// answered 401 to a request with no token, measured against huggingface.co
/// on 2026-11-16 with a public repository of each type.
const OWNER_ONLY: [&str; 11] = [
    "/lfs-files",
    "/resource-group",
    "/user-access-request/{status}",
    "/xet-write-token/{rev}",
    "/duplicate/status",
    "/settings/trusted-publishers",
    "/user-access-report",
    "/logs/{logType}",
    "/secrets",
    "/variables",
    "/api/spaces/zero-gpu/quota",
];

fn owner_only(path: &str) -> bool {
    path == "/api/whoami-v2" || OWNER_ONLY.iter().any(|tail| path.ends_with(tail))
}

/// The read operations Hugging Face publishes for models, datasets and Spaces:
/// every GET in those tags, the one read sent as a POST (paths-info), every
/// read that names a repository type, search across repositories and whoami.
/// `{repoType}` is expanded to each type.
fn published_reads() -> BTreeSet<(String, String)> {
    let inventory: Value = serde_json::from_str(&read("tools/hf-surface/inventory.json"))
        .expect("the pinned surface is JSON");
    let mut out = BTreeSet::new();
    for op in inventory["operations"].as_array().expect("operations") {
        let (method, path, tag) = (
            op["method"].as_str().unwrap(),
            op["path"].as_str().unwrap(),
            op["tag"].as_str().unwrap(),
        );
        let is_read = method == "GET" || (method == "POST" && path.contains("/paths-info/"));
        let in_scope = ["models", "datasets", "spaces"].contains(&tag)
            || path.contains("{repoType}")
            || [
                "/api/quicksearch",
                "/api/search/full-text",
                "/api/whoami-v2",
            ]
            .contains(&path);
        if !is_read || !in_scope {
            continue;
        }
        if path.contains("{repoType}") {
            for kind in KINDS {
                out.insert((method.to_string(), path.replace("{repoType}", kind)));
            }
        } else {
            out.insert((method.to_string(), path.to_string()));
        }
    }
    out
}

/// The docs screen the kernel serves (request `03 04`), from the vectors the
/// kernel is checked against.
fn docs() -> Value {
    let vectors: Value =
        serde_json::from_str(&read("app/tools/vectors.json")).expect("vectors are JSON");
    let hex = vectors
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["request"] == "0304")
        .expect("the docs screen is a vector")["response"]
        .as_str()
        .unwrap()
        .to_string();
    let bytes: Vec<u8> = (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect();
    serde_json::from_slice(&bytes).expect("the docs screen is JSON")
}

/// Every (method, path in Hugging Face's spelling) the hub declares, with the
/// (operation, kind, method) numbers the kernel is asked.
fn declared() -> BTreeMap<(String, String), (usize, usize, usize)> {
    let docs = docs();
    let prefix: BTreeMap<String, String> = docs["kinds"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| {
            (
                k[0].as_str().unwrap().to_string(),
                k[1].as_str().unwrap().to_string(),
            )
        })
        .collect();
    let methods = ["", "GET", "HEAD", "POST"];
    let mut out = BTreeMap::new();
    let surface = docs["surface"]
        .as_array()
        .expect("the docs screen carries the surface");
    for (op, row) in surface.iter().enumerate() {
        let path = row[1].as_str().unwrap();
        let kinds: Vec<&str> = row[2]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| k.as_str().unwrap())
            .collect();
        let each: Vec<(usize, String)> = if kinds.is_empty() {
            vec![(0, path.to_string())]
        } else {
            kinds
                .iter()
                .map(|k| {
                    let n = KINDS.iter().position(|x| x == k).unwrap() + 1;
                    (
                        n,
                        path.replace("{type}", k).replace("{prefix}", &prefix[*k]),
                    )
                })
                .collect()
        };
        for m in row[0].as_array().unwrap() {
            let m = m.as_str().unwrap();
            let method = methods
                .iter()
                .position(|x| *x == m)
                .expect("a method the kernel numbers");
            for (kind, spelled) in &each {
                out.insert((m.to_string(), spelled.clone()), (op, *kind, method));
            }
        }
    }
    out
}

fn numbers(text: &str, n: usize) -> Vec<usize> {
    text.split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .take(n)
        .map(|s| s.parse().unwrap())
        .collect()
}

/// A definition nested by operation, then kind, then method, as
/// (operation, kind, method) -> the value it gives: each `(if (method =? m)
/// then v` belongs to the nearest operation and kind before it.
fn table(model: &str, name: &str) -> BTreeMap<(usize, usize, usize), String> {
    let start = model
        .find(&format!("name: {name},"))
        .unwrap_or_else(|| panic!("the kernel defines {name}"));
    let body = &model[start
        ..start
            + model[start..]
                .find(
                    "
}
",
                )
                .unwrap()];
    let mut out = BTreeMap::new();
    let (mut op, mut kind) = (usize::MAX, usize::MAX);
    let mut rest = body;
    while let Some(at) = rest.find("(if (") {
        rest = &rest[at + 5..];
        let n = numbers(rest, 1);
        if rest.starts_with("op =? ") {
            op = n[0];
        } else if rest.starts_with("kind =? ") {
            kind = n[0];
        } else if rest.starts_with("method =? ") {
            let then = &rest[rest.find(" then ").unwrap() + 6..];
            let value: String = then
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric())
                .collect();
            out.insert((op, kind, n[0]), value);
        }
    }
    out
}

/// The (operation, kind, method) the kernel's `readAnswer` answers, with the answer.
fn read_answers() -> BTreeMap<(usize, usize, usize), usize> {
    table(&read("app/src/Kernel.lex.tex"), "readAnswer")
        .into_iter()
        .map(|(c, v)| (c, v.parse().unwrap()))
        .filter(|(_, v)| *v != 0)
        .collect()
}

fn public_cases() -> BTreeSet<(usize, usize, usize)> {
    read_answers().into_keys().collect()
}

/// The kernel's `route` as (operation, kind, method) -> answer for every case
/// it answers, and the answer it gives everything else. `route` refuses a
/// request `readAnswer` gives 0, and otherwise answers with what it gives.
fn route() -> (BTreeMap<(usize, usize, usize), usize>, usize) {
    let model = read("app/src/Kernel.lex.tex");
    let start = model
        .find("name: route,")
        .expect("the kernel defines route");
    let body = &model[start
        ..start
            + model[start..]
                .find(
                    "
}
",
                )
                .unwrap()];
    assert!(
        body.contains("body: (if ((readAnswer method kind op) =? 0) then 4 else (if ((readAnswer method kind op) <? 4) then (readAnswer method kind op) else 3))"),
        "route must refuse what readAnswer does not answer, and otherwise answer with it"
    );
    (read_answers(), 4)
}

const REFUSED: usize = 4;

/// That a proof module's `breaks` definition states `statement`, and the
/// cases `readAnswer` answers, which that statement is over.
fn cases_in(module: &str, breaks: &str, statement: &str) -> BTreeSet<(usize, usize, usize)> {
    let text = read(&format!("app/src/Proofs/{module}.lex.tex"));
    let at = text
        .find(&format!("name: {breaks},"))
        .unwrap_or_else(|| panic!("{module} defines {breaks}"));
    assert!(
        text[at..].contains(&format!("body: {statement}")),
        "{breaks} must state {statement}"
    );
    public_cases()
}

fn proved(module: &str, holds: &str, breaks: &str) {
    let text = read(&format!("app/src/Proofs/{module}.lex.tex"));
    assert!(
        text.contains(&format!("name: {holds},"))
            && text.contains(&format!("statement: (({breaks} method kind op) = false),")),
        "{module} must prove {holds}: (({breaks} method kind op) = false)"
    );
    assert!(
        read("app/lexlean.toml").contains(&format!("\"src/Proofs/{module}.lex.tex\"")),
        "{module} must be an entrypoint Lean checks"
    );
}

/// `HK-31`: Every read operation Hugging Face answers a client with no token, for models, datasets and Spaces, is one the hub answers at Hugging Face's own path and in its terms, and none of them is refused
#[test]
fn surface_hk_31() {
    let published = published_reads();
    let declared = declared();
    let (route, default) = route();
    assert!(
        published.len() > 60,
        "the pinned surface must hold the read operations: {}",
        published.len()
    );
    let mut public = BTreeSet::new();
    for (method, path) in &published {
        let Some(&case) = declared.get(&(method.clone(), path.clone())) else {
            panic!("Hugging Face publishes {method} {path}, and the hub's surface does not name it at that path");
        };
        let answer = route.get(&case).copied().unwrap_or(default);
        if owner_only(path) {
            assert_eq!(
                answer, REFUSED,
                "{method} {path} is owner only on Hugging Face and must be refused as it refuses"
            );
        } else {
            assert!(
                matches!(answer, 1..=3),
                "{method} {path} is answered by Hugging Face to a client with no token, and the kernel routes it to {answer}"
            );
            public.insert(case);
        }
    }
    // The reads clients make that Hugging Face leaves out of its file.
    for (method, path) in [
        ("HEAD", "/{namespace}/{repo}/resolve/{rev}/{path}"),
        ("HEAD", "/datasets/{namespace}/{repo}/resolve/{rev}/{path}"),
        ("GET", "/api/models"),
        ("GET", "/api/datasets"),
        ("GET", "/api/spaces"),
        ("GET", "/api/datasets/{namespace}/{repo}"),
        ("GET", "/api/spaces/{namespace}/{repo}/revision/{rev}"),
    ] {
        let case = declared[&(method.to_string(), path.to_string())];
        assert!(
            matches!(route.get(&case), Some(1..=3)),
            "{method} {path} must be answered"
        );
        public.insert(case);
    }
    // Lean proves the route never refuses these: every one is a case of the
    // proved statement.
    proved("Surface", "surfaceHolds", "breaksSurface");
    let in_proof = cases_in(
        "Surface",
        "breaksSurface",
        "((not ((Kernel::readAnswer method kind op) =? 0)) && ((Kernel::route method kind op) =? 4))",
    );
    for case in &public {
        assert!(
            in_proof.contains(case),
            "the proof of HK-31 must cover {case:?}"
        );
    }
}

/// `HK-32`: Every request the hub does not answer as a read is refused as Hugging Face refuses a client with no token: 401 with a Bearer challenge
#[test]
fn surface_hk_32() {
    let (route, default) = route();
    assert_eq!(
        default, REFUSED,
        "the route decision must refuse every request no row names"
    );
    // Lean proves that only the cases the table answers are answered.
    proved("Anonymous", "anonymousHolds", "breaksAnonymous");
    let answered: BTreeSet<_> = route
        .iter()
        .filter(|(_, d)| **d != REFUSED)
        .map(|(c, _)| *c)
        .collect();
    assert_eq!(
        cases_in(
            "Anonymous",
            "breaksAnonymous",
            "(((Kernel::readAnswer method kind op) =? 0) && (not ((Kernel::route method kind op) =? 4)))"
        ),
        answered,
        "the proof of HK-32 must name exactly the cases the route answers"
    );
    for ((_, _, method), d) in &route {
        assert!(
            *d == REFUSED || (1..=3).contains(method),
            "no method but GET, HEAD and POST may be answered"
        );
    }

    // The dialect answers that refusal as huggingface.co answers a client with no token.
    let docs = docs();
    let row = docs["answers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r[0] == 18)
        .expect("the dialect names the anonymous refusal");
    assert_eq!(row[1], 401, "the anonymous refusal must be a 401");
    assert_eq!(
        row[2], "none",
        "with no X-Error-Code, as Hugging Face sends none"
    );
    assert_eq!(
        row[3], "Invalid username or password.",
        "with Hugging Face's own message"
    );

    // And the edge answers with it, with Hugging Face's own challenge, for every request the kernel refuses.
    let edge = read("edge/edge.mjs");
    assert!(
        edge.contains("const ANONYMOUS = 18;")
            && edge.contains(
                r#"answer === ANONYMOUS) headers["www-authenticate"] = 'Bearer realm="Authentication required", charset="UTF-8"'"#
            ),
        "the edge must challenge as Hugging Face does"
    );
    assert!(
        edge.contains(
            "new Uint8Array([8, METHOD_NO[request.method] ?? 0, found.kindNo, found.op])"
        ) && edge.contains("return refuse(ANONYMOUS, request.method);"),
        "the edge must ask the kernel's route decision and refuse what it refuses"
    );
}

/// `HK-53`: The edge reads the signed index root again when a record does not match the root it holds, so a deploy never leaves a model refused, and bytes no signed root names are still refused
#[test]
fn surface_hk_53() {
    // The root is read again, through the same signed open as at start, when a
    // record does not match it; a failed load is forgotten.
    let edge = read("edge/edge.mjs");
    for needle in [
        "reopenIndex = () => openIndex(indexUrl, policy);",
        "await reopen();",
        "const again = index.records.get(repo.toLowerCase());",
        "if (at.loaded.get(entry.repo) === loading) at.loaded.delete(entry.repo);",
        "if (index && Date.now() - index.opened > REOPEN) reopen()",
    ] {
        assert!(
            edge.contains(needle),
            "edge/edge.mjs must contain `{needle}`"
        );
    }
    // The behaviour, not only the text: CI deploys over a running edge.
    let workflow = read(".github/workflows/edge.yml");
    assert!(
        workflow.contains("node tests/edge/reopen.mjs"),
        "the edge workflow must run tests/edge/reopen.mjs"
    );
    let test = read("tests/edge/reopen.mjs");
    for needle in [
        "a record a deploy changed is refused",
        "a record no root names must be refused",
        "a record refused once must answer when its bytes match again",
    ] {
        assert!(
            test.contains(needle),
            "tests/edge/reopen.mjs must check `{needle}`"
        );
    }
}
