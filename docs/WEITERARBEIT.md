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
- **Schritt 5 – was noch fehlte (gebaut, 11. 11. 2026):**
  - *Karten hängen sich ein* (`domain/planet.ts`: `mapAnchor`, `geoIndex`, `exactGeo`): Haben
    zwei Orte einer Wiki-Karte eine Lage, folgen Maßstab und Drehung der Karte – und die Lage
    aller anderen Orte darauf. Nichts wird dafür gespeichert; es ist eine abgeleitete Sicht, die
    sich neu rechnet, sobald sich Orte oder Karten ändern. Eine so gewonnene Lage kann weitere
    Karten einhängen (bis zu vier Durchgänge). `placeGeo` liefert `own` (eingetragen), `exact`
    (gehört zu diesem Ort: eingetragen oder aus Karte) und `via` (die Karte). Der Atlas zeigt
    „über Karte“ und sagt beim Ort, was einer Karte zum Einhängen fehlt.
  - *Höhen für eingelesene Landmassen* (`domain/landRelief.ts`): Wayfarer erzeugt ein Gelände –
    an der Küste niedrig, im Inneren höher, Gebirgszüge aus weichem Rauschen, Ausgangswert ist
    die Kennung der Landmasse. `reliefOf` rechnet es ins Höhenraster ein, also gilt es für Karte,
    Kugel, Hexkarten und Klima. Als erzeugt gekennzeichnet („etwa 640 m (erzeugt)“), je Landmasse
    abschaltbar (`lands[].relief`: `generated` / `flat`).
  - *Landweg ums Wasser* (`domain/landRoute.ts`): Führt die Luftlinie über Meer oder See, sucht
    Wayfarer den kürzesten Weg über Land (Raster von einem halben Grad, danach begradigt). Der
    Atlas nennt Luftlinie und Landweg oder „kein Landweg“; die Hexkarte folgt dem Landweg
    (`GenerateInput.route`).
  - *Flüsse auf Hexkarten:* Die Flüsse des Atlas stehen als `hex.river` im Feld und werden
    eingezeichnet. Straßen kennt der Atlas nicht.
  - *Zeitleisten des Exports* (`wiki/timeline.ts`): Die Ereignisse werden Termine im Kalender.
    LegendKeeper zählt je Kalender in Minuten; umgerechnet wird über das Datum. Welches Jahr
    gemeint ist, sagt die Zeitrechnung: Trägt ein Kalender des Exports eine, die Wayfarers
    Kalender kennt („AD“, „JF“), ist die Zuordnung eindeutig; sonst bleibt die Zeitleiste draußen
    und wird genannt. Vergangenes ist abgehakt; was schon im Kalender steht, bleibt.
  - *Welt:* Der Überblick eines Eintrags sagt, welche Angaben aus dem Steckbrief seines Artikels
    stammen (`articleShare`).
  - *Kleinere Mängel:* Dialoge fragen nach, bevor Escape oder ein Klick daneben Eingaben verwirft
    (`Dialog guard`; reine Ansichten schalten es ab); im Kalender lässt sich an vergangenen
    Tagen nachtragen; ein abgehakter Termin, der in die Zukunft verschoben wird, steht wieder aus.
  - *Wetter:* Orte derselben Gegend (Feld von zwei Grad) teilen ihr Wetter, wenn ihr Klima aus
    der Lage stammt – sonst hätte jedes Dorf einer eingehängten Karte sein eigenes.
  - Gegengeprüft (neun Befunde, alle behoben), mit Tests und in der Vorschau mit den echten
    Dateien. **Nicht geprüft:** installierte App, macOS.
  - *Landmassen ersetzen (11. 11. 2026):* Der alte Atlas zeichnet einen Teil der Welt anders, als
    der Spielleiter ihn heute spielt. Dafür: Landmassen der Weltdatei lassen sich **ausblenden**
    (`hiddenLands`, `setLandHidden`; samt Seen, Flüssen und Höhen, jederzeit zurück, übersteht
    ein neues Einlesen der Weltdatei) und durch ein eingelesenes Kartenbild ersetzen. Beim
    Einlesen lassen sich einzelne **Flächen wegnehmen** (`dropAreas`: Klick auf eine Nachbarinsel,
    ein Schriftfeld, eine Wolke) und **dunkle Flecken im Land zuschütten** (`fillHoles`; aus,
    wenn die Flecken Seen sind). Die flache Karte malt das Gelände jetzt auch für Land, das über
    die Datumsgrenze reicht.
- Offen: ein gemaltes Oberflächenbild (z. B. aus Gaea, 2:1, Nordpol oben, Länge 0 in der
  Mitte) statt der gerechneten Färbung; feineres Höhenraster; Orte auf der Karte ziehen; die
  Zeitrechnung des alten Atlas (Jahresbeginn im Frühling) mit dem Kalender abgleichen.

**KI-Leser (11. 11. 2026) – erster Schritt gebaut.** Ziel des Spielleiters: Wayfarer macht
Elaris lebendig, unabhängig von der Story – die Welt bewegt sich von selbst weiter, er sieht
immer den nächsten Schritt, kein Faden geht verloren. Fließtext mit festen Regeln zu lesen trägt
dafür nicht weit; deshalb liest jetzt ein Sprachmodell, und nur das.
- **Ablauf:** Am Artikel im Wiki „Lesen lassen“ (oder in den Einstellungen alle ungelesenen auf
  einmal). Wayfarer schickt Kalender, Titel und Text des Artikels an die Claude-API und bekommt in
  fester Form zurück: **Termine** (einmalig oder regelmäßig – „legt jeden Feuertag ab“),
  **Beziehungen** und **Offenes** (Versprechen, Schulden, Aufträge). Daraus werden Vorschläge am
  Artikel, jeder mit dem Satz, aus dem er stammt. Annehmen legt einen Termin im Kalender, eine
  Beziehung in der Welt oder eine Abmachung in der Chronik an; ablehnen merkt sich Wayfarer.
- **Wo was steht:** `features/ki/reader.ts` (Auftrag, Form der Antwort, Prüfen, Namen und Daten
  in der Welt wiederfinden – reine Rechnung, mit Test), `features/ki/actions.ts` (lesen,
  annehmen, ablehnen, Kosten), `features/ki/AiPanel.tsx` (am Artikel),
  `einstellungen/AiSection.tsx` (Key, Modell, Kosten, alle lesen), `src-tauri/src/ai.rs` (Key im
  Schlüsselbund, POST an genau eine Adresse, keine Weiterleitungen; die Oberfläche sieht den Key
  nie). Vorschläge und Lesestand liegen am Artikel (`aiHints`, `aiRead`), das Modell in der
  Kampagne (`aiModel`, Vorgabe Haiku 5.5).
- **Kosten:** nach Textmenge, über ein eigenes Konto bei Anthropic – das Claude-Abo gilt dafür
  nicht. Geschätzt für alle rund 520 Artikel mit genug Text: etwa 0,25 $ mit Haiku 5.5. Die App
  zeigt Schätzung vor dem Lesen und Verbrauch danach.
- **Geprüft:** Rechnung und Befehle mit Tests (erfundene Welt, nachgestellte Antworten), die
  Rust-Seite gegen einen Gegenpart auf dem eigenen Rechner, die Oberfläche in der Vorschau mit
  von Hand eingelegten Vorschlägen. (Nachtrag 11. 11.: Der echte Abruf läuft – siehe „Stammbaum
  und Verwandtschaft“.) Damals **nicht geprüft:** ein echter Abruf bei Claude – dafür
  braucht es den Key des Spielleiters; ob die Form der Antwort (`output_config.format`) so
  angenommen wird und wie gut Haiku liest, zeigt erst der erste echte Lauf. Installierte App und
  macOS ebenfalls nicht.
- **Als Nächstes:** Fäden als eigene Sicht, der Spieltisch mit „was jetzt?“. Der Leser soll
  dann auch Uhren und Aufenthaltsorte vorschlagen.

**Uhren und „Währenddessen“ (11. 11. 2026) – gebaut.** Die Welt bewegt sich ohne die Gruppe.
- **Uhr** (Sammlung `clocks`, `domain/clock.ts`): ein Vorhaben der Welt – wer es betreibt, wo,
  und die Schritte, die der Spielleiter schreibt, jeder „nach n Tagen“ auf den vorigen. Wayfarer
  führt nur Buch: Rückt die Weltzeit über die Frist, tritt der Schritt ein und steht als
  Veränderung in der Chronik (am Ort und bei den Beteiligten; geheim, solange die Uhr geheim
  ist). `advanceTime` meldet die Schritte in `steps`, `undoTimeAdvance` nimmt sie zurück.
- **Eingreifen** (`data/actions.ts`): anhalten und weiterlaufen lassen (die Standzeit schiebt
  den nächsten Schritt hinaus), verzögern, den nächsten Schritt jetzt eintreten lassen oder
  festhalten, dass die Gruppe ihn verhindert hat (`settleStep`) – beides steht in der Chronik.
- **Oberfläche:** Kalender → Knopf „Uhr“ (`kalender/ClockDialog.tsx`); laufende Uhren stehen
  unter „Läuft gerade“; der nächste Schritt jeder Uhr steht am Spieltisch unter „Anstehend“.
- **„Währenddessen“** (`shell/meanwhile.ts`): Die Meldung nach dem Vorstellen der Zeit und nach
  einer Rast ordnet nach Gewicht – Schritte von Uhren, einmalige Ereignisse und abgelaufene
  Wirkungen zuerst, darunter gedämpft die Routinen am Ort der Gruppe (auch im Ort darüber oder
  darin), alle übrigen Routinen nur gezählt. Höchstens sieben Zeilen.
- Geprüft mit Tests und in der Vorschau (Uhr anlegen, Zeit vorstellen, Meldung, zurücknehmen,
  anhalten, löschen). **Nicht geprüft:** installierte App, macOS.
