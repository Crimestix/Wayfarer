# Abgleich über GitHub – fertiger Entwurf zum Bauen

Stand: 15. 11. 2026, Zweig `welle4/atlas`. Überarbeitung des ersten Entwurfs
(`abgleich-entwurf.md`) nach drei Gegenlesungen (Datenverlust, Bedienung, Technik). Nur gelesen,
nichts im Projekt geändert, nichts gebaut, nichts gegen GitHub ausprobiert. Für diese Fassung selbst
nachgelesen: `src/data/db.ts` (ganz), `src/data/actions.ts` (`advanceTime`, `undoTimeAdvance`),
`src/App.tsx`, `src/shell/Welcome.tsx`, `src/ui/sheet.tsx` (`Written`),
`src/features/wiki/PageEditor.tsx`, `wiki/editing.ts`, `wiki/actions.ts` (`applyLkImport`),
`bestiarium/actions.ts` (`saveCreature`), `domain/schema.ts` (`PlayStateSchema`),
`einstellungen/CampaignSection.tsx` und `MediaSection.tsx` (Beschriftungen), alle Aufrufer von
`replaceAll`, `src-tauri/src/watch.rs` (Ruhezeiten, Überlauf), `lib.rs` (`config_set`),
`data/store.ts` (Schnittstelle). Was übernommen und nicht geprüft ist, steht in Abschnitt 10.

Gegenüber dem ersten Entwurf ist der Abgleich **an fünf Stellen einfacher** geworden:
- Ein Widerspruch hält nur den einen Eintrag an, nicht den ganzen Abgleich.
- Rust schreibt Dateien des Spielstands nur noch an **einer** Stelle (`sync_recover`, vor dem
  Öffnen). Das erste Holen und „Der Stand aus der Ablage gilt“ laufen über denselben Merkzettel
  wie jedes Anwenden; `sync_adopt` entfällt.
- Kein Anhalten, keine Systemfrage beim zweiten Schließen, kein `POST git/blobs`, keine
  Liste „Doppelt in der Chronik“ (Doppeltes räumt Wayfarer nach fester Regel selbst auf),
  vier statt sieben Zustände am Zeichen.
- Beiseitegelegtes wird nach Zahl der Läufe ausgedünnt, nicht nach Uhr und Größe.
- „Sicherung einspielen“ und „Neu beginnen“ machen den gemeinsamen Stand ungültig – danach gilt
  dieselbe Frage wie beim ersten Abgleich, statt einer eigenen Maschinerie.

Gebaut wird in **zwei Abschnitten** (Abschnitt 9): **A** – Fachlogik, Datenbank, Rust, Ablauf,
alles mit Tests und ohne Oberfläche prüfbar; **B** – Oberfläche, Texte, Unterlagen, Rundgang.

Inhalt:
0. Die Festlegungen · 1. Was der Spielleiter sieht und tut · 2. Was abgeglichen wird ·
3. Der Ablauf eines Abgleichs · 4. Bausteine und Vertrag der Befehle · 5. Dateien · 6. Prüfplan ·
7. Offene Entscheidungen · 8. Bewusst nicht in der ersten Fassung · 9. Bauabschnitte A und B ·
10. Geprüft / nicht geprüft · 11. Einwände

---

## 0. Die Festlegungen

1. **Abgeglichen wird nur, was auf ein strenges Muster passt:** `campaign.json`, `state.json`,
   `<ordner>/<kennung>.json`. Alles andere im Ordner gibt es für den Abgleich nicht.
2. **Bilder (`media/`) reisen nicht mit** (1,35 GB). Sie werden je Rechner geholt.
3. **Der gemeinsame Stand liegt im Kampagnenordner in `.abgleich/`** (unter Windows mit dem
   Merkmal „versteckt“), **gebunden an genau diesen Ordner**: Eine Kopie oder ein verschobener
   Ordner gleicht erst ab, wenn der Spielleiter es ausdrücklich will. Der Zugangsschlüssel liegt
   nur im Schlüsselbund.
4. **TypeScript entscheidet, Rust trägt.** Plan, Zusammenführen und Texte sind reine Funktionen
   (Vitest, ohne Netz). Rust kennt Netz, Schlüsselbund, Dateien und Prüfsummen – und nichts vom
   Inhalt.
5. **Im laufenden Programm schreibt nur die Datenbank Dateien des Spielstands** – Übernommenes
   über `CampaignDb.takeRemote`: wörtlich, in einem JavaScript-Schritt, alles oder nichts. Rust
   schreibt sie nur in `sync_recover`, **bevor** es eine Datenbank gibt.
6. **Angewendet wird nur in einem ruhigen Moment:** kein ungespeicherter Text in einem Feld, kein
   offener Dialog, kein offener Wesen-Editor. Sonst wartet das Anwenden; Hochladen geht trotzdem.
7. **Zusammengeführt wird feldweise**, wo sich beide Seiten nicht widersprechen. Geschrieben wird
   der zusammengeführte Wert selbst; das Schema prüft nur.
8. **Ein Widerspruch hält nur seinen Eintrag an.** Der strittige Eintrag wird weder geholt noch
   hochgeladen, bis der Spielleiter entschieden hat; alles andere läuft weiter.
9. **Erst holen und prüfen, dann beiseitelegen, dann Merkzettel, dann anwenden.** Jede Datei in
   Eingang und Beiseite ist sicher geschrieben, bevor der Merkzettel entsteht. Fällt der Strom
   aus, bringt das nächste Öffnen es ohne Netz zu Ende.
10. **Hochladen ist ein einziger Umschaltpunkt** (`PATCH` mit `force: false`). Weicht auch nur
    eine Datei vom Plan ab, wird nichts hochgeladen.
11. **Ein älteres Programm holt, lädt aber nicht hoch.** Ist das Programm wieder aktuell, ergänzt
    der erste Lauf, was das ältere beim Speichern weggelassen hat. Gleiche Versionsnummer bei
    anderer Gestalt sperrt beide Richtungen.
12. **Schließen hängt nie am Netz:** höchstens 12 Sekunden, nur hochladen; die Frist steht in
    Rust.
13. **Ohne gemeinsamen Stand wird nie still gelöscht oder gemischt** – erster Abgleich, verlorener
    `.abgleich`, eingespielte Sicherung: immer eine ausdrückliche Wahl.

---

## 1. Was der Spielleiter sieht und tut

### 1.1 Wörter

Durchgehend **„Abgleich“**. Der Ort bei GitHub heißt **„Ablage bei GitHub“** (beim ersten
Vorkommen in jedem Text, danach „Ablage“); „Repository“ fällt nur dort, wo er es auf GitHubs
Seite wiederfinden muss. Statt „Token“: **„Zugangsschlüssel“**. Nie: Commit, Branch, Push, Pull,
Merge, Sync, Hash, Dateipfade. Die Seiten heißen **„hier“** und **beim Namen des anderen
Rechners** („MacBook“), sonst „am anderen Rechner“. Gezählt wird in **Einträgen** (nie
„Dateien“). Englische Beschriftungen von GitHubs Seite stehen in Anführungszeichen, wie dort.

Damit „Ablage“ nicht mit dem Ordner verwechselt wird: In Einstellungen → Kampagne heißt das Feld
mit dem Pfad künftig **„Kampagnenordner“** statt „Ablageort“ (`CampaignSection.tsx:223`, dazu
Kopfkommentar Z. 1).

### 1.2 Einrichten (Einstellungen → Abschnitt „Abgleich“)

Ort: **Einstellungen → neuer Abschnitt „Abgleich“**, direkt nach „Kampagne“. Kopf: Titel
**Abgleich**, Satz: „Derselbe Spielstand auf deinem Windows-PC und deinem MacBook. Wayfarer gleicht
den Kampagnenordner selbst mit einer privaten Ablage bei GitHub ab – du musst dafür nichts weiter
installieren.“ In der Browser-Vorschau nur: „Der Abgleich arbeitet nur in der installierten App.“

**Noch nicht eingerichtet** (`Notice`, Ton `info`): „Einmal einrichten dauert etwa zehn Minuten.
Du brauchst ein kostenloses Konto bei GitHub. Danach gleicht Wayfarer von selbst ab: beim Öffnen,
nach Änderungen und beim Schließen.“ Knopf **„Abgleich einrichten“**.

Liegt auf diesem Rechner schon ein Zugangsschlüssel (nach „Trennen“ ohne Haken, nach einem
abgebrochenen Einrichten), prüft „Abgleich einrichten“ ihn zuerst: „Ein Zugangsschlüssel ist
hinterlegt – er gilt für **<Besitzer>/<Name>**.“ → weiter bei Schritt 5 (klein daneben: „Anderen
Schlüssel einfügen“ → Schritt 3).

Der Knopf öffnet im Abschnitt selbst eine geführte Folge (kein Dialog; oben „Schritt 2 von 5“,
unten „Zurück“ / „Weiter“; „Abbrechen“ führt zur Notiz zurück). Verlässt er die Einstellungen
mittendrin, ist beim Wiederkommen alles wie vorher: Die Verbindung entsteht erst mit dem gelungenen
ersten Abgleich (Schritt 5), bis dahin gilt „Noch nicht eingerichtet“.

**Vorab – zwei Wahlkarten:**
- **„Das ist mein erster Rechner mit Abgleich“** – „Wayfarer legt deinen Spielstand von diesem
  Rechner in eine neue Ablage bei GitHub.“ → Schritt 1.
- **„Am anderen Rechner ist der Abgleich schon eingerichtet“** – „Du brauchst nur einen eigenen
  Zugangsschlüssel für diesen Rechner.“ → Schritt 3 (Schritt 1 und 2 entfallen).

**Schritt 1 von 5 – Ein Konto bei GitHub**
> GitHub ist ein Dienst, bei dem man Dateien in privaten Ablagen aufbewahren kann. Wayfarer
> nutzt eine solche Ablage als Treffpunkt für deine beiden Rechner. Hast du noch kein Konto,
> lege eines an (kostenlos) und melde dich im Browser an.

Knöpfe: „GitHub im Browser öffnen“ (`https://github.com/`), „Weiter“.

**Schritt 2 von 5 – Eine private Ablage anlegen**
> Bei GitHub heißt so eine Ablage „Repository“. Der Knopf öffnet die passende Seite; Name und
> „privat“ sind schon ausgefüllt.
> 1. Bei „Repository name“ steht `spielstand-elaris`. Ist der Name schon vergeben, nimm einen
>    anderen – merk ihn dir, du brauchst ihn in Schritt 3.
> 2. Es muss „Private“ gewählt sein – nie „Public“: Sonst könnte jeder deinen Spielstand lesen.
>    Eine öffentliche Ablage lehnt Wayfarer ab.
> 3. Klicke unten auf „Create repository“.

Knopf: „Seite bei GitHub öffnen“ → `https://github.com/new?name=spielstand-elaris&visibility=private`.
(Der Name steht als Vorgabe im Code, `SUGGESTED_REPO`; alle Texte sagen danach „die Ablage aus
Schritt 2“, nie den festen Namen.)

**Schritt 3 von 5 – Einen Zugangsschlüssel erzeugen**

Oben ein Feld **„So heißt dieser Rechner im Abgleich“**, vorbelegt nach System („Windows-PC“ bzw.
„MacBook“), frei änderbar (1–30 Zeichen).

Auf dem zweiten Rechner steht davor: „Den Schlüssel vom anderen Rechner kannst du nicht noch einmal
verwenden – er wird nirgends angezeigt. Erzeuge hier einen eigenen (zwei Minuten). Melde dich dazu
im Browser **dieses** Rechners mit demselben GitHub-Konto an; GitHub fragt dabei vielleicht noch
einmal nach Passwort oder Code.“

> Der Zugangsschlüssel ist eine lange Zeichenfolge, mit der Wayfarer – und nur Wayfarer – in
> genau diese eine Ablage schreiben darf. Bei GitHub heißt er „Fine-grained personal access
> token“. Der Knopf öffnet die Seite; Name, Laufzeit und die nötige Erlaubnis sind schon
> ausgefüllt.
> 1. Bei „Repository access“ wähle „Only select repositories“ und im Feld darunter **die Ablage
>    aus Schritt 2** (bzw. die, die du am anderen Rechner angelegt hast). Liegt dort auch eine
>    Ablage namens „Wayfarer“, ist das nicht die richtige.
> 2. Prüfe unter „Permissions“ → „Repository permissions“, dass bei „Contents“ „Read and write“
>    steht. „Metadata“ setzt GitHub von selbst dazu – lass es stehen.
> 3. Bei „Expiration“ steht „No expiration“: Der Schlüssel läuft nicht ab. GitHub warnt davor;
>    das darfst du übergehen. Löschen kannst du ihn bei GitHub jederzeit.
> 4. Klicke unten auf „Generate token“ (fragt GitHub noch einmal nach Passwort oder Code, ist
>    das normal) und kopiere die Zeichenfolge, die GitHub dir zeigt. Sie beginnt mit
>    `github_pat_` und wird nur dieses eine Mal angezeigt.
>
> Für den zweiten Rechner erzeugst du später auf dieselbe Weise einen eigenen Schlüssel. So
> kannst du einen Rechner einzeln aussperren, falls er einmal verloren geht.

Knopf: „Seite bei GitHub öffnen“ →
`https://github.com/settings/personal-access-tokens/new?name=Wayfarer+<Rechnername>&description=Abgleich+des+Spielstands&expires_in=none&contents=write`
(Rechnername URL-kodiert).

**Schritt 4 von 5 – Schlüssel einfügen**

Feld „Zugangsschlüssel“ (`Input type="password"`, `autoComplete="off"`, `spellCheck={false}`,
Platzhalter „github_pat_…“), Hinweis: „Der Schlüssel wird im Schlüsselbund deines Systems
abgelegt, nicht im Kampagnenordner. Er wird nie angezeigt.“ Nur auf dem Mac zusätzlich: „Dein
Mac fragt gleich nach deinem Anmeldepasswort, damit Wayfarer den Schlüssel im Schlüsselbund
ablegen darf. Wähle „Immer erlauben“. Nach jeder neuen Version von Wayfarer fragt er einmal
wieder.“ Knopf: „Speichern und prüfen“ / „Wird geprüft …“.

Ergebnisse (Zeile unter dem Feld, Fehler mit `role="alert"`; der gefundene Name immer groß):

| Lage | Text |
|---|---|
| genau eine passende Ablage | „Angemeldet als **<Konto>**. Gefunden: die private Ablage **<Besitzer>/<Name>**.“ |
| mehrere | „Der Schlüssel gilt für mehrere Ablagen. Welche ist für den Spielstand gedacht?“ + Auswahl (Ablagen mit fremdem Inhalt ausgegraut: „kein Spielstand“) |
| keine | „Der Schlüssel funktioniert, gilt aber für keine private Ablage, in die Wayfarer schreiben darf. Erzeuge ihn neu und wähle bei „Only select repositories“ die Ablage aus Schritt 2.“ + Knopf „Zurück zu Schritt 3“ |
| Schlüssel gilt nur für eine Ablage mit fremdem Inhalt | „Der Schlüssel gilt für **<Name>** – das ist nicht die Ablage für den Spielstand. Erzeuge den Schlüssel neu und wähle bei „Only select repositories“ die Ablage aus Schritt 2.“ + Knopf „Zurück zu Schritt 3“ |
| Ablage ist öffentlich | „**<Besitzer>/<Name>** ist öffentlich. Dort könnte jeder deinen Spielstand lesen – Wayfarer gleicht nur mit einer privaten Ablage ab. Stelle sie bei GitHub auf „Private“ oder lege eine neue an.“ |
| GitHub lehnt ab (401) | „GitHub nimmt diesen Schlüssel nicht an. Wurde er vollständig kopiert? Er beginnt mit `github_pat_`.“ |
| Schlüssel alter Art (`ghp_…`) | „Das ist ein Schlüssel der älteren Art; er gälte für alle deine Ablagen. Bitte erzeuge einen „Fine-grained token“ wie in Schritt 3.“ (wird nicht gespeichert) |
| kein Netz | „GitHub ist gerade nicht erreichbar. Besteht eine Internetverbindung? Der Schlüssel ist gespeichert; versuche es gleich noch einmal.“ |
| Schlüsselbund verweigert | „Der Schlüsselbund deines Systems hat den Zugriff verweigert. Versuche es noch einmal und wähle „Immer erlauben“.“ |

**Schritt 5 von 5 – Der erste Abgleich** (je nach Lage der Ablage):

a) *Ablage leer oder nur mit README* (der Windows-PC):
> Die Ablage ist noch leer. Wayfarer lädt jetzt den Spielstand dieses Rechners hoch:
> **<Name der Kampagne> · <Weltzeit>** · <Teile wie in „Sicherung“>. Das kann ein paar Minuten
> dauern; der Balken zeigt, wie weit es ist. Bilder im Ordner „media“ reisen nicht mit.
> *Hast du den Abgleich am anderen Rechner schon eingerichtet, ist das die falsche Ablage – dort
> müsste dein Spielstand schon liegen.*

   Knopf (Messing): **„Spielstand hochladen“**. Fortschritt: „Lade hoch … 1 200 von 3 480
   Einträgen“. Scheitert es mit fehlendem Recht (403): „Der Schlüssel darf nicht schreiben – bei
   „Contents“ fehlt „Read and write“.“ + „Zurück zu Schritt 3“.
   Danach Meldung: „**Abgleich eingerichtet** – Der Spielstand liegt jetzt auch in deiner Ablage.
   Am MacBook: Wayfarer öffnen und „Spielstand vom anderen Rechner holen“ wählen. Spielst du ohne
   Netz, öffne Wayfarer am MacBook vorher einmal mit Netz, bis „Abgeglichen“ steht.“

b) *In der Ablage liegt derselbe Stand wie hier:* „Dieser Rechner und die Ablage haben denselben
   Stand. Ab jetzt wird abgeglichen.“ Knopf „Fertig“.

c) *In der Ablage liegt ein anderer Spielstand:* die Frage aus 1.9.

d) *Die Ablage stammt von einer neueren Version:* Hinweis aus 1.10. Ist der Ordner leer bzw.
   gleich, wird trotzdem eingerichtet (holen geht, hochladen erst nach dem Aktualisieren); in der
   Frage 1.9 steht dann nur „Der Stand aus der Ablage gilt“ und „Abbrechen“ zur Wahl.

### 1.3 Holen am zweiten Rechner (Startbildschirm)

`shell/Welcome.tsx`. Im ersten Zustand („Kampagne öffnen“) eine **zweite Wahlkarte** unter
„Kampagnenordner wählen“: Titel **„Spielstand vom anderen Rechner holen“**, Unterzeile „Du hast
den Abgleich am anderen Rechner eingerichtet? Wayfarer lädt die Kampagne in einen neuen, leeren
Ordner.“ → Ordnerwahl mit dem Titel **„Neuen, leeren Ordner anlegen und wählen“**.
Im Zustand „Dieser Ordner ist noch leer“ steht dieselbe Karte **als erste**.

Danach das Panel **„Spielstand holen“** (alles als Zeile im Panel, keine Meldungen):

> In **<Ordner>** landet deine Kampagne. Dafür braucht Wayfarer einen eigenen Zugangsschlüssel für
> diesen Rechner. Den vom anderen Rechner kannst du nicht noch einmal verwenden – er wird nirgends
> angezeigt.

- Feld „So heißt dieser Rechner im Abgleich“ (vorbelegt „MacBook“).
- **Offen** (nicht eingeklappt): „So erzeugst du den Schlüssel“ – der Satz zum Anmelden im
  Browser dieses Rechners und die Punkte aus Schritt 3 mit „Seite bei GitHub öffnen“; auf dem
  Mac der Satz zum Schlüsselbund aus Schritt 4.
- Feld „Zugangsschlüssel“ + Knopf „Prüfen“. Liegt schon einer: „Ein Zugangsschlüssel ist
  hinterlegt.“ + „Prüfen“ (+ klein „Anderen einfügen“).
- Nach der Prüfung: „Gefunden: **<Besitzer>/<Name>** – **<Name der Kampagne>**, Weltzeit
  **<Datum, Uhrzeit>**, zuletzt hochgeladen vom Windows-PC am 15. November 2026, 21:40 Uhr.“
- Knopf (Messing): **„In diesen Ordner holen“**; Fortschritt „Hole den Spielstand … 2 100 von
  3 480 Einträgen“, dann kurz „Lege ab …“; „Abbrechen“ führt zurück.
