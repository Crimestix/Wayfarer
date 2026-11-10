//! Überwachung des Kampagnenordners: meldet der Oberfläche, wenn sich JSON-Dateien ändern –
//! etwa weil das Cloud-Laufwerk den Spielstand des anderen Rechners abgleicht.
//!
//! Die Meldungen werden entprellt: viele Änderungen kurz hintereinander ergeben eine Meldung
//! mit allen betroffenen Pfaden. Eigene Schreibvorgänge werden mitgemeldet; die Oberfläche
//! erkennt sie am unveränderten Inhalt.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::store;

/// So lange muss Ruhe herrschen, bevor gemeldet wird.
const QUIET: Duration = Duration::from_millis(300);
/// Spätestens nach dieser Zeit wird gemeldet, auch wenn laufend weitere Änderungen eintreffen.
const MAX_WAIT: Duration = Duration::from_secs(2);

/// Die laufende Überwachung. Wird sie fallen gelassen, endet sie.
pub struct FolderWatch {
    _watcher: RecommendedWatcher,
}

/// Hält die eine aktive Überwachung der App; ein neuer Aufruf ersetzt die bisherige.
#[derive(Default)]
pub struct WatchState(pub Mutex<Option<FolderWatch>>);

/// Was sich seit der letzten Meldung angesammelt hat.
#[derive(Default)]
struct Batch {
    files: BTreeSet<String>,
    /// Ordner, die neu aufgetaucht sind; ihr Inhalt wird erst beim Melden aufgelistet.
    folders: BTreeSet<String>,
    /// Das Betriebssystem hat Ereignisse verworfen: alles als geändert melden.
    everything: bool,
}

impl Batch {
    fn add(&mut self, root: &Path, event: &Event) {
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        if event.need_rescan() {
            self.everything = true;
            return;
        }
        for path in &event.paths {
            if let Some(rel) = store::to_rel_path(root, path) {
                self.files.insert(rel);
            } else if let Some(folder) = folder_rel_path(root, path) {
                self.folders.insert(folder);
            }
        }
    }

    fn into_paths(mut self, root: &Path) -> Vec<String> {
        if self.everything || !self.folders.is_empty() {
            if let Ok(all) = store::list(root) {
                let everything = self.everything;
                let folders = std::mem::take(&mut self.folders);
                self.files.extend(
                    all.into_iter()
                        .filter(|p| everything || folders.iter().any(|f| p.starts_with(&format!("{f}/")))),
                );
            }
        }
        self.files.into_iter().collect()
    }
}

/// Relativer Pfad eines sichtbaren Unterordners der Ablage (ohne Endung, „/“ als Trenner).
fn folder_rel_path(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let parts: Vec<&str> = rel
        .components()
        .map(|c| c.as_os_str().to_str())
        .collect::<Option<_>>()?;
    if parts.is_empty() || parts.len() >= store::MAX_DEPTH {
        return None;
    }
    // Als Ordner gilt, was keine Endung trägt und nicht versteckt ist; geprüft wird beim Melden.
    if parts.iter().any(|p| p.starts_with('.') || p.contains('.')) {
        return None;
    }
    Some(parts.join("/"))
}

