# Getrennte Wege – Entwurf (Station 1 von Version 1.0)

Stand 16. 11. 2026. Schritt 1 ist gebaut (unten „Stand nach Schritt 1“). Plan:
`docs/VERSION-1.md`.

## Befund

- Der Ort der Gruppe ist ein Feld: `state.placeId` (`domain/schema.ts:121`), direkt gelesen an
  98 Stellen in 59 Dateien. `DATA_VERSION = 3` (`schema.ts:16`).
- Ortswechsel: Chronik-Art `travel` `{ fromId, toId }` (`schema.ts:791`); `moveParty`
  (`data/actions.ts:362`), `walk`/`walkRoute` (`features/wege/actions.ts:81/102`),
  `MovePartyDialog` (`shell/dialogs.tsx:835`); Festhalten `record.ts:144-170`, Löschen
  `effectHolds` (`record.ts:854`), `setPlace`/`restore` (`record.ts:982-1008`).
- Eine Sorte für alle Ortswechsel (`sortKeyOf('travel')`, `history.ts:107`); Ort zu einer Zeit
  `partyPlaceAt` (`history.ts:84`), doppelt in `looseEnds.ts:80` (`placeAtEntry`); `worldAt`
  (`worldAt.ts:378`); Besuche `partyStays`/`visitsTo`/`placeStatus` (`derive.ts:363-419`).
- Schon da: `character.placeId` (abseits, `schema.ts:342`; `characterPlaceId`, `derive.ts:521`;
  `moveCharacter`, `gruppe/actions.ts:92` – schreibt nur eine Notiz, `worldAt` kann es nicht
  zurückrechnen); Teilnehmerlisten `timer/journey/rest.participants`; `character.active`;
  `state.march`; NSC-Begleiter Art `companion` (`partyCompanions`, `history.ts:340`);
  Abgleich `STATE_RULES` (`domain/syncMerge.ts:38`).

## Entwurf

**Daten (DATA_VERSION 4, neuer DATA_SHAPE):**
- `state.groups: [{ id, memberIds, placeId }]` – leer = alle zusammen (heutiges Verhalten, ältere
  Stände unverändert). Mitglieder: aktive Gefährten und NSC-Begleiter; Neue gehen in die
  geleitete Teilgruppe.
- `state.leadId` = geleitete Teilgruppe. Regel: `state.placeId` ist immer ihr Ort (nur Befehle in
  `actions.ts` sorgen dafür) – so bleiben die meisten Leser unverändert.
- `STATE_RULES`: Gruppe `party: ['placeId', 'groups', 'leadId']` (ein Widerspruch beim Abgleich
  entscheidet alle drei zusammen).
- `travel.who: id[]` (leer = ganze Gruppe); `chronicle.party: id[]` (wer dabei war, nur gesetzt,
  solange getrennt, automatisch wie `sessionId`).

**Befehle und Regeln** (neu `domain/party.ts`: `partyGroups`, `ledMembers`, `groupOf`,
`partyPlaces`, `memberPlaceAt`):
- Trennen `splitParty(who, ziel?)` (mit Ziel über `walk(…, who)`), Umschalten `leadGroup` (ändert
  nur `leadId`/`placeId`, nichts in der Chronik), Zusammenführen `mergeGroups` (nur auf Klick;
  am selben Ort ohne Text in der Chronik; bleibt eine Teilgruppe, wird `groups = []`).
- `moveParty`/`walk` mit `who`, Vorgabe = geleitete Teilgruppe.
- Ort je Gefährte: jüngster Ortswechsel, an dem er beteiligt war (`partyPlaceAt(data, at,
  memberId)`); `isNewestOfSort` für `travel`: kein späterer Ortswechsel betrifft eines seiner
  Mitglieder – ebenso in `recordEntry`, `effectHolds`, `placeAtEntry`, `continuity`, `timeline`.
