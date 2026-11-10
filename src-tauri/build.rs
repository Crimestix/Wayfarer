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
    let mut attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));

    // Windows (MSVC): Das Anwendungsmanifest (Common Controls v6, nötig für Systemdialoge) hängt
    // tauri-build nur an das Programm selbst. Die Testprogramme von `cargo test` starteten ohne
    // es nicht (STATUS_ENTRYPOINT_NOT_FOUND). Deshalb bettet der Linker dasselbe Manifest in
    // alle Programme dieses Pakets ein, und tauri-build fügt kein zweites hinzu.
    let windows = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
    let msvc = std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if windows && msvc {
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed=windows-app-manifest.xml");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        attributes =
            attributes.windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }

    tauri_build::try_build(attributes).expect("Tauri-Bau fehlgeschlagen");
}
