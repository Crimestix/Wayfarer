# Alpha 1.0 – Befund- und Abnahmestand

Fortlaufender Stand zum Arbeitsauftrag „Wayfarer Alpha 1.0“ (Audit vom 20. 11. 2026,
Grundlage `a346634`, 21 Befunde F01–F21, 36 Prüfbereiche M01–M36, 60 Abnahmefälle K01–K60).
Wer hier weiterarbeitet, liest zuerst diesen Stand: Was offen ist, steht als offen da.

## Ausgangsstand

- Zweig `alpha-1.0`, abgezweigt von `welle4/atlas-stukvu` = `origin/main` = `a346634`
  („Übergabe: Paket 0.1.39“). Keine fremden lokalen Änderungen vorgefunden.
- Ausgangsprüfung in der Cloud-Umgebung (Linux): `npm test -- --maxWorkers=2` → 227 Dateien,
  2829 Tests bestanden; `npm run build` erfolgreich (Hinweis auf große Chunks, nicht gemessen).
- Zwei Dateien standen schon vorher nicht im Format von Prettier (`domain/syncMerge.ts`,
  `features/welt/knowledge.test.ts`) – unverändert gelassen.

## Umgebung und ihre Grenzen

| Prüfart                                                                            | Möglich hier?                           | Bemerkung                                                                                   |
| ---------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Logiktests (Vitest), Typprüfung, Produktionsbuild                                  | ja                                      | Linux-Container                                                                             |
| Oberfläche im Browser (Vorschau `npm run dev`, Playwright/Chromium)                | ja                                      | Speicherung im Browser, nicht der Kampagnenordner                                           |
| Native Windows-App starten, Kampagnenordner, Dateirechte, Schließen beim Speichern | **nein**                                | kein Windows-Rechner; bleibt offen, bis am Windows-PC geprüft                               |
| Installer bauen                                                                    | ja, über GitHub Actions („Alpha bauen“) | ein gebauter Installer ist **keine** ausgeführte Desktopprüfung                             |
| macOS                                                                              | nein                                    | nur CI-Bau                                                                                  |
| Echte Kampagnenkopie (Elaris, Atlas, Brett, Dungeons)                              | **nein**                                | liegt nicht in dieser Umgebung; geprüft wird mit erfundenen Daten und dem Elaris-Grundstand |
| Abgleich gegen GitHub, KI-Leser mit echtem Schlüssel                               | nein                                    | nur Attrappe; keine kostenpflichtigen Abrufe                                                |

Rückfall vor jedem Test der Alpha am eigenen Rechner: siehe „Rückfall“ unten.

## Befunde F01–F21

Status: **behoben** (Änderung + Nachprüfung), **widerlegt** (Gegenbeleg), **offen**, **teilweise**.
Beleg: T = Regressionstest im Repository, B = im Browser nachgeprüft (Vorschau), N = nativ.

