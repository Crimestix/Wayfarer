//! Das Hauptfenster: wie es sich öffnet (Größe vom letzten Mal, nie größer als der Bildschirm),
//! wie es sich schließt (erst speichern, dann schließen) und ein paar Manieren, die ein
//! installiertes Programm von einer Webseite unterscheiden.
//!
//! Schließen läuft in drei Schritten, weil die Oberfläche Änderungen einen Augenblick sammelt,
//! bevor sie sie schreibt:
//!   1. Jemand will das Fenster schließen → Ereignis „close-requested“ an die Oberfläche.
//!   2. Die Oberfläche meldet sich sofort mit `app_close({ state: "saving" })` und schreibt.
//!   3. Sie meldet `"saved"` (Fenster schließt) oder `"unsaved"` (Rückfrage, ob trotzdem).
//!
//! Meldet sich die Oberfläche gar nicht (nicht geladen, hängt), schließt das Fenster nach
//! kurzer Frist von selbst.
//!
//! Ist gespeichert und lädt der Abgleich noch hoch, meldet die Oberfläche `"syncing"`. Dann
//! schließt das Fenster spätestens nach 12 Sekunden – die Frist wacht hier, nicht in der
//! Webansicht (deren Zeitgeber werden in einem verborgenen Fenster gedrosselt). Ein zweiter
//! Klick auf Schließen schließt in dieser Zeit sofort.

use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::store::write_atomic;

pub const MAIN_WINDOW: &str = "main";
pub const CLOSE_REQUESTED_EVENT: &str = "close-requested";

/// So lange hat die Oberfläche Zeit, sich auf „close-requested“ zu melden.
const ANSWER_GRACE: Duration = Duration::from_millis(1500);
/// So lange darf der Abgleich beim Schließen noch hochladen.
pub const SYNC_GRACE: Duration = Duration::from_secs(12);

// ── Schließen ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ClosePhase {
    /// Niemand will schließen.
    #[default]
    Open,
    /// Die Oberfläche wurde gefragt und hat sich noch nicht gemeldet (mit laufender Nummer).
    Requested(u64),
    /// Die Oberfläche speichert gerade.
    Saving,
    /// Es läuft eine Rückfrage an den Menschen.
    Asking,
    /// Gespeichert; der Abgleich lädt noch hoch (mit laufender Nummer der Frist).
    Syncing(u64),
}

/// Was die Oberfläche auf „close-requested“ antwortet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CloseAnswer {
    Saving,
    Syncing,
    Saved,
    Unsaved,
}

/// Wonach beim Schließen gefragt wird.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Question {
    /// Das Speichern ist fehlgeschlagen.
    Unsaved,
    /// Das Speichern läuft noch, und jemand will schon wieder schließen.
    StillSaving,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseStep {
    Nothing,
    /// „close-requested“ senden und die Frist mit dieser Nummer starten.
    AskFrontend(u64),
    AskHuman(Question),
    /// Die Frist für den Abgleich mit dieser Nummer starten.
    SyncDeadline(u64),
    CloseNow,
}

/// Jemand will das Fenster schließen (Schließen-Knopf, Alt+F4, „Beenden“ im Menü).
pub fn on_close_request(phase: ClosePhase, next_ticket: u64) -> (ClosePhase, CloseStep) {
    match phase {
        ClosePhase::Open => (
            ClosePhase::Requested(next_ticket),
            CloseStep::AskFrontend(next_ticket),
        ),
        // Ungeduld während des Speicherns: nicht einfach schließen, sondern nachfragen.
        ClosePhase::Saving => (ClosePhase::Asking, CloseStep::AskHuman(Question::StillSaving)),
        // Gespeichert ist schon; der Abgleich holt beim nächsten Öffnen nach.
        ClosePhase::Syncing(_) => (ClosePhase::Open, CloseStep::CloseNow),
        ClosePhase::Requested(_) | ClosePhase::Asking => (phase, CloseStep::Nothing),
    }
}

