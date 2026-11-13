import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { acceptProfessions } from '../../features/welt/professions';
import {
  KNOWN_PROFESSIONS,
  professionForms,
  professionSuggestions,
  type WrittenSource,
} from '../professions';
import { createEntity, createRelation } from '../schema';

const article = (more: Partial<WrittenSource> & { title: string }): WrittenSource => ({
  id: more.title,
  ownerId: null,
  professionLines: [],
  roleLines: [],
  text: '',
  ...more,
});

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const put = (init: object) => db.put('entities', createEntity(init as never));
  const brann = put({ kind: 'person', name: 'Brann Eichwald', person: { role: 'Schmied' } });
  const mira = put({ kind: 'person', name: 'Mira Tannhaus' });
  const odo = put({ kind: 'person', name: 'Odo Tannhaus' });
  const ilka = put({ kind: 'person', name: 'Ilka Weber' });
  const lando = put({ kind: 'character', name: 'Lando Furtner' });
  put({ kind: 'place', name: 'Hohenfurt' });
  return { db, brann, mira, odo, ilka, lando, data: () => db.getSnapshot() };
}

describe('Liste der Berufe', () => {
  it('bringt viele mittelalterliche Berufe mit Einordnung und Werkzeug mit', () => {
    expect(KNOWN_PROFESSIONS.length).toBeGreaterThanOrEqual(60);
    const names = KNOWN_PROFESSIONS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of ['Schmied', 'Gerber', 'Böttcher', 'Hebamme', 'Edelsteinschleifer'])
      expect(names).toContain(name);
    expect(KNOWN_PROFESSIONS.find((p) => p.name === 'Schmied')?.tool).toBe('Schmiedewerkzeug');
    expect(KNOWN_PROFESSIONS.find((p) => p.name === 'Kräuterkundige')?.category).toBe('Heilkunde');
  });

  it('bildet weibliche Form und Genitiv', () => {
    expect(professionForms('Schmied')).toEqual(['Schmied', 'Schmiedin', 'Schmieds', 'Schmiedes']);
    expect(professionForms('Hebamme')).toEqual(['Hebamme', 'Hebammen']);
    expect(professionForms('Bauer', ['Bäuerin'])).toContain('Bäuerin');
  });
});

