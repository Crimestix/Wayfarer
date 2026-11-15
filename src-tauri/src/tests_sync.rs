//! Abgleich: Vertrag mit der Oberfläche und Abläufe zweier Ordner gegen den Gegenpart
//! (`sync/testserver.rs`) – über `invoke`, wie die Oberfläche es tut. Nie gegen GitHub.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde_json::{json, Value};
use tauri::test::MockRuntime;
use tauri::{Manager, WebviewWindow};
use tempfile::TempDir;

use crate::keys::KeyState;
use crate::sync::local::{blob_sha, mark, read_stand, scan_local, write_link, Decision, MarkInput};
use crate::sync::testserver::{self, Forced};
use crate::sync::Sync;
use crate::tests::{app, invoke, window};

/// Eine Vorlage aus `src/sync/contract/` (auch von Vitest gelesen), mit eingesetztem Ordner.
fn template(name: &str, root: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/sync/contract")
        .join(name);
    let text = std::fs::read_to_string(path).unwrap();
    let root = serde_json::to_string(root).unwrap();
    serde_json::from_str(&text.replace("\"<root>\"", &root)).unwrap()
}

/// Gleiche Gestalt: dieselben Schlüssel in Objekten (rekursiv), Listen am ersten Element.
/// Objekte mit Pfaden als Schlüssel (gemeinsamer Stand, Entscheidungen) gelten als frei.
fn same_shape(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let free = |m: &serde_json::Map<String, Value>| {
                m.keys()
                    .any(|k| k.contains('/') || k.contains('.') || k.starts_with('*'))
            };
            if free(x) || free(y) {
                return true;
            }
            let keys = |m: &serde_json::Map<String, Value>| m.keys().cloned().collect::<BTreeSet<_>>();
            keys(x) == keys(y) && x.iter().all(|(k, v)| same_shape(v, &y[k]))
        }
        (Value::Array(x), Value::Array(y)) => match (x.first(), y.first()) {
            (Some(p), Some(q)) => same_shape(p, q),
            _ => true,
        },
        (Value::Null, _) | (_, Value::Null) => true,
        (x, y) => std::mem::discriminant(x) == std::mem::discriminant(y),
    }
}

fn canonical(dir: &TempDir) -> String {
    dunce::canonicalize(dir.path())
        .unwrap()
        .to_string_lossy()
        .into_owned()
}

fn link(root: &str, device: &str) -> Value {
    json!({ "owner": "spielleiter", "repo": "spielstand-elaris", "branch": "main", "device": device, "root": root })
}

