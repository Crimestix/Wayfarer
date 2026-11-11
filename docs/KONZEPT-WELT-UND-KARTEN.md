# Konzept: Lebendige Welt und intelligente Karten

Erarbeitet mit dem Spielleiter am 11. 11. 2026 (Gespräch am Handy, ohne Zugriff auf den
Spielstand). Das ist ein Konzept, noch kein Bauplan: Es hält fest, was entschieden ist, und
schlägt eine Reihenfolge vor. Erst `CLAUDE.md` lesen, dann `docs/FUNKTIONSUMFANG.md`, dann diese
Datei.

Das Repository ist öffentlich. Beispiele hier sind darum allgemein gehalten; die echten Fälle
aus der Kampagne kennt der Spielleiter.

---

## 1. Leitsätze für eine lebendige Welt

Vom Spielleiter vorgegeben. Jede neue Funktion wird daran gemessen.

- **Eigenständigkeit:** Menschen, Tiere und Natur haben eigene Bedürfnisse, Abläufe und Rhythmen.
- **Zusammenhänge:** Gelände beeinflusst Wasser und Wetter, beides prägt Lebensräume, Wege und
  Siedlungen.
- **Veränderung:** Jahreszeiten, Wachstum, Verfall, Konflikte und Entscheidungen verändern Orte.
- **Erinnerung:** Vergangenheit hinterlässt Spuren in Landschaften, Gebäuden, Beziehungen und
  Gewohnheiten.
- **Konsequenzen:** Handlungen wirken weiter, manchmal verzögert und über den ursprünglichen Ort
  hinaus.
- **Eigenart:** Orte unterscheiden sich durch Licht, Geräusche, Gerüche, Materialien und
  Lebensweisen.
- **Ungewissheit:** Wissen bleibt lückenhaft, Menschen können irren und manches darf rätselhaft
  bleiben.
- **Wiedererkennbarkeit:** Bei einer Rückkehr ist genug vertraut, um die Veränderungen überhaupt
  wahrzunehmen.

## 2. Entscheidungen des Spielleiters (11. 11. 2026)

1. **Logische Folgen geschehen von selbst.** Was ohne Eingriff von außen geschieht und eindeutig
   folgt, passiert einfach. Beispiel: Ein unbefestigter Weg durch nassen Grund geht bei
   Starkregen verloren.
2. **Alles, was Geschichte ist, bleibt Vorschlag.** Wie eine Person oder Fraktion auf etwas
   reagiert, entscheidet der Spielleiter. Wayfarer sagt, *dass* und *wann* sich die Frage stellt.
   Das gilt ausdrücklich auch für Uhren: Eine Uhr darf blockiert werden, aber nie von selbst
   umplanen.
3. **„Die Welt dreht sich weiter“** ist ein eigener Bereich nur für den Spielleiter. Was abseits
   der Gruppe geschieht, ist für die Spieler nicht relevant, für den Spielleiter aber schon, und
   es soll geschehen, auch wenn die Gruppe gerade woanders ist.
4. **Wayfarer darf auch Unsicheres vorschlagen** (etwa: ein Händler bleibt wegen eines gesperrten
   Weges aus). Solche Vorschläge stehen getrennt von dem, was sicher geschehen ist.
5. **NSC brauchen keine perfekte Routine.** Wichtig ist, dass sich die Welt für die Spieler
   lebendig anfühlt. Zufällige Begegnungen aus dem Alltag sind gut, dürfen aber nicht ständig
   passieren.
6. **Jede Person weiß eigene Dinge.** Dafür gibt es Wissensebenen. Das Wissen einer Person steht
   in ihrem Artikel und ist über die Suche zu finden.
7. **NSC reisen wie die Gruppe:** über Wege, mit Tempo und Wetter. Ein verschlammter Weg hält sie
   genauso auf.
8. **Karten sind intelligent.** Jeder Strich bedeutet etwas (siehe Teil 4).

## 3. Die lebendige Welt

### 3.1 Folgen

Zwei Arten von Ereignissen, beide laufen mit der Weltzeit:

- **Abgeleitete Folgen:** Wayfarer erkennt sie aus dem Zustand der Welt. Starkregen → Weg
  verschlammt; Vorrat aufgebraucht → Lieferung nötig; lange unbewohnt → verfallen.
