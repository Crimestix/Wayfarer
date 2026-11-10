//! Bilder der Kampagne: Kartenbilder, Porträts und Bilder in Artikeln.
//!
//! Sie liegen als gewöhnliche Dateien im Ordner `media/` des Kampagnenordners – neben den
//! JSON-Dateien der Ablage, aber getrennt von ihnen: Die Ablage liest nur JSON, hier liegen nur
//! Bilder. Die Oberfläche nennt immer nur einen Dateinamen, nie einen Pfad. Geholt wird ein Bild
//! einmal aus dem Netz (etwa von LegendKeeper); danach zeigt Wayfarer es ohne Verbindung an.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use reqwest::{redirect, Client, Url};

use crate::store;

/// Eigenes Adressschema, unter dem das Fenster die Bilder der Kampagne lädt.
pub const SCHEME: &str = "wfmedia";
/// Unterordner des Kampagnenordners, in dem die Bilder liegen.
pub const MEDIA_DIR: &str = "media";
/// Größer ist kein Bild, das Wayfarer anzeigen soll.
const MAX_BYTES: usize = 96 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 120;
const MAX_REDIRECTS: usize = 5;
const TIMEOUT: Duration = Duration::from_secs(180);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "avif"];

/// Zustand der laufenden App: der Client fürs Holen und der Ordner, aus dem angezeigt wird.
#[derive(Default)]
pub struct Media {
    client: Mutex<Option<Client>>,
    root: Mutex<Option<PathBuf>>,
}

impl Media {
    fn client(&self) -> Result<Client, String> {
        let mut slot = self
            .client
            .lock()
            .map_err(|_| "Interner Fehler beim Holen der Bilder.".to_string())?;
        if let Some(client) = slot.as_ref() {
            return Ok(client.clone());
        }
        let client = build_client()?;
        *slot = Some(client.clone());
        Ok(client)
    }

    /// Merkt sich den Kampagnenordner, aus dem das Fenster Bilder anzeigen darf.
    pub fn set_root(&self, root: PathBuf) {
        if let Ok(mut slot) = self.root.lock() {
            *slot = Some(root);
        }
    }

    pub fn root(&self) -> Option<PathBuf> {
        self.root.lock().ok().and_then(|slot| slot.clone())
    }

    /// Holt ein Bild aus dem Netz und legt es unter `name` ab. Liegt es schon da, wird nichts
    /// geholt. Gibt die Größe der Datei zurück.
    pub async fn fetch(&self, root: &str, url: &str, name: &str) -> Result<u64, String> {
        let root = store::check_root(root)?;
        let target = path_of(&root, name)?;
        if let Ok(meta) = fs::metadata(&target) {
            if meta.is_file() && meta.len() > 0 {
                return Ok(meta.len());
            }
        }
        let url = check_url(url)?;
        let bytes = download(&self.client()?, url).await?;
        tauri::async_runtime::spawn_blocking(move || save(&target, &bytes))
            .await
            .map_err(|_| "Ein interner Arbeitsschritt wurde unerwartet abgebrochen.".to_string())?
    }
}

// ── Namen und Adressen ───────────────────────────────────────────────────────

/// Prüft den Namen einer Bilddatei: ein einzelner Name ohne Ordner, nur Buchstaben, Ziffern,
/// Punkt, Binde- und Unterstrich, mit einer Endung für Bilder.
pub fn check_name(name: &str) -> Result<&str, String> {
    let invalid = || format!("Ungültiger Name für ein Bild: „{name}“");
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS || name.starts_with('.') {
        return Err(invalid());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        return Err(invalid());
    }
    let Some((stem, extension)) = name.rsplit_once('.') else {
        return Err(invalid());
    };
    if stem.is_empty()
        || stem.ends_with('.')
        || !EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
    {
        return Err(invalid());
    }
    Ok(name)
}

/// Der Pfad eines Bildes im (bereits geprüften) Kampagnenordner.
pub fn path_of(root: &Path, name: &str) -> Result<PathBuf, String> {
    let name = check_name(name)?;
    let dir = root.join(MEDIA_DIR);
    // Eine Verknüpfung an dieser Stelle könnte aus dem Kampagnenordner hinausführen.
    if fs::symlink_metadata(&dir).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err("Der Ordner für Bilder ist eine Verknüpfung und wird nicht angefasst.".into());
    }
    Ok(dir.join(name))
}

