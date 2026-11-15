# Abgleich über GitHub – Teil 3: alter Plan und Gestalt der Daten

Stand: 15. 11. 2026. Nur gelesen (Zweig `welle4/atlas`), nichts im Projekt geändert, nichts gestartet.
Der echte Kampagnenordner und der Desktop wurden nicht angefasst – alle Mengen unten sind
**Schätzungen aus den Unterlagen und dem Code**, nicht gezählt.

Pfade sind relativ zu `D:\Wayfarer`. Schreibweise `Datei:Zeile`.

**Achtung bei Zeilennummern:** `src/data/actions.ts`, `src/data/record.ts`, `src/domain/prep.ts`
und `src/features/abend/*` wurden während des Lesens von einem Kollegen geändert (Zeilen
verschoben sich um bis zu 18). Dort gilt der **Funktionsname**; die Zeile ist der Stand am Ende
des Lesens. Alle anderen Dateien waren unverändert.

Inhalt:
1. Der alte Plan – was gilt, was ist überholt
2. Mengengerüst und Bündeln
3. Was beide Rechner gleichzeitig ändern – `state.json`
4. Einen Konflikt verständlich zeigen
5. Löschen und der Papierkorb
6. `media/`
7. Was nie ins Repository darf
8. Verschiedene Programmversionen
9. Was der Code heute schon mitbringt (und wo er dem Abgleich im Weg steht)
10. Fallstricke, kurz

---

## 1. Der alte Plan

### 1.1 Was wörtlich dasteht

Der Plan ist **eine Tabellenzeile**, kein ausgearbeitetes Konzept:

`docs/WEITERARBEIT.md:168`
> | I | Abgleich über GitHub | Spielstand in einem privaten GitHub-Repository (Entscheidung des
> Spielleiters, kein Cloud-Laufwerk); Rust-Seite über die GitHub-API (Bäume/Blobs, kein libgit2),
> Zugangsschlüssel im Schlüsselbund, Abgleich beim Öffnen, nach Änderungen und beim Schließen;
> Dreiwegevergleich je Datei mit gespeichertem gemeinsamem Stand; Konflikte zur Entscheidung
> anzeigen | – |

Dazu verstreut:

| Stelle | Aussage |
|---|---|
| `docs/WEITERARBEIT.md:185` | Reihenfolge: I läuft parallel zu A–K, hängt von nichts ab. |
| `docs/WEITERARBEIT.md:1105-1107` | Geleitet am MacBook Air 13" (M1, 8 GB), vorbereitet am Windows-PC; „Der Abgleich Mac ↔ Windows (Bereich I) ist damit wichtig.“ |
| `docs/WEITERARBEIT.md:1135-1137` | „Das Repository ist öffentlich. … Es darf **nie** ein Spielstand, ein Backup, ein Schlüssel … hineingeraten. Der Abgleich des Spielstands (Bereich I) braucht ein **eigenes, privates** Repository.“ |
| `docs/WEITERARBEIT.md:318-335` | Bilder: 481 Dateien, 1,35 GB (`:326`). Sicherung enthält sie nicht (`:328`). „Für den Abgleich über GitHub (Bereich I) ist er mit 1,35 GB zu groß; dafür braucht es kleinere Fassungen der Bilder oder einen anderen Weg.“ (`:331-333`). Vor einer Kündigung von LegendKeeper müssen die Bilder auf **beiden** Rechnern geholt sein (`:330`). |
| `docs/WEITERARBEIT.md:1680-1681` | Fassungen: „bei 500 viel bearbeiteten Artikeln grob 5–30 MB, schlimmstenfalls um 90 MB“; offen, ob wahlweise ohne Fassungen gesichert wird. |
| `docs/WEITERARBEIT.md:27-38` | Oberfläche und Installationspakete sind auf dem Mac nie gelaufen (nur Rust-Tests bei GitHub). |
| `docs/FUNKTIONSUMFANG.md:57` | „Geräteübergreifend synchronisieren (über ein privates GitHub-Repository), offline weiterarbeiten, Backups exportieren und wiederherstellen, … getrennter Testspielstand“. |
| `README.md:13-15`, `README.md:104-106` | „in Arbeit“; bis dahin Sicherung herunterladen/einspielen; „Immer nur an einem Rechner gleichzeitig weiterspielen.“ |
| `README.md:131-133` | Muster für Schlüssel: Schlüsselbund des Betriebssystems, „auf jedem Rechner einmal eintragen“. |
| `CLAUDE.md:153-155` | „Mac und Windows teilen sich den Spielstand über ein privates GitHub-Repository (Entscheidung des Spielleiters; er nutzt kein Cloud-Laufwerk).“ |

### 1.2 Was weiter gilt

- Privates GitHub-Repository, kein Cloud-Laufwerk (Entscheidung des Spielleiters).
- Rust-Seite spricht die GitHub-Schnittstelle direkt (Bäume/Blobs), **kein Git auf dem Rechner, kein libgit2**.
- Zugangsschlüssel im Schlüsselbund – das Muster steht zweimal fertig da:
  `src-tauri/src/legendkeeper.rs:17-18` (`KEYRING_SERVICE = "app.wayfarer.desktop"`,
  `KEYRING_ACCOUNT = "LegendKeeper-Key"`), `src-tauri/src/ai.rs:19-20` (`"Claude-Key"`).
  Ein dritter Eintrag (etwa `"GitHub-Key"`) passt daneben.
- Abgleich beim Öffnen, nach Änderungen, beim Schließen (neu dazu: per Knopf).
- Dreiwegevergleich je Datei mit gespeichertem gemeinsamem Stand; Konflikte entscheidet der Spielleiter.
- Eigenes Repository nur für den Spielstand – getrennt vom Code-Repository.

### 1.3 Was überholt ist

- **„Das Repository ist öffentlich“** (`docs/WEITERARBEIT.md:1135`): seit 12. 11. 2026 privat
  (`CLAUDE.md:65-68`). Die Regel bleibt trotzdem: Spielstand nie ins Code-Repository.
- **Cloud-Laufwerk als Weg** steht noch im Code als Annahme und ist als Text falsch geworden:
  `src/data/store.ts:2-3` („Der Ordner darf in einem Cloud-Laufwerk liegen; so teilen sich mehrere
  Rechner denselben Spielstand“), `src-tauri/src/watch.rs:1-2`, `src-tauri/src/config.rs:1-2`,
  `src-tauri/src/store.rs:64` (Fehlertext „Ist das Cloud-Laufwerk verbunden?“),
  `src/features/einstellungen/model.ts:95-125` (Erkennen von „Konfliktkopien“ des Cloud-Laufwerks).
  Die **Mechanik dahinter bleibt nützlich** (siehe 9), nur die Worte stimmen nicht mehr.
- **Mengen**: Der Plan stammt vom 10. 11. – damals 95 Einträge, 36 Chronikeinträge, 2 Sessions
  (`docs/WEITERARBEIT.md:104-106`). Seither kamen 28 Sammlungen dazu (`LATER_COLLECTIONS`,
  `src/domain/schema.ts:2770-2799`), das ganze Wiki (656 Artikel, `docs/WEITERARBEIT.md:268`) und
  `versions`. „Nach Änderungen“ heißt heute etwas anderes als damals (siehe 2).
- **„Bis dahin: nur an einem Rechner gleichzeitig“** (`README.md:106`) – genau das soll der
  Abgleich ablösen; der Satz ist nach dem Bau zu ersetzen.

### 1.4 Was der alte Plan offen lässt (und dieser Bericht beantwortet)

- Wo liegt der gemeinsame Stand, und was genau wird gespeichert (nur Prüfsummen oder auch Inhalt)? → 5.1
- Was ist mit `state.json`, die praktisch immer auf beiden Seiten anders ist? → 3
- Wie sieht ein Konflikt für jemanden ohne Programmierkenntnisse aus? → 4
- Löschen. → 5
- Bilder. → 6
- Verschiedene Programmversionen. → 8
- Erster Abgleich (Repository leer / Ordner leer / beide voll ohne gemeinsamen Stand). → 5.4
- Wie oft „nach Änderungen“ ist. → 2.4

---

## 2. Mengengerüst

### 2.1 Was im Ordner liegt

Ablage: `campaign.json`, `state.json`, je Dokument `<sammlung>/<id>.json`
(`src/data/db.ts:40-45`). Geschrieben wird immer `JSON.stringify(doc, null, 1) + '\n'`
(`src/data/db.ts:45`) – LF, feste Reihenfolge der Felder (Reihenfolge des Schemas nach `parse`),
also **auf Mac und Windows byte-gleich**. Prüfsummen über den Dateiinhalt sind damit zwischen den
Rechnern vergleichbar; es gibt kein Zeilenenden-Problem, solange kein Git mit Zeilenenden-Umwandlung
dazwischenhängt (hängt hier keines).

