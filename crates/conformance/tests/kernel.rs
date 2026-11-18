//! The `kernel` suite: one test per scenario in `features/suites/kernel.feature`.
//!
//! The proofs are checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. What these tests hold fixed is the claim each
//! proof is about: the exact condition no input may meet, the theorem that
//! states none does, and that the application's answer is decided by the
//! functions those theorems are about. A weakened condition, a theorem that no
//! longer quantifies over every input, or a dispatch that decides some other
//! way would still verify, and would no longer be the claim its row makes.

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

/// The body of the top-level declaration named `name`, up to its closing brace.
fn declaration<'a>(model: &'a str, name: &str) -> &'a str {
    let start = model
        .find(&format!("\n  name: {name},\n"))
        .unwrap_or_else(|| panic!("{name} is not declared"));
    let end = model[start..]
        .find("\n}\n")
        .unwrap_or_else(|| panic!("{name} is not closed"));
    &model[start..start + end]
}

/// The condition no input may meet, and the theorem in `app/src/Proofs/` that
/// says none does, over every input, resting on exactly `axioms`.
fn pinned(
    module: &str,
    breaks: &str,
    condition: &str,
    theorem: &str,
    arguments: &str,
    axioms: &str,
) {
    let path = format!("app/src/Proofs/{module}.lex.tex");
    let model = read(&path);
    let found = declaration(&model, breaks);
    assert!(
        found.ends_with(&format!("  body: {condition}")),
        "the condition of {breaks} in {path} changed:\n{found}"
    );
    let holds = declaration(&model, theorem);
    assert!(
        holds.contains(&format!("statement: (({breaks} {arguments}) = false),")),
        "{theorem} must state that no input meets {breaks}:\n{holds}"
    );
    assert!(
        holds.contains("proof: linear_arithmetic")
            && holds.contains(&format!("axioms: [{axioms}]")),
        "{theorem} is proved by linear_arithmetic on exactly {axioms}:\n{holds}"
    );
    let lexlean = read("app/lexlean.toml");
    assert!(
        lexlean.contains(&format!("\"src/Proofs/{module}.lex.tex\"")),
        "{path} must be a build entrypoint, or Lean never checks {theorem}"
    );
}

/// Every answer comes from `dispatch`. A resolve request is answered by
/// `plan`, which names a source (`select`) and an ETag kind (`etagKind`) only
/// when `delivers` holds, and otherwise the same `04 00` whatever the sources
/// hold; an accept request is answered by `accepts`.
fn dispatch_decides_by(function: &str) {
    let model = read("app/src/Kernel.lex.tex");
    let dispatch = declaration(&model, "dispatch");
    assert!(
        dispatch.contains("then (plan (observeFacts value))")
            && dispatch.contains("(if (accepts (observeCheck value)) then 0x140400 else 0x150400)"),
        "dispatch must answer through plan and accepts:\n{dispatch}"
    );
    let plan = declaration(&model, "plan");
    assert!(
        plan.contains("body: (if (delivers facts) then (prim append (encodeAnswer (answer facts)) (prim append (encodeSlot (select facts)) (encodeEtag (etagKind facts)) : Bytes) : Bytes) else (prim append (encodeAnswer (answer facts)) 0x0400 : Bytes))"),
        "plan must name a source and an ETag only when delivers holds:\n{plan}"
    );
    let delivers = declaration(&model, "delivers");
    assert!(
        delivers.contains(
            "body: (((answer facts) =? (answerRedirect)) || ((answer facts) =? (answerServe)))"
        ),
        "delivers must be exactly a redirect or a serve answer:
{delivers}"
    );
    assert!(
        dispatch.contains(function) || plan.contains(function),
        "the plan must be decided by {function}"
    );
}

/// `HK-01`: A missing repository and a private repository get the same answer: repository not found, with no source and no ETag
#[test]
fn kernel_hk_01() {
    pinned(
        "Privacy",
        "breaksPrivacy",
        "((((project facts repo) =? 1) || ((project facts repo) =? 2)) && ((not ((Kernel::answer facts) =? (Kernel::answerRepoNotFound))) || (Kernel::delivers facts)))",
        "privacyHolds",
        "facts",
        "Quot.sound, propext",
    );
    dispatch_decides_by("(answer facts)");
}