| ID  | Kurz                                             | Prio | Status      | Beleg / Ort                                                   |
| --- | ------------------------------------------------ | ---- | ----------- | ------------------------------------------------------------- |
| F01 | Schreiben erfordert vorab eine Einordnung        | P1   | behoben     | „Frei schreiben“ ohne Pflichtangaben; Test                    |
| F02 | Geschichten nach Methode bewertet                | P1   | behoben     | Stand/Rat nur mit „Hinweise zur Form zeigen“; Test            |
| F03 | Kurze freie Texte als Pflegebedarf gezählt       | P1   | behoben     | Platzhalter nicht mehr gezählt; Test                          |
| F04 | „Zuletzt“ ohne eigenständige Artikel             | P1   | behoben     | „Weiterarbeiten“ mit freien Artikeln; Test                    |
| F05 | Material einer Reise verteilt                    | P1   | behoben     | Mappe an Text/Geschichte, Rückweg; Browser + Test             |
| F06 | Live-Steuerung beim Gestalten dominant           | P1   | behoben     | Arbeitsansicht in der Leiste; Browser: keine Datenänderung    |
| F07 | Nachschlagen öffnet volles Dossier               | P2   | behoben     | Seitenblatt schmal mit Kurzblick; Browser + Test              |
| F08 | Unbekannter Aufenthalt als „fort“                | P1   | **behoben** | T: `data/__tests__/campaign.test.ts` „F08 …“                  |
| F09 | Hexmaßstab Dialog ≠ Ergebnis                     | P1   | **behoben** | T: `erkundung/generate.test.ts` „F09 …“                       |
| F10 | Ortsauswahl gewichtet Maßstäbe schlecht          | P2   | behoben     | Auswahl: Zuletzt, dann Größe, Räume zuletzt; Test             |
| F11 | Dossier lässt wenig Raum für den Artikel         | P2   | behoben     | Text nach Steckbrief, „Breit schreiben“; Browser              |
| F12 | Weltstartseite betont Pflegeaufwand              | P2   | behoben     | Start: Schreiben und Weiterarbeiten vorn, Pflege unten        |
| F13 | Lokale Vorbereiten/Spielen-Wechsel uneinheitlich | P2   | behoben     | Karten beginnen passend; Würfeln/Löschen nur beim Vorbereiten |
| F14 | „verwaltet“ als Herrschaft vorgeschlagen         | P2   | behoben     | „verwaltet“ eigene Beziehung; Test                            |
| F15 | Bastionsverlauf nach Umbenennen weg              | P1   | **behoben** | T: `bastion/rooms.test.ts` „F15 …“; Datenversion 43           |
| F16 | Gelöschter Statblock beschädigt Begegnungen      | P1   | **behoben** | T: `bestiarium/bestiarium.test.ts` „F16 …“                    |
| F17 | Strg/Cmd+E doppelt belegt                        | P1   | **behoben** | B: reproduziert und nachgeprüft; T: `shell/shortcuts.test.ts` |
| F18 | Sammelartikel als Personen                       | P2   | behoben     | Sammelseiten bleiben Text; Hinweis bei Bestand; Test          |
| F19 | Sicherung ohne Medien                            | P1   | offen       |                                                               |
| F20 | Gewichtung von Nebeninformationen                | P2   | behoben     | Kontrast ≥ 4,5:1, Fokus sichtbar; Browser gemessen            |
| F21 | Abendblatt als Methode                           | P2   | behoben     | Abendblatt frei, Führung als Schalter; Browser + Test         |

### Einzelheiten

**F01 – Freier Schreibbeginn.** Alter Ablauf: „Neu“ begann als Person, Name Pflicht
(im Browser bestätigt). Änderung: „Neu“ beginnt als freier Text ohne Art, der Name ist dort
freiwillig („Entwurf“, „Entwurf 2“ … über `draftTitle`); auf der Weltstartseite steht „Frei
schreiben“ als Haupthandlung (`startFreeText`). Einordnen bleibt jederzeit möglich, nie Pflicht.

**F02 – Geschichten nicht nach Methode bewerten.** Alter Ablauf: Jede Geschichte zeigte Stand
(Keim/Spielbar/Rund) und Rat. Änderung: Feld `story.guide` (Vorgabe aus, Datenversion 43); Stand
und Rat erscheinen auf Blatt und Abendblatt nur mit „Hinweise zur Form zeigen“.

**F03/F04/F12 – Weltstart.** `gapCount` zählt nur noch fehlende Texte und genannte, aber
ungeschriebene Namen – keine kurzen Texte oder Platzhalter. Die Weltstartseite beginnt mit
„Frei schreiben“ und „Weiterarbeiten“ (`recentWork`: Einträge mit Text, freie Artikel,
Geschichten, Wegenetze, Hexkarten, Dungeons), dann die Kategorien mit Inhalt (leere auf Klick),
und erst unten „Pflege, wenn du magst“.

**F06/F13 – Zwei Arbeitsansichten.** Begriffspaar überall „Vorbereiten / Spielen“. Umschalter in
der Weltleiste (`shell/workView.ts`, reine Ansicht, nicht gespeichert; ohne Wahl folgt sie dem
laufenden Abend). Beim Vorbereiten treten Uhr-Knöpfe, Ort, Wetter, Session und Monde zurück,
„Festhalten“ ist kein Messingknopf. Hexkarte und Dungeon beginnen in der passenden lokalen
Ansicht (`localWorkView`), „Neu würfeln“ und „Karte löschen“ stehen nur beim Vorbereiten.
Nachprüfung (K28) im Browser: Umschalten und Seitenwechsel lassen den gespeicherten Spielstand
byte-gleich. Grenze: Die Wahl gilt bis zum Neustart, nicht über ihn hinaus.