/// Startet die Überwachung von `root` und ruft `on_change` mit den relativen Pfaden auf.
pub fn start(root: &str, on_change: impl Fn(Vec<String>) + Send + 'static) -> Result<FolderWatch, String> {
    let root: PathBuf = store::check_root(root)?;
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let failed = |err: notify::Error| format!("Der Kampagnenordner lässt sich nicht überwachen: {err}");
    let mut watcher = notify::recommended_watcher(move |result| {
        let _ = tx.send(result);
    })
    .map_err(failed)?;
    watcher.watch(&root, RecursiveMode::Recursive).map_err(failed)?;

    std::thread::Builder::new()
        .name("wayfarer-ordnerwache".into())
        .spawn(move || {
            // Endet, sobald die Überwachung fallen gelassen wird (der Sender verschwindet).
            while let Ok(first) = rx.recv() {
                let mut batch = Batch::default();
                if let Ok(event) = first {
                    batch.add(&root, &event);
                }
                let started = Instant::now();
                let mut open = true;
                while started.elapsed() < MAX_WAIT {
                    match rx.recv_timeout(QUIET) {
                        Ok(Ok(event)) => batch.add(&root, &event),
                        Ok(Err(_)) => {}
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => {
                            open = false;
                            break;
                        }
                    }
                }
                let paths = batch.into_paths(&root);
                if !paths.is_empty() {
                    on_change(paths);
                }
                if !open {
                    break;
                }
            }
        })
        .map_err(|err| format!("Die Überwachung des Kampagnenordners ließ sich nicht starten: {err}"))?;

    Ok(FolderWatch { _watcher: watcher })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc::{channel, Receiver};
    use tempfile::TempDir;

    fn watch(dir: &TempDir) -> (FolderWatch, Receiver<Vec<String>>) {
        let (tx, rx) = channel();
        let watch = start(dir.path().to_str().unwrap(), move |paths| {
            let _ = tx.send(paths);
        })
        .unwrap();
        // Dem Betriebssystem einen Moment geben, die Überwachung einzurichten.
        std::thread::sleep(Duration::from_millis(150));
        (watch, rx)
    }

    /// Sammelt Meldungen, bis alle erwarteten Pfade gemeldet wurden.
    fn gather(rx: &Receiver<Vec<String>>, expected: &[&str]) -> BTreeSet<String> {
        let mut seen = BTreeSet::new();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !expected.iter().all(|p| seen.contains(*p)) {
            let left = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(left) {
                Ok(paths) => seen.extend(paths),
                Err(_) => panic!("Erwartet {expected:?}, gemeldet nur {seen:?}"),
            }
        }
        seen
    }

    #[test]
    fn reports_changed_json_files_with_relative_paths() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("entities")).unwrap();
        let (_watch, rx) = watch(&dir);
        let root = dir.path().to_str().unwrap();

        store::write(root, "entities/abc.json", "{}").unwrap();
        store::write(root, "state.json", "{}").unwrap();
        fs::write(dir.path().join("notiz.txt"), "fremd").unwrap();
        let seen = gather(&rx, &["entities/abc.json", "state.json"]);
        assert_eq!(
            seen.into_iter().collect::<Vec<_>>(),
            vec!["entities/abc.json", "state.json"]
        );

        store::remove(root, "entities/abc.json").unwrap();
        let seen = gather(&rx, &["entities/abc.json"]);
        assert!(seen
            .iter()
            .all(|p| p.ends_with(".json") && !p.contains('\\') && !p.contains(".wayfarer-")));
    }

    #[test]
    fn many_quick_changes_become_few_messages() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("chronicle")).unwrap();
        let (_watch, rx) = watch(&dir);
        let root = dir.path().to_str().unwrap();
        for i in 0..40 {
            store::write(root, &format!("chronicle/e{i}.json"), "{}").unwrap();
        }
        let mut messages = 0;
        let mut seen = BTreeSet::new();
        while seen.len() < 40 {
            let paths = rx
                .recv_timeout(Duration::from_secs(10))
                .expect("Meldung erwartet");
            messages += 1;
            seen.extend(paths);
        }
        // Jede Änderung löst mehrere Ereignisse aus; ohne Entprellen wären es weit über 40 Meldungen.
        assert!(messages <= 10, "{messages} Meldungen für 40 schnelle Änderungen");
    }

    #[test]
    fn reports_files_of_a_folder_that_appears_at_once() {
        let dir = TempDir::new().unwrap();
        let (_watch, rx) = watch(&dir);
        // So gleicht ein Cloud-Laufwerk ab: Ordner und Dateien erscheinen in einem Zug.
        let staging = TempDir::new().unwrap();
        fs::create_dir(staging.path().join("entities")).unwrap();
        fs::write(staging.path().join("entities/a.json"), "{}").unwrap();
        fs::write(staging.path().join("entities/b.json"), "{}").unwrap();
        fs::rename(staging.path().join("entities"), dir.path().join("entities")).unwrap();
        gather(&rx, &["entities/a.json", "entities/b.json"]);
    }

    #[test]
    fn stops_when_dropped() {
        let dir = TempDir::new().unwrap();
        let (watch, rx) = watch(&dir);
        drop(watch);
        std::thread::sleep(Duration::from_millis(100));
        fs::write(dir.path().join("state.json"), "{}").unwrap();
        // Der Sender verschwindet mit dem Wächter-Thread: kein Ereignis, Kanal geschlossen.
        assert!(rx.recv_timeout(Duration::from_secs(2)).is_err());
    }

    #[test]
    fn refuses_missing_folders() {
        let dir = TempDir::new().unwrap();
        let missing = dir.path().join("fehlt");
        assert!(start(missing.to_str().unwrap(), |_| {}).is_err());
    }
}
