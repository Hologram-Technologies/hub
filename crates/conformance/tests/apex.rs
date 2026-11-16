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
        routes.contains(
            "path_regexp edge ^(/api/|/(datasets/|spaces/)?([^/]+/)?[^/]+/resolve/|/(datasets/)?[^/]+/[^/]+/user-access-report$)"
        )
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
            assert!(
                answered(&path, &routes),
                "{command} asks the apex for {path}, which no route sends to a runner of this repository"
            );
        }
    }
}

/// Whether the record answers a tool's request for `path`: the edge's
/// Hugging Face dialect, the object store, or, for the bare name, the guide.
fn answered(path: &str, routes: &str) -> bool {
    let segments: Vec<&str> = path.split('/').collect();
    path.starts_with("/api/models")
        || (path.starts_with("/via/") && path.contains("/resolve/"))
        || (segments.len() > 4 && segments[3] == "resolve" && !path.starts_with("/via/"))
        || path.starts_with("/api/v1/objects/sha256:")
        || (path == "/" && block(routes, HTTPS).contains(&tool_route()))
}

const HTTPS: &str = "gethologram.ai, hub.uor.foundation {";
const HTTP: &str = "http://gethologram.ai, http://hub.uor.foundation {";

/// One site block of the record, every line trimmed, from its address line to
/// the next site block's or the end. A block that is absent is empty.
fn block(routes: &str, head: &str) -> String {
    let lines: Vec<&str> = routes.lines().map(str::trim).collect();
    let Some(start) = lines.iter().position(|l| *l == head) else {
        return String::new();
    };
    lines[start..]
        .iter()
        .skip(1)
        .take_while(|l| **l != HTTPS && **l != HTTP)
        .copied()
        .collect::<Vec<_>>()
        .join(
            "
",
        )
}

/// The route that sends a tool's bare request to the guide Pages publishes.
fn tool_route() -> String {
    [
        "@tool {",
        "path /",
        "header_regexp tool User-Agent ^(curl|Wget|HTTPie|xh)/",
        "}",
        "header / Vary User-Agent",
        "handle @tool {",
        "rewrite * /hub/agent.txt",
        "reverse_proxy https://hologram-technologies.github.io {",
        "header_up Host hologram-technologies.github.io",
        "}",
        "}",
    ]
    .join(
        "
",
    )
}

/// The strings of the home screen's `guide`, read from the model as generated.
fn guide(site: &str) -> Vec<String> {
    let text = site.replace("\\\"", "\"");
    let at = text
        .find("\"guide\":[")
        .expect("the home screen has a guide")
        + 9;
    let list = &text[at..at + text[at..].find(']').expect("a closed guide")];
    list.split('"')
        .skip(1)
        .step_by(2)
        .map(str::to_string)
        .collect()
}

/// `HK-33`: A tool that asks the apex for its bare name, curl gethologram.ai over http or https, gets a plain-text guide published as a static file and written from the home screen's model, every curl in it reaches a route the apex answers, and the home page prints that command
#[test]
fn apex_hk_33() {
    let site = read("app/src/Site.lex.tex");
    let home = site
        .split("name: screenHome,")
        .nth(1)
        .and_then(|rest| rest.split("name: screenModels,").next())
        .expect("the model has a home screen")
        .replace("\\\"", "\"");
    assert!(
        home.contains("\"command\":\"curl gethologram.ai\""),
        "the home screen must print curl gethologram.ai"
    );

    let lines = guide(&home);
    assert!(lines.len() > 5, "the guide is a page, not {lines:?}");
    let file = read("web/agent.txt");
    assert_eq!(
        file,
        lines.join(
            "
"
        ) + "
",
        "web/agent.txt must be the model's guide exactly; run python app/tools/gen_kernel.py"
    );
    let routes = routes();
    for line in &lines {
        assert!(
            line.len() <= 100,
            "the guide line {line:?} is wider than 100 columns"
        );
        let words: Vec<&str> = line.split_whitespace().collect();
        if words.first() != Some(&"curl") {
            continue;
        }
        let command = words
            .iter()
            .map(|w| w.trim_matches(['\'', '"']))
            .collect::<Vec<_>>()
            .join(" ");
        let path = apex_path(&command).unwrap_or_else(|| panic!("{line} must ask the apex"));
        assert!(
            answered(&path, &routes),
            "the guide's {line} asks the apex for {path}, which no route answers"
        );
    }

    let https = block(&routes, HTTPS);
    let http = block(&routes, HTTP);
    for (name, site_block) in [("https", &https), ("http", &http)] {
        let at = site_block.find(&tool_route());
        assert!(
            at.is_some(),
            "the {name} block must send a tool's bare request to the guide"
        );
        let fallback = site_block
            .find(
                "handle {
",
            )
            .unwrap_or(usize::MAX);
        assert!(
            at < Some(fallback),
            "in the {name} block the guide must be routed before the catch-all handle"
        );
    }
    assert!(
        http.contains(
            "handle {
redir https://{host}{uri} 308
}"
        ),
        "every other plain-http request must move to https"
    );
}

/// The stylesheet's rules, with its block comments removed, each rule's
/// whitespace collapsed.
fn css(path: &str) -> String {
    let text = read(path);
    let mut out = String::new();
    let mut rest = text.as_str();
    while let Some(at) = rest.find("/*") {
        out.push_str(&rest[..at]);
        rest = &rest[at + rest[at..].find("*/").expect("a closed comment") + 2..];
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `HK-34`: The landing hero fits every screen from 320 pixels wide: no part of it is wider than the window, so nothing is cut off and the page never scrolls sideways
#[test]
fn apex_hk_34() {
    let rules = css("web/hub.css");
    assert!(
        rules.contains(".land, .land-copy { grid-template-columns: minmax(0, 1fr); }"),
        "the landing and its copy must lay out in one column the window bounds"
    );
    assert!(
        rules.contains(".land-copy > *, .land-second { max-width: 100%; }"),
        "no child of the hero, and not the command line, may be wider than its column"
    );
    let smoke = read("tools/smoke.mjs");
    for width in ["[320, 568]", "[1440, 900]"] {
        assert!(
            smoke.contains(width),
            "the published-site check must open the landing at {width}"
        );
    }
    assert!(
        smoke.contains("wider than the window"),
        "the published-site check must fail on any part of the landing wider than the window"
    );
}
