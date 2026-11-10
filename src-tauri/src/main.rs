// Unter Windows kein zusätzliches Konsolenfenster in der fertigen App.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    wayfarer_lib::run();
}