- Offen: Uhren am Eintrag der Welt zeigen (beim Betreiber und am Ort), fertige Uhren nachlesen,
  Schritte mit Folgen (etwa: Ort wechselt den Besitzer), Uhren aus dem Text vorschlagen lassen.

**Konzept (11. 11. 2026, abends):** Der Spielleiter hat mit Claude am Handy ein Konzept
erarbeitet – `docs/KONZEPT-WELT-UND-KARTEN.md`. Es legt Leitsätze, Entscheidungen und eine
Reihenfolge fest für die lebendige Welt, intelligente Karten aus Vektoren, das Fadenbrett, das
Bestiarium, „Alles ist ein Artikel“ und Beute. Es geht den älteren Vorschlägen in dieser Datei
vor, wo sie sich widersprechen. Übernommen aus dem Zweig `konzept/karten-und-welt`; dabei wurden
Namen aus der echten Kampagne durch erfundene ersetzt.

**Stammbaum und Verwandtschaft (11. 11. 2026) – gebaut.** Wunsch des Spielleiters: Jede Person
hat Verwandtschaften (Tante, Schwester, Cousin, Großcousin …), und daraus entsteht ein Stammbaum,
den man in der Familie sieht.
- **Eintragen:** Im Dossier einer Person, Reiter „Beziehungen“, oben: „Mira ist [Schwester] von
  [Odo]“ (`welt/KinSection.tsx`, `setKin`). Gespeichert wird an der Beziehung (`relation.kin`);
  das Geschlecht des Wortes merkt sich Wayfarer an der Person (`person.gender`), damit ihre
  übrigen Verwandtschaften richtig heißen.
- **Ableiten** (`domain/kin.ts`): aus Eltern, Paaren und Geschwistern folgen Großeltern, Tanten,
  Cousins, Großcousins (Kinder von Cousins), Halbgeschwister, Stief- und Schwiegereltern,
  Schwager. Geschwister ohne eingetragene Eltern teilen sich gedachte Eltern, damit ihre Kinder
  trotzdem Cousins sind. Die Liste an der Person nennt Eingetragenes und Abgeleitetes.
- **Stammbaum** (`domain/kinTree.ts`, `welt/FamilyTree.tsx`): Reiter „Stammbaum“ im Dossier
  einer Familie. Zeilen sind Generationen (auch aus „Tante von“ gerechnet), Paare stehen
  nebeneinander, Kinder unter ihren Eltern, Geschwister ohne bekannte Eltern unter einer
  Klammer; was sonst eingetragen ist (Cousine ohne Zwischenglieder), als gestrichelte Linie mit
  Wort. Wer nicht zur Familie gehört (eingeheiratet), ist gestrichelt umrandet.
- **Schlüsse** (`kinClosure`, Nachtrag am selben Tag: „Der Stammbaum sollte smart sein“): Auch
  aus „Tante von“, „Cousin von“, „Großvater von“ wird sicher gefolgert. Wer von jemandem
  abstammt, erbt dessen Verwandte nach oben (Tante von Y + Sohn der Tante = Cousin von Y); wer
  verwandt ist, ist es auch mit den Nachkommen; volle Geschwister teilen Eltern und entfernte
  Verwandte. Nicht geschlossen wird, was offen ist (zwei Cousinen derselben Person müssen
  nicht verwandt sein).
- **Vorschläge** (`kinSuggestions`, `welt/KinSuggestions.tsx`): Führt eine eingetragene
  Verwandtschaft über Eltern, die schon bekannt sind, schlägt Wayfarer die fehlende Verbindung
  vor („Hilda könnte Schwester von Greta sein – weil Hilda Tante von Odo ist und Greta Mutter
  von Odo ist“). Annehmen trägt ein, Ablehnen merkt sich die Beziehung (`relation.kinSkip`).
  Zu sehen an der Person und über dem Stammbaum.
- **Genogramm** (Wunsch des Spielleiters): Quadrat für Männer, Kreis für Frauen, Raute für
  unbekannt; ein Kreuz für Verstorbene; die Linie eines Paares läuft unter beiden Zeichen, die
  Kinder gehen von ihrer Mitte ab. Das Geschlecht lässt sich an der Person auch von Hand
  wählen. Offen: Trennung, Zwillinge, Adoption, Art der Beziehung (eng, zerstritten) als Linie.
- Sätze im Wiki („Sie ist die Schwester von …“) tragen beim Annehmen gleich die Verwandtschaft
  ein. **Offen:** Der KI-Leser nennt Verwandtschaften noch nicht mit Wort; Gefährten der Gruppe
  lassen sich als Verwandte wählen, haben aber keine eigene Eingabe; Stammbaum einer Person
  ohne Familie; Drucken.
- **KI-Leser nachgebessert** (Rückmeldung des Spielleiters): (1) Jeder Knopf sagt, wohin der
  Vorschlag kommt („In den Kalender“, „Als Beziehung“, „Als Abmachung“, „Als Geheimnis“), die
  Meldung danach, wo er zu finden ist. (2) Wissen und Geheimnisse („Mira weiß nicht, was ihr
  Bruder fand“) sind keine Abmachung mehr: Sie kommen ohne Datum ins Feld „Geheimnis“ der
  genannten Person. Der Leser nennt die Art selbst (`sort`); bei älteren Vorschlägen
  entscheiden die Worte (`threadSort`). (3) Vergangenes landet nie als „ab heute“: Der Leser
  kennzeichnet es (`past`), und ohne eigenes Datum wird es nicht vorgeschlagen. **Nicht
  geprüft:** ob Claude die neuen Angaben verlässlich setzt – dafür müssen Artikel neu gelesen
  werden. Offen: Abmachungen stehen weiter mit dem Tag des Eintragens in der Chronik.
- **Vorschläge des KI-Lesers:** Auf der Startseite des Wikis stehen jetzt alle offenen
  Vorschläge beieinander (`ki/AiOverview.tsx`). Anlass: Im Spielstand lagen 156 Vorschläge aus
  191 gelesenen Artikeln, sichtbar aber nur einzeln im jeweiligen Artikel. Damit ist auch belegt,
  dass der Abruf bei Claude mit echtem Schlüssel läuft.
- Geprüft mit Tests (`domain/__tests__/kin.test.ts`) und in der Vorschau (Baum einer Familie,
  Eingabe und Liste an der Person). **Nicht geprüft:** installierte App, macOS, die Übersicht
  der Vorschläge mit echten Daten.

**Wege und Pointcrawl (11. 11. 2026) – erster Teil gebaut.** Der Spielleiter: „mit das
wichtigste Tool“ – Reisen innerhalb einer Stadt und zwischen Orten, auch als genaue Route über
mehrere Punkte. Das Datenmodell (`paths`) gab es schon; es fehlte die ganze Bedienung.
- **Rechnung** (`domain/ways.ts`): Wege von einem Ort (`waysFrom`; in beide Richtungen, außer
  „nur in dieser Richtung“), rund um einen Ort (`waysAround`: wer im Gasthaus sitzt, bricht vom
  Viertel aus auf), schnellste Route über mehrere Punkte (`routeBetween`, Dijkstra), Dauer
  (`wayMinutes`: feste Minuten, sonst Länge durch Tempo, schwieriges Gelände doppelt), Länge
  aus dem Verlauf auf einer Karte mit Maßstab (`lineKm`, `suggestedKm`).
- **Gehen** (`features/wege/actions.ts`): `walk` / `walkRoute` lassen erst die Zeit des Weges
  vergehen (Termine, Uhren, Lichter) und versetzen dann die Gruppe; in der Chronik steht „über
  Hafen · 25 Min.“. Eine Meldung nennt Ankunft und was währenddessen geschah; „Rückgängig“ nimmt
  Zeit und Ortswechsel zusammen zurück (`walkAndReport` in `shell/dialogs.tsx`).
- **Spieltisch:** Zeile „Wege“ unter „Orte hier“ (`tisch/WayRow.tsx`): je Weg ein Knopf mit
  Ziel und Dauer – ein Klick geht ihn. Dahinter „Wege …“ zum Anlegen und Ändern
  (`wege/WayDialog.tsx`: Von, Nach, Dauer, Name, Besonderheiten, nur eine Richtung, der Gruppe
  unbekannt).
- **„Die Gruppe zieht weiter“:** Kennt das Wegenetz eine Route zum Ziel, zeigt der Dialog sie
  mit Dauer und lässt die Zeit mitlaufen. Sonst fragt er nach der Dauer (schnelle Knöpfe, mit
  Vorschlag aus einer Karte mit Maßstab) und merkt sich den Weg auf Wunsch – so entsteht das
  Netz beim Spielen von selbst.
- **Karte:** Wege, deren beide Orte auf einer Karte liegen, sind dort als Linie zu sehen (ihr
  gezeichneter Verlauf, sonst die Gerade). Der Punkt eines Ortes führt über „Gruppe hierher
  versetzen“ in den Dialog mit Route und Dauer.
- Geprüft mit Tests (`domain/__tests__/ways.test.ts`) und in der Vorschau (Ziel wählen, Dauer
  angeben, Zeit läuft mit, Rückweg als Knopf, bekannte Route im Dialog, Dialog „Neuer Weg“).
  **Nicht geprüft:** die Linien auf einer Karte (nur gerechnet), installierte App, macOS.
- **Offen:** Wege auf der Karte selbst zeichnen (Verlauf mit Zwischenpunkten) und den Maßstab
  einer Karte setzen; eine Route Punkt für Punkt gehen mit Halt an jedem Punkt; Verirren,
  Vorräte und Begegnungen auf langen Wegen (Unterreich, Schritt 3); Tempo wählen; Reittiere.

