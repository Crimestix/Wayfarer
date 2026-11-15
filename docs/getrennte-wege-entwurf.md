# Getrennte Wege – Entwurf (Station 1 von Version 1.0)

Stand 16. 11. 2026, nur gelesen, nichts gebaut. Wartet auf die Entscheidungen des Spielleiters
(unten). Plan: `docs/VERSION-1.md`.

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

## Entscheidungen des Spielleiters

1. Eine Weltzeit für alle (Empfehlung) – oder je Teilgruppe eine eigene (großer Umbau).
2. Am selben Ort sind Teilgruppen nicht von selbst wieder zusammen – erst auf Klick
   (Empfehlung; am selben Ort ein Hinweis mit Knopf).
3. Mitschrift: alles vom Abend mit Marke, Fremdes schwach, Umschalter „nur diese“ (Empfehlung).
4. „Abseits“ auf der Gefährten-Seite wird eine Teilgruppe aus einer Person (Empfehlung).
