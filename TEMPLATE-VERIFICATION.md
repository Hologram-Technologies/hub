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
whole. Which owners to fetch is read from the signed index the deploy is
assembling, not from the live hub's catalogue, so a mark is never kept for a
row the page does not draw. Measured on 2026-11-14 against the published index
(400 records, 210 distinct owners): 209 marks, 1,121 kB, one owner without a
mark and keeping its initials. The earlier figure of 249 files and 1.3 MB,
measured on 2026-11-13, was over the live hub's 500 catalogue rows, which is a
different and larger set of owners.

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

## A source no redirect can name (HK-19), and the runner that can reach it

The edge cannot use Pirate Face, and measuring why decided the whole design.
A magnet link is not something a `302` can point a Hugging Face client at, so
the obvious bridge is BEP-19: Pirate Face's magnets carry a web seed, and a web
seed is plain HTTP. Measured 2026-11-14 on `Qwen/Qwen3.8-27B`, the web seed
`https://pirateface.co/api/ws/Qwen/Qwen3.8-27B/1d4bf0f2.../config.json` answers
`302` to `http://187.127.110.248:8787/...`, a volunteer on plaintext HTTP, the
same address on three consecutive calls; following that one hop returns, from
`BaseHTTP/0.6 Python/3.12.3`, a second `302` to
`https://huggingface.co/Qwen/Qwen3.8-27B/resolve/1d4bf0f2.../config.json`. The
same for a 3 GB weight file. Zero bytes came from the swarm. Adding that as a
vetted HTTP source would have built a failover path that ends at the host it
was failing away from, and `HK-07` would have preferred it. One model at one
moment, so not the whole catalog - but enough to stop building on it.

So the swarm is reachable only by a runner that holds bytes, and `runner/` is
that runner. The kernel needed one new theorem for it to be safe.

The resolve request has exactly four source slots (`app/tools/gen_kernel.py`,
bytes 8 to 23, four fields each). `edge/edge.mjs` names three and pads the
fourth with zeros, so one was free; the runner uses it for `pirateface`. A
fifth would move the request from 104 bytes to 108, change the "no source"
sentinel from 4 to 5 in every response and every pinned vector, widen operation
4 from five bytes to six, and re-prove `Vetted`, `Sound`, `Pin` and `Healthy`,
each of which names the four slots explicitly. Nothing here needed that.

`pirateface` is never vetted, and that is what the word means: a vetted source
is one the edge may redirect a client to. `HK-04` therefore keeps the swarm off
the edge for every input, already proved, with no new code. What was missing is
the other half. `eligible` read `holds && !failed && (runner || vetted)`, so a
local runner could fetch from a source nobody vetted for a file the record
gives no address for - and then the only thing standing between the swarm and
the cache is a check written by hand. `HK-19` closes that: `eligible` now reads
`holds && !failed && (vetted || (runner && entry == 2))`, and `addressedHolds`
proves no input reaches `breaksAddressed`, which is a chosen source that is not
vetted for a file the record does not address.

This is not a hypothetical. Running the runner against the published holo,
which predates `HK-19`, a request for `openai-community/gpt2/config.json` with
the HTTP sources failing reached the swarm - and `config.json` is a small file
with no SHA-256 in the index. The rule changes real behaviour on a real
request.

An independent reference implementation of `select` was enumerated over every
input it reads: 2,359,296 combinations of runner, pin, entry and the four
sources' sixteen bits. No input met `breaksAddressed`, `breaksVetted`,
`breaksSound`, `breaksSourced`, `breaksPin` or `breaksHealthy`. The planted
defect was to drop the address requirement, leaving `vetted || runner`: 110,336
inputs then met `breaksAddressed`, the first at `runner 1, entry 0`, with slot
three holding the file and vetted by nobody. The condition is not vacuous.
`kernel_hk_19` pins its exact text, and `kernel_vectors_match_reference`
requires the holo's 68 vectors to be the reference's; two of those vectors are
new, a local runner and an unvetted source with and without an address.

Proved on 2026-11-14 in the SDK image `prismpm.lock` pins, with LexLean 0.3.0
and Lean 4.32.1. Before `HK-17` merged, `lexlean verify` verified 24 modules
in 7 minutes 6 seconds, attestation
`e5567e6d7160658bc286b6cf19a81840c0e902bfc9635930c51de207fc945c02`. With the
second witness merged the model is 25 modules, and `lexlean verify` verifies
them in 7 minutes 26 seconds, attestation
`eb7679443cadc1280bf9d201bd3c57a9924279d746fc59a44b00a42111c2f195`. That is
the attestation for this tree. The earlier figure is kept because the mount
measurement below was taken against the model it names. `addressedHolds` is proved by
`linear_arithmetic` on `Quot.sound` and `propext`, as `kernel_hk_19` requires.
`lexlean fmt --check` and `lexlean lock --check` pass, and
`cargo test --workspace` passes with `kernel_hk_19`, `kernel_hk_17` and
`index_hk_18` together, 19 in the kernel suite.

