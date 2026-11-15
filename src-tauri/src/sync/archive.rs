//! Abgleich: das Archiv einer Ablage (tar.gz) lesen – für das Holen vieler Dateien auf einmal.
//! Nur gewöhnliche Dateien, nur Pfade nach dem Muster, nur angeforderte Kennungen, mit
//! Obergrenze für das Entpackte. Der Oberordner, den GitHub voranstellt, wird abgeschnitten.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;

use super::local::{blob_sha, is_synced_path};
use super::SyncError;

/// Höchstens so viel wird entpackt.
pub const MAX_UNPACKED: u64 = 512 * 1024 * 1024;

/// Liest aus dem Archiv die Dateien mit den gewünschten Kennungen (Kennung → Bytes).
pub fn extract(gz: &[u8], wanted: &BTreeSet<String>) -> Result<BTreeMap<String, Vec<u8>>, SyncError> {
    let broken = || SyncError::new("server", "Das Archiv der Ablage ist unvollständig.");
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(gz));
    let mut found = BTreeMap::new();
    let mut total: u64 = 0;
    for entry in archive.entries().map_err(|_| broken())? {
        let mut entry = entry.map_err(|_| broken())?;
        if entry.header().entry_type() != tar::EntryType::Regular {
            continue;
        }
        let Ok(path) = entry.path() else { continue };
        let Some(text) = path.to_str() else { continue };
        // „owner-repo-sha/entities/a.json“ → „entities/a.json“
        let Some((_, rel)) = text.split_once('/') else {
            continue;
        };
        if !is_synced_path(rel) {
            continue;
        }
        let size = entry.header().size().map_err(|_| broken())?;
        total += size;
        if total > MAX_UNPACKED || size > super::local::MAX_FILE_BYTES {
            return Err(SyncError::new(
                "server",
                "Das Archiv der Ablage ist unerwartet groß.",
            ));
        }
        let mut bytes = Vec::with_capacity(size as usize);
        entry.read_to_end(&mut bytes).map_err(|_| broken())?;
        let sha = blob_sha(&bytes);
        if wanted.contains(&sha) {
            found.insert(sha, bytes);
        }
    }
    Ok(found)
}

/// Baut ein Archiv wie GitHub (nur für Tests und den Gegenpart).
#[cfg(test)]
pub fn build(prefix: &str, files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::fast(),
    ));
    for (path, bytes) in files {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_entry_type(tar::EntryType::Regular);
        header.set_cksum();
        builder
            .append_data(&mut header, format!("{prefix}/{path}"), *bytes)
            .unwrap();
    }
    builder.into_inner().unwrap().finish().unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_only_wanted_files_inside_the_pattern() {
        let a: &[u8] = b"{\"id\":\"a\"}";
        let b: &[u8] = b"{\"id\":\"b\"}";
        let gz = build(
            "spielleiter-spielstand-abc123",
            &[
                ("entities/a.json", a),
                ("entities/b.json", b),
                ("README.md", b"# x"),
                ("media/bild.png", b"png"),
            ],
        );
        let wanted = BTreeSet::from([blob_sha(a), blob_sha(b"# x")]);
        let found = extract(&gz, &wanted).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[&blob_sha(a)], a);
        assert!(extract(b"kein archiv", &wanted).is_err());
    }
}