- Danach öffnet sich die Kampagne. In der App einmal die Meldung: „**Spielstand geholt.** Bilder
  reisen nicht mit – hole sie einmal auf diesen Rechner.“ mit dem Knopf **„Zu den Bildern“**
  (führt zu Einstellungen → Abgleich, wo der Baustein „Bilder auf diesen Rechner holen“ steht).

Liegt im gewählten Ordner ein angefangenes Holen (Merkzettel, 3.9), zeigt das Panel nur
**„Holen fortsetzen“** und „Anderen Ordner wählen“ – nie „Elaris neu beginnen“ oder „Spielstand
der alten Version übernehmen“. Diese beiden verweigern sich außerdem in jedem Ordner, in dem
schon Einträge eines Spielstands liegen (Zeile: „In diesem Ordner liegen schon Teile eines
Spielstands. Wähle einen leeren Ordner.“).

Fehlerzeilen im Panel:

| Lage | Text |
|---|---|
| Ordner nicht leer | „In diesem Ordner liegt schon etwas. Zum Holen braucht Wayfarer einen neuen, leeren Ordner.“ |
| Ablage leer | „In deiner Ablage liegt noch kein Spielstand. Richte den Abgleich zuerst am Rechner mit der Kampagne ein (Einstellungen → Abgleich).“ |
| Ablage von neuerer Version | „Der Spielstand wurde mit einer neueren Version von Wayfarer geschrieben. Hol ihn trotzdem – Wayfarer lädt von hier aus nichts hoch, bis du es aktualisiert hast.“ (kein Fehler, nur Hinweis) |
| kein Netz / Abbruch | „Die Verbindung ist abgerissen. Was schon geholt wurde, bleibt; „In diesen Ordner holen“ macht dort weiter.“ |
| übrige | die Sätze aus Schritt 4 |

Nie anbieten: erst „Elaris neu beginnen“ und dann verbinden.

### 1.4 Alltag: das Zeichen in der Leiste

Im Fuß der linken Leiste, unter „Gespeichert“, eine zweite Zeile gleicher Bauart – als **echter
Knopf** (Hover, Fokus, Tastatur). Ohne Schlüssel und ohne Verbindung steht dort nichts.

| Zustand | Text | Punkt | Wenn man darauf zeigt | Klick |
|---|---|---|---|---|
| alles gleich | **Abgeglichen** | moosgrün | „Zuletzt abgeglichen: heute, 21:40 Uhr. Letzter Stand vom MacBook: gestern, 23:58 Uhr. Klick: jetzt abgleichen.“ | gleicht ab |
| – hier gibt es Neues | **Abgeglichen** | moosgrün mit goldenem Rand | „Hier gibt es Änderungen, die gleich hochgeladen werden. …“ | gleicht ab |
| – läuft | **Gleicht ab …** | gold, pulsiert | „Wayfarer gleicht mit deiner Ablage bei GitHub ab.“ | – |
| kein Netz | **Kein Netz** | hohl, gedämpft | „GitHub ist gerade nicht erreichbar. Alles ist auf diesem Rechner gespeichert; abgeglichen wird, sobald wieder Netz da ist. Stand vom MacBook: Donnerstag, 21:40 Uhr. Klick: jetzt versuchen.“ | versucht es |
| braucht dich | **Abgleich braucht dich** | gold gefüllt | der Grund in einem Satz (Widerspruch, Schlüssel, Version, Kopie …) | öffnet den Dialog (1.8) bzw. Einstellungen → Abgleich |
| nicht verbunden | **Abgleich nicht verbunden** | hohl, gedämpft | „Auf diesem Rechner liegt ein Zugangsschlüssel, aber dieser Kampagnenordner ist nicht verbunden.“ | Einstellungen → Abgleich |

Blutrot bleibt „Speichern fehlgeschlagen“ vorbehalten; der Abgleich ist nie rot.

Am Tisch gilt: **kein Dialog, keine Meldung von selbst**. Nur das Zeichen ändert sich – und
in einem Fall eine ruhige Zeile: Hat der erste Lauf nach dem Öffnen oder Aufwachen etwas zu
holen, steht unter der Weltleiste, bis es da ist: „Vom MacBook kommt Neues (14 Einträge) – gleich
da.“ (kein Knopf, kein Schließen; verschwindet von selbst; nie, wenn nichts zu holen ist).

Wird etwas übernommen, steht die Oberfläche einfach auf dem neuen Stand. Im Abschnitt steht
danach „Zuletzt abgeglichen: … · 14 Einträge vom MacBook übernommen, 3 hochgeladen“.

### 1.5 „Jetzt abgleichen“

Klick aufs Zeichen oder Einstellungen → Abgleich → Zeile **„Jetzt abgleichen“** („Sonst geschieht
das von selbst: beim Öffnen, nach Änderungen, beim Schließen.“). Rückmeldung als Zeile:
„Abgeglichen – nichts Neues.“ / „Abgeglichen – 14 Einträge vom MacBook übernommen, 3
hochgeladen.“ / die Sätze aus 1.11.

### 1.6 Was beim Schließen geschieht

1. Wayfarer speichert wie bisher.
2. Gibt es hier Änderungen, die noch nicht in der Ablage sind, lädt Wayfarer sie hoch –
   **höchstens 12 Sekunden**. So lange steht in der Mitte eine kleine Tafel: „**Wayfarer gleicht
   noch ab** und schließt dann von selbst.“ mit „Sofort schließen“.
3. Hereingeholt wird beim Schließen nichts.
4. Klappt es nicht (kein Netz, zu langsam), schließt Wayfarer trotzdem; nachgeholt wird beim
   nächsten Öffnen.
5. Ein zweiter Klick auf Schließen schließt sofort (keine Rückfrage).

Die Warnung „Die letzten Änderungen ließen sich nicht speichern …“ erscheint weiterhin nur, wenn
das **Speichern** scheitert.

### 1.7 Ohne Netz

Wayfarer arbeitet wie immer; das Zeichen zeigt „Kein Netz“ und nennt, von wann der Stand des
anderen Rechners ist. Neue Versuche nach 1, 2, 5, dann alle 10 Minuten und sofort, wenn das
System wieder Netz meldet. Was beide Rechner inzwischen getan haben, führt der nächste Lauf
zusammen; nur Widersprüche werden gefragt (1.8).

### 1.8 Wenn beide Rechner dasselbe geändert haben

Das Zeichen zeigt „Abgleich braucht dich“. **Nur der strittige Eintrag wartet**; alles andere
wird weiter geholt und hochgeladen. Weiterarbeiten geht ohne Einschränkung, auch am strittigen
Eintrag. Ein Klick aufs Zeichen (oder Einstellungen → Abgleich → „Ansehen und entscheiden“)
startet zuerst einen frischen Lauf („Wayfarer sieht nach …“, wenige Sekunden) und öffnet dann den
Dialog mit dessen Karten:

**Titel:** „Abgleich: Das entscheidest du“
**Einleitung:** „Diese Einträge wurden an beiden Rechnern geändert. Was sich nicht widerspricht,
hat Wayfarer schon zusammengeführt. Bis du entscheidest, bleibt auf jedem Rechner seine Fassung
dieser Einträge; alles andere wird abgeglichen.“

Je Eintrag eine Karte:

**a) Beide haben dieselbe Angabe verschieden geändert**
- Kopf: Art und Name („Geschichte „<Titel>““, „Artikel „<Titel>“ – Seite „<Seite>““).
- „Hier: geändert am 14. November 2026, 21:40 Uhr“ · „MacBook: geändert am 15. November 2026,
  00:12 Uhr“ (das ist der Stand des ganzen Eintrags; so steht es auch da: „Eintrag zuletzt
  geändert“).
- Je strittiger Angabe eine Zeile **in Worten** – Bezeichnung, „hier: …“, „MacBook: …“:
  Verweise als Name des Eintrags, Listenelemente mit ihrem Titel oder Anfang des Textes („Szene
  „Der Überfall““), ja/nein statt true/false, Zeiten im Kalender der Welt. Ohne eigene
  Beschriftung gilt die Übersetzungstabelle der Feldnamen (`FIELD_LABELS`), sonst „Angabe ohne
  Namen“ – aber immer mit beiden Werten. Lange Texte als Zeilenvergleich (`DiffView`) mit je
  einem Knopf **„Text kopieren“** (der Text ist markierbar).
- Kann eine Zeile nichts Lesbares zeigen, wird die Karte zur Wahl über die ganze Fassung (wie e).
- Wahl: **„Fassung von hier behalten“** / **„Fassung vom MacBook nehmen“**.
- Darunter: „Es geht nur um die gezeigten Angaben; alles andere an diesem Eintrag ist schon
  zusammengeführt. Die nicht gewählte Fassung legt Wayfarer beiseite.“

**b) An beiden Rechnern ist Zeit vergangen** (beide haben die Weltzeit verschieden gestellt)
- Kopf: „An beiden Rechnern ist Zeit vergangen“
- Wahl nach Inhalt beschriftet: **„Weltzeit von hier: 20. Tauwind 701, 14:30 · in <Ort>“** /
  **„Weltzeit vom MacBook: 19. Tauwind 701, 6:00 · in <Ort>“** (der Ort nur, wenn er auf beiden
  Seiten verschieden ist).
- Darunter: „Was an beiden Rechnern festgehalten wurde, bleibt in der Chronik. Termine und
  Schritte von Uhren, die nach der gewählten Weltzeit eingetreten waren, stehen danach wieder
  aus; doppelt Eingetretenes räumt Wayfarer zusammen.“ Nach dem Anwenden steht im Abschnitt
  einmal: „Wieder offen: 2 Termine, 1 Schritt einer Uhr · zusammengelegt: 1 Termin“ (wegklickbar).
- Ort, Session, Reisemittel und Marschordnung sind einzelne Angaben (Karte a), nicht Teil dieser
  Wahl.

**c) Gelöscht gegen geändert**
- „<Art> „<Name>““ – „Am MacBook gelöscht – hier inzwischen geändert (14. November 2026, 21:40
  Uhr).“ Wahl: **„Behalten“** (vorgewählt) / **„Auch hier löschen“**. Bei Einträgen der Welt:
  „Was beim Löschen am MacBook mit entfernt wurde (zum Beispiel Beziehungen), kommt durch
  „Behalten“ nicht von selbst zurück.“
- Ebenso, wenn dort gelöscht wurde und hier nur **etwas Neues darauf verweist**: „Am MacBook
  gelöscht – hier verweist inzwischen etwas darauf (<Art> „<Name>“).“ Gleiche Wahl.
- Umgekehrt: „Hier gelöscht – am MacBook inzwischen geändert.“ Wahl: **„Zurückholen“**
  (vorgewählt) / **„Gelöscht lassen“**.

**d) Sehr viel auf einmal** (Schutz)
- Hier: „Seit dem letzten Abgleich fehlen hier **240 Einträge** (zum Beispiel: …).“ bzw. „… hast
  du hier **312 Einträge** geändert.“ Wahl: **„Stimmt – so in die Ablage“** / **„Stimmt nicht –
  aus der Ablage zurückholen“**.
- Dort: „Am MacBook wurden **240 Einträge** entfernt (…).“ Wahl: **„Stimmt – hier auch
  entfernen“** / **„Stimmt nicht – hier behalten und wieder hochladen“**.

**e) Nur als Ganzes** (beide neu angelegt, nicht zusammenführbar, oder eine Fassung vom anderen
Rechner kann diese Version nicht lesen): beide Fassungen mit Datum; Wahl **„Fassung von hier“** /
**„Fassung vom MacBook“**. Ist die Fassung vom MacBook unlesbar, gibt es nur „Fassung von hier
hochladen“ und den Satz „Diese Fassung kann Wayfarer hier nicht lesen. Stimmen die Versionen
überein?“

**Fuß:** Knopf (Messing) **„Anwenden und abgleichen“** – bedienbar, sobald **mindestens eine**
Karte eine Wahl hat (nicht Gewählte warten weiter) – und „Später entscheiden“. Der Dialog hat
keinen Hinweis auf Sicherungen: Jede nicht gewählte Fassung liegt beiseite.

Danach läuft sofort ein Abgleich. Meldung: „**Abgeglichen** – 3 Entscheidungen übernommen. Die
nicht gewählten Fassungen liegen unter Einstellungen → Abgleich → „Beiseitegelegte Fassungen“.“

### 1.9 Zwei Spielstände – welcher gilt?

Kommt vor, wenn ein Rechner früher per Sicherung gefüllt wurde, `.abgleich` verloren ging oder
hier eine Sicherung eingespielt / „Neu beginnen“ gewählt wurde (3.12). Wayfarer mischt dann
**nie** von selbst. Sind beide Stände gleich: „Dieser Rechner und die Ablage haben denselben
Stand. Ab jetzt wird abgeglichen.“ Sonst ein Dialog:

**Titel:** „Zwei Spielstände – welcher gilt?“ (nach einer eingespielten Sicherung: „Du hast hier
einen ganzen Stand eingespielt“)
**Einleitung:** „Auf diesem Rechner und in deiner Ablage bei GitHub liegt jeweils ein Spielstand.
Wayfarer weiß nicht, was davon neuer ist.“ Zwei Spalten: **„Dieser Rechner“** und **„In der
Ablage“** („zuletzt vom MacBook, 15. November 2026, 00:12 Uhr“), je Name, Weltzeit, Teile.
Darunter: „Gleich: 3 480 · nur hier: 12 · nur dort: 0 · verschieden: 3“ und **aufklappbar** die
Einträge nach Art und Name mit Datum, getrennt nach „nur hier“, „nur dort“, „verschieden“ (bis
30, dann „und 12 weitere“).

Wahl:
- **„Der Stand dieses Rechners gilt“** – „Die Ablage wird auf den Stand dieses Rechners gebracht.
  Was es dort anders gibt (3 Einträge), legt Wayfarer vorher hier beiseite.“
- **„Der Stand aus der Ablage gilt“** – „Dieser Rechner wird auf den Stand der Ablage gebracht.
  Was es hier anders gibt (15 Einträge), legt Wayfarer vorher beiseite. Wayfarer startet dafür
  einmal neu.“
- **„Abbrechen“** – „Nichts wird geändert; der Abgleich wartet.“

Beiseitegelegtes aus dieser Wahl löscht Wayfarer nie von selbst und lässt sich mit einem Klick
ganz zurückholen (1.12).

### 1.10 Verschiedene Versionen von Wayfarer

*Auf dem älteren Rechner* (meist das MacBook): Zeichen „Abgleich braucht dich“; im Abschnitt eine
`Notice` (Ton `warn`), dieselbe Notiz einmal beim Öffnen der Kampagne als Zeile unter der
Weltleiste (am Schreibtisch; am Tisch nur das Zeichen):
- Titel: „Wayfarer ist auf diesem Rechner älter“
- Text: „Der Windows-PC arbeitet mit einer neueren Version. Dieser Rechner holt weiter, was von
  dort kommt, lädt aber nichts hoch, bis du Wayfarer hier aktualisiert hast. Was du hier änderst,
  bleibt sicher auf diesem Rechner und wird danach abgeglichen. Die neue Version für den Mac
  liegt bei GitHub unter „Releases“.“ + Knopf „Seite öffnen“ (`RELEASES_URL`, beim Bau
  festgelegt).

*Auf dem neueren Rechner*: keine Meldung von selbst, sondern eine bleibende Zeile im Abschnitt
und ein Zusatz am Zeichen („Abgeglichen – MacBook braucht die neue Version“), bis ein Hochladen
des MacBook mit dem neuen Datenstand gesehen wurde: „Diese Version speichert mehr als die vorige.
Das MacBook holt weiter, kann aber erst wieder hochladen, wenn dort dieselbe Version läuft.“

*Gleiche Versionsnummer, andere Gestalt* (nur bei Arbeit am Programm in getrennten Zweigen): beide
Rechner „Abgleich braucht dich“: „Die beiden Rechner haben verschieden gebaute Fassungen von
Wayfarer. Bis beide dieselbe haben, gleicht keiner ab.“

### 1.11 Störungen in Worten

Als Zeile im Abschnitt und als Text am Zeichen – nie als Dialog. „braucht dich“ heißt: nur der
Spielleiter kann es beheben; dann führt der Klick dorthin, wo er es kann.

| Lage | Zeichen | Text |
|---|---|---|
| kein Netz, Zeitüberschreitung, Störung bei GitHub (5xx) | Kein Netz | „GitHub ist gerade nicht erreichbar. Alles ist auf diesem Rechner gespeichert; Wayfarer versucht es von selbst wieder.“ |
| GitHub bittet um Pause | Kein Netz | „GitHub bittet um eine Pause. Wayfarer versucht es um 21:55 Uhr wieder.“ |
| Schlüssel gilt nicht mehr (401) | braucht dich | „GitHub nimmt den Zugangsschlüssel nicht mehr an – er wurde gelöscht oder ist abgelaufen. Dein Spielstand ist davon nicht berührt.“ + „Zugangsschlüssel ersetzen“ (klappt die Anleitung aus Schritt 3 mit dem Knopf auf, darunter das Feld) |
| Recht fehlt (403) | braucht dich | „Der Zugangsschlüssel darf in deine Ablage nicht schreiben. Bei GitHub muss für ihn unter „Contents“ „Read and write“ gewählt sein.“ + „Zugangsschlüssel ersetzen“ |
| Ablage nicht gefunden (404, Weiterleitung) | braucht dich | „Wayfarer findet die Ablage **<Besitzer>/<Name>** nicht mehr. Wurde sie umbenannt oder gelöscht?“ |
| Ablage ist öffentlich geworden | braucht dich | „Deine Ablage ist jetzt öffentlich. Wayfarer lädt nichts mehr hoch, bis sie wieder privat ist.“ |
| Ablage steht hinter dem zuletzt Gesehenen | Kein Netz | „Die Ablage zeigt gerade einen älteren Stand als zuletzt. Wayfarer wartet und versucht es wieder.“ |
| Ablage leer, obwohl schon abgeglichen | braucht dich | „Deine Ablage ist leer, obwohl hier schon abgeglichen wurde. Wurde sie gelöscht und neu angelegt?“ + „Abgleich neu einrichten“ |
| Schlüsselbund verweigert | braucht dich | „Der Schlüsselbund gibt den Zugangsschlüssel nicht heraus.“ + Knopf „Noch einmal versuchen“ (Wayfarer fragt in dieser Sitzung nicht von selbst wieder) |
| Ordner kopiert oder verschoben | braucht dich | die Frage aus 1.15 |
| Versionen | braucht dich | 1.10 |
| Einträge ausgelassen | (wie sonst) + Zeile | „<N> Einträge lässt der Abgleich aus: <Art> „<Name>“ …“ – mit Grund (unlesbar hier → „siehe Probleme beim Laden“; Name nur in Groß-/Kleinschreibung verschieden; zu groß) |
| Speichern klappt gerade nicht | (unverändert) | Der Abgleich wartet still, bis „Gespeichert“ wieder steht. |

### 1.12 Beiseitegelegte Fassungen

Einstellungen → Abgleich → Zeile **„Beiseitegelegte Fassungen“** („Was beim Abgleich auf diesem
Rechner ersetzt, entfernt oder nicht gewählt wurde.“) → Liste, jüngste zuerst. Zunächst nur
**Entscheidungen, erste Abgleiche, eingespielte Stände und Gelöschtes**; das Gewöhnliche
(„beim Abgleich ersetzt“) hinter „Auch Ersetztes zeigen“.

- „14. November 2026, 23:05 Uhr – deine Entscheidung: 2 Fassungen vom MacBook nicht gewählt“
- „12. November 2026, 19:10 Uhr – erster Abgleich: 15 Einträge von hier“

Je Lauf ein Knopf **„Alle zurückholen“**; aufgeklappt je Eintrag „<Art> „<Name>“ (Fassung von
hier)“ mit **„Ansehen“** (Vergleich mit heute, Text markierbar, „Text kopieren“) und
**„Zurückholen“** („Setzt diesen Eintrag auf die beiseitegelegte Fassung zurück. Die heutige
Fassung wird dabei ihrerseits beiseitegelegt.“). Zurückgeholtes ist eine gewöhnliche Änderung und
wird abgeglichen.

Unter der Liste: „Wayfarer hebt die letzten 50 Abgleiche auf, die etwas beiseitegelegt haben.
Deine Entscheidungen und erste Abgleiche bleiben, bis du sie löschst.“ + „Diese löschen“ je Lauf.

### 1.13 Zugangsschlüssel ersetzen, trennen

- **„Zugangsschlüssel ersetzen“**: klappt die Anleitung aus Schritt 3 (mit „Seite bei GitHub
  öffnen“) und darunter das Feld aus Schritt 4 auf.
