//! Vollständige Kopie einer Kampagne (F19): alle Dateien des Kampagnenordners – JSON und Bilder
//! unter `media/` – in einen neuen Ordner. Das ist der vollständige Rückfall; die JSON-Sicherung
//! enthält keine Bilder. Ausgelassen wird, was die Kopie nicht haben darf: der Zustand des
//! Abgleichs (`.abgleich/` – eine geöffnete Kopie würde sonst als dieselbe Kampagne abgleichen)
//! und beiseitegelegte Stände des Testmodus (`testmodus*.json`). Der Zugangsschlüssel liegt nie im
//! Ordner. Wiederhergestellt wird, indem man die Kopie als Kampagne öffnet.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::store;

/// Was in die Kopie ging.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CopyReport {
    /// Der neu angelegte Ordner der Kopie.
    pub folder: String,
    pub files: u64,
    /// Davon Bilder unter `media/`.
    pub media: u64,
    pub bytes: u64,
}

/// Bleibt in der Kopie außen vor.
fn skipped(name: &str, top: bool) -> bool {
    name == crate::sync::local::DIR || (top && name.starts_with("testmodus") && name.ends_with(".json"))
}

/// Kopiert die Kampagne `root` in einen neuen Unterordner von `target`. Der Name des neuen
/// Ordners ist `name`; gibt es ihn schon, wird ein Zähler angehängt – nie wird etwas
/// überschrieben. `target` darf nicht im Kampagnenordner liegen.
pub fn copy_campaign(root: &str, target: &str, name: &str) -> Result<CopyReport, String> {
    let root = store::check_root(root)?;
    let target = store::check_root(target)
        .map_err(|_| "Der Zielordner für die Kopie ist nicht erreichbar.".to_string())?;
    if target.starts_with(&root) {
        return Err("Die Kopie darf nicht im Kampagnenordner selbst liegen – wähle einen Ordner daneben.".into());
    }
    let base = clean_name(name);
    let mut folder = target.join(&base);
    let mut n = 2;
    while folder.exists() {
        folder = target.join(format!("{base} ({n})"));
        n += 1;
    }
    fs::create_dir(&folder).map_err(|e| format!("Der Ordner für die Kopie ließ sich nicht anlegen: {e}"))?;
    let mut report = CopyReport {
        folder: folder.to_string_lossy().into_owned(),
        files: 0,
        media: 0,
        bytes: 0,
    };
    if let Err(error) = copy_dir(&root, &folder, true, false, &mut report) {
        // Eine halbe Kopie wäre ein falscher Rückfall: weg damit.
        let _ = fs::remove_dir_all(&folder);
        return Err(error);
    }
    Ok(report)
}

fn copy_dir(from: &Path, to: &Path, top: bool, in_media: bool, report: &mut CopyReport) -> Result<(), String> {
    let entries = fs::read_dir(from).map_err(|e| format!("Ein Ordner der Kampagne ließ sich nicht lesen: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Ein Ordner der Kampagne ließ sich nicht lesen: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if skipped(&name, top) {
            continue;
        }
        let kind = entry.file_type().map_err(|e| format!("„{name}“ ließ sich nicht lesen: {e}"))?;
        let source = entry.path();
        let dest: PathBuf = to.join(&name);
        if kind.is_dir() {
            fs::create_dir(&dest).map_err(|e| format!("Der Ordner „{name}“ ließ sich nicht anlegen: {e}"))?;
            copy_dir(&source, &dest, false, in_media || (top && name == crate::media::MEDIA_DIR), report)?;
        } else if kind.is_file() {
            let bytes = fs::copy(&source, &dest).map_err(|e| format!("„{name}“ ließ sich nicht kopieren: {e}"))?;
            report.files += 1;
            report.bytes += bytes;
            if in_media {
                report.media += 1;
            }
        }
        // Verknüpfungen werden nicht verfolgt: Die Kopie enthält nur, was wirklich im Ordner liegt.
    }
    Ok(())
}

/// Ein Ordnername ohne Zeichen, die ein Dateisystem nicht mag.
fn clean_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '-' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "Kampagne – Kopie".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn kopiert_daten_und_bilder_ohne_abgleich_und_testmodus() {
        let campaign = TempDir::new().unwrap();
        let elsewhere = TempDir::new().unwrap();
        write(&campaign.path().join("campaign.json"), "{}");
        write(&campaign.path().join("entities/a.json"), "{}");
        write(&campaign.path().join("media/bild.webp"), "BILD");
        write(&campaign.path().join(".abgleich/stand.json"), "{}");
        write(&campaign.path().join("testmodus.json"), "{}");
        let report = copy_campaign(
            campaign.path().to_str().unwrap(),
            elsewhere.path().to_str().unwrap(),
            "Elaris – Kopie",
        )
        .unwrap();
        let folder = Path::new(&report.folder);
        assert_eq!(report.files, 3);
        assert_eq!(report.media, 1);
        assert_eq!(fs::read_to_string(folder.join("media/bild.webp")).unwrap(), "BILD");
        assert!(folder.join("entities/a.json").is_file());
        assert!(!folder.join(".abgleich").exists());
        assert!(!folder.join("testmodus.json").exists());
    }

    #[test]
    fn ueberschreibt_nie_und_kopiert_nicht_in_sich_selbst() {
        let campaign = TempDir::new().unwrap();
        let elsewhere = TempDir::new().unwrap();
        write(&campaign.path().join("campaign.json"), "{}");
        let root = campaign.path().to_str().unwrap();
        let first = copy_campaign(root, elsewhere.path().to_str().unwrap(), "Kopie").unwrap();
        let second = copy_campaign(root, elsewhere.path().to_str().unwrap(), "Kopie").unwrap();
        assert_ne!(first.folder, second.folder);
        assert!(second.folder.ends_with("Kopie (2)"));
        let inside = campaign.path().join("sicherungen");
        fs::create_dir(&inside).unwrap();
        assert!(copy_campaign(root, inside.to_str().unwrap(), "Kopie").is_err());
    }
}