- **Uhren des Spielleiters:** gibt es schon (`domain/clock.ts`). Neu sind Bedingungen (3.3).

Grundsatz **Zustand statt Meldung:** Die meisten Folgen ändern nur still einen Zustand (Weg
verschlammt, Lager verfallen). Man sieht ihn, wenn man den Ort oder Weg öffnet oder die Gruppe
ihn betritt. Gemeldet wird nur, was Gewicht hat.

### 3.2 „Die Welt dreht sich weiter“

Ein Bereich mit drei Ebenen:

1. **Oben:** Uhren und alles, was der Spielleiter beobachtet (Personen, Orte, Fraktionen gezielt
   beobachten: Alles zu ihnen erscheint, egal wie weit weg).
2. **Darunter, nach Gewicht:** Gewicht ergibt sich aus der Nähe zur Gruppe, räumlich und über
   Beziehungen. Was eine Person betrifft, die die Gruppe kennt, wiegt schwerer.
3. **Eingeklappt:** der Rest.

Dazu eine eigene Spalte **Vorschläge** zum Annehmen oder Verwerfen; Unbearbeitetes läuft nach
einer Weile ab. Nach einem Zeitsprung wird **gebündelt** („Drei Wege im Moor gesperrt“ statt drei
Einträgen). Ein einfacher Schalter **Überblick / Alles**, kein feiner Regler.

Am Spieltisch erscheint davon nichts, solange es den Ort der Gruppe nicht betrifft. Kehrt die
Gruppe zurück, zeigt „Seit eurem letzten Besuch“ das Vorher und Nachher.

Baut auf `shell/meanwhile.ts` auf („Währenddessen“), ersetzt es nicht.

### 3.3 Uhren mit Bedingungen

Ein Schritt einer Uhr kann an eine **Bedingung** geknüpft sein, zum Beispiel: „Die letzte
Lieferung trifft im Lager ein.“ Fällt die Bedingung weg, läuft die Uhr nicht weiter, sondern
steht auf **blockiert**. Wie es weitergeht, ist ein Vorschlag an den Spielleiter.

Bei verdeckten Vorhaben zeigt Wayfarer zu jedem Betroffenen:

- **weiß es noch nicht**
- **frühestens:** wann die Nachricht ihn über die schnellsten Wege erreichen kann
- **spätestens:** wann er es merken muss, weil eine erwartete Nachricht ausbleibt

### 3.4 Regelmäßige Abläufe

Transporte, Lieferungen, Patrouillen, Boten: wiederkehrende Reisen mit **Strecke**, **Fahrplan**
(z. B. einmal im Monat), **Träger** (Boot, Karawane) und **Betreiber** (Fraktion). Sie laufen von
selbst weiter. Fehlt der Träger oder der Betreiber, fällt der Ablauf aus.

Ohne Fahrplan weiß Wayfarer nicht, wann etwas fehlt. Darum gehört er zu jedem Ablauf.

### 3.5 Ausbleiben als Ereignis

Wenn Erwartetes nicht eintritt, entsteht Wissen: Am Ziel eines ausgefallenen Ablaufs weiß man zur
fälligen Zeit, *dass* etwas fehlt, aber nicht *warum*. Das Fehlen selbst ist die Nachricht.

### 3.6 Nachrichten reisen

Wissen verbreitet sich über **Träger**: Boten, Abläufe, Reisende, Patrouillen, entlang der Wege
mit deren Reisezeit. Ein Ort ohne Verbindung erfährt nichts. Das ist gerade unter der Erde
entscheidend, wo es wenige Wege gibt.

Offen: ob sich Neuigkeiten auf belebten Wegen auch ohne angelegten Träger langsam herumsprechen
(Vorschlag: ja, als langsamste Stufe, abschaltbar).

### 3.7 NSC in drei Stufen

- **Kulisse:** kein Ablauf, sie sind einfach da. Die große Mehrheit.
- **Alltag:** ein einfacher Tagesrhythmus aus wenigen Zeitfenstern (morgens hier, abends dort).
  Daraus entstehen Begegnungen von selbst: Ist die Gruppe zur richtigen Zeit am richtigen Ort,
  schlägt Wayfarer die Person als mögliche Begegnung vor. Nur als Hinweis, nie aufgedrängt.
- **Vorhaben:** Personen mit eigenem Ziel und eigener Uhr, die auch reisen.