Kennungen: `^[A-Za-z0-9_-]{1,64}$` (`src/domain/schema.ts:10`); neue sind 12 zufällige Zeichen
(`newId`, `src/domain/schema.ts:2822`) – zwei Rechner erzeugen praktisch nie dieselbe.
Ausnahmen mit **festen** Kennungen (hier kann „auf beiden neu“ wirklich dieselbe Datei treffen):

- `campaign.json`, `state.json`
- `weather/<climateId>-<Tagesindex>.json` (`weatherId`, `src/domain/schema.ts:2151`)
- `atlas/planet.json`, `atlas/relief.json` (`src/domain/schema.ts:2372-2377`)
- alles, was aus einer Übernahme mit `safeId` (`src/domain/schema.ts:2828`) stammt
  (LegendKeeper-Artikel, v157) – nur wenn dieselbe Übernahme auf beiden Rechnern getrennt liefe.

34 Sammlungen (`COLLECTION_SCHEMAS`, `src/domain/schema.ts:2729-2764`). Grenzen der Ablage, an
die sich auch der Abgleich halten muss (`src-tauri/src/store.rs:17-24`): Tiefe 4, 240 Zeichen Pfad,
16 MB je Datei, 100 000 Dateien, 512 MB gesamt. Die Ablage sieht nur `*.json`, nichts Verstecktes
(`src-tauri/src/store.rs:78-110`).

### 2.2 Geschätzte Größen (nicht gezählt!)

| Sammlung | Anzahl heute (geschätzt) | Wachstum | Bemerkung |
|---|---|---|---|
| `articles` | ~650–700 | langsam (neue Artikel) | 656 Artikel / 861 Seiten aus dem Export (`docs/WEITERARBEIT.md:268`). **Alle Seiten eines Artikels stehen in einer Datei** (`docs`, `src/domain/schema.ts:2335`). Größte Gruppe nach Bytes. |
| `entities` | einige hundert | langsam | 95 am 10. 11.; dazu Einträge zu Artikeln. Einträge mit Bild tragen es **in der Datei** (Data-URL, ≤ 512 px, `src/features/welt/image.ts:5`, Feld `image` `src/domain/schema.ts:215`) → einzelne Dateien 30–100 KB. |
| `chronicle` | einige hundert (Sessions 1–13 nachgetragen) | **+20–80 je Abend** | wächst am stärksten nach Stückzahl; kleine Dateien (< 2 KB). Fast nur neue Dateien, selten geänderte. |
| `versions` | hunderte bis wenige tausend | **+ bis zu 6 je Seite und Schreibstunde** | Deckel 60 je Artikel (`KEEP_MOST`, `src/domain/versions.ts:19`), theoretisch 656 × 60 ≈ 39 000; real weit darunter. Jede Datei trägt den ganzen Wortlaut einer Seite, bei `delete` den ganzen Artikel (`src/domain/schema.ts:2709-2726`). |
| `relations` | einige hundert | langsam | klein |
| `maps` | ~70 | selten | 64 aus dem Export + 6 aus v157; gezeichnete Karten können groß werden (Striche) |
| `atlas` | 2 | nie | `planet` (Küsten als Zahlenreihen) und `relief` (Höhenraster als Base64, `src/domain/schema.ts:2424-2428`) – **die größten Einzeldateien** (MB-Bereich), `relief` ändert sich nie |
| `weather` | wenige | kaum | **Korrektur zur Annahme im Auftrag:** `weather/` hält nur von Hand gesetztes Wetter (`setManualWeather`, `src/features/wetter/actions.ts:53-80`); alles andere wird errechnet. Wächst nicht mit der Weltzeit. |
| `sessions`, `events`, `stories`, `threads`, `preps`, `clocks`, `loot`, `shops`, … | je einige bis einige Dutzend | langsam | klein bis mittel; `sessions` mit `source`/`reading` größer |

Summe heute grob **2 000–4 000 Dateien, 15–60 MB** (ohne `media/`). Für einen Vergleich über einen
Baum mit Prüfsummen ist das klein; zu viel ist es, um bei jedem Abgleich jede Datei einzeln
anzufragen. **Folge: Vergleich immer über Prüfsummen aus einem Baum, nie über Einzelabrufe.**
(Grenzen der GitHub-Schnittstelle – Einträge je Baum, Größe je Anfrage, Anfragen je Stunde – prüft
der Rust-Teil gegen die aktuelle Doku; hier nur die Mengen.)

Der teure Fall ist der **erste Abgleich**: einige tausend Dateien hoch (Windows) und einige tausend
herunter (Mac). Dafür braucht es eine Fortschrittsanzeige, Wiederaufnahme nach Abbruch und einen
Weg, der nicht je Datei eine Anfrage kostet.

### 2.3 Was übliche Handgriffe schreiben

Jede Änderung landet nach 250 ms im Ordner (`src/data/db.ts:266-272`); `db.batch` fasst nur die
Benachrichtigung zusammen, nicht das Schreiben.

| Handgriff | Dateien | Beleg |
|---|---|---|
| Zeit vorstellen | `state.json` + je eingetretenem einmaligem Termin 1 neue `chronicle` + geändertes `events` + je abgelaufenem Timer 1 `timers` + je betroffener Uhr 1 `clocks` + je Schritt 1 neue `chronicle` → typisch 1–6 | `advanceTime`, `src/data/actions.ts:57` (Schreiben `:86-120`) |
| Zeitsprung zurück | dieselben wieder (auch **Löschen** von `chronicle`) | `undoTimeAdvance`, `src/data/actions.ts:125-166` |
| Mitschrift-Zeile / Festhalten (Notiz) | 1 neue `chronicle` | `logEntry` `src/data/actions.ts:338`; `recordEntry` `src/data/record.ts:760` |
| Festhalten mit Wirkung (Haltung, Schicksal, Aufenthalt, Stufe, Handel …) | 1 neue `chronicle` + 1–3 weitere: `relations` oder `entities`, ggf. `state.json`, ggf. **der nächste spätere Chronikeintrag derselben Sorte** (sein `before`), `threads`, `preps`, `shops` | `applyEffect`, `src/data/record.ts:556-715` |
| Ort wechseln | 1 neue `chronicle` + `state.json`; über einen Weg zusätzlich „Zeit vorstellen“ | `moveParty` `src/data/actions.ts:299-318` |
| Session beginnen / beenden | `sessions` + `state.json` (+ `preps`) | `startSession` `src/data/actions.ts:408`, `endSession` `:476` |
| Artikel schreiben | **dieselbe `articles`-Datei alle 600 ms Tipp-Pause neu** (`SAVE_DELAY_MS`, `src/features/wiki/editing.ts:34`) + höchstens 1 neue `versions` je Seite und 10 Minuten (+ Löschen ausgedünnter) | `savePageText` `src/features/wiki/actions.ts:178-199`, `keepVersion` `:149-171` |
| Karte auf dem Fadenbrett oder im Netz verschieben | `state.json` (`board`, `netBoard`) | `src/features/faeden/actions.ts:611-631`, `src/features/welt/netActions.ts:18-25` |
| Eintrag löschen | 1 gelöschte `entities` + alle `relations` dazu gelöscht + geänderte `events`, `areas`, `loot`, `tracks`, ggf. `state.json` | `deleteEntity` `src/data/actions.ts:487` |
| Sicherung einspielen / LegendKeeper übernehmen / „Elaris neu beginnen“ | **alle** Dateien werden neu geschrieben (`replaceAll`, `src/data/db.ts:217-253`), auch die inhaltlich gleichen | Aufrufer: `BackupSection.tsx:64`, `LegacySection.tsx:241`, `CampaignSection.tsx:214`, `wiki/actions.ts:55`, `:81` |

Ein Spielabend (4 Stunden): grob 50–150 neue oder geänderte Dateien, fast alles neue
Chronikeinträge; `state.json` Dutzende Male neu.
Ein Nachmittag Vorbereitung: 10–40 Artikel (jeder hunderte Male überschrieben), 20–100 neue
Fassungen, ein paar Dutzend `stories`/`preps`/`threads`/`entities`, `state.json` (Brett).

### 2.4 Folgerung: so bündeln

1. **Nie je Schreibvorgang abgleichen.** Der Editor schreibt alle 600 ms, das Brett bei jedem
   Loslassen. Ein Abgleich je Datei wären hunderte Commits je Stunde.
2. **Der Abgleich vergleicht Zustände, nicht Ereignisse:** Prüfsummen aller Dateien im Ordner gegen
   den gemeinsamen Stand. Dann spielt es keine Rolle, dass `replaceAll` alles „schreibt“ – was
   inhaltlich gleich blieb, hat dieselbe Prüfsumme.
3. **Auslöser „nach Änderungen“:** nach der letzten Speicherung eine Ruhezeit abwarten (Vorschlag
   90–120 s ohne weitere Änderung), bei Dauerarbeit spätestens alle 10 Minuten. Dazu sofort: beim
   Öffnen, beim Beenden einer Session (`endSession`), beim Schließen, per Knopf.
