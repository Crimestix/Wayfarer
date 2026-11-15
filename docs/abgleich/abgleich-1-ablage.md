# Abgleich 1 – Wie Wayfarer den Spielstand ablegt und lädt

Stand: 15. 11. 2026, Zweig `welle4/atlas`. Nur gelesen, nichts geändert. Zeilennummern beziehen
sich auf den Arbeitsbaum zu diesem Zeitpunkt. Der echte Kampagnenordner wurde nicht geöffnet;
Größenangaben stammen aus `docs/WEITERARBEIT.md`.

Gelesen: `src/data/store.ts`, `db.ts`, `platform.ts`, `hooks.ts`, `media.ts`,
`src/data/__tests__/{campaign,replaceAll,platform,media}.test.ts`, `src/App.tsx`,
`src/shell/AppShell.tsx` (Speicherstatus), `src/shell/Welcome.tsx`,
`src/features/einstellungen/{CampaignSection.tsx,files.ts,ProblemsSection.tsx,model.ts,backup.ts}`,
`src/features/wiki/media.ts`, `src/domain/schema.ts` (Kopf, Sammlungen, Hilfen),
`src-tauri/src/{store.rs,watch.rs,config.rs,lib.rs,window.rs,media.rs,tests.rs}`,
`src-tauri/{Cargo.toml,build.rs,tauri.conf.json,capabilities/main.json}`,
Schlüsselbund-Teil von `ai.rs` / `legendkeeper.rs`, `docs/WEITERARBEIT.md` (Bereich I, Bilder).

---

## 0. Das Wichtigste in zehn Sätzen

1. Der Spielstand ist `campaign.json`, `state.json` und je Dokument `<sammlung>/<id>.json`
   (34 Sammlungen), dazu `media/<name>.<bildendung>`. Sonst legt Wayfarer nichts in den Ordner.
2. Geschrieben wird immer die ganze Datei, atomar (temporäre Datei `.wayfarer-…tmp` im selben
   Ordner, dann umbenennen), als UTF-8 ohne BOM, mit `\n`, Einzug ein Leerzeichen, Schlusszeile.
3. Die Bytes sind für ein gegebenes Dokument auf beiden Rechnern gleich. Aber: **jedes** `put`
   erhöht `rev` und setzt `updated` – ein „Speichern ohne Änderung“ ändert die Datei trotzdem.
4. Dateien werden beim Laden nie umgeschrieben; Vorgaben neuer Felder stehen nur im Speicher.
   Unbekannte Felder wirft zod beim nächsten `put` weg → **beide Rechner müssen dieselbe
   Wayfarer-Version haben**, sonst verliert die ältere Version stillschweigend Felder der neueren.
5. Änderungen von außen kommen über die Ordnerwache (`notify`, entprellt 300 ms / 2 s) als
   Ereignis `store-changed` an und landen in `CampaignDb.reload` → `applyExternal`. Beide sind
   `private`.
6. **Lücke:** Wartet für eine Datei noch eine eigene Änderung (`pending`), wird die Änderung von
   außen übergangen und beim nächsten `flush` **still überschrieben** (`db.ts:334`). Ein Abgleich,
   der Dateien einfach in den Ordner legt, kann so Daten des anderen Rechners verlieren.
7. Speichern: 250 ms nach der letzten Änderung, Datei für Datei nacheinander; nach einem Fehler
   alle 5 s neu. Status `saved | saving | error` über `db.getStatus()` / `subscribeStatus`.
8. Schließen: Rust hält das Fenster auf, die Oberfläche meldet `saving`, ruft alle
   `onAppClosing`-Stellen (gleichzeitig!) und meldet `saved` oder `unsaved`. Nach `saving` gibt es
   keine Frist mehr – ein Abgleich beim Schließen braucht deshalb eine eigene Zeitgrenze.
9. Dateinamen der Dokumente und Bilder sind reines ASCII (`[A-Za-z0-9_-]`): Umlaute/NFD sind
   nur bei fremden Dateien (Konfliktkopien) ein Thema; Groß/Klein kann theoretisch kollidieren.
10. `media/` ist mit gemessenen 481 Bildern / 1,35 GB für ein GitHub-Repository zu groß; Bilder
    ändern sich unter ihrem Namen nie und lassen sich auf jedem Rechner aus dem Netz neu holen.

---

## 1. Was im Kampagnenordner liegt und wie es geschrieben wird

### 1.1 Pfadschema

`src/data/db.ts:40-45`

```ts
const CAMPAIGN_PATH = 'campaign.json';
const STATE_PATH = 'state.json';
const docPath = (collection: CollectionName, id: string) => `${collection}/${id}.json`;
const serialize = (doc: unknown) => JSON.stringify(doc, null, 1) + '\n';
```

- `campaign.json` – `CampaignMetaSchema` (`schema.ts:71-103`): `id: 'campaign'`, `schema: 1`,
  `rev`, `name`, `calendar`, `warmestMonth`, `aiModel`, `customConditions`, `tableRules`,
  `factScaffolds`, `ages`, `created`, `updated`.
- `state.json` – `PlayStateSchema` (`schema.ts:105-163`), siehe Abschnitt 5.2.
- `<sammlung>/<id>.json` – je Dokument eine Datei. Sammlungen einzig in `COLLECTION_SCHEMAS`
  (`schema.ts:2729-2764`), 34 Stück: `entities relations chronicle events sessions timers maps
  paths journeys mounts climates weather areas tables rests articles atlas clocks threads stories
  creatures encounters stocks runs nets preps loot tracks handouts bastions guesses shops
  assortments versions`. Flach, keine Unterordner.
- `media/<name>` – Bilder (Abschnitt 5.1). Kein JSON, die Ablage sieht sie nicht.
- Kurzlebig: `.wayfarer-<dateiname>.<pid>-<zähler>.tmp` im jeweiligen Ordner
  (`store.rs:26-27`, `329-333`); liegengebliebene werden nach 10 Minuten beim nächsten
  Durchgehen gelöscht (`store.rs:201-211`, `235-239`).

Einstellungen **je Rechner** liegen nicht im Kampagnenordner, sondern im Konfigurationsordner
der App (`app_config_dir`, Kennung `app.wayfarer.desktop`): `config.json` mit nur `campaignDir`
(`config.rs:11-19`) und `window.json` mit Fenstergröße (`window.rs:218-243`). Schlüssel liegen im
Schlüsselbund (Dienst `app.wayfarer.desktop`, Konten `Claude-Key` und `LegendKeeper-Key`,
`ai.rs:19-20`, `legendkeeper.rs:17-18`).

### 1.2 Kennungen (= Dateinamen)

- `schema.ts:10`: `const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);` – nur ASCII.
- `newId()` (`schema.ts:2822-2825`): 12 Zeichen aus `a-z0-9`, zufällig.
- `safeId()` (`schema.ts:2828-2831`): fremde Kennungen (LegendKeeper, v157) – **Großbuchstaben
  bleiben erhalten**, alles andere wird `-`. Verwendet in `wiki/apply.ts:281,354`,
  `wiki/lkexport.ts:503,586,619,633,642,676`, `import/v157.ts:275`.