Damit Begegnungen nicht stören: ein **Lebendigkeitsregler je Ort** (ein Markt ist belebt, ein
Gang unter der Erde still).

### 3.8 Wissensebenen

- **Bereiche** des Wissens: Gemeinwissen einer Region, Akademisch, Militär, Glaube, Unterwelt,
  Handwerk …
- Eine Person erhält Bereiche über Herkunft, Beruf und Fraktion; dazu von Hand einzelne Dinge,
  die nur sie weiß.
- **Gerüchte** mit Wahrheitsgehalt: Menschen können sich irren.
- Im Artikel der Person ein Abschnitt „Wissen“: zuerst, was zum aktuellen Ort und zu aktiven
  Themen passt, der Rest eingeklappt.

## 4. Intelligente Karten

### 4.1 Der Leitsatz

**Jeder Strich auf der Karte bedeutet etwas.** Der Kartendesigner malt keine Bilder, sondern
Daten, die Wayfarer schön darstellt. Programme wie Inkarnate erzeugen Bilder, aus denen Wayfarer
nichts lernen kann; das ist ausdrücklich nicht das Ziel.

Was daraus folgt:

- **Gelände** bestimmt Reisetempo, Begegnungen und über Höhe und Klima das Wetter. Hexkarten
  entstehen daraus.
- **Wasser** folgt den Höhen: Flüsse fließen bergab ins Meer, Seen sammeln sich in Senken.
- **Wege** haben eine Art (Pfad, Straße, Bootsroute); Reisezeit aus Länge und Gelände, Zustand
  aus dem Wetter.
- **Orte** sind mit der Weltdatenbank verknüpft; Hineinzoomen öffnet ihre Unterkarten.
- **Ebenen** liegen übereinander (Oberwelt, Unterreich), verbunden durch Schächte und Abstiege.
- **Wissen:** Die Gruppe sieht nur, was sie entdeckt hat.
- **Veränderung:** zerstört, verschlammt, gewachsen, verfallen, als Zustand auf der Karte.
- **Vorschläge:** wo eine Siedlung logisch läge (Furt, Kreuzung, Hafen, Flussmündung). Entschieden
  wird von Hand.

### 4.2 Was darstellbar sein muss

- **Maßstäbe:** Welt → Kontinent → Region → Umland → Stadt → Gebäude → Dungeon → Kampfraster.
- **Natur:** Höhen, Gebirge, Hügel, Ebenen; Küsten, Meere, Seen, Flüsse, Sümpfe, Gletscher; Wald,
  Steppe, Wüste, Tundra; Klimazonen.
- **Unterreich:** Kavernen, Tunnel, Schluchten, unterirdische Seen und Meere, Pilzwälder,
  Faerzress-Zonen; Höhe als dritte Dimension.
- **Menschengemachtes:** Straßen, Pfade, Brücken, Furten, Fähren, Häfen; Siedlungen jeder Größe;
  Mauern, Burgen, Minen, Felder; in Städten Viertel, Straßenzüge, Plätze, Gebäude.
- **Macht:** Grenzen, Herrschaftsgebiete, Einflusszonen (auch innerhalb einer Stadt).
- **Magisches:** Kraftlinien, Zonen wilder Magie, verfluchte Gebiete.
- **Zustand und Zeit:** Wetter, Jahreszeit, Tag und Nacht; zerstört, verschlammt, überflutet,
  verfallen; Ereignisse aus „Die Welt dreht sich weiter“.
- **Bewegung:** die Gruppe, NSC mit Vorhaben, Abläufe, Reisen in Etappen.
- **Wissen:** Nebel, Entdecktes, Gerüchte, getrennt nach Spielleitung und Gruppe.
- **Beschriftung**, die mit dem Maßstab mitwächst und sich nicht überlappt.

### 4.3 Aufbau in Schichten

Daten und Darstellung sind strikt getrennt.

1. **Grund:** Höhe und Gelände. Gemalt oder erzeugt.
2. **Wasser:** aus den Höhen abgeleitet, von Hand korrigierbar.
3. **Natur:** aus Klima und Höhe vorgeschlagen, übermalbar.
4. **Kultur:** Wege, Orte, Grenzen, Gebäude als Vektoren. Aus den Wegen entsteht das Netz für
   den Pointcrawl (passt zu `domain/ways.ts`).
