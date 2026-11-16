import { describe, expect, it } from 'vitest';
import {
  advanceTime,
  catchUp,
  leadGroup,
  logEntry,
  mergeGroups,
  moveParty,
  settleTime,
  splitParty,
  undoTimeAdvance,
} from '../../data/actions';
import { recordEntry, removeRecorded } from '../../data/record';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { moveCharacter } from '../../features/gruppe/actions';
import { walk } from '../../features/wege/actions';
import { partyPlaceAt } from '../history';
import {
  frontOf,
  groupOf,
  groupStanding,
  isSplit,
  ledMembers,
  memberPlaceAt,
  partyGroups,
  partyOverview,
} from '../party';
import { createClock, createEntity, createEvent, createTimer, PlayStateSchema } from '../schema';

const HOUR = 60;

/**
 * Erfunden: die Stadt Kaltenbrück mit Markt, Archiv und Burg; vier Gefährten – Arn, Bela, Cyd
 * und Dorn – und die Händlerin Wenna.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  for (const entity of Object.values(db.getSnapshot().entities))
    if (entity.kind === 'character')
      db.patch('entities', entity.id, { character: { ...entity.character, active: false } });
  const city = db.put('entities', createEntity({ kind: 'place', name: 'Kaltenbrück' }));
  const sub = (name: string) =>
    db.put(
      'entities',
      createEntity({ kind: 'place', name, place: { parentId: city.id } } as never),
    );
  const market = sub('Fischmarkt');
  const archive = sub('Archiv der Brücke');
  const castle = sub('Burg Kaltenbrück');
  const mate = (name: string) => db.put('entities', createEntity({ kind: 'character', name }));
  const [arn, bela, cyd, dorn] = ['Arn', 'Bela', 'Cyd', 'Dorn'].map(mate) as [
    ReturnType<typeof mate>,
    ReturnType<typeof mate>,
    ReturnType<typeof mate>,
    ReturnType<typeof mate>,
  ];
  moveParty(db, city.id);
  const t0 = db.getSnapshot().state.now;
  return { db, city, market, archive, castle, arn, bela, cyd, dorn, t0 };
}

type World = Awaited<ReturnType<typeof setup>>;

/** Einer kauft ein (1 Std.), einer ins Archiv (3 Std.), einer kopiert Zauber (12 Std.), Dorn bleibt. */
function cityDay(w: World) {
  const result = splitParty(w.db, [
    { memberIds: [w.arn.id], placeId: w.market.id, text: 'kauft ein', minutes: HOUR },
    { memberIds: [w.bela.id], placeId: w.archive.id, text: 'liest Chroniken', minutes: 3 * HOUR },
    { memberIds: [w.cyd.id], placeId: w.castle.id, text: 'kopiert Zauber', minutes: 12 * HOUR },
  ]);
  if ('problem' in result) throw new Error(result.problem);
  return result;
}

const eventLines = (db: CampaignDb, eventId: string) =>
  Object.values(db.getSnapshot().chronicle).filter((e) => e.eventId === eventId).length;

