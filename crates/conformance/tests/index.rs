//! The `index` suite: one test per scenario in `features/suites/index.feature`.
//!
//! What this holds fixed is a promise to another program. The engine that
//! reads this hub's index was told it may depend on a record's `repo`,
//! `revision`, `files[]` with `path`, `size` and `gitSha1`, and `sources[]`.
//! A Lean proof cannot catch a field being renamed in `tools/index.mjs`, so
//! this reads the builder itself and fails if the record it writes stops
//! carrying one of them, or if the name is only mentioned somewhere else in
//! the file.

use std::path::Path;

/// The builder's source, with comments removed, so a field named only in a
/// comment cannot satisfy the test.
fn builder() -> String {
    let path = repo_model::repo_root().join("tools/index.mjs");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    text.lines()
        .map(|line| match line.find("//") {
            // A `//` inside a string is not a comment; the builder's only such
            // case is a URL, which always has `://` before it.
            Some(at) if !line[..at].ends_with(':') => &line[..at],
            _ => line,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The record literal the builder writes, from its assignment to the line that
/// closes it. Reading the whole file would let a field mentioned anywhere
/// pass; the promise is about this object.
fn record_literal(source: &str) -> String {
    // Anchored on the assignment, not on the format string: the builder names
    // the format in more than one place now that it can upgrade a cached record
    // in place, and the earlier of those is not the literal this promise is
    // about. The trailing newline is what tells the two apart.
    let start = source
        .find("record = {\n")
        .expect("the builder assigns a record literal");
    let rest = &source[start..];
    let end = rest
        .find("\n      };")
        .expect("the record literal ends where it always has");
    rest[..end].to_string()
}

/// `HK-18`: A release record always carries the fields a client reads: the repository, the revision, every file with its path, size and git blob address, and the sources that hold it
#[test]
fn index_hk_18() {
    let source = builder();
    let record = record_literal(&source);
    for field in [
        "format: \"hologram.hub.release/",
        "repo:",
        "revision:",
        "files,",
        "sources,",
    ] {
        assert!(
            record.contains(field),
            "a release record must carry {field} for a client that reads this index:\n{record}"
        );
    }
    // The file entries, which are built just above the record.
    let files = {
        let start = source
            .find("const files = tree")
            .expect("the builder maps the tree into file entries");
        let rest = &source[start..];
        let end = rest
            .find("}));")
            .expect("the file mapping ends where it always has");
        rest[..end].to_string()
    };
    for field in ["path:", "size:", "gitSha1:"] {
        assert!(
            files.contains(field),
            "every file entry must carry {field}:\n{files}"
        );
    }
    // `sha256` stays optional: Hugging Face publishes one only for LFS files,
    // and a second witness is kept elsewhere so the edge's ETag does not move.
    assert!(
        files.contains("sha256:"),
        "a file entry must still carry sha256 where the source has one:\n{files}"
    );
    // The promise is about the published shape, so the published document must
    // be the one this test read.
    assert!(
        Path::new(&repo_model::repo_root().join("tools/index.mjs")).is_file(),
        "the builder this test reads must be the one that writes the index"
    );
}

/// `HK-20`: A release record names where its own bytes come from, and the edge sends a client to that same place, so a reader who is not the edge can fetch and check a file without knowing which hub built the record
///
/// The other half of this claim - that the edge's redirect is that same base -
/// is checked end to end by `tests/edge/origin.mjs`, because it is a fact about
/// what the edge answers rather than about what the builder writes.
#[test]
fn index_hk_20() {
    let source = builder();
    let record = record_literal(&source);
    assert!(
        record.contains("origin:"),
        "a release record must name the origin its bytes come from:\n{record}"
    );
    let origin = {
        let start = record.find("origin:").expect("checked just above");
        let rest = &record[start..];
        let end = rest.find('\n').unwrap_or(rest.len());
        rest[..end].to_string()
    };
    for part in ["kind:", "resolve:"] {
        assert!(
            origin.contains(part),
            "the origin must carry {part}, the shape a source entry already has: {origin}"
        );
    }
    // Built from the host the builder actually read and from this record's own
    // repository and revision. A second copy of a host name written out by hand
    // is what drifts.
    for part in ["HF", "row.id", "row.sha"] {
        assert!(
            origin.contains(part),
            "the origin's resolve base must be built from {part}, not written out: {origin}"
        );
    }
}

/// The source of a file in this repository, with comments removed by the same
/// rule the builder's own source is read by, so a rule named only in a comment
/// cannot satisfy a check.
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

/// `HK-21`: A swarm catalog row is filed under the shard key the page resolves a query with, and says it is a listing rather than a checked record, so a search reads one shard and what it draws is not mistaken for proof
///
/// The catalog is about 300 MB of rows, so a search reads one shard and no
/// other. That only finds anything if the builder's filing rule and the page's
/// resolving rule are the same rule, which is why there is one of it. This
/// reads both files and fails if either grows its own copy; that the built
/// shards obey it is checked against the artifact by
/// `tests/index/swarm-catalog.mjs`.
#[test]
fn index_hk_21() {
    let builder = without_comments("tools/swarm-catalog.mjs");
    let page = without_comments("web/hub.mjs");
    assert!(
        builder.contains("from \"../web/swarmkey.mjs\""),
        "the catalog builder must file rows by the shared rule, not its own"
    );
    assert!(
        page.contains("from \"./swarmkey.mjs\""),
        "the page must resolve a query by the shared rule, not its own"
    );
    // A second spelling of the rule is the failure this is guarding against,
    // and it looks like this: two characters taken off a name and folded to a
    // safe key. Either file doing that again has stopped sharing.
    for (name, source) in [("the builder", &builder), ("the page", &page)] {
        assert!(
            !source.contains("[^a-z0-9]"),
            "{name} spells out a shard key rule of its own; there must be only one"
        );
    }
    // The honesty half. A row the swarm listed is not a row this hub checked,
    // and the page draws these beside signed rows.
    assert!(
        builder.contains("state: \"listed\""),
        "every catalog row must say it is a listing"
    );
    assert!(
        builder.contains("\"pirateface\""),
        "a catalog row's only source is the swarm that listed it"
    );
}

/// `HK-23`: A suggestion the header offers is filed under the words the page resolves a query with, and a panel the head of the catalogue could not fill says so and is completed from the full index, so a short list is never mistaken for the whole answer
#[test]
fn index_hk_23() {
    let builder = without_comments("tools/browse-index.mjs");
    let reader = without_comments("web/browse.mjs");
    let rule = without_comments("web/browsekey.mjs");

    // Half of this is the same hazard HK-21 guards for the swarm's shards: the
    // builder files a name under a bucket and the page looks in a bucket, and
    // if those are two spellings of one rule the page quietly stops finding
    // what the builder wrote. So there is one of it, and both import it.
    assert!(
        builder.contains("from \"../web/browsekey.mjs\""),
        "the builder must file suggestions by the shared rule, not its own"
    );
    assert!(
        reader.contains("from \"./browsekey.mjs\""),
        "the page must resolve a query by the shared rule, not its own"
    );
    for (name, source) in [("the builder", &builder), ("the page", &reader)] {
        assert!(
            !source.contains("[^a-z0-9]+"),
            "{name} spells out a word rule of its own; there must be only one"
        );
        assert!(
            !source.contains("slice(0, 2)"),
            "{name} spells out a bucket rule of its own; there must be only one"
        );
    }
    assert!(
        rule.contains("export const words") && rule.contains("export const bucketOf"),
        "the shared rule must be the one that says what a word is and which bucket it falls in"
    );
    // The suggestion index files by `quickWords`, and the page matches by the
    // same call through `suggests`. A page matching on `words` would offer a
    // name the file does not hold, and miss ones it does.
    assert!(
        builder.contains("quickWords(") && rule.contains("quickWords(id)"),
        "the builder must file suggestions by the suggestion rule"
    );
    assert!(
        rule.contains("const held = quickWords(id)"),
        "a suggestion must be matched on the words it was filed under"
    );

    // The honesty half. The head of the catalogue is QUICK_ROWS names; a panel
    // it could not fill must say it is not complete, and the caller must then
    // read the full index rather than leave a short list standing.
    assert!(
        reader.contains("complete: rows.length >= want || names.length < QUICK_ROWS"),
        "a panel is complete only when it was filled, or the bucket held everything there was"
    );
    let page = without_comments("web/hub.mjs");
    assert!(
        page.contains("if (complete || !index) return;"),
        "the page must stop only when the panel is complete; an incomplete one is finished from the full index"
    );
    assert!(
        page.contains("index.page({ sort: \"trending\", q, page: 1 })"),
        "an incomplete panel must be completed from the full index, which reads the whole catalogue"
    );
}

/// `HK-24`: Every row in the UOR address index carries a canonical address and the canonical-form version that minted it, taken here from bytes this build streamed rather than copied from any host, and is filed under the shard key the page resolves a model with
#[test]
fn index_hk_24() {
    let builder = without_comments("tools/uor-index.mjs");
    let page = without_comments("web/hub.mjs");
    let minter = without_comments("crates/uor-label/src/main.rs");

    // One filing rule, imported by both sides. Two spellings of it would file
    // a row under a key the page never looks in, and the row would not be
    // found rather than be found wrong -- which is the failure worth catching.
    assert!(
        builder.contains("from \"../web/uorkey.mjs\""),
        "the index builder must file rows by the shared rule, not its own"
    );
    assert!(
        page.contains("from \"./uorkey.mjs\""),
        "the page must resolve a model's shard by the shared rule, not its own"
    );
    // The rule is a shift of the leading bits of a digest. Either file doing
    // that arithmetic again has stopped sharing it.
    for (name, source) in [("the builder", &builder), ("the page", &page)] {
        assert!(
            !source.contains(">>> (16 -"),
            "{name} spells out a shard key rule of its own; there must be only one"
        );
    }

    // The address is upstream's, from upstream's own entry point.
    assert!(
        minter.contains("uor_addr::gguf::address"),
        "the address must come from uor-addr rather than be assembled here"
    );
    // A label and the canonical form that minted it travel together: a label
    // whose form is unknown is ambiguous the moment upstream bumps one.
    assert!(
        builder.contains("label: minted.label"),
        "a row's address must be the one the minter returned"
    );
    assert!(
        builder.contains("canonicalForm: minted.canonicalForm"),
        "a row must carry the canonical form that minted its address"
    );
    // Taken from the bytes, never read out of the record. The record's digests
    // are Hugging Face's, which is the single dependency this claim exists to
    // remove.
    for wrong in ["label: file.", "label: record.", "label: row."] {
        assert!(
            !builder.contains(wrong),
            "a row's address must come from the bytes this build streamed, not from `{wrong}`"
        );
    }

    // The range a reader needs to check one tensor, and the minter's own
    // refusal to publish a range the leaf does not match.
    assert!(
        minter.contains("let begin = data_start"),
        "a tensor's range must be the file's own offset, not the skeleton's recomputed one"
    );
    assert!(
        minter.contains("over_range.as_slice() != entry.leaf"),
        "the minter must refuse a leaf that is not the digest of the range it publishes"
    );
}

/// `HK-25`: The page shows a tensor address as checked only when the kernel accepted bytes the page fetched itself, so an address the hub published is never drawn as proof of bytes nobody read
#[test]
fn index_hk_25() {
    let page = without_comments("web/hub.mjs");

    // One tensor's own range, not the file. A weight file is gigabytes; the
    // whole point of publishing a range per tensor is that a reader need not
    // take it.
    assert!(
        page.contains("bytes=${tensor.begin}-${tensor.begin + tensor.length - 1}"),
        "the page must fetch one tensor's byte range"
    );
    // A host that ignores `Range` answers 200 with the whole file, so anything
    // but a partial response is no answer rather than a download.
    assert!(
        page.contains("response.status !== 206"),
        "the page must treat a response that is not partial as no answer"
    );
    // The verdict is the kernel's accept rule about the bytes the page got.
    // `addressed` is that rule; a comparison written here would be the page's
    // own opinion wearing the kernel's clothes.
    assert!(
        page.contains("accepted: await addressed(body, tensor.leaf"),
        "the verdict must be the kernel's answer about the bytes the page fetched"
    );
    for wrong in [
        "=== tensor.leaf",
        "tensor.leaf ===",
        "!== tensor.leaf",
        "tensor.leaf !==",
    ] {
        assert!(
            !page.contains(wrong),
            "the page must not judge an address itself with `{wrong}`"
        );
    }
    // Until the kernel has answered, the row says so rather than looking
    // checked.
    assert!(
        page.contains("s.uor.unchecked"),
        "a row the kernel has not judged must say it is unchecked"
    );
}