**F05 – Mappe.** Alter Ablauf: Text, Geschichte, Brett, Abendblatt, Wegenetz und Hexkarte
waren getrennte Einstiege ohne gemeinsamen Arbeitsplatz. Änderung: Jeder Text und jede
Geschichte trägt eine **Mappe** (`material`, nur Verweise auf Einträge, Texte, Geschichten,
Wegenetze, Hexkarten, Dungeons; `welt/material.ts`). „+ Material anheften“ sucht in allem,
zuletzt Bearbeitetes zuerst; ein Klick öffnet; auf dem Material steht der Rückweg „Liegt in der
Mappe von …“ (auch auf Wegenetz, Hexkarte, Dungeon). Nie doppelt, nie sich selbst; Rückgängig.
Mit „Weiterarbeiten“ (F04) und der Arbeitsansicht (F06) ist der Weg freie Idee → Nachschlagen
(F07) → Material/Karte → Wiederaufnahme geschlossen. Nachprüfung im Browser: zwei freie Texte,
anheften, öffnen, Rückweg. Grenze: Das Abendblatt hat noch keine eigene Mappe (es nimmt die
Mappen über Geschichten im Spiel nicht auf).

**F07 – Nachschlagen.** Das Seitenblatt öffnet schmal (420 px) mit Kurzblick (Art, Satz,
Wichtigstes, Steckbrief, Beziehungen) und dem ersten Absatz des Textes ohne Geheimes
(`leadOf`); „Alles hier zeigen“ öffnet das volle Dossier daneben, „Ganze Seite öffnen“ wechselt.

**F11 – Platz für den Text.** Ein geschriebener Text steht im Dossier gleich nach dem
Steckbrief, vor Listen wie „Orte darin“ und „Räume“; ohne Text wartet die Schreibfläche am
Ende. „Breit schreiben“ (Kopf der Seite, auch an freien Texten) blendet Liste links und Spalte
„Jetzt“ aus – reine Ansicht. Nebenbefund K07: Im Spielen ragte die Weltleiste schon bei 1440 px
über den Rand (durch den neuen Umschalter, bei 1366 px um 83 px). Behoben: Umschalter unter
1500 px als Zeichen (Name im Hinweis), unter 1400 px gibt der Ort nach, unter 1300 px treten
Monde und „+10 Min.“ zurück (Kalender bzw. Zeitmenü). Gemessen: 1440×900, 1366×768, 1280×800
und 1440×900 bei 125 % passen in beiden Ansichten.

**F21 – Abendblatt.** Vorgabe ist jetzt die freie Vorbereitung: ein freier Text oben
(`prep.text`), Fächer nur, wenn etwas darin steht oder sie dazugeholt werden („Fächer
dazuholen: …“), kein „Fang hier an“ und kein Rat. „Geführt vorbereiten“ (Kampagne,
`prepGuide`) zeigt das bisherige Blatt. Der freie Text steht am Spieltisch unter „Dieser
Abend“ und auf der gedruckten Seite.

**F08 – Unbekannter Aufenthalt.** Alter Ablauf: `placeCast` legte jede lebende Person mit
Zuhause im Ort und ohne Aufenthalt in `away`; das Dossier zeigte sie unter „Hier zu Hause, aber
fort“. Änderung: `placeCast` trennt `away` (ein anderer Ort ist eingetragen) von `homeUnknown`
(nichts eingetragen). Dossier: „Hier zu Hause, Aufenthalt nicht eingetragen“ mit Unterzeile
„vermutlich hier – nicht eingetragen“ (Annahme erkennbar, übersteuerbar über den Ort der Person)
und getrennt „Hier zu Hause, gerade anderswo“. Spieltisch und Weltstartseite zeigen beide Gruppen
wie bisher (der Spieltisch trennte schon richtig). Nachprüfung: Regressionstest; Oberfläche im
Browser noch nicht mit einer gefüllten Welt angesehen.

**F09 – Hexmaßstab.** Alter Ablauf: Unter der Erde rechnete der Dialog mit sechs Meilen je Feld,
die Auswahl kannte nur 2/10/50 km und zeigte deshalb „2 km je Feld“. Die Erzeugung selbst nahm
schon den gerechneten Wert. Änderung: `hexSizeOptions(size)` nimmt den geltenden Maßstab in die
Auswahl auf, Beschriftung über `scaleWords` („6 Meilen je Feld“), Hinweis „Unter der Erde: sechs
Meilen je Feld.“ bzw. „Von dir gewählt.“ Eigene Wahl bleibt erhalten. Nachprüfung: Test;
Browserdurchlauf mit Reisezeit (K25) offen.

