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

**Spieltisch und Wiki (10. 11. 2026):** Im Kopf des Ortes öffnen „Karte“ und „Artikel“ ein
Fenster über dem Tisch (`tisch/WikiPeek.tsx`, `tisch/wiki.ts`): die Karte des Ortes und die der
Orte darüber, der Artikel zum Blättern. Auf jeder Karte ist markiert, wo die Gruppe steht
(`wiki/MapView.tsx`); ein Klick auf einen Kartenpunkt bietet „Artikel lesen“, „In der Welt
öffnen“ und „Gruppe hierher versetzen“. Neben der Besetzung steht ein Auszug „Aus dem Wiki“.
Wer an einem Ort wohnt und keinen anderen Aufenthalt hat, zählt als anwesend.

**Welt eingrenzen (10. 11. 2026):** `welt/scope.ts` – „Bereich“ (Ort der Gruppe oder ein Ort
darüber: zeigt nur, was dazugehört) und „Nur Bekanntes“ (getroffene Personen, besuchte Orte).

**Wetter (10. 11. 2026) – Bereich F, erster Teil gebaut.** `domain/weather.ts` rechnet das
Wetter eines Tages aus Klima, Kalender, Ausgangswert und Tag – ohne etwas zu speichern und ohne
die Tage davor durchzugehen. Feuchte, Wind und Temperatur folgen Wetterlagen über mehrere Tage
(`drift`: gleitender Mittelwert von Zufallswerten, zurückgerechnet auf Gleichverteilung, damit
die Häufigkeiten des Klimas stimmen). Der Tag hat vier Abschnitte mit eigener Temperatur,
Niederschlag und Nebel. Folgen nach Regelwerk 2024: extreme Kälte/Hitze, starker Wind, starker
Niederschlag, Nebel. `domain/weatherZone.ts` findet die Klimazone eines Ortes: festgelegt
(`place.climateId`, gilt für alles darunter) vor erkannt (Worte in Namen, Art, Schlagworten;
unter der Erde gibt es kein Wetter) vor der Vorgabe „Gemäßigt“. Neun Vorgaben (`PRESET`); als
Klimazone gespeichert werden sie erst, wenn etwas daran hängt. Der wärmste Monat steht in der
Kampagne (`warmestMonth`; für Elaris angenommen: Hochbrand) und ist in den Einstellungen unter
„Kalender“ wählbar. Oberfläche: `features/wetter` – Feld in der Weltleiste (Tagesverlauf, vier
Tage Vorschau, Regelfolgen, „Heute festlegen“, „Klima festlegen“), Zeile am Spieltisch.
- Orte derselben Zone unter demselben Ort haben dasselbe Wetter. Entfernung spielt noch keine
  Rolle; dafür braucht es die Lage der Orte auf Karten (Bereich D).
- Offen: Wetter im Kalender, Wetter auf Reisen (Bereich E), Südhalbkugel, eigene Klimazonen mit
  eigenen Monatswerten bearbeiten.