The planted defect was then run through the same gate. Weakening `eligible`
in `src/Kernel.lex.tex` to `(vetted =? 1) || (runner =? 1)`, which is what it
said before `HK-19`, and leaving every proof untouched, `lexlean verify`
refused in 2 minutes 58 seconds with `LLV7002`:

    Lean rejected `HologramHubKernel.Proofs.Addressed` (error): omega could
    not prove the goal: a possible counterexample may satisfy the constraints
    0 <= a <= 1 where a := facts.entry
      --> src/Proofs/Addressed.lex.tex:15:1

`entry` is 0 when the record has no entry for the file and 1 when the file is
small, so the counterexample Lean names is exactly the case the claim is
about: a file the record gives no address for. Restored, the tree verifies
again with the attestation above. The gate can fail, and it fails for the
right reason.

The other six parts of `just vv` pass in the same image: `fmt-check`, `model`
(`validate: every gate passed`), `template-check` (`template contract passed`,
`SDK lock is canonical and valid`), `lint`, `test` and `deny`. `just app` is
the part not run here, for the reason below.

Running LexLean on the Windows-mounted checkout is slower, not broken, and the
difference is worth stating because the first measurement taken here said
otherwise. `lexlean verify` on the mounted tree completed in 12 minutes 53
seconds; the same command on a copy of the model inside the container's own
filesystem took 7 minutes 6 seconds. Both answered with attestation
`e5567e6d7160658bc286b6cf19a81840c0e902bfc9635930c51de207fc945c02` - the same
model, verified from two filesystems, to the same attestation. The second of
those runs was on the tree after the claim was renumbered from `HK-18` to
`HK-19`, which is the direct evidence that renumbering an id leaves the proved
artefacts alone.

That is worth stating as a rule, because the next person to renumber will
otherwise derive it the slow way. An id lives in exactly two places that are
written by hand - its row in `model/ids.toml` and its row in the `CASES` table
in `app/tools/write_tests.py` - and in the files generated from those two. It
never reaches the Lean: `gen_kernel.py` names invariants by module, not by id,
so `app/src/`, `app/tools/vectors.json` and `app/lexlean.lock` come out byte
for byte the same. A renumbering is therefore a documentation change wearing a
model change's clothes, and it needs no new proof. The check is the attestation
not moving, and the gate will say so by not moving it.

An earlier run of that same command on that same mount used no CPU at all for
twenty minutes and was abandoned. It overlapped a `prismpm verify` working the
same mount from a second container. A process blocked in I/O wait accrues no
CPU time, so `docker top` shows `00:00:00` for one that is stuck rather than
idle, which is what made it look like a hang rather than a wait. Contention on
the mount is the likely cause; one sample each way does not establish it, and
it is recorded here as unverified. What is established is that the mount alone
does not stop `lexlean verify`.

A third run narrows it further. The merged model, 25 modules, verified on the
same mount in 7 minutes 26 seconds against the 12 minutes 53 seconds the
24-module model took, because `.lexlean` was warm by then. Most of the mount's
cost is writing the staging tree, and it is paid once rather than per run.

Do not copy the whole of `app/` to work around it. `app/target` is 1.7 GB after
a `prismpm verify` and walking it over the mount takes minutes; `src/`,
`language/` and the five project files are enough, and that copy takes six
seconds.

`runner/swarm.mjs` is a leeching BitTorrent client with no dependencies, which
matters because this repository ships none: `package.json` has two
devDependencies and nothing at run time. It announces to an HTTP tracker,
speaks the peer wire protocol over TCP, and hands on a piece only when its
SHA-1 equals the hash the infohash committed to. `runner/torrent.mjs`
recomputes that infohash from the metadata's own bytes, so a `.torrent` from a
host nobody trusts is refused unless it hashes to the infohash the magnet
named; `tests/runner/torrent.mjs` plants a single flipped byte in one piece
hash and requires the refusal. It does not seed, speak UDP trackers or the DHT,
or use web seeds, for the reason measured above.

Measured live on 2026-11-14 (`tests/runner/live-pirateface.mjs`, not part of
`just vv` because it needs real peers): `openai-community/gpt2` at revision
`607a30d783df`, which is the revision the hub's own record names, 6 seeders,
infohash `008ff5a52ed1f80a72e74b23acc3830d12135162`, a 28,407-byte `.torrent`
whose info dictionary hashes to that infohash, 25 files and 1,343 pieces of
4,194,304 bytes over 5,632,416,850 bytes. The HTTP tracker named 7 peers, and
two pieces - 8,388,608 bytes - arrived in 10.0 seconds, each matching its
committed hash.