**F15 – Bastionsverlauf.** Alter Ablauf: Verlauf = Chronik-Einträge, deren Text mit
„Bastionszug <heutiger Name>“ beginnt; nach Umbenennen leer. Änderung: neues Feld
`chronicle.bastionId` (Datenversion 43), `runTurn` setzt es; `bastionHistory()` ordnet über die
Kennung zu, ältere Einträge ohne Kennung über den Wortlaut mit heutigem Namen oder – nach
Umbenennen – am Ort der Bastion, nie über den Namen einer anderen Bastion. Keine Textersetzung.

**F16 – Statblock löschen.** Alter Ablauf: Begegnungen behielten die Kennung, Werte und EP fielen
auf 0, der Dialog nannte nur Erben. Gewählte Strategie: vollständige Ankündigung und
umkehrbares Löschen. `creatureUses()` findet Erben, Begegnungen, Bestände, Tiere, Reittiere,
Würfeltabellen, Läden, Landschaften; der Dialog nennt sie. `removeCreature` gibt ein `undo`
zurück, das Statblock (gleiche Kennung), Erben und Tierverweise wiederherstellt – danach stimmen
Begegnung und EP wieder. Meldung mit „Rückgängig“. Grenze: Nach Ablauf der Meldung bleibt der
Verweis in der Begegnung ohne Werte („nicht mehr im Bestiarium“) – ein Archiv für Statblöcke gibt
es nicht.

**F17 – Strg/Cmd+E.** Reproduziert in der Vorschau: Mit offenem Artikel öffnete Strg+E
„Festhalten“ und schaltete zugleich den Artikel um. Änderung: `shell/shortcuts.ts` – eine
Arbeitsfläche beansprucht das Kürzel (`useShortcut`), der einzige Lauscher in `AppShell` ruft die
zuletzt angemeldete Fläche, sonst „Festhalten“. Nachprüfung im Browser: mit Artikel nur
Umschalten, kein Dialog; am Spieltisch öffnet Strg+E „Festhalten“. Rest: Der Hinweis am Knopf
„Festhalten (Strg+E)“ gilt nicht, solange ein Artikel offen ist.

**F19 – Sicherung und Medien.** Alter Stand: Die Sicherungsdatei enthält Daten und von Hand
gewählte (eingebettete) Bilder, nicht aber die aus dem Netz geholten Bilder unter `media/`; einen
Weg, Daten und Bilder zusammen zu sichern, gab es in der App nicht. Änderung: Einstellungen →
Sicherung nennt den Umfang genau („N Bilder liegen nur im Ordner media …“, `backupGapText`) und
bietet in der installierten App „Vollständige Kopie mit Bildern“: neuer Befehl `campaign_copy`
(`src-tauri/src/copy.rs`) kopiert den ganzen Kampagnenordner in einen neuen Ordner (nie
überschreibend, nie in sich selbst), ohne `.abgleich/` und ohne beiseitegelegte Stände des
Testmodus – eine geöffnete Kopie gleicht also nicht ungefragt ab. Wiederherstellung: die Kopie
beim Start als Kampagne öffnen. Nachprüfung: Rust-Tests auf Linux (Kopie mit Bild, ohne
Abgleich/Testmodus; Name doppelt → „(2)“; Ziel im Kampagnenordner abgelehnt). **Offen:** Knopf
und Wiederherstellung in der installierten Windows-App (K48, K57).

## Abnahmematrix K01–K60

Status je Fall: offen / bestanden (Umgebung) / fehlgeschlagen / blockiert. „Bestanden (Vorschau)“
heißt: in der Browservorschau geprüft, nicht in der installierten App.

