# Konzeptbesprechung vom 16. 11. 2026

Gespräch zwischen Spielleiter und Claude am Handy, nach dem ersten echten Abend mit Wayfarer
(15. 11.) und nach dem Storyboard-Umbau des Fadenbretts. Nichts davon ist gebaut; das hier hält
fest, was entschieden ist, was vorgeschlagen und was offen ist. Zu lesen nach `CLAUDE.md`,
`docs/KONZEPT-WIKI.md` und `docs/KONZEPT-WELT-UND-KARTEN.md`.

Kennzeichnung: **Entschieden** = vom Spielleiter so gesagt. **Vorschlag** = von Claude, vom
Spielleiter gutgeheißen, aber noch nicht im Einzelnen festgelegt. **Offen** = noch zu klären.

---

## 1. Die Ordnung von Wayfarer

**Entschieden.** Wayfarer hat drei Kerne:

| Kern | Bereich | Rolle |
|---|---|---|
| Worldbuilding | Welt (Wiki) | der Rücken: die Welt, in der die Geschichte spielt |
| Storyboarding | Fadenbrett | Geschichten schreiben, Hinweise legen, Fäden ziehen |
| Leiten | Spieltisch | aus Storyboard und Welt wird der Abend, den die Spieler erleben; Dinge verändern sich, Fortschritt geschieht, die Zeit läuft |

Alles andere sind Bereiche, die die Kerne füttern und „nicht passen“:

- **Gefährten** – alles, was den Spielern gehört (siehe 2).
- **Zeit** – Kalender, Ereignisse, Feiertage, Dauer der Gruppe. „Sehr gute Seite, muss aber noch
  besser werden.“
- **Bestiarium** – inhaltlich Wiki, wichtig für den späteren Kampf.

Die drei Säulen des Spiels (Erkunden, Gespräch, Kampf) liegen quer dazu; nach dem Stand des
Codes ist Gespräch in allen drei Kernen stark, Kampf in allen schwach, Erkunden überall halb da.

**Entschieden: Wir müssen aufräumen.** Beobachtung aus dem Code (Navigation, `features/registry.ts`):
Viele Reiter liegen quer zur Ordnung der drei Kerne, zum Beispiel

- unter Fadenbrett: Abend vorbereiten (Brücke Storyboard → Leiten), Handouts (Material für den
  Tisch), Noch offen (Rückblick auf Gespieltes);
- unter Zeit: Chronik (Gedächtnis des Leitens), Weltgeschehen („Die Welt dreht sich weiter“),
  Nachtragen (Aufarbeiten alter Abende) neben dem Kalender;
- unter Bestiarium: Begegnungen (Vorbereitung) und Bestände (Welt an einem Ort) neben den Wesen;
- Karten als eigener Eintrag, obwohl sie Welt sind und am Tisch gebraucht werden.

Dazu gibt es viel Gebautes, das kaum auffällt (Spielerbuch, Fortschritt, Zeitleiste, Welt an
einem Tag, Fraktionsnetz). Eindruck: Wayfarer kann fast zu viel; das Problem ist weniger, was
fehlt, als dass es nicht entlang der drei Kerne geordnet ist. **Offen:** die neue Ordnung im
Einzelnen.

---

## 2. Gefährten

**Entschieden.**

- Unter Gefährten gehört **alles, was die Charaktere der Spieler betrifft**: Charakter,
  Backstory, Beute, Bastion, Fortschritt, was sie wissen und vermuten.
- Der **Wiki-Artikel eines Charakters ist irrelevant**, solange er Gefährte ist. Ein Charakter
  lebt nur unter Gefährten.
- Die **Backstory** trägt der Spielleiter als Text ein (er hat sie als Text von den Spielern).
- Die **Bastion** wird von Wayfarer geführt und ist „super wichtig“.

