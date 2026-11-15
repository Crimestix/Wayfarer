# Abgleich über GitHub ohne installiertes Git – Recherche (Teil 4)

Stand: 15. 11. 2026. Nur gelesen, nichts im Projekt geändert, nichts ausprobiert (kein Schlüssel,
kein Repository angefasst). Alle Angaben zur GitHub-Schnittstelle stammen aus den in Abschnitt 14
aufgeführten Seiten; bei jeder steht, ob ich sie **heute gelesen** habe. Was nur Vorwissen oder
Bericht Dritter ist, ist als solches markiert und steht gesammelt in Abschnitt 11 („Vor dem Bau
einmal nachprüfen“).

## 0. Kurzfassung

- **Lesen:** `GET git/ref` → `GET git/commits` → `GET git/trees/{sha}?recursive=1` liefert Pfad →
  Blob-Kennung für den ganzen Stand in **einer** Anfrage (bis 100 000 Einträge / 7 MB). Lokal
  rechnet Wayfarer dieselbe Kennung aus (`sha1("blob <Länge>\0" + Bytes)`) und vergleicht – ohne
  etwas herunterzuladen. Geholt wird nur, was sich unterscheidet: einzeln über
  `GET git/blobs/{sha}` (roh), bei sehr vielen Dateien (erster Abgleich auf dem zweiten Rechner)
  über das Archiv `GET tarball/{commit}` in einer Anfrage.
- **Schreiben:** `POST git/trees` mit `base_tree` und dem Text der JSON-Dateien **direkt im Feld
  `content`** (kein Blob je Datei), Löschungen als `sha: null`; danach `POST git/commits` und
  `PATCH git/refs/heads/<zweig>` mit `force: false`. Nur Bilder (binär) brauchen je Datei ein
  `POST git/blobs` (base64).
- **Schutz:** `PATCH … force:false` schlägt mit 422 fehl, wenn inzwischen der andere Rechner
  geschrieben hat → von vorn (holen, vergleichen, zusammenführen). Bis zu diesem einen Schritt ist
  im Repository nichts sichtbar verändert; er ist der einzige „Umschaltpunkt“.
- **Anfragen:** erster Abgleich mit 5 000 JSON-Dateien hochladen ≈ **18** (davon 12 schreibend,
  etwa eine halbe Minute), auf dem zweiten Rechner herunterladen ≈ **7**; üblicher Abgleich mit
  20 geänderten Dateien **4–5** (nur hochladen) bzw. **≈ 23** (nur holen).
- **Zugang:** fein eingestellter persönlicher Zugangsschlüssel, nur dieses eine Repository,
  „Contents: Read and write“ (Metadata: Read kommt von selbst). Kein Gerätecode-Ablauf – der wäre
  für einen einzelnen Nutzer mehr Aufwand und entweder zu weit berechtigt (OAuth-App: alle
  Repositories) oder umständlicher (GitHub-App: anlegen, installieren, Schlüssel alle 8 Stunden
  erneuern).
- **Rust:** `reqwest` (schon da) + `serde_json` (schon da) genügen; SHA-1 liefert `ring` (schon
  im Bau, `ring::digest::SHA1_FOR_LEGACY_USE_ONLY`) oder die Crate `sha1`; `base64` 0.23 und
  `flate2` 1.1 liegen schon in `Cargo.lock`, neu wäre nur `tar` 0.4 fürs Archiv.
- **Bilder:** der Ordner `media/` ist mit 1,35 GB (481 Bilder) zu groß für diesen Weg
  (`docs/WEITERARBEIT.md:327-333`). Erst nur JSON abgleichen; Bilder später mit Grenze je Bild.

## 1. Was im Projekt schon da ist (Anknüpfungspunkte, Datei:Zeile)

| Stelle | Was dort steht | Bedeutung für den Abgleich |
|---|---|---|
| `docs/WEITERARBEIT.md:168` | Bereich I: „Rust-Seite über die GitHub-API (Bäume/Blobs, kein libgit2), Zugangsschlüssel im Schlüsselbund, Abgleich beim Öffnen, nach Änderungen und beim Schließen; Dreiwegevergleich je Datei mit gespeichertem gemeinsamem Stand; Konflikte zur Entscheidung anzeigen“ | Der alte Plan trägt; diese Recherche bestätigt ihn und macht ihn genau. |
| `docs/WEITERARBEIT.md:327-333` | „Gemessen: 481 Bilder, 1,35 GB“ … „Für den Abgleich über GitHub (Bereich I) ist er mit 1,35 GB zu groß“ | Bilder nicht im ersten Schritt, siehe Abschnitt 7. |
| `src-tauri/Cargo.toml:30` | `keyring = "4"` | Schlüsselbund ist da. |
| `src-tauri/Cargo.toml:32-33` | `reqwest = { version = "0.13", default-features = false, features = ["rustls-no-provider", "http2", "system-proxy", "charset"] }`, `rustls … ["ring", …]` | **Kein** `json`-Feature: Anfragen wie in `ai.rs` mit `serde_json::to_vec` + `.body(…)` bauen. `ring` ist schon im Bau (`Cargo.lock`: ring 0.17.14). |
| `src-tauri/src/ai.rs:16-20` | feste Adresse, `KEYRING_SERVICE = "app.wayfarer.desktop"`, `KEYRING_ACCOUNT = "Claude-Key"` | Muster für den Schlüssel: gleicher Dienst, neues Konto (z. B. „GitHub-Abgleich“). |
| `src-tauri/src/ai.rs:63-118` | `KeyStore` (im Speicher gemerkt, `get`/`set`/`clear`) | Übernehmen. |
| `src-tauri/src/ai.rs:167-185` | `build_client`: `rustls::crypto::ring::default_provider().install_default()`, `redirect::Policy::none()`, `https_only`, `user_agent("Wayfarer/<Version>")` | Genau so für `api.github.com`: **keine** Weiterleitungen (der Schlüssel geht nur an eine Adresse); das Archiv ist die eine Ausnahme und wird von Hand behandelt (Abschnitt 3.6). |
| `src-tauri/src/ai.rs:201-224` | `send`: Antwort stückweise lesen, Obergrenze `MAX_BODY_BYTES` (8 MiB) | Muster für Antworten; Obergrenze für den Baum (bis 7 MB) und das Archiv größer wählen. |
| `src-tauri/src/store.rs:17-24` | `MAX_DEPTH = 4`, `MAX_FILE_BYTES = 16 MiB`, `MAX_FILES = 100_000`, `MAX_TOTAL_BYTES = 512 MiB` | Passt zu GitHubs Grenzen (Baum rekursiv: 100 000 Einträge). |
| `src-tauri/src/store.rs:26-29`, `:235` | temporäre Dateien `.wayfarer-….tmp`; `walk` übergeht alles, was mit „.“ beginnt | Der Abgleich muss dieselben Dateien übergehen; ein versteckter Ordner (z. B. `.wayfarer-abgleich/`) im Kampagnenordner wird von der Ablage nie gelesen. |
| `src-tauri/src/store.rs:189-199` | `decode` entfernt ein BOM und ersetzt ungültiges UTF-8 | **Der Abgleich muss mit den rohen Bytes rechnen**, nicht mit dem, was `store_read` der Oberfläche gibt – sonst stimmt die Blob-Kennung nicht. |
| `src-tauri/src/store.rs:323-346` | `write_atomic` (erst temporär, dann umbenennen) | Für jede geholte Datei verwenden. |
| `src-tauri/src/store.rs:384` | Testpfad `entities/Aldric (Konfliktkopie 2).json` | Solche Namen (Leerzeichen, Klammern, Umlaute denkbar) müssen als Pfad im Baum heil ankommen – JSON-Zeichenkette, kein URL-Teil; unkritisch, aber testen. |
| `src-tauri/src/watch.rs:1-6` | Überwachung meldet geänderte JSON-Dateien; „etwa weil das Cloud-Laufwerk den Spielstand des anderen Rechners abgleicht“ | Geholte Dateien kommen über diesen vorhandenen Weg in die Oberfläche („Änderungen von außen“). |
| `src-tauri/src/config.rs:1-2` | „Einstellungen der App auf diesem Rechner – bewusst NICHT im Kampagnenordner“ | Der gemeinsame Stand (Abschnitt 8) ist je Rechner verschieden und gehört ebenfalls nie ins Repository. |
| `src/data/platform.ts:175-203`, `src-tauri/src/lib.rs:290-300` | `onAppClosing` / `close-requested` / `app_close` | Hier hängt sich „Abgleich beim Schließen“ ein (mit Frist, nie blockierend). |
| `src-tauri/src/media.rs:20-27` | Bilder in `media/`, bis 96 MiB je Bild | Viel größer als das, was über die Schnittstelle sinnvoll ist (Abschnitt 7). |

