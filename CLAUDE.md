# Wayfarer

Digitaler Spielleiterschirm für eine Pen-&-Paper-Kampagne (D&D 2024, Welt „Elaris“). Installierte
Desktop-App für macOS und Windows (Tauri 2 + React + TypeScript). Ein Nutzer: der Spielleiter, am
Tisch mit Laptop und zur Vorbereitung.

## Die Idee

Weltwissen, Gruppe, Zeit und das, was tatsächlich am Tisch passiert, hängen zusammen:

- Öffnet man einen **Ort**, sieht man, wer dort eine Rolle spielt, wann die Gruppe dort war und was
  sich seitdem verändert hat.
- Öffnet man eine **Person**, sieht man ihre Haltung zur Gruppe mit Verlauf, ihre Beziehungen,
  offene Abmachungen und wo sie gerade ist.
- Die **Chronik** ist das Rückgrat: Ortswechsel, Notizen, Haltungsänderungen, eingetretene Termine,
  Abmachungen und Veränderungen der Welt. Besuche und „seitdem verändert“ werden daraus abgeleitet.
- Die **Weltzeit** läuft nur, wenn der Spielleiter sie vorstellt; dabei treten Termine ein –
  und die Schritte der **Uhren**: Vorhaben der Welt, die ohne die Gruppe weiterlaufen
  (`domain/clock.ts`). Die Schritte schreibt der Spielleiter, Wayfarer führt Buch. Was
  währenddessen geschah, meldet es nach Gewicht geordnet (`shell/meanwhile.ts`).
- Wayfarers Weltdatenbank ist führend. LegendKeeper wird nur gelesen und verknüpft, nie beschrieben.
  Ziel ist, ohne LegendKeeper auszukommen: Das eigene Wiki (`features/wiki`) hält alle Artikel und
  Karten im Spielstand; übernommen werden sie aus der Exportdatei („.lk“).
- **Geschrieben wird in Wayfarer.** Ein Artikel ist Text (Markdown mit `[[Verweisen]]`, Kästen
  wie `> [!steckbrief]` und `> [!geheim]`), geschrieben in einem Editor mit gesetzter Ansicht
  und Quelltext. Das Ziel dahinter: aus geschriebenem Text eine simulierte Welt machen – der
  Spielleiter schreibt und verbindet, Wayfarer liest daraus, was es wissen muss, statt dass
  Datensätze gepflegt werden.
- Geschichte und Welt schreibt der Spielleiter – nie eine KI und nie Wayfarer. Wayfarer liest,
  was geschrieben ist, rechnet, leitet ab und simuliert nach festen Regeln. Keine mitgelieferten
  Beispielinhalte. In der App steht nur, was der Spielleiter geschrieben, eingetragen, übernommen
  oder ausdrücklich angenommen hat.
- **KI nur als Leser** (Entscheidung des Spielleiters, 11. 11. 2026): Ein Sprachmodell darf die
  Artikel lesen und vorschlagen, was daraus für die Welt folgt (`features/ki`). Es schreibt keine
  Geschichte, ändert nichts von selbst und wird am Tisch nie gebraucht: Jeder Vorschlag nennt
  den Satz, aus dem er stammt, und gilt erst, wenn der Spielleiter ihn annimmt. Zeit, Wetter,
  Reisen und alles Erzeugte rechnen weiter nach festen Regeln, ohne Netz. Der KI-Leser ist
  freiwillig (eigener Claude-Key, Abrechnung nach Textmenge); ohne ihn fehlt Wayfarer nichts.
- **Was erzeugt werden darf:** „Wo andere Spielleiter Zufallstabellen nutzen, nutzen wir
  Wayfarer.“ Alles Prozedurale erzeugt Wayfarer selbst und nach festen, wiederholbaren Regeln:
  Gelände und Hexkarten zwischen zwei Orten (auch ohne vorher angelegte Karte), Wetter,
  Begegnungen und Entdeckungen unterwegs, Beiwerk-NSC. Dabei erkennt es aus der Welt, was für ein
  Gebiet das ist, wie groß es ist und was dort liegt.
- **Was nie erzeugt wird:** alles, was für die Geschichte wichtig ist – Handlung, bedeutende
  Personen und Orte, Geheimnisse, Abmachungen. Das kommt vom Spielleiter.
