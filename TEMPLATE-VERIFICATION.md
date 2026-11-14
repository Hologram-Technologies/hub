# Template repository verification

This repository's `just vv` instantiates the universal verification policy in
`VERIFICATION.md` for this repository, which is a Prism application: the hub kernel in
`app/`.

| `just` recipe | Enforces | ID classes |
| --- | --- | --- |
| `just fmt-check` | the diff is reviewable | --- |
| `just model` | R1, R4, R5 and the bootstrap trust root, in one `xtask validate` | `CM-01` |
| `just template-check` | immutable SDK selection and template drift, checked by the SDK | --- |
| `just lint` | Clippy at `-D warnings`, every target, every optional feature | --- |
| `just test` | the workspace suite, including the R3 meta-gate | `CM-02`, `CM-03` |
| `just deny` | R6 over the dependency graph | --- |
| `just app` | the Prism application: LexLean format and lock, then `prismpm verify`, which builds the holo and checks it | `HK-01` to `HK-14` |

Each check runs once per `just vv`. `just bdd` runs only the meta-gate while a
scenario is being written; `just test` already includes it.

The register holds fourteen claims, `HK-01` to `HK-14`, so the meta-gate
checks real rows, real scenarios and real tests. It becomes an error as soon as an ID, scenario,
or test is added without the other two.

## Planted defects

| Gate | Planted defect | Result |
| --- | --- | --- |
| `check-model` | `CONFORMANCE.md` disagrees with the register | rejected |
| `audit-deferral` | a deferral marker in a crate and in the gate's own source | both rejected |
| honesty meta-gate | an ID with no test | rejected |
| `kernel_hk_01` to `kernel_hk_10` | `breaksPrivacy` drops its `delivers` disjunct; `dispatch` delivers on a digest mismatch; `soundHolds` declares an extra axiom; `Proofs/Sound.lex.tex` is removed from the entrypoints; one acceptance vector's response is edited; `breaksNav` drops its screen check; `breaksDialect` moves its threshold to 500; `dispatch` stops serving screens from `Site`; `breaksVerdict` tests a verdict code that never occurs; `dispatch` reads the verdict's first result from the wrong byte; `breaksTrust` stops testing a witness shown as a publisher; `dispatch` shifts the trust facts by one byte | all twelve rejected |
| `prismpm verify` | an acceptance vector set without the exact guest-allocation boundary | rejected (PP2009) |
| `audit-bootstrap` | a floating/copied action, mutable SDK tag, changed universal file, narrowed boundary, shallow/credential-retaining checkout, copied project renderer, omitted standards lock, acceptance bypass, deploy-job signing privilege, incomplete release lifecycle, or a bootstrap that drops a native architecture from main or tags, cancels or replaces a main run, or skips runs by path, condition or matrix exclusion | all rejected |
| `audit-bootstrap` (`proof_reuse_is_confined`) | proof reuse widened to `push` or to any event, a recipe that stops proving, a cache key without the `Justfile` or without `app/**`, the event line removed from the gate, a second use of the event in the recipe, and the `merge_group` trigger dropped | all rejected |

`audit-deferral` reads every crate and `xtask`, including itself. Its token
construction therefore cannot exempt the very gate in which a deferral could
otherwise be hidden.

## One pull-request run, complete native coverage on main and tags