**Reisen auf der Hexkarte (10. 11. 2026) – Bereich E, erster Teil gebaut.** Eine Hexkarte
kennt jetzt die Stellung der Gruppe (`area.party`: Feld, Tempo, Reisezeit des Tages, bisheriger
Weg). `erkundung/travel.ts` (reine Funktionen): Dauer je Feld aus Feldgröße, Tempo (2/3/4 Meilen
je Stunde) und Gelände (`TERRAIN_MAX_PACE`: Gebirge und Sumpf nur langsam, Wald/Hügel/Wüste
höchstens normal, Wasser zu Fuß gar nicht); ein Schritt deckt das Feld und seine Nachbarn auf;
ab der neunten Reisestunde eines Tages Gewaltmarsch (Rettungswurf SG 10 + Stunden darüber);
`routeTo` sucht den schnellsten Weg zum Ziel um Wasser herum; `rollEncounters` würfelt
wiederholbar auf den Tabellen des Feldes oder Gebiets. `travelTo` (actions) lässt die Reisezeit
über `advanceTime` vergehen – Termine treten ein, Timer laufen ab – und lässt sich
zurücknehmen. Oberfläche: Fläche „Reise“ rechts neben der Karte (Tempo, heute gereist, Wetter,
Rest bis zum Ziel, „Weiterziehen“, Ergebnis des letzten Schritts), auf der Karte die Gruppe, ihr
bisheriger und der geplante Weg; im Feld „Hierher ziehen“ oder „Gruppe hierher setzen“. Am Ziel
bietet Wayfarer an, die Gruppe an den Ort zu versetzen (der Eintrag in der Chronik entsteht dort).
- Die Reisezeit zählt je Welttag, nicht seit der letzten Rast.
- Offen: Tabellen in der Oberfläche anlegen und einem Gebiet zuordnen (bisher nur aus der alten
  Version übernommen), Begegnungen ohne eigene Tabelle, Wetterfolgen fürs Tempo, Reittiere und
  Fahrzeuge, Boote über Wasser, Lager und Wachen unterwegs, Eintrag der ganzen Reise in der
  Chronik, Teilgruppen.

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

**In Wayfarer schreiben (10. 11. 2026) – dritte Welle, Stufen 1 bis 4 gebaut.** Entscheidung des
Spielleiters: Er will künftig nur noch in Wayfarer schreiben („schreiben, simpel verbinden und
managen – anstatt 20 Jahre Datensätze zu pflegen“), mit einem Editor wie in Obsidian (schöne
Ansicht und Quelltext). Ziel: aus Text eine simulierte Welt. Eine eingebaute KI, die Geld kostet,
ist ausgeschlossen; alles Erkennen läuft über festen Code.
- **Artikel sind Text.** Jede Seite hat `text` (Markdown). Dialekt in `wiki/markdown.ts`:
  `[[Titel]]`, `[[Titel|gezeigter Text]]`, `[[Titel~kennung]]` (nur bei doppelten Titeln), Kästen
  `> [!steckbrief]` (Zeilen „Feld: Wert“, Bild, `**Gruppentitel**`), `> [!geheim]`, `> [!info]`,
  `> [!warnung]`, `> [!aufklappen] Titel`; `==markiert==`, Tabellen, Bildzeilen. Die alte Form
  (Knoten, eigener Steckbrief) wird beim Lesen umgeschrieben und beim ersten Speichern ersetzt
  (`wiki/text.ts`). An den echten Daten geprüft: 877 von 899 Seiten kommen gleich wieder heraus,
  der Rest unterscheidet sich nur harmlos.
- **Verweise** führen über den Titel, dann über Zweitnamen. Umbenennen, Anlegen, Löschen und neue
  Zweitnamen ziehen alle Verweise nach (`relinked`). Ein neuer Import überschreibt nicht, was in
  Wayfarer geändert wurde (`source: 'wayfarer'`).
- **Editor** (`wiki/editor`, CodeMirror 6, eigener Ladeblock): Ansichten Lesen / Schreiben /
  Quelltext (Strg+E wechselt), Vorschläge nach `[[` und `@`, Listen und Kästen setzen sich fort,
  Suche im Text, Werkzeugleiste. `wiki/PageEditor.tsx` speichert 0,6 s nach dem letzten
  Tastendruck und vor jedem anderen Handgriff (`flushEdits`). Beim Tippen wird nur die geänderte
  Seite neu gelesen (`linkIndex().stamp`).
- **Verwalten** (`wiki/ArticleTools.tsx`): neuer Artikel (auch als Unterartikel), verschieben,
  Schlagworte und Zweitnamen, löschen mit Rückgängig; Seiten hinzufügen, umbenennen, entfernen.
- **Erwähnt, aber noch nicht angelegt:** Verweise ohne Artikel sind gestrichelt, ein Klick bietet
  das Anlegen an; die Startseite des Wikis listet sie (`wantedArticles`).