/// `HK-02`: The kernel delivers a file only for a public repository at a resolved revision whose entry exists, and names a source and an ETag exactly when it delivers
#[test]
fn kernel_hk_02() {
    pinned(
        "Delivery",
        "breaksDelivery",
        "((((Kernel::answer facts) =? (Kernel::answerRedirect)) || ((Kernel::answer facts) =? (Kernel::answerServe))) && (not ((((project facts repo) =? 0) && ((project facts revision) =? 1)) && (((project facts entry) =? 1) || ((project facts entry) =? 2)))))",
        "deliveryHolds",
        "facts",
        "Classical.choice, Quot.sound, propext",
    );
    dispatch_decides_by("(delivers facts)");
}

/// `HK-03`: The edge runner only ever redirects and the local runner only ever serves
#[test]
fn kernel_hk_03() {
    pinned(
        "Runner",
        "breaksRunner",
        "(((not ((project facts runner) =? 1)) && ((Kernel::answer facts) =? (Kernel::answerServe))) || (((project facts runner) =? 1) && ((Kernel::answer facts) =? (Kernel::answerRedirect))))",
        "runnerHolds",
        "facts",
        "Quot.sound, propext",
    );
    dispatch_decides_by("(answer facts)");
}

/// `HK-04`: The edge runner never redirects to a source that is not vetted
#[test]
fn kernel_hk_04() {
    pinned(
        "Vetted",
        "breaksVetted",
        "((not ((project facts runner) =? 1)) && ((((Kernel::select facts) =? 0) && (not ((project facts vetted0) =? 1))) || ((((Kernel::select facts) =? 1) && (not ((project facts vetted1) =? 1))) || ((((Kernel::select facts) =? 2) && (not ((project facts vetted2) =? 1))) || (((Kernel::select facts) =? 3) && (not ((project facts vetted3) =? 1)))))))",
        "vettedHolds",
        "facts",
        "Quot.sound, propext",
    );
    dispatch_decides_by("(select facts)");
}

/// `HK-05`: A delivered file always has a source, and the kernel never chooses a source that does not hold the file or that failed verification for it
#[test]
fn kernel_hk_05() {
    pinned(
        "Sourced",
        "breaksSourced",
        "((Kernel::delivers facts) && ((Kernel::select facts) =? 4))",
        "sourcedHolds",
        "facts",
        "Quot.sound, propext",
    );
    pinned(
        "Sound",
        "breaksSound",
        "((((Kernel::select facts) =? 0) && (not (((project facts holds0) =? 1) && ((project facts failed0) =? 0)))) || ((((Kernel::select facts) =? 1) && (not (((project facts holds1) =? 1) && ((project facts failed1) =? 0)))) || ((((Kernel::select facts) =? 2) && (not (((project facts holds2) =? 1) && ((project facts failed2) =? 0)))) || (((Kernel::select facts) =? 3) && (not (((project facts holds3) =? 1) && ((project facts failed3) =? 0)))))))",
        "soundHolds",
        "facts",
        "Classical.choice, Quot.sound, propext",
    );
    dispatch_decides_by("(select facts)");
}

/// `HK-06`: A pinned source is the only source the kernel may choose
#[test]
fn kernel_hk_06() {
    pinned(
        "Pin",
        "breaksPin",
        "(((0 <? (project facts pin)) && ((Kernel::select facts) <? 4)) && (not (((Kernel::select facts) + 1) =? (project facts pin))))",
        "pinHolds",
        "facts",
        "Quot.sound, propext",
    );
    dispatch_decides_by("(select facts)");
}

/// `HK-07`: Without a pin, the kernel chooses a healthy source whenever a usable one exists
#[test]
fn kernel_hk_07() {
    pinned(
        "Healthy",
        "breaksHealthy",
        "((((project facts pin) =? 0) && ((Kernel::usable0 facts) || ((Kernel::usable1 facts) || ((Kernel::usable2 facts) || (Kernel::usable3 facts))))) && (((Kernel::select facts) =? 4) || ((((Kernel::select facts) =? 0) && (not ((project facts healthy0) =? 1))) || ((((Kernel::select facts) =? 1) && (not ((project facts healthy1) =? 1))) || ((((Kernel::select facts) =? 2) && (not ((project facts healthy2) =? 1))) || (((Kernel::select facts) =? 3) && (not ((project facts healthy3) =? 1))))))))",
        "healthyHolds",
        "facts",
        "Classical.choice, Quot.sound, propext",
    );
    dispatch_decides_by("(select facts)");
}