The whole path, measured 2026-11-14. A request to
`/via/pirateface/openai-community/gpt2/resolve/main/64-8bits.tflite` answered
`200` with 125,162,496 bytes in 47.8 seconds, from 7 peers over 30 pieces, and
the bytes hash to `c966da3b74697803352ca7c6f2f220e7090a557b619de9da0c6b34d89f7825c1`,
which is the address the signed index names. Every piece was checked against
the infohash on the way in and the whole file against the record before any of
it was served. That is a model weight file fetched from a BitTorrent swarm and
handed to a Hugging Face client, with nothing trusted along the way.

The same request from `huggingface_hub` 2.4.0 fails, and the reason is worth
recording because it is not a defect in either side. A file is served only
after all of it has been checked, so a cold fetch answers nothing for 48
seconds; the client's read timeout is ten, and it sees silence rather than
progress. It then retried, and each retry started another download of the same
torrent: four concurrent fetches competing for the same four seeders, reported
as `the swarm delivered 0 of 30 pieces before the deadline`.

Streaming pieces as they arrive would fix the timeout and break the claim.
BitTorrent checks each piece against the infohash, so streamed bytes would be
intact, but the infohash comes from the swarm's own index and only the address
in this hub's signed record says the torrent is the file it claims to be.
Streaming sends bytes before that question is settled, which is what `HK-19`
exists to prevent. So the wait stays and moves to `runner/pull.mjs`, which is
not a Hugging Face client and does not mind waiting; afterwards the bytes are
in the cache under their address and a client is answered from them at once.

Two changes came out of that run. Fetches are now coalesced per address, so a
retry joins the download in flight instead of starting a rival one. And the
fetch verifies and moves the bytes into the cache before it returns, because
the first version of the coalescing handed waiters a path that the request
which started the fetch was about to rename - a race that only exists once
more than one request can want the same file, which is exactly what a retrying
client produces.

The three steps together, measured 2026-11-14 on one machine. Ask what the
swarm has: `/api/swarm/openai-community/gpt2` reports the revision matching the
hub's record, 4 seeders, and the infohash recomputed. Pull it:
`runner/pull.mjs ... --via pirateface` fetched 125,162,496 bytes in 42.1
seconds and left them in the cache. Use it: `huggingface_hub` 2.4.0 with
`HF_ENDPOINT` pointed at the runner and no pin at all returned the file in 2.6
seconds, hashing to the address the signed index names. The client was not
modified, told nothing about torrents, and never saw one.

Discovery is the other half and is reported apart from it, because peers decide
whether bytes can be fetched and addresses decide whether they can be believed.
`node runner/discover.mjs qwen` found 67 models with a torrent. For
`openai-community/gpt2`, `/api/swarm/{repo}` reports the revision matching the
hub's record, 4 seeders, the infohash recomputed from the metadata, 25 files,
5,632,416,850 bytes over 1,343 pieces, and `servable` as 11 addressed of 26
files. A model with peers and no address is one that can be downloaded and not
checked, and it is printed as that rather than as a result.
`tests/runner/discover.mjs` covers the parsing, the revision mismatch, the
absent repository and the tampered torrent in 5 checks with no network.

What a Hugging Face client sees is the point, and it sees nothing. Measured
2026-11-14 with `huggingface_hub` 2.4.0, `tests/edge/observe.py` run against
huggingface.co and against the local runner, and `compare.py` over the two:
14 of 14 checks identical - file hashes, large and small file metadata, an LFS
download, the commit prefix, the model commit, the file list, the snapshot,
the cache blob names, the search, and the errors for a missing repository, a
missing file, a missing revision and a gated one. The runner reported no
failed source in that run, so every byte it passed on had matched its address
first.

Two defects were found by running that comparison rather than by reading the
code. A HEAD was answered by downloading the file: `huggingface_hub` sends one
before every download, so describing `model.safetensors` fetched 548 MB and the
client timed out. A HEAD now answers from the record alone, and
`tests/runner/serve.mjs` requires the cache to be empty afterwards. The other
was an import removed while refactoring, which made every HTTP source fail and
sent the kernel to the swarm for a file it should not have been asked for.