- Feste Muster: `weatherId = ${climateId}-${day}` (`schema.ts:2151`) – eine Datei je Klimazone
  und Tag; Klimazonen `klima-<vorgabe>` (`weather.ts:557`), `klima-lage-…` (`geoClimate.ts:131`);
  feste Kennungen der Gefährten aus der Übernahme der alten Version (`import/v157.ts:76-81`).
- Beim Laden muss der Dateiname zur Kennung passen, sonst gilt die Datei als Konfliktkopie
  (`db.ts:117-122`). Der Vergleich unterscheidet Groß/Klein.

### 1.3 Verwaltungsfelder

`schema.ts:13-19`

```ts
const base = {
  id,
  /** Zählt jede Speicherung; dient der Konflikterkennung. */
  rev: z.number().int().nonnegative().default(0),
  created: z.string().default(''),
  updated: z.string().default(''),
};
```

- `created` / `updated`: `new Date().toISOString()` (`schema.ts:2833`) – Wanduhr des Rechners
  in UTC. Zwischen zwei Rechnern nicht verlässlich vergleichbar; nur zum Anzeigen.
- `rev`: zählt je Dokument, auf jedem Rechner für sich. `db.put` (`db.ts:162-168`):

```ts
const stamped = { ...doc, rev: doc.rev + 1, updated: nowIso() } as CollectionTypes[C];
const valid = COLLECTION_SCHEMAS[collection].parse(stamped) as CollectionTypes[C];
...
this.enqueue(docPath(collection, valid.id), serialize(valid));
```

  Ebenso `setState` (`db.ts:189-198`) und `setCampaign` (`db.ts:200-209`). `state.json` und
  `campaign.json` haben `rev` und `updated`; `state.json` hat **kein** `created`.
- `rev` allein erkennt keinen Konflikt (beide Rechner können von 7 auf 8 zählen, mit
  verschiedenem Inhalt). Für den Abgleich taugt nur „Inhalt gegen gemeinsamen Stand“.
- `rev` wird von Rückgängig-Befehlen als „unverändert seitdem?“ benutzt
  (`record.ts:764-769,977-988`, `laden/actions.ts:171,333-336`, `chronik/actions.ts:180-192`,
  `shell/dialogs.tsx:500`, `welt/actions.ts:213,280-286` – dort `rev === 1` = „frisch angelegt“).
  Übernimmt der Abgleich ein fremdes Dokument, zählt dessen `rev`; das ist in Ordnung, aber ein
  Grund, übernommene Dokumente **nicht** durch `put` zu schicken (sonst `rev + 1`).

### 1.4 Format und Stabilität der Bytes

- `serialize` (`db.ts:45`): `JSON.stringify(doc, null, 1) + '\n'` → Einzug **ein Leerzeichen**,
  Zeilenende **`\n`**, Schlusszeile, Umlaute roh als UTF-8 (nicht `\u…`), kein BOM.
- Rust schreibt die Bytes unverändert (`store.rs:348-353`: `content.as_bytes()`), keine
  Umwandlung der Zeilenenden.
- Reihenfolge der Felder: zod (4.6.7) gibt Objekte in der Reihenfolge des Schemas aus und wirft
  unbekannte Felder weg; `z.record` (z. B. `state.board`, `campaign.factScaffolds`) behält die
  Einfügereihenfolge (ganzzahlige Schlüssel zuerst). Mit einem Wegwerf-Schnipsel gegen das
  eingebaute zod geprüft (nichts im Projekt geändert). Zahlen formatiert jede JS-Engine gleich
  (WebView2 und WKWebView). → Dasselbe Dokument-Objekt ergibt auf beiden Rechnern dieselben
  Bytes.
- **Aber nicht „gleicher Inhalt → gleiche Bytes“ im weiteren Sinn:**
  - Jedes `put` ändert `rev` und `updated`, auch wenn sich sonst nichts ändert.
  - Beim Öffnen wird nichts umgeschrieben (`db.ts:75-94` liest nur). Eine Datei, die vor
    Einführung eines Feldes entstand, behält ihre alten Bytes, bis das Dokument wieder
    gespeichert wird; dann erscheinen alle Vorgaben neuer Felder auf einmal.
  - `replaceAll` (Sicherung einspielen, `db.ts:217-253`) schreibt **alle** Dokumente neu
    (ohne `rev + 1`), löscht alle, die fehlen, und füllt dabei Vorgaben auf → viele geänderte
    Dateien in einem Zug.
- Lesen: `decode` (`store.rs:189-199`) entfernt ein BOM und ersetzt ungültiges UTF-8 durch
  U+FFFD. Der Abgleich muss für Prüfsummen die **rohen Bytes** nehmen, nicht den dekodierten Text
  (`store::read`/`read_all` liefern nur den Text; `read_patiently` und `patiently` sind privat –
  für den Abgleich öffentlich machen oder eine eigene rohe Lesefunktion ergänzen).

### 1.5 Schreiben auf der Rust-Seite

`store.rs:323-345`

```rust
pub fn write_atomic(target: &Path, content: &[u8]) -> io::Result<()> {
    ...
    fs::create_dir_all(dir)?;
    let temp = dir.join(format!("{TEMP_PREFIX}{name}.{}-{}{TEMP_SUFFIX}", std::process::id(), ...));
    let written = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temp)?;
        file.write_all(content)?;
        file.sync_all()?;
        drop(file);
        patiently(|| fs::rename(&temp, target))
    })();
    if written.is_err() { let _ = fs::remove_file(&temp); }
    written
}
```

- Am Ziel liegt immer die alte oder die neue Fassung, nie eine halbe (Test
  `a_reader_never_sees_a_half_written_file`, `store.rs:545-565`).
- `write_atomic` ist `pub` und wird auch für `config.json`, `window.json` und Bilder benutzt –
  der Abgleich soll sie ebenfalls nehmen.
- Atomar ist nur die einzelne Datei. Ein Befehl über mehrere Dokumente (Zeit vorstellen: `state`
  + Termine + Chronik + Uhren) wird Datei für Datei geschrieben (`db.ts:302-312`), in der
  Reihenfolge, in der die Pfade zuerst in `pending` kamen. Mitten im `flush` ist der Ordner
  kurz in sich unstimmig.

### 1.6 Grenzen der Ablage (`store.rs:17-24`)

`MAX_DEPTH = 4` Ebenen, `MAX_PATH_CHARS = 240`, `MAX_FILE_BYTES = 16 MiB` (größere JSON-Dateien
werden beim Einlesen **still übergangen**, `store.rs:284-286`), `MAX_FILES = 100 000`,
`MAX_TOTAL_BYTES = 512 MiB` (darüber Fehler „zu viele Dateien“).