describe('Berufe vorschlagen', () => {
  it('findet Berufe im Geschriebenen und die Personen dazu', async () => {
    const { data, brann, mira, odo, lando } = await setup();
    const { found, more } = professionSuggestions(data(), [
      article({ title: 'Hohenfurt', text: 'Der Schmied von Hohenfurt kennt jeden Hufnagel.' }),
      article({
        title: 'Mira Tannhaus',
        ownerId: mira.id,
        professionLines: ['Gerberin'],
        text: 'Sie ist Gerberin.',
      }),
      article({ title: 'Salzgrotte', text: 'Odo Tannhaus, der Böttcher, liefert die Fässer.' }),
      article({ title: 'Furt', text: 'Die Hebamme Lando half bei der Geburt.' }),
    ]);
    const smith = found.find((s) => s.name === 'Schmied')!;
    expect(smith).toMatchObject({ professionId: null, tool: 'Schmiedewerkzeug', mentions: 2 });
    expect(smith.people).toEqual([
      { entityId: brann.id, name: 'Brann Eichwald', why: 'Rolle: Schmied' },
    ]);
    expect(found.find((s) => s.name === 'Gerber')?.people.map((p) => p.entityId)).toEqual([
      mira.id,
    ]);
    expect(found.find((s) => s.name === 'Böttcher')?.people).toEqual([
      {
        entityId: odo.id,
        name: 'Odo Tannhaus',
        why: '„Odo Tannhaus, der Böttcher“ in Salzgrotte',
      },
    ]);
    expect(found.find((s) => s.name === 'Hebamme')?.people.map((p) => p.entityId)).toEqual([
      lando.id,
    ]);
    // Was vorkommt, steht nicht noch einmal bei den übrigen.
    expect(more.some((s) => s.name === 'Schmied')).toBe(false);
    expect(more.some((s) => s.name === 'Töpfer')).toBe(true);
  });

  it('liest keinen Beruf aus einem Namen der Welt und keinen kleingeschriebenen', async () => {
    const { data } = await setup();
    const { found } = professionSuggestions(data(), [
      article({ title: 'Markt', text: 'Ilka Weber verkauft knappe Vorräte.' }),
    ]);
    expect(found.some((s) => s.name === 'Weber')).toBe(false);
  });

  it('schlägt einen unbekannten Beruf aus der Zeile „Beruf“ vor', async () => {
    const { data, odo } = await setup();
    const { found } = professionSuggestions(data(), [
      article({ title: 'Odo Tannhaus', ownerId: odo.id, professionLines: ['Salzschürfer'] }),
    ]);
    expect(found.find((s) => s.name === 'Salzschürfer')).toMatchObject({
      key: 'n:salzschürfer',
      people: [{ entityId: odo.id }],
    });
  });

  it('macht aus „Unbekannt“ oder „Keiner“ keinen Beruf', async () => {
    const { data, odo, mira } = await setup();
    const { found } = professionSuggestions(data(), [
      article({ title: 'Odo Tannhaus', ownerId: odo.id, professionLines: ['Unbekannt'] }),
      article({ title: 'Mira Tannhaus', ownerId: mira.id, professionLines: ['Keiner (früher)'] }),
    ]);
    const names = found.map((s) => s.name);
    expect(names).not.toContain('Unbekannt');
    expect(names).not.toContain('Keiner');
  });

  it('verbindet vorhandene Berufe nur mit Personen, die ihn noch nicht ausüben', async () => {
    const { db, data, brann } = await setup();
    const smith = db.put('entities', createEntity({ kind: 'profession', name: 'Schmied' }));
    expect(professionSuggestions(data()).found[0]).toMatchObject({
      key: `e:${smith.id}`,
      professionId: smith.id,
      people: [{ entityId: brann.id }],
    });
    // Den vorhandenen schlägt die Liste nicht noch einmal vor.
    expect(professionSuggestions(data()).more.some((s) => s.name === 'Schmied')).toBe(false);
    db.put('relations', createRelation({ from: brann.id, to: smith.id, type: 'practises' }));
    expect(professionSuggestions(data()).found).toEqual([]);
  });

  it('legt erst beim Annehmen an und verbindet – Rückgängig nimmt beides zurück', async () => {
    const { db, data, brann } = await setup();
    const before = Object.keys(data().entities).length;
    const result = acceptProfessions(db, [
      {
        name: 'Schmied',
        category: 'Handwerk',
        tool: 'Schmiedewerkzeug',
        professionId: null,
        peopleIds: [brann.id],
      },
      {
        name: 'Töpfer',
        category: 'Handwerk',
        tool: 'Töpferwerkzeug',
        professionId: null,
        peopleIds: [],
      },
    ]);
    expect(result).toMatchObject({ created: 2, linked: 1 });
    const smith = Object.values(data().entities).find((e) => e.name === 'Schmied')!;
    expect(smith).toMatchObject({
      kind: 'profession',
      profession: { category: 'Handwerk', tool: 'Schmiedewerkzeug' },
      notes: '',
      tagline: '',
    });
    expect(
      Object.values(data().relations).some(
        (r) => r.from === brann.id && r.to === smith.id && r.type === 'practises',
      ),
    ).toBe(true);
    // Einen Namen, den es gibt, legt es nie ein zweites Mal an.
    expect(
      acceptProfessions(db, [
        { name: 'schmied', category: '', tool: '', professionId: null, peopleIds: [brann.id] },
      ]),
    ).toMatchObject({ created: 0, linked: 0 });
    result.undo();
    expect(Object.keys(data().entities).length).toBe(before);
    expect(Object.values(data().relations).filter((r) => r.type === 'practises')).toEqual([]);
  });
});
