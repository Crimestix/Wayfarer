//! Abgleich: die Anfragen an GitHub (Entwurf, Abschnitt 3.2). Je Anfrage eine Funktion; die
//! Antworten werden hier eingeordnet (`classify`) – die Oberfläche erkennt die Art eines Fehlers
//! nie am Wortlaut. Weder der Zugangsschlüssel noch die Kurzzeit-Adresse eines Archivs stehen je
//! in einer Meldung.
//!
//! Keine Weiterleitungen: Ein 301/307/308 von der Schnittstelle heißt „umbenannt oder gelöscht?“.

use std::collections::BTreeMap;
use std::time::Duration;

use reqwest::header::{HeaderMap, ACCEPT, AUTHORIZATION, LOCATION};
use reqwest::{redirect, Client, Method, Url};
use serde_json::{json, Value};

use super::SyncError;

pub const API_BASE: &str = "https://api.github.com";
pub const API_VERSION: &str = "2026-03-10";
const TIMEOUT: Duration = Duration::from_secs(30);
const ARCHIVE_TIMEOUT: Duration = Duration::from_secs(300);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Obergrenzen beim Lesen.
pub const MAX_JSON: usize = 16 * 1024 * 1024;
pub const MAX_BLOB: usize = 16 * 1024 * 1024;
pub const MAX_ARCHIVE: usize = 512 * 1024 * 1024;
/// Inhalt der README, mit der eine leere Ablage eröffnet wird (Base64 einer festen Zeile).
const README_B64: &str =
    "IyBTcGllbHN0YW5kCgpIaWVyIGxlZ3QgV2F5ZmFyZXIgZGVuIFNwaWVsc3RhbmQgYWIuIEJpdHRlIG5pY2h0cyB2b24gSGFuZCDDpG5kZXJuLgo=";

/// Wer fragt und wohin.
pub struct Api {
    pub client: Client,
    /// Ohne Schlüssel – nur für die Kurzzeit-Adresse eines Archivs.
    pub plain: Client,
    pub base: Url,
    pub key: String,
    pub owner: String,
    pub repo: String,
    pub branch: String,
}

pub fn build_clients(base: &Url) -> Result<(Client, Client), SyncError> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let make = |timeout: Duration| {
        let mut builder = Client::builder()
            .redirect(redirect::Policy::none())
            .timeout(timeout)
            .connect_timeout(CONNECT_TIMEOUT)
            .https_only(base.scheme() == "https")
            .user_agent(concat!("Wayfarer/", env!("CARGO_PKG_VERSION")));
        if base.scheme() != "https" {
            // Nur in Tests: der Gegenpart auf diesem Rechner, nie über einen Proxy.
            builder = builder.no_proxy();
        }
        builder
            .build()
            .map_err(|_| SyncError::new("local", "Die Verbindung zu GitHub ließ sich nicht vorbereiten."))
    };
    Ok((make(TIMEOUT)?, make(ARCHIVE_TIMEOUT)?))
}

