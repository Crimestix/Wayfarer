import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { spendDowntime } from '../../features/gruppe/downtime';
import { emptyRecipe } from '../crafting';
import {
  NO_CHOICE,
  craftDays,
  downtimeInput,
  downtimeOptions,
  downtimeTracks,
  newProjectKey,
  itemsToHand,
  planDowntime,
  projectName,
  type NewProject,
} from '../downtime';
import { createEntity, createEvent, createTrack, type Item } from '../schema';
import { MINUTES_PER_DAY } from '../time/calendar';

async function setup(history = false) {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const put = (init: object) => db.put('entities', createEntity(init as never));
  const corrin = put({ kind: 'character', name: 'Corrin' });
  const mira = put({ kind: 'character', name: 'Mira Tannhaus' });
  const odo = put({ kind: 'character', name: 'Odo Tannhaus' });
  const sword = put({
    kind: 'item',
    name: 'Langschwert',
    item: { history, recipe: { ...emptyRecipe(), price: 80 } },
  }) as Item;
  return { db, corrin, mira, odo, sword, data: () => db.getSnapshot() };
}

const craft = (ownerId: string, itemId: string, target: number | null = 8): NewProject => ({
  key: `neu:${ownerId}`,
  ownerId,
  activity: 'craft',
  subject: '',
  itemId,
  target,
});

describe('Freie Zeit planen', () => {
  it('benennt Vorhaben aus der Tätigkeit', () => {
    expect(projectName('craft', '', { name: 'Langschwert' })).toBe('Langschwert herstellen');
    expect(projectName('research', ' Spur der  Salzgrotte ')).toBe(
      'Nachforschen: Spur der Salzgrotte',
    );
    expect(projectName('recover', '')).toBe('Erholen');
    expect(projectName('custom', 'Briefe an Hohenfurt')).toBe('Briefe an Hohenfurt');
  });

  it('nimmt die Dauer beim Herstellen aus dem Rezept', async () => {
    const { data, sword } = await setup();
    expect(craftDays(data().entities[sword.id] as Item)).toBe(8);
  });

  it('zählt je Helfer einen Arbeitstag und meldet, wann es fertig ist', async () => {
    const { data, corrin, mira, odo, sword } = await setup();
    const plan = planDowntime(data(), {
      days: 5,
      projects: [
        craft(corrin.id, sword.id),
        {
          key: `neu:${odo.id}`,
          ownerId: odo.id,
          activity: 'recover',
          subject: '',
          itemId: null,
          target: null,
        },
      ],
      work: [
        { characterId: corrin.id, projectKey: `neu:${corrin.id}` },
        { characterId: mira.id, projectKey: `neu:${corrin.id}` },
        { characterId: odo.id, projectKey: `neu:${odo.id}` },
      ],
    });
    expect(plan.progress[0]).toMatchObject({
      name: 'Langschwert herstellen',
      helpers: [corrin.id, mira.id],
      before: 0,
      after: 8,
      target: 8,
      finished: true,
      doneAfter: 4,
    });
    expect(plan.progress[1]).toMatchObject({ name: 'Erholen', after: 5, target: 0 });
    expect(plan.text).toBe(
      'Freie Zeit, 5 Tage: Corrin und Mira Tannhaus: Langschwert herstellen (8 von 8 Tagen, fertig); Odo Tannhaus: Erholen (5 Tage).',
    );
    expect(plan.refs).toEqual([corrin.id, mira.id, odo.id, sword.id]);
    expect(itemsToHand(data(), plan)).toEqual([{ itemId: sword.id, holderId: corrin.id }]);
  });

  it('setzt ein bestehendes Vorhaben fort', async () => {
    const { db, data, corrin } = await setup();
    const track = db.put(
      'tracks',
      createTrack({
        name: 'Lernen und Üben: Elfisch',
        ownerId: corrin.id,
        kind: 'count',
        target: 20,
        value: 12,
        unit: 'Tage',
        downtime: { activity: 'train', itemId: null },
      }),
    );
    const plan = planDowntime(data(), {
      days: 3,
      projects: [],
      work: [{ characterId: corrin.id, projectKey: track.id }],
    });
    expect(plan.progress[0]).toMatchObject({ trackId: track.id, before: 12, after: 15 });
    expect(plan.text).toBe(
      'Freie Zeit, 3 Tage: Corrin: Lernen und Üben: Elfisch (15 von 20 Tagen).',
    );
    expect(downtimeTracks(data()).map((t) => t.id)).toEqual([track.id]);
  });
});

