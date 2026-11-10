# LegendKeeper-API – geprüfte Fakten (Koordinator, vor Baubeginn dieses Bereichs)

Zuerst lesen. Diese Punkte sind gegen die echte Schnittstelle geprüft:

- In dieser Entwicklungsumgebung ist ein echter API-Key hinterlegt. Der Netzwerk-Proxy setzt ihn
  in jede HTTPS-Anfrage an `www.legendkeeper.com` ein. Es genügt irgendein Platzhalter im Header:
  `curl -sS -L -H 'Authorization: Bearer proxy-injected' -H 'Accept: application/json' <url>`.
  Der Key selbst ist nirgends lesbar und darf nirgends auftauchen.
- Basis: `https://www.legendkeeper.com/api/v3`.
- `GET /projects/?limit=2` → `{ data: [{ id, name, isPublic, createdAt, coverImageUrl,
  coverGradient, lastActivityAt }], hasMore, nextCursor }`. Der Key des Nutzers gehört zu genau
  einem Projekt.
- Alle weiteren Pfade hängen unter dem Projekt: `/projects/{projectId}/resources`,
  `/projects/{projectId}/search`, … Ohne dieses Präfix antwortet der Server mit einer
  HTML-404-Seite (kein JSON!) – das muss die Fehlerbehandlung erkennen.
- Die API leitet auf Pfade mit abschließendem „/“ um; Weiterleitungen folgen oder den
  Schrägstrich gleich anhängen.
- Listen sind seitenweise: `{ data, hasMore, nextCursor }`, Parameter `cursor` und `limit`.
- Der Tauri-Befehl `lk_get({ path, query })` bekommt den Pfad relativ zur Basis, also
  einschließlich `/projects/{projectId}/…`. Die Projekt-ID ermittelt die Zugriffsschicht einmal
  über `/projects/` und merkt sie sich.

Regel: Die Welt des Nutzers ist privat. Echte Antworten nur zum Verstehen der Struktur ansehen;
keine Namen, Texte oder IDs daraus in Code, Tests, Fixtures oder Berichte übernehmen. Fixtures
immer mit erfundenen Inhalten in derselben Struktur anlegen.

Diese Datei nach getaner Arbeit durch eine kurze eigene Notiz zur Schnittstelle ersetzen oder löschen.