/// `HK-08`: A delivered small file carries the git blob ETag and a delivered large file carries the SHA-256 ETag
#[test]
fn kernel_hk_08() {
    pinned(
        "Etag",
        "breaksEtag",
        "((Kernel::delivers facts) && (not ((((project facts entry) =? 1) && ((Kernel::etagKind facts) =? 1)) || (((project facts entry) =? 2) && ((Kernel::etagKind facts) =? 2)))))",
        "etagHolds",
        "facts",
        "Classical.choice, Quot.sound, propext",
    );
    dispatch_decides_by("(etagKind facts)");
}

/// `HK-09`: A commit prefix resolves only when it is 7 to 40 characters long and matches the release's commit
#[test]
fn kernel_hk_09() {
    pinned(
        "Revision",
        "breaksRevision",
        "((((kind =? 1) && ((length <? 7) || (40 <? length))) || ((kind =? 1) && (not (matched =? 1)))) && ((Kernel::revisionDecision kind refFound length matched) =? 1))",
        "revisionHolds",
        "kind refFound length matched",
        "Quot.sound, propext",
    );
    let model = read("app/src/Kernel.lex.tex");
    assert!(
        declaration(&model, "observeFacts").contains(
            "revision := (revisionDecision (byteNat value 3) (byteNat value 4) (byteNat value 5) (prefixEqual value 24 64 (byteNat value 5)))"
        ),
        "the revision fact must be decided by revisionDecision over the requested prefix and the commit"
    );
}

/// `HK-17`: An address with two witnesses is used only when they agree; where one witness alone names it the page says so, and where they disagree the file has no address
#[test]
fn kernel_hk_17() {
    pinned(
        "Concur",
        "breaksConcur",
        "(((((Kernel::concur ours theirs same) =? 1) && (((ours =? 1) && (theirs =? 1)) && (not (same =? 1)))) || (((Kernel::concur ours theirs same) =? 1) && (not ((ours =? 1) && (theirs =? 1))))) || ((((Kernel::concur ours theirs same) =? 2) && (((ours =? 1) && (theirs =? 1)) || ((not (ours =? 1)) && (not (theirs =? 1))))) || (((Kernel::concur ours theirs same) =? 0) && ((ours =? 1) || (theirs =? 1)))))",
        "concurHolds",
        "ours theirs same",
        "Classical.choice, Quot.sound, propext",
    );
    dispatch_decides_by("(encodeVerdict (concur (byteNat value 1)");
}

/// `HK-16`: Every filter the browse page offers maps to one query parameter and back, so a link carries the whole state
#[test]
fn kernel_hk_16() {
    pinned(
        "Query",
        "breaksQuery",
        "((facet <? (Site::facetCount)) && ((not ((Site::facetParam facet) <? (Site::paramCount))) || (((not (facet =? 0)) && ((Site::facetParam facet) =? 6)) || (((not (facet =? 1)) && ((Site::facetParam facet) =? 11)) || (((not (facet =? 2)) && ((Site::facetParam facet) =? 10)) || (((not (facet =? 3)) && ((Site::facetParam facet) =? 8)) || (((not (facet =? 4)) && ((Site::facetParam facet) =? 7)) || (((not (facet =? 5)) && ((Site::facetParam facet) =? 9)) || (((not (facet =? 6)) && ((Site::facetParam facet) =? 0)) || (((not (facet =? 7)) && ((Site::facetParam facet) =? 3)) || (((not (facet =? 8)) && ((Site::facetParam facet) =? 2)) || (((not (facet =? 9)) && ((Site::facetParam facet) =? 1)) || (((not (facet =? 10)) && ((Site::facetParam facet) =? 4)) || ((not (facet =? 11)) && ((Site::facetParam facet) =? 5)))))))))))))))",
        "queryHolds",
        "facet",
        "Quot.sound, propext",
    );
    dispatch_decides_by("(Site::screen (byteNat value 1))");
}