/// Die Oberfläche meldet sich.
pub fn on_answer(phase: ClosePhase, answer: CloseAnswer) -> (ClosePhase, CloseStep) {
    match (phase, answer) {
        (ClosePhase::Requested(_), CloseAnswer::Saving) => (ClosePhase::Saving, CloseStep::Nothing),
        // Die Nummer der Frist vergibt `advance`.
        (ClosePhase::Requested(_) | ClosePhase::Saving, CloseAnswer::Syncing) => {
            (ClosePhase::Syncing(0), CloseStep::Nothing)
        }
        (ClosePhase::Syncing(_), CloseAnswer::Saved) => (ClosePhase::Open, CloseStep::CloseNow),
        (ClosePhase::Syncing(_), CloseAnswer::Unsaved) => {
            (ClosePhase::Asking, CloseStep::AskHuman(Question::Unsaved))
        }
        (ClosePhase::Requested(_) | ClosePhase::Saving, CloseAnswer::Saved) => {
            (ClosePhase::Open, CloseStep::CloseNow)
        }
        (ClosePhase::Requested(_) | ClosePhase::Saving, CloseAnswer::Unsaved) => {
            (ClosePhase::Asking, CloseStep::AskHuman(Question::Unsaved))
        }
        // Während einer Rückfrage oder nach „Zurück zu Wayfarer“ entscheidet der Mensch, nicht die Oberfläche.
        _ => (phase, CloseStep::Nothing),
    }
}

/// Die Frist für die erste Antwort ist abgelaufen.
pub fn on_grace_over(phase: ClosePhase, ticket: u64) -> (ClosePhase, CloseStep) {
    match phase {
        ClosePhase::Requested(current) if current == ticket => (ClosePhase::Open, CloseStep::CloseNow),
        _ => (phase, CloseStep::Nothing),
    }
}

/// Die Frist für den Abgleich ist abgelaufen: schließen, gleich wie weit er ist.
pub fn on_sync_over(phase: ClosePhase, ticket: u64) -> (ClosePhase, CloseStep) {
    match phase {
        ClosePhase::Syncing(current) if current == ticket => (ClosePhase::Open, CloseStep::CloseNow),
        _ => (phase, CloseStep::Nothing),
    }
}

/// Der Mensch hat die Rückfrage beantwortet.
pub fn on_human_answer(phase: ClosePhase, close_anyway: bool) -> (ClosePhase, CloseStep) {
    match phase {
        ClosePhase::Asking if close_anyway => (ClosePhase::Open, CloseStep::CloseNow),
        ClosePhase::Asking => (ClosePhase::Open, CloseStep::Nothing),
        _ => (phase, CloseStep::Nothing),
    }
}

#[derive(Default)]
struct CloseProgress {
    phase: ClosePhase,
    tickets: u64,
}

/// Stand des Schließens für das Hauptfenster.
#[derive(Default)]
pub struct Closing(Mutex<CloseProgress>);

/// Wendet eine der Regeln oben auf den Stand des Fensters an und führt den Schritt aus.
/// `decide` bekommt den Stand und die nächste freie Nummer.
fn advance<R: Runtime>(
    window: &WebviewWindow<R>,
    decide: &dyn Fn(ClosePhase, u64) -> (ClosePhase, CloseStep),
) {
    let step = {
        let closing = window.state::<Closing>();
        let Ok(mut progress) = closing.0.lock() else {
            // Lieber schließen als ein Fenster, das sich nie mehr schließen lässt.
            return close_now(window);
        };
        let (mut phase, mut step) = decide(progress.phase, progress.tickets + 1);
        if let CloseStep::AskFrontend(ticket) = step {
            progress.tickets = ticket;
        }
        if phase == ClosePhase::Syncing(0) {
            progress.tickets += 1;
            phase = ClosePhase::Syncing(progress.tickets);
            step = CloseStep::SyncDeadline(progress.tickets);
        }
        progress.phase = phase;
        step
    };
    match step {
        CloseStep::Nothing => {}
        CloseStep::AskFrontend(ticket) => {
            let _ = window.app_handle().emit(CLOSE_REQUESTED_EVENT, ());
            let window = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(ANSWER_GRACE);
                advance(&window, &|phase, _| on_grace_over(phase, ticket));
            });
        }
        CloseStep::SyncDeadline(ticket) => {
            let window = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(SYNC_GRACE);
                advance(&window, &|phase, _| on_sync_over(phase, ticket));
            });
        }
        CloseStep::AskHuman(question) => ask_human(window, question),
        CloseStep::CloseNow => close_now(window),
    }
}

/// Beginnt das Schließen. Das eigentliche Schließen wurde vorher mit `prevent_close` aufgehalten.
pub fn request_close<R: Runtime>(window: &WebviewWindow<R>) {
    advance(window, &on_close_request);
}

/// Antwort der Oberfläche (Befehl `app_close`).
pub fn answer<R: Runtime>(window: &WebviewWindow<R>, answer: CloseAnswer) {
    advance(window, &|phase, _| on_answer(phase, answer));
}