**Atlas: Kontinente als Fläche (11. 11. 2026) – gebaut.** Wunsch des Spielleiters: Ein
Kontinent ist kein einzelner Ort, sondern die ganze Landmasse; darüber stehen die
Kontinentalwelten.
- **Erkennen** (`domain/planet.ts`, `landOwners`): Trägt eine sichtbare Landmasse den Namen
  eines Ortes (Akzente zählen nicht), ist sie dieser Ort; bei gleichen Namen der, der in der
  Welt weiter oben steht. Von Hand zuordnen geht vor (`land.placeId`, `setLandPlace`) und
  übersteht das erneute Einlesen der Weltdatei. Ein Ort umfasst auch die Landmassen der Orte
  unter ihm (`placeLands`).
- **Lage:** `placeGeo` gibt einem solchen Ort die Mitte seiner Fläche (`area`, nie `exact`);
  Orte darunter ohne eigene Lage übernehmen sie als ungefähre Lage („in Westmark“).
- **Atlas:** Ein Klick aufs Land wählt den Kontinent, die Fläche leuchtet golden (Karte) bzw.
  bekommt eine goldene Küste (Kugel). Ein weiterer Klick auf dieselbe Fläche geht eine Stufe
  hinauf: Kontinentalwelt, dann Planet, dann wieder der Kontinent. Eine Landmasse ohne Ort zeigt
  eine Karte zum Zuordnen.
- Geprüft mit Tests (`atlas/area.test.ts`) und in der Vorschau. **Nicht geprüft:** installierte
  App, macOS, die Kugel.
- Offen: die einzelnen Inseln einer eingelesenen Landmasse verschiedenen Orten zuordnen (eine
  aus einem Bild eingelesene Kontinentalwelt ist eine einzige Landmasse); Zuordnung in der Karte
  des Ortes wieder lösen; Namen der Flächen auf der Karte.
- **Flüssig beim Verschieben (Rückmeldung: „immer noch sehr laggy“):** Die Weltkarte malt das
  Gelände einmal als Bild der ganzen Welt (`paintTerrain`, 4096 Bildpunkte breit) und legt es beim
  Verschieben und aus der Ferne nur noch hin; steht die Karte nah herangeholt still, wird sie
  scharf aus den Küstenlinien nachgezeichnet. In der Vorschau rund 6,5 ms je Schritt statt 23.
  **Nicht gemessen:** installierte App, MacBook.
- **Namen der Kontinente** stehen auf der Karte (jeder Ort, der selbst eine Landmasse ist).
  Offen für die Verständlichkeit: Seitenleiste aufräumen (Orte ohne Lage erst auf Wunsch),
  klare Arten „Ansehen / Orte setzen / Landmassen“, Namen auch auf der Kugel.
- **Eis an den Polen:** Die Karte färbt Land nach Höhe und Breite (`iceShare`, `snowlineM` in
  `domain/geoClimate.ts`): ab etwa 66° liegt Eis bis ans Meer, weiter zum Äquator nur noch auf
  den Gipfeln. Gilt für Karte und Kugel; Land ohne Höhen (flach gestellt) bleibt ohne Eis.
- **Karte im echten Spielstand (11. 11. 2026):** Auf Wunsch des Spielleiters sind die drei aus
  Bildern eingelesenen Landmassen und die vier ausgeblendeten alten Formen aus der Vorschau in
  seinen Kampagnenordner übernommen (nur `atlas/planet.json` ergänzt; Sicherung der alten
  Datei unter `Dokumente\Wayfarer-Sicherungen`).

**Unter der Erde (11. 11. 2026) – Schritt 1 von 3 gebaut.** Anlass: Die Gruppe spielt im
Unterreich, fast alle Funktionen (Wetter, Sonne, Monde, Atlas) gelten aber der Oberwelt.
- **Erkennen** (`domain/underground.ts`, `isUnderground`): ein Ort liegt unten, wenn sein Klima
  „Unter der Erde“ ist – festgelegt oder aus Namen und Art gelesen (wie bisher beim Wetter).
- **Statt des Wetters** zeigt das Feld der Weltleiste und die Zeile am Spieltisch den Stand des
  Lichts: das zuerst erlöschende Licht mit Restzeit, sonst „Dämmriges Licht“ oder „Dunkelheit“.
  Aufgeklappt (`features/unterreich/UndergroundPanel.tsx`): Lichter der Gruppe mit Restzeit,
  Knöpfe zum Anzünden (Fackel und Kerze 1 Std., Laterne 6 Std., Zauber „Licht“ 1 Std., nach den
  Regeln von 2024), wer im Dunkeln sieht (Dunkelsicht der Gefährten), die Umgebung des Ortes.
- **Lichter** sind Wirkungen der neuen Art `light`: Sie stehen unter „Anstehend“ und „Läuft
  gerade“, brennen mit der Weltzeit herunter, und nach einem Zeitsprung meldet „Währenddessen“
  „Erloschen: Fackel“. Zehn Minuten vorher warnt das Feld; ebenso, wenn in Dunkelheit kein Licht
  brennt und jemand keine Dunkelsicht hat.
- **Umgebung** (errechnet wie das Wetter, wiederholbar): Helligkeit und Luft hängen am Ort, das
  Geräusch zusätzlich am Tag. Wo dem Namen nach jemand wohnt, ist es dämmrig. Die Helligkeit
  lässt sich je Ort von Hand festlegen (`place.light`, gilt auch darunter).
- **Zeit ohne Himmel:** „seit 12 Tagen“ (aus den Ortswechseln der Chronik, `belowSince`) und
  die Tageszeit an der Oberfläche.
- Geprüft mit Tests und in der Vorschau (Ort unter der Erde, Fackel anzünden, Stunde vergeht,
  Meldung, zurücknehmen). **Nicht geprüft:** installierte App, macOS.
- Bekannt: „Dungeon“ in Name oder Art zählt als unter der Erde – auch bei einem Turm. Abhilfe:
  am Ort ein anderes Klima festlegen.
- **Schritt 2 (offen):** zweite Ebene im Atlas – Umschalter „Oberwelt / Unterreich“, Orte mit
  Tiefe, Küsten nur blass zur Orientierung.
- **Schritt 3 (offen):** Gänge statt Gelände – Orte durch Tunnel verbunden (Reisetage, Gefahr),
  Reise entlang des Gangs, Verirren, Vorräte. Vorher klären, wie der Spielleiter unten reisen
  lässt: feste Gänge oder Feld für Feld.

**Oberfläche überarbeitet (11. 11. 2026).** Auftrag: nutzerfreundlich und wirklich schön.
- **Entwurf „Schreibtisch des Spielleiters“:** Navigation und Weltleiste aus geschwärztem Holz,
  jede Fläche eine Lederunterlage mit Messingbeschlägen an allen vier Ecken, Kopfzeile der
  Flächen leicht abgesetzt. Knöpfe fühlen sich nach Tasten an; die eine wichtige Handlung einer
  Ansicht ist ein Messingschild mit dunkler Schrift. Eingabefelder sind eingelassen. Leere
  Zustände tragen ihr Symbol in einem Messingring.
- **Lesbarkeit:** Alle Schriftgrade unter 12 Punkt angehoben (`--text-2xs` als kleinste Stufe),
  `--text-xs` und `--text-sm` größer, gedämpfte Schriftfarben heller. Knöpfe und Felder höher.
- **Bedienung:** Unter jedem Bereich der Navigation steht, wozu er da ist. Erkundung zeigt in
  der leeren Liste, was dort später steht.
- **Bildmaterial (Higgsfield, 39 von 150 freigegebenen Credits):** Holz- und Lederkachel
  (nahtlos durch Spiegeln), Startbild (Tisch bei Kerzenlicht) und das App-Symbol (Windrose aus
  Messing; ersetzt das gezeichnete Zeichen, auch in der Navigation). Alle Symbolgrößen der
  installierten App sind neu erzeugt.
- **Verworfen – nicht wieder versuchen:** ein bräunlicher Kupferstich als Bildstil („kein
  schönes Bild“); gemalte Stillleben hinter den Überschriften der Bereiche und in leeren
  Zuständen („stören mehr, als dass sie gut aussehen“, „nicht einfach Bilder hinklatschen“).
  Schönheit kommt aus Werkstoff, Schrift und Abstand, nicht aus Schmuckbildern.
- Geprüft in der Vorschau bei 1440×900 und 1280×800 (alle Bereiche, Dialog „Festhalten“,
  Startseite). **Nicht geprüft:** installierte App, macOS, das neue Symbol im Dock und in der
  Taskleiste.

**Karten zeichnen (12. 11. 2026) – erster Schritt gebaut.** Aus dem Konzept
(`docs/KONZEPT-WELT-UND-KARTEN.md`, „Jeder Strich bedeutet etwas“): Karten entstehen in
Wayfarer, als Formen statt als Bild, und Wayfarer liest aus ihnen.
- **Bereich „Karten“** (`features/karten`, neunter Punkt der Navigation): links alle Karten
  (gezeichnete zuerst, dann die Bildkarten des Wikis – die öffnen ihre bisherige Ansicht),
  rechts die Zeichenfläche. „Neue Karte“ fragt Namen, Ort, Breite in Kilometern (daraus der
  Maßstab), Grund (das Gelände, wo nichts gemalt ist – Wasser für eine Insel) und Ebene.
- **Werkzeuge:** Ansehen (ziehen, Mausrad, Klick zeigt, was dort ist), Gelände (acht Arten, drei
  Pinselbreiten; der spätere Strich liegt oben – „Ebene“ über Wald radiert), Linie (Straße,
  Pfad, Fluss, Grenze), Ort (Eintrag der Welt oder nur eine Beschriftung). Rückgängig je
  Strich (Strg + Z), Entfernen des Gewählten mit Entf.
