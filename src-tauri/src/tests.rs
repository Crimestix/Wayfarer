//! Prüft den Vertrag mit der Oberfläche: Jeder Befehl wird so aufgerufen, wie
//! `src/data/platform.ts` es tut (gleiche Namen, gleiche Parameter), und zwar mit den echten
//! Berechtigungen aus `capabilities/main.json` – nur ohne Fenster.

use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{Listener, WebviewWindow, WebviewWindowBuilder};
use tempfile::TempDir;

fn app() -> tauri::App<MockRuntime> {
    crate::wayfarer(mock_builder())
        .build(tauri::generate_context!())
        .expect("App für Tests")
}

fn window(app: &tauri::App<MockRuntime>, label: &str) -> WebviewWindow<MockRuntime> {
    WebviewWindowBuilder::new(app, label, Default::default())
        .build()
        .unwrap()
}

/// Ruft einen Befehl auf, wie `invoke(cmd, args)` es in der Oberfläche tut.
fn invoke(webview: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize::<Value>().unwrap())
}

#[test]
fn store_commands_follow_the_contract() {
    let app = app();
    let main = window(&app, "main");
    let dir = TempDir::new().unwrap();
    let root = dir.path().to_str().unwrap();

    assert_eq!(
        invoke(&main, "store_read_all", json!({ "root": root })),
        Ok(json!([]))
    );
    assert_eq!(
        invoke(
            &main,
            "store_read",
            json!({ "root": root, "path": "campaign.json" })
        ),
        Ok(Value::Null)
    );
    assert_eq!(
        invoke(
            &main,
            "store_write",
            json!({ "root": root, "path": "entities/abc.json", "content": "{\"id\":\"abc\"}" })
        ),
        Ok(Value::Null)
    );
    assert_eq!(
        invoke(
            &main,
            "store_read",
            json!({ "root": root, "path": "entities/abc.json" })
        ),
        Ok(json!("{\"id\":\"abc\"}"))
    );
    assert_eq!(
        invoke(&main, "store_read_all", json!({ "root": root })),
        Ok(json!([{ "path": "entities/abc.json", "content": "{\"id\":\"abc\"}" }]))
    );
    assert_eq!(
        invoke(
            &main,
            "store_remove",
            json!({ "root": root, "path": "entities/abc.json" })
        ),
        Ok(Value::Null)
    );
    assert_eq!(
        invoke(&main, "store_read_all", json!({ "root": root })),
        Ok(json!([]))
    );

    // Fehler kommen als verständlicher deutscher Satz zurück.
    let err = invoke(
        &main,
        "store_write",
        json!({ "root": root, "path": "../raus.json", "content": "x" }),
    )
    .unwrap_err();
    assert!(err.as_str().unwrap().contains("Ungültiger Dateipfad"), "{err}");
    let err = invoke(
        &main,
        "store_read_all",
        json!({ "root": dir.path().join("fehlt").to_str().unwrap() }),
    )
    .unwrap_err();
    assert!(err.as_str().unwrap().contains("nicht erreichbar"), "{err}");
}

#[test]
fn store_watch_sends_store_changed_with_relative_paths() {
    let app = app();
    let main = window(&app, "main");
    let dir = TempDir::new().unwrap();
    let other = TempDir::new().unwrap();
    let root = dir.path().to_str().unwrap();
    let (tx, rx) = mpsc::channel::<Value>();
    app.listen("store-changed", move |event| {
        let _ = tx.send(serde_json::from_str(event.payload()).unwrap());
    });

    // Ein zweiter Aufruf ersetzt die erste Überwachung: der alte Ordner meldet nichts mehr.
    assert_eq!(
        invoke(
            &main,
            "store_watch",
            json!({ "root": other.path().to_str().unwrap() })
        ),
        Ok(Value::Null)
    );
    assert_eq!(
        invoke(&main, "store_watch", json!({ "root": root })),
        Ok(Value::Null)
    );
    std::thread::sleep(Duration::from_millis(200));
    std::fs::write(other.path().join("state.json"), "{}").unwrap();
    assert_eq!(
        invoke(
            &main,
            "store_write",
            json!({ "root": root, "path": "state.json", "content": "{}" })
        ),
        Ok(Value::Null)
    );

    // Je nach Betriebssystem kommt die Änderung in einer oder mehreren Meldungen an –
    // aber immer nur für die Datei im aktuell überwachten Ordner.
    let first = rx
        .recv_timeout(Duration::from_secs(10))
        .expect("Ereignis „store-changed“ erwartet");
    assert_eq!(first, json!({ "paths": ["state.json"] }));
    while let Ok(later) = rx.recv_timeout(Duration::from_millis(1200)) {
        assert_eq!(
            later,
            json!({ "paths": ["state.json"] }),
            "der ersetzte Ordner meldet noch"
        );
    }
}

#[test]
fn legendkeeper_commands_validate_before_anything_leaves_the_machine() {
    let app = app();
    let main = window(&app, "main");
    let err = invoke(&main, "lk_set_key", json!({ "key": "   " })).unwrap_err();
    assert!(err.as_str().unwrap().contains("LegendKeeper-Key"), "{err}");
    let err = invoke(&main, "lk_set_key", json!({ "key": "zwei worte" })).unwrap_err();
    assert!(err.as_str().unwrap().contains("sieht nicht nach"), "{err}");
}

#[test]
fn only_the_main_window_may_call_commands() {
    let app = app();
    let main = window(&app, "main");
    let other = window(&app, "fremd");
    let dir = TempDir::new().unwrap();
    let root = dir.path().to_str().unwrap();
    assert!(invoke(&main, "store_read_all", json!({ "root": root })).is_ok());
    for cmd in [
        "store_read_all",
        "store_write",
        "config_get",
        "lk_status",
        "lk_get",
    ] {
        let err = invoke(
            &other,
            cmd,
            json!({ "root": root, "path": "x.json", "content": "" }),
        )
        .unwrap_err();
        assert!(err.to_string().contains("not allowed"), "{cmd}: {err}");
    }
    // Was nicht ausdrücklich freigegeben ist, bleibt auch dem Hauptfenster verwehrt.
    let err = invoke(&main, "plugin:dialog|save", json!({ "options": {} })).unwrap_err();
    assert!(err.to_string().contains("not allowed"), "{err}");
}

/// Nur unter Linux lässt sich der Einstellungsordner für den Test umlenken (XDG_CONFIG_HOME).
#[cfg(target_os = "linux")]
#[test]
fn config_commands_follow_the_contract() {
    let home = TempDir::new().unwrap();
    // Wird nur in diesem einen Test gesetzt und von keinem anderen gelesen.
    unsafe { std::env::set_var("XDG_CONFIG_HOME", home.path()) };
    let app = app();
    let main = window(&app, "main");

    assert_eq!(
        invoke(&main, "config_get", json!({})),
        Ok(json!({ "campaignDir": null }))
    );
    assert_eq!(
        invoke(&main, "config_set", json!({ "campaignDir": "/cloud/Elaris" })),
        Ok(Value::Null)
    );
    assert_eq!(
        invoke(&main, "config_get", json!({})),
        Ok(json!({ "campaignDir": "/cloud/Elaris" }))
    );
    let file = home.path().join("app.wayfarer.desktop").join("config.json");
    assert!(
        file.is_file(),
        "Einstellungen liegen im Konfigurationsordner der App"
    );
    assert_eq!(
        invoke(&main, "config_set", json!({ "campaignDir": null })),
        Ok(Value::Null)
    );
    assert_eq!(
        invoke(&main, "config_get", json!({})),
        Ok(json!({ "campaignDir": null }))
    );
}