Stand im Code: Ein Gefährte (`character`) hat Notizen, Geheimnis, Ziel, Heldenbogen, Beute,
Abmachungen, Chronik – aber kein Feld für die Backstory und keinen Artikel auf seiner Seite. Die
Bastion steht als eigener Reiter, nicht auf der Seite des einzelnen Gefährten, nicht beim Abend
und nicht auf dem Brett.

**Vorschlag.**

- Ein Textfeld „Backstory“ auf der Seite des Gefährten; Namen darin erkennt Wayfarer wie überall.
- Einzelne Sätze der Backstory lassen sich aufs Brett holen (siehe 3), mit Faden zum Gefährten.
  Welche Teile einer Backstory Haken für Geschichten sind, entscheidet der Spielleiter.
- Auf der Seite eines Gefährten laufen seine Dinge zusammen, auch seine Einrichtungen der Bastion.
- Bastionsereignisse sind mögliche Einstiege in Geschichten: ein gewürfeltes Ereignis mit einem
  Klick aufs Brett legen.

---

## 3. Das Fadenbrett ist die Pinnwand eines Ermittlers

### Was der Spielleiter will

**Entschieden.**

- Der freie Whiteboard-Weg (seit 16. 11.) ist deutlich besser als das Blatt. Auf dem Blatt
  Geschichten zu schreiben „hat nicht funktioniert“.
- Die Geschichten der Kampagne sind eine Art Point Crawl. Am Ende hängt alles irgendwie
  zusammen, weil Hinweise gegeben werden müssen.
- Ziel: **nicht so viel improvisieren, immer wissen, was man gerade hat**, damit den Spielern
  nicht zu viel um die Ohren fliegt – obwohl die Gruppe gerade viele Geschichten gleichzeitig hat.
- Auf dem Brett liegen **die Dinge selbst**, so wie sie in der Welt sind: Orte, Personen,
  Gegenstände, Fraktionen … – **nicht** als „Frage“ oder „Hinweis“. Ein Tagebuch ist ein
  Gegenstand; Hinweis wird es durch seinen Faden.
- **Die Fäden sind die Verbindungen** – und auf ihnen steht, wie etwas dazugehört. Die Wörter an
  den Fäden darf Wayfarer verstehen.
- **Eine Geschichte ist ein Geflecht**: alles, was an ihrem Antreiber hängt. Was dazugehört, legt
  der Spielleiter selbst fest, gern mit einem **Rahmen** – und kann dann **nur diese Geschichte
  zeigen** und die anderen ausblenden.
- Dass beim Herauszoomen nichts mehr lesbar ist, ist egal: Das Brett ist das Drawing Board, auf
  dem alles zusammenkommt.
- Nur Geschichten als Textkarten aufs Brett zu legen „bringt nichts – das kann ich auch mit Docs“.

Beispiel des Spielleiters (Ausschnitt einer sehr großen Geschichte):

> Vorzagath (Betrachter, Oberherr) → hält die Große Mutter (Ältestengehirn) → die führt die
> Kolonie in Yth'Voraal → die hatte mit Haus Duskryn zu tun → Haus Duskryn hatte Duskryns
> versteckte Bucht und Duskryns Arena → in der Arena das Rote Bad → davon wusste Sarion Goldkehle …

> Daria Hagel → ihr Tagebuch (Hinweis, liegt an einem Ort) → der Ort, an dem sie das Gespräch
> zwischen Theo Becker und seiner Frau belauscht hat → daher wusste sie Theos Standort → den
> verriet sie an den Smaragdzirkel.

Für jede Geschichte muss man aufdröseln können: Wo kann die Gruppe was finden? Welche Personen
sind wichtig? Welche Gegenstände? Wo liegt welcher Hinweis? – jeweils als das Ding, das es ist,
und auf dem Brett geschrieben, inwiefern es dazugehört.

### Karten

