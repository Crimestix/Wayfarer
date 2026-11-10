# LegendKeeper-Anbindung – Notizen zur Schnittstelle

Wayfarer liest aus LegendKeeper und schreibt dort nie. Dieser Ordner enthält alles dazu.

## Die API

- Offizielle Beschreibung (OpenAPI 3.1): `https://www.legendkeeper.com/api/v3/openapi.json`.
  Daran und an echten Antworten ist diese Anbindung ausgerichtet.
- Basis `https://www.legendkeeper.com/api/v3`, Anmeldung `Authorization: Bearer <API-Key>`.
  Ein Key gehört zu genau einem Projekt (in LegendKeeper: Project Settings → Developers → API Keys;
  setzt einen bezahlten Tarif voraus).
- Wayfarer nutzt nur diese GET-Pfade:

  | Pfad                                             | Wofür                                                             |
  | ------------------------------------------------ | ----------------------------------------------------------------- |
  | `/projects?limit=1`                              | Projekt des Keys (Kennung, Name); zugleich die Verbindungsprüfung |
  | `/projects/{p}/resources?limit=100&cursor=…`     | Verzeichnis aller Artikel (seitenweise)                           |
  | `/projects/{p}/resources/{id}`                   | Artikel: Dokumente, Seitenleiste, Pfad (`ancestors`), Banner      |
  | `/projects/{p}/resources/{id}/docs/{doc}/blocks` | Inhalt einer Seite als Blöcke                                     |
  | `/projects/{p}/search?q=…&limit=30`              | Volltextsuche (Namen und Inhalte)                                 |

- Listen: `{ data, hasMore, nextCursor }`. Fehler (jeder Status ab 400): `{ message, code, requestId }`.
- Adressen außerhalb `/projects/…` beantwortet LegendKeeper mit einer **HTML-404-Seite**; das wird
  als „unerwartete Antwort“ erkannt, nicht als „Artikel fehlt“ (`errors.ts`).
- Grenzen je Key: 300 Anfragen pro Minute, 6 000 pro Stunde. Das Verzeichnis kostet eine Anfrage
  je 100 Artikel und wird 15 Minuten gemerkt, Artikel 5 Minuten, Suchen 1 Minute. Ist danach
  keine Verbindung da (oder LegendKeeper gestört), gilt die ältere Antwort weiter, solange die App
  läuft – „Aktualisieren“ dagegen meldet ehrlich, dass es nicht geklappt hat.
- Übersichtsseiten listen ihre Unterartikel in LegendKeeper oft über einen Block, den die
  Schnittstelle nur als `unsupported` liefert. Wayfarer zeigt die Unterartikel deshalb selbst aus
  dem Verzeichnis an („Darunter in LegendKeeper“).
- Vorlagen hängen unter dem gedachten Artikel `templates` und stehen in der Artikelliste mit drin;
  das Verzeichnis lässt sie weg (`catalog.ts`).
- Bilder liegen öffentlich auf `assets.legendkeeper.com` und werden direkt als `<img>` geladen.
- Artikel im Browser: `https://www.legendkeeper.com/p/{projekt}/{artikel}/[{dokument}/]`.
- Ein Artikel hat mehrere Dokumente: `page` (Text – wird gelesen), `blank` (leer – wird übergangen),
  `map`, `board`, `time` (nur als Link nach LegendKeeper).
- `unsupported` heißt: LegendKeeper selbst gibt diesen Block oder diese Eigenschaft nicht heraus.
  Blöcke werden an Ort und Stelle zum Hinweis; Eigenschaften der Seitenleiste stehen gesammelt am
  Fuß des Artikels. Die Eigenschaft „Tags“ entfällt, weil die Schlagworte im Kopf stehen.
- Geheime Blöcke und verborgene Seiten liefert die API nur einem Key mit Admin-Rechten.

## Aufbau des Ordners

- `client.ts` – Zugriff: `lkGet(path, query)`, Zwischenspeicher, Zusammenlegen gleicher Anfragen,
  Abbruch, seitenweises Laden. Zwei Wege: installierte App (`lk_get` der Rust-Seite, Key im
  Schlüsselbund) und Browser-Vorschau (Entwicklungs-Proxy `/lk-api`, siehe `vite.config.ts`).
- `errors.ts` – Fehlerarten und ihre deutschen Erklärungen.
- `model.ts` – Blöcke, Textläufe und Eigenschaften → Knoten der Anzeige. Unbekanntes wird nie
  verschluckt: Text wird gerettet, sonst erscheint ein Hinweis.
- `catalog.ts` – Verzeichnis, Baum, Suche nach Titel, Vorschläge zu einem Eintragsnamen, Trefferliste.
- `state.ts` – Stand der Verbindung und Verzeichnis, einmal für die ganze App.
- `status.ts` – Zustandszeile der Einstellungen.
- `index.tsx` – die Schnittstelle zum Rest: `LkArticlePanel({ link, onLink, suggest? })` und
  `LegendKeeperSettings()`. Dazu `ArticleView.tsx`, `Article.tsx`, `Finder.tsx`, `Settings.tsx`.
- `fixtures/` – erfundene Beispielantworten im echten Aufbau; `__tests__/` – Tests.

## Regel

Die Welt des Nutzers ist privat. In Code, Tests, Fixtures und Notizen steht nichts aus echten
Antworten – keine Namen, Texte oder Kennungen. Fixtures haben erfundene Inhalte im selben Aufbau.
