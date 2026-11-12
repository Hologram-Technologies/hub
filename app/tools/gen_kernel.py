"""Writes app/src/Kernel.lex.tex and app/src/KernelProofs.lex.tex.

The kernel is easier to read and change as this table-driven generator than as
two thousand lines of LexLean; the generated modules are the authority, and
`lexlean fmt --check` fails if they are edited by hand without rerunning this.
The acceptance vectors are computed by the reference implementation below, an
independent second reading of the same rules, so a vector disagreeing with the
compiled guest is caught by `prismpm verify`.

Usage: python app/tools/gen_kernel.py
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "src")
PREFIX = "HologramHubKernel"

# Request layout, operation 1 (resolve), exactly 104 bytes:
#   0 op=1 | 1 runner (0 edge, 1 local) | 2 repo state | 3 revision kind
#   4 named ref found | 5 revision length | 6 entry (0 missing, 1 small, 2 large)
#   7 pin (0 none, 1..4 source slot) | 8..23 four sources x (holds, healthy, vetted, failed)
#   24..63 revision bytes as requested | 64..103 the release's 40-hex commit
# Request layout, operation 2 (accept), exactly 81 bytes:
#   0 op=2 | 1..32 expected digest | 33..64 observed digest
#   65..72 expected size (u64 BE) | 73..80 observed size (u64 BE)
# Response, always 3 bytes: answer code | source slot (4 = none) | etag kind.

ANSWERS = [
    ("answerInvalid", 0),
    ("answerRedirect", 1),
    ("answerServe", 2),
    ("answerRepoNotFound", 10),
    ("answerRevisionNotFound", 11),
    ("answerEntryNotFound", 12),
    ("answerGatedRepo", 13),
    ("answerDisabledRepo", 14),
    ("answerUnknownSource", 15),
    ("answerSourceLacksFile", 16),
    ("answerNoSource", 17),
    ("answerDeliver", 20),
    ("answerQuarantine", 21),
]
SOURCE_FIELDS = ("holds", "healthy", "vetted", "failed")
FIELDS = ["runner", "repo", "revision", "entry", "pin"] + [
    k + str(i) for i in range(4) for k in SOURCE_FIELDS
]


# ---------------------------------------------------------------- reference
def ref_eligible(runner, holds, vetted, failed):
    return holds == 1 and failed == 0 and (runner == 1 or vetted == 1)


def ref_select(f):
    el = [
        ref_eligible(f["runner"], f["holds%d" % i], f["vetted%d" % i], f["failed%d" % i])
        for i in range(4)
    ]
    us = [el[i] and f["healthy%d" % i] == 1 for i in range(4)]
    if f["pin"] == 0:
        for i in range(4):
            if us[i]:
                return i
        for i in range(4):
            if el[i]:
                return i
        return 4
    if 1 <= f["pin"] <= 4:
        return f["pin"] - 1 if el[f["pin"] - 1] else 4
    return 4


def ref_answer(f):
    if f["repo"] in (1, 2):
        return 10
    if f["repo"] == 3:
        return 13
    if f["repo"] == 4:
        return 14
    if f["repo"] != 0:
        return 0
    if f["revision"] != 1:
        return 11
    if f["entry"] == 0:
        return 12
    if f["entry"] not in (1, 2):
        return 0
    if f["pin"] > 4:
        return 15
    if f["pin"] != 0 and f["holds%d" % (f["pin"] - 1)] != 1:
        return 16
    if ref_select(f) == 4:
        return 17
    return 2 if f["runner"] == 1 else 1


def ref_revision(kind, ref_found, length, matched):
    if kind == 0:
        return 1 if ref_found == 1 else 0
    if kind == 1:
        if length < 7 or length > 40:
            return 0
        return 1 if matched == 1 else 0
    return 0


def ref_dispatch(b):
    if len(b) == 104 and b[0] == 1:
        ln = b[5]
        matched = 1
        for i in range(ln):
            if 24 + i >= len(b) or 64 + i >= len(b) or b[24 + i] != b[64 + i]:
                matched = 0
                break
        f = dict(
            runner=b[1],
            repo=b[2],
            revision=ref_revision(b[3], b[4], ln, matched),
            entry=b[6],
            pin=b[7],
        )
        for i in range(4):
            for j, k in enumerate(SOURCE_FIELDS):
                f[k + str(i)] = b[8 + 4 * i + j]
        a = ref_answer(f)
        d = a in (1, 2)
        slot = ref_select(f) if d else 4
        etag = (1 if f["entry"] == 1 else 2) if d else 0
        return bytes([a, slot, etag])
    if len(b) == 81 and b[0] == 2:
        ok = b[1:33] == b[33:65] and b[65:73] == b[73:81]
        return bytes([20 if ok else 21, 4, 0])
    return bytes([0, 4, 0])


# ------------------------------------------------------------------ vectors
COMMIT = b"607a30d783dfa663caf39e06633721c8d4cfcd7e"
GOOD = (1, 1, 1, 0)
NONE = (0, 0, 0, 0)


def resolve(runner=0, repo=0, kind=0, ref=1, ln=0, entry=2, pin=0,
            src=(GOOD, NONE, NONE, NONE), rev=b"", commit=COMMIT):
    b = bytearray(104)
    b[0:8] = bytes([1, runner, repo, kind, ref, ln, entry, pin])
    for i, s in enumerate(src):
        b[8 + 4 * i:12 + 4 * i] = bytes(s)
    b[24:24 + len(rev)] = rev
    b[64:104] = commit
    return bytes(b)


D1 = bytes.fromhex("248dfc3911869ec493c76e65bf2fcf7f615828b0254c12b473182f0f81d3a707")
D2 = bytes.fromhex("248dfc3911869ec493c76e65bf2fcf7f615828b0254c12b473182f0f81d3a706")


def accept(e, o, es, os_):
    return bytes([2]) + e + o + es.to_bytes(8, "big") + os_.to_bytes(8, "big")


VECTORS = [
    resolve(entry=1),
    resolve(entry=2),
    resolve(runner=1, src=((1, 1, 0, 0), NONE, NONE, NONE)),
    resolve(src=((1, 1, 0, 0), GOOD, NONE, NONE)),
    resolve(src=((1, 1, 1, 1), (1, 0, 1, 0), NONE, NONE)),
    resolve(src=((1, 0, 1, 0), NONE, GOOD, NONE)),
    resolve(repo=1),
    resolve(repo=2),
    resolve(repo=3),
    resolve(repo=4),
    resolve(ref=0),
    resolve(kind=1, ref=0, ln=7, rev=COMMIT[:7]),
    resolve(kind=1, ref=0, ln=6, rev=COMMIT[:6]),
    resolve(kind=1, ref=0, ln=40, rev=COMMIT[:39] + b"f"),
    resolve(kind=1, ref=0, ln=40, rev=COMMIT),
    resolve(entry=0),
    resolve(pin=2, src=(GOOD, GOOD, NONE, NONE)),
    resolve(pin=2),
    resolve(pin=5),
    resolve(pin=1, src=((1, 1, 1, 1), GOOD, NONE, NONE)),
    resolve(src=(NONE, NONE, NONE, NONE)),
    resolve(src=((1, 1, 0, 0), NONE, NONE, NONE)),
    resolve(repo=9),
    resolve(entry=3),
    accept(D1, D1, 548105171, 548105171),
    accept(D1, D2, 548105171, 548105171),
    accept(D1, D1, 548105171, 548105170),
    resolve()[:103],
    resolve() + b"\x00",
    b"",
    bytes([3]) + resolve()[1:],
    bytes([1]) + accept(D1, D1, 1, 1)[1:],
    bytes(128),
]
assert len(set(VECTORS)) == len(VECTORS), "requests must be unique"
assert max(len(v) for v in VECTORS) == 128, "one request is exactly guestAllocationMaximum bytes"
EXPECTED = [ref_dispatch(v) for v in VECTORS]


# -------------------------------------------------------------- model text
AX = ["Quot.sound", "propext"]
T = "Foundation.View.Text.V1.Model::"
HEAD = (
    "\\useglossary{lexlean.std.bool@1.2.0}\n"
    "\\useglossary{lexlean.std.nat@1.2.0}\n"
    "\\useglossary{prism.arch@1.0.0}\n"
)


def hx(b):
    return "0x" + b.hex()


def pf(name):
    return "(project facts %s)" % name


def chain(cases, default):
    out = default
    for cond, value in reversed(cases):
        out = "(if %s then %s else %s)" % (cond, value, out)
    return out


def nest(op, xs):
    out = xs[-1]
    for x in reversed(xs[:-1]):
        out = "(%s %s %s)" % (x, op, out)
    return out


def defn(name, params, result, body, axioms=None, rec=None):
    s = "definition{\n  name: %s,\n  parameters: [%s],\n  result: %s,\n  body: %s" % (
        name, params, result, body)
    if axioms:
        s += ",\n  axioms: [%s]" % ", ".join(axioms)
    if rec:
        s += ",\n  recursive_argument: %s" % rec
    return s + "\n}\n"


def structure(name, fields):
    rows = ",\n".join("    {name: %s, type: %s}" % f for f in fields)
    return "structure{\n  name: %s,\n  type_parameters: [],\n  parameters: [],\n  fields: [\n%s\n  ]\n}\n" % (name, rows)


def kernel_module():
    k = []
    for n, v in ANSWERS:
        k.append("definition{name: %s, parameters: [], result: Nat, body: %d}\n" % (n, v))
    k.append(structure("Facts", [(f, "Nat") for f in FIELDS]))
    k.append(structure("Digest", [("w%d" % i, "Nat") for i in range(4)]))
    k.append(structure("Check", [("expected", "Digest"), ("observed", "Digest"),
                                 ("expectedSize", "Nat"), ("observedSize", "Nat")]))
    k.append(defn("eligible", "runner : Nat, holds : Nat, vetted : Nat, failed : Nat", "Bool",
                  "(((holds =? 1) && (failed =? 0)) && ((runner =? 1) || (vetted =? 1)))"))
    for i in range(4):
        k.append(defn("eligible%d" % i, "facts : Facts", "Bool", "(eligible %s %s %s %s)" % (
            pf("runner"), pf("holds%d" % i), pf("vetted%d" % i), pf("failed%d" % i))))
    for i in range(4):
        k.append(defn("usable%d" % i, "facts : Facts", "Bool",
                      "((eligible%d facts) && (%s =? 1))" % (i, pf("healthy%d" % i))))
    k.append(defn("selectFree", "facts : Facts", "Nat", chain(
        [("(usable%d facts)" % i, str(i)) for i in range(4)]
        + [("(eligible%d facts)" % i, str(i)) for i in range(4)], "4")))
    k.append(defn("selectPinned", "facts : Facts", "Nat", chain(
        [("(%s =? %d)" % (pf("pin"), i + 1), "(if (eligible%d facts) then %d else 4)" % (i, i))
         for i in range(4)], "4")))
    k.append(defn("select", "facts : Facts", "Nat",
                  "(if (%s =? 0) then (selectFree facts) else (selectPinned facts))" % pf("pin")))
    # Every condition below is a flat Boolean formula over the facts: Lean's
    # `linear_arithmetic` splits an `if` in the goal but not an `if` buried in
    # another `if`'s condition, so no decision tests the result of `select`.
    k.append(defn("pinnedHolds", "facts : Facts", "Bool", nest("||", [
        "((%s =? %d) && (%s =? 1))" % (pf("pin"), i + 1, pf("holds%d" % i)) for i in range(4)])))
    # Every `if` condition is positive: `omega` loses a negated fact that an
    # `if` condition introduces, so the happy path nests in the `then` branches.
    # `answer` tests `select` as a whole: a proof about the answer leaves it
    # folded, and `omega` reads it as one number, so no proof has to carry both
    # decision chains at once (Lean's `split` runs out of `simp` steps if it does).
    found = "(if ((select facts) =? 4) then (answerNoSource) else (if (%s =? 1) then (answerServe) else (answerRedirect)))" % pf("runner")
    sourced = chain([
        ("(4 <? %s)" % pf("pin"), "(answerUnknownSource)"),
        ("(%s =? 0)" % pf("pin"), found),
        ("(pinnedHolds facts)", found),
    ], "(answerSourceLacksFile)")
    exists = chain([
        ("(%s =? 0)" % pf("entry"), "(answerEntryNotFound)"),
        ("((%s =? 1) || (%s =? 2))" % (pf("entry"), pf("entry")), sourced),
    ], "(answerInvalid)")
    resolved = "(if (%s =? 1) then %s else (answerRevisionNotFound))" % (pf("revision"), exists)
    k.append(defn("answer", "facts : Facts", "Nat", chain([
        ("((%s =? 1) || (%s =? 2))" % (pf("repo"), pf("repo")), "(answerRepoNotFound)"),
        ("(%s =? 3)" % pf("repo"), "(answerGatedRepo)"),
        ("(%s =? 4)" % pf("repo"), "(answerDisabledRepo)"),
        ("(%s =? 0)" % pf("repo"), resolved),
    ], "(answerInvalid)")))
    # Delivering means the answer is a redirect or a serve, by definition, so
    # `plan` names a source and an ETag exactly when the answer delivers.
    k.append(defn("delivers", "facts : Facts", "Bool",
                  "(((answer facts) =? (answerRedirect)) || ((answer facts) =? (answerServe)))"))
    k.append(defn("etagKind", "facts : Facts", "Nat", "(if (%s =? 1) then 1 else 2)" % pf("entry")))
    k.append(defn("revisionDecision", "kind : Nat, refFound : Nat, length : Nat, matched : Nat", "Nat",
                  "(if (kind =? 0) then (if (refFound =? 1) then 1 else 0) else (if (kind =? 1) then "
                  "(if (length <? 7) then 0 else (if (40 <? length) then 0 else (if (matched =? 1) then 1 else 0))) else 0))"))
    k.append(defn("sameDigest", "left : Digest, right : Digest", "Bool", nest("&&", [
        "((project left w%d) =? (project right w%d))" % (i, i) for i in range(4)])))
    k.append(defn("SameDigest", "left : Digest, right : Digest", "Prop", nest("/\\", [
        "((project left w%d) = (project right w%d))" % (i, i) for i in range(4)])))
    k.append(defn("accepts", "check : Check", "Bool",
                  "((sameDigest (project check expected) (project check observed)) && "
                  "((project check expectedSize) =? (project check observedSize)))"))
    k.append(defn("Accepts", "check : Check", "Prop",
                  "((SameDigest (project check expected) (project check observed)) /\\ "
                  "((project check expectedSize) = (project check observedSize)))"))
    k.append(defn("byteNat", "value : Bytes, offset : Nat", "Nat",
                  "(match (Foundation.Bytes::byteAt value offset)\n    | Option.none => 255\n"
                  "    | Option.some byte => (prim to_nat byte : Nat))", AX))
    k.append(defn("natFrom", "value : Bytes, offset : Nat, remaining : Nat, accumulated : Nat", "Nat",
                  "(match remaining\n    | Nat.zero => accumulated\n    | Nat.succ rest => "
                  "(match (Foundation.Bytes::byteAt value offset)\n      | Option.none => accumulated\n"
                  "      | Option.some byte => (natFrom value (offset + 1) rest "
                  "((prim multiply accumulated 256 : Nat) + (prim to_nat byte : Nat)))))", AX, "remaining"))
    k.append(defn("prefixEqual", "value : Bytes, left : Nat, right : Nat, remaining : Nat", "Nat",
                  "(match remaining\n    | Nat.zero => 1\n    | Nat.succ rest => "
                  "(if ((byteNat value left) =? (byteNat value right)) then "
                  "(prefixEqual value (left + 1) (right + 1) rest) else 0))", AX, "remaining"))
    k.append(defn("digestAt", "value : Bytes, offset : Nat", "Digest",
                  "(record Digest {%s})" % ", ".join(
                      "w%d := (natFrom value %s 8 0)" % (i, "offset" if i == 0 else "(offset + %d)" % (8 * i))
                      for i in range(4)), AX))
    k.append(defn("observeCheck", "value : Bytes", "Check",
                  "(record Check {expected := (digestAt value 1), observed := (digestAt value 33), "
                  "expectedSize := (natFrom value 65 8 0), observedSize := (natFrom value 73 8 0)})", AX))
    obs = [
        "runner := (byteNat value 1)",
        "repo := (byteNat value 2)",
        "revision := (revisionDecision (byteNat value 3) (byteNat value 4) (byteNat value 5) "
        "(prefixEqual value 24 64 (byteNat value 5)))",
        "entry := (byteNat value 6)",
        "pin := (byteNat value 7)",
    ]
    o = 8
    for i in range(4):
        for f in SOURCE_FIELDS:
            obs.append("%s%d := (byteNat value %d)" % (f, i, o))
            o += 1
    k.append(defn("observeFacts", "value : Bytes", "Facts", "(record Facts {%s})" % ", ".join(obs), AX))
    k.append(defn("encodeAnswer", "code : Nat", "Bytes", chain(
        [("(code =? (%s))" % n, hx(bytes([v]))) for n, v in ANSWERS[1:]], "0x00")))
    k.append(defn("encodeSlot", "index : Nat", "Bytes", chain(
        [("(index =? %d)" % i, hx(bytes([i]))) for i in range(4)], "0x04")))
    k.append(defn("encodeEtag", "kind : Nat", "Bytes", chain(
        [("(kind =? 1)", "0x01"), ("(kind =? 2)", "0x02")], "0x00")))
    # A source and an ETag are named only when the file is delivered, so every
    # refusal is the answer byte followed by `04 00`, whatever the sources hold.
    k.append(defn("plan", "facts : Facts", "Bytes",
                  "(if (delivers facts) then (prim append (encodeAnswer (answer facts)) "
                  "(prim append (encodeSlot (select facts)) (encodeEtag (etagKind facts)) : Bytes) : Bytes) "
                  "else (prim append (encodeAnswer (answer facts)) 0x0400 : Bytes))"))
    k.append(defn("dispatch", "value : Bytes", "Bytes",
                  "(if (((Foundation.Bytes::byteLength value) =? 104) && ((byteNat value 0) =? 1)) then "
                  "(plan (observeFacts value)) else (if (((Foundation.Bytes::byteLength value) =? 81) && "
                  "((byteNat value 0) =? 2)) then (if (accepts (observeCheck value)) then 0x140400 else 0x150400) "
                  "else 0x000400))", AX))
    vec = "(nil %sAcceptanceVector)" % T
    for r, e in reversed(list(zip(VECTORS, EXPECTED))):
        vec = "(cons (record %sAcceptanceVector {request := %s, response := %s}) %s)" % (T, hx(r), hx(e), vec)
    app = (
        '(record %sTextApplication {profile := "prismpm/text-application/1", name := "Hub kernel", '
        'cargoName := "hologram-hub-kernel", cargoVersion := "0.1.0", '
        'cargoDescription := "Decides how a model hub answers one file request and whether received bytes may be delivered.", '
        'cargoRepository := "https://github.com/Hologram-Technologies/hub", '
        'cargoHomepage := "https://github.com/Hologram-Technologies/hub", '
        'libraryRoots := (cons "%s.Kernel.dispatch" (nil String)), acceptanceVectors := %s, '
        'entryRoot := "%s.Kernel.dispatch", coreContract := "hologram:guest/core-wasm@1", '
        'requestMaximum := (104 : UInt32), responseMaximum := (16 : UInt32), guestAllocationMaximum := (128 : UInt32), '
        'capabilitiesEmpty := true, fatArchive := true, primaryLayer := (0 : UInt8), viewLayer := (1 : UInt8), '
        'view := (record %sTextView {title := "Hub kernel", heading := "Hub kernel", inputLabel := "Request facts", '
        'submitLabel := "Decide", outputLabel := "Plan", inputError := "Invalid request", '
        'responseError := "Invalid response"})})' % (T, PREFIX, vec, PREFIX, T))
    k.append(defn("application", "", "%sTextApplication" % T, app))
    return ("\\begin{lexlean}{Kernel}\n" + HEAD
            + "\\importmodule{Foundation.Bytes}\n\\importmodule{Foundation.View.Text.V1.Model}\n"
            + "\\title{Text application model}\n\\begin{semanticmodule}\n"
            + "\n".join(k) + "\\end{semanticmodule}\n\\end{lexlean}\n")


# ------------------------------------------------------------------ proofs
def q(n):
    return "Kernel::" + n


def kf(n):
    return "(project facts %s)" % n


ANSWER_NAMES = [q(n) for n, _ in ANSWERS]
SELECT_DEFS = ([q("eligible%d" % i) for i in range(4)] + [q("eligible")]
               + [q("usable%d" % i) for i in range(4)]
               + [q("select"), q("selectFree"), q("selectPinned")])
ELIGIBLE_DEFS = [q("eligible%d" % i) for i in range(4)] + [q("eligible")]
# `select` and `pinnedHolds` stay folded in proofs about the answer.
ANSWER_DEFS = ANSWER_NAMES + [q("answer")]
DELIVERS_DEFS = ANSWER_DEFS + [q("delivers")]
ANSWER_DELIVERS = "(((Kernel::answer facts) =? (Kernel::answerRedirect)) || ((Kernel::answer facts) =? (Kernel::answerServe)))"
FACTS = "facts : Kernel::Facts"

# (module, breaks, holds, parameters, arguments, the condition no input may
# meet, definitions). One module per theorem, so a proof Lean rejects is named
# by its module, and no theorem unfolds more than its claim is about.
INVARIANTS = [
    # Missing and private repositories get the same answer and never deliver,
    # so `plan` answers both with the same three bytes.
    ("Privacy", "breaksPrivacy", "privacyHolds", FACTS, "facts",
     "(((%s =? 1) || (%s =? 2)) && ((not ((Kernel::answer facts) =? (Kernel::answerRepoNotFound))) || "
     "(Kernel::delivers facts)))" % (kf("repo"), kf("repo")), DELIVERS_DEFS),
    ("Delivery", "breaksDelivery", "deliveryHolds", FACTS, "facts",
     # Stated over the answer itself, which `delivers` is by definition.
     "(%s && (not (((%s =? 0) && (%s =? 1)) && ((%s =? 1) || (%s =? 2)))))"
     % (ANSWER_DELIVERS, kf("repo"), kf("revision"), kf("entry"), kf("entry")), ANSWER_DEFS),
    ("Runner", "breaksRunner", "runnerHolds", FACTS, "facts",
     "(((not (%s =? 1)) && ((Kernel::answer facts) =? (Kernel::answerServe))) || "
     "((%s =? 1) && ((Kernel::answer facts) =? (Kernel::answerRedirect))))" % (kf("runner"), kf("runner")),
     ANSWER_DEFS),
    ("Vetted", "breaksVetted", "vettedHolds", FACTS, "facts",
     "((not (%s =? 1)) && %s)" % (kf("runner"), nest("||", [
         "(((Kernel::select facts) =? %d) && (not (%s =? 1)))" % (i, kf("vetted%d" % i)) for i in range(4)])),
     SELECT_DEFS),
    # A delivered file always has a source ...
    ("Sourced", "breaksSourced", "sourcedHolds", FACTS, "facts",
     "((Kernel::delivers facts) && ((Kernel::select facts) =? 4))", DELIVERS_DEFS),
    # ... and the chosen source holds it and has not failed verification for it.
    ("Sound", "breaksSound", "soundHolds", FACTS, "facts", nest("||", [
        "(((Kernel::select facts) =? %d) && (not ((%s =? 1) && (%s =? 0))))" % (i, kf("holds%d" % i), kf("failed%d" % i))
        for i in range(4)]), SELECT_DEFS),
    ("Pin", "breaksPin", "pinHolds", FACTS, "facts",
     "(((0 <? %s) && ((Kernel::select facts) <? 4)) && (not (((Kernel::select facts) + 1) =? %s)))"
     % (kf("pin"), kf("pin")), SELECT_DEFS),
    ("Healthy", "breaksHealthy", "healthyHolds", FACTS, "facts",
     "(((%s =? 0) && %s) && %s)" % (
         kf("pin"),
         nest("||", ["(Kernel::usable%d facts)" % i for i in range(4)]),
         nest("||", ["((Kernel::select facts) =? 4)"] + [
             "(((Kernel::select facts) =? %d) && (not (%s =? 1)))" % (i, kf("healthy%d" % i)) for i in range(4)])),
     SELECT_DEFS),
    ("Etag", "breaksEtag", "etagHolds", FACTS, "facts",
     "((Kernel::delivers facts) && (not (((%s =? 1) && ((Kernel::etagKind facts) =? 1)) || "
     "((%s =? 2) && ((Kernel::etagKind facts) =? 2)))))" % (kf("entry"), kf("entry")),
     DELIVERS_DEFS + [q("etagKind")]),
    ("Revision", "breaksRevision", "revisionHolds", "kind : Nat, refFound : Nat, length : Nat, matched : Nat",
     "kind refFound length matched",
     "((((kind =? 1) && ((length <? 7) || (40 <? length))) || ((kind =? 1) && (not (matched =? 1)))) && "
     "((Kernel::revisionDecision kind refFound length matched) =? 1))", [q("revisionDecision")]),
]


def theorem(name, params, statement, form, defs, axioms):
    # The two forms order differently (lexlean `ir/semantic.rs`): `simplify`
    # compares (module, name) with no module first, so Lean's own bridges such
    # as `Bool.and_eq_true` lead; `linear_arithmetic` compares the spelled key.
    if form == "simplify":
        key = lambda d: ("::" in d, d.split("::")[0] if "::" in d else "", d.split("::")[-1])
    else:
        key = lambda d: d
    ordered = sorted(set(defs), key=key)
    # `lexlean fmt` keeps a proof on one line when it fits in 100 columns.
    proof = "  proof: %s{definitions: [%s]}," % (form, ", ".join(ordered))
    if len(proof) > 100:
        rows = ",\n".join("      " + d for d in ordered)
        proof = "  proof: %s{\n    definitions: [\n%s\n    ]\n  }," % (form, rows)
    return ("theorem{\n  name: %s,\n  parameters: [%s],\n  statement: %s,\n%s\n"
            "  axioms: [%s]\n}\n" % (name, params, statement, proof, ", ".join(axioms)))


def proof_module(name, declarations):
    return ("\\begin{lexlean}{Proofs.%s}\n" % name + HEAD + "\\importmodule{Kernel}\n"
            + "\\title{Text application model}\n\\begin{semanticmodule}\n"
            + "\n".join(declarations) + "\\end{semanticmodule}\n\\end{lexlean}\n")


# The axioms Lean observes for each proof (`#print axioms`, measured): `omega`
# reaches `Classical.choice` when a split leaves an `if` over a disjunction.
# LexLean refuses a proof whose declared set differs (LLV7005).
CLASSICAL = {"Delivery", "Etag", "Healthy", "Sound"}


def proof_modules():
    modules = {}
    for module, breaks, holds, params, args, body, defs in INVARIANTS:
        axioms = ["Classical.choice"] + AX if module in CLASSICAL else AX
        modules[module] = proof_module(module, [
            defn(breaks, params, "Bool", body),
            theorem(holds, params, "((%s %s) = false)" % (breaks, args), "linear_arithmetic",
                    defs + [breaks], axioms)])
    modules["Accepts"] = proof_module("Accepts", [theorem(
        "acceptsDecides", "check : Kernel::Check",
        "(((Kernel::accepts check) = true) <-> (Kernel::Accepts check))", "simplify",
        ["Bool.and_eq_true", "Nat.beq_eq", q("Accepts"), q("SameDigest"), q("accepts"), q("sameDigest")],
        ["propext"])])
    return modules


def main():
    with open(os.path.join(SRC, "Kernel.lex.tex"), "w", newline="\n") as f:
        f.write(kernel_module())
    stale = os.path.join(SRC, "KernelProofs.lex.tex")
    if os.path.exists(stale):
        os.remove(stale)
    os.makedirs(os.path.join(SRC, "Proofs"), exist_ok=True)
    modules = proof_modules()
    for name, text in modules.items():
        with open(os.path.join(SRC, "Proofs", name + ".lex.tex"), "w", newline="\n") as f:
            f.write(text)
    print("entrypoints = [%s]" % ", ".join(
        ['"src/Kernel.lex.tex"'] + ['"src/Proofs/%s.lex.tex"' % n for n in sorted(modules)]))
    with open(os.path.join(HERE, "vectors.json"), "w", newline="\n") as f:
        json.dump([{"request": r.hex(), "response": e.hex()} for r, e in zip(VECTORS, EXPECTED)], f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