- Erzeugtes ist als solches erkennbar, lässt sich von Hand übersteuern und bleibt stabil
  (gleicher Ausgangswert → gleiches Ergebnis), damit eine Rückreise dieselbe Welt vorfindet.
- Leitbild (ausführlich in `docs/FUNKTIONSUMFANG.md`): ein starkes Werkzeug für die Spielleitung,
  das die Welt simuliert, durch die die Gruppe läuft (Zeit, Wetter, Reisen), möglichst viel selbst
  erkennt und ableitet statt abzufragen, und beim Leiten nicht stört.
- Geleitet wird an einem MacBook Air 13" (etwa 1440×900), vorbereitet an einem Windows-PC.
- **Das Repository ist privat** (seit 12. 11. 2026, vorher öffentlich). Namen aus der Kampagne
  dürfen in Beispielen und Unterlagen stehen. Trotzdem nie einen Spielstand, ein Backup oder
  Schlüssel einchecken – auch nicht als Testmaterial: Der Spielstand gehört in den
  Kampagnenordner, und was einmal im Verlauf steht, bleibt dort. Tests nutzen weiter erfundene
  Welten. Die Prüfungen bei GitHub kosten jetzt Freiminuten (Windows doppelt, macOS zehnfach).

Dies ist ein Neubau. Die alte Version (v157) ist nur Ideenquelle; Code, Aufbau und Oberfläche werden
nicht übernommen.

## Aufbau

- Erzeugtes (Hexkarten, Namen, später Wetter) rechnet mit `domain/random.ts` (`rngOf`,
  `seedOf`), nie mit `Math.random`; Hexfelder mit `domain/hex.ts`, Gelände und Reisetage mit
  `domain/terrain.ts`.
- `src/domain/` – reine Fachlogik ohne React: Kalender-Engine (`time/calendar.ts`), Elaris-Kalender
  als Daten (`time/elaris.ts`), Datenmodell (`schema.ts`, zod), Beziehungsarten und Haltungsskala
  (`relations.ts`), abgeleitete Sichten (`derive.ts`). Mit Tests.
- `src/data/` – Ablage und Spielstand: `store.ts` (Kampagnenordner als Schnittstelle), `db.ts`
  (geladener Spielstand, Speichern, Änderungen von außen), `actions.ts` (Befehle über mehrere
  Dokumente: Zeit vorstellen, Ort wechseln, Haltung setzen, festhalten …), `hooks.ts` (React),
  `platform.ts` (Brücke zur Tauri-Seite), `seed.ts` (Elaris-Grundstand). Die erfundene Beispielwelt liegt nur noch als Testmaterial in
  `data/__fixtures__/demoWorld.ts` und darf in der App nicht auftauchen.
- `src/ui/` – Designsystem: `tokens.css`, `base.css`, `ui.css`, Bausteine in `components.tsx`,
  `entity.tsx`, `chronicle.tsx`, `moon.tsx`. Alles über `import { … } from '../../ui'`.
- `src/shell/` – Gerüst: Navigation, Weltleiste, Dialoge. `commands.ts` enthält die Handgriffe, die
  jede Seite auslösen kann (`openQuickLog`, `openAttitude`, `openMoveParty`, `openSearch`,
  `openTimeDialog`). Die Suche (`search.ts`, `searchWorld`) findet alles, was der Spielleiter
  angelegt hat – eine neue Sammlung, die man finden soll, dort eintragen. Soll ein Treffer auf
  einer Seite ohne eigene Adresse etwas öffnen (Karte des Fadenbretts, Uhr, Tag), geht das über
  `focus.ts` (`focusOn`, `useFocus`).
- **Navigation** (`features/registry.ts`): sieben Einträge – Spieltisch, Welt, Zeit,
  Fadenbrett, Bestiarium, Gefährten, Karten. Verwandte Seiten stehen als Reiter unter einem
  Eintrag (`shell/AreaTabs`): „Zeit“ = Kalender, Chronik und Weltgeschehen; „Bestiarium“ = Wesen,
  Begegnungen und Bestände; „Karten“ = Weltkarte (`atlas`),
  Karten (`karten`), Hexkarten (`erkundung`). „Welt“ ist Weltdatenbank und Wiki in einem:
  `features/welt` zeigt die Seite (eine Übersicht mit „Nach Art“ und „Ordner“, eine Suche auch
  im Text), `features/wiki` liefert die Bausteine (`ArticleTree`, `ArticlePage`,
  `WikiStart`). Ein Ding hat eine Seite: `/wiki/<id>` führt zur Seite des Eintrags, wenn der
  Artikel einem gehört – dort ist er der Reiter „Text“. Vor einem neuen Eintrag in der
  Navigation prüfen, ob er als Reiter oder als Teil der Welt passt (Entscheidung des
  Spielleiters, 12. 11. 2026: „vieles ist drin, dadurch ist einiges unübersichtlich geworden“).