Was die Ablage als ihre Datei ansieht, entscheidet `check_rel_path` (`store.rs:80-112`): Teile
mit `/`, kein `..`, kein `\ : < > " | ? *`, keine Steuerzeichen, kein Teil mit `.` oder
Leerzeichen am Anfang/Ende, keine Windows-Gerätenamen (`CON`, `NUL`, `COM1` …), Endung `.json`
(Groß/Klein egal). **Nicht-ASCII ist erlaubt** (Test `store.rs:384-385`:
`entities/Aldric (Konfliktkopie 2).json`, `entities/Ärmel Straße.JSON`). `walk`
(`store.rs:215-257`) übergeht Verstecktes (Name beginnt mit `.` – also auch `.git`),
Verknüpfungen und alles, was `to_rel_path` ablehnt.

Wachstum: `weather/` eine Datei je Klimazone und Tag; `versions/` bis 60 Fassungen je Artikel;
`chronicle/` eine Datei je Eintrag. Das können einige tausend kleine Dateien werden.
`atlas/` enthält den Planeten (Küsten, Höhen) – vermutlich die größten JSON-Dateien; die
tatsächliche Größe wurde nicht gemessen (Ordner tabu).

---

## 2. Änderungen von außen, ungespeicherte Änderungen, ungültige Dateien

### 2.1 Ordnerwache (Rust)

`src-tauri/src/watch.rs`: `notify::recommended_watcher`, rekursiv auf dem Kampagnenordner
(`:97-101`). Ein eigener Thread sammelt Ereignisse: `QUIET = 300 ms` Ruhe, spätestens nach
`MAX_WAIT = 2 s` wird gemeldet (`:19-21`, `:107-132`). Gemeldet werden nur relative Pfade, die
`store::to_rel_path` annimmt (also `*.json`, nicht versteckt, `:51-57`); taucht ein Ordner neu
auf oder hat das System Ereignisse verworfen (`need_rescan`), wird der Ordner aufgelistet
(`:60-72`). Zugriffs-Ereignisse zählen nicht (`:44-46`).

Kopfkommentar `watch.rs:5-6`: „Eigene Schreibvorgänge werden mitgemeldet; die Oberfläche erkennt
sie am unveränderten Inhalt.“

Befehl `store_watch` (`lib.rs:87-106`) sendet `store-changed { paths }`; ein neuer Aufruf
ersetzt die alte Wache (Test `tests.rs:120-169`). Bilder in `media/` und versteckte Dateien lösen
nichts aus.

### 2.2 Oberfläche: `FolderStore.watch` → `CampaignDb.reload` → `applyExternal`

- `platform.ts:72-89`: `watch` ruft `store_watch` und hört auf `store-changed`. Schlägt die
  Wache fehl, läuft die App weiter (nur `console.warn`).
- `db.ts:70`: `this.unwatch = store.watch?.((paths) => void this.reload(paths)) ?? null;`
- `db.ts:331-342`:

```ts
private async reload(paths: string[]) {
  let changed = false;
  for (const path of paths) {
    if (this.pending.has(path)) continue;
    const content = await this.store.read(path);
    if (content === (this.lastWritten.get(path) ?? null)) continue;
    if (content === null) this.lastWritten.delete(path);
    else this.lastWritten.set(path, content);
    changed = this.applyExternal(path, content) || changed;
  }
  if (changed) this.notify();
}
```

- `lastWritten` (`db.ts:54`) hält je Pfad den zuletzt gelesenen oder geschriebenen Text
  (gesetzt beim Öffnen `:88`, nach jedem Schreiben `:309`, gelöscht nach Entfernen `:306`). Es
  ist **kein** gemeinsamer Stand zweier Rechner, nur „was diese Instanz zuletzt auf der Platte
  sah“; es überlebt keinen Neustart.
- `applyExternal` (`db.ts:344-373`): `campaign.json` / `state.json` werden geprüft und ersetzt
  (bei ungültigem Inhalt: nichts, kein Problem-Eintrag, `:354-356`); eine von außen **gelöschte**
  `state.json`/`campaign.json` bewirkt nichts. Dokumente: gelöscht → aus dem Speicher; sonst
  `parseDoc` → ersetzt das Dokument samt dessen `rev`/`updated` unverändert. Keine Wirkung auf
  den Speicherstatus, kein Schreiben.
- `reload` und `applyExternal` sind `private`; ein öffentliches „lies diese Pfade neu“ gibt es
  nicht. Tests: `campaign.test.ts:66-76` (Übernahme und Löschen von außen), `:275-287`.

### 2.3 Von außen geändert, während Ungespeichertes wartet

`db.ts:334`: `if (this.pending.has(path)) continue;` – die Änderung von außen wird **nicht
gelesen, nicht gemerkt, nicht gemeldet**. Der nächste `flush` schreibt die eigene Fassung
darüber (`db.ts:308`). Die Kopfzeile sagt es so (`db.ts:8-9`): „Änderungen von außen … werden
übernommen, solange hier nichts Ungespeichertes für dieselbe Datei wartet.“

Folgen für den Abgleich:

- Das Fenster ist kurz (250 ms bis zum Schreiben), aber im Fehlerfall beliebig lang
  (`RETRY_MS = 5000`, `db.ts:42`, `:317`) – und am Tisch tippt der Spielleiter gerade dann.
- Auch ohne `pending` gibt es einen Wettlauf: Abgleich legt Fassung R der Datei X ab → Wache
  meldet nach 300 ms–2 s → in der Zwischenzeit ändert der Spielleiter X im Speicher (noch auf
  Grundlage der alten Fassung) → `pending` hat X → `reload` übergeht R → `flush` überschreibt R.
  Hat der Abgleich R schon als gemeinsamen Stand gemerkt, sieht die nächste Runde „hier
  geändert, dort nicht“ und lädt die alte Grundlage hoch: **die Änderung des anderen Rechners
  ist still verloren.** Das ist der eine Fall, den der Bau ausschließen muss (Abschnitt 4.3).
- Kein Test deckt diesen Fall ab.

### 2.4 Ungültige und fremde Dateien

`parseDoc` (`db.ts:108-130`):

- Pfad passt nicht auf `^([a-z]+)\/([^/]+)\.json$` oder Sammlung unbekannt → `null`, **ohne**
  Meldung (Datei bleibt liegen, wird nie angefasst). Das trifft auch `.JSON` in Großbuchstaben
  und Dateien neuerer Sammlungen, die diese Version nicht kennt.
- Kein JSON / passt nicht zum Schema → `db.problems` bekommt `{ path, message }`
  (`message` höchstens 300 Zeichen), Dokument fehlt im Speicher.
- `doc.id !== Dateiname` → Problem „Dateiname und Kennung passen nicht zusammen (vermutlich eine
  Konfliktkopie).“
- `setProblem` (`db.ts:133-136`) führt je Pfad höchstens ein Problem; wird die Datei gültig oder
  gelöscht, verschwindet es (Test `campaign.test.ts:275-287`).
- `db.problems` ist ein öffentliches Feld, **ohne** Benachrichtigung bei Änderung; die
  Einstellungen lesen es bei jedem Zeichnen (`ProblemsSection.tsx:15-16`,
  `einstellungen/index.tsx:27`).