#[cfg(test)]
pub fn current_phase<R: Runtime>(window: &WebviewWindow<R>) -> ClosePhase {
    window.state::<Closing>().0.lock().unwrap().phase
}

fn ask_human<R: Runtime>(window: &WebviewWindow<R>, question: Question) {
    let message = match question {
        Question::Unsaved => {
            "Die letzten Änderungen ließen sich nicht speichern – vermutlich ist der Kampagnenordner \
             gerade nicht erreichbar.\n\nWenn du Wayfarer jetzt schließt, gehen sie verloren."
        }
        Question::StillSaving => {
            "Wayfarer speichert noch.\n\nWenn du jetzt schließt, gehen die letzten Änderungen \
             womöglich verloren."
        }
    };
    let asked = window.clone();
    window
        .dialog()
        .message(message)
        .title("Wayfarer schließen?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Trotzdem schließen".into(),
            "Zurück zu Wayfarer".into(),
        ))
        .parent(window)
        .show(move |close_anyway| advance(&asked, &|phase, _| on_human_answer(phase, close_anyway)));
}

fn close_now<R: Runtime>(window: &WebviewWindow<R>) {
    remember(window);
    let _ = window.destroy();
}

/// Holt das Hauptfenster nach vorn – wenn Wayfarer ein zweites Mal gestartet wird.
pub fn bring_to_front<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// ── Größe merken ─────────────────────────────────────────────────────────────

const WINDOW_FILE: &str = "window.json";
/// Platz für Titelleiste und Fensterrand, den die nutzbare Bildschirmfläche hergeben muss.
const FRAME_HEIGHT: f64 = 40.0;

/// Größe des Fensterinhalts in Bildpunkten, wie die Oberfläche sie sieht (unabhängig von der Skalierung).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub maximized: bool,
}

pub fn load_state(dir: &Path) -> Option<WindowState> {
    let text = fs::read_to_string(dir.join(WINDOW_FILE)).ok()?;
    let state: WindowState = serde_json::from_str(&text).ok()?;
    (state.width.is_finite() && state.height.is_finite()).then_some(state)
}

pub fn save_state(dir: &Path, state: &WindowState) {
    if let Ok(text) = serde_json::to_string(state) {
        // Gelingt das nicht, öffnet sich das Fenster beim nächsten Mal eben in der Vorgabegröße.
        let _ = write_atomic(&dir.join(WINDOW_FILE), text.as_bytes());
    }
}

/// Die Größe, in der das Fenster aufgehen soll: die gemerkte (sonst die Vorgabe), aber nie
/// kleiner als die Mindestgröße und nie größer als die nutzbare Fläche des Bildschirms.
pub fn opening_size(
    remembered: Option<WindowState>,
    default: (f64, f64),
    min: (f64, f64),
    screen: Option<(f64, f64)>,
) -> (f64, f64) {
    let (width, height) = remembered.map_or(default, |state| (state.width, state.height));
    let (max_width, max_height) = screen.map_or((f64::MAX, f64::MAX), |(w, h)| (w, h - FRAME_HEIGHT));
    (
        width.min(max_width).max(min.0).round(),
        height.min(max_height).max(min.1).round(),
    )
}

/// Nutzbare Fläche des Hauptbildschirms (ohne Taskleiste, Menüleiste, Dock) in Bildpunkten der Oberfläche.
pub fn usable_screen<R: Runtime>(app: &AppHandle<R>) -> Option<(f64, f64)> {
    let monitor = app.primary_monitor().ok()??;
    let scale = monitor.scale_factor();
    let area = monitor.work_area().size;
    (scale > 0.0 && area.width > 0 && area.height > 0)
        .then(|| (f64::from(area.width) / scale, f64::from(area.height) / scale))
}

/// Die Vorgabegröße aus `tauri.conf.json`.
fn configured_size<R: Runtime>(window: &WebviewWindow<R>) -> Option<(f64, f64)> {
    let config = window.config();
    let main = config.app.windows.iter().find(|w| w.label == MAIN_WINDOW)?;
    Some((main.width, main.height))
}