- `src/features/<bereich>/` – je ein Arbeitsbereich: `tisch`, `welt`, `chronik`, `kalender`,
  `gruppe`, `erkundung` (Hexkarten), `wiki` (eigene Artikel schreiben und lesen, Editor unter `wiki/editor`, Übernahme des
  LegendKeeper-Exports),
  `wetter` (Anzeige; die Rechnung steht in `domain/weather.ts` und `domain/weatherZone.ts`),
  `unterreich` (unter der Erde zeigt das Feld des Wetters Licht, Sicht und Umgebung; die
  Rechnung steht in `domain/underground.ts`),
  `wege` (Wege zwischen Orten anlegen und gehen – das Wegenetz, Pointcrawl; die Rechnung steht
  in `domain/ways.ts`),
  `karten` (Karten zeichnen und ansehen: Zeichenfläche `MapEditor`, Formen `shapes.ts`,
  Zeichner `draw.ts`; was
  eine Stelle oder Linie bedeutet, steht in `domain/mapDraw.ts`),
  `atlas` (der Planet: Weltkarte, Kugel, Lage der Orte, Landmassen aus Kartenbildern; die
  Rechnung auf der Kugel steht in `domain/geo.ts`, das Lesen von Bildern in `atlas/trace.ts`),
  `ki` (der KI-Leser: Auftrag, Antwort prüfen, Vorschläge am Artikel),
  `bestiarium` (Wesen bauen, als Text übernehmen, finden, am Tisch würfeln; die Rechnung steht
  in `domain/creature.ts`, das Lesen von Text in `bestiarium/parse.ts`),
  `faeden` (das Fadenbrett: Geschichten und Fäden nach Nähe zur Gruppe; die Rechnung steht in
  `domain/story.ts`),
  `einstellungen`, `import`, `legendkeeper`. `index.tsx` exportiert die Seite als default.
- `src-tauri/` – Rust-Seite: Dateizugriff auf den Kampagnenordner, Dateiüberwachung,
  LegendKeeper-Abruf, Anfragen an Claude (`ai.rs`), Schlüsselbund, Bilder (`media/` im Kampagnenordner, Schema `wfmedia`). Die Befehle stehen als Vertrag in `src/data/platform.ts`.

## Daten

- Eine Kampagne ist ein Ordner mit JSON-Dateien: `campaign.json`, `state.json` und je Dokument eine
  Datei unter `entities/`, `relations/`, `chronicle/`, `events/`, `sessions/`, `timers/` sowie
  (seit der zweiten Welle) `maps/`, `paths/`, `journeys/`, `mounts/`, `climates/`, `weather/`,
  `areas/`, `tables/`, `rests/`, `articles/`, `atlas/`, `clocks/`, `threads/`, `stories/`, `creatures/`, `encounters/`, `stocks/`, `runs/`. Die Liste der Sammlungen steht einzig in `COLLECTION_SCHEMAS`
  (`src/domain/schema.ts`); leere Sammlungen liefert `emptyCollections()`. Eine neue Sammlung
  gehört außerdem in `LATER_COLLECTIONS` (ältere Sicherungen kennen sie nicht) und bekommt eine
  Bezeichnung in `einstellungen/backup.ts` und `einstellungen/model.ts`.
- Mac und Windows teilen sich den Spielstand über ein privates GitHub-Repository (Entscheidung des
  Spielleiters; er nutzt kein Cloud-Laufwerk). Der Abgleich ist Teil der zweiten Welle, siehe
  `docs/WEITERARBEIT.md`. Bis dahin: Sicherung herunterladen / einspielen.