4. **Ein Abgleich = ein Commit** mit allen Dateien des Bündels. Ein Handgriff (Zeit vorstellen)
   schreibt mehrere Dateien, die zusammengehören; ein Commit mitten in einem Handgriff ist durch die
   Ruhezeit ausgeschlossen. Vor der Momentaufnahme `flushEdits()`
   (`src/features/wiki/editing.ts:29-31`) und `await db.flush()` (`src/data/db.ts:293-323`) rufen.
5. **Schließen:** Das Fenster wartet heute nur aufs Speichern (`onAppClosing`,
   `src/App.tsx:76-79`; Frist der Rust-Seite `ANSWER_GRACE` 1,5 s bis zur ersten Antwort,
   `src-tauri/src/window.rs:29`). Der Abgleich beim Schließen braucht eine eigene, begrenzte Frist
   (Vorschlag: höchstens ~15 s, mit sichtbarem „Gleiche ab …“ und „Trotzdem schließen“); gelingt er
   nicht, holt ihn das nächste Öffnen nach. Nie das Schließen vom Netz abhängig machen.
6. **Am Tisch nie stören** (Leitbild, `docs/FUNKTIONSUMFANG.md:25-26`): Scheitert der Abgleich
   (kein Netz), nur ein stilles Zeichen bei „Gespeichert“; kein Dialog, kein Toast. Konflikte warten,
   bis der Spielleiter sie öffnet.

---

## 3. Was beide Rechner gleichzeitig ändern

### 3.1 Realistische Doppeländerungen

Üblicher Ablauf: Windows bereitet vor → Mac leitet → Windows bereitet nach. Konflikte entstehen,
wenn ein Rechner vor dem Arbeiten **nicht** abgeglichen hat (kein Netz am Tisch, Mac zugeklappt
ohne Schließen, Abgleich beim Schließen abgebrochen).

| Dokument | Windows (Vorbereitung) | Mac (Tisch) | Häufigkeit |
|---|---|---|---|
| `state.json` | `board`, `netBoard`, `timelineLanes`, `watch`, `continuityOk`, `twinsApart` | `now`, `previousNow`, `placeId`, `sessionId`, `march`, `travelBy`, `recapDismissed` | **fast immer** |
| `preps/<id>` (Blatt des Abends) | schreiben | Szenen abhaken, Geheimnisse aufdecken; `startSession` setzt `sessionId` (`src/data/actions.ts:428`) | häufig |
| `stories/<id>` | Blatt schreiben | `scene.done`, `inPlay`, `memo` | häufig |
| `clocks/<id>` | Schritte schreiben | Zeit vorstellen trägt `step.at` ein, `pausedAt`, `blocked` (`src/data/actions.ts:89-96`) | gelegentlich |
| `entities/<id>` – Gefährten | Ziel, Text | Trefferpunkte, Zustände, Aufenthalt, Stufe | gelegentlich |
| `entities/<id>` – Personen, Orte, Gegenstände | Notizen, Geheimnis, Felder | Schicksal, Aufenthalt, Besitzer (`src/data/record.ts:691-712`), „bekannt“ | gelegentlich |
| `articles/<id>` | schreiben | kleine Korrektur am Tisch; Nachtragen schreibt Zeilen in Steckbrief und „Was geschah“ (`src/features/nachtragen/reviewActions.ts:53`) | selten |
| `threads`, `loot`, `shops`, `encounters`, `tracks`, `timers`, `events` | anlegen, ändern | abhaken, ausgeben, handeln, Trefferpunkte | selten |
| `relations/<id>` | Art, Text | `attitude` (`setAttitude`, `src/data/actions.ts:361`) | selten |
| `sessions/<id>` | Nachtragen (`reading`, `source`) | laufende Session (`endAt`, `notes`) | selten (verschiedene Sessions) |
| `chronicle/<id>` | – | neu; geändert nur `before` des Nachfolgers und `promise` | sehr selten |
| `campaign.json` | Einstellungen, Regeln des Tisches, Zeitalter | – | sehr selten |
| `versions/<id>` | neu / ausgedünnt | – | nie dieselbe Datei (zufällige Kennung, nie geändert) |

### 3.2 `state.json`: Feld für Feld

`PlayStateSchema`, `src/domain/schema.ts:105-166`. Wer schreibt was:

| Feld | Zeile | Bedeutung | gehört zu | geschrieben in |
|---|---|---|---|---|
| `now` | 109 | Weltzeit | **Spielkern** | `data/actions.ts:119`, `:164`, `:295` |
| `previousNow` | 111 | Anker für „Zeitsprung zurück“ | **Spielkern** (hängt an `now`) | ebenda |
| `placeId` | 113 | Ort der Gruppe | **Spielkern** | `data/actions.ts:316`, `:538`, `data/record.ts:562` |
| `sessionId` | 115 | laufende Session | **Spielkern** | `data/actions.ts:425`, `:482`, `:570`, `:592` |
| `travelBy` | 140 | womit die Gruppe reist | Spiel | `fortbewegung/actions.ts:56-73` |
| `march` | 138 | Marschordnung | Spiel | `gruppe/OnTheRoad.tsx:22` |
| `recapDismissed` | 160 | Rückblick weggeklickt (Session) | Spiel/Ansicht | `tisch/commands.ts:115` |
| `watch` | 120 | Beobachtete | Vorbereitung (Menge) | `geschehen/actions.ts:71` |
| `continuityOk` | 145 | „Passt so“ | Vorbereitung (Menge) | `offen/actions.ts:7-10` |
| `twinsApart` | 131 | „Sind verschieden“ | Vorbereitung (Menge) | `faeden/actions.ts:943-945` |
| `board` | 126 | Fadenbrett: Schlüssel → x/y | Auslage (je Schlüssel) | `faeden/actions.ts:611-631` |
| `netBoard` | 136 | Fraktionsnetz: Kennung → x/y | Auslage (je Schlüssel) | `welt/netActions.ts:18-25` |
| `timelineLanes` | 155 | Bahnen der Zeitleiste | Ansicht | `zeitleiste/actions.ts:11`, `:39` |
| `nameMemory` | 150 | Gedächtnis ein/aus | Ansicht/Vorliebe | `ui/memory.tsx:43` |
| `rev`, `updated` | 107, 164 | Verwaltung | – | `db.setState`, `src/data/db.ts:189-198` |

**Befund: In `state.json` steht nichts, was wirklich nur zu einem Rechner gehört.** Rechnereigenes
liegt schon außerhalb des Ordners: `config.json` mit dem Pfad des Kampagnenordners
(`src-tauri/src/config.rs:11-19`), `window.json` mit der Fenstergröße
(`src-tauri/src/window.rs:218`), die Schlüssel im Schlüsselbund. Browser-Speicher wird nur von
`BrowserStore` benutzt (`src/data/store.ts:57-91`; Regel `CLAUDE.md:773`). **Auslagern löst das
Problem also nicht** – es gibt nichts auszulagern. Höchstens `nameMemory` und `timelineLanes` wären
Kandidaten, aber der Spielleiter will sie vermutlich auf beiden Rechnern gleich.

### 3.3 Vorschlag: `state.json` feldweise zusammenführen

Die Datei ist ein Sammelbecken unabhängiger Angaben; als ganze Datei verglichen, wäre sie bei fast
jedem Abgleich ein Konflikt. Deshalb **Dreiwege je Feld** (gemeinsamer Stand B, hier L, dort R):

- Feld nur auf einer Seite anders als B → diese Seite gilt. (Der Normalfall: Windows hat `board`
  verschoben, der Mac `now` gestellt – kein Konflikt.)
- Feld auf beiden Seiten gleich geändert → fertig.
- Feld auf beiden Seiten verschieden geändert → nach Art des Feldes:
  - **Mengen** (`watch`, `continuityOk`, `twinsApart`): Dreiwege als Menge – was eine Seite
    hinzugefügt hat, kommt dazu; was eine Seite entfernt hat, geht. Nie ein Konflikt.
  - **Auslagen** (`board`, `netBoard`): je Schlüssel Dreiwege; liegt dieselbe Karte auf beiden
    Seiten woanders, gilt die Seite mit dem jüngeren `updated` (es geht nur um eine Stelle auf einem
    Blatt – das lohnt keine Frage).
  - **Ansicht** (`timelineLanes`, `nameMemory`, `recapDismissed`): jüngeres `updated` gilt.
  - **Spielkern** (`now`, `previousNow`, `placeId`, `sessionId`, dazu `travelBy`, `march`): **als
    Gruppe** behandeln. Hat nur eine Seite den Kern angefasst, gilt sie ganz. Haben **beide** ihn
    angefasst, ist das ein echter Konflikt – und zwar keiner der Datei, sondern des Spiels (3.4).