/// `HK-11`: Every header item and every link that stays in the hub opens a screen the kernel renders
#[test]
fn kernel_hk_11() {
    pinned(
        "Nav",
        "breaksNav",
        "(((item <? (Site::navCount)) && (Site::navInternal item)) && (not (Site::hasScreen (Site::navRoute item))))",
        "navHolds",
        "item",
        "Quot.sound, propext",
    );
    pinned(
        "Links",
        "breaksLinks",
        "((link <? (Site::linkCount)) && (not (Site::hasScreen (Site::linkRoute link))))",
        "linksHold",
        "link",
        "Quot.sound, propext",
    );
    dispatch_decides_by("(Site::screen (byteNat value 1))");
}

/// `HK-12`: A Hugging Face tool sees no HTTP error exactly when the kernel delivers, and every refusal reaches it as a 4xx or 5xx status with a named error code, except the refusal of a client with no token, which carries exactly the headers Hugging Face sends it
#[test]
fn kernel_hk_12() {
    pinned(
        "Dialect",
        "breaksDialect",
        "((((Site::hfStatus answer) <? 400) && (not (((answer =? 1) || (answer =? 2)) || (answer =? 20)))) || ((((answer =? 1) || (answer =? 2)) || (answer =? 20)) && (not ((Site::hfStatus answer) <? 400))))",
        "dialectHolds",
        "answer",
        "Quot.sound, propext",
    );
    pinned(
        "Errors",
        "breaksErrors",
        "((not (((answer =? 1) || (answer =? 2)) || (answer =? 20))) && ((((Site::hfStatus answer) <? 400) || (599 <? (Site::hfStatus answer))) || (((Site::hfCode answer) =? 0) && (not (answer =? 18)))))",
        "errorsHold",
        "answer",
        "Quot.sound, propext",
    );
    dispatch_decides_by("(Site::screen (byteNat value 1))");
}

/// `HK-13`: The page says Verified only when at least one source delivered and none sent other bytes, and any source that sent other bytes makes the verdict a mismatch
#[test]
fn kernel_hk_13() {
    pinned(
        "Verdict",
        "breaksVerdict",
        "((((Kernel::verdict r0 r1 r2 r3) =? 1) && ((((r0 =? 21) || (r1 =? 21)) || ((r2 =? 21) || (r3 =? 21))) || (not (((r0 =? 20) || (r1 =? 20)) || ((r2 =? 20) || (r3 =? 20)))))) || ((((r0 =? 21) || (r1 =? 21)) || ((r2 =? 21) || (r3 =? 21))) && (not (((Kernel::verdict r0 r1 r2 r3) =? 2) || ((Kernel::verdict r0 r1 r2 r3) =? 0)))))",
        "verdictHolds",
        "r0 r1 r2 r3",
        "Quot.sound, propext",
    );
    dispatch_decides_by("(encodeVerdict (verdict (byteNat value 1)");
}

/// `HK-15`: An answer is built from the index only when the record holds every field that answer names; where one is missing the source dialect is asked, and where it cannot be asked the answer says it is partial
#[test]
fn kernel_hk_15() {
    pinned(
        "Complete",
        "breaksComplete",
        "((((Kernel::complete revision siblings tags pipelineTag libraryName config cardData safetensors lastModified gated passthrough) =? 1) && (not (Kernel::recordHolds revision siblings tags pipelineTag libraryName config cardData safetensors lastModified gated))) || ((((Kernel::complete revision siblings tags pipelineTag libraryName config cardData safetensors lastModified gated passthrough) =? 2) && (not (passthrough =? 1))) || ((((Kernel::complete revision siblings tags pipelineTag libraryName config cardData safetensors lastModified gated passthrough) =? 3) && (passthrough =? 1)) || (not ((((Kernel::complete revision siblings tags pipelineTag libraryName config cardData safetensors lastModified gated passthrough) =? 1) || ((Kernel::complete revision siblings tags pipelineTag libraryName config cardData safetensors lastModified gated passthrough) =? 2)) || ((Kernel::complete revision siblings tags pipelineTag libraryName config cardData safetensors lastModified gated passthrough) =? 3))))))",
        "completeHolds",
        "revision siblings tags pipelineTag libraryName config cardData safetensors lastModified gated passthrough",
        "Classical.choice, Quot.sound, propext",
    );
    dispatch_decides_by("(encodeVerdict (complete (byteNat value 1)");
}

