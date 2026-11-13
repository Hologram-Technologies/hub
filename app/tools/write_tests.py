"""Writes crates/conformance/tests/kernel.rs and features/suites/kernel.feature.

The tests pin the exact text of each claim as it stands when this is run; after
that they are hand-owned and a changed model fails them until a person agrees.
"""
import re
import sys

ROOT = sys.argv[1]


def body(module, name):
    text = open(ROOT + "/app/src/Proofs/%s.lex.tex" % module, encoding="utf-8").read()
    m = re.search(r"\n  name: %s,\n.*?\n  body: (.*?)\n}\n" % name, text, re.S)
    return m.group(1)


# id, statement, [(module, breaks, theorem, arguments)], what the plan is decided by
CASES = [
    ("HK-01", "A missing repository and a private repository get the same answer: repository not found, with no source and no ETag",
     [("Privacy", "breaksPrivacy", "privacyHolds", "facts")], "(answer facts)"),
    ("HK-02", "The kernel delivers a file only for a public repository at a resolved revision whose entry exists, and names a source and an ETag exactly when it delivers",
     [("Delivery", "breaksDelivery", "deliveryHolds", "facts")], "(delivers facts)"),
    ("HK-03", "The edge runner only ever redirects and the local runner only ever serves",
     [("Runner", "breaksRunner", "runnerHolds", "facts")], "(answer facts)"),
    ("HK-04", "The edge runner never redirects to a source that is not vetted",
     [("Vetted", "breaksVetted", "vettedHolds", "facts")], "(select facts)"),
    ("HK-05", "A delivered file always has a source, and the kernel never chooses a source that does not hold the file or that failed verification for it",
     [("Sourced", "breaksSourced", "sourcedHolds", "facts"), ("Sound", "breaksSound", "soundHolds", "facts")], "(select facts)"),
    ("HK-06", "A pinned source is the only source the kernel may choose",
     [("Pin", "breaksPin", "pinHolds", "facts")], "(select facts)"),
    ("HK-07", "Without a pin, the kernel chooses a healthy source whenever a usable one exists",
     [("Healthy", "breaksHealthy", "healthyHolds", "facts")], "(select facts)"),
    ("HK-08", "A delivered small file carries the git blob ETag and a delivered large file carries the SHA-256 ETag",
     [("Etag", "breaksEtag", "etagHolds", "facts")], "(etagKind facts)"),
    ("HK-09", "A commit prefix resolves only when it is 7 to 40 characters long and matches the release's commit",
     [("Revision", "breaksRevision", "revisionHolds", "kind refFound length matched")], None),
    ("HK-11", "Every header item and every link that stays in the hub opens a screen the kernel renders",
     [("Nav", "breaksNav", "navHolds", "item"), ("Links", "breaksLinks", "linksHold", "link")],
     "(Site::screen (byteNat value 1))"),
    ("HK-12", "A Hugging Face tool sees no HTTP error exactly when the kernel delivers, and every refusal reaches it as a 4xx or 5xx status with a named error code",
     [("Dialect", "breaksDialect", "dialectHolds", "answer"), ("Errors", "breaksErrors", "errorsHold", "answer")],
     "(Site::screen (byteNat value 1))"),
    ("HK-13", "The page says Verified only when at least one source delivered and none sent other bytes, and any source that sent other bytes makes the verdict a mismatch",
     [("Verdict", "breaksVerdict", "verdictHolds", "r0 r1 r2 r3")],
     "(encodeVerdict (verdict (byteNat value 1)"),
    ("HK-15", "An answer is built from the index only when the record holds every field that answer names; where one is missing the source dialect is asked, and where it cannot be asked the answer says it is partial",
     [("Complete", "breaksComplete", "completeHolds", "revision siblings tags pipelineTag libraryName config cardData safetensors lastModified gated passthrough")],
     "(encodeVerdict (complete (byteNat value 1)"),
    ("HK-14", "A model page says Witnessed or Published only when every signature check passed, says Published only for a publisher's signature from the namespace owner, and never shows a witness's signature as a publisher's",
     [("Trust", "breaksTrust", "trustHolds", "present chain time log signature identity subject predicate kind owner")],
     "(encodeVerdict (trust (byteNat value 1)"),
]
HK10 = "Received bytes are delivered exactly when their digest and size equal the expected digest and size"