/// Nur verschlüsselte Adressen im offenen Netz: kein „http“, keine Zugangsdaten in der Adresse,
/// keine nackten IP-Adressen und nichts ohne Punkt im Namen (etwa „localhost“).
pub fn check_url(url: &str) -> Result<Url, String> {
    let invalid = || "Diese Adresse ist keine Bildadresse, die Wayfarer holen darf.".to_string();
    let url = Url::parse(url).map_err(|_| invalid())?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err(invalid());
    }
    match url.host() {
        Some(url::Host::Domain(domain))
            if domain.contains('.')
                && !domain.ends_with('.')
                && !domain.to_ascii_lowercase().ends_with(".local") =>
        {
            Ok(url)
        }
        _ => Err(invalid()),
    }
}

// ── Holen und Ablegen ────────────────────────────────────────────────────────

fn build_client() -> Result<Client, String> {
    // Verschlüsselung über rustls mit „ring“; ist bereits ein Anbieter eingerichtet, bleibt er.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let policy = redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            attempt.error("zu viele Weiterleitungen")
        } else if check_url(attempt.url().as_str()).is_ok() {
            attempt.follow()
        } else {
            attempt.error("Weiterleitung auf eine Adresse, die Wayfarer nicht holen darf")
        }
    });
    Client::builder()
        .redirect(policy)
        .timeout(TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .https_only(true)
        .user_agent(concat!("Wayfarer/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|err| format!("Das Holen der Bilder ließ sich nicht vorbereiten: {err}"))
}

fn request_error(err: reqwest::Error) -> String {
    if err.is_timeout() {
        return "Das Bild kam nicht rechtzeitig an. Bitte später erneut versuchen.".into();
    }
    if err.is_connect() {
        return "Der Bildspeicher ist nicht erreichbar. Besteht eine Internetverbindung?".into();
    }
    "Das Bild ließ sich nicht holen.".into()
}

async fn download(client: &Client, url: Url) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "image/*")
        .send()
        .await
        .map_err(request_error)?;
    let status = response.status();
    if status.as_u16() == 404 || status.as_u16() == 410 {
        return Err("Dieses Bild gibt es am Ursprung nicht mehr.".into());
    }
    if !status.is_success() {
        return Err(format!(
            "Der Bildspeicher hat das Bild nicht herausgegeben (Antwort {}).",
            status.as_u16()
        ));
    }
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(request_error)? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("Das Bild ist zu groß und wurde nicht übernommen.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

/// Erkennt am Anfang der Datei, was für ein Bild es ist – unabhängig von der Endung.
pub fn mime_of(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && (&bytes[8..12] == b"avif" || &bytes[8..12] == b"avis")
    {
        Some("image/avif")
    } else {
        None
    }
}

/// Legt ein geholtes Bild ab. Was kein Bild ist, wird nicht gespeichert.
pub fn save(target: &Path, bytes: &[u8]) -> Result<u64, String> {
    if mime_of(bytes).is_none() {
        return Err("Unter dieser Adresse liegt kein Bild.".into());
    }
    store::write_atomic(target, bytes).map_err(|err| format!("Das Bild ließ sich nicht speichern: {err}"))?;
    Ok(bytes.len() as u64)
}

/// Namen aller Bilder, die im Kampagnenordner liegen.
pub fn list(root: &str) -> Result<(PathBuf, Vec<String>), String> {
    let root = store::check_root(root)?;
    let dir = root.join(MEDIA_DIR);
    let mut names = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        // Noch kein Bild geholt: Den Ordner gibt es dann einfach nicht.
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok((root, names)),
        Err(err) => return Err(format!("Der Ordner für Bilder lässt sich nicht lesen: {err}")),
    };
    for entry in entries.flatten() {
        let is_file = entry.file_type().is_ok_and(|kind| kind.is_file());
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if is_file && check_name(name).is_ok() && entry.metadata().is_ok_and(|meta| meta.len() > 0) {
            names.push(name.to_string());
        }
    }
    names.sort();
    Ok((root, names))
}

/// Liest ein Bild für die Anzeige. `None`, wenn es (noch) nicht da ist oder kein Bild ist.
pub fn read(root: &Path, name: &str) -> Option<(Vec<u8>, &'static str)> {
    let path = path_of(root, name).ok()?;
    let meta = fs::symlink_metadata(&path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    let mime = mime_of(&bytes)?;
    Some((bytes, mime))
}

/// Der Name des Bildes aus dem Pfad einer Anfrage („/abc.png“).
pub fn name_from_request_path(path: &str) -> Option<&str> {
    let name = path.strip_prefix('/').unwrap_or(path);
    check_name(name).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n rest";

    #[test]
    fn accepts_only_plain_image_names() {
        for name in [
            "karte.png",
            "0a1b2c3d-0000-4000-8000-00000000abcd.png",
            "a_b.JPG",
            "x.webp",
        ] {
            assert!(check_name(name).is_ok(), "{name}");
        }
        for name in [
            "",
            ".png",
            "karte",
            "karte.json",
            "karte.svg",
            "../karte.png",
            "a/b.png",
            "a\\b.png",
            "karte .png",
            "karte..png",
            "c:karte.png",
            "karte.png.exe",
        ] {
            assert!(check_name(name).is_err(), "{name}");
        }
        assert!(check_name(&format!("{}.png", "a".repeat(200))).is_err());
    }

    #[test]
    fn fetches_only_from_encrypted_public_addresses() {
        assert!(check_url("https://assets.example.org/bild.png").is_ok());
        for url in [
            "http://assets.example.org/bild.png",
            "https://localhost/bild.png",
            "https://127.0.0.1/bild.png",
            "https://[::1]/bild.png",
            "https://nutzer:geheim@assets.example.org/bild.png",
            "https://drucker.local/bild.png",
            "file:///etc/passwd",
            "kein-url",
        ] {
            assert!(check_url(url).is_err(), "{url}");
        }
    }

    #[test]
    fn recognises_images_by_content() {
        assert_eq!(mime_of(PNG), Some("image/png"));
        assert_eq!(mime_of(b"\xff\xd8\xff\xe0 jpeg"), Some("image/jpeg"));
        assert_eq!(mime_of(b"RIFF\x10\x00\x00\x00WEBPVP8 "), Some("image/webp"));
        assert_eq!(mime_of(b"GIF89a..."), Some("image/gif"));
        assert_eq!(mime_of(b"\x00\x00\x00\x1cftypavif...."), Some("image/avif"));
        assert_eq!(mime_of(b"<html>Fehler</html>"), None);
        assert_eq!(mime_of(b""), None);
    }

    #[test]
    fn stores_lists_and_reads_images() {
        let dir = TempDir::new().unwrap();
        let root = store::check_root(dir.path().to_str().unwrap()).unwrap();
        let root_str = root.to_str().unwrap();

        // Ohne Bilder gibt es den Ordner nicht – das ist kein Fehler.
        assert_eq!(list(root_str).unwrap().1, Vec::<String>::new());

        let target = path_of(&root, "karte.png").unwrap();
        assert_eq!(save(&target, PNG), Ok(PNG.len() as u64));
        // Eine Fehlerseite statt eines Bildes wird nicht abgelegt.
        let wrong = path_of(&root, "falsch.png").unwrap();
        assert!(save(&wrong, b"<html>404</html>").is_err());
        assert!(!wrong.exists());
        // Fremde Dateien im Ordner zählen nicht.
        fs::write(root.join(MEDIA_DIR).join("notiz.txt"), "x").unwrap();
        fs::write(root.join(MEDIA_DIR).join("leer.png"), "").unwrap();

        assert_eq!(list(root_str).unwrap().1, vec!["karte.png".to_string()]);
        let (bytes, mime) = read(&root, "karte.png").unwrap();
        assert_eq!((bytes.as_slice(), mime), (PNG, "image/png"));
        assert!(read(&root, "fehlt.png").is_none());
        assert!(read(&root, "../campaign.json").is_none());

        // Die Ablage der Kampagne sieht die Bilder nicht.
        assert_eq!(store::read_all(root_str).unwrap(), vec![]);
    }

    #[test]
    fn reads_the_name_from_a_request_path() {
        assert_eq!(name_from_request_path("/karte.png"), Some("karte.png"));
        assert_eq!(name_from_request_path("karte.png"), Some("karte.png"));
        assert_eq!(name_from_request_path("/a/b.png"), None);
        assert_eq!(name_from_request_path("/..%2Fx.png"), None);
        assert_eq!(name_from_request_path("/"), None);
    }
}