- **Bedeutung** (`domain/mapDraw.ts`): `groundAt` sagt, was an einer Stelle ist; `walkAlong`
  rechnet eine Linie Stück für Stück nach dem Gelände darunter (schwieriges Gelände halbiert
  abseits von Straßen das Tempo; ein Pfad durchs Wasser wird gemeldet, eine Straße gilt als
  Brücke). Beginnt und endet eine Straße oder ein Pfad an zwei Orten der Welt, entsteht ein
  **Weg im Wegenetz** (`drawLine`); seine Dauer rechnet `wayMinutes` jedes Mal neu aus der
  Karte – wird das Gelände umgemalt, ändert sie sich mit.
- **Aussehen** (`karten/draw.ts`, Farben `--map-*`): wie die abgesegnete Probe
  (`docs/proben/varrand-karte.html`) – Tinte auf Pergament, Bäume, Hügel, Gipfel, Schilf und
  Dünen auf festem Raster (`sitesOf` in `karten/shapes.ts`, immer dieselben Stellen), Wasser mit Küstenlinie und
  getöntem Saum, Windrose, Maßstab. Ebene „Unterreich“: heller Strich auf dunklem Fels.
- **Datenmodell:** `MapSchema` hat `kind` (image | drawn), `level`, `ground`, `strokes`
  (Pinselstriche mit Breite) und `lines` (mit `pathId` zum Weg). Keine neue Sammlung.
- Geprüft in der Vorschau bei 1440×900: Karte anlegen, Gelände malen, Fluss, zwei Orte, Straße
  dazwischen (35 km → 7 Std. 20 Min., Weg im Wegenetz), Auswahl, Vergrößern, Grund Wasser,
  Unterreich, Angaben ändern, Löschen samt Weg. **Nicht geprüft:** installierte App, macOS,
  Zeichnen mit dem Trackpad, große Karten mit sehr vielen Strichen.
- **Höhlen und Gänge (12. 11. 2026, zweiter Schritt) – gebaut.** Anlass: Die Gruppe spielt im
  Unterreich.
  - **Eigenes Gelände je Ebene** (`LEVEL_GROUNDS`): unter der Erde Fels (der übliche Grund),
    Höhle, Pilzwald, Geröll, Wasser, Abgrund. Fels und Abgrund sind `solid` – kein Durchkommen.
    Der Dialog bietet nur das Gelände der gewählten Ebene an.
  - **Gänge:** Die Linie „Straße“ heißt unter der Erde „Gang“ (`lineLabel`) und gräbt sich durch
    den Fels: `groundAt` meldet im Gang (`TUNNEL_WIDTH`) begehbaren Boden, der Zeichner schneidet
    ihn aus der Felsfläche. Ein Gang trägt auch über Abgrund und Wasser. Ein **Pfad** durch Fels
    oder über einen Abgrund wird gemeldet (`walk.blocked`). Von Ort zu Ort wird ein Gang zum Weg.
  - **Räume:** Pinsel „Rechteck“ – aufziehen ergibt ein Rechteck (`paintRect`). Gespeichert als
    gerader Strich mit stumpfen Enden (`stroke.cap: 'butt'`), kein neues Formmodell.
  - **Gerade Linien:** Umschalt-Taste beim Ziehen einer Linie.
  - **Aussehen:** Fels, Wasser und Abgrund sind Flächen mit Randlinie (`SOLID` in `draw.ts`;
    seit dem dritten Schritt aus Umrissen, siehe unten): dunkler Fels, hellere Höhlen, Pilze
    und Steine als Zeichen. Farben `--map-cave`, `--map-fungus`,
    `--map-fungus-cap`, `--map-rubble`, `--map-chasm`, `--map-glow`.
  - **Kleine Maßstäbe:** Längen unter einem Kilometer stehen in Metern (`formatLength`), der
    Maßstabsbalken reicht bis 5 m hinunter.
  - Geprüft in der Vorschau bei 1440×900: Karte „Unterreich“ anlegen (Grund springt auf Fels),
    Höhlen malen, drei Räume, Gänge frei und gerade, Pilzwald, See, Abgrund, Geröll, zwei Orte,
    Gang dazwischen (1,1 km → 14 Min., Weg im Wegenetz), Pfad durch Fels mit Warnung, Löschen.
    **Nicht geprüft:** installierte App, macOS, Trackpad.
- **Zeichner neu (12. 11. 2026, dritter Schritt).** Urteil des Spielleiters über die ersten
  beiden Schritte: „Das Kartenmodul ist echt hässlich. Also die Karten.“ Ursache: Gezeichnet
  wurden die Pinselstriche selbst – runde Kleckse mit harter Kante, flache Farbe, Leuchtrand
  im Unterreich. **Nicht wieder so:** Striche nie unmittelbar als Bild zeigen.
  - **Formen statt Striche** (`karten/shapes.ts`): Die Karte wird gerastert (`rasterize`, 2,5
    Einheiten), der Rand gemalter Striche dabei leicht bewegt (festes Rauschen je Karte –
    Rechtecke und Gänge bleiben gerade), und aus dem Raster werden geschlossene Umrisse gelesen
    (`contour`, `smooth`, `outlinesOf`) – das Verfahren der Probe `varrand-karte.html`. Auch
    die Stellen der Zeichen kommen von dort (`sitesOf`, je Zeichen ein eigener Abstand). Das
    ist nur Ansicht: Was gilt, sagt weiter `groundAt()`; die gezeichnete Kante weicht höchstens
    um einen Federstrich ab. Etwa 50–70 ms je Änderung.
  - **Oberwelt** (`karten/draw.ts`): Pergament mit Flecken und Körnung (`makeTextures`),
    Tönung mit weichem Saum, Ufersaum, Wellenlinien vor der Küste, Küstenlinie in Tinte;
    Flüsse verschwinden im See.
  - **Unterreich:** dunkler Fels mit Schraffur an den Wänden und verhaltenem Schimmer statt
    Leuchtrand, Schatten am Fuß der Wände, Abgrund mit Strichen in die Tiefe.
  - Die Hilfsflächen mit Masken (`Layers`, `FLOODS`) und `symbolSites` gibt es nicht mehr.
  - Geprüft in der Vorschau bei 1440×900 (Insel mit Wald, Gebirge, Hügeln, Sumpf, Seen, Fluss,
    Straße; Gewölbe mit Höhlen, Räumen, Gängen, Pilzwald, See, Abgrund). **Nicht geprüft:**
    installierte App, macOS (dort zeichnet eine andere Technik), Tempo auf dem MacBook, das
    Urteil des Spielleiters über das neue Aussehen.
- **Karte am Spieltisch (12. 11. 2026, vierter Schritt) – gebaut.** Das neue Aussehen hat der
  Spielleiter bestätigt („Ja, passt so“).
  - Der Knopf „Karte“ am Ort der Gruppe zeigt jetzt auch gezeichnete Karten (`placeMaps` in
    `tisch/wiki.ts`): die Karte des Ortes selbst, die der Orte darüber – und gezeichnete Karten
    ohne zugeordneten Ort, auf denen der Ort als Punkt steht.
  - **Ansicht** (`karten/MapPeek.tsx`): nur ansehen, ziehen, Mausrad. Der Punkt der Gruppe ist
    in Glut markiert (`markerOfPlace`: der eigene Punkt, sonst der des nächsten Ortes darüber;
    `scene.here`). Ein Klick auf einen Ort nennt den Weg von hier (`routeText`: Dauer über das
    Wegenetz, „über …“) und bietet „Hierher ziehen …“ – das öffnet den bekannten Dialog, die
    Zeit des Weges vergeht mit. Ein Klick auf eine Linie oder das Gelände zeigt, was es bedeutet.
  - **Gemeinsame Bühne** (`karten/useMapStage.ts`): Zeichenfläche, Ausschnitt, Formen und
    Farben teilen sich Zeichnen und Ansehen; `pickAt` (was ein Klick trifft) und `LineSummary`
    ebenso.
  - Geprüft in der Vorschau: Gruppe in der Pilzgrotte, Karte öffnen, Torhalle anklicken
    („Zu Fuß von hier 14 Min.“), hinziehen (Zeit +14 Min.), Markierung wandert mit; danach die
    Vorschau zurückgesetzt. **Nicht geprüft:** installierte App, macOS.
  - **Unten ist, was auf einer Unterreich-Karte steht (12. 11., fünfter Schritt) – gebaut.**
    Ein Ort, der als Punkt auf einer gezeichneten Karte der Ebene „Unterreich“ steht, gilt als
    unter der Erde – er und alles, was in ihm liegt (`placesBelow` in `domain/mapDraw.ts`,
    in `weatherZone` als Quelle `map` gleich nach dem festgelegten Klima). Wer zugleich auf
    einer gezeichneten Karte der Oberwelt steht (ein Aufgang), zählt nicht; ein von Hand
    festgelegtes Klima geht vor. Bewusst **nicht** abgeleitet: der Ort, den eine
    Unterreich-Karte „zeigt“ (`map.placeId`) – das wäre oft die Stadt darüber. Geprüft in der
    Vorschau: Torhalle (Name sagt nichts) zeigt „Unter der Erde · Dämmriges Licht“.
  - **Türen, Geheimgänge und Fallen (12. 11., sechster Schritt) – gebaut.** Neues Werkzeug
    „Zeichen“: Tür (auf der Oberwelt „Tor“), Geheimtür, Falle – ein Klick setzt es; nahe an
    Gang, Straße oder Pfad rastet es auf der Linie ein (`placeSign`, `SIGN_SNAP`). Zeichen
    liegen in `map.signs` (`MapSignSchema`: Tür offen / geschlossen / verschlossen, Falle
    scharf oder nicht, `hidden` = die Gruppe weiß nichts davon). Was sie bedeuten, steht in
    `domain/mapDraw.ts` (`lineOfSign`, `signsAlong`, `signBars`, `signNote`) und gilt
    für den Weg, der über die Linie führt (`domain/ways.ts`: `Way.signs`, `Way.barred`,
    `wayNotes`, `routeNotes`, `routeDetour`): Eine **verschlossene Tür versperrt den Weg** –
    `routeBetween` nimmt dann jeden freien Umweg und nur ohne einen solchen den versperrten Weg
    (`route.barred`). Am Spieltisch: Schloss an der Wegzeile (ein Klick geht nicht still
    hindurch, sondern öffnet „Die Gruppe zieht weiter“ mit der Warnung), Hinweise im Dialog und
    an der Karte („Der direkte Weg ist versperrt: …“, „Unterwegs: Falle …“); ein Klick auf Tür
    oder Falle der Karte ändert ihren Zustand (`SignCard`, `updateSign`) – aufgeschlossen ist
    der Weg sofort frei. **Geheimgang:** Linie mit `secret` (Knopf beim Zeichnen, Haken an der
    Linie, `setLineSecret`); der Weg dazu trägt `path.secret`, unter der Erde wird der Gang
    nicht aus dem Fels geschnitten, sondern gestrichelt angedeutet, bis die Gruppe ihn entdeckt.
    Gezeichnet: verschlossen = Blutrot, Geheimtür = Messing mit gestricheltem Rand, offene Tür =
    zwei Pfosten mit Blatt, Falle = Raute (scharf gefüllt). Bewusst nicht gebaut: Eintrag in der
    Chronik, wenn eine Tür aufgeht (stört am Tisch); Türen, die sich nach der Wand statt nach
    dem Gang richten; Fallen mit Werten (Rettungswurf, Schaden).