HEADER = r'''//! The `kernel` suite: one test per scenario in `features/suites/kernel.feature`.
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
fn pinned(module: &str, breaks: &str, condition: &str, theorem: &str, arguments: &str, axioms: &str) {
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
            && dispatch
                .contains("(if (accepts (observeCheck value)) then 0x140400 else 0x150400)"),
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
'''


def axioms(module):
    text = open(ROOT + "/app/src/Proofs/%s.lex.tex" % module, encoding="utf-8").read()
    return re.search(r"axioms: \[(.*?)\]\n}", text).group(1)


def rust_str(s):
    return s.replace("\\", "\\\\").replace('"', '\\"')


parts = [HEADER]
for ident, statement, theorems, decider in CASES:
    fn = "kernel_" + ident.lower().replace("-", "_")
    calls = "".join(
        '    pinned(\n        "%s",\n        "%s",\n        "%s",\n        "%s",\n        "%s",\n        "%s",\n    );\n'
        % (module, breaks, rust_str(body(module, breaks)), theorem, args, axioms(module))
        for module, breaks, theorem, args in theorems)
    if decider:
        extra = '    dispatch_decides_by("%s");\n' % decider
    else:
        extra = (
            '    let model = read("app/src/Kernel.lex.tex");\n'
            '    assert!(\n'
            '        declaration(&model, "observeFacts").contains(\n'
            '            "revision := (revisionDecision (byteNat value 3) (byteNat value 4) (byteNat value 5) (prefixEqual value 24 64 (byteNat value 5)))"\n'
            '        ),\n'
            '        "the revision fact must be decided by revisionDecision over the requested prefix and the commit"\n'
            '    );\n'
        )
    parts.append('\n/// `%s`: %s\n#[test]\nfn %s() {\n%s%s}\n' % (ident, statement, fn, calls, extra))

parts.append(r'''
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
''')
with open(ROOT + "/crates/conformance/tests/kernel.rs", "w", encoding="utf-8", newline="\n") as f:
    f.write("".join(parts))

# scenarios
feat = ["Feature: kernel", "",
        "  The hub kernel, in app/: from the facts a runner gathered about one file",
        "  request, it decides the answer, the source and the ETag kind; given an expected",
        "  and an observed digest and size, it decides whether received bytes may be",
        "  delivered. Every claim below is a theorem Lean proves for every input.", ""]
for ident, statement, theorems, _ in CASES:
    feat += ["  @%s @build" % ident, "  Scenario: %s" % statement, "    Given the kernel model in app/src/Kernel.lex.tex"]
    for i, (module, breaks, theorem, _) in enumerate(theorems):
        feat.append("    %s the Lean kernel checks %s in app/src/Proofs/%s.lex.tex during prismpm verify"
                    % ("When" if i == 0 else "And", theorem, module))
    for i, (module, breaks, theorem, _) in enumerate(theorems):
        feat.append("    %s no input meets %s" % ("Then" if i == 0 else "And", breaks))
    feat.append("")
feat += ["  @HK-10 @build", "  Scenario: %s" % HK10, "    Given the kernel model in app/src/Kernel.lex.tex",
         "    When the Lean kernel checks acceptsDecides in app/src/Proofs/Accepts.lex.tex during prismpm verify",
         "    Then accepts is true exactly when Accepts holds"]
with open(ROOT + "/features/suites/kernel.feature", "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(feat) + "\n")

# register statements
ids = open(ROOT + "/model/ids.toml", encoding="utf-8").read()
for ident, statement, _, _ in CASES:
    ids = re.sub(r'(id = "%s"\nlevel = "build"\nsuite = "kernel"\nstatement = ")[^"]*(")' % ident,
                 lambda m: m.group(1) + statement + m.group(2), ids)
ids = ids.replace("theorem Lean proves in `app/src/KernelProofs.lex.tex`.",
                  "theorem Lean proves in `app/src/Proofs/`.")
with open(ROOT + "/model/ids.toml", "w", encoding="utf-8", newline="\n") as f:
    f.write(ids)