## 2. Grundlagen jeder Anfrage

- Adresse: `https://api.github.com`. Kopfzeilen bei jeder Anfrage [Q9, Q10]:
  - `Authorization: Bearer <Schlüssel>` („in most cases you can use `Authorization: Bearer` or
    `Authorization: token`“),
  - `Accept: application/vnd.github+json`,
  - `X-GitHub-Api-Version: 2026-03-10` (unterstützt: `2026-03-10` und `2022-11-28`; ohne
    Kopfzeile gilt `2022-11-28`, die bis 10. 3. 2028 läuft; eine nicht mehr unterstützte Version
    gibt `410 Gone`) [Q8]. Die Änderungen von 2026-03-10 betreffen keine der hier genutzten
    Stellen (Blobs, Bäume, Commits, Refs, Archiv, `GET /user`; bei `GET /repos/{o}/{r}` fällt nur
    `has_downloads` u. Ä. weg) [Q13],
  - `User-Agent: Wayfarer/<Version>` – **Pflicht**: „Requests with no `User-Agent` header will be
    rejected“, ein ungültiger gibt 403 [Q9]. Das vorhandene Muster (`ai.rs:178`) genügt.
- Anfragen **nacheinander**, nie gleichzeitig („make requests serially instead of
  concurrently“), und zwischen schreibenden Anfragen **mindestens eine Sekunde** warten [Q7].
- Zeitgrenze der Schnittstelle: mehr als 10 Sekunden Bearbeitung → Abbruch mit Serverfehler [Q11].

### Fehlercodes, die Wayfarer unterscheiden muss

| Code | Wann | Was tun |
|---|---|---|
| 401 | Schlüssel falsch, abgelaufen oder widerrufen [Q10] | „Der Zugangsschlüssel gilt nicht mehr“ – neuen einfügen lassen. Nicht wiederholen (nach mehreren Fehlversuchen sperrt GitHub kurzzeitig mit 403). |
| 403 + `x-ratelimit-remaining: 0` | Stundengrenze erreicht [Q6] | Bis `x-ratelimit-reset` (UTC-Sekunden) warten. |
| 403 oder 429 mit `retry-after` oder Text „secondary rate limit“ | Zweitgrenze [Q6] | `retry-after` Sekunden warten; fehlt sie: mindestens eine Minute, dann länger werdend. Weiterfeuern kann zur Sperre führen. |
| 403 „Resource not accessible by personal access token“ | Recht fehlt (z. B. Contents nur lesend) [Q11] | Kopfzeile `X-Accepted-GitHub-Permissions` nennt das nötige Recht → dem Spielleiter sagen, was am Schlüssel fehlt. |
| 404 | Repository gibt es nicht **oder der Schlüssel darf es nicht sehen** (bei Privatem absichtlich 404 statt 403) [Q10, Q11]; Blob/Baum unbekannt | Name und Schlüssel prüfen lassen. |
| 409 | „The REST API will return a `409 Conflict` if the Git repository is empty or unavailable“ (unavailable = wird gerade angelegt) [Q5] | Leeres Repository: erst über die Inhalte-Schnittstelle eine Datei anlegen (Abschnitt 3.5); frisch angelegt: kurz warten. |
| 410 | API-Version nicht mehr unterstützt [Q8] | Programmfehler – Version anheben. |
| 422 bei `PATCH git/refs` | kein Vorspulen möglich: der Zweig steht nicht mehr dort, wo man dachte (Wortlaut laut Bericht: „Update is not a fast forward“) [Q4; Wortlaut nur aus Q20] | **Gewollter Schutz** → von vorn. |
| 422 bei `POST git/trees` | u. a. `sha` und `content` zugleich; Löschen einer Datei, die es nicht gibt („Returns an error if you try to delete a file that does not exist“) [Q2] | Programmfehler oder veralteter Ausgangsbaum → von vorn. |
| 502/504, Zeitüberschreitung | zu großes Paket (ein Bericht: Baum mit 20 000 Einträgen → 502) [Q17] | Paket halbieren und wiederholen. |

## 3. Die Git-Daten-Schnittstelle im Einzelnen

Alle Wege unter `/repos/{owner}/{repo}`; `owner` und `repo` unterscheiden Groß und Klein nicht.
Rechte für einen fein eingestellten Schlüssel laut Tabelle [Q12]: alle `GET` unten brauchen
„Contents: read“, alle `POST`/`PATCH`/`PUT` „Contents: write“; `GET /repos/{o}/{r}` und
`GET /user/repos` „Metadata: read“.

### 3.1 Refs [Q4]

- `GET /git/ref/heads/<zweig>` → 200 `{ "ref": "refs/heads/main", "node_id": …, "url": …,
  "object": { "type": "commit", "sha": "<40 Zeichen>", "url": … } }`; 404 wenn es den Zweig nicht
  gibt; 409 bei leerem Repository. („The :ref in the URL must be formatted as heads/<branch name>“.)
- `PATCH /git/refs/heads/<zweig>` mit `{ "sha": "<neuer Commit>", "force": false }` → 200 mit
  demselben Aufbau. `force`: „Indicates whether to force the update or to make sure the update is
  a fast-forward update. Leaving this out or setting it to false will make sure you're not
  overwriting work.“ Codes: 200, 409, 422. **Wayfarer setzt `force` nie auf `true`.**
- `POST /git/refs` (`{ "ref": "refs/heads/…", "sha": … }`) braucht Wayfarer nicht. Wichtig zu
  wissen: „You are unable to create new references for empty repositories, even if the commit
  SHA-1 hash used exists. Empty repositories are repositories without branches.“
- Billig nachsehen, ob sich etwas getan hat: dieselbe `GET`-Anfrage mit `If-None-Match: <ETag
  der letzten Antwort>`; ein `304` zählt nicht gegen die Stundengrenze [Q7].

### 3.2 Commits [Q3]

- `GET /git/commits/{sha}` → `sha`, `tree.sha`, `parents[].sha`, `message`, `author`, `committer`.
- `POST /git/commits` mit `{ "message": "…", "tree": "<Baum>", "parents": ["<bisheriger Kopf>"] }`
  → 201 mit `sha`. `parents` leer/weggelassen = Wurzel-Commit. `author` (Name, E-Mail, Datum) ist
  freiwillig: Vorgabe ist der angemeldete Nutzer zum jetzigen Zeitpunkt, `committer` folgt
  `author`. Codes: 201, 404, 409, 422.
- Vorschlag für die Nachricht (nur Zahlen, kein Inhalt der Welt):
  `Wayfarer: 20 geändert, 1 neu, 2 gelöscht (Windows-PC)`.

### 3.3 Bäume [Q2, Q16, Q17]

