//! The `pieces` suite: one test per scenario in `features/suites/pieces.feature`.
//!
//! The browser fetcher is JavaScript, so Lean does not check it. What holds it
//! to the kernel's rule is that its decision function is the kernel's
//! `pieceDecision` transcribed, that it uses bytes only on that function's
//! answers, and that `tests/pieces/fetch.mjs`, which CI runs, checks the four
//! kernel guarantees of that function on every input and then end to end
//! against a host that lies, truncates and fails. These tests hold all of that
//! in place, so a fetcher that decides some other way, or a check that stops
//! running, fails here.

use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crates/conformance is two below the root")
        .to_path_buf()
}

fn read(path: &str) -> String {
    std::fs::read_to_string(root().join(path)).unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// `HK-43`: A model's bytes are fetched in pieces from any host, and a piece is used only when the fetcher's decision, the kernel's piece rule, answers reuse or deliver; that decision keeps HK-39 to HK-42 on every input, and the committed hasher is what its source builds
#[test]
fn pieces_hk_43() {
    let kernel = read("app/src/Pieces.lex.tex");
    let fetcher = read("web/pieces.mjs");
    let check = read("tests/pieces/fetch.mjs");
    let workflow = read(".github/workflows/pieces.yml");

    // The rule the fetcher transcribes is the one Lean proves: the table, then
    // the stored copy, then the received bytes, then another source.
    assert!(
        kernel.contains("body: (if (tableHolds piece) then (if (cacheHolds piece) then (answerReuse) else (if (bytesHold piece) then (answerDeliver) else (fallback piece))) else (fallback piece))"),
        "the kernel's pieceDecision changed; the fetcher's transcription must change with it"
    );
    assert!(
        kernel.contains(
            "body: (if (0 <? (project piece sourcesLeft)) then (answerRetry) else (answerRefuse))"
        ),
        "the kernel's fallback changed"
    );
    // The transcription, in the same order and with the same answers.
    assert!(
        fetcher.contains(
            "  const fallback = sourcesLeft > 0 ? ANSWER.retry : ANSWER.refuse;\n  if (!tableHolds) return fallback;\n  if (held && cachedMatches) return ANSWER.reuse;\n  if (observedMatches && lengthMatches) return ANSWER.deliver;\n  return fallback;\n"
        ),
        "web/pieces.mjs's pieceDecision must be the kernel's, transcribed"
    );
    assert!(
        fetcher
            .contains("ANSWER = Object.freeze({ reuse: 30, deliver: 31, retry: 32, refuse: 33 })"),
        "the fetcher's answers must be the kernel's numbers"
    );

    // Bytes reach the caller in exactly three places, each behind an answer
    // of reuse or deliver.
    let uses: Vec<usize> = fetcher
        .match_indices("onPiece?.(")
        .map(|(i, _)| i)
        .collect();
    assert_eq!(
        uses.len(),
        3,
        "the fetcher hands bytes to its caller in exactly three places"
    );
    for at in uses {
        let before = &fetcher[at.saturating_sub(600)..at];
        assert!(
            before.contains("if (d === ANSWER.reuse)")
                || before.contains("if (d === ANSWER.deliver)"),
            "every place the fetcher uses bytes must follow a reuse or deliver answer:\n{before}"
        );
    }

    // The check exercises each guarantee on every input, then end to end.
    for (id, line) in [
        (
            "HK-39",
            "if (d === ANSWER.deliver) assert.ok(tableHolds && observedMatches && lengthMatches",
        ),
        (
            "HK-40",
            "if (d === ANSWER.reuse) assert.ok(tableHolds && held && cachedMatches",
        ),
        (
            "HK-41",
            "if (tableHolds && held && cachedMatches) assert.equal(d, ANSWER.reuse",
        ),
        (
            "HK-42",
            "if (d === ANSWER.refuse) assert.equal(sourcesLeft, 0",
        ),
    ] {
        assert!(
            check.contains(line),
            "tests/pieces/fetch.mjs must check {id} on every input"
        );
    }
    assert!(
        check.contains("const liar") || check.contains("host(\"liar\""),
        "the check must run the fetcher against a host that lies"
    );

    // CI runs both, and refuses a module that is not what its source builds.
    assert!(
        workflow.contains("run: tools/build-piece-hash.sh --check"),
        "the pieces workflow must rebuild the hasher and compare it with the committed module"
    );
    assert!(
        workflow.contains("run: node tests/pieces/fetch.mjs"),
        "the pieces workflow must run the fetcher's check, or it proves nothing"
    );
    let module = std::fs::read(root().join("web/piece-hash.wasm")).expect("web/piece-hash.wasm");
    assert_eq!(
        &module[..4],
        b"\0asm",
        "web/piece-hash.wasm must be a WebAssembly module"
    );
}