A fourth was found by the live check, and only by it. A peer whose TCP
connection never established left its promise pending: a socket's `setTimeout`
in Node is an inactivity timeout and does not cover connecting, so an
unreachable peer held the whole download open until the operating system gave
up minutes later. Both pieces had already arrived and been verified; the run
simply never finished. The connection now carries its own deadline, and a
socket that closes before the handshake is a failure rather than silence. The
same run also caught a scope error in the fix for it, which made every peer
fail on its first byte: with the error swallowed per peer, the only symptom was
a swarm that found seven peers and downloaded nothing.

A third came out of writing the tests. The runner was marking a source that
timed out or answered 404 as having failed verification, which is the kernel's
`failed` bit and a lasting judgement about that copy. Not being able to reach a
source is not evidence that it sent the wrong bytes. `failed` is now set only
when bytes arrive and do not match, and a source that could not deliver is
marked as not holding the file for that request alone. The test that caught it
had asserted the wrong thing and passed for the wrong reason: Hugging Face is a
candidate for any file an index record lists, whatever sources the record
names, so the case that was meant to leave the kernel with nothing had in fact
left it with one.

`tests/runner/serve.mjs` runs the whole path against one source that serves the
bytes the record addresses and one that serves something else: 10 checks
against the published holo, with `tests/runner/torrent.mjs` at 10 and
`tests/runner/uor.mjs` at 7. A pinned source that sends other bytes is refused rather
than served; with the good source drained, the kernel reaches the healthy bad
one first, the runner refuses its bytes, and `HK-05` sends it back to the
drained source, which has them. A warm cache does not override a refusal: the
cache is a shortcut, and a delivered file always has a source (`HK-02`,
`HK-05`).

Not established here: `prismpm --project app verify` did not complete on this
machine. It ran Lean on the generated kernel and then stopped making progress
in a later stage, which matches what this file already records about the
Hologram oracle stage on a Windows-mounted checkout. `lexlean verify` completes either
on the mounted tree or on a copy inside the container, as above. The holo was
therefore not rebuilt here, so `tests/runner/kernel.mjs`, which pins the
answers `HK-19` changes, has not been run against a holo that contains it. The
other runner tests ran against the published holo, as the edge tests do.

The second witness does not yet reach the runner, and saying otherwise would be
the easy mistake now that `HK-17` is on main. `tools/index.mjs` keeps a second
witness's addresses in `record.witnesses[].addresses[]` and deliberately out of
`files[].sha256`, because the edge reads that field to decide whether a file is
an LFS file and so which ETag `HK-08` hands a client. The runner reads
`files[].sha256` too. So for the fifteen `openai-community/gpt2` files Hugging
Face gives no address for, `entry` is still 1, `HK-19` still keeps the swarm
off them, and the swarm serves the eleven addressed files and not the other
fifteen.

Closing that is not a matter of reading the other field. `entry` carries two
meanings at once - whether the file is LFS, which decides the ETag, and whether
the record addresses it, which decides `HK-19` - and they have been the same
thing only because both came from the LFS pointer. A second witness separates
them. Setting `entry` to 2 because a witness named an address would change the
ETag for those fifteen files and break the wire the edge tests pin, which is
the trap `tools/index.mjs` already names in its own comment. The honest fix is
a separate `addressed` fact in the resolve request, which moves it from 104
bytes to 108 and re-proves every theorem that names the slots. That is a change
of its own and is not made here.

## An address that outlives the host that gave it

Measured 2026-11-14 against <https://pirateface.co>: 669k models listed,
25,825 with a magnet, 38,257 seeding, against this hub's 415 indexed. So 3.9
per cent of the catalog has a torrent and the rest is a link to Hugging Face
and a checksum, both of which end when Hugging Face does.

`/api/models` is cursor-paginated and hard-capped at 30 rows; `limit`,
`seeded`, `filter`, `sort` and `hasTorrent` were each passed and each ignored,
so a full sweep is about 22,300 requests. `sitemap.xml` has 42 entries and
lists no models. `/s/<query>` returns only models with a magnet, which makes it
a magnet-only view but a query-driven one.

Indexing that catalog is the wrong goal, and the reason is the one that
decides the design. A model is self-verifying only against a digest from
somewhere other than the party serving the bytes, so Pirate Face's own SHA-256
cannot check bytes from Pirate Face's swarm. `HK-19` already says it in the
kernel's terms. While Hugging Face answers, the runner asks it for the address
and the swarm for the bytes and they are different parties; when it stops,
there is no second independent answer and the swarm is refused.

So two things are built and kept apart. Discovery is answered live -
`/api/swarm/search?q=` relays the catalog with `claimedBy` naming the party and
`checked` false - and covers all 669k with no index and nothing to go stale.
Addressing is written down, because it is the part that expires:
`tools/swarm-index.mjs` records `{ repo, revision, files: [ { path, size,
sha256 } ] }` from Hugging Face's tree for the seeded releases. No magnet and
no infohash, which are fetched live and are not lost.

