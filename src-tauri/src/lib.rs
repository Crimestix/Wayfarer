//! Rust-Seite von Wayfarer: Dateizugriff auf den Kampagnenordner, Dateiüberwachung,
//! LegendKeeper-Abruf und Schlüsselbund. Die Befehle sind der Vertrag mit der Oberfläche;
//! er steht in `src/data/platform.ts`.

mod config;
mod legendkeeper;
mod links;
mod media;
mod menu;
mod store;
mod watch;
mod window;

use serde::Serialize;
use serde_json::Value;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use config::AppConfig;
use legendkeeper::{LegendKeeper, LkResponse, LkStatus};
use links::LinkTarget;
use media::Media;
use store::StoredFile;
use watch::WatchState;
use window::{CloseAnswer, Closing, MAIN_WINDOW};

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

// ── Bilder ───────────────────────────────────────────────────────────────────

/// Welche Bilder im Kampagnenordner liegen. Merkt sich zugleich, aus welchem Ordner das Fenster
/// Bilder anzeigen darf.
#[tauri::command]
async fn media_list<R: Runtime>(app: AppHandle<R>, root: String) -> Result<Vec<String>, String> {
    let (root, names) = blocking(move || media::list(&root)).await?;
    app.state::<Media>().set_root(root);
    Ok(names)
}

/// Holt ein Bild aus dem Netz in den Kampagnenordner. Gibt die Größe der Datei zurück.
#[tauri::command]
async fn media_fetch<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    url: String,
    name: String,
) -> Result<u64, String> {
    app.state::<Media>().fetch(&root, &url, &name).await
}

/// Beantwortet Anfragen des Fensters nach einem Bild („wfmedia://…/name.png“): die Datei aus
/// dem Ordner `media/` der geöffneten Kampagne – und nichts anderes.
fn serve_media<R: Runtime>(app: &AppHandle<R>, path: &str) -> tauri::http::Response<Vec<u8>> {
    let found = media::name_from_request_path(path).and_then(|name| {
        let root = app.state::<Media>().root()?;
        media::read(&root, name)
    });
    let response = tauri::http::Response::builder();
    match found {
        Some((bytes, mime)) => response
            .status(200)
            .header("Content-Type", mime)
            // Ein Bild ändert sich unter seinem Namen nie.
            .header("Cache-Control", "private, max-age=31536000, immutable")
            .header("X-Content-Type-Options", "nosniff")
            .body(bytes),
        None => response.status(404).body(Vec::new()),
    }
    .expect("feste Kopfzeilen")
}

// ── Fenster ──────────────────────────────────────────────────────────────────

/// Antwort der Oberfläche auf das Ereignis „close-requested“: erst „saving“, dann „saved“
/// oder „unsaved“ (siehe `window.rs`).
#[tauri::command]
fn app_close<R: Runtime>(window: WebviewWindow<R>, state: CloseAnswer) {
    window::answer(&window, state);
}

/// Öffnet das Hauptfenster, wie es in `tauri.conf.json` beschrieben ist – in der Größe vom
/// letzten Mal –, und legt fest, wohin Links führen: Die App bleibt im Fenster, Webadressen
/// gehen an den Browser des Systems.
fn open_main_window<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let config = app.config();
    let window = config
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
        .expect("tauri.conf.json beschreibt das Hauptfenster");
    let remembered = config_dir(app.handle())
        .ok()
        .and_then(|dir| window::load_state(&dir));
    let (width, height) = window::opening_size(
        remembered,
        (window.width, window.height),
        (window.min_width.unwrap_or(0.0), window.min_height.unwrap_or(0.0)),
        window::usable_screen(app.handle()),
    );
    let dev_origin = if cfg!(dev) {
        config.build.dev_url.clone()
    } else {
        None
    };
    let dev_origin_for_new_windows = dev_origin.clone();
    let mut builder = WebviewWindowBuilder::from_config(app, window)?
        .inner_size(width, height)
        .maximized(remembered.is_some_and(|state| state.maximized));
    if !cfg!(debug_assertions) {
        builder = builder.initialization_script(window::DESKTOP_MANNERS);
    }
    builder
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
    // Nur macOS hat eine Menüleiste; dort soll sie deutsch sein. In den Tests nicht: Menüs
    // dürfen auf macOS nur im Hauptthread entstehen, Tests laufen in eigenen Threads.
    let builder = if cfg!(target_os = "macos") && !cfg!(test) {
        builder.menu(menu::build).on_menu_event(menu::on_event)
    } else {
        builder
    };
    builder
        .setup(|app| {
            open_main_window(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Erst speichern lassen, dann schließen.
                if let Some(main) = window
                    .get_webview_window(MAIN_WINDOW)
                    .filter(|_| window.label() == MAIN_WINDOW)
                {
                    api.prevent_close();
                    window::request_close(&main);
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol(media::SCHEME, |context, request, responder| {
            let app = context.app_handle().clone();
            let path = request.uri().path().to_string();
            // Große Kartenbilder werden abseits der Oberfläche gelesen.
            std::thread::spawn(move || responder.respond(serve_media(&app, &path)));
        })
        .manage(Media::default())
        .manage(WatchState::default())
        .manage(LegendKeeper::default())
        .manage(Closing::default())
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
            media_list,
            media_fetch,
            app_close,
        ])
}

pub fn run() {
    let mut builder = tauri::Builder::default();
    // Im fertigen Programm läuft Wayfarer nur einmal: Ein zweiter Start holt das offene Fenster
    // nach vorn, statt dieselbe Kampagne doppelt zu öffnen. (Muss als Erstes angemeldet werden.)
    if !cfg!(debug_assertions) {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::bring_to_front(app);
        }));
    }
    wayfarer(builder)
        .run(context())
        .expect("Wayfarer konnte nicht gestartet werden");
}

#[cfg(test)]
mod tests;

/// Der Kontext der App (Einstellungen, Symbole, Berechtigungen). Das Makro darf im ganzen Paket
/// nur einmal vorkommen: Auf macOS legt es ein Symbol an, das ein zweites Mal den Bau abbricht.
pub(crate) fn context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}