| Fall                                       | Status                                | Beleg / Bemerkung                                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K01 Einstieg und Wiederaufnahme            | bestanden (Vorschau)                  | „Weiterarbeiten“ auf der Weltstartseite, Mappe mit Rückweg (F04, F05); nach Neuladen derselbe Text                                                                                                                  |
| K02 Freier Text                            | bestanden (Vorschau)                  | „Frei schreiben“ ohne Pflichtangaben, „Entwurf“; kein Pflegezähler (F01, F03)                                                                                                                                       |
| K03 Freies Brett                           | offen                                 | Brett unverändert; kein eigener Durchlauf                                                                                                                                                                           |
| K04 Inline anlegen                         | bestanden (Vorschau)                  | „@Mara Fenn“ → Platzhalter, Fokus zurück im Feld, Rückgängig nimmt nur den neuen Eintrag                                                                                                                            |
| K05 Material eingrenzen                    | teilweise                             | Mappe (F05) geprüft; ganze Reiseprobe mit echter Welt offen                                                                                                                                                         |
| K06 Nachschlagen                           | teilweise                             | kompaktes Seitenblatt (F07) geprüft; Fokus-Rückkehr in den Editor nicht gemessen                                                                                                                                    |
| K07 Fenster und Lesbarkeit                 | bestanden (Vorschau)                  | Weltleiste 4 Größen; 22 Seiten ohne Querüberlauf bei 1280×800 und 1152×720 (125 %); nur mit kleiner Welt                                                                                                            |
| K08 Speichern und Unterbrechen             | **behoben**, bestanden (Vorschau)     | Fehler gefunden: Text im Editor bzw. in Blattfeldern ging beim sofortigen Neuladen/Schließen verloren. Jetzt geben Editoren und Felder vorher ab (Gegenprobe ohne Änderung: verloren). Native Schließen-Probe offen |
| K09 Editor und Formate                     | bestanden (Vorschau)                  | Liste, Tabelle, Geheim-Kasten; Lesen→Schreiben→Quelltext ohne Änderung; nicht erreichbares Bild wird gemeldet                                                                                                       |
| K10 Einfügen                               | offen                                 |                                                                                                                                                                                                                     |
| K11 Umbenennen und Verweise                | offen (Tests)                         | bestehende Tests grün; kein Browserlauf                                                                                                                                                                             |
| K12 Verschieben, Löschen, Wiederherstellen | offen (Tests)                         | bestehende Tests grün; kein Browserlauf                                                                                                                                                                             |
| K13 Entwurf und Zustand                    | offen                                 |                                                                                                                                                                                                                     |
| K14 Arten und Unterkategorien              | teilweise                             | Sammelseiten (F18) per Test; Kategoriewechsel im Browser offen                                                                                                                                                      |
| K15 Großer Weltbestand                     | blockiert                             | keine anonymisierte große Kampagnenkopie in dieser Umgebung; Auswahlordnung (F10) per Test                                                                                                                          |
| K16 Unbekannter Aufenthalt                 | teilweise                             | Logik behoben (F08); Oberfläche mit gefüllter Welt offen                                                                                                                                                            |
| K17 Dossier am Tisch                       | offen                                 |                                                                                                                                                                                                                     |
| K18 Weltzeit                               | bestanden (Vorschau)                  | zwei Tagessprünge, eingetretener Termin gemeldet und in der Chronik                                                                                                                                                 |
| K19, K20                                   | offen (Tests)                         | Kalender-Tests grün                                                                                                                                                                                                 |
| K21 Zeitsprung zurücknehmen                | bestanden (Vorschau)                  | „Zurück“ nimmt den letzten Sprung samt Termin-Eintrag; eine Stufe (so angekündigt); erneut ausgeführt genau ein Eintrag                                                                                             |
| K22–K24                                    | offen                                 |                                                                                                                                                                                                                     |
| K25 Hexmaßstab                             | teilweise                             | Auswahl behoben (F09); Reisezeit im Browser offen                                                                                                                                                                   |
| K26, K27                                   | offen                                 |                                                                                                                                                                                                                     |
| K28 Ansichtswechsel ohne Wirkung           | bestanden (Vorschau)                  | Spielstand byte-gleich (F06)                                                                                                                                                                                        |
| K29–K32                                    | offen                                 |                                                                                                                                                                                                                     |
| K33 Verwendeten Statblock löschen          | teilweise                             | Ankündigung + Rückgängig (F16) per Test; Oberfläche offen                                                                                                                                                           |
| K34–K39                                    | offen                                 |                                                                                                                                                                                                                     |
| K40 Bastionsverlauf                        | teilweise                             | Logik behoben (F15) per Test; Neuladen im Browser offen                                                                                                                                                             |
| K41–K44                                    | offen                                 |                                                                                                                                                                                                                     |
| K45 Beziehungsbedeutung                    | bestanden (Test)                      | „verwaltet“ ≠ Herrschaft (F14); Verneinung, Vergangenheit, Vermutung: bestehende Tests                                                                                                                              |
| K46, K47                                   | offen                                 |                                                                                                                                                                                                                     |
| K48 Vollständige Sicherung                 | teilweise                             | Kopierbefehl mit Medien per Rust-Test (F19); Knopf in der installierten App offen                                                                                                                                   |
| K49–K51                                    | blockiert                             | brauchen installierte App bzw. zwei Geräte                                                                                                                                                                          |
| K52 Optionaler KI-Leser                    | teilweise                             | Kern läuft ohne Schlüssel (alle Proben ohne); kein echter Abruf (kostenpflichtig, nicht beauftragt)                                                                                                                 |
| K53, K54                                   | offen                                 |                                                                                                                                                                                                                     |
| K55 Tastatur und Fokus                     | teilweise                             | Strg+E (F17); Fokus auf 12 Seiten je 20 Tab-Schritte sichtbar, alle Bedienelemente benannt (F20)                                                                                                                    |
| K56 Interaktionen                          | offen                                 |                                                                                                                                                                                                                     |
| K57 Installation und Rückfall              | blockiert                             | native Prüfung auf Windows/macOS nötig                                                                                                                                                                              |
| K58 Große Datenmenge                       | blockiert                             | keine große Probe; keine Messwerte erfunden                                                                                                                                                                         |
| K59 Routen und Nachladen                   | bestanden (Produktionsbuild, Browser) | Editor lädt nach; direkte Adressen öffnen; Text nach Neustart da; unbekannte Adresse ohne Absturz                                                                                                                   |
| K60 Freigabe und Testreste                 | offen                                 | Schlussprüfung in Phase E                                                                                                                                                                                           |