- Geprüft im Browser (1440×900, 1280×800) mit dem echten Export. **Nicht geprüft:** die
  installierte App und macOS (Befehlstaste, WebKit).
- Offen im Editor: Tabellen nur als Quelltext, Bilder einfügen nur per Adresse, kein
  Rechtschreibprüfer, Vorlagen beim Anlegen nutzen, Steckbrief in der Schreibansicht steht über
  statt neben dem Text.
- **Stufe 3 – der Steckbrief speist die Welt** (`wiki/facts.ts`, reine Regeln mit Test):
  - Gelesen werden die Zeilen „Feld: Wert“ aller Steckbriefe eines Artikels. Was ein Feld
    bedeutet, hängt von der Art des Eintrags ab (`VOCABULARY`): Person – Titel/Beruf (Rolle),
    Spezies, Status, Aufenthaltsort, Wohnort, Herkunft, Arbeitet bei, Zugehörigkeit; Ort – Liegt
    in/Region/Ort, Art, Herrscher, Besitzer; Fraktion und Familie – Sitz, Führung, Art;
    Gegenstand – Besitzer. Unbekannte Felder (Haare, Stimme …) bleiben reiner Text.
  - Die Werte der echten Steckbriefe sind Text ohne Verweise. Wayfarer findet den Eintrag über
    einen Verweis oder den Namen (`worldIndex`: Name, Zweitnamen, Titel des Artikels, auch ohne
    „Der/Die/Das“); bei „Region, Ort“ zählt der genauere Ort. Die Herkunft gilt als Zuhause,
    solange kein Wohnort dasteht.
  - Ein Artikel ohne Eintrag bekommt einen, wenn sein Steckbrief verrät, was er beschreibt:
    „Art: Dorf“ (Wortliste `KIND_WORDS`, auch als Wortende: „Bergdorf“) oder Felder, die nur
    Personen haben (Spezies und eines mehr). Die Art eines bestehenden Eintrags ändert sich nie.
  - **Wer gewinnt:** Der Eintrag merkt sich je Angabe den Wortlaut, den er übernommen hat
    (`entity.fromArticle`). Ändert sich der Wortlaut im Artikel, gilt der Artikel. Bleibt er
    gleich, bleibt, was seither von Hand geändert wurde (ein NSC zieht am Tisch weiter).
    Beziehungen aus dem Steckbrief tragen `relation.articleId`; nur sie fallen weg, wenn die
    Zeile verschwindet.
  - `syncFacts` (`wiki/actions.ts`) schreibt und liefert `undo`. Ausgelöst wird es beim
    Verlassen des Editors (`PageEditor`), am Artikel („Übernehmen“) und für alle auf der
    Startseite des Wikis („Alle Steckbriefe übernehmen“, `wiki/FactsHint.tsx`). Namen ohne
    Eintrag stehen dort zum Anlegen (`createNamedEntity`).
  - Probelauf mit dem echten Export: 39 Einträge bekamen Angaben, eine Person wurde an ihren
    Feldern erkannt, 12 Namen blieben ohne Eintrag; der Lauf dauert unter 0,2 s.
  - Offen: Zeitleisten-Felder (Zeitraum, Beteiligte, Zeitalter) lesen; gebeugte Namen („Altes
    Zollhaus“ für „Das Alte Zollhaus“); die Welt zeigt noch nicht an, welche Angaben aus dem
    Steckbrief stammen; nach einer Übernahme aus LegendKeeper läuft das Auswerten nicht von
    selbst (seit 10. 11.: doch – `applyLkImport` liest die Steckbriefe gleich mit, wenn das
    Erkennen der Einträge eingeschaltet ist); Zweitnamen aus dem Steckbrief werden bewusst nicht
    übernommen.
