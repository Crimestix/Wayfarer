//! LegendKeeper: nur lesen. Der API-Key liegt im Schlüsselbund des Betriebssystems und verlässt
//! die Rust-Seite nie; die Oberfläche bekommt nur Antworten der LegendKeeper-API zu sehen.
//!
//! Abgerufen wird ausschließlich per GET von einer fest eingebauten Adresse. Weiterleitungen
//! werden nur innerhalb dieser API verfolgt, damit der Key nirgendwo anders ankommt.

use std::sync::Mutex;
use std::time::Duration;

use reqwest::{redirect, Client, Url};
use serde::Serialize;
use serde_json::Value;

/// Die einzige Adresse, an die der Key je geschickt wird.
pub const API_BASE: &str = "https://www.legendkeeper.com/api/v3";

const KEYRING_SERVICE: &str = "app.wayfarer.desktop";
const KEYRING_ACCOUNT: &str = "LegendKeeper-Key";

const TIMEOUT: Duration = Duration::from_secs(25);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REDIRECTS: usize = 5;
/// Größere Antworten werden abgelehnt, statt den Arbeitsspeicher zu füllen.
const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;
const MAX_KEY_CHARS: usize = 512;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LkStatus {
    pub has_key: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct LkResponse {
    pub status: u16,
    pub body: String,
}

// ── Schlüsselbund ────────────────────────────────────────────────────────────

/// Der Key im Arbeitsspeicher, damit der Schlüsselbund nicht bei jedem Abruf gefragt wird.
/// `None` = noch nicht nachgesehen, `Some(None)` = es ist keiner hinterlegt.
#[derive(Default)]
pub struct KeyCache(Mutex<Option<Option<String>>>);

fn keyring_error(err: keyring::Error) -> String {
    match err {
        keyring::Error::NoStorageAccess(_) => {
            "Der Schlüsselbund des Systems ist gesperrt oder hat den Zugriff verweigert.".into()
        }
        keyring::Error::NoDefaultStore => "Auf diesem System steht kein Schlüsselbund zur Verfügung.".into(),
        other => format!("Der Schlüsselbund des Systems meldet einen Fehler: {other}"),
    }
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(keyring_error)
}

impl KeyCache {
    /// Der hinterlegte Key, falls es einen gibt.
    pub fn get(&self) -> Result<Option<String>, String> {
        let mut cached = self
            .0
            .lock()
            .map_err(|_| "Interner Fehler im Schlüsselbund-Zugriff.".to_string())?;
        if let Some(known) = cached.as_ref() {
            return Ok(known.clone());
        }
        let found = match entry()?.get_password() {
            Ok(key) => Some(key),
            Err(keyring::Error::NoEntry) => None,
            Err(err) => return Err(keyring_error(err)),
        };
        *cached = Some(found.clone());
        Ok(found)
    }

    pub fn set(&self, key: &str) -> Result<(), String> {
        let key = check_key(key)?;
        entry()?.set_password(&key).map_err(keyring_error)?;
        if let Ok(mut cached) = self.0.lock() {
            *cached = Some(Some(key));
        }
        Ok(())
    }

    pub fn clear(&self) -> Result<(), String> {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(err) => return Err(keyring_error(err)),
        }
        if let Ok(mut cached) = self.0.lock() {
            *cached = Some(None);
        }
        Ok(())
    }
}

/// Bereinigt einen eingegebenen Key und lehnt ab, was nicht in eine Kopfzeile gehört.
pub fn check_key(key: &str) -> Result<String, String> {
    let key = key.trim();
    let key = key.strip_prefix("Bearer ").unwrap_or(key).trim();
    if key.is_empty() {
        return Err("Bitte den LegendKeeper-Key eingeben.".into());
    }
    if key.chars().count() > MAX_KEY_CHARS || !key.chars().all(|c| c.is_ascii_graphic()) {
        return Err(
            "Das sieht nicht nach einem LegendKeeper-Key aus (Leerzeichen oder Sonderzeichen enthalten)."
                .into(),
        );
    }
    Ok(key.to_string())
}

