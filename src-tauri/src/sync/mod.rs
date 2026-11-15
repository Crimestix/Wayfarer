//! Abgleich mit einer privaten Ablage bei GitHub (Entwurf `docs/abgleich/abgleich-entwurf-fertig.md`).
//!
//! **TypeScript entscheidet, Rust trägt.** Hier stehen Netz, Schlüsselbund, Dateien, Kennungen,
//! Archiv, der Ordner `.abgleich/`, Hochladen und Wiederaufnahme – nichts vom Inhalt der Welt.
//! Die Befehle sind der Vertrag mit `src/data/platform.ts`.

pub mod archive;
pub mod github;
pub mod local;
#[cfg(test)]
pub mod testserver;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::keys::{KeyState, KeyStore};
use github::Api;
use local::{Marker, Seen, Stand, SyncFile, SyncLink};

/// Vorschlag für den Namen der Ablage (Schritt 2 der Einrichtung).
pub const SUGGESTED_REPO: &str = "spielstand-elaris";
const MARKER_PATH: &str = "wayfarer.json";
const ATTRIBUTES_PATH: &str = ".gitattributes";
/// Ab so vielen Dateien wird das Archiv geholt statt jede einzeln.
const ARCHIVE_FROM: usize = 100;
/// Pakete beim Hochladen.
const PACKET_ENTRIES: usize = 400;
const PACKET_BYTES: usize = 2 * 1024 * 1024;
/// Ob die Ablage privat ist, wird je Sitzung einmal und danach einmal am Tag gefragt.
const PRIVACY_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// Ein Fehler des Abgleichs: die Art (Entwurf 4.5), ein Satz, ggf. Wartezeit in Sekunden.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncError {
    pub kind: &'static str,
    pub message: String,
    pub retry_after: Option<u64>,
}

impl SyncError {
    pub fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            retry_after: None,
        }
    }
}

impl std::fmt::Display for SyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

type Result<T> = std::result::Result<T, SyncError>;

/// Zustand der laufenden App: Schlüssel, Adresse, Verbindungen, Wartezeiten.
pub struct Sync {
    pub keys: KeyStore,
    api: Mutex<Url>,
    clients: Mutex<Option<(Url, Client, Client)>>,
    privacy: Mutex<HashMap<String, (bool, Instant)>>,
    /// Pause zwischen zwei schreibenden Anfragen.
    write_gap: Mutex<Duration>,
    /// Wartezeiten vor dem Wiederholen eines Pakets.
    retry_waits: Mutex<Vec<Duration>>,
}

impl Default for Sync {
    fn default() -> Self {
        Self {
            keys: KeyStore::new("GitHub-Key"),
            api: Mutex::new(Url::parse(github::API_BASE).expect("feste Adresse")),
            clients: Mutex::new(None),
            privacy: Mutex::new(HashMap::new()),
            write_gap: Mutex::new(Duration::from_secs(1)),
            retry_waits: Mutex::new(vec![
                Duration::from_secs(5),
                Duration::from_secs(15),
                Duration::from_secs(45),
            ]),
        }
    }
}

impl Sync {
    /// Nur in Tests: der Gegenpart statt GitHub, ohne Wartezeiten.
    #[cfg(test)]
    pub fn for_tests(&self, base: Url) {
        *self.api.lock().unwrap() = base;
        *self.write_gap.lock().unwrap() = Duration::ZERO;
        *self.retry_waits.lock().unwrap() = vec![Duration::ZERO; 3];
    }

    fn api(&self, key: String, link: &SyncLink) -> Result<Api> {
        let base = self.api.lock().map_err(|_| internal())?.clone();
        let mut slot = self.clients.lock().map_err(|_| internal())?;
        let (client, plain) = match slot.as_ref() {
            Some((url, c, p)) if *url == base => (c.clone(), p.clone()),
            _ => {
                let (c, p) = github::build_clients(&base)?;
                *slot = Some((base.clone(), c.clone(), p.clone()));
                (c, p)
            }
        };
        check_name(&link.owner)?;
        check_name(&link.repo)?;
        check_name(&link.branch)?;
        Ok(Api {
            client,
            plain,
            base,
            key,
            owner: link.owner.clone(),
            repo: link.repo.clone(),
            branch: link.branch.clone(),
        })
    }

    fn key(&self, retry: bool) -> Result<String> {
        match self.keys.get(retry) {
            KeyState::Present(key) => Ok(key),
            KeyState::Missing => Err(SyncError::new(
                "nokey",
                "Auf diesem Rechner liegt kein Zugangsschlüssel.",
            )),
            KeyState::Denied => Err(SyncError::new(
                "keychain",
                "Der Schlüsselbund gibt den Zugangsschlüssel nicht heraus.",
            )),
        }
    }

    fn gap(&self) -> Duration {
        self.write_gap
            .lock()
            .map(|g| *g)
            .unwrap_or(Duration::from_secs(1))
    }