Measured on a two-page walk: 9 releases scanned, 9 with a torrent, 8 addressed
across 476 files, none already gone from Hugging Face. Run again against the
same output, 8 of 8 were reused and nothing was fetched, which is what makes
the nightly job cost the catalog walk and almost nothing else.

`tests/index/swarm-shards.mjs` is the gate. It checks every shard against the
root, that the root's count matches what the shards hold, that the snapshot
names Hugging Face as the source of its addresses, and that every row carries
a revision and at least one file with a 64-hex SHA-256 and a size - a row with
no address is useless and a row addressed by the swarm would be worse. The
planted defect is one byte inside one shard's first `"sha256":"`, which leaves
the snapshot parsing and describing the same releases; it was refused.

`runner/snapshot.mjs` is used in exactly one place: a release neither the
signed index nor Hugging Face can describe. `tests/runner/snapshot.mjs` checks
that such a release stops being answered as missing, that it then reaches the
question of which source holds it rather than failing before it, that a HEAD
is answered with the recorded address and revision and the SHA-256 ETag
`HK-08` gives an addressed file, that a file the snapshot does not list is
still not found and a repository it does not hold is still missing, and that a
shard which does not match the root is refused and the release goes back to
missing. Five checks, no network beyond the holo.

Not established here. The snapshot has only ever been built two pages deep;
the full walk has not been run, and its first run will take about two hours
before the reuse above makes it cheap. Nothing is published yet, because the
nightly workflow has not run, so `pages` finds no snapshot in the cache and
publishes none - which it is written to tolerate. And the predicate type
`https://hologram.foundation/hub/swarm/v1` is a constant in
`runner/snapshot.mjs` rather than a field of the kernel's trust policy: the
pinned Sigstore roots and the workflow identity are the kernel's, but that one
string is not, and moving it there is a model change that has not been made.

## Checking every address a record has, not the first one

A second witness made two things that had always been the same thing
different, and the difference is who chose a digest rather than how strong it
is.

`addressOf` on `claude/addressed-fact` returns the release's own
`files[].sha256` and, failing that, an address from any witness. There is one
witness on main and it is `pirateface.co`, which is also the operator of the
`pirateface` source. Measured on the live record for `openai-community/gpt2`:
`witnesses[0].source` is `pirateface.co` and 14 files are addressed by it
alone - `README.md`, `config.json`, `generation_config.json` and the rest of
the small ones. Letting a witness address stand for those files would have had
the runner fetch bytes from Pirate Face's swarm and check them against Pirate
Face's own digest.

Worse than that, it would have removed a check rather than added one. `check`
guarded the git-blob branch on `if (!address)`, so a non-null witness SHA-256
did not supplement the independent SHA-1, it replaced it. The comment above
`check` described the invariant - a source nobody vetted is never chosen for a
file with no SHA-256 - and the code did not enforce it, because `address` and
"independently addressed" were the same thing when it was written. A comment
that is true when written and silently falsified by a widening elsewhere is a
failure mode no gate here catches, and this is the first one recorded.

The hash question is not the one it looks like. The attack on a git blob
identity is a second preimage, not a collision: the genuine file already
exists, its digest is fixed in a signed record the attacker cannot author, and
the `blob <size>\0` prefix pins the length - which the record carries
separately as well. SHAttered was a chosen-prefix collision, which needs the
attacker to write both messages. Second preimage on SHA-1 is not broken.
Against an adversary who is the source, an independent SHA-1 is worth more
than a SHA-256 that adversary supplied, which is worth nothing.

So `check` now computes both digests in one pass over the bytes and refuses if
either fails, and refuses a file the record addresses in neither way rather
than passing for want of something to compare. `tests/runner/serve.mjs` lists
a file whose SHA-256 is right for the bytes the source serves and whose git
blob identity is not - which is what a witness supplying an address for bytes
it also serves looks like - and requires the refusal. It also lists a file
with no address of any kind and requires that, which until now was refused
only because a computed digest is not equal to `undefined`.

All 14 of those gpt2 files carry a 40-hex `gitSha1` and a size in the signed
record, so the independent address is written down here and does not depend on
Hugging Face still answering.

`tools/swarm-index.mjs` was recording only `f.lfs?.oid` and so kept weights
and dropped every small file. Measured on four releases: 99 addressed files,
57 by SHA-256 and 42 by git blob, where those 42 were being discarded. A
snapshot of 25,825 models' weights without their `config.json` and tokenizer
keeps the bytes and loses the models. Reading one gives a file with a SHA-256
an LFS entry and a file with only a git blob identity a small entry, so
`HK-08` hands back the ETag it would have.

