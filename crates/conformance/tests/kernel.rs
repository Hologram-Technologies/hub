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

/// `HK-12`: A Hugging Face tool sees no HTTP error exactly when the kernel delivers, and every refusal reaches it as a 4xx or 5xx status with a named error code
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
        "((not (((answer =? 1) || (answer =? 2)) || (answer =? 20))) && ((((Site::hfStatus answer) <? 400) || (599 <? (Site::hfStatus answer))) || ((Site::hfCode answer) =? 0)))",
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