- Ergebnis: `rev = max(L.rev, R.rev) + 1`, `updated = jetzt`, durch `PlayStateSchema.parse`.

Dasselbe Verfahren passt auf `campaign.json` (`CampaignMetaSchema`, `src/domain/schema.ts:71-102`):
`name`, `calendar`, `warmestMonth`, `aiModel`, `customConditions`, `tableRules`, `factScaffolds`,
`ages` sind unabhängig; `tableRules` ist Text (Zeilenvergleich möglich), `ages` hat Kennungen,
`customConditions` Namen. `calendar` als Ganzes behandeln (ein halb zusammengeführter Kalender
verschiebt alle Daten).

### 3.4 Warum „die jüngere Weltzeit gewinnt“ gefährlich ist

1. **Die Weltzeit läuft nicht nur vorwärts.** `setTime` (`src/data/actions.ts:292`) und
   `undoTimeAdvance` (`:125`) stellen sie zurück. Hat der Spielleiter am Tisch einen Sprung
   zurückgenommen, ist die *kleinere* Zeit die richtige; „größer gewinnt“ machte das Zurücknehmen
   rückgängig.
2. **`now` steht nie allein.** `advanceTime` schreibt in einem Zug Chronikeinträge für eingetretene
   Termine, hakt Termine ab, beendet Timer, trägt Schritte der Uhren ein und sperrt Uhren
   (`src/data/actions.ts:86-120`). Nimmt man `now` von Rechner A, während die Dateien beider Rechner
   zusammenfließen, stehen **beide** Sätze von Folgen da: derselbe Termin zweimal in der Chronik
   (zwei Einträge mit gleichem `eventId`, aber verschiedenen zufälligen Kennungen – **kein
   Dateikonflikt, niemand merkt es**), derselbe Schritt einer Uhr zweimal (`clockId` + `stepId`,
   `stepEntry`, `src/data/actions.ts:172`), dazu ein Dateikonflikt in `clocks/<id>`.
3. **`previousNow` ist der Anker von „rückgängig“.** `undoTimeAdvance` löscht alle
   Termin-Einträge und Schritte zwischen `previousNow` und `now` (`src/data/actions.ts:131-163`).
   Ein `previousNow` von A neben einem `now` von B löscht beim nächsten „Zurück“ Einträge, die nie
   zu diesem Sprung gehörten.
4. **Ort und Session gehören dazu.** `now` von A mit `placeId` von B ergibt einen Stand, den es an
   keinem Rechner je gab; Besuche und „seitdem verändert“ werden daraus abgeleitet.
5. **Nachgetragenes** stellt nie Zeit vor (`CLAUDE.md`, Abschnitte Nachtragen und Festhalten) –
   eine Regel „größte Zeit gewinnt“ über die Chronik statt über `state.now` wäre erst recht falsch.

**Deshalb:** Haben beide Rechner den Spielkern geändert, heißt das „an beiden Rechnern wurde
gespielt“. Das ist **eine** Frage an den Spielleiter, mit Weltzeit, Ort und Session beider Seiten
nebeneinander („Hier: 19. Tauwind 701, 6:00, in X, Session 13 läuft – Am anderen Rechner: …“), und
der Hinweis, dass Termine und Schritte doppelt in der Chronik stehen können. Danach eine Prüfung auf
Doppelte (10, Punkt 3). Das wird selten vorkommen (der Spielleiter leitet nur am Mac), muss aber
sauber enden, wenn es vorkommt.

---

## 4. Einen Konflikt verständlich zeigen

### 4.1 Geht das? Ja – in drei Stufen

Für einen Konflikt in **einem** Dokument lässt sich zeigen:

1. **Was es ist:** Art und Name.
2. **Wann und wo geändert:** „hier“ und „am anderen Rechner“, je mit echter Uhrzeit.
3. **Der Unterschied:** bei Text Zeile für Zeile, sonst die wenigen abweichenden Angaben
   nebeneinander.

Und drei Antworten: „Meine behalten“, „Die andere nehmen“, bei Text zusätzlich „Beide ansehen“.
Die unterlegene Fassung darf nie verschwinden (4.5).

### 4.2 Was es dafür schon gibt

| Zweck | Vorhanden | Stelle | Stand |
|---|---|---|---|
| Bezeichnung der Sammlung, Einzahl/Mehrzahl („Chronikeintrag“/„Chronikeinträge“) | `COLLECTION_LABEL` | `src/features/einstellungen/backup.ts:39-74` | **nicht exportiert** (`const`) |
| Bezeichnung nach Ordner („Eintrag der Welt“) | `FOLDER_LABEL` | `src/features/einstellungen/model.ts:58-93` | **nicht exportiert**; zweite Liste mit teils anderen Wörtern („Uhren“, „Bestiarium“) |
| Art eines Eintrags der Welt („Person“, „Orte“) | `KIND_LABEL`, `KIND_LABEL_PLURAL` | `src/domain/derive.ts:35`, `:53` | exportiert |
| Art eines Chronikeintrags | `KIND_LABEL` | `src/domain/chronicleKinds.ts:108` | exportiert |
| Name eines beliebigen Dokuments (`name`, sonst `title`, `label`, `text`, 60 Zeichen) | `describe(label, item)` | `src/features/einstellungen/backup.ts:208-214` | **privat**, aber genau die gebrauchte Logik |
| Zusammenfassung eines ganzen Standes („Elaris · Weltzeit … · 18 Personen · 71 Orte · …“) | `summarize(data)` → `CampaignSummary` | `src/features/einstellungen/backup.ts:232-258` | exportiert; Anzeige `SummaryLine`, `PartsLine` in `ReplaceDialog.tsx:15-43` |
| Echte Uhrzeit lesbar („14. November 2026, 21:40 Uhr“) | `formatRealTime(iso)` | `src/features/einstellungen/backup.ts:261-273` | exportiert, schon von Wiki und Papierkorb benutzt |
| Weltzeit lesbar | `formatDateTime(calendar, at)` | `src/domain/time/calendar` (benutzt in `backup.ts:255`) | exportiert |
| Zeilenweiser Vergleich zweier Texte | `lineDiff(before, after)` | `src/domain/versions.ts:129-176` | exportiert, rein, getestet |
| Lange gleiche Strecken einklappen | `foldDiff(lines, context)` | `src/domain/versions.ts:196-223` | exportiert |
| Größe einer Änderung („+3 / −1 Zeilen“) | `diffSize` | `src/domain/versions.ts:179-188` | exportiert |
| Anzeige eines Vergleichs | `DiffView({ parts })` | `src/features/wiki/Versions.tsx:18` | exportiert, fertig gestaltet |
| Dialog „Das kommt / das verschwindet / vorher sichern“ | `ReplaceDialog` | `src/features/einstellungen/ReplaceDialog.tsx:45` | fertig; bietet „jetzigen Stand vorher sichern“ |
| Erklärung unlesbarer Dateien (beschädigt / falsche Form / „von einer neueren Wayfarer-Version geschrieben“) | `explainProblem` | `src/features/einstellungen/model.ts:99-126` | fertig; Anzeige `ProblemsSection.tsx` |
| Verweise aufräumen, die ins Leere zeigen | `repairReferences(data)` | `src/features/import/integrity.ts:14` | fertig; nach jedem Einspielen benutzt (`backup.ts:199`) |
| Wie ein Dokument jeder Sammlung in einer Liste heißt | `searchWorld` | `src/shell/search.ts:79` | Vorlage für Titel je Sammlung |

### 4.3 Was fehlt

- **Eine gemeinsame, exportierte Liste der Bezeichnungen.** Heute zwei private Listen
  (`CLAUDE.md` verlangt für jede neue Sammlung einen Eintrag in beiden). Der Abgleich wäre die
  dritte Stelle – besser `COLLECTION_LABEL` exportieren (oder nach `domain/` ziehen) und
  `describe` zu einem exportierten „Titel eines Dokuments“ machen.
- **„Was kommt herein“ als Unterschied, nicht als Bestand.** `summarize` zählt, was in einem Stand
  *ist*. Für den Abgleich braucht es dieselbe Zeile für eine **Änderungsmenge**: „12 neue
  Chronikeinträge · 3 geänderte Artikel · 1 gelöschter Termin“. Neue reine Funktion, die
  `COLLECTION_LABEL`, `KIND_LABEL(_PLURAL)` und `PartsLine` wiederverwendet.
- **Welcher Rechner.** Dokumente tragen nur `updated` (echte Zeit, ISO; `base`,
  `src/domain/schema.ts:13-19`), **keinen Rechnernamen**. Bei genau zwei Rechnern genügt „hier“ /
  „am anderen Rechner“; der Name des anderen (frei wählbar, etwa „MacBook“) kann in der Nachricht
  des Commits stehen. Nicht in die Dokumente schreiben – das änderte jede Datei.