- `GET /git/trees/{tree_sha}?recursive=1` → `{ "sha", "url", "truncated": false, "tree": [
  { "path": "entities/abc.json", "mode": "100644", "type": "blob", "sha": "…", "size": 123 }, … ] }`.
  Grenze beim rekursiven Lesen: **100 000 Einträge und 7 MB**; darüber `truncated: true` – dann
  ohne `recursive` je Unterordner einzeln lesen („fetching one sub-tree at a time“). Bei 5 000
  Dateien mit kurzen Pfaden liegt die Antwort bei etwa 1 MB. **`truncated` immer prüfen** und bei
  `true` nicht weiterrechnen, als fehlten Dateien (sonst gälten sie als „gelöscht“!).
  `tree_sha` darf laut Seite „The SHA1 value or ref (branch or tag) name of the tree“ sein.
- `POST /git/trees` mit

  ```json
  { "base_tree": "<Baum des bisherigen Kopfs>",
    "tree": [
      { "path": "entities/abc.json",  "mode": "100644", "type": "blob", "content": "{ … }" },
      { "path": "media/bild.png",     "mode": "100644", "type": "blob", "sha": "<vorher angelegter Blob>" },
      { "path": "chronicle/alt.json", "mode": "100644", "type": "blob", "sha": null }
    ] }
  ```

  → 201 mit `sha` des neuen Baums.
  - `content`: „The content you want this file to have. GitHub will write this blob out and use
    that SHA for this entry. Use either this, or tree.sha.“ → **viele Textdateien in einer
    Anfrage, ohne Blob je Datei.** Nur Text (das Feld ist eine JSON-Zeichenkette); Binäres muss
    über einen Blob.
  - `sha: null`: „If the value is null then the file will be deleted.“
  - `base_tree`: „Entries defined in the tree parameter will overwrite items from base_tree with
    the same path.“ Ohne `base_tree` entsteht ein Baum **nur** aus den genannten Einträgen – alles
    andere gälte als gelöscht. **Immer `base_tree` setzen.**
  - Pfade mit „/“ dürfen direkt genannt werden (Unterbäume legt GitHub an).
- Größe eines Pakets: nicht dokumentiert. Berichte: ~1 500 Einträge gingen, 20 000 gaben 502
  [Q17]; Retool schickt „chunks of at most 1000 tree objects“ und verkettet sie über `base_tree`
  [Q16]. **Empfehlung:** höchstens 500 Einträge **und** höchstens ~3 MB Anfragetext je Paket;
  bei 502/Zeitüberschreitung halbieren. Verkettung: Paket 1 mit `base_tree = alter Baum` → Baum
  T1; Paket 2 mit `base_tree = T1` → T2; … der letzte Baum kommt in den Commit.

### 3.4 Blobs [Q1]

- `POST /git/blobs` mit `{ "content": "<base64>", "encoding": "base64" }` (oder `"utf-8"`) → 201
  `{ "url", "sha" }`. Codes: 201, 403, 404, 409, 422. Eine Größengrenze nennt die Seite fürs
  Anlegen nicht.
- `GET /git/blobs/{sha}`: mit `Accept: application/vnd.github.raw+json` kommen die **rohen
  Bytes** (empfohlen – kein base64 zu entpacken); sonst JSON mit `content` (base64), `encoding`,
  `size`, `sha`. „This endpoint supports blobs up to 100 megabytes in size.“
- Blobs, Bäume und Commits sind nach ihrem Inhalt benannt: dieselbe Anfrage noch einmal zu
  schicken ist harmlos (gleiche Kennung). Solange kein Ref darauf zeigt, sieht sie niemand.

### 3.5 Leeres Repository – der erste Commit [Q5, Q14]

- Die Git-Daten-Schnittstelle geht in einem leeren Repository **nicht**: 409 (siehe oben), und
  Refs lassen sich dort nicht anlegen [Q4].
- Offizieller Ausweg [Q5]: „For an empty repository, you can use the
  `PUT /repos/{owner}/{repo}/contents/{path}` REST API endpoint to create content and initialize
  the repository so you can use the API to manage the Git database.“
  `PUT /contents/README.md` mit `{ "message": "Wayfarer: Abgleich eingerichtet",
  "content": "<base64>" }` → 201; danach gibt es den Standardzweig und alles Weitere läuft normal.
  (Braucht „Contents: write“ [Q12]. Nicht gleichzeitig mit anderen Schreibanfragen schicken.)
- Einfacher für den Laien: beim Anlegen das Häkchen für eine README-Datei setzen (Abschnitt 5) –
  dann ist das Repository nie leer. Wayfarer sollte trotzdem beide Fälle können.
- Die README gehört nicht zum Spielstand: Wayfarer gleicht nur ab, was es kennt
  (`campaign.json`, `state.json`, `<sammlung>/*.json`, später `media/*`), und lässt alles andere
  im Repository unberührt (dank `base_tree` bleibt es stehen).

### 3.6 Alles auf einmal holen: das Archiv [Q14]

- `GET /tarball/{ref}` (oder `/zipball/{ref}`), `ref` = Commit-Kennung (nicht der Zweigname,
  damit Baum und Archiv sicher zum selben Stand gehören). Antwort: **302** mit `Location`.
  „For private repositories, these links are temporary and expire after five minutes.“ Leeres
  Repository: 404 nach der Umleitung.
- Umleitung **von Hand**: `Location` lesen, prüfen (https, Rechner unter `github.com` bzw.
  `githubusercontent.com`), dann **ohne** `Authorization` abrufen. `reqwest` würde den Schlüssel
  bei fremdem Rechner zwar selbst weglassen (`remove_sensitive_headers` entfernt
  `AUTHORIZATION`, `COOKIE`, … wenn Rechner, Port oder Schema wechseln) [Q22], aber die
  vorhandenen Clients folgen bewusst keiner Umleitung (`ai.rs:174`) – dabei bleiben.
- Echtheit: Das Archiv selbst hat keine Prüfsumme. **Jede entpackte Datei gegen die Blob-Kennung
  aus dem Baum prüfen** (Abschnitt 4) – stimmt sie nicht oder fehlt eine Datei, einzeln über
  `GET git/blobs` nachholen. So ist das Archiv nur ein schneller Transport, nie die Wahrheit.
- Aufbau (Vorwissen, nicht heute gelesen): `.tar.gz`, alles unter einem Oberordner
  `<owner>-<repo>-<kurze Kennung>/`, davor ein `pax_global_header`. Also: ersten Pfadteil
  abschneiden, nur gewöhnliche Dateien nehmen, Pfade wie in `store.rs:80` (`check_rel_path`)
  prüfen, Größe begrenzen.
- Für wenige geänderte Dateien lohnt das Archiv nicht (es enthält immer alles). Faustregel:
  ab etwa 100 zu holenden Dateien Archiv, darunter einzelne Blobs.

### 3.7 Nicht nehmen: Inhalte-Schnittstelle für den laufenden Abgleich [Q14]

`PUT /contents/{path}` macht je Datei einen eigenen Commit (20 Dateien = 20 Commits, 20
Schreibanfragen, kein gemeinsamer Umschaltpunkt); `GET /contents/{ordner}` listet höchstens
1 000 Dateien je Ordner. Nur für die allererste Datei eines leeren Repositorys (3.5).

## 4. Vergleichen, ohne herunterzuladen

Git benennt eine Datei nach `SHA-1("blob " + <Länge in Bytes, dezimal> + "\0" + <Bytes>)`.
Prüfwerte (Vorwissen, bitte als Test übernehmen): leere Datei →
`e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`; `"hello\n"` →
`ce013625030ba8dba906f756967f9e9ca394464a`; `"test content\n"` →
`d670460b4b4aece5915caf5c68d12f560a9fe3e4`.

- Immer über die **rohen Bytes der Datei** rechnen (nicht über `decode`, `store.rs:189`). Ohne
  Git auf dem Rechner wandelt niemand Zeilenenden um – Bytes bleiben auf Windows und Mac gleich.
- 5 000 kleine Dateien zu hashen dauert Bruchteile einer Sekunde; ein Zwischenspeicher (Größe +
  Änderungszeit) ist nicht nötig.