5. **Zustand:** was sich mit der Weltzeit ändert.
6. **Wissen:** was wer sieht.
7. **Darstellung:** ein Zeichner, der alles im Wayfarer-Stil malt, als **Bild**, **Hex** oder
   **Netz**.

Unterkarten sind Fenster mit feinerer Auflösung, die genau in ihrer Elternkarte liegen. Bildkarten
(eigene Zeichnungen, Importe) bleiben erlaubt und werden kalibriert.

### 4.4 Vektoren statt Pixel

**Nichts wird als Pixel gespeichert, alles als Form oder Formel.**

- Küsten, Flüsse, Wege, Grenzen, Gebäude, Räume: Linien und Flächen.
- Gelände-Malen: Jeder Pinselstrich wird zu einer Fläche, angrenzende Flächen verschmelzen.
- Höhen: Rauschen plus vom Spielleiter gezogene Kämme als Linien, an jedem Punkt in beliebiger
  Feinheit berechenbar.
- Gezeichnet wird über die Grafikkarte (Canvas/WebGL), nicht als SVG im Dokument: SVG wird mit
  tausenden Elementen (jeder Baum, jedes Haus) zu langsam. Der Atlas war schon „laggy“.
  Export und Druck als SVG oder PDF in beliebiger Größe.
- Tauri: Die Oberfläche läuft in der Webansicht des Systems (WebView2, WebKit), also gilt
  dasselbe. Schwere Rechnungen (Welt erzeugen, Abfluss, Wegsuche) können auf die Rust-Seite oder
  in einen Worker, damit die Karte nie ruckelt.

### 4.5 Schick

Hohe Qualität ist Pflicht.

- **Handgezeichnet aus Daten:** Federstriche, schraffierte Gebirge, Bäume als kleine Symbole,
  Wellenlinien vor der Küste. Es sieht gezeichnet aus, obwohl es gerechnet ist.
- **Ein Stil je Ebene:** Oberwelt in Tinte auf Pergament, Unterreich dunkel mit violettem
  Schimmer. Beides im Messing und Leder von Wayfarer.
- **Detail nach Zoom:** von weitem Küsten und große Namen, nah heran Bäume, Gipfel, Höhenlinien,
  Häuser. Symbole liegen auf festen, wiederholbaren Rastern, damit beim Zoomen nichts springt.

### 4.6 Die Probe

`docs/proben/varrand-karte.html` zeigt den Ansatz in einer Datei, ohne Abhängigkeiten: Varrand,
eine erfundene Insel (nur Anschauungsmaterial, gehört nie in die App). Im Browser öffnen.

Was sie vormacht:

- Höhen aus Rauschen und einem gezogenen Kamm; Senken auffüllen (Priority-Flood) → Seen und
  Abflussrichtung; Flüsse aus dem gesammelten Abfluss.
- Gelände aus Höhe und Feuchte (Schwellen nach Anteilen, nicht fest), geglättet und als Flächen
  umrandet (Marching Squares).
- Siedlungen an logischen Stellen mit Begründung („an einer Flussmündung, auf ebenem Grund“).
- Wege per A* über Geländekosten, Straßen zuerst, Pfade nutzen sie mit; Brücken an Flüssen;
  Reisezeit nach D&D 2024 (normales Tempo, schwieriges Gelände halbiert).
- Starkregen sperrt den Pfad mit dem meisten Sumpf und rechnet den Umweg querfeldein.
- Ansichten Karte, Hex (6 Meilen) und Netz aus denselben Daten; Detail nach Zoom.

Für den Einbau in Wayfarer zu beachten: Zufall über `domain/random.ts` statt eigener Hashfunktion,
Farben aus `tokens.css`, Rechnung in `src/domain/` mit Tests, Zeichnen in `features/`.

## 4a. Leiten in einer lebendigen Sandbox

Besprochen am 11. 11. 2026 (abends). Die Gruppe bewegt sich frei durch eine Welt mit mehreren
Geschichten gleichzeitig. Sie kann eine Geschichte verfolgen, liegen lassen, den Ort wechseln
oder die Region ganz verlassen. Es gibt keine Handlung, die vorbereitet abläuft, sondern
**Kräfte, die sich bewegen**, und die Gruppe läuft hindurch.

