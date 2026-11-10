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
| Wiki | `/wiki/:id?` | Eigenes Nachschlagewerk: Baum aller Artikel, Suche im ganzen Text, Artikel mit Steckbrief, Seiten, Karten mit Punkten, Rückverweise; „In die Welt aufnehmen“ |
| Einstellungen | `/einstellungen` | Kampagne, Sicherung herunterladen/einspielen, alten Spielstand (v157) übernehmen, Ladeprobleme, LegendKeeper, Kalender |
| LegendKeeper | (in Welt und Einstellungen) | Artikel suchen, lesen, verknüpfen; Key im Schlüsselbund; nur lesend |
| Desktop | `src-tauri/` | Tauri 2: Kampagnenordner, Dateiüberwachung, LegendKeeper-Abruf, Schlüsselbund, sicheres Schließen, ein Fenster je Kampagne; GitHub-Abläufe für Installationspakete |

Das Gerüst (Weltleiste, Navigation, Suche Strg+K, Festhalten Strg+E, Zeitdialog, Ortswechsel,
Haltungsdialog) und das Fundament (`src/domain`, `src/data`, `src/ui`) sind gemeinsam genutzt.

### Auf macOS und Windows bisher nur teilweise geprüft

Die erste Welle lief in einem Linux-Container. Die Rust-Tests der Desktop-Seite laufen seit dem
10. 11. auch auf echten Mac- und Windows-Rechnern bei GitHub grün (Ablauf „Desktop prüfen“; dabei
wurden drei Fehler gefunden und behoben: doppeltes `generate_context!` auf macOS, fehlendes
Manifest für Windows-Testprogramme, Menü außerhalb des Hauptthreads). Die Oberfläche selbst und
die Installationspakete sind auf Mac und Windows noch nicht gelaufen.
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
(Elaris-Grundstand; `http://localhost:1420/?reset#/` setzt sie zurück).

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

### 4.1 Zuerst: Fundament erweitern (eine Hand, vor den Bereichen) – ✅ erledigt

**Stand 10. 11. 2026, Zweig `welle2/fundament`:** Das Datenmodell unten ist in
`src/domain/schema.ts` angelegt, mit Tests in `src/domain/__tests__/schema.test.ts`. Noch ohne
Oberfläche; die Bereiche A–K bauen darauf auf. Festgelegt wurde dabei:

- Neue Arten `family`, `species`, `language` (mit `scriptId`), `script`, `ability`; Person hat
  `speciesId` und `workplaceId` (Ort oder Fraktion), das alte Freitextfeld `species` bleibt
  für Bestandsdaten. Neue Beziehungsarten `speaks`, `writes`, `has-ability` (Gruppe „Wissen und
  Können“); Familie über `member`.
- Ort hat `climateId` (null = Zone des übergeordneten Ortes).
- Sammlungen `maps`, `paths`, `journeys`, `mounts`, `climates`, `weather`, `areas`, `tables`,
  `rests`. Karten-Punkte sind `[x, y]` in Pixeln des Kartenbilds (wie in v157). `weather/`
  speichert nur festgehaltenes oder von Hand gesetztes Wetter (ID `<climateId>-<Tagesindex>`);
  das übrige wird reproduzierbar ausgewürfelt (Bereich F).
- Timer: Art `spell`, dazu `casterId`, `concentration`, `participants`. Der Timer-Dialog bietet
  „Zauber“ noch nicht an (Bereich G).
- Rast (`rests/`) mit Teilnehmern, Wachplan und Unterbrechungen ist ebenfalls schon angelegt,
  damit G das Fundament nicht ändern muss.
- Reittier-Vorgaben nach Regelwerk sind **noch nicht** eingetragen (`builtIn`), das macht E.
- Sicherungen der ersten Welle ohne die neuen Sammlungen spielen sich ohne Meldung ein.
- `repairReferences` kennt die neuen Verweise (Spezies, Arbeitsplatz, Klimazone, Wege, Karten,
  Reisen, Rasten, Wirker).

**Mit dem echten Backup geprüft** (`elaris-backup-2026-11-10.json`, liegt beim Spielleiter, nicht
im Repository): Übernahme ohne übersprungene oder unlesbare Teile – 71 Orte, 18 Personen,
6 Gefährten, 44 Beziehungen, 36 Chronikeinträge, 10 Termine, 2 Sessions; nach Speichern und
Neuladen identisch.