- **Stufe 4 – Erkennen über Code** (alles feste Regeln mit Test, nichts davon ändert den Text):
  - **Namen ohne Klammern** (`wiki/names.ts`): Steht der Titel oder ein Zweitname eines anderen
    Artikels im Text, wird er beim Lesen zum Verweis (`mention.implicit`, gepunktet
    unterstrichen), zählt als Rückverweis und im Steckbrief als Verweis. Genau geschrieben, als
    ganzes Wort oder mit angehängtem „s“; der Titel ohne „Der/Die/Das“ nur, wenn ein solches Wort
    davorsteht. Außen vor: Namen unter drei Zeichen, klein geschriebene Titel, Allerweltswörter
    (`COMMON`), Vorlagen und Artikel mit `autoLink: false` (Schalter unter „Schlagworte und
    Zweitnamen“). Eingesetzt in `pageNodes`; gilt je Stand der Titel (`linkIndex().stamp`).
    Im echten Export: rund 2 700 erkannte Namen zu 253 gesetzten Verweisen.
  - **Daten** (`domain/time/textDates.ts`): „17. Tauwind 701 AD“, „17. Tauwind“, „Tauwind 701“,
    „701 AD“ – Muster aus den Monatsnamen und Zeitrechnungen des Kalenders. Im Artikel
    anklickbar; der Hinweis nennt Wochentag und Abstand zu heute, der Klick öffnet den Kalender
    an dem Tag (`kalender/focus.ts`). Ohne Jahr gilt das laufende. Zeitrechnungen, die der
    Kalender nicht kennt, werden nicht gelesen.
  - **Satzmuster** (`wiki/sentences.ts`): „Schwester von X“, „dient dem Y“, „Mitglied der Z“,
    „lebt in W“ … ergeben Vorschläge für Beziehungen – nur, wenn das Schlüsselwort unmittelbar
    vor einem bekannten Namen steht und die Arten passen. Das Subjekt ist der Name am Satzanfang,
    sonst der Eintrag des Artikels. Verneintes, Vergangenes und Vermutetes wird nicht gelesen.
    Es bleibt beim Vorschlag („Eintragen“ / „Stimmt nicht“, am Artikel und gesammelt auf der
    Startseite des Wikis); Abgelehntes merkt sich der Artikel (`dismissedHints`). Im echten
    Export nur eine Handvoll Treffer – die Texte nutzen diese Wendungen selten.
  - **Oft zusammen genannt** (`coMentions` in `wiki/model.ts`): unter dem Artikel, wer mindestens
    zweimal im selben Absatz mit ihm steht.
  - **Vornamen und Nachnamen allein** (`linkShortNames` in `wiki/names.ts`): nur auf der
    Seite, auf der die Person mit vollem Namen oder als Verweis steht – nie über die ganze Welt
    (bei tausenden NSC wäre kein Vorname eindeutig). Zwei Träger desselben Namensteils auf einer
    Seite, oder der Artikel selbst und ein weiterer: bleibt Text. Ob ein Artikel eine Person
    beschreibt, liest das Wiki an Symbol, Schlagworten oder Steckbrief ab (`isPersonArticle`).
  - Offen: gebeugte Namen, Namen über
    Auszeichnungsgrenzen hinweg; erkannte Namen im Editor zeigen und auf Wunsch in echte
    Verweise umwandeln; Daten aus Zeitleisten-Steckbriefen in den Kalender übernehmen; mehr
    Satzmuster nach dem Sprachgebrauch der echten Texte.

**Rast (10. 11. 2026) – Bereich G, gebaut.** `domain/rest.ts` rechnet nach D&D 2024: Kurze Rast
eine Stunde; Lange Rast acht Stunden, jeder wacht höchstens zwei (`proposeWatches` verteilt
reihum, zeigt je Wache die höchste Passive Wahrnehmung); danach Trefferpunkte voll und
Erschöpfung −1; eine Lange Rast je 24 Stunden (16 Stunden Abstand, als Hinweis, nicht als
Sperre). `gruppe/rest.ts` `takeRest` lässt die Zeit über `advanceTime` vergehen, legt ein
Dokument in `rests` an und schreibt die Chronik; alles mit `undo`. Eine Rast kann gestört enden
(„Störung nach 3 Std.“ – in Meldung und Chronik steht, wer gerade wachte) und später fortgesetzt
werden: Rest der acht Stunden plus eine Stunde je Störung. Fenster: `gruppe/RestDialog.tsx`,
geöffnet über `openRest` (Weltleiste › Zeit, Seite „Gefährten“). Der alte Knopf „Lange Rast
abschließen“ (ließ die Zeit stehen) ist ersetzt.
- Offen: Trefferwürfel bei der Kurzen Rast, Zauberplätze, Lager unterwegs auf der Hexkarte,
  Teilgruppen an verschiedenen Orten, Rast als Eintrag im Kalender.