### Eine Geschichte ist ein Vorhaben, kein Plot

Jede Geschichte hat:

- **Wer sie antreibt:** eine Person oder Fraktion.
- **Was passiert, wenn niemand eingreift:** eine Uhr (`domain/clock.ts`, mit Bedingungen nach
  3.3). Sie läuft weiter, auch wenn die Gruppe woanders ist.
- **Einstiege:** wo und wie die Gruppe darauf stoßen kann, an mehreren Orten.
- **Fäden und Hinweise:** was die Gruppe darüber wissen kann und was sie schon weiß.

Lässt die Gruppe eine Geschichte liegen, läuft sie weiter; die Folgen landen in „Die Welt dreht
sich weiter“. Kehrt die Gruppe zurück, findet sie den neuen Stand vor.

### Fäden und Hinweise

- Ein **Faden** ist eine Frage, die die Geschichte stellt. Zustand: offen, aktiv, ruhend, gelöst,
  verloren. Er hängt an Personen, Orten, Fraktionen und Uhren.
- **Hinweise** am Faden: wo man sie findet und ob die Gruppe sie hat. Wayfarer warnt, wenn ein
  wichtiger Faden nur noch an einem Hinweis hängt, den die Gruppe verpassen kann.

### Ruf entscheidet über den Einstieg

Haltungen zu Personen gibt es schon. Neu: **Ruf bei Fraktionen, je Gefährte und für die
Gruppe.** Ein Einstieg kann am Ruf hängen: Bei gutem Ruf bittet man um Hilfe, bei schlechtem wird
ein Gefährte am Tor erkannt. Der Ruf ändert nicht die Geschichte, sondern wie die Gruppe
hineinkommt.

### Situationen statt Szenen

Vorbereitet werden Situationen, die an Orten und Personen hängen („Wenn die Gruppe X aufsucht,
will Y etwas von ihr“), keine Abfolge von Szenen.

### Was der Spielleiter am Tisch sieht

Wo immer die Gruppe ist, zeigt Wayfarer am Ort:

- welche Geschichten diesen Ort gerade berühren,
- wie weit sie sind (Stand der Uhr),
- welcher Einstieg passt, gefiltert nach dem Ruf der Anwesenden,
- welche Situationen und Hinweise hier bereitliegen, und wer hier etwas weiß.

Der Spielleiter bereitet Geschichten vor statt Wege; Wayfarer sagt, wo die Gruppe gerade mit
welcher zusammenstößt.

### Das Fadenbrett

Das Storyboard: alle Geschichten nebeneinander, wie weit jede ist, wie nah die Gruppe dran ist
und wo sie sich berühren (eine Geschichte, die eine andere trifft). Als Pinnwand mit Personen,
Orten und Fäden, verbunden durch Linien.

### Wenn Geschichten sich berühren

Verbindungen zwischen Geschichten werden nicht von Hand gezogen, sondern erkannt:

- **Gemeinsame Knoten:** Hängen zwei Geschichten an derselben Person, demselben Ort oder derselben
  Fraktion, zeigt das Fadenbrett die Berührung, mit dem Grund daran (z. B. „über den Hafen: Die
  Rebellen waren dort gefangen“). Jede Geschichte listet ihre Verbindungen.
- **Hinweise wandern:** Wer an einem Ort war oder etwas erlebt hat, ist eine Quelle für die Fäden
  der anderen Geschichte. Hängt ein Faden nur an einem Hinweis, nennt Wayfarer zweite Wege über
  verbundene Geschichten. So stolpert die Gruppe auch in eine Geschichte, wenn sie einer anderen
  folgt.
- **Folgen springen über:** Was in einer Geschichte geschieht, prüft Wayfarer gegen die
  verbundenen. Betrifft es sie, kommt ein Vorschlag („Betrifft auch: … Soll das etwas ändern?“).
  Entschieden wird von Hand, auch über Folgen für den Ruf.
- Grundlage ist das Wissen der Personen (3.8): Was jemand miterlebt hat, steht dort.

### Das Fadenbrett im Entwurf