#[test]
fn commands_without_network_follow_the_templates() {
    let app = app();
    let main = window(&app, "main");
    let dir = TempDir::new().unwrap();
    let root = canonical(&dir);
    std::fs::write(dir.path().join("state.json"), "hello\n").unwrap();

    assert_eq!(
        invoke(&main, "sync_link", template("link.input.json", &root)),
        Ok(Value::Null)
    );
    assert_eq!(
        invoke(&main, "sync_mark", template("mark.input.json", &root)),
        Ok(Value::Null)
    );
    let state = invoke(&main, "sync_state", json!({ "root": root, "dataVersion": 1 })).unwrap();
    assert!(
        same_shape(&state, &template("state.output.json", &root)),
        "{state}"
    );
    assert_eq!(state["moved"], json!(false));
    assert_eq!(state["key"], json!("no"));
    assert_eq!(state["restored"], json!(false));

    let scan = invoke(&main, "sync_scan", json!({ "root": root, "remote": false })).unwrap();
    assert!(same_shape(&scan, &template("scan.output.json", &root)), "{scan}");
    assert_eq!(
        scan["local"][0]["sha"],
        json!("ce013625030ba8dba906f756967f9e9ca394464a")
    );
    assert_eq!(
        scan["decided"]["stories/salzgrotte.json"]["fields"],
        json!([["summary"]])
    );

    let begun = invoke(
        &main,
        "sync_apply_begin",
        template("apply_begin.input.json", &root),
    )
    .unwrap();
    assert!(
        same_shape(&begun, &template("apply_begin.output.json", &root)),
        "{begun}"
    );
    let run = begun["run"].clone();
    assert_eq!(
        invoke(&main, "sync_apply_abort", json!({ "root": root, "run": run })),
        Ok(Value::Null)
    );
    let begun = invoke(
        &main,
        "sync_apply_begin",
        template("apply_begin.input.json", &root),
    )
    .unwrap();
    std::fs::create_dir_all(dir.path().join("entities")).unwrap();
    std::fs::write(
        dir.path().join("entities/tannhaus.json"),
        "{\"id\":\"tannhaus\"}\n",
    )
    .unwrap();
    let ended = invoke(
        &main,
        "sync_apply_end",
        json!({ "root": root, "run": begun["run"] }),
    )
    .unwrap();
    assert!(
        same_shape(&ended, &template("apply_end.output.json", &root)),
        "{ended}"
    );
    assert_eq!(ended["done"], json!(["entities/tannhaus.json"]));

    let recovered = invoke(&main, "sync_recover", json!({ "root": root })).unwrap();
    assert_eq!(recovered, template("recover.output.json", &root));

    let put = invoke(
        &main,
        "sync_aside_put",
        json!({ "root": root, "paths": ["state.json"], "reason": "zurueckholen" }),
    )
    .unwrap();
    let list = invoke(&main, "sync_aside_list", json!({ "root": root })).unwrap();
    assert!(same_shape(&list, &template("aside.output.json", &root)), "{list}");
    assert_eq!(
        invoke(
            &main,
            "sync_aside_read",
            json!({ "root": root, "run": put["run"], "side": "hier", "path": "state.json" })
        ),
        Ok(json!("hello\n"))
    );
    assert_eq!(
        invoke(
            &main,
            "sync_aside_drop",
            json!({ "root": root, "run": put["run"] })
        ),
        Ok(Value::Null)
    );

    // Ohne Schlüssel verlässt nichts den Rechner – der Fehler hat die vereinbarte Gestalt.
    let err = invoke(&main, "sync_push", template("push.input.json", &root)).unwrap_err();
    assert!(same_shape(&err, &template("error.json", &root)), "{err}");
    assert_eq!(err["kind"], json!("nokey"));
    let err = invoke(&main, "sync_set_key", json!({ "key": "ghp_alt" })).unwrap_err();
    assert_eq!(err["kind"], json!("input"));

    // Ein kopierter Ordner merkt, dass er nicht der eingerichtete ist.
    let copy = TempDir::new().unwrap();
    let copy_root = canonical(&copy);
    write_link(
        copy.path(),
        &serde_json::from_value(link(&root, "Windows-PC")).unwrap(),
    )
    .unwrap();
    let state = invoke(
        &main,
        "sync_state",
        json!({ "root": copy_root, "dataVersion": 1 }),
    )
    .unwrap();
    assert_eq!(state["moved"], json!(true));
    assert_eq!(
        invoke(
            &main,
            "sync_link",
            json!({ "root": copy_root, "link": link(&root, "Windows-PC"), "moveTo": true })
        ),
        Ok(Value::Null)
    );
    let state = invoke(
        &main,
        "sync_state",
        json!({ "root": copy_root, "dataVersion": 1 }),
    )
    .unwrap();
    assert_eq!(state["moved"], json!(false));
    assert_eq!(
        invoke(&main, "sync_link", json!({ "root": copy_root, "link": null })),
        Ok(Value::Null)
    );
    let state = invoke(
        &main,
        "sync_state",
        json!({ "root": copy_root, "dataVersion": 1 }),
    )
    .unwrap();
    assert_eq!(state["link"], Value::Null);
}

/// Eine App, die gegen den Gegenpart spricht, mit vorbelegtem Schlüssel.
fn online() -> (
    tauri::App<MockRuntime>,
    WebviewWindow<MockRuntime>,
    testserver::Server,
) {
    let server = testserver::start();
    let app = app();
    let main = window(&app, "main");
    let sync = app.state::<Sync>();
    sync.for_tests(server.base.clone());
    sync.keys.preset(KeyState::Present("github_pat_geheim".into()));
    (app, main, server)
}

fn fill(dir: &TempDir, count: usize) -> Vec<Value> {
    let mut changes = Vec::new();
    let mut put = |path: &str, text: String| {
        let full = dir.path().join(path);
        std::fs::create_dir_all(full.parent().unwrap()).unwrap();
        std::fs::write(&full, &text).unwrap();
        changes.push(json!({ "path": path, "sha": blob_sha(text.as_bytes()) }));
    };
    put(
        "campaign.json",
        "{\"id\":\"campaign\",\"name\":\"Hohenfurt\"}\n".into(),
    );
    put("state.json", "{\"id\":\"state\",\"now\":0}\n".into());
    for i in 0..count {
        put(
            &format!("entities/e{i}.json"),
            format!("{{\"id\":\"e{i}\",\"name\":\"Salzgrotte {i} – Äther\"}}\n"),
        );
    }
    changes
}