- **Offen (Reihenfolge nach dem Konzept):** Raster für Gewölbe (Grundlage des Kampfmodus); Schächte und Abstiege, die Ebenen
  verbinden; Faerzress-Zonen und Herrschaftsgebiete als Flächen über dem Gelände; Licht und
  Wissen („kennt die Gruppe“) auf der Karte; Flächen statt nur Pinsel (Küste nachziehen,
  füllen); Bildkarten des Wikis, auf denen der Ort nur als Punkt steht, am Spieltisch anbieten (bisher nur Bildkarten,
  `tisch/wiki.ts`); Ansichten „Hex“ und „Netz“ derselben Karte; Linien nachträglich
  verschieben; Zustand und Wissen als Schichten (gesperrte Straße, „kennt die Gruppe“);
  Hexkarten der Erkundung aus der gezeichneten Karte speisen (`groundShares` steht bereit).

**Kalender zeigt, was zählt – Fäden – Fadenbrett (12. 11. 2026, nach Rückmeldung des
Spielleiters: „alle täglichen Dinge im Kalender – das juckt gar nicht“; „so etwas wäre eher ein
Faden“; „das Storyboard ist noch nicht drin“).**

- **Gewicht eines Termins** (`domain/weight.ts`, `eventWeight`): Einmaliges, Vorhaben, Fristen
  und Feste (monatlich, jährlich) stehen immer im Kalender; was sich nach Wochen wiederholt, nur
  dort, wo die Gruppe ist (`isNear`: derselbe Ort, darüber, darin); was sich nach Tagen
  wiederholt, ist **Alltag** – überall. Was an einem offenen Faden hängt (`event.threadId`),
  zählt immer. Alltag wird geführt, steht aber nicht im Monatsraster (`gridSpans`), nicht unter
  „Anstehend“ (Kalender und Spieltisch) und nicht „auf dem Weg dorthin“, sondern eingeklappt am
  Tag (`splitDay`, „Alltag“). Knopf „Alltag zeigen (n)“; je Termin festlegbar („Im Kalender“:
  Wayfarer entscheidet / immer / Alltag, `event.weight`) mit einem Satz, warum.
- **Fäden und Geschichten** (Sammlungen `threads`, `stories`; `domain/story.ts`): Eine
  Geschichte hat Antreiber, Uhr („wenn niemand eingreift“), Zugehöriges und Einstiege; ein Faden
  ist eine Frage oder Spur mit Zustand (offen, aktiv, ruhend, gelöst, verloren), Knoten und
  Hinweisen (wo, wer weiß es, gefunden). Abgeleitet: woran etwas hängt (`storyNodes`,
  `threadNodes`), Nähe zur Gruppe (`nearness`: hier / erreichbar über Wegenetz oder dieselbe
  Gegend / fern), Stand der Uhr (`storyClock`), Berührungen über gemeinsame Knoten
  (`touches`, `touchReason`), Warnung bei einem einzigen Hinweis (`threadWarning`).
- **KI-Leser:** dritte Sorte offener Punkte – `lead` = Faden (Spur, offene Frage). Der Leser
  nennt sie selbst; bei älteren Vorschlägen entscheiden die Worte (`LEAD_WORDS`). Annehmen legt
  einen Faden an; an jedem offenen Punkt gibt es außerdem „Als Faden“.
- **Fadenbrett** (`features/faeden`, Bereich „Fadenbrett“): drei Stapel Hier · Erreichbar ·
  Fern; Karten für Geschichten (Antreiber, Uhr als Schritte, Fäden) und lose Fäden; goldene
  Linien, wo sich zwei berühren (Grund an der gewählten Karte, sonst ein Knoten); gemeinsame
  Knoten golden; Seitenteil mit „Wenn niemand eingreift“, Fäden samt Hinweisen zum Abhaken
  (`setHintFound`: erster Fund macht den Faden bekannt und aktiv), Einstiegen („die Gruppe ist
  hier“), Berührungen; Umschalter **Wahrheit / Was die Gruppe weiß** (`boardCards(…, 'party')`).
- **Ruf und Spieltisch (12. 11., zweiter Schritt) – gebaut.** Ruf ist keine neue Angabe,
  sondern die Haltungen, die es schon gibt, zusammen gelesen (`reputeOf`: Haltung des Antreibers
  zur Gruppe und zu einzelnen Gefährten). Ein Einstieg kann „bei gutem Ruf“ oder „bei schlechtem
  Ruf“ gelten (`entry.standing`, `entryFit`): gut = Gruppe oder ein Gefährte ab +1, schlecht =
  ab −1 – der Ruf ändert nicht die Geschichte, nur den Einstieg. Am Fadenbrett: Ruf an der Karte
  und im Seitenteil (mit „Ändern“ → Haltungsdialog), Einstiege mit dem Grund, warum sie passen.
  Am Spieltisch: Feld „Was diesen Ort gerade berührt“ (`storiesHere`, `tisch/StoriesHere`) –
  Geschichten und lose Fäden am Ort der Gruppe mit nächstem Schritt der Uhr, den Einstiegen
  hier (passende zuerst) und den Hinweisen, die hier liegen oder von denen hier jemand weiß.
- **Offen:** Ruf als eigene Linie auf dem Brett; Situationen an Orten; „Hinweise
  wandern“ und „Folgen springen über“; Vorschläge aus der Mitschrift; Uhr direkt am Brett
  anlegen; Karten von Hand verschieben; rote Fäden als Linien zu einzelnen Personen und Orten
  (bisher Zettel an der Karte). Der Entwurf vom 11. 11. lag nur als Beschreibung vor – das
  Aussehen ist mit dem Spielleiter abzustimmen.

**Bestiarium, erster Schritt (12. 11. 2026) – gebaut.** Nach `docs/KONZEPT-WELT-UND-KARTEN.md`
Abschnitt 4b.

- **Datenmodell** (Sammlung `creatures`, `CreatureSchema`): Vorlage, Variante, Einzelner in
  einer Kette (`parentId`). `block` hält die Werte eines Statblocks nach 2024, jedes Feld darf
  fehlen – eine Variante hält nur fest, was abweicht. Fähigkeiten (`features`: Merkmal, Aktion,
  Bonusaktion, Reaktion, legendäre Aktion; mit Angriff und Rettungswurf) werden vererbt; eine
  gleichnamige ersetzt die geerbte, `dropped` streicht sie. Längen in Fuß (wie die Dunkelsicht
  der Gefährten).
- **Rechnung** (`domain/creature.ts`): `resolveCreature` legt die Kette übereinander;
  `statsOf` rechnet Modifikatoren, Übungsbonus und EP aus dem HG, Trefferpunkte aus
  Trefferwürfeln (Würfel nach Größe) und Konstitution, Initiative, Rettungswürfe, Fertigkeiten,
  passive Wahrnehmung; `attackMath` Angriffsbonus und durchschnittlichen Schaden; `saveDcOf`
  den SG. `crCheck` schätzt, ob der HG passt (Faustregel aus TP, RK, Schaden je Runde und
  Angriffsbonus – Merkmale und Zauber kennt sie nicht). `xpBudget` / `difficultyOf`: EP-Budget
  2024 je Stufe (steht bereit, noch ohne Oberfläche).
- **Text einfügen** (`bestiarium/parse.ts`, `parseStatblock`): deutsch und englisch, Satz von
  2014 und 2024, auch so, wie D&D Beyond kopiert (Bezeichnung und Wert auf getrennten Zeilen).
  Meter werden zu Fuß; das Attribut hinter einem Angriff wird gesucht, damit Wayfarer weiter
  rechnen kann; was sich nicht zuordnen lässt, steht unter `unread` und wird vor dem Übernehmen
  gezeigt.
- **Oberfläche** (`features/bestiarium`, Bereich „Bestiarium“): Liste mit Suche und Filtern
  (HG, Typ, Lebensraum, Quelle), Erben eingerückt; Statblock im Aufbau von 2024 mit Würfeln
  (Angriff, Schaden, kritisch – echter Zufall, `fairDie`); Einzelner mit eigenen
  Trefferpunkten (`setCreatureHp`); Dialog zum Bauen (leere Felder erben, Wayfarer rechnet
  mit, Fähigkeiten anderer Wesen übernehmen). Löschen schreibt Erben ihre Werte fest ein.
