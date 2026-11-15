//! Abgleich, lokale Seite: welche Dateien zählen, ihre Kennungen, und der Ordner `.abgleich/`
//! im Kampagnenordner (Verbindung, gemeinsamer Stand, Merkzettel, Eingang, Beiseitegelegtes).
//!
//! Jede Datei unter `.abgleich/` wird mit `store::write_atomic` geschrieben. Der Merkzettel
//! (`anwenden.json`) entsteht erst, wenn alles, worauf er verweist, sicher auf der Platte steht.
//! Dateien des Spielstands schreibt diese Rust-Seite nur in `recover` – bevor es eine Datenbank
//! gibt.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::SyncError;
use crate::store;

pub const DIR: &str = ".abgleich";
const LINK_FILE: &str = "verbindung.json";
const STAND_FILE: &str = "stand.json";
const STAND_BEFORE: &str = "stand.vorher.json";
const NOTE_FILE: &str = "anwenden.json";
const INBOX: &str = "eingang";
const ASIDE: &str = "beiseite";
/// Größere Dateien reisen nicht mit.
pub const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
/// So viele gewöhnliche Läufe mit Beiseitegelegtem bleiben.
const KEEP_RUNS: usize = 50;

// ── Muster und Kennung ───────────────────────────────────────────────────────