// ── Adresse ──────────────────────────────────────────────────────────────────

/// Liegt die Adresse innerhalb der API (gleiche Herkunft, Pfad unterhalb der Basis, keine Zugangsdaten)?
pub fn within_api(base: &Url, url: &Url) -> bool {
    url.scheme() == base.scheme()
        && url.host_str() == base.host_str()
        && url.port_or_known_default() == base.port_or_known_default()
        && url.username().is_empty()
        && url.password().is_none()
        && url
            .path()
            .starts_with(&format!("{}/", base.path().trim_end_matches('/')))
}

fn append_query_value(pairs: &mut Vec<(String, String)>, name: &str, value: &Value) -> Result<(), String> {
    match value {
        Value::Null => {}
        Value::String(text) => pairs.push((name.to_string(), text.clone())),
        Value::Number(number) => pairs.push((name.to_string(), number.to_string())),
        Value::Bool(flag) => pairs.push((name.to_string(), flag.to_string())),
        Value::Array(items) => {
            for item in items {
                if item.is_array() || item.is_object() {
                    return Err(format!("Ungültiger Abfragewert für „{name}“."));
                }
                append_query_value(pairs, name, item)?;
            }
        }
        Value::Object(_) => return Err(format!("Ungültiger Abfragewert für „{name}“.")),
    }
    Ok(())
}

/// Abfrageparameter aus dem, was die Oberfläche mitgibt: ein Objekt (Name → Wert), eine
/// fertige Abfragezeile („limit=100&cursor=…“) oder nichts.
fn query_pairs(query: Option<&Value>) -> Result<Vec<(String, String)>, String> {
    let mut pairs = Vec::new();
    match query {
        None | Some(Value::Null) => {}
        Some(Value::Object(map)) => {
            for (name, value) in map {
                append_query_value(&mut pairs, name, value)?;
            }
        }
        Some(Value::String(line)) => {
            let line = line.trim_start_matches('?');
            pairs.extend(url::form_urlencoded::parse(line.as_bytes()).into_owned());
        }
        Some(_) => return Err("Ungültige Abfrageparameter für LegendKeeper.".into()),
    }
    Ok(pairs)
}

/// Baut die Adresse eines Abrufs. `path` ist ein Pfad innerhalb der API („/projects“),
/// nie eine vollständige Adresse.
pub fn api_url(base: &Url, path: &str, query: Option<&Value>) -> Result<Url, String> {
    let invalid = || format!("Ungültiger LegendKeeper-Pfad: „{path}“");
    if !path.starts_with('/')
        || path.starts_with("//")
        || path.contains("://")
        || path.contains('\\')
        || path.contains('#')
        || path.contains('@')
        || path.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err(invalid());
    }
    // Ein „?…“ im Pfad wird wie mitgegebene Abfrageparameter behandelt.
    let (path_only, inline_query) = match path.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (path, None),
    };
    if path_only.split('/').any(|segment| {
        let decoded = segment.to_ascii_lowercase().replace("%2e", ".");
        decoded == "." || decoded == ".." || decoded.contains("%2f") || decoded.contains("%5c")
    }) {
        return Err(invalid());
    }
    let mut url = Url::parse(&format!("{}{}", base.as_str().trim_end_matches('/'), path_only))
        .map_err(|_| invalid())?;
    let mut pairs = Vec::new();
    if let Some(inline) = inline_query {
        pairs.extend(url::form_urlencoded::parse(inline.as_bytes()).into_owned());
    }
    pairs.extend(query_pairs(query)?);
    if !pairs.is_empty() {
        url.query_pairs_mut().extend_pairs(pairs);
    }
    if !within_api(base, &url) {
        return Err(invalid());
    }
    Ok(url)
}

// ── Abruf ────────────────────────────────────────────────────────────────────