- Nach dem Hochladen mit `content` einmal `GET git/trees/<neuer Baum>?recursive=1` und die
  Kennungen der hochgeladenen Pfade mit den lokal gerechneten vergleichen, **bevor** der Commit
  entsteht. Das fängt jede Abweichung (BOM, ungültiges UTF-8, Fehler beim Verpacken) ab und
  kostet eine Anfrage. Dateien, die kein sauberes UTF-8 ohne BOM sind, gehen vorsorglich als
  Blob (base64) statt als `content`.

## 5. Grenzen

| Grenze | Wert | Quelle |
|---|---|---|
| Anfragen je Stunde mit Zugangsschlüssel | 5 000 (eine Antwort `304` auf eine bedingte Anfrage zählt nicht mit) | [Q6, Q7] |
| Gleichzeitige Anfragen | höchstens 100 – Empfehlung: gar keine gleichzeitig | [Q6, Q7] |
| Punkte je Minute und Endpunkt (REST) | 900; `GET` = 1 Punkt, `POST/PATCH/PUT/DELETE` = 5 Punkte → rechnerisch 180 Schreibanfragen je Minute | [Q6] |
| „Inhalte erzeugende“ Anfragen | 80 je Minute, 500 je Stunde („Some endpoints have lower content creation limits“). Ob `POST git/blobs` darunter fällt, sagt GitHub nicht. | [Q6] |
| Pause zwischen Schreibanfragen | „at least one second between each request“ | [Q7] |
| Bei Überschreitung | 403 oder 429; `retry-after` beachten, sonst `x-ratelimit-reset`, sonst ≥ 1 Minute, dann länger werdend | [Q6, Q7] |
| Baum rekursiv lesen | 100 000 Einträge, 7 MB, sonst `truncated` | [Q2, Q17] |
| Baum anlegen | nicht dokumentiert; ~1 500 Einträge gingen, 20 000 → 502; Retool: 1 000 je Paket | [Q16, Q17] |
| Blob lesen | bis 100 MB | [Q1] |
| Einzelne Datei im Repository | empfohlen ≤ 1 MB, erzwungen 100 MB; Warnung ab 50 MiB | [Q15, Q23] |
| Datei über die Schnittstelle hochladen | Berichte: 10 MB gingen, 50 MB und mehr → 422; Fit: „issues with files >10MB“ | [Q18, Q19] |
| Repository | empfohlen < 1 GB, „strongly recommended“ < 5 GB; empfohlenes Höchstmaß auf der Platte 10 GB | [Q15, Q23] |
| Einträge in einem Ordner | empfohlen ≤ 3 000 („Directory width“) – Empfehlung, kein harter Riegel; darüber werden Git-Operationen träger | [Q15] |
| Ordnertiefe | empfohlen ≤ 50 (Wayfarer: 4) | [Q15] |
| GraphQL: Anfragegröße | beobachtet: „The request payload cannot be larger than 45MB“ (Bericht eines Dritten, nicht dokumentiert) | [Q21] |

Folgen für Wayfarer:

- **Ein Blob je Datei ist für den ersten Abgleich ausgeschlossen:** 5 000 `POST git/blobs`
  wären 25 000 Punkte, bei einer Sekunde Pause über 83 Minuten, und sie stoßen an die
  Stundengrenze von 5 000 Anfragen. Zwei unabhängige Projekte sind genau daran gescheitert
  (403 nach vielen Blob-Anfragen) und haben auf `content` im Baum umgestellt [Q24, Q25].
- **Mit `content` im Baum** sind es bei 5 000 Dateien rund zehn Schreibanfragen.
- Ordner mit sehr vielen Dateien (`chronicle/`, `entities/`, `versions/`) können über die Jahre
  die empfohlenen 3 000 Einträge überschreiten. Das bricht nichts (rekursives Lesen geht bis
  100 000), aber als Hinweis für später merken; Wayfarer nutzt nie `GET /contents/{ordner}`.

## 6. Alternative: GraphQL `createCommitOnBranch` [Q26, Q27, Q28, Q21]

- Eine Anfrage an `https://api.github.com/graphql`: `branch` (`repositoryNameWithOwner` +
  `branchName`), `expectedHeadOid` („The git commit oid expected at the head of the branch prior
  to the commit“ – der Schutz), `message`, `fileChanges { additions: [{ path, contents(base64) }],
  deletions: [{ path }] }`. Antwort: neuer Commit und Ref. Inhalte dürfen binär sein; keine
  Umwandlung von Zeichensatz oder Zeilenenden; Pfade ohne führenden „/“; jeder Pfad nur einmal;
  ein zu löschender Pfad muss existieren, sonst bricht der Commit ab.
- **Vorteile:** Commit und Zweigwechsel in **einer** Anfrage, der Schutz ist eingebaut, Bilder
  gehen im selben Zug mit, die Commits sind von GitHub signiert.
- **Nachteile:** alles base64 (+33 %); Größengrenze nicht dokumentiert (beobachtet 45 MB,
  Zeitgrenze 10 s); Verfasser lässt sich nicht setzen; anderes Fehlerbild (Fehler stehen im
  Antworttext); geht nicht in einem leeren Repository (es braucht einen Zweig); zum Lesen
  braucht man REST ohnehin. Ob fein eingestellte Schlüssel hier dieselben Rechte brauchen, habe
  ich heute nicht bestätigt gefunden.
- **Urteil:** nicht nötig. Der REST-Weg braucht für den üblichen Abgleich 3–4 kleine Anfragen,
  ist vollständig dokumentiert (samt Rechte-Tabelle) und bleibt ein einziger Codepfad. GraphQL
  wäre eine spätere Abkürzung, falls die Zahl der Anfragen je stören sollte.

## 7. Bilder (binär)

- Technisch: `POST git/blobs` mit base64 je Bild (eine Schreibanfrage, eine Sekunde Abstand),
  dann im Baum mit `sha` eintragen. Holen über `GET git/blobs/{sha}` roh oder über das Archiv.
- Sinnvolle Grenze je Bild: **5 MB** als Vorgabe (GitHub empfiehlt ≤ 1 MB je Datei [Q15];
  Berichte sehen ab > 10 MB Schwierigkeiten [Q18, Q19]). Größeres wird nicht abgeglichen, sondern
  genannt („3 Bilder sind zu groß für den Abgleich“) – nie still übergangen.
- Menge: 481 Bilder / 1,35 GB (`WEITERARBEIT.md:327-333`) sprengt die Empfehlung (< 1 GB) und
  wäre beim ersten Mal 481 Schreibanfragen (≥ 8 Minuten, nahe an „500 je Stunde“, falls Blobs
  dazu zählen). Wenn Bilder dazukommen: in Paketen (z. B. 50 Bilder je Commit, jeder Commit ein
  fertiger Zwischenstand, nach einem Abbruch geht es beim nächsten weiter) und mit verkleinerten
  Fassungen. Bilder ändern sich nach dem Holen nicht mehr – ihr Abgleich ist „nur hinzufügen“.
- **Git LFS meiden:** eigener Ablauf (Batch-Schnittstelle, Zeigerdateien), eigenes Kontingent,
  und das Archiv enthält dann nur Zeiger. Passt nicht zu „ohne Git“.
- Empfehlung: **Schritt 1 nur JSON** (das ist der Spielstand; Bilder holt jeder Rechner wie
  bisher aus dem Ursprung), Bilder als eigener, abschaltbarer zweiter Schritt.

## 8. Dreiwege-Abgleich: bewährtes Muster

### 8.1 Was je Rechner gespeichert wird (nie im Repository)

```json
{ "owner": "…", "repo": "…", "branch": "main",
  "baseCommit": "<zuletzt abgeglichener Commit>",
  "baseTree": "<dessen Baum>",
  "files": { "entities/abc.json": "<Blob-Kennung>", … },
  "refEtag": "<ETag der letzten Ref-Antwort>" }
```