Am 11. 11. 2026 als Entwurf gezeigt und für gut befunden: Brett nach Nähe zur Gruppe geordnet
(Hier · Erreichbar · Fern); Geschichten als Karten mit Antreiber und Uhr (Zustand läuft, ruht,
blockiert); rote Fäden zu Personen und Orten, goldene Linien, wo Geschichten sich berühren;
Ruf als eigene Linie; Seitenteil mit Uhr, „Wenn niemand eingreift“, Fäden mit gefundenen und
fehlenden Hinweisen, Einstiegen und Ruf; Umschalter **Wahrheit / Was die Gruppe weiß**, der
Geschichten zu den Fäden macht, die die Spieler kennen, und Verborgenes ausblendet.

### Nach der Session

Aus der Mitschrift schlägt Wayfarer vor, welche Fäden sich bewegt haben und welche Hinweise
gefunden wurden. Der Spielleiter bestätigt.

## 4b. Bestiarium

Besprochen am 11. 11. 2026. Monster nach D&D-2024-Regeln bauen, Homebrew einfach machen,
Monster übernehmen – und Monster als lebendiger Teil der Welt.

### Erben statt kopieren

- **Spezies** (gibt es schon als Art `species`): Lebensweise, Sprache, Gesellschaft.
- **Vorlage:** der Statblock (z. B. „Goblin“).
- **Variante:** erbt die Vorlage und hält nur fest, was abweicht („Goblin-Krieger“). Ändert sich
  die Vorlage, ziehen Varianten mit, außer wo sie bewusst abweichen.
- **Einzelner:** ein bestimmtes Wesen mit Namen, eigenen Trefferpunkten, Zustand und Geschichte.

### Homebrew

Wayfarer rechnet, was sich rechnen lässt: Modifikatoren, Übungsbonus aus dem
Herausforderungsgrad, Angriffsbonus, Rettungswurf-SG, durchschnittlicher Schaden aus den Würfeln,
Trefferpunkte aus Trefferwürfeln und Konstitution; dazu eine Einschätzung, ob der
Herausforderungsgrad zu den Werten passt. Darstellung im Statblock-Format von 2024.

### Übernehmen

Quellen des Spielleiters: physische Bücher, D&D Beyond (große Teile der Bücher), andere Tools.

- **SRD 5.2** (frei lizenziert, Regeln 2024): auf Knopfdruck übernehmen.
- **Statblock als Text einfügen:** Wayfarer erkennt die Teile, auch im Layout von D&D Beyond.
  D&D Beyond hat keine offizielle Ausfuhr; kein automatisches Abgreifen.
- **Foto aus dem Buch:** über den freiwilligen KI-Leser (er liest nur ab, erfindet nichts); jedes
  Feld wird vor dem Übernehmen bestätigt.
- **Dateien anderer Tools:** Formate noch offen.
- Jedes Monster trägt seine Quelle. Monster aus Büchern liegen nur im Kampagnenordner, nie im
  Repository und nie mitgeliefert.

### Lebendige Monster

- **Bestände an Orten statt einzelner Statblöcke:** ein Bau, Hort oder Nest ist ein Ort mit
  Bewohnern (z. B. „rund 30, davon 6 Krieger und ein Anführer“), Vorräten, Beute und Revier.
- **Bestände verändern sich:** Verluste im Kampf fehlen danach; mit der Zeit wächst ein Bestand
  nach; wird der Bau zerstört, ziehen Überlebende weiter.
- **Reviere erzeugen Begegnungen:** Was unterwegs auftaucht, kommt aus den Revieren der Gegend.
  Raubzüge sind Abläufe (3.4) und haben Folgen (ausbleibende Händler).
- **Große Einzelne** (ein Drache) haben Hort, großes Revier und regelmäßige Jagd; die Spuren
  landen in „Die Welt dreht sich weiter“. Alles, was Geschichte ist (greift er eine Stadt an?),
  bleibt Vorschlag.
- **Erinnerung:** Wer aus einem Kampf flieht, warnt den Bau; beim nächsten Besuch ist er
  vorbereitet. Ein Überlebender kann zum Einzelnen mit Namen werden.

### Was das Bestiarium können muss (erste Version) und später

- **Statblock nach 2024:** Größe, Typ, Gesinnung, RK, Initiative, Trefferpunkte, Bewegungsarten,
  Attribute mit Modifikator und Rettungswurf, Fertigkeiten, Resistenzen und Immunitäten, Sinne
  und passive Wahrnehmung, Sprachen, HG mit EP und Übungsbonus, Merkmale, Aktionen,
  Bonusaktionen, Reaktionen, legendäre Aktionen, Zauberwirken, Ausrüstung – dazu **Lebensraum**
  und **Schatz** (speisen Reviere und Beute).