**Übernahme nachgezogen (10. 11. 2026, Zweig `welle2/uebernahme`):** Der Importer (`import/v157.ts`)
übernimmt jetzt auch Spezies, Fähigkeiten, Sprachen und Schriften als eigene Arten, Familien als
Art `family`, Spezies und Arbeitsort der Personen als Felder, Sprachen/Schriften/Fähigkeiten als
Beziehungen (`speaks`, `writes`, `has-ability`), Karten mit Maßstab und Kartenpunkten
(`maps`), Routen als Wege (`paths`), Erkundungen als Gebiete mit Würfeltabellen
(`areas`/`tables`), Rasten mit Wachen (`rests`) und bei Timern Wirker, Konzentration und
Teilnehmer (Konzentration → Art „Zauber“). Kartenpunkte ohne Ort werden einem vorhandenen Ort
zugeordnet (LegendKeeper-Kennung, sonst Name mit kleinen Schreibunterschieden); nur wo keiner
existiert, entsteht ein Ort der Art „Kartenpunkt“ (beim echten Backup genau einer). Echtes Backup
damit geprüft: nichts übersprungen, 6 Karten, 15 Kartenpunkte, 14 Wege, 1 Gebiet, 6 Tabellen,
2 Rasten. Weiterhin nicht übernommen: Dungeonräume, Tagging von LegendKeeper-Artikeln,
Gewaltmarsch-Prüfungen. Die Testdaten (`v157-voll.json`) nutzen jetzt das echte Kartenformat
(Schlüssel als JSON-Liste, Maßstab unter `elaris-travel-scale:<res>:<doc>:<B>x<H>`).

Ursprünglicher Plan:

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
| A | Welt erweitern ✅ | neue Arten, „arbeitet bei“, NSC-Galerie mit Porträts und Filtern (Ort, bekannt/unbekannt), Dossiers zeigen Familie, Spezies, Sprachen, Kartenpunkte und Ereignisse eines Ortes | 4.1 |
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

**Stand A (10. 11. 2026):** Die fünf neuen Arten stehen in Übersicht, Einstieg, Suche und
Dialog „Neuer Eintrag“. Personen haben Spezies (Auswahl; alter Freitext lässt sich mit einem Klick
übernehmen), „Arbeitet bei“ (Ort oder Fraktion) sowie Familien, Sprachen und Fähigkeiten – die drei
Listen laufen über Beziehungen (`member`, `speaks`, `has-ability`, Abgleich in
`welt/actions.ts` `syncLinkedRelations`). Dossiers: Familie mit Mitgliedern und Stammsitz,
Spezies mit Vertretern, Sprache mit Sprechern und Schrift, Schrift mit Sprachen, Fähigkeit mit
Trägern; Orte zeigen „Arbeiten hier“, Fraktionen zählen Arbeitende zu den Mitgliedern. Galerie der
Personen: links „Personen“ wählen, ohne offenen Eintrag – Porträts, Suche, Ortsfilter (auch Wohn-
und Arbeitsort), bekannt/unbekannt, Bekanntheit per Augen-Knopf umschalten. Verweise der
Einzelangaben stehen zentral in `DETAIL_LINKS` (`domain/derive.ts`); Löschen und Aufräumen nutzen
sie. **Offen:** Kartenpunkte eines Ortes (kommt mit D), NSC mit LegendKeeper-Artikel anlegen (C),
Beziehung „schreibt“ hat noch keine eigene Auswahl im Personen-Dialog.

Reihenfolge: 4.1 → (A, B, C, D, F, G, I, J, K parallel, soweit der Rechner trägt) → E → H.

## 5. Antworten des Spielleiters (10. 11. 2026)

Die Fragen aus den Prüfungen der ersten Welle sind beantwortet und – bis auf die unten als
„offen“ genannten – am 10. 11. 2026 umgesetzt (Zweig `welle2/antworten`):

- **3** Ein Klick unter „Orte hier“ öffnet „Die Gruppe zieht weiter“ mit dem Ort als Vorschlag;
  versetzt wird erst nach Bestätigung (`openMoveParty({ placeId })`).
