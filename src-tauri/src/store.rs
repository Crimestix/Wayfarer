//! Dateizugriff auf den Kampagnenordner.
//!
//! Eine Kampagne ist ein Ordner voller kleiner JSON-Dateien. Die Oberfläche nennt immer den
//! Ordner (`root`) und einen relativen Pfad mit „/“ (`entities/abc.json`). Dieses Modul sorgt
//! dafür, dass ein solcher Pfad den Ordner nie verlassen kann, dass nur JSON-Dateien berührt
//! werden und dass Schreiben nie eine halbe Datei hinterlässt.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use serde::Serialize;

/// So tief dürfen Dateien unter dem Kampagnenordner liegen (Ordnerebenen plus Dateiname).
pub const MAX_DEPTH: usize = 4;
/// Längster erlaubter relativer Pfad in Zeichen.
const MAX_PATH_CHARS: usize = 240;
/// Größere Dateien sind keine Wayfarer-Dokumente und werden beim Einlesen übergangen.
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
/// Schutz davor, versehentlich einen riesigen Ordner (etwa „Dokumente“) als Kampagne zu öffnen.
const MAX_FILES: usize = 100_000;
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;

const TEMP_PREFIX: &str = ".wayfarer-";
const TEMP_SUFFIX: &str = ".tmp";
/// Liegengebliebene temporäre Dateien (nach einem Absturz) werden nach dieser Zeit aufgeräumt.
const STALE_TEMP_AGE: Duration = Duration::from_secs(10 * 60);

/// Eine Datei der Kampagne, wie die Oberfläche sie erwartet.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct StoredFile {
    pub path: String,
    pub content: String,
}

// ── Pfadprüfung ──────────────────────────────────────────────────────────────

/// Prüft den Kampagnenordner und gibt seinen echten Pfad zurück.
pub fn check_root(root: &str) -> Result<PathBuf, String> {
    let given = Path::new(root);
    if root.trim().is_empty() || !given.is_absolute() {
        return Err("Der Kampagnenordner muss als vollständiger Pfad angegeben sein.".into());
    }
    if !given.is_dir() {
        return Err(unreachable_root(root));
    }
    // dunce liefert unter Windows gewöhnliche Pfade (C:\…) statt der \\?\-Schreibweise.
    // Manche virtuellen Laufwerke (eingebundene Cloud-Laufwerke, RAM-Disks) können ihren
    // „echten“ Pfad nicht nennen, obwohl der Ordner da ist – dann gilt der Pfad, wie angegeben.
    Ok(dunce::canonicalize(given).unwrap_or_else(|_| lexically_clean(given)))
}

/// Der angegebene Pfad ohne „.“-Teile – für Laufwerke, die keinen echten Pfad liefern.
/// „..“ bleibt stehen: Das Betriebssystem löst es beim Zugriff selbst auf.
fn lexically_clean(path: &Path) -> PathBuf {
    path.components()
        .filter(|part| !matches!(part, std::path::Component::CurDir))
        .collect()
}

fn unreachable_root(root: &str) -> String {
    format!("Der Kampagnenordner „{root}“ ist nicht erreichbar. Ist das Cloud-Laufwerk verbunden?")
}

/// Unter Windows reservierte Gerätenamen – auch mit Endung nicht als Dateiname erlaubt.
fn is_reserved_name(component: &str) -> bool {
    let stem = component.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0')
}

/// Prüft einen relativen Pfad der Ablage. Erlaubt ist nur, was auf macOS UND Windows als
/// gewöhnliche Datei innerhalb des Ordners gilt: Teile mit „/“ getrennt, kein „..“, kein
/// absoluter Pfad, kein Laufwerksbuchstabe, nichts Verstecktes, Endung „.json“.
pub fn check_rel_path(path: &str) -> Result<Vec<&str>, String> {
    let invalid = || format!("Ungültiger Dateipfad in der Kampagne: „{path}“");
    if path.is_empty() || path.chars().count() > MAX_PATH_CHARS {
        return Err(invalid());
    }
    if path
        .chars()
        .any(|c| c.is_control() || matches!(c, '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*'))
    {
        return Err(invalid());
    }
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() > MAX_DEPTH {
        return Err(invalid());
    }
    for part in &parts {
        if part.is_empty()
            || part.starts_with('.')
            || part.ends_with('.')
            || part.starts_with(' ')
            || part.ends_with(' ')
            || is_reserved_name(part)
        {
            return Err(invalid());
        }
    }
    let name = parts[parts.len() - 1];
    let is_json = name.len() > ".json".len() && name.to_ascii_lowercase().ends_with(".json");
    if !is_json {
        return Err(invalid());
    }
    Ok(parts)
}