fn files_of(dir: &Path) -> BTreeMap<String, String> {
    scan_local(dir)
        .unwrap()
        .0
        .into_iter()
        .map(|f| (f.path, f.sha))
        .collect()
}

fn first_push(main: &WebviewWindow<MockRuntime>, root: &str, changes: Vec<Value>) -> Result<Value, Value> {
    invoke(
        main,
        "sync_push",
        json!({ "root": root, "head": null, "tree": null, "changes": changes, "dataVersion": 1,
                "dataShape": "abc", "counts": { "changed": 0, "added": 1, "removed": 0 },
                "link": link(root, "Windows-PC") }),
    )
}

#[test]
fn upload_into_an_empty_repository_then_fetch_into_an_empty_folder() {
    let (_app, main, server) = online();
    let pc = TempDir::new().unwrap();
    let pc_root = canonical(&pc);
    let changes = fill(&pc, 150);
    let scan = invoke(
        &main,
        "sync_scan",
        json!({ "root": pc_root, "remote": true, "link": link(&pc_root, "Windows-PC") }),
    )
    .unwrap();
    assert_eq!(scan["remote"]["kind"], json!("empty"));
    assert_eq!(scan["base"], Value::Null);
    let pushed = first_push(&main, &pc_root, changes).unwrap();
    {
        let repo = server.repo.lock().unwrap();
        assert_eq!(repo.head.as_deref(), pushed["head"].as_str());
        let files = repo.files();
        assert_eq!(files.len(), 152 + 3);
        assert_eq!(files[".gitattributes"], b"* -text\n");
        let marker: Value = serde_json::from_slice(&files["wayfarer.json"]).unwrap();
        assert_eq!(
            marker,
            json!({ "format": "wayfarer-abgleich", "datenstand": 1, "gestalt": "abc", "geraete": { "Windows-PC": 1 } })
        );
        let lines: Vec<&str> = repo.log.iter().map(|(l, _)| l.as_str()).collect();
        assert!(lines.contains(&"PUT /repos/spielleiter/spielstand-elaris/contents/README.md"));
        assert_eq!(lines.iter().filter(|l| l.starts_with("PATCH")).count(), 1);
        for (_, headers) in &repo.log {
            let lower: Vec<String> = headers.iter().map(|h| h.to_ascii_lowercase()).collect();
            assert!(lower.contains(&"authorization: bearer github_pat_geheim".to_string()));
            assert!(lower.contains(&"x-github-api-version: 2026-03-10".to_string()));
            assert!(lower.iter().any(|h| h.starts_with("user-agent: wayfarer/")));
        }
    }
    assert_eq!(
        invoke(
            &main,
            "sync_link",
            json!({ "root": pc_root, "link": link(&pc_root, "Windows-PC") })
        ),
        Ok(Value::Null)
    );

    // Der zweite Rechner holt in einen leeren Ordner – über das Archiv.
    let mac = TempDir::new().unwrap();
    let mac_root = canonical(&mac);
    let mac_link = link(&mac_root, "MacBook");
    let scan = invoke(
        &main,
        "sync_scan",
        json!({ "root": mac_root, "remote": true, "link": mac_link }),
    )
    .unwrap();
    assert_eq!(scan["remote"]["kind"], json!("wayfarer"));
    assert_eq!(scan["remote"]["device"], json!("Windows-PC"));
    let remote: Vec<Value> = scan["remote"]["files"].as_array().unwrap().clone();
    assert_eq!(remote.len(), 152);
    // Eine verfälschte Datei im Eingang wird nicht genommen, sondern neu geholt.
    let first_sha = remote[0]["sha"].as_str().unwrap().to_string();
    std::fs::create_dir_all(mac.path().join(".abgleich/eingang")).unwrap();
    std::fs::write(
        mac.path().join(".abgleich/eingang").join(&first_sha),
        "verfälscht",
    )
    .unwrap();
    let items: Vec<Value> = remote
        .iter()
        .map(|f| json!({ "sha": f["sha"], "path": f["path"] }))
        .collect();
    let fetched = invoke(
        &main,
        "sync_fetch",
        json!({ "root": mac_root, "items": items, "link": mac_link }),
    )
    .unwrap();
    assert_eq!(fetched.as_array().unwrap().len(), 152);
    assert!(fetched
        .as_array()
        .unwrap()
        .iter()
        .all(|f| f["content"].is_string()));
    {
        let repo = server.repo.lock().unwrap();
        let archive: Vec<&(String, Vec<String>)> = repo
            .log
            .iter()
            .filter(|(l, _)| l.starts_with("GET /archiv/"))
            .collect();
        assert_eq!(archive.len(), 1);
        // Das Archiv wird ohne Schlüssel abgerufen.
        assert!(!archive[0]
            .1
            .iter()
            .any(|h| h.to_ascii_lowercase().starts_with("authorization")));
    }
    let writes: Vec<Value> = remote
        .iter()
        .map(|f| json!({ "path": f["path"], "sha": f["sha"], "expect": null, "base": f["sha"] }))
        .collect();
    let base_all: serde_json::Map<String, Value> = remote
        .iter()
        .map(|f| (f["path"].as_str().unwrap().to_string(), f["sha"].clone()))
        .collect();
    // Ein Ordner, in dem schon etwas liegt, nimmt kein Holen an.
    let full = TempDir::new().unwrap();
    fill(&full, 1);
    let err = invoke(
        &main,
        "sync_apply_begin",
        json!({ "root": canonical(&full), "kind": "adopt", "head": scan["remote"]["head"], "reason": "abgleich",
                "writes": [], "deletes": [], "keep": [], "link": mac_link, "baseAll": {} }),
    )
    .unwrap_err();
    assert_eq!(err["kind"], json!("input"));
    invoke(
        &main,
        "sync_apply_begin",
        json!({ "root": mac_root, "kind": "adopt", "head": scan["remote"]["head"], "reason": "abgleich",
                "writes": writes, "deletes": [], "keep": [], "link": mac_link, "baseAll": base_all }),
    )
    .unwrap();
    // Bis zur Wiederaufnahme ist nichts eingerichtet.
    let state = invoke(&main, "sync_state", json!({ "root": mac_root, "dataVersion": 1 })).unwrap();
    assert_eq!(
        (state["link"].clone(), state["pending"].clone()),
        (Value::Null, json!("adopt"))
    );
    let recovered = invoke(&main, "sync_recover", json!({ "root": mac_root })).unwrap();
    assert_eq!(recovered["finished"], json!(152));
    assert_eq!(files_of(mac.path()), files_of(pc.path()));
    let state = invoke(&main, "sync_state", json!({ "root": mac_root, "dataVersion": 1 })).unwrap();
    assert_eq!(state["hasBase"], json!(true));
    assert_eq!(state["link"]["device"], json!("MacBook"));

    // Der Mac ändert eine Datei und lädt hoch; der PC sieht es.
    let changed = "{\"id\":\"e1\",\"name\":\"Tannhaus\"}\n";
    std::fs::write(mac.path().join("entities/e1.json"), changed).unwrap();
    let sha = blob_sha(changed.as_bytes());
    let push = |scan: &Value, sha: &str| {
        invoke(
            &main,
            "sync_push",
            json!({ "root": mac_root, "head": scan["remote"]["head"], "tree": scan["remote"]["tree"],
                    "changes": [{ "path": "entities/e1.json", "sha": sha }],
                    "dataVersion": 1, "dataShape": "abc", "counts": { "changed": 1, "added": 0, "removed": 0 } }),
        )
    };
    let posts = || {
        server
            .repo
            .lock()
            .unwrap()
            .log
            .iter()
            .filter(|(l, _)| l.starts_with("POST"))
            .count()
    };
    let scan = invoke(&main, "sync_scan", json!({ "root": mac_root, "remote": true })).unwrap();
    // Weicht eine Datei vom Plan ab: nichts hochgeladen.
    let before = posts();
    let err = push(&scan, &blob_sha(b"anders")).unwrap_err();
    assert_eq!(err["kind"], json!("busy"));
    assert_eq!(posts(), before);
    // Schiebt vor dem Umschalten ein anderer ein: „moved“, nichts überschrieben.
    server.repo.lock().unwrap().push_in_before_patch = Some(BTreeMap::from([(
        "entities/e2.json".to_string(),
        "{\"id\":\"e2\"}\n".to_string(),
    )]));
    let err = push(&scan, &sha).unwrap_err();
    assert_eq!(err["kind"], json!("moved"));
    assert_eq!(
        server.repo.lock().unwrap().files()["entities/e2.json"],
        b"{\"id\":\"e2\"}\n"
    );
    // Von vorn: jetzt geht es.
    let scan = invoke(&main, "sync_scan", json!({ "root": mac_root, "remote": true })).unwrap();
    push(&scan, &sha).unwrap();
    let pc_scan = invoke(&main, "sync_scan", json!({ "root": pc_root, "remote": true })).unwrap();
    let e1 = pc_scan["remote"]["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == "entities/e1.json")
        .unwrap()
        .clone();
    assert_eq!(e1["sha"], json!(sha));
    assert_eq!(pc_scan["remote"]["device"], json!("MacBook"));
    assert_eq!(pc_scan["remote"]["behind"], json!(false));
}

#[test]
fn a_large_first_upload_goes_in_packets_with_a_control() {
    let (_app, main, server) = online();
    let pc = TempDir::new().unwrap();
    let root = canonical(&pc);
    let changes = fill(&pc, 1000);
    first_push(&main, &root, changes).unwrap();
    let repo = server.repo.lock().unwrap();
    let lines: Vec<&str> = repo.log.iter().map(|(l, _)| l.as_str()).collect();
    assert_eq!(
        lines
            .iter()
            .filter(|l| **l == "POST /repos/spielleiter/spielstand-elaris/git/trees")
            .count(),
        3
    );
    // Kontrolle nach den Paketen, vor dem Commit.
    let control = lines
        .iter()
        .rposition(|l| l.starts_with("GET /repos/spielleiter/spielstand-elaris/git/trees/"))
        .unwrap();
    let commit = lines
        .iter()
        .position(|l| *l == "POST /repos/spielleiter/spielstand-elaris/git/commits")
        .unwrap();
    assert!(control < commit);
    assert_eq!(repo.files().len(), 1002 + 3);
}

#[test]
fn the_control_catches_a_tree_that_lost_files() {
    let (_app, main, server) = online();
    let pc = TempDir::new().unwrap();
    let root = canonical(&pc);
    let changes = fill(&pc, 3);
    // GitHub „vergisst“ den Inhalt: Der neue Baum ist ein unbekannter.
    server.repo.lock().unwrap().forced.push_back(Forced {
        contains: "POST /repos/spielleiter/spielstand-elaris/git/trees".into(),
        status: 201,
        headers: vec![],
        body: "{\"sha\":\"0000000000000000000000000000000000000000\"}".into(),
    });
    let err = first_push(&main, &root, changes).unwrap_err();
    assert!(
        err["kind"] == json!("server") || err["kind"] == json!("missing"),
        "{err}"
    );
    assert!(!server
        .repo
        .lock()
        .unwrap()
        .log
        .iter()
        .any(|(l, _)| l.starts_with("PATCH")));
}

#[test]
fn packets_are_repeated_after_a_broken_connection_and_halved_on_502() {
    let (_app, main, server) = online();
    let pc = TempDir::new().unwrap();
    let root = canonical(&pc);
    let changes = fill(&pc, 10);
    {
        let mut repo = server.repo.lock().unwrap();
        // GET ref? nein – PUT README, GET Baum, GET Ablage; dann bricht der erste Paket-Versuch ab.
        repo.drop_after = Some(3);
        repo.forced.push_back(Forced {
            contains: "POST /repos/spielleiter/spielstand-elaris/git/trees".into(),
            status: 502,
            headers: vec![],
            body: String::new(),
        });
    }
    first_push(&main, &root, changes).unwrap();
    let repo = server.repo.lock().unwrap();
    assert_eq!(repo.files().len(), 12 + 3);
    let posts = repo
        .log
        .iter()
        .filter(|(l, _)| l.starts_with("POST") && l.ends_with("/git/trees"))
        .count();
    assert_eq!(posts, 4, "abgebrochen, 502, dann zwei Hälften");
}

fn linked_with_head(main: &WebviewWindow<MockRuntime>, dir: &TempDir) -> String {
    let root = canonical(dir);
    let changes = fill(dir, 2);
    first_push(main, &root, changes).unwrap();
    invoke(
        main,
        "sync_link",
        json!({ "root": root, "link": link(&root, "Windows-PC") }),
    )
    .unwrap();
    root
}

#[test]
fn answers_are_classified_without_secrets_in_messages() {
    let (_app, main, server) = online();
    let dir = TempDir::new().unwrap();
    let root = linked_with_head(&main, &dir);
    let force = |contains: &str, status: u16, headers: Vec<(String, String)>, body: &str| {
        server.repo.lock().unwrap().forced.push_back(Forced {
            contains: contains.into(),
            status,
            headers,
            body: body.into(),
        });
    };
    let scan = || invoke(&main, "sync_scan", json!({ "root": root, "remote": true }));
    for (status, headers, body, kind) in [
        (401, vec![], "", "key"),
        (
            403,
            vec![("Retry-After".to_string(), "90".to_string())],
            "",
            "limit",
        ),
        (403, vec![], "API rate limit exceeded for user", "limit"),
        (
            403,
            vec![(
                "X-Accepted-GitHub-Permissions".to_string(),
                "contents=write".to_string(),
            )],
            "",
            "denied",
        ),
        (404, vec![], "", "missing"),
        (
            301,
            vec![(
                "Location".to_string(),
                "https://api.github.com/repositories/1".to_string(),
            )],
            "",
            "missing",
        ),
        (502, vec![], "", "server"),
        // Leer (409), obwohl schon ein gemeinsamer Stand da ist: keine leere Ablage, sondern Störung.
        (409, vec![], "", "server"),
    ] {
        force("/git/ref/heads/", status, headers, body);
        let err = scan().unwrap_err();
        assert_eq!(err["kind"], json!(kind), "{status} {body}");
        assert!(!err["message"].as_str().unwrap().contains("geheim"));
        if kind == "limit" {
            assert!(err["retryAfter"].as_u64().unwrap() >= 60);
        }
    }
    // Das Archiv: Weder die Kurzzeit-Adresse noch der Schlüssel stehen in der Meldung.
    let mac = TempDir::new().unwrap();
    let mac_root = canonical(&mac);
    let items: Vec<Value> = (0..100).map(|i| json!({ "sha": format!("{i:040x}") })).collect();
    force("GET /archiv/", 500, vec![], "");
    let err = invoke(
        &main,
        "sync_fetch",
        json!({ "root": mac_root, "items": items, "link": link(&mac_root, "MacBook") }),
    )
    .unwrap_err();
    let message = err["message"].as_str().unwrap();
    assert!(
        !message.contains("geheim") && !message.contains("127.0.0.1"),
        "{message}"
    );
}

#[test]
fn a_truncated_tree_is_read_folder_by_folder() {
    let (_app, main, server) = online();
    let pc = TempDir::new().unwrap();
    let root = linked_with_head(&main, &pc);
    let full = invoke(&main, "sync_scan", json!({ "root": root, "remote": true })).unwrap();
    // Ein anderer Ordner ohne Zwischenspeicher, mit gekürzter Antwort.
    let mac = TempDir::new().unwrap();
    let mac_root = canonical(&mac);
    server.repo.lock().unwrap().truncate = true;
    let cut = invoke(
        &main,
        "sync_scan",
        json!({ "root": mac_root, "remote": true, "link": link(&mac_root, "MacBook") }),
    )
    .unwrap();
    assert_eq!(cut["remote"]["files"], full["remote"]["files"]);
}

#[test]
fn a_repository_behind_what_was_seen_is_reported() {
    let (_app, main, server) = online();
    let pc = TempDir::new().unwrap();
    let root = linked_with_head(&main, &pc);
    let old = server.repo.lock().unwrap().head.clone();
    server.repo.lock().unwrap().commit_files(&BTreeMap::from([(
        "entities/neu.json".to_string(),
        "{}".to_string(),
    )]));
    invoke(&main, "sync_scan", json!({ "root": root, "remote": true })).unwrap();
    server.repo.lock().unwrap().head = old;
    let scan = invoke(&main, "sync_scan", json!({ "root": root, "remote": true })).unwrap();
    assert_eq!(scan["remote"]["behind"], json!(true));
}

#[test]
fn foreign_and_public_repositories_are_never_written() {
    let (_app, main, server) = online();
    let dir = TempDir::new().unwrap();
    let root = canonical(&dir);
    let changes = fill(&dir, 1);
    server.repo.lock().unwrap().commit_files(&BTreeMap::from([(
        "src/main.rs".to_string(),
        "fn main() {}".to_string(),
    )]));
    let scan = invoke(
        &main,
        "sync_scan",
        json!({ "root": root, "remote": true, "link": link(&root, "Windows-PC") }),
    )
    .unwrap();
    assert_eq!(scan["remote"]["kind"], json!("foreign"));
    let err = invoke(
        &main,
        "sync_push",
        json!({ "root": root, "head": scan["remote"]["head"], "tree": scan["remote"]["tree"], "changes": changes,
                "dataVersion": 1, "dataShape": "abc", "counts": {}, "link": link(&root, "Windows-PC") }),
    )
    .unwrap_err();
    assert_eq!(err["kind"], json!("input"));

    let (_app2, main2, server2) = online();
    server2.repo.lock().unwrap().private = false;
    let dir2 = TempDir::new().unwrap();
    let root2 = canonical(&dir2);
    let changes2 = fill(&dir2, 1);
    let err = first_push(&main2, &root2, changes2).unwrap_err();
    assert_eq!(err["kind"], json!("denied"));
    assert!(!server2
        .repo
        .lock()
        .unwrap()
        .log
        .iter()
        .any(|(l, _)| l.starts_with("PATCH")));
}

/// Läuft einmal, sobald eine Anfrage `contains` enthält: merkt im Ordner gleichzeitig etwas
/// (wie eine eingespielte Sicherung oder eine Entscheidung, während der Abgleich im Netz ist).
fn meanwhile(server: &testserver::Server, contains: &'static str, root: &str, input: MarkInput) {
    let root = std::path::PathBuf::from(root);
    let mut input = Some(input);
    server.repo.lock().unwrap().on_request = Some(Box::new(move |line: &str| {
        if line.contains(contains) {
            if let Some(input) = input.take() {
                mark(&root, input).unwrap();
            }
        }
    }));
}

#[test]
fn reading_the_repository_never_undoes_what_was_noted_meanwhile() {
    let (_app, main, server) = online();
    let dir = TempDir::new().unwrap();
    let root = linked_with_head(&main, &dir);
    assert!(read_stand(dir.path()).unwrap().files.is_some());
    // Während der Blick in die Ablage unterwegs ist, wird eine Sicherung eingespielt.
    meanwhile(
        &server,
        "/git/ref/heads/",
        &root,
        MarkInput {
            drop_base: Some(true),
            ..MarkInput::default()
        },
    );
    let scan = invoke(&main, "sync_scan", json!({ "root": root, "remote": true })).unwrap();
    let stand = read_stand(dir.path()).unwrap();
    assert!(stand.files.is_none(), "der gemeinsame Stand ist wieder da");
    assert!(stand.restored);
    assert_eq!(scan["base"], Value::Null);
    assert_eq!(scan["restored"], json!(true), "Frage 1.9 braucht die Angabe");
    let state = invoke(&main, "sync_state", json!({ "root": root, "dataVersion": 1 })).unwrap();
    assert_eq!(state["restored"], json!(true));
    assert!(stand.seen.is_some());
}

#[test]
fn uploading_never_undoes_what_was_noted_meanwhile() {
    let (_app, main, server) = online();
    let dir = TempDir::new().unwrap();
    let root = linked_with_head(&main, &dir);
    let scan = invoke(&main, "sync_scan", json!({ "root": root, "remote": true })).unwrap();
    let changed = "{\"id\":\"e0\",\"name\":\"Tannhaus\"}\n";
    std::fs::write(dir.path().join("entities/e0.json"), changed).unwrap();
    // Während des Hochladens: eine Entscheidung und eine eingespielte Sicherung.
    meanwhile(
        &server,
        "POST /repos/spielleiter/spielstand-elaris/git/commits",
        &root,
        MarkInput {
            drop_base: Some(true),
            decided: Some(BTreeMap::from([(
                "stories/x.json".to_string(),
                Some(Decision {
                    choice: "local".into(),
                    remote: None,
                    fields: None,
                }),
            )])),
            ..MarkInput::default()
        },
    );
    invoke(
        &main,
        "sync_push",
        json!({ "root": root, "head": scan["remote"]["head"], "tree": scan["remote"]["tree"],
                "changes": [{ "path": "entities/e0.json", "sha": blob_sha(changed.as_bytes()) }],
                "dataVersion": 1, "dataShape": "abc", "counts": { "changed": 1, "added": 0, "removed": 0 } }),
    )
    .unwrap();
    let stand = read_stand(dir.path()).unwrap();
    assert!(
        stand.files.is_none(),
        "ein Teil des gemeinsamen Stands ist entstanden"
    );
    assert!(stand.decided.contains_key("stories/x.json"));
    assert_eq!(
        stand.seen.unwrap().files["entities/e0.json"],
        blob_sha(changed.as_bytes())
    );
}

/// Probe gegen GitHub – nur von Hand, nur mit einer Wegwerf-Ablage, nie bei den Prüfungen:
/// `WAYFARER_PROBE_KEY=github_pat_… WAYFARER_PROBE_REPO=konto/wegwerf cargo test probe -- --ignored`
/// Die Ablage muss leer und privat sein. Was abweicht, wird in `classify` und im Gegenpart
/// (`testserver.rs`) nachgezogen.
#[test]
#[ignore]
fn probe_against_a_throwaway_repository() {
    let key = std::env::var("WAYFARER_PROBE_KEY").expect("WAYFARER_PROBE_KEY setzen");
    let repo = std::env::var("WAYFARER_PROBE_REPO").expect("WAYFARER_PROBE_REPO=konto/name setzen");
    let (owner, name) = repo.split_once('/').expect("konto/name");
    let app = app();
    let main = window(&app, "main");
    app.state::<Sync>().keys.preset(KeyState::Present(key));
    let dir = TempDir::new().unwrap();
    let root = canonical(&dir);
    let link = json!({ "owner": owner, "repo": name, "branch": "main", "device": "Probe", "root": root });
    let probe = invoke(&main, "sync_probe", json!({ "owner": owner, "repo": name })).unwrap();
    println!("probe: {probe}");
    let scan = invoke(
        &main,
        "sync_scan",
        json!({ "root": root, "remote": true, "link": link }),
    )
    .unwrap();
    assert_eq!(
        scan["remote"]["kind"],
        json!("empty"),
        "Die Ablage muss leer sein."
    );
    let mut changes = fill(&dir, 398);
    // Umlaute, \r\n, ohne Zeilenende am Schluss.
    std::fs::write(
        dir.path().join("entities/umlaut.json"),
        "{\"name\":\"Äther – Öl\"}\r\n",
    )
    .unwrap();
    std::fs::write(dir.path().join("entities/ohne.json"), "{\"name\":\"ohne Ende\"}").unwrap();
    for path in ["entities/umlaut.json", "entities/ohne.json"] {
        let bytes = std::fs::read(dir.path().join(path)).unwrap();
        changes.push(json!({ "path": path, "sha": blob_sha(&bytes) }));
    }
    let started = std::time::Instant::now();
    let pushed = invoke(
        &main,
        "sync_push",
        json!({ "root": root, "head": null, "tree": null, "changes": changes, "dataVersion": 1,
                "dataShape": "probe", "counts": {}, "link": link }),
    )
    .unwrap();
    println!("erstes Hochladen: {:?}, {pushed}", started.elapsed());
    invoke(&main, "sync_link", json!({ "root": root, "link": link })).unwrap();
    let scan = invoke(&main, "sync_scan", json!({ "root": root, "remote": true })).unwrap();
    assert_eq!(scan["remote"]["files"].as_array().unwrap().len(), 402);
    // Die letzte Datei eines Ordners löschen.
    std::fs::create_dir_all(dir.path().join("solo")).unwrap();
    let solo = "{\"id\":\"s\"}\n";
    std::fs::write(dir.path().join("solo/s.json"), solo).unwrap();
    let one = |changes: Value, scan: &Value| {
        invoke(
            &main,
            "sync_push",
            json!({ "root": root, "head": scan["remote"]["head"], "tree": scan["remote"]["tree"], "changes": changes,
                    "dataVersion": 1, "dataShape": "probe", "counts": {} }),
        )
    };
    one(
        json!([{ "path": "solo/s.json", "sha": blob_sha(solo.as_bytes()) }]),
        &scan,
    )
    .unwrap();
    let scan = invoke(&main, "sync_scan", json!({ "root": root, "remote": true })).unwrap();
    one(json!([{ "path": "solo/s.json", "sha": null }]), &scan).unwrap();
    // Zweites Umschalten auf einem veralteten Kopf: „moved“?
    let err = one(
        json!([{ "path": "state.json", "sha": changes_sha(&dir, "state.json") }]),
        &scan,
    )
    .unwrap_err();
    println!("veralteter Kopf: {err}");
    assert_eq!(err["kind"], json!("moved"));
    // Holen über das Archiv in einen zweiten Ordner.
    let other = TempDir::new().unwrap();
    let other_root = canonical(&other);
    let other_link =
        json!({ "owner": owner, "repo": name, "branch": "main", "device": "Probe2", "root": other_root });
    let scan = invoke(
        &main,
        "sync_scan",
        json!({ "root": other_root, "remote": true, "link": other_link }),
    )
    .unwrap();
    let items: Vec<Value> = scan["remote"]["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| json!({ "sha": f["sha"] }))
        .collect();
    let started = std::time::Instant::now();
    let fetched = invoke(
        &main,
        "sync_fetch",
        json!({ "root": other_root, "items": items, "link": other_link }),
    )
    .unwrap();
    println!(
        "Archiv: {} Dateien in {:?}",
        fetched.as_array().unwrap().len(),
        started.elapsed()
    );
}

fn changes_sha(dir: &TempDir, path: &str) -> String {
    blob_sha(&std::fs::read(dir.path().join(path)).unwrap())
}