/// `HK-14`: A model page says Witnessed or Published only when every signature check passed, says Published only for a publisher's signature from the namespace owner, and never shows a witness's signature as a publisher's
#[test]
fn kernel_hk_14() {
    pinned(
        "Trust",
        "breaksTrust",
        "((((((Kernel::trust present chain time log signature identity subject predicate kind owner) =? 1) || ((Kernel::trust present chain time log signature identity subject predicate kind owner) =? 2)) && (not ((present =? 1) && ((chain =? 1) && ((time =? 1) && ((log =? 1) && ((signature =? 1) && ((identity =? 1) && ((subject =? 1) && (predicate =? 1)))))))))) || (((Kernel::trust present chain time log signature identity subject predicate kind owner) =? 2) && (not ((kind =? 2) && (owner =? 1))))) || ((kind =? 1) && ((Kernel::trust present chain time log signature identity subject predicate kind owner) =? 2)))",
        "trustHolds",
        "present chain time log signature identity subject predicate kind owner",
        "Classical.choice, Quot.sound, propext",
    );
    dispatch_decides_by("(encodeVerdict (trust (byteNat value 1)");
}

/// `HK-19`: A source that is not vetted is chosen only for a file whose address the record names, so bytes from an untrusted source are always checkable before they are served
#[test]
fn kernel_hk_19() {
    pinned(
        "Addressed",
        "breaksAddressed",
        "((((Kernel::select facts) =? 0) && ((not ((project facts vetted0) =? 1)) && (not ((project facts addressed) =? 1)))) || ((((Kernel::select facts) =? 1) && ((not ((project facts vetted1) =? 1)) && (not ((project facts addressed) =? 1)))) || ((((Kernel::select facts) =? 2) && ((not ((project facts vetted2) =? 1)) && (not ((project facts addressed) =? 1)))) || (((Kernel::select facts) =? 3) && ((not ((project facts vetted3) =? 1)) && (not ((project facts addressed) =? 1)))))))",
        "addressedHolds",
        "facts",
        "Quot.sound, propext",
    );
    dispatch_decides_by("(select facts)");
}

/// `HK-22`: A source nobody vetted is chosen only for a file the release itself addressed, so the party serving the bytes is never the only party that named them; what the ETag says and what the sources may serve are decided by different facts
#[test]
fn kernel_hk_22() {
    pinned(
        "Servable",
        "breaksServable",
        "((((((project facts runner) =? 1) && ((project facts addressed) =? 1)) && (((project facts holds0) =? 1) && ((project facts failed0) =? 0))) && (not (Kernel::eligible0 facts))) || ((((((project facts runner) =? 1) && ((project facts addressed) =? 1)) && (((project facts holds1) =? 1) && ((project facts failed1) =? 0))) && (not (Kernel::eligible1 facts))) || ((((((project facts runner) =? 1) && ((project facts addressed) =? 1)) && (((project facts holds2) =? 1) && ((project facts failed2) =? 0))) && (not (Kernel::eligible2 facts))) || (((((project facts runner) =? 1) && ((project facts addressed) =? 1)) && (((project facts holds3) =? 1) && ((project facts failed3) =? 0))) && (not (Kernel::eligible3 facts))))))",
        "servableHolds",
        "facts",
        "Classical.choice, Quot.sound, propext",
    );
    dispatch_decides_by("(select facts)");
}

/// `HK-10`: Received bytes are delivered exactly when their digest and size equal the expected digest and size
#[test]
fn kernel_hk_10() {
    let proofs = read("app/src/Proofs/Accepts.lex.tex");
    let decides = declaration(&proofs, "acceptsDecides");
    assert!(
        decides.contains(
            "statement: (((Kernel::accepts check) = true) <-> (Kernel::Accepts check)),"
        ) && decides.contains("parameters: [check : Kernel::Check],")
            && decides.contains("axioms: [propext]"),
        "HK-10's statement changed: accepts must be true exactly when Accepts holds, for every check:\n{decides}"
    );
    let model = read("app/src/Kernel.lex.tex");
    let accepts = declaration(&model, "Accepts");
    assert!(
        accepts.contains("((SameDigest (project check expected) (project check observed)) /\\ ((project check expectedSize) = (project check observedSize)))"),
        "Accepts must require both the digest and the size to match:\n{accepts}"
    );
    let same = declaration(&model, "SameDigest");
    for word in ["w0", "w1", "w2", "w3"] {
        assert!(
            same.contains(&format!("((project left {word}) = (project right {word}))")),
            "SameDigest must compare digest word {word}"
        );
    }
    dispatch_decides_by("accepts");
}

