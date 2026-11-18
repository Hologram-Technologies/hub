//! The `runner` suite: one test per scenario in `features/suites/runner.feature`.
//!
//! The runner is JavaScript, and what it does with bytes is exercised by
//! `tests/runner/serve.mjs`, which `.github/workflows/runner.yml` runs against
//! the published kernel. These tests hold the source to the promise and hold
//! that behavioural test in place, so neither can quietly go.

/// A file's source with `//` comments removed, so a promise kept only in a
/// comment cannot satisfy a test.
fn without_comments(relative: &str) -> String {
    let path = repo_model::repo_root().join(relative);
    assert!(
        path.is_file(),
        "{relative} must exist for this test to be reading anything"
    );
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    text.lines()
        .map(|line| match line.find("//") {
            Some(at) if !line[..at].ends_with(':') => &line[..at],
            _ => line,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The behavioural test, which must be one the runner workflow actually runs.
fn serve_test_is_run() -> String {
    let workflow = without_comments(".github/workflows/runner.yml");
    assert!(
        workflow.contains("node tests/runner/serve.mjs"),
        "the runner workflow must run tests/runner/serve.mjs, or its cases prove nothing"
    );
    without_comments("tests/runner/serve.mjs")
}

/// Up to `len` bytes of `source` from the first occurrence of `anchor`.
fn after<'a>(source: &'a str, anchor: &str, len: usize) -> &'a str {
    let at = source
        .find(anchor)
        .unwrap_or_else(|| panic!("the runner no longer contains `{anchor}`"));
    let mut end = (at + len).min(source.len());
    while !source.is_char_boundary(end) {
        end -= 1;
    }
    &source[at..end]
}

/// `HK-36`: The runner checks a file it serves from its cache against the file's address and every tensor's address on every read, as it checks a fresh fetch, and a cached file that fails is deleted and fetched again rather than served
#[test]
fn runner_hk_36() {
    let runner = without_comments("runner/local.mjs");

    // A hit goes through the same `check` a fresh fetch does, and a failing
    // copy is deleted and the attempt moves on to a fetch.
    let hit = after(&runner, "if (hit) {", 600);
    assert!(
        hit.contains("await check(kernel, file,"),
        "a cache hit must be checked against the file's address like a fresh fetch"
    );
    assert!(
        hit.contains("await unlink(file)") && hit.contains("continue;"),
        "a cached copy that fails must be deleted and fetched again"
    );
    // The tensor check runs on whatever file is about to be served, hit or
    // fresh, and a copy that fails it is deleted rather than left to block
    // the file.
    let tensors = after(&runner, "checkTensorsOfFile(manifest, path, file)", 700);
    assert!(
        tensors.contains("await unlink(file)"),
        "a copy whose tensors fail must be deleted, whether it came from the cache or a source"
    );

    let test = serve_test_is_run();
    assert!(
        test.contains("flipped[100] ^= 1")
            && test.contains("a corrupted cached copy must never reach the client"),
        "tests/runner/serve.mjs must corrupt a cached copy and require that it is not served"
    );
}

/// `HK-37`: When every source sends bytes that do not match the address, the runner refuses with Quarantined, naming the address it expected and the one it got, so a client can tell bad bytes from an outage
#[test]
fn runner_hk_37() {
    let runner = without_comments("runner/local.mjs");

    assert!(
        runner.contains("mismatch && !silent.size ? refuse(21, method, mismatch)"),
        "bytes that only ever mismatched must be refused with code 21, and an unreachable source must keep it an outage"
    );
    assert!(
        runner.contains("expected: mismatch.expected, found: mismatch.found"),
        "the refusal must name the address expected and the one found"
    );
    // Both digests `check` compares say what they expected and what they got,
    // so the refusal never has to guess.
    assert!(
        runner.contains("expected: `sha256:${address}`, found: `sha256:${observed}`"),
        "a SHA-256 mismatch must carry both addresses"
    );
    assert!(
        runner.contains("expected: `gitSha1:${blobId}`, found: `gitSha1:${found}`"),
        "a git blob mismatch must carry both addresses"
    );

    // The code is the one the model declares for it.
    let spec = without_comments("app/tools/site_spec.py");
    assert!(
        spec.contains("21: (502,"),
        "code 21 must be the 502 the model declares"
    );

    let test = serve_test_is_run();
    assert!(
        test.contains("assert.equal(response.headers.get(\"x-error-code\"), \"Quarantined\")"),
        "tests/runner/serve.mjs must require Quarantined for bytes that only mismatched"
    );
    assert!(
        test.contains("a file with no address of any kind is refused"),
        "tests/runner/serve.mjs must keep a file with no address an outage, not a mismatch"
    );
}