**Entschieden.** Eine Karte auf dem Brett legt man selbst fest: etwa das Porträt einer Person,
ein kurzer Text als Notiz, eine Notiz zu einer Stadt unabhängig vom eigentlichen Artikel –
„whatever gerade wichtig ist“. **Die Notiz gehört zur Karte**, nicht zum Ding.

**Vorschlag** (Kleinteile, später): Kopf (Name, Kategorie) immer; Bild aus der Welt (das Feld
`image` gibt es am Eintrag schon) auf Wunsch; Brett-Notiz; einzelne angeheftete Zeilen aus dem
Steckbrief; leiser Zustand (tot, Platzhalter, der Gruppe bekannt). Gefaltet nur der Name.
**Offen:** Bilder immer oder nur je Karte eingeschaltet (Entscheidung vom 11. 11.: Bilder in
Arbeitsflächen stören eher – ein Porträt ist aber Inhalt).

### Was es dafür im Code schon gibt

- Einträge der Welt und Artikel lassen sich aufs Brett holen (`node:`/`article:`), eine Schnur ins
  Leere kann dort etwas neu anlegen (`DropSearch`, `addFromWriting`).
- Jede Schnur trägt ein Wort und eine Richtung (`state.boardLinks`).
- Bereiche gibt es (`state.boardAreas`); „nur diesen Bereich zeigen“ fehlt.

### Befunde aus der Probe (Vorschau, 16. 11.)

Claude hat die Geschichten der Gefährten in der Vorschau aufs Brett gelegt (allerdings nur als
Textkarten – siehe oben, das war der falsche Ansatz) und nachgesehen, was davon ankommt:

- Gut: Doppelklick → Überschrift → Eingabetaste → auf der Karte weiterschreiben; Namen im Text
  werden erkannt; Schnüre ziehen und das Menü daran sind klar; Gelöstes wandert nach
  „Abgeschlossen“; am Spieltisch zeigt „Auf dem Storyboard“ die Karte und wohin es führt.
- **Was auf dem Brett liegt, kommt sonst nirgends an.** Alles dort Geschriebene ist ein loser
  Faden. Die Seite des Gefährten („Noch betrifft keine Geschichte …“), „Abend vorbereiten“ und
  „Im Spiel“ lesen nur Geschichten vom Blatt.
- **„Hier steht die Gruppe“ gibt es nur einmal** – bei sechs Gefährten mit eigenen Geschichten
  sieht man am Tisch nur eine.
- **Die Sicht „Was die Gruppe weiß“ ist leer**: Neues auf dem Brett gilt als der Gruppe unbekannt,
  auch die Backstorys, die die Spieler selbst geschrieben haben.
- Personen, Orte, Gegenstände liegen nur als kleine Namensschilder da, ohne Inhalt.
- Doppelklick ins Leere macht immer einen Faden, nie gleich eine Person, einen Ort, einen
  Gegenstand.
- Kleinigkeiten: „+ Geschichte“ öffnet das Blatt; neue Ideen tragen sofort eine rote Warnung
  („Kein Hinweis führt zu ihm“); nach jeder Karte und Schnur eine Meldung, die sich stapeln;
  mehrere aufs Brett geholte Namen landen übereinander; ein im Text erkannter Name wird nicht
  von selbst zur Schnur.

**Offen:** wie das Brett für den Rest von Wayfarer sichtbar wird (Gefährten, Abend, Spieltisch,
Seite eines Dings), ohne seine Freiheit zu verlieren.

---

## 4. Die Wiki: gutes Worldbuilding

### Das Problem

**Entschieden (Einschätzung des Spielleiters).** Worldbuilding ist sein größtes Hobby, und es gibt
keine gute Plattform dafür.

- LegendKeeper: ein Lore-Blatt, keine Optionen – man schreibt einfach drauflos und ist durch.
- World Anvil: viele, sehr volle Vorlagen – inspiriert, schränkt aber ein und überfordert; alles
  außerhalb der Vorlagen bleibt aus.