- **Bauen** – Muss: Vorlage, Variante, Einzelner; Rechenbares rechnet Wayfarer; Fähigkeiten aus
  anderen Monstern übernehmen. Später: Schablonen („als Untoter“), HG hoch- oder runterrechnen.
- **Übernehmen** – Muss: Text einfügen, SRD 5.2. Später: Foto, Dateien anderer Tools.
- **Finden** – Muss: Suche; Filter nach HG, Typ, Lebensraum, Quelle. Später: „Was lebt hier?“
- **Am Tisch** – Muss: Statblock auf einen Blick, Angriffe und Schaden würfeln, mehrere Exemplare
  mit eigenen Trefferpunkten, Begegnung zusammenstellen mit Schwierigkeit nach dem EP-Budget von
  2024. Später: voller Kampfmodus.
- **Wissen der Gruppe** – Später, aber im Modell vorsehen: Würfe auf Arkane Kunde, Naturkunde
  usw. decken Teile des Statblocks auf.
- **Lebendigkeit** – Muss: Bau oder Hort als Ort mit Bestand; Verluste zählen. Später:
  Nachwachsen, Abwandern, Reviere, Begegnungen aus Revieren, Raubzüge, Erinnerung.
  Vom Spielleiter am 11. 11. 2026 so bestätigt.

## 5. Vorgeschlagene Reihenfolge

**Karten**

1. Gemeinsames Datenmodell für Kartenschichten (Vektoren, Lage in der Welt, Ebenen, Unterkarten).
   Atlas, Bildkarten und Hexkarten der Erkundung darauf zusammenführen.
2. Zeichner (Canvas/WebGL, Kacheln, Detail nach Zoom) mit Bild-, Hex- und Netzansicht.
3. Gelände-Pinsel.
4. Linien: Küsten, Flüsse, Straßen, Pfade, mit Reisezeit ab dem ersten Strich.
5. Symbole und Beschriftung; Orte setzen und mit der Welt verknüpfen.
6. Raster für Dungeons und Gebäude (Grundlage für den Kampfmodus).
7. Städte: Viertel, Straßen, Häuserblöcke.

**Lebendige Welt**

1. Zustände an Wegen und Orten, die von selbst entstehen (Wetter → Weg).
2. „Die Welt dreht sich weiter“ mit Gewicht, Bündeln, Beobachten und Vorschlägen.
3. Uhren mit Bedingungen; „weiß es noch nicht / frühestens / spätestens“.
4. Regelmäßige Abläufe mit Fahrplan; Ausbleiben als Ereignis.
5. Nachrichten reisen über Träger.
6. NSC-Stufen und Lebendigkeit je Ort.
7. Wissensebenen und Gerüchte.

**Leiten**

1. Geschichten als Vorhaben (Antreiber, Uhr, Einstiege) und Fäden mit Hinweisen.
2. Ruf bei Fraktionen, je Gefährte und Gruppe; Einstiege abhängig vom Ruf.
3. Am Spieltisch: was den Ort gerade berührt.
4. Das Fadenbrett.
5. Vorschläge aus der Mitschrift.

**Bestiarium**

1. Statblock-Modell mit Vorlage, Variante, Einzelnem; Rechnung und Anzeige nach 2024.
2. Übernehmen: SRD 5.2, Text einfügen, später Foto und andere Tools.
3. Bestände, Baue und Reviere; Begegnungen aus Revieren.

**Später** (noch nicht besprochen): Kampfmodus, Dungeoncrawl.

## 6. Offene Fragen

- Sollen die Spieler die Karte je selbst sehen (zweiter Bildschirm, Beamer)?
- Neuigkeiten ohne angelegten Träger: langsam herumsprechen lassen oder nur über Träger?
- Wissen auch für die Bedeutung von Ereignissen: Erkennt ein Betroffener nur, *dass* etwas fehlt,
  oder auch, dass ein Plan geplatzt ist? (Vorschlag: am Vorhaben festlegen, wer eingeweiht ist.)
- Wie Unterkarten erzeugt werden, wenn keine gezeichnet ist (Stadt, Dungeon).