    fn waits(&self) -> Vec<Duration> {
        self.retry_waits.lock().map(|w| w.clone()).unwrap_or_default()
    }
}

fn internal() -> SyncError {
    SyncError::new("local", "Interner Fehler im Abgleich.")
}

/// Namen von Konto, Ablage und Zweig: nur, was GitHub selbst erlaubt.
fn check_name(name: &str) -> Result<()> {
    let ok = !name.is_empty()
        && name.len() <= 100
        && name != "."
        && name != ".."
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'));
    if ok {
        Ok(())
    } else {
        Err(SyncError::new("input", "Ungültiger Name der Ablage."))
    }
}

fn check_root(root: &str) -> Result<PathBuf> {
    crate::store::check_root(root).map_err(|m| SyncError::new("input", m))
}

async fn pause(duration: Duration) {
    if duration.is_zero() {
        return;
    }
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration)).await;
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| internal())?
}

#[derive(Clone, Serialize)]
struct Progress {
    phase: &'static str,
    done: usize,
    total: usize,
}

fn progress<R: Runtime>(app: &AppHandle<R>, phase: &'static str, done: usize, total: usize) {
    let _ = app.emit("sync-progress", Progress { phase, done, total });
}

fn marker_text(marker: &Marker) -> String {
    let value = json!({
        "format": "wayfarer-abgleich",
        "datenstand": marker.datenstand,
        "gestalt": marker.gestalt,
        "geraete": marker.geraete,
    });
    format!("{value}\n")
}

fn parse_marker(bytes: &[u8]) -> Option<Marker> {
    let value: Value = serde_json::from_slice(bytes).ok()?;
    if value["format"] != "wayfarer-abgleich" {
        return None;
    }
    serde_json::from_value(value).ok()
}

/// empty = nichts; fresh = nur README & Co.; wayfarer = Marke; foreign = alles andere.
fn kind_of(files: &BTreeMap<String, String>, marker: Option<&Marker>) -> &'static str {
    if files.is_empty() {
        return "empty";
    }
    if marker.is_some() {
        return "wayfarer";
    }
    let fresh = files.keys().all(|p| {
        let upper = p.to_ascii_uppercase();
        !p.contains('/')
            && (upper.starts_with("README")
                || upper.starts_with("LICENSE")
                || p == ".gitignore"
                || p == ATTRIBUTES_PATH)
    });
    if fresh {
        "fresh"
    } else {
        "foreign"
    }
}

// ── sync_state ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateInfo {
    key: &'static str,
    link: Option<SyncLink>,
    moved: bool,
    has_base: bool,
    pending: Option<String>,
    older: bool,
    synced_at: Option<String>,
    device: Option<String>,
    pushed_at: Option<String>,
    aside: usize,
    /// Hier wurde ein ganzer Stand eingespielt (Sicherung, Neuanfang) – Frage 1.9.
    restored: bool,
}

pub fn state(sync: &Sync, root: &str, data_version: u32) -> Result<StateInfo> {
    let root = check_root(root)?;
    let link = local::read_link(&root);
    let mut stand = local::read_stand(&root);
    if let Some(s) = stand.as_mut() {
        if data_version < s.max_version && !s.older_edits {
            // Gesetzt, bevor irgendetwas angewendet wird.
            s.older_edits = true;
            local::write_stand(&root, s)?;
        }
    }
    let key = match sync.keys.get(false) {
        KeyState::Present(_) => "yes",
        KeyState::Missing => "no",
        KeyState::Denied => "denied",
    };
    let root_text = root.to_string_lossy().into_owned();
    Ok(StateInfo {
        key,
        moved: link
            .as_ref()
            .is_some_and(|l| !local::same_place(&l.root, &root_text)),
        link,
        has_base: stand.as_ref().is_some_and(|s| s.files.is_some()),
        pending: local::read_note(&root)?.map(|n| n.kind),
        older: stand.as_ref().is_some_and(|s| data_version < s.max_version),
        synced_at: stand.as_ref().and_then(|s| s.synced_at.clone()),
        device: stand.as_ref().and_then(|s| s.seen.as_ref()?.device.clone()),
        pushed_at: stand.as_ref().and_then(|s| s.seen.as_ref()?.pushed_at.clone()),
        aside: local::aside_list(&root).len(),
        restored: stand.as_ref().is_some_and(|s| s.restored),
    })
}

/// Prüft die Form eines Zugangsschlüssels.
pub fn check_key(key: &str) -> Result<String> {
    let key = key.trim();
    if key.starts_with("ghp_") {
        return Err(SyncError::new(
            "input",
            "Das ist ein Schlüssel der älteren Art; er gälte für alle deine Ablagen. Bitte erzeuge einen „Fine-grained token“.",
        ));
    }
    if !key.starts_with("github_pat_") || key.len() > 512 || !key.bytes().all(|b| b.is_ascii_graphic()) {
        return Err(SyncError::new(
            "input",
            "Das sieht nicht nach einem Zugangsschlüssel aus. Er beginnt mit github_pat_.",
        ));
    }
    Ok(key.to_string())
}