- **„Abgleich trennen“** (Knopf der Art `danger`, ganz unten) → Rückfrage „Abgleich auf diesem
  Rechner trennen?“ – „Wayfarer gleicht diesen Kampagnenordner dann nicht mehr ab. Der Spielstand
  bleibt hier und in deiner Ablage, wie er ist; nichts wird gelöscht.“ Kästchen „Auch den
  Zugangsschlüssel von diesem Rechner entfernen“. Knopf „Trennen“. Danach gedämpft: „Die Ablage
  selbst löschst du – falls gewünscht – bei GitHub in den Einstellungen der Ablage („Delete this
  repository“).“

Ein Anhalten gibt es nicht. Zum Ausprobieren: vorher „Sicherung herunterladen“ (so steht es auch
im Abschnitt, gedämpft unter „Jetzt abgleichen“: „Was du hier änderst, wird abgeglichen. Zum
Ausprobieren nimm vorher eine Sicherung.“).

### 1.14 Der Abschnitt, wenn eingerichtet

1. Zustandszeile: „**Abgeglichen** – verbunden mit <Besitzer>/<Name> · dieser Rechner: Windows-PC
   · zuletzt heute, 21:40 Uhr · letzter Stand vom MacBook: gestern, 23:58 Uhr“. Wartet etwas auf
   eine Entscheidung: „**<N> Einträge warten auf deine Entscheidung** – seit Donnerstag, 22:10 Uhr
   kommen diese Einträge nicht in die Ablage“ + Knopf „Ansehen und entscheiden“ (dann der
   Messingknopf dieser Ansicht).
2. Hinweise nur, wenn es sie gibt: Version (1.10), Störung (1.11), „Wieder offen …“ (1.8 b).
3. Zeilen (`ActionRow`): „Jetzt abgleichen“ · „Beiseitegelegte Fassungen (N)“ ·
   „Zugangsschlüssel ersetzen“.
4. `Notice` (Ton `info`) „Bilder reisen nicht mit“: „Der Abgleich überträgt den Spielstand, nicht
   die Bilder (auf diesem Rechner: <N>). Hole sie auf jedem Rechner einmal – **bevor du
   LegendKeeper kündigst**.“ Darunter der vorhandene Baustein „Bilder auf diesen Rechner holen“
   (`MediaSection`) selbst – nicht der Weg dorthin.
5. „Abgleich trennen“.

### 1.15 Kopie oder verschobener Ordner

Bemerkt Wayfarer beim Öffnen, dass der Kampagnenordner nicht mehr dort liegt, wo der Abgleich
eingerichtet wurde (Kopie, Umzug, ein auf den anderen Rechner kopierter Ordner), gleicht er nicht
ab und fragt im Abschnitt (Zeichen „Abgleich braucht dich“):

**„Dieser Ordner ist eine Kopie oder wurde verschoben“** – „Der Abgleich wurde für
**<alter Pfad>** eingerichtet; dieser Ordner liegt in **<neuer Pfad>**. Ist das eine Kopie – etwa
eine Sicherung oder ein Ordner zum Ausprobieren –, soll sie nicht abgleichen: Sonst würde sie auf
den heutigen Stand gebracht, und was du darin änderst, käme auf deinen anderen Rechner.“
- **„Nicht abgleichen – das ist eine Kopie“** (vorgewählt): trennt nur diese Kopie (Verbindung
  und gemeinsamer Stand dieser Kopie weg, Beiseitegelegtes bleibt).
- **„Das ist jetzt mein Kampagnenordner“**: merkt den neuen Ort; ab jetzt wird abgeglichen.

Bis zur Antwort geht keine Anfrage an GitHub.

---

## 2. Was abgeglichen wird – und was nie

### 2.1 Erlaubnisliste (nach Muster)

Abgeglichen wird eine Datei genau dann, wenn ihr Pfad (mit „/“) passt auf: `campaign.json`,
`state.json` oder `<ordner>/<kennung>.json` mit `<ordner>` = 1–32 Kleinbuchstaben `a–z`,
`<kennung>` = 1–64 Zeichen aus `A–Z a–z 0–9 _ -`, Endung genau `.json`. Der Ordner wird nicht auf
die bekannten Sammlungen beschränkt: Dateien einer Sammlung, die diese Version noch nicht kennt,
reisen wörtlich mit und werden nie gelöscht. Die Prüfung steht einmal in Rust
(`sync::local::is_synced_path`) und einmal in TypeScript (`isSyncedPath`), mit denselben Fällen.
`versions/` reist mit (Entscheidung 5). Die Kennungen im Schema passen auf dieses Muster (im
Code nachgelesen, auch zusammengesetzte und die aus LegendKeeper).

### 2.2 Was nie in die Ablage kommt

| Was | Wo | Wodurch ausgeschlossen |
|---|---|---|
| Zugangsschlüssel (GitHub, LegendKeeper, Claude) | Schlüsselbund | liegt nicht im Ordner; kein Befehl gibt ihn heraus |
| `config.json`, `window.json` | Einstellungsordner der App | liegt nicht im Ordner |
| `.abgleich/` | Kampagnenordner, versteckt | Muster; `store::walk` und Ordnerwache übergehen Namen mit „.“ |
| `media/` | Kampagnenordner | Muster (2.3) |
| `.wayfarer-*.tmp`, `.DS_Store`, `Thumbs.db`, `desktop.ini`, `.git` | Kampagnenordner | Muster |
| Sicherungsdateien, Konfliktkopien fremder Programme, Namen mit Umlauten/Leerzeichen | Kampagnenordner | Muster |
| beim Laden unlesbare Dateien (`db.problems`) | Kampagnenordner | ausgelassen (2.7) |

In der Ablage liegen außer dem Spielstand nur `wayfarer.json` (Marke, 2.6), `.gitattributes`
(Inhalt `* -text`, beim ersten Hochladen angelegt) und gegebenenfalls GitHubs `README.md`.
Dank `base_tree` bleiben fremde Dateien unberührt; lokal geschrieben werden sie nie.

### 2.3 Bilder (`media/`): nicht abgleichen

481 Bilder / 1,35 GB – über GitHubs Empfehlung für eine ganze Ablage, und der Verlauf vergisst
nie. Bilder sind ein Zwischenspeicher (im Spielstand steht die Adresse des Ursprungs); eigene
Porträts stehen verkleinert im Dokument und reisen mit. Je Rechner einmal „Bilder auf diesen
Rechner holen“ – der Baustein steht im Abschnitt Abgleich (1.14 Punkt 4).

### 2.4 `state.json` und `campaign.json`: feldweise

In `state.json` ist nichts an einen Rechner gebunden. Sie wird Feld für Feld gegen den
gemeinsamen Stand verglichen (`STATE_RULES`):

| Feld(er) | wenn beide Seiten es verschieden geändert haben |
|---|---|
| `now` + `previousNow` (zusammen: „Weltzeit“) | Rückfrage 1.8 b. Danach `settleTime` (3.6). Nie „die jüngere gewinnt“. |
| `placeId`, `sessionId`, `travelBy`, `march` | je eine Rückfrage (Karte a, Bezeichnungen „Ort der Gruppe“, „Laufende Session“, „Reist mit“, „Marschordnung“) |
| `watch`, `continuityOk`, `twinsApart` | als **Menge**: Hinzugefügtes kommt dazu, Entferntes geht. Nie eine Rückfrage. |
| `board`, `netBoard` | je Schlüssel; dieselbe Karte auf beiden Seiten woanders → jüngeres `updated`. Nie eine Rückfrage. |
| `timelineLanes`, `nameMemory`, `recapDismissed` | jüngeres `updated`. Nie eine Rückfrage. |
| `rev`, `updated` | nie verglichen; Ergebnis `rev = max + 1`, `updated = jetzt`. |

Hat nur eine Seite ein Feld geändert, gilt sie. „Jüngeres `updated`“ (Wanduhr, ganzes Dokument)
entscheidet nur über Auslage, nie über Spielstand. Beispiel am Tisch: Der PC hat bei der
Vorbereitung Zeit vorgestellt, der Mac hat nur die Session gestartet → kein Widerspruch: Weltzeit
vom PC, Session vom Mac.

`campaign.json` (`CAMPAIGN_RULES`): `name`, `warmestMonth`, `aiModel` einzeln; `calendar` **als
Ganzes**; `tableRules` als Text (beide verschieden → Rückfrage mit Zeilenvergleich); `ages` je
Kennung; `factScaffolds` je Art (Liste einer Art als Ganzes); `customConditions` als Ganzes;
`schema` bleibt.

Neue Felder in `PlayState` / `CampaignMeta` ohne Regel laufen nach der allgemeinen Regel (2.5) –
der Fingerabdruck-Test (2.6) erinnert daran, die Regel zu prüfen.

### 2.5 Alle anderen Dokumente: dieselbe Regel

Objekte Schlüssel für Schlüssel; Listen aus Objekten mit eindeutiger `id` je `id`; alles andere
als Ganzes (Einzelheiten 3.5). Der Mac hakt eine Szene ab, der PC schreibt an der Zusammenfassung
→ kein Widerspruch. Text wird nicht in sich zusammengeführt (zwei Fassungen desselben Seitentexts
sind eine Rückfrage). Zwei Fassungen, die sich nur in `rev`/`updated` unterscheiden, sind kein
Widerspruch: höheres `rev`, bei Gleichstand die des anderen Rechners.

### 2.6 Verschiedene Programmversionen

Problem: zod streicht unbekannte Felder beim Lesen (`db.put`, `db.ts:163-164`, und schon beim
Öffnen). Ein älteres Programm, das ein Dokument der neueren Gestalt speichert, verliert deren
Felder. Lösung – **Zahl, Fingerabdruck, Marke, Ergänzen:**

1. `export const DATA_VERSION = 1;` und `export const DATA_SHAPE = '<16 Zeichen hex>';` in
   `src/domain/schema.ts`. `DATA_VERSION` steigt bei jeder Änderung der Gestalt.
2. **Test** `dataVersion.test.ts`: Fingerabdruck = SHA-256 über `z.toJSONSchema(…)` aller
   Schemata (`COLLECTION_SCHEMAS`, `PlayStateSchema`, `CampaignMetaSchema`; Schlüssel sortiert),
   die ersten 16 Zeichen. Weicht er von `DATA_SHAPE` ab: „Die Gestalt der Daten hat sich geändert.
   `DATA_VERSION` um eins erhöhen, `DATA_SHAPE` auf <neu> setzen und bei neuen Feldern in
   `state.json`/`campaign.json` die Regel in `STATE_RULES`/`CAMPAIGN_RULES` prüfen.“ (Notfalls
   `{ unrepresentable: 'any' }`.)
3. **Marke** `wayfarer.json` im Wurzelordner der Ablage:
   `{"format":"wayfarer-abgleich","datenstand":7,"gestalt":"<DATA_SHAPE>","geraete":{"Windows-PC":7,"MacBook":6}}`
   + Zeilenende. Passt nicht aufs Muster, wird also nie lokal geschrieben; dient zugleich als
   Ausweis „hier liegt ein Wayfarer-Spielstand“. Jedes Hochladen setzt `geraete[<dieser
   Rechner>]` auf die eigene Zahl und hebt `datenstand`/`gestalt`, wenn die eigene Zahl höher ist
   (im selben Commit).
4. **Regel bei jedem Lauf** (Marke und `stand.json` → `maxVersion`, die höchste je hier gesehene
   Zahl):
   - Marke **höher** als `DATA_VERSION` (oder `maxVersion` höher): **„älter“**. Geholt wird nur,
     wo hier nichts geändert ist (Zeilen 8, 9, 10 aus 3.4); nichts wird zusammengeführt,
     nichts hochgeladen, nichts dort gelöscht. In `stand.json` steht dann dauerhaft
     `olderEdits: true` – gesetzt, **bevor** irgendetwas angewendet wird (beim Öffnen über
     `sync_state`).
   - **Gleiche** Zahl, **anderer** Fingerabdruck: ruht in beide Richtungen (1.10).
   - Marke niedriger oder gleich: normal.
5. **Ergänzen nach dem Aktualisieren:** Steht `olderEdits` und ist das Programm nicht mehr
   älter, holt der erste Lauf für jeden Pfad, der hier seit dem gemeinsamen Stand geändert ist,
   die Fassung des gemeinsamen Stands (`sync_fetch` über ihre Kennung) und ergänzt mit
   `fillStripped(gemeinsam, hier)` jeden Schlüssel, der dort steht und hier fehlt – in Objekten
   und in Listenelementen mit gleicher `id`; nie werden Listenelemente oder Einträge einer Liste
   zurückgebracht. Das Ergebnis wird angewendet wie Zusammengeführtes (3.3, Schritt 9) und ist
   danach „hier geändert“. Erst danach plant der Lauf normal; `olderEdits` wird gelöscht.
   (Fehlte ein Feld absichtlich, kommt höchstens ein früherer Wert zurück – nie geht etwas
   verloren.)
6. Eingehende Dateien bekannter Sammlungen müssen durchs Schema (`checkIncoming`); geschrieben
   wird der Text selbst. Besteht eine das Schema nicht, wird **nur diese** ausgelassen (Karte e).

Folge für die Arbeit am Programm (`CLAUDE.md`): Wer das Schema ändert, erhöht `DATA_VERSION`
und setzt `DATA_SHAPE`. Der Mac holt danach weiter, lädt aber erst nach seinem Aktualisieren
wieder hoch.

### 2.7 Ausgelassene Einträge

Ein ausgelassener Pfad wird in diesem Lauf weder hochgeladen noch überschrieben noch gelöscht;
sein gemeinsamer Stand bleibt. Er hält den Rest nie an und wird mit Art und Name genannt (Name
aus der lokalen Fassung oder dem Titel der anderen; nie nur der Pfad).

| Grund | erkannt von | bleibt bis |
|---|---|---|
| beim Laden unlesbar (`db.problems`) | TypeScript | die Datei wieder lesbar ist |
| zwei Pfade nur in Groß-/Kleinschreibung verschieden | Rust | einer verschwindet |
| kein sauberes UTF-8 oder mit BOM | Rust | die Datei sauber ist |
| größer als 16 MiB | Rust | kleiner |
| gesperrt (Virenscanner) | Rust | nächster Lauf, ohne Meldung |
| strittig (offene Rückfrage, 1.8) | TypeScript | entschieden |
| vom anderen Rechner, aber hier unlesbar (Schema) | TypeScript | entschieden (Karte e) oder neue Fassung |

`campaign.json` und `state.json` werden nie gelöscht, in keiner Richtung.

---

## 3. Der Ablauf eines Abgleichs

### 3.1 Der Ordner `.abgleich/` im Kampagnenordner

Er liegt im Kampagnenordner, weil Eingang, Merkzettel und Beiseitegelegtes Platz neben den Dateien
brauchen und `config_set` die `config.json` heute aus einem Feld neu schreibt (`lib.rs:53-56`).
Damit eine Kopie des Ordners **nicht** einfach weiter abgleicht, trägt `verbindung.json` den Ort
(`root`, 1.15). `store::walk`, `check_rel_path` und die Ordnerwache übergehen Namen mit Punkt;
unter Windows bekommt der Ordner beim Anlegen zusätzlich das Merkmal „versteckt“ (über
`windows-sys`, nur `cfg(windows)`), damit ihn niemand beim Aufräumen für Müll hält.

```
.abgleich/
  verbindung.json    wohin abgeglichen wird; entsteht erst mit dem gelungenen ersten Abgleich
  stand.json         gemeinsamer Stand, zuletzt gesehene Ablage, Entscheidungen, Zähler
  stand.vorher.json  die vorige Fassung von stand.json
  anwenden.json      Merkzettel, solange angewendet wird (auch erstes Holen, „Ablage gilt“)
  eingang/<sha>      geholte, geprüfte Dateien (Name = Kennung)
  beiseite/<nr>/     hier/<pfad>, dort/<pfad>, inhalt.json
```

**Jede** Datei unter `.abgleich/` – auch in `eingang/` und `beiseite/` – wird mit
`store::write_atomic` geschrieben (mit `sync_all`). Der Merkzettel entsteht erst, wenn alles, worauf
er verweist, so geschrieben ist.

