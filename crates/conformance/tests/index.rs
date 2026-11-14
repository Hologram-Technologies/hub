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