- Wayfarer hat heute extrem viele Optionen; man muss ständig nachdenken. Worldbuilding fühlt sich
  noch nicht so leicht an wie in LegendKeeper.
- Die Welt ist riesig (Regionen, Territorien, Städte, Dorfarten, Gebäude, Arten von Personen,
  Berufe … und alles Selbsterdachte). Für alles eine eigene Sache zu bauen geht nicht.
- Ein Template-Builder wäre schön, ist aber vielleicht zu viel.

### Das Vorbild: Läden

**Entschieden: „Das mit den Läden ist perfekt umgesetzt.“** Am 15. 11. ausprobiert: Aus einem Text,
der sonst nur gelesen würde, wird Text, der als Mechanik funktioniert – Bestand einfügen, die
Spieler kaufen tatsächlich ein, super einfach. **Ziel: diese Grundprinzipien für alles.**

Warum es funktioniert (Claudes Lesart): Man schreibt, was man ohnehin schreiben würde (eine
Preisliste); Wayfarer macht sofort etwas Spielbares daraus; Vorschläge sind Angebote zum
Ankreuzen, nie Pflicht; die Art des Ladens ist ein freies Wort; Vorlagen entstehen durch
„Als Vorlage merken“.

### Die Richtung

**Entschieden: „Das Prinzip ist richtig.“** Im Einzelnen:

- **Kategorien** in der Wiki, konkret: Ort, Person, Gestein, Pflanze und solche Sachen. Nicht zu
  grob („Natur“ ist zu grob), keine Restkiste („alles andere“ ist schlecht). Das Wort ist
  **Kategorie** (nicht „Grundart“).
- **Darunter das eigene Wort** des Spielleiters: Fischerdorf ist etwas anderes als Handelsposten;
  bei Pflanzen Pilz, Kraut, Baum; bei Gestein Metall, Stein, Erz.

**Vorschlag** (gutgeheißen, Einzelheiten offen):

- **Kategorien schneiden nach Mechanik**: Jede bringt mit, was Wayfarer mit ihr tun kann. Entwurf:

  | Kategorie | Was Wayfarer damit kann | Eigene Wörter, z. B. |
  |---|---|---|
  | Person | Haltung, Aufenthalt, Beziehungen, Wissen | Händler, Wirtin, Priester |
  | Fraktion | Ruf, Vorhaben, Sitz, Mitglieder | Gilde, Orden, Kult, Widerstand |
  | Haus / Familie | Stammbaum, dazu alles einer Fraktion | Adelshaus, Sippe, Clan |
  | Ort | Wer hier ist, Wege, Läden, Räume | Fischerdorf, Handelsposten, Taverne |
  | Reich *(neu)* | Gebiet, Herrscher, Gesetze, Grenzen | Königreich, Stadtstaat, Grenzmark |
  | Gegenstand | Besitzer, Beute, Magie, Rezept, Buch | Waffe, Tagebuch, Trank, Brief |
  | Pflanze | Lebensraum, Jahreszeit, Wert | Pilz, Kraut, Baum |
  | Tier | Lebensraum, Kampfwerte | Raubtier, Reittier |
  | Gestein / Rohstoff | Vorkommen, Wert | Metall, Edelstein, Erz |
  | Wesen | Statblock (Bestiarium) | Monster, Untoter |
  | Spezies | Lebensweise, Sprache | Volk |
  | Gottheit *(neu)* | Domänen, Anhänger, Tempel, Feiertage, Vorhaben | Göttin, Dämonenfürst |
  | Ereignis *(neu)* | Datum, Zeitleiste, Folgen | Krieg, Gründung, Katastrophe |
  | Beruf | wer ihn ausübt, Handwerk | Schmied, Fährmann |
  | Sprache, Schrift | wer sie spricht | |
  | Überlieferung *(statt Thema)* | Text, verlinkt, aufs Brett | Legende, Prophezeiung, Magiesystem |

  Heute (`ENTITY_KINDS`): Person, Ort, Fraktion, Gefährte, Gegenstand, Thema, Familie, Spezies,
  Sprache, Schrift, Fähigkeit, Pflanze, Tier, Gestein, Beruf. Gottheiten fehlen ganz, obwohl eine
  (Isara) gerade eine persönliche Geschichte trägt.
