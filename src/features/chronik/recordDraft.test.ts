import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { recordEntries, recordEntry } from '../../data/record';
import { emptyCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { secretOfText } from '../../domain/prep';
import { recognizeEntry } from '../../domain/recognize';

import { PARTY_ID, createEntity, createPrep, createThread, type Entity } from '../../domain/schema';
import { ELARIS_CALENDAR, ELARIS_START } from '../../domain/time/elaris';
import {
  clueChoices,
  draftFromRecognized,
  draftOfEntry,
  draftProblem,
  emptyRecordDraft,
  hasRecordFields,
  isAccepted,
  partOf,
  prefillFromRefs,
  recordCheck,
  recordInputOf,
  recordInputs,
  secretChoices,
  toggleChoice,
  toggleRecognized,
  type RecordCommon,
  type RecordDraft,
} from './recordDraft';

const DAY = 24 * 60;
const NOW = ELARIS_START;

async function setup() {
  const db = await CampaignDb.create(
    new MemoryStore(),
    emptyCampaign('Testwelt', ELARIS_CALENDAR, NOW),
  );
  const add = <E extends Entity>(entity: E): E => db.put('entities', entity) as E;
  const hohenfurt = add(createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const anleger = add(createEntity({ kind: 'place', name: 'Alter Anleger' }));
  const mira = add(createEntity({ kind: 'person', name: 'Mira Tannhaus' }));
  const lando = add(createEntity({ kind: 'person', name: 'Lando Furtner' }));
  const krummzahn = add(createEntity({ kind: 'person', name: 'Krummzahn' }));
  const bande = add(createEntity({ kind: 'faction', name: 'Die Krähenbande' }));
  const brann = add(
    createEntity({ kind: 'character', name: 'Brann Eichwald', character: { level: 3 } }),
  );
  db.setState({ placeId: hohenfurt.id });
  return { db, hohenfurt, anleger, mira, lando, krummzahn, bande, brann };
}

const common = (change: Partial<RecordCommon> = {}): RecordCommon => ({
  text: 'Am Alten Anleger',
  refs: [],
  secret: false,
  ...change,
});
const draft = (change: Partial<RecordDraft>): RecordDraft => ({ ...emptyRecordDraft(), ...change });

describe('recordInputOf', () => {
  it('setzt die Angabe der Art aus dem Entwurf', () => {
    expect(
      recordInputOf('fate', draft({ whoId: 'k', status: 'missing' }), common(), NOW).fate,
    ).toEqual({ entityId: 'k', status: 'missing' });
    expect(
      recordInputOf('whereabouts', draft({ whoId: 'm', placeId: 'a' }), common(), NOW).whereabouts,
    ).toEqual({ entityId: 'm', placeId: 'a' });
    expect(recordInputOf('travel', draft({ placeId: 'a' }), common(), NOW).travel).toEqual({
      toId: 'a',
    });
    expect(recordInputOf('rest', draft({ longRest: true }), common(), NOW).rest).toEqual({
      long: true,
    });
    expect(
      recordInputOf('milestone', draft({ whoId: 'b', level: ' 5 ' }), common(), NOW).milestone,
    ).toEqual({ characterId: 'b', level: 5 });
    expect(
      recordInputOf('milestone', draft({ whoId: 'b', level: '' }), common(), NOW).milestone,
    ).toEqual({ characterId: 'b', level: null });
  });

  it('Haltung ohne Gegenüber gilt der Gruppe; Ruf ist eine Haltung', () => {
    const input = recordInputOf('repute', draft({ whoId: 'f', attitude: -2 }), common(), NOW);
    expect(input.kind).toBe('attitude');
    expect(input.attitude).toEqual({ fromId: 'f', toId: PARTY_ID, value: -2 });
  });

  it('Frist in Tagen zählt ab dem Zeitpunkt des Eintrags', () => {
    const now = recordInputOf('promise', draft({ dueDays: '3' }), common(), NOW);
    expect(now.promise?.due).toBe(NOW + 3 * DAY);
    const earlier = recordInputOf(
      'promise',
      draft({ dueDays: '2', promiseOutcome: 'kept' }),
      common({ at: NOW - 10 * DAY }),
      NOW,
    );
    expect(earlier.promise).toEqual({ due: NOW - 8 * DAY, outcome: 'kept' });
    expect(recordInputOf('promise', draft({}), common(), NOW).promise?.due).toBeNull();
  });

  it('Gegner, Getroffene und wer etwas erfährt stehen vorn in den Verweisen', () => {
    const refs = ['x'];
    expect(
      recordInputOf('fight', draft({ withIds: ['k', 'x'] }), common({ refs }), NOW).refs,
    ).toEqual(['k', 'x']);
    expect(recordInputOf('meeting', draft({ withIds: ['l'] }), common({ refs }), NOW).refs).toEqual(
      ['l', 'x'],
    );
    expect(recordInputOf('knowledge', draft({ whoId: 'm' }), common({ refs }), NOW).refs).toEqual([
      'm',
      'x',
    ]);
  });

  it('eine Entdeckung nimmt den entdeckten Ort als Ort des Eintrags', () => {
    expect(recordInputOf('discovery', draft({ placeId: 'a' }), common(), NOW).placeId).toBe('a');
    expect(recordInputOf('discovery', draft({}), common({ placeId: 'h' }), NOW).placeId).toBe('h');
  });

  it('Zustand aufheben nennt den Beginn nur beim Aufheben', () => {
    expect(
      recordInputOf('condition', draft({ whoId: 'b', endsId: 'e' }), common(), NOW).condition,
    ).toEqual({ entityId: 'b', ended: false, endsId: null });
    expect(
      recordInputOf('condition', draft({ whoId: 'b', ended: true, endsId: 'e' }), common(), NOW)
        .condition,
    ).toEqual({ entityId: 'b', ended: true, endsId: 'e' });
  });
});

describe('draftProblem', () => {
  it('verlangt bei der Haltung einen Wert – sonst wäre sie „unbekannt“', () => {
    expect(draftProblem('attitude', draft({}))).toMatch(/Wessen Haltung/);
    expect(draftProblem('repute', draft({}))).toMatch(/Fraktion/);
    expect(draftProblem('attitude', draft({ whoId: 'm' }))).toMatch(/neue Haltung/);
    expect(draftProblem('attitude', draft({ whoId: 'm', attitude: 0 }))).toBe('');
  });

  it('meldet fehlende Dinge und eine Stufe, die keine Zahl ist', () => {
    expect(draftProblem('travel', draft({}))).toMatch(/Wohin/);
    expect(draftProblem('fate', draft({}))).toMatch(/Schicksal/);
    expect(draftProblem('bond', draft({ whoId: 'm' }))).toMatch(/Mit wem/);
    expect(draftProblem('milestone', draft({ whoId: 'b', level: 'fünf' }))).toMatch(/keine Zahl/);
    expect(draftProblem('promise', draft({ dueDays: '-1' }))).toMatch(/Frist/);
    expect(draftProblem('note', draft({}))).toBe('');
  });
});

describe('Arten wählen', () => {
  it('die Notiz steht allein, jede andere Art tritt an ihre Stelle', () => {
    let parts = [partOf('note')];
    parts = toggleChoice(parts, 'fight');
    expect(parts.map((p) => p.choice)).toEqual(['fight']);
    parts = toggleChoice(parts, 'fate');
    expect(parts.map((p) => p.choice)).toEqual(['fight', 'fate']);
    parts = toggleChoice(parts, 'fight');
    expect(parts.map((p) => p.choice)).toEqual(['fate']);
    parts = toggleChoice(parts, 'fate');
    expect(parts.map((p) => p.choice)).toEqual(['note']);
    expect(toggleChoice([partOf('fight'), partOf('fate')], 'note').map((p) => p.choice)).toEqual([
      'note',
    ]);
  });

  it('nur Arten mit Angaben bekommen Felder', () => {
    expect(hasRecordFields('note')).toBe(false);
    expect(hasRecordFields('lore')).toBe(false);
    expect(hasRecordFields('fate')).toBe(true);
    expect(hasRecordFields('repute')).toBe(true);
  });
});

describe('Vorschläge übernehmen', () => {
  it('ein Klick übernimmt Art und Angaben, ein zweiter nimmt sie weg', async () => {
    const { db, krummzahn } = await setup();
    const [fate] = recognizeEntry(db.getSnapshot(), 'Krummzahn ist tot.').filter(
      (item) => item.kind === 'fate',
    );
    expect(fate).toBeDefined();
    const accepted = toggleRecognized([partOf('note')], fate!);
    expect(accepted.parts).toHaveLength(1);
    expect(accepted.parts[0]!.choice).toBe('fate');
    expect(accepted.parts[0]!.draft.whoId).toBe(krummzahn.id);
    expect(accepted.parts[0]!.draft.status).toBe('dead');
    expect(accepted.parts[0]!.sourceLabel).toBe(fate!.label);
    expect(accepted.refs).toEqual([]);
    expect(isAccepted(accepted.parts, fate!)).toBe(true);
    const removed = toggleRecognized(accepted.parts, fate!);
    expect(removed.parts.map((p) => p.choice)).toEqual(['note']);
  });

  it('ersetzt eine leere, von Hand gewählte Art gleicher Sorte', async () => {
    const { db } = await setup();
    const [fate] = recognizeEntry(db.getSnapshot(), 'Krummzahn ist tot.');
    const parts = toggleRecognized([partOf('fate'), partOf('rest')], fate!).parts;
    expect(parts.map((p) => p.choice)).toEqual(['rest', 'fate']);
    expect(parts[1]!.source).not.toBeNull();
  });

  it('Gegner eines Kampfes kommen ins Feld „Gegen“, Übriges zu „Betrifft“', async () => {
    const { db, bande } = await setup();
    const items = recognizeEntry(db.getSnapshot(), 'Wir haben gegen die Krähenbande gekämpft.');
    const fight = items.find((item) => item.kind === 'fight');
    expect(fight).toBeDefined();
    const { draft: d, refs } = draftFromRecognized(fight!);
    expect(d.withIds).toEqual([bande.id]);
    expect(refs).toEqual([]);
  });

  it('mehrere übernommene Vorschläge werden zusammen festgehalten', async () => {
    const { db, krummzahn, lando } = await setup();
    const text = 'Lando hat gegen Krummzahn gekämpft. Krummzahn ist tot.';
    const items = recognizeEntry(db.getSnapshot(), text);
    let parts = [partOf('note')];
    for (const item of items.filter((i) => i.kind === 'fate' || i.kind === 'fight'))
      parts = toggleRecognized(parts, item).parts;
    expect(parts.map((p) => p.choice).sort()).toEqual(['fate', 'fight']);
    const c = common({ text, refs: [lando.id] });
    expect(recordCheck(db.getSnapshot(), parts, c).problem).toBe('');
    const result = recordEntries(db, recordInputs(parts, c, NOW));
    if ('problem' in result) throw new Error(result.problem);
    expect(result.entries.map((e) => e.kind).sort()).toEqual(['fate', 'fight']);
    const after = db.getSnapshot().entities[krummzahn.id];
    expect(after?.kind === 'person' && after.person.status).toBe('dead');
    result.undo();
    const back = db.getSnapshot().entities[krummzahn.id];
    expect(back?.kind === 'person' && back.person.status).toBe('alive');
    expect(Object.keys(db.getSnapshot().chronicle)).toHaveLength(0);
  });
});

describe('recordCheck', () => {
  it('fehlt nur der Text, sagt es das leise', async () => {
    const { db } = await setup();
    const check = recordCheck(db.getSnapshot(), [partOf('note')], common({ text: '  ' }));
    expect(check.problem).not.toBe('');
    expect(check.onlyText).toBe(true);
  });

  it('nennt bei mehreren Arten, welche noch etwas braucht', async () => {
    const { db } = await setup();
    const check = recordCheck(
      db.getSnapshot(),
      [partOf('rest'), partOf('fate')],
      common({ text: 'Rast, und dann …' }),
    );
    expect(check.problem).toBe('Schicksal: Wessen Schicksal?');
    expect(check.onlyText).toBe(false);
  });

  it('meldet die Zukunft über recordProblem', async () => {
    const { db } = await setup();
    const check = recordCheck(db.getSnapshot(), [partOf('note')], common({ at: NOW + DAY }));
    expect(check.problem).toMatch(/Zukunft/);
  });
});

describe('draftOfEntry', () => {
  it('liest die Angaben eines Eintrags so zurück, dass dieselbe Eingabe entsteht', async () => {
    const { db, mira, anleger, brann, bande } = await setup();
    const cases = [
      { kind: 'whereabouts' as const, d: draft({ whoId: mira.id, placeId: anleger.id }) },
      { kind: 'fate' as const, d: draft({ whoId: mira.id, status: 'missing' }) },
      { kind: 'milestone' as const, d: draft({ whoId: brann.id, level: '4' }) },
      { kind: 'attitude' as const, d: draft({ whoId: bande.id, attitude: -3 }) },
      { kind: 'fight' as const, d: draft({ withIds: [bande.id], fightOutcome: 'fled' }) },
      { kind: 'promise' as const, d: draft({ dueDays: '5', promiseOutcome: 'failed' }) },
    ];
    for (const { kind, d } of cases) {
      const input = recordInputOf(kind, d, common({ placeId: null }), NOW);
      const result = recordEntry(db, input);
      if ('problem' in result) throw new Error(`${kind}: ${result.problem}`);
      const again = recordInputOf(kind, draftOfEntry(result.entry), common({ placeId: null }), NOW);
      expect(again[kind]).toEqual(input[kind]);
    }
  });
});

describe('prefillFromRefs', () => {
  it('nimmt „Wer“ aus „Betrifft“, wenn genau einer passt', async () => {
    const { db, bande, mira, lando, hohenfurt } = await setup();
    const data = db.getSnapshot();
    expect(
      prefillFromRefs(data, 'repute', emptyRecordDraft(), [hohenfurt.id, bande.id]).whoId,
    ).toBe(bande.id);
    // Zwei Personen: nicht raten.
    expect(prefillFromRefs(data, 'fate', emptyRecordDraft(), [mira.id, lando.id]).whoId).toBeNull();
    // Eine Fraktion hat kein Schicksal.
    expect(prefillFromRefs(data, 'fate', emptyRecordDraft(), [bande.id]).whoId).toBeNull();
    // Schon gewählt bleibt gewählt; Arten ohne „Wer“ bleiben, wie sie sind.
    expect(prefillFromRefs(data, 'fate', draft({ whoId: lando.id }), [mira.id]).whoId).toBe(
      lando.id,
    );
    expect(prefillFromRefs(data, 'note', emptyRecordDraft(), [mira.id]).whoId).toBeNull();
  });
});

describe('Auswahllisten', () => {
  it('Fäden: offene zuerst, dann nach Titel; Geheimnisse nur, was noch keiner kennt', async () => {
    const { db } = await setup();
    db.put('threads', createThread({ title: 'Wer zahlt den Zoll?', state: 'solved' }));
    db.put(
      'threads',
      createThread({
        title: 'Was liegt in der Salzgrotte?',
        hints: [{ id: 'h1', text: 'Karte im Lager', placeId: null, sourceId: null, found: false }],
      }),
    );
    expect(clueChoices(db.getSnapshot()).map((c) => c.title)).toEqual([
      'Was liegt in der Salzgrotte?',
      'Wer zahlt den Zoll?',
    ]);
    db.put(
      'preps',
      createPrep({
        secrets: [
          {
            id: 's1',
            text: 'Lando schmuggelt Salz',
            storyId: null,
            revealed: false,
            revealedAt: null,
            hint: null,
            carried: 0,
          },
          { ...secretOfText('Mira kennt den Weg'), id: 's2', revealed: true, revealedAt: NOW },
          { ...secretOfText('  '), id: 's3' },
        ],
      }),
    );
    expect(secretChoices(db.getSnapshot())).toEqual([{ id: 's1', text: 'Lando schmuggelt Salz' }]);
    // Beim Bearbeiten bleibt das Geheimnis wählbar, das der Eintrag aufgedeckt hat.
    expect(secretChoices(db.getSnapshot(), 's2').map((s) => s.id)).toEqual(['s1', 's2']);
  });
});