/// Merkt sich Größe und „maximiert“ für den nächsten Start.
fn remember<R: Runtime>(window: &WebviewWindow<R>) {
    let Ok(dir) = window.path().app_config_dir() else {
        return;
    };
    let maximized = window.is_maximized().unwrap_or(false);
    let special =
        maximized || window.is_fullscreen().unwrap_or(false) || window.is_minimized().unwrap_or(false);
    let size = if special {
        // Maximiert, im Vollbild oder im Dock: die zuletzt gemerkte gewöhnliche Größe bleibt gültig.
        load_state(&dir)
            .map(|state| (state.width, state.height))
            .or_else(|| configured_size(window))
    } else {
        match (window.inner_size(), window.scale_factor()) {
            (Ok(size), Ok(scale)) if scale > 0.0 && size.width > 0 && size.height > 0 => {
                Some((f64::from(size.width) / scale, f64::from(size.height) / scale))
            }
            _ => None,
        }
    };
    if let Some((width, height)) = size {
        save_state(
            &dir,
            &WindowState {
                width: width.round(),
                height: height.round(),
                maximized,
            },
        );
    }
}

// ── Manieren ─────────────────────────────────────────────────────────────────

/// Läuft vor der Oberfläche, nur im fertigen Programm: kein Browser-Kontextmenü („Neu laden“,
/// „Zurück“, „Speichern unter“) außer in Eingabefeldern, und F5 / Strg+R laden die App nicht neu.
pub const DESKTOP_MANNERS: &str = r#"(function () {
  document.addEventListener('contextmenu', function (event) {
    var target = event.target;
    var editable = target && target.closest &&
      target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
    if (!editable) event.preventDefault();
  }, true);
  window.addEventListener('keydown', function (event) {
    var key = event.key;
    var reload = key === 'F5' || ((event.ctrlKey || event.metaKey) && (key === 'r' || key === 'R'));
    if (reload) event.preventDefault();
  }, true);
})();"#;

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn closing_waits_for_the_frontend_to_save() {
        let (phase, step) = on_close_request(ClosePhase::Open, 1);
        assert_eq!(
            (phase, step),
            (ClosePhase::Requested(1), CloseStep::AskFrontend(1))
        );
        let (phase, step) = on_answer(phase, CloseAnswer::Saving);
        assert_eq!((phase, step), (ClosePhase::Saving, CloseStep::Nothing));
        // Die Frist gilt nur, solange sich die Oberfläche nicht gemeldet hat.
        assert_eq!(on_grace_over(phase, 1), (ClosePhase::Saving, CloseStep::Nothing));
        assert_eq!(
            on_answer(phase, CloseAnswer::Saved),
            (ClosePhase::Open, CloseStep::CloseNow)
        );
    }

    #[test]
    fn a_silent_frontend_does_not_keep_the_window_open() {
        let (phase, _) = on_close_request(ClosePhase::Open, 7);
        // Ein zweiter Klick auf „Schließen“ ändert nichts …
        assert_eq!(on_close_request(phase, 8), (phase, CloseStep::Nothing));
        // … eine veraltete Frist auch nicht …
        assert_eq!(on_grace_over(phase, 6), (phase, CloseStep::Nothing));
        // … die eigene schließt das Fenster.
        assert_eq!(on_grace_over(phase, 7), (ClosePhase::Open, CloseStep::CloseNow));
        // Eine Oberfläche ohne offene Änderungen darf auch gleich „gespeichert“ melden.
        assert_eq!(
            on_answer(phase, CloseAnswer::Saved),
            (ClosePhase::Open, CloseStep::CloseNow)
        );
    }

    #[test]
    fn unsaved_changes_are_never_dropped_without_asking() {
        let (phase, step) = on_answer(ClosePhase::Saving, CloseAnswer::Unsaved);
        assert_eq!(
            (phase, step),
            (ClosePhase::Asking, CloseStep::AskHuman(Question::Unsaved))
        );
        // Während der Rückfrage zählt nur die Antwort des Menschen.
        assert_eq!(on_close_request(phase, 2), (phase, CloseStep::Nothing));
        assert_eq!(on_answer(phase, CloseAnswer::Saved), (phase, CloseStep::Nothing));
        assert_eq!(on_grace_over(phase, 1), (phase, CloseStep::Nothing));
        assert_eq!(
            on_human_answer(phase, false),
            (ClosePhase::Open, CloseStep::Nothing)
        );
        assert_eq!(
            on_human_answer(phase, true),
            (ClosePhase::Open, CloseStep::CloseNow)
        );
        // Nach „Zurück zu Wayfarer“ schließt eine verspätete Meldung der Oberfläche nichts mehr.
        assert_eq!(
            on_answer(ClosePhase::Open, CloseAnswer::Saved),
            (ClosePhase::Open, CloseStep::Nothing)
        );
        assert_eq!(
            on_human_answer(ClosePhase::Open, true),
            (ClosePhase::Open, CloseStep::Nothing)
        );
    }

    #[test]
    fn closing_again_while_saving_asks_first() {
        assert_eq!(
            on_close_request(ClosePhase::Saving, 3),
            (ClosePhase::Asking, CloseStep::AskHuman(Question::StillSaving))
        );
    }

    #[test]
    fn syncing_after_saving_has_its_own_deadline() {
        let (phase, _) = on_answer(ClosePhase::Saving, CloseAnswer::Syncing);
        assert_eq!(phase, ClosePhase::Syncing(0));
        let phase = ClosePhase::Syncing(4);
        // Der Abgleich ist fertig → schließen.
        assert_eq!(
            on_answer(phase, CloseAnswer::Saved),
            (ClosePhase::Open, CloseStep::CloseNow)
        );
        // Die eigene Frist schließt, eine fremde nicht; die Frist der ersten Antwort auch nicht.
        assert_eq!(on_sync_over(phase, 3), (phase, CloseStep::Nothing));
        assert_eq!(on_grace_over(phase, 4), (phase, CloseStep::Nothing));
        assert_eq!(on_sync_over(phase, 4), (ClosePhase::Open, CloseStep::CloseNow));
        // Ein zweiter Klick schließt sofort – ohne Rückfrage.
        assert_eq!(
            on_close_request(phase, 9),
            (ClosePhase::Open, CloseStep::CloseNow)
        );
        // Nie „ungespeichert“ wegen des Abgleichs – nur, wenn das Speichern scheiterte.
        assert_eq!(
            on_answer(phase, CloseAnswer::Unsaved),
            (ClosePhase::Asking, CloseStep::AskHuman(Question::Unsaved))
        );
    }

    #[test]
    fn answers_use_the_agreed_words() {
        for (text, answer) in [
            ("\"saving\"", CloseAnswer::Saving),
            ("\"syncing\"", CloseAnswer::Syncing),
            ("\"saved\"", CloseAnswer::Saved),
            ("\"unsaved\"", CloseAnswer::Unsaved),
        ] {
            assert_eq!(serde_json::from_str::<CloseAnswer>(text).unwrap(), answer);
        }
        assert!(serde_json::from_str::<CloseAnswer>("\"egal\"").is_err());
    }

    #[test]
    fn opens_in_the_remembered_size_but_never_larger_than_the_screen() {
        let default = (1440.0, 900.0);
        let min = (1280.0, 720.0);
        let state = |width, height| {
            Some(WindowState {
                width,
                height,
                maximized: false,
            })
        };
        assert_eq!(opening_size(None, default, min, None), (1440.0, 900.0));
        assert_eq!(
            opening_size(None, default, min, Some((1920.0, 1040.0))),
            (1440.0, 900.0)
        );
        // Kleiner Laptop-Bildschirm: die Vorgabe passt nicht, das Fenster schrumpft auf die Fläche.
        assert_eq!(
            opening_size(None, default, min, Some((1366.0, 728.0))),
            (1366.0, 720.0)
        );
        assert_eq!(
            opening_size(state(1700.0, 1000.0), default, min, Some((1920.0, 1040.0))),
            (1700.0, 1000.0)
        );
        // Zuletzt am großen Bildschirm benutzt, jetzt am Laptop.
        assert_eq!(
            opening_size(state(2400.0, 1300.0), default, min, Some((1512.0, 944.0))),
            (1512.0, 904.0)
        );
        // Unsinnige Werte aus einer beschädigten Datei ergeben die Mindestgröße.
        assert_eq!(
            opening_size(state(10.0, -5.0), default, min, None),
            (1280.0, 720.0)
        );
    }

    #[test]
    fn window_state_survives_a_restart_and_ignores_broken_files() {
        let dir = TempDir::new().unwrap();
        assert_eq!(load_state(dir.path()), None);
        let state = WindowState {
            width: 1600.0,
            height: 950.0,
            maximized: true,
        };
        save_state(dir.path(), &state);
        assert_eq!(load_state(dir.path()), Some(state));
        fs::write(dir.path().join(WINDOW_FILE), "kaputt").unwrap();
        assert_eq!(load_state(dir.path()), None);
        fs::write(dir.path().join(WINDOW_FILE), "{\"width\":1500,\"height\":900}").unwrap();
        assert_eq!(
            load_state(dir.path()),
            Some(WindowState {
                width: 1500.0,
                height: 900.0,
                maximized: false
            })
        );
    }
}