fn outside_api_message() -> &'static str {
    "LegendKeeper leitet auf eine Adresse außerhalb seiner API weiter. Der Key wurde nicht weitergegeben."
}

/// Der HTTP-Client für LegendKeeper. `base` ist außerhalb von Tests immer [`API_BASE`].
pub fn build_client(base: &Url) -> Result<Client, String> {
    // Verschlüsselung über rustls mit „ring“ – ohne OpenSSL und ohne Zusatzwerkzeuge beim Bau.
    // Ist bereits ein Anbieter eingerichtet, bleibt er bestehen.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let api = base.clone();
    let policy = redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            attempt.error("zu viele Weiterleitungen")
        } else if within_api(&api, attempt.url()) {
            attempt.follow()
        } else {
            attempt.error(outside_api_message())
        }
    });
    let mut builder = Client::builder()
        .redirect(policy)
        .timeout(TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .https_only(base.scheme() == "https")
        .user_agent(concat!("Wayfarer/", env!("CARGO_PKG_VERSION")));
    if base.scheme() != "https" {
        // Nur in Tests: der lokale Gegenpart soll nie über einen Proxy angesprochen werden.
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|err| format!("Die Verbindung zu LegendKeeper ließ sich nicht vorbereiten: {err}"))
}

fn request_error(err: reqwest::Error) -> String {
    if err.is_redirect() {
        return outside_api_message().to_string();
    }
    if err.is_timeout() {
        return "LegendKeeper hat nicht rechtzeitig geantwortet. Bitte später erneut versuchen.".into();
    }
    if err.is_connect() {
        return "LegendKeeper ist nicht erreichbar. Besteht eine Internetverbindung?".into();
    }
    "Die Verbindung zu LegendKeeper ist fehlgeschlagen. Der Key bleibt gespeichert; bitte erneut versuchen."
        .into()
}