/// Abgeglichen wird nur `campaign.json`, `state.json` oder `<ordner>/<kennung>.json`
/// (Ordner 1–32 Kleinbuchstaben, Kennung 1–64 aus A–Z a–z 0–9 _ -). Dasselbe Muster prüft
/// `isSyncedPath` in `src/domain/sync.ts`.
pub fn is_synced_path(path: &str) -> bool {
    if path == "campaign.json" || path == "state.json" {
        return true;
    }
    let Some((folder, file)) = path.split_once('/') else {
        return false;
    };
    let Some(id) = file.strip_suffix(".json") else {
        return false;
    };
    (1..=32).contains(&folder.len())
        && folder.bytes().all(|b| b.is_ascii_lowercase())
        && (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Die Kennung wie bei Git: SHA-1 über „blob <Länge>\0“ und die rohen Bytes.
pub fn blob_sha(bytes: &[u8]) -> String {
    let mut ctx = ring::digest::Context::new(&ring::digest::SHA1_FOR_LEGACY_USE_ONLY);
    ctx.update(format!("blob {}\0", bytes.len()).as_bytes());
    ctx.update(bytes);
    ctx.finish().as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// Sauberes UTF-8 ohne Byte-Order-Mark – sonst reist die Datei nicht mit.
pub fn clean_text(bytes: &[u8]) -> Option<&str> {
    if bytes.starts_with(b"\xEF\xBB\xBF") {
        return None;
    }
    std::str::from_utf8(bytes).ok()
}

// ── Gestalten ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLink {
    pub owner: String,
    pub repo: String,
    pub branch: String,
    pub device: String,
    pub root: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkFile {
    version: u32,
    owner: String,
    repo: String,
    branch: String,
    device: String,
    root: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Marker {
    pub datenstand: u32,
    pub gestalt: String,
    #[serde(default)]
    pub geraete: BTreeMap<String, u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Seen {
    pub commit: String,
    pub tree: String,
    #[serde(default)]
    pub files: BTreeMap<String, String>,
    #[serde(default)]
    pub marker: Option<Marker>,
    #[serde(default)]
    pub device: Option<String>,
    #[serde(default)]
    pub pushed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub choice: String,
    pub remote: Option<String>,
    pub fields: Option<Vec<Vec<String>>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Stand {
    pub version: u32,
    pub repo: Option<String>,
    pub branch: Option<String>,
    /// Der gemeinsame Stand; `None` = keiner (erster Abgleich, eingespielte Sicherung).
    pub files: Option<BTreeMap<String, String>>,
    pub seen: Option<Seen>,
    pub decided: BTreeMap<String, Decision>,
    pub max_version: u32,
    pub older_edits: bool,
    pub restored: bool,
    pub run_no: u64,
    pub synced_at: Option<String>,
}

impl Default for Stand {
    fn default() -> Self {
        Self {
            version: 1,
            repo: None,
            branch: None,
            files: None,
            seen: None,
            decided: BTreeMap::new(),
            max_version: 0,
            older_edits: false,
            restored: false,
            run_no: 0,
            synced_at: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteWrite {
    pub path: String,
    pub sha: String,
    pub expect: Option<String>,
    pub base: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDelete {
    pub path: String,
    pub expect: String,
}

/// Der Merkzettel: was angewendet wird. `kind`: run | adopt | remoteWins.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub version: u32,
    pub kind: String,
    pub run: u64,
    pub head: Option<String>,
    pub writes: Vec<NoteWrite>,
    pub deletes: Vec<NoteDelete>,
    pub link: Option<SyncLink>,
    pub base_all: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AsideEntry {
    pub side: String,
    pub path: String,
    pub sha: String,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AsideMeta {
    version: u32,
    at: String,
    reason: String,
    entries: Vec<AsideEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsideRun {
    pub run: u64,
    pub at: String,
    pub reason: String,
    pub entries: Vec<AsideEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFile {
    pub path: String,
    pub sha: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frozen {
    pub path: String,
    pub reason: &'static str,
}

// ── Hilfen ───────────────────────────────────────────────────────────────────

fn local_err(what: &str, err: &io::Error) -> SyncError {
    let why = match err.kind() {
        io::ErrorKind::StorageFull => "der Datenträger ist voll".to_string(),
        io::ErrorKind::PermissionDenied => "Zugriff verweigert".to_string(),
        io::ErrorKind::ReadOnlyFilesystem => "der Datenträger ist schreibgeschützt".to_string(),
        _ => err.to_string(),
    };
    SyncError::new("local", format!("{what}: {why}"))
}

pub fn dir(root: &Path) -> PathBuf {
    root.join(DIR)
}

/// Legt `.abgleich/` an; unter Windows bekommt der Ordner das Merkmal „versteckt“.
fn ensure_dir(root: &Path) -> Result<PathBuf, SyncError> {
    let path = dir(root);
    if !path.is_dir() {
        fs::create_dir_all(&path).map_err(|e| local_err("Der Ordner für den Abgleich", &e))?;
        hide(&path);
    }
    Ok(path)
}

#[cfg(windows)]
fn hide(path: &Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, INVALID_FILE_ATTRIBUTES,
    };
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: `wide` ist ein nullterminierter Pfad, der während der Aufrufe lebt.
    unsafe {
        let current = GetFileAttributesW(wide.as_ptr());
        if current != INVALID_FILE_ATTRIBUTES {
            SetFileAttributesW(wide.as_ptr(), current | FILE_ATTRIBUTE_HIDDEN);
        }
    }
}

#[cfg(not(windows))]
fn hide(_path: &Path) {}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), SyncError> {
    store::write_atomic(path, bytes)
        .map_err(|e| local_err("Eine Datei des Abgleichs ließ sich nicht schreiben", &e))
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), SyncError> {
    let mut text = serde_json::to_vec_pretty(value)
        .map_err(|_| SyncError::new("local", "Interner Fehler beim Schreiben."))?;
    text.push(b'\n');
    write_file(path, &text)
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn remove_quietly(path: &Path) {
    if path.is_dir() {
        let _ = fs::remove_dir_all(path);
    } else {
        let _ = fs::remove_file(path);
    }
}

/// Ein Pfad des Spielstands im Kampagnenordner (nur nach Muster, nie außerhalb).
fn campaign_file(root: &Path, path: &str) -> Result<PathBuf, SyncError> {
    if !is_synced_path(path) {
        return Err(SyncError::new(
            "input",
            format!("„{path}“ gehört nicht zum Spielstand."),
        ));
    }
    store::resolve(root, path).map_err(|m| SyncError::new("input", m))
}

/// Die Kennung der Datei hier, `None` = sie fehlt.
pub fn local_sha(root: &Path, path: &str) -> Result<Option<String>, SyncError> {
    let full = campaign_file(root, path)?;
    match store::read_patiently(&full) {
        Ok(bytes) => Ok(Some(blob_sha(&bytes))),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(local_err(&format!("„{path}“ lässt sich nicht lesen"), &e)),
    }
}

/// Liest eine Datei des Spielstands roh.
pub fn read_campaign_file(root: &Path, path: &str) -> Result<Option<Vec<u8>>, SyncError> {
    let full = campaign_file(root, path)?;
    match store::read_patiently(&full) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(local_err(&format!("„{path}“ lässt sich nicht lesen"), &e)),
    }
}

/// Vergleicht zwei Orte: kanonisch, unter Windows und macOS ohne Groß/Klein.
pub fn same_place(a: &str, b: &str) -> bool {
    let norm = |p: &str| {
        let path = Path::new(p);
        let canon = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let text = canon.to_string_lossy().trim_end_matches(['/', '\\']).to_string();
        let text = text.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(text);
        if cfg!(any(windows, target_os = "macos")) {
            text.to_lowercase()
        } else {
            text
        }
    };
    norm(a) == norm(b)
}

// ── Die Liste hier ───────────────────────────────────────────────────────────

/// Alle Dateien des Spielstands mit Kennung; Ausgelassenes mit Grund.
pub fn scan_local(root: &Path) -> Result<(Vec<SyncFile>, Vec<Frozen>), SyncError> {
    let paths = store::list(root).map_err(|m| SyncError::new("local", m))?;
    let synced: Vec<String> = paths.into_iter().filter(|p| is_synced_path(p)).collect();
    // Zwei Pfade, die sich nur in Groß/Klein unterscheiden, reisen beide nicht.
    let mut by_lower: HashMap<String, usize> = HashMap::new();
    for path in &synced {
        *by_lower.entry(path.to_lowercase()).or_default() += 1;
    }
    let mut files = Vec::new();
    let mut frozen = Vec::new();
    for path in synced {
        if by_lower.get(&path.to_lowercase()).copied().unwrap_or(0) > 1 {
            frozen.push(Frozen { path, reason: "case" });
            continue;
        }
        let full = root.join(&path);
        let size = fs::metadata(&full).map(|m| m.len()).unwrap_or(0);
        if size > MAX_FILE_BYTES {
            frozen.push(Frozen { path, reason: "size" });
            continue;
        }
        match store::read_patiently(&full) {
            Ok(bytes) => {
                if clean_text(&bytes).is_none() {
                    frozen.push(Frozen {
                        path,
                        reason: "encoding",
                    });
                } else {
                    files.push(SyncFile {
                        sha: blob_sha(&bytes),
                        size: bytes.len() as u64,
                        path,
                    });
                }
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(_) => frozen.push(Frozen {
                path,
                reason: "locked",
            }),
        }
    }
    Ok((files, frozen))
}

// ── Verbindung ───────────────────────────────────────────────────────────────

pub fn read_link(root: &Path) -> Option<SyncLink> {
    let file: LinkFile = read_json(&dir(root).join(LINK_FILE))?;
    Some(SyncLink {
        owner: file.owner,
        repo: file.repo,
        branch: file.branch,
        device: file.device,
        root: file.root,
    })
}

pub fn write_link(root: &Path, link: &SyncLink) -> Result<(), SyncError> {
    let dir = ensure_dir(root)?;
    write_json(
        &dir.join(LINK_FILE),
        &LinkFile {
            version: 1,
            owner: link.owner.clone(),
            repo: link.repo.clone(),
            branch: link.branch.clone(),
            device: link.device.clone(),
            root: link.root.clone(),
        },
    )
}

/// Trennt: Verbindung, gemeinsamer Stand, Merkzettel und Eingang weg; Beiseitegelegtes bleibt.
pub fn unlink(root: &Path) {
    let dir = dir(root);
    for name in [LINK_FILE, STAND_FILE, STAND_BEFORE, NOTE_FILE, INBOX] {
        remove_quietly(&dir.join(name));
    }
}

// ── Gemeinsamer Stand ────────────────────────────────────────────────────────

/// `stand.json`, sonst `stand.vorher.json`; beide unlesbar → keiner.
pub fn read_stand(root: &Path) -> Option<Stand> {
    let dir = dir(root);
    read_json(&dir.join(STAND_FILE)).or_else(|| read_json(&dir.join(STAND_BEFORE)))
}

/// Schreibt `stand.json`; die bisherige wird vorher zu `stand.vorher.json`.
pub fn write_stand(root: &Path, stand: &Stand) -> Result<(), SyncError> {
    let dir = ensure_dir(root)?;
    let current = dir.join(STAND_FILE);
    if let Ok(bytes) = fs::read(&current) {
        if serde_json::from_slice::<Stand>(&bytes).is_ok() {
            write_file(&dir.join(STAND_BEFORE), &bytes)?;
        }
    }
    write_json(&current, stand)
}

/// Merkt, was in der Ablage gesehen wurde – auf dem Stand, der **jetzt** in der Datei steht.
/// Ein Blick in die Ablage dauert; was währenddessen gemerkt wurde (eine Entscheidung, eine
/// eingespielte Sicherung), darf er nie mit dem vorher Gelesenen überschreiben.
pub fn remember_seen(root: &Path, seen: Option<Seen>, max_version: u32) -> Result<(), SyncError> {
    let Some(mut stand) = read_stand(root) else {
        return Ok(());
    };
    stand.seen = seen;
    stand.max_version = stand.max_version.max(max_version);
    write_stand(root, &stand)
}

// ── Merkzettel und Eingang ───────────────────────────────────────────────────

pub fn read_note(root: &Path) -> Result<Option<Note>, SyncError> {
    let path = dir(root).join(NOTE_FILE);
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| SyncError::new("local", "Der Merkzettel eines Abgleichs ist unlesbar.")),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(local_err("Der Merkzettel lässt sich nicht lesen", &e)),
    }
}

fn write_note(root: &Path, note: &Note) -> Result<(), SyncError> {
    write_json(&ensure_dir(root)?.join(NOTE_FILE), note)
}

fn remove_note(root: &Path) {
    remove_quietly(&dir(root).join(NOTE_FILE));
}

fn inbox_path(root: &Path, sha: &str) -> Option<PathBuf> {
    (sha.len() == 40 && sha.bytes().all(|b| b.is_ascii_hexdigit())).then(|| dir(root).join(INBOX).join(sha))
}

/// Eine Eingangsdatei, nur wenn ihre Kennung stimmt.
pub fn inbox_read(root: &Path, sha: &str) -> Option<Vec<u8>> {
    let bytes = fs::read(inbox_path(root, sha)?).ok()?;
    (blob_sha(&bytes) == sha).then_some(bytes)
}

/// Legt Bytes in den Eingang; die Kennung wird geprüft.
pub fn inbox_write(root: &Path, sha: &str, bytes: &[u8]) -> Result<(), SyncError> {
    if blob_sha(bytes) != sha {
        return Err(SyncError::new(
            "server",
            "Eine geholte Datei passt nicht zu ihrer Kennung.",
        ));
    }
    let path =
        inbox_path(root, sha).ok_or_else(|| SyncError::new("server", "Ungültige Kennung einer Datei."))?;
    ensure_dir(root)?;
    write_file(&path, bytes)
}

/// Leert den Eingang bis auf das, was ein liegender Merkzettel braucht.
pub fn inbox_clear(root: &Path) -> Result<(), SyncError> {
    let keep: BTreeSet<String> = read_note(root)?
        .map(|n| n.writes.into_iter().map(|w| w.sha).collect())
        .unwrap_or_default();
    if let Ok(entries) = fs::read_dir(dir(root).join(INBOX)) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !keep.contains(&name) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

// ── Beiseitelegen ────────────────────────────────────────────────────────────

fn aside_dir(root: &Path) -> PathBuf {
    dir(root).join(ASIDE)
}

/// Legt `beiseite/<nr>/` an – „muss neu sein“; bei Zusammenstoß wird weitergezählt.
fn new_aside_run(root: &Path, after: u64) -> Result<(u64, PathBuf), SyncError> {
    let base = aside_dir(root);
    fs::create_dir_all(&base).map_err(|e| local_err("Beiseitelegen", &e))?;
    let mut run = after + 1;
    loop {
        let path = base.join(run.to_string());
        match fs::create_dir(&path) {
            Ok(()) => return Ok((run, path)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => run += 1,
            Err(e) => return Err(local_err("Beiseitelegen", &e)),
        }
    }
}

fn now_iso() -> String {
    // Ohne Zeitzonen-Bibliothek: Sekunden seit 1970 in UTC als ISO-Datum.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    iso_from_secs(secs)
}

pub fn iso_from_secs(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rest = secs % 86_400;
    // Umrechnung nach Howard Hinnant (civil_from_days).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
}

struct AsideWriter {
    dir: PathBuf,
    run: u64,
    entries: Vec<AsideEntry>,
}

impl AsideWriter {
    fn put(&mut self, side: &str, path: &str, bytes: &[u8]) -> Result<(), SyncError> {
        if !is_synced_path(path) {
            return Ok(());
        }
        write_file(&self.dir.join(side).join(path), bytes)?;
        self.entries.push(AsideEntry {
            side: side.to_string(),
            path: path.to_string(),
            sha: blob_sha(bytes),
            title: title_of(path, bytes),
        });
        Ok(())
    }
    fn finish(self, reason: &str) -> Result<u64, SyncError> {
        write_json(
            &self.dir.join("inhalt.json"),
            &AsideMeta {
                version: 1,
                at: now_iso(),
                reason: reason.to_string(),
                entries: self.entries,
            },
        )?;
        Ok(self.run)
    }
}

/// Art und Name für die Liste („name“ oder „title“ des Eintrags, sonst der Ordner).
fn title_of(path: &str, bytes: &[u8]) -> String {
    let value: Option<serde_json::Value> = serde_json::from_slice(bytes).ok();
    let name = value.as_ref().and_then(|v| {
        ["name", "title", "text"]
            .iter()
            .find_map(|k| v.get(k).and_then(|x| x.as_str()).filter(|s| !s.is_empty()))
            .map(|s| s.chars().take(80).collect::<String>())
    });
    let folder = path.split('/').next().unwrap_or(path).trim_end_matches(".json");
    match name {
        Some(name) => format!("{folder}: {name}"),
        None => folder.to_string(),
    }
}

// ── Anwenden ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyWrite {
    pub path: String,
    pub expect: Option<String>,
    pub base: Option<String>,
    #[serde(default)]
    pub sha: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShaPath {
    pub path: String,
    pub sha: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyBegin {
    pub kind: String,
    pub head: Option<String>,
    pub reason: String,
    pub writes: Vec<ApplyWrite>,
    pub deletes: Vec<NoteDelete>,
    #[serde(default)]
    pub keep: Vec<ShaPath>,
    #[serde(default)]
    pub link: Option<SyncLink>,
    #[serde(default)]
    pub base_all: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Begun {
    pub run: u64,
    pub busy: Vec<String>,
}

/// Ist der Ordner leer genug, um eine Kampagne hineinzuholen?
fn has_campaign_files(root: &Path) -> Result<bool, SyncError> {
    Ok(store::list(root)
        .map_err(|m| SyncError::new("local", m))?
        .iter()
        .any(|p| is_synced_path(p)))
}

/// Erwartetes prüfen (`busy` → nichts getan), beiseitelegen, Zusammengeführtes in den Eingang,
/// dann der Merkzettel – in dieser Reihenfolge.
pub fn apply_begin(root: &Path, input: ApplyBegin) -> Result<Begun, SyncError> {
    if !matches!(input.kind.as_str(), "run" | "adopt" | "remoteWins") {
        return Err(SyncError::new("input", "Unbekannte Art des Anwendens."));
    }
    if read_note(root)?.is_some() {
        return Err(SyncError::new(
            "local",
            "Ein früherer Abgleich ist noch nicht zu Ende gebracht.",
        ));
    }
    if input.kind == "adopt" && (has_campaign_files(root)? || read_link(root).is_some()) {
        return Err(SyncError::new(
            "input",
            "In diesem Ordner liegt schon etwas. Zum Holen braucht Wayfarer einen neuen, leeren Ordner.",
        ));
    }
    let mut busy = Vec::new();
    for w in &input.writes {
        if local_sha(root, &w.path)? != w.expect {
            busy.push(w.path.clone());
        }
    }
    for d in &input.deletes {
        if local_sha(root, &d.path)?.as_deref() != Some(d.expect.as_str()) {
            busy.push(d.path.clone());
        }
    }
    if !busy.is_empty() {
        return Ok(Begun { run: 0, busy });
    }
    let mut stand = read_stand(root).unwrap_or_default();
    // Zusammengeführtes in den Eingang; alles, worauf der Merkzettel zeigt, muss dort liegen.
    let mut writes = Vec::new();
    for w in &input.writes {
        let sha = match (&w.sha, &w.content) {
            (_, Some(content)) => {
                let sha = blob_sha(content.as_bytes());
                inbox_write(root, &sha, content.as_bytes())?;
                sha
            }
            (Some(sha), None) => {
                if inbox_read(root, sha).is_none() {
                    return Err(SyncError::new(
                        "local",
                        format!("Für „{}“ fehlt die geholte Fassung.", w.path),
                    ));
                }
                sha.clone()
            }
            (None, None) => return Err(SyncError::new("input", "Eine Datei ohne Inhalt.")),
        };
        writes.push(NoteWrite {
            path: w.path.clone(),
            sha,
            expect: w.expect.clone(),
            base: w.base.clone(),
        });
    }
    // Beiseitelegen: die Fassungen von hier, die ersetzt oder gelöscht werden, und Fassungen von dort.
    let (run, run_dir) = new_aside_run(root, stand.run_no)?;
    let mut aside = AsideWriter {
        dir: run_dir.clone(),
        run,
        entries: Vec::new(),
    };
    for w in &input.writes {
        if let Some(bytes) = read_campaign_file(root, &w.path)? {
            aside.put("hier", &w.path, &bytes)?;
        }
    }
    for d in &input.deletes {
        if let Some(bytes) = read_campaign_file(root, &d.path)? {
            aside.put("hier", &d.path, &bytes)?;
        }
    }
    for k in &input.keep {
        let bytes = inbox_read(root, &k.sha)
            .ok_or_else(|| SyncError::new("local", format!("Für „{}“ fehlt die geholte Fassung.", k.path)))?;
        aside.put("dort", &k.path, &bytes)?;
    }
    if aside.entries.is_empty() {
        let _ = fs::remove_dir_all(&run_dir);
    } else {
        aside.finish(&input.reason)?;
    }
    stand.run_no = run;
    write_stand(root, &stand)?;
    write_note(
        root,
        &Note {
            version: 1,
            kind: input.kind,
            run,
            head: input.head,
            writes,
            deletes: input.deletes,
            link: input.link,
            base_all: input.base_all,
        },
    )?;
    Ok(Begun {
        run,
        busy: Vec::new(),
    })
}

/// Trägt für Erledigtes den gemeinsamen Stand nach (bei `adopt`/`remoteWins` den ganzen und die
/// Verbindung) und entfernt den Merkzettel.
fn finish_note(root: &Path, note: &Note, done: &BTreeSet<String>) -> Result<(), SyncError> {
    let mut stand = read_stand(root).unwrap_or_default();
    if note.kind == "run" {
        let mut files = stand.files.clone();
        for w in &note.writes {
            if done.contains(&w.path) {
                if let Some(files) = files.as_mut() {
                    match &w.base {
                        Some(base) => {
                            files.insert(w.path.clone(), base.clone());
                        }
                        None => {
                            files.remove(&w.path);
                        }
                    }
                }
                stand.decided.remove(&w.path);
            }
        }
        for d in &note.deletes {
            if done.contains(&d.path) {
                if let Some(files) = files.as_mut() {
                    files.remove(&d.path);
                }
                stand.decided.remove(&d.path);
            }
        }
        stand.files = files;
        write_stand(root, &stand)?;
    } else {
        stand.files = Some(note.base_all.clone().unwrap_or_default());
        stand.restored = false;
        if let Some(link) = &note.link {
            stand.repo = Some(format!("{}/{}", link.owner, link.repo));
            stand.branch = Some(link.branch.clone());
        }
        stand.seen = note.head.as_ref().map(|head| Seen {
            commit: head.clone(),
            tree: String::new(),
            files: note.base_all.clone().unwrap_or_default(),
            marker: None,
            device: None,
            pushed_at: None,
        });
        write_stand(root, &stand)?;
        if let Some(link) = &note.link {
            write_link(root, link)?;
        }
    }
    remove_note(root);
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ended {
    pub done: Vec<String>,
    pub left: Vec<String>,
}

/// Nach dem Schreiben durch die Datenbank: prüft die Platte, trägt nach, Merkzettel weg.
/// Schreibt keine Datei des Spielstands.
pub fn apply_end(root: &Path, run: u64) -> Result<Ended, SyncError> {
    let note = read_note(root)?
        .filter(|n| n.run == run)
        .ok_or_else(|| SyncError::new("local", "Der Merkzettel passt nicht zu diesem Abgleich."))?;
    let mut done = BTreeSet::new();
    let mut left = Vec::new();
    for w in &note.writes {
        if local_sha(root, &w.path)?.as_deref() == Some(w.sha.as_str()) {
            done.insert(w.path.clone());
        } else {
            left.push(w.path.clone());
        }
    }
    for d in &note.deletes {
        if local_sha(root, &d.path)?.is_none() {
            done.insert(d.path.clone());
        } else {
            left.push(d.path.clone());
        }
    }
    finish_note(root, &note, &done)?;
    Ok(Ended {
        done: done.into_iter().collect(),
        left,
    })
}

pub fn apply_abort(root: &Path, run: u64) -> Result<(), SyncError> {
    if read_note(root)?.is_some_and(|n| n.run == run) {
        remove_note(root);
    }
    remove_quietly(&aside_dir(root).join(run.to_string()));
    Ok(())
}

/// Ein liegender Merkzettel im laufenden Programm: nachtragen, was schon auf der Platte steht –
/// ohne zu schreiben. Ergebnis: Zahl der nachgetragenen Einträge.
pub fn settle_note(root: &Path) -> Result<usize, SyncError> {
    let Some(note) = read_note(root)? else {
        return Ok(0);
    };
    if note.kind != "run" {
        return Ok(0);
    }
    let ended = apply_end(root, note.run)?;
    Ok(ended.done.len())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recovered {
    pub finished: usize,
    pub left: Vec<ShaPathOut>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShaPathOut {
    pub path: String,
    pub sha: String,
}

/// Bringt einen liegenden Merkzettel zu Ende – vor dem Öffnen, ohne Netz, und als einzige
/// Stelle, an der die Rust-Seite Dateien des Spielstands schreibt. Je Eintrag: Kennung der
/// Eingangsdatei nachrechnen (stimmt nicht → Eintrag verwerfen, Datei hier nicht anfassen);
/// steht schon die neue Fassung → gut; steht noch die erwartete alte → schreiben bzw. löschen;
/// etwas Drittes → nicht anfassen.
pub fn recover(root: &Path) -> Result<Recovered, SyncError> {
    let Some(note) = read_note(root)? else {
        return Ok(Recovered {
            finished: 0,
            left: Vec::new(),
        });
    };
    let mut done = BTreeSet::new();
    let mut left = Vec::new();
    for w in &note.writes {
        let Some(bytes) = inbox_read(root, &w.sha) else {
            if note.kind != "run" {
                left.push(ShaPathOut {
                    path: w.path.clone(),
                    sha: w.sha.clone(),
                });
            }
            continue;
        };
        let now = local_sha(root, &w.path)?;
        if now.as_deref() == Some(w.sha.as_str()) {
            done.insert(w.path.clone());
        } else if now == w.expect {
            let full = campaign_file(root, &w.path)?;
            store::write_atomic(&full, &bytes)
                .map_err(|e| local_err(&format!("„{}“ ließ sich nicht schreiben", w.path), &e))?;
            done.insert(w.path.clone());
        }
    }
    for d in &note.deletes {
        let now = local_sha(root, &d.path)?;
        if now.is_none() {
            done.insert(d.path.clone());
        } else if now.as_deref() == Some(d.expect.as_str()) {
            let full = campaign_file(root, &d.path)?;
            fs::remove_file(&full)
                .map_err(|e| local_err(&format!("„{}“ ließ sich nicht entfernen", d.path), &e))?;
            done.insert(d.path.clone());
        }
    }
    if !left.is_empty() {
        // Erstes Holen / „Ablage gilt“: Was fehlt, muss mit Netz nachgeholt werden; der
        // Merkzettel bleibt für genau diese Einträge.
        let mut rest = note.clone();
        rest.writes.retain(|w| left.iter().any(|l| l.path == w.path));
        rest.deletes.clear();
        write_note(root, &rest)?;
        return Ok(Recovered {
            finished: done.len(),
            left,
        });
    }
    finish_note(root, &note, &done)?;
    Ok(Recovered {
        finished: done.len(),
        left,
    })
}

// ── Merken ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseMark {
    pub path: String,
    pub sha: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkInput {
    #[serde(default)]
    pub base: Option<Vec<BaseMark>>,
    #[serde(default)]
    pub decided: Option<BTreeMap<String, Option<Decision>>>,
    #[serde(default)]
    pub synced: Option<bool>,
    #[serde(default)]
    pub drop_base: Option<bool>,
    #[serde(default)]
    pub older_edits: Option<bool>,
}

pub fn mark(root: &Path, input: MarkInput) -> Result<(), SyncError> {
    let mut stand = read_stand(root).unwrap_or_default();
    if let Some(base) = input.base {
        let files = stand.files.get_or_insert_with(BTreeMap::new);
        for b in base {
            if !is_synced_path(&b.path) {
                continue;
            }
            match b.sha {
                Some(sha) => {
                    files.insert(b.path, sha);
                }
                None => {
                    files.remove(&b.path);
                }
            }
        }
    }
    if let Some(decided) = input.decided {
        for (key, value) in decided {
            match value {
                Some(d) => {
                    stand.decided.insert(key, d);
                }
                None => {
                    stand.decided.remove(&key);
                }
            }
        }
    }
    if let Some(older) = input.older_edits {
        stand.older_edits = older;
    }
    if input.drop_base == Some(true) {
        stand.files = None;
        stand.restored = true;
    }
    if input.synced == Some(true) {
        // Ein gelungener Abgleich mit gemeinsamem Stand: Der eingespielte Stand ist erledigt.
        if stand.files.is_some() {
            stand.restored = false;
        }
        stand.synced_at = Some(now_iso());
        inbox_clear(root)?;
        prune_aside(root)?;
    }
    write_stand(root, &stand)
}

/// Die 50 jüngsten gewöhnlichen Läufe bleiben; Entscheidungen, erste Abgleiche und Eingespieltes
/// bleiben, bis der Spielleiter sie löscht. Angefangene Läufe ohne Inhalt verschwinden.
fn prune_aside(root: &Path) -> Result<(), SyncError> {
    let current = read_note(root)?.map(|n| n.run);
    let mut ordinary: Vec<u64> = Vec::new();
    let Ok(entries) = fs::read_dir(aside_dir(root)) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let Some(run) = entry.file_name().to_str().and_then(|n| n.parse::<u64>().ok()) else {
            continue;
        };
        match read_json::<AsideMeta>(&entry.path().join("inhalt.json")) {
            Some(meta) if meta.reason == "abgleich" || meta.reason == "zurueckholen" => ordinary.push(run),
            Some(_) => {}
            None if Some(run) != current => remove_quietly(&entry.path()),
            None => {}
        }
    }
    ordinary.sort_unstable_by(|a, b| b.cmp(a));
    for run in ordinary.into_iter().skip(KEEP_RUNS) {
        remove_quietly(&aside_dir(root).join(run.to_string()));
    }
    Ok(())
}

// ── Beiseitegelegtes ansehen ─────────────────────────────────────────────────

pub fn aside_list(root: &Path) -> Vec<AsideRun> {
    let mut runs = Vec::new();
    if let Ok(entries) = fs::read_dir(aside_dir(root)) {
        for entry in entries.flatten() {
            let Some(run) = entry.file_name().to_str().and_then(|n| n.parse::<u64>().ok()) else {
                continue;
            };
            if let Some(meta) = read_json::<AsideMeta>(&entry.path().join("inhalt.json")) {
                runs.push(AsideRun {
                    run,
                    at: meta.at,
                    reason: meta.reason,
                    entries: meta.entries,
                });
            }
        }
    }
    runs.sort_by_key(|r| std::cmp::Reverse(r.run));
    runs
}

pub fn aside_read(root: &Path, run: u64, side: &str, path: &str) -> Result<String, SyncError> {
    if !matches!(side, "hier" | "dort") || !is_synced_path(path) {
        return Err(SyncError::new("input", "Ungültige Angabe."));
    }
    let file = aside_dir(root).join(run.to_string()).join(side).join(path);
    let bytes =
        fs::read(&file).map_err(|_| SyncError::new("input", "Diese Fassung liegt nicht beiseite."))?;
    String::from_utf8(bytes).map_err(|_| SyncError::new("local", "Diese Fassung ist nicht lesbar."))
}

/// Die heutigen Fassungen beiseite (vor „Zurückholen“).
pub fn aside_put(root: &Path, paths: &[String], reason: &str) -> Result<u64, SyncError> {
    let mut stand = read_stand(root).unwrap_or_default();
    let (run, run_dir) = new_aside_run(root, stand.run_no)?;
    let mut aside = AsideWriter {
        dir: run_dir,
        run,
        entries: Vec::new(),
    };
    for path in paths {
        if let Some(bytes) = read_campaign_file(root, path)? {
            aside.put("hier", path, &bytes)?;
        }
    }
    let run = aside.finish(reason)?;
    stand.run_no = run;
    write_stand(root, &stand)?;
    Ok(run)
}

pub fn aside_drop(root: &Path, run: u64) {
    remove_quietly(&aside_dir(root).join(run.to_string()));
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn root() -> (TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_path_buf();
        (dir, path)
    }

    fn put(root: &Path, path: &str, text: &str) -> String {
        let full = root.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(&full, text).unwrap();
        blob_sha(text.as_bytes())
    }

    #[test]
    fn the_pattern_matches_the_typescript_side() {
        for ok in [
            "entities/abc.json",
            "entities/Abc-1_x.json",
            "campaign.json",
            "state.json",
        ] {
            assert!(is_synced_path(ok), "{ok}");
        }
        for no in [
            "Entities/a.json",
            "a.json",
            "entities/a.JSON",
            "entities/ä.json",
            "entities/Aldric (Konfliktkopie 2).json",
            "entities/sub/a.json",
            "media/x.png",
            ".abgleich/stand.json",
            "wayfarer.json",
            "README.md",
        ] {
            assert!(!is_synced_path(no), "{no}");
        }
        assert!(!is_synced_path(&format!("entities/{}.json", "x".repeat(65))));
        assert!(!is_synced_path(&format!("{}/x.json", "a".repeat(33))));
    }

    #[test]
    fn blob_ids_match_git() {
        assert_eq!(blob_sha(b""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
        assert_eq!(blob_sha(b"hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a");
        assert_eq!(
            blob_sha("ä\n".as_bytes()),
            "8be8316c70848caa99b9b3086c64976e82d1c17d"
        );
        assert_eq!(
            blob_sha(b"\xEF\xBB\xBFhello\n"),
            "c2d46024e14dbd9078bb0aafcf920bb8e7216455"
        );
    }

    #[test]
    fn scan_leaves_out_what_must_not_travel() {
        let (_d, root) = root();
        put(&root, "campaign.json", "{}");
        put(&root, "entities/a.json", "{\"id\":\"a\"}");
        put(&root, "entities/Ä.json", "{}");
        put(&root, "media/bild.json", "{}");
        fs::write(root.join("entities/bom.json"), b"\xEF\xBB\xBF{}").unwrap();
        fs::write(root.join("entities/kaputt.json"), b"{\"a\":\"\xFF\"}").unwrap();
        put(&root, ".abgleich/stand.json", "{}");
        let big = "x".repeat(MAX_FILE_BYTES as usize + 1);
        put(&root, "entities/gross.json", &big);
        let (files, frozen) = scan_local(&root).unwrap();
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["campaign.json", "entities/a.json", "media/bild.json"]);
        let mut reasons: Vec<(String, &str)> = frozen.iter().map(|f| (f.path.clone(), f.reason)).collect();
        reasons.sort();
        assert_eq!(
            reasons,
            vec![
                ("entities/bom.json".to_string(), "encoding"),
                ("entities/gross.json".to_string(), "size"),
                ("entities/kaputt.json".to_string(), "encoding"),
            ]
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn names_that_differ_only_in_case_both_stay_home() {
        let (_d, root) = root();
        put(&root, "entities/abc.json", "{}");
        put(&root, "entities/ABC.json", "{}");
        let (files, frozen) = scan_local(&root).unwrap();
        assert!(files.is_empty());
        assert_eq!(frozen.len(), 2);
        assert!(frozen.iter().all(|f| f.reason == "case"));
    }

    #[test]
    fn stand_falls_back_to_the_previous_version() {
        let (_d, root) = root();
        assert!(read_stand(&root).is_none());
        let mut stand = Stand {
            files: Some(BTreeMap::from([("state.json".into(), "a".into())])),
            ..Stand::default()
        };
        write_stand(&root, &stand).unwrap();
        stand.files = Some(BTreeMap::from([("state.json".into(), "b".into())]));
        write_stand(&root, &stand).unwrap();
        fs::write(dir(&root).join(STAND_FILE), "kaputt").unwrap();
        assert_eq!(read_stand(&root).unwrap().files.unwrap()["state.json"], "a");
        fs::write(dir(&root).join(STAND_BEFORE), "auch kaputt").unwrap();
        assert!(read_stand(&root).is_none());
    }

    #[test]
    fn places_compare_without_case_and_prefix() {
        let (_d, root) = root();
        let text = root.to_str().unwrap();
        assert!(same_place(text, text));
        assert!(same_place(text, &format!("{text}/")));
        if cfg!(windows) {
            assert!(same_place(text, &text.to_uppercase()));
            assert!(same_place(text, &format!(r"\\?\{text}")));
        }
        assert!(!same_place(text, &format!("{text}-kopie")));
    }

    #[cfg(windows)]
    #[test]
    fn the_sync_folder_is_hidden_on_windows() {
        use std::os::windows::fs::MetadataExt;
        let (_d, root) = root();
        write_link(
            &root,
            &SyncLink {
                owner: "o".into(),
                repo: "r".into(),
                branch: "main".into(),
                device: "Windows-PC".into(),
                root: root.to_string_lossy().into(),
            },
        )
        .unwrap();
        let attrs = fs::metadata(dir(&root)).unwrap().file_attributes();
        assert_ne!(attrs & 0x2, 0, "versteckt");
        // Und die Ablage des Kampagnenordners sieht ihn nie.
        assert!(store::list(&root).unwrap().is_empty());
    }

    fn begin(
        root: &Path,
        kind: &str,
        writes: Vec<ApplyWrite>,
        deletes: Vec<NoteDelete>,
    ) -> Result<Begun, SyncError> {
        apply_begin(
            root,
            ApplyBegin {
                kind: kind.into(),
                head: Some("h".repeat(40)),
                reason: "abgleich".into(),
                writes,
                deletes,
                keep: vec![],
                link: None,
                base_all: None,
            },
        )
    }

    fn write_of(path: &str, content: &str, expect: Option<String>) -> ApplyWrite {
        ApplyWrite {
            path: path.into(),
            expect,
            base: Some(blob_sha(content.as_bytes())),
            sha: None,
            content: Some(content.into()),
        }
    }

    #[test]
    fn apply_begin_reports_busy_and_does_nothing() {
        let (_d, root) = root();
        put(&root, "entities/a.json", "hier");
        let begun = begin(
            &root,
            "run",
            vec![write_of("entities/a.json", "dort", Some("falsch".into()))],
            vec![],
        )
        .unwrap();
        assert_eq!(begun.busy, vec!["entities/a.json"]);
        assert!(read_note(&root).unwrap().is_none());
        assert!(aside_list(&root).is_empty());
    }

    #[test]
    fn aside_runs_count_up_and_skip_collisions() {
        let (_d, root) = root();
        let a = put(&root, "entities/a.json", "eins");
        fs::create_dir_all(aside_dir(&root).join("1")).unwrap();
        let begun = begin(
            &root,
            "run",
            vec![write_of("entities/a.json", "zwei", Some(a))],
            vec![],
        )
        .unwrap();
        assert_eq!(begun.run, 2);
        apply_abort(&root, 2).unwrap();
        let b = blob_sha(b"eins");
        let again = begin(
            &root,
            "run",
            vec![write_of("entities/a.json", "drei", Some(b))],
            vec![],
        )
        .unwrap();
        assert_eq!(again.run, 3);
    }

    #[test]
    fn recover_finishes_each_entry_by_what_is_on_disk() {
        let (_d, root) = root();
        let a = put(&root, "entities/a.json", "a alt");
        let b = put(&root, "entities/b.json", "b alt");
        let c = put(&root, "entities/c.json", "c alt");
        let e = put(&root, "entities/e.json", "e alt");
        write_stand(
            &root,
            &Stand {
                files: Some(BTreeMap::new()),
                ..Stand::default()
            },
        )
        .unwrap();
        let begun = begin(
            &root,
            "run",
            vec![
                write_of("entities/a.json", "a neu", Some(a)),
                write_of("entities/b.json", "b neu", Some(b)),
                write_of("entities/c.json", "c neu", Some(c)),
                write_of("entities/d.json", "d neu", None),
            ],
            vec![NoteDelete {
                path: "entities/e.json".into(),
                expect: e,
            }],
        )
        .unwrap();
        // Schon neu: a. Noch alt: c, d, e. Etwas Drittes: b. Eingangsdatei von d verfälscht.
        put(&root, "entities/a.json", "a neu");
        put(&root, "entities/b.json", "b fremd");
        let d_sha = blob_sha(b"d neu");
        fs::write(inbox_path(&root, &d_sha).unwrap(), "verfälscht").unwrap();
        let result = recover(&root).unwrap();
        assert_eq!(result.finished, 3);
        assert!(result.left.is_empty());
        assert_eq!(fs::read_to_string(root.join("entities/a.json")).unwrap(), "a neu");
        assert_eq!(
            fs::read_to_string(root.join("entities/b.json")).unwrap(),
            "b fremd"
        );
        assert_eq!(fs::read_to_string(root.join("entities/c.json")).unwrap(), "c neu");
        assert!(!root.join("entities/d.json").exists());
        assert!(!root.join("entities/e.json").exists());
        assert!(read_note(&root).unwrap().is_none());
        let files = read_stand(&root).unwrap().files.unwrap();
        assert!(files.contains_key("entities/a.json") && files.contains_key("entities/c.json"));
        assert!(!files.contains_key("entities/b.json"));
        let runs = aside_list(&root);
        assert_eq!(runs[0].run, begun.run);
        assert_eq!(runs[0].entries.len(), 4);
    }

    #[test]
    fn adopt_writes_stand_and_link_only_at_the_end() {
        let (_d, root) = root();
        let content = "{\"id\":\"campaign\"}";
        let sha = blob_sha(content.as_bytes());
        inbox_write(&root, &sha, content.as_bytes()).unwrap();
        let link = SyncLink {
            owner: "o".into(),
            repo: "r".into(),
            branch: "main".into(),
            device: "MacBook".into(),
            root: root.to_string_lossy().into(),
        };
        let other = "{\"id\":\"state\"}";
        let other_sha = blob_sha(other.as_bytes());
        apply_begin(
            &root,
            ApplyBegin {
                kind: "adopt".into(),
                head: Some("c".repeat(40)),
                reason: "abgleich".into(),
                writes: vec![
                    ApplyWrite {
                        path: "campaign.json".into(),
                        expect: None,
                        base: Some(sha.clone()),
                        sha: Some(sha.clone()),
                        content: None,
                    },
                    ApplyWrite {
                        path: "state.json".into(),
                        expect: None,
                        base: Some(other_sha.clone()),
                        sha: None,
                        content: Some(other.into()),
                    },
                ],
                deletes: vec![],
                keep: vec![],
                link: Some(link.clone()),
                base_all: Some(BTreeMap::from([
                    ("campaign.json".into(), sha.clone()),
                    ("state.json".into(), other_sha.clone()),
                ])),
            },
        )
        .unwrap();
        assert!(read_link(&root).is_none());
        // Eine Eingangsdatei fehlt: Der Merkzettel bleibt, nichts ist eingerichtet.
        fs::remove_file(inbox_path(&root, &other_sha).unwrap()).unwrap();
        let first = recover(&root).unwrap();
        assert_eq!(first.left.len(), 1);
        assert!(read_link(&root).is_none());
        assert!(read_note(&root).unwrap().is_some());
        // Nachgeholt (mit Netz): jetzt fertig.
        inbox_write(&root, &other_sha, other.as_bytes()).unwrap();
        let second = recover(&root).unwrap();
        assert!(second.left.is_empty());
        assert_eq!(read_link(&root), Some(link));
        assert_eq!(read_stand(&root).unwrap().files.unwrap().len(), 2);
        // Ein nicht leerer Ordner nimmt kein Holen an.
        unlink(&root);
        let err = begin(&root, "adopt", vec![], vec![]).unwrap_err();
        assert_eq!(err.kind, "input");
    }

    #[test]
    fn apply_end_only_settles_what_is_on_disk() {
        let (_d, root) = root();
        let a = put(&root, "entities/a.json", "alt");
        write_stand(
            &root,
            &Stand {
                files: Some(BTreeMap::new()),
                ..Stand::default()
            },
        )
        .unwrap();
        let begun = begin(
            &root,
            "run",
            vec![write_of("entities/a.json", "neu", Some(a))],
            vec![],
        )
        .unwrap();
        let ended = apply_end(&root, begun.run).unwrap();
        assert_eq!(ended.left, vec!["entities/a.json"]);
        assert!(read_stand(&root).unwrap().files.unwrap().is_empty());
        assert_eq!(fs::read_to_string(root.join("entities/a.json")).unwrap(), "alt");
    }

    #[test]
    fn pruning_keeps_decisions_and_the_newest_fifty() {
        let (_d, root) = root();
        put(&root, "entities/a.json", "a");
        for i in 0..55 {
            aside_put(&root, &["entities/a.json".to_string()], "abgleich").unwrap();
            if i == 3 {
                aside_put(&root, &["entities/a.json".to_string()], "entscheidung").unwrap();
            }
        }
        fs::create_dir_all(aside_dir(&root).join("999")).unwrap();
        mark(
            &root,
            MarkInput {
                synced: Some(true),
                ..MarkInput::default()
            },
        )
        .unwrap();
        let runs = aside_list(&root);
        assert_eq!(runs.len(), 51);
        assert!(runs.iter().any(|r| r.reason == "entscheidung"));
        assert!(!aside_dir(&root).join("999").exists());
    }

    #[test]
    fn mark_drops_the_base_after_a_restore() {
        let (_d, root) = root();
        mark(
            &root,
            MarkInput {
                base: Some(vec![BaseMark {
                    path: "state.json".into(),
                    sha: Some("a".into()),
                }]),
                ..MarkInput::default()
            },
        )
        .unwrap();
        assert!(read_stand(&root).unwrap().files.is_some());
        mark(
            &root,
            MarkInput {
                drop_base: Some(true),
                ..MarkInput::default()
            },
        )
        .unwrap();
        let stand = read_stand(&root).unwrap();
        assert!(stand.files.is_none());
        assert!(stand.restored);
        // Ohne gemeinsamen Stand bleibt die Angabe auch nach einem Lauf stehen …
        mark(
            &root,
            MarkInput {
                synced: Some(true),
                ..MarkInput::default()
            },
        )
        .unwrap();
        assert!(read_stand(&root).unwrap().restored);
        // … und ist erledigt, sobald der erste Abgleich wieder einen gemeinsamen Stand hat.
        mark(
            &root,
            MarkInput {
                base: Some(vec![BaseMark {
                    path: "state.json".into(),
                    sha: Some("a".into()),
                }]),
                synced: Some(true),
                ..MarkInput::default()
            },
        )
        .unwrap();
        assert!(!read_stand(&root).unwrap().restored);
    }

    #[test]
    fn iso_dates() {
        assert_eq!(iso_from_secs(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_from_secs(1_794_778_800), "2026-11-15T21:40:00Z");
    }
}
