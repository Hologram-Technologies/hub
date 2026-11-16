//! The `buckets` suite: one test per scenario in `features/suites/buckets.feature`.
//!
//! The Buckets page fetches an object by its address and hashes it itself; the
//! kernel's accept rule (HK-10) judges what arrives. What Lean cannot see is
//! whether the store it fetches from is this hub's, names objects honestly, and
//! holds the one the page offers. This reads the store's builder, the site's
//! model as generated, the carried Spaces and the deployment that serves them.

use sha2::{Digest, Sha256};

fn read(path: &str) -> String {
    let full = repo_model::repo_root().join(path);
    std::fs::read_to_string(&full).unwrap_or_else(|e| panic!("reading {}: {e}", full.display()))
}

/// A source file with its `//` and `#` line comments removed, so a step named
/// only in a comment cannot satisfy the test.
fn code(path: &str) -> String {
    read(path)
        .lines()
        .map(|line| {
            let line = match line.find("//") {
                Some(at) if !line[..at].ends_with(':') => &line[..at],
                _ => line,
            };
            if line.trim_start().starts_with('#') {
                ""
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// `HK-28`: The object store holds each object only under the SHA-256 of its bytes, every file a published Space is made of is in it, and the address the Buckets page offers as its example is one the store holds
#[test]
fn buckets_hk_28() {
    // An object's name comes from its bytes, and from nothing else.
    let builder = code("tools/objects.mjs");
    assert!(
        builder.contains(
            "const name = createHash(\"sha256\").update(await readFile(file)).digest(\"hex\");"
        ),
        "tools/objects.mjs must name each object by the SHA-256 of its bytes"
    );
    assert_eq!(
        builder.matches("join(store, ").count(),
        2,
        "tools/objects.mjs writes into the store only under that name (one link, one copy fallback)"
    );
    assert!(
        builder.matches("join(store, name)").count() == 2,
        "every write into the store is under the computed name"
    );
    // Every published Space file: the store reads the whole release tools/spaces.mjs assembled (HK-27).
    assert!(
        builder.contains("filesUnder(join(release, \"spaces\"))"),
        "tools/objects.mjs must take every file of the published Spaces"
    );
    let deploy = code("deploy/spaces/deploy.sh");
    let spaces_at = deploy
        .find("tools/spaces.mjs")
        .expect("the deploy assembles the Spaces");
    let objects_at = deploy
        .find("tools/objects.mjs")
        .expect("the deploy builds the object store");
    assert!(
        objects_at > spaces_at,
        "the store is built from the assembled Spaces, so after them"
    );

    // The page reads the store at /api/v1/objects/<address>, which the deployment answers from it.
    let caddy = code("deploy/caddy/gethologram.ai.caddy");
    assert!(
        caddy.contains("/api/v1/objects/sha256:")
            && caddy.contains("rewrite * /objects/sha256/{re.object.1}"),
        "Caddy must answer /api/v1/objects/sha256:<hex> from the store"
    );

    // The example the kernel serves is the SHA-256 of a Space manifest this repository carries.
    let site = read("app/src/Site.lex.tex");
    let marker = "\\\"example\\\":\\\"sha256:";
    let at = site
        .find(marker)
        .expect("the Buckets screen offers an example address")
        + marker.len();
    let hex: String = site[at..].chars().take(64).collect();
    assert!(
        hex.chars().all(|c| c.is_ascii_hexdigit()) && hex.len() == 64,
        "the example is a SHA-256 address"
    );
    // The command the screen prints fetches that same object; an address appearing anywhere else on the screen must
    // be it too, so the page never offers one object to click and another to copy.
    let screen_start = site[..at]
        .rfind("\\\"title\\\":\\\"Buckets\\\"")
        .expect("the example is on the Buckets screen");
    let screen_end = at
        + site[at..]
            .find("\\\"docsRoute\\\"")
            .expect("the Buckets screen ends");
    let screen = &site[screen_start..screen_end];
    assert!(
        screen.contains(&format!("/api/v1/objects/sha256:{hex} | sha256sum")),
        "the Buckets command must fetch the example object, sha256:{hex}"
    );
    for (i, _) in screen.match_indices("sha256:") {
        let addr: String = screen[i + 7..].chars().take(64).collect();
        if addr.len() == 64 && addr.chars().all(|c| c.is_ascii_hexdigit()) {
            assert_eq!(
                addr, hex,
                "the Buckets screen names sha256:{addr}, which is not its example"
            );
        }
    }
    let spaces = repo_model::repo_root().join("spaces");
    let held = std::fs::read_dir(&spaces)
        .expect("this repository carries the Spaces")
        .flatten()
        .filter_map(|entry| std::fs::read(entry.path().join("manifest.json")).ok())
        .any(|manifest| sha256(&manifest) == hex);
    assert!(
        held,
        "the example sha256:{hex} is not the manifest of any Space the store holds"
    );
}
