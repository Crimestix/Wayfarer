/// Die Befehle der Rust-Seite. Jeder muss in `capabilities/main.json` ausdrücklich für das
/// Hauptfenster freigegeben sein (`allow-…`); ohne diese Liste dürfte jede Webansicht alles.
const COMMANDS: &[&str] = &[
    "config_get",
    "config_set",
    "store_read_all",
    "store_read",
    "store_write",
    "store_remove",
    "store_watch",
    "lk_status",
    "lk_set_key",
    "lk_clear_key",
    "lk_get",
    "app_close",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("Tauri-Bau fehlgeschlagen");
}