**`verbindung.json`**
```json
{ "version": 1, "owner": "<Konto>", "repo": "<Name>", "branch": "main",
  "device": "Windows-PC", "root": "<kanonischer Pfad des Kampagnenordners>" }
```
`root` wird beim Öffnen mit dem tatsächlichen Ort verglichen (`std::fs::canonicalize`, unter
Windows ohne `\\?\`, unter Windows und macOS ohne Groß/Klein). Weicht er ab → `moved` (1.15);
bis zur Antwort geht keine Anfrage hinaus.

**`stand.json`**
```json
{ "version": 1, "repo": "<Konto>/<Name>", "branch": "main",
  "files": { "entities/abc.json": "<Kennung>", "state.json": "<Kennung>" },
  "seen": { "commit": "<sha>", "tree": "<sha>", "files": { "<pfad>": "<Kennung>" },
            "marker": { "datenstand": 7, "gestalt": "<hex>", "geraete": { "MacBook": 6 } },
            "device": "MacBook", "pushedAt": "2026-11-15T00:12:00Z" },
  "decided": { "stories/x.json": { "choice": "local", "remote": "<Kennung|null>", "fields": ["summary"] },
               "*mass:<Prüfsumme der Pfadliste>": { "choice": "ok" } },
  "maxVersion": 7, "olderEdits": false, "restored": false,
  "runNo": 412, "syncedAt": "2026-11-15T21:40:03.000Z" }
```
- `files` ist **der gemeinsame Stand**; `null` = keiner (erster Abgleich, nach einer
  eingespielten Sicherung).
- Vor jedem Schreiben wird die bisherige `stand.json` zu `stand.vorher.json`. Ist `stand.json`
  unlesbar, gilt `stand.vorher.json` (ein älterer gemeinsamer Stand ergibt höchstens mehr
  Rückfragen oder holt Gelöschtes zurück, überschreibt aber nie still). Sind beide unlesbar → kein
  gemeinsamer Stand (1.9).
- `seen` ist nur Zwischenspeicher der Ablage (spart Anfragen), nie die Wahrheit.
- `decided` hält Entscheidungen, bis sie angewendet sind (3.6).
- `runNo` zählt Läufe, die etwas beiseitelegen; `beiseite/<nr>/` wird mit „muss neu sein“
  angelegt, bei Zusammenstoß wird weitergezählt. Keine Uhrzeit im Namen.
- Kennung = Git-Blob-Kennung: `sha1("blob " + Länge in **Bytes** + "\0" + rohe Bytes)`, 40 Zeichen
  hex. Prüfwerte (mit `git hash-object` bestätigt): leer
  `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`; `"hello\n"`
  `ce013625030ba8dba906f756967f9e9ca394464a`; `"ä\n"` (3 Bytes)
  `8be8316c70848caa99b9b3086c64976e82d1c17d`; BOM + `"hello\n"`
  `c2d46024e14dbd9078bb0aafcf920bb8e7216455`.

**`anwenden.json`** (Merkzettel)
```json
{ "version": 1, "kind": "run", "run": 412, "head": "<commit>",
  "writes":  [ { "path": "stories/x.json", "sha": "<neue Kennung>", "expect": "<alte Kennung|null>", "base": "<Kennung der Ablage>" } ],
  "deletes": [ { "path": "events/y.json", "expect": "<alte Kennung>" } ],
  "link": null, "baseAll": null }
```
`kind`: `run` (Schritt 9) | `adopt` (erstes Holen in leeren Ordner) | `remoteWins` („Der Stand
aus der Ablage gilt“). Bei `adopt`/`remoteWins` stehen `link` (künftige `verbindung.json`) und
`baseAll` (der ganze gemeinsame Stand) darin; sie werden erst geschrieben, wenn jeder Eintrag
erledigt ist.

**`beiseite/<nr>/inhalt.json`**
```json
{ "version": 1, "at": "2026-11-15T21:40:03Z", "reason": "abgleich",
  "entries": [ { "side": "hier", "path": "stories/x.json", "sha": "<Kennung>", "title": "<Art und Name>" } ] }
```
`reason`: `abgleich` | `entscheidung` | `erster-abgleich` | `eingespielt` | `zurueckholen`.
**Aufheben:** die 50 jüngsten Läufe mit `reason` `abgleich` oder `zurueckholen`; alle übrigen
bleiben, bis der Spielleiter sie löscht. Keine Zeit- und keine Größengrenze. `eingang/` wird nach
jedem gelungenen Lauf geleert (außer was ein liegender Merkzettel braucht).

### 3.2 Die Anfragen an GitHub

An `https://api.github.com`, nacheinander, mit `Authorization: Bearer <Schlüssel>`,
`Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2026-03-10`,
`User-Agent: Wayfarer/<Version>`. Zeitgrenze je Anfrage 30 s (Verbindungsaufbau 10 s), Archiv
300 s. Keine Weiterleitungen (`redirect::Policy::none()`); 301/307/308 von `api.github.com` →
Fehlerart `missing` („umbenannt oder gelöscht?“).

| Zweck | Anfrage | Gelesen / gesendet |
|---|---|---|
| Wer bin ich | `GET /user` | `login` |
| Ablage gezielt | `GET /repos/{login}/{SUGGESTED_REPO}` bzw. `/repos/{o}/{r}` | `private`, `permissions.push`, `archived`, `disabled`, `default_branch` |
| Ablagen des Schlüssels (nur, wenn gezielt 404) | `GET /user/repos?per_page=100` | je `full_name`, `private`, `permissions.push`, `default_branch` – nur zum Aussortieren, nie als Zusage |
| Kopf des Zweigs | `GET …/git/ref/heads/{zweig}` | `object.sha`; 409 = leer **nur ohne** gemeinsamen Stand und `seen.commit`, sonst Fehlerart `server` |
| Kopf baut auf dem Gesehenen auf? (nur wenn Kopf ≠ `seen.commit`) | `GET …/compare/{seen}...{kopf}` | `status`: `ahead`/`identical` → weiter; `behind`/`diverged`/404 → nichts anwenden, „Ablage steht hinter dem Gesehenen“ (1.11), später neu |
| Commit | `GET …/git/commits/{sha}` | `tree.sha`, `message`, `committer.date` |
| Baum | `GET …/git/trees/{tree}?recursive=1` | `tree[]`; bei `truncated: true` → Wurzelbaum ohne `recursive`, dann je Unterordner `GET git/trees/{sha}` (dieselbe Funktion für die Kontrolle) |
| eine Datei | `GET …/git/blobs/{sha}` mit `Accept: application/vnd.github.raw+json` | rohe Bytes (auch alte Fassungen: gemeinsamer Stand fürs Zusammenführen und Ergänzen) |
| alles holen (ab 100 Dateien) | `GET …/tarball/{commit}` → 302; `Location` prüfen (https, Rechner endet auf `.github.com`/`.githubusercontent.com`), **ohne** `Authorization` abrufen; Fehler nur als feste Sätze (`without_url`), nie mit der Adresse | `tar.gz`, auf die Platte gestreamt; **nur benötigte** Dateien nach `eingang/` |
| leere Ablage eröffnen | `PUT …/contents/README.md` | Antwort: `commit.sha`, `commit.tree.sha` = Kopf und `base_tree` des ersten Pakets (kein zweites Lesen) |
| Baum anlegen | `POST …/git/trees` `{ base_tree, tree: [ { path, mode: "100644", type: "blob", content } \| { …, sha: null } ] }` | `sha` |
| Commit anlegen | `POST …/git/commits` `{ message, tree, parents: [<Kopf>] }` | `sha` |
| **Umschalten** | `PATCH …/git/refs/heads/{zweig}` `{ sha, force: false }` | 200; 422/409 = weitergewandert |

Kein `POST git/blobs`: Eine Datei über der Paketgrenze bekommt ein eigenes Paket mit `content`.
Nachricht eines Commits (nie Inhalt der Welt): `Wayfarer (Windows-PC): 20 geändert, 1 neu, 2
gelöscht`.

### 3.3 Die Schrittfolge eines Laufs

Zwei Arten: **ganz** und **nur hochladen** (Schließen, Fenster verliert den Fokus). Es läuft
höchstens ein Lauf; weitere Auslöser merken sich „danach noch einmal“.

| # | Schritt | Wer | Bei Abbruch hier |
|---|---|---|---|
| 0 | Voraussetzungen: Verbindung da, Ort stimmt (nicht `moved`), Schlüssel lesbar (je Programmstart einmal gelesen, Verweigerung wird nicht von selbst wiederholt). | TS + Rust | – |
| 1 | `flushEdits()`, `await db.flush()`. Wartet danach noch etwas → still enden, in 30 s neu. | TS | nichts geschehen |
| 2 | `db.changeMark()` und `db.diskSnapshot()` nehmen. | TS | nichts geschehen |
| 3 | `sync_scan`: (a) liegt ein Merkzettel → abschließen wie `sync_recover`, nur ohne zu schreiben (3.7); (b) lokale Liste mit Kennungen; (c) Kopf; weicht er von `seen.commit` ab: `compare`, Commit, Baum, Marke, `seen` fortschreiben; (d) `stand.json`. | Rust | nichts geschehen |
| 4 | `changeMark` geändert → zurück zu 1 (höchstens dreimal, dann in 30 s). Für jeden Pfad im Abbild muss `blobSha(Text)` gleich der Kennung aus Rust sein, sonst ebenso zurück. | TS | nichts geschehen |
| 5 | Sperren: Ablage fremd/öffentlich/leer trotz Stand → braucht dich. Gleiche Zahl, anderer Fingerabdruck → ruht. Marke höher → Modus „nur holen“ (2.6). Kein gemeinsamer Stand → 3.9, nie von selbst. `olderEdits` und nicht mehr älter → Ergänzen vormerken (2.6 Punkt 5). | TS | nichts geschehen |
| 6 | `planSync` (3.4) → je Pfad ein Schritt; Strittiges, Ausgelassenes → `hold`. Schutz „sehr viel auf einmal“ (3.4). *Nur hochladen:* nur Schritte `push`/`pushDelete`, weiter bei 11. | TS | nichts geschehen |
| 7 | `sync_fetch`: alles Nötige nach `eingang/` (zu holende Fassungen; für Zusammenführen und Ergänzen auch die des gemeinsamen Stands), Kennung geprüft. | Rust | nur `eingang/` gefüllt; wird wiederverwendet |
| 8 | Prüfen und zusammenführen: `checkIncoming` je geholter Datei (unlesbar → `hold`, Karte e); `mergeFile` (3.5) mit den gültigen Entscheidungen (3.6). Was strittig bleibt → `hold`, als Rückfrage veröffentlicht. | TS | nichts geschehen |
| 9 | **Anwenden** – nur wenn es etwas zu holen/zusammenzuführen/löschen gibt **und** `hasOpenDrafts()` falsch ist (sonst überspringen, Punkt „steht an“, neu sobald die Entwürfe frei sind, spätestens in 20 s – Hochladen in 11 geht trotzdem). (a) `sync_apply_begin`: lokale Kennungen gegen `expect` (eine weicht ab → `busy` → zurück zu 1); Beiseitelegen; Zusammengeführtes nach `eingang/`; alles sicher geschrieben; dann Merkzettel. (b) `db.takeRemote(…, Abbild)` – ein Schritt, alles oder nichts; lehnt es ab → `sync_apply_abort`, zurück zu 1. Unmittelbar danach im selben Schritt: nach einer Wahl der Weltzeit `settleTime` (3.6). (c) `await db.flush()`. (d) `sync_apply_end`. | Rust + TS | siehe 3.7 |
| 10 | `sync_mark`: Pfade nachziehen, die hier und dort gleich sind; angewendete Entscheidungen löschen. | Rust | harmlos |
| 11 | **Hochladen:** `await db.flush()`, Marke, `sync_scan({ remote: false })`, Marke unverändert? `planSync` mit dem fortgeschriebenen Stand → nur `push`/`pushDelete`. Gibt es welche und ist nicht „nur holen“: `sync_push` (3.3a). `busy` → zurück zu 1 in 20 s. | TS + Rust | vor dem Umschalten: in der Ablage nichts sichtbar |
| 12 | `sync_mark({ synced })`: `syncedAt`, `eingang/` leeren, Beiseitegelegtes ausdünnen. | Rust | harmlos |

**3.3a `sync_push`** (Rust, eine Folge ohne Rückkehr zur Oberfläche):
1. Jede zu ladende Datei roh lesen und ihre Kennung gegen den Plan prüfen. **Weicht auch nur eine
   ab → Fehlerart `busy`, nichts hochgeladen.**
2. Leere Ablage (`head: null`): `PUT /contents/README.md`; Kopf und Baum aus der Antwort.
3. `POST git/trees` in Paketen (≤ 400 Einträge **und** ≤ 2 MB Anfragetext; eine größere Datei
   allein in einem Paket), `base_tree` = Baum des Kopfs bzw. Ergebnis des vorigen Pakets.
   Löschungen als `sha: null`. Dazu Marke (`wayfarer.json`) und `.gitattributes`, falls nötig.
   Jedes Paket bei `offline`/5xx bis zu dreimal nach 5, 15, 45 s wiederholen (Zwischenbäume tragen
   ihre Kennung nach Inhalt); bei 502/504 vorher halbieren.
4. **Kontrolle** nur beim ersten Hochladen und bei mehr als einem Paket: Baum lesen, jede
   geladene Kennung vergleichen, sonst `server`. Sonst wird `seen.files` aus der alten Liste und
   den geladenen Kennungen fortgeschrieben (eine falsche Annahme zeigt sich beim nächsten echten
   Lesen als „dort geändert“; die Fassung von hier liegt dann beiseite).
5. `POST git/commits` mit `parents: [Kopf aus dem Plan]`.
6. `PATCH` mit `force: false`. 422/409 → `moved`.
7. Erst jetzt `stand.json`: `files[pfad]` = Kennung bzw. entfernt; `seen` = neuer Kopf und Baum.
Zwischen zwei schreibenden Anfragen mindestens eine Sekunde.

### 3.4 Die Dreiwege-Entscheidung je Pfad

G = gemeinsamer Stand, H = hier, D = dort. „–“ = fehlt.

| # | G | H | D | Bedeutung | Was geschieht |
|---|---|---|---|---|---|
| 1 | a | a | a | nichts geändert | nichts |
| 2 | – | a | a | beide gleich neu | G := a |
| 3 | a | b | b | beide gleich geändert | G := b |
| 4 | a | – | – | beide gelöscht | G entfernt |
| 5 | – | a | – | hier neu | **hochladen** |
| 6 | a | b | a | hier geändert | **hochladen** |
| 7 | a | – | a | hier gelöscht | **in der Ablage löschen** |
| 8 | – | – | a | dort neu | **holen** |
| 9 | a | a | b | dort geändert | **holen** (Fassung von hier beiseite) |
| 10 | a | a | – | dort gelöscht | **hier löschen** (beiseite) – außer etwas hier Neues oder Geändertes verweist darauf: dann **Rückfrage** wie 13 („verweist“) |
| 11 | a | b | c | beide geändert | **zusammenführen** (3.5); Widerspruch → Rückfrage |
| 12 | – | a | b | beide neu, verschieden | nur `rev`/`updated` verschieden → höheres `rev`; sonst Rückfrage (ganze Fassung) |
| 13 | a | b | – | dort gelöscht, hier geändert | Rückfrage, Vorgabe „Behalten“ |
| 14 | a | – | b | hier gelöscht, dort geändert | Rückfrage, Vorgabe „Zurückholen“ |

Regeln darüber:
- **Ausgelassen/strittig** (2.7): `hold`, gleich welche Zeile.
- **`campaign.json` / `state.json`** werden nie gelöscht (7, 10, 13, 14 → „etwas anderes“).
- **„Verweist“ (Zeile 10):** Der Pfad des Gelöschten nennt seine Kennung; findet sich
  `"<kennung>"` im Text einer Datei der Zeilen 5, 6, 11 oder 13 (aus dem Abbild), wird gefragt.
  Reine Textsuche über die wenigen Dateien des Laufs, ohne Kenntnis der Schemata.
- **Sehr viel auf einmal:** mehr als **20** Zeilen 7, mehr als **20** Zeilen 10 oder mehr als
  **100** Zeilen 6 → **eine** Rückfrage je Gruppe (1.8 d), statt still auszuführen. Bis zur
  Antwort sind genau diese Pfade `hold`; der Rest läuft. Die Antwort gilt für genau diese Menge
  (Prüfsumme der sortierten Pfadliste); kommt etwas dazu, wird neu gefragt.
- **Modus „nur holen“** (älteres Programm): nur 8, 9, 10 (sowie 2, 3, 4); alles andere `hold`
  ohne Rückfrage.
- **Ohne gemeinsamen Stand** gilt die Tabelle nicht, sondern 3.9.

Reihenfolge der Prüfung: erst H = D (1–4), dann H = G, dann D = G, dann der Rest. So bereinigt
sich ein abgebrochener Lauf beim nächsten Mal von selbst.

### 3.5 Zusammenführen

`mergeJson(base, local, remote, rules, choose?)` auf geparstem JSON:

1. Gleichheit immer ohne `rev` und `updated` (oberste Ebene).
2. **Objekt:** Schlüssel für Schlüssel; nur eine Seite geändert → diese; beide gleich → fertig;
   beide verschieden → hineinsteigen, wenn beide Objekte bzw. Listen mit Kennungen sind, sonst
   **Widerspruch**.
3. **Liste aus Objekten mit eindeutiger Zeichenkette `id`** (in allen drei Fassungen): je `id`.
   Hinzugefügtes kommt dazu; Entferntes geht, wenn die andere Seite es nicht geändert hat, sonst
   Widerspruch. Reihenfolge: die der Seite, die sie geändert hat; beide verschieden →
   Widerspruch für die Liste.
4. **Alles andere** als Ganzes.
5. **Regeln** (`rules`) nur für `state.json`/`campaign.json` (2.4).
6. **Ergebnis:** `rev = max + 1`, `updated = jetzt`; der zusammengeführte Wert wird mit dem
   Schema **geprüft** (`safeParse`), geschrieben wird **der Wert selbst**
   (`JSON.stringify(wert, null, 1) + '\n'`) – so bleiben Felder, die dieses Programm nicht kennt.
   Besteht er das Schema nicht → Rückfrage über die ganze Fassung.
7. **`choose`** (aus einer Entscheidung): `{ side, at: Feldpfade }` – Widersprüche **an diesen
   Angaben** gehen zur gewählten Seite; ein neuer Widerspruch anderswo bleibt eine Rückfrage.
8. Unbekannte Sammlung oder unlesbares JSON → Rückfrage über die ganze Fassung.

Ohne Rückfrage ist damit: verschiedene Angaben desselben Dokuments, verschiedene Elemente
derselben Liste, Mengen und Auslage in `state.json`.

### 3.6 Rückfragen und Entscheidungen

- Offene Rückfragen werden nicht gespeichert, sondern jeden Lauf neu errechnet.
- Eine **Entscheidung** speichert `sync_mark` als `decided[pfad] = { choice, remote, fields }`:
  die Kennung der Fassung **dort**, für die sie gilt, und die strittigen Angaben. Sie gilt,
  solange die Fassung dort dieselbe ist – auch wenn hier inzwischen weitergearbeitet wurde (am
  Tisch ändert sich `state.json` laufend). Ändert sich die Fassung dort, verfällt sie. Weil der
  Dialog erst nach einem frischen Lauf öffnet und der Lauf gleich nach „Anwenden“ startet, ist das
  Fenster dazwischen Sekunden lang; was hier in genau dieser Angabe danach noch geändert und
  durch „vom MacBook nehmen“ ersetzt wird, liegt beiseite.
- Wirkung je Art:
  - *Angaben (Zeile 11):* `mergeFile(…, choose)` → anwenden (G := Kennung dort) → hochladen.
    Beiseite: Fassung von hier; bei „hier behalten“ auch die von dort (`dort/`).
  - *Ganze Fassung (12, e):* „hier“ → Fassung dort nach `dort/`, G := dort (→ hochladen).
    „dort“ → holen.
  - *Dort gelöscht (13, „verweist“):* „Behalten“ → G := – (→ „hier neu“ → hochladen). „Auch hier
    löschen“ → hier löschen (beiseite).
  - *Hier gelöscht (14):* „Zurückholen“ → holen. „Gelöscht lassen“ → Fassung dort nach `dort/`,
    G := dort (→ in der Ablage löschen).
  - *Sehr viel:* „Stimmt“ → ausführen. „Stimmt nicht“ → für diese Pfade G leeren: hier Fehlendes
    wird „dort neu“ (holen), dort Fehlendes „hier neu“ (hochladen), hier Geändertes wird mit der
    Fassung dort ersetzt (holen, beiseite).
  - *Weltzeit (1.8 b):* die gewählte Seite liefert `now` und `previousNow`. Liegt die andere
    Weltzeit später, ruft der Ablauf im selben Schritt wie `takeRemote` **`settleTime(db, gewählt,
    andere)`** (`data/actions.ts`): öffnet wieder, was zwischen den beiden Zeiten eingetreten war
    – Termine, Timer, Schritte von Uhren, Blockaden, samt deren selbst erzeugten Chronikzeilen –
    mit demselben Kern wie `undoTimeAdvance` (gemeinsame Hilfe `reopenBetween`); und legt
    doppelte selbst erzeugte Zeilen zusammen (gleicher Termin + Zeit, gleiche Uhr + Schritt; es
    bleibt die mit der kleineren Kennung). Was der Spielleiter selbst festgehalten hat, bleibt.
    Das Ergebnis ist eine gewöhnliche Änderung und wird im selben Lauf hochgeladen.

### 3.7 Abbruch mittendrin

| Abbruch … | Zustand danach | Was das nächste Öffnen / der nächste Lauf tut |
|---|---|---|
| vor oder während Schritt 7 | Ordner unverändert; `eingang/` teils gefüllt | Lauf beginnt neu; Geholtes wird wiederverwendet |
| in 9 a, vor dem Merkzettel | Ordner unverändert; angefangener `beiseite/<nr>/` | harmlos; wird ausgedünnt |
| in 9 b/c: Merkzettel liegt, ein Teil geschrieben | **halb**, aber Merkzettel + `eingang/` + `beiseite/` sind sicher geschrieben | **`openCampaign` → `sync_recover` vor dem Öffnen** (ohne Netz): je Eintrag Kennung der Eingangsdatei nachrechnen (stimmt nicht → Eintrag verwerfen, lokale Datei nicht anfassen); steht schon die neue Fassung → gut; steht noch die erwartete alte → schreiben bzw. löschen; etwas Drittes → nicht anfassen. Dann gemeinsamen Stand für Erledigtes, Merkzettel weg. |
| nach 9 c, vor 9 d | alles geschrieben, Stand alt | wie oben; im laufenden Programm schließt Schritt 3 a ab (schreibt nichts, trägt nur nach) |
| Speichern scheitert in 9 c | Merkzettel liegt; die Datenbank versucht es alle 5 s | Lauf endet ohne 9 d; ein späterer schließt in 3 a ab |
| in 11 vor dem Umschalten | in der Ablage nichts sichtbar | Lauf beginnt neu |
| nach dem Umschalten, vor `stand.json` | Ablage neu, Stand alt | nächster Lauf: H = D → nur nachziehen |
| erstes Holen, vor dem Merkzettel | Ordner leer; `eingang/` teils gefüllt | „In diesen Ordner holen“ nutzt `eingang/` |
| erstes Holen, Merkzettel liegt | Ordner teils gefüllt, `campaign.json` evtl. fehlt | Startbildschirm zeigt nur „Holen fortsetzen“; `openCampaign` → `sync_recover` bringt es zu Ende; fehlt eine Eingangsdatei → mit Netz einzeln nachholen, dann weiter |
| „Ablage gilt“, nach dem Merkzettel | Programm lädt neu | `openCampaign` → `sync_recover` |

Rust schreibt Dateien des Spielstands nur in `sync_recover`, und das läuft nur in
`openCampaign`, bevor es eine Datenbank gibt. Schlägt `sync_recover` fehl und liegt danach noch
ein Merkzettel, öffnet `openCampaign` **nicht** still den halben Stand, sondern zeigt auf dem
Startbildschirm: „Ein Abgleich wurde unterbrochen. „Fortsetzen“ bringt ihn zu Ende.“ (mit Netz
werden fehlende Eingangsdateien geholt).

### 3.8 Wenn der Zweig weitergewandert ist

`PATCH` antwortet 422/409 (`moved`): Nichts ist überschrieben. Der Lauf beginnt von vorn
(höchstens dreimal, dann in einer Minute). `force` ist nie `true`.

### 3.9 Der erste Abgleich (kein gemeinsamer Stand)

Ohne gemeinsamen Stand tut der Ablauf **nichts von selbst** (Zeichen „braucht dich“, Frage 1.9),
außer bei den beiden eindeutigen Lagen, die der Spielleiter ausdrücklich auslöst:

| Lage | Auslöser | Was geschieht |
|---|---|---|
| Ordner voll, Ablage leer oder nur README | „Spielstand hochladen“ (Schritt 5) | `sync_push` mit allem als „neu“ (Pakete, Fortschritt), Marke, `.gitattributes`. Danach `sync_link` (mit `root`) – erst jetzt ist eingerichtet. |
| Ordner leer, Ablage voll (Startbildschirm) | „In diesen Ordner holen“ | `sync_scan` (Ablage), `sync_fetch` aller Dateien (Archiv) nach `eingang/`, `sync_apply_begin({ kind: 'adopt', link, baseAll })` (alle `expect: null`), dann `openCampaign` → `sync_recover` legt alles ab und schreibt zuletzt `stand.json` und `verbindung.json`. Kein eigener Schreibweg. |
| beide voll, gleich | Schritt 5 / Lauf | `sync_mark` setzt `files` = alles; `sync_link`. |
| beide voll, verschieden | 1.9 | **„Dieser Rechner gilt“:** die dort abweichenden Fassungen holen und nach `beiseite/<nr>/dort/` legen (`reason: erster-abgleich`); `files` = das Gleiche; `sync_push` (alles Abweichende hoch, nur dort Vorhandenes löschen); `sync_link`. **„Ablage gilt“:** `flushEdits()`, `await db.flush()`, die abweichenden Fassungen nach `eingang/` holen, `db.close()` (danach lehnt die Datenbank jedes Schreiben ab), `sync_apply_begin({ kind: 'remoteWins', link, baseAll })` (lokal Abweichendes beiseite, nur hier Vorhandenes löschen), `window.location.reload()`; beim Start bringt `sync_recover` es zu Ende. |

Der Startbildschirm-Weg verlangt einen **wirklich leeren** Ordner (geduldet: `.DS_Store`,
`Thumbs.db`, `desktop.ini` und ein `.abgleich/` ohne Verbindung mit Resten eines früheren
Versuchs).

### 3.10 Auslöser und Takt

| Auslöser | Art | Bemerkung |
|---|---|---|
| Öffnen der Kampagne | ganz | im Hintergrund nach `openCampaign`; der Start wartet nie aufs Netz |
| Fenster bekommt Fokus, wird sichtbar, Rechner wacht auf (`focus`, `visibilitychange`, Zeitsprung eines 30-s-Takts > 2 min) | ganz | nur, wenn der letzte Blick in die Ablage älter als 60 s ist |
| nach Änderungen | ganz | 30 s nach dem letzten „Gespeichert“; bei Dauerarbeit spätestens 5 Minuten nach der ersten |
| Fenster verliert Fokus oder wird verborgen, hier steht etwas an | nur hochladen | frühestens 20 s nach dem letzten Lauf |
| Session beendet (`state.sessionId` gesetzt → `null`) | ganz | sofort |
| alle 10 Minuten | ganz | eine Anfrage, wenn nichts Neues |
| Knopf, Klick aufs Zeichen, Dialog öffnen, nach „Anwenden“ | ganz | – |
| Entwürfe frei (`subscribeDrafts`) und Anwenden steht aus | ganz | – |
| Schließen | nur hochladen | höchstens 12 s (1.6, 4.8) |
| kein Netz | – | nach 1, 2, 5, dann alle 10 Minuten; sofort bei `online` |
| Pause von GitHub | – | zur genannten Zeit, mindestens 60 s, bei Wiederholung länger |

Ein Lauf = höchstens ein Commit. Was sich geändert hat, ergibt immer der Vergleich der Kennungen,
nie eine Liste von Schreibereignissen.

### 3.11 Grenzen der Schnittstelle

- Anfragen nacheinander; zwischen schreibenden ≥ 1 s. Üblicher Lauf: 1 Anfrage (nichts Neues),
  5 (nur hochladen), 3 + Zahl der Dateien (holen, bis 100; darüber Archiv). Erstes Hochladen:
  10–40 Pakete, einige Minuten – unter 80 schreibenden Anfragen je Minute und 500 je Stunde.
- `retry-after` bzw. `x-ratelimit-reset` beachten; 403/429 mit „rate limit“ in der Meldung →
  `limit` (≥ 60 s); 401 nie wiederholen.
- Obergrenzen beim Lesen: Baum 16 MB je Antwort, Datei 16 MiB, Archiv 512 MB entpackt.
- Pfade aus der Ablage sind fremde Eingaben: nur Pfade nach 2.1, nur durch `store::resolve`.

### 3.12 Ganzer Stand eingespielt

„Sicherung einspielen“ (`BackupSection`), „Spielstand der alten Version übernehmen“
(`LegacySection`) und „Neu beginnen“ (`CampaignSection:214`) rufen **vor** `db.replaceAll`
`await syncBeforeRestore()` auf (`features/abgleich`; ohne Verbindung tut es nichts):
`sync_mark({ dropBase: true })` setzt `files: null`, `restored: true` (die alte Fassung bleibt als
`stand.vorher.json`, wird aber bei lesbarer `stand.json` nicht genommen). Danach gibt es keinen
gemeinsamen Stand mehr – der nächste Lauf lädt nichts still hoch, sondern stellt die Frage 1.9
(Titel „Du hast hier einen ganzen Stand eingespielt“). Beiseitegelegtes daraus: `reason:
eingespielt`, nie von selbst gelöscht.
Die Übernahme aus LegendKeeper (`applyLkImport`, `undoLkImport`) baut auf dem heutigen Stand auf
und ruft es **nicht**; sie fällt höchstens unter „sehr viel auf einmal“.

---

## 4. Bausteine und Vertrag der Befehle

### 4.1 Wer rechnet was

| Aufgabe | Wo |
|---|---|
| Muster, Plan, Schutz „sehr viel“, Vergleich ohne gemeinsamen Stand, `blobSha`, Ordner-Prüfung | `src/domain/sync.ts` (rein) |
| Zusammenführen, Regeln, `checkIncoming`, `fillStripped` | `src/domain/syncMerge.ts` (rein) |
| `DATA_VERSION`, `DATA_SHAPE` + Test | `src/domain/schema.ts`, `__tests__/dataVersion.test.ts` |
| `settleTime`, `reopenBetween` (Kern aus `undoTimeAdvance`) | `src/data/actions.ts` |
| `takeRemote`, `changeMark`, `diskSnapshot`, Lücke in `reload`, `close` sperrt | `src/data/db.ts` |
| Kampagne öffnen (Wiederaufnahme, dann öffnen) | `src/data/openCampaign.ts` |
| Register offener Entwürfe | `src/ui/drafts.ts` |
| Ablauf, Auslöser, Zustand | `src/features/abgleich/engine.ts`, `state.ts`, `port.ts` |
| Texte (Zeichen, Störungen, Karten, Feldnamen) | `src/features/abgleich/model.ts` (Abschnitt B) |
| Netz, Schlüsselbund, Dateien, Kennungen, Archiv, `.abgleich/`, Hochladen, Wiederaufnahme | `src-tauri/src/sync/*`, `keys.rs` |
| Schließen mit Abgleich | `src-tauri/src/window.rs`, `platform.ts` |

### 4.2 Reine Fachlogik (TypeScript)

`src/domain/sync.ts`
```ts
export type Sha = string;
export const isSyncedPath: (path: string) => boolean;
export const NEVER_DELETED: readonly ['campaign.json', 'state.json'];
export function blobSha(text: string): Promise<Sha>;     // WebCrypto SHA-1 über UTF-8-Bytes
/** Liegen im Ordner schon Teile eines Spielstands? (Startbildschirm: „Neu beginnen“ verweigern) */
export function hasCampaignFiles(paths: readonly string[]): boolean;

export interface SyncLists {
  base: ReadonlyMap<string, Sha> | null;
  local: ReadonlyMap<string, Sha>;
  remote: ReadonlyMap<string, Sha>;
  hold: ReadonlySet<string>;                         // ausgelassen (2.7)
  localTexts: ReadonlyMap<string, string>;           // Abbild – für „verweist“
  older: boolean;                                    // Modus „nur holen“
}
export type SyncStep =
  | { do: 'settle'; path: string; sha: Sha | null }  // 2–4
  | { do: 'push'; path: string }                     // 5, 6
  | { do: 'pushDelete'; path: string }               // 7
  | { do: 'pull'; path: string }                     // 8, 9
  | { do: 'pullDelete'; path: string }               // 10
  | { do: 'merge'; path: string }                    // 11, 12
  | { do: 'clash'; path: string; kind: 'deletedThere' | 'deletedHere' | 'referenced'; by?: string }
  | { do: 'hold'; path: string; why: 'frozen' | 'older' | 'mass' };
export interface MassGroup { kind: 'deleteHere' | 'deleteThere' | 'changeHere'; paths: string[]; key: string }
export interface SyncPlan { steps: SyncStep[]; mass: MassGroup[]; broken: string | null }
export function planSync(lists: SyncLists, massOk: ReadonlySet<string>): SyncPlan;  // wirft ohne base
export function compareWithoutBase(local: ReadonlyMap<string, Sha>, remote: ReadonlyMap<string, Sha>):
  { same: string[]; onlyLocal: string[]; onlyRemote: string[]; different: string[] };
export interface ChangeCounts { changed: number; added: number; removed: number }
export function countChanges(steps: readonly SyncStep[], base: ReadonlyMap<string, Sha>):
  { up: ChangeCounts; down: ChangeCounts };
```

`src/domain/syncMerge.ts`
```ts
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface MergeRules {
  sets?: string[]; newerWins?: string[]; whole?: string[];
  groups?: { name: string; fields: string[] }[];     // state.json: { name: 'time', fields: ['now', 'previousNow'] }
}
export const STATE_RULES: MergeRules;
export const CAMPAIGN_RULES: MergeRules;
export interface FieldClash { at: string[]; group?: string; local: Json | undefined; remote: Json | undefined }
export interface Choose { side: 'local' | 'remote'; at: string[][] }
export function mergeJson(base: Json | undefined, local: Json, remote: Json, rules?: MergeRules,
                          choose?: Choose, now?: string): { value: Json; clashes: FieldClash[] };
export function sameIgnoringStamps(a: Json, b: Json): boolean;
export type FileMerge =
  | { kind: 'merged'; content: string }
  | { kind: 'take'; side: 'local' | 'remote' }
  | { kind: 'clash'; fields: FieldClash[] }
  | { kind: 'whole'; why: 'noBase' | 'unknown' | 'invalid' };
export function mergeFile(path: string, base: string | null, local: string, remote: string,
                          choose?: Choose, now?: string): FileMerge;
export function checkIncoming(path: string, content: string): { ok: true } | { ok: false; why: string };
/** Ergänzt Schlüssel, die in `base` stehen und in `local` fehlen (Objekte, Listenelemente gleicher id). */
export function fillStripped(base: Json, local: Json): Json;
```

`src/domain/schema.ts`: `DATA_VERSION`, `DATA_SHAPE`.

`src/data/actions.ts`:
```ts
/** Nach der Wahl der Weltzeit: öffnet, was zwischen `chosen` und `other` eingetreten war; legt Doppeltes zusammen. */
export function settleTime(db: CampaignDb, chosen: WorldTime, other: WorldTime):
  { reopened: { events: number; steps: number; timers: number }; merged: number };
```
(`undoTimeAdvance` ruft danach dieselbe Hilfe `reopenBetween(db, back, upto)`; sein Verhalten
bleibt gleich – bestehende Tests sichern das.)

### 4.3 Datenbank (`src/data/db.ts`), Öffnen, Entwürfe

```ts
changeMark(): number;                                    // zählt jede Änderung im Speicher
diskSnapshot(): ReadonlyMap<string, string>;             // Pfad → zuletzt geschriebener Text
export interface RemoteFile { path: string; content: string | null }
export interface TakeResult { ok: boolean; busy: string[]; invalid: string[] }
takeRemote(files: readonly RemoteFile[], disk: ReadonlyMap<string, string>): TakeResult;
```
`takeRemote` in **einem** synchronen Schritt: `busy` = Pfade mit `pending.has` oder
`lastWritten ≠ Abbild`; `invalid` = `checkIncoming` scheitert, Dateiname ≠ Kennung, Löschen von
`campaign.json`/`state.json`. Ist eins nicht leer → nichts geändert. Sonst je Datei
`applyExternal` und `pending.set(path, content)` mit dem wörtlichen Text, dann einmal
`setStatus('saving')`, `notify()`, Zeitgeber wie `enqueue`, `changeMark` + 1. Jede spätere Änderung
baut auf der übernommenen Fassung auf.

Drei kleine Änderungen am Bestand:
- **`reload`** (Lücke `db.ts:334-339`): vor dem `await` `const before = this.lastWritten.get(path)`;
  danach überspringen, wenn `this.pending.has(path)` oder `this.lastWritten.get(path) !== before`.
  Ein Nachlesen, das während eines Schreibens unterwegs war, setzt den Speicher so nie auf die
  alte Fassung zurück.
- **`close()`** setzt `closed = true`; danach werfen `put`/`remove`/`setState`/`setCampaign`/
  `replaceAll`/`takeRemote` („Die Kampagne wird gerade neu geladen.“) und `flush` schreibt nichts
  mehr.
- `changeMark` zählt in `enqueue`, `replaceAll`, `takeRemote` und in `reload`, wenn es etwas
  übernommen hat.

`src/data/openCampaign.ts`:
```ts
/** Der einzige Weg, einen Kampagnenordner zu öffnen: liegt ein Merkzettel, erst zu Ende bringen. */
export async function openCampaign(dir: string): Promise<CampaignDb>;
export class SyncInterruptedError extends Error {}       // Merkzettel liegt noch → Startbildschirm „Fortsetzen“
```
Benutzt von `App.boot()`, `Welcome.choose`, nach dem ersten Holen und nach „Ablage gilt“.

`src/ui/drafts.ts`:
```ts
export function holdDraft(key: string): () => void;      // gibt das Freigeben zurück
export function hasOpenDrafts(): boolean;
export function subscribeDrafts(fn: () => void): () => void;
```
Angemeldet wird an vier Stellen: `Written` (solange `text !== value`), `PageEditor` (solange
`pending`), `Dialog` in `ui/components.tsx` (solange offen) und `CreatureEditor` (solange der
Entwurf vom Gespeicherten abweicht). Formulare in Dialogen sind damit alle abgedeckt.

### 4.4 Befehle der Rust-Seite (Vertrag für `src/data/platform.ts`)

Alle `async`, generisch über `R: Runtime`, Dateiarbeit in `blocking(…)`. Fehler sind
`{ kind, message, retryAfter? }` (4.5). `root` ist der Kampagnenordner.

```ts
export interface SyncLink { owner: string; repo: string; branch: string; device: string; root: string }
export interface SyncFile { path: string; sha: string; size: number }
export interface SyncFrozen { path: string; reason: 'case' | 'encoding' | 'size' | 'locked' }
export interface SyncDecision { choice: 'local' | 'remote' | 'ok' | 'back'; remote: string | null; fields: string[][] | null }
export type RemoteKind = 'empty' | 'fresh' | 'wayfarer' | 'foreign';
export interface Marker { datenstand: number; gestalt: string; geraete: Record<string, number> }
```

| Befehl | Eingabe | Ausgabe | Netz | Was er tut |
|---|---|---|---|---|
| `sync_state` | `{ root, dataVersion }` | `{ key: 'yes' \| 'no' \| 'denied'; link: SyncLink \| null; moved: boolean; hasBase: boolean; pending: 'run' \| 'adopt' \| 'remoteWins' \| null; older: boolean; syncedAt; device; pushedAt; aside: number }` | nein | liest `verbindung.json`, `stand.json` (mit Rückfall), vergleicht `root`; setzt `olderEdits`, wenn `dataVersion < maxVersion`; liest den Schlüssel **einmal je Programmstart** (Ergebnis bleibt im Speicher) |
| `sync_set_key` | `{ key }` | – | nein | Form prüfen (`github_pat_`, ≤ 512 sichtbare ASCII; `ghp_…` → `input`), ablegen (Dienst `app.wayfarer.desktop`, Konto `GitHub-Key`), Speicher erneuern |
| `sync_clear_key` | – | – | nein | entfernen |
| `sync_probe` | `{ owner?, repo? }` | `{ login; repos: RepoInfo[]; found: Found \| null }` | ja | `GET /user`; gezielt `/repos/{login}/{SUGGESTED_REPO}` bzw. die Angabe; nur bei 404 `/user/repos`; je Kandidat `kind` (Kopf, Baum, Marke) |
| `sync_link` | `{ root; link: SyncLink \| null; moveTo?: boolean }` | – | nein | `verbindung.json` schreiben; `null` = trennen (Verbindung, Stand, Merkzettel, Eingang weg; `beiseite/` bleibt); `moveTo` = neuen Ort übernehmen (1.15) |
| `sync_recover` | `{ root }` | `{ finished: number; left: { path: string; sha: string }[] }` | nein | Merkzettel zu Ende bringen (3.7); bei `adopt`/`remoteWins` zuletzt `stand.json` und `verbindung.json` |
| `sync_scan` | `{ root; remote: boolean; retryKey?: boolean }` | `SyncScan` | wenn `remote` | 3.3 Schritt 3 |
| `sync_fetch` | `{ root; items: { sha: string; path?: string }[] }` | `{ sha: string; content: string \| null }[]` | ja | nach `eingang/` (schon da und Kennung stimmt → nicht neu); einzeln oder ab 100 über das Archiv (nur Benötigtes entpackt); `null` = kein sauberes UTF-8 |
| `sync_apply_begin` | `{ root; kind: 'run' \| 'adopt' \| 'remoteWins'; head; reason; writes: ApplyWrite[]; deletes: { path; expect }[]; keep: { path; sha }[]; link?: SyncLink; baseAll?: Record<string,string> }` | `{ run: number; busy: string[] }` | nein | `expect` prüfen (`busy` → nichts getan); beiseitelegen; Zusammengeführtes nach `eingang/`; alles sicher schreiben; dann Merkzettel |
| `sync_apply_end` | `{ root; run }` | `{ done: string[]; left: string[] }` | nein | prüft die Platte, trägt den gemeinsamen Stand nach, löscht erledigte Entscheidungen und den Merkzettel; schreibt **keine** Datei des Spielstands |
| `sync_apply_abort` | `{ root; run }` | – | nein | Merkzettel und `beiseite/<run>/` entfernen |
| `sync_push` | `{ root; head: string \| null; tree: string \| null; changes: { path; sha: string \| null }[]; dataVersion; dataShape; counts }` | `{ head; tree }` | ja | 3.3a; `busy` bei Abweichung; `moved`; schreibt nach Erfolg `stand.json`; Fortschritt |
| `sync_mark` | `{ root; base?: { path; sha: string \| null }[]; decided?: Record<string, SyncDecision \| null>; synced?: boolean; dropBase?: boolean; olderEdits?: boolean }` | – | nein | Stand nachziehen, Entscheidungen, `syncedAt`, Aufräumen, 3.12 |
| `sync_aside_list` | `{ root }` | `{ run: number; at; reason; entries: { side; path; sha; title }[] }[]` | nein | jüngstes zuerst |
| `sync_aside_read` | `{ root; run; side; path }` | `string` | nein | Inhalt |
| `sync_aside_put` | `{ root; paths: string[]; reason }` | `{ run: number }` | nein | heutige Fassungen beiseite (vor „Zurückholen“) |
| `sync_aside_drop` | `{ root; run }` | – | nein | „Diese löschen“ |

```ts
type ApplyWrite = { path: string; expect: string | null; base: string | null }
                & ({ sha: string } | { content: string });
interface RepoInfo { owner: string; repo: string; branch: string; isPrivate: boolean; canPush: boolean; archived: boolean; kind: RemoteKind | null }
interface Found { info: RepoInfo; kind: RemoteKind; files: number; marker: Marker | null;
                  device: string | null; pushedAt: string | null; campaign: string | null; state: string | null }
interface SyncScan {
  link: SyncLink; base: Record<string, string> | null; decided: Record<string, SyncDecision>;
  local: SyncFile[]; frozen: SyncFrozen[]; settled: number; maxVersion: number; olderEdits: boolean;
  remote: null | { live: boolean; kind: RemoteKind; isPrivate: boolean; behind: boolean;
                   head: string | null; tree: string | null; files: SyncFile[];
                   marker: Marker | null; device: string | null; pushedAt: string | null };
}
```
Ereignis `sync-progress` `{ phase: 'lesen' | 'holen' | 'hochladen' | 'ablegen'; done; total }`.

`kind`: `empty` = 409 ohne gemeinsamen Stand; `fresh` = nur `README*`, `LICENSE*`, `.gitignore`,
`.gitattributes`; `wayfarer` = Marke mit `format: "wayfarer-abgleich"`; `foreign` = alles andere
→ nie anfassen. `isPrivate` beim ersten Lauf einer Sitzung und danach einmal am Tag.

Neuer Befehl: `build.rs` (`COMMANDS`) **zuerst**, `lib.rs` (`generate_handler!`,
`.manage(Sync::default())`), `capabilities/main.json`, Kopfkommentar und Hülle in `platform.ts`,
Vertragstest in `tests.rs`; erzeugte `permissions/autogenerated/sync_*.toml` einchecken.

### 4.5 Fehlerarten

`#[derive(Serialize)] #[serde(rename_all = "camelCase")] struct SyncError { kind: &'static str, message: String, retry_after: Option<u64> }`.
`platform.ts` bekommt `invokeSync` → `class SyncFailure extends Error { kind; retryAfter }`. Die
Art wird nie am Wortlaut erkannt (außer in Rust beim Einordnen von GitHubs Antworten).

| `kind` | Wann | Folge |
|---|---|---|
| `offline` | keine Verbindung, Zeitüberschreitung, DNS | „Kein Netz“, Wiederholen nach 3.10 |
| `server` | 5xx, 410, unerwartete Antwort, Kontrolle scheitert, 409 beim Kopf mit gemeinsamem Stand, Ablage hinter dem Gesehenen | wie `offline`, eigener Satz |
| `limit` | 403/429 mit `retry-after`, `x-ratelimit-remaining: 0` **oder** „rate limit“ in der Meldung | wartet (≥ 60 s) |
| `key` | 401 | braucht dich; nie wiederholen |
| `nokey` | kein Schlüssel | braucht dich |
| `keychain` | Schlüsselbund verweigert / gesperrt | braucht dich; in dieser Sitzung nur auf Klick neu |
| `denied` | 403 mit `X-Accepted-GitHub-Permissions` oder „Resource not accessible“ | braucht dich |
| `missing` | 404, 301/307/308 | braucht dich |
| `moved` | 422/409 beim `PATCH` | Lauf von vorn (höchstens dreimal) |
| `busy` | lokale Datei weicht vom Plan ab | Lauf von vorn in 20 s |
| `local` | Datenträger voll, gesperrt, Merkzettel passt nicht | braucht dich mit dem Satz |
| `input` | Eingabe abgelehnt (Schlüssel-Form, Ordner nicht leer, Pfad außerhalb des Musters) | Zeile am Formular |

Weder der Schlüssel noch die Kurzzeit-Adresse des Archivs erscheinen je in `message`.

### 4.6 Der Ablauf in TypeScript (`features/abgleich`)

```ts
// port.ts – genau die Befehle aus 4.4
export interface SyncPort { state; setKey; clearKey; probe; link; recover; scan; fetch;
  applyBegin; applyEnd; applyAbort; push; mark; asideList; asideRead; asidePut; asideDrop }
export const desktopPort: SyncPort;

// engine.ts
export interface SyncEngine {
  start(): void; stop(): void;
  syncNow(): Promise<void>;
  lookAgain(): Promise<SyncView>;                    // frischer Lauf, bevor der Dialog öffnet
  decide(choices: Record<string, 'local' | 'remote' | 'ok' | 'back'>): Promise<void>;
  firstSync(choice: 'upload' | 'localWins' | 'remoteWins'): Promise<void>;
  confirmMove(isMine: boolean): Promise<void>;       // 1.15
  beforeClose(): Promise<void>;                      // nur hochladen
  pushSoon(): void;                                  // Fokus verloren / verborgen
}
export function createSyncEngine(db: CampaignDb, port: SyncPort, opts?: {
  now?: () => Date; timers?: Timers; beforeScan?: () => void; drafts?: { has(): boolean; subscribe(fn: () => void): () => void } }): SyncEngine;
export function syncBeforeRestore(): Promise<void>;  // 3.12; ohne Verbindung nichts
```
`beforeScan` ist in der App `flushEdits`, `drafts` das Register aus `ui/drafts.ts` – beides als
Parameter, damit Tests ohne Editor und Oberfläche laufen.

`state.ts` (Muster `createStore` + `useSyncExternalStore` wie `features/legendkeeper/state.ts`):
```ts
export type SyncPhase = 'off' | 'unlinked' | 'synced' | 'running' | 'offline' | 'needsYou';
export interface SyncView {
  phase: SyncPhase; due: boolean;
  needs: null | { why: 'conflicts' | 'version' | 'shape' | 'key' | 'nokey' | 'keychain' | 'denied'
                       | 'missing' | 'public' | 'foreign' | 'emptied' | 'moved' | 'firstSync' | 'local'; detail?: string };
  offline: null | { why: 'net' | 'server' | 'behind' | 'limit'; until?: string };
  link: SyncLink | null; syncedAt: string | null;
  other: { device: string | null; pushedAt: string | null };
  last: null | { up: ChangeCounts; down: ChangeCounts; from: string | null };
  incoming: null | { count: number; from: string | null };      // die ruhige Zeile (1.4)
  conflicts: RawConflict[]; heldSince: string | null; skipped: { path: string; why: string; title: string | null }[];
  progress: null | { phase: string; done: number; total: number };
  closing: boolean; older: boolean; otherNeedsUpdate: string | null; reopened: SettleSummary | null;
}
export const useSync = (): SyncView;
```
`RawConflict` (engine, ohne Text): `{ id; path; kind: 'fields' | 'time' | 'whole' | 'deletedThere'
| 'referenced' | 'deletedHere' | 'mass'; local: { json: Json | null; at: string | null };
remote: { json: Json | null; at: string | null; device: string | null }; fields: FieldClash[];
mass?: MassGroup }`. Daraus macht `model.ts` (Abschnitt B) die Karten mit Namen und Worten.

**Auslöser ohne Schleife:** Der Ablauf hört auf `db.subscribeStatus`; ein Wechsel auf `saved`
außerhalb des eigenen Anwendens gilt als „hier gibt es Neues“. Während Schritt 9 setzt der
Ablauf ein Kennzeichen und übergeht diese Wechsel – dass nichts mehr hochzuladen ist, zeigt
ohnehin Schritt 11.

**Einhängen** (`src/App.tsx`): `boot()` und `Welcome.choose` öffnen nur noch über
`openCampaign`; nach `ready` `createSyncEngine(db, desktopPort, { beforeScan: flushEdits, drafts })`,
`engine.start()`, `onAppClosingAfterSave(() => engine.beforeClose())`, `blur`/`visibilitychange`
→ `pushSoon`/Lauf; beim Aufräumen `engine.stop()`. In der Vorschau entsteht kein Ablauf.

### 4.7 Ordnerwache und Abgleich

| Wer schreibt wohin | Ordnerwache | Datenbank | Abgleich |
|---|---|---|---|
| Rust in `.abgleich/**` | meldet nichts (versteckt); bei einem Überlauf (`need_rescan`) meldet sie **alle** Dateien – dann liest `reload` alles nach (langsam, mit der neuen Prüfung in `reload` folgenlos) | – | – |
| Datenbank schreibt Übernommenes | meldet die Pfade | `reload`: Inhalt = `lastWritten` → nichts | Statuswechsel übergangen |
| Datenbank schreibt eigene Änderungen | meldet die Pfade | nichts | → 30 s → Lauf |
| `sync_recover` | es gibt noch keine Wache | es gibt noch keine Datenbank | – |

Damit ein Überlauf selten bleibt, entpackt `sync_fetch` aus dem Archiv nur die benötigten
Dateien.

### 4.8 Schließen (`platform.ts`, `window.rs`)

`platform.ts`: zweite Liste neben `closingHandlers`, `onAppClosingAfterSave(handler)`,
`CLOSE_SYNC_MS = 12_000`. Im Hörer von „close-requested“: `saving` → speichern → bei Erfolg und
vorhandenen Handlern `app_close({ state: 'syncing' })` → `settleAfterSave` (Wettlauf mit der Frist,
nur für die Tafel) → `app_close({ state: 'saved' })`.

`window.rs`: `CloseAnswer::Syncing`, `ClosePhase::Syncing`. Beim Übergang nach `Syncing` startet
ein Faden mit Nummer (wie `ANSWER_GRACE`): nach 12 s `(Syncing, Nummer)` → `CloseNow` – die Frist
hängt nicht an Zeitgebern der Webansicht (die in einem verborgenen Fenster gedrosselt werden).
`on_answer`: `(Requested | Saving, Syncing) → (Syncing, Nothing)`; `(Syncing, Saved) → (Open,
CloseNow)`; `(Syncing, Unsaved) → (Asking, AskHuman(Unsaved))`. `on_close_request` in `Syncing` →
`CloseNow` (zweiter Klick schließt sofort; keine neue Frage).

### 4.9 Prüfen ohne GitHub

**TypeScript** (`src/features/abgleich/__tests__/fake.ts`): `FakeRepo` (Ablage im Speicher;
Kennungen wie Git über `node:crypto`, Länge über `Buffer.byteLength`; Stellschrauben
`beforeSwitch`, `failNext(kind)`, `private`, `marker`, `rewindHead` für „hinter dem Gesehenen“).
`MemoryPort implements SyncPort` auf einem `MemoryStore` mit `.abgleich` in Feldern,
`crashAfter(step)`, `recover()`. `machine(repo, seed?)` = `MemoryStore` + `CampaignDb` +
`MemoryPort` + Ablauf mit falschen Zeitgebern und Entwurfsregister; zwei Rechner = zweimal
`machine`. Welt aus `data/__fixtures__/demoWorld.ts`.

**Naht TypeScript ↔ Rust:** JSON-Vorlagen für jede Ein- und Ausgabe der Befehle in
`src-tauri/src/sync/contract/*.json`. Vitest liest sie und prüft sie gegen die Typen aus
`port.ts` (und füttert `MemoryPort` damit); `tests.rs` ruft die Befehle ohne Netz
(`sync_state`, `sync_link`, `sync_recover`, `sync_scan` mit `remote: false`,
`sync_apply_begin/end/abort`, `sync_mark`, `sync_aside_*`) **über `invoke`** mit denselben Vorlagen
und vergleicht die Antworten. Für die Netz-Befehle zwei Test-Nähte: `KeyStore` mit vorbelegtem
Schlüssel unter `#[cfg(test)]` und eine in Tests setzbare Basisadresse in `Sync` – dann fahren
zwei `TempDir` gegen den Gegenpart durch `invoke`.

**Rust-Gegenpart** (`sync/testserver.rs`, `#[cfg(test)]`): nach dem Muster
`legendkeeper.rs:434-463` + `ai.rs:336-363`; dieselbe Ablage im Speicher; alle Anfragen aus 3.2
samt Archiv, 302, `compare`, `truncated` mit Lesen je Ordner; Stellschrauben für Status je
Anfrage (401, 403 mit und ohne Kopfzeilen, „rate limit“ ohne Kopfzeilen, 404, 301, 409 leer und
409 vorübergehend, 422, 502), Verbindung nach der n-ten Anfrage abbrechen, „vor dem `PATCH`
schiebt ein anderer ein“, Protokoll aller Anfragen.

**Probe gegen GitHub** (`#[ignore]`, `cargo test probe -- --ignored`): liest Schlüssel und
Ablage nur aus Umgebungsvariablen (setzt der Spielleiter selbst), fährt gegen eine
**Wegwerf-Ablage**: leer → 409; `PUT` README (Antwort nutzen); Baum mit `content` (Umlaute,
`\r\n`, ohne Zeilenende am Schluss, 400 Einträge / 2 MB mit Zeitmessung); letzte Datei eines
Ordners löschen; Kontrolle; Commit; `PATCH`; zweiter `PATCH` ohne Vorspulen (Code?); `compare`;
Archiv (Rechner der Umleitung, Oberordner); `/repos/{login}/{name}` und `/user/repos` mit dem
beschränkten Schlüssel. Einmal lokal vor dem echten Einsatz, nie bei den Prüfungen auf GitHub.
Was abweicht, wird in `classify` und im Gegenpart nachgezogen.

### 4.10 Rust-Module

- `src-tauri/src/keys.rs` (neu): `KeyStore` mit Kontonamen als Parameter; nur der Abgleich
  benutzt ihn (`ai.rs`, `legendkeeper.rs` bleiben, Aufräumliste).
- `sync/mod.rs`: `pub struct Sync { keys, key_cache: Mutex<KeyState>, api: Url, client,
  plain_client, privacy }`, `SyncError`, Befehle.
- `sync/github.rs`: je Anfrage eine Funktion; `classify` (4.5); Baum lesen mit Rückfall je
  Ordner; Pause zwischen Schreibanfragen (`spawn_blocking` + `thread::sleep`).
- `sync/local.rs`: `is_synced_path`, `blob_sha` (`ring::digest::SHA1_FOR_LEGACY_USE_ONLY`),
  `scan_local` (rohe Bytes; `store::read_patiently` wird `pub(crate)`), `.abgleich`-Dateien
  (`stand.json` mit `stand.vorher.json`, `root`-Vergleich, versteckt unter Windows), Eingang,
  Beiseitelegen mit laufender Nummer, Ausdünnen, `recover` (Kennung jeder Eingangsdatei
  nachrechnen). Alles mit `root: &Path` (testbar mit `TempDir`).
- `sync/archive.rs`: `tar.gz` lesen, Oberordner abschneiden, nur gewöhnliche Dateien, nur Pfade
  nach 2.1, nur angeforderte Kennungen, Größe begrenzen.
- `sync/testserver.rs`, `sync/contract/*.json`: nur Tests.

Anfragen ohne `json`-Feature (`serde_json::to_vec` + `.body`, Antwort stückweise mit Obergrenze,
Muster `ai.rs:201-224`); vor dem Client-Bau `rustls::crypto::ring::default_provider().install_default()`.

---

## 5. Dateien

### 5.1 Neu

| Datei | Inhalt | Abschnitt |
|---|---|---|
| `src/domain/sync.ts`, `syncMerge.ts` | 4.2 | A |
| `src/domain/__tests__/sync.test.ts`, `syncMerge.test.ts`, `dataVersion.test.ts` | Tests | A |
| `src/data/openCampaign.ts`, `__tests__/openCampaign.test.ts` | 4.3 | A |
| `src/data/__tests__/takeRemote.test.ts`, `settleTime.test.ts` | Tests | A |
| `src/ui/drafts.ts`, `__tests__/drafts.test.ts` | Register offener Entwürfe | A |
| `src/features/abgleich/port.ts`, `engine.ts`, `state.ts`, `index.ts` | 4.6 | A |
| `src/features/abgleich/__tests__/fake.ts`, `engine.test.ts`, `contract.test.ts` | Attrappe, zwei Rechner, Vorlagen | A |
| `src-tauri/src/keys.rs`, `sync/mod.rs`, `github.rs`, `local.rs`, `archive.rs`, `testserver.rs`, `sync/contract/*.json` | 4.10 | A |
| `src-tauri/permissions/autogenerated/sync_*.toml` | erzeugt der Bau | A |
| `src/features/abgleich/model.ts`, `__tests__/model.test.ts` | Texte, `FIELD_LABELS`, Karten aus `RawConflict` | B |
| `src/features/abgleich/SyncSection.tsx`, `Setup.tsx`, `ConflictDialog.tsx`, `FirstSyncDialog.tsx`, `AsideList.tsx`, `MoveQuestion.tsx`, `SyncSign.tsx`, `IncomingLine.tsx`, `FetchPanel.tsx`, `abgleich.css` | Oberfläche (`wf-abgleich-`) | B |

### 5.2 Geändert

| Datei | Änderung | Abschnitt |
|---|---|---|
| `src/domain/schema.ts` | `DATA_VERSION`, `DATA_SHAPE` | A |
| `src/data/db.ts` | `takeRemote`, `changeMark`, `diskSnapshot`, Prüfung in `reload`, `close` sperrt; Kopfkommentar | A |
| `src/data/actions.ts` | `settleTime`, `reopenBetween` (aus `undoTimeAdvance` herausgelöst) | A |
| `src/data/platform.ts` | Vertrag, `sync…`-Hüllen, `invokeSync`, `SyncFailure`, `onAppClosingAfterSave`, Stufe `syncing` | A |
| `src/App.tsx` | `openCampaign`; Ablauf starten; Fokus/Sichtbarkeit; Schließen | A |
| `src/shell/Welcome.tsx` | `choose` über `openCampaign` (Rest in B) | A |
| `src/ui/sheet.tsx` (`Written`), `src/ui/components.tsx` (`Dialog`), `features/wiki/PageEditor.tsx`, `features/bestiarium/CreatureEditor.tsx` | je eine Anmeldung bei `holdDraft` | A |
| `einstellungen/BackupSection.tsx`, `LegacySection.tsx`, `CampaignSection.tsx` (Z. 214) | `await syncBeforeRestore()` vor `replaceAll` | A |
| `src-tauri/Cargo.toml`, `Cargo.lock` | `ring`, `flate2` direkt; `tar` neu; `windows-sys` (nur Windows) direkt | A |
| `src-tauri/build.rs`, `capabilities/main.json`, `src/lib.rs` | 17 Befehle, `mod keys; mod sync;`, `.manage(Sync::default())` | A |
| `src-tauri/src/store.rs` | `read_patiently` `pub(crate)`; Fehlertext ohne „Cloud-Laufwerk“ | A |
| `src-tauri/src/window.rs` | Stufe `Syncing` mit eigener Frist (4.8) | A |
| `src-tauri/src/tests.rs` | Vertragstests über `invoke`; neue Namen in `only_the_main_window_may_call_commands` | A |
| `src-tauri/src/config.rs`, `watch.rs`, `lib.rs` | Kommentare ohne „Cloud-Laufwerk“ | A |
| `src/shell/Welcome.tsx` | Wahlkarte, `FetchPanel`, „Holen fortsetzen“, Sperre für „Neu beginnen“/„übernehmen“ bei `hasCampaignFiles` | B |
| `src/shell/AppShell.tsx`, `shell.css` | Zeichen unter „Gespeichert“, ruhige Zeile, Tafel beim Schließen | B |
| `src/features/einstellungen/index.tsx` | Abschnitt „Abgleich“ nach „Kampagne“ in `Boundary`; `NUMERALS` um `'XIII'` | B |
| `einstellungen/CampaignSection.tsx` | „Ablageort“ → „Kampagnenordner“ (Z. 1, 223); Notiz „… folgt“ (Z. 232–236) weg | B |
| `einstellungen/backup.ts` | `COLLECTION_LABEL` und `describe` exportieren | B |
| `einstellungen/MediaSection.tsx` | als Baustein im Abschnitt Abgleich nutzbar (Kopf abschaltbar) | B |
| `einstellungen/ProblemsSection.tsx`, `model.ts`, `BackupSection.tsx` | Texte ohne „Cloud-Laufwerk“ | B |
| `src/data/store.ts` | Kopfkommentar | B |
| `CLAUDE.md`, `docs/WEITERARBEIT.md`, `README.md` | 5.4 | B |

Gemeinsam mit dem Kollegen am „Abend“ berührt: `src/App.tsx`, `src/shell/AppShell.tsx`,
`einstellungen/index.tsx`, `src/domain/schema.ts` (zwei Zeilen), `src/data/actions.ts`,
`CLAUDE.md`, `docs/WEITERARBEIT.md`. Vor dem Bau nachsehen, ob er weiterschreibt.

### 5.3 Neue Crates

| Crate | Wofür | Begründung |
|---|---|---|
| `ring = "0.17"` | SHA-1 der Blob-Kennung | steht schon in `Cargo.lock`; nur direkt eintragen |
| `flate2 = "1"` | Archiv (gzip) | steht schon in `Cargo.lock` |
| `tar = { version = "0.4", default-features = false }` | Archiv lesen (und im Test bauen) | einzig neu; sonst wäre das erste Holen je Datei eine Anfrage |
| `windows-sys` (nur `cfg(windows)`, Merkmal `Win32_Storage_FileSystem`) | `.abgleich` als versteckt markieren | über Tauri schon in `Cargo.lock`; Version an die vorhandene anlehnen |

Nicht nötig: `base64` (die README der leeren Ablage ist eine feste Zeichenkette), `sha1`,
`tokio` direkt, ein Mock-Server-Crate. `Cargo.lock` mit einchecken.

### 5.4 Unterlagen (Abschnitt B)

**`CLAUDE.md`**
- „Aufbau“: Bereich `abgleich` („der eingebaute Abgleich mit einer privaten Ablage bei GitHub:
  Ablauf `engine.ts`, Bote `port.ts`, Zustand `state.ts`; die Rechnung steht in
  `domain/sync.ts` und `domain/syncMerge.ts`“); `src-tauri/`: „… Abgleich (`sync/`),
  Schlüsselbund (`keys.rs`) …“.
- „Daten“: Der Punkt „Mac und Windows teilen sich den Spielstand …“ wird ein Punkt **Abgleich**:
  - abgeglichen wird nur nach Muster (`isSyncedPath`); `.abgleich/` und `media/` nie;
  - eine Kampagne öffnet man nur über `openCampaign` (es bringt einen unterbrochenen Abgleich
    zu Ende);
  - Übernommenes nur über `db.takeRemote`; nie Dateien am Programm vorbei in den Ordner legen;
  - wer den ganzen Stand austauscht (Sicherung, Neuanfang), ruft vorher `syncBeforeRestore()`;
  - ein Feld, Formular oder Dialog, das Eingaben hält, meldet sich bei `holdDraft` an;
  - **wer das Schema ändert, erhöht `DATA_VERSION` und setzt `DATA_SHAPE`** (der Test erzwingt
    es); danach holt der andere Rechner weiter, lädt aber erst nach seinem Aktualisieren hoch;
  - neues Feld in `state.json`/`campaign.json`: Regel in `STATE_RULES`/`CAMPAIGN_RULES` prüfen;
  - ein Widerspruch hält nur seinen Eintrag an; am Tisch nie ein Dialog;
  - in der Oberfläche nie „Repository“ (außer in der Anleitung), „Token“, „Commit“, Dateipfade.
- „Befehle“: `cargo test probe -- --ignored` (nur lokal, nur mit Wegwerf-Ablage).

**`docs/WEITERARBEIT.md`**: Bereich I als gebaut mit Verweis; Reihenfolge ohne I; Bilder: „Der
Abgleich überträgt Bilder bewusst nicht“; „Repository öffentlich“ ist überholt – der Spielstand
hat eine **eigene** private Ablage, nie das Code-Repository (`foreign`); neuer Abschnitt „Abgleich
über GitHub – gebaut“ (Festlegungen kurz, Probe 6.3, was bewusst fehlt); Aufräumliste:
`KeyStore` dreifach, `repairReferences` gezielt, stabile Signatur des Mac-Pakets, Probe-Liste.
Bereich J „Testspielstand: Kopie der Kampagne“: Hinweis, dass eine Kopie nicht abgleicht (1.15).

**`README.md`**: „in Arbeit … immer nur an einem Rechner gleichzeitig“ → kurze Beschreibung.

---

## 6. Prüfplan

### 6.1 Tests in TypeScript (Vitest, ohne Netz)

`sync.test.ts`
1. Jede der 14 Zeilen aus 3.4; „ausgelassen schlägt jede Zeile“.
2. `campaign.json`/`state.json` nie gelöscht (→ `broken`).
3. „Sehr viel“: 21 Löschungen → Gruppe; 20 → keine; 101 Änderungen → Gruppe; Antwort gilt nur
   für dieselbe Pfadmenge.
4. „Verweist“: dort gelöscht, hier neue Chronikzeile mit `"<kennung>"` → `clash referenced`;
   ohne Verweis → `pullDelete`.
5. Modus „nur holen“: nur 2–4 und 8–10, sonst `hold`.
6. Muster: `entities/abc.json`, `entities/Abc-1_x.json` ja; `Entities/a.json`, `a.json`,
   `entities/a.JSON`, `entities/ä.json`, `entities/Aldric (Konfliktkopie 2).json`,
   `entities/sub/a.json`, `media/x.png`, `.abgleich/stand.json`, `wayfarer.json` nein.
7. `blobSha` mit den vier Prüfwerten (3.1).
8. `planSync` wirft ohne gemeinsamen Stand; `compareWithoutBase`; `hasCampaignFiles`.
9. Abgebrochener Lauf: H = D ≠ G → nur nachziehen.

`syncMerge.test.ts`
10. `state.json`: PC verschiebt eine Karte, Mac stellt die Zeit vor → beides, keine Rückfrage.
11. Beide stellen `now` verschieden → ein Widerspruch der Gruppe `time`; mit `choose` kommen
    `now`/`previousNow` von einer Seite.
12. PC stellt Zeit vor, Mac startet nur die Session → kein Widerspruch.
13. `travelBy` auf beiden Seiten verschieden → Rückfrage (nicht „jüngeres `updated`“).
14. Mengen; dieselbe Karte auf beiden Seiten verschoben → jüngeres `updated`.
15. Geschichte: Szene abgehakt hier, Zusammenfassung dort → zusammen.
16. Listen mit `id`: Hinzufügen beidseits; Entfernen gegen Ändern → Widerspruch; Umordnen beidseits
    → Widerspruch.
17. Seitentext beidseits → Widerspruch. Nur `rev`/`updated` → `take`.
18. Unbekanntes Feld auf einer Seite bleibt im Ergebnis (Wert wird geschrieben, nicht die
    geprüfte Fassung).
19. `choose` löst nur die genannten Angaben; ein neuer Widerspruch anderswo bleibt.
20. Ergebnis verletzt das Schema → `whole: 'invalid'`; unbekannte Sammlung → `unknown`; ohne
    Basis → `noBase`. Zweimal zusammenführen ergibt dasselbe.
21. `campaign.json`: Kalender als Ganzes; Zeitalter je Kennung; `tableRules` beidseits →
    Widerspruch.
22. `checkIncoming`: gültig; Schema verletzt; Kennung ≠ Dateiname; unbekannte Sammlung mit
    gültigem JSON → ok.
23. `fillStripped`: fehlender Schlüssel oben, in einem verschachtelten Objekt und in einem
    Listenelement gleicher `id` kommt zurück; ein fehlendes Listenelement nicht; Vorhandenes wird
    nie überschrieben.

`dataVersion.test.ts`: 24. Fingerabdruck = `DATA_SHAPE`.

`takeRemote.test.ts` / Datenbank
25. Wörtlich übernommen (Text, `rev` wie geliefert); wartet etwas → `ok: false`, nichts geändert;
    Platte ≠ Abbild → `busy`; ungültig → `invalid`; Löschen; unbekannte Sammlung geschrieben,
    Speicher bleibt; Wache danach → kein zweites Übernehmen; Änderung danach baut auf der
    übernommenen Fassung auf.
26. `reload`: Lesen unterwegs, währenddessen schreibt `flush` dieselbe Datei → Speicher bleibt
    neu (der Wettlauf aus Einwand 11). Bestand: von außen geändert, während dieselbe Datei
    wartet.
27. Nach `close()` wirft `put`, und `flush` schreibt nichts.

`settleTime.test.ts`
28. Mac 3 Tage vor (2 Termine, 1 Uhrenschritt), PC 1 Stunde; Wahl PC → Termine und Schritt
    wieder offen, ihre selbst erzeugten Zeilen weg, Notizen bleiben. Wahl Mac → nichts geöffnet,
    doppelte Terminzeile zusammengelegt. `undoTimeAdvance` verhält sich wie vorher.

`openCampaign.test.ts`: 29. Merkzettel liegt → erst Wiederaufnahme, dann öffnen; Wiederaufnahme
scheitert mit liegendem Merkzettel → `SyncInterruptedError`, kein Öffnen.

`drafts.test.ts`: 30. halten/freigeben, mehrfach, Benachrichtigung.

`engine.test.ts` – zwei Rechner gegen eine `FakeRepo`
31. **Erster Abgleich:** PC lädt in leere Ablage; Mac holt in leeren Ordner (Merkzettel +
    Wiederaufnahme); gleich; weiterer Lauf = eine Anfrage.
32. Beide ändern verschiedene Dateien → gleich, keine Rückfrage.
33. Dieselbe Datei, verschiedene Angaben → zusammengeführt.
34. **Dieselbe Angabe:** nur dieser Eintrag `hold`, **alles andere** desselben Laufs geholt und
    hochgeladen; Entscheidung „hier“/„dort“; nicht Gewähltes liegt beiseite. Entscheidung bleibt
    gültig, obwohl hier weitergeschrieben wurde; verfällt, wenn sich die Fassung dort ändert.
35. Löschen gegen Ändern, beide Richtungen, beide Antworten; „verweist“.
36. Löschen ohne Gegenänderung wandert hinüber; beiseite.
37. **Weltzeit beidseits** → Karte `time`; Wahl → `settleTime`; Ergebnis im selben Lauf
    hochgeladen; der andere Rechner holt es.
38. **Der andere war schneller** (`moved`) → neu, nichts überschrieben, nie `force`.
39. **Ablage hinter dem Gesehenen** (`rewindHead`) → nichts angewendet, „Kein Netz“-Art.
40. Abbruch nach `tree`/`commit`; nach dem Umschalten vor `stand.json`.
41. Abbruch mitten im Anwenden → `recover()` bringt es zu Ende; **Eingangsdatei verfälscht** →
    Eintrag verworfen, lokale Datei unberührt, nächster Lauf holt neu.
42. **Weitergeschrieben während des Laufs** → `busy`/Marke → nichts angewendet, nichts
    hochgeladen, neuer Versuch.
43. **`sync_push` mit einer abweichenden Datei** → kein Commit (kein halber Handgriff).
44. **Entwurf offen** (`holdDraft`) → nichts angewendet, Hochladen geschieht; nach dem Freigeben
    angewendet; ein veraltetes Formular, danach gespeichert, wird feldweise zusammengeführt.
45. **Kein Netz**, Wiederholen nach Plan.
46. **Älteres Programm:** Marke höher → holt (8–10), lädt nicht hoch, führt nicht zusammen;
    lokale Bearbeitung beschneidet ein neues Feld; nach dem „Aktualisieren“ ergänzt der erste
    Lauf das Feld (`fillStripped`) und lädt hoch – das Feld ist auf beiden Rechnern da.
    Gleiche Zahl, anderer Fingerabdruck → ruht beidseits. Neuere Version hebt die Marke im selben
    Commit; `geraete` wird je Rechner fortgeschrieben.
47. **Sicherung eingespielt** (`syncBeforeRestore` + `replaceAll`) → kein Hochladen, Frage 1.9;
    beide Wahlen.
48. **Sehr viel:** 30 Löschungen hier → nur diese warten; „Stimmt nicht“ holt sie zurück.
49. **Kopie des Ordners** (anderer `root`) → keine Anfrage an die Ablage; „Kopie“ trennt nur die
    Kopie; „mein Ordner“ übernimmt den Ort.
50. **`stand.json` kaputt** → `stand.vorher.json` gilt; beide kaputt → 1.9.
51. Unlesbare Datei vom anderen Rechner → nur sie wartet (Karte e); „Fassung von hier hochladen“.
52. Schließen: nur hochladen, endet nach `CLOSE_SYNC_MS`, meldet nie „ungespeichert“.
53. Auslöser: 30 s Ruhe; 5-Minuten-Deckel; Fokus nach > 60 s; Fokus verloren → nur hochladen;
    eigenes Anwenden löst keinen Lauf aus; Session beendet → sofort.
54. Schlüssel ungültig → braucht dich, kein Wiederholen; Schlüsselbund verweigert → kein
    Wiederholen von selbst, „Noch einmal versuchen“ liest neu.
55. Laufende Nummern: zwei Läufe hintereinander ohne `stand.json` dazwischen → zwei Ordner.

`contract.test.ts`: 56. Jede Vorlage aus `sync/contract/` passt zu den Typen in `port.ts`.

### 6.2 Tests in Rust (`cargo test --locked`, ohne Netz)

`sync/local.rs`: Muster; Blob-Kennung (vier Prüfwerte); BOM → ausgelassen; Groß/Klein →
ausgelassen; Umlaut im Dateinamen → in keiner Liste, nie gelöscht; > 16 MiB → ausgelassen;
`stand.json` mit Rückfall auf `stand.vorher.json`; `root`-Vergleich (Groß/Klein, `\\?\`);
Beiseitelegen mit laufender Nummer und Zusammenstoß; Ausdünnen nach Zahl, Entscheidungen
bleiben; `recover` je Eintrag (schon neu / noch alt / etwas Drittes / Eingangsdatei mit falscher
Kennung); `adopt`/`remoteWins` schreiben Stand und Verbindung erst am Ende; `.abgleich/` nie in
`store::list`; unter Windows versteckt.

`sync/github.rs` + `testserver.rs`: Kopfzeilen; Schlüssel nie in Meldungen, Archiv-Adresse nie in
Meldungen; Einordnung aller Codes aus 4.5 (403 mit/ohne Kopfzeilen, „rate limit“ ohne Kopfzeilen,
409 mit/ohne gemeinsamen Stand, 301); `retry-after`; keine Weiterleitung mit Schlüssel;
`truncated` → Lesen je Ordner, gleiche Liste; `compare` behind/diverged; nie `force: true`;
jeder `POST git/trees` mit `base_tree`; Pakete ≤ 400 / ≤ 2 MB, große Datei allein; Paket-
Wiederholung nach Verbindungsabbruch; `PUT`-Antwort als Basis.

Abläufe mit zwei `TempDir` **über `invoke`**: leere Ablage → hochladen; erstes Hochladen von
1 000 Dateien; Holen in leeren Ordner (Archiv, eine verfälschte Datei einzeln nachgeholt);
Abbruch mitten im Archiv → zweiter Versuch nutzt `eingang/`; Abbruch nach dem Merkzettel →
`sync_recover` vollendet; Holen lehnt einen nicht leeren Ordner ab; `sync_push` mit einer
geänderten Datei → `busy`, kein Commit; Kontrolle entdeckt Abweichung; 422 → `moved`;
`sync_apply_begin` meldet `busy` und tut nichts; `sync_apply_end` trägt nur nach, was auf der
Platte steht; Ablage `foreign` und öffentlich → kein Schreiben.

`window.rs`: Übergänge `Syncing`; Frist nach 12 s ohne Antwort der Oberfläche → `CloseNow`;
zweiter Klick in `Syncing` → `CloseNow`. `tests.rs`: Vertragstests mit den Vorlagen; nur das
Hauptfenster.

Rust-Änderungen gebündelt hochladen (Freiminuten auf drei Systemen).

### 6.3 Was nur der Spielleiter prüfen kann

Zuerst mit einem **Testordner** und einer **Wegwerf-Ablage**:
1. Die Probe aus 4.9 einmal lokal laufen lassen (Schlüssel für die Wegwerf-Ablage selbst in die
   Umgebung setzen); Abweichungen werden nachgezogen.
2. Die Anleitung an GitHubs echter Seite: Beschriftungen, Vorbelegung der beiden Knöpfe,
   „Metadata“, Warnung bei „No expiration“, Passwortabfrage.
3. Schlüssel einfügen → wird genau die Ablage gefunden und groß genannt?
4. Hochladen, Dauer, Fortschritt; im Browser: privat, Dateien da.
5. Zweiter Ordner: „Spielstand vom anderen Rechner holen“; mittendrin abbrechen und fortsetzen.
6. Hin und her, Netz trennen, Widerspruch entscheiden, Beiseitegelegtes zurückholen; den
   Testordner kopieren und die Kopie öffnen (Frage 1.15).
7. Schließen mit und ohne Netz.
8. Danach im Testordner „Abgleich trennen“ **mit** „Schlüssel entfernen“ – sonst bietet die echte
   Einrichtung den Schlüssel der Wegwerf-Ablage an.
9. Echt: Einrichtung am Windows-PC mit dem echten Kampagnenordner (vorher „Sicherung
   herunterladen“), Zahl der Einträge und Dauer notieren.
10. **MacBook** (dort ist Wayfarer nie gelaufen): Paket installieren; Schlüsselbund-Frage beim
    ersten Mal und nach einem neuen Paket?; Holen; Bilder; ein Abend mit und ohne Netz; Deckel
    zu nach dem letzten Eintrag (lag er am PC an?).
11. Mac mit älterem Paket gegen PC mit neuerem Datenstand → Mac holt, lädt nicht hoch, nach dem
    Aktualisieren kommt alles an, nichts fehlt.

---

## 7. Offene Entscheidungen für den Spielleiter

1. **Bilder reisen nicht mit.** Je Rechner einmal „Bilder holen“, vor einer Kündigung von
   LegendKeeper auf beiden. *Empfehlung: so.*
2. **Zugangsschlüssel ohne Ablaufdatum, je Rechner ein eigener.** *Empfehlung: so* (er gilt nur
   für die eine private Ablage; ein ablaufender sperrte dich einmal im Jahr mitten in der
   Vorbereitung aus; einzeln löschbar, wenn ein Rechner verloren geht).
3. **Bei einem Widerspruch wartet nur der strittige Eintrag** (neu gegenüber dem ersten
   Entwurf, der den ganzen Abgleich anhielt). Vorteil: Deine Vorbereitung kommt am Tisch an,
   und ein Abend liegt nie tagelang nur auf einem Rechner. Preis: Bis du entscheidest, kann ein
   Handgriff, der mehrere Einträge betraf, auf dem anderen Rechner halb zu sehen sein (die
   Beute ist vergeben, der Gegenstand gehört noch dem alten Besitzer). *Empfehlung: so.*
4. **Ein älteres Wayfarer holt weiter, lädt aber nicht hoch**, bis es aktualisiert ist; danach
   ergänzt es, was es beim Speichern weggelassen hat. Am Tisch bekommst du also immer die
   Vorbereitung – nur deine Änderungen am Mac warten. *Empfehlung: so – und als Gewohnheit: nach
   einem Bau am PC das Mac-Paket bald einspielen.* Der PC sagt es dir, bis es geschehen ist.
5. **Frühere Fassungen und der Papierkorb reisen mit** (`versions`). *Empfehlung: mitnehmen.*
6. **Beiseitegelegtes:** die letzten 50 gewöhnlichen Läufe; deine Entscheidungen, erste Abgleiche
   und eingespielte Stände bleiben, bis du sie löschst. *Empfehlung: so.*
7. **Name der Ablage**: Vorschlag `spielstand-elaris`. *Empfehlung: so* (verwechselt sich nicht
   mit der Programm-Ablage „Wayfarer“).
8. **Mac-Paket mit einem gleichbleibenden, selbst erzeugten Zertifikat signieren**, damit der
   Schlüsselbund nicht nach jeder Version fragt. *Empfehlung: erst nach Punkt 10 der Probe
   entscheiden;* fragt der Mac nur einmal je Version, reicht der Hinweis in der Anleitung.

---

## 8. Bewusst nicht in der ersten Fassung

- Bilder abgleichen.
- Verweise aufräumen nach dem Holen (`repairReferences` schreibt über `replaceAll` alles neu).
  Der häufigste Fall – dort gelöscht, hier neu verwiesen – wird gefragt (3.4 „verweist“).
- Weitere Doppelte melden (zwei Beziehungen gleicher Richtung, zwei Einträge gleichen Namens, zwei
  offene Abend-Blätter, zwei Sessions gleicher Nummer).
- Text in sich zusammenführen.
- Den lokalen Stand bei einem Widerspruch in einen eigenen Zweig der Ablage retten (unnötig, weil
  nur der strittige Eintrag wartet).
- Ein Anhalten des Abgleichs.
- Bedingte Anfragen (`If-None-Match`), Anmeldung über Gerätecode, GraphQL.
- Den Verlauf der Ablage zeigen oder kürzen.
- Schemata durchlässig machen (statt dessen: älteres Programm lädt nicht hoch, `fillStripped`).
- Die drei Schlüsselbund-Bausteine zusammenlegen.
- Erkennen eines **von Hand** aus einer Ordnerkopie zurückkopierten Stands über `rev` – gefangen
  wird nur, was über 100 Änderungen oder 20 Löschungen geht; die Regel in `CLAUDE.md` sagt: nie
  Dateien am Programm vorbei in den Ordner legen.
- Ein Schlüssel je Ablage statt je Rechner.

---

## 9. Bauabschnitte

### A – Fachlogik, Datenbank, Rust-Seite, Ablauf (ohne Oberfläche lauffähig geprüft)

Ziel: Am Ende von A läuft der ganze Abgleich in Tests – zwei Rechner gegen die TypeScript-Attrappe
und zwei Ordner gegen den Rust-Gegenpart über `invoke`. In der App ist er noch nicht
einschaltbar (keine Einstellungen), aber `openCampaign`, Schließen und die Entwurfs-Anmeldungen
sind schon aktiv.

1. `domain/schema.ts`: `DATA_VERSION`, `DATA_SHAPE` + `dataVersion.test.ts` (24).
2. `domain/sync.ts`, `domain/syncMerge.ts` + Tests 1–23.
3. `data/actions.ts`: `reopenBetween` aus `undoTimeAdvance` herauslösen, `settleTime` + Test 28
   (bestehende Tests zu `undoTimeAdvance` müssen unverändert grün sein).
4. `data/db.ts`: `takeRemote`, `changeMark`, `diskSnapshot`, Prüfung in `reload`, `close` sperrt +
   Tests 25–27.
5. `ui/drafts.ts` + Test 30; Anmeldung in `Written`, `Dialog`, `PageEditor`, `CreatureEditor`
   (je wenige Zeilen, keine sichtbare Änderung).
6. `data/openCampaign.ts` + Test 29; `App.boot` und `Welcome.choose` darauf umstellen.
7. `features/abgleich/port.ts`, `engine.ts`, `state.ts`, `index.ts` (`syncBeforeRestore`),
   Attrappe + Tests 31–55. Aufrufe von `syncBeforeRestore` in `BackupSection`, `LegacySection`,
   `CampaignSection` (je eine Zeile).
8. Rust: `keys.rs`; `sync/local.rs` mit Tests; `sync/github.rs` + `testserver.rs`;
   `sync/archive.rs`; Befehle in `lib.rs`, `build.rs` (zuerst), `capabilities`; `window.rs`
   (Stufe `Syncing` mit Frist); `store.rs`; Vorlagen `sync/contract/*.json`; `tests.rs` über
   `invoke`; Probe mit `#[ignore]`. `Cargo.toml`/`Cargo.lock`.
9. `platform.ts` (Vertrag, `invokeSync`, Schließen); `App.tsx` (Ablauf starten, Fokus,
   Sichtbarkeit, Schließen – der Ablauf startet nur, wenn eine Verbindung besteht, also in A
   noch nie von selbst); `contract.test.ts` (56).
10. Lokal `npm run typecheck`, `npm test`, `cargo test --locked` (Rückgabewert prüfen, nicht durch
    eine Pipe), dann **einmal** hochladen.
11. Übergabe an B: Befehle wie gebaut, Abweichungen vom Entwurf, was gegen GitHub offen ist.

### B – Oberfläche, Texte, Unterlagen

1. `features/abgleich/model.ts` + Test: alle Texte aus Abschnitt 1 als reine Funktionen;
   `FIELD_LABELS`; Karten aus `RawConflict` (Namen statt Kennungen, Werte in Worten, ja/nein,
   Weltzeit im Kalender); Zeichen-Zustände; Zeiten („gestern, 23:58 Uhr“).
2. `SyncSign` (vier Zustände, echter Knopf), `IncomingLine` (ruhige Zeile unter der Weltleiste),
   Tafel beim Schließen – in `AppShell.tsx`/`shell.css`.
3. `SyncSection` + `Setup` (Vorab-Wahl, fünf Schritte, Wiedereinstieg mit hinterlegtem
   Schlüssel), `MoveQuestion` (1.15), `MediaSection` als Baustein; `einstellungen/index.tsx`
   (`'XIII'`); `CampaignSection` („Kampagnenordner“, alte Notiz weg); `backup.ts` exportiert
   Bezeichnungen.
4. `FirstSyncDialog` (1.9 mit Liste), `ConflictDialog` (frischer Lauf vor dem Öffnen, Karten a–e,
   „Text kopieren“), `AsideList` (Filter, „Alle zurückholen“, „Diese löschen“).
5. `Welcome.tsx` + `FetchPanel` (Wahlkarte, Holen, „Holen fortsetzen“, Sperre für „Neu
   beginnen“/„übernehmen“ über `hasCampaignFiles`, Meldung mit „Zu den Bildern“).
6. Alte Texte („Cloud-Laufwerk“, „folgt“); `CLAUDE.md`, `docs/WEITERARBEIT.md`, `README.md`.
7. Rundgang als Spielleiter bei 1440 × 900 mit gefüllter Testwelt (ganze App) in der echten App
   mit Testordner und Wegwerf-Ablage – dafür braucht es den Spielleiter (Konto, Schlüssel), also
   zusammen mit 6.3 Punkt 1–8.

Vor dem echten Einsatz: 6.3 vollständig.

---

## 10. Was geprüft ist – und was nicht

**Im Code nachgelesen** (Stand des Arbeitsbaums heute): `db.ts` – `reload` prüft `pending` nur vor
dem `await` (Z. 334–339), `close()` beendet nur Wache und Zeitgeber (Z. 375–379), `put` und
`setState` laufen durchs Schema und streichen dabei Unbekanntes (Z. 163–164, 189–197),
`replaceAll` (Z. 217), `create` prüft nichts (Z. 97); `Written` setzt den Text zurück, sobald sich
der Wert ändert, auch im Fokus (`sheet.tsx:72`); der Editor behält bei laufender Eingabe seinen
Text und schreibt ihn danach (`PageEditor.tsx:148–155`, 600 ms); `saveCreature` schreibt das
ganze Formular auf den aktuellen Stand (`bestiarium/actions.ts:35`); `App.tsx` öffnet direkt über
`CampaignDb.open` und speichert bei `blur`; `Welcome.choose` öffnet direkt und hält jeden Ordner
ohne `campaign.json` für leer (Z. 45–52); `advanceTime` schreibt Uhren, Termine, Timer, Chronik
und `state` (Z. 57–122), `undoTimeAdvance` nimmt genau das in einem Zeitraum zurück (Z. 125–167);
`replaceAll` wird von Sicherung, alter Version, „Neu beginnen“ und der LegendKeeper-Übernahme samt
Rücknahme gerufen; `PlayStateSchema` (Felder in 2.4); `watch.rs` 300 ms / 2 s und Überlauf meldet
alles; `config_set` schreibt die Datei aus einem Feld; `CampaignStore` hat kein `list` (Prüfung
im Startbildschirm über `readAll`); Beschriftungen in `CampaignSection.tsx:223` und
`MediaSection.tsx:62`; `ring`, `flate2`, `windows-sys` stehen in `Cargo.lock`, `tar` nicht.

**Übernommen, nicht selbst geprüft:** GitHubs Schnittstelle (Bericht 4 und die Gegenlesung
Technik, die Wege, Felder, Grenzen und Codes heute in GitHubs Dokumentation nachgelesen hat –
**nichts davon gegen GitHub ausprobiert**); die Blob-Prüfwerte (von der Gegenlesung mit `git
hash-object` bestätigt); Mengen (2 000–4 000 Dateien, 15–60 MB, geschätzt); Verhalten des
Schlüsselbunds auf dem Mac (das Paket lief nie); dass Kennungen im Schema auf das Muster passen
(Gegenlesung Datenverlust).

**Annahmen, die der Bau als Erstes bestätigt** (die Probe 4.9 deckt 1–3 ab):
1. Code beim `PATCH` ohne Vorspulen (422?), 409 bei leerer Ablage, Größe und Dauer eines `POST
   git/trees` mit `content`, ob `sha: null` die letzte Datei eines Ordners löschen darf.
2. Was `/repos/{login}/{name}` und `/user/repos` mit einem beschränkten Schlüssel liefern.
3. `compare` liefert `ahead`/`behind`/`diverged` wie erwartet; Archiv-Umleitung.
4. `z.toJSONSchema` verträgt alle Schemata (sonst `unrepresentable: 'any'`).
5. Welche Listen eindeutige `id`s tragen (fehlt sie, gilt die Liste als Ganzes – sicher, nur mit
   mehr Rückfragen).
6. `takeRemote` mit einigen hundert Dateien ist schnell genug; `sync_fetch` über die Brücke
   notfalls in Portionen.
7. `windows-sys` setzt das Merkmal „versteckt“ für einen Ordner ohne weiteres Crate.

---

## 11. Einwände

### Blick „Datenverlust“

| # | Einwand | Ergebnis |
|---|---|---|
| 1 | Kopierter/umgezogener Ordner nimmt Verbindung mit | **eingearbeitet**, einfacher als vorgeschlagen: `root` in `verbindung.json` statt Kennung in `config.json` (die `config_set` aus einem Feld neu schreibt); Frage 1.15, Vorgabe „Kopie“, bis dahin keine Anfrage. |
| 2 | Sicherung einspielen wird als Änderung verteilt | **eingearbeitet**: `syncBeforeRestore()` vor `replaceAll` macht den gemeinsamen Stand ungültig → Frage 1.9 (3.12); Schwelle ohne 10-%-Bedingung (> 20 Löschungen) und neu > 100 Änderungen; Antwort an die Pfadmenge gebunden. **Zurückgewiesen:** `rev`-Rückschritt je Pfad (braucht `rev` im gemeinsamen Stand für einen Weg, den nur Handarbeit am Ordner öffnet; Schwelle und Regel in `CLAUDE.md` reichen). |
| 3 | Übernommenes trifft auf ungespeicherte Eingaben | **eingearbeitet**: Register `ui/drafts.ts` (Feld, Editor, Dialog, Wesen-Editor); Anwenden nur im ruhigen Moment, Hochladen trotzdem. Statt „kein Feld hat den Fokus“ zählt ungespeicherter Text – sonst blockierte die Mitschrift am Tisch jedes Holen. |
| 4 | „Ablage gilt“ schreibt, während die Oberfläche schreiben kann | **eingearbeitet**: holen nach `eingang/`, `db.close()` sperrt jedes Schreiben, Merkzettel, neu laden, `sync_recover` vor dem Öffnen – kein eigener Schreibweg mehr. |
| 5 | Fehlender gemeinsamer Stand → Alles-oder-nichts | **eingearbeitet**: `stand.vorher.json` als Rückfall; unter Windows versteckt; Beiseitegelegtes aus ersten Abgleichen nie von selbst gelöscht, „Alle zurückholen“. **Zurückgewiesen:** volle Sicherung vor 1.9 – beide Wahlen legen alles Abweichende beiseite, und das bleibt jetzt dauerhaft. |
| 6 | Eingang/Beiseite nicht sicher geschrieben | **eingearbeitet**: alles mit `write_atomic`, Merkzettel zuletzt; `sync_recover` rechnet jede Eingangsdatei nach. |
| 7 | Versionssperre: gleiche Zahl/andere Gestalt; Zurückstufen | **eingearbeitet**: `DATA_SHAPE` in der Marke (gleiche Zahl, andere Gestalt sperrt beidseits); `maxVersion` und `olderEdits` in `stand.json`, Hinweis beim Öffnen; nach dem Aktualisieren ergänzt `fillStripped`, statt still Beschnittenes hochzuladen. |
| 8 | Zeit von einer Seite, Folgen von beiden | **eingearbeitet**: `settleTime` (Kern von `undoTimeAdvance`) im selben Schritt; Doppeltes wird nach fester Regel zusammengelegt – die Liste „Doppelt in der Chronik“ entfällt. |
| 9 | Abgebrochenes Holen: weder fortsetzen noch neu beginnen | **eingearbeitet**: Holen über Merkzettel + `sync_recover`; Startbildschirm „Holen fortsetzen“; „Neu beginnen“/„übernehmen“ verweigert bei Teilen eines Spielstands. |
| 10 | `sync_recover` nur beim Start | **eingearbeitet**: `openCampaign` für jeden Weg; liegt nach einem Fehler noch ein Merkzettel, kein stilles Öffnen. |
| 11 | Wettlauf in `reload` | **eingearbeitet** (drei Zeilen, Test 26); Abbild wird über `blobSha` gegen Rusts Kennung geprüft. Die Entscheidung des ersten Entwurfs, die Lücke zu lassen, ist umgedreht. |
| 12 | „Jüngeres `updated`“ entscheidet `travelBy`/`march` | **eingearbeitet**: beide als einzelne Angaben mit Rückfrage; „jüngeres `updated`“ nur noch für Auslage. |
| 13 | Lauf-Kennung aus der Ortszeit | **eingearbeitet**: laufende Nummer, „muss neu sein“, Ausdünnen nach Zahl, keine Größengrenze. |
| 14 | Offener Konflikt sperrt Hochladen | **eingearbeitet**, einfacher als vorgeschlagen: Ein Widerspruch hält nur seinen Eintrag an; kein eigener Zweig nötig. Seit wann ein Eintrag wartet, steht im Abschnitt. |
| 15 | Löschen dort, neuer Verweis hier | **eingearbeitet**: Zeile 10 wird bei einem Verweis zur Rückfrage (Textsuche über die Dateien des Laufs). |
| 16 | `sync_push` lässt Pfade aus | **eingearbeitet**: eine Abweichung → kein Commit (`busy`), `skipped` entfällt. |
| 17 | Kopf nicht auf Abstammung geprüft | **eingearbeitet**: `compare`, nur wenn der Kopf sich bewegt hat; dahinter/daneben → nichts anwenden. |
| 18 | „Anhalten … zum Ausprobieren“ verspricht zu viel | **eingearbeitet**, weitergehend: Anhalten entfällt ganz; Satz zur Sicherung im Abschnitt. |

### Blick „Bedienung“

| # | Einwand | Ergebnis |
|---|---|---|
| 1 | Mac startet am Tisch auf altem Stand | **eingearbeitet**: Lauf bei Fokus/Sichtbarkeit/Aufwachen; ruhige Zeile „Vom MacBook kommt Neues“; Session starten gegen Zeit vorstellen ist kein Widerspruch mehr (Weltzeit und Session getrennt), und ein Widerspruch hält nur seinen Eintrag an. |
| 2 | Versionssperre als Regelfall am Tisch | **eingearbeitet** (die größere Lösung): der ältere Rechner holt weiter; PC sagt dauerhaft an, dass das MacBook die neue Version braucht; Notiz am Mac mit Weg zur neuen Version. |
| 3 | Massenlöschung ohne Ausweg | **eingearbeitet**: „Stimmt nicht – zurückholen / wieder hochladen“. |
| 4 | Zweiter Rechner landet in zweiter Ablage | **eingearbeitet**: Vorab-Wahl „erster Rechner / schon eingerichtet“; Satz in 5 a. |
| 5 | Eine unlesbare Datei hält alles an | **eingearbeitet**: nur sie wartet (Karte e), mit Art und Name. |
| 6 | Falsche Ablage im Schlüssel | **eingearbeitet**: eigener Satz mit „Zurück zu Schritt 3“; Name `spielstand-elaris`, Texte sagen „die Ablage aus Schritt 2“. |
| 7 | Ungültiger Schlüssel zu leise, Ersetzen nur ein Feld | **eingearbeitet**: Zustand „Abgleich braucht dich“; „Zugangsschlüssel ersetzen“ mit Anleitung. |
| 8 | Schlüsselbund-Frage am Tisch, nach „Ablehnen“ immer wieder | **eingearbeitet**: einmal je Programmstart lesen, Verweigerung nicht von selbst wiederholen; Satz in Schritt 4/Holen. |
| 9 | Karten ohne Namen | **eingearbeitet**: Regel für `model.ts` (Namen, Worte, `FIELD_LABELS`, sonst ganze Fassung); „Eintrag zuletzt geändert“ statt scheinbarer Zeit der Angabe. |
| 10 | Knöpfe bei „gespielt“ missverständlich | **eingearbeitet**: Knöpfe nach Inhalt; was wieder offen ist, sagt die Zeile nach dem Anwenden (statt einer Liste „Vom anderen Stand übrig“, weil `settleTime` es selbst ordnet). |
| 11 | Entscheidung verfällt | **eingearbeitet**: Dialog nach frischem Lauf; Entscheidung hängt an der Fassung dort und den strittigen Angaben, nicht an der lokalen Kennung. |
| 12 | Zwei Textfassungen nur ganz oder gar nicht | **eingearbeitet**: „Text kopieren“, markierbar. |
| 13 | Rotes Zeichen, sieben Zustände | **eingearbeitet**: vier Zustände, nie rot, echter Knopf. |
| 14 | Deckel zu nach dem Abend | **eingearbeitet**: 30 s statt 90 s, sofort hochladen bei Fokusverlust/Verbergen, „Letzter Stand vom MacBook“ am Zeichen. |
| 15 | Ohne Netz: wie alt ist der Stand? | **eingearbeitet**: Datum am Zeichen; Satz nach dem Einrichten. |
| 16 | Abgebrochenes Einrichten, erneutes Verbinden | **eingearbeitet**: Verbindung erst nach dem ersten Abgleich; Wiedereinstieg mit hinterlegtem Schlüssel; „nicht verbunden“ am Zeichen. |
| 17 | Zweiter Rechner: falscher Schlüssel erwartet, Ordner nicht wirklich leer | **eingearbeitet**: Texte, Anleitung offen, wirklich leerer Ordner, Titel der Ordnerwahl. |
| 18 | Bilder: Knopf heißt anders, falscher Handgriff naheliegend | **eingearbeitet**: `MediaSection` im Abschnitt, Meldung mit „Zu den Bildern“. |
| 19 | 1.9 nur Zahlen; Zurückholen einzeln | **eingearbeitet**: aufklappbare Liste; „Alle zurückholen“. |
| 20 | Vier Stolperstellen bei GitHub, Dauer | **eingearbeitet**: README-Punkt gestrichen, drei Sätze ergänzt, keine Dauer. |
| 21 | „Ablage“ vs. „Ablageort“ | **eingearbeitet**: „Kampagnenordner“; „Ablage bei GitHub“ beim ersten Vorkommen. |
| 22 | Zu viel Oberfläche | **eingearbeitet** alle vier: kein Anhalten, keine Systemfrage beim zweiten Schließen, kein Sicherungshinweis im Konfliktdialog, Gewöhnliches in der Liste zunächst ausgeblendet. |

### Blick „Technik“

| # | Einwand | Ergebnis |
|---|---|---|
| 1 | Abgebrochenes Holen: Sackgasse | **eingearbeitet** (wie Datenverlust 9): Merkzettel, `sync_recover`, „Holen fortsetzen“; `sync_adopt` entfällt. |
| 2 | `sync_push` lässt Pfade aus | **eingearbeitet** (wie Datenverlust 16). |
| 3 | Fehlereinordnung (Zweitgrenze, 409, Weiterleitung) | **eingearbeitet** in `classify` (4.5) und Gegenpart. |
| 4 | Schlüsselprüfung auf unbelegten Angaben | **eingearbeitet**: gezielt `/repos/{login}/{name}`, Liste nur als Rückfall, `permissions.push` nur zum Aussortieren; 403 beim ersten Hochladen führt zu Schritt 3. |
| 5 | Naht TS ↔ Rust ungetestet | **eingearbeitet**: gemeinsame JSON-Vorlagen, Vertragstests über `invoke`, Test-Nähte für Schlüssel und Basisadresse. |
| 6 | Nur eigene Annahmen geprüft | **eingearbeitet**: Probe mit `#[ignore]` gegen Wegwerf-Ablage, vor dem echten Einsatz (6.3 Punkt 1). |
| 7 | 12-Sekunden-Frist nur in JavaScript | **eingearbeitet**: Faden mit Nummer in `window.rs`. |
| 8 | `truncated` ist eine Sackgasse | **eingearbeitet**: Lesen je Ordner, auch für die Kontrolle. |
| 9 | Schlüsselbund-Dialog beim Öffnen am Mac | **eingearbeitet**: Satz in der Anleitung, einmal je Start lesen; stabile Signatur als offene Entscheidung 8. |
| 10 | Verschwindet `.abgleich`, ist der Abgleich wortlos aus | **eingearbeitet**: „Abgleich nicht verbunden“; versteckt unter Windows; `stand.vorher.json`. |
| 11 | Dauer, Wiederholen je Paket, Blob-Weg überflüssig | **eingearbeitet**: Text ohne Dauer, Wiederholen 5/15/45 s, `POST git/blobs` gestrichen. |
| 12 | Kontrolle lädt immer den ganzen Baum | **eingearbeitet**: nur beim ersten Hochladen und bei mehreren Paketen. |
| 13 | Kopf nach `PUT` neu lesen | **eingearbeitet**: Antwort des `PUT` nutzen. |
| 14 | Prüfwerte nur ASCII | **eingearbeitet**: zwei Werte mit Umlaut und BOM; Länge über Bytes. |
| 15 | Ordnerwache sieht `.abgleich` über „neu durchsehen“ | **eingearbeitet**: Satz in 4.7 berichtigt, nur Benötigtes entpackt, Prüfung in `reload`. |
| 16 | Schlüssel je Rechner, Verbindung je Ordner | **zurückgewiesen** (Schlüssel je Ablage wäre mehr Maschinerie für einen einmaligen Probelauf); statt dessen 6.3 Punkt 8 (Testordner mit Schlüssel trennen) und der gefundene Name groß in Schritt 4. |
| 17 | Archiv-Adresse in Fehlermeldungen | **eingearbeitet**: feste Sätze / `without_url`, Test. |