## A fixture that agreed with the mistake

Checking every address a record carries shipped with a defect that refused
every weight file, and it reached main because the test that should have
caught it was written from the same misunderstanding as the code.

`gitSha1` is the git blob of whatever git holds for a file. For a file git
holds whole that is the content. For an LFS file git holds a 134-byte pointer,
so `gitSha1` hashes the pointer and says nothing about the bytes. Measured on
`openai-community/gpt2`: `64-8bits.tflite` is 125,162,496 bytes, its record
entry carries `gitSha1 90e59f00f62c654b1a88a5f127dff14df4611cdc` and
`pointerSize 134`, and fetching `/raw/<revision>/64-8bits.tflite` returns 134
bytes whose git blob is exactly that `gitSha1`. The pointer, not the content.

The new `check` compared the git blob whenever the record carried one, so for
every LFS file it hashed 125 MB of content and compared it to the hash of a
134-byte pointer. Every weight file would have been refused - the whole
capability, on main, for about twenty minutes.

`tests/runner/serve.mjs` passed throughout, because its LFS fixture set
`gitSha1` to the git blob of the content. The fixture was not wrong about the
code; it was wrong about Hugging Face, in the same way the code was, so the
two agreed. Rewriting the fixture to carry the pointer's hash reproduced the
failure immediately: the first case went from 200 to 503.

`check` now compares the git blob only where `entry` is not 2, which is
exactly where Hugging Face publishes no SHA-256 and the git blob is the only
address there is. Restored, a real LFS file and a real small file both serve:
125,162,496 bytes of `64-8bits.tflite` hashing to
`c966da3b74697803352ca7c6f2f220e7090a557b619de9da0c6b34d89f7825c1`, and
`config.json` at 665 bytes, with nothing refused.

The dual-address property moved to `tests/runner/check.mjs`, which exercises
`check` directly, because it cannot be reached through a record: a witness
address never lands in `files[].sha256`, so a small file with a SHA-256 beside
its git blob identity has no serve-path representation. Seven checks, covering
both addresses agreeing, each one disagreeing while the other agrees, the LFS
pointer case, a file with no address, a large file with no digest, and a file
of the right length holding other bytes.

The lesson is narrower than "test against reality". A fixture written by
whoever wrote the code tests that the code does what its author meant, and
that is worth something, but it cannot test whether the author understood the
format. The only thing that caught this was reading a real record and then
fetching the pointer to see what the field actually hashed.

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

The second of those is no longer so, as of the change below: `web-routes.mjs`
reads the signed index it is assembling beside, which holds every owner's
models, so each one gets a prerendered page like any other.

## What the hub reads from the live hub

This repository was building itself from the hub it means to replace: the list
of models to index, the search behind a witnessed model, the model list the two
page tools worked from, and the edge's run-time source records all came from
gethologram.ai. Cut on 2026-11-14, with what was measured each time.

| What | Was | Is | Measured |
| --- | --- | --- | --- |
| which models to index | `gethologram.ai/api/models?limit=500` | `huggingface.co/api/models?sort=trendingScore&direction=-1&full=true` | the two lists agree on 367 of 500 ids and on the head of the order; Hugging Face carries `sha` on 500 of 500 rows against the live hub's 399 |
| a witnessed model outside the list | the live hub's search, then Hugging Face | Hugging Face by name | 8 records from a 6-row seed plus the 2 witnessed models |
| the catalog's bytes | whatever shape the list arrived in | a projection of thirteen named fields | 5,632 bytes for 8 rows, against 2.0 MB for the 500-row `full=true` answer it is cut from |
| the edge's source records | `gethologram.ai/data/files/{repo}.json` at run time | the signed index alone | see below |
| the page tools' model list | `gethologram.ai/api/models?limit=500` | the index being assembled beside them | 13 route pages and 8 owner marks from an 8-record index, exactly its 8 repositories |

`full=true` is what carries `sha`; the plain listing carries it on none of its
500 rows, so the seed cannot be the cheaper call.

The edge's change is the one that alters an answer. `holders()` used to fetch
an unsigned record from a third host and hand it to the kernel as the fact of
which sources hold a file. It now reads the signed index, whose bytes were
hashed against the root the edge verified at start, and nothing else. Measured
on 2026-11-14 against the published index (400 records):

| Request | Answer |
| --- | --- |
| `/via/ipfs/openai-community/gpt2/resolve/main/config.json` | 302 to `ipfs.filebase.io`, `x-hub-source: ipfs` |
| `/via/modelscope.cn/openai-community/gpt2/resolve/main/config.json` | 302 to `modelscope.cn`, `x-hub-source: modelscope.cn` |
| the same `/via/ipfs/` on `hf-internal-testing/tiny-random-gpt2`, which the index does not hold | 404, `x-error-code: SourceHasNotGotIt` |

