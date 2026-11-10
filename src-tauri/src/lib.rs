//! Rust-Seite von Wayfarer: Dateizugriff auf den Kampagnenordner, Dateiüberwachung,
//! LegendKeeper-Abruf und Schlüsselbund. Die Befehle sind der Vertrag mit der Oberfläche;
//! er steht in `src/data/platform.ts`.

mod config;
mod legendkeeper;
mod links;
mod store;
mod watch;

use serde::Serialize;
use serde_json::Value;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindowBuilder};

use config::AppConfig;
use legendkeeper::{LegendKeeper, LkResponse, LkStatus};
use links::LinkTarget;
use store::StoredFile;
use watch::WatchState;

/// Führt Dateiarbeit abseits der Oberfläche aus, damit ein träges Cloud-Laufwerk nichts blockiert.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "Ein interner Arbeitsschritt wurde unerwartet abgebrochen.".to_string())?
}

fn config_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|_| "Der Ordner für die Einstellungen der App ließ sich nicht bestimmen.".to_string())
}

// ── Einstellungen ────────────────────────────────────────────────────────────

#[tauri::command]
async fn config_get<R: Runtime>(app: AppHandle<R>) -> Result<AppConfig, String> {
    let dir = config_dir(&app)?;
    blocking(move || Ok(config::load(&dir))).await
}

#[tauri::command]
async fn config_set<R: Runtime>(app: AppHandle<R>, campaign_dir: Option<String>) -> Result<(), String> {
    let dir = config_dir(&app)?;
    let campaign_dir = campaign_dir.filter(|dir| !dir.trim().is_empty());
    blocking(move || config::save(&dir, &AppConfig { campaign_dir })).await
}

// ── Kampagnenordner ──────────────────────────────────────────────────────────

#[tauri::command]
async fn store_read_all(root: String) -> Result<Vec<StoredFile>, String> {
    blocking(move || store::read_all(&root)).await
}

#[tauri::command]
async fn store_read(root: String, path: String) -> Result<Option<String>, String> {
    blocking(move || store::read(&root, &path)).await
}

#[tauri::command]
async fn store_write(root: String, path: String, content: String) -> Result<(), String> {
    blocking(move || store::write(&root, &path, &content)).await
}

#[tauri::command]
async fn store_remove(root: String, path: String) -> Result<(), String> {
    blocking(move || store::remove(&root, &path)).await
}

#[derive(Clone, Serialize)]
struct StoreChanged {
    paths: Vec<String>,
}

/// Beginnt, den Kampagnenordner zu überwachen. Ein erneuter Aufruf ersetzt die bisherige Überwachung.
#[tauri::command]
async fn store_watch<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, WatchState>,
    root: String,
) -> Result<(), String> {
    let emitter = app.clone();
    let started = blocking(move || {
        watch::start(&root, move |paths| {
            let _ = emitter.emit("store-changed", StoreChanged { paths });
        })
    })
    .await?;
    let mut active = state
        .0
        .lock()
        .map_err(|_| "Interner Fehler in der Ordnerüberwachung.".to_string())?;
    *active = Some(started);
    Ok(())
}

// ── LegendKeeper ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn lk_status<R: Runtime>(app: AppHandle<R>) -> Result<LkStatus, String> {
    blocking(move || {
        let has_key = app.state::<LegendKeeper>().keys.get()?.is_some();
        Ok(LkStatus { has_key })
    })
    .await
}

#[tauri::command]
async fn lk_set_key<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
    blocking(move || app.state::<LegendKeeper>().keys.set(&key)).await
}

#[tauri::command]
async fn lk_clear_key<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    blocking(move || app.state::<LegendKeeper>().keys.clear()).await
}

#[tauri::command]
async fn lk_get<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    query: Option<Value>,
) -> Result<LkResponse, String> {
    let reader = app.clone();
    let key = blocking(move || reader.state::<LegendKeeper>().keys.get())
        .await?
        .ok_or_else(|| "Es ist noch kein LegendKeeper-Key hinterlegt.".to_string())?;
    app.state::<LegendKeeper>().get(&key, &path, query.as_ref()).await
}

/// Öffnet das Hauptfenster, wie es in `tauri.conf.json` beschrieben ist, und legt fest, wohin
/// Links führen: Die App bleibt im Fenster, Webadressen gehen an den Browser des Systems.
fn open_main_window<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let config = app.config();
    let window = config
        .app
        .windows
        .first()
        .expect("tauri.conf.json beschreibt das Hauptfenster");
    let dev_origin = if cfg!(dev) {
        config.build.dev_url.clone()
    } else {
        None
    };
    let dev_origin_for_new_windows = dev_origin.clone();
    WebviewWindowBuilder::from_config(app, window)?
        .on_navigation(move |url| match links::link_target(url, dev_origin.as_ref()) {
            LinkTarget::App => true,
            LinkTarget::Browser => {
                links::open_in_browser(url);
                false
            }
            LinkTarget::Blocked => false,
        })
        .on_new_window(move |url, _features| {
            // Wayfarer öffnet nie selbst weitere Fenster; „in neuem Tab öffnen“ meint den Browser.
            if links::link_target(&url, dev_origin_for_new_windows.as_ref()) == LinkTarget::Browser {
                links::open_in_browser(&url);
            }
            NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

/// Meldet Plugins, Zustand und Befehle an – für die echte App ebenso wie für die Tests.
fn wayfarer<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .setup(|app| {
            open_main_window(app)?;
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .manage(WatchState::default())
        .manage(LegendKeeper::default())
        .invoke_handler(tauri::generate_handler![
            config_get,
            config_set,
            store_read_all,
            store_read,
            store_write,
            store_remove,
            store_watch,
            lk_status,
            lk_set_key,
            lk_clear_key,
            lk_get,
        ])
}

pub fn run() {
    wayfarer(tauri::Builder::default())
        .run(tauri::generate_context!())
        .expect("Wayfarer konnte nicht gestartet werden");
}

#[cfg(test)]
mod tests;