- Weltzeit = ganze Minuten seit Beginn des absoluten Jahres 1 (bei Elaris: kosmisches Jahr, JF).
  Der Kalender ist Daten (`CalendarDef`), nie fest im Code.
- Änderungen laufen über `db.put / patch / remove / setState` oder die Befehle in `actions.ts`.
  Was mehrere Dokumente betrifft (Zeit, Ort, Haltung), gehört in `actions.ts`, nicht in die Oberfläche.
- Ungültige oder fremde Dateien werden nie überschrieben, nur gemeldet (`db.problems`).
- Lage: Orte tragen `place.geo` (Länge, Breite). Gefragt wird immer über `placeGeo()` – nie
  direkt über `place.geo`: Orte ohne eigene Lage bekommen sie aus einer Wiki-Karte, auf der
  zwei andere Orte eine Lage haben (`geoIndex`), sonst erben sie die des Ortes darüber.
  Ein Ort kann auch eine **Fläche** sein: Ein Kontinent ist die Landmasse gleichen Namens (oder
  die ihm von Hand zugeordnete, `land.placeId`), eine Kontinentalwelt umfasst die Landmassen
  ihrer Kontinente (`landOwners`, `placeLands`). Seine Lage ist dann die Mitte der Fläche –
  ungefähr, nie `exact`. Der Planet zum Fragen (`planetOf`, `terrainAt`,
  `coastKm`, `placeGeo`) steht in `domain/planet.ts`; die Oberfläche nimmt ihn aus
  `atlas/model.ts`, das alles weiterreicht. Aus der Lage folgen Klima (`domain/geoClimate.ts`),
  Sonnenstand (`sunAt`) sowie Strecke und Gelände der Hexkarten (`erkundung/generate.ts`,
  `groundOf`). Der Planet selbst
  (Küsten, Höhen) liegt in der Sammlung `atlas` und stammt aus der Übernahme des alten Atlas;
  seine Daten gehören zur Kampagne und nie ins Repository. Landmassen, die der Spielleiter aus
  einem Kartenbild einliest (`addLand`, Kennung `bild-…`), liegen im selben Dokument, haben
  keine Höhen und bleiben, wenn die Weltdatei neu eingelesen wird. Land zum Zeichnen immer über
  `landPaths()` holen – es kennt Ringe um die Pole und Land, das über anderem liegt.
- Verwandtschaft: Eine Beziehung mit `kin` sagt, was `from` für `to` ist (`sibling`, `aunt` …,
  `domain/kin.ts`). Eingetragen wird über `setKin` (`welt/kin.ts`); alles Weitere leitet
  Wayfarer ab: was sicher folgt (`kinClosure`, `derivedKin`, `relativesOf`), Generationen und
  den Stammbaum einer Familie als Genogramm (`domain/kinTree.ts`). Was nur naheliegt, wird
  vorgeschlagen (`kinSuggestions`) und gilt erst, wenn der Spielleiter es annimmt. Nie
  Zwischenpersonen erfinden, um einen Baum zu füllen.
- KI-Leser: Ein offener Punkt ist eine Abmachung (kommt in die Chronik) oder ein Geheimnis
  (`threadSort`) – Wissen und Nichtwissen stehen ohne Datum im Feld „Geheimnis“ des Eintrags,
  nie als heutiger Eintrag der Chronik. Vergangenes kommt nur mit eigenem Datum in den Kalender.
- Kalender: Was im Kalender steht, entscheidet `eventWeight()` (`domain/weight.ts`), nie die
  Oberfläche: Tägliches ist Alltag, Wöchentliches zählt nur am Ort der Gruppe, Einmaliges, Feste
  und alles an einem offenen Faden immer. Alltag wird geführt, aber nur am Tag gezeigt. Neue
  Listen von Terminen („Anstehend“, Meldungen) filtern mit `isEveryday()`.
- Geschichten und Fäden (`stories/`, `threads/`): geschrieben vom Spielleiter (oder als
  Vorschlag des KI-Lesers angenommen), nie erzeugt. Nähe zur Gruppe, Berührungen und Warnungen
  leitet `domain/story.ts` ab – Verbindungen zwischen Geschichten werden nie von Hand gezogen.
  Ruf ist keine eigene Angabe: `reputeOf()` liest die Haltungen des Antreibers zur Gruppe und zu
  Gefährten; ob ein Einstieg passt, sagt `entryFit()`, was am Ort der Gruppe bereitliegt
  `storiesHere()`.
  Geändert wird über `features/faeden/actions.ts`.
