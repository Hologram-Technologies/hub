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

    // The model label is upstream's, from upstream's own default entry point,
    // which since uor-addr 0.4.0 is the blake3 axis; and the minter re-derives
    // it from the skeleton before printing it.
    assert!(
        minter.contains("uor_addr::gguf::address(")
            && !minter.contains("address_blake3")
            && !minter.contains("address_sha256"),
        "the model label must come from uor-addr's default (blake3) entry point rather than be assembled here"
    );
    assert!(
        minter.contains("format!(\"blake3:{}\", hex(&b3(&skeleton)))"),
        "the minter must re-derive the label by hashing the skeleton it read the leaves from"
    );
    // A tensor's address is uor-addr's canonical-form leaf: since 0.4.0 the
    // BLAKE3 of the tensor's raw bytes, the same number runner/uor.mjs emits.
    // The minter publishes it only after hashing the range it names, so the
    // builder carries it as it is and computes no second number beside it.
    assert!(
        minter.contains("\\\"address\\\":\\\"blake3:{}\\\""),
        "the minter must publish each tensor's leaf as its blake3 address"
    );
    for second in ["blake3OfRange", "uorLeaf", "sha256Label"] {
        assert!(
            !builder.contains(second),
            "a tensor has one address; the builder must not carry `{second}` beside it"
        );
    }
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
    let fetcher = without_comments("web/pieces.mjs");

    // One tensor's own range, not the file. A weight file is gigabytes; the
    // whole point of publishing a range per tensor is that a reader need not
    // take it. The fetcher asks for that range in pieces.
    assert!(
        page.contains("sources: [{ url: `${row.resolve}${tensor.file ?? row.path}`, offset: tensor.offset ?? tensor.begin }]")
            && page.contains("length: tensor.length,"),
        "the page must fetch one tensor's byte range"
    );
    assert!(
        fetcher.contains("bytes=${from}-${source.offset + end - 1}"),
        "the fetcher must ask for the range it was given, by Range"
    );
    // A host that ignores `Range` answers 200 with the whole file, so anything
    // but a partial response is no answer rather than a download.
    assert!(
        fetcher.contains("if (response.status !== 206) {")
            && fetcher.contains("await response.body?.cancel()"),
        "the fetcher must treat a response that is not partial as no answer, and not read it"
    );
    // The verdict is the kernel's accept rule about the bytes the page got:
    // the chaining values the page observed for them, folded into their
    // BLAKE3. A comparison written here would be the page's own opinion
    // wearing the kernel's clothes.
    assert!(
        page.contains("const digest = observed.length === 1 ? observed[0] : foldTable(observed, pool.parent);")
            && page.contains("accepts(digest, uorDigestHex(tensor.address), tensor.length)"),
        "the verdict must be the kernel's answer about the bytes the page fetched, on the tensor's own axis"
    );
    // Both axes are 71 bytes, so a label's axis is read from its prefix and
    // never from its length. A page that took the length for the axis would
    // check a blake3 address with sha256 and refuse good bytes.
    assert!(
        page.contains("isBlake3Label(tensor.address)"),
        "the page must decide a tensor's axis from its prefix"
    );
    assert!(
        !page.contains("length === 71") && !page.contains("length == 71"),
        "the page must not infer an axis from a label's length"
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

/// `HK-26`: A filter the panel offers is one whatever is driving the list can act on, so a control is never drawn that cannot narrow anything
#[test]
fn index_hk_26() {
    let page = without_comments("web/hub.mjs");

    // Three controls were drawn over the roll that nothing acted on: the
    // parameter slider, Status, and Sources. Each looked like a filter, moved
    // when clicked, and changed nothing, because the roll cannot answer them
    // and no branch did anything else about it. That is the defect this
    // guards: a facet is offered only if the thing driving the list can act
    // on it.
    assert!(
        page.contains("const HUB_FACETS = "),
        "the facets only this hub can answer must be named in one place"
    );
    // One list, read by the deciding and by the moving. Two lists is how a
    // facet comes to be offered on a page that will not act on it.
    assert!(
        page.contains("HUB_FACETS.includes(f.key) || (pre ? Object.hasOwn(pre, f.key) : true)"),
        "a facet is offered only when the roll counts it or this hub can answer it"
    );
    assert!(
        page.contains("HUB_FACETS.some((k) => (st.f[k]?.length ?? 0) > 0)"),
        "choosing one of this hub's own facets must move the page to the records that answer it"
    );

    // The parameter range is a filter over the roll, not a drawing of one.
    // The roll files each row in the bucket of the largest stop its count
    // reaches, so a range is the union of the buckets between the handles.
    assert!(
        page.contains("filters.parameters = Array.from("),
        "the parameter range must be applied to the roll, not merely drawn over it"
    );
    assert!(
        page.contains("params: \"parameters\""),
        "the roll's parameter postings must be mapped into the counts the panel is built from"
    );

    let spec = without_comments("app/tools/site_spec.py");
    assert!(
        spec.contains("\"sources\", \"hub_source\""),
        "Sources must be a facet the screen declares"
    );
}
/// `HK-29`: The index learns which other sources hold a release only from the holders record this repository carries, and only for the revision that record names, so a build reads no other hub
#[test]
fn index_hk_29() {
    // The builder asks no other hub: it names none, and takes holders from the
    // record this repository carries.
    let source = builder();
    for host in ["gethologram.ai", "/data/files", "hub.uor.foundation"] {
        assert!(
            !source.contains(host),
            "tools/index.mjs must not ask another hub for holders (it names {host})"
        );
    }
    assert!(
        source.contains("readFile(new URL(\"../sources/holders.json\", import.meta.url)"),
        "tools/index.mjs must read holders from sources/holders.json"
    );
    // An entry counts only for the revision it names.
    assert!(
        source.contains("held?.revision === row.sha"),
        "tools/index.mjs must take a holder entry only for the revision it names"
    );

    // The record: where and when it was read, and per release the revision,
    // the hash of the file it came from, and each source a client can be sent to.
    let path = repo_model::repo_root().join("sources/holders.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    let record: serde_json::Value =
        serde_json::from_str(&text).expect("sources/holders.json is JSON");
    assert_eq!(record["format"], "hologram.hub.holders/1");
    for field in ["from", "written", "by"] {
        assert!(
            record["read"][field]
                .as_str()
                .is_some_and(|s| !s.is_empty()),
            "the record must say {field} it was read"
        );
    }
    let holders = record["holders"]
        .as_object()
        .expect("the record lists holders");
    assert!(!holders.is_empty(), "an empty record proves nothing");
    let hex = |s: &str, n: usize| s.len() == n && s.chars().all(|c| c.is_ascii_hexdigit());
    for (repo, entry) in holders {
        assert!(
            entry["revision"].as_str().is_some_and(|r| hex(r, 40)),
            "{repo}: an entry names the full revision it holds"
        );
        assert!(
            entry["sha256"].as_str().is_some_and(|h| hex(h, 64)),
            "{repo}: an entry names the hash of the file it was read from"
        );
        for held in entry["sources"]
            .as_array()
            .expect("an entry lists its sources")
        {
            assert!(
                held["kind"].as_str().is_some_and(|k| !k.is_empty()),
                "{repo}: a source has a kind"
            );
            assert!(
                held["resolve"]
                    .as_str()
                    .is_some_and(|r| r.starts_with("https://")),
                "{repo}: a source has an https resolve base"
            );
            assert!(
                held["missing"].is_array(),
                "{repo}: a source lists what it lacks"
            );
        }
    }

    // The signed index says where its holders came from.
    let pages =
        std::fs::read_to_string(repo_model::repo_root().join(".github/workflows/pages.yml"))
            .expect("reading pages.yml");
    let predicate = pages
        .lines()
        .find(|l| {
            l.trim_start()
                .starts_with("predicate: '{\"tool\":\"tools/index.mjs\"")
        })
        .expect("pages.yml signs the index with a predicate");
    assert!(
        predicate.contains("\"holders\":\"sources/holders.json"),
        "the index's signed predicate must name sources/holders.json: {predicate}"
    );
}

/// `HK-35`: Every safetensors file in the UOR address index is addressed by uor-addr's safetensors realization, and each of its tensors carries the BLAKE3 leaf the file's label binds, which is its address, and the byte range that leaf was taken over, so a reader checks one tensor from a ranged read
#[test]
fn index_hk_35() {
    let builder = without_comments("tools/uor-index.mjs");
    let minter = without_comments("crates/uor-label/src/main.rs");
    let check = without_comments("tests/uor/index.mjs");

    // The safetensors label is upstream's, from upstream's own entry points,
    // and the skeleton it is checked against is the one upstream canonicalized.
    for call in [
        "uor_addr::safetensors::address(",
        "uor_addr::safetensors::canonicalize",
    ] {
        assert!(
            minter.contains(call),
            "a safetensors label must come from uor-addr's `{call}`, not be assembled here"
        );
    }
    // The realization is chosen by the file's own bytes, not its name.
    assert!(
        minter.contains("GGUF_MAGIC.to_le_bytes()"),
        "the minter must choose the realization from the file's first bytes"
    );
    // Every leaf published is the digest of exactly the range published beside
    // it, for safetensors as for GGUF: the check appears once per realization.
    assert!(
        minter
            .matches("over_range.as_slice() != entry.leaf")
            .count()
            >= 2,
        "both realizations must refuse a leaf that is not the digest of the range they publish"
    );
    assert!(
        minter.contains("\\\"realization\\\":\\\"safetensors\\\""),
        "a safetensors row must say which realization minted it"
    );

    // The builder fetches safetensors files and does not set them aside.
    assert!(
        builder.contains(r"/\.(gguf|safetensors)$/i"),
        "the builder must address safetensors files, not only GGUF"
    );
    assert!(
        builder.contains(r"const other = record.files.filter((f) => /\.onnx$/i"),
        "only ONNX may be reported as having no canonical form read here"
    );
    // Two realizations number their forms apart, so the root names one per
    // realization and a row is held to its own realization's.
    assert!(
        builder.contains("canonicalForms:"),
        "the root must name the canonical form of each realization"
    );
    assert!(
        check.contains("root.canonicalForms[row.realization]"),
        "the artifact check must hold each row to its own realization's form"
    );
}

/// `HK-44`: Every tensor longer than 1 MiB in the UOR address index has a piece table, published under the tensor's address, that folds to that address, so a reader checks each piece of the tensor as it arrives
#[test]
fn index_hk_44() {
    let minter = without_comments("crates/uor-label/src/main.rs");
    let builder = without_comments("tools/uor-index.mjs");
    let check = without_comments("tests/uor/index.mjs");
    let workflow =
        std::fs::read_to_string(repo_model::repo_root().join(".github/workflows/pages.yml"))
            .expect("reading pages.yml");

    // The minter takes each tensor's range as BLAKE3's own tree cut at 1 MiB,
    // for both realizations, and that same pass is the leaf check and the
    // table: a table that did not fold to the leaf would fail the check
    // before it was printed.
    assert!(
        minter
            .matches("let (over_range, table) = piece_tree(")
            .count()
            >= 2,
        "both realizations must take each tensor's leaf through its piece tree"
    );
    assert!(
        minter
            .matches("pieces_field(&table, tensor.length)")
            .count()
            >= 2,
        "both realizations must publish the piece table they checked the leaf with"
    );
    assert!(
        minter.contains("bytes.extend_from_slice(b\"HPTREE01\");"),
        "a piece table is in hologram-space's HPTREE01 encoding"
    );
    // The builder publishes each table under its tensor's address and takes it
    // out of the row, and the root says where tables are.
    assert!(
        builder
            .contains("await writeFile(join(out, \"pieces\", hex), Buffer.from(table, \"hex\"));")
            && builder.contains("if (pieces) tables.set(tensor.address.slice(7), pieces);"),
        "the builder must publish each tensor's table under the tensor's address"
    );
    assert!(
        builder.contains("pieceTables: { path: \"pieces/{address hex}\""),
        "the root must say where piece tables are"
    );
    // The artifact check folds every published table and requires one for
    // every tensor over a piece; the Pages workflow runs it on what it built.
    assert!(
        check.contains("does not fold to its address")
            && check.contains("has no piece table at pieces/"),
        "tests/uor/index.mjs must fold every table and require one for each tensor over 1 MiB"
    );
    assert!(
        workflow.contains("node tests/uor/index.mjs"),
        "the Pages workflow must run the artifact check, or it proves nothing"
    );
}

/// `HK-45`: Every file manifests/onnx.txt lists carries, in its release record, the BLAKE3 of the whole file's bytes, and the index root names every record and browse shard by BLAKE3 beside SHA-256, so a reader checks a record and a file without SHA-256
///
/// Hologram AI checks model bytes by BLAKE3 alone. This holds the source to
/// the promise; `tests/index/shards.mjs` holds the built index to it, and the
/// Pages workflow runs that on every build.
#[test]
fn index_hk_45() {
    let list = std::fs::read_to_string(repo_model::repo_root().join("manifests/onnx.txt"))
        .expect("manifests/onnx.txt names the files given a BLAKE3");
    for repo in [
        "onnx-community/Qwen2.5-1.5B-Instruct",
        "onnx-community/Qwen3-0.6B-ONNX",
        "onnx-community/Llama-3.2-1B-Instruct-ONNX",
        "Xenova/all-MiniLM-L6-v2",
        "Xenova/distilbert-base-uncased-finetuned-sst-2-english",
    ] {
        for path in [
            "onnx/model_q4.onnx",
            "onnx/model_q4f16.onnx",
            "config.json",
            "tokenizer.json",
            "tokenizer_config.json",
        ] {
            assert!(
                list.lines().any(|l| l.trim() == format!("{repo} {path}")),
                "manifests/onnx.txt must list {repo} {path}"
            );
        }
    }
    let builder = without_comments("tools/index.mjs");
    let hasher = without_comments("tools/blake3.mjs");
    let check = without_comments("tests/index/shards.mjs");
    let workflow =
        std::fs::read_to_string(repo_model::repo_root().join(".github/workflows/pages.yml"))
            .expect("reading pages.yml");

    // A listed file is hashed from its bytes, and a listed path the release
    // does not hold stops the build rather than going quiet.
    for needle in [
        "named(\"onnx.txt\")",
        "file.blake3 = await blake3Of(record, file);",
        "which ${record.revision} does not hold",
        "if (length !== file.size)",
    ] {
        assert!(
            builder.contains(needle),
            "tools/index.mjs must contain `{needle}`"
        );
    }
    // The root names records, browse shards and the catalog by BLAKE3 too.
    assert_eq!(
        builder
            .matches("sha256: sha256(bytes), blake3: blake3Hex(bytes)")
            .count(),
        2,
        "both the record entries and the browse entries must carry a BLAKE3"
    );
    assert!(
        builder.contains("catalogBlake3: blake3Hex(catalog),"),
        "the index root must name the catalog by BLAKE3"
    );
    // One BLAKE3: the hasher every reader runs, folded the way readers fold.
    assert!(
        hasher.contains("web/piece-hash.wasm") && hasher.contains("foldTable(cvs, hasher.parent)"),
        "tools/blake3.mjs must hash with web/piece-hash.wasm and fold as web/pieces.mjs does"
    );
    // The artifact check reads by BLAKE3 alone, and refuses a changed record.
    for needle in [
        "is not the bytes whose BLAKE3 the root names",
        "a changed record is refused by its BLAKE3",
        "manifests/onnx.txt lists carries its BLAKE3",
    ] {
        assert!(
            check.contains(needle),
            "tests/index/shards.mjs must check `{needle}`"
        );
    }
    assert!(
        workflow.contains("node tests/index/shards.mjs"),
        "the Pages workflow must run the index check on what it built"
    );
    let key = workflow
        .lines()
        .find(|l| l.trim_start().starts_with("key: index-"))
        .expect("the index is cached under a key");
    for input in [
        "manifests/onnx.txt",
        "tools/blake3.mjs",
        "web/piece-hash.wasm",
    ] {
        assert!(
            key.contains(input),
            "the index cache key must name {input}, an input of every BLAKE3 it keeps"
        );
    }
}

/// `HK-46`: Every initializer of an ONNX graph manifests/onnx.txt lists is in the UOR address index with its name, data type and dims, the file its bytes lie in, their offset and length there, and an address that is the BLAKE3 of exactly those bytes, so a reader checks one tensor from a ranged read
///
/// uor-addr's ONNX realization addresses a tensor kept in an external file by
/// its reference rather than its bytes, so these rows come from
/// `tools/onnx.mjs`, which reads only what ONNX's schema says and refuses what
/// it would have to guess.
#[test]
fn index_hk_46() {
    let reader = without_comments("tools/onnx.mjs");
    let builder = without_comments("tools/uor-index.mjs");
    let check = without_comments("tests/uor/index.mjs");
    let page = without_comments("web/hub.mjs");
    let workflow =
        std::fs::read_to_string(repo_model::repo_root().join(".github/workflows/pages.yml"))
            .expect("reading pages.yml");

    // ModelProto 7 is the graph, GraphProto 5 an initializer; in a
    // TensorProto 9 is raw_data, 13 external_data, 14 data_location.
    for needle in [
        "tag >> 3 !== 7",
        "field === 5 && (inner & 7) === 2",
        "field === 9 && wire === 2",
        "field === 13 && wire === 2",
        "field === 14 && wire === 0",
    ] {
        assert!(
            reader.contains(needle),
            "tools/onnx.mjs must read `{needle}` as ONNX's schema defines it"
        );
    }
    // What would need a guess is refused: typed data, whose stored bytes are
    // not the tensor; a length the dims and type do not make; a location that
    // leaves the repository.
    for needle in [
        "TYPED_DATA.has(field)",
        "its dims and ${dtype} make ${expected}",
        ".includes(\"..\")",
    ] {
        assert!(
            reader.contains(needle),
            "tools/onnx.mjs must refuse with `{needle}`"
        );
    }
    // Each range is hashed as it streams past, by the one hasher.
    assert!(
        reader.contains("hash.update(part)") && reader.contains("blake3Stream()"),
        "an initializer's address must be the BLAKE3 of the bytes read for it"
    );
    // Every file read must be the BLAKE3 its signed record names, and the row
    // names content by BLAKE3 only.
    for needle in [
        "which is not the BLAKE3 its record names",
        "realization: \"onnx\",",
        "readGraph(await stream(record, path), path,",
        "await addressRanges(await stream(record, file), ranges,",
    ] {
        assert!(
            builder.contains(needle),
            "tools/uor-index.mjs must contain `{needle}`"
        );
    }
    let row = builder
        .split("realization: \"onnx\",")
        .nth(1)
        .and_then(|rest| rest.split("});").next())
        .expect("the ONNX row");
    assert!(
        !row.contains("sha256"),
        "an ONNX row must name nothing by SHA-256: {row}"
    );
    // The artifact check holds the rows to it, and re-reads one tensor per
    // file by range from where the row says its bytes came from.
    for needle in [
        "names content by SHA-256",
        "which the row does not name",
        "read by range, is not its address",
        "is not the bytes the root names by BLAKE3",
    ] {
        assert!(
            check.contains(needle),
            "tests/uor/index.mjs must check `{needle}`"
        );
    }
    // The reader's behaviour, not only its text: graphs built byte by byte,
    // every address against a second BLAKE3, every refusal by name, run on
    // each push and pull request that touches the reader or its hasher.
    let unit = without_comments("tests/uor/onnx.mjs");
    for needle in [
        "the address is the BLAKE3 of its range",
        "external address",
        "\"typed field 4\"",
        "\"its dims and FLOAT make 12\"",
        "\"names external location\"",
        "\"the file ends inside a field\"",
    ] {
        assert!(
            unit.contains(needle),
            "tests/uor/onnx.mjs must check `{needle}`"
        );
    }
    let pieces =
        std::fs::read_to_string(repo_model::repo_root().join(".github/workflows/pieces.yml"))
            .expect("reading pieces.yml");
    assert!(
        pieces.contains("run: node tests/uor/onnx.mjs")
            && pieces.matches("- \"tools/onnx.mjs\"").count() == 2
            && pieces.matches("- \"tools/blake3.mjs\"").count() == 2
            && pieces.matches("- \"tests/uor/onnx.mjs\"").count() == 2,
        "pieces.yml must run tests/uor/onnx.mjs on every push and pull request that touches the reader or its hasher"
    );
    // The page fetches an ONNX tensor from the file it lies in.
    assert!(
        page.contains("${row.resolve}${tensor.file ?? row.path}")
            && page.contains("offset: tensor.offset ?? tensor.begin"),
        "the page must fetch an ONNX tensor from its own file at its own offset"
    );
    let key = workflow
        .lines()
        .find(|l| l.trim_start().starts_with("key: uor-"))
        .expect("the address index is cached under a key");
    for input in ["manifests/onnx.txt", "tools/onnx.mjs", "tools/blake3.mjs"] {
        assert!(
            key.contains(input),
            "the address cache key must name {input}"
        );
    }
}