Ablage: im Einstellungsordner der App (wie `config.json`, `config.rs:1-2`), je Kampagnenordner
eine Datei; geschrieben mit `write_atomic`. Alternativ ein versteckter Ordner im
Kampagnenordner (`store.rs:235` übergeht ihn) – dann aber ausdrücklich vom Hochladen ausnehmen.
Genau so halten es die Vorbilder: Basalt Causeway („baseline records the last commit both sides
agreed on plus each file's blob SHA“), GitHub Enterprise Sync, Fit (SHA-1 je Datei statt
`.git`) [Q29, Q30, Q19].

### 8.2 Je Pfad: B (gemeinsamer Stand), L (lokal), R (Repository); „–“ = fehlt

| Fall | Bedeutung | Handlung |
|---|---|---|
| L = R | beide gleich (auch: beide gelöscht, beide gleich geändert) | nichts; B := L |
| L = B, R ≠ B | nur das Repository hat sich geändert | holen (oder lokal löschen, wenn R fehlt) |
| R = B, L ≠ B | nur dieser Rechner hat geändert | hochladen (oder im Baum löschen, wenn L fehlt) |
| alle drei verschieden | **beide haben geändert** (auch: einer geändert, der andere gelöscht; beide neu mit verschiedenem Inhalt) | Konflikt → der Spielleiter entscheidet; bis dahin bleibt lokal alles, wie es ist, und die Fassung des Repositorys liegt beiseite |

**„L = R“ zuerst prüfen** – dadurch ist jeder abgebrochene Lauf beim nächsten Mal von selbst
bereinigt (siehe 8.4).

Ohne gemeinsamen Stand (erster Abgleich auf einem Rechner, auf dem schon ein Spielstand liegt):
B gilt als leer. Gleiches ist gleich; Verschiedenes ist ein Konflikt mit Sammelwahl („alles von
diesem Rechner“ / „alles aus dem Repository“); **gelöscht wird ohne gemeinsamen Stand nie
etwas** (Basalt: „Deletions follow the baseline, not mere absence, so a first sync can't wipe
files“ [Q29]).

### 8.3 Ablauf eines Laufs

1. `GET git/ref/heads/<zweig>` (mit `If-None-Match`). 304 oder Kopf = `baseCommit` → das
   Repository ist unverändert, R = B, Schritte 2–3 entfallen.
2. `GET git/commits/<kopf>` → Baum; `GET git/trees/<baum>?recursive=1` → R (nur die Pfade, die
   Wayfarer abgleicht; `truncated` prüfen).
3. Lokal alle Dateien hashen → L. Je Pfad nach 8.2 einordnen.
4. **Holen:** alles zu Holende zuerst in einen Zwischenordner laden und gegen die Kennung
   prüfen; erst wenn alles da ist, Datei für Datei mit `write_atomic` an ihren Platz – und
   unmittelbar davor noch einmal prüfen, dass die lokale Datei noch die Kennung von Schritt 3
   hat (sonst hat der Spielleiter gerade weitergeschrieben → dieser Pfad wird zum nächsten Lauf
   zurückgestellt bzw. zum Konflikt). Lokales Löschen ebenso.
5. **Hochladen** (falls etwas ansteht): Bilder als Blobs; `POST git/trees` (Pakete,
   `base_tree` = Baum des Kopfs aus Schritt 1/2) → Kontrolle über `GET git/trees` →
   `POST git/commits` (`parents: [kopf]`) → `PATCH git/refs/heads/<zweig>` mit `force:false`.
6. 422 beim `PATCH` (oder 409) → der andere Rechner war schneller: **von vorn ab Schritt 1**
   (höchstens etwa dreimal, dann mit Hinweis aufhören). Die schon angelegten Bäume und Commits
   bleiben unsichtbar liegen und stören nicht.
7. Erst nach Erfolg den gemeinsamen Stand schreiben (`baseCommit`, `baseTree`, `files` – mit den
   Kennungen dessen, was tatsächlich hoch- oder heruntergeladen wurde, nicht neu von der Platte
   gelesen).

Konflikte halten den Lauf nicht auf: alles Unstrittige wird geholt und hochgeladen; für
strittige Pfade bleibt im neuen Baum die Fassung des Repositorys stehen (sie werden einfach
nicht genannt), lokal bleibt die eigene, und ihr Eintrag in `files` bleibt beim alten B. Nach
der Entscheidung des Spielleiters ist der Pfad im nächsten Lauf ein gewöhnliches „hochladen“
oder „holen“.

### 8.4 Abbruch mittendrin

- **Vor dem `PATCH`:** im Repository ist nichts sichtbar geschehen. Nächster Lauf beginnt neu;
  gleiche Blobs/Bäume ergeben gleiche Kennungen.
- **`PATCH` gelungen, gemeinsamer Stand nicht mehr geschrieben** (Absturz, Deckel zu): nächster
  Lauf sieht R ≠ B und L ≠ B, aber L = R → kein Konflikt, B wird nachgezogen.
- **Beim Einspielen geholter Dateien abgebrochen:** schon eingespielte haben L = R, die übrigen
  L = B → werden beim nächsten Lauf geholt. Der gemeinsame Stand wird erst am Ende geschrieben.
- **Ohne Netz:** Lauf endet still mit „steht noch aus“; nichts wird verändert. Wiederholen mit
  wachsendem Abstand und sobald wieder gespeichert wird; beim Schließen höchstens eine kurze
  Frist, dann zugehen lassen – der nächste Start holt es nach.
- **Was andere tun:** Basalt Causeway legt bei beidseitiger Änderung die fremde Fassung als
  `<name>.conflict-<kennung>` daneben und fasst die eigene Datei nie an [Q29]; Fit legt sie unter
  `_fit/` ab und lässt den Lauf nicht scheitern [Q19]; UltiSync warnt im eigenen README vor genau
  dem Fehler, gerade Hochgeladenes gegen einen veralteten Baum als fremde Änderung zu lesen und
  zu überschreiben [Q30] – das verhindert die Regel „L = R zuerst“ plus das Schreiben des
  gemeinsamen Stands aus dem, was wirklich hochgeladen wurde. Retool lernte: Bäume nur aus den
  geänderten Pfaden auf `base_tree` bauen (dreimal schneller), Löschungen über `sha: null`,
  Anfragen nacheinander statt gleichzeitig [Q16].
- **Für Wayfarer wichtig:** Die beiseitegelegte Fassung darf **nicht** als `.json` in einer
  Sammlung liegen – die Ablage läse sie als Dokument. Sie gehört in den versteckten Ordner bzw.
  den Einstellungsordner.

## 9. Zugangsschlüssel

### 9.1 Welcher Schlüssel, welche Rechte

- Fein eingestellter persönlicher Zugangsschlüssel („fine-grained personal access token“);
  GitHub empfiehlt ihn ausdrücklich vor dem klassischen [Q10].
- **Repository access:** „Only select repositories“ → genau das Spielstand-Repository.
- **Permissions → Repository permissions → Contents: Read and write.** Mehr braucht es nicht
  (Fit, das dasselbe tut: „the only required permission is Contents: Read and Write under
  Repository permissions“ [Q19]). „Metadata: Read“ – nötig für `GET /repos/{o}/{r}` und
  `GET /user/repos` [Q12] – wird von GitHub von selbst mitgewählt (Vorwissen).
  „Workflows“ wird **nicht** gebraucht (nur, wenn man Dateien unter `.github/workflows` schriebe).
- **Ablauf:** Über die vorbelegte Adresse sind 1–366 Tage oder `none` (läuft nie ab) möglich;
  Vorgabe 30 Tage. „Infinite lifetimes are allowed but may be blocked by a maximum lifetime
  policy“ (das betrifft Organisationen, nicht das eigene Konto) [Q31]. GitHub entfernt Schlüssel,
  die ein Jahr lang nicht benutzt wurden [Q31, Q32]. Höchstens 50 fein eingestellte Schlüssel je
  Konto [Q31].
  Empfehlung: **ohne Ablauf** – der Schlüssel darf nur dieses eine private Repository lesen und
  schreiben und liegt im Schlüsselbund; ein ablaufender Schlüssel würde den Laien einmal im Jahr
  mitten in der Vorbereitung aussperren. Wer lieber ein Jahr wählt: Wayfarer erkennt den Ablauf
  am 401 und sagt klar, was zu tun ist.