// ── sync_scan ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteScan {
    live: bool,
    kind: &'static str,
    is_private: bool,
    behind: bool,
    head: Option<String>,
    tree: Option<String>,
    files: Vec<SyncFile>,
    marker: Option<Marker>,
    device: Option<String>,
    pushed_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    link: Option<SyncLink>,
    base: Option<BTreeMap<String, String>>,
    decided: BTreeMap<String, local::Decision>,
    local: Vec<SyncFile>,
    frozen: Vec<local::Frozen>,
    settled: usize,
    max_version: u32,
    older_edits: bool,
    /// Hier wurde ein ganzer Stand eingespielt (Sicherung, Neuanfang) – Frage 1.9.
    restored: bool,
    remote: Option<RemoteScan>,
}

async fn is_private(sync: &Sync, api: &Api) -> Result<bool> {
    let name = format!("{}/{}", api.owner, api.repo);
    if let Some((private, at)) = sync.privacy.lock().map_err(|_| internal())?.get(&name) {
        if at.elapsed() < PRIVACY_AGE {
            return Ok(*private);
        }
    }
    let info = api.repo_info().await?;
    let private = info["private"].as_bool().unwrap_or(false);
    sync.privacy
        .lock()
        .map_err(|_| internal())?
        .insert(name, (private, Instant::now()));
    Ok(private)
}

async fn scan_remote(sync: &Sync, api: &Api, stand: &mut Option<Stand>) -> Result<RemoteScan> {
    let head = api.head().await?;
    let seen = stand.as_ref().and_then(|s| s.seen.clone());
    let has_base = stand.as_ref().is_some_and(|s| s.files.is_some());
    let private = is_private(sync, api).await?;
    let Some(head) = head else {
        if has_base || seen.is_some() {
            return Err(SyncError::new(
                "server",
                "Die Ablage antwortet gerade unerwartet.",
            ));
        }
        return Ok(RemoteScan {
            live: true,
            kind: "empty",
            is_private: private,
            behind: false,
            head: None,
            tree: None,
            files: Vec::new(),
            marker: None,
            device: None,
            pushed_at: None,
        });
    };
    let cached = seen
        .as_ref()
        .filter(|s| s.commit == head && !s.tree.is_empty())
        .cloned();
    let fresh = match cached {
        Some(seen) => seen,
        None => {
            if let Some(seen) = seen.as_ref().filter(|s| s.commit != head) {
                if !api.builds_on(&seen.commit, &head).await? {
                    return Ok(RemoteScan {
                        live: true,
                        kind: "wayfarer",
                        is_private: private,
                        behind: true,
                        head: Some(head),
                        tree: None,
                        files: Vec::new(),
                        marker: seen.marker.clone(),
                        device: seen.device.clone(),
                        pushed_at: seen.pushed_at.clone(),
                    });
                }
            }
            let (tree, message, date) = api.commit(&head).await?;
            let files = api.tree(&tree).await?;
            let marker = match files.get(MARKER_PATH) {
                Some(sha) => parse_marker(&api.blob(sha).await?),
                None => None,
            };
            let fresh = Seen {
                commit: head.clone(),
                tree,
                files,
                marker,
                device: github::device_of(&message),
                pushed_at: date,
            };
            if let Some(s) = stand.as_mut() {
                s.max_version = s
                    .max_version
                    .max(fresh.marker.as_ref().map_or(0, |m| m.datenstand));
                s.seen = Some(fresh.clone());
            }
            fresh
        }
    };
    Ok(RemoteScan {
        live: true,
        kind: kind_of(&fresh.files, fresh.marker.as_ref()),
        is_private: private,
        behind: false,
        head: Some(fresh.commit.clone()),
        tree: Some(fresh.tree.clone()),
        files: fresh
            .files
            .iter()
            .filter(|(p, _)| local::is_synced_path(p))
            .map(|(p, s)| SyncFile {
                path: p.clone(),
                sha: s.clone(),
                size: 0,
            })
            .collect(),
        marker: fresh.marker.clone(),
        device: fresh.device.clone(),
        pushed_at: fresh.pushed_at.clone(),
    })
}

