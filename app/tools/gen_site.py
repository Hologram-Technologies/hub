"""Writes app/src/Site.lex.tex and the site's proof modules from site_spec.py.

The module holds two kinds of definition. Small Nat tables (routes, navigation,
links, the Hugging Face dialect) are what Lean proves things about. Each
screen is a `Bytes` definition: its JSON, written as readable text pieces
joined by a balanced tree of appends, so a word in the spec reads as a word in
the model and nesting stays far under the guest compiler's limit.
"""

import json
import re

import site_spec as S

AX = ["Quot.sound", "propext"]
# Printable ASCII but the backslash: LexLean source strings take these as they
# are, with `"` written `\"`. Anything else is written as hex. One screen is
# then a few long strings, not hundreds of pieces (the guest grew to 152 KB
# with a piece per word, and the proof page's Lighthouse budget failed).
SAFE = re.compile(r"[\x20-\x5b\x5d-\x7e]+")


def defn(name, params, result, body, axioms=None):
    # `lexlean fmt` keeps a definition on one line when it fits in 100 columns.
    one = "definition{name: %s, parameters: [%s], result: %s, body: %s}" % (name, params, result, body)
    if not axioms and len(one) <= 100 and "\n" not in body:
        return one + "\n"
    s = "definition{\n  name: %s,\n  parameters: [%s],\n  result: %s,\n  body: %s" % (name, params, result, body)
    if axioms:
        s += ",\n  axioms: [%s]" % ", ".join(axioms)
    return s + "\n}\n"


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


def screen_json(name):
    text = json.dumps(S.SCREENS[name], separators=(",", ":"), ensure_ascii=False)
    assert "\\" not in text, "a screen may not contain a backslash: LexLean strings cannot hold one"
    return text.encode("utf-8")


def pieces(data):
    """Readable runs as `utf8_encode` literals; every other byte as hex."""
    text = data.decode("utf-8")
    out, i = [], 0
    for m in SAFE.finditer(text):
        if m.start() > i:
            out.append("0x" + text[i:m.start()].encode("utf-8").hex())
        out.append('(prim utf8_encode "%s" : Bytes)' % m.group(0).replace('"', '\\"'))
        i = m.end()
    if i < len(text):
        out.append("0x" + text[i:].encode("utf-8").hex())
    return out


def balanced(parts):
    if len(parts) == 1:
        return parts[0]
    mid = len(parts) // 2
    return "(prim append %s %s : Bytes)" % (balanced(parts[:mid]), balanced(parts[mid:]))


def delivering(a):
    return "(((%s =? 1) || (%s =? 2)) || (%s =? 20))" % (a, a, a)


def site_module(head):
    k = []
    k.append("definition{name: routeCount, parameters: [], result: Nat, body: %d}\n" % len(S.ROUTES))
    k.append("definition{name: navCount, parameters: [], result: Nat, body: %d}\n" % len(S.NAV))
    k.append("definition{name: linkCount, parameters: [], result: Nat, body: %d}\n" % len(S.LINKS))
    for i, r in enumerate(S.ROUTES):
        k.append("definition{name: route%s, parameters: [], result: Nat, body: %d}\n" % (r.capitalize(), i))
    k.append(defn("hasScreen", "route : Nat", "Bool", "(route <? (routeCount))"))
    # A formula, not an `if` chain of `true` and `false`: `omega` cannot use a
    # Boolean that an `if` branch returns.
    k.append(defn("navInternal", "item : Nat", "Bool", nest("||", [
        "(item =? %d)" % i for i, n in enumerate(S.NAV) if "route" in n])))
    k.append(defn("navRoute", "item : Nat", "Nat", chain(
        [("(item =? %d)" % i, "(route%s)" % n["route"].capitalize()) for i, n in enumerate(S.NAV) if "route" in n],
        "(routeCount)")))
    k.append(defn("linkRoute", "link : Nat", "Nat", chain(
        [("(link =? %d)" % j, "(route%s)" % to.capitalize()) for j, (_, _, to) in enumerate(S.LINKS)],
        "(routeCount)")))
    # The browse page's filters and the query a link carries are one table.
    # `facetParam` gives each filter the position of its parameter's name in
    # the sorted list of names, so two filters naming one parameter get one
    # position between them and `queryHolds` fails.
    facets = [f[1] for f in S.SCREENS["models"]["facets"]]
    names = sorted(set(facets))
    k.append("definition{name: facetCount, parameters: [], result: Nat, body: %d}\n" % len(facets))
    k.append("definition{name: paramCount, parameters: [], result: Nat, body: %d}\n" % len(names))
    k.append(defn("facetParam", "facet : Nat", "Nat", chain(
        [("(facet =? %d)" % i, str(names.index(name))) for i, name in enumerate(facets)],
        "(paramCount)")))
    statuses = sorted(S.DIALECT.items())
    k.append(defn("hfStatus", "answer : Nat", "Nat", chain(
        [("(answer =? %d)" % a, str(st)) for a, (st, _, _) in statuses], str(S.BAD_REQUEST[0]))))
    k.append(defn("hfCode", "answer : Nat", "Nat", chain(
        [("(answer =? %d)" % a, str(code)) for a, (_, code, _) in statuses], str(S.BAD_REQUEST[1]))))
    for r in S.ROUTES:
        k.append(defn("screen%s" % r.capitalize(), "", "Bytes", balanced(pieces(screen_json(r)))))
    k.append(defn("screen", "route : Nat", "Bytes", chain(
        [("(route =? (route%s))" % r.capitalize(), "(screen%s)" % r.capitalize()) for r in S.ROUTES], "0x000400")))
    return ("\\begin{lexlean}{Site}\n" + head
            + "\\title{Text application model}\n\\begin{semanticmodule}\n"
            + "\n".join(k) + "\\end{semanticmodule}\n\\end{lexlean}\n")