- Nie überschrieben: Ein unlesbares Dokument ist nicht im Speicher, also schreibt es niemand;
  `replaceAll` lehnt ausdrücklich ab, wenn eine neue Kennung auf eine unlesbare Datei fiele
  (`db.ts:231-234`, Tests `campaign.test.ts:52-64`, `replaceAll.test.ts:73-85`).
  **Ausnahme:** Wird ein *geladenes* Dokument von außen durch Ungültiges ersetzt, bleibt die
  alte Fassung im Speicher (`applyExternal` → `parseDoc` → `null`); ändert der Spielleiter es
  danach, überschreibt `flush` die ungültige Datei.
- Einordnung für den Menschen: `einstellungen/model.ts:97-126` (`explainProblem`): Konfliktkopie
  (Meldung oder Namensmuster `CONFLICT_NAME`), beschädigt, unerwartete Form („… oder von einer
  neueren Wayfarer-Version geschrieben“). Der Hilfetext in `ProblemsSection.tsx:46-67` spricht
  vom „Cloud-Laufwerk“ – mit eingebautem Abgleich anpassen.
- Konfliktkopien legt Wayfarer selbst nie an; es erkennt nur die eines Cloud-Laufwerks.

---

## 3. Wann geschrieben wird, Speicherstatus, Haken für den Abgleich

### 3.1 Warteschlange

- `enqueue` (`db.ts:266-272`): `pending.set(path, content)`, Status `saving`, `notify()`,
  Zeitgeber auf **250 ms** neu gestellt (jede weitere Änderung verschiebt ihn).
  `content === null` heißt löschen.
- `replaceAll` füllt `pending` direkt und stellt denselben Zeitgeber (`db.ts:240-252`).
- `flush` (`db.ts:293-323`): wartet auf einen laufenden Durchgang, schreibt dann der Reihe nach
  je einen Eintrag (`store.write` / `store.remove`), merkt `lastWritten`, nimmt ihn nur aus
  `pending`, wenn inzwischen nichts Neueres wartet (`:311`). Fehler: Status `error` mit Text,
  Rest bleibt in `pending`, neuer Versuch nach 5 s (`:314-317`). **`flush()` wirft nie** – nach
  `await db.flush()` muss man `db.hasUnsavedChanges()` (`:325-327`) fragen.
- Zusätzliche Auslöser in `App.tsx:72-74`: `beforeunload` und `blur` des Fensters rufen
  `db.flush()`.
- `batch` (`db.ts:256-264`) bündelt nur Benachrichtigungen, nicht das Schreiben.
- Test: `campaign.test.ts:226-247` (Fehler → `error` → nach 5 s `saved`).

### 3.2 Status für die Oberfläche

- `SaveStatus = 'saved' | 'saving' | 'error'` (`db.ts:26`), `getStatus`, `getLastError`,
  `subscribeStatus` (`db.ts:149-157`), gesetzt in `setStatus` (`db.ts:283-288`; meldet nur bei
  Wechsel).
- Hook `useSaveStatus()` (`hooks.ts:42-46`).
- Anzeige unten links in der Navigation, `shell/AppShell.tsx:164-171`:

```tsx
<div className="wf-save" data-status={status} title={error || db.store.location}>
  <i />
  {status === 'saved' ? 'Gespeichert' : status === 'saving' ? 'Speichert …' : 'Speichern fehlgeschlagen'}
</div>
```

  Hier gehört der Stand des Abgleichs daneben (z. B. „Abgeglichen“, „Gleicht ab …“, „Ohne Netz –
  wird nachgeholt“, „2 Dateien zu entscheiden“). Weiterer Nutzer von `useSaveStatus`:
  `chronik/Sessions.tsx:195`.

### 3.3 Haken „nach Änderungen abgleichen“

Es gibt kein Ereignis „diese Pfade wurden geschrieben“. Geeignet:

- `db.subscribeStatus`: Wechsel auf `saved` heißt „alles Wartende steht auf der Platte“. Darauf
  einen eigenen, längeren Zeitgeber setzen (Vorschlag: 30–60 s Ruhe, spätestens nach einigen
  Minuten) und dann abgleichen. Was sich geändert hat, ergibt ohnehin der Vergleich der
  Prüfsummen gegen den gemerkten gemeinsamen Stand – eine Pfadliste braucht es nicht.
- Vor jedem Abgleich: `await db.flush()` und nur weitermachen, wenn `!db.hasUnsavedChanges()`
  (sonst liest der Abgleich einen halb geschriebenen Befehl, siehe 1.5).
- Übernimmt der Abgleich fremde Dateien über die Ordnerwache, ändert das den Speicherstatus
  nicht (`applyExternal` schreibt nicht) – also keine Schleife. Übernähme er sie über `db.put`,
  entstünde durch `rev + 1` sofort eine neue lokale Änderung → Ping-Pong. **Nie `put` für
  Übernommenes.**

### 3.4 Haken „vor dem Schließen abgleichen“

Ablauf heute:

1. Rust, `lib.rs:290-301`: `CloseRequested` am Hauptfenster → `api.prevent_close()` →
   `window::request_close` → Ereignis `close-requested` und Frist `ANSWER_GRACE = 1500 ms`
   (`window.rs:29`, `:149-156`).
2. Oberfläche, `platform.ts:197-204`:

```ts
void listen('close-requested', async () => {
  await invoke('app_close', { state: 'saving' }).catch(() => undefined);
  const saved = await settleBeforeClosing(closingHandlers);
  await invoke('app_close', { state: saved ? 'saved' : 'unsaved' }).catch(() => undefined);
});
```

3. `settleBeforeClosing` (`platform.ts:192-195`) ruft **alle Stellen gleichzeitig**
   (`Promise.all`); ein Fehler oder `false` zählt als „nicht gespeichert“.
4. Angemeldet ist bisher nur `App.tsx:76-79`: `await db.flush(); return !db.hasUnsavedChanges();`
5. Rust-Zustände (`window.rs:74-116`): nach `saving` gilt die Frist nicht mehr – das Fenster
   bleibt offen, bis `saved` oder `unsaved` kommt. Klickt der Mensch währenddessen noch einmal
   auf Schließen, fragt Rust „Wayfarer speichert noch. … Trotzdem schließen / Zurück zu
   Wayfarer“ (`window.rs:81`, `:183-186`). `unsaved` führt zur Rückfrage „Die letzten Änderungen
   ließen sich nicht speichern …“ (`:179-182`). Tests: `window.rs:333-414`, `tests.rs:271-330`.

Für den Abgleich heißt das:

- Als weitere `onAppClosing`-Stelle anmelden, die **selbst zuerst `await db.flush()`** macht
  (die Reihenfolge der Stellen ist nicht garantiert) und dann abgleicht.