**Wetter im Kalender (10. 11. 2026) – gebaut.** Jedes Tagesfeld trägt ein Wetterzeichen (auffällig
bei Folgen nach dem Regelwerk), die Tagesansicht den Abschnitt „Wetter“ mit den vier
Tagesabschnitten und den Regelfolgen (`wetter/DayWeather.tsx`, `dayGlance`/`dayEffects` in
`domain/weather.ts`). Es gilt das Wetter am Ort der Gruppe – errechnet, also auch für kommende
Tage. Offen: Wetter vergangener Tage an dem Ort, an dem die Gruppe damals war.

**Auffangstelle (10. 11. 2026).** `shell/ErrorBoundary.tsx` umschließt die Bereiche: Scheitert der
Aufbau einer Seite oder lädt ein Teil nicht, bleiben Navigation und Weltleiste bedienbar, und es
steht da, wie es weitergeht.

**Atlas – Lage und Weltkarte (11. 11. 2026) – vierte Welle, Schritte 1 und 2 gebaut.** Der
Spielleiter hält den Globus für wichtig: Wayfarer soll wissen, wo etwas liegt.
- **Quelle:** der alte Atlas (Ordner `Atlas-Elaris` auf dem Desktop des Spielleiters, nur lokal,
  nie ins Repository). Brauchbar: `inputs/world.json` (Planet, Küsten der Landmassen als Ringe,
  Seen, Flüsse) und `artifacts/4096x2048/height.f32` (Höhenkarte). Orte mit Position gibt es
  dort keine.
- **Rechnen** (`domain/geo.ts`, mit Test): Entfernung über die Oberfläche, Richtung, Zielpunkt,
  Punkt im Ring (auch über die Datumsgrenze und um die Pole), Küsten vereinfachen, Höhe aus dem
  Raster, Tageslänge aus Breite und Achsneigung.
- **Daten:** Sammlung `atlas` mit zwei Dokumenten – `planet` (Radius, Tag, Jahr, Achsneigung,
  Landmassen mit Ringen und Löchern, Seen, Flüsse) und `relief` (Höhen 1024 × 512, 16 Bit,
  Base64). Orte haben `place.geo` (Länge, Breite); ohne eigene Lage gilt die des nächsten
  übergeordneten Ortes (`placeGeo`).
- **Übernahme:** Einstellungen → „Atlas übernehmen“ (`einstellungen/AtlasSection`,
  `atlas/import.ts`): Weltdatei wählen, Vorschau, übernehmen; Höhenkarte dazu. Küsten werden auf
  etwa 700 m vereinfacht (79 000 → 50 000 Punkte), die Höhenkarte gemittelt verkleinert.
- **Weltkarte:** Bereich „Atlas“ (`features/atlas`): der Planet flach ausgebreitet, verschieben
  und vergrößern, Gelände nach Höhe gefärbt mit Licht von Nordwesten, scharfe Küsten, Seen,
  Flüsse, Gradnetz, Maßstab. Links die Orte (große zuerst); Ort wählen, auf die Karte klicken –
  gesetzt. Unter dem Zeiger: Lage, Landmasse oder Meer, Höhe. Am gewählten Ort: Luftlinie und
  Richtung von der Gruppe, Tageslicht heute (`daylightAt`; die Sonnenwende wird am Beginn des
  wärmsten Monats angenommen).