/// The acceptance vectors the holo carries are exactly the ones the reference
/// implementation in `app/tools/gen_kernel.py` computed.
#[test]
fn kernel_vectors_match_reference() {
    let model = read("app/src/Kernel.lex.tex");
    let vectors = read("app/tools/vectors.json");
    let mut count = 0;
    for pair in vectors.split("\"request\": \"").skip(1) {
        let request = pair.split('"').next().expect("request");
        let response = pair
            .split("\"response\": \"")
            .nth(1)
            .and_then(|r| r.split('"').next())
            .expect("response");
        let record = format!("request := 0x{request}, response := 0x{response}}}");
        assert!(
            model.contains(&record),
            "the model lacks the vector {request} -> {response}"
        );
        count += 1;
    }
    assert_eq!(
        count,
        model.matches("AcceptanceVector {request := ").count(),
        "the model carries a vector the reference did not compute"
    );
}

/// Every piece answer comes from `pieceDecision`, which checks the piece table
/// against the requested address first, then the stored piece, then the
/// received bytes, and falls back to another source only while one is left.
/// The four theorems below are about this function, so its body is fixed here.
fn piece_decision_is_fixed() {
    let model = read("app/src/Pieces.lex.tex");
    let decision = declaration(&model, "pieceDecision");
    assert!(
        decision.ends_with("  body: (if (tableHolds piece) then (if (cacheHolds piece) then (answerReuse) else (if (bytesHold piece) then (answerDeliver) else (fallback piece))) else (fallback piece))"),
        "pieceDecision changed:
{decision}"
    );
    let lexlean = read("app/lexlean.toml");
    assert!(
        lexlean.contains("\"src/Proofs/PieceVerified.lex.tex\""),
        "the piece proofs must be build entrypoints"
    );
}

/// `HK-39`: A piece of a file is delivered only when its piece table folds to the requested address and the piece matches the table entry in chaining value and length
#[test]
fn kernel_hk_39() {
    pinned(
        "PieceVerified",
        "breaksPieceVerified",
        "(((Pieces::pieceDecision piece) =? (Pieces::answerDeliver)) && (not ((Pieces::tableHolds piece) && (Pieces::bytesHold piece))))",
        "pieceVerifiedHolds",
        "piece",
        "Classical.choice, Quot.sound, propext",
    );
    piece_decision_is_fixed();
}

/// `HK-40`: A piece the local store holds is reused only when its piece table folds to the requested address and the stored piece matches the table entry
#[test]
fn kernel_hk_40() {
    pinned(
        "PieceCached",
        "breaksPieceCached",
        "(((Pieces::pieceDecision piece) =? (Pieces::answerReuse)) && (not ((Pieces::tableHolds piece) && (Pieces::cacheHolds piece))))",
        "pieceCachedHolds",
        "piece",
        "Classical.choice, Quot.sound, propext",
    );
    piece_decision_is_fixed();
}

/// `HK-41`: A stored piece that matches a piece table of the requested address is always reused and never fetched again
#[test]
fn kernel_hk_41() {
    pinned(
        "PieceReused",
        "breaksPieceReused",
        "(((Pieces::tableHolds piece) && (Pieces::cacheHolds piece)) && (not ((Pieces::pieceDecision piece) =? (Pieces::answerReuse))))",
        "pieceReusedHolds",
        "piece",
        "Classical.choice, Quot.sound, propext",
    );
    piece_decision_is_fixed();
}

/// `HK-42`: A piece is refused only when no source is left, and retried only while a source remains
#[test]
fn kernel_hk_42() {
    pinned(
        "PiecePersists",
        "breaksPiecePersists",
        "((((Pieces::pieceDecision piece) =? (Pieces::answerRefuse)) && (0 <? (project piece sourcesLeft))) || (((Pieces::pieceDecision piece) =? (Pieces::answerRetry)) && ((project piece sourcesLeft) =? 0)))",
        "piecePersistsHolds",
        "piece",
        "Quot.sound, propext",
    );
    piece_decision_is_fixed();
}

