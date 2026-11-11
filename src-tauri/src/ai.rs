//! KI-Leser: Wayfarer schickt den Text eines Artikels an Claude und bekommt Vorschläge zurück.
//! Der API-Key liegt im Schlüsselbund des Betriebssystems und verlässt die Rust-Seite nie.
//!
//! Gesendet wird ausschließlich per POST an eine fest eingebaute Adresse; Weiterleitungen werden
//! nicht verfolgt, damit der Key nirgendwo anders ankommt. Die Oberfläche gibt nur an, welches
//! Modell lesen soll und was es lesen soll – die Anfrage selbst baut diese Seite.

use std::sync::Mutex;
use std::time::Duration;

use reqwest::{redirect, Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Die einzige Adresse, an die der Key je geschickt wird.
pub const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2026-10-21";

const KEYRING_SERVICE: &str = "app.wayfarer.desktop";
const KEYRING_ACCOUNT: &str = "Claude-Key";

/// Lesen dauert länger als ein gewöhnlicher Abruf.
const TIMEOUT: Duration = Duration::from_secs(180);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Größere Antworten werden abgelehnt, statt den Arbeitsspeicher zu füllen.
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_KEY_CHARS: usize = 512;
/// Mehr Text nimmt eine einzelne Anfrage nicht mit (Zeichen, nicht Textbausteine).
const MAX_TEXT_CHARS: usize = 600_000;
/// Obergrenze für die Länge einer Antwort, in Textbausteinen.
const MAX_OUTPUT_TOKENS: u32 = 16_000;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub has_key: bool,
}

/// Antwort der Claude-API, unverändert: auch 401 oder 429 kommen so zurück.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct AiResponse {
    pub status: u16,
    pub body: String,
}

/// Was die Oberfläche lesen lassen will.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    /// Kennung des Modells, z. B. „claude-haiku-5-5“.
    pub model: String,
    /// Der Auftrag: was zu tun ist.
    pub system: String,
    /// Der Text, um den es geht.
    pub user: String,
    /// Die Form, in der geantwortet werden soll (JSON-Schema).
    pub schema: Option<Value>,
    pub max_tokens: u32,
}

// ── Schlüsselbund ────────────────────────────────────────────────────────────

/// Der Key im Arbeitsspeicher, damit der Schlüsselbund nicht bei jeder Anfrage gefragt wird.
/// `None` = noch nicht nachgesehen, `Some(None)` = es ist keiner hinterlegt.
#[derive(Default)]
pub struct KeyStore(Mutex<Option<Option<String>>>);

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

impl KeyStore {
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
    if key.is_empty() {
        return Err("Bitte den Claude-Key eingeben.".into());
    }
    if key.chars().count() > MAX_KEY_CHARS || !key.chars().all(|c| c.is_ascii_graphic()) {
        return Err(
            "Das sieht nicht nach einem Claude-Key aus (Leerzeichen oder Sonderzeichen enthalten)."
                .into(),
        );
    }
    Ok(key.to_string())
}

// ── Anfrage ──────────────────────────────────────────────────────────────────

/// Prüft, was die Oberfläche lesen lassen will, und baut daraus die Anfrage an die API.
pub fn build_body(request: &AiRequest) -> Result<Value, String> {
    let model = request.model.trim();
    let plain = model
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.');
    if !model.starts_with("claude-") || model.len() > 80 || !plain {
        return Err("Dieses Modell kennt Wayfarer nicht.".into());
    }
    if request.user.trim().is_empty() {
        return Err("Es gibt keinen Text zum Lesen.".into());
    }
    if request.user.chars().count() + request.system.chars().count() > MAX_TEXT_CHARS {
        return Err("Der Text ist zu lang, um ihn auf einmal lesen zu lassen.".into());
    }
    let mut body = json!({
        "model": model,
        "max_tokens": request.max_tokens.clamp(256, MAX_OUTPUT_TOKENS),
        "messages": [{ "role": "user", "content": request.user }],
    });
    if !request.system.trim().is_empty() {
        body["system"] = Value::String(request.system.clone());
    }
    if let Some(schema) = &request.schema {
        body["output_config"] = json!({ "format": { "type": "json_schema", "schema": schema } });
    }
    Ok(body)
}