def q(n):
    return "Site::" + n


ROUTE_DEFS = [q("routeCount")] + [q("route%s" % r.capitalize()) for r in S.ROUTES] + [q("hasScreen")]

# (module, breaks, holds, parameters, arguments, condition, definitions)
SITE_INVARIANTS = [
    # Every header item that stays in the hub opens a screen the guest renders.
    ("Nav", "breaksNav", "navHolds", "item : Nat", "item",
     "(((item <? (Site::navCount)) && (Site::navInternal item)) && (not (Site::hasScreen (Site::navRoute item))))",
     ROUTE_DEFS + [q("navCount"), q("navInternal"), q("navRoute")]),
    # Every link a screen follows inside the hub opens a screen the guest renders.
    ("Links", "breaksLinks", "linksHold", "link : Nat", "link",
     "((link <? (Site::linkCount)) && (not (Site::hasScreen (Site::linkRoute link))))",
     ROUTE_DEFS + [q("linkCount"), q("linkRoute")]),
    # Every filter the page offers names a parameter of its own: the parameter
    # exists, and no other filter claims it. So a link carries the whole state
    # and nothing in it is dropped or read as something else. The comparisons
    # are against literals, because `omega` cannot see through an `if` whose
    # scrutinee is itself an `if` chain.
    ("Query", "breaksQuery", "queryHolds", "facet : Nat", "facet",
     "((facet <? (Site::facetCount)) && ((not ((Site::facetParam facet) <? (Site::paramCount))) || %s))"
     % nest("||", [
         "((not (facet =? %d)) && ((Site::facetParam facet) =? %d))" % (i, sorted(set(f[1] for f in S.SCREENS["models"]["facets"])).index(name))
         for i, name in enumerate(f[1] for f in S.SCREENS["models"]["facets"])]),
     [q("facetCount"), q("paramCount"), q("facetParam")]),
    # A tool sees a status below 400 exactly when the kernel delivers.
    ("Dialect", "breaksDialect", "dialectHolds", "answer : Nat", "answer",
     "((((Site::hfStatus answer) <? 400) && (not %s)) || (%s && (not ((Site::hfStatus answer) <? 400))))"
     % (delivering("answer"), delivering("answer")),
     [q("hfStatus")]),
    # Every refusal reaches the tool as a 4xx or 5xx status with a named error code.
    ("Errors", "breaksErrors", "errorsHold", "answer : Nat", "answer",
     "((not %s) && ((((Site::hfStatus answer) <? 400) || (599 <? (Site::hfStatus answer))) || ((Site::hfCode answer) =? 0)))"
     % delivering("answer"),
     [q("hfStatus"), q("hfCode")]),
]

SITE_CLAIMS = [
    ("HK-16", "Every filter the browse page offers maps to one query parameter and back, so a link carries the whole state",
     ["Query"]),
    ("HK-11", "Every header item and every link that stays in the hub opens a screen the kernel renders",
     ["Nav", "Links"]),
    ("HK-12", "A Hugging Face tool sees no HTTP error exactly when the kernel delivers, and every refusal reaches it as a 4xx or 5xx status with a named error code",
     ["Dialect", "Errors"]),
]


def site_vectors():
    vectors = []
    for i, r in enumerate(S.ROUTES):
        vectors.append((bytes([3, i]), screen_json(r)))
    vectors.append((bytes([3, len(S.ROUTES)]), bytes([0, 4, 0])))
    vectors.append((bytes([3]), bytes([0, 4, 0])))
    vectors.append((bytes([3, 0, 0]), bytes([0, 4, 0])))
    return vectors


def largest_screen():
    return max(len(screen_json(r)) for r in S.ROUTES)