- Bestiarium (`creatures/`): Vorlage, Variante, Einzelner erben über `parentId`. Gelesen wird
  ein Wesen immer über `resolveCreature()` (`domain/creature.ts`), gerechnet über `statsOf()`,
  `attackMath()`, `saveDcOf()` – nie Werte aus `creature.block` direkt zeigen: Was fehlt, ist
  geerbt. Nichts wird mitgeliefert; Monster aus Büchern liegen nur im Kampagnenordner, Tests
  nutzen erfundene Wesen. Würfe am Tisch sind echter Zufall (`fairDie`), kein fester Ausgangswert.
  Begegnungen (`encounters/`) sind Listen von Exemplaren mit eigenen Trefferpunkten; gelesen
  über `encounterView()`, die Schwierigkeit folgt dem EP-Budget der aktiven Gefährten.
  Bestände (`stocks/`, `domain/stock.ts`) sind Baue und Horte an Orten; Verluste kommen nur
  über `loseFromGroup` oder `bookLosses` hinein, Bewohner nur über `fieldFromStock` in eine
  Begegnung – so wird niemand doppelt gezählt.
- Wege: Ein Weg (`paths/`) verbindet zwei Orte und hat eine Dauer – fest in Minuten oder aus
  seiner Länge gerechnet (`wayMinutes`). Orte sind die Punkte, Wege die Verbindungen
  (`waysFrom`, `routeBetween`). Die Gruppe bewegt sich über `walk` / `walkRoute`
  (`features/wege/actions.ts`): Erst vergeht die Zeit des Weges, dann kommt sie an – nie den Ort
  wechseln und die Zeit getrennt stellen, wenn ein Weg bekannt ist.
  Das Wetter wirkt auf Wege (`domain/wayState.ts`): verschlammt, verschneit, nicht passierbar –
  nie gespeichert, immer aus dem Wetter der letzten Tage gerechnet (`wayCondition`). Wer eine
  Dauer zeigt oder eine Route sucht, nimmt `waysFrom` / `routeBetween`; `wayMinutes` ist die
  Dauer bei trockenem Wetter. Wer im Viertel steht, steht auch in der Stadt: `routeBetween`
  nimmt die Wege der Orte darüber, wenn vom Ort selbst keiner zum Ziel führt, und lässt am Ziel
  den Ort gelten, in dem es liegt – angekommen ist die Gruppe bei `route.toId`.
- Wer an einem Ort ist, sagt `placeCast()` (`domain/derive.ts`): Tote und Verschollene sind nie
  anwesend, sie stehen für sich in `lost`.
- Lebendige Welt: Was eindeutig folgt, geschieht von selbst und still (Zustand statt Meldung);
  alles, was Geschichte ist, bleibt Vorschlag. Was abseits der Gruppe geschieht, sammelt
  `worldTurn()` (`domain/worldTurn.ts`) für die Seite „Weltgeschehen“ – nach Gewicht
  (`turnWeight`), Beobachtetes (`state.watch`) zuerst. Neue Quellen dort eintragen, nicht in
  der Oberfläche. Regelmäßige Abläufe (`runs/`, `domain/runs.ts`) laufen nach Fahrplan von
  selbst; ob eine fragliche Fahrt ausfällt, ist ein Vorschlag (`suggestions`) und wird nur über
  `decideTrip` entschieden. Eine Uhr, deren Schritt an einem ausgebliebenen Ablauf hängt,
  bleibt beim Zeitsprung blockiert stehen (`clock.blocked`) – sie plant nie von selbst um.