- **Begegnungen (12. 11., zweiter Schritt) – gebaut.** Sammlung `encounters`: eine Begegnung
  ist eine Liste von Exemplaren (`foes`), jedes mit Namen („Grubenschleicher 2“, die kleinste
  freie Nummer – `nextFoeName`) und eigenen Trefferpunkten. `encounterView` rechnet EP,
  Budget der Gruppe (`partyLevels`: Stufen der aktiven Gefährten) und Schwierigkeit; besiegt ist,
  wer bei 0 steht. Seite „Begegnungen“ als zweiter Reiter des Bestiariums
  (`bestiarium/Encounters.tsx`, Befehle in `encounterActions.ts`): Wesen und Anzahl
  hinzufügen, Schaden und Heilung je Exemplar, „Von vorn“, rechts der Statblock des gewählten
  Exemplars mit den Würfeln. Ein Einzelner kommt mit seinem Namen und seinen jetzigen
  Trefferpunkten. Nicht gebaut: Initiative und Reihenfolge (voller Kampfmodus, später),
  Verluste in einen Bestand zurückschreiben, EP der Gruppe gutschreiben.
- **Bestände (12. 11., dritter Schritt) – gebaut.** Sammlung `stocks`: ein Bau, Hort oder Nest
  an einem Ort mit Gruppen von Bewohnern (`groups`: Wesen, Anzahl, Verluste), dazu Vorräte,
  Beute, Revier als Text. `domain/stock.ts`: `stockView`, `stockSummary` („27 von 30 – 20
  Grubenschleicher, 6 Treiber, 1 Krummzahn“), `stocksHere`, `lossPlan`. Seite „Bestände“ als
  dritter Reiter des Bestiariums (`bestiarium/Stocks.tsx`, Befehle in `stockActions.ts`).
  **Verluste zählen:** von Hand (ein Verlust, zurücknehmen) – oder aus einer Begegnung: Bewohner
  treten aus dem Bestand an (`fieldFromStock`, nie mehr als noch da sind; „Begegnung daraus“
  stellt höchstens zwölf je Art auf), und „Verluste verbuchen“ (`bookLosses`, mit Rückgängig)
  zieht die Besiegten im Bestand ab – einmal, nicht doppelt; „Von vorn“ erweckt Verbuchte nicht.
  Am Spieltisch: Feld „Wer hier haust“ (`tisch/StocksHere`) für Bestände am Ort der Gruppe,
  darüber oder darin. Nicht gebaut (später laut Konzept): Nachwachsen, Abwandern, Reviere als
  Fläche, Begegnungen aus Revieren, Raubzüge, Erinnerung.
- **Offen (Muss der ersten Version):** SRD 5.2 auf Knopfdruck. **Später:** Foto über den KI-Leser, Schablonen,
  HG hoch- und runterrechnen, Zauberwirken als eigene Angabe, Wissen der Gruppe, Reviere und
  Begegnungen daraus, Verbindung zur Art „Spezies“ und zu „Alles ist ein Artikel“.
- **Nicht geprüft:** die Faustregel für den HG und das EP-Budget stammen aus den Regelwerken, wie
  ich sie kenne – gegen das Buch des Spielleiters gegenzulesen.

**Aufräumen der Navigation (12. 11. 2026, auf Wunsch des Spielleiters) – gebaut.** Von elf auf
sieben Einträge.

- **Karten:** Atlas, Karten und Erkundung stehen unter „Karten“ als Reiter Weltkarte · Karten ·
  Hexkarten (`MAP_TABS`, `shell/AreaTabs`). Sprünge: von einem Ort der Weltkarte zu den Karten,
  die ihn zeigen (`mapsShowing`), und von einer Karte zurück auf die Weltkarte. Die drei haben
  weiter getrennte Daten – das gemeinsame Kartenmodell aus dem Konzept (4.3) steht noch aus.
- **Zeit:** Kalender und Chronik als zwei Reiter (`TIME_TABS`).
- **Welt = Weltdatenbank + Wiki:** eine Seite (`features/welt/index.tsx`), erreichbar über
  `/welt/…` (Eintrag) und `/wiki/…` (Artikel). Die Übersicht links hat eine Suche für beides
  (Einträge, dazu Artikel nach Titel und Text) und zwei Ansichten: „Nach Art“ (wie bisher) und
  „Ordner“ (der Baum der Artikel). Die Seite eines Eintrags zeigt seinen Artikel als ersten
  Reiter „Text“ – zum Lesen und Schreiben, mit Steckbrief-Hinweis und KI-Leser; ohne Artikel
  bietet der Reiter „Artikel schreiben“ an. Ein Artikel, der einem Eintrag gehört, hat keine
  eigene Seite mehr (`WikiRoute` leitet um). Die Startseite zeigt das Dashboard der Welt und
  darunter die Artikel (Regal, KI-Leser, Steckbriefe, Gesuchtes). Die Daten sind unverändert.
- **Offen:** Einträge ohne Artikel stehen nicht im Ordnerbaum (nur unter „Nach Art“); die
  Verschachtelung der Orte und die Ordner der Artikel sind weiter zwei Bäume; „lange Pfade“
  (Konzept 4c) nicht angefasst; Bestiarium und Fadenbrett sind eigene Bereiche und noch keine
  Reiter an der Seite eines Dings.

**Lebendige Welt, Schritte 1 und 2 (12. 11. 2026) – gebaut.** Nach
`docs/KONZEPT-WELT-UND-KARTEN.md`, Abschnitt 3 und Reihenfolge in 5.

- **Zustände an Wegen, die von selbst entstehen** (`domain/wayState.ts`): Das Wetter wirkt auf
  den Weg – nichts wird gespeichert, der Zustand folgt aus dem Wetter von heute, gestern und
  vorgestern an beiden Enden (`wayCondition`). Boden (`soilOf`): befestigt (Straße, Gasse),
  fest, nass (Sumpf – auch von einer gezeichneten Karte abgelesen), unter der Erde. Regeln:
  Starkregen heute/gestern → fester Boden verschlammt (halbes Tempo), nasser Grund nicht
  passierbar; Starkregen vorgestern oder Regen seit zwei Tagen → nasser Grund verschlammt;
  starker Schnee heute/gestern → jeder Weg im Freien außerhalb der Stadt verschneit (halbes
  Tempo). `waysFrom` rechnet die längere Dauer ein (`way.weather`), ein verschluckter Weg gilt
  wie versperrt: `routeBetween` nimmt den Umweg. Am Spieltisch stehen Dauer, Zeichen und Grund
  am Weg. Beim Anlegen sagt der Spielleiter, was für ein Weg es ist („Was für ein Weg“ im
  Dialog, `WAY_SORTS`); ohne Angabe ist ein Weg eine Gasse – wie bisher, das Wetter ändert
  nichts an ihm. Wege von gezeichneten Karten bringen Straße oder Pfad schon mit.
- **„Die Welt dreht sich weiter“** (`domain/worldTurn.ts`, Seite `features/geschehen`, dritter
  Reiter unter „Zeit“: „Weltgeschehen“): rechts die Uhren und was der Spielleiter beobachtet
  (`state.watch`: Personen, Orte, Fraktionen – alles zu ihnen steht oben, auch Orte darin);
  links das Geschehen nach Gewicht (`turnWeight`: am Ort der Gruppe, in derselben Gegend,
  höchstens einen Tagesmarsch entfernt – `DAY_MARCH` –, oder es betrifft Bekannte), der Rest
  eingeklappt („Weit weg“). Schalter Überblick (14 Tage) / Alles (90 Tage, aufgeklappt).
  Quellen: Schritte der Uhren und eingetretene Ereignisse aus der Chronik, dazu Wege, die das
  Wetter verändert hat – gebündelt nach Zustand und Gegend („Zwei Wege verschlammt in Graufels“).
- **Regelmäßige Abläufe, Ausbleiben, Uhren mit Bedingungen, Vorschläge (12. 11., Schritte 3
  und 4) – gebaut.**
  - *Abläufe* (Sammlung `runs`, `domain/runs.ts`): Strecke (von – nach, über das Wegenetz),
    Fahrplan (alle n Tage, Wochen, Monate ab einer ersten Abfahrt), Träger (Text), Betreiber.
    `tripsBetween` nennt die Fahrten mit Abfahrt und Ankunft; das Wetter am Tag der Abfahrt
    verzögert die Ankunft von selbst. `runProblem`: ausgesetzt oder Betreiber tot, verschollen,
    gelöscht → es fährt niemand (das folgt eindeutig). `runStatus`: unterwegs, wartet, fährt
    nicht.
  - *Ausbleiben:* War ein Weg der Strecke am Tag der Abfahrt nicht passierbar, ist das ein
    **Vorschlag** (`openTrips`), kein Urteil: „Fällt aus“ (`decideTrip … 'missed'`) oder „Fand
    statt“. Nach 14 Tagen gilt eine fragliche Fahrt als gefahren (`RUN_WINDOW`). Eine
    ausgefallene Fahrt steht zur fälligen Ankunft im Weltgeschehen: „… bleibt in X aus – am Ziel
    weiß man, dass etwas fehlt, aber nicht, warum“.
  - *Uhren mit Bedingungen:* Ein Schritt trägt eine Bedingung in Worten (`step.needs`) und
    kann an einem Ablauf hängen (`step.runId`). Ist dessen letzte fällige Fahrt ausgefallen
    oder fährt er nicht (`runFailure`), tritt der Schritt beim Zeitsprung nicht ein: Die Uhr
    steht mit Grund (`clock.blocked`, `advanceTime` → `result.blocked`, auch in der Meldung
    „Währenddessen“). Sie plant nie von selbst um. `blockClock` blockiert von Hand
    („Bedingung ist weggefallen“); `resumeClock` lässt weiterlaufen und löst den Schritt von
    seinem Ablauf. Fadenbrett zeigt „blockiert“.
  - *Vorschläge:* eigene Spalte oben rechts im Weltgeschehen (`worldTurn().suggestions`):
    fragliche Fahrten und blockierte Uhren – getrennt von dem, was sicher geschehen ist.