pub async fn scan(
    sync: &Sync,
    root: &str,
    remote: bool,
    retry_key: bool,
    link: Option<SyncLink>,
) -> Result<Scan> {
    let root = check_root(root)?;
    let (settled, local_files, frozen, mut stand, stored_link) = {
        let root = root.clone();
        blocking(move || {
            let settled = local::settle_note(&root)?;
            let (files, frozen) = local::scan_local(&root)?;
            Ok((
                settled,
                files,
                frozen,
                local::read_stand(&root),
                local::read_link(&root),
            ))
        })
        .await?
    };
    let link = link.or(stored_link);
    let remote = if remote {
        let link = link
            .clone()
            .ok_or_else(|| SyncError::new("input", "Der Abgleich ist nicht eingerichtet."))?;
        let api = sync.api(sync.key(retry_key)?, &link)?;
        let scanned = scan_remote(sync, &api, &mut stand).await?;
        if let Some(s) = stand.as_ref() {
            // Nur das Gesehene nachtragen – auf dem jetzigen Stand der Datei.
            local::remember_seen(&root, s.seen.clone(), s.max_version)?;
            stand = local::read_stand(&root);
        }
        Some(scanned)
    } else {
        None
    };
    let stand = stand.unwrap_or_default();
    Ok(Scan {
        link,
        base: stand.files,
        decided: stand.decided,
        local: local_files,
        frozen,
        settled,
        max_version: stand.max_version,
        older_edits: stand.older_edits,
        restored: stand.restored,
        remote,
    })
}

// ── sync_fetch ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchItem {
    pub sha: String,
    /// Nur zur Auskunft (wofür die Datei geholt wird).
    #[serde(default)]
    #[allow(dead_code)]
    pub path: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Fetched {
    sha: String,
    content: Option<String>,
}

pub async fn fetch<R: Runtime>(
    app: &AppHandle<R>,
    sync: &Sync,
    root: &str,
    items: Vec<FetchItem>,
    link: Option<SyncLink>,
) -> Result<Vec<Fetched>> {
    let root = check_root(root)?;
    let mut missing: BTreeSet<String> = items
        .iter()
        .filter(|i| local::inbox_read(&root, &i.sha).is_none())
        .map(|i| i.sha.clone())
        .collect();
    let total = missing.len();
    if !missing.is_empty() {
        let link = link
            .or_else(|| local::read_link(&root))
            .ok_or_else(|| SyncError::new("input", "Der Abgleich ist nicht eingerichtet."))?;
        let api = sync.api(sync.key(false)?, &link)?;
        if missing.len() >= ARCHIVE_FROM {
            let head = match local::read_stand(&root).and_then(|s| s.seen).map(|s| s.commit) {
                Some(head) => head,
                None => api
                    .head()
                    .await?
                    .ok_or_else(|| SyncError::new("input", "In deiner Ablage liegt noch kein Spielstand."))?,
            };
            progress(app, "holen", 0, total);
            let gz = api.tarball(&head).await?;
            let found = archive::extract(&gz, &missing)?;
            for (sha, bytes) in found {
                local::inbox_write(&root, &sha, &bytes)?;
                missing.remove(&sha);
            }
        }
        let rest: Vec<String> = missing.into_iter().collect();
        for (i, sha) in rest.iter().enumerate() {
            let bytes = api.blob(sha).await?;
            local::inbox_write(&root, sha, &bytes)?;
            progress(app, "holen", total - rest.len() + i + 1, total);
        }
    }
    items
        .into_iter()
        .map(|item| {
            let bytes = local::inbox_read(&root, &item.sha).ok_or_else(|| {
                SyncError::new("server", "Eine geholte Datei passt nicht zu ihrer Kennung.")
            })?;
            let content = local::clean_text(&bytes).map(str::to_string);
            Ok(Fetched {
                sha: item.sha,
                content,
            })
        })
        .collect()
}