- Mit **eigener Zeitgrenze** (z. B. 10–15 s) und bei „kein Netz“ sofort fertig: Ein
  fehlgeschlagener Abgleich darf **nicht** `false` liefern – sonst erscheint die falsche Warnung
  „Änderungen gehen verloren“, obwohl lokal alles gespeichert ist. Stattdessen `true` liefern und
  „noch nicht abgeglichen“ merken (wird beim nächsten Öffnen nachgeholt).
- Offene Konflikte halten das Schließen nicht auf; sie stehen beim nächsten Start wieder da.
- Soll während des Abgleichs beim zweiten Klick ein passender Satz stehen („Wayfarer gleicht
  noch ab“), braucht `CloseAnswer` / `Question` in `window.rs` eine weitere Stufe (etwa
  `syncing`) – sonst steht dort „speichert noch“.
- Im fertigen Programm läuft Wayfarer nur einmal (`lib.rs:340-344`), ein zweites Fenster auf
  demselben Ordner gibt es also nicht.

### 3.5 Haken „beim Öffnen abgleichen“

- `App.tsx:24-39` (`boot`): `getConfig()` → `CampaignDb.open(new FolderStore(campaignDir))`.
  Am saubersten gleicht man **vor** `CampaignDb.open` ab (dann gibt es noch kein `pending` und
  keinen Wettlauf) – mit kurzer Zeitgrenze, ohne Netz sofort weiter. Dauert es länger, öffnen
  und im Hintergrund weitermachen (dann gilt 4.3).
- Neuer Rechner (Mac): `Welcome.tsx:40-53` – wählt man einen leeren Ordner, wirft
  `CampaignDb.open` `CampaignMissingError` und es erscheint „Dieser Ordner ist noch leer“
  (`Welcome.tsx:87ff`) mit „Spielstand der alten Version übernehmen“ und „Elaris neu beginnen“.
  Dort gehört die dritte Wahl hin: „Spielstand aus GitHub holen“ (alles herunterladen, dann
  `CampaignDb.open`, `setConfig`).
- Ordnerwechsel in den Einstellungen: `CampaignSection.tsx:94-102` (`flush`, `setConfig`,
  `window.location.reload()`), „Kampagne mitnehmen“ `:137-143` – beim Wechsel muss der Abgleich
  wissen, zu welchem Ordner welcher gemeinsame Stand gehört.
- `CampaignDb.close()` (`db.ts:375-379`) beendet Wache und Zeitgeber; `App.tsx:84-86` ruft es
  bewusst nicht auf.

---

## 4. Schnitt der Schnittstelle – Abgleich als Schicht neben dem Store

### 4.1 `CampaignStore` (`store.ts:12-21`)

```ts
export interface CampaignStore {
  readonly location: string;
  readAll(): Promise<StoredFile[]>;
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  watch?(onChange: (paths: string[]) => void): () => void;
}
```

- `FolderStore` (`platform.ts:55-90`): reicht alles an die Rust-Befehle weiter, `root` ist
  öffentlich (`location === root`).
- `BrowserStore` (`store.ts:57-91`): `localStorage` unter `wayfarer:default:<pfad>`, kein
  `watch`. Vorschau – dort gibt es keinen Abgleich (`isDesktopApp()`, `platform.ts:44-45`).
- `MemoryStore` (`store.ts:24-54`): für Tests, mit `externalWrite` zum Nachstellen von
  Änderungen von außen – damit lässt sich der Abgleich auf der TS-Seite testen.
- `CampaignDb` kennt nur diese Schnittstelle (`db.store` ist öffentlich und `readonly`).

### 4.2 Was die Rust-Seite schon kann

Befehle (Vertrag in `platform.ts:5-25`, Anmeldung `lib.rs:314-333`):

| Befehl | Rust | Bemerkung |
|---|---|---|
| `store_read_all({root})` | `store::read_all` (`store.rs:279-304`) | nur `*.json`, sortiert, Text dekodiert |
| `store_read({root,path})` | `store::read` (`:307-315`) | `null`, wenn es die Datei nicht gibt |
| `store_write({root,path,content})` | `store::write` → `write_atomic` (`:348-353`) | legt Unterordner an |
| `store_remove({root,path})` | `store::remove` (`:356-364`) | fehlt die Datei, kein Fehler |
| `store_watch({root})` | `watch::start` (`watch.rs:93-137`) | Ereignis `store-changed` |
| `media_list({root})` | `media::list` (`media.rs:228-248`) | merkt zugleich den Ordner fürs Anzeigen |
| `media_fetch({root,url,name})` | `Media::fetch` (`media.rs:63-76`) | nur https, nur echte Bilder |
| `config_get` / `config_set` | `config.rs` | bisher nur `campaignDir` |

Nützliche `pub`-Funktionen für einen neuen Rust-Baustein (`sync.rs`): `store::check_root`,
`check_rel_path`, `resolve` (lehnt Verknüpfungen ab), `to_rel_path`, `list` (alle JSON-Pfade,
sortiert), `write_atomic`, `remove`, `media::check_name`, `media::path_of`, `media::list`.
`lib.rs:30-36` `blocking(...)` für Dateiarbeit abseits der Oberfläche. Netz: `reqwest 0.13`
mit rustls (`Cargo.toml`), Muster für Client, Zeitgrenzen und Fehlersätze in `media.rs:139-169`
und `legendkeeper.rs`. Schlüsselbund: `keyring 4`, Muster `KeyStore` (`ai.rs:66-119`) bzw.
`KeyCache` (`legendkeeper.rs:44-95`) – zweimal fast gleich vorhanden, ein drittes Konto
(z. B. `GitHub-Key`) passt daneben. Prüfsummen (SHA-1 für Git-Blobs) und Base64 sind **noch
keine** Abhängigkeiten.

Ein neuer Befehl braucht vier Stellen: `#[tauri::command]` + Eintrag in `generate_handler!`
(`lib.rs:314-333`), Name in `COMMANDS` (`build.rs`), `allow-…` in
`capabilities/main.json`, Vertrag und Aufruf in `src/data/platform.ts`. Die Dateien unter
`src-tauri/permissions/autogenerated/` erzeugt der Bau. Test nach dem Muster `tests.rs`
(„wie die Oberfläche aufruft“). Netzadressen müssen nicht in die CSP: Anfragen gehen von Rust
aus (`connect-src` bleibt `'self' ipc:`).

### 4.3 Geht „Schicht daneben, die nur Dateien legt und dann neu laden lässt“?

Ja für alles außer dem Einspielen fremder Fassungen bei laufender App. Im Einzelnen:

- **Lesen des lokalen Stands, Vergleichen, Hochladen:** ganz auf der Rust-Seite, neben dem
  Store, ohne `CampaignDb` zu berühren – vorausgesetzt, vorher lief `db.flush()` und es wartet
  nichts.