/// Ordnet einen Übertragungsfehler ein – ohne Adresse.
fn transport(err: &reqwest::Error) -> SyncError {
    if err.is_timeout() || err.is_connect() || err.is_request() || err.is_body() {
        SyncError::new("offline", "GitHub ist gerade nicht erreichbar.")
    } else {
        SyncError::new("server", "Die Verbindung zu GitHub ist fehlgeschlagen.")
    }
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Die Art eines Fehlers aus GitHubs Antwort (Entwurf 4.5).
pub fn classify(status: u16, headers: &HeaderMap, body: &str) -> SyncError {
    match status {
        401 => SyncError::new(
            "key",
            "GitHub nimmt den Zugangsschlüssel nicht an – er wurde gelöscht oder ist abgelaufen.",
        ),
        403 | 429 => {
            let retry = header(headers, "retry-after")
                .and_then(|v| v.trim().parse::<u64>().ok())
                .or_else(|| {
                    let reset = header(headers, "x-ratelimit-reset")?.trim().parse::<u64>().ok()?;
                    (header(headers, "x-ratelimit-remaining") == Some("0"))
                        .then(|| reset.saturating_sub(now_secs()))
                });
            let exhausted = header(headers, "x-ratelimit-remaining") == Some("0");
            let says = body.to_ascii_lowercase().contains("rate limit");
            if status == 429 || retry.is_some() || exhausted || says {
                SyncError {
                    kind: "limit",
                    message: "GitHub bittet um eine Pause.".into(),
                    retry_after: Some(retry.unwrap_or(60).max(60)),
                }
            } else {
                SyncError::new(
                    "denied",
                    "Der Zugangsschlüssel darf in diese Ablage nicht schreiben.",
                )
            }
        }
        404 | 301 | 302 | 307 | 308 => SyncError::new(
            "missing",
            "Wayfarer findet die Ablage nicht mehr. Wurde sie umbenannt oder gelöscht?",
        ),
        _ => SyncError::new("server", "GitHub antwortet gerade unerwartet."),
    }
}

/// Eine Antwort: Status, Kopfzeilen, Inhalt.
pub struct Reply {
    pub status: u16,
    pub headers: HeaderMap,
    pub body: Vec<u8>,
}

impl Reply {
    fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }
    fn json(&self) -> Result<Value, SyncError> {
        serde_json::from_slice(&self.body)
            .map_err(|_| SyncError::new("server", "GitHub antwortet gerade unerwartet."))
    }
    fn fail(&self) -> SyncError {
        classify(self.status, &self.headers, &String::from_utf8_lossy(&self.body))
    }
}