- **7** Wiederkehrende Termine haben `skip` (Tagesindizes); im Kalender lässt ein Knopf am Termin
  dieses eine Mal ausfallen, der Termin-Dialog nimmt es wieder auf.
- **8** „Frühere Session nachtragen“ (Chronik → Sessions), `addPastSession`.
- **9** „Für die Spieler“ kopiert die Zusammenfassung ohne Notizen der Spielleitung, ohne
  Haltungen, ohne Einträge mit `secret` und ohne Personen, die die Gruppe nicht kennt.
  Chronikeinträge lassen sich als „Nur für die Spielleitung“ markieren.
- **10** Gefährten: `hp`, `initiative`, `spellSaveDc`, `darkvision`; Schaden und Heilung auf
  der Detailseite. Die Lange Rast setzt die Trefferpunkte noch nicht zurück (Bereich G).
- **11** Eigene Zustände: `campaign.customConditions`, anlegbar bei den Zuständen.
- **12** Trennen und Zurückkehren steht auch aus dem Bearbeiten-Dialog in der Chronik.
- **15** Haltungsskala mit elf Stufen (−5 Todfeind … +5 Ergeben), jede mit Bedeutung;
  alte Meinungen: Hass −4, Abneigung −2, Skepsis −1, Wohlwollen +2, Zuneigung +3, Liebe +5.

**Offen:** 2 (keine Änderung nötig), 6 (bleibt), 16 (Porträts kommen vom Spielleiter),
17 (entfällt).

**Zusätzlich gewünscht und gebaut (10. 11. 2026):**

- **Familien aus Nachnamen** (`welt/dynasty.ts`, `adoptFamilies`): beim Anlegen einer Person,
  nach der Übernahme des alten Spielstands und nach dem Nachladen der LegendKeeper-Namen;
  Titel, Beinamen und Einzelnamen ergeben keinen Nachnamen. Angelegte Familien tragen das
  Schlagwort „aus Nachnamen“.
- **NSC-Generator** (`welt/npc.ts`): Würfel-Knopf im Dialog „Neue Person“. Namen lernen den
  Klang der vorhandenen Namen (ab sechs Vorlagen, je Spezies), sonst allgemeine Silben;
  Tätigkeit nach Art des Ortes; Nachname oft vom selben Ort.
- **Wiederholbarer Zufall** (`domain/random.ts`: `rngOf`, `seedOf`) – Grundlage für alles
  Erzeugte (Wetter, Hexkarten, Begegnungen). Nie `Math.random` in Fachlogik.

**Desktop auf Windows (10. 11. 2026):** Rust 1.99 ist installiert, Visual Studio 2026 mit
C++-Werkzeugen war vorhanden. `cargo build` läuft durch, `cargo test`: 47 Tests grün.
Start mit laufender Vorschau: `npx tauri dev -c '{"build":{"beforeDevCommand":""}}'`.

**Hexkarten erzeugen (10. 11. 2026, Zweig `welle2/hexkarten`):** Neuer Bereich „Erkundung“
(`/erkundung/:id?`, `features/erkundung`). „Neue Hexkarte“ nimmt zwei Orte und erkennt aus der
Welt (`generate.ts` `recognize`): Entfernung und Richtung aus Kartenpunkten samt Maßstab, sonst
die Länge eines gespeicherten Weges, sonst fragt der Dialog; die Landschaft aus Namen, Art und
Schlagworten der Orte und ihrer Umgebung, aus Karten und Wegen; bekannte Orte am Weg aus den
Kartenpunkten. Daraus entsteht zusammenhängendes Gelände (weiches Rauschen für Höhe und Feuchte,
je Landschaft anders gelesen) mit Besonderheiten je Gelände – wiederholbar über `area.seed`.
Felder stehen auf der Spitze (`orientation: 'pointy'`), damit Ost–West eine gerade Reihe ist.
Die Karte zeigt Gelände, Besonderheiten, Orte, den direkten Weg und Unentdecktes gedämpft; je
Feld lassen sich Gelände, Besonderheit, Ort, „Was hier wartet“, Notiz und „entdeckt“ ändern;
„Neu würfeln“ baut das Gelände neu. Neue Felder im Modell: `hex.feature`, `area.fromId`,
`toId`, `biome`, `seed`, `distanceKm`. **Noch nicht gebaut:** die Reise selbst (Position der
Gruppe, Reisetage, Begegnungen aus Tabellen, Wetter), Flüsse und Straßen als Linien, die Karte
über einem Kartenbild. Die aus der alten Version übernommene Erkundung erscheint in der Liste,
hat aber nur ihre zwei besuchten Felder.