## Rückfall

1. Vor dem Installieren der Alpha den **ganzen Kampagnenordner** kopieren – einschließlich
   `media/` (Bilder liegen nur dort, nicht in der JSON-Sicherung, siehe F19). In der Alpha geht
   das danach auch über Einstellungen → Sicherung → „Vollständige Kopie mit Bildern“.
2. Den bisherigen Installer (0.1.39) aufheben. Die Alpha hat dieselbe App-Kennung: Sie
   **ersetzt** die installierte App. Zurück geht es, indem man den alten Installer wieder
   ausführt.
3. Die Alpha erhöht die Datenversion (43). Eine mit der Alpha geöffnete Kampagne nicht mehr mit
   der alten App öffnen; zurück geht es nur mit der Kopie aus Schritt 1.
4. Die Alpha zuerst mit einer **Kopie** der Kampagne öffnen, nie mit dem Original – und in der
   Kopie den Abgleich nicht einrichten (die Kopie aus „Vollständige Kopie mit Bildern“ enthält
   ihn ohnehin nicht).
5. Welche Fassung läuft, steht unter Einstellungen → Quellen → „Diese Fassung“.

## Alpha-Paket

- Workflow „Alpha bauen“ (`.github/workflows/alpha-bauen.yml`): baut bei jedem Push auf einen
  Zweig `alpha-…` Pakete für Windows (`-setup.exe`) und macOS (`.dmg`, Apple Silicon und Intel)
  als **Anhang des Laufs** (Actions → Lauf → „Artifacts“, 14 Tage). Kein Tag, keine
  Veröffentlichung, kein Updater. Der Workflow „Veröffentlichen“ wurde nicht benutzt.
- Version: `0.2.0-alpha.<Laufnummer>`.
- **Gebaut:** Lauf 44791127572 (Stand `093a607`), 20. 11. 2026 – `Wayfarer-0.2.0-alpha.2-Windows`
  (8,7 MB, `-setup.exe`) und `Wayfarer-0.2.0-alpha.2-macOS` (22,2 MB, `.dmg`), abrufbar bis 4. 12. 2026 unter Actions → „Alpha bauen“ → Lauf 2 → Artifacts. Nicht installiert, nicht
  gestartet.
