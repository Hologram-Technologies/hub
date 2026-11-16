//! The `spaces` suite: one test per scenario in `features/suites/spaces.feature`.
//!
//! A Space is published only as the artifact it was sealed as. Lean does not see
//! these bytes, so this reads them: the catalog, every Space's lock and manifest,
//! the files this repository carries, the packages it pins for the rest, and the
//! assembler that publishes them.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::Value;
use sha2::{Digest, Sha256};

fn spaces() -> PathBuf {
    repo_model::repo_root().join("spaces")
}

fn json(path: &Path) -> Value {
    let text =
        std::fs::read_to_string(path).unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{} is not JSON: {e}", path.display()))
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn text(value: &Value, key: &str, at: &str) -> String {
    value[key]
        .as_str()
        .unwrap_or_else(|| panic!("{at}: `{key}` is not a string"))
        .to_string()
}

/// The assembler's source with its comments removed, so a check named only in a
/// comment cannot satisfy the test.
fn assembler() -> String {
    let path = repo_model::repo_root().join("tools/spaces.mjs");
    let source = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    source
        .lines()
        .map(|line| match line.find("//") {
            Some(at) if !line[..at].ends_with(':') => &line[..at],
            _ => line,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// `HK-27`: Every Space the site publishes is the sealed artifact its catalog names: each file hashes to its lock entry, the manifest hashes to the root, and the runtime comes from locked packages whose bytes match the lock too
#[test]
fn spaces_hk_27() {
    let root = spaces();
    let catalog = json(&root.join("catalog.json"));
    let sources = json(&root.join("sources.json"));
    let runtime = sources["runtime"]
        .as_object()
        .expect("sources.json pins the runtime packages");
    let entries = catalog["spaces"]
        .as_array()
        .expect("the catalog lists its Spaces");
    assert!(
        !entries.is_empty(),
        "a catalog with no Spaces proves nothing"
    );

    for space in entries {
        let id = text(space, "id", "catalog");
        let dir = root.join(&id);
        let lock = json(&dir.join("holospace.lock.json"));
        let manifest_bytes =
            std::fs::read(dir.join("manifest.json")).expect("every Space carries its manifest");
        let manifest: Value =
            serde_json::from_slice(&manifest_bytes).expect("the manifest is JSON");

        // The seal: the manifest hashes to the root the lock and the catalog both name.
        let sealed = format!("sha256:{}", sha256(&manifest_bytes));
        assert_eq!(
            text(&lock, "root", &id),
            sealed,
            "{id}: the manifest is not the lock's root"
        );
        assert_eq!(
            text(space, "root", &id),
            sealed,
            "{id}: the manifest is not the catalog's root"
        );

        // The manifest and the lock name the same files, with the same digests and sizes.
        let files = lock["files"]
            .as_object()
            .unwrap_or_else(|| panic!("{id}: the lock names its files"));
        let mut layers = BTreeMap::new();
        for layer in manifest["layers"]
            .as_array()
            .unwrap_or_else(|| panic!("{id}: the manifest has layers"))
        {
            let title = text(&layer["annotations"], "org.opencontainers.image.title", &id);
            layers.insert(
                title,
                (
                    text(layer, "digest", &id),
                    layer["size"].as_u64().unwrap_or(u64::MAX),
                ),
            );
        }
        // The Space's description is the manifest's config rather than a layer, and the lock names it like any file.
        let config = &manifest["config"];
        layers.insert(
            "holospace.json".to_string(),
            (
                text(config, "digest", &id),
                config["size"].as_u64().unwrap_or(u64::MAX),
            ),
        );
        assert_eq!(
            layers.keys().collect::<Vec<_>>(),
            files.keys().collect::<Vec<_>>(),
            "{id}: the manifest's layers and config, and the lock's files, differ"
        );

        for (path, want) in files {
            let digest = text(want, "sha256", path);
            let bytes = want["bytes"]
                .as_u64()
                .unwrap_or_else(|| panic!("{id}/{path}: the lock gives no size"));
            assert_eq!(
                layers[path],
                (format!("sha256:{digest}"), bytes),
                "{id}/{path}: manifest and lock disagree"
            );

            let carried = if let Some(rest) = path.strip_prefix("runtime/") {
                root.join("runtime").join(rest)
            } else {
                dir.join(path)
            };
            if carried.exists() {
                let found = std::fs::read(&carried).unwrap();
                assert_eq!(
                    found.len() as u64,
                    bytes,
                    "{id}/{path}: the size is not the lock's"
                );
                assert_eq!(
                    sha256(&found),
                    digest,
                    "{id}/{path}: the bytes are not the lock's"
                );
                continue;
            }
            // Not carried: it must be an ONNX Runtime file pinned to a package, with the same hash.
            let mut parts = path.splitn(4, '/');
            let (Some("runtime"), Some("ort"), Some(pin), Some(name)) =
                (parts.next(), parts.next(), parts.next(), parts.next())
            else {
                panic!("{id}/{path}: neither carried here nor a pinned runtime file");
            };
            let package = runtime
                .get(pin)
                .unwrap_or_else(|| panic!("{id}/{path}: runtime {pin} is not pinned"));
            for field in ["package", "version", "tarball", "integrity"] {
                assert!(
                    package[field].as_str().is_some_and(|s| !s.is_empty()),
                    "{pin}: the pin has no {field}"
                );
            }
            assert!(
                text(package, "integrity", pin).starts_with("sha512-"),
                "{pin}: the tarball is pinned by sha512"
            );
            let pinned = package["files"]
                .as_array()
                .and_then(|fs| fs.iter().find(|f| f["to"] == *name))
                .unwrap_or_else(|| panic!("{id}/{path}: {pin} does not list {name}"));
            assert_eq!(
                text(pinned, "sha256", name),
                digest,
                "{id}/{path}: the pinned file is not the lock's"
            );
        }
    }

    // The assembler refuses what this test cannot see: a tarball that is not its integrity, a file that is not its
    // lock entry, a manifest that is not its root, a file that is published but not locked.
    let source = assembler();
    for check in [
        "p.integrity.split(\"-\")",
        "sha256(bytes) !== want.sha256",
        "root !== lock.root || root !== space.root",
        "published but not in the lock",
        "process.exit(1)",
    ] {
        assert!(
            source.contains(check),
            "tools/spaces.mjs no longer checks `{check}`"
        );
    }
}
