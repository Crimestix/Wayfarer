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
- **Nie einschränken, nur Hinweise** (Grundsatz des Spielleiters, 14. 11. 2026: „Wayfarer soll den
  Spielleiter nie einschränken – gerade in der Kreativität. Es soll Hinweise geben, aber nie
  einschränken.“): Arten, Einordnungen und Vorlagen helfen beim Finden und Vorschlagen, filtern
  aber nie etwas weg; am Tisch bleibt immer ein freier Weg (freie Zeile, eigener Wert, trotzdem
  tun).
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
  Eintrag (`shell/AreaTabs`): „Zeit“ = Kalender, Chronik, Zeitleiste, Nachtragen und Weltgeschehen; „Fadenbrett“ = Fadenbrett, Abend vorbereiten, Handouts und Noch offen; „Gefährten“ =
  Gefährten und Beute-Buch; „Bestiarium“ = Wesen,
  Begegnungen und Bestände; „Karten“ = Weltkarte (`atlas`),
  Karten (`karten`), Wegenetze (`wegenetz`), Hexkarten (`erkundung`). „Welt“ ist Weltdatenbank und Wiki in einem:
  `features/welt` zeigt die Seite (eine Übersicht mit „Nach Art“, „Ordner“ und „Netz“, eine
  Suche auch im Text), `features/wiki` liefert die Bausteine (`ArticleTree`, `ArticlePage`,
  `WikiStart`). Ein Ding hat eine Seite: `/wiki/<id>` führt zur Seite des Eintrags, wenn der
  Artikel einem gehört – dort ist er der Reiter „Text“. Vor einem neuen Eintrag in der
  Navigation prüfen, ob er als Reiter oder als Teil der Welt passt (Entscheidung des
  Spielleiters, 12. 11. 2026: „vieles ist drin, dadurch ist einiges unübersichtlich geworden“).