- Ein gebautes Paket ist **keine** ausgeführte Desktopprüfung (K57 bleibt offen, bis die Alpha
  am Windows-PC mit einer Kampagnenkopie geöffnet wurde).

## Funktionsumfang der Alpha (Änderungen gegenüber 0.1.39)

- **Frei schreiben**: „Neu“ beginnt als freier Text ohne Pflichtangaben; Weltstart mit
  „Frei schreiben“ und „Weiterarbeiten“, Pflege nur unten und ohne Zähler kurzer Texte.
- **Mappe**: Material (Einträge, Texte, Geschichten, Wegenetze, Hexkarten, Dungeons) an Texte und
  Geschichten anheften, mit Rückweg.
- **Arbeitsansicht** Vorbereiten/Spielen in der Weltleiste – reine Ansicht; Hexkarte und Dungeon
  beginnen passend; Neu würfeln/Löschen nur beim Vorbereiten.
- **Nachschlagen** im schmalen Seitenblatt; **Breit schreiben**; Text im Dossier gleich nach dem
  Steckbrief.
- **Geschichten** ohne Bewertung (Stand/Rat nur auf Wunsch); **Abendblatt** frei mit freiem Text,
  Führung als Schalter.
- **Vollständige Kopie mit Bildern** (nur installierte App); Sicherungsumfang benannt.
- Fehlerbehebungen: unbekannter Aufenthalt, Hexmaßstab unter der Erde, Bastionsverlauf nach
  Umbenennen, Statblock löschen mit Ankündigung und Rückgängig, Strg+E doppelt belegt,
  „verwaltet“ ≠ Herrschaft, Sammelseiten nicht als Personen, Ortsauswahl geordnet, Lesbarkeit
  und Fokus, Weltleiste bis 125 % Zoom, **kein Textverlust beim sofortigen Schließen** (K08).
- Datenversion 43 (neu: `chronicle.bastionId`, `story.guide`, `material` an Artikel und
  Geschichte, `prep.text`, `campaign.prepGuide`).

## Grenzen dieser Alpha

- Nicht nativ geprüft: Windows- und macOS-App, Kampagnenordner, Dateirechte, Schließen beim
  Speichern, „Vollständige Kopie mit Bildern“, Wiederherstellung (K48, K49, K57).
- Nicht mit einer großen echten Kampagne geprüft (K15, K58); alle Browserproben mit kleinem
  Elaris-Grundstand und erfundenen Einträgen.
- Abgleich nur gegen die Attrappe; zwei echte Geräte offen (K50, K51).
- Viele Abnahmefälle sind offen (siehe Matrix) – keiner davon ist als bestanden markiert, ohne
  geprüft zu sein.
- Das Abendblatt hat noch keine eigene Mappe; die Zeitrücknahme hat eine Stufe.

## Protokoll

- 20. 11. 2026: Phase A (Ausgangsstand), Phase B begonnen: F08, F09, F15, F16, F17 behoben,
          2837 Tests grün.
- 20. 11. 2026: Phase C: F01–F04, F06, F12, F13 behoben, 2848 Tests grün.
- 20. 11. 2026: Phase C abgeschlossen: F05, F07, F11, F21; Weltleiste K07. 2854 Tests grün.
          Datenversion bleibt 43 (noch nicht ausgeliefert), Gestalt neu: `material` an Artikel und
          Geschichte, `prep.text`, `campaign.prepGuide`.
- 20. 11. 2026: Phase D: F10, F14, F18, F20 behoben; Browserproben K01–K09, K18, K21, K55,
          K59; neuer Befund K08 (Textverlust beim sofortigen Schließen) gefunden und behoben.
          2857 Tests grün.
- 20. 11. 2026: Phase E: Fassung in den Einstellungen sichtbar; Workflow „Alpha bauen“; Pakete
          0.2.0-alpha.2 für Windows und macOS gebaut (ohne Veröffentlichung). Rust-Tests Windows und
          Linux grün (inkl. Kopierbefehl), macOS-Testlauf mangels freiem Rechner abgebrochen.

## Nächster Schritt

Am Windows-PC: Kampagnenordner samt `media/` kopieren, Paket 0.2.0-alpha.2 installieren, die
**Kopie** öffnen und K57, K48, K49, K08 (Schließen kurz nach dem Tippen) nativ prüfen; danach die
offenen Fälle der Matrix mit der echten Welt.