async fn read_body(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>, SyncError> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| transport(&e))? {
        if bytes.len() + chunk.len() > limit {
            return Err(SyncError::new(
                "server",
                "Die Antwort von GitHub ist unerwartet groß.",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

impl Api {
    fn url(&self, path: &str) -> Result<Url, SyncError> {
        Url::parse(&format!("{}{}", self.base.as_str().trim_end_matches('/'), path))
            .map_err(|_| SyncError::new("input", "Ungültiger Name der Ablage."))
    }

    fn repo_path(&self, rest: &str) -> String {
        format!("/repos/{}/{}{}", self.owner, self.repo, rest)
    }

    /// Eine Anfrage mit Schlüssel und den festen Kopfzeilen.
    pub async fn call(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
        accept: &str,
        limit: usize,
    ) -> Result<Reply, SyncError> {
        let mut request = self
            .client
            .request(method, self.url(path)?)
            .header(AUTHORIZATION, format!("Bearer {}", self.key))
            .header(ACCEPT, accept)
            .header("X-GitHub-Api-Version", API_VERSION);
        if let Some(body) = body {
            let bytes = serde_json::to_vec(body)
                .map_err(|_| SyncError::new("local", "Interner Fehler beim Hochladen."))?;
            request = request
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(bytes);
        }
        let response = request.send().await.map_err(|e| transport(&e))?;
        let status = response.status().as_u16();
        let headers = response.headers().clone();
        let body = read_body(response, limit).await?;
        Ok(Reply {
            status,
            headers,
            body,
        })
    }

    async fn get_json(&self, path: &str) -> Result<Value, SyncError> {
        let reply = self
            .call(Method::GET, path, None, "application/vnd.github+json", MAX_JSON)
            .await?;
        if !reply.ok() {
            return Err(reply.fail());
        }
        reply.json()
    }

    // ── Lesen ────────────────────────────────────────────────────────────────

    pub async fn user(&self) -> Result<String, SyncError> {
        let value = self.get_json("/user").await?;
        value["login"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| SyncError::new("server", "GitHub antwortet gerade unerwartet."))
    }

    /// Angaben zur Ablage: privat, darf schreiben, archiviert, gesperrt, Hauptzweig.
    pub async fn repo_info(&self) -> Result<Value, SyncError> {
        self.get_json(&self.repo_path("")).await
    }

    pub async fn user_repos(&self) -> Result<Vec<Value>, SyncError> {
        let value = self.get_json("/user/repos?per_page=100").await?;
        Ok(value.as_array().cloned().unwrap_or_default())
    }

    /// Kopf des Zweigs; `None` = die Ablage ist leer (409).
    pub async fn head(&self) -> Result<Option<String>, SyncError> {
        let reply = self
            .call(
                Method::GET,
                &self.repo_path(&format!("/git/ref/heads/{}", self.branch)),
                None,
                "application/vnd.github+json",
                MAX_JSON,
            )
            .await?;
        if reply.status == 409 {
            return Ok(None);
        }
        if !reply.ok() {
            return Err(reply.fail());
        }
        let value = reply.json()?;
        value["object"]["sha"]
            .as_str()
            .map(|s| Some(s.to_string()))
            .ok_or_else(|| SyncError::new("server", "GitHub antwortet gerade unerwartet."))
    }

    /// Baut `head` auf `seen` auf? (`ahead`/`identical` → ja; sonst oder 404 → nein)
    pub async fn builds_on(&self, seen: &str, head: &str) -> Result<bool, SyncError> {
        let reply = self
            .call(
                Method::GET,
                &self.repo_path(&format!("/compare/{seen}...{head}")),
                None,
                "application/vnd.github+json",
                MAX_JSON,
            )
            .await?;
        if reply.status == 404 {
            return Ok(false);
        }
        if !reply.ok() {
            return Err(reply.fail());
        }
        let status = reply.json()?["status"].as_str().unwrap_or("").to_string();
        Ok(status == "ahead" || status == "identical")
    }

    /// Commit: Baum, Nachricht, Zeit.
    pub async fn commit(&self, sha: &str) -> Result<(String, String, Option<String>), SyncError> {
        let value = self
            .get_json(&self.repo_path(&format!("/git/commits/{sha}")))
            .await?;
        let tree = value["tree"]["sha"]
            .as_str()
            .ok_or_else(|| SyncError::new("server", "GitHub antwortet gerade unerwartet."))?
            .to_string();
        Ok((
            tree,
            value["message"].as_str().unwrap_or("").to_string(),
            value["committer"]["date"].as_str().map(str::to_string),
        ))
    }

    /// Alle Dateien eines Baums (Pfad → Kennung). Bei `truncated` je Ordner.
    pub async fn tree(&self, sha: &str) -> Result<BTreeMap<String, String>, SyncError> {
        let value = self
            .get_json(&self.repo_path(&format!("/git/trees/{sha}?recursive=1")))
            .await?;
        if value["truncated"].as_bool() != Some(true) {
            let mut files = BTreeMap::new();
            for entry in value["tree"].as_array().into_iter().flatten() {
                if entry["type"] == "blob" {
                    if let (Some(path), Some(sha)) = (entry["path"].as_str(), entry["sha"].as_str()) {
                        files.insert(path.to_string(), sha.to_string());
                    }
                }
            }
            return Ok(files);
        }
        let mut files = BTreeMap::new();
        let mut queue = vec![(String::new(), sha.to_string())];
        while let Some((prefix, sha)) = queue.pop() {
            let value = self
                .get_json(&self.repo_path(&format!("/git/trees/{sha}")))
                .await?;
            for entry in value["tree"].as_array().into_iter().flatten() {
                let (Some(path), Some(sha)) = (entry["path"].as_str(), entry["sha"].as_str()) else {
                    continue;
                };
                let full = format!("{prefix}{path}");
                match entry["type"].as_str() {
                    Some("blob") => {
                        files.insert(full, sha.to_string());
                    }
                    Some("tree") => queue.push((format!("{full}/"), sha.to_string())),
                    _ => {}
                }
            }
        }
        Ok(files)
    }

    /// Rohe Bytes einer Datei (auch alte Fassungen).
    pub async fn blob(&self, sha: &str) -> Result<Vec<u8>, SyncError> {
        let reply = self
            .call(
                Method::GET,
                &self.repo_path(&format!("/git/blobs/{sha}")),
                None,
                "application/vnd.github.raw+json",
                MAX_BLOB,
            )
            .await?;
        if !reply.ok() {
            return Err(reply.fail());
        }
        Ok(reply.body)
    }

    /// Das Archiv eines Commits: Umleitung lesen, prüfen, ohne Schlüssel abrufen.
    pub async fn tarball(&self, commit: &str) -> Result<Vec<u8>, SyncError> {
        let reply = self
            .call(
                Method::GET,
                &self.repo_path(&format!("/tarball/{commit}")),
                None,
                "application/vnd.github+json",
                MAX_JSON,
            )
            .await?;
        if reply.status != 302 {
            return Err(if reply.ok() {
                SyncError::new("server", "GitHub antwortet gerade unerwartet.")
            } else {
                reply.fail()
            });
        }
        let location = header(&reply.headers, LOCATION.as_str())
            .and_then(|l| Url::parse(l).ok())
            .filter(|l| archive_allowed(&self.base, l))
            .ok_or_else(|| {
                SyncError::new("server", "GitHub leitet das Archiv an eine unerwartete Stelle.")
            })?;
        let response = self
            .plain
            .get(location)
            .send()
            .await
            // Nie die Adresse in der Meldung – sie enthält einen Kurzzeit-Zugang.
            .map_err(|e| transport(&e.without_url()))?;
        if !response.status().is_success() {
            return Err(SyncError::new(
                "server",
                "Das Archiv der Ablage ließ sich nicht holen.",
            ));
        }
        read_body(response, MAX_ARCHIVE).await
    }

    // ── Schreiben ────────────────────────────────────────────────────────────

    /// Eröffnet eine leere Ablage mit einer README. Ergebnis: (Commit, Baum).
    pub async fn put_readme(&self) -> Result<(String, String), SyncError> {
        let body =
            json!({ "message": "Wayfarer: Ablage für den Spielstand eröffnet", "content": README_B64 });
        let reply = self
            .call(
                Method::PUT,
                &self.repo_path("/contents/README.md"),
                Some(&body),
                "application/vnd.github+json",
                MAX_JSON,
            )
            .await?;
        if !reply.ok() {
            return Err(reply.fail());
        }
        let value = reply.json()?;
        match (
            value["commit"]["sha"].as_str(),
            value["commit"]["tree"]["sha"].as_str(),
        ) {
            (Some(c), Some(t)) => Ok((c.to_string(), t.to_string())),
            _ => Err(SyncError::new("server", "GitHub antwortet gerade unerwartet.")),
        }
    }

    /// Ein Paket für einen Baum; Ergebnis: Kennung des neuen Baums.
    pub async fn post_tree(
        &self,
        base_tree: Option<&str>,
        entries: &[Value],
    ) -> Result<Result<String, Box<Reply>>, SyncError> {
        let mut body = json!({ "tree": entries });
        if let Some(base) = base_tree {
            body["base_tree"] = json!(base);
        }
        let reply = self
            .call(
                Method::POST,
                &self.repo_path("/git/trees"),
                Some(&body),
                "application/vnd.github+json",
                MAX_JSON,
            )
            .await?;
        if !reply.ok() {
            return Ok(Err(Box::new(reply)));
        }
        let value = reply.json()?;
        value["sha"]
            .as_str()
            .map(|s| Ok(s.to_string()))
            .ok_or_else(|| SyncError::new("server", "GitHub antwortet gerade unerwartet."))
    }

    pub async fn post_commit(&self, message: &str, tree: &str, parent: &str) -> Result<String, SyncError> {
        let body = json!({ "message": message, "tree": tree, "parents": [parent] });
        let reply = self
            .call(
                Method::POST,
                &self.repo_path("/git/commits"),
                Some(&body),
                "application/vnd.github+json",
                MAX_JSON,
            )
            .await?;
        if !reply.ok() {
            return Err(reply.fail());
        }
        reply.json()?["sha"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| SyncError::new("server", "GitHub antwortet gerade unerwartet."))
    }

    /// Der einzige Umschaltpunkt – nie mit `force`. 422/409 = der Zweig ist weitergewandert.
    pub async fn switch(&self, sha: &str) -> Result<(), SyncError> {
        let body = json!({ "sha": sha, "force": false });
        let reply = self
            .call(
                Method::PATCH,
                &self.repo_path(&format!("/git/refs/heads/{}", self.branch)),
                Some(&body),
                "application/vnd.github+json",
                MAX_JSON,
            )
            .await?;
        match reply.status {
            200..=299 => Ok(()),
            409 | 422 => Err(SyncError::new("moved", "Der andere Rechner war schneller.")),
            _ => Err(reply.fail()),
        }
    }
}

/// Darf das Archiv von dort geholt werden? Nur https und Rechner von GitHub – in Tests derselbe
/// Gegenpart wie die Schnittstelle.
pub fn archive_allowed(base: &Url, location: &Url) -> bool {
    if base.scheme() != "https" {
        return location.scheme() == base.scheme() && location.host_str() == base.host_str();
    }
    location.scheme() == "https"
        && location.username().is_empty()
        && location.host_str().is_some_and(|host| {
            host == "github.com" || host.ends_with(".github.com") || host.ends_with(".githubusercontent.com")
        })
}

/// Der Name des Rechners aus der Nachricht eines Commits („Wayfarer (MacBook): …“).
pub fn device_of(message: &str) -> Option<String> {
    let rest = message.strip_prefix("Wayfarer (")?;
    let end = rest.find("):")?;
    Some(rest[..end].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (k, v) in pairs {
            map.insert(*k, HeaderValue::from_str(v).unwrap());
        }
        map
    }

    #[test]
    fn classifies_every_answer() {
        let none = HeaderMap::new();
        assert_eq!(classify(401, &none, "").kind, "key");
        assert_eq!(
            classify(403, &none, "Resource not accessible by personal access token").kind,
            "denied"
        );
        assert_eq!(
            classify(
                403,
                &headers(&[("x-accepted-github-permissions", "contents=write")]),
                ""
            )
            .kind,
            "denied"
        );
        let limited = classify(403, &headers(&[("retry-after", "120")]), "");
        assert_eq!((limited.kind, limited.retry_after), ("limit", Some(120)));
        assert_eq!(classify(403, &none, "API rate limit exceeded").kind, "limit");
        assert_eq!(
            classify(403, &none, "API rate limit exceeded").retry_after,
            Some(60)
        );
        assert_eq!(classify(429, &none, "").kind, "limit");
        assert_eq!(
            classify(
                403,
                &headers(&[("x-ratelimit-remaining", "0"), ("x-ratelimit-reset", "1")]),
                ""
            )
            .kind,
            "limit"
        );
        for status in [404, 301, 307, 308] {
            assert_eq!(classify(status, &none, "").kind, "missing", "{status}");
        }
        for status in [500, 502, 503, 410, 409, 418] {
            assert_eq!(classify(status, &none, "").kind, "server", "{status}");
        }
    }

    #[test]
    fn archives_only_from_github_hosts() {
        let base = Url::parse(API_BASE).unwrap();
        let ok = |s: &str| archive_allowed(&base, &Url::parse(s).unwrap());
        assert!(ok("https://codeload.github.com/o/r/legacy.tar.gz/x?token=1"));
        assert!(ok("https://objects.githubusercontent.com/x"));
        assert!(!ok("http://codeload.github.com/x"));
        assert!(!ok("https://github.com.evil.test/x"));
        assert!(!ok("https://user@codeload.github.com/x"));
    }

    #[test]
    fn reads_the_device_from_the_message() {
        assert_eq!(
            device_of("Wayfarer (MacBook): 3 geändert").as_deref(),
            Some("MacBook")
        );
        assert_eq!(device_of("Initial commit"), None);
    }
}