Every instance inherits this bootstrap. Before this change, each pull request
and each main push ran the complete `just vv` on both native runners, and
nothing cancelled a superseded pull-request run. Those runner minutes are
shared across the organization (UOR-Foundation/PrismPM#187). Repeating a
deterministic gate on the same inputs adds time, not evidence
(UOR-Foundation/PrismPM#210, UOR-Foundation/prism-code#25).

A pull request now runs the complete gate once, natively on amd64, and a newer
push to the same pull request cancels its older run. Every main push and every
tag runs the complete gate on both native architectures. Each non-pull-request
run has a concurrency group of its own. GitHub keeps at most one pending run
per group, so a shared main group would replace a queued commit's run before
it produced a verdict. The pull request's arm64 evidence therefore arrives on
the merge commit, before any tag of it publishes.

`native_coverage_is_complete`, part of `audit-bootstrap`, keeps that saving
sound. It requires the main and tag triggers, one of exactly two runner
matrices, and either no concurrency or exactly the pull-request-only
cancellation. The two admissible matrices are both architectures on every
event, or amd64 on pull requests and both elsewhere. The gate also rejects job
conditions, `continue-on-error`, matrix inclusions or exclusions, and path,
branch or tag filters.

The new test, `dropped_native_coverage_plant_is_rejected`, failed against the
previous workflow bytes: `assertion failed: native_coverage_is_complete(bootstrap)`.
It passes against the changed workflow, and rejects eight planted defects:
- arm64 removed from main and tags;
- the two matrix legs swapped;
- the tag trigger removed;
- unconditional cancellation;
- one shared main group;
- a `paths-ignore` filter;
- a job condition that skips arm64;
- a matrix exclusion of arm64.

Running both architectures on every event without concurrency stays
admissible, because it is stronger than the policy.

All 15 `xtask` tests, including both invoked Node cases, passed with the pinned
Rust 1.97.1 on `x86_64-pc-windows-gnu`, locked. Formatting passed, and
all-target Clippy with warnings denied passed for `xtask`. These ran outside
the SDK image, because no Docker host was available. Workspace Clippy on that
target also reports `result_large_err` in `repo-model` on unchanged `main`; it
is not part of this change. The change's own pull-request run on GitHub
evaluated both expressions and started exactly one job,
`acceptance / ubuntu-24.04`. That job then stopped before the gate, as every
template run does, because the template commits no `prismpm.lock`. The main,
tag and cancellation behavior have not yet run on a hosted runner.

## A pull request reuses main's proof of byte-identical inputs

Proving the application (`prismpm --project app verify`, Lean and leanchecker)
is most of a pull request's gate: in UOR-Foundation/foundry it took 16 of 20
minutes, on every pull request, including the many that change no proof input.
The reasoning of the section above applies to it unchanged: a pull request's
merge commit is proved again, in full, on main.

`bootstrap.yml` now keeps the proof in `.prism-proof`, through `actions/cache`,
keyed by every byte the proof reads: `app/**`, `prismpm.lock`, the `Justfile`
and `rust-toolchain.toml`, per runner OS and architecture. It passes the event
to the gate as `PRISM_PROOF_EVENT`. `just app` reuses a kept proof only when the
event is `pull_request` or `merge_group`, and says so with the attestation it
reuses. A main push, a tag and every local run prove in full and keep their
proof. GitHub scopes caches by ref: a pull request can write only its own
scope, and reads main's. A pull request could already change the `Justfile`
to skip the proof on itself, so reuse gives a pull request no power it lacked.
Main's verdict, which is what a release rests on, never reuses anything.

`merge_group` joins the fixed trigger block, so a merge queue can require this
gate. A merge queue run gets the pull request's amd64 matrix and its own
concurrency group, and is never cancelled.

`proof_reuse_is_confined`, part of `audit-bootstrap`, keeps the saving sound. It
requires the exact cache key, the exact event line, and a `Justfile` `app`
recipe whose only use of the event is one `case` with the single pattern
`pull_request|merge_group)`, and which still runs `prismpm --project app verify`.
`native_coverage_is_complete` requires `merge_group` in the triggers and the new
matrix. The new test, `widened_proof_reuse_plant_is_rejected`, rejects every
planted defect: reuse widened to `push`; reuse for any event; a recipe that
stops proving; the `Justfile` or `app/**` dropped from the key; the event line
removed; a second use of the event in the recipe; and `merge_group` dropped
from the triggers. All 19 `xtask` tests passed in the locked SDK image, with
formatting checked.

## Platform-indexed SDK bootstrap

The `/2` SDK lock renderer delegates index and inventory validation to the
SDK-owned `platform-lock.mjs` helper. Transport extracts inventory and standards
files from each exact `linux/amd64` and `linux/arm64` image child using Docker
without executing the foreign architecture. The template native audit compares
the detected platform's complete inventory and bytes; the legacy `/1` branch
keeps its original exact comparison.

All 10 template `xtask` tests and all-target Clippy passed, locked and offline,
inside the existing PrismPM SDK as UID 1000. The new negative test rejects a
swapped native inventory, missing platform, and legacy architecture drift.
Shell and Node syntax checks passed. An isolated ignored Cargo target was used
because older root-owned fingerprints prevented reuse of the default target;
those unrelated artifacts were not changed. These focused tests do not claim
the template's full `just vv` has accepted an unpublished candidate SDK. A real
immutable multi-platform candidate and policy-input commit are still required
before generating and committing the new locks.

The initial standards binding adds two executable Node cases, also invoked
by the ordinary `xtask` test suite: absent and matching locks preserve the
exact supplied bytes; a differing existing lock is rejected without changing
it. The complete 11-test `xtask` suite, all-target Clippy and shell/Node syntax
checks passed inside the SDK as UID 1000. This is byte-binding evidence, not a
claim that the project has adopted or conforms to every referenced standard.

## Private Buildx state with read-only credentials

Foundry bootstrap run `35104180230` failed on both runner architectures before
the repository gate: Buildx tried to create `.docker/buildx` inside the
read-only credentials mount. The exact amd64 SDK candidate
`ghcr.io/uor-foundation/prismpm-sdk-candidate@sha256:c2e0e50437e13d9b2e382d3af4ae7a962b469721b9b80f14f215d9254e8ed78f`
reproduced `mkdir /tmp/prismpm-home/.docker/buildx: read-only file system`
under UID 1000, with network disabled, an empty test-only credentials file
mounted read-only, the socket's group, and the same private `/tmp` tmpfs.
No owner credentials were read or mounted.

With `BUILDX_CONFIG=/tmp/prismpm-buildx` and `umask 077`, actual `docker buildx
version` and `docker buildx inspect --bootstrap` passed. The state directory
was mode 0700, credentials stayed read-only and byte-identical, and no state
was created inside the credential directory. The default Docker driver was
inspected; no builder was created, selected, or removed. The disposable
container's state vanished when it exited. This is native amd64 execution,
not a claim that the updated hosted ARM job has already passed.

The native guard's planted missing-state regression failed before the fix.
It now rejects missing/duplicate configuration, paths inside either the
credentials directory or its parent, missing tmpfs and permissive creation.
An additional real-workflow mutation pair reproduced that the initial guard
accepted an appended `umask 022` before Buildx and a `umask 077` moved after
inspection. Both now fail: the scoped container-script check requires exactly
one umask directive, exactly 077, before its first Buildx command. The final
12-test xtask suite, both invoked Node tests, formatting and Clippy passed
again; the actual Docker workflow was already correct and remained unchanged.
All 20 workspace Rust tests (including all 12 xtask tests), both invoked
Node tests, locked offline Clippy, all-features/all-target checks, formatting,
model comparison and YAML/embedded-shell syntax passed under that exact SDK.
The YAML check used the SDK's existing `js-yaml`; no tooling was installed.
Raw RED/GREEN logs are retained under `target/template-buildx-*`.

The template remains unbound: these component checks do not replace its
required complete `just vv`, accept a production SDK, or waive universal
policy. Downstream repositories must receive the changed workflow and policy
through their normal reviewed template update.

## SDK-owned dependency maintenance

Dependabot uses canonical JSON-form YAML, checked structurally by
`audit-dependency-updates` within `audit-bootstrap`. Duplicate keys, malformed
values, missing or broader exclusions, and disabled maintenance are rejected.
Only the SHA-pinned `UOR-Foundation/PrismPM/action` and byte-bound
`.github/workflows/bootstrap.yml` use the reviewed SDK/template update flow.
Other Actions and Cargo dependencies retain their weekly schedules and groups;
both now request Conventional Commit prefixes.

GitHub documents [dependency ignores and path exclusions](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).
The upstream [SHA-pinned subpath parser](https://github.com/dependabot/dependabot-core/blob/dc25739e082c6d97399b476ad4eb06b5559895e7/github_actions/lib/dependabot/github_actions/file_parser.rb#L148)
confirms the exact action dependency name. The existing SDK's `js-yaml` 4.3.2
independently parsed the configuration and preserved the prior schedules and
groups; this inspection is not a new SDK API or general YAML conformance claim.

The previous configuration failed the new gate. A canonical broad `*` ignore
also failed the actual command; restoring the exact action passed. Negative
tests cover omitted/wrong/extra exclusions, disabled or duplicate ecosystems,
removed Cargo coverage, altered scheduling, and duplicate JSON keys.
The byte-wise SHA formatter preserves exact empty-string and `abc` digests
with unchanged sha2 0.10.9; the same correction fixes sha2 0.11 compilation in
the separately verified Foundry dependency update. No dependency was changed
here. Logs are retained under `target/template-dependabot-*` and
`target/template-maintenance-*`.

In the exact native AMD64 SDK above, all 22 workspace Rust tests and both
invoked Node tests, formatting, Clippy, all-feature/all-target compilation,
model/limit/deferral audits and dependency checks passed. Full `just vv`
passes the new policy check, then rejects the template's existing absent
`prismpm.lock`. No universal policy bytes changed or release gate was waived.

## Each check once, and the R3 scaffold

`just vv` used to run `check-model` and `audit-bootstrap` twice (once in
`template-check`, again inside `xtask validate`), the `repo-conformance` tests
twice (`test`, then `bdd`), and the workspace through two compilers that differ
only in features (`lint` at the default features, then `features`, a
`cargo check --all-features`). Repeating a deterministic check on the same
inputs adds time, not evidence. Now `model` is the one `xtask validate`,
`template-check` is only the SDK's two checks, `lint` is Clippy with
`--all-features` (so an optional feature is still compiled, with its tests, and
now also linted), and `test` compiles the default features. Every Cargo
invocation passes `--locked`, so no part of the gate can resolve a dependency
the lock does not name (R6). The `cargo vv` alias, which ran `xtask validate`
and so was not the gate its name claimed, is removed.

`cargo xtask new-capability <ID> <level> <suite> <statement>` (`just
new-capability`) writes the register row, the tagged scenario and a test named
`<suite>_<id>` that fails until the capability is built, then regenerates
`CONFORMANCE.md`. Its tests run the honesty meta-gate on a scratch copy of the
register: two scaffolded capabilities leave it clean, and a lowercase ID, a
missing hyphen or number, an unknown level, an uppercase or path-escaping
suite, an empty or two-line statement, too few arguments and a duplicate ID
are all refused with the register byte-identical and no suite file written.

On a copy of this repository, `just new-capability CX-01 build parsing ...`
produced files that passed `cargo fmt --check` and all-feature Clippy, and
`cargo test` then failed exactly at `parsing_cx_01`, as R3 requires. The 18
`xtask` tests, all-target all-feature Clippy, formatting and `audit-deferral`
passed with the pinned Rust 1.97.1 on `x86_64-unknown-linux-gnu`, locked,
outside the SDK image; the SDK checks run in the pull request's bootstrap job.

## The hub kernel

`app/` is a Prism text application modeled in `app/src/Kernel.lex.tex`, with
one proof module per theorem in `app/src/Proofs/`. Both are generated by
`app/tools/gen_kernel.py`, which also computes the 33 acceptance vectors from
an independent Python reading of the same rules. A resolve request is 104
bytes, an accept request 81; the answer is always three bytes (answer code,
source slot, ETag kind). The layout is in `README.md`.

Lean proves eleven theorems, one module each, all quantified over every input:
`privacyHolds`, `deliveryHolds`, `runnerHolds`, `vettedHolds`, `sourcedHolds`,
`soundHolds`, `pinHolds`, `healthyHolds`, `etagHolds` and `revisionHolds` by
`linear_arithmetic`, and `acceptsDecides` by `simplify`. Their axiom sets are
the ones Lean observes (`#print axioms`, measured 2026-11-12): `propext` only
for `acceptsDecides`; `Classical.choice`, `Quot.sound` and `propext` for
`deliveryHolds`, `etagHolds`, `healthyHolds` and `soundHolds`; `Quot.sound` and
`propext` for the rest.

Three shapes were refused before this one, and the model avoids each:

- An `if` whose condition tests another decision chain (`select facts =? 4`
  inside `answer`, with `select` unfolded): `linear_arithmetic` left the inner
  chain unsplit and `omega` found a spurious counterexample.
- One proof unfolding both `answer` and `select`: Lean's `split` ran out of
  `simp` steps. `answer` now tests `select` folded, and the claim that a
  delivered file has a source is its own theorem, `sourcedHolds`.
- All theorems in one module: Lean ran for three minutes and was refused
  without a message. One module per theorem names any failure.

Measured locally on 2026-11-12 in the SDK image `prismpm.lock` pins, with
LexLean 0.3.0: `lexlean fmt --check`, `lexlean lock --check` and `lexlean check`
passed on 14 modules. Each proof module checked in Lean alone in 9 to 75
seconds. `prismpm verify` built `Hub kernel.holo` (26,237 bytes, guest 4,022
bytes, blake3 `9c6d9224fcf6d3eea3bcd7a03edb88f00e0d75893fc704c8870b93eec5858a76`), and
`prism-code vectors` replayed 33 of 33 vectors against it with identities
verified. The same `prismpm verify` then stopped in its Hologram oracle stage
with `Input/output error (os error 5)` writing a compiled dependency to the
Windows-mounted checkout; that stage has not completed locally. A first
attempt stopped earlier, compiling `js-sys` for the browser adapter with no
diagnostic, while other containers held most of the machine's memory; it
passed with `CARGO_BUILD_JOBS=2`. Not yet run: the whole of `just vv` in one
process, and the build on GitHub Actions.

`kernel_hk_01` to `kernel_hk_10` read the model as text and pin each claim's
exact condition, statement, axiom set and entrypoint, that `plan` names a
source and an ETag only when `delivers` holds, and that `delivers` is exactly a
redirect or serve answer. `kernel_vectors_match_reference` requires the holo's
vectors to be exactly the reference implementation's. Each planted defect in
the table above failed the suite, and the restored tree passed 11 of 11.

## The hub interface

`app/src/Site.lex.tex` holds the site and the Hugging Face dialect, generated
from `app/tools/site_spec.py` by `app/tools/gen_site.py`: Nat tables for
routes, header items, links, HTTP statuses and error codes, and one `Bytes`
definition per screen, its JSON written as readable text pieces joined by a
balanced tree of appends. `dispatch` answers a two-byte request `03 nn` with
screen `nn`; the five screens and three refusals are acceptance vectors.

Lean proves four more theorems, each in its own module, with `propext` and
`Quot.sound` (measured with `#print axioms` on 2026-11-12): `navHolds` (12 s)
and `linksHold` (5 s) for `HK-11`, `dialectHolds` (29 s) and `errorsHold`
(67 s) for `HK-12`. `navInternal` is a formula, not an `if` chain of `true`
and `false`: the chain was refused with "No usable constraints found". The
hosted verifier also verified every module of the previous revision
(attestation `0dc8cbcdeb954cd5bab6b5f4358bdb05ca3a1a836703c6fd12cb501ed6f31441`).

`web/` draws only what the guest returns. `pages.yml` publishes it at the
root of the Pages site and the proof page under `app/`, so the interface
reads the holo, the runtime and the brand tokens from beside it.

## A promise to another program (HK-18)

The engine being built on this hub (prism-hologram-ai) asked which fields of a
release record it may depend on, so that a rename here does not break it
silently. The answer agreed with its coordinator session on 2026-11-14: the
repository, the revision, every file's `path`, `size` and `gitSha1`, `sha256`
where the source publishes one, and `sources[]`. Everything else in a record -
`info`, `observed`, `config`, `cardData`, `safetensors`, `witnesses` - is still
moving and was named as such.

A Lean proof cannot catch a field being renamed in JavaScript, so this claim is
a test and says so. `crates/conformance/tests/index.rs` reads
`tools/index.mjs`, strips its comments so a field named only in a comment
cannot satisfy it, finds the record literal the builder writes and the file
entries it maps, and fails unless each promised field is there. Reading the
whole file would let a mention anywhere pass; the promise is about that object.

Planted defect: rename one field in the file mapping.

    path: f.path, size: f.size, blobId: f.oid,   // was gitSha1

    $ cargo test -p repo-conformance --test index
    thread 'index_hk_18' panicked at crates/conformance/tests/index.rs:65:9:
    every file entry must carry gitSha1:
    test result: FAILED. 0 passed; 1 failed

Restored, it passes. Registered with `cargo xtask new-capability HK-18 build
index`, which wrote the row, the scenario and a failing test in the order
`AGENTS.md` sets out, before the assertion was written.

## A second witness, and what to do when two disagree (HK-17)

The browse page said VERIFIED for records nobody had re-hashed, and the model
page could offer Verify on only the files Hugging Face publishes a SHA-256
for. For `openai-community/gpt2` that is eleven of twenty-six: the other
fifteen are small files whose address the hub copied out of an LFS pointer
that does not exist for them. The smallest file a reader could check was
hundreds of megabytes.

Pirate Face publishes a SHA-256 per file for the models it indexes.
`docs/pirateface-integration.md` assessed six ways to use it and recommended
this one. Measured again by hand on 2026-11-14 before building on it:
`https://pirateface.co/api/torrents?repo=openai-community/gpt2` names the same
revision the hub's record does; of the eleven files both parties address, all
eleven agree and none conflict; fourteen files the hub cannot address, it can.
Three of those fourteen were checked against the bytes - `tokenizer_config.json`,
`onnx/special_tokens_map.json` and `onnx/generation_config.json` were
downloaded from Hugging Face at that revision and hashed here, and all three of
Pirate Face's values are right.

Agreement on the eleven is weak evidence, because both numbers may descend from
the same LFS pointer. The fourteen are the finding: Hugging Face publishes no
address for them, so another party hashed bytes to get one.

The kernel decides what two witnesses add up to. Operation 7 takes four bytes -
`07`, whether the release names an address, whether the other witness does, and
whether the two are the same - and answers 1 use it, both agree; 2 one witness
alone named it, and the page says which; 3 they disagree, so the file has no
address; 0 neither named one. `concurHolds` (`app/src/Proofs/Concur.lex.tex`)
proves no input reaches `breaksConcur`: never "use it" while both named one and
they differed, never "use it" while neither did, never "one alone" while both
or neither did, and never "none" while one did.

The second witness is kept out of `files[].sha256` on purpose. `edge/edge.mjs`
reads that field to decide whether a file is an LFS file, which decides which
ETag `HK-08` hands a Hugging Face client; writing addresses there would change
the ETag for fourteen of gpt2's twenty-six files and break the wire the edge
tests pin. It goes in a `witnesses` block, with the party that gave it and the
day it was read, and the record format is `hologram.hub.release/v3` so a cached
v2 record is rebuilt rather than reused.

Measured on a six-record index built from this tree: four releases gained a
second witness, 48 addresses were filled, and no two witnesses disagreed. On
the model page for `openai-community/gpt2`:

    25 of 26 files carry an address a reader can check.
    11 agreed by gethologram.ai and pirateface.co
    14 from pirateface.co alone
    1 with no address
    pirateface.co, read 2026-11-14

One parameter name had to change. `first` is a glossary term, so
`(first =? 1)` parsed as an application and LexLean refused `=?` as not a term
(`LLP2001`). The parameters are `ours`, `theirs` and `same`.

### The gate, and the defect that proves it fails

Planted defect: make `concur` use the address whenever both witnesses name
one, agreement or not, in the generator and in its reference implementation
together, so the acceptance vectors agree with the lie and only the proof can
catch it.

    ("((ours =? 1) && (theirs =? 1))", "1"),   // was: if same then 1 else 3

    $ just app
    LLV7002: Lean rejected `HologramHubKernel.Proofs.Concur` (error):
      omega could not prove the goal: No usable constraints found.
    PP5001: LexLean verification failed
    error: recipe `app` failed with exit code 1

Restored, the gate passes. Worth recording how this had to be measured:
`prismpm build` published the defective kernel without complaint, because
build compiles the guest and does not run the proofs. Only `prismpm verify`,
which `just vv` reaches through `just app`, refuses it. A green build is not a
green proof.

## The listing, with Hugging Face switched off

With Hugging Face unreachable the hub answered `/api/models` with fifty rows
of seven keys, no `Link` header, and silence for `filter`, `sort`,
`direction`, `full`, `config` and `expand[]`; it also answered 200 where
Hugging Face answers 400. The inventory called it a different endpoint, and it
was.

It answers from the browse shards now, the same rows the page draws, so the
listing a person sees and the listing a tool gets are one set of facts. The
query it takes is the kernel's (`listQuery` on screen 4), so the docs page and
the answer cannot disagree about it.

Measured against huggingface.co on 2026-11-13, the same request to each:

| Request | Hugging Face | This hub, Hugging Face off |
| --- | --- | --- |
| `?limit=2` | 200, eleven keys, `Link` next | the same eleven keys, in the same order, with a `Link` |
| `?sort=trending` | 400 | 400 `BadRequest` |
| `?direction=1` | 400 | 400 `BadRequest` |
| `?full=true` | 200, sixteen keys | the same sixteen keys, in the same order |
| `?expand[]=lastModified` | `_id, id, lastModified, trendingScore` | identical |
| `?expand[]=downloadsAllTime` | `_id, id, trendingScore, downloadsAllTime` | identical |
| `?expand[]=downloads&sort=downloads` | `_id, id, downloads` | identical |
| `?expand[]=safetensors&expand[]=gguf` | `_id, id, trendingScore, safetensors` | identical |

Two behaviours had to be measured rather than guessed. An expansion comes back
with the identity, the key the answer was sorted by, and the fields asked for
that the model has - a field it has not is left out, not sent as null. And the
keys follow the record's own order, which is the order `full=true` answers in,
with a field that order does not name coming after it. Both are now what the
hub does.

Three routes the inventory found unanswered now answer from the index:
`/api/models-tags-by-type` (the tags the listed models carry, by kind),
`/api/quicksearch`, and `/api/models/{repo}/commits/{revision}`, which returns
the one commit the index holds and says `X-Hub-Partial: history` rather than
implying the repository has had one commit.

### The gate

`tests/edge/listing.mjs` runs the edge with Hugging Face drained and checks
twenty-one things: the row shape, each accepted sort and the order it
produces, the two refusals, `filter`, `author`, `full`, `config`, `expand`,
the cursor and that the next page is new rows, the taxonomy, quicksearch and
the commit. It runs in `pages.yml` after the deploy, against the published
holo and the published index.

## One index, two readers

The browse page drew 500 rows copied at deploy while the signed index held
400 releases and the wire answered from a third place, so a search could miss
a model the hub could serve and a deep page had nothing behind it. The page
now reads the index.

`tools/index.mjs` writes browse shards beside the records: one row per release,
derived by `tools/facets.mjs`, which is also the only place the hub decides
what a model's task, size, family, architecture, languages, format and licence
are. The root names each shard by the hash of its bytes and names the rule
that produced the rows (`rules: hologram.hub.facets/1`), so a reader can tell
which opinion it is looking at. The signature over the root now covers the
listing as well as the releases.

The page checks both. A shard is drawn only when its bytes are the ones the
root names, judged by the kernel's accept rule (`HK-10`, the same rule a
download goes through), and the root's signature is checked with the pinned
Sigstore roots from screen 3 and the kernel's trust rule (`HK-14`). The lead
row says which of the two it is holding: `Signed listing` or `Unsigned
listing`, with the row and shard counts and the rule behind it.

Because the rows come from records rather than a catalogue copy, `sort=modified`
returns: the record carries `lastModified` and the copy never did.

### The gate, and the defect that proves it fails

`tests/index/shards.mjs` reads an index the way the page does, then copies it,
changes one row's licence, leaves the root alone, and reads it again.

    ok   the root names its browse shards
    ok   the root names the rule that derived them
    ok   every shard is read
    ok   a row carries what the page filters on
    ok   a row's counts name the host that measured them
    ok   a changed shard is refused

The same defect was planted in the browser against the preview: one row's
licence changed in `data/index/browse/0.json` and the root left as it was. The
page drew no cards and said

    the index shard browse/0.json does not match the signed root

Restored, it drew all six rows again. The step runs in `pages.yml` between
building the index and signing its root.

## The query a link carries (HK-16)

The Phase 1 inventory measured a Hugging Face browse link losing everything it
carried when the host was changed: `?pipeline_tag=text-generation&num_parameters=6B,32B&sort=modified&p=2`
left the hub showing all 500 rows with no filter pressed, sort Trending, page
one, and rewrote the address bar to `/models/` with no query at all. The hub
read `tasks`, `params` and `page`, and dropped silently what it did not know.

The parameter names are now Hugging Face's own, read from its browse page's
hydration props on 2026-11-13 (`activeFilters`): `pipeline_tag`,
`num_parameters`, `library`, `language`, `license`, and `author`, `search`,
`sort` and `p` beside them. The slider writes a pair of the stops' own labels,
as Hugging Face writes it. The hub's own facets - status, source, format,
family, architecture, modality, release recency - wear a `hub_` prefix, so
nothing a copied link carries can collide with one.

`sort=modified` is left out rather than accepted and answered with some other
order: the copied catalog carries no last-changed date. The signed index does,
so it returns when the page reads the index.

`queryHolds` (`app/src/Proofs/Query.lex.tex`) proves the table is sound:
`facetParam` reads the facets in the order the screen lists them, `paramFacet`
reads them back from the parameter names in their own order, and no input
reaches `breaksQuery`, so every facet maps to one parameter and that parameter
maps back to it. Two facets sharing a parameter leaves the second without a way
home and the proof fails, which is how a collision is caught.

The first statement of the claim was the obvious one - read the parameter
from the facet, read the facet back from the parameter, and ask that it is the
one you started with - and Lean refused it (`LLV7002`): `omega` cannot see
through an `if` whose scrutinee is itself an `if` chain, so it printed a
counterexample made of the whole nested table. The claim is now stated without
the nesting: every facet's parameter is one of the parameters, and no other
facet has the same one, each comparison against a literal. It proves the same
thing - a map that is total and injective is a map that round-trips - and
`omega` proves it in seconds.

The gate refused the first generated module as not canonical (`LLL1003`):
`lexlean fmt` keeps a proof's definitions on one line while they fit in 100
columns, and the generator went straight to one definition per line. The
generator now matches the formatter, so the modules are canonical as written
rather than after a pass.

## A record the index may answer from (HK-15)

The Phase 1 inventory (`docs/phase1-models.md`) measured the hub describing a
model it had indexed worse than one it had never seen: `GET
/api/models/openai-community/gpt2` returned fifteen keys from the index and
twenty-four when it passed through to Hugging Face, and an indexed answer
carried neither `config` nor `cardData` nor `safetensors` nor `lastModified`.
The edge preferred the index whatever the index held.

The kernel now decides that. Operation 6 takes twelve bytes — one per field of
a release record, in the order the docs screen lists them, then one byte for
whether the source dialect can be asked — and answers 1 answer from the index,
2 ask the source dialect, 3 answer from the index and say the answer is
partial. `completeHolds` (`app/src/Proofs/Complete.lex.tex`) proves that no
input reaches `breaksComplete`: the answer is never 1 while a field is absent,
never 2 while the dialect cannot be asked, never 3 while it can, and is always
one of the three. Lean observes `Classical.choice`, `Quot.sound` and
`propext`, which is what the module declares. `prismpm build` accepted the
proof with only the first two declared; `prismpm verify`, which `just vv`
runs, refused it with `LLV7005` until the third was added, so the exact axiom
policy is checked by the gate and not by the build. The conformance test pins
that list too, so `app/tools/write_tests.py` had to be run again and the test
reformatted; the gate refused the stale pin in between.

The record itself grew to carry the ten fields (`tools/index.mjs`, format
`hologram.hub.release/v2`): the revision, every file, the tags as published,
the task, the library, the config, the card's front matter and the address of
its bytes, the parameter counts, the last change and whether the publisher
gates access. Two calls per release now, the repository and the tree, where
there was one. The card's bytes are not copied; the record names the file and
the git blob address its bytes must have, so a reader fetches it from any
source and checks it.

The counts of another host's traffic moved under `observed`, which names the
host that measured them and the day they were read. Before this, `likes` and
`downloads` sat beside the hashes as though the index had established them.

### The edge is older than the kernel it meets

The `edge` workflow starts the edge against the *published* holo, not the one
built from the commit under test, because that is how the edge is deployed:
separately, and against whatever kernel the hub is serving. The first push of
this work therefore failed it (run 43453813350, 2026-11-13):

    TypeError: Cannot read properties of undefined (reading 'fields')
    '[Errno 111] Connection refused' thrown while requesting HEAD
      http://127.0.0.1:8787/openai-community/gpt2/resolve/main/config.json

The edge read `docs.record` from screen 4 and the deployed kernel, built
before the record block existed, did not carry one; the start threw and every
client request met a closed port. The deploy itself had already passed, so
this was the only gate that could catch it.

The edge now takes a kernel that does not know operation 6 as one that cannot
answer the question: the plan falls back to answering from the index, which is
what it did before. `tests/edge/older-kernel.mjs` pins the start path against
whatever is published.

### The gate, and the defect that proves it fails

`tests/edge/complete.mjs` copies the index, removes one field from one
record, recomputes that record's hash in the root, serves the copy, and asks
the edge for both repositories with Hugging Face unreachable.

Measured on 2026-11-13, against the holo built from this tree and a five
record index:

    ok   a complete record answers from the index
    ok   the answer carries config, cardData, safetensors, lastModified, tags, siblings
    ok   downloads come from the observation
    ok   an incomplete record still answers
    ok   and names the field that was removed
    ok   and does not invent the field

Planted defect: in `fromIndex`, drop the partial header and answer as though
the record were whole.

    const headers = {};   // was: plan === 3 && missing.length ? { [partialHeader]: ... } : {}

    $ node tests/edge/complete.mjs <holo> <index>
    FAIL and names the field that was removed: null
    exit 1

Restored, the same command exits 0 with every check passing. The step runs in
`pages.yml` after the deploy, against the published holo and a two record copy
of the published index.

## The look, measured against gethologram.ai

The site's look is the live hub's own, not an imitation of it: `web/hub.css`
is gethologram.ai's `chrome.css` and `styles.css` (read on 2026-11-13),
trimmed to the parts this hub draws, and `web/icons.mjs` is its icon set and
its card mesh, which seeds a surface from each entry's address so the same
entry draws the same surface. The marks on the cards and on the landing strip
are the owners' own: Hugging Face names one avatar per owner
(`/api/organizations/{owner}/avatar`, then `/api/users/{owner}/avatar`), the
CDN serves one original at 200 px, and `tools/web-data.mjs` copies those bytes
whole. Measured on 2026-11-13: 500 of 500 catalogue rows have one, 249 files,
1.3 MB in all.

The filters are grouped as Hugging Face groups them, and the facet values are
derived rather than taken, because the hub's API does not carry them. Measured
against the live hub's own prepared catalogue on 2026-11-13, for the rows both
hold: the format counts agree exactly (Safetensors 187, GGUF 125, ONNX 5,
MLX 3), and task, family and architecture agree after three fixes — tasks are
mapped by an explicit table rather than by pattern (the live hub reads
`zero-shot-classification`, `video-to-video` and `image-to-3d` as neither
Text nor Video), a family keeps the version glued to its name ("Qwen 3.8", not
"Qwen 3 8"), and one spelling per family is chosen by count, so "MiniMax" and
"Minimax" are one facet and not two.

The holo grew from 81,413 bytes to 88,280 as the screens took the new facets,
the parameter stops and the theme panel's words. GitHub Pages serves it
gzipped, so what a visitor downloads went from 22,901 bytes to 23,085: the
proof page's Lighthouse budget (122,880 bytes of transfer, 100 ms of total
blocking time) is measured on that.

The theme panel is the Prism frame's, reached through the frame's Unsplash
worker (`prism-unsplash.trinity-03d.workers.dev`), which answers
`Access-Control-Allow-Origin: *` and holds the one key every Prism app shares,
so no page here carries one. Measured on 2026-11-13: a search returns nine
photos with their photographer and a placeholder colour, the chosen photo is
set as the wall through the worker's image route at this screen's own width,
and `POST /use?id=` reports the use as Unsplash's licence asks. A wallpaper
this site ships names no photographer, so it carries no credit line.

## Verify

`Verify` on a model page is decided by the kernel. The page fetches the
smallest file whose address is a SHA-256 from each source through the hub's
`/via/<source>` route and hashes it; each copy goes to `accept` (`HK-10`), and
the four results go to `verdict`, a five-byte request `04 r0 r1 r2 r3` (0
unreachable, 20 delivered, 21 quarantined) answered with one byte: 1 verified,
2 mismatch, 3 unreachable, 0 invalid. `verdictHolds` (`HK-13`) states that 1
needs a delivered copy and no quarantined one, and that any quarantined copy
gives 2 (or 0 when another result is invalid). Lean proved it in 5 seconds with
`propext` and `Quot.sound`; seven verdict requests are acceptance vectors.

Measured on 2026-11-12 for `openai-community/gpt2` `config.json` (665 bytes):
Hugging Face, ModelScope and IPFS (Filebase) each serve the file to another
origin, and each copy hashes to the address in the hub's index,
`0daed7749b4f…`.

## Holo size and the proof page's budget

The first push of `Verify` (commit `0b8beeb`) failed two gates in CI, and both
are fixed in the next commit:

- `audit-bootstrap` refused `pages.yml` because the new `smoke` job checked out
  without `fetch-depth: 0` ("omits complete history or retains checkout
  credentials"). The job now fetches complete history.
- Lighthouse on the proof page measured total blocking time 118 ms against the
  100 ms budget (performance 0.99). The holo had grown to 201 KB because each
  screen was written as hundreds of short text pieces, which compiled to a
  152 KB guest. Each screen is now one string literal (LexLean takes printable
  ASCII with `\"` for a quote; other characters are hex), `Site.lex.tex` went
  from 37 KB to 11 KB, and `gen_site.py` refuses a screen that holds a
  backslash, which a LexLean string cannot.

## Registry, Apps and Buckets

The three remaining header items are now routes the kernel renders (routes 5
to 7), so `navHolds` and `linksHold` (`HK-11`) cover every header item; both
were proved again (3 s and 2 s, `propext` and `Quot.sound`). The live hub's
`/registry/data/images.json` (3.1 MB, 2,149 entries) and `/spaces/spaces.json`
(12 apps) send no CORS header, measured on 2026-11-12, so `tools/web-data.mjs`
copies them at each deploy, keeping only the fields the screens read (1.3 MB,
237 KB compressed). The object store `/api/v1/objects/{id}` sends
`Access-Control-Allow-Origin: *`, so Buckets checks an object in the browser:
the catalog object `blake3:5d1685…` (544,627 bytes) is fetched, hashed with the
vendored BLAKE3 and judged by `accept`.

## Signed manifests

`trust` (request `05` plus ten bytes: whether a bundle exists, seven checks,
the signature kind and namespace ownership) answers 0 not signed, 1 witnessed,
2 published or 3 does not check out. `trustHolds` (`HK-14`) states that 1 and
2 need every check, that 2 needs a publisher's signature from the namespace
owner, and that a witness (kind 1) never gets 2. Lean proved it in 2 seconds
with `Classical.choice`, `Quot.sound` and `propext`; eight trust requests are
acceptance vectors.

`web/sigstore.mjs` was tested on 2026-11-12 against the real bundle GitHub
holds for the deployed holo (`sha256:ba7cecaa…`, signed by `pages.yml`): every
check passed; one flipped byte in the holo failed only the subject check; a
different workflow identity failed only the identity check; an edited
statement failed the log, signature and statement-type checks. The pinned
roots are the public-good Fulcio intermediate (valid from 2022-04-13) and the
Rekor key `c0d23d6a…` from Sigstore's trusted root.

`tools/manifest.mjs` was run on `BAAI/bge-small-en-v1.5`: 14 files, 12
re-hashed and matching Hugging Face's addresses, 200 tensors; the 133 MB
safetensors file took 66 s from this machine. The first full run stalled on
the network for 15 minutes on `openai-community/gpt2`, so the tool now prints a
line per file. The bundle a deploy signs is only produced in CI, where the
workflow has an OIDC identity; locally the page shows the manifest as not
checking out, as it should without a signature.

## The edge runner

Measured on 2026-11-12 with `huggingface_hub` 2.4.0 and `hf_xet` 1.8.0 on
Windows, the edge on Node 22 with the published kernel (59 examples replayed at
start). `tests/edge/observe.py` records fourteen things a client sees (two
file hashes, file metadata for a small and a large file, a commit-prefix
revision, the model's commit, the file list, a filtered snapshot, an LFS
download, cache blob names, a search, and the exception class for a missing
repository, file and revision and a gated repository); all fourteen equal
huggingface.co's through the edge, and all thirteen that apply equal them with
every file pinned to IPFS. On Windows without symlinks the cache blob names
are empty on both sides; on Linux (CI) they are the ETags.

Found while testing: `huggingface_hub` follows a redirect to a Hugging Face
host during its HEAD and then reads that host's headers, including
`X-Xet-Hash`, so a file the kernel sends to Hugging Face is downloaded through
Xet with a read token from the edge's endpoint. The edge first refused that
token request and the download failed; it now passes it through. The same
behaviour meant a planted defect (the git blob hash sent as a large file's
ETag) passed the comparison through Hugging Face; the comparison pinned to
IPFS failed on it (`large file metadata`), and that comparison is part of the
gate.

## The signed index and Hugging Face switched off

Measured on 2026-11-12 with a 14-model index built locally (`tools/index.mjs
<dir> 12` plus the witnessed models) and the edge started with Hugging Face's
API off and Hugging Face drained. Because the index's signature is made only in
CI, this run adopted the unsigned local index through
`adoptUnsignedIndexForTests`, which the server never calls. The kernel sent
`openai-community/gpt2`'s `config.json` and `model.safetensors` to ModelScope
and `.gitattributes`, which ModelScope does not hold, to IPFS; refs and the
file tree came from the index. `huggingface_hub` 2.4.0 against that edge
matched huggingface.co on all eleven checks that apply to an indexed model
(file hashes, file metadata, commit prefix, model commit, file list, snapshot,
cache blob names, and the errors for a missing repository, file and revision).
The `offline` job in `pages.yml` repeats this after each deploy against the
published, signed index.

## Prism accounts: the remembered passkey

The sign-in page (`identity/id.mjs`) remembers which passkey this device last
signed in with, so the browser asks for that one and skips its chooser, and
it names the device's authenticator ("Secured by Windows Hello"). The hint
must never decide that a device has no passkey: if it could, someone with an
account whose remembered passkey was removed would be sent to Create account
and end up with a second account.

| Gate | Planted defect | Result |
| --- | --- | --- |
| `npm run test:identity`, "a remembered passkey that is gone asks for any passkey, never straight to a new account" | the branch that forgets a remembered passkey which did not answer, removed from `run()` | rejected: `locator.waitFor: Timeout 10000ms exceeded` waiting for `#go-label` to read `Sign in`; restored, 20 of 20 pass |
| `npm run test:identity`, "a click the bar is redrawn under still opens the panel" | the frame before this fix, which opened the panel it was clicked on even after the bar was redrawn (found on holo-search: a first click right after load did nothing) | rejected: `not ok 2`, waiting for `#account-panel:popover-open`; fixed, 21 of 21 pass |
| same test, after the account panel became a centred dialog and the button reads "Continue with Windows Hello" | the same branch removed again | rejected: the button read `Create account` where `Continue with Windows Hello` was required; restored, 21 of 21 pass |

## The workspace page

The standard page became the workspace: a header row, the app's surface
beside a rail for its result, actions and history, and a spec that opens
beside the window (the frame's window and bar narrow by `--prism-aside`)
and loads only when opened. Plain dark replaced immersive as the default
theme. The page gates were run on three apps built with these files, as
`frame-sync.mjs --pin` gives them (Leap year, Luhn check, Legal chess, each
with its own holo and LexLean source):

| Gate | Result |
| --- | --- |
| `node bootstrap/screens.mjs site screens`, six size classes in three themes, the spec open and closed | every class passes in every theme, all three apps |
| `lhci autorun`, three runs each | 100 in all four categories, CLS 0, LCP about 1.21 s; 105 KiB (Leap year, Luhn) and 122,701 of 122,880 bytes (Legal chess, whose live page was already within 1 KiB of the budget) |
| `npm run test:identity`, `npm run test:try` | 21 of 21, 1 of 1 |

The screens gate's new check, that the workspace fits the screen, was first
written as "the page does not scroll". A planted defect showed it could not
fail: the page hides its overflow, so a workspace taller than the screen is
cut off rather than scrolled.

| Gate | Planted defect | Result |
| --- | --- | --- |
| `screens.mjs`, the workspace fits the screen (scroll only) | `main` made 4 rem taller than the screen | passed: the defect went unseen |
| same, checking that `main` ends inside the screen and holds its content | the same 4 rem | rejected in all 18 cases: `the workspace does not fit the screen: the page would scroll or cut it off`; restored, the three apps pass |

Lighthouse found two more before the change was done: the display's type
shrank once the script set its width (CLS 0.009 on Luhn check, fixed by
setting the first width in the hashed stylesheet), and `app.mjs` crossed the
unminified-JavaScript allowance (2,458 bytes against 2,048, fixed by moving
the spec into `site/spec.mjs`, loaded on first open, and shortening comments).

## A newer frame may add a file

`frame-sync.mjs --pin` judged a target commit's lock by this checkout's own
frame list, so the first frame to add files (`site/spec.css`, `site/spec.mjs`)
could not be pinned by any app that had an older script. The target is now
judged by its own frame: its `frame-sync.mjs`, matched to its lock, names the
files, read as text and never run, and each must sit under `bootstrap/` or
`site/` (or be `lighthouserc.json`). `--check` is unchanged. Run against real
commits and against mirrors served with `PRISM_TEMPLATE_RAW`:

| Case | Result |
| --- | --- |
| the old logic with the old fourteen-file list pins `128d80d` | refused: `frame.lock at 128d80d… is not a prism/frame-lock/1 lock of this frame` (the defect) |
| the new logic with the old list pins `128d80d` | pinned; `--check` then passes, 16 files |
| the new logic pins back to `76bdeb0` | pinned; `site/spec.css` and `site/spec.mjs` reported as no longer part of the frame |
| a mirror serves `site/app.mjs` with one line added | refused: its digest against the lock's; nothing written |
| a mirror's lock names a file its frame does not | refused: the lock's list against the frame's; nothing written |
| a mirror's frame and lock both add `.github/workflows/x.yml` | refused: `names files outside the page`; nothing written |
| an untouched mirror | pinned |

## Indexing an owner whole

`manifests/owners.txt` names owners, not repositories; `tools/index.mjs` reads
it beside `manifests/models.txt` and indexes every public model Hugging Face
lists under each name (`GET /api/models?author=<owner>&full=true`, the Link
header followed to the next page, the same one-call-a-second throttle and the
same reuse of a record already written for the same revision). `HOLOGRAMTECH`
is the first owner listed.

Measured on 2026-11-14. `node tools/index.mjs <dir> 2` built 20 records: 2 from
the catalog, 3 witnessed, 15 from `HOLOGRAMTECH`, 4 of the 20 complete. The
owner's listing is case sensitive: `author=hologramtech` answers 200 with an
empty array, `author=HOLOGRAMTECH` answers 15 models.

| Gate | Planted defect | Result |
| --- | --- | --- |
| `node tools/index.mjs <dir> 2` with the new owner list | `HOLOGRAMTECH` misspelled as `HologramTech` in `manifests/owners.txt` | refused: `index: HologramTech lists no public model with a release; check the name in manifests/owners.txt`; restored, 15 models indexed under the owner |

`HOLOGRAMTECH/q-ternary-bonsai-1.7b` was the model this list was added for. It
is on Hugging Face and not on the live hub, so its record's `sources` is empty:
`https://gethologram.ai/data/files/HOLOGRAMTECH/q-ternary-bonsai-1.7b.json`
answers 404, and `https://gethologram.ai/api/models/HOLOGRAMTECH/q-ternary-bonsai-1.7b`
answers 404 `RepoNotFound`. That is not a defect. An empty `sources` leaves
Hugging Face as the only slot that holds the file, and the kernel's source
choice (`HK-05`, `HK-06`) does the rest. Measured against the published holo
with the local index adopted unsigned:

| Request | Answer |
| --- | --- |
| `GET /api/models/HOLOGRAMTECH/q-ternary-bonsai-1.7b`, Hugging Face off | 200, `X-Hub-Partial: pipelineTag,libraryName,safetensors` |
| the same, Hugging Face reachable | asked of Hugging Face, no partial header (operation 6 plan 2) |
| `HEAD /HOLOGRAMTECH/q-ternary-bonsai-1.7b/resolve/main/q-ternary-bonsai-1.7b.v1.holo` | 302 to `huggingface.co`, `X-Hub-Source: huggingface.co`, ETag `acf0b5ad…`, size 424013749 |
| the same pinned `/via/modelscope.cn/` | 404 `SourceHasNotGotIt` |

So a user can fetch the file through the hub, not merely see it listed; what an
empty `sources` costs is the second copy, and with it the page's cross-source
check, which has nothing to compare.

The record carries 7 of the ten fields operation 6 names: revision, files,
tags, config, cardData, lastModified and gated. It is missing `pipeline_tag`,
`library_name` and `safetensors`, which the publisher has not set - the
repository ships one `.holo` file, not safetensors weights. The edge names
exactly those three in `X-Hub-Partial` with Hugging Face off, and asks Hugging
Face when it can. Nothing was filled in to make the record look complete.

Two things this change leaves as they are. A record with no source already
describes 147 of the 400 models in the live index, and the model page shows
its Verify button for all of them although there is nothing to compare, so the
button does nothing when clicked; that is older than this change.
`tools/web-routes.mjs` builds its model pages from the live hub's catalog, so
an owner's models have no prerendered page and open through `404.html`.

## HK-20: a record says where its own bytes come from

A record addressed every file and named the other places that held them, but
never said where it came from itself. The edge did not need telling - it has
`const HF = "https://huggingface.co"` and built the redirect from that - so the
gap only showed for a reader that is not the edge. A browser client holding a
record could check a file's address and still not know which host to ask. The
nearest thing in the record was `observed.source`, which names who counted the
downloads, not where bytes live; reading it as a resolve base would be one
field doing two jobs.

So a record now carries `origin`, the same shape a `sources` entry has and
good for the same one revision: `{ kind, resolve }`, where `resolve` is a base
a path appends to. `sources` keeps its meaning - the *other* places that hold
these bytes - and nothing claims Hugging Face twice. The edge reads `origin`
when its kind matches the slot the kernel chose, and falls back to its constant
for a record written before this existed. The record format moved to
`hologram.hub.release/v4`, which also forces every cached record to be rebuilt
rather than reused without the new field.

Two gates, because the claim has two halves, and each was shown to fail first.

| Planted | Gate | Diagnostic |
| --- | --- | --- |
| The resolve base written out by hand as `"https://huggingface.co/"` instead of built from what the builder read | `index_hk_20` in `crates/conformance/tests/index.rs` | `the origin's resolve base must be built from HF, not written out` |
| `const fromRecord = null` in `edge/edge.mjs`, so the edge ignores the record and uses its own constant | `tests/edge/origin.mjs` | three failures, including `a record whose origin is a mirror is followed to the mirror` |

The second gate needed designing before it could fail at all. Every record
today names Hugging Face, which is exactly what the edge's own constant says,
so comparing the redirect against the record would have passed even with the
field ignored entirely. The test therefore moves one record's origin to
`https://mirror.invalid/held/`, a base the constant could never produce, and
that is the check that can actually fail. A gate that cannot distinguish the
implementation from its absence is not evidence, however green it reads.

### A cached target directory can make a test read a different repository

`crates/model`'s `repo_root()` is `env!("CARGO_MANIFEST_DIR")`, resolved when
the binary is compiled, not when it runs. The SDK volume holds both a shared
`CARGO_TARGET_DIR` at `/tmp/hub-target` and a copy of the tree at `/tmp/hubvv`
that `just vv` made earlier. A binary built during that run bakes
`/tmp/hubvv/crates/model`, so a later `cargo test` using the same target
directory against the mounted `/w` reads `/tmp/hubvv/tools/index.mjs` - a tree
that can be hours old - while appearing to test the working tree.

This is not hypothetical: it is how `index_hk_20` was first seen to fail, and
how `cargo run -p xtask -- check-model --write` wrote `/tmp/hubvv/CONFORMANCE.md`
and left the real one stale. The symptom is a test whose result does not change
when the file it reads does. `cargo clean -p repo-model -p xtask -p
repo-conformance` rebuilds with the right path baked in; `just vv` is unaffected
because it makes its own fresh copy. Any source-reading gate is exposed to this,
which is the cost of a gate that reads a file rather than running code.

### The record format moved without a refetch, and the anchor moved with it

Moving the format to `v4` would have invalidated every cached record, and a
record is reused only when the release has not moved, so the first run after
it would have paid two Hugging Face calls for each of five hundred records at
the one-a-second pace `hf()` keeps - about twenty minutes in a job that is
normally almost free. But a `v3` record already holds everything a `v4` record
does except `origin`, and this builder has only ever read Hugging Face, so that
record's origin is not a guess: it is the string the builder would write for
it. The builder upgrades such a record in place instead. Checked by building a
fixture of `v3` records, applying the upgrade, and running
`tests/edge/origin.mjs` over the result. `pages.yml`'s build job still moved
from 45 to 60 minutes, because a run that genuinely cannot reuse the cache
must finish rather than look like a flake.

That upgrade broke `index_hk_18` and `index_hk_20` the moment it was written,
and the break is worth recording because it is the failure mode of every gate
that reads source. `record_literal` found the record by its format string, and
the upgrade names the format too, earlier in the file. So the test began
reading the upgrade expression as though it were the record. It is now
anchored on `record = {` followed by a newline, which the one-line upgrade
cannot match. The planted defect was re-run after the anchor moved -
`the origin's resolve base must be built from HF, not written out` - because an
anchor change is exactly what can make a gate vacuous while leaving it green.
