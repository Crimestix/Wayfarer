# Weiterarbeit: Übergabe an die Sitzung auf dem eigenen Rechner

Stand: 10. 11. 2026, nach der ersten Bauwelle. Diese Datei ist die Übergabe zwischen der
Cloud-Sitzung (erste Welle) und der Arbeit auf dem Rechner des Spielleiters (zweite Welle).
Erst `CLAUDE.md` lesen, dann `docs/FUNKTIONSUMFANG.md`, dann diese Datei.

## 1. Was steht

Alle Bereiche der ersten Welle sind gebaut und von einem zweiten Agenten durchgespielt und
nachgebessert worden. Typprüfung fehlerfrei, alle Tests grün, `npm run build` läuft.

| Bereich | Route | Inhalt |
|---|---|---|
| Spieltisch | `/` | Ort der Gruppe mit Besetzung, „Seit eurem letzten Besuch“, Orte darunter; Mitschrift mit @-Verweisen; Anstehendes; Leiste der Gefährten |
| Welt | `/welt/:id?` | Weltdatenbank: Orte als Baum, Personen, Fraktionen, Gegenstände, Themen; Dossiers mit Überblick, Beziehungen, Chronik, LegendKeeper |
| Chronik | `/chronik` | Verlauf nach Welt-Tagen mit Filtern, Sessions mit Notizen, Nachtragen, Bearbeiten |
| Kalender | `/kalender` | Monatsraster mit Monden und Terminen, Tagesleiste, Termine mit Wiederholung, Wirkungen und Tätigkeiten (Timer), Mond-Kalibrierung |
| Gefährten | `/gruppe/:id?` | Karten der sechs Charaktere, Kennzahlen der Gruppe, Erschöpfung nach 2024, Zustände, Detailseite, lange Rast |
| Einstellungen | `/einstellungen` | Kampagne, Sicherung herunterladen/einspielen, alten Spielstand (v157) übernehmen, Ladeprobleme, LegendKeeper, Kalender |
| LegendKeeper | (in Welt und Einstellungen) | Artikel suchen, lesen, verknüpfen; Key im Schlüsselbund; nur lesend |
| Desktop | `src-tauri/` | Tauri 2: Kampagnenordner, Dateiüberwachung, LegendKeeper-Abruf, Schlüsselbund, sicheres Schließen, ein Fenster je Kampagne; GitHub-Abläufe für Installationspakete |

Das Gerüst (Weltleiste, Navigation, Suche Strg+K, Festhalten Strg+E, Zeitdialog, Ortswechsel,
Haltungsdialog) und das Fundament (`src/domain`, `src/data`, `src/ui`) sind gemeinsam genutzt.

### Nur unter Linux geprüft

Die erste Welle lief in einem Linux-Container. Auf macOS und Windows ist noch nichts gelaufen.
**Erste Aufgabe auf dem eigenen Rechner:** `npm run tauri dev` starten, eine Kampagne anlegen,
die wichtigsten Abläufe einmal durchklicken (Zeit vorstellen, Ort wechseln, Person anlegen,
Haltung ändern, Festhalten, Neustart → alles noch da). Besonders prüfen:
Darstellung in WebKit (macOS: Container-Abfragen, `color-mix`, `:has()`), Schlüsselbund,
Ordnerüberwachung, Schließen mit ungespeicherten Änderungen, Menüleiste auf dem Mac.

## 2. Den eigenen Rechner einrichten

Einmalig:

