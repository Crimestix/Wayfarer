# Beispielantworten der LegendKeeper-API

Erfundene Inhalte (Beispielwelt aus `src/data/seed.ts`) im Aufbau echter Antworten der
LegendKeeper-API v3. Der Aufbau wurde gegen die offizielle Beschreibung
(`https://www.legendkeeper.com/api/v3/openapi.json`) und gegen echte Antworten abgeglichen;
aus der echten Welt stammt hier nichts – keine Namen, keine Texte, keine Kennungen.

Verwendet von den Tests in diesem Ordner und von den Playwright-Skripten, die die Oberfläche
gegen nachgestellte Antworten prüfen.

| Datei | Entspricht |
| --- | --- |
| `projects.json` | `GET /projects?limit=1` |
| `resources-1.json`, `resources-2.json` | `GET /projects/{p}/resources` (zwei Seiten, mit Vorlagen) |
| `resource.json` | `GET /projects/{p}/resources/{id}` |
| `blocks.json` | `GET /projects/{p}/resources/{id}/docs/{doc}/blocks` |
| `blocks-secrets.json` | dasselbe für eine zweite, verborgene Seite |
| `search.json` | `GET /projects/{p}/search?q=…` |
| `error-401.json`, `error-404.json`, `error-429.json` | Fehlerantworten |
| `not-api.html` | Antwort auf eine Adresse, die es in der API nicht gibt (HTML statt JSON) |