describe('Freie Zeit verbringen', () => {
  it('stellt die Zeit vor, schreibt Leisten und Chronik, gibt den Gegenstand – und nimmt alles zurück', async () => {
    const { db, data, corrin, mira, sword } = await setup(true);
    const now = data().state.now;
    db.put(
      'events',
      createEvent({ title: 'Markttag in Hohenfurt', at: now + 2 * MINUTES_PER_DAY }),
    );
    const result = spendDowntime(db, {
      days: 5,
      projects: [craft(corrin.id, sword.id)],
      work: [
        { characterId: corrin.id, projectKey: `neu:${corrin.id}` },
        { characterId: mira.id, projectKey: `neu:${corrin.id}` },
      ],
    })!;
    expect(data().state.now).toBe(now + 5 * MINUTES_PER_DAY);
    // Termine treten dabei ein wie sonst auch.
    expect(result.advance.occurred.map((o) => o.event.title)).toContain('Markttag in Hohenfurt');
    const [track] = downtimeTracks(data());
    expect(track).toMatchObject({
      name: 'Langschwert herstellen',
      ownerId: corrin.id,
      kind: 'count',
      target: 8,
      value: 8,
      unit: 'Tage',
      done: true,
      downtime: { activity: 'craft', itemId: sword.id },
    });
    const notes = Object.values(data().chronicle).filter((e) => e.text.startsWith('Freie Zeit'));
    expect(notes.map((e) => e.text)).toEqual([result.text]);
    expect(result.finished.map((p) => p.name)).toEqual(['Langschwert herstellen']);
    expect(result.handed).toEqual([{ item: 'Langschwert', holder: 'Corrin' }]);
    expect((data().entities[sword.id] as Item).item.holderId).toBe(corrin.id);
    // Mit Lebenslauf steht der Wechsel des Besitzers in der Chronik.
    expect(Object.values(data().chronicle).some((e) => e.holder?.itemId === sword.id)).toBe(true);

    result.undo();
    expect(data().state.now).toBe(now);
    expect(downtimeTracks(data())).toEqual([]);
    expect((data().entities[sword.id] as Item).item.holderId).toBeNull();
    expect(
      Object.values(data().chronicle).filter(
        (e) => e.text.startsWith('Freie Zeit') || e.holder || e.kind === 'event',
      ),
    ).toEqual([]);
  });

  it('tut ohne ganze Tage nichts', async () => {
    const { db } = await setup();
    expect(spendDowntime(db, { days: 0, projects: [], work: [] })).toBeNull();
  });
});

describe('Die Wahl im Dialog', () => {
  it('macht aus den Wahlen neue Vorhaben, Fortsetzen und Mithelfen', async () => {
    const { db, data, corrin, mira, odo, sword } = await setup();
    const track = db.put(
      'tracks',
      createTrack({
        name: 'Nachforschen: Salzgrotte',
        ownerId: odo.id,
        kind: 'count',
        target: 10,
        value: 2,
        downtime: { activity: 'research', itemId: null },
      }),
    );
    const choices = {
      [corrin.id]: { ...NO_CHOICE, value: 'n:craft', itemId: sword.id },
      [mira.id]: { ...NO_CHOICE, value: `j:${newProjectKey(corrin.id)}` },
      [odo.id]: { ...NO_CHOICE, value: `t:${track.id}` },
    };
    const input = downtimeInput(data(), 2, choices);
    expect(input.projects).toEqual([
      {
        key: newProjectKey(corrin.id),
        ownerId: corrin.id,
        activity: 'craft',
        subject: '',
        itemId: sword.id,
        target: 8,
      },
    ]);
    expect(input.work).toEqual([
      { characterId: corrin.id, projectKey: newProjectKey(corrin.id) },
      { characterId: mira.id, projectKey: newProjectKey(corrin.id) },
      { characterId: odo.id, projectKey: track.id },
    ]);
    // Mira kann bei Odos Vorhaben und bei Corrins neuem helfen.
    const options = downtimeOptions(data(), mira.id, choices);
    expect(options.filter((o) => o.group === 'help').map((o) => o.label)).toEqual([
      'Nachforschen: Salzgrotte (2 von 10) – mit Odo Tannhaus',
      'Langschwert herstellen – mit Corrin (neu)',
    ]);
    expect(options.filter((o) => o.group === 'new').map((o) => o.label)).toContain('Herstellen');
    expect(downtimeOptions(data(), odo.id, choices)[0]).toMatchObject({
      value: `t:${track.id}`,
      group: 'continue',
    });
  });

  it('nimmt ein eigenes Ziel und lässt Herstellen ohne Gegenstand weg', async () => {
    const { data, corrin, mira } = await setup();
    const input = downtimeInput(data(), 3, {
      [corrin.id]: { ...NO_CHOICE, value: 'n:craft' },
      [mira.id]: { ...NO_CHOICE, value: 'n:train', subject: 'Elfisch', target: '20' },
    });
    expect(input.projects.map((p) => [p.activity, p.subject, p.target])).toEqual([
      ['train', 'Elfisch', 20],
    ]);
  });
});