describe('Getrennte Wege: Teilgruppen mit eigener Uhr', () => {
  it('ein alter Spielstand ohne Teilgruppen lädt unverändert', () => {
    const state = PlayStateSchema.parse({ id: 'state', now: 5000, placeId: null });
    expect(state.groups).toEqual([]);
    expect(state.leadId).toBeNull();
  });

  it('zusammen verhält sich alles wie bisher', async () => {
    const w = await setup();
    expect(isSplit(w.db.getSnapshot())).toBe(false);
    expect(frontOf(w.db.getSnapshot())).toBe(w.t0);
    walk(w.db, w.market.id, 30);
    const data = w.db.getSnapshot();
    expect(data.state.now).toBe(w.t0 + 30);
    expect(data.state.placeId).toBe(w.market.id);
    const travel = Object.values(data.chronicle).find((e) => e.travel?.toId === w.market.id)!;
    expect(travel.travel?.who).toBeUndefined();
    expect(travel.party).toEqual([]);
  });

  it('trennt in Teilgruppen: je Zeile Ort, Tätigkeit und eigene Uhr', async () => {
    const w = await setup();
    const result = cityDay(w);
    const data = w.db.getSnapshot();
    expect(isSplit(data)).toBe(true);
    // Dorn bleibt in der Stadt und wird geleitet – zur Zeit von eben.
    expect(ledMembers(data)).toEqual([w.dorn.id]);
    expect(data.state.now).toBe(w.t0);
    expect(data.state.placeId).toBe(w.city.id);
    expect(groupOf(data, w.cyd.id)).toMatchObject({
      placeId: w.castle.id,
      now: w.t0 + 12 * HOUR,
      doing: { from: w.t0, until: w.t0 + 12 * HOUR },
    });
    expect(frontOf(data)).toBe(w.t0 + 12 * HOUR);
    // Je Zeile ein Ortswechsel und eine Tätigkeit in ihren Worten – nichts sonst.
    const kinds = result.entries.map((e) => e.kind);
    expect(kinds).toEqual(['travel', 'downtime', 'travel', 'downtime', 'travel', 'downtime']);
    const copy = result.entries[5]!;
    expect(copy.downtime).toMatchObject({
      minutes: 12 * HOUR,
      activities: [{ characterId: w.cyd.id, text: 'kopiert Zauber' }],
    });
    expect(copy.party).toEqual([w.cyd.id]);
    // Der Ort je Gefährte folgt seiner eigenen Kette.
    expect(memberPlaceAt(data, w.t0, w.bela.id)).toBe(w.archive.id);
    expect(memberPlaceAt(data, w.t0, w.dorn.id)).toBe(w.city.id);
  });

  it('der Überblick: wer macht was bis wann, und wann alle wieder frei sind', async () => {
    const w = await setup();
    cityDay(w);
    const view = partyOverview(w.db.getSnapshot());
    expect(view.rows.map((row) => [row.names.join(), row.doing, row.until])).toEqual([
      ['Dorn', '', null],
      ['Arn', 'kauft ein', w.t0 + HOUR],
      ['Bela', 'liest Chroniken', w.t0 + 3 * HOUR],
      ['Cyd', 'kopiert Zauber', w.t0 + 12 * HOUR],
    ]);
    expect(view.allFree).toBe(w.t0 + 12 * HOUR);
    // Ist eine Tätigkeit vorbei, steht sie ruhig als „fertig seit“.
    leadGroup(w.db, groupOf(w.db.getSnapshot(), w.bela.id)!.id);
    const arn = groupOf(w.db.getSnapshot(), w.arn.id)!;
    expect(groupStanding(arn, w.t0 + 3 * HOUR)).toEqual({
      kind: 'behind',
      by: 2 * HOUR,
      doneSince: w.t0 + HOUR,
    });
    expect(groupStanding(groupOf(w.db.getSnapshot(), w.cyd.id)!, w.t0 + 3 * HOUR)).toEqual({
      kind: 'busy',
      until: w.t0 + 12 * HOUR,
    });
  });

  it('Termine und Schritte der Uhren treten genau einmal ein: wenn die vorderste Uhr sie erreicht', async () => {
    const w = await setup();
    const event = w.db.put(
      'events',
      createEvent({
        title: 'Die Glocke der Brücke schlägt',
        at: w.t0 + 2 * HOUR,
        timed: true,
        kind: 'world',
      }),
    );
    const clock = w.db.put(
      'clocks',
      createClock({
        title: 'Die Schmuggler räumen das Lager',
        start: w.t0,
        steps: [
          {
            id: 's1',
            text: 'Das Lager ist leer',
            days: 0.25,
            delay: 0,
            at: null,
            skipped: false,
            needs: '',
            runId: null,
          },
        ],
      }),
    );
    const steps = () =>
      Object.values(w.db.getSnapshot().chronicle).filter((e) => e.clockId === clock.id).length;
    // Cyd kopiert 12 Stunden: Seine Uhr überholt die Glocke (2 Std.) und den Schritt (6 Std.).
    cityDay(w);
    expect(eventLines(w.db, event.id)).toBe(1);
    expect(steps()).toBe(1);
    // Dorn (geleitet) rückt 4 Stunden vor – nichts tritt ein zweites Mal ein.
    advanceTime(w.db, w.t0 + 4 * HOUR);
    expect(eventLines(w.db, event.id)).toBe(1);
    expect(steps()).toBe(1);
    // Umschalten nimmt nichts zurück, Nachholen einer zurückliegenden löst nichts doppelt aus.
    const arn = groupOf(w.db.getSnapshot(), w.arn.id)!;
    leadGroup(w.db, arn.id);
    expect(eventLines(w.db, event.id)).toBe(1);
    catchUp(w.db, arn.id, w.t0 + 5 * HOUR);
    expect(eventLines(w.db, event.id)).toBe(1);
    expect(steps()).toBe(1);
    // Rückgängig eines Zeitsprungs hinter der vordersten Uhr öffnet nichts wieder.
    advanceTime(w.db, w.t0 + 6 * HOUR);
    undoTimeAdvance(w.db);
    expect(eventLines(w.db, event.id)).toBe(1);
    expect(steps()).toBe(1);
  });

  it('was hinter der vordersten Uhr liegt, tritt ein, sobald eine Teilgruppe sie überholt', async () => {
    const w = await setup();
    const late = w.db.put(
      'events',
      createEvent({
        title: 'Die Tore schließen',
        at: w.t0 + 14 * HOUR,
        timed: true,
        kind: 'world',
      }),
    );
    cityDay(w);
    expect(eventLines(w.db, late.id)).toBe(0);
    // Dorn wird 15 Stunden nachgeholt: Er überholt Cyd (12 Std.) – erst jetzt schließen die Tore.
    const dorn = groupOf(w.db.getSnapshot(), w.dorn.id)!;
    const result = catchUp(w.db, dorn.id, w.t0 + 15 * HOUR)!;
    expect(result.advance.occurred.map((o) => o.event.id)).toEqual([late.id]);
    expect(eventLines(w.db, late.id)).toBe(1);
    expect(frontOf(w.db.getSnapshot())).toBe(w.t0 + 15 * HOUR);
    // Rückgängig nimmt es wieder zurück.
    result.undo();
    expect(eventLines(w.db, late.id)).toBe(0);
    expect(w.db.getSnapshot().state.now).toBe(w.t0);
  });

  it('was erst hinter der vordersten Uhr angelegt wird, tritt trotzdem genau einmal ein', async () => {
    const w = await setup();
    cityDay(w);
    // Cyd ist 12 Stunden voraus. Erst jetzt legt der Spielleiter für Dorn (geleitet) einen Termin
    // in zwei Stunden an und entzündet eine Fackel für eine Stunde.
    const meeting = w.db.put(
      'events',
      createEvent({ title: 'Treffen am Brunnen', at: w.t0 + 2 * HOUR, timed: true, kind: 'plan' }),
    );
    const torch = w.db.put(
      'timers',
      createTimer({ label: 'Fackel', kind: 'light', start: w.t0, end: w.t0 + HOUR }),
    );
    const result = advanceTime(w.db, w.t0 + 4 * HOUR);
    expect(result.occurred.map((o) => o.event.id)).toEqual([meeting.id]);
    expect(result.expired.map((t) => t.id)).toEqual([torch.id]);
    expect(eventLines(w.db, meeting.id)).toBe(1);
    expect(w.db.getSnapshot().timers[torch.id]!.done).toBe(true);
    // Rückt danach eine andere zurückliegende Teilgruppe darüber, tritt nichts ein zweites Mal ein.
    const arn = groupOf(w.db.getSnapshot(), w.arn.id)!;
    const later = catchUp(w.db, arn.id, w.t0 + 5 * HOUR)!;
    expect(later.advance.occurred).toEqual([]);
    expect(eventLines(w.db, meeting.id)).toBe(1);
    // Rückgängig des Nachholens lässt stehen, was Dorn erreicht hat.
    later.undo();
    expect(eventLines(w.db, meeting.id)).toBe(1);
  });

  it('Rückgängig des Trennens nimmt auch zurück, was erst danach eingetreten ist', async () => {
    const w = await setup();
    cityDay(w);
    const dorn = groupOf(w.db.getSnapshot(), w.dorn.id)!;
    const meeting = w.db.put(
      'events',
      createEvent({ title: 'Treffen am Brunnen', at: w.t0 + 2 * HOUR, timed: true, kind: 'plan' }),
    );
    // Dorn trennt sich weiter: Er geht für 3 Stunden ins Archiv – dabei tritt das Treffen ein.
    const again = splitParty(w.db, [{ memberIds: [w.dorn.id], text: 'sucht', minutes: 3 * HOUR }]);
    if ('problem' in again) throw new Error(again.problem);
    expect(again.advance.occurred.map((o) => o.event.id)).toEqual([meeting.id]);
    expect(eventLines(w.db, meeting.id)).toBe(1);
    again.undo();
    expect(eventLines(w.db, meeting.id)).toBe(0);
    expect(groupOf(w.db.getSnapshot(), w.dorn.id)?.id).toBe(dorn.id);
  });

  it('Abgleich: die Wahl der Weltzeit öffnet nichts, was die vorderste Uhr hier erreicht hat', async () => {
    const w = await setup();
    const bell = w.db.put(
      'events',
      createEvent({ title: 'Die Glocke schlägt', at: w.t0 + HOUR / 2, timed: true, kind: 'world' }),
    );
    cityDay(w);
    expect(eventLines(w.db, bell.id)).toBe(1);
    // Gewählt ist dieser Stand (Dorn geleitet, t0); der andere Rechner stand eine Stunde weiter.
    settleTime(w.db, w.t0, w.t0 + HOUR);
    expect(eventLines(w.db, bell.id)).toBe(1);
    expect(w.db.getSnapshot().events[bell.id]!.done).toBe(true);
  });

  it('reist eine Teilgruppe, rückt nur ihre Uhr vor – die andere bleibt', async () => {
    const w = await setup();
    // Arn und Bela gehen 3 Stunden zur Burg, Cyd und Dorn bleiben (geleitet).
    walk(w.db, w.castle.id, 3 * HOUR, '', [w.arn.id, w.bela.id]);
    const data = w.db.getSnapshot();
    expect(data.state.now).toBe(w.t0);
    expect(data.state.placeId).toBe(w.city.id);
    const away = groupOf(data, w.arn.id)!;
    expect(away).toMatchObject({ placeId: w.castle.id, now: w.t0 + 3 * HOUR });
    expect(away.memberIds).toEqual([w.arn.id, w.bela.id]);
    // Zu Dorns Zeit ist sie unterwegs, eine Stunde später auch, nach der Ankunft voraus bzw. gleichauf.
    expect(groupStanding(away, w.t0 + HOUR)).toEqual({ kind: 'busy', until: w.t0 + 3 * HOUR });
    expect(groupStanding(away, w.t0 + 3 * HOUR)).toMatchObject({ kind: 'same' });
    // Wo die Gruppe war, rechnet je Gefährte.
    expect(partyPlaceAt(data, w.t0 + 3 * HOUR, [w.arn.id])).toBe(w.castle.id);
    expect(partyPlaceAt(data, w.t0 + 3 * HOUR, [w.dorn.id])).toBe(w.city.id);
    // Reist dann die geleitete Teilgruppe, rückt ihre Uhr vor und sie steht am Ziel.
    walk(w.db, w.market.id, 20);
    expect(w.db.getSnapshot().state).toMatchObject({ now: w.t0 + 20, placeId: w.market.id });
    expect(groupOf(w.db.getSnapshot(), w.arn.id)?.now).toBe(w.t0 + 3 * HOUR);
  });

  it('Rückgängig eines Weges der geleiteten Teilgruppe nimmt auch „unterwegs“ zurück', async () => {
    const w = await setup();
    cityDay(w);
    const dorn = groupOf(w.db.getSnapshot(), w.dorn.id)!;
    const went = walk(w.db, w.market.id, 20);
    expect(groupOf(w.db.getSnapshot(), w.dorn.id)?.doing).toMatchObject({ until: w.t0 + 20 });
    went.undo();
    const back = w.db.getSnapshot();
    expect(back.state).toMatchObject({ now: w.t0, placeId: w.city.id });
    expect(groupOf(back, w.dorn.id)?.doing).toEqual(dorn.doing);
  });

  it('Festhalten bekommt die Zeit und die Mitglieder der geleiteten Teilgruppe', async () => {
    const w = await setup();
    cityDay(w);
    const bela = groupOf(w.db.getSnapshot(), w.bela.id)!;
    leadGroup(w.db, bela.id);
    const note = logEntry(w.db, { text: 'Bela findet die alte Karte' });
    expect(note.at).toBe(w.t0 + 3 * HOUR);
    expect(note.placeId).toBe(w.archive.id);
    expect(note.party).toEqual([w.bela.id]);
    const recorded = recordEntry(w.db, { kind: 'rumor', text: 'Die Brücke ist verflucht' });
    if ('problem' in recorded) throw new Error(recorded.problem);
    expect(recorded.entry.party).toEqual([w.bela.id]);
  });

  it('ein Ortswechsel einer Teilgruppe lässt sich löschen, ohne die anderen zu bewegen', async () => {
    const w = await setup();
    cityDay(w);
    const cyd = groupOf(w.db.getSnapshot(), w.cyd.id)!;
    leadGroup(w.db, cyd.id);
    const moved = recordEntry(w.db, { kind: 'travel', travel: { toId: w.market.id } });
    if ('problem' in moved) throw new Error(moved.problem);
    expect(moved.entry.travel).toMatchObject({ fromId: w.castle.id, who: [w.cyd.id] });
    expect(w.db.getSnapshot().state.placeId).toBe(w.market.id);
    // Arns eigener Ortswechsel ist davon unberührt.
    expect(groupOf(w.db.getSnapshot(), w.arn.id)?.placeId).toBe(w.market.id);
    expect(groupOf(w.db.getSnapshot(), w.bela.id)?.placeId).toBe(w.archive.id);
    removeRecorded(w.db, moved.entry.id);
    expect(w.db.getSnapshot().state.placeId).toBe(w.castle.id);
    expect(groupOf(w.db.getSnapshot(), w.bela.id)?.placeId).toBe(w.archive.id);
  });

  it('nachholen, dann zusammenführen: die Gruppe ist wieder eine', async () => {
    const w = await setup();
    cityDay(w);
    const data = w.db.getSnapshot();
    const ids = partyGroups(data).map((group) => group.id);
    const dorn = groupOf(data, w.dorn.id)!;
    catchUp(w.db, dorn.id, w.t0 + 2 * HOUR);
    expect(w.db.getSnapshot().state.now).toBe(w.t0 + 2 * HOUR);
    // Arn und Dorn: Arn steht am Markt, Dorn in der Stadt – Arn zieht zu Dorn.
    const arn = groupOf(w.db.getSnapshot(), w.arn.id)!;
    const two = mergeGroups(w.db, [dorn.id, arn.id])!;
    expect(two.entries).toHaveLength(1);
    expect(two.entries[0]!.travel).toMatchObject({ toId: w.city.id, who: [w.arn.id] });
    expect(two.entries[0]!.text).toBe('');
    expect(ledMembers(w.db.getSnapshot()).sort()).toEqual([w.arn.id, w.dorn.id].sort());
    expect(partyGroups(w.db.getSnapshot())).toHaveLength(3);
    // Alle zusammen: Die Zeit ist die der vordersten (Cyd, 12 Std.), es tritt nichts ein.
    const all = mergeGroups(
      w.db,
      partyGroups(w.db.getSnapshot()).map((group) => group.id),
    )!;
    const after = w.db.getSnapshot();
    expect(isSplit(after)).toBe(false);
    expect(after.state.now).toBe(w.t0 + 12 * HOUR);
    expect(after.state.placeId).toBe(w.city.id);
    expect(all.advance.occurred).toEqual([]);
    expect(ids).toHaveLength(4);
    // Rückgängig: wieder getrennt.
    all.undo();
    expect(partyGroups(w.db.getSnapshot())).toHaveLength(3);
  });

  it('Rückgängig nach dem Trennen stellt alles wieder her', async () => {
    const w = await setup();
    const before = w.db.getSnapshot();
    const result = cityDay(w);
    result.undo();
    const after = w.db.getSnapshot();
    expect(after.state.groups).toEqual([]);
    expect(after.state.now).toBe(before.state.now);
    expect(Object.keys(after.chronicle).sort()).toEqual(Object.keys(before.chronicle).sort());
  });

  it('„Abseits“ ist eine Teilgruppe aus einer Person – und zurück führt sie zusammen', async () => {
    const w = await setup();
    const away = moveCharacter(w.db, w.cyd.id, w.castle.id)!;
    let data = w.db.getSnapshot();
    expect(groupOf(data, w.cyd.id)).toMatchObject({ memberIds: [w.cyd.id], placeId: w.castle.id });
    expect(ledMembers(data)).not.toContain(w.cyd.id);
    // Kein Satz von Wayfarer in der Chronik – nur der Ortswechsel mit ihm allein.
    const travel = Object.values(data.chronicle).find((e) => e.travel?.toId === w.castle.id)!;
    expect(travel.text).toBe('');
    expect(travel.travel?.who).toEqual([w.cyd.id]);
    moveCharacter(w.db, w.cyd.id, null);
    data = w.db.getSnapshot();
    expect(isSplit(data)).toBe(false);
    expect(data.state.placeId).toBe(w.city.id);
    away.undo();
  });

  it('lässt nur zu, wer bei der geleiteten Teilgruppe ist, und niemanden doppelt', async () => {
    const w = await setup();
    expect(
      splitParty(w.db, [
        { memberIds: [w.arn.id], minutes: 10 },
        { memberIds: [w.arn.id], minutes: 20 },
      ]),
    ).toEqual({ problem: 'Arn steht in zwei Zeilen.' });
    cityDay(w);
    expect(splitParty(w.db, [{ memberIds: [w.cyd.id], minutes: 10 }])).toEqual({
      problem: 'Cyd ist gerade nicht bei der geleiteten Gruppe.',
    });
  });
});