**Namen aus LegendKeeper (10. 11. 2026):** `import/NameSync.tsx` trägt Namen von selbst ein,
sobald die Verbindung steht, und zeigt in der Welt einen Hinweis, solange sie fehlen.

**LegendKeeper ganz übernehmen (10. 11. 2026) – erster Teil gebaut.** Der Spielleiter will
LegendKeeper kündigen und alles in Wayfarer haben. Weg: die **Exportdatei** des Projekts
(„.lk“ = gepacktes JSON mit allen Artikeln, Seiten, Steckbriefen, Karten und Kartenpunkten),
nicht die Schnittstelle. Bereich `features/wiki/`:

- `lkexport.ts` liest die Datei ohne Vertrauen und wandelt sie um: Artikel (Sammlung
  `articles`, Kennung = Kennung in LegendKeeper), Inhalt als dieselben Knoten, die
  `legendkeeper/Article.tsx` schon darstellt, Karten (Sammlung `maps` mit `image`,
  `markers[].articleId`, `shapes`). Kartenpunkte stehen im Kachelraster; der Faktor zu
  Bildpunkten ist die Zweierpotenz, in die das Bild passt (`pinScale`) – gegen die Anker des
  alten Backups geprüft, nicht `max_zoom`. Vorlagen (`parentId: 'templates'`) werden als
  `template` markiert.
- `recognize.ts` erkennt Personen, Orte, Fraktionen, Gegenstände aus Steckbrief-Vorlage,
  Schlagworten, Symbol und Karte – nur bei eindeutigen Hinweisen; Ordner, Vorlagen und Entwürfe
  bleiben draußen.
- `apply.ts` (`planLkImport`, reine Funktion) ergänzt den Spielstand: nichts Eingetragenes
  wird überschrieben, vorhandene Einträge finden ihren Artikel über Verknüpfung oder Namen
  (Gefährten auch über den Vornamen), ein zweites Einlesen legt nichts doppelt an. Abgeleitet
  werden übergeordneter Ort, Wohnort, Sitz und Beziehungen; Familien entstehen ab zwei Trägern
  eines Nachnamens. Zurücknehmen geht, solange seither nichts geändert wurde.
- Oberfläche: Einstellungen → „LegendKeeper ganz übernehmen“ (`einstellungen/WikiImportSection`),
  Bereich „Wiki“, im Dossier der Reiter „Artikel“ (statt „LegendKeeper“), Suche Strg+K findet
  auch Artikel.
- Mit dem echten Export geprüft (nur lokal): 656 Artikel, 861 Seiten, 64 Karten, 174
  Kartenpunkte; alle 15 namenlosen Personen tragen ihren Namen.

**Bilder auf dem Rechner (10. 11. 2026) – gebaut.** Im Spielstand bleibt bei jedem Bild die
Adresse stehen, von der es stammt. „Bilder holen“ (Einstellungen → LegendKeeper ganz übernehmen,
`einstellungen/MediaSection`) lädt sie in den Kampagnenordner unter `media/<letzter Teil der
Adresse>`; angezeigt wird die Datei von dort, sobald sie da ist (`data/media.ts`:
`useMediaSrc`), sonst die Adresse im Netz. Rust-Seite: `src-tauri/src/media.rs` (nur https,
keine IP-Adressen, nur echte Bilddateien, atomar geschrieben), Befehle `media_list` und
`media_fetch`, Adressschema `wfmedia` für die Anzeige (in `tauri.conf.json` unter `img-src`
erlaubt). Die Ablage (`store.rs`) sieht den Ordner nicht. Unter Windows in der echten App
geprüft (Holen, Anhalten, Anzeige); **auf macOS noch nicht**. Gemessen: 481 Bilder, 1,35 GB,
etwa drei Minuten.
- Die Sicherungsdatei enthält die geholten Bilder nicht; auf einem zweiten Rechner holt man sie
  neu (solange der Ursprung besteht) oder kopiert den Ordner `media`.