- **Eine Weltzeit für alle.** Reise/Rast einer Teilgruppe stellt sie vor; die anderen bleiben, wo
  sie sind; Wayfarer schreibt nichts für sie, zeigt nur „zuletzt geleitet vor …“.
- NSC-Begleiter gehen mit ihrem Besitzer; Gruppenbegleiter wählt man beim Trennen.
- Leser: unverändert (Läden, Szenen, Geschichten hier, Wetter, Gedächtnis); alle Teilgruppen über
  `partyPlaces` (`isNear`, `nearness`, `worldTurn`, `looseOrder`, Spielerbuch, Rückblick, Abend,
  Karten); nur geleitete Mitglieder `ledMembers` (Licht, Rast, Begegnungen, Marsch).
- `worldAt`: Teilgruppen aus den Orten der Gefährten zur Zeit; Seite zeigt „getrennt: A, B in X ·
  C in Y“. Alte Stände: `who = []` = ganze Gruppe; `character.placeId` wird als Teilgruppe aus
  einer Person gelesen.

**Spieltisch (1440 × 900):** drei Spalten bleiben; die Gefährten-Leiste unten wird Umschalter der
Teilgruppen (`wf-btn-group`, `aria-pressed`, Alt+1…4): je Teilgruppe Mitglieder, Ort, „vor N Min.
geleitet“; daneben „Trennen …“ und „Zusammenführen“. Weltleiste: „getrennt (2)“. Mitschrift mit
Marke der Teilgruppe, Fremdes schwach, Umschalter „nur diese / alle“.

## Schritte

1. Modell und Spieltisch (~15 Dateien, ~4 Testdateien): Schema/Version/Gestalt, `STATE_RULES`,
   `party.ts`, `history.ts`, `record.ts`, `actions.ts`, `wege/actions.ts`, Ortswechsel-Dialog mit
   „Wer geht?“, Trennen-Dialog, Umschalter am Spieltisch, Marken in der Mitschrift. Danach ist
   eine getrennte Gruppe in einer Stadt führbar.
2. Leser über alle Teilgruppen (~25 Dateien, ~8 Testdateien): `weight`, `story`, `worldTurn`,
   `looseEnds`, `prepOffers`/Abend, `recap`, `playerBook`, `worldAt` (`groupsAt`), `timeline`
   (Bahn je Teilgruppe), `continuity`, Licht/Sicht/Rast/Begegnungen/Marsch über die Mitglieder,
   Karten, Welt-Dossier, Weltleiste; `moveCharacter` auf Teilgruppen umstellen.

## Entscheidungen des Spielleiters (16. 11. 2026)

1. **Jede Teilgruppe hat ihre eigene Uhr** (seine Worte: „Wenn sich die Gruppe trennt, muss die
   Zeit für sie individuell vergehen.“ Hauptfragen am Tisch: „Wann kommen wir an?“, „Wann bin
   ich wieder da?“). Das ersetzt „eine Weltzeit für alle“ oben.
2. Am selben Ort erst auf Klick wieder zusammen (wie empfohlen).
3. Mitschrift zeigt alles vom Abend mit Marke, Fremdes schwach, Umschalter „nur diese“.
4. „Abseits“ wird eine Teilgruppe aus einer Person.

### Eigene Uhr je Teilgruppe – Modell (ersetzt „Eine Weltzeit für alle“)

- Jede Teilgruppe hat ihre Zeit (`group.now`). Ist die Gruppe nicht getrennt, gilt `state.now`
  wie heute. `state.now` ist immer die Zeit der geleiteten Teilgruppe (wie `placeId`) – so bleiben
  Leser unverändert und rechnen Wetter, Licht, Wer-ist-wo für die geleitete Teilgruppe zu ihrer
  Zeit.
- **Die vorderste Uhr** (`state.front` o. ä.) ist die Weltzeit für alles, was von selbst
  geschieht: Termine, Schritte der Uhren, Abläufe treten **genau einmal** ein, wenn die vorderste
  Uhr sie erreicht – nie erneut, wenn eine zurückliegende Teilgruppe vorrückt, nie rückgängig
  beim Umschalten. Das ist die wichtigste Regel; mit Tests absichern.