- Gezeichnete Karten: Eine Karte mit `kind: 'drawn'` ist kein Bild, sondern Formen –
  Pinselstriche Gelände (`strokes`, der spätere liegt oben), Linien (`lines`: Straße, Pfad,
  Fluss, Grenze) und Punkte (`markers`). Was an einer Stelle ist, fragt man über `groundAt()`,
  wie lange eine Linie zu Fuß dauert über `walkAlong()` – nie selbst über die Striche rechnen.
  Verbindet eine Straße oder ein Pfad zwei Orte der Welt, legt `drawLine`
  (`features/karten/actions.ts`) den Weg dazu an; seine Dauer bleibt offen (`minutes: null`)
  und folgt der Karte. Gezeichnet wird nur über diese Befehle, damit Wege und Rückgängig
  mitziehen. Farben der Karte: nur `--map-*`. Jede Ebene hat ihr Gelände (`LEVEL_GROUNDS`):
  unter der Erde ist Fels der Grund, die Straße heißt „Gang“ (`lineLabel`) und gräbt sich durch
  den Fels; ein Raum ist ein Strich mit stumpfen Enden (`paintRect`). Wasser, Fels und Abgrund
  zeichnet `draw.ts` als Flächen mit Rand (`SOLID`) – neues Gelände dieser Art dort eintragen.
  Türen und Fallen sind Zeichen (`map.signs`): Sitzen sie auf einer Straße, einem Gang oder
  einem Pfad, gelten sie für den Weg darüber – eine verschlossene Tür versperrt ihn
  (`way.barred`; `routeBetween` weicht aus), Fallen und Geheimtüren meldet `routeNotes()`.
  Ein Geheimgang ist eine Linie mit `secret`; geändert wird über `setLineSecret`, damit der
  Weg mitzieht.
  Gezeichnet werden nie die Striche selbst, sondern die Formen daraus (`karten/shapes.ts`:
  Raster, bewegter Rand, Umrisse, Stellen der Zeichen) – runde Pinselkleckse hat der
  Spielleiter als hässlich verworfen. Zeichenfläche (`MapEditor`) und Ansicht am Spieltisch
  (`MapPeek`) teilen sich die Bühne `useMapStage`; wo die Gruppe auf einer Karte steht, sagt
  `markerOfPlace()`.
- Unter der Erde: Ob ein Ort unten liegt, fragt man über `isUnderground()` (Klima „Unter der
  Erde“: festgelegt, von einer gezeichneten Unterreich-Karte abgelesen – `placesBelow` – oder
  aus den Namen gelesen). Dort gibt es keinen Himmel: statt Wetter zählen
  die Helligkeit des Ortes (`place.light`, sonst errechnet), die Lichter der Gruppe (Wirkungen
  der Art `light`) und die Dunkelsicht der Gefährten – alles über `lightStatus()`.
- Bilder: Im Spielstand steht die Adresse des Ursprungs; zum Anzeigen immer `useMediaSrc()` aus
  `data/media.ts` nehmen – dann kommt die Datei vom Rechner, wenn sie geholt wurde.
- Artikel: Der Text jeder Seite (`ArticleDoc.text`) ist die Quelle; die Anzeige liest ihn mit
  `pageNodes()` aus `wiki/text.ts`. Den Dialekt (beide Richtungen) beschreibt
  `wiki/markdown.ts`. Verweise gehen über den Titel (`linkIndex`); Umbenennen, Anlegen und
  Löschen laufen über `wiki/actions.ts`, damit Verweise mitziehen. Vor solchen Handgriffen
  `flushEdits()` aus `wiki/editing.ts` aufrufen – ein offener Editor speichert dann zuerst.
  Ein Artikel und ein Eintrag gleichen Namens sind dasselbe Ding: `linkTwins()` verbindet sie
  von selbst (nur wenn eindeutig) – nie einen zweiten Eintrag für einen Namen anlegen, den es
  schon gibt.
- Steckbrief und Welt: Die Zeilen „Feld: Wert“ im Steckbrief eines Artikels speisen den Eintrag
  der Welt, der zu ihm gehört (`wiki/facts.ts`, `syncFacts`). Der Artikel gilt, wenn sich sein
  Wortlaut ändert; sonst bleibt, was von Hand geändert wurde (`entity.fromArticle`). Neue
  Bezeichnungen für Felder gehören in `VOCABULARY`, nicht in die Oberfläche.
- Erkennen ohne Klammern: Namen anderer Artikel im Text werden beim Lesen zu Verweisen
  (`wiki/names.ts`), Daten des Kalenders anklickbar (`domain/time/textDates.ts`), Sätze wie
  „Schwester von X“ zu Vorschlägen für Beziehungen (`wiki/sentences.ts`). Das sind Sichten auf
  den Text – der Text bleibt, wie er geschrieben wurde, und Vorschläge trägt nur der Spielleiter
  ein.

## Regeln für Code

