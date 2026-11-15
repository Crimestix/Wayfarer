//! Schlüsselbund des Systems für den Zugangsschlüssel des Abgleichs. Der Schlüssel verlässt die
//! Rust-Seite nie; die Oberfläche erfährt nur, ob einer da ist.
//!
//! Gelesen wird **einmal je Programmstart** (das Ergebnis bleibt im Speicher). Verweigert der
//! Schlüsselbund den Zugriff (am Mac: „Ablehnen“), fragt Wayfarer in dieser Sitzung nicht von
//! selbst wieder – erst, wenn der Spielleiter „Noch einmal versuchen“ wählt (`reload`).
//!
//! (LegendKeeper und der KI-Leser haben ihre eigenen, älteren Bausteine; Aufräumliste.)

use std::sync::Mutex;

#[cfg_attr(test, allow(dead_code))]
const SERVICE: &str = "app.wayfarer.desktop";

/// Was der Schlüsselbund hergibt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyState {
    Present(String),
    Missing,
    Denied,
}

pub struct KeyStore {
    #[cfg_attr(test, allow(dead_code))]
    account: &'static str,
    cache: Mutex<Option<KeyState>>,
}

impl KeyStore {
    pub const fn new(account: &'static str) -> Self {
        Self {
            account,
            cache: Mutex::new(None),
        }
    }

    #[cfg(not(test))]
    fn entry(&self) -> Result<keyring::Entry, keyring::Error> {
        keyring::Entry::new(SERVICE, self.account)
    }

    #[cfg(not(test))]
    fn read(&self, _current: Option<KeyState>) -> KeyState {
        let found = self.entry().and_then(|entry| entry.get_password());
        match found {
            Ok(key) => KeyState::Present(key),
            Err(keyring::Error::NoEntry) => KeyState::Missing,
            Err(_) => KeyState::Denied,
        }
    }

    /// In Tests wird der echte Schlüsselbund nie berührt.
    #[cfg(test)]
    fn read(&self, current: Option<KeyState>) -> KeyState {
        current.unwrap_or(KeyState::Missing)
    }

    /// Der Stand aus dem Speicher; beim ersten Mal (oder mit `reload`) aus dem Schlüsselbund.
    pub fn get(&self, reload: bool) -> KeyState {
        let Ok(mut cached) = self.cache.lock() else {
            return KeyState::Denied;
        };
        if !reload {
            if let Some(known) = cached.as_ref() {
                return known.clone();
            }
        }
        let state = self.read(cached.clone());
        *cached = Some(state.clone());
        state
    }

    pub fn set(&self, key: &str) -> Result<(), String> {
        #[cfg(not(test))]
        self.entry()
            .and_then(|entry| entry.set_password(key))
            .map_err(|_| "Der Schlüsselbund deines Systems hat den Zugriff verweigert.".to_string())?;
        if let Ok(mut cached) = self.cache.lock() {
            *cached = Some(KeyState::Present(key.to_string()));
        }
        Ok(())
    }

    pub fn clear(&self) -> Result<(), String> {
        #[cfg(not(test))]
        match self.entry().and_then(|entry| entry.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => return Err("Der Schlüsselbund deines Systems hat den Zugriff verweigert.".into()),
        }
        if let Ok(mut cached) = self.cache.lock() {
            *cached = Some(KeyState::Missing);
        }
        Ok(())
    }

    /// Nur in Tests: ein Schlüssel ohne Schlüsselbund.
    #[cfg(test)]
    pub fn preset(&self, state: KeyState) {
        *self.cache.lock().unwrap() = Some(state);
    }
}