- **Reisen:** Geht eine Teilgruppe (`walk(…, who)`), rückt nur ihre Uhr bis zur Ankunft vor (wie
  heute: erst Zeit, dann ankommen) – die anderen bleiben in ihrer Zeit. Aus Sicht einer
  Teilgruppe zu ihrer Zeit T ist eine andere: **unterwegs** (ihre letzte Reise umspannt T: „unterwegs
  nach X, Ankunft 16:20“), **voraus** („schon bei 17:40“) oder **zurück** („1 Std. 20 Min.
  zurück“). „Wann kommen wir an?“ zeigt der Ortswechsel-Dialog vor dem Losgehen (Ankunft, Rückweg,
  wann bei den anderen).
- **Nachholen:** „bis HH:MM nachholen“ zieht eine zurückliegende Teilgruppe auf eine Zeit vor –
  nur auf Klick, nie von selbst; was sie dabei tat, schreibt der Spielleiter nur, wenn er will.
- **Festhalten und Mitschrift** bekommen die Zeit der geleiteten Teilgruppe (`entry.at`) und
  `entry.party`; Festhalten in der Vergangenheit trägt (`isNewestOfSort`).
- **Zusammenführen:** am selben Ort; die zurückliegende wird auf die Zeit der anderen gezogen.
- Widersprüche zwischen den Zeiten meldet nur „Passt nicht zusammen“ (`continuity.ts`), leise.
- `worldAt`, Zeitleiste, Rückblick und Abend kommen in Schritt 2.

## Dazu: Haltung je Gefährte (Gespräch)

Seine Worte: „Nicht jeder NSC ist begeistert von Neil, könnte Tomlin aber lieben. Quenthel … mag
Neil nicht, ist aber in Tomlin verliebt.“ Daten können das schon (`setAttitude(fromId, toId)`,
`data/actions.ts:427`; Gefährten-Seite `gruppe/Detail.tsx:246`). Es fehlt am Tisch:
- Der Haltungs-Dialog (`shell/dialogs.tsx` ~773) setzt aus Spieltisch/Kurzblick immer die Gruppe
  (`PARTY_ID`); er braucht die Wahl „zur Gruppe / zu <Gefährte>“ (Umschalter, Vorgabe Gruppe).
- Person am Tisch (Kurzblick, „Wer hier ist“, Gedächtnis beim Tippen `memoryOf`) zeigt neben der
  Haltung zur Gruppe die abweichenden zu einzelnen Gefährten („Tomlin +5 · Neil −3“), knapp.
- Mitschrift/Festhalten: Haltung zu einem Gefährten wie zur Gruppe festhaltbar.
Klein, kommt vor den Teilgruppen.

## Klarstellung des Spielleiters (16. 11. 2026): Tätigkeiten in der Stadt zuerst

Seine Worte: „Die Gruppe teilt sich ja auch nicht auf in der Menge, dass sie sagen ‚wir gehen jetzt
nach Segenbruch und 2 von uns gehen die nächsten 3 Tage woanders hin'. Es ist eher innerhalb einer
Stadt, dass mehrere Leute gleichzeitig Dinge erledigen. Der eine geht shoppen, der andere in die
Bibliothek für 3 Stunden, Tomlin kopiert in der Burg 3 Spells, das dauert 12 Stunden, usw.“

Folgen: Der erste Fall ist eine **Tätigkeit mit Dauer an einem Ort in der Stadt**. Dialog
„Wer macht was?“ mit Zeilen: Wer, Wo (Vorgabe hier, auch ein Ort darin), Was (freie Zeile, sein
Wortlaut), Wie lange. Eine Tätigkeit wirkt auf die eigene Uhr wie eine Reise. Am Spieltisch der
Überblick „Wer macht was – bis wann“ (nach Ende geordnet, wann alle frei sind); ist eine Tätigkeit
vorbei, nur ruhig „fertig seit …“. Reisen bleiben über dieselbe Logik möglich.