/// Löst einen relativen Pfad innerhalb des (bereits geprüften) Kampagnenordners auf.
/// Verknüpfungen auf dem Weg werden abgelehnt, damit nichts nach draußen zeigen kann.
pub fn resolve(root: &Path, path: &str) -> Result<PathBuf, String> {
    let parts = check_rel_path(path)?;
    let mut full = root.to_path_buf();
    for part in parts {
        full.push(part);
        match fs::symlink_metadata(&full) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(format!(
                    "„{path}“ führt über eine Verknüpfung aus dem Kampagnenordner heraus und wird nicht angefasst."
                ));
            }
            _ => {}
        }
    }
    Ok(full)
}

/// Macht aus einem Pfad unterhalb von `root` den relativen Pfad der Ablage („/“ als Trenner).
/// Gibt `None` zurück, wenn der Pfad nicht zur Ablage gehört (anderer Ordner, versteckt,
/// temporär, kein JSON).
pub fn to_rel_path(root: &Path, full: &Path) -> Option<String> {
    let rel = full.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for component in rel.components() {
        match component {
            std::path::Component::Normal(part) => parts.push(part.to_str()?),
            _ => return None,
        }
    }
    let joined = parts.join("/");
    check_rel_path(&joined).ok()?;
    Some(joined)
}

// ── Lesen ────────────────────────────────────────────────────────────────────

/// Unter Windows ist eine Datei kurz gesperrt, während ein anderes Programm (Cloud-Abgleich,
/// Virenscanner) sie ersetzt oder prüft. Dann lohnt es sich, einen Moment zu warten.
fn busy_retries() -> u64 {
    if cfg!(windows) {
        8
    } else {
        0
    }
}

fn patiently<T>(mut work: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    let mut attempt = 0;
    loop {
        match work() {
            Err(err) if attempt < busy_retries() && err.kind() == io::ErrorKind::PermissionDenied => {
                attempt += 1;
                std::thread::sleep(Duration::from_millis(25 * attempt));
            }
            result => return result,
        }
    }
}

fn read_patiently(path: &Path) -> io::Result<Vec<u8>> {
    patiently(|| fs::read(path))
}

fn describe(err: &io::Error) -> String {
    match err.kind() {
        io::ErrorKind::PermissionDenied => "Zugriff verweigert".into(),
        io::ErrorKind::NotFound => "nicht gefunden".into(),
        io::ErrorKind::StorageFull => "der Datenträger ist voll".into(),
        io::ErrorKind::ReadOnlyFilesystem => "der Datenträger ist schreibgeschützt".into(),
        _ => err.to_string(),
    }
}

fn decode(bytes: Vec<u8>) -> String {
    // Manche Programme stellen ein Byte-Order-Mark voran; JSON verträgt das nicht.
    let bytes = bytes
        .strip_prefix(b"\xEF\xBB\xBF")
        .map(<[u8]>::to_vec)
        .unwrap_or(bytes);
    match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(err) => String::from_utf8_lossy(err.as_bytes()).into_owned(),
    }
}

fn is_stale_temp(name: &str, entry: &fs::DirEntry) -> bool {
    if !(name.starts_with(TEMP_PREFIX) && name.ends_with(TEMP_SUFFIX)) {
        return false;
    }
    entry
        .metadata()
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age > STALE_TEMP_AGE)
}