- TypeScript strikt, keine `any`. Bezeichner englisch, alle sichtbaren Texte deutsch.
- Sichtbare Texte: klare, ganze Wörter, kein Fachjargon der Entwicklung, keine englischen
  Regelbegriffe, wenn es ein deutsches Wort gibt („Kurze Rast“, nicht „Short Rest“).
- Fachlogik als reine Funktion in `src/domain/` oder im eigenen Bereich (`features/x/model.ts`),
  mit Test. Komponenten rechnen nicht selbst.
- Nur Farben, Schriften und Abstände aus `tokens.css`. Erst die Bausteine aus `src/ui` verwenden;
  eigenes CSS je Bereich in `features/x/x.css` mit Klassenpräfix `wf-<bereich>-`.
- Keine weiteren Abhängigkeiten ohne guten Grund. (Der Editor nutzt CodeMirror 6; er wird erst
  geladen, wenn geschrieben wird.)
- Kein Zustand im Browser-Speicher außer über `BrowserStore` (Vorschau).

## Gestaltung

Dark Fantasy: geschwärztes Holz, Pergament als Schrift, angelaufenes Messing als Akzent, Blutrot
nur für Gefahr und Überfälliges. Es soll wie ein hochwertiges Werkzeug aus der Spielwelt wirken,
nicht wie ein Admin-Dashboard.

- Schriften: Cormorant Garamond (Namen, Überschriften), Cinzel (kleine Versalien für Etiketten und
  Navigation), Crimson Pro (Fließtext und Bedienelemente).
- Werkstoffe: Das Gerüst ist Holz (`tex-holz`), jede Fläche (`Panel`, Dialog) eine Unterlage aus
  dunklem Leder (`tex-leder`) mit Messingbeschlägen an den vier Ecken. Messing als Fläche trägt
  nur der Knopf für die eine wichtige Handlung einer Ansicht (`variant="primary"`) – höchstens
  einer je Ansicht, sonst verliert er seinen Sinn. „Festhalten“ in der Weltleiste ist deshalb
  nur am Spieltisch aus Messing; Knöpfe in Leerzuständen, Listen und Reitern sind gewöhnliche,
  wenn die Seite schon einen hat. Ein Dialog ist eine eigene Ansicht.
- Abschnittstitel in Versalien, Zierlinie (`Divider`).
- **Keine Bilder als Schmuck in Arbeitsflächen** (Entscheidung des Spielleiters, 11. 11. 2026:
  „Die Bilder stören mehr, als dass sie gut aussehen“). Gemalt sind nur das Startbild und das
  App-Symbol; alles Weitere kommt aus Werkstoff, Schrift und Abstand. Bildmaterial liegt in
  `src/ui/assets`, ist mit Higgsfield erzeugt und zeigt nie etwas aus der Welt des Spielleiters.
- Lesbarkeit: kein Schriftgrad unter `--text-2xs`; gedämpfte Schrift nur über `--ink-mute` und
  `--ink-faint`, nie dunkler.
- Dichte: am Tisch muss man mit einem Blick finden, was man sucht. Lieber wenige, klar gegliederte
  Flächen als viele Kästen. Keine leeren Flächen ohne Hinweis, was hier hingehört.
- Für Desktop gebaut: 1280 × 800 bis 1920 × 1080. Kein Mobil-Layout.

## Weitere Dokumente

- `docs/FUNKTIONSUMFANG.md` – was Wayfarer können soll (vom Spielleiter).
- `docs/WEITERARBEIT.md` – Stand, Plan der zweiten Welle, offene Fragen, Aufräumliste.
- `docs/KONZEPT-WELT-UND-KARTEN.md` – lebendige Welt („Die Welt dreht sich weiter“, Uhren mit
  Bedingungen, Abläufe, Wissen) und intelligente Karten aus Vektoren; dazu Leiten in der Sandbox
  (Fadenbrett), Bestiarium, „Alles ist ein Artikel“ und Beute. Probe in `docs/proben/`.

## Befehle

- `npm run dev` – Vorschau im Browser auf Port 1420 (Elaris-Grundstand, Speicherung im Browser;
  `?reset` vor dem `#` setzt die Vorschau zurück).
- `npm run typecheck`, `npm test`, `npm run build`.
- `npm run tauri dev` / `npm run tauri build` – installierte App.