// ── sync_push ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub sha: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Counts {
    pub changed: usize,
    pub added: usize,
    pub removed: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushInput {
    pub head: Option<String>,
    pub tree: Option<String>,
    pub changes: Vec<Change>,
    pub data_version: u32,
    pub data_shape: String,
    #[serde(default)]
    pub counts: Counts,
    #[serde(default)]
    pub link: Option<SyncLink>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Pushed {
    head: String,
    tree: String,
}

/// Teilt die Einträge in Pakete (≤ 400 Einträge und ≤ 2 MB; eine größere Datei allein).
fn packets(entries: Vec<Value>) -> Vec<Vec<Value>> {
    let mut out: Vec<Vec<Value>> = Vec::new();
    let mut size = 0;
    for entry in entries {
        let len = entry.to_string().len();
        let full = out
            .last()
            .is_none_or(|p| p.len() >= PACKET_ENTRIES || (size + len > PACKET_BYTES && !p.is_empty()));
        if full {
            out.push(Vec::new());
            size = 0;
        }
        size += len;
        out.last_mut().unwrap().push(entry);
    }
    out
}

/// Hochladen in einer Folge (Entwurf 3.3a): erst jede Datei gegen den Plan prüfen – weicht
/// eine ab, wird nichts hochgeladen –, dann Bäume in Paketen, Commit, Umschalten ohne `force`,
/// und erst danach `stand.json`.
pub async fn push<R: Runtime>(
    app: &AppHandle<R>,
    sync: &Sync,
    root: &str,
    input: PushInput,
) -> Result<Pushed> {
    let root = check_root(root)?;
    let link = input
        .link
        .clone()
        .or_else(|| local::read_link(&root))
        .ok_or_else(|| SyncError::new("input", "Der Abgleich ist nicht eingerichtet."))?;
    // 1. Jede Datei roh lesen und ihre Kennung gegen den Plan prüfen.
    let mut contents: Vec<(String, String)> = Vec::new();
    let mut deletes: Vec<String> = Vec::new();
    for change in &input.changes {
        if !local::is_synced_path(&change.path) {
            return Err(SyncError::new(
                "input",
                format!("„{}“ gehört nicht zum Spielstand.", change.path),
            ));
        }
        match &change.sha {
            None => deletes.push(change.path.clone()),
            Some(expect) => {
                let bytes = local::read_campaign_file(&root, &change.path)?;
                let ok = bytes.as_ref().is_some_and(|b| local::blob_sha(b) == *expect);
                let text = bytes.as_deref().and_then(local::clean_text);
                match (ok, text) {
                    (true, Some(text)) => contents.push((change.path.clone(), text.to_string())),
                    _ => return Err(SyncError::new("busy", "Eine Datei hat sich inzwischen geändert.")),
                }
            }
        }
    }
    let api = sync.api(sync.key(false)?, &link)?;
    let stand = local::read_stand(&root);
    let seen = stand.as_ref().and_then(|s| s.seen.clone());
    // Gab es schon einen gemeinsamen Stand? (Ohne: das erste Hochladen legt ihn an.)
    let had_base = stand.as_ref().is_some_and(|s| s.files.is_some());
    // 2. Leere Ablage: eröffnen.
    let first = input.head.is_none() || seen.is_none();
    let (head, mut base_tree) = match &input.head {
        Some(head) => (
            head.clone(),
            match &input.tree {
                Some(tree) => tree.clone(),
                None => api.commit(head).await?.0,
            },
        ),
        None => {
            let (commit, tree) = api.put_readme().await?;
            pause(sync.gap()).await;
            (commit, tree)
        }
    };
    let known: BTreeMap<String, String> = match seen.as_ref().filter(|s| s.commit == head) {
        Some(s) => s.files.clone(),
        None => api.tree(&base_tree).await?,
    };
    // Nie in eine fremde oder öffentliche Ablage schreiben.
    if kind_of(&known, None) == "foreign" && !known.contains_key(MARKER_PATH) {
        return Err(SyncError::new(
            "input",
            "In dieser Ablage liegt kein Spielstand von Wayfarer.",
        ));
    }
    if !is_private(sync, &api).await? {
        return Err(SyncError::new(
            "denied",
            "Die Ablage ist öffentlich. Wayfarer lädt nichts hoch.",
        ));
    }
    // Marke: dieser Rechner mit seiner Zahl; Datenstand und Gestalt nur nach oben.
    let old = match known.get(MARKER_PATH) {
        Some(sha) => parse_marker(&api.blob(sha).await?),
        None => None,
    };
    let mut marker = old.clone().unwrap_or_default();
    if old.is_none() || input.data_version >= marker.datenstand {
        marker.gestalt = input.data_shape.clone();
    }
    marker.datenstand = marker.datenstand.max(input.data_version);
    marker.geraete.insert(link.device.clone(), input.data_version);
    let marker_body = marker_text(&marker);
    let mut entries: Vec<Value> = contents
        .iter()
        .map(|(path, text)| json!({ "path": path, "mode": "100644", "type": "blob", "content": text }))
        .collect();
    entries.extend(
        deletes
            .iter()
            .map(|path| json!({ "path": path, "mode": "100644", "type": "blob", "sha": null })),
    );
    entries.push(json!({ "path": MARKER_PATH, "mode": "100644", "type": "blob", "content": marker_body }));
    if !known.contains_key(ATTRIBUTES_PATH) {
        entries.push(
            json!({ "path": ATTRIBUTES_PATH, "mode": "100644", "type": "blob", "content": "* -text\n" }),
        );
    }
    // 3. Bäume in Paketen, jedes mit base_tree; bei Störung bis zu dreimal wiederholen.
    let mut queue = packets(entries);
    let count = queue.len();
    let total = input.changes.len();
    let mut sent = 0;
    queue.reverse();
    'packets: while let Some(packet) = queue.pop() {
        let mut attempt = 0;
        loop {
            let result = api.post_tree(Some(&base_tree), &packet).await;
            match result {
                Ok(Ok(tree)) => {
                    base_tree = tree;
                    break;
                }
                Ok(Err(reply)) if matches!(reply.status, 502 | 504) && packet.len() > 1 => {
                    // Zu groß für GitHub: halbieren.
                    let mut half = packet.clone();
                    let second = half.split_off(packet.len() / 2);
                    queue.push(second);
                    queue.push(half);
                    continue 'packets;
                }
                Ok(Err(reply)) => {
                    let err = github::classify(
                        reply.status,
                        &reply.headers,
                        &String::from_utf8_lossy(&reply.body),
                    );
                    if err.kind != "server" || attempt >= 3 {
                        return Err(err);
                    }
                }
                Err(err) if (err.kind == "offline" || err.kind == "server") && attempt < 3 => {}
                Err(err) => return Err(err),
            }
            let wait = sync
                .waits()
                .get(attempt)
                .copied()
                .unwrap_or(Duration::from_secs(45));
            attempt += 1;
            pause(wait).await;
        }
        sent += packet
            .iter()
            .filter(|e| e["path"] != MARKER_PATH && e["path"] != ATTRIBUTES_PATH)
            .count();
        progress(app, "hochladen", sent.min(total), total);
        pause(sync.gap()).await;
    }
    // 4. Kontrolle beim ersten Hochladen und bei mehreren Paketen.
    let mut expected = known.clone();
    for (path, text) in &contents {
        expected.insert(path.clone(), local::blob_sha(text.as_bytes()));
    }
    for path in &deletes {
        expected.remove(path);
    }
    expected.insert(MARKER_PATH.into(), local::blob_sha(marker_body.as_bytes()));
    expected
        .entry(ATTRIBUTES_PATH.into())
        .or_insert_with(|| local::blob_sha(b"* -text\n"));
    let files = if first || count > 1 {
        let actual = api.tree(&base_tree).await?;
        let mismatch = contents
            .iter()
            .any(|(p, t)| actual.get(p) != Some(&local::blob_sha(t.as_bytes())))
            || deletes.iter().any(|p| actual.contains_key(p));
        if mismatch {
            return Err(SyncError::new(
                "server",
                "GitHub hat nicht alles übernommen; nichts wurde umgeschaltet.",
            ));
        }
        actual
    } else {
        expected
    };
    // 5. Commit auf den Kopf aus dem Plan; 6. Umschalten ohne force.
    let c = &input.counts;
    let message = format!(
        "Wayfarer ({}): {} geändert, {} neu, {} gelöscht",
        link.device, c.changed, c.added, c.removed
    );
    let commit = api.post_commit(&message, &base_tree, &head).await?;
    pause(sync.gap()).await;
    api.switch(&commit).await?;
    // 7. Erst jetzt der gemeinsame Stand – auf dem, was jetzt in der Datei steht: Was während
    // des Hochladens gemerkt wurde (Entscheidung, eingespielte Sicherung), bleibt. Wurde der
    // gemeinsame Stand inzwischen verworfen, entsteht kein Teil davon neu.
    let mut fresh = local::read_stand(&root).unwrap_or_default();
    let s = &mut fresh;
    if s.files.is_some() || !had_base {
        let base = s.files.get_or_insert_with(BTreeMap::new);
        for (path, text) in &contents {
            base.insert(path.clone(), local::blob_sha(text.as_bytes()));
        }
        for path in &deletes {
            base.remove(path);
        }
    }
    s.repo = Some(format!("{}/{}", link.owner, link.repo));
    s.branch = Some(link.branch.clone());
    s.max_version = s.max_version.max(marker.datenstand);
    s.seen = Some(Seen {
        commit: commit.clone(),
        tree: base_tree.clone(),
        files,
        marker: Some(marker),
        device: Some(link.device.clone()),
        pushed_at: Some(local::iso_from_secs(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        )),
    });
    local::write_stand(&root, s)?;
    Ok(Pushed {
        head: commit,
        tree: base_tree,
    })
}