- `src/features/<bereich>/` – je ein Arbeitsbereich: `tisch`, `welt`, `chronik`, `kalender`,
  `gruppe`, `beute` (das Beute-Buch; die Rechnung steht in `domain/loot.ts`), `erkundung` (Hexkarten), `wiki` (eigene Artikel schreiben und lesen, Editor unter `wiki/editor`, Übernahme des
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
  `wegenetz` (Strecken und Gegenden vorbereiten: Punkte auf einem Blatt, Wege dazwischen, was
  dort wartet – im Gespräch „Point Crawl“, in der App nie so genannt; die Rechnung steht in
  `domain/net.ts`),
  `faeden` (das Fadenbrett: eine Pinnwand aus Geschichten, losen Fäden und den Namen, an denen
  sie hängen; die Rechnung steht in `domain/story.ts`),
  `abend` (den nächsten Abend vorbereiten; die Rechnung steht in `domain/prep.ts`),
  `nachtragen` (alte Sessions aus Notizdateien: lesen, trennen, in die Weltzeit legen,
  übernehmen),
  `laden` (Läden und Handelsplätze: Handel am Tisch, Abschnitt „Laden“ auf Seiten, Vorlagen
  für Ladenarten; die Rechnung steht in `domain/shop.ts`, `domain/market.ts` und
  `domain/shopTemplate.ts`, das Lesen von Preislisten in `domain/priceList.ts`),
  `fortbewegung` (Reittiere, Fahrzeuge, Schiffe: Kasten auf der Gefährten-Seite, Umschalter
  `TravelBy`, Überfahrten am Spieltisch; die Rechnung steht in `domain/mounts.ts` und
  `domain/crossing.ts`),
  `einstellungen`, `import`, `legendkeeper`. `index.tsx` exportiert die Seite als default.
- `src-tauri/` – Rust-Seite: Dateizugriff auf den Kampagnenordner, Dateiüberwachung,
  LegendKeeper-Abruf, Anfragen an Claude (`ai.rs`), Schlüsselbund, Bilder (`media/` im Kampagnenordner, Schema `wfmedia`). Die Befehle stehen als Vertrag in `src/data/platform.ts`.

## Daten

- Eine Kampagne ist ein Ordner mit JSON-Dateien: `campaign.json`, `state.json` und je Dokument eine
  Datei unter `entities/`, `relations/`, `chronicle/`, `events/`, `sessions/`, `timers/` sowie
  (seit der zweiten Welle) `maps/`, `paths/`, `journeys/`, `mounts/`, `climates/`, `weather/`,
  `areas/`, `tables/`, `rests/`, `articles/`, `atlas/`, `clocks/`, `threads/`, `stories/`, `creatures/`, `encounters/`, `stocks/`, `runs/`, `nets/`, `preps/`, `loot/`, `tracks/`, `handouts/`, `bastions/`, `guesses/`, `shops/`, `assortments/`. Die Liste der Sammlungen steht einzig in `COLLECTION_SCHEMAS`
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
  Eine angenommene Abmachung steht an dem Tag, an dem sie getroffen wurde: aus der Antwort, sonst
  aus dem zitierten Satz, sonst vom Spielleiter in der Karte gesetzt; ohne Tag vor dem Beginn der
  Mitschrift – nie auf „jetzt“, nie in der Zukunft, nie im laufenden Abend (`promiseWhen` in
  `ki/reader.ts`).
- Kalender: Was im Kalender steht, entscheidet `eventWeight()` (`domain/weight.ts`), nie die
  Oberfläche: Tägliches ist Alltag, Wöchentliches zählt nur am Ort der Gruppe, Einmaliges, Feste
  und alles an einem offenen Faden immer. Alltag wird geführt, aber nur am Tag gezeigt. Neue
  Listen von Terminen („Anstehend“, Meldungen) filtern mit `isEveryday()`.
- Jahreszeiten: Der Spielleiter legt sie im Kalender fest (`calendar.seasons`, je Jahreszeit
  Name und Monate, in den Einstellungen je Monat gewählt); leer = vier gleiche Viertel um den
  wärmsten Monat. Gefragt wird immer über `seasonsAt()` (`domain/seasons.ts`) – nie selbst um
  den wärmsten Monat rechnen. Die üblichen Wörter („Herbst“) meinen die eigene Jahreszeit dieses
  Namens, sonst die mit den meisten errechneten Herbstmonaten; im Süden ein halbes Jahr versetzt.
- Geschichten und Fäden (`stories/`, `threads/`): geschrieben vom Spielleiter (oder als
  Vorschlag des KI-Lesers angenommen), nie erzeugt. Eine Geschichte schreibt man auf ihrem
  **Blatt** (`faeden/StoryPage`, `/geschichte/<id>`): worum es geht, was auf dem Spiel steht,
  die Schritte ihrer Uhr, Fragen (Fäden) mit Hinweisen, Einstiege, Szenen und Begegnungen, Ende
  und Belohnung – ohne „Speichern“, über `patchStory`, `setStorySteps`, `patchThread`. Was noch
  fehlt, sagt `storyAdvice()` als Rat (drei Hinweise je Frage, `HINTS_WANTED`), nie als Pflicht.
  **Uhren gehören zu Geschichten** (Entscheidung des Spielleiters, 13. 11. 2026): Im Kalender
  gibt es keine mehr. Eine Uhr entsteht mit dem ersten Schritt auf dem Blatt und geht mit der
  Geschichte; `ClockDialog` ist nur noch zum Eingreifen da. Uhren ohne Geschichte aus früheren
  Ständen (`looseClocks`) werden über `storyFromClock` zu einer. Nähe zur Gruppe, Berührungen und Warnungen
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
  Gebaut wird auf der Seite `bestiarium/CreatureEditor` (nie wieder ein Dialog): Entwurf,
  Vorschau und Rückgängig über `bestiarium/draft.ts`; Regelbegriffe, Abwehr, Sprachen, die
  Bibliothek der Fähigkeiten (`featureLibrary`), Gerüste (`FEATURE_TEMPLATES`) und Platzhalter
  im Text (`fillPlaceholders`, `[SG KON]`) in `domain/creatureParts.ts`. Was in der Welt fehlt
  (Spezies, Sprache, Fähigkeit), legt `keepInWorld` an – gibt es den Namen schon, bleibt es bei
  dem Eintrag. Gerüste sind leere Formen in eigenen Worten, nie Buchtexte. Abbrechen räumt nur
  weg, was dort gerade entstanden ist (`addToWorld` sagt `created`), nie einen Eintrag, den es
  schon gab. Zahlen hält `clampNumber` in den Grenzen des Schemas, `draftProblem` prüft Art
  gegen die Erben; wird eine Variante zur Vorlage, schreibt `switchKind` ihr das Geerbte ein.
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
- Fortbewegung: Ein Fortbewegungsmittel ist ein Eintrag in `mounts` (`domain/mounts.ts`) mit
  den Reisedaten – Art (Reittier, Fahrzeug, Schiff), Besitzer (null = die Gruppe), Tempo in
  Meilen je Stunde oder am Tag, Plätze, Ladung, Besatzung, Unterhalt, Zustand; sein Name und
  Artikel in der Welt hängen optional über `entityId` daran (das Schiff als Gegenstand, das Pferd
  als Tier), Kampfwerte über `creatureId`. Womit die Gruppe reist, steht in `state.travelBy`
  (null = zu Fuß); Wege, Routen und Hexkarten nehmen es über `partyTravel` / `partyMeans` als
  `how` mit (`waysFrom`, `routeBetween`, `hexMinutes`). Feste Minuten eines Weges gelten immer;
  ohne eigenes Tempo reisen Reittiere und Fuhrwerke im Tempo der Gruppe (Regelwerk). Ein
  Wasserweg ist `terrain: 'water'` (Art „Wasserweg“, kein Schlamm und Schnee): Schiffe tragen
  nur dort, alles andere nur an Land, Fliegendes überall – passt es nicht, geht der Abschnitt zu
  Fuß, und `wayFit` gibt einen ruhigen Hinweis, nie ein Verbot. Zustand, Rast und Unterhalt
  („seit dem letzten Abend“, `upkeepSince`) sind nur Hinweise; abgezogen wird nichts. Gekauftes
  aus dem Laden bietet `meansInBasket` zum Eintragen an. Überfahrten mit Abläufen nach Fahrplan
  (`crossingsHere` – vom Ort der Gruppe, darin und darüber; ein Ort ohne Orte darin zählt zum
  Ort, in dem er liegt) bucht `bookCrossing` (`features/wege/actions.ts`): Handel mit freiem
  Preis, dann `walk` bis zur Ankunft der Fahrt – nie Zeit von Hand rechnen. Im Laden angeboten
  wird alles, was ein Mittel sein könnte; vorab angekreuzt nur, was es klar ist (`checked`).
- Nachtragen (`features/nachtragen`, Reiter unter Zeit): Notizdateien werden in Sessions
  getrennt (`splitSessions`) und eingeordnet (`placeSessions` – nie nach „jetzt“, nie nach der
  ersten vorhandenen Session; Zwischenzeiten aus `gaps.ts`). Übernommen wird nur über
  `takeOverSessions`: Die Notizen stehen dann wörtlich in `session.source`, unverändert;
  `session.notes` bleibt die Mitschrift des Spielleiters. Nachgetragenes stellt nie Zeit vor.
  Gelesen wird nur über `readSession` / `storeReading` (der Rückblick nie als Geschehen,
  Entscheidungen hängen an Art + Satz). Angenommen wird nur über
  `nachtragen/reviewActions.ts` (`acceptProposals`, Beute über `giveLootAt`, Fäden über `saveThread`); was
  ein Vorschlag angelegt oder geändert hat, steht an ihm (`created`, `edits`), damit
  `undoAccepted` es auch nach einem Neustart zurücknimmt. In Artikel schreibt Wayfarer dabei nur
  die Zeile im Steckbrief und einen Punkt unter „## Was geschah“ (`wiki/factLines.ts`), nie in
  den Fließtext.
- Abmachungen (Chronik, `kind: 'promise'`): offen, erledigt oder gescheitert – gelesen über
  `promiseOutcome()`, gesetzt über `setPromiseOutcome()`. `promise.done` heißt nur „nicht mehr
  offen“; ob sie eingelöst wurde oder gescheitert ist, sagt `promise.failed`.
- Festhalten (alle Arten der Chronik außer `event`, Namen und fünf Gruppen in
  `domain/chronicleKinds.ts`): immer über `recordEntry` (`data/record.ts`), auch für früher.
  Ein Eintrag ist Geschichte – seine Wirkung (Schicksal, Aufenthalt, Haltung, Ortswechsel,
  Stufe, Beziehung …) gilt nur, wenn er der jüngste seiner Sorte ist (`isNewestOfSort`,
  `domain/history.ts`); sonst steht er nur in der Geschichte. Gelöscht wird über
  `removeRecorded`, das die Wirkung zurücknimmt. Festhalten stellt nie Zeit vor. Wo die Gruppe
  und welche Session zu einer Zeit war, sagen `partyPlaceAt` und `sessionAt`; offene Zustände
  `activeConditions`. Was ein Satz sein dürfte, schlägt `recognizeEntry` (`domain/recognize.ts`)
  vor – nur Art und Dinge, nie Text, und nie geraten.
- Gedächtnis beim Tippen (`domain/memory.ts`, Baustein `NameMemory` in `ui/memory.tsx`): Unter
  Mitschrift und Festhalten steht leise das Wichtigste zu den genannten Namen – höchstens zwei
  Namen, je drei Angaben (`memoryOf`: Schicksal, Haltung, wo, zuletzt, offene Abmachungen, sonst
  `tagline`). Namen findet `namesInText` mit den Regeln des Erkennens (`namesIn` in
  `recognize.ts`), nie mit eigenem Muster. Kein Fenster, kein Fokuswechsel, gleichbleibende
  Höhe; ausgeblendet über `state.nameMemory`. „Zuletzt“ zählt nur, was die Gruppe erlebt hat –
  nie Geheimes, Schicksale, Aufenthalte, Weltwissen oder Beziehungen zwischen anderen; tot ist
  auch, wessen Lebensdaten enden (`entity.ended`). In Dialogen sind die Namen keine Verweise
  (`link={false}`), und die Mitschrift behält eine angefangene Zeile (`draftKey`).
- Wegenetze (`nets/`, `domain/net.ts`): Ein Netz merkt sich nur, welche Orte seine Punkte
  sind und wo sie auf dem Blatt liegen. Die Wege sind die der Welt (`paths`): Zum Netz gehört
  jeder Weg, dessen beide Orte Punkte sind – nie Wege im Netz selbst speichern. Gelesen wird
  über `netView()`, geändert über `features/wegenetz/actions.ts`. Eine Strecke lässt sich
  schreiben („A -> B (4 Std.) -> C“, `parseRoutes`); Orte, die es gibt, werden genommen
  (`placeNamed`), nie doppelt angelegt. Was unterwegs wartet, steht am Weg (`path.onTheWay`,
  `path.encounterId`) und gehört zu `wayNotes()`. Was an einem Punkt hängt, sagt `hangingAt()`.
- Blätter zum freien Auslegen (Wegenetz, Fadenbrett) nutzen `useBoard` aus `ui/board.ts`:
  verschieben, vergrößern, Stücke ziehen. Wo etwas auf dem Fadenbrett liegt, steht in
  `state.board`; was dort fehlt, legt `boardLayout()` aus. Fäden zwischen Karte und Namen
  werden nie gespeichert – sie folgen aus dem, woran eine Geschichte hängt (`pinToCard` heftet
  einen Namen an).
- Einen Abend vorbereiten (`preps/`, `domain/prep.ts`, `features/abend`, Reiter neben dem
  Fadenbrett): je Abend ein Blatt – starker Einstieg, mögliche Szenen, Geheimnisse (noch an
  keinem Ort festgemacht), Begegnungen, Beute. Das offene Blatt (`sessionId: null`) gilt dem
  kommenden Abend; `startSession` hängt es an die Session. Was nicht gespielt und nicht
  aufgedeckt wurde, wandert über `carryOver()` auf das nächste Blatt – nie von Hand kopieren.
  Gelesen wird über `prepView()`, geschrieben über `features/abend/actions.ts` (`patchPrep`
  legt das Blatt mit dem ersten Wort an). Was fehlt, sagt `prepAdvice()` als Rat. Eine Szene (Abend
  oder Geschichte) kann an einen Ort geheftet sein (`scene.placeId`); am Spieltisch zeigt
  `scenesHere()` sie unter „Was hier passieren kann“, sobald die Gruppe dort ist. Unter „Starker
  Einstieg“ stehen die letzten Einträge der vorigen Session zum Übernehmen (`lastSessionLines`) –
  Wayfarer bietet nur die eigenen Zeilen des Spielleiters an, es formuliert nichts. Darüber steht
  „Letztes Mal“ (`recap()` in `domain/recap.ts`, gezeigt mit `RecapBox`): die gewichtigsten
  Einträge der vorigen Session (`RECAP_WEIGHT`, Alltag fällt weg), wo die Gruppe steht, was offen
  hängt, was ansteht – am Spieltisch über `tableRecap()`, bis im Abend etwas festgehalten oder es
  weggeklickt ist (`state.recapDismissed`, `dismissRecap`). Was ein
  Gefährte will, steht bei ihm (`character.goal`). Welche Geschichte einen Gefährten persönlich
  betrifft, steht an der Geschichte (`story.heroes`, mit seinem Grund; gesetzt über `tieHero` /
  `untieHero`) – gelesen über `heroesOf()` und `storiesOfHero()`. Solche Gefährten zählen zu
  den Knoten der Geschichte (`storyNodes`): Auf dem Brett verbindet sie ein Faden.
- Beute (`loot/`, `domain/loot.ts`, Seite `features/beute`, Reiter „Beute-Buch“ unter
  Gefährten): Wayfarer führt kein Inventar – das tun die Spieler –, sondern ein Beute-Buch. Ein
  Eintrag liegt bereit (vorbereitet, auf dem Abend-Blatt oder an einer Geschichte) oder ist
  ausgegeben – mit Abend, Ort, Herkunft und Empfänger (ein Gefährte oder die Gruppe). Ausgegeben
  wird nur über `giveLoot` (`features/beute/actions.ts`, in der Oberfläche `useGiveLoot`):
  Dabei entsteht die Zeile der Chronik, und ein Gegenstand der Welt gehört danach dem
  Empfänger; `takeBackLoot` und `removeLoot` nehmen beides zurück. Am Spieltisch steht
  bereitliegende Beute bei ihrer Geschichte im Spiel (`playView`), sonst unter „Dieser Abend“
  (`eveningLoot`). Was ein Gefährte bekommen hat, sagt `receivedBy()`, das ganze Buch
  `lootBook()`, den Text für die Spieler `receivedText()`.
- Läden und Preise (`shops/`, `domain/shop.ts`, `features/laden`): Gegenstände, Pflanzen, Tiere
  und Gesteine haben einen Listenpreis (`listPrice()`; Gegenstand: `item.price`). Ein Laden steht
  an einem Ort oder geht mit seinem Händler (`shopPlaceId`), hat Preisstufe (`priceFactor`),
  Ankauf (`buyFactor`), was er gern ankauft (`buys` – nur ein Hinweis) und einen Bestand
  (`stock`: Eintrag der Welt jeder Art, Wesen des Bestiariums `creatureId`, Regelwerk oder Worte;
  eigener Preis oder Listenpreis × Stufe, Einheit `unit` wie „je Pfund“, Menge oder unbegrenzt)
  – gelesen über `stockRows()`. **Läden schränken nie ein:** Gewählt wird aus allem
  (`wareGroups`, nach Art gruppiert als Hilfe, nie als Filter; `WarePicker` – die Eingabetaste
  nimmt nur den genauen Namen oder Handelsübliches, `enterWare`; „als Gegenstand anlegen“ nimmt
  einen Eintrag gleichen Namens, `wareItem`), am Tisch kauft und verkauft jeder Laden alles mit
  eigenem Preis; `planTrade` nimmt jeden Eintrag. Gehandelt wird nur über `tradeAt` (`laden/actions.ts`): ein Eintrag der Art
  „Handel“ (`kind: 'trade'`, `entry.trade`, über `recordEntry`); Bestand und Besitzer eines
  einzelnen Stücks (`isSingleItem`: Lebenslauf, Besitzer oder bei der Gruppe) ziehen mit,
  `removeRecorded` nimmt beides zurück. Handel ist keine Beute; „Gold der Gruppe“ im Kasten
  „Unterwegs“ ist Beute plus Handel (`tradeTotals`). Was ein Laden verkauft hat, steht nur in der
  Chronik (`shopTrades`). Preislisten liest `parsePriceLines`, `planPriceLines` sucht Einträge nach
  Namen (nie einen Namen doppelt; ein Name einer Person bleibt Wort), übernommen wird nur
  Bestätigtes (`takePriceList`, danach `linkTwins`); ein neuer Name wird nach fester Regel als
  Pflanze, Gestein, Tier oder Gegenstand angelegt (`newKindOf`: erst der Name, dann die
  Überschrift, ein Tier nur nach der Überschrift) – der Spielleiter bestätigt die Art in der
  Vorschau. Ein einzelnes Stück, das die Gruppe schon hat (`partyHolder`), ist im Laden
  ausverkauft, auch wenn der Bestand keine Menge zählt. Die Art eines Ladens ist ein freies Wort;
  „Liste vorschlagen“ zeigt zum Ankreuzen die eigene **Vorlage** des Spielleiters für die Art
  (`assortments/`, Text wie eine Preisliste, `templateProposals`; passende zuerst über
  `templateFit`/`kindKey`, jede andere wählbar) und „Wayfarer schlägt vor“ (`wayfarerProposals`:
  `shopSuggestions` – Natur am Ort, Einordnung, Name passend zu `SHOP_KIND_RULES` –,
  `creatureSuggestions` bei Tierhändlern, Regelwerk); in den Bestand nur über `addProposedLines`.
  „Als Vorlage für <Art> merken“ (`rememberAsTemplate`, `templateTextOf`). **Handelsplätze**
  (`shop.market`, `domain/market.ts`): Markt, Hafen, Auktionshaus, Hehler – dort steht
  „Verkaufen“ vorn, „Gesucht“/„Nicht gefragt“ (`shop.demand`, Wort + Faktor) sind Hinweise, die
  beim Ankauf auf- oder abschlagen (`buyShare`, `demandOf`: das Wort passt aufs Ende eines
  Wortes – „Salz“ auf „Steinsalz“, nie auf „Salzdistel“); Handelsgüter (Pflanze, Tier, Gestein,
  Tiere des Bestiariums) bringen dort ihren vollen Wert. Versteigern würfelt das Höchstgebot mit `fairDie`
  nach fester Regel (`auctionBid`: 4 W6, 50–150 %, Seltenes 25–175 %, in Schritten) – nur ein
  Vorschlag. Am Spieltisch „Läden hier“ bzw. „Läden und Handelsplätze hier“ (`shopsHere`,
  `shopsHereTitle`), überall `openShop`; im Festhalten öffnet „Handel“ den Laden.
- Regelwerk-Ausrüstung (Entscheidung des Spielleiters, 14. 11. 2026): Die Ausrüstung des SRD
  5.2.1 (CC BY 4.0) liegt als **Nachschlagewerk** in `src/domain/srd` (`equipment.ts`: Name
  deutsch und englisch, Gruppe, Preis wie im SRD und in Gold, Gewicht; nachschlagen über
  `srdMatch`, `srdSearch`, Ladenarten in `SHOP_KIND_RULES`). Nichts davon wird von selbst
  angelegt: In einen Laden kommt es nur auf Wahl des Spielleiters („Aus dem Regelwerk“,
  `addRuleItems` – Zeilen mit `stock.srdId`, keine Einträge der Welt; einzeln „Als Gegenstand
  anlegen“, `stockLineToItem` – nimmt einen Eintrag gleichen Namens, trägt eine Person oder ein
  Ort den Namen, entsteht nichts). Ohne eigenen und ohne Listenpreis gilt der Preis des Regelwerks
  mal Preisstufe (`stockRuleItem`, `listOrRulePrice`, angezeigt als „Preis nach dem Regelwerk“);
  am Tisch findet die Suche auch, was nicht im Bestand ist (`ruleHits`). Die Namensnennung
  (`SRD_ATTRIBUTION`, Einstellungen „Quellen“ und unter dem Nachschlagewerk) nie entfernen.
  Monster-Werteblöcke aus dem SRD gehören nicht dazu; nie Preise raten oder Beschreibungen
  übernehmen.
- Bücher in der Welt (`item.book`, `domain/book.ts`, Abschnitt „Buch“ am Gegenstand): Ein Buch
  ist ein Gegenstand mit Verfasser; seine Seiten stellt `bookPages()` aus den Artikeln zusammen
  (`bookEntries()`: alles aus seinen Themen `selection.rules` – Art, Einordnung, Schlagwort,
  Gegend über `scopeMembers`, Ordner des Wikis, nie Räume –, dazu `include`, ohne `exclude`; die
  ältere Regel aus `kinds`/`regionIds`/`categories` liest `legacyRules`). „Was darin steht“ ist
  ein Thema zum Durchsehen mit Kästchen (`bookTopics`, `topicEntries` in `domain/bookTopics.ts`,
  `topicListing`); angekreuzt wird nur über `setInBook`, ein Thema an- und abgeschaltet über
  `setBookRule` (abschalten behält, was angekreuzt ist). Gegend ist jeder Ort außer Räumen.
  Das gewählte Thema ist Ansicht, nie Spielstand. Eine Seite ist Steckbrief und Wortlaut des Artikels ohne Geheimes
  (`withoutSecrets`, `articleParts` in `domain/articleText.ts` – nie selbst Kästen zerlegen);
  überschrieben steht sie in den Worten des Verfassers (`book.pages`) und wächst nicht mehr mit.
  Wayfarer formuliert nie. Ein Eintrag mit verborgenem Artikel steht für die Leser nicht darin
  (`isReadable`, `readablePages`; `bookView().groups` für Lesen und Druck, `allGroups` für die
  Spielleitung). Hat die Gruppe oder ein Gefährte das Buch, zählt es im Spielerbuch in
  seiner Fassung (`booksAbout`, `knowledgeOf().books`). Geändert über `welt/book.ts`, gelesen
  und gedruckt über `BookPaper`.
- Lebenslauf eines Gegenstands (`item.history`, „Lebenslauf führen“, aus als Vorgabe): gelesen
  über `itemHistory()` und `holdersOf()` (`domain/itemHistory.ts`) – aus Lebensdaten, Beute-Buch
  und Chronik, nie gespeichert; eingeschaltet gilt alles schon Vorhandene. Setzt der Spielleiter
  den Besitzer von Hand, hält `noteHolderChange` (`welt/actions.ts`) das als geheime Veränderung
  mit `entry.holder` fest – wer den Besitzer anderswo setzt, ruft es mit auf; `giveLoot` hat
  schon seine Zeile und braucht es nicht. Zeiten nie genauer zeigen, als sie bekannt sind
  (`itemEventWhen`, `holdingSpan` mit `fromPrecision` / `toPrecision`).
- Blätter zum Schreiben (Geschichte, Abend) nutzen die Bausteine aus `ui/sheet.tsx`
  (`SheetSection`, `useDraftList`, `SheetAdvice`, dazu `Written`): Geschrieben wird beim
  Verlassen eines Feldes, ein „Speichern“ gibt es dort nicht.
- Spieltisch (`features/tisch`): drei Spalten – der Ort (wer hier ist, Wege, was hier ist), in
  der Mitte **„Im Spiel“** (`PlayPanel`), rechts Mitschrift und „Sonst noch“. Im Spiel ist, was
  der Spielleiter hereinnimmt (`story.inPlay`, bei losen Fäden `thread.inPlay`, gesetzt über
  `setInPlay`) – nie von selbst. Was an einer Geschichte hängt (Uhr, was am Ort bereitliegt,
  wer hier ist, Fäden, Abmachungen, Termine, Notizen, Merkzettel `story.memo`), sammelt
  `playView()` in `domain/play.ts`; neue Arten von „hängt daran“ dort eintragen, nicht in der
  Oberfläche. Eine Notiz kann zu einer Geschichte gehören (`chronicle.storyId`). Was bei einer
  Geschichte im Spiel steht, steht unter „Sonst noch“ nicht noch einmal (`playClaims`).
  Die Regeln des Tisches (Hausregeln und Absprachen, `campaign.tableRules`, Markdown, nur vom
  Spielleiter) öffnet das Zeichen in der Mitschrift (`TableRulesButton`, auch über die Suche,
  `focusOn({ type: 'rules' })`); dasselbe Blatt steht in den Einstellungen.
- Bastion (`bastions/`, `domain/bastion.ts`, Reiter „Bastion“ unter Gefährten; Regeln von 2024):
  Einrichtungen (`facilities`) mit Besitzer, Befehlen, Gefolgsleuten und Stand (bereit, beschädigt,
  wird repariert – Reparatur als Fortschrittsleiste über `startRepair`). Alle `turnDays` Tage ist
  ein Zug fällig (`turnsDue`); er steht am Spieltisch unter „Sonst noch“, ausgeführt wird er nur
  über `runTurn` (`features/bastion/actions.ts`) – nie von selbst. Ereignisse würfelt `fairDie`
  auf der Tabelle des Spielleiters (`bastion.events`, Zeilen „1–50: …“). Keine Buchinhalte.
- Pflanzen, Tiere, Gesteine, Berufe (Arten `plant`, `animal`, `mineral`, `profession`): Arten der
  Welt, kein eigenes Lexikon. Faustregel, damit nie Zweifel bleibt: gewachsen = Pflanze (auch
  Pilze, Moose), lebt = Tier, aus dem Boden = Gestein, von Hand gemacht = Gegenstand (auch Trank,
  Gift, Buch), Tätigkeit = Beruf; ein Tier mit Namen und eigener Geschichte ist eine Person. Die
  drei der Natur tragen Lebensraum (Wörter), Vorkommen (`regionIds`, Orte mit allem darunter),
  Zeit (Jahreszeiten oder Monate des Kalenders), Seltenheit und Wert – gelesen über `natureOf()`.
  Was an einer Stelle vorkommt, sagt `natureAt()` / `natureHere()` / `natureOnHex()`
  (`domain/nature.ts`): Wer Gegenden hat, kommt nur dort vor; sonst zählt der Lebensraum (Ort,
  Klima, Lage, Gelände des Feldes). Steht das Gelände fest (Feld der Hexkarte), muss ein
  bekannter Lebensraum auch in der eigenen Gegend passen. Ein Tier ist im Festhalten ein Gegner
  wie eine Spezies (ohne Schicksal). Jahreszeiten folgen aus dem wärmsten Monat, nie fest im Code.
  Unter „Nach Art“ zeigen sie ein Lexikon (`welt/lexicon.ts`, `LexiconView.tsx`). Ein Tier
  verweist auf seine Kampfwerte (`animal.creatureId`, `linkAnimalCreature`); wer einen Beruf
  ausübt, steht in Beziehungen der Art `practises`.
- Handwerk und freie Zeit: Berufe schlägt Wayfarer vor, angelegt wird nur Angenommenes
  (`domain/professions.ts`: Liste mittelalterlicher Berufe mit Einordnung und Werkzeug,
  `professionSuggestions` liest Rolle, Steckbrief-Zeile „Beruf“ und feste Wendungen wie „Brann,
  der Schmied“; Kasten „Vorschläge“ im Lexikon der Berufe, `welt/professions.ts`). Was hergestellt
  wird, ist ein Gegenstand mit Rezept (`item.recipe`: Beruf, Werkzeug, Zutaten aus Pflanzen,
  Gesteinen, Tieren, Gegenständen, Preis, Seltenheit, Verbrauchsgut). Dauer und Kosten nach den
  Regeln von 2024 rechnet `craftPlan()` (`domain/crafting.ts`, Regelwerte in `CRAFTING_RULES`),
  ein Rezept kann sie übersteuern; gelesen über `recipeView`, `madeBy`, `usedIn`. Freie Zeit
  (`domain/downtime.ts`, Dialog über `openDowntime`): ein Vorhaben ist eine Fortschrittsleiste mit
  `track.downtime` (zählt Arbeitstage, je Helfer einer pro Tag); verbracht wird nur über
  `spendDowntime` (`gruppe/downtime.ts`): Zeit über `advanceTime`, Leisten, ein Eintrag
  „Zwischenzeit“ (`kind: 'downtime'`, am Beginn, je Gefährte seine Tätigkeit) nur aus den
  gewählten Tätigkeiten, Fertiges gehört auf Wunsch dem Gefährten – einem anderen nimmt es ihn
  nur ausdrücklich (`keepByDefault`), Rückgängig.
- Räume: Ein Ort mit `place.room` gehört zum Ort darüber (Festung, Verlies, Haus) und steht nicht
  einzeln in der Welt-Liste und im Wiki-Baum, sondern auf dessen Seite unter „Räume“ (`roomsOf`,
  `domain/rooms.ts`; Befehle in `welt/rooms.ts`). Orte der Art „Dungeonraum“ o. ä. schlägt
  `roomCandidates` einmal zum Umwandeln vor. Ein Raum bleibt ein Ort (Gruppe, Chronik, Karten).
- Handouts (`handouts/`, `domain/handout.ts`, Reiter „Handouts“ neben Fadenbrett und Abend):
  Brief, Notiz, Erlass, Hinweiskarte – geschrieben vom Spielleiter, auf Pergament gezeigt und
  gedruckt (`usePrint` in `handouts/print.tsx`: eine eigene Ebene nur für den Druck). Wortlaut
  aus Schriftstücken übernehmen (`handoutSources`), Hinweiskarten aus den Geheimnissen des
  Abend-Blatts (`prepHintCards`). „Übergeben“ hält es in der Mitschrift fest. Kein Vollbild-Zeigen.
- Fortschrittsleisten (`tracks/`, `domain/track.ts`, Reiter „Fortschritt“ unter Gefährten): benannte
  Stufen, eine Zahl bis zu einem Ziel oder Abschnitte; sie gehören einem Eintrag oder der Gruppe.
  Geändert über `features/fortschritt/actions.ts` (`moveTrack` hält jeden Schritt als Veränderung
  beim Besitzer fest). Bastion-Reparaturen und Studien sollen diese Leisten nutzen.
- Spielerbuch (`domain/playerBook.ts`, Reiter „Spielerbuch“ unter Gefährten): was die Gruppe
  weiß und vermutet – nie gespeichert, abgeleitet (`playerBook`, für eine Seite `knowledgeOf`:
  weiß, vermutet, nur du). Was die Spieler sehen dürfen, entscheidet einzig `isKnownLine` /
  `isForPlayers` – nie `secret`, `notes`, geheime Zeilen, Termine oder Schritte von Uhren, Stand
  von Gerüchten. Vermutungen (`guesses/`) legen nur `features/spielerbuch/actions.ts` an
  (`saveGuess`, `setGuessTruth`, `removeGuess`); ihr Stand gilt nur „Für dich“. Im Festhalten
  ist „Vermutung“ ein zweiter Eingang wie „Beute“ (`isOwnDialogChoice`), keine Art der Chronik.
  Ein Treffer der Suche öffnet die Vermutung zum Ändern (`focusOn`, Art `guess`).
- Noch offen (`domain/looseEnds.ts`, Reiter „Noch offen“ neben Fadenbrett, Abend und Handouts):
  was die Gruppe angestoßen und nie beendet hat – nie gespeichert, aus der Chronik abgeleitet
  (`looseEnds`): offene Abmachungen, ungeprüfte Gerüchte, Wünsche der Spieler, entdeckte Orte ohne
  Besuch, Entscheidungen mit einem Ort, an dem die Gruppe nie ankam, und Angeheftetes
  (`entry.loose = 'open'`, die Nadel an jedem Eintrag). „Erledigt“ setzt `loose = 'settled'`.
  Am Spieltisch steht unter „Was hier passieren kann“, was am Ort der Gruppe offen hängt
  (`looseEndsHere`, ohne Abmachungen). Neue Arten offener Punkte dort eintragen (`looseReason`).
- Marschordnung: Reihen von vorn nach hinten in `state.march`; gelesen über `marchRows()`
  (`gruppe/march.ts`) – wer nicht dabei ist, fällt weg, Neue gehen hinten mit. Der Kasten
  „Unterwegs“ auf der Gefährten-Seite zeigt dazu Dunkelsicht, Lichter (`timer.refs`) und das Gold.
- Heldenbogen und Rampenlicht (`domain/heroArc.ts`): Was die Geschichte eines Gefährten
  ausmacht, sammelt `heroArc()` – Ziel, offene Wünsche (`openWishes`), Wandlungen, Meilensteine,
  Lehrer und Schüler (`mentorsOf`, Art `mentor` in beiden Richtungen), Geschichten
  (`storiesOfHero`), Leisten, offene Zustände; gezeigt im Kasten „Heldenbogen“ der Seite (dort
  auch die Leisten). `spotlight()` zählt, in wie vielen Einträgen der letzten begonnenen Abende
  jeder aktive Gefährte vorkommt (über `entryEntityIds`, je Eintrag einmal, ohne Termine und
  Uhren); `spotlightHint()` gibt höchstens einen ruhigen Satz – erst ab zwei Abenden, an denen
  ein Eintrag einen Gefährten nennt, und unter der Hälfte des Schnitts – und steht als Rat in
  `prepAdvice`; wer schon gezählt hat, nimmt `spotlightHintOf(view)`. Nie bewerten.
- Lebensdaten: `entity.born` / `entity.ended` (Tag, Monat oder Jahr, `DatePoint`). Alter, Gründung
  und „vor N Jahren“ rechnet `lifeFacts()` (`domain/lifespan.ts`) – nie ein Alter speichern. Gelesen
  wird über `readDatePoint` („3. Tauwind 667“, „667“, „vor 300 Jahren“, „Alter 34“), auch aus dem
  Steckbrief (Geboren, Alter, Gegründet, Gestorben …). Ein Tod aus der Chronik zählt ohne Tag.
- Wer an einem Ort ist, sagt `placeCast()` (`domain/derive.ts`): Tote und Verschollene sind nie
  anwesend, sie stehen für sich in `lost`.
- Kontinuität („Passt nicht zusammen“, `domain/continuity.ts`): `continuityIssues()` meldet
  Widersprüche leise – auf „Noch offen“ und als Hinweis auf der Seite eines Eintrags, nie als
  Rückfrage oder Toast. Geprüft wird nach Eintrag (id), nie nach Namen; gleiche Namen sind nur ein
  Hinweis. Jeder Punkt hat einen stabilen `key`; „Passt so“ (`markContinuityOk`,
  `features/offen/actions.ts`) merkt ihn in `state.continuityOk`. Neue Prüfungen dort eintragen,
  nie in der Oberfläche; Nachgetragenes und Ungefähres taugt nicht für einen Widerspruch, und was
  in derselben Minute (bei nur bekanntem Tag: am selben Tag) festgehalten ist, gilt als gleichzeitig.
- Lebendige Welt: Was eindeutig folgt, geschieht von selbst und still (Zustand statt Meldung);
  alles, was Geschichte ist, bleibt Vorschlag. Was abseits der Gruppe geschieht, sammelt
  `worldTurn()` (`domain/worldTurn.ts`) für die Seite „Weltgeschehen“ – nach Gewicht
  (`turnWeight`), Beobachtetes (`state.watch`) zuerst. Neue Quellen dort eintragen, nicht in
  der Oberfläche. Regelmäßige Abläufe (`runs/`, `domain/runs.ts`) laufen nach Fahrplan von
  selbst; ob eine fragliche Fahrt ausfällt, ist ein Vorschlag (`suggestions`) und wird nur über
  `decideTrip` entschieden. Eine Uhr, deren Schritt an einem ausgebliebenen Ablauf hängt,
  bleibt beim Zeitsprung blockiert stehen (`clock.blocked`) – sie plant nie von selbst um.
  Zeit vorstellen fragt nie nach und bleibt nie hängen: Eine stehende Uhr wird nur leise
  gemeldet (`hasNews` in `shell/meanwhile.ts`), entschieden wird danach im Weltgeschehen.
- Vorhaben von Fraktionen: Ein Vorhaben ist eine Geschichte mit der Fraktion (Familie, Person)
  als Antreiber (`story.ownerId`, sonst der der Uhr: `driverOf`) – kein zweites Uhrenwerk.
  Gelesen über `schemesOf()` und `deedsOf()` (`domain/schemes.ts`), angelegt über `newScheme`
  (`faeden/actions.ts`), gezeigt im Abschnitt „Vorhaben“ (`welt/Schemes.tsx`). Das
  Weltgeschehen „nach Fraktion“ (`factionTurn`, seit dem letzten Abend: `lastEvening`) sagt, was
  jede getan hat; mit „Alles“ der weite Zeitraum. Die Spanne gibt einzig `factionWindow()` –
  in der ersten Session gilt der Überblick, nie eine leere Spanne ab „jetzt“.
- Fraktionsnetz (Ansicht „Netz“ in Welt, `welt/FactionNet.tsx`): Fraktionen als Siegel, Familien
  als Wappen, Personen um ihre Fraktion, die Gruppe als Kompassrose; Fäden nach Art und Haltung
  (`relationTone`, `attitudeTone`). Gerechnet in `domain/factionNet.ts` (`factionNet`,
  `filterNet`, `netIndex`) – nur aus eingetragenen Beziehungen, Verwandtschaft zeigt der
  Stammbaum. Die Anordnung ist ein festes Kräfte-Verfahren mit `rngOf(seedOf(…))`; was der
  Spielleiter hinlegt, steht in `state.netBoard` (`welt/netActions.ts`: `placeInNet`, `tidyNet`).
  Welche Übersicht gilt, sagt `useWorldLayout()` (`welt/overview.ts`). „Alles zeigen“ zeigt
  wirklich alles; die Schrift bleibt dabei auf dem Schirm gleich groß (`LABELS_FLOOR`).
- Zeitleiste (Reiter unter Zeit, `/zeitleiste`, `features/zeitleiste`): Bahnen untereinander –
  die Gruppe (Aufenthalte, Meilensteine), Geschichten mit Uhr, Fraktionen (Vorhaben,
  Veränderungen), Personen und Orte (Lebensdaten, Besuche, Einträge), Termine nach
  `eventWeight` (Alltag nie). Gerechnet in `domain/timeline.ts`: `timelineLanes`/`laneOf`,
  Abende als Bänder (`evenings`), Achse je Zoomstufe aus der Kalender-Engine (`axisTicks`,
  `zoomPreset`, `axisContext`), Auslegen mit weichender Schrift und Bündeln (`layoutLane`, nur
  Sichtbares). Jedes Stück trägt nur Titel oder Text des Spielleiters und nie eine genauere Zeit
  als bekannt (`spreadOf`, `pieceWhen`). Welche Bahnen stehen, steht in `state.timelineLanes`
  (null = `defaultLaneKeys`); geändert über `zeitleiste/actions.ts`. Neue Arten von Stücken dort
  eintragen, nie in der Oberfläche. Wiederkehrende Termine rechnen im Fenster `repeatWindow`;
  ob einer zu oft im Bild stünde, zählt am Bild (`span`). Ein Bündel, das Heranzoomen nicht
  trennt (`clusterSpreads`), öffnet seine Stücke als Liste.
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