- **Herunterladen in den Ordner:** Die Ordnerwache meldet die geschriebenen JSON-Dateien von
  selbst, `reload` übernimmt sie. Ein Extra-Aufruf ist nicht nötig – **aber** wegen 2.3 nicht
  sicher. Zwei saubere Wege:

  **Weg A (empfohlen): Einspielen läuft durch `CampaignDb`.** Rust liefert nur den Plan
  („diese Pfade mit diesem Inhalt übernehmen / löschen“) und schreibt selbst nichts in den
  Ordner. `CampaignDb` bekommt eine öffentliche Methode, etwa

  ```ts
  /** Übernimmt Fassungen des anderen Rechners. Gibt zurück, was nicht übernommen wurde. */
  takeRemote(files: { path: string; content: string | null; expect: string | null }[]):
    { taken: string[]; busy: string[] }
  ```

  die in **einem** JS-Schritt je Pfad prüft: wartet etwas in `pending` oder weicht
  `lastWritten.get(path)` von `expect` (der Fassung, mit der Rust verglichen hat) ab → `busy`
  (nicht anfassen, gemeinsamer Stand bleibt, nächste Runde zeigt es als Konflikt); sonst
  `applyExternal(path, content)` und `pending.set(path, content)` mit dem **wörtlichen** Inhalt
  (kein `serialize`, kein `rev + 1`), danach gewöhnlicher `flush`. Weil JavaScript nicht
  unterbrochen wird, gibt es zwischen Prüfen und Übernehmen keinen Wettlauf. Der gemeinsame
  Stand wird erst fortgeschrieben, wenn `flush` die Datei wirklich geschrieben hat. Mit
  `MemoryStore` vollständig testbar.

  **Weg B: Rust schreibt, Wache lädt neu.** Dann muss Rust unmittelbar vor dem Umbenennen
  prüfen, dass die Datei auf der Platte noch die verglichene Prüfsumme hat, und `reload` muss
  melden, welche Pfade es wegen `pending` übergangen hat (heute: `continue`, still). Ohne beides
  bleibt die Lücke aus 2.3. Mehr Stellen, schlechter testbar.

- Für `media/` gilt das nicht: Bilder kennt `CampaignDb` nicht; Rust kann sie direkt ablegen.
  Danach `loadLocalMedia(root)` (`data/media.ts:99-107`) erneut aufrufen bzw. `addLocalMedia`,
  sonst zeigt die Oberfläche weiter die Netzadresse.
- Ungültiges vom anderen Rechner: `applyExternal` lehnt es ab und trägt ein Problem ein, das
  Dokument im Speicher bleibt. Für Weg A heißt das: Schlägt die Prüfung fehl, Pfad als `busy`/
  „nicht lesbar“ zurückgeben und **nicht** schreiben – so überschreibt der Abgleich nie eine
  gute lokale Fassung mit einer kaputten.

### 4.4 Wo der gemerkte gemeinsame Stand liegen kann

- Er gehört zum Paar (Rechner, Kampagnenordner), nicht zum Spielstand – er darf **nicht**
  mit abgeglichen werden.
- Im Kampagnenordner als versteckter Ordner (z. B. `.wayfarer-abgleich/`): Die Ablage übergeht
  alles, was mit `.` beginnt (`store.rs:235-240`), die Wache meldet es nicht
  (`to_rel_path` → `check_rel_path` lehnt versteckte Teile ab). Aufräumen trifft nur Dateien
  `.wayfarer-*.tmp`, keine Ordner (`store.rs:201-211`, `:236`). Vorteil: zieht mit, wenn der
  Ordner verschoben wird. Der Abgleich muss ihn selbst ausnehmen.
- Oder im Konfigurationsordner der App neben `config.json`, nach Ordnerpfad getrennt. Dann
  `AppConfig` (`config.rs:13-19`, `#[serde(default)]` je Feld) um Repository und Zweig erweitern
  – `config_set` nimmt heute nur `campaign_dir` (`lib.rs:52-57`) und `setConfig`
  (`platform.ts:52`) schreibt die ganze Einstellung neu: beim Erweitern darauf achten, dass ein
  Ordnerwechsel die Abgleich-Einstellungen nicht löscht.
- Der Zugangsschlüssel: Schlüsselbund, eigenes Konto; er verlässt die Rust-Seite nie (wie bei
  `lk_set_key` / `ai_set_key`, nur `…_status() -> { hasKey }` geht zurück).

---

## 5. `media/` und `state.json`

### 5.1 Bilder

- Ort: `<Kampagnenordner>/media/<name>` (`media.rs:20`, `path_of` `:107-115`). Kein
  Unterordner. Der Ordner entsteht erst mit dem ersten Bild.
- Name: der letzte Teil der Ursprungsadresse (`data/media.ts:18-28`, `mediaName`), geprüft mit
  `^[A-Za-z0-9][A-Za-z0-9._-]{0,118}\.(png|jpe?g|webp|gif|avif)$` (`data/media.ts:12`) bzw.
  `check_name` (`media.rs:83-104`: nur ASCII-Buchstaben, Ziffern, `. - _`, höchstens 120
  Zeichen, Endung für Bilder, Groß/Klein der Endung egal). Bei LegendKeeper ist das die
  Kennung des Bildes, z. B. `0a1b2c3d-….png`.
- Im Spielstand steht **die Adresse des Ursprungs** (`map.image`, `entity.image`,
  `article.banner`, Bildknoten in Artikeln – `wiki/media.ts:32-46`), nicht der Dateiname. Liegt
  die Datei da, zeigt `useMediaSrc` sie über `wfmedia://` (`data/media.ts:59-82`,
  `lib.rs:196-213`), sonst die Netzadresse.
- Holen: `media_fetch` (`lib.rs:184-192` → `media.rs:63-76`): liegt die Datei schon da (Größe
  > 0), wird nichts geholt; sonst nur `https`, keine IP-Adressen, höchstens 5 Weiterleitungen,
  180 s; gespeichert wird nur, was am Anfang wie ein Bild aussieht (`mime_of` `:199-216`), über
  `write_atomic`. Aufgerufen aus den Einstellungen („Bilder holen“, `MediaSection.tsx:43`) mit
  vier gleichzeitig (`wiki/media.ts:58`).
- Größe: je Bild höchstens `MAX_BYTES = 96 MiB` (`media.rs:22`). Gemessen laut
  `docs/WEITERARBEIT.md:326-327`: **481 Bilder, 1,35 GB, etwa drei Minuten**. Ebenda `:330-333`:
  „Für den Abgleich über GitHub (Bereich I) ist er mit 1,35 GB zu groß; dafür braucht es
  kleinere Fassungen der Bilder oder einen anderen Weg.“
- Ein Bild ändert sich unter seinem Namen nie (`lib.rs:206-207`: Antwort mit
  `Cache-Control: … immutable`). Für einen Abgleich heißt das: Bilder sind nur „da“ oder „nicht
  da“ – kein Dreiwegevergleich, kein Konflikt; nie löschen, nur ergänzen.
- Die Sicherungsdatei enthält keine Bilder (`backup.ts:76-94`).
- Welche Bilder auf dem Rechner liegen, liest die Oberfläche einmal beim Öffnen
  (`App.tsx:71` → `loadLocalMedia`); `media_list` merkt dabei auch den Ordner, aus dem `wfmedia`
  ausliefern darf (`lib.rs:177-181`).
