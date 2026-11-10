//! Einstellungen der App auf diesem Rechner – bewusst NICHT im Kampagnenordner, denn jeder
//! Rechner hat seinen eigenen Pfad zum Cloud-Laufwerk.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::store::write_atomic;

pub const CONFIG_FILE: &str = "config.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// Der zuletzt geöffnete Kampagnenordner.
    #[serde(default)]
    pub campaign_dir: Option<String>,
}

/// Liest die Einstellungen. Fehlt die Datei oder ist sie unlesbar, gelten die Vorgaben.
pub fn load(dir: &Path) -> AppConfig {
    fs::read_to_string(dir.join(CONFIG_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, config: &AppConfig) -> Result<(), String> {
    let text = serde_json::to_string_pretty(config).map_err(|err| err.to_string())?;
    write_atomic(&dir.join(CONFIG_FILE), text.as_bytes())
        .map_err(|err| format!("Die Einstellungen ließen sich nicht speichern: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn missing_or_broken_config_means_no_campaign_yet() {
        let dir = TempDir::new().unwrap();
        assert_eq!(load(dir.path()), AppConfig { campaign_dir: None });
        fs::write(dir.path().join(CONFIG_FILE), "kaputt").unwrap();
        assert_eq!(load(dir.path()), AppConfig { campaign_dir: None });
        fs::write(dir.path().join(CONFIG_FILE), "{}").unwrap();
        assert_eq!(load(dir.path()), AppConfig { campaign_dir: None });
    }

    #[test]
    fn saves_and_loads_the_campaign_folder() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("noch").join("nicht da");
        let config = AppConfig {
            campaign_dir: Some("C:\\Users\\Mara\\OneDrive\\Elaris".into()),
        };
        save(&nested, &config).unwrap();
        assert_eq!(load(&nested), config);
        let text = fs::read_to_string(nested.join(CONFIG_FILE)).unwrap();
        assert!(text.contains("\"campaignDir\""), "{text}");
        save(&nested, &AppConfig { campaign_dir: None }).unwrap();
        assert_eq!(load(&nested).campaign_dir, None);
    }
}