So a pinned source still works for an indexed model and is refused for one the
index does not name, rather than answered from somebody else's word. The live
hub answers 404 for that model's source record too, so nothing that worked
before stops working; what changes is the case of a model the live hub indexed
and this one did not, which is now refused.

One build-time read is left, named apart from Hugging Face in the index
signature's predicate: `gethologram.ai/data/files/{repo}.json`, which says
which other sources hold a release's bytes. Nothing here re-derives it, because
that claim has to come from whoever hashed those bytes. A release it does not
answer for is indexed with no second source: measured on an 8-record build,
5 of 8 records carried one. `docs/live-deployment.md` has the rest.

So the dependency is narrowed rather than cut, and the narrowing has a price
worth stating. Measured on 2026-11-14, sampling the two 500-row lists: of 20
ids both lists hold, 20 have a `/data/files` record; of 20 ids only Hugging
Face's list holds, none do. The non-overlapping third of the new seed is
therefore a third that can carry no second source until something here derives
one. What it costs is the model page's cross-source check, not the download: a
record with an empty `sources[]` still resolves, because the Hugging Face slot
is filled from the file's presence in the tree and not from that list.

The live row carries a `hologram` block (`manifest`, `files`, `weight_bytes`,
`parameters`, `context`, `sources`) that the new seed does not. Nothing here
read it: `tools/index.mjs` takes parameter counts from Hugging Face's
`safetensors` and sources from `/data/files/{repo}.json`, and neither it nor
`tools/facets.mjs` mentions `row.hologram` at all. Losing the block costs this
index nothing it was using.
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

### A claim can need no new proof, and the attestation is how you know

`HK-20` registered an id, a scenario and two tests, and moved a record format,
an edge code path and a CI step. It added no theorem. So `app/src/`,
`app/tools/vectors.json` and `app/lexlean.lock` came out byte for byte the
same, and `just vv` verified the same attestation as the run before it,
`8678abcd344fc1ee1eb6c35e6475ba696c620e3abf8a0285aab5a22d6ffacd48`.

That is worth recording because the natural assumption is the opposite: that a
new claim means a new proof, and that an unchanged attestation after a day's
work means something was not rebuilt. Here it is the confirmation. An id lives
in `model/ids.toml` and in the `CASES` table in `app/tools/write_tests.py`, and
`gen_kernel.py` names invariants by module rather than by id, so nothing about
registering `HK-20` could reach the Lean. The gate agreeing by not moving is
the cheapest available check that the change was the kind of change it was
believed to be - and an attestation that *had* moved would have been the signal
to stop and find out why.

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

## The roll, and the two rules that make it worth keeping

`tools/roll.mjs` writes one line for every model Hugging Face has ever listed
and for every model it has stopped listing. It is worth keeping only if it
remembers what Hugging Face forgets, and only if a reader can tell whether a row
of it is this hub's answer. `tests/roll/tombstone.mjs` runs exactly those two
rules, and `.github/workflows/roll.yml` runs it on every push.

Measured 2026-11-14. One hour of the Hub is one call. The test builds that hour,
plants a model that never existed inside it, rebuilds the same hour, and checks
that the planted model is still there and marked gone, that no model the listing
still names was marked gone, and that a shard changed without its root is
refused. Eleven checks, all passing.

**The planted defect.** The tombstone loop skips a row it saw this run
(`if (row[4] === now) continue;`). Replacing that guard with an unconditional
`continue` means nothing is ever tombstoned - a plausible mistake, and one that
leaves every other behaviour intact.

Failing command: `node tests/roll/tombstone.mjs`. Diagnostic:

    FAIL and it is marked gone: state 0
    FAIL the root counts the gone one: {"listed":157,"gone":0,"withheld":1}

Exit 1 with the defect, exit 0 with it restored, and nine of the eleven checks
passed either way - including "the planted model is still there", because the
row survives whether or not it is judged. A gate that only checked survival
would have stayed green.

## A measurement taken from the wrong sample

Worth recording because the error was invisible and the correction changed a
decision.

`docs/model-roll.md` first sized a roll line at 60 B raw and 17 B gzipped,
giving 185 MB for three million models. The real figures, measured by running
`tools/roll.mjs` over a day - 3,970 models from four calls - are 119.1 B raw and
42.9 B gzipped, or 367 MB and 132 MB.

The estimate came from a sample of listing rows fetched without `full=true`.
That flag is what carries `sha`, so every row in the sample serialised its
revision as `null`: four characters where a real row carries forty. On a
sixty-byte record that is a thirty-six byte error, and nothing about the sample
looked wrong.