- **Ort mit Größe** als zweiter Angabe, weil sie Mechanik ändert: Gegend, Siedlung, Gebäude, Raum.
  Davon hängen „Wer hier ist“, Räume und die langen Pfade ab.
- **Bausteine statt voller Vorlagen**: Laden, Räume, Rezept, Buch, Vorhaben, Bestand … gibt man
  einer Seite, wenn man sie braucht (heute schon als „Hinzufügen: …“, `pagePlan`/`AddKey`).
- **Vorlagen durch Merken statt Builder**: Eine Seite einmal so schreiben, wie man sie will
  (Steckbrief-Zeilen, Überschriften, Bausteine) → „Als Vorlage für Taverne merken“; beim
  nächsten Ding mit diesem Wort wird die eigene Vorlage angeboten. Wie heute bei Läden
  (`rememberAsTemplate`).
- **Inspiration als Fragen, nicht als Felder**: ein, zwei Leitfragen je Wort am Rand („Wovon leben
  die Leute hier?“), wegklickbar; eigene Fragen in eigenen Vorlagen. Dazu ruhige Hinweise aus der
  Welt („In Zuversicht gibt es noch keinen Ort zum Übernachten“), nie Warnungen.
- **Text, der zur Mechanik wird**, auch außerhalb der Läden – Beispiele: Fährdienst im Text eines
  Dorfs → Angebot, eine Überfahrt mit Fahrplan anzulegen; Taverne mit Gerüchten, die man am Tisch
  anzapft; Tempel mit Diensten und Preisen.
- Was Wayfarer nicht versteht, bleibt vollwertiger Text: verlinkt, aufs Brett, im Kurzblick.

### Offene Fragen zur Wiki

1. Wie heißt das eigene Wort unter der Kategorie („Unterkategorie“, oder ohne Namen als
   „Ort · Fischerdorf“)?
2. Sind die Kategorien die Ordnung des Baums (oben Orte, Personen …, darunter Ordner), oder bleiben
   die eigenen Ordner die Ordnung und die Kategorien sind Etiketten zum Finden?
3. Schlägt das Feld für das eigene Wort nur die eigenen bisherigen Wörter vor, oder bringt
   Wayfarer ein paar gängige mit, damit eine neue Welt nicht leer startet?
4. Die Liste der Kategorien im Einzelnen (fehlt eine, die in der Welt ständig vorkommt? Kultur?).

---

## 5. Weitere Punkte aus dem Gespräch

- **Arbeitsweise beim Planen** (Rückmeldung des Spielleiters): über Wayfarer sprechen, wie es ist
  und wie man etwas löst – nicht nur „hier ist eine Lösung“ oder „theoretisch müssen wir …“. Auch
  benennen, wenn etwas nicht lösbar ist, und was dann gilt. Aber locker im Gespräch, kein starres
  Schema. Claude kennt den Code und soll dieses Wissen einbringen.
- **Große Orte** (Menzoberranzan): Heute ist „Wer hier ist“ entweder die ganze Stadt (Flut) oder
  nur, wer genau am Unterort eingetragen ist (Leere; wer nur bei der Stadt steht, fehlt). Ein
  Vorschlag war eine eingeklappte Zeile „In der Stadt, ohne genauen Ort“. Nicht lösbar: wer von
  den ungenau Eingetragenen gerade da ist – das entscheidet der Spielleiter. **Offen**, nicht
  weiter besprochen; das Verorten darf nie Pflegearbeit werden („wieder zu verkompliziert für den
  DM“).