- Folgerung: `media/` in der ersten Fassung **nicht** über GitHub abgleichen. Der Mac holt die
  Bilder wie bisher aus dem Ursprung („Bilder holen“). Das trägt, solange der Ursprung
  (LegendKeeper) besteht – eine Entscheidung für den Spielleiter, weil er LegendKeeper kündigen
  will; bis dahin müssen die Bilder auf beiden Rechnern geholt sein oder es braucht einen
  eigenen Weg für Bilder.

### 5.2 `state.json`

`PlayStateSchema` (`schema.ts:105-163`). Alles darin gehört zum Spiel oder ist eine Einstellung
des einen Spielleiters, die er an beiden Rechnern gleich erwartet. **Nichts ist an einen Rechner
gebunden** – Fenstergröße und Ordnerpfad liegen im Konfigurationsordner der App (1.1), und die
App hält keinen Zustand im Browser-Speicher (in `src` kein `localStorage` außer
`BrowserStore`).

| Feld | Bedeutung | Art |
|---|---|---|
| `now`, `previousNow` | Weltzeit; Zeit vor dem letzten Sprung (für Rückgängig) | Spiel |
| `placeId` | Ort der Gruppe | Spiel |
| `sessionId` | laufende Session | Spiel |
| `travelBy`, `march` | Fortbewegungsmittel, Marschordnung | Spiel |
| `watch` | Beobachtetes im Weltgeschehen | Vorbereitung |
| `continuityOk`, `twinsApart` | „Passt so“, „Sind verschieden“ | Entscheidungen des Spielleiters |
| `recapDismissed` | Rückblick weggeklickt (je Session) | Ansicht, aber sinnvoll gemeinsam |
| `board`, `netBoard` | wo Karten auf Fadenbrett und Fraktionsnetz liegen | Auslage |
| `timelineLanes` | Bahnen der Zeitleiste | Auslage |
| `nameMemory` | Gedächtnis beim Tippen an/aus | Einstellung |
| `id`, `rev`, `updated` | Verwaltung | – |

Wichtig für den Abgleich: `state.json` ist die **eine Datei, die fast jede Sitzung ändert** (Zeit,
Ort, Session) **und** beim Vorbereiten (Karte auf dem Fadenbrett verschieben, Bahn umstellen).
Mit reinem Dreiwegevergleich je Datei ist sie der häufigste Konflikt: am PC eine Karte
verschoben, am Mac die Zeit vorgestellt. Sinnvoll ist deshalb für `state.json` (und
`campaign.json`, das Kalender, Regeln des Tisches, Zeitalter und Gerüste bündelt) ein
**Dreiwegevergleich je Feld**: Haben beide Seiten verschiedene Felder geändert, lässt sich
ohne Rückfrage zusammenführen (`rev` = größeres + 1, `updated` = jetzt); nur dasselbe Feld auf
beiden Seiten ist eine Frage an den Spielleiter. `now`/`previousNow`/`placeId`/`sessionId`
gehören dabei zusammen (ein Zeitsprung an einem Rechner, ein Ortswechsel am anderen ist
fachlich eine Frage, auch wenn die Felder verschieden sind).

---

## 6. Fallstricke

### 6.1 Der stille Verlust (wichtigster Punkt)
`db.ts:334` übergeht Änderungen von außen an Dateien, für die etwas wartet, und überschreibt
sie. Ein Abgleich, der bei laufender App Dateien in den Ordner legt, braucht Weg A aus 4.3 (oder
die beiden Sicherungen aus Weg B). Den gemeinsamen Stand erst fortschreiben, wenn die Datei
nachweislich so auf der Platte liegt.

### 6.2 Nie über `db.put` einspielen
`put` zählt `rev` hoch und setzt `updated` → andere Bytes als auf dem anderen Rechner →
endloses Hin und Her. Übernommenes wörtlich schreiben.

### 6.3 Verschiedene Wayfarer-Versionen
zod wirft unbekannte Felder weg (`put` → `parse`, `db.ts:164`), unbekannte Sammlungen lädt die
ältere Version gar nicht (`db.ts:114`), bleibt aber liegen. Ändert die ältere Version ein
Dokument, das die neuere mit neuen Feldern geschrieben hat, sind die Felder weg – und der
Abgleich trägt den Verlust zurück. `campaign.schema` ist fest `1` (`schema.ts:73`) und taugt
nicht als Versionsmarke. Vorschlag: Der Abgleich legt im Repository eine kleine Marke ab
(Version der App, die zuletzt hochgeladen hat) und warnt bzw. lädt nicht hoch, wenn die eigene
Version älter ist.

### 6.4 Unstimmiger Stand mitten im Schreiben
Befehle über mehrere Dokumente werden Datei für Datei geschrieben (1.5). Nur abgleichen, wenn
`db.flush()` durch ist und `!db.hasUnsavedChanges()`. Den lokalen Stand in einem Zug erfassen
(Prüfsummen und Inhalt), nicht während des Hochladens noch einmal von der Platte lesen.

### 6.5 Zusammenführen je Datei ist nicht immer fachlich richtig
Dokumente verweisen aufeinander (Chronik ↔ `state`, Uhren ↔ Geschichten, Wirkungen „jüngster
seiner Sorte“). Haben beide Rechner seit dem letzten Abgleich geändert, kann ein Zusammenlegen
ohne Dateikonflikt trotzdem Seltsames ergeben (zwei Zeitsprünge: `state.json` ist der Konflikt,
die Chronikeinträge beider Seiten kommen einfach beide). Vorschlag: Sobald **beide** Seiten
Änderungen haben, das dem Spielleiter sagen („hier 12, dort 3 Dateien geändert“) – auch wenn
keine Datei doppelt betroffen ist – und vorher eine Sicherung anbieten.

### 6.6 Löschen
Ein gelöschtes Dokument ist eine fehlende Datei, es gibt keine Grabsteine (`db.ts:181-187`,
`store.rs:356-364`). Ohne gemeinsamen Stand ist „fehlt hier“ nicht von „neu dort“ zu
unterscheiden → der **erste** Abgleich eines Rechners muss ausdrücklich eine Richtung haben
(„dieser Rechner lädt hoch“ / „von GitHub holen“). Löschen hier + Ändern dort ist ein Konflikt.
`replaceAll` (Sicherung einspielen, `db.ts:217-253`) löscht und schreibt sehr viele Dateien auf
einmal – bei massenhaften Löschungen vor dem Weitertragen nachfragen.