/// Every answer about whether a pulled file may be used comes from
/// `identityDecision`: a file with a BLAKE3 address is held to it alone, and a
/// file with none is minted only from bytes matching Hugging Face's SHA-256
/// for it. The five theorems below are about this function, so its body is
/// fixed here.
fn identity_decision_is_fixed() {
    let model = read("app/src/Kernel.lex.tex");
    let decision = declaration(&model, "identityDecision");
    assert!(
        decision.ends_with("  body: (if ((project pull minted) =? 1) then (if ((pullBlake3Holds pull) && ((pullSizeHolds pull) && ((project pull tensorsHold) =? 1))) then (identityServe) else (identityRefuse)) else (if ((pullNameHolds pull) && ((pullSizeHolds pull) && ((project pull tensorsHold) =? 1))) then (identityMint) else (identityRefuse)))"),
        "identityDecision changed:\n{decision}"
    );
    let axis = declaration(&model, "pullBlake3Holds");
    assert!(
        axis.ends_with("  body: (((project pull axis) =? 1) && (sameDigest (project pull observed) (project pull address)))"),
        "pullBlake3Holds changed:\n{axis}"
    );
    assert!(
        model.contains("(encodeIdentity (identityDecision (observePull value)))"),
        "dispatch must answer an identity request with identityDecision"
    );
}

/// `HK-45`: A file is served only when its bytes match its BLAKE3 address, or, for a file never addressed before, the name Hugging Face gives it (the LFS SHA-256, or a small file's git blob), at the size and with every tensor matching
#[test]
fn kernel_hk_45() {
    pinned(
        "IdentityVerified",
        "breaksIdentityVerified",
        "((((Kernel::identityDecision pull) =? (Kernel::identityServe)) || ((Kernel::identityDecision pull) =? (Kernel::identityMint))) && (not ((Kernel::pullSizeHolds pull) && (((project pull tensorsHold) =? 1) && ((((project pull minted) =? 1) && (Kernel::pullBlake3Holds pull)) || ((not ((project pull minted) =? 1)) && (Kernel::pullNameHolds pull)))))))",
        "identityVerifiedHolds",
        "pull",
        "Classical.choice, Quot.sound, propext",
    );
    identity_decision_is_fixed();
}

/// `HK-46`: Once a file has a BLAKE3 address, bytes that do not match it are refused whatever Hugging Face's own name for the file says
#[test]
fn kernel_hk_46() {
    pinned(
        "IdentityDecides",
        "breaksIdentityDecides",
        "((((project pull minted) =? 1) && (not (Kernel::pullBlake3Holds pull))) && (not ((Kernel::identityDecision pull) =? (Kernel::identityRefuse))))",
        "identityDecidesHolds",
        "pull",
        "Classical.choice, Quot.sound, propext",
    );
    identity_decision_is_fixed();
}

/// `HK-47`: A BLAKE3 address is minted only for a file that has none, never over an existing one
#[test]
fn kernel_hk_47() {
    pinned(
        "IdentityMintOnce",
        "breaksIdentityMintOnce",
        "(((Kernel::identityDecision pull) =? (Kernel::identityMint)) && ((project pull minted) =? 1))",
        "identityMintOnceHolds",
        "pull",
        "Classical.choice, Quot.sound, propext",
    );
    identity_decision_is_fixed();
}

/// `HK-48`: A file with an address is served only on the BLAKE3 axis
#[test]
fn kernel_hk_48() {
    pinned(
        "IdentityAxis",
        "breaksIdentityAxis",
        "(((Kernel::identityDecision pull) =? (Kernel::identityServe)) && (not ((project pull axis) =? 1)))",
        "identityAxisHolds",
        "pull",
        "Classical.choice, Quot.sound, propext",
    );
    identity_decision_is_fixed();
}

/// `HK-49`: A file is served or minted only when every tensor it declares matches its address
#[test]
fn kernel_hk_49() {
    pinned(
        "IdentityTensors",
        "breaksIdentityTensors",
        "((((Kernel::identityDecision pull) =? (Kernel::identityServe)) || ((Kernel::identityDecision pull) =? (Kernel::identityMint))) && (not ((project pull tensorsHold) =? 1)))",
        "identityTensorsHolds",
        "pull",
        "Classical.choice, Quot.sound, propext",
    );
    identity_decision_is_fixed();
}