- **Unterschied in Worten für Nicht-Text.** Feldnamen sind englische Bezeichner; eine deutsche
  Bezeichnung je Feld gibt es nicht (nur `VOCABULARY` für Steckbrief-Zeilen in `wiki/facts.ts`).
  Machbar ohne großes Wörterbuch: je Sammlung eine kurze Liste der Felder, die man zeigen will
  (Name/Titel, Text, Zeit, Ort), mit deutscher Beschriftung; alles Übrige als „und N weitere
  Angaben“. Lange Textfelder (`articles.docs[].text`, `sessions.notes`, `campaign.tableRules`,
  `entities.notes`/`secret`, Text der Handouts, Felder der Geschichten) über `lineDiff` + `DiffView`.
- **`rev` taugt nicht als Vergleich.** Kommentar: „Zählt jede Speicherung; dient der
  Konflikterkennung“ (`src/domain/schema.ts:15-16`). Beide Rechner zählen von `rev 5` auf `rev 6` –
  gleiche Zahl, verschiedener Inhalt. Erkennen über Prüfsumme gegen den gemeinsamen Stand; `rev`
  und `updated` nur zur Anzeige.
- **„Gleich“ muss `rev`/`updated` übergehen.** `db.put` zählt `rev` hoch und setzt `updated` bei
  **jedem** Schreiben (`src/data/db.ts:163`), auch wenn sich sonst nichts ändert. Zwei Dateien, die
  sich nur darin unterscheiden, sind **kein Konflikt** (dann die mit höherem `rev` nehmen).

### 4.4 Konflikte gar nicht erst entstehen lassen: Dokumente feldweise zusammenführen

Was für `state.json` nötig ist (3.3), hilft allen Dokumenten: Der Mac hakt in einer Geschichte eine
Szene ab, Windows schreibt an ihrer Zusammenfassung – als Datei ein Konflikt, als Felder keiner.
Allgemeine Regel für JSON (B, L, R):

- Objekte: Schlüssel für Schlüssel, rekursiv.
- Listen aus Objekten **mit `id`** (Szenen, Schritte einer Uhr, Seiten eines Artikels `docs`,
  Einrichtungen, Bestandszeilen …): je `id` zusammenführen; Reihenfolge von der Seite, die sie
  geändert hat.
- Andere Listen und einfache Werte: unteilbar – nur eine Seite geändert → nehmen; beide verschieden
  → Konflikt.
- Ergebnis durch das Schema der Sammlung (`COLLECTION_SCHEMAS[c].parse`); schlägt das fehl →
  Konflikt statt Raten.

Das ist **kein stilles Überschreiben** – beide Änderungen bleiben erhalten. Für die erste Fassung
reicht: `state.json` und `campaign.json` feldweise (Pflicht), alle anderen Dokumente nach derselben
Regel (dringend empfohlen wegen `stories`, `preps`, `clocks`, Gefährten); Text in sich
zusammenzuführen (Zeile für Zeile aus beiden) kann warten.

### 4.5 Nie Daten verlieren

- Was der andere Rechner hochgeladen hat, steht im Verlauf des Repositorys – das geht nie verloren.
- Gefährdet ist nur **die hiesige, noch nicht hochgeladene** Fassung, wenn der Spielleiter „Die
  andere nehmen“ wählt. Dafür:
  - Artikeltext: die unterlegene Fassung als frühere Fassung ablegen (`createVersion`,
    `src/domain/schema.ts:2927`; Gründe heute `edit | restore | delete`,
    `src/domain/schema.ts:2700` – ein vierter Grund wäre eine Schema-Änderung, `edit` tut es auch).
    Dann ist sie über „Frühere Fassungen“ zurückholbar.
  - Alles andere: vor dem Anwenden einer Entscheidung den hiesigen Stand als Ganzes sichern –
    entweder als Sicherungsdatei (`serializeBackup`, `src/features/einstellungen/backup.ts:92-94`)
    in einen Ordner des Rechners, oder (sauberer, kein zweiter Ablageort) als eigener Zweig im
    Repository („Stand von <Rechner> vor dem Abgleich am …“).

---

## 5. Löschen

### 5.1 Ohne gemeinsamen Stand nicht entscheidbar

Fehlt eine Datei auf A und ist sie auf B da, gibt es zwei Lesarten: „A hat gelöscht“ oder „B hat
neu angelegt“. Nur der **gemeinsame Stand** (was beim letzten erfolgreichen Abgleich auf beiden
Seiten gleich war) trennt sie. Fälle je Pfad (B = gemeinsamer Stand, L = hier, R = dort, – = fehlt):

| B | L | R | Bedeutung | Tun |
|---|---|---|---|---|
| – | x | – | hier neu | hochladen |
| – | – | x | dort neu | holen |
| – | x | y | beide neu unter derselben Kennung | gleich (ohne `rev`/`updated`) → fertig; sonst Konflikt (nur bei festen Kennungen, 2.1) |
| b | b | – | dort gelöscht, hier unberührt | **hier löschen** |
| b | – | b | hier gelöscht, dort unberührt | dort löschen |
| b | – | – | beide gelöscht | fertig |
| b | l≠b | – | **dort gelöscht, hier geändert** | Konflikt „gelöscht gegen geändert“ – Vorgabe: behalten |
| b | – | r≠b | **hier gelöscht, dort geändert** | Konflikt – Vorgabe: behalten (wieder holen) |
| b | l | b | hier geändert | hochladen |
| b | b | r | dort geändert | holen |
| b | l | r | beide geändert | gleich → fertig; sonst feldweise zusammenführen; Rest Konflikt |

Was gespeichert werden muss: **je Pfad die Prüfsumme** des gemeinsamen Standes und **der Commit**,
zu dem er gehört. Für das feldweise Zusammenführen braucht man zusätzlich den **Inhalt** von B –
nur für die wenigen Dateien, die beide geändert haben. Er lässt sich über die Prüfsumme aus dem
Repository holen (Netz ist beim Abgleich ohnehin da) oder als Kopie auf dem Rechner halten.

Wo der gemeinsame Stand liegt: **je Rechner, nie im Repository** (sonst wäre er selbst ständig im
Konflikt). Zwei Orte kommen in Frage – zu entscheiden vom Rust-Teil:
- im Konfigurationsordner der App neben `config.json` (dort liegt schon Rechnereigenes,
  `src-tauri/src/config.rs:1-2`), Schlüssel: Kampagnenordner + Repository; oder
- versteckt im Kampagnenordner (die Ablage übergeht alles mit führendem Punkt,
  `src-tauri/src/store.rs:97`; die Oberfläche sieht es nie). Vorteil: Er wandert mit, wenn der
  Ordner verschoben wird. Muss dann ausdrücklich vom Hochladen ausgenommen sein.

**Achtung:** Geht der gemeinsame Stand verloren (neuer Rechner, Ordner neu gewählt, Datei
gelöscht), darf der Abgleich **nichts löschen**: ohne B gilt jede einseitig vorhandene Datei als
neu. Schlimmster Fehler wäre das Gegenteil (einseitig Fehlendes als „gelöscht“ lesen und auf der
anderen Seite löschen).

### 5.2 Löschen zieht Kreise

Ein Löschbefehl ändert mehrere Dateien:
- `deleteEntity` (`src/data/actions.ts:487`): löscht die Beziehungen, schreibt einen
  Chronikeintrag, bereinigt `events`, `areas`, `loot`, `tracks`, ggf. `state.placeId`.
- `deleteArticle` (`src/features/wiki/actions.ts:422`): legt eine Fassung `delete` an, rückt
  Unterartikel nach oben (`childIds`), löst Einträge (`entityIds`), zieht Verweise nach.
- `deleteSession` (`src/data/actions.ts:563`): nimmt `sessionId` aus allen Chronikeinträgen.

Folgen für den Abgleich:
- Hat der andere Rechner inzwischen etwas angelegt, das auf das Gelöschte zeigt (neue Beziehung zu
  einer gelöschten Person, Chronikeintrag mit `refs`), entsteht **kein Dateikonflikt**, aber ein
  Verweis ins Leere. Nach jedem Abgleich, der etwas hereinholt, `repairReferences`
  (`src/features/import/integrity.ts:14`) laufen lassen – so wie nach „Sicherung einspielen“
  (`src/features/einstellungen/backup.ts:199`) – und was es ändert, mit hochladen.
- Wird ein „gelöscht gegen geändert“ mit „behalten“ entschieden, sind die Nebenwirkungen des
  Löschens (gelöschte Beziehungen, hochgerückte Unterartikel) schon angewendet. Für Artikel gibt es
  den sauberen Weg: `restoreArticle` (`src/features/wiki/actions.ts:503`) stellt aus der Fassung
  `delete` Kennung, Unterartikel, Einträge und Verweise wieder her; danach den geänderten Text
  setzen. Für Einträge der Welt gibt es so etwas nicht – dort kommt der Eintrag zurück, seine
  gelöschten Beziehungen nicht (sie stehen aber im Verlauf des Repositorys). Als bekannte Grenze
  hinnehmen und im Dialog sagen.