- Derselbe Schlüssel kann auf beiden Rechnern eingefügt werden; sauberer sind zwei („Wayfarer
  Windows“, „Wayfarer Mac“), dann lässt sich einer einzeln widerrufen.

### 9.2 Wie Wayfarer den Schlüssel prüft

1. `GET /user` → 200 mit `login` (401 = Schlüssel ungültig) [Q33].
2. `GET /user/repos?per_page=100` („Metadata: read“ [Q12]) → die Repositories, die der Schlüssel
   sieht. Genau eines mit `private: true` und `permissions.push: true` → dieses vorschlagen;
   mehrere → wählen lassen; keines → „Der Schlüssel passt auf kein privates Repository mit
   Schreibrecht“. (Dass ein auf ein Repository beschränkter Schlüssel hier nur dieses liefert,
   ist zu erwarten, aber heute nicht belegt – beim Bau prüfen.)
3. `GET /repos/{owner}/{repo}` → `private`, `default_branch`, `permissions { admin, maintain,
   push, triage, pull }`, `archived`, `disabled` [Q34]. Wayfarer verlangt `private == true`
   (**öffentliches Repository ablehnen** – dort läge der Spielstand offen), `permissions.push ==
   true`, nicht archiviert. 404 = Name falsch oder Schlüssel gilt nicht für dieses Repository.
4. `GET git/ref/heads/<default_branch>` → 200 (bereit), 409 (leer → 3.5).

Der Schlüssel wird nie in den Kampagnenordner, in `config.json`, in ein Protokoll oder eine
Fehlermeldung geschrieben; die Oberfläche bekommt nur „hinterlegt: ja/nein“, Anmeldename und
Repository (wie `aiStatus`).

### 9.3 Anleitung für den Spielleiter (GitHubs Seite ist englisch; die Wörter stehen so dort)

**A. Privates Repository anlegen** [Q35]

1. Auf github.com anmelden.
2. Oben rechts auf das **+** klicken → **New repository**.
   (Abkürzung, die Wayfarer als Knopf anbieten kann:
   `https://github.com/new?name=wayfarer-spielstand&visibility=private` – Name und Sichtbarkeit
   sind dann schon ausgefüllt.)
3. **Owner:** das eigene Konto. **Repository name:** z. B. `wayfarer-spielstand` (nur
   Buchstaben, Ziffern, `.`, `-`, `_`).
4. Sichtbarkeit: **Private**.
5. Das Häkchen für eine README-Datei setzen („Add a README file“ – genaue Beschriftung
   Vorwissen), sonst nichts wählen. (Vergisst er es: Wayfarer legt die erste Datei selbst an.)
6. **Create repository**.

**B. Zugangsschlüssel erzeugen** [Q31]

1. Oben rechts auf das Profilbild → **Settings**.
2. Links ganz unten **Developer settings**.
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
   (Abkürzung als Knopf in Wayfarer:
   `https://github.com/settings/personal-access-tokens/new?name=Wayfarer&description=Abgleich+des+Spielstands&expires_in=none&contents=write`
   – Name, Ablauf und das Recht „Contents: Read and write“ sind dann schon gesetzt. Das
   Repository lässt sich so **nicht** vorwählen; Schritt 6 bleibt Handarbeit.)
4. **Token name:** `Wayfarer`. 5. **Expiration:** „No expiration“ (oder ein Datum).
6. **Resource owner:** das eigene Konto. **Repository access:** **Only select repositories** →
   im Feld darunter `wayfarer-spielstand` wählen.
7. **Permissions** → **Repository permissions** → bei **Contents** „Read and write“ wählen.
8. **Generate token** (ggf. bestätigen).
9. Die angezeigte Zeichenfolge (beginnt mit `github_pat_`, wird nur dieses eine Mal gezeigt –
   Vorwissen) kopieren und in Wayfarer unter „Abgleich“ einfügen. Wayfarer prüft sie sofort,
   zeigt Konto und Repository und fragt, ob der Spielstand dieses Rechners hochgeladen oder der
   aus dem Repository geholt werden soll.

Reihenfolge beachten: erst das Repository, dann der Schlüssel – sonst gibt es in Schritt 6
nichts zu wählen.

### 9.4 Alternative: Anmeldung über Gerätecode (Device Flow) [Q36, Q37, Q38]

- Ablauf: `POST https://github.com/login/device/code` (`client_id`) → `user_code` (8 Zeichen),
  `verification_uri` (`https://github.com/login/device`), `interval` 5 s, gültig 900 s. Der
  Nutzer öffnet die Seite, tippt den Code, bestätigt. Wayfarer fragt derweil
  `POST https://github.com/login/oauth/access_token` (`client_id`, `device_code`,
  `grant_type=urn:ietf:params:oauth:grant-type:device_code`) ab. Kein Geheimnis im Programm
  („The `client_secret` is not needed for the device flow“); im Programm steht nur die
  Client-Kennung. Der Ablauf muss in den Einstellungen der App bei GitHub eingeschaltet sein.
- Voraussetzung: Jemand (der Spielleiter selbst) muss bei GitHub einmal eine **App
  registrieren**.
  - Als **OAuth-App**: Das nötige Recht `repo` gilt für **alle** Repositories des Kontos, auch
    die privaten – weit mehr als nötig, keine Beschränkung auf eines.
  - Als **GitHub-App**: Beschränkung auf ein Repository geht, aber der Nutzer muss die App
    zusätzlich auf seinem Konto **installieren** und dabei das Repository wählen; der
    Zugangsschlüssel (`ghu_…`) läuft nach 8 Stunden ab und wird mit einem Erneuerungsschlüssel
    (`ghr_…`, 6 Monate, bei jeder Nutzung neu) erneuert – beides gehört dann in den
    Schlüsselbund, je Rechner (das Ablaufen lässt sich in den App-Einstellungen abwählen).
- **Empfehlung: nicht bauen.** Für einen einzelnen Nutzer ist der Schlüssel einmal neun Klicks
  (mit vorbelegter Adresse weniger), danach nie wieder etwas, und er ist am engsten berechtigt.
  Der Gerätecode lohnt erst, wenn Wayfarer an viele Leute ginge.

## 10. Rust

- `reqwest` 0.13 wie vorhanden; JSON über `serde_json::to_vec` / `from_slice` (das
  `json`-Feature ist nicht eingeschaltet, `Cargo.toml:32` – so lassen, Muster `ai.rs:201-224`).
  Ein eigener Client für `api.github.com` (`redirect::Policy::none()`, `https_only(true)`,
  `user_agent`, Zeitgrenzen), ein zweiter ohne Schlüssel für die Archiv-Adresse.
- **SHA-1:** `ring` 0.17.14 steht schon in `Cargo.lock` (über `rustls`); als direkte
  Abhängigkeit eintragen und `ring::digest::digest(&ring::digest::SHA1_FOR_LEGACY_USE_ONLY, …)`
  bzw. `digest::Context` nutzen [Q39] – keine neue Crate im Bau. Üblich und gepflegt wäre sonst
  `sha1` (RustCrypto, 0.11.0 stabil, zuletzt aktualisiert Juli 2026, ~685 Mio. Downloads) [Q40].
  („Legacy“ ist hier unbedenklich: Die Kennung dient nur dem Vergleich mit dem, was GitHub
  selbst rechnet, nicht der Sicherheit.)
- **base64:** `base64` 0.23.1 (marshallpierce/rust-base64, aktualisiert August 2026; in
  `Cargo.lock` schon als 0.21.7 und 0.23.1 vorhanden) [Q41]. Gebraucht für Bilder
  (`POST git/blobs`) und die README im leeren Repository. Beim Lesen von Blobs die rohe Fassung
  verlangen, dann braucht man es dort nicht.
