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

| Prüfart                                                                            | Möglich hier?                               | Bemerkung                                                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Logiktests (Vitest), Typprüfung, Produktionsbuild                                  | ja                                          | Linux-Container                                                                             |
| Oberfläche im Browser (Vorschau `npm run dev`, Playwright/Chromium)                | ja                                          | Speicherung im Browser, nicht der Kampagnenordner                                           |
| Native Windows-App starten, Kampagnenordner, Dateirechte, Schließen beim Speichern | **nein**                                    | kein Windows-Rechner; bleibt offen, bis am Windows-PC geprüft                               |
| Installer bauen                                                                    | ja, über GitHub Actions („Veröffentlichen“) | ein gebauter Installer ist **keine** ausgeführte Desktopprüfung                             |
| macOS                                                                              | nein                                        | nur CI-Bau                                                                                  |
| Echte Kampagnenkopie (Elaris, Atlas, Brett, Dungeons)                              | **nein**                                    | liegt nicht in dieser Umgebung; geprüft wird mit erfundenen Daten und dem Elaris-Grundstand |
| Abgleich gegen GitHub, KI-Leser mit echtem Schlüssel                               | nein                                        | nur Attrappe; keine kostenpflichtigen Abrufe                                                |

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
| F05 | Material einer Reise verteilt                    | P1   | offen       |                                                               |
| F06 | Live-Steuerung beim Gestalten dominant           | P1   | behoben     | Arbeitsansicht in der Leiste; Browser: keine Datenänderung    |
| F07 | Nachschlagen öffnet volles Dossier               | P2   | offen       |                                                               |
| F08 | Unbekannter Aufenthalt als „fort“                | P1   | **behoben** | T: `data/__tests__/campaign.test.ts` „F08 …“                  |
| F09 | Hexmaßstab Dialog ≠ Ergebnis                     | P1   | **behoben** | T: `erkundung/generate.test.ts` „F09 …“                       |
| F10 | Ortsauswahl gewichtet Maßstäbe schlecht          | P2   | offen       |                                                               |
| F11 | Dossier lässt wenig Raum für den Artikel         | P2   | offen       |                                                               |
| F12 | Weltstartseite betont Pflegeaufwand              | P2   | behoben     | Start: Schreiben und Weiterarbeiten vorn, Pflege unten        |
| F13 | Lokale Vorbereiten/Spielen-Wechsel uneinheitlich | P2   | behoben     | Karten beginnen passend; Würfeln/Löschen nur beim Vorbereiten |
| F14 | „verwaltet“ als Herrschaft vorgeschlagen         | P2   | offen       |                                                               |
| F15 | Bastionsverlauf nach Umbenennen weg              | P1   | **behoben** | T: `bastion/rooms.test.ts` „F15 …“; Datenversion 43           |
| F16 | Gelöschter Statblock beschädigt Begegnungen      | P1   | **behoben** | T: `bestiarium/bestiarium.test.ts` „F16 …“                    |
| F17 | Strg/Cmd+E doppelt belegt                        | P1   | **behoben** | B: reproduziert und nachgeprüft; T: `shell/shortcuts.test.ts` |
| F18 | Sammelartikel als Personen                       | P2   | offen       |                                                               |
| F19 | Sicherung ohne Medien                            | P1   | offen       |                                                               |
| F20 | Gewichtung von Nebeninformationen                | P2   | offen       |                                                               |
| F21 | Abendblatt als Methode                           | P2   | offen       |                                                               |

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

| Fall                              | Status               | Bemerkung                                         |
| --------------------------------- | -------------------- | ------------------------------------------------- |
| K01–K15                           | offen                |                                                   |
| K16 Unbekannter Aufenthalt        | teilweise            | Logik behoben (F08), Oberfläche offen             |
| K17–K24                           | offen                |                                                   |
| K25 Hexmaßstab                    | teilweise            | Auswahl behoben (F09), Reisezeit im Browser offen |
| K26–K27                           | offen                |                                                   |
| K28 Ansichtswechsel ohne Wirkung  | bestanden (Vorschau) | Spielstand byte-gleich (F06)                      |
| K29–K32                           | offen                |                                                   |
| K33 Verwendeten Statblock löschen | teilweise            | Ankündigung + Rückgängig (F16), Oberfläche offen  |
| K34–K39                           | offen                |                                                   |
| K40 Bastionsverlauf               | teilweise            | Logik behoben (F15), Neuladen im Browser offen    |
| K41–K54                           | offen                |                                                   |
| K55 Tastatur und Fokus            | teilweise            | Strg+E geprüft (F17); übrige Kombinationen offen  |
| K56–K60                           | offen                |                                                   |

## Rückfall

1. Vor dem Installieren der Alpha den **ganzen Kampagnenordner** kopieren – einschließlich
   `media/` (Bilder liegen nur dort, nicht in der JSON-Sicherung, siehe F19). In der Alpha geht
   das danach auch über Einstellungen → Sicherung → „Vollständige Kopie mit Bildern“.
2. Den bisherigen Installer (0.1.39) aufheben.
3. Die Alpha erhöht die Datenversion (43). Eine mit der Alpha geöffnete Kampagne nicht mehr mit
   der alten App öffnen; zurück geht es nur mit der Kopie aus Schritt 1.
4. Die Alpha zuerst mit einer **Kopie** der Kampagne öffnen, nie mit dem Original.

## Protokoll

- 20. 11. 2026: Phase A (Ausgangsstand), Phase B begonnen: F08, F09, F15, F16, F17 behoben,
          2837 Tests grün.
- 20. 11. 2026: Phase C: F01–F04, F06, F12, F13 behoben, 2848 Tests grün.

## Nächster Schritt

Phase C (F01–F07, F11–F13, F21): freier Schreibbeginn, Arbeitszusammenhang, Gestalten/Leiten.