- Geprüft in der Vorschau mit den echten Dateien. **Nicht geprüft:** installierte App, macOS.
- **Schritt 3 – aus der Lage rechnen (gebaut, 11. 11. 2026):**
  - *Grundlage:* Der Planet zum Fragen (`planetOf`, `reliefOf`, `terrainAt`, `placeGeo`) liegt
    jetzt in `domain/planet.ts`, damit auch das Wetter ihn nutzen kann; `atlas/model.ts` reicht
    alles weiter. Neu: `coastKm` – wie weit das offene Meer ist (Ringe bei 60, 150, 300, 600 km).
  - *Klima* (`domain/geoClimate.ts`): aus Breite (unter 20° Tropen, bis 35° warm oder fern vom
    Meer Wüste, bis 55° gemäßigt oder nahe am Meer Küste, bis 68° kalt, darüber Eisland), Höhe
    (über 300 m je 1 000 m 6,5 °C kälter, ab 1 800 m Wind, Nebel und Niederschlag des Gebirges)
    und Küstennähe. Auf der Südhalbkugel liegt der wärmste Monat ein halbes Jahr versetzt.
    `weatherZone`: festgelegt → unter der Erde → Lage oder Worte, je nachdem, was näher am Ort
    steht (auf gleicher Stufe gehen „Wüste“, „Gletscher“ … der Lage vor, „Hafen“ und „Insel“
    nicht) → „Gemäßigt“. Die Wetteranzeige nennt, woraus gerechnet wurde.
  - *Sonne* (`sunAt` in `atlas/model.ts`): Aufgang, Untergang, Tageslänge am Ort der Gruppe in
    der Wetteranzeige; Tag und Nacht der Anzeige richten sich danach. Polartag und Polarnacht.
  - *Reisen* (`erkundung/generate.ts`): `recognize` misst Entfernung und Richtung auf dem
    Planeten, wenn beide Orte eine eigene Lage haben (sonst Karte, Weg, zuletzt grob über die Lage
    der Orte darüber), findet Orte mit Lage am Weg und liest die Landschaft aus dem Klima auf
    halber Strecke, wenn kein Wort auf eine deutet. `groundOf` + `groundTerrain`: Die Hexkarte
    nimmt Meer, Seen, Küste, Hügel (ab 600 m) und Gebirge (ab 1 600 m) vom Atlas; im Tiefland
    entscheidet die Landschaft, erfindet aber kein Gewässer und kein Gebirge dazu. Der gerade Weg
    darf dann übers Meer führen – zu Fuß ist dort kein Durchkommen. Im Atlas steht am gewählten
    Ort neben der Luftlinie die Reisedauer zu Fuß.
  - Geprüft mit Tests (`atlas/position.test.ts`, erfundene Welt) und in der Vorschau mit zwei
    probehalber gesetzten Orten (danach wieder entfernt). **Nicht geprüft:** installierte App,
    macOS. Offen: Flüsse und Straßen auf Hexkarten, Wege um das Meer herum statt Luftlinie,
    Dunkelheit als Reiseregel, Klima im Kalender je Ort anzeigen.
- **Schritt 4 – die Kugel (gebaut):** Umschalter „Karte / Kugel“ im Atlas. `atlas/Globe.tsx` malt die
  Welt einmal flach in ein Bild (4096 × 2048); die Grafikkarte rechnet für jeden Bildpunkt der
  Scheibe aus, welche Stelle zu sehen ist (WebGL, ohne weitere Bibliothek). Darüber liegt eine
  zweite Zeichenfläche für Gradnetz, Orte, Gruppe und alle Eingaben. Ziehen dreht, das Rad
  vergrößert; Orte setzen und wählen wie auf der Karte. Gemessen: rund 10 ms je Bewegung (die
  erste Fassung rechnete jeden Bildpunkt im Programm und ruckelte). Kann die Grafikkarte nicht,
  steht ein Hinweis da und die flache Karte bleibt.