- **Archiv:** `flate2` 1.1.11 (rust-lang, aktualisiert 6. 11. 2026; schon in `Cargo.lock`) +
  `tar` 0.4.46 (aktualisiert Mai 2026, ~290 Mio. Downloads; **neu**) [Q42, Q43]. Wer `tar`
  vermeiden will: einzelne Blobs holen (5 000 Anfragen – gerade an der Stundengrenze, also nur
  mit Pausen über mehr als eine Stunde) – das Archiv ist klar besser.
- Laufzeit: wie bisher `tauri::async_runtime`; Dateiarbeit in `spawn_blocking` (`lib.rs:33`).
- Tests ohne Netz: Der Client bekommt wie in `ai.rs:167` die Adresse hereingereicht; ein kleiner
  lokaler Gegenpart (Muster `ai.rs:342`, `legendkeeper.rs:440`) spielt GitHub. Die
  Dreiwege-Regel (8.2) ist reine Logik und gehört mit vielen Fällen getestet – ohne Netz.

## 11. Vor dem Bau einmal nachprüfen (Probe gegen ein Wegwerf-Repository)

Nicht aus heute gelesener GitHub-Dokumentation belegt – Vorwissen oder Berichte Dritter:

1. Wortlaut und Code bei `PATCH git/refs` ohne Vorspulen (erwartet 422 „Update is not a fast
   forward“) und bei leerem Repository (erwartet 409 „Git Repository is empty.“).
2. Wie groß ein `POST git/trees` mit `content` sein darf (500 Einträge / 3 MB annehmen, messen)
   und wie lange er dauert (10-Sekunden-Grenze).
3. Dass `content` Byte für Byte ankommt (Umlaute, `\r\n`, kein Zeilenende am Schluss) – die
   Kontrolle in Abschnitt 4 deckt es ohnehin ab.
4. Dass `GET /user` und `GET /user/repos` mit einem auf ein Repository beschränkten Schlüssel
   gehen und was `GET /user/repos` dann liefert.
5. Aufbau des Archivs (Oberordner, `pax_global_header`) und Rechner der Umleitung
   (`codeload.github.com`).
6. Ob viele `POST git/blobs` hintereinander unter „80 je Minute / 500 je Stunde“ fallen
   (betrifft nur Bilder).
7. Beschriftungen auf GitHubs Seite („Add a README file“, „No expiration“, „Read and write“),
   Vorsilbe `github_pat_`, „wird nur einmal gezeigt“, „Metadata“ von selbst gewählt.
8. Ob `GET git/trees/{commit-kennung}` direkt geht (spart eine Anfrage; der sichere Weg über
   `GET git/commits` steht oben).
9. Ob die Antwort eine Kopfzeile mit dem Ablaufdatum des Schlüssels trägt
   (`github-authentication-token-expiration`, Vorwissen; auf der heute gelesenen Seite [Q32]
   steht sie nicht) – wäre schön für „läuft in 14 Tagen ab“.
10. GraphQL nur, falls man es doch will: Rechte des fein eingestellten Schlüssels, 45-MB-Grenze.

## 12. Empfehlung mit Zahl der Anfragen

**Lesen:** Ref → Commit → Baum rekursiv; lokal hashen und vergleichen; einzelne Blobs roh
holen, ab etwa 100 Dateien das Archiv des Commits (mit Prüfung jeder Datei gegen den Baum).
**Schreiben:** Baum mit `base_tree` und `content` (Pakete zu 500), Kontrolle, Commit,
`PATCH` des Refs mit `force:false`; Bilder vorher einzeln als Blob.

**(a) Erster Abgleich, 5 000 JSON-Dateien**

| Schritt | Anfragen |
|---|---|
| Schlüssel prüfen: `GET /user`, `GET /repos/{o}/{r}` | 2 |
| `GET git/ref`, `GET git/commits`, `GET git/trees?recursive=1` (Repository enthält nur die README) | 3 |
| `POST git/trees` in Paketen zu 500 (verkettet) | 10 |
| Kontrolle `GET git/trees/<neu>?recursive=1` | 1 |
| `POST git/commits`, `PATCH git/refs` | 2 |
| **Summe hochladen (Windows)** | **18**, davon 12 schreibend (60 Punkte); mit einer Sekunde Pause etwa 20–40 Sekunden |
| Zweiter Rechner (Mac, leerer Ordner): `GET /user`, `GET /repos`, `GET git/ref`, `GET git/commits`, `GET git/trees?recursive=1`, `GET tarball/<commit>` + Abruf der Umleitung | **7**, alle lesend |

Zum Vergleich der verworfene Weg „ein Blob je Datei“: 5 000 Schreibanfragen, > 83 Minuten,
Stunden- und Zweitgrenze gerissen.
Sind die Dateien größer als gedacht (Pakete nach 3 MB statt nach 500 Stück geschnitten), werden
aus 10 Baum-Anfragen entsprechend mehr – auch 50 wären noch unkritisch.

**(b) Üblicher Abgleich, 20 geänderte Dateien**

| Lage | Anfragen |
|---|---|
| Nichts zu tun (Repository unverändert, lokal nichts) | 1 (`GET git/ref`, meist 304 = zählt nicht) |
| 20 lokal geändert, Repository unverändert | `GET git/ref` + `POST git/trees` + Kontrolle `GET git/trees` + `POST git/commits` + `PATCH git/refs` = **5** (ohne Kontrolle 4), 3 schreibend, ~4 Sekunden |
| 20 im Repository geändert, lokal nichts | `GET git/ref` + `GET git/commits` + `GET git/trees` + 20 × `GET git/blobs` = **23**, alle lesend |
| Beides (je 20, verschiedene Dateien) | 23 + 4 = **27** |
| Der andere Rechner kommt dazwischen (422) | noch einmal von vorn: + 5 bis + 27 |

Bei 5 000 Anfragen je Stunde ist das alles weit unter jeder Grenze; selbst ein Abgleich alle
zwei Minuten bliebe bei etwa 30 Anfragen je Stunde.

## 13. Fallstricke (Sammlung)

1. **Ohne `base_tree` löscht ein neuer Baum alles nicht Genannte.** Immer setzen.
2. **`truncated: true` nicht beachten** hieße: fehlende Dateien gelten als gelöscht → lokal
   würde gelöscht. Bei `true` abbrechen bzw. Unterordner einzeln lesen.
3. **Rohe Bytes hashen**, nicht den Text aus `decode` (`store.rs:189`), sonst falsche Kennung
   bei BOM/ungültigem UTF-8 → Dauer-„Änderung“.
4. **Leeres Repository:** 409 auf allen Git-Daten-Stellen; erste Datei über `PUT /contents/…`.
5. **404 heißt bei privaten Repositories auch „kein Zugriff“** – nicht als „gibt es nicht“ melden.
6. **Nie `force: true`.** 422 beim `PATCH` ist der Schutz, kein Fehler.
7. **Nie gleichzeitig anfragen; zwischen Schreibanfragen ≥ 1 s;** `retry-after` beachten, sonst
   droht eine Sperre.
8. **Kein Blob je JSON-Datei** – `content` im Baum. Blobs nur für Binäres.
9. **Öffentliches Repository ablehnen** (`private` prüfen) – sonst läge der Spielstand offen.
10. **Schlüssel nur an `api.github.com`;** Umleitung des Archivs ohne `Authorization` und nur
    zu GitHubs Rechnern; Schlüssel nie in Meldungen oder Dateien.
11. **Gemeinsamer Stand je Rechner, nie im Repository**, und erst nach gelungenem `PATCH`
    schreiben – mit den Kennungen des tatsächlich Übertragenen.
12. **Während des Laufs wird weitergeschrieben:** vor dem Überschreiben einer lokalen Datei
    ihre Kennung noch einmal prüfen.
