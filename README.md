# Wayfarer

Wayfarer ist ein digitaler Spielleiterschirm für eine Pen-&-Paper-Kampagne – gebaut für die Welt
„Elaris“ (D&D 2024). Weltwissen, Gruppe, Weltzeit und das, was am Tisch tatsächlich passiert,
hängen darin zusammen:

- Öffnest du einen **Ort**, siehst du, wer dort eine Rolle spielt, wann die Gruppe dort war und
  was sich seitdem verändert hat.
- Öffnest du eine **Person**, siehst du ihre Haltung zur Gruppe mit Verlauf, ihre Beziehungen und
  offene Abmachungen.
- Die **Chronik** hält fest, was geschieht; die **Weltzeit** läuft nur, wenn du sie vorstellst.

Wayfarer ist ein installiertes Programm für **macOS und Windows**. Den Spielstand zwischen Mac und
Windows gleicht Wayfarer künftig selbst über ein privates GitHub-Repository ab (in Arbeit); bis
dahin geht es über „Sicherung herunterladen“ und „Sicherung einspielen“.

---

## Installation

Die Installationspakete liegen auf der Seite
**[Releases](https://github.com/Crimestix/Wayfarer/releases)**. Nimm den obersten Eintrag und
klappe dort „Assets“ auf.

| Rechner | Datei |
| --- | --- |
| Mac (Apple Silicon und Intel) | endet auf **`.dmg`** |
| Windows (64 Bit) | endet auf **`-setup.exe`** |

Andere Dateien in der Liste brauchst du nicht. Voraussetzung ist macOS 12 (Monterey) oder neuer
mit installierten Systemupdates bzw. Windows 10 oder 11.

Steht auf der Seite noch kein Eintrag, wurde noch keine Version gebaut. Wie das geht, steht unten
unter [Eine neue Version veröffentlichen](#eine-neue-version-veröffentlichen) – es sind drei Klicks
auf GitHub.

### macOS

1. Die `.dmg`-Datei öffnen und **Wayfarer** in den Ordner **Programme** ziehen.
2. Wayfarer aus dem Ordner Programme starten.

**Beim ersten Start meldet macOS, die App könne nicht geöffnet werden,** weil sie nicht bei Apple
registriert ist. Das ist zu erwarten – so gibst du sie einmalig frei:

- **macOS 15 (Sequoia) und neuer:** Die Meldung mit „Fertig“ schließen. Dann
  **Systemeinstellungen → Datenschutz & Sicherheit** öffnen, ganz nach unten blättern und bei
  „Wayfarer wurde blockiert …“ auf **„Dennoch öffnen“** klicken. Mit deinem Passwort bestätigen.
- **macOS 14 und älter:** Im Ordner Programme mit **Rechtsklick** (oder ctrl-Klick) auf Wayfarer →
  **Öffnen** → im Fenster noch einmal **Öffnen**.

Danach startet Wayfarer wie jedes andere Programm.

Fragt macOS, ob Wayfarer auf einen Ordner zugreifen darf (zum Beispiel „Dokumente“ oder
„iCloud Drive“), bitte **erlauben** – sonst kann Wayfarer den Spielstand nicht lesen.

Falls macOS stattdessen meldet, die App sei „beschädigt“: das Programm **Terminal** öffnen, diese
Zeile einfügen und mit der Eingabetaste bestätigen – danach noch einmal starten:

```
xattr -cr /Applications/Wayfarer.app
```

### Windows

1. Die Datei `…-setup.exe` ausführen.
2. Windows zeigt meist **„Der Computer wurde durch Windows geschützt“** (SmartScreen), weil das
   Programm nicht signiert ist. Auf **„Weitere Informationen“** klicken, dann auf
   **„Trotzdem ausführen“**.
3. Dem Installationsassistenten folgen. Wayfarer wird nur für dein Benutzerkonto installiert;
   Administratorrechte sind nicht nötig.

Wayfarer nutzt die in Windows eingebaute Webanzeige („WebView2“). Sie ist unter Windows 10 und 11
normalerweise vorhanden; fehlt sie, lädt das Installationsprogramm sie nach (dafür ist einmal eine
Internetverbindung nötig).

### Auf eine neue Version wechseln

Neues Paket herunterladen und wie oben installieren – die alte Version wird ersetzt. Dein
Spielstand bleibt unberührt, denn er liegt nicht im Programm, sondern im Kampagnenordner.

---

## Kampagnenordner

Wayfarer speichert eine Kampagne als **Ordner voller kleiner Dateien** auf deinem Rechner. Beim
ersten Start fragt Wayfarer nach diesem Ordner.

**So richtest du es ein:**

1. Lege einen **eigenen, leeren Ordner** an, zum Beispiel `Dokumente/Wayfarer-Elaris`. Nimm nicht
   „Dokumente“ selbst – in dem Ordner soll nur die Kampagne liegen.
2. Starte Wayfarer, klicke auf **„Kampagnenordner wählen“** und wähle diesen Ordner.
3. Ist der Ordner leer, bietet Wayfarer an, Elaris neu zu beginnen oder den Spielstand der alten
   Version zu übernehmen (Backup-Datei aus dem Menü der alten Version, „Backup herunterladen“).

Wayfarer merkt sich den Ordner und öffnet ihn beim nächsten Start von selbst.

Wayfarer **speichert von selbst**, sobald du etwas änderst; einen Speichern-Knopf gibt es nicht.
Unten links steht „Gespeichert“, wenn alles im Ordner angekommen ist. Beim Schließen wartet
Wayfarer, bis die letzte Änderung geschrieben ist. Gelingt das nicht, fragt Wayfarer nach, statt
die Änderungen stillschweigend zu verlieren; nach einem Fehler versucht Wayfarer alle paar Sekunden
von selbst erneut zu speichern.

**Mac und Windows:** Der eingebaute Abgleich über GitHub ist in Arbeit. Bis dahin: am einen Rechner
**Einstellungen → Sicherung herunterladen**, am anderen **Einstellungen → Sicherung einspielen**.
Immer nur an einem Rechner gleichzeitig weiterspielen.

**Bitte die Dateien im Ordner nicht von Hand ändern, umbenennen oder verschieben.** Liegt dort eine
Datei, die Wayfarer nicht lesen kann, rührt Wayfarer sie nicht an und zeigt sie unter
**Einstellungen → Probleme beim Laden**.

**Wenn etwas hakt:**

- *„Der Kampagnenordner … ist nicht erreichbar“* beim Start: Der Ordner wurde verschoben oder
  umbenannt. Über „Kampagnenordner wählen“ neu auswählen.
- *Unten links steht „Speichern fehlgeschlagen“:* Wayfarer **offen lassen**; es versucht von selbst
  erneut. Bleibt die Meldung unter Windows dauerhaft stehen, ist in der Windows-Sicherheit
  vermutlich der „Überwachte Ordnerzugriff“ aktiv. Dort Wayfarer als zugelassene App eintragen oder
  den Kampagnenordner an einen anderen Ort legen.

---

## LegendKeeper

Wayfarer kann Artikel aus LegendKeeper nachschlagen und mit Orten, Personen und anderen Einträgen
verknüpfen. Wayfarer **liest nur** – in LegendKeeper wird nie etwas verändert.

- Den Zugangsschlüssel („API-Key“) erstellst du in LegendKeeper selbst, in den Einstellungen im
  Bereich für die API.
- In Wayfarer trägst du ihn unter **Einstellungen → LegendKeeper** ein.
- Der Key liegt danach im **Schlüsselbund des Betriebssystems** (macOS: Schlüsselbund, Windows:
  Anmeldeinformationsverwaltung) – nicht im Kampagnenordner und nicht in der Cloud. Deshalb musst
  du ihn **auf jedem Rechner einmal** eintragen.
- macOS fragt beim ersten Zugriff, ob Wayfarer den Schlüsselbund benutzen darf; mit
  „Immer erlauben“ bleibt es bei dieser einen Frage. Nach der Installation einer neuen
  Wayfarer-Version kann macOS noch einmal fragen.
- LegendKeeper braucht eine Internetverbindung; alles andere in Wayfarer funktioniert ohne.

---

## Sicherung

Unter **Einstellungen → Sicherung herunterladen** schreibt Wayfarer die gesamte Kampagne in eine
einzige Datei. Mit **Sicherung einspielen** holst du einen solchen Stand zurück; vorher zeigt
Wayfarer, was darin steckt, und fragt nach.

Sinnvoll ist eine Sicherung vor jedem Spielabend und vor größeren Umbauten an der Welt. Lege die
Dateien an einem zweiten Ort ab, etwa auf einem USB-Stick.

---

## Eine neue Version veröffentlichen

Die Installationspakete baut GitHub selbst. Es gibt zwei Wege – beide führen zum selben Ergebnis:

**Von Hand auf GitHub (am einfachsten):**

1. Im Repository auf **Actions** gehen und links **„Veröffentlichen“** wählen.
2. Rechts auf **„Run workflow“** klicken, die neue **Versionsnummer** eintragen (drei Zahlen, zum
   Beispiel `0.2.0`) und bestätigen.
3. Etwa 15 bis 25 Minuten warten. Danach steht die Version unter
   [Releases](https://github.com/Crimestix/Wayfarer/releases), gekennzeichnet als „Pre-release“
   (Vorabversion), mit dem Paket für macOS und dem für Windows.

**Per Tag:**

```
git tag v0.2.0
git push origin v0.2.0
```

Die Versionsnummer muss bei jeder Veröffentlichung größer werden. Im Code muss dafür nichts
geändert werden; die Pakete übernehmen die Nummer aus der Eingabe bzw. dem Tag.

Die Pakete sind nicht signiert (dafür wären kostenpflichtige Entwicklerkonten bei Apple und ein
Zertifikat für Windows nötig). Deshalb die Hinweise beim ersten Start oben.

---

## Für die Entwicklung

Voraussetzungen: [Node.js](https://nodejs.org) 24, [Rust](https://rustup.rs) (stable) und die
[Tauri-Voraussetzungen](https://v2.tauri.app/start/prerequisites/) für das jeweilige Betriebssystem.

```
npm install
npm run dev          # Vorschau im Browser auf Port 1420 (Elaris-Grundstand, Speicherung im Browser)
npm run tauri dev    # die echte Desktop-App mit Kampagnenordner
npm run typecheck
npm test             # Tests der Oberfläche und der Fachlogik
npm run tauri build  # Installationspaket für das eigene Betriebssystem

cd src-tauri && cargo test   # Tests der Rust-Seite
```

In der Browser-Vorschau setzt `?reset` vor dem `#` auf den Elaris-Grundstand zurück
(`http://localhost:1420/?reset#/welt`).

**Aufbau** (ausführlich in [`CLAUDE.md`](CLAUDE.md)):

- `src/` – Oberfläche (React, TypeScript): Fachlogik in `domain/`, Spielstand in `data/`,
  Designsystem in `ui/`, Gerüst in `shell/`, die Arbeitsbereiche in `features/`.
- `src-tauri/` – Rust-Seite der Desktop-App (Tauri 2):
  - `src/store.rs` – Dateizugriff auf den Kampagnenordner: strenge Pfadprüfung, Schreiben über
    temporäre Datei und Umbenennen
  - `src/watch.rs` – Überwachung des Ordners, meldet Änderungen als Ereignis `store-changed`
  - `src/legendkeeper.rs` – Key im Schlüsselbund, Abruf nur per GET von der fest eingebauten Adresse
  - `src/links.rs` – fremde Adressen öffnen sich im Browser des Systems, nie im App-Fenster
  - `src/config.rs` – merkt sich den Kampagnenordner im Konfigurationsordner der App
  - `src/window.rs` – das Hauptfenster: Größe vom letzten Mal, erst speichern und dann schließen
    (Ereignis `close-requested`, Befehl `app_close`), kein Browser-Kontextmenü im fertigen Programm
  - `src/menu.rs` – die deutsche Menüleiste unter macOS
  - `src/lib.rs` – die Befehle; `src/tests.rs` prüft sie so, wie die Oberfläche sie aufruft
- Der **Vertrag** zwischen Oberfläche und Rust-Seite steht in `src/data/platform.ts`. Ein neuer
  Befehl muss an drei Stellen eingetragen werden: in `src-tauri/src/lib.rs` (Funktion und
  `generate_handler!`), in `src-tauri/build.rs` (Liste `COMMANDS`) und in
  `src-tauri/capabilities/main.json` (`allow-…`). Was dort nicht freigegeben ist, darf das Fenster
  nicht aufrufen.

**Automatische Abläufe** (`.github/workflows/`):

- `pruefen.yml` – bei jeder Änderung: Typen, Tests, Bau der Oberfläche.
- `desktop-pruefen.yml` – Rust-Tests auf macOS, Windows und Linux; läuft, wenn sich `src-tauri/`
  ändert, oder von Hand.
- `release.yml` – baut die Installationspakete (siehe oben).

In einem privaten Repository verbrauchen die Abläufe Freiminuten von GitHub Actions; macOS zählt
dabei zehnfach, Windows doppelt.

**App-Symbol:** Die Vorlagen liegen als SVG in `src-tauri/icons/` (`app-icon.svg` für Windows,
`app-icon-macos.svg` mit Rand nach Apples Raster). Nach einer Änderung als PNG mit 1024 × 1024
Pixeln rendern und mit `npx tauri icon <datei.png> -o src-tauri/icons` die Symbolgrößen neu
erzeugen (`icon.icns` aus der macOS-Vorlage).
