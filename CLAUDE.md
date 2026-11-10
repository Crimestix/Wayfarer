# Wayfarer

Digitaler Spielleiterschirm für eine Pen-&-Paper-Kampagne (D&D 2024, Welt „Elaris“). Installierte
Desktop-App für macOS und Windows (Tauri 2 + React + TypeScript). Ein Nutzer: der Spielleiter, am
Tisch mit Laptop und zur Vorbereitung.

## Die Idee

Weltwissen, Gruppe, Zeit und das, was tatsächlich am Tisch passiert, hängen zusammen:

- Öffnet man einen **Ort**, sieht man, wer dort eine Rolle spielt, wann die Gruppe dort war und was
  sich seitdem verändert hat.
- Öffnet man eine **Person**, sieht man ihre Haltung zur Gruppe mit Verlauf, ihre Beziehungen,
  offene Abmachungen und wo sie gerade ist.
- Die **Chronik** ist das Rückgrat: Ortswechsel, Notizen, Haltungsänderungen, eingetretene Termine,
  Abmachungen und Veränderungen der Welt. Besuche und „seitdem verändert“ werden daraus abgeleitet.
- Die **Weltzeit** läuft nur, wenn der Spielleiter sie vorstellt; dabei treten Termine ein.
- Wayfarers Weltdatenbank ist führend. LegendKeeper wird nur gelesen und verknüpft, nie beschrieben.
- Keine Inhaltsgenerierung, keine KI-Funktionen.

Dies ist ein Neubau. Die alte Version (v157) ist nur Ideenquelle; Code, Aufbau und Oberfläche werden
nicht übernommen.

## Aufbau

- `src/domain/` – reine Fachlogik ohne React: Kalender-Engine (`time/calendar.ts`), Elaris-Kalender
  als Daten (`time/elaris.ts`), Datenmodell (`schema.ts`, zod), Beziehungsarten und Haltungsskala
  (`relations.ts`), abgeleitete Sichten (`derive.ts`). Mit Tests.
- `src/data/` – Ablage und Spielstand: `store.ts` (Kampagnenordner als Schnittstelle), `db.ts`
  (geladener Spielstand, Speichern, Änderungen von außen), `actions.ts` (Befehle über mehrere
  Dokumente: Zeit vorstellen, Ort wechseln, Haltung setzen, festhalten …), `hooks.ts` (React),
  `platform.ts` (Brücke zur Tauri-Seite), `seed.ts` (Elaris-Grundstand, Beispielwelt).
- `src/ui/` – Designsystem: `tokens.css`, `base.css`, `ui.css`, Bausteine in `components.tsx`,
  `entity.tsx`, `chronicle.tsx`, `moon.tsx`. Alles über `import { … } from '../../ui'`.
- `src/shell/` – Gerüst: Navigation, Weltleiste, Dialoge. `commands.ts` enthält die Handgriffe, die
  jede Seite auslösen kann (`openQuickLog`, `openAttitude`, `openMoveParty`, `openSearch`,
  `openTimeDialog`).
- `src/features/<bereich>/` – je ein Arbeitsbereich: `tisch`, `welt`, `chronik`, `kalender`,
  `gruppe`, `einstellungen`, `import`, `legendkeeper`. `index.tsx` exportiert die Seite als default.
- `src-tauri/` – Rust-Seite: Dateizugriff auf den Kampagnenordner, Dateiüberwachung,
  LegendKeeper-Abruf, Schlüsselbund. Die Befehle stehen als Vertrag in `src/data/platform.ts`.

## Daten

- Eine Kampagne ist ein Ordner mit JSON-Dateien: `campaign.json`, `state.json` und je Dokument eine
  Datei unter `entities/`, `relations/`, `chronicle/`, `events/`, `sessions/`, `timers/`. Der Ordner
  darf in einem Cloud-Laufwerk liegen; so teilen sich Mac und Windows den Spielstand.
- Weltzeit = ganze Minuten seit Beginn des absoluten Jahres 1 (bei Elaris: kosmisches Jahr, JF).
  Der Kalender ist Daten (`CalendarDef`), nie fest im Code.
- Änderungen laufen über `db.put / patch / remove / setState` oder die Befehle in `actions.ts`.
  Was mehrere Dokumente betrifft (Zeit, Ort, Haltung), gehört in `actions.ts`, nicht in die Oberfläche.
- Ungültige oder fremde Dateien werden nie überschrieben, nur gemeldet (`db.problems`).

## Regeln für Code

- TypeScript strikt, keine `any`. Bezeichner englisch, alle sichtbaren Texte deutsch.
- Sichtbare Texte: klare, ganze Wörter, kein Fachjargon der Entwicklung, keine englischen
  Regelbegriffe, wenn es ein deutsches Wort gibt („Kurze Rast“, nicht „Short Rest“).
- Fachlogik als reine Funktion in `src/domain/` oder im eigenen Bereich (`features/x/model.ts`),
  mit Test. Komponenten rechnen nicht selbst.
- Nur Farben, Schriften und Abstände aus `tokens.css`. Erst die Bausteine aus `src/ui` verwenden;
  eigenes CSS je Bereich in `features/x/x.css` mit Klassenpräfix `wf-<bereich>-`.
- Keine weiteren Abhängigkeiten ohne guten Grund.
- Kein Zustand im Browser-Speicher außer über `BrowserStore` (Vorschau).

## Gestaltung

Dark Fantasy: geschwärztes Holz, Pergament als Schrift, angelaufenes Messing als Akzent, Blutrot
nur für Gefahr und Überfälliges. Es soll wie ein hochwertiges Werkzeug aus der Spielwelt wirken,
nicht wie ein Admin-Dashboard.

- Schriften: Cormorant Garamond (Namen, Überschriften), Cinzel (kleine Versalien für Etiketten und
  Navigation), Crimson Pro (Fließtext und Bedienelemente).
- Rahmen mit Messingecken (`Panel`), Abschnittstitel in Versalien, Zierlinie (`Divider`).
- Dichte: am Tisch muss man mit einem Blick finden, was man sucht. Lieber wenige, klar gegliederte
  Flächen als viele Kästen. Keine leeren Flächen ohne Hinweis, was hier hingehört.
- Für Desktop gebaut: 1280 × 800 bis 1920 × 1080. Kein Mobil-Layout.

## Befehle

- `npm run dev` – Vorschau im Browser auf Port 1420 (Beispielwelt, Speicherung im Browser;
  `?reset` vor dem `#` stellt die Beispielwelt wieder her).
- `npm run typecheck`, `npm test`, `npm run build`.
- `npm run tauri dev` / `npm run tauri build` – installierte App.