### 5.3 Papierkorb und frühere Fassungen (`versions`)

- Eine Fassung wird **einmal geschrieben und nie geändert** (`createVersion`), Kennung zufällig.
  Dateikonflikte in `versions/` gibt es praktisch nicht; es gibt nur „neu“ und „gelöscht“.
- Gelöscht wird beim Ausdünnen (`pruneVersions`, `src/domain/versions.ts:63-82`, aufgerufen in
  `keepVersion`, `src/features/wiki/actions.ts:170`) und beim endgültigen Leeren (`purgeArticle`,
  `:553`). „Hier ausgedünnt, dort unberührt“ → dort löschen: richtig.
- Schreiben beide Rechner am selben Artikel, entstehen auf beiden Seiten Fassungen; nach dem
  Abgleich ist es die Vereinigung, und das nächste Speichern dünnt wieder auf 20 + 1/Tag/Seite,
  höchstens 60 (`KEEP_RECENT`, `KEEP_MOST`, `src/domain/versions.ts:17-19`). Harmlos.
  `versionDay` rechnet in der **Ortszeit des Rechners** (`src/domain/versions.ts:31-36`) – beide
  Rechner stehen in derselben Zeitzone, also gleich.
- **Papierkorb = Fassungen mit `reason: 'delete'`, deren Artikel es nicht mehr gibt** (`trashOf`,
  `src/domain/versions.ts:98-108`). Löscht A einen Artikel, bringt der Abgleich B: Artikel-Datei
  weg + neue `versions`-Datei → der Artikel liegt auf B im Papierkorb. Genau richtig, ohne
  Sonderfall. Kommt der Artikel durch eine Entscheidung zurück, verschwindet er von selbst aus dem
  Papierkorb (Bedingung `!data.articles[v.articleId]`, `:101`).
- **Mengenfrage:** `versions` ist die Sammlung, die das Repository aufbläht (jede Fassung ist ein
  ganzer Seitentext; `docs/WEITERARBEIT.md:1680-1681` rechnet mit 5–30 MB, schlimmstenfalls 90 MB).
  Für den Abgleich **mitnehmen** – sonst gäbe es am zweiten Rechner weder frühere Fassungen noch
  Papierkorb, und „hier gelöscht“ wäre dort endgültig. Zu wissen: Der Verlauf des Repositorys
  behält auch ausgedünnte Fassungen für immer – das Repository wächst stetig, auch wenn der Ordner
  es nicht tut. Bei reinem Text über Jahre unkritisch, aber nicht null.

### 5.4 Erster Abgleich (kein gemeinsamer Stand)

Der Spielleiter: „Den Spielstand kann ich ja so übernehmen“ – der volle Ordner liegt am Windows-PC.

| Lage | Tun |
|---|---|
| Repository leer, Ordner voll (Windows, erstes Mal) | alles hochladen; das ist der gemeinsame Stand |
| Repository voll, Ordner leer (Mac, erstes Mal) | alles holen. **Dafür braucht der Startbildschirm einen dritten Weg „Kampagne aus dem Abgleich holen“** – heute bietet ein leerer Ordner nur „Elaris neu beginnen“ oder „alten Spielstand übernehmen“ (`README.md:93`; `src/App.tsx:24-39`, `CampaignMissingError` `src/data/db.ts:34-38`) |
| Repository voll, Ordner voll, kein gemeinsamer Stand (z. B. Mac wurde per Sicherung gefüllt oder dort „Elaris neu beginnen“ geklickt) | Dateien mit gleichem Inhalt: gemeinsamer Stand. Rest: **keine Löschungen**, einseitig Vorhandenes gilt als neu; verschieden Vorhandenes ist Konflikt ohne B (kein feldweises Zusammenführen möglich). Hier ist die ehrliche Frage eine für den ganzen Stand: „Welcher Rechner hat den richtigen Stand?“ – mit `summarize` beider Seiten nebeneinander wie in `ReplaceDialog`. |

Warnung zum dritten Fall: „Elaris neu beginnen“ legt sechs Gefährten mit **zufälligen** Kennungen
an (`elarisCampaign`, `src/data/seed.ts:36-41`). Fließt das mit dem echten Stand zusammen, stehen
zwölf Gefährten da – ohne jeden Dateikonflikt. Deshalb am Mac nie erst eine Kampagne anlegen und
dann verbinden; und der Abgleich sollte beim Verbinden eines nicht leeren Ordners mit einem nicht
leeren Repository ohne gemeinsamen Stand **nicht still mischen**, sondern fragen.

---

## 6. `media/`

**Empfehlung: nicht mit abgleichen (erste Fassung).**

Gründe:
- **Größe:** 481 Bilder, 1,35 GB (`docs/WEITERARBEIT.md:326`) – im Schnitt 2,8 MB je Bild. Der alte
  Plan sagt selbst „zu groß“ (`:331-333`). Jedes Bild müsste einzeln hoch, das Repository läge weit
  über dem, wofür solche Repositorys gedacht sind, und der Verlauf vergisst nie etwas.
- **Netz am Tisch:** Der erste Abgleich am Mac würde sehr lange dauern; am Tisch gibt es womöglich
  gar kein Netz. Der Spielstand selbst (Text) ist dagegen schnell da.
- **Es ändert sich nicht.** `media/` ist kein lebender Teil des Spielstands, sondern ein
  Zwischenspeicher fremder Bilder: geschrieben nur von `media_fetch` (`src-tauri/src/media.rs`,
  Vertrag `src/data/platform.ts:19-22`), Dateiname = letzter Teil der Adresse (`mediaName`,
  `src/data/media.ts:18-28`). Im Spielstand steht immer die Adresse; fehlt die Datei, zeigt
  Wayfarer das Bild aus dem Netz (`useMediaSrc`, `src/data/media.ts:73`). Ein Rechner ohne
  `media/` verliert nichts, solange der Ursprung besteht.
- **„Bilder holen“ gibt es schon** (`einstellungen/MediaSection`, `docs/WEITERARBEIT.md:318-327`):
  am Mac einmal drücken, etwa drei Minuten.
- **Eigene Bilder reisen bereits mit:** Porträts und Bilder von Einträgen stehen verkleinert
  (≤ 512 px) als Data-URL **im Dokument** (`src/features/welt/image.ts:5-9`: „So bleibt die Datei
  des Eintrags klein genug, um im Kampagnenordner mitzureisen“; `src/features/gruppe/image.ts`).
- **Die Ablage sieht den Ordner ohnehin nicht** (`docs/WEITERARBEIT.md:325`; nur `*.json`,
  `src-tauri/src/store.rs:107-108`) – der Abgleich über eine Erlaubnisliste von Pfaden (7.2) lässt
  ihn von selbst aus.

Was offen bleibt und dem Spielleiter gesagt werden muss:
- **Vor einer Kündigung von LegendKeeper** müssen die Bilder auf **beiden** Rechnern geholt sein
  (`docs/WEITERARBEIT.md:330`) – oder der Ordner `media` wird einmal von Hand kopiert (USB-Stick).
  Danach gibt es keinen Ursprung mehr; ein neuer dritter Rechner bekäme die Bilder nur per Kopie.
- Ein Hinweis in den Einstellungen des Abgleichs: „Bilder werden nicht abgeglichen – auf diesem
  Rechner liegen N“ (Zahl gibt es: `localMediaCount`, `src/data/media.ts:53`).
- Späterer Ausbau, falls gewünscht: kleinere Fassungen der Bilder oder ein eigener Weg nur für
  Bilder. Nicht Teil der ersten Fassung.

---

## 7. Was nie ins Repository darf

### 7.1 Zwei verschiedene Repositorys

`CLAUDE.md:65-68`: „Trotzdem nie einen Spielstand, ein Backup oder Schlüssel einchecken – auch
nicht als Testmaterial: Der Spielstand gehört in den Kampagnenordner, und was einmal im Verlauf
steht, bleibt dort.“ – das meint das **Code-Repository**. Ebenso `CLAUDE.md:173` zu den Daten des
Planeten („gehören zur Kampagne und nie ins Repository“). `docs/WEITERARBEIT.md:1137`: „Der
Abgleich des Spielstands (Bereich I) braucht ein **eigenes, privates** Repository.“

Der Abgleich sollte das selbst absichern, weil der Nutzer nicht programmiert:
- Beim Verbinden prüfen, dass das Repository **privat** ist; ein öffentliches ablehnen.
- Ein Repository ablehnen, das nach Code aussieht (dort liegen `package.json`, `src-tauri/`,
  `CLAUDE.md`) oder das nicht leer ist und keine `campaign.json` enthält.
- Der Zugangsschlüssel soll nur für **dieses eine** Repository gelten (fein eingestellt, nur
  Inhalte lesen und schreiben). Wayfarer kann das nicht erzwingen, aber in der Anleitung genau so
  beschreiben.