- **Vor einer Kündigung von LegendKeeper** müssen die Bilder auf **beiden** Rechnern geholt sein
  – oder der Ordner `media` wird mit dem Spielstand abgeglichen. Für den Abgleich über GitHub
  (Bereich I) ist er mit 1,35 GB zu groß; dafür braucht es kleinere Fassungen der Bilder oder
  einen anderen Weg.
- Offen: kleine Vorschaubilder für Listen (jetzt werden die großen Bilder erst beim Hinsehen
  geladen), ein Bild von Hand ersetzen, Aufräumen nicht mehr gebrauchter Dateien.

**Noch offen, in dieser Reihenfolge:**
1. Zeitleisten (8) und Kalender des Exports – Ereignisse in den Kalender übernehmen.
2. Artikel in Wayfarer schreiben und ändern (eigener Editor), Vorlagen nutzen.
3. Die Zeichenfläche („Board“, 1) bleibt außen vor.
4. Karten des Wikis mit Karten/Wegen (Bereich D) zusammenführen: Maßstab, Wege, Reisen.

**Nächste große Schritte nach dem Leitbild** (`docs/FUNKTIONSUMFANG.md`): Wettersimulation (F),
Hexkarte zwischen zwei Orten erzeugen (H, auch ohne Karte), Karten und Wege (D), Reisen (E),
LegendKeeper-Einordnung mit selbstständigem Erkennen von Orten und Lage (C).

**Am Tisch**
1. Bildschirm: Geleitet wird an einem **MacBook Air 13" (M1, 8 GB)**, etwa 1440×900. Vorbereitet
   wird an einem **Windows-PC**. Jede Oberfläche ist in 1440×900 zu prüfen (zusätzlich zu
   1280×800 und 1600×950). Der Abgleich Mac ↔ Windows (Bereich I) ist damit wichtig.
2. Die Spieler sehen den Bildschirm **nicht**. Spielleiterwissen bleibt offen sichtbar.
3. Ein Klick auf einen Ort darf die Gruppe **nicht** versetzen. Die Gruppe wird nur bewusst
   versetzt (eigener Knopf mit Rückfrage) oder durch Reisen und das laufende Spiel.
4. „Anstehend“: Spieltisch 7 Tage, Kalender 30 Tage – bleibt.

**Kalender und Chronik**
5. Die Woche beginnt mit Ruhnacht – bleibt.
6. Vorhaben und Fristen bleiben überfällig, bis sie abgehakt sind – bleibt vorerst.
7. Wiederkehrende Termine: einzelne Male sollen ausfallen können.
8. Vergangene Sessions (1–11) sollen sich nachträglich anlegen lassen.
9. Eine Zusammenfassung einer Session ohne Spielleiterwissen zum Weitergeben ist gewünscht.

**Gefährten**
10. Gewünschte Werte: Initiative, Zauberrettungswurf-SG, Dunkelsicht, aktuelle Trefferpunkte.
11. Eigene Zustände neben den 14 des Regelwerks sind gewünscht.
12. Trennen und Zurückkehren eines Gefährten steht immer in der Chronik.

**Übernahme des alten Spielstands**
13. Echtes Backup liegt vor und ist geprüft (siehe 4.1).
14. Session-Notizen heißen im echten Backup „Session 12“ / „Session 13“ – wird erkannt.
15. Die Haltungsskala soll **deutlich feiner und klarer** sein als die sieben Stufen der ersten
    Welle. Die Ausgestaltung ist dem Bau überlassen.
16. Die sechs Porträts hat der Spielleiter auf dem Rechner und liefert sie nach.
17. Der Dungeonraum der alten Version wird weggelassen.

**Desktop**
18. macOS: die neueste Version, die auf dem M1 läuft – Voraussetzung (macOS 12) erfüllt.
19. **Das Repository ist öffentlich.** Folgen: GitHub Actions kostet keine Freiminuten. Es darf
    **nie** ein Spielstand, ein Backup, ein Schlüssel oder sonst etwas Privates hineingeraten.
    Der Abgleich des Spielstands (Bereich I) braucht ein **eigenes, privates** Repository.
20. Warnungen beim ersten Start sind in Ordnung – keine Signierung nötig.

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