The correction moved the roll from 18 to 36 per cent of what GitHub Pages
allows, which still fits, and moved the cheapest shard count from 1,024 to
2,048. The lesson is narrower than "measure rather than estimate": the sample
has to be the shape the thing will really have, and a flag that changes whether
a field is present changes its size.

## Pirate Face's models, drawn as models

### One rule in two files is a shard nobody can find

The swarm catalog is about 300 MB of rows, so the page reads one shard for a
search and no other. Which shard is decided twice: `tools/swarm-catalog.mjs`
chose where to write a row, and `web/hub.mjs` chose where to look for one.
They did not agree. The builder keyed on the model's name, so
`DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-Instruct-uncensored-abliterated-18.4B-GGUF`
went to `ll`; the page keyed on the first two characters of whatever was
typed, so a reader searching `llama` asked for `ll` and found it, while one
pasting the id asked for `me`, `da` or `qw` and was told the swarm holds
nothing. The builder also guarded its key with `[a-z0-9_.-]` and the page with
nothing, so the two disagreed again on any name starting outside that set.

Neither was wrong on its own. Both were the same claim written twice, which
`R1` forbids for exactly this reason: nothing fails, rows simply stop being
findable, and no amount of checking either file catches it. The rule now lives
in `web/swarmkey.mjs` and both import it. `web/` is published whole by
`pages.yml`, so one file serves a build-time tool and a browser.

`HK-21` is the claim, `index_hk_21` reads both files and fails if either grows
its own copy, and `tests/index/swarm-catalog.mjs` holds the built shards to it
by recomputing every row's key from the artifact.

### The gate that proves the other gates were not enough

`tests/index/swarm-catalog.mjs` was written against a catalog built with the
shard key replaced by the model's *organisation* - a single-token change in
the builder. Every other check still passed: the shards matched their hashes,
the root's counts matched the shards, every row carried its fields, the rank
pages were in order. Only `every row is in the shard the page will look in`
failed, naming the row, the shard it was in and the shard it belonged in:

    FAIL every row is in the shard the page will look in:
      adventists-ai/Sophon-Realtime-v1 is filed under ad,
      but its name belongs in so

That is the shape of the defect this gate exists for. A catalog can be
internally consistent, correctly signed, and completely unsearchable, and the
hash checks cannot tell the difference. The builder was restored and the
checks pass again.

Two smaller things the same run found. Pirate Face sends `params: 0` for a
model whose size it does not know, and `??` let the zero through, so a row
claimed a model with no parameters rather than a model whose size is unknown;
it is `||` now. And `tests/runner/kernel.mjs` shipped with the runner in `#8`
and was in no workflow, so it had never run in CI - it is in `runner.yml` now,
and passes against the published kernel.

### The source gate rejects a page that stops sharing the rule

`tests/index/swarm-catalog.mjs` holds the built shards to the rule.
`index_hk_21` holds the two files to having one of it, which is the part no
artifact can show, so it was planted against too. The defect is the state this
change was made to leave behind: the page drops the import and spells the key
itself.

    -import { swarmKeyOf } from "./swarmkey.mjs";
    -  const shard = (cat?.name ?? []).find((x) => x.prefix === swarmKeyOf(q));
    +  const key = q.slice(0, 2).toLowerCase().replace(/[^a-z0-9]/g, "_");
    +  const shard = (cat?.name ?? []).find((x) => x.prefix === key);

    test index_hk_21 ... FAILED
    panicked at crates/conformance/tests/index.rs:168:5:
    the page must resolve a query by the shared rule, not its own

The page still runs and a search for `llama` still returns rows, which is why
this needed a gate rather than a test of behaviour: the damage is to the
models nobody searches for by bare name. Restored, `index_hk_21` passes.

### What this change was proved at

The model moved: `HK-21` is a new claim, and the site model gained the words
the page draws a listed row with. So the attestation moved with it, which is
the signal the ledger above says to expect from a real model change.

`just vv` in the image `prismpm.lock` selects, 25 modules canonical,
`lexlean.lock` current, `cargo deny` clean, every conformance test passing
including `index_hk_21`:

    verified attestation: 7f11795bab18886e7321642c825d68347edcf4f92956a51d3cf6dab09ae5a354
    vv: the acceptance gate passed

An earlier run of the same tree verified `6e0cc8d6f8593efc3a4a2457d4dc34b023e79eb0315ac965a4c4b3245a373251`
before the site model was reworked. It is recorded here only so that the two
hashes in this session's history are not mistaken for an unexplained drift:
the model between them changed, and the second is the one this change ships.