- **Offen (nächste Schritte der Reihenfolge):** „weiß es noch nicht / frühestens / spätestens“
  bei verdeckten Vorhaben; Träger als Eintrag der Welt wählen (`carrierId` steht bereit);
  Abläufe als Träger von Nachrichten; Patrouillen und Lieferungen als Begegnung unterwegs;
  Nachrichten über Träger; NSC-Stufen und Lebendigkeit je Ort; Wissensebenen und
  Gerüchte. Außerdem: weitere abgeleitete Folgen (Vorrat aufgebraucht, Verfall), „Seit eurem
  letzten Besuch“ mit Zuständen, NSC reisen wie die Gruppe, Zustand der Wege auf der Karte
  zeigen, die Art handgemachter Wege aus der Lage erkennen statt abfragen.

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

### Wegenetze und Fadenbrett als Pinnwand (13. 11. 2026) – gebaut

Der Spielleiter: Als Nächstes kommen mehrere „Point Crawls“ (der Weg von der Bucht bis in die
Stadt in der Tiefe, der Weg aus der Drow-Stadt hinaus) – die müssen sich vorbereiten lassen, ohne
in der App so zu heißen. Und: Das Fadenbrett sei unübersichtlich, habe keine Linien mehr und
solle „wie eine Art Whiteboard“ funktionieren.

- **Wegenetze** (Sammlung `nets`, `domain/net.ts`, `features/wegenetz`, Reiter unter „Karten“):
  ein Blatt mit Punkten (Orten der Welt) und den Wegen dazwischen. Punkte ziehen, Weg zu einem
  Punkt ziehen, „Nächster Punkt“ (Name + Dauer, Enter), Doppelklick legt einen Ort an. Rechts:
  am Punkt „Was hier ist“ / „Nur für dich“ (Notizen und Spielleiterwissen des Ortes), was dort
  hängt (Geschichten, Fäden, Uhren, Bestände, Begegnungen), Wege von hier; am Weg Dauer (als
  Text: „2 Tage“), Art, Name, Besonderheiten, **Unterwegs** (Text) und **Begegnung unterwegs**,
  nur eine Richtung, der Gruppe unbekannt. „Strecke schreiben“ übernimmt Ketten mit Pfeilen und
  zeigt vorher, welche Orte neu entstehen. Am Spieltisch: Knopf „Wegenetz“; ein Weg, auf dem
  etwas wartet, zeigt es vor dem Aufbruch.
- **Fadenbrett als Pinnwand:** Karten (Geschichten, lose Fäden) und Namen (Personen, Orte,
  Fraktionen) liegen frei auf einem Blatt, Fäden verbinden sie; ein Name, an dem mehrere Karten
  hängen, ist golden – dort berühren sich Geschichten. Ziehen legt hin (`state.board`), der
  Rest wird ausgelegt (`boardLayout`), „Aufräumen“ legt alles neu aus. Karten sind knapper;
  das Seitenteil trägt die Einzelheiten. Neu im Seitenteil: Uhr anlegen und ändern, Namen
  anheften. Doppelklick aufs Brett legt eine Geschichte an.
- **Nicht geprüft:** installierte App, echte Daten, sehr große Netze (30+ Punkte), Bretter mit
  vielen Geschichten.
- **Offen:** Verirren und Abkürzungen abseits der Wege; Punkt für Punkt gehen mit Halt (heute:
  Nachbarpunkt wählen → „Hierher gehen“); Licht und Vorräte auf langen Wegen unter der Erde;
  ein Netz in einem Punkt (Stadt in der Strecke) ist heute einfach ein zweites Netz; Geschichte
  auf einem Blatt schreiben (Vorhaben, Uhr, Fäden, Hinweise zusammen) – der Spielleiter nennt
  das Vorbereiten von Geschichten „noch sehr schwer“.

### Spieltisch aufgeräumt: „Im Spiel“ (13. 11. 2026) – gebaut

Der Spielleiter: „Der Spielleitertisch muss auch aufgeräumt werden. Hier müssen wir quasi die
aktuell wichtigen Geschichten und davon abhängigen Dinge notieren und sehen.“ Erst als Probe
gezeigt (`docs/proben/spieltisch.html`), dann so gebaut.

- **Drei Spalten:** links der Ort (Kopf mit Knöpfen unter dem Namen, Orte hier, Wege, „Seit
  eurem letzten Besuch“, wer hier ist, „Wer hier haust“, „Was hier ist“, „Nur für dich“, was
  hier bisher geschah) · Mitte „Im Spiel“ · rechts Mitschrift und „Sonst noch“. Unten die
  Gefährten.
- **Im Spiel** (`domain/play.ts`, `tisch/PlayPanel.tsx`): Geschichten und lose Fäden, die der
  Spielleiter hereinnimmt (Knopf „Geschichte“, auch „Neue Geschichte schreiben“). Die erste ist
  aufgeklappt: nächster Schritt der Uhr; **Liegt hier** (Hinweise zum Abhaken, Einstiege);
  **Hier** (ihre Leute am Ort); **Faden**; **Abmachung** (Haken, Kreuz); **Termin**;
  **Merkzettel** (`story.memo`); **Notiert** (Notizen mit `storyId`, Eingabe darunter).
  Zugeklappt: eine Zeile. Unten: was den Ort berührt, aber nicht im Spiel ist – zum
  Hereinnehmen.
- **Weg vom Tisch:** der Kasten „Was diesen Ort gerade berührt“ (in „Im Spiel“ aufgegangen) und
  der Auszug aus dem Artikel (der Knopf „Artikel“ öffnet ihn). „Anstehend“ heißt „Sonst noch“
  und zeigt nicht, was schon bei einer Geschichte steht.
- **Nebenbei:** In der Weltleiste schob ein langer Ortsname „Festhalten“ aus dem Bild – jetzt
  gibt nur der Ort nach.
- **Nicht geprüft:** installierte App, echte Daten. Bei 1280 Breite ist es eng (Spalten 328 /
  414 / 269), aber nichts läuft über.
- **Offen:** Begegnungen und Bestände einer Geschichte bei ihr zeigen; @-Verweise in der
  Notiz zur Geschichte; Reihenfolge der Geschichten von Hand; Punkt 19 des Rundgangs (kleine
  Schrift) gilt weiter.

### Geschichten schreiben: das Blatt – und Uhren gehören zu Geschichten (13. 11. 2026) – gebaut

Der Spielleiter fand das Vorbereiten von Geschichten „noch sehr schwer“ (drei Fenster an zwei
Stellen) und die Uhren „irgendwie weird“ – sie sollten zu den Geschichten, nicht in den
Kalender. Vorher nachgelesen, wie Abenteuer vorbereitet werden (Lage statt Ablauf; wer will was;
was geschieht, wenn niemand eingreift; drei Hinweise je Erkenntnis; Einstiege; Begegnungen mit
Zweck; Ende und Belohnung; für den Abend: starker Einstieg, Szenen, Geheimnisse ohne festen
Ort).

- **Das Blatt** (`faeden/StoryPage.tsx`, `/geschichte/<id>`): Name · Worum es geht + Antreiber
  · Was auf dem Spiel steht (`stakes`) · Wenn niemand eingreift (Schritte der Uhr, direkt
  geschrieben; „Eingreifen“ öffnet `ClockDialog`) · Fragen und Hinweise (Fäden mit Antwort,
  Zustand, Hinweisen samt Ort und Quelle; Zähler „2 von 3“) · Einstiege · Szenen und Begegnungen
  (`scenes`: Text, kommt sicher / vielleicht / eher nicht, Begegnung wählen oder neu anlegen) ·
  Leute und Orte · Wie es enden kann (`ending`) und was die Gruppe davon hat (`reward`) ·
  Merkzettel. Rechts: Im Spiel, Gruppe weiß davon, zu Ende erzählt; **Noch offen** (Rat aus
  `storyAdvice`); Berührt. Alles schreibt beim Verlassen des Feldes.
- **Wege dorthin:** „Geschichte“ und Doppelklick auf dem Fadenbrett legen eine leere an und
  öffnen ihr Blatt; „Schreiben“ im Seitenteil; „Blatt öffnen“ am Spieltisch; die Suche. Das
  Fenster „Geschichte“ gibt es nicht mehr.
- **Uhren:** aus dem Kalender entfernt (Knopf „Uhr“, Zeilen unter „Läuft gerade“). Im
  Weltgeschehen öffnet eine Uhr das Blatt ihrer Geschichte. Eine Uhr ohne Geschichte steht dort
  mit dem Vermerk und auf dem Fadenbrett unten links („Uhren ohne Geschichte“) – ein Klick macht
  eine Geschichte daraus. Eine Geschichte zu löschen nimmt ihre Uhr mit.
- **Am Spieltisch** stehen die Szenen einer Geschichte im Spiel bei ihr, mit „Begegnung
  öffnen“.
- **Nicht geprüft:** installierte App, echte Daten.
- **Offen (Reihenfolge der Pläne):** 2. einen Abend vorbereiten (starker Einstieg, mögliche
  Szenen, Geheimnisse ohne festen Ort, die in den nächsten Abend wandern, Beute) · 3. Gefährten
  einbinden (was jeder will; an Geschichten heften) · 4. Beute und Belohnungen · Schritte einer
  Uhr stehen weiter als „Veränderung“ in der Mitschrift (Rundgang 13).

### Abend vorbereiten (13. 11. 2026) – gebaut