- **Landmassen aus Kartenbildern (gebaut, 11. 11. 2026):** Der alte Atlas kennt nur die sieben
  Kontinente; zwei weitere Kontinentalwelten liegen dem Spielleiter als Bilder vor. Im Atlas, Knopf
  „Landmasse aus einem Kartenbild einlesen“ (`atlas/TraceDialog.tsx`, Rechnung in
  `atlas/trace.ts`, mit Test):
  - *Lesen:* Land oder Wasser entscheidet die Ähnlichkeit zu gewählten Farben – „diese Farben
    sind Wasser“ (alles andere Land) oder „diese Farben sind Land“. Jeder Klick ins Bild nimmt die
    Farbe der Stelle dazu (bis zu acht), ein Klick aufs Farbfeld nimmt sie heraus. Regler:
    Ähnlichkeit, kleinste Fläche (Schrift und Zierrat fallen weg), Weichzeichnen (für gemalte
    Karten), „Bildrand abschneiden“ (`cropMask`: Titel, Maßstab oder Land am Rand, das nicht
    dazugehört – etwa Eis eines Pols – gilt dann als Meer). Flache, einfarbige Karten gehen mit einer Farbe; eine gemalte Karte braucht mehrere
    Wassertöne und Weichzeichnen und bleibt ungefähr (Wolken und Schrift am Land zählen mit).
  - *Einpassen* (`placeShape`): als **Gebiet** – Mitte per Klick, Breite in Kilometern (am
    Maßstab des Bildes abgelesen), Drehung; das Bild liegt flach auf der Kugel auf, Formen
    bleiben auch am Pol erhalten – oder als **Weltstreifen** in Grad (für Bilder wie die
    Weltkarte, „Von Pol zu Pol“). Übernehmen legt die Landmasse in den Planeten
    (`addLand`, Kennung `bild-…`, ohne Höhen: flaches Land); rückgängig über die Meldung,
    entfernen in der Liste „Aus Bildern eingelesen“. Die Weltdatei neu einzulesen lässt sie stehen.
  - *Zeichnen:* Eingelesene Landmassen dürfen über anderem Land liegen und um einen Pol reichen.
    Darum hat jede ihre eigene Fläche (`landPaths`), und ein Ring um den Pol bringt seine Kopien
    selbst mit und wird einmal gezeichnet (`LandPath.once`) – sonst hebt sich überlappendes Land
    beim Füllen gegenseitig auf.
  - Geprüft in der Vorschau mit den beiden Bildern des Spielleiters (nur lokal): Karte und
    Geländeabfrage stimmen überein, auch nach dem Verschieben. Die Lage dort war nur eine Probe;
    die echte setzt der Spielleiter in seiner App. **Nicht geprüft:** installierte App, macOS.
  - Offen: Höhen für eingelesene Landmassen; Stellen von Hand wegnehmen (Wolken, Schrift);
    Maßstab im Bild abgreifen statt Kilometer eintippen.
- Offen: eine Wiki-Karte über zwei bekannte Punkte einhängen (dann haben alle ihre Kartenpunkte
  eine Lage); ein gemaltes Oberflächenbild (z. B. aus Gaea, 2:1, Nordpol oben, Länge 0 in der
  Mitte) statt der gerechneten Färbung; feineres Höhenraster; Orte auf der Karte ziehen; die
  Zeitrechnung des alten Atlas (Jahresbeginn im Frühling) mit dem Kalender abgleichen.

**Noch offen, in dieser Reihenfolge:**
1. Zeitleisten (8) und Kalender des Exports – Ereignisse in den Kalender übernehmen.
2. Die Zeichenfläche („Board“, 1) bleibt außen vor.
3. Karten des Wikis mit Karten/Wegen (Bereich D) zusammenführen: Maßstab, Wege, Reisen.

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
- `wiki/editor/helpers.ts` wiederholt `splitTarget` und die Zeilenmuster aus `wiki/markdown.ts`
  (der Editor entstand getrennt) – zusammenführen.