### 7.2 Erlaubnisliste statt Verbotsliste

Abgeglichen wird **nur**, was auf eines dieser Muster passt – alles andere im Ordner existiert für
den Abgleich nicht:

- `campaign.json`
- `state.json`
- `<ordner>/<id>.json` mit `<ordner>` aus Kleinbuchstaben und `<id>` nach
  `^[A-Za-z0-9_-]{1,64}$` – dasselbe Muster wie `parseDoc`, `src/data/db.ts:111`.
  **Wichtig:** den Ordnernamen *nicht* auf die bekannten 34 Sammlungen beschränken. Eine neuere
  Version legt neue Sammlungen an; eine ältere muss deren Dateien **mitführen und nie löschen**,
  auch wenn sie sie nicht versteht (8.2).

Damit bleiben draußen, ohne dass man sie aufzählen müsste:

| Was | Wo es liegt | Warum nie |
|---|---|---|
| GitHub-Zugangsschlüssel, LegendKeeper-Key, Claude-Key | Schlüsselbund (`legendkeeper.rs:17-18`, `ai.rs:19-20`) | geheim; `README.md:131-133` |
| `config.json` (Pfad des Kampagnenordners) | Konfigurationsordner der App (`src-tauri/src/config.rs:11-19`) | je Rechner anders |
| `window.json` (Fenstergröße) | ebenda (`src-tauri/src/window.rs:218`) | je Rechner |
| gemeinsamer Stand / Stand des Abgleichs | je Rechner (5.1) | wäre selbst immer im Konflikt |
| `media/` | Kampagnenordner | Größe (6) |
| temporäre Dateien `.wayfarer-*.tmp` | Kampagnenordner (`src-tauri/src/store.rs:26-29`) | halbe Dateien |
| Verstecktes, `.DS_Store`, `Thumbs.db`, `desktop.ini` | Kampagnenordner | Müll des Systems |
| Sicherungsdateien (`wayfarer-sicherung-….json`, `backupFileName` `backup.ts:100-114`), die jemand in den Ordner gelegt hat | Kampagnenordner, oberste Ebene | groß, doppelt; passt nicht aufs Muster |
| Dateien, die beim Laden unlesbar waren (`db.problems`, `src/data/db.ts:62-63`, `:126-136`) | Kampagnenordner | Regel `CLAUDE.md:160`: „werden nie überschrieben, nur gemeldet“ – siehe unten |

**Unlesbare Dateien** passen aufs Muster, sind aber heikel: Eine hier halb geschriebene Datei
hochzuladen zerstörte die gute Fassung des anderen Rechners; eine gute Fassung von dort
herunterzuschreiben bräche die Regel „nie überschreiben“. Vorschlag: Pfade aus `db.problems` sind
für den Abgleich **in beide Richtungen eingefroren** und werden gemeldet („1 Datei ausgelassen –
siehe Probleme beim Laden“).

**Groß-/Kleinschreibung:** Windows und macOS unterscheiden `Abc.json` und `abc.json` nicht, das
Repository schon. Neue Kennungen sind klein (`newId`), übernommene (`safeId`,
`src/domain/schema.ts:2828`) können Großbuchstaben tragen. `readBackup` prüft Doppelte bereits
ohne Rücksicht auf Groß/Klein (`backup.ts:184-187`); der Abgleich sollte Pfade ebenso vergleichen
und zwei Pfade, die sich nur darin unterscheiden, als Problem melden statt einen zu überschreiben.

---

## 8. Verschiedene Programmversionen

### 8.1 Was heute geschieht

- zod 4 (`package.json:35`, `"zod": "^4.6.7"`). Alle Schemata sind `z.object(...)` – das
  **entfernt unbekannte Felder still** (weder streng noch durchlässig). Einzige Ausnahme:
  `SessionReadingSchema = z.looseObject(...)` (`src/domain/schema.ts:1174`). Kein `.transform`,
  `preprocess` oder `.catch` in `schema.ts` (gesucht, nichts gefunden) – `parse` füllt nur Vorgaben
  und streicht Unbekanntes.
- **Laden** verändert keine Datei: `open` liest, merkt sich den rohen Inhalt (`lastWritten`,
  `src/data/db.ts:88`) und hält das geprüfte Dokument im Speicher. Eine Datei mit neuen Feldern
  bleibt auf der Platte unversehrt, **solange das Dokument nicht geändert wird**.
- **Jede Änderung** schreibt das geprüfte Dokument zurück: `put` → `parse` → `serialize`
  (`src/data/db.ts:162-167`). **Dabei gehen unbekannte Felder verloren – still.** Beispiel: Version
  N+1 führt an Geschichten ein neues Feld ein; am Mac (Version N) wird in dieser Geschichte eine
  Szene abgehakt → die Datei wird ohne das Feld geschrieben → der Abgleich lädt sie als „hier
  geändert“ hoch → Windows verliert die Angabe. Genau der Datenverlust, den der Abgleich nie
  verursachen darf.
- **Neue Werte in Aufzählungen** (neue Art eines Eintrags – `EntitySchema` ist ein
  `discriminatedUnion('kind')`, `src/domain/schema.ts:585`; neue Art der Chronik; 89 `z.enum` im
  Schema): `parse` schlägt fehl → die Datei steht unter `db.problems`, wird nicht angefasst, **aber
  der Eintrag fehlt in der App** – Verweise auf ihn zeigen ins Leere.
- **Neue Sammlungen:** Ordner, den die ältere Version nicht kennt → `parseDoc` gibt ohne Meldung
  `null` zurück (`src/data/db.ts:113-114`); die Dateien bleiben liegen, auch bei `replaceAll`
  (löscht nur Bekanntes, `:240-245`).
- **`campaign.schema: z.literal(1)`** (`src/domain/schema.ts:73`): die einzige Versionsmarke im
  Spielstand. Stünde dort 2, ließe sich die Kampagne mit einer älteren Version gar nicht öffnen
  (`CampaignMetaSchema.parse` wirft in `open`, `src/data/db.ts:80`; Meldung „… ließ sich nicht
  öffnen“, `src/App.tsx:36`). Sie wurde trotz 28 neuer Sammlungen und vieler neuer Felder nie
  erhöht – als Sperre taugt sie nur für harte Brüche.
- Die Sicherung hat eine Versionssperre mit gutem Wortlaut: „Diese Sicherung stammt aus einer
  neueren Version von Wayfarer. Bitte Wayfarer aktualisieren und es dann noch einmal versuchen.“
  (`src/features/einstellungen/backup.ts:146-149`); `BACKUP_VERSION = 1` (`:28`).
- Umgekehrt (neuere Version liest ältere Dateien) ist alles gut: fehlende Felder bekommen Vorgaben
  („füllen fehlende Felder mit Vorgaben“, `src/domain/schema.ts:2-3`).

### 8.2 Braucht der Abgleich eine Sperre? Ja – und sie wird oft greifen

Der Windows-PC läuft praktisch immer mit dem neuesten Stand (dort wird gebaut), der Mac mit einem
Installationspaket, das seltener erneuert wird (`README.md:152-162`: Paket baut GitHub auf
Knopfdruck, 15–25 Minuten). **Der Mac ist also regelmäßig die ältere Version.** Die Sperre ist kein
Randfall.

Die **Programmversion taugt nicht** als Maß: Im Entwicklungsbetrieb steht immer `0.1.0`
(`package.json:4`; die echte Nummer setzt erst der Paketbau, `.github/workflows/release.yml:121`).

Vorschlag – zwei Sicherungen, die sich ergänzen:

**(a) Datenstand als Zahl.** Eine Konstante im Schema, die bei jeder Änderung der Gestalt der Daten
steigt (neues Feld, neuer Wert einer Aufzählung, neue Sammlung). Der Abgleich schreibt sie in eine
eigene kleine Datei im Repository (abgleicheigen, nicht Teil des Spielstands: Datenstand, Zeit, Name
des Rechners). Regel:
- Stand im Repository **höher** als der eigene → **kein Abgleich in beide Richtungen**. Meldung
  nach dem Muster der Sicherung: „Der Stand im Abgleich stammt aus einer neueren Version von
  Wayfarer. Bitte Wayfarer auf diesem Rechner aktualisieren – bis dahin arbeitest du hier weiter,
  und es wird später abgeglichen.“ Weiterarbeiten ist ungefährlich: Es wird nichts geholt, also
  auch nichts beschnitten.
- Warum auch **Holen** sperren (und nicht nur Hochladen): Geholte Dateien mit neuen Feldern würden
  beim nächsten lokalen Ändern beschnitten; nach dem Aktualisieren sähe der Abgleich die
  beschnittene Datei als „hier geändert“ und lüde sie hoch.
- Stand im Repository niedriger → abgleichen und die Marke anheben.

