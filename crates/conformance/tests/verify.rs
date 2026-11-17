//! The `verify` suite: one test per scenario in `features/suites/verify.feature`.
//!
//! The verifier is Python a client runs on its own machine, and what it does
//! with bytes is exercised by `tests/uor/verify.py`, which the Pages workflow
//! runs against rows the real minter wrote. This holds the verifier to its
//! promise and holds that test in place.

/// A file's text with `#` comments removed, so a promise kept only in a
/// comment cannot satisfy the test. A `#` inside a string is not a comment;
/// the verifier has none outside its docstring, which is dropped whole.
fn python_code(relative: &str) -> String {
    let path = repo_model::repo_root().join(relative);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    let body = text
        .split_once("\"\"\"\nimport")
        .map_or(text.as_str(), |(_, rest)| rest);
    body.lines()
        .map(|line| line.split_once(" # ").map_or(line, |(code, _)| code))
        .filter(|line| !line.trim_start().starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n")
}

/// `HK-38`: A downloaded model file is checked against the UOR address index by a verifier that uses only the Python standard library: it recomputes the file's canonical label and every tensor's leaf, and refuses the file naming each tensor that does not match
#[test]
fn verify_hk_38() {
    let verifier = python_code("web/uor-verify.py");

    // Only the standard library, so a reader needs nothing of this hub's to
    // run it, and nothing a package index could swap.
    const STDLIB: [&str; 8] = [
        "hashlib",
        "json",
        "math",
        "mmap",
        "os",
        "struct",
        "sys",
        "urllib.request",
    ];
    for line in verifier
        .lines()
        .filter(|l| l.starts_with("import ") || l.starts_with("from "))
    {
        let module = line.split_whitespace().nth(1).unwrap_or_default();
        assert!(
            STDLIB.contains(&module),
            "web/uor-verify.py imports `{module}`, which is not the standard library"
        );
    }
    // Both checks, each against the index's own field.
    assert!(
        verifier.contains("if label != row[\"label\"]:"),
        "the verifier must recompute the file's label and compare it with the index"
    );
    assert!(
        verifier.contains("if found != t[\"address\"]:")
            && verifier.contains("problems.append(f\"tensor {t['name']}: expected"),
        "the verifier must recompute every tensor's leaf and name each tensor that differs"
    );
    // The label is recomputed from the bytes for both realizations the index carries.
    assert!(
        verifier.contains(
            "SKELETONS = {\"safetensors\": safetensors_skeleton, \"gguf\": gguf_skeleton}"
        ),
        "the verifier must hold a canonical form for each realization the index addresses"
    );
    // An index shard is used only if it is the bytes the signed root names.
    assert!(
        verifier.contains("!= named[\"sha256\"]"),
        "the verifier must refuse a shard that is not the bytes the root names"
    );

    let workflow =
        std::fs::read_to_string(repo_model::repo_root().join(".github/workflows/pages.yml"))
            .expect("reading pages.yml");
    assert!(
        workflow.contains("python3 -I tests/uor/verify.py"),
        "the Pages workflow must run tests/uor/verify.py, or its cases prove nothing"
    );
    let test = std::fs::read_to_string(repo_model::repo_root().join("tests/uor/verify.py"))
        .expect("reading tests/uor/verify.py");
    for case in [
        "a flipped tensor byte is refused, naming that tensor",
        "a changed metadata value is refused by the label",
        "a flipped GGUF tensor byte is refused",
    ] {
        assert!(
            test.contains(case),
            "tests/uor/verify.py must keep the case: {case}"
        );
    }
}