## Stand nach Schritt 1 (16. 11. 2026)

Gebaut (Commits „Haltung je Gefährte …“, „Getrennte Wege, Schritt 1 …“, „Zwei Gefährten, ein
Körper …“):
- Daten (DATA_VERSION 5): `state.groups` (`memberIds`, `placeId`, `now`, `doing`), `state.leadId`,
  `travel.who`, `entry.party`, `downtime.minutes`; `character.bodyWith`/`resting`. Abgleich: Ort,
  Teilgruppen und geleitete Teilgruppe als eine Gruppe in `STATE_RULES`.
- Regel der vordersten Uhr (`frontOf`, `fireFrom`) in `advanceTime`, `undoTimeAdvance` und allen
  Befehlen; mit Tests (`domain/__tests__/party.test.ts`).
- Befehle `splitParty`, `sendOff`, `leadGroup`, `catchUp`, `mergeGroups`, `moveParty`/`walk` mit
  `who`; „Abseits“ (`moveCharacter`) als Teilgruppe aus einer Person, ohne Satz von Wayfarer.
- Spieltisch: Umschalter über der Gefährten-Leiste (je Teilgruppe Mitglieder, Ort, Tätigkeit bzw.
  Stand, „alle frei …“), „Wer macht was …“, „Nachholen …“, „Zusammenführen …“; Ortswechsel-Dialog
  mit „Wer geht?“ und Ankunft/Rückweg vorab; Mitschrift mit Marke, Fremdes schwach, „Alle
  Teilgruppen / Nur diese“.

Abweichungen vom Entwurf:
- Die vorderste Uhr ist kein eigenes Feld, sondern das Späteste der Uhren (`frontOf`) – so kann sie
  nicht auseinanderlaufen.
- Eine Tätigkeit ist ein Eintrag der vorhandenen Art „Freie Zeit“ mit Minuten (je Gefährte sein
  Wortlaut), keine neue Art. Ohne Dauer steht der Wortlaut als Notiz da.
- Mitglieder sind in Schritt 1 nur Gefährten; NSC-Begleiter ziehen noch nicht mit.
- Kein Alt+1…4, keine Marke „getrennt (2)“ in der Weltleiste.
- Zusammenführen an verschiedenen Orten ist erlaubt (nie einschränken): wer woanders steht, zieht
  ohne Text zum Ort der geleiteten Teilgruppe.

Offen für Schritt 2:
- Besuche und „seitdem verändert“ (`partyStays`, `visitsTo`, `placeStatus`) lesen alle
  Ortswechsel als einen Weg der ganzen Gruppe – nach dem Zusammenführen zählt die Ankunft der
  anderen als neuer Besuch.
- `worldAt`, Zeitleiste (Bahn je Teilgruppe), Rückblick, Abend, `looseEnds` (`placeAtEntry`),
  Kontinuität, Spielerbuch, Weltgeschehen, Karten (wo die Gruppe steht) über alle Teilgruppen.
- Kalender und Uhren zeigen „anstehend“ von der Zeit der geleiteten aus; was die vorderste Uhr
  schon ausgelöst hat, steht dann als eingetreten, obwohl die geleitete noch davor ist.
- Licht, Rast, Begegnungen, Marsch über `ledMembers`; NSC-Begleiter mit ihrem Besitzer.
- „Zeit zurücknehmen“ (`undoTimeAdvance`) öffnet nur, was hinter der vordersten Uhr eingetreten
  ist; was dabei nachträglich davor eintrat (erst später angelegt), bleibt eingetreten – nie
  doppelt, aber nicht zurückgenommen. Die Rückgängig-Knöpfe der Teilgruppen nehmen es genau zurück.
- Alte `character.placeId` (abseits aus früheren Ständen) wird noch nicht als Teilgruppe gelesen;
  ein Klick „zurück zur Gruppe“ setzt ihn wie bisher zurück.