Damit die Zahl nicht vergessen wird: ein Test, der einen Fingerabdruck der Gestalt aller Schemata
(`COLLECTION_SCHEMAS`, `PlayStateSchema`, `CampaignMetaSchema`) festhält und fehlschlägt, wenn sich
die Gestalt ändert, ohne dass die Zahl stieg.

**(b) Prüfung am Inhalt, unabhängig von der Zahl.** Für jede hereinkommende Datei: roh lesen,
durch das Schema schicken, und vergleichen, ob das Ergebnis **Schlüssel verloren** hat (tief; nur
Schlüssel, die roh da waren und danach fehlen – hinzugekommene Vorgaben sind harmlos). Ebenso:
Prüfung schlägt fehl, oder der Ordner ist keine bekannte Sammlung. Trifft eines zu, „enthält der
Stand Angaben, die diese Version nicht kennt“ → wie (a) sperren. Das fängt den Fall, dass (a)
vergessen wurde, und ist verlässlich, weil das Schema nichts umformt (8.1). Vorsicht bei der einen
durchlässigen Stelle (`SessionReadingSchema`) und bei `z.record`/`z.unknown` (dort bleibt alles
erhalten – kein Verlust, also auch kein Alarm).

### 8.3 Was das für den Bau des Schemas heißt

Solange (a)+(b) sperren, muss am Schema nichts geändert werden. Wer es weicher will (ältere Version
darf weiterarbeiten, ohne zu beschneiden), müsste alle Schemata durchlässig machen – das berührt
3 000 Zeilen Schema und alle Tests, und fremde Felder überlebten dann auch Tippfehler. Nicht für die
erste Fassung.

---

## 9. Was der Code schon mitbringt – und wo er im Weg steht

Hilfreich:
- **Änderungen von außen werden übernommen:** Ordnerwache (`src-tauri/src/watch.rs`, entprellt
  300 ms / höchstens 2 s, `:18-21`) → Ereignis `store-changed` → `db.reload`
  (`src/data/db.ts:331-342`) → `applyExternal` (`:344-373`). Eigene Schreibvorgänge erkennt die
  Datenbank am unveränderten Inhalt (`lastWritten`, `:336`).
- **Der Editor rechnet damit:** „Der Text wurde anderswo geändert (… Abgleich mit dem anderen
  Rechner): Der Editor zeigt den neuen Stand – außer es wird gerade getippt.“
  (`src/features/wiki/PageEditor.tsx:148-155`).
- `MemoryStore.externalWrite` (`src/data/store.ts:48-53`) simuliert den anderen Rechner in Tests.
- `db.replaceAll` (`src/data/db.ts:217-253`) prüft erst alles, ändert dann – alles oder nichts;
  Vorlage für „einen Stand in einem Zug anwenden“.

Im Weg:
- **`reload` überspringt still jede Datei, für die hier noch etwas Ungespeichertes wartet**
  (`if (this.pending.has(path)) continue;`, `src/data/db.ts:334`). Schreibt der Abgleich Dateien
  einfach in den Ordner und überlässt den Rest der Wache, kann eine hereingeholte Datei von einer
  gleichzeitig wartenden lokalen Änderung **still überschrieben** werden. Der Abgleich darf sich
  nicht auf die Wache verlassen: vorher `flushEdits()` + `await db.flush()`, dann anwenden über
  **einen** Befehl der Datenbank (alles in einem Zug, eine Benachrichtigung, wie `replaceAll`),
  und währenddessen keine lokalen Schreibvorgänge dazwischenlassen.
- **Teilweises Anwenden zerreißt Handgriffe.** Kommt von einem „Zeit vorstellen“ des anderen
  Rechners `state.json` an, der zugehörige Chronikeintrag aber nicht (weil er im Konflikt hängt),
  ist der Stand halb. Empfehlung für die erste Fassung: **Gibt es einen echten Konflikt, wird gar
  nichts angewendet und nichts hochgeladen**, bis entschieden ist; der Rechner arbeitet so lange
  weiter wie ohne Netz. Am Tisch heißt das: ein stilles Zeichen, kein Dialog.
- **Rückgängig-Griffe halten alte Stände im Speicher** (z. B. `record`, `src/data/record.ts:780-786`,
  vergleicht `rev`). Nach einem hereingeholten Stand können sie ins Leere greifen; die meisten
  prüfen das schon („solange seither nichts geändert wurde“). Zusammengeführte Dokumente bekommen
  `rev = max + 1`, damit solche Prüfungen „geändert“ sehen.
- **Abgeleitetes nach dem Hereinholen:** `linkTwins` (läuft laufend über `TwinSync`,
  `docs/WEITERARBEIT.md:1823`), `repairReferences` – beide können nach einem Abgleich Dateien
  ändern, die dann wieder hochzuladen sind. Nicht in eine Schleife laufen (nach dem Aufräumen
  höchstens einmal nachlegen).

---

## 10. Fallstricke, kurz

1. **`state.json` ist immer verschieden** – ohne feldweises Zusammenführen fragt der Abgleich bei
   jedem Mal. (3.3)
2. **„Jüngere Weltzeit gewinnt“ verdoppelt die Chronik still** und verträgt kein Zurückstellen. (3.4)
3. **Doppelte ohne Dateikonflikt.** Zufällige Kennungen verhindern Dateikonflikte, aber nicht
   doppelte Bedeutung, wenn beide Rechner dasselbe tun:
   - derselbe Termin zweimal in der Chronik (`eventId` + `at`), derselbe Schritt einer Uhr zweimal
     (`clockId` + `stepId`);
   - zwei Beziehungen in derselben Richtung (Regel: „je Richtung höchstens eine“,
     `src/features/welt/actions.ts:83`);
   - zwei Einträge gleichen Namens (Regel: „nie einen zweiten Eintrag für einen Namen“);
   - zwei offene Blätter für den kommenden Abend (`createPrep` mit `sessionId: null`,
     `src/features/abend/actions.ts:71` – der Bereich wird gerade umgebaut, dort nachsehen);
   - zwei Sessions mit derselben Nummer.
   Nach einem Abgleich, bei dem beide Seiten etwas Neues hatten, diese fünf prüfen und **als Hinweis**
   melden (nicht selbst auflösen).
4. **`rev` und `updated` ändern sich bei jedem Schreiben** – beim Vergleich „gleich?“ übergehen;
   `rev` ist kein Konfliktzeichen. (4.3)
5. **`replaceAll` schreibt alles neu** – nur Prüfsummen sagen, was sich wirklich geändert hat. (2.3)
6. **Ohne gemeinsamen Stand nie löschen.** (5.1)
7. **Am Mac nie „Elaris neu beginnen“ und dann verbinden** – es braucht „Kampagne aus dem Abgleich
   holen“ auf dem Startbildschirm. (5.4)
8. **Ältere Version beschneidet Dateien still beim Ändern** – Sperre nötig, und der Mac ist
   regelmäßig der ältere. Programmversion ist kein brauchbares Maß (`0.1.0` im Entwicklungsbetrieb). (8)
9. **`db.reload` lässt Wartendes still gewinnen** – nicht über die Ordnerwache anwenden. (9)
10. **Nie halb anwenden** – ein Handgriff schreibt mehrere Dateien. (9)
11. **`media/` nicht abgleichen; vor der Kündigung von LegendKeeper auf beiden Rechnern holen.** (6)
12. **Erlaubnisliste der Pfade, Ordnernamen nicht auf bekannte Sammlungen beschränken.** (7.2)
13. **Groß-/Kleinschreibung der Dateinamen** zwischen Rechner und Repository. (7.2)
14. **Editor schreibt alle 600 ms** – Ruhezeit vor dem Abgleich, ein Commit je Bündel. (2.4)
15. **Schließen nie vom Netz abhängig machen.** (2.4)
16. **Zwei private Listen der Bezeichnungen** (`COLLECTION_LABEL`, `FOLDER_LABEL`) – exportieren
    statt eine dritte anzulegen. (4.3)
17. **`weather/` wächst nicht** (nur Handgesetztes) – die Annahme im Auftrag stimmt nicht; stark
    wachsen `chronicle` (Stückzahl) und `versions` (Bytes), groß sind `articles` und `atlas`. (2.2)
18. **Die Worte „Cloud-Laufwerk“** stehen noch in Code und Fehlermeldungen (1.3) – nach dem Bau
    anpassen, sonst liest der Spielleiter etwas, das es bei ihm nicht gibt.
19. **Der Mac ist ungeprüft:** Oberfläche und Paket sind dort nie gelaufen
    (`docs/WEITERARBEIT.md:27-38`); der Schlüsselbund unter macOS kann nach jeder neuen Version
    erneut fragen (`README.md:134-136`) – das trifft dann auch den GitHub-Schlüssel.
20. **Zeilennummern in `data/actions.ts` und `data/record.ts` wandern** – dort arbeitet gerade ein
    Kollege; nach Funktionsnamen suchen.