### 6.7 Groß- und Kleinschreibung
NTFS und APFS unterscheiden in der Regel nicht, ein Git-Baum schon. Kennungen dürfen
Großbuchstaben haben (`schema.ts:10`; `safeId` erhält sie, LegendKeeper-Kennungen in
`wiki/apply.ts:281`, `wiki/lkexport.ts`), `newId` erzeugt nur Kleinbuchstaben. Zwei Kennungen,
die sich nur in Groß/Klein unterscheiden, wären lokal dieselbe Datei, im Repository zwei Pfade.
Der Abgleich sollte Pfade beim Zuordnen ohne Groß/Klein vergleichen, die Schreibweise der Platte
bzw. des Repositorys beibehalten und zwei Pfade, die sich nur so unterscheiden, als Problem
melden statt einen zu überschreiben. Gleiches gilt für Bildnamen (`a_b.JPG`). Sammlungsordner
sind immer klein (`^[a-z]+`).

### 6.8 Umlaute und Unicode-Normalisierung (macOS NFD)
Für alles, was Wayfarer selbst schreibt, **kein Thema**: Dokumentnamen sind
`[A-Za-z0-9_-]{1,64}.json`, Bildnamen ASCII (`check_name`). Ein Thema nur bei fremden Dateien,
die `check_rel_path` durchlässt (Konfliktkopien wie `Aldric (Konfliktkopie 2).json`,
`store.rs:384-385`): Auf dem Mac können solche Namen zerlegt (NFD) vorliegen, GitHub vergleicht
Bytes. Empfehlung: Der Abgleich nimmt nur Pfade nach strengem Muster –
`campaign.json`, `state.json`, `^[a-z]+/[A-Za-z0-9_-]{1,64}\.json$` (nach Muster, nicht nach der
Liste bekannter Sammlungen, damit Dateien neuerer Sammlungen mitreisen) – und lässt alles andere
lokal liegen (es steht weiter unter „Probleme beim Laden“). Der Text **in** den Dateien wird
nie normalisiert; er bleibt, wie er getippt wurde.

### 6.9 Zeilenenden und Kodierung
Wayfarer schreibt `\n`, UTF-8, kein BOM, auf beiden Systemen gleich (1.4). Da der Abgleich über
die Schnittstelle Blobs byteweise ablegt, greift keine Umwandlung. Vorsicht nur, wenn jemand das
Repository zusätzlich mit einem Git-Programm unter Windows ausleiht (`autocrlf`) – eine
`.gitattributes` mit `* -text` im Repository beugt vor. Prüfsummen über rohe Bytes bilden, nicht
über den Text aus `store::read` (BOM entfernt, kaputtes UTF-8 ersetzt, `store.rs:189-199`).

### 6.10 Gesperrte Dateien unter Windows
`patiently` (`store.rs:154-173`) wiederholt bei „Zugriff verweigert“ unter Windows bis zu
achtmal mit wachsender Pause (25 ms × Versuch, zusammen etwa 0,9 s) – für Lesen, Umbenennen
und Löschen; auf dem Mac kein Wiederholen. `write_atomic` nutzt es beim Umbenennen. Der
Abgleich soll `write_atomic` / `store::remove` nehmen und für rohes Lesen dieselbe Geduld
aufbringen (Funktionen dafür sind privat, siehe 1.4). Bleibt eine Datei gesperrt
(Virenscanner), diese Datei überspringen und in der nächsten Runde nachholen, nicht den ganzen
Abgleich abbrechen.

### 6.11 Zeitstempel
Dateizeiten nutzt Wayfarer nirgends außer beim Aufräumen alter `.tmp`-Dateien. Das atomare
Schreiben gibt jeder Datei bei jedem Schreiben eine neue Änderungszeit; nach dem Herunterladen
tragen alle Dateien die Zeit des Abgleichs. Änderungszeit also höchstens als Abkürzung („seit
dem letzten Durchgang unverändert?“), entscheidend ist die Prüfsumme. `updated` im Dokument ist
die Wanduhr des jeweiligen Rechners – gut für die Anzeige im Konfliktdialog („hier zuletzt
geändert …, dort …“), nicht zum Entscheiden.

### 6.12 Eigene Dateien des Abgleichs und fremde Reste
Verstecktes (`.…`) sieht die Ablage nicht – dort kann der gemerkte Stand liegen, er darf aber
nie hochgeladen werden. Liegt im Kampagnenordner schon ein `.git` (frühere Versuche), bleibt es
unberührt und hat mit dem eingebauten Abgleich nichts zu tun. Frische `.wayfarer-*.tmp` gehören
zu einem laufenden Schreibvorgang und werden nie abgeglichen. Sicherungsdateien darf der
Spielleiter nicht in den Kampagnenordner legen (`einstellungen/files.ts:42-45` verhindert es) –
lägen sie doch dort, nähme das strenge Muster aus 6.8 sie aus.

### 6.13 Meldungen und Texte
`db.problems` meldet Änderungen nicht an die Oberfläche (2.4) – für Konflikte des Abgleichs
einen eigenen, abonnierbaren Zustand bauen, nicht `problems` mitbenutzen. Hilfetexte unter
„Probleme beim Laden“ (`ProblemsSection.tsx:46-67`), die Fehlermeldung
`unreachable_root` („Ist das Cloud-Laufwerk verbunden?“, `store.rs:63-65`), die Kommentare in
`store.ts:2-4`, `config.rs:1-2`, `watch.rs:1-2` und die Rückfragen beim Schließen
(`window.rs:179-186`) sprechen vom Cloud-Laufwerk bzw. nur vom Speichern.

### 6.14 Größe und Anzahl
Viele kleine Dateien (Wetter je Tag, Fassungen, Chronik) – der Abgleich sollte Bäume vergleichen
und nur Geändertes übertragen, nicht je Datei einzeln fragen. `MAX_FILE_BYTES = 16 MiB` je
JSON-Datei; was größer ist, lädt Wayfarer gar nicht (still). Wie groß `atlas/` wirklich ist,
ist offen (nicht gemessen).

---

## 7. Vorhandene Tests, an denen sich der Abgleich ausrichten kann

- `src/data/__tests__/campaign.test.ts:38-77` – Ablage: jede Datei einzeln, leere Ablage,
  Unlesbares nicht überschreiben, Änderungen von außen (`MemoryStore.externalWrite`).
- `…/campaign.test.ts:226-248` – erneutes Speichern nach Fehler (mit falschen Zeitgebern).
- `…/campaign.test.ts:275-288` – Ladeprobleme je Datei einmal.
- `…/replaceAll.test.ts` – Austausch des ganzen Stands, eine Benachrichtigung, Ungültiges lässt
  alles unangetastet.
- `…/platform.test.ts` – `settleBeforeClosing` / `onAppClosing`.
- `…/media.test.ts` – `mediaName`, `resolveMedia`.
- `src-tauri/src/store.rs:366-701` – Pfadprüfung, atomar, Verknüpfungen, BOM, nur JSON.
- `src-tauri/src/watch.rs:139-246` – Wache: relative Pfade, Entprellen, neuer Ordner in einem Zug.
- `src-tauri/src/tests.rs` – Befehle so aufgerufen wie von der Oberfläche; Schließen
  (`:271-330`); nur das Hauptfenster darf Befehle rufen (`:243-269`).
- **Fehlt:** ein Test für „von außen geändert, während dieselbe Datei wartet“ (2.3).