/// Geht den Kampagnenordner durch und ruft `visit` für jede JSON-Datei der Ablage auf.
/// Versteckte Ordner, Verknüpfungen und fremde Dateitypen werden übergangen.
fn walk(
    root: &Path,
    dir: &Path,
    depth: usize,
    visit: &mut dyn FnMut(String, &Path, u64) -> Result<(), String>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|err| {
        format!(
            "Der Ordner „{}“ lässt sich nicht lesen: {}",
            dir.display(),
            describe(&err)
        )
    })?;
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.starts_with('.') {
            if file_type.is_file() && is_stale_temp(name, &entry) {
                let _ = fs::remove_file(entry.path());
            }
            continue;
        }
        if file_type.is_symlink() {
            continue;
        }
        let full = entry.path();
        if file_type.is_dir() {
            if depth + 1 < MAX_DEPTH {
                walk(root, &full, depth + 1, visit)?;
            }
        } else if file_type.is_file() {
            if let Some(rel) = to_rel_path(root, &full) {
                let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
                visit(rel, &full, size)?;
            }
        }
    }
    Ok(())
}

fn too_large() -> String {
    "Dieser Ordner enthält zu viele Dateien für eine Kampagne. Bitte wähle den Ordner, in dem nur die Kampagne liegt."
        .to_string()
}

/// Relative Pfade aller JSON-Dateien der Ablage.
pub fn list(root: &Path) -> Result<Vec<String>, String> {
    let mut paths = Vec::new();
    walk(root, root, 0, &mut |rel, _, _| {
        if paths.len() >= MAX_FILES {
            return Err(too_large());
        }
        paths.push(rel);
        Ok(())
    })?;
    paths.sort();
    Ok(paths)
}

/// Alle JSON-Dateien der Ablage mit Inhalt.
pub fn read_all(root: &str) -> Result<Vec<StoredFile>, String> {
    let root = check_root(root)?;
    let mut files = Vec::new();
    let mut total: u64 = 0;
    walk(&root, &root, 0, &mut |rel, full, size| {
        if size > MAX_FILE_BYTES {
            return Ok(());
        }
        total += size;
        if files.len() >= MAX_FILES || total > MAX_TOTAL_BYTES {
            return Err(too_large());
        }
        match read_patiently(full) {
            Ok(bytes) => files.push(StoredFile {
                path: rel,
                content: decode(bytes),
            }),
            // Zwischen Auflisten und Lesen verschwunden (Cloud-Abgleich): einfach übergehen.
            Err(err) if err.kind() == io::ErrorKind::NotFound => {}
            Err(err) => return Err(format!("„{rel}“ lässt sich nicht lesen: {}", describe(&err))),
        }
        Ok(())
    })?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// Inhalt einer Datei oder `None`, wenn es sie nicht gibt.
pub fn read(root: &str, path: &str) -> Result<Option<String>, String> {
    let root = check_root(root)?;
    let full = resolve(&root, path)?;
    match read_patiently(&full) {
        Ok(bytes) => Ok(Some(decode(bytes))),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("„{path}“ lässt sich nicht lesen: {}", describe(&err))),
    }
}

// ── Schreiben ────────────────────────────────────────────────────────────────

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Schreibt eine Datei so, dass am Ziel immer entweder die alte oder die neue Fassung liegt:
/// erst vollständig in eine temporäre Datei im selben Ordner, dann umbenennen.
pub fn write_atomic(target: &Path, content: &[u8]) -> io::Result<()> {
    let dir = target
        .parent()
        .ok_or_else(|| io::Error::other("Zielordner fehlt"))?;
    let name = target.file_name().and_then(|n| n.to_str()).unwrap_or("datei");
    fs::create_dir_all(dir)?;
    let temp = dir.join(format!(
        "{TEMP_PREFIX}{name}.{}-{}{TEMP_SUFFIX}",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let written = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temp)?;
        file.write_all(content)?;
        file.sync_all()?;
        drop(file);
        patiently(|| fs::rename(&temp, target))
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temp);
    }
    written
}

/// Schreibt eine Datei der Ablage; fehlende Unterordner werden angelegt.
pub fn write(root: &str, path: &str, content: &str) -> Result<(), String> {
    let root = check_root(root)?;
    let full = resolve(&root, path)?;
    write_atomic(&full, content.as_bytes())
        .map_err(|err| format!("„{path}“ ließ sich nicht speichern: {}", describe(&err)))
}

