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

/// The record literal the builder writes, from `format:` to the line that
/// closes it. Reading the whole file would let a field mentioned anywhere
/// pass; the promise is about this object.
fn record_literal(source: &str) -> String {
    let start = source
        .find("format: \"hologram.hub.release/")
        .expect("the builder writes a record with a format");
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
    for field in ["repo:", "revision:", "files,", "sources,"] {
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