/// Ein GET auf die API. Jede Antwort – auch 401 oder 404 – wird mit Status und Text zurückgegeben;
/// ein Fehler bedeutet, dass gar keine Antwort der API zustande kam.
pub async fn fetch(
    client: &Client,
    base: &Url,
    key: &str,
    path: &str,
    query: Option<&Value>,
) -> Result<LkResponse, String> {
    let url = api_url(base, path, query)?;
    let mut response = client
        .get(url)
        .bearer_auth(key)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(request_error)?;
    let status = response.status().as_u16();
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(request_error)? {
        if bytes.len() + chunk.len() > MAX_BODY_BYTES {
            return Err("Die Antwort von LegendKeeper ist unerwartet groß und wurde verworfen.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(LkResponse {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// Client und Schlüssel der laufenden App.
pub struct LegendKeeper {
    pub keys: KeyCache,
    base: Url,
    client: Mutex<Option<Client>>,
}

impl Default for LegendKeeper {
    fn default() -> Self {
        Self {
            keys: KeyCache::default(),
            base: Url::parse(API_BASE).expect("feste Adresse"),
            client: Mutex::new(None),
        }
    }
}

impl LegendKeeper {
    fn client(&self) -> Result<Client, String> {
        let mut slot = self
            .client
            .lock()
            .map_err(|_| "Interner Fehler beim LegendKeeper-Abruf.".to_string())?;
        if let Some(client) = slot.as_ref() {
            return Ok(client.clone());
        }
        let client = build_client(&self.base)?;
        *slot = Some(client.clone());
        Ok(client)
    }

    pub async fn get(&self, key: &str, path: &str, query: Option<&Value>) -> Result<LkResponse, String> {
        let client = self.client()?;
        fetch(&client, &self.base, key, path, query).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    fn base() -> Url {
        Url::parse(API_BASE).unwrap()
    }

    #[test]
    fn builds_urls_only_inside_the_api() {
        let url = api_url(&base(), "/projects", None).unwrap();
        assert_eq!(url.as_str(), "https://www.legendkeeper.com/api/v3/projects");
        let url = api_url(
            &base(),
            "/projects/p1/resources",
            Some(&json!({ "limit": 100, "cursor": "a b&c", "skip": null })),
        )
        .unwrap();
        assert_eq!(
            url.as_str(),
            "https://www.legendkeeper.com/api/v3/projects/p1/resources?cursor=a+b%26c&limit=100"
        );
        let url = api_url(&base(), "/projects?limit=2", Some(&json!("cursor=x"))).unwrap();
        assert_eq!(
            url.as_str(),
            "https://www.legendkeeper.com/api/v3/projects?limit=2&cursor=x"
        );
        let url = api_url(&base(), "/tags", Some(&json!({ "id": ["a", "b"], "deep": true }))).unwrap();
        assert_eq!(url.query(), Some("deep=true&id=a&id=b"));
    }

    #[test]
    fn rejects_paths_with_scheme_host_or_escape() {
        for path in [
            "",
            "projects",
            "https://evil.test/api/v3/projects",
            "//evil.test/api/v3/projects",
            "/https://evil.test",
            "/../../account",
            "/projects/../../../admin",
            "/projects/%2e%2e/%2E%2E/admin",
            "/projects/./x",
            "/projects/..%2f..%2fadmin",
            "/projects\\..\\admin",
            "/@evil.test/x",
            "/projects#frag",
            "/projects with space",
            "/projects\n/x",
        ] {
            assert!(
                api_url(&base(), path, None).is_err(),
                "{path:?} hätte abgelehnt werden müssen"
            );
        }
        assert!(api_url(&base(), "/x", Some(&json!(5))).is_err());
        assert!(api_url(&base(), "/x", Some(&json!({ "a": { "b": 1 } }))).is_err());
    }

    #[test]
    fn redirect_targets_must_stay_inside_the_api() {
        let api = base();
        let inside = |s: &str| within_api(&api, &Url::parse(s).unwrap());
        assert!(inside("https://www.legendkeeper.com/api/v3/projects/p1"));
        assert!(!inside("https://www.legendkeeper.com/api/v3"));
        assert!(!inside("https://www.legendkeeper.com/api/v30/projects"));
        assert!(!inside("https://www.legendkeeper.com/login"));
        assert!(!inside("http://www.legendkeeper.com/api/v3/projects"));
        assert!(!inside("https://legendkeeper.com/api/v3/projects"));
        assert!(!inside("https://www.legendkeeper.com.evil.test/api/v3/projects"));
        assert!(!inside("https://www.legendkeeper.com:8443/api/v3/projects"));
        assert!(!inside("https://user:pw@www.legendkeeper.com/api/v3/projects"));
    }

    #[test]
    fn cleans_and_checks_keys() {
        assert_eq!(check_key("  lk_abc-123.DEF  ").unwrap(), "lk_abc-123.DEF");
        assert_eq!(check_key("Bearer lk_abc").unwrap(), "lk_abc");
        assert!(check_key("").is_err());
        assert!(check_key("   ").is_err());
        assert!(check_key("lk abc").is_err());
        assert!(check_key("lk\nabc").is_err());
        assert!(check_key("schlüssel").is_err());
        assert!(check_key(&"x".repeat(600)).is_err());
    }

    #[test]
    fn status_and_response_use_the_agreed_field_names() {
        assert_eq!(
            serde_json::to_string(&LkStatus { has_key: true }).unwrap(),
            "{\"hasKey\":true}"
        );
        assert_eq!(
            serde_json::to_string(&LkResponse {
                status: 200,
                body: "{}".into()
            })
            .unwrap(),
            "{\"status\":200,\"body\":\"{}\"}"
        );
    }

    /// Ein winziger Gegenpart auf diesem Rechner: beantwortet jede Anfrage nach Vorgabe und
    /// gibt die empfangenen Kopfzeilen weiter.
    fn serve(respond: impl Fn(&str) -> String + Send + 'static) -> (Url, mpsc::Receiver<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut lines = Vec::new();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    lines.push(line.trim_end().to_string());
                }
                let reply = respond(lines.first().map(String::as_str).unwrap_or(""));
                let _ = stream.write_all(reply.as_bytes());
                if tx.send(lines).is_err() {
                    break;
                }
            }
        });
        (
            Url::parse(&format!("http://127.0.0.1:{port}/api/v3")).unwrap(),
            rx,
        )
    }

    fn reply(status: &str, extra: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",
            body.len()
        )
    }

    fn run<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn sends_a_get_with_the_key_and_returns_status_and_body() {
        let (base, seen) = serve(|_| {
            reply(
                "200 OK",
                "Content-Type: application/json\r\n",
                "{\"data\":[\"Elaris\"]}",
            )
        });
        let client = build_client(&base).unwrap();
        let response = run(fetch(
            &client,
            &base,
            "geheim-123",
            "/projects",
            Some(&json!({ "limit": 2 })),
        ))
        .unwrap();
        assert_eq!(
            response,
            LkResponse {
                status: 200,
                body: "{\"data\":[\"Elaris\"]}".into()
            }
        );
        let request = seen.recv().unwrap();
        assert_eq!(request[0], "GET /api/v3/projects?limit=2 HTTP/1.1");
        let lower: Vec<String> = request.iter().map(|l| l.to_ascii_lowercase()).collect();
        assert!(
            lower.contains(&"authorization: bearer geheim-123".to_string()),
            "{request:?}"
        );
        assert!(lower.contains(&"accept: application/json".to_string()));
    }

    #[test]
    fn passes_error_statuses_through_instead_of_failing() {
        let (base, _seen) = serve(|_| reply("401 Unauthorized", "", "{\"error\":\"invalid key\"}"));
        let client = build_client(&base).unwrap();
        let response = run(fetch(&client, &base, "falsch", "/projects", None)).unwrap();
        assert_eq!(response.status, 401);
        assert_eq!(response.body, "{\"error\":\"invalid key\"}");
    }

    #[test]
    fn follows_redirects_inside_the_api_only() {
        let (base, seen) = serve(|request_line| {
            if request_line.contains("/alt") {
                reply("302 Found", "Location: /api/v3/neu\r\n", "")
            } else {
                reply("200 OK", "", "angekommen")
            }
        });
        let client = build_client(&base).unwrap();
        let response = run(fetch(&client, &base, "k", "/alt", None)).unwrap();
        assert_eq!(response.body, "angekommen");
        assert_eq!(seen.recv().unwrap()[0], "GET /api/v3/alt HTTP/1.1");
        assert_eq!(seen.recv().unwrap()[0], "GET /api/v3/neu HTTP/1.1");
    }

    #[test]
    fn refuses_redirects_that_leave_the_api() {
        // Der zweite Gegenpart steht für eine fremde Adresse; er darf nie eine Anfrage sehen.
        let (foreign, foreign_seen) = serve(|_| reply("200 OK", "", "fremd"));
        let target = format!("Location: {}/x\r\n", foreign.as_str());
        let (base, _seen) = serve(move |request_line| {
            if request_line.contains("/raus") {
                reply("302 Found", &target, "")
            } else {
                reply("302 Found", "Location: /login\r\n", "")
            }
        });
        let client = build_client(&base).unwrap();
        for path in ["/raus", "/intern"] {
            let err = run(fetch(&client, &base, "geheim", path, None)).unwrap_err();
            assert!(err.contains("außerhalb seiner API"), "{err}");
            assert!(!err.contains("geheim"));
        }
        assert!(
            foreign_seen.try_recv().is_err(),
            "die fremde Adresse wurde angesprochen"
        );
    }

    #[test]
    fn reports_unreachable_service_in_plain_words() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let base = Url::parse(&format!("http://127.0.0.1:{port}/api/v3")).unwrap();
        let client = build_client(&base).unwrap();
        let err = run(fetch(&client, &base, "geheim", "/projects", None)).unwrap_err();
        assert!(err.contains("nicht erreichbar"), "{err}");
    }
}