// ── sync_probe ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    owner: String,
    repo: String,
    branch: String,
    is_private: bool,
    can_push: bool,
    archived: bool,
    kind: Option<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    info: RepoInfo,
    kind: &'static str,
    files: usize,
    marker: Option<Marker>,
    device: Option<String>,
    pushed_at: Option<String>,
    campaign: Option<String>,
    state: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    login: String,
    repos: Vec<RepoInfo>,
    found: Option<Found>,
}

fn repo_info_of(value: &Value) -> RepoInfo {
    RepoInfo {
        owner: value["owner"]["login"].as_str().unwrap_or("").to_string(),
        repo: value["name"].as_str().unwrap_or("").to_string(),
        branch: value["default_branch"].as_str().unwrap_or("main").to_string(),
        is_private: value["private"].as_bool().unwrap_or(false),
        can_push: value["permissions"]["push"].as_bool().unwrap_or(false),
        archived: value["archived"].as_bool().unwrap_or(false)
            || value["disabled"].as_bool().unwrap_or(false),
        kind: None,
    }
}

/// Wer bin ich, und welche Ablage gilt? Gezielt `/repos/{login}/{SUGGESTED_REPO}` bzw. die
/// Angabe; nur bei 404 die Liste der Ablagen des Schlüssels (nur zum Aussortieren).
pub async fn probe(sync: &Sync, owner: Option<String>, repo: Option<String>) -> Result<Probe> {
    let key = sync.key(false)?;
    let anchor = SyncLink {
        owner: owner.clone().unwrap_or_else(|| "x".into()),
        repo: repo.clone().unwrap_or_else(|| SUGGESTED_REPO.into()),
        branch: "main".into(),
        device: String::new(),
        root: String::new(),
    };
    let login = sync.api(key.clone(), &anchor)?.user().await?;
    let target = SyncLink {
        owner: owner.unwrap_or_else(|| login.clone()),
        ..anchor
    };
    let api = sync.api(key.clone(), &target)?;
    let (repos, chosen) = match api.repo_info().await {
        Ok(value) => {
            let info = repo_info_of(&value);
            (Vec::new(), Some(info))
        }
        Err(e) if e.kind == "missing" => {
            let list = api.user_repos().await?;
            let infos: Vec<RepoInfo> = list
                .iter()
                .map(repo_info_of)
                .filter(|r| r.is_private && r.can_push && !r.archived)
                .collect();
            (infos, None)
        }
        Err(e) => return Err(e),
    };
    let found = match chosen {
        None => None,
        Some(mut info) => {
            let link = SyncLink {
                owner: info.owner.clone(),
                repo: info.repo.clone(),
                branch: info.branch.clone(),
                device: String::new(),
                root: String::new(),
            };
            let api = sync.api(key, &link)?;
            let mut nothing = None;
            let remote = scan_remote(sync, &api, &mut nothing).await?;
            let campaign = match remote.files.iter().find(|f| f.path == "campaign.json") {
                Some(f) => serde_json::from_slice::<Value>(&api.blob(&f.sha).await?)
                    .ok()
                    .and_then(|v| v["name"].as_str().map(str::to_string)),
                None => None,
            };
            info.kind = Some(remote.kind);
            Some(Found {
                kind: remote.kind,
                files: remote.files.len(),
                marker: remote.marker,
                device: remote.device,
                pushed_at: remote.pushed_at,
                campaign,
                state: None,
                info,
            })
        }
    };
    Ok(Probe { login, repos, found })
}