Plan 2 aus der Liste nach dem Nachlesen (acht Schritte der „faulen“ Vorbereitung).

- **Das Blatt** (`features/abend`, `/abend`, Reiter „Abend vorbereiten“ neben dem Fadenbrett):
  Die Gefährten (was jeder will – `character.goal`, auch im Fenster des Gefährten) · Starker
  Einstieg · Geschichten im Spiel (hereinnehmen, herausnehmen, neue schreiben) · Mögliche Szenen
  (abhaken: gespielt) · Geheimnisse und Hinweise (abhaken: aufgedeckt; auf Wunsch einer
  Geschichte zugeordnet; Zähler „4 von 10“; Enter legt gleich das nächste an) · Begegnungen
  bereit · Beute. Rechts der Rat (`prepAdvice`).
- **Ein Blatt je Abend** (Sammlung `preps`): Das offene Blatt gilt dem kommenden Abend; beginnt
  eine Session, gehört es zu ihr. Nach dem Abend beginnt das nächste Blatt mit den Szenen, die
  nicht gespielt, und den Geheimnissen, die nicht aufgedeckt wurden (`carryOver`) – Einstieg,
  Begegnungen und Beute bleiben beim alten. Wer mitten im Abend zu schreiben beginnt, schreibt
  auf das Blatt dieses Abends.
- **Am Spieltisch** steht „Dieser Abend“ über den Geschichten im Spiel (`tisch/EveningBlock`):
  Einstieg, Szenen und Geheimnisse zum Abhaken (mit „Rückgängig“), Begegnungen zum Öffnen,
  Beute.
- **Gemeinsame Bausteine:** `ui/sheet.tsx` und `ui/sheet.css` tragen jetzt beide Blätter
  (Geschichte und Abend).
- **Nicht geprüft:** installierte App, echte Daten, der Wechsel über mehrere Abende nur in
  Tests.
- **Offen:** ältere Blätter ansehen (was für Session 11 vorbereitet war); ein aufgedecktes
  Geheimnis steht nicht von selbst in der Mitschrift; Gefährten an Geschichten heften (Plan 3);
  Beute als eigene Sache statt als Text (Plan 4).

### Gefährten an Geschichten (13. 11. 2026) – gebaut

Plan 3: Bei jedem Gefährten steht, was er will, und er lässt sich an eine Geschichte heften.

- **An der Geschichte** (`story.heroes`): Abschnitt „Wen es persönlich betrifft“ auf dem Blatt
  – Gefährte, sein eigener Grund, darunter sein Ziel. Rat: „Ein Gefährte hat einen eigenen
  Grund“.
- **Unter „Abend vorbereiten“:** bei jedem Gefährten sein Ziel und seine Geschichten (die nicht
  im Spiel sind, gedämpft), dazu „an Geschichte heften“. Rat: „Für jeden Gefährten ist etwas
  dabei“ – nennt, wen keine Geschichte im Spiel betrifft (`withoutHook`).
- **Seite des Gefährten:** Kasten „Geschichten“ mit Ziel und den Geschichten samt Grund.
- **Spieltisch:** Zeile „Betrifft“ bei einer Geschichte im Spiel.
- **Fadenbrett:** Ein angehefteter Gefährte ist ein Name auf dem Brett; hängt er an zwei
  Geschichten, ist er golden.
- **Nebenbei:** Ein Feld auf einem Blatt (`Written`) übernimmt jetzt, was woanders geändert
  wurde.
- **Nicht geprüft:** installierte App, echte Daten.
- **Offen:** lose Fäden lassen sich nicht an Gefährten heften.

### Beute und Belohnungen: das Beute-Buch (13. 11. 2026) – gebaut

Plan 4, nach der Entscheidung im Konzept (§ 4d): Die Spieler führen ihr Inventar selbst;
Wayfarer merkt sich, was die Gruppe bekommt.

- **Ein Eintrag** (`loot/`): was es ist (in Worten), Gold, auf Wunsch ein Gegenstand der Welt,
  für wen (Gefährte oder die Gruppe), woher, zu welcher Geschichte. Er liegt bereit oder ist
  ausgegeben.
- **Vorbereiten:** unter „Abend vorbereiten“ im Abschnitt „Beute“ (das alte Textfeld bleibt als
  „Gedanken zur Beute“) und auf dem Blatt einer Geschichte unter „Wie es enden kann“.
- **Am Spieltisch:** bereitliegende Beute steht bei ihrer Geschichte im Spiel, sonst unter
  „Dieser Abend“ – mit „ausgeben“. Dort auch „Beute ausgeben“ für Ungeplantes. Ausgeben schreibt
  eine Zeile in die Mitschrift; ein Gegenstand der Welt gehört danach dem Empfänger.
  „Rückgängig“ nimmt alles zurück.
- **Beute-Buch** (Reiter unter Gefährten, `/beute`): was bereitliegt, was an welchem Abend
  hinausging (mit „Kopieren“ für den Gruppenchat), rechts „Wer was hat“.
- **Seite des Gefährten:** Kasten „Erhalten“ mit Gold und den letzten Einträgen.
- **Nicht geprüft:** installierte App, echte Daten, „Kopieren“ in der installierten App.
- **Offen:** Beute aus einem Bestand (Hort) oder einer Begegnung heraus vorschlagen; Gold in
  anderen Münzen (Silber, Kupfer).

### Funde des Spielleiters (13. 11. 2026) – behoben

- **Abend vorbereiten:** „an Geschichte heften“ steht immer da und kann eine neue Geschichte für
  den Gefährten anlegen (öffnet ihr Blatt). Unter „Starker Einstieg“: „Wo es zuletzt aufhörte“ –
  die letzten fünf Einträge der vorigen Session, je mit „Übernehmen“ (hängt die Zeile an).
- **KI-Leser:** Abmachungen kommen an den Tag, an dem sie getroffen wurden (Antwort, zitierter
  Satz oder Datumsfeld in der Karte); ohne Tag vor den Beginn der Mitschrift. Ein Datum nach
  „bis“, „spätestens“ … gilt als Frist, nicht als Tag der Abmachung. Schon früher angenommene
  Abmachungen bleiben, wo sie stehen – in der Chronik lässt sich ihr Tag von Hand ändern.
- **Bestiarium:** Knöpfe brechen um statt über den Rand zu laufen (Liste, Leisten von
  Begegnungen und Beständen, Statblock in schmaler Spalte). Werteblöcke: PDF mit getrennten
  Zeilen, D&D Beyond (2014 und 2024), deutsche Übersetzung („STÄ“, „W“-Würfel, Meter), Hort- und
  Regionalaktionen; was nicht verstanden wurde, steht im Dialog.
- **Nicht geprüft:** installierte App; Werteblöcke aus echten Büchern (nur erfundene Wesen).
- **Offen:** Hortaktionen haben keinen eigenen Abschnitt (stehen bei den legendären Aktionen);
  Zauberlisten werden zu einem Absatz; eine Frist aus dem Satz wird nicht als Fälligkeit gesetzt.

## 6. Bekannte Mängel und Aufräumliste

### Rundgang am 12. 11. 2026 (ganze App, gefüllte erfundene Welt, 1440 × 900)

Der Spielleiter fragte, ob Wayfarer auch als Ganzes geprüft wird. Ergebnis war eine Liste mit 19
Punkten; behoben sind die sechs Fehler und die Punkte 7 bis 9 (sowie 15 und 17 nebenbei):

- **Artikel und Eintrag gleichen Namens** gehören zusammen: `twins()` (`wiki/facts.ts`) findet
  sie, `linkTwins()` verbindet sie – beim Anlegen eines Artikels, vor dem Lesen der Steckbriefe
  und laufend über `TwinSync` im Gerüst. Nur was eindeutig ist (genau ein Artikel, genau ein
  Eintrag, keine andere Art im Steckbrief).
- **Wege aus einem Viertel heraus:** `routeBetween` nimmt auch die Wege der Orte darüber und
  lässt am Ziel den Ort gelten, in dem es liegt (`route.toId` ist das gefragte Ziel). Am
  Spieltisch stehen hinter den Wegen des Viertels die aus der Stadt hinaus (`waysAround().above`).
- **Suche** findet alles Angelegte (`shell/search.ts`, `searchWorld`) und springt hin
  (`shell/focus.ts`); sie fragt beim Schließen nicht mehr nach.
- **Tote und Verschollene** sind nie anwesend: `placeCast().lost`, eigene Gruppe am Spieltisch
  und auf der Seite des Ortes.
- **Weltgeschehen:** Der Überblick reicht bis vor den letzten Zeitsprung und zum Beginn der
  laufenden Session zurück (`turnDays`).
- **Kalender:** Der Kopf passt auf 1440 Breite (die Legende zeigt dann nur die Farben).
- **Spieltisch:** „Was diesen Ort gerade berührt“ und „Wer hier haust“ sind je eine Zeile zum
  Aufklappen; die Mitschrift bekommt mehr Höhe als „Anstehend“.
- **Messing:** „Festhalten“ in der Weltleiste ist nur am Spieltisch aus Messing; die Seite eines
  Eintrags, der Kalender und die Hexkarten haben je einen.

**Noch offen aus dem Rundgang** (erst Probe zeigen, es geht um Geschmack): 10 Personenseite
zeigt vieles doppelt · 11 Kalender: Titel brechen mitten im Wort, untere Kästen sehr niedrig ·
12 Fadenbrett: Linien werden zum Knäuel · 13 Schritte geheimer Uhren stehen in der Mitschrift
des Abends · 14 Welt-Übersicht mit Kacheln „0“ · 16 Kasten zu LegendKeeper im Reiter „Text“ ·
18 Einstellungen sehr lang · 19 viel kleine Schrift am Spieltisch. Nicht geprüft wurden Karten
mit Inhalt, der Editor, der KI-Leser und die installierte App.

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