13. **Beiseitegelegte Konfliktfassungen nie als `.json` in eine Sammlung** – die Ablage läse sie
    als Dokument (`store.rs:107`, `:235`).
14. **Ohne gemeinsamen Stand nie löschen** (erster Abgleich).
15. **`state.json` und `campaign.json` ändern sich auf beiden Rechnern fast immer** (Weltzeit,
    Brett, Ansichten). Wird nicht vor und nach jeder Sitzung abgeglichen, ist hier der häufigste
    Konflikt zu erwarten – für diese beiden lohnt ein Zusammenführen nach Feldern statt „ganze
    Datei, entweder – oder“. (Nicht Teil dieser Recherche, aber für den Kollegen, der die
    Zusammenführung baut.)
16. **Groß/Klein und Zeichenformen in Dateinamen:** Git unterscheidet `Abc.json` und
    `abc.json`, Windows und der Mac (Vorgabe) nicht; der Mac kann Umlaute in Namen anders
    zerlegt speichern. Solange Dateinamen Kennungen aus ASCII sind, unkritisch – zwei Pfade im
    Baum, die sich nur darin unterscheiden, als Problem melden statt einen zu überschreiben.
17. **Bilder:** 1,35 GB gehören nicht in dieses Repository; Grenze je Bild, in Paketen, eigener
    Schritt. Kein LFS.
18. **API-Version festschreiben** (`2026-03-10`); 410 heißt „Wayfarer aktualisieren“.
19. **Schlüssel läuft ab oder wird nach einem Jahr ohne Nutzung entfernt:** 401 klar erklären
    („neuen Schlüssel erzeugen und einfügen“), der Spielstand bleibt dabei unberührt.
20. **`GET /contents/{ordner}`** listet nur 1 000 Dateien – nie zum Auflisten nehmen.

## 14. Quellen

„Heute gelesen“ = am 15. 11. 2026 abgerufen. Vorwissen ist im Text jeweils so genannt.

| Nr. | Adresse | Wofür | Heute gelesen |
|---|---|---|---|
| Q1 | https://docs.github.com/en/rest/git/blobs | Blobs anlegen/lesen, 100 MB, rohe Fassung, Codes | ja |
| Q2 | https://docs.github.com/en/rest/git/trees | Bäume: `content`, `sha: null`, `base_tree`, `recursive`, `truncated`, 100 000 / 7 MB | ja |
| Q3 | https://docs.github.com/en/rest/git/commits | Commits anlegen/lesen | ja |
| Q4 | https://docs.github.com/en/rest/git/refs | Refs lesen/setzen, `force`, leere Repositories | ja |
| Q5 | https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-your-git-database | 409 bei leerem Repository, Ausweg über `PUT contents`, Reihenfolge der Schritte | ja |
| Q6 | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api | 5 000/h, Zweitgrenzen, Punkte, Kopfzeilen | ja |
| Q7 | https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api | nacheinander, 1 s Pause, 304 zählt nicht | ja |
| Q8 | https://docs.github.com/en/rest/about-the-rest-api/api-versions | Versionen 2026-03-10 / 2022-11-28, 410 | ja |
| Q9 | https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api | Kopfzeilen, User-Agent Pflicht | ja |
| Q10 | https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api | Bearer, 401/403/404 | ja |
| Q11 | https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api | 404 statt 403, `X-Accepted-GitHub-Permissions`, 10-s-Grenze | ja |
| Q12 | https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens | Rechte je Endpunkt (Contents, Metadata) | ja |
| Q13 | https://docs.github.com/en/rest/about-the-rest-api/breaking-changes?apiVersion=2026-03-10 | was sich mit 2026-03-10 ändert | ja |
| Q14 | https://docs.github.com/en/rest/repos/contents | `PUT contents`, Größen, 1 000 Dateien je Ordner, Archiv (302, fünf Minuten, 404 bei leer) | ja |
| Q15 | https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits | Ordnerbreite 3 000, 1 MB/100 MB je Datei, 10 GB | ja |
| Q16 | https://retool.com/blog/gotchas-git-github-api | Pakete zu 1 000, `base_tree`, nacheinander (Erfahrungsbericht) | ja |
| Q17 | https://github.com/orgs/community/discussions/23748 | 100 000 / 7 MB (Antwort von GitHub), 20 000 Einträge → 502 (Nutzerbericht) | ja |
| Q18 | https://github.com/orgs/community/discussions/155856 | 422 bei 50 MB und mehr über die Schnittstelle (Nutzerbericht) | ja |
| Q19 | https://raw.githubusercontent.com/joshuakto/fit/main/README.md | Fit: Rechte, `_fit/`, Dateigrößen | ja |
| Q20 | Suchergebnis zu „Update is not a fast forward“ (Spiegel einer Stack-Overflow-Frage) | Wortlaut der 422 | nur als Suchauszug |
| Q21 | https://github.com/dlworrell/code-noodling/pull/153 | GraphQL: „payload cannot be larger than 45MB“ (Bericht) | ja |
| Q22 | https://docs.rs/reqwest/latest/src/reqwest/redirect.rs.html | `remove_sensitive_headers` (reqwest 0.13.5) | ja |
| Q23 | https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github | 50 MiB Warnung, 100 MiB Sperre, < 1 GB / < 5 GB | ja |
| Q24 | https://github.com/penta2himajin/github-mcp-proxy/pull/11 | 397 Blob-Anfragen rissen die 900 Punkte; Umstieg auf `content` im Baum | ja |
| Q25 | https://github.com/thodel/agentic_historian/pull/489 | 403 nach vielen Blob-Anfragen; Umstieg auf `content` im Baum | ja |
| Q26 | https://docs.github.com/en/graphql/reference/commits | `createCommitOnBranch`, `expectedHeadOid` | ja |
| Q27 | https://docs.github.com/en/graphql/reference/git | `FileChanges`, `FileAddition`, `FileDeletion`, `CommittableBranch` | ja |
| Q28 | https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api | GraphQL-Grenzen, 10 s | ja |
| Q29 | https://community.obsidian.md/plugins/basalt-causeway | vier Anfragen je Abgleich, Baseline, Konfliktdateien | ja |
| Q30 | Suchergebnis zu Obsidian-Plugins (UltiSync, GitHub Enterprise Sync, GitHub Vault Relay) | gespeicherter Stand, bekannter Fehler | nur als Suchauszug |
| Q31 | https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens | Schlüssel anlegen, vorbelegte Adresse, `expires_in` 1–366/`none`, 50 Stück | ja |
| Q32 | https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation | Ablauf, Entfernen nach einem Jahr | ja |
| Q33 | https://docs.github.com/en/rest/users/users | `GET /user` | ja |
| Q34 | https://docs.github.com/en/rest/repos/repos | `GET /repos/{o}/{r}`: `private`, `default_branch`, `permissions` | ja |
| Q35 | https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository | Repository anlegen, Adresse mit `name`/`visibility` | ja |
| Q36 | https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps | Gerätecode-Ablauf | ja |
| Q37 | https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app | GitHub-App: `ghu_`, 8 Stunden, nur installierte Repositories | ja |
| Q38 | https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens | Erneuern ohne Geheimnis beim Gerätecode, 6 Monate | ja |
| Q39 | https://docs.rs/ring/latest/ring/digest/index.html | `SHA1_FOR_LEGACY_USE_ONLY` (ring 0.17.14) | ja |
| Q40 | https://crates.io/api/v1/crates/sha1 | Version, Pflege | ja |
| Q41 | https://crates.io/api/v1/crates/base64 | Version, Pflege | ja |
| Q42 | https://crates.io/api/v1/crates/flate2 | Version, Pflege | ja |
| Q43 | https://crates.io/api/v1/crates/tar | Version, Pflege | ja |

Nicht erreichbar: https://deepwiki.com/joshuakto/fit (429). Nichts Privates wurde in Suchen oder
Abrufen verwendet (keine Namen, Pfade oder Inhalte des Projekts).