/// Der HTTP-Client für die Claude-API. `url` ist außerhalb von Tests immer [`API_URL`].
pub fn build_client(url: &Url) -> Result<Client, String> {
    // Verschlüsselung über rustls mit „ring“ – wie beim LegendKeeper-Abruf.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = Client::builder()
        // Keine Weiterleitungen: Der Key geht an genau eine Adresse.
        .redirect(redirect::Policy::none())
        .timeout(TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .https_only(url.scheme() == "https")
        .user_agent(concat!("Wayfarer/", env!("CARGO_PKG_VERSION")));
    if url.scheme() != "https" {
        // Nur in Tests: der lokale Gegenpart soll nie über einen Proxy angesprochen werden.
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|err| format!("Die Verbindung zu Claude ließ sich nicht vorbereiten: {err}"))
}

fn request_error(err: reqwest::Error) -> String {
    if err.is_timeout() {
        return "Claude hat nicht rechtzeitig geantwortet. Bitte später erneut versuchen.".into();
    }
    if err.is_connect() {
        return "Claude ist nicht erreichbar. Besteht eine Internetverbindung?".into();
    }
    "Die Verbindung zu Claude ist fehlgeschlagen. Der Key bleibt gespeichert; bitte erneut versuchen."
        .into()
}

/// Schickt eine Anfrage. Jede Antwort – auch 401 oder 429 – wird mit Status und Text
/// zurückgegeben; ein Fehler bedeutet, dass gar keine Antwort der API zustande kam.
pub async fn send(client: &Client, url: &Url, key: &str, body: &Value) -> Result<AiResponse, String> {
    let payload = serde_json::to_vec(body)
        .map_err(|_| "Die Anfrage an Claude ließ sich nicht zusammenstellen.".to_string())?;
    let mut response = client
        .post(url.clone())
        .header("x-api-key", key)
        .header("anthropic-version", API_VERSION)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::ACCEPT, "application/json")
        .body(payload)
        .send()
        .await
        .map_err(request_error)?;
    let status = response.status().as_u16();
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(request_error)? {
        if bytes.len() + chunk.len() > MAX_BODY_BYTES {
            return Err("Die Antwort von Claude ist unerwartet groß und wurde verworfen.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(AiResponse {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// Client und Schlüssel der laufenden App.
pub struct Ai {
    pub keys: KeyStore,
    url: Url,
    client: Mutex<Option<Client>>,
}

impl Default for Ai {
    fn default() -> Self {
        Self {
            keys: KeyStore::default(),
            url: Url::parse(API_URL).expect("feste Adresse"),
            client: Mutex::new(None),
        }
    }
}

impl Ai {
    fn client(&self) -> Result<Client, String> {
        let mut slot = self
            .client
            .lock()
            .map_err(|_| "Interner Fehler bei der Anfrage an Claude.".to_string())?;
        if let Some(client) = slot.as_ref() {
            return Ok(client.clone());
        }
        let client = build_client(&self.url)?;
        *slot = Some(client.clone());
        Ok(client)
    }

    pub async fn ask(&self, key: &str, request: &AiRequest) -> Result<AiResponse, String> {
        let body = build_body(request)?;
        let client = self.client()?;
        send(&client, &self.url, key, &body).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    fn request(model: &str, user: &str) -> AiRequest {
        AiRequest {
            model: model.into(),
            system: "Lies den Artikel.".into(),
            user: user.into(),
            schema: Some(json!({ "type": "object" })),
            max_tokens: 4000,
        }
    }

    #[test]
    fn cleans_and_checks_keys() {
        assert_eq!(check_key("  schluessel-123 \n").unwrap(), "schluessel-123");
        assert!(check_key("   ").is_err());
        assert!(check_key("mit leerzeichen").is_err());
        assert!(check_key(&"x".repeat(600)).is_err());
    }

    #[test]
    fn builds_the_request_in_the_agreed_shape() {
        let body = build_body(&request("claude-haiku-5-5", "Die Fähre legt jeden Feuertag ab.")).unwrap();
        assert_eq!(body["model"], "claude-haiku-5-5");
        assert_eq!(body["max_tokens"], 4000);
        assert_eq!(body["system"], "Lies den Artikel.");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["content"], "Die Fähre legt jeden Feuertag ab.");
        assert_eq!(body["output_config"]["format"]["type"], "json_schema");
        assert_eq!(body["output_config"]["format"]["schema"]["type"], "object");
        // Ohne Auftrag und ohne Form fehlen die Felder ganz; die Länge der Antwort ist begrenzt.
        let mut bare = request("claude-sonnet-5-5", "Text");
        bare.system = " ".into();
        bare.schema = None;
        bare.max_tokens = 1_000_000;
        let body = build_body(&bare).unwrap();
        assert!(body.get("system").is_none());
        assert!(body.get("output_config").is_none());
        assert_eq!(body["max_tokens"], 16_000);
    }

    #[test]
    fn refuses_unknown_models_and_empty_or_huge_texts() {
        assert!(build_body(&request("gpt-x", "Text")).is_err());
        assert!(build_body(&request("claude-haiku-5-5/../x", "Text")).is_err());
        assert!(build_body(&request("claude-haiku-5-5", "   ")).is_err());
        assert!(build_body(&request("claude-haiku-5-5", &"a".repeat(700_000))).is_err());
    }

    #[test]
    fn status_and_response_use_the_agreed_field_names() {
        let status = serde_json::to_value(AiStatus { has_key: true }).unwrap();
        assert_eq!(status, json!({ "hasKey": true }));
        let parsed: AiRequest = serde_json::from_value(json!({
            "model": "claude-haiku-5-5",
            "system": "",
            "user": "Text",
            "schema": null,
            "maxTokens": 2000
        }))
        .unwrap();
        assert_eq!(parsed.max_tokens, 2000);
        assert!(parsed.schema.is_none());
    }

    /// Ein winziger Gegenpart auf diesem Rechner: nimmt eine Anfrage an, gibt Kopfzeilen und
    /// Inhalt weiter und antwortet nach Vorgabe.
    fn serve(reply: String) -> (Url, mpsc::Receiver<(Vec<String>, String)>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else { return };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut lines = Vec::new();
            let mut length = 0usize;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap_or(0);
                }
                lines.push(line.trim_end().to_string());
            }
            let mut body = vec![0u8; length];
            let _ = reader.read_exact(&mut body);
            let _ = stream.write_all(reply.as_bytes());
            let _ = tx.send((lines, String::from_utf8_lossy(&body).into_owned()));
        });
        (Url::parse(&format!("http://127.0.0.1:{port}/v1/messages")).unwrap(), rx)
    }

    fn reply(status: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn run<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn posts_with_key_and_version_and_returns_status_and_body() {
        let (url, seen) = serve(reply("200 OK", "{\"content\":[]}"));
        let client = build_client(&url).unwrap();
        let body = build_body(&request("claude-haiku-5-5", "Text")).unwrap();
        let response = run(send(&client, &url, "geheim-123", &body)).unwrap();
        assert_eq!(
            response,
            AiResponse {
                status: 200,
                body: "{\"content\":[]}".into()
            }
        );
        let (lines, sent) = seen.recv().unwrap();
        assert_eq!(lines[0], "POST /v1/messages HTTP/1.1");
        let lower: Vec<String> = lines.iter().map(|l| l.to_ascii_lowercase()).collect();
        assert!(lower.contains(&"x-api-key: geheim-123".to_string()), "{lines:?}");
        assert!(lower.contains(&"anthropic-version: 2026-10-21".to_string()), "{lines:?}");
        assert!(lower.contains(&"content-type: application/json".to_string()), "{lines:?}");
        let sent: Value = serde_json::from_str(&sent).unwrap();
        assert_eq!(sent["model"], "claude-haiku-5-5");
    }

    #[test]
    fn passes_error_statuses_through_instead_of_failing() {
        let (url, _seen) = serve(reply("401 Unauthorized", "{\"error\":{\"type\":\"authentication_error\"}}"));
        let client = build_client(&url).unwrap();
        let body = build_body(&request("claude-haiku-5-5", "Text")).unwrap();
        let response = run(send(&client, &url, "falsch", &body)).unwrap();
        assert_eq!(response.status, 401);
        assert!(response.body.contains("authentication_error"));
    }

    #[test]
    fn does_not_follow_redirects() {
        let (url, _seen) = serve(
            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/anderswo\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_string(),
        );
        let client = build_client(&url).unwrap();
        let body = build_body(&request("claude-haiku-5-5", "Text")).unwrap();
        let response = run(send(&client, &url, "geheim-123", &body)).unwrap();
        // Die Weiterleitung kommt als Antwort zurück – der Key wandert nicht weiter.
        assert_eq!(response.status, 302);
    }
}
