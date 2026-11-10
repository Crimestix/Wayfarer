//! Wohin ein Klick auf einen Link führt. Die App selbst bleibt immer im Fenster; fremde
//! Adressen (der Charakterbogen bei D&D Beyond, ein Artikel in LegendKeeper) öffnen sich im
//! Browser des Systems – nie im Fenster von Wayfarer, wo sie Zugriff auf die Befehle hätten.

use tauri::Url;

#[derive(Debug, PartialEq, Eq)]
pub enum LinkTarget {
    /// Gehört zur App: im Fenster anzeigen.
    App,
    /// Gewöhnliche Webadresse: an den Browser des Systems übergeben.
    Browser,
    /// Alles andere wird nicht geöffnet.
    Blocked,
}

/// `dev_origin` ist die Adresse der Vorschau während der Entwicklung, sonst `None`.
pub fn link_target(url: &Url, dev_origin: Option<&Url>) -> LinkTarget {
    let is_app = match url.scheme() {
        // macOS und Linux liefern die Oberfläche über „tauri://localhost“ aus …
        "tauri" => url.host_str() == Some("localhost"),
        // … Windows über „http://tauri.localhost“.
        "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
        "http" | "https" => dev_origin.is_some_and(|dev| dev.origin() == url.origin()),
        "about" => url.as_str() == "about:blank",
        _ => false,
    };
    if is_app {
        LinkTarget::App
    } else if matches!(url.scheme(), "http" | "https") && url.host_str().is_some() {
        LinkTarget::Browser
    } else {
        LinkTarget::Blocked
    }
}

/// Öffnet eine Webadresse im Browser des Systems.
pub fn open_in_browser(url: &Url) {
    if let Err(err) = open::that_detached(url.as_str()) {
        eprintln!("Die Adresse {url} ließ sich nicht im Browser öffnen: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(url: &str, dev: Option<&str>) -> LinkTarget {
        let dev = dev.map(|d| Url::parse(d).unwrap());
        link_target(&Url::parse(url).unwrap(), dev.as_ref())
    }

    #[test]
    fn the_app_itself_stays_in_the_window() {
        assert_eq!(
            target("tauri://localhost/index.html#/welt/abc", None),
            LinkTarget::App
        );
        assert_eq!(target("http://tauri.localhost/#/tisch", None), LinkTarget::App);
        assert_eq!(target("https://tauri.localhost/", None), LinkTarget::App);
        assert_eq!(target("about:blank", None), LinkTarget::App);
        assert_eq!(
            target("http://localhost:1420/#/tisch", Some("http://localhost:1420")),
            LinkTarget::App
        );
    }

    #[test]
    fn web_addresses_go_to_the_system_browser() {
        for url in [
            "https://www.dndbeyond.com/characters/123456",
            "https://www.legendkeeper.com/app/abc/def",
            "http://example.org/",
            // Die Vorschau-Adresse gehört nur während der Entwicklung zur App.
            "http://localhost:1420/#/tisch",
            "http://localhost:9999/",
            "https://tauri.localhost.evil.test/",
        ] {
            assert_eq!(target(url, None), LinkTarget::Browser, "{url}");
        }
        assert_eq!(
            target("http://localhost:9999/", Some("http://localhost:1420")),
            LinkTarget::Browser
        );
    }

    #[test]
    fn everything_else_is_not_opened() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "tauri://evil/index.html",
            "about:srcdoc",
            "ms-settings:privacy",
            "smb://server/share",
            "mailto:jemand@example.org",
        ] {
            assert_eq!(target(url, None), LinkTarget::Blocked, "{url}");
        }
    }
}
