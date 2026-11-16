//! The `apex` suite: one test per scenario in `features/suites/apex.feature`.
//!
//! gethologram.ai answers only from this repository: the edge, the Spaces and
//! their object store by the routes in `deploy/caddy/gethologram.ai.caddy`, and
//! everything else from this repository's site. A command the site prints is a
//! promise about what the apex answers, so this reads every command in the
//! site's model as generated and the route record that serves it.

fn read(path: &str) -> String {
    let full = repo_model::repo_root().join(path);
    std::fs::read_to_string(&full).unwrap_or_else(|e| panic!("reading {}: {e}", full.display()))
}

/// The route record with its `#` comments removed, so a route named only in a
/// comment cannot satisfy the test.
fn routes() -> String {
    read("deploy/caddy/gethologram.ai.caddy")
        .lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Every string the site's model prints as a command: each `command`, each
/// entry of `commands`, and the command of each `tools` row. The model is
/// JSON escaped inside LexLean, so quotes arrive as `\"`.
fn commands(site: &str) -> Vec<String> {
    let text = site.replace("\\\"", "\"");
    let mut out = Vec::new();
    let mut rest = text.as_str();
    while let Some(at) = rest.find("\"command\":\"") {
        rest = &rest[at + 11..];
        out.push(rest[..rest.find('"').expect("a closed command")].to_string());
    }
    // `commands` is a list of strings; `tools` a list of [label, command] rows.
    for (key, close, every) in [("\"commands\":[", "]", 1), ("\"tools\":[", "]]", 2)] {
        let mut rest = text.as_str();
        while let Some(at) = rest.find(key) {
            rest = &rest[at + key.len()..];
            let list = &rest[..rest.find(close).expect("a closed list")];
            let strings: Vec<&str> = list.split('"').skip(1).step_by(2).collect();
            out.extend(
                strings
                    .iter()
                    .skip(every - 1)
                    .step_by(every)
                    .map(|s| s.to_string()),
            );
        }
    }
    out
}

/// The path a `curl` command asks the apex for, when it names the apex.
fn apex_path(command: &str) -> Option<String> {
    let url = command
        .split_whitespace()
        .skip(1)
        .find(|w| !w.starts_with('-'))?;
    let url = url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let rest = url.strip_prefix("gethologram.ai")?;
    Some(if rest.is_empty() {
        "/".to_string()
    } else {
        rest.to_string()
    })
}

/// `HK-30`: Every command the model page gives a tool is one whose requests the apex routes to this repository, so the site never offers a command that reaches nothing
#[test]
fn apex_hk_30() {
    let routes = routes();
    // The Hugging Face dialect is the one a tool speaks to the apex, and the record sends it to this repository's edge.
    assert!(
        routes.contains("path_regexp edge ^(/api/models(/|$)|/[^/]+/[^/]+/resolve/)")
            && routes.contains("reverse_proxy hub-edge:8787"),
        "the route record must send the Hugging Face dialect to this repository's edge"
    );
    // OCI and Ollama clients speak /v2/; nothing of this repository's answers it, so the record must not route it.
    assert!(
        !routes.contains("/v2"),
        "the route record must not route /v2: no runner of this repository answers it"
    );
    for upstream in routes
        .lines()
        .filter_map(|l| l.trim().strip_prefix("reverse_proxy "))
    {
        let upstream = upstream.trim_end_matches(" {");
        assert!(
            [
                "hub-edge:8787",
                "hub-spaces:8080",
                "https://hologram-technologies.github.io"
            ]
            .contains(&upstream),
            "the apex may answer only from this repository's edge, Spaces and site, not {upstream}"
        );
    }

    let printed = commands(&read("app/src/Site.lex.tex"));
    assert!(
        printed
            .iter()
            .any(|c| c.starts_with("HF_ENDPOINT=https://{host} ")),
        "the model page must give a tool its command: {printed:?}"
    );
    for command in &printed {
        let tool = command
            .split_whitespace()
            .find(|w| !w.contains('='))
            .unwrap_or("");
        assert!(
            !["ollama", "oras", "docker", "podman"].contains(&tool),
            "{command} needs /v2/, which the apex does not route"
        );
        if tool != "curl" {
            continue;
        }
        if let Some(path) = apex_path(command) {
            let answered = path.starts_with("/api/models")
                || (path.starts_with("/via/") && path.contains("/resolve/"))
                || path.starts_with("/api/v1/objects/sha256:");
            assert!(
                answered,
                "{command} asks the apex for {path}, which no route sends to a runner of this repository"
            );
        }
    }
}