/// Entfernt eine Datei der Ablage. Fehlt sie bereits, ist das kein Fehler.
pub fn remove(root: &str, path: &str) -> Result<(), String> {
    let root = check_root(root)?;
    let full = resolve(&root, path)?;
    match patiently(|| fs::remove_file(&full)) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("„{path}“ ließ sich nicht entfernen: {}", describe(&err))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn campaign() -> (TempDir, String) {
        let dir = TempDir::new().unwrap();
        let root = dir.path().to_str().unwrap().to_string();
        (dir, root)
    }

    #[test]
    fn accepts_ordinary_store_paths() {
        for path in [
            "campaign.json",
            "state.json",
            "entities/abc123.json",
            "chronicle/k3_x-9.json",
            "entities/Aldric (Konfliktkopie 2).json",
            "entities/Ärmel Straße.JSON",
            "a/b/c/d.json",
        ] {
            assert!(check_rel_path(path).is_ok(), "{path} sollte erlaubt sein");
        }
    }

    #[test]
    fn rejects_paths_that_leave_the_folder() {
        for path in [
            "",
            "/etc/passwd.json",
            "/campaign.json",
            "../campaign.json",
            "entities/../../secret.json",
            "entities/..",
            "./campaign.json",
            "entities//abc.json",
            "entities/abc.json/",
            "C:/Users/x/secret.json",
            "C:secret.json",
            "c:\\secret.json",
            "\\\\server\\share\\x.json",
            "entities\\abc.json",
            "..\\secret.json",
            "~/secret.json:stream",
            "entities/abc.json:hidden",
            "entities/a\0b.json",
            "entities/a\nb.json",
        ] {
            assert!(
                check_rel_path(path).is_err(),
                "{path:?} hätte abgelehnt werden müssen"
            );
        }
    }

    #[test]
    fn rejects_foreign_hidden_and_reserved_files() {
        for path in [
            "campaign.txt",
            "campaign",
            "campaign.json.tmp",
            ".json",
            "entities/.json",
            ".git/config.json",
            ".hidden.json",
            "entities/.wayfarer-abc.json.1-2.tmp",
            "entities/abc.json.",
            "entities/abc.json ",
            " entities/abc.json",
            "entities./abc.json",
            "NUL.json",
            "con.json",
            "entities/COM1.json",
            "lpt9/abc.json",
            "a/b/c/d/e.json",
            "entities/was?.json",
            "entities/stern*.json",
            "entities/a|b.json",
        ] {
            assert!(
                check_rel_path(path).is_err(),
                "{path:?} hätte abgelehnt werden müssen"
            );
        }
        // Namen, die nur so ähnlich aussehen, bleiben erlaubt.
        for path in ["console.json", "com0.json", "comet.json", "entities/null.json"] {
            assert!(check_rel_path(path).is_ok(), "{path} sollte erlaubt sein");
        }
        assert!(check_rel_path(&format!("{}.json", "x".repeat(300))).is_err());
    }

    #[test]
    fn root_must_be_an_existing_absolute_folder() {
        let (dir, root) = campaign();
        assert!(check_root(&root).is_ok());
        assert!(check_root("").is_err());
        assert!(check_root("kampagne").is_err());
        assert!(check_root("./kampagne").is_err());
        let missing = dir.path().join("fehlt");
        let err = check_root(missing.to_str().unwrap()).unwrap_err();
        assert!(err.contains("nicht erreichbar"), "{err}");
        let file = dir.path().join("datei.json");
        fs::write(&file, "{}").unwrap();
        assert!(check_root(file.to_str().unwrap()).is_err());
    }

    #[test]
    fn a_root_without_a_real_path_is_used_as_given() {
        let path = if cfg!(windows) {
            "G:\\Meine Ablage\\.\\Elaris"
        } else {
            "/Volumes/Cloud/./Elaris/."
        };
        let expected = if cfg!(windows) {
            "G:\\Meine Ablage\\Elaris"
        } else {
            "/Volumes/Cloud/Elaris"
        };
        assert_eq!(lexically_clean(Path::new(path)), Path::new(expected));
    }

    #[test]
    fn write_then_read_roundtrip_creates_folders() {
        let (dir, root) = campaign();
        assert_eq!(read(&root, "entities/abc.json").unwrap(), None);
        write(&root, "entities/abc.json", "{\"id\":\"abc\"}\n").unwrap();
        assert_eq!(
            read(&root, "entities/abc.json").unwrap().as_deref(),
            Some("{\"id\":\"abc\"}\n")
        );
        assert!(dir.path().join("entities").is_dir());
        // Umlaute und Sonderzeichen bleiben erhalten.
        write(&root, "campaign.json", "{\"name\":\"Elaris – Äther & Öl\"}").unwrap();
        assert_eq!(
            read(&root, "campaign.json").unwrap().as_deref(),
            Some("{\"name\":\"Elaris – Äther & Öl\"}")
        );
    }

    #[test]
    fn write_replaces_existing_file_and_leaves_no_temp_files() {
        let (dir, root) = campaign();
        write(&root, "state.json", "alt").unwrap();
        write(&root, "state.json", "neu").unwrap();
        assert_eq!(read(&root, "state.json").unwrap().as_deref(), Some("neu"));
        let names: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["state.json".to_string()]);
    }

    #[test]
    fn failed_write_keeps_the_old_version() {
        let (dir, _root) = campaign();
        let target = dir.path().join("state.json");
        fs::write(&target, "alt").unwrap();
        // Ein Ordner am Ziel lässt das Umbenennen scheitern – die temporäre Datei muss verschwinden.
        let blocked = dir.path().join("blockiert.json");
        fs::create_dir(&blocked).unwrap();
        fs::write(blocked.join("inhalt.json"), "x").unwrap();
        assert!(write_atomic(&blocked, b"neu").is_err());
        assert!(blocked.is_dir());
        assert_eq!(fs::read_to_string(&target).unwrap(), "alt");
        let leftovers = fs::read_dir(dir.path())
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")
            })
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn a_reader_never_sees_a_half_written_file() {
        let (_dir, root) = campaign();
        let a = "a".repeat(200_000);
        let b = "b".repeat(200_000);
        std::thread::scope(|scope| {
            scope.spawn(|| {
                for round in 0..40 {
                    write(&root, "state.json", if round % 2 == 0 { &a } else { &b }).unwrap();
                }
            });
            scope.spawn(|| {
                for _ in 0..400 {
                    // Ein kurzzeitig gesperrtes Ziel (Windows) ist kein Fehler dieses Tests.
                    if let Ok(Some(content)) = read(&root, "state.json") {
                        assert!(content == a || content == b, "halb geschriebene Datei gelesen");
                    }
                }
            });
        });
        assert_eq!(read(&root, "state.json").unwrap().unwrap(), b);
    }

    #[test]
    fn remove_deletes_and_tolerates_missing_files() {
        let (_dir, root) = campaign();
        write(&root, "timers/t1.json", "{}").unwrap();
        remove(&root, "timers/t1.json").unwrap();
        assert_eq!(read(&root, "timers/t1.json").unwrap(), None);
        remove(&root, "timers/t1.json").unwrap();
        remove(&root, "gibtesnicht/x.json").unwrap();
    }

    #[test]
    fn commands_refuse_to_leave_the_root() {
        let (dir, root) = campaign();
        let outside = dir.path().parent().unwrap().join("wayfarer-outside-test.json");
        let _ = fs::remove_file(&outside);
        assert!(write(&root, "../wayfarer-outside-test.json", "x").is_err());
        assert!(!outside.exists());
        assert!(read(&root, "../wayfarer-outside-test.json").is_err());
        assert!(remove(&root, "../wayfarer-outside-test.json").is_err());
        assert!(write(&root, outside.to_str().unwrap(), "x").is_err());
        assert!(!outside.exists());
        assert!(write(&root, "notiz.txt", "x").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_be_used_to_escape() {
        let (dir, root) = campaign();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("geheim.json"), "geheim").unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("entities")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("geheim.json"), dir.path().join("link.json")).unwrap();

        assert!(read(&root, "entities/geheim.json").is_err());
        assert!(write(&root, "entities/neu.json", "x").is_err());
        assert!(!outside.path().join("neu.json").exists());
        assert!(remove(&root, "entities/geheim.json").is_err());
        assert!(read(&root, "link.json").is_err());
        assert!(write(&root, "link.json", "x").is_err());
        assert_eq!(
            fs::read_to_string(outside.path().join("geheim.json")).unwrap(),
            "geheim"
        );
        assert!(read_all(&root).unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_campaign_folder_itself_is_fine() {
        let real = TempDir::new().unwrap();
        let links = TempDir::new().unwrap();
        let link = links.path().join("Kampagne");
        std::os::unix::fs::symlink(real.path(), &link).unwrap();
        let root = link.to_str().unwrap();
        write(root, "campaign.json", "{}").unwrap();
        assert_eq!(read_all(root).unwrap().len(), 1);
        assert!(real.path().join("campaign.json").is_file());
    }

    #[test]
    fn read_all_lists_only_json_with_forward_slashes() {
        let (dir, root) = campaign();
        write(&root, "campaign.json", "{\"a\":1}").unwrap();
        write(&root, "entities/b.json", "b").unwrap();
        write(&root, "entities/a.json", "a").unwrap();
        write(&root, "chronicle/2024/tief.json", "tief").unwrap();
        fs::write(dir.path().join("notiz.txt"), "fremd").unwrap();
        fs::write(dir.path().join("entities/bild.png"), "fremd").unwrap();
        fs::write(dir.path().join("entities/.versteckt.json"), "fremd").unwrap();
        fs::write(dir.path().join("entities/.wayfarer-a.json.1-1.tmp"), "frisch").unwrap();
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git/config.json"), "fremd").unwrap();
        fs::create_dir_all(dir.path().join("a/b/c/d")).unwrap();
        fs::write(dir.path().join("a/b/c/ok.json"), "ok").unwrap();
        fs::write(dir.path().join("a/b/c/d/zu-tief.json"), "zu tief").unwrap();

        let files = read_all(&root).unwrap();
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            vec![
                "a/b/c/ok.json",
                "campaign.json",
                "chronicle/2024/tief.json",
                "entities/a.json",
                "entities/b.json"
            ]
        );
        assert_eq!(files[1].content, "{\"a\":1}");
        assert_eq!(list(&check_root(&root).unwrap()).unwrap(), paths);
        // Eine frische temporäre Datei gehört vielleicht zu einem laufenden Schreibvorgang.
        assert!(dir.path().join("entities/.wayfarer-a.json.1-1.tmp").exists());
    }

    #[test]
    fn read_tolerates_byte_order_mark_and_broken_text() {
        let (dir, root) = campaign();
        fs::write(dir.path().join("campaign.json"), b"\xEF\xBB\xBF{\"a\":1}").unwrap();
        fs::write(dir.path().join("state.json"), b"{\"a\":\"\xFF\"}").unwrap();
        assert_eq!(
            read(&root, "campaign.json").unwrap().as_deref(),
            Some("{\"a\":1}")
        );
        assert!(read(&root, "state.json").unwrap().unwrap().contains('\u{FFFD}'));
        assert_eq!(read_all(&root).unwrap().len(), 2);
    }

    #[test]
    fn to_rel_path_ignores_everything_outside_the_store() {
        let root = Path::new(if cfg!(windows) {
            "C:\\Kampagne"
        } else {
            "/kampagne"
        });
        assert_eq!(
            to_rel_path(root, &root.join("entities").join("abc.json")).as_deref(),
            Some("entities/abc.json")
        );
        assert_eq!(
            to_rel_path(root, &root.join("campaign.json")).as_deref(),
            Some("campaign.json")
        );
        assert_eq!(to_rel_path(root, &root.join("entities")), None);
        assert_eq!(
            to_rel_path(root, &root.join("entities").join(".wayfarer-abc.json.7-1.tmp")),
            None
        );
        assert_eq!(to_rel_path(root, &root.join("bild.png")), None);
        assert_eq!(to_rel_path(root, root), None);
        assert_eq!(
            to_rel_path(root, &root.parent().unwrap().join("anders").join("x.json")),
            None
        );
    }
}