- **Node.js** 22 oder neuer (https://nodejs.org, „LTS“).
- **Rust** über https://rustup.rs.
- **macOS:** Xcode-Befehlszeilenwerkzeuge (`xcode-select --install`).
- **Windows:** „Microsoft C++ Build Tools“ mit der Auswahl „Desktopentwicklung mit C++“;
  WebView2 ist bei Windows 10/11 bereits vorhanden.
- **Claude Code** (Desktop-App oder Kommandozeile).

Dann:

```bash
git clone https://github.com/Crimestix/Wayfarer.git
cd Wayfarer
npm ci
npm run tauri dev
```

Die Browser-Vorschau ohne Desktop-Teil: `npm run dev` → http://localhost:1420
(Beispielwelt; `http://localhost:1420/?reset#/` setzt sie zurück).

## 3. Arbeitsweise, die sich bewährt hat

- Je Bereich ein Agent, der baut, danach ein **unabhängiger** Agent, der den Bereich wie ein
  Spielleiter durchspielt (Playwright, Bildschirmfotos in 1600×950 und 1280×800, Randfälle,
  Neuladen) und Mängel selbst behebt. Diese zweite Runde hat in jedem Bereich echte Fehler
  gefunden (u. a. Datenverlust beim schnellen Schließen, unlesbare Ziffern, abgeschnittene Texte).
- Bereiche haben feste Ordner; das Fundament wird nur ergänzt, nicht umgebaut.
- Gearbeitet wird auf einem Zweig; nach Prüfung in `main` übernehmen.
- Vor der Übernahme: `npm run typecheck`, `npm test`, `npm run build`,
  in `src-tauri`: `cargo test`.

## 4. Zweite Welle: Plan

Ziel: Alles, was in v157 unfertig oder falsch war, funktioniert und ist ausgearbeitet –
siehe `docs/FUNKTIONSUMFANG.md`. Regeln nach D&D 2024 (Hausregeln vorerst nicht),
Werte einstellbar, keine erfundenen Texte.

### 4.1 Zuerst: Fundament erweitern (eine Hand, vor den Bereichen)

Damit parallel arbeitende Agenten nicht gegeneinander bauen, legt **eine** Sitzung zuerst das
Datenmodell an (`src/domain/schema.ts` + Tests), danach starten die Bereiche.

- **Neue Arten der Weltdatenbank:** `family` (Familie), `species` (Spezies), `language` (Sprache),
  `script` (Schrift), `ability` (Fähigkeit). Person bekommt `speciesId`, `workplaceId`
  (arbeitet bei / in), Familie und Sprachen über Beziehungen (`member`, neue Art `speaks`,
  `writes`). Organisationen = bestehende Art `faction`.
- **Karten** (`maps/`): `{ id, name, lk: { resourceId, docId } | null, scale: { kmPerUnit } |
  Kalibrierung aus zwei Punkten, markers: [{ id, x, y, entityId | null, lkFeatureId | null }] }`.
  Bild und Pins kommen aus LegendKeeper (Kartenfeatures), Maßstab und Verknüpfungen sind
  Wayfarer-Daten.
- **Wege** (`paths/`) – Grundlage für Reisen **und** Pointcrawl: `{ id, fromId, toId (Orte),
  name, distanceKm | null, minutes | null (fester Aufwand), terrain, road, conditions (Text),
  mapId | null, points: [[x, y]] }`. Ein Wegenetz besteht unabhängig von einer Reise und wird
  wiederverwendet; Städte ohne Karte (Auvel) bestehen nur aus Orten und Wegen.
- **Reisen** (`journeys/`): `{ id, participants (Gefährten-IDs → Teilgruppen), legs (Wege oder
  freie Strecke auf einer Karte), pace (langsam/normal/schnell), mountIds/vehicleId, status
  (geplant / unterwegs / angekommen / abgebrochen), progress (Abschnitt, km), log }`.
  Position mitten auf einer Strecke ist ein Zustand der Reise, nicht ein Ort.
- **Reittiere und Fahrzeuge**: kleine Bibliothek in der Kampagne (Name, Tempo, Traglast,
  Besonderheiten), Vorgaben nach Regelwerk, vom Spielleiter ergänzbar.
- **Wetter**: Klimazonen (je Monat Temperaturbereich, Niederschlags- und Windneigung), Orte
  gehören einer Zone an; ein Wetter je Tag und Zone, reproduzierbar ausgewürfelt und jederzeit
  von Hand überschreibbar (`weather/`).
- **Erkundungsgebiete** (`areas/`): Hexraster über einer Karte (Hexgröße in km), je Hex Gelände,
  Ort, Notiz, entdeckt ja/nein, vorbereitetes Ereignis. **Tabellen** (`tables/`): Begegnungs-
  und Entdeckungstabellen je Region, kampagnenweit wiederverwendbar.
- **Timer** erweitern: Art „Zauber“ mit Konzentration (Wirker), Teilnehmer (Teilgruppe).
- **Teilgruppen**: Gefährten haben schon einen eigenen Aufenthaltsort; Reisen, Rasten und
  Tätigkeiten nehmen eine Teilnehmerliste.

### 4.2 Bereiche der zweiten Welle

| # | Bereich | Inhalt | Hängt ab von |
|---|---|---|---|
| A | Welt erweitern | neue Arten, „arbeitet bei“, NSC-Galerie mit Porträts und Filtern (Ort, bekannt/unbekannt), Dossiers zeigen Familie, Spezies, Sprachen, Kartenpunkte und Ereignisse eines Ortes | 4.1 |
| B | Seitenfläche | Dossier, LegendKeeper-Artikel und Notizen neben der aktuellen Arbeit öffnen, ohne Seitenwechsel (aus jedem Verweis heraus) | 4.1 |
| C | LegendKeeper-Einordnung | jeder Artikel: als was er erkannt wird (Ort, Person, Familie …), ob er in Ortssuche und Reiseplanung auftaucht; einzeln oder gesammelt prüfen und als Wayfarer-Eintrag übernehmen/verknüpfen; nur lesend | 4.1 |
| D | Karten und Wege | Karten aus LegendKeeper wählen, zoomen, kalibrieren; Marker mit Orten verbinden; Wege zeichnen, speichern, wiederverwenden; Wegenetz ohne Karte (Pointcrawl) | 4.1 |
| E | Reisen und Reiten | Planung (Start, Ziel, Weg, Tempo, Aufbruch, Teilnehmer, Reittiere) mit Vorschau von Entfernung, Dauer, Etappen; erst bei Bestätigung läuft die Zeit; Reisetag für Reisetag: Etappe, Wetter, Begegnungsprüfung, Gewaltmarsch (2024: Konstitutionsrettungswurf ab der 9. Stunde), Lager; Position auf der Karte; Ankunft setzt den Ort richtig | D |
| F | Wetter | Klimazonen pflegen, Tageswetter in Weltleiste, Spieltisch und Kalender, Regelfolgen 2024 (extreme Kälte/Hitze, starker Wind, starker Niederschlag, Nebel), von Hand setzbar | 4.1 |
| G | Rast, Lager, Wachen | kurze und lange Rast nach 2024 (lange Rast: 8 h, davon mind. 6 h Schlaf, Unterbrechung, eine je 24 h, −1 Erschöpfung), Wachplan mit passiver Wahrnehmung, Schlaf bestätigen; für Gruppe oder Teilgruppe; Konzentration und Zauber als Timer | 4.1 |
| H | Exploration | Erkundungsgebiete auf der echten Karte, Hexcrawl: Orientierung, Reisezeit, Entdeckungen, Begegnungen aus den eigenen Tabellen, frei abbiegen, „Bis zur nächsten Entscheidung“, Entdecktes bleibt erhalten | D, E, F |
| I | Abgleich über GitHub | Spielstand in einem privaten GitHub-Repository (Entscheidung des Spielleiters, kein Cloud-Laufwerk); Rust-Seite über die GitHub-API (Bäume/Blobs, kein libgit2), Zugangsschlüssel im Schlüsselbund, Abgleich beim Öffnen, nach Änderungen und beim Schließen; Dreiwegevergleich je Datei mit gespeichertem gemeinsamem Stand; Konflikte zur Entscheidung anzeigen | – |
| J | Testspielstand | Kopie der Kampagne zum Ausprobieren, unübersehbar gekennzeichnet, mit einem Klick verwerfen | – |
| K | D&D-Beyond-Werte | Werte aus dem D&D-Beyond-Link eines Charakters holen (öffentlicher Charakter), über die Rust-Seite; Werte kennzeichnen, von Hand überschreibbar | – |

Reihenfolge: 4.1 → (A, B, C, D, F, G, I, J, K parallel, soweit der Rechner trägt) → E → H.

## 5. Offene Fragen an den Spielleiter

Gesammelt aus den Prüfungen der ersten Welle; Vorschlag in Klammern ist umgesetzt, bis er
anders entscheidet.

**Am Tisch**
1. Welche Bildschirmgröße hat der Laptop am Tisch? (Gebaut für 1280×800 bis 1920×1080.)
2. Sehen Spieler den Bildschirm? Dann sollte „Spielleiterwissen“ verdeckt sein. (Offen sichtbar, blutrot abgesetzt.)
3. Ein Klick auf einen Ort unter „Orte hier“ verlegt die Gruppe sofort. (Ja, mit „Rückgängig“.)
4. Wie weit soll „Anstehend“ vorausschauen? (Spieltisch 7 Tage, Kalender 30 Tage.)

**Kalender und Chronik**
5. Beginnt die Woche in Elaris mit Ruhnacht? (So dargestellt.)
6. Sollen Vorhaben beim Eintreten von selbst als erledigt gelten, und nur Fristen überfällig werden? (Bisher bleiben beide überfällig, bis sie abgehakt sind.)
7. Ausnahmen bei wiederkehrenden Terminen (einmal ausfallen lassen)? (Nicht vorhanden.)
8. Vergangene Sessions 1–11 nachträglich anlegen? (Nicht möglich.)
9. Zusammenfassung einer Session auch in einer Fassung ohne Spielleiterwissen zum Weitergeben? (Nur die vollständige.)

**Gefährten**
10. Welche Werte fehlen am Tisch: Initiative, Zauberrettungswurf-SG, Dunkelsicht, aktuelle Trefferpunkte? (Vorhanden: RK, max. TP, Bewegung, drei passive Werte.)
11. Eigene Zustände neben den 14 des Regelwerks (z. B. „Verflucht“)? (Nicht anlegbar.)
12. Soll das Trennen und Zurückkehren eines Gefährten immer in der Chronik stehen? (Beim Wechsel auf der Karte ja, im Dialog nein – vereinheitlichen.)

**Übernahme des alten Spielstands**
13. Liegt eine echte Backup-Datei der alten Version vor? (Bisher nur an nachgebauten Daten geprüft – das ist der wichtigste offene Punkt.)
14. Wie heißen die Session-Notizen in der alten Version? (Erkannt: „Session 12“, „Sitzung 12“, „Spielabend 12“, „Session #12“.)
15. Meinungsskala alt → neu: Hass −3, Abneigung −2, Skepsis −1, Wohlwollen +1, Zuneigung +2, Liebe +3; gleiche Meinung bei allen sechs → Haltung zur Gruppe. (So umgesetzt.)
16. Sollen die sechs Porträts aus der alten Version übernommen werden? Sie stecken im Programm (`public/character-portraits.js`), nicht im Backup.
17. Dungeon-Notizen, Rastprotokolle, Explorationen, gespeicherte Routen: jetzt als Text sichern oder auf die eigenen Bereiche der zweiten Welle warten? (Werden derzeit im Bericht als „nicht übernommen“ genannt.)

**Desktop**
18. Welche macOS-Version? (Voraussetzung macOS 12 oder neuer.)
19. Ist das Repository privat? (Dann kosten Mac-Bauten bei GitHub Actions Freiminuten, grob 150–250 Minuten je Version.)
20. Sollen Warnungen beim ersten Start verschwinden? (Nur mit Apple-Entwicklerkonto, ca. 99 $/Jahr, und Windows-Zertifikat.)

## 6. Bekannte Mängel und Aufräumliste

- Doppelte Hilfen zusammenführen: Bild verkleinern (`welt/image.ts`, `gruppe/image.ts`),
  Charakterbogen-Link (`tisch/model.ts` `sheetLink`, `gruppe/model.ts` `sheetHref`), mehrtägige
  laufende Termine (`tisch/model.ts`, `kalender` `spansBetween`), Chronik-Einträge ändern/löschen
  (`tisch/commands.ts`, `chronik`), `undoMove` (`tisch`) und `movePartyTo` (`welt`) → nach
  `src/data/actions.ts` bzw. `src/ui`.
- `MentionInput` (@-Verweise, `tisch/Journal.tsx`) auch im Dialog „Festhalten“ verwenden.
- „Festhalten“ kennt nur die aktuelle Weltzeit; aus dem Kalender für vergangene Tage festhalten.
- Dialoge schließen bei Escape ohne Rückfrage, auch mit ungespeicherten Eingaben.
- Ein verschobener, schon abgehakter Termin bleibt abgehakt.
- Wiederkehrende Termine schreiben beim Zeitsprung keinen Chronik-Eintrag mehr (stehen nur in
  der Meldung) – bewusst so, damit lange Reisen die Chronik nicht füllen.
- Die Hauptdatei des Clients ist groß (Warnung beim Bauen); Bereiche bei Bedarf nachladen.
- Beispielwelt: „Vollmondmarkt“ liegt an einem Tag ohne Vollmond.