// ── Befehle ──────────────────────────────────────────────────────────────────

fn root_text(root: &Path) -> String {
    root.to_string_lossy().into_owned()
}

#[tauri::command]
pub async fn sync_state<R: Runtime>(app: AppHandle<R>, root: String, data_version: u32) -> Result<StateInfo> {
    blocking(move || state(&app.state::<Sync>(), &root, data_version)).await
}

#[tauri::command]
pub async fn sync_set_key<R: Runtime>(app: AppHandle<R>, key: String) -> Result<()> {
    let key = check_key(&key)?;
    blocking(move || {
        app.state::<Sync>()
            .keys
            .set(&key)
            .map_err(|m| SyncError::new("keychain", m))
    })
    .await
}

#[tauri::command]
pub async fn sync_clear_key<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    blocking(move || {
        app.state::<Sync>()
            .keys
            .clear()
            .map_err(|m| SyncError::new("keychain", m))
    })
    .await
}

#[tauri::command]
pub async fn sync_probe<R: Runtime>(
    app: AppHandle<R>,
    owner: Option<String>,
    repo: Option<String>,
) -> Result<Probe> {
    probe(&app.state::<Sync>(), owner, repo).await
}

#[tauri::command]
pub async fn sync_link(root: String, link: Option<SyncLink>, move_to: Option<bool>) -> Result<()> {
    blocking(move || {
        let root = check_root(&root)?;
        match link {
            None => {
                local::unlink(&root);
                Ok(())
            }
            Some(mut link) => {
                check_name(&link.owner)?;
                check_name(&link.repo)?;
                check_name(&link.branch)?;
                if move_to == Some(true) || link.root.is_empty() {
                    link.root = root_text(&root);
                }
                local::write_link(&root, &link)
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn sync_recover(root: String) -> Result<local::Recovered> {
    blocking(move || local::recover(&check_root(&root)?)).await
}

#[tauri::command]
pub async fn sync_scan<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    remote: bool,
    retry_key: Option<bool>,
    link: Option<SyncLink>,
) -> Result<Scan> {
    scan(
        &app.state::<Sync>(),
        &root,
        remote,
        retry_key.unwrap_or(false),
        link,
    )
    .await
}

#[tauri::command]
pub async fn sync_fetch<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    items: Vec<FetchItem>,
    link: Option<SyncLink>,
) -> Result<Vec<Fetched>> {
    fetch(&app, &app.state::<Sync>(), &root, items, link).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn sync_apply_begin(
    root: String,
    kind: String,
    head: Option<String>,
    reason: String,
    writes: Vec<local::ApplyWrite>,
    deletes: Vec<local::NoteDelete>,
    keep: Option<Vec<local::ShaPath>>,
    link: Option<SyncLink>,
    base_all: Option<BTreeMap<String, String>>,
) -> Result<local::Begun> {
    blocking(move || {
        local::apply_begin(
            &check_root(&root)?,
            local::ApplyBegin {
                kind,
                head,
                reason,
                writes,
                deletes,
                keep: keep.unwrap_or_default(),
                link,
                base_all,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn sync_apply_end(root: String, run: u64) -> Result<local::Ended> {
    blocking(move || local::apply_end(&check_root(&root)?, run)).await
}

#[tauri::command]
pub async fn sync_apply_abort(root: String, run: u64) -> Result<()> {
    blocking(move || local::apply_abort(&check_root(&root)?, run)).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn sync_push<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    head: Option<String>,
    tree: Option<String>,
    changes: Vec<Change>,
    data_version: u32,
    data_shape: String,
    counts: Option<Counts>,
    link: Option<SyncLink>,
) -> Result<Pushed> {
    let input = PushInput {
        head,
        tree,
        changes,
        data_version,
        data_shape,
        counts: counts.unwrap_or_default(),
        link,
    };
    push(&app, &app.state::<Sync>(), &root, input).await
}

#[tauri::command]
pub async fn sync_mark(
    root: String,
    base: Option<Vec<local::BaseMark>>,
    decided: Option<BTreeMap<String, Option<local::Decision>>>,
    synced: Option<bool>,
    drop_base: Option<bool>,
    older_edits: Option<bool>,
) -> Result<()> {
    blocking(move || {
        local::mark(
            &check_root(&root)?,
            local::MarkInput {
                base,
                decided,
                synced,
                drop_base,
                older_edits,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn sync_aside_list(root: String) -> Result<Vec<local::AsideRun>> {
    blocking(move || Ok(local::aside_list(&check_root(&root)?))).await
}

#[tauri::command]
pub async fn sync_aside_read(root: String, run: u64, side: String, path: String) -> Result<String> {
    blocking(move || local::aside_read(&check_root(&root)?, run, &side, &path)).await
}

#[derive(Debug, Serialize)]
pub struct AsidePut {
    run: u64,
}

#[tauri::command]
pub async fn sync_aside_put(root: String, paths: Vec<String>, reason: String) -> Result<AsidePut> {
    blocking(move || {
        if !matches!(
            reason.as_str(),
            "abgleich" | "entscheidung" | "erster-abgleich" | "eingespielt" | "zurueckholen"
        ) {
            return Err(SyncError::new("input", "Unbekannter Grund."));
        }
        Ok(AsidePut {
            run: local::aside_put(&check_root(&root)?, &paths, &reason)?,
        })
    })
    .await
}

#[tauri::command]
pub async fn sync_aside_drop(root: String, run: u64) -> Result<()> {
    blocking(move || {
        local::aside_drop(&check_root(&root)?, run);
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_the_form_of_keys() {
        assert!(check_key("  github_pat_11ABC_def  ").is_ok());
        assert_eq!(check_key("ghp_alt").unwrap_err().kind, "input");
        assert_eq!(check_key("github_pat_mit leerzeichen").unwrap_err().kind, "input");
        assert_eq!(check_key("irgendwas").unwrap_err().kind, "input");
    }

    #[test]
    fn packets_respect_count_and_size() {
        let small: Vec<Value> = (0..900)
            .map(|i| json!({ "path": format!("a/{i}.json") }))
            .collect();
        let sizes: Vec<usize> = packets(small).iter().map(Vec::len).collect();
        assert_eq!(sizes, vec![400, 400, 100]);
        let big = "x".repeat(PACKET_BYTES + 10);
        let mixed = vec![json!({ "c": "a" }), json!({ "c": big }), json!({ "c": "b" })];
        let sizes: Vec<usize> = packets(mixed).iter().map(Vec::len).collect();
        assert_eq!(sizes, vec![1, 1, 1]);
    }

    #[test]
    fn names_kinds_of_repositories() {
        let files = |names: &[&str]| names.iter().map(|n| (n.to_string(), "x".to_string())).collect();
        assert_eq!(kind_of(&files(&[]), None), "empty");
        assert_eq!(kind_of(&files(&["README.md", ".gitattributes"]), None), "fresh");
        assert_eq!(kind_of(&files(&["src/main.rs"]), None), "foreign");
        assert_eq!(
            kind_of(&files(&["state.json"]), Some(&Marker::default())),
            "wayfarer"
        );
        assert!(parse_marker(
            b"{\"format\":\"wayfarer-abgleich\",\"datenstand\":2,\"gestalt\":\"ab\",\"geraete\":{}}"
        )
        .is_some());
        assert!(parse_marker(b"{\"datenstand\":2}").is_none());
    }

    #[test]
    fn repo_names_cannot_leave_the_api() {
        for bad in ["", "..", "a/b", "a?b", "a b", "ä"] {
            assert!(check_name(bad).is_err(), "{bad}");
        }
        assert!(check_name("spielstand-elaris").is_ok());
    }
}
