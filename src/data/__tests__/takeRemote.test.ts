import { describe, expect, it } from 'vitest';
import { createEntity, type Entity } from '../../domain/schema';
import { CampaignDb } from '../db';
import { elarisCampaign } from '../seed';
import { MemoryStore } from '../store';

const text = (v: unknown) => JSON.stringify(v, null, 1) + '\n';

async function setup() {
  const store = new MemoryStore();
  const db = await CampaignDb.create(store, elarisCampaign());
  const brann = db.put('entities', createEntity({ kind: 'person', name: 'Brann' }));
  await db.flush();
  return { store, db, brann, path: `entities/${brann.id}.json` };
}

describe('Übernehmen vom anderen Rechner', () => {
  it('übernimmt wörtlich – Text und rev wie geliefert', async () => {
    const { store, db, brann, path } = await setup();
    const remote = { ...brann, name: 'Brann der Schmied', rev: 40, neuesFeld: 'bleibt' };
    const result = db.takeRemote([{ path, content: text(remote) }], db.diskSnapshot());
    expect(result).toEqual({ ok: true, busy: [], invalid: [] });
    expect(db.getSnapshot().entities[brann.id]).toMatchObject({
      name: 'Brann der Schmied',
      rev: 40,
    });
    await db.flush();
    expect(store.files.get(path)).toBe(text(remote));
    // Eine Änderung danach baut auf der übernommenen Fassung auf.
    const next = db.patch('entities', brann.id, { tagline: 'Schmied in Hohenfurt' }) as Entity;
    expect(next.rev).toBe(41);
    expect(next.name).toBe('Brann der Schmied');
  });

  it('wartet hier etwas für dieselbe Datei → nichts geändert', async () => {
    const { db, brann, path } = await setup();
    const disk = db.diskSnapshot();
    const mark = db.changeMark();
    db.patch('entities', brann.id, { tagline: 'hier' });
    const before = db.getSnapshot();
    const result = db.takeRemote([{ path, content: text({ ...brann, name: 'dort' }) }], disk);
    expect(result.ok).toBe(false);
    expect(result.busy).toEqual([path]);
    expect(db.getSnapshot()).toBe(before);
    expect(db.changeMark()).toBe(mark + 1);
  });

  it('steht auf der Platte etwas anderes als im Abbild → busy', async () => {
    const { db, brann, path } = await setup();
    const disk = new Map(db.diskSnapshot());
    disk.set(path, 'etwas anderes');
    const result = db.takeRemote([{ path, content: text({ ...brann, name: 'dort' }) }], disk);
    expect(result).toEqual({ ok: false, busy: [path], invalid: [] });
  });

  it('ungültig: Schema, Kennung, campaign löschen, fremder Pfad', async () => {
    const { db, brann, path } = await setup();
    const disk = db.diskSnapshot();
    for (const file of [
      { path, content: text({ ...brann, name: 5 }) },
      { path: 'entities/anders.json', content: text(brann) },
      { path: 'campaign.json', content: null },
      { path: 'entities/sub/a.json', content: '{}' },
      { path: 'entities/ä.json', content: '{}' },
    ]) {
      const result = db.takeRemote([file, { path: 'zukunft/x.json', content: '{}' }], disk);
      expect(result.ok, file.path).toBe(false);
      expect(result.invalid.length, file.path).toBe(1);
    }
    expect(db.getSnapshot().entities[brann.id]!.name).toBe('Brann');
  });

  it('löscht und schreibt unbekannte Sammlungen, ohne den Speicher zu ändern', async () => {
    const { store, db, brann, path } = await setup();
    const result = db.takeRemote(
      [
        { path, content: null },
        { path: 'zukunft/x.json', content: '{"was":"neu"}\n' },
      ],
      db.diskSnapshot(),
    );
    expect(result.ok).toBe(true);
    expect(db.getSnapshot().entities[brann.id]).toBeUndefined();
    await db.flush();
    expect(store.files.has(path)).toBe(false);
    expect(store.files.get('zukunft/x.json')).toBe('{"was":"neu"}\n');
  });

  it('die Ordnerwache übernimmt danach nichts ein zweites Mal', async () => {
    const { store, db, brann, path } = await setup();
    db.takeRemote([{ path, content: text({ ...brann, name: 'dort' }) }], db.diskSnapshot());
    await db.flush();
    const mark = db.changeMark();
    store.externalWrite(path, store.files.get(path)!);
    await new Promise((r) => setTimeout(r, 0));
    expect(db.changeMark()).toBe(mark);
  });
});

describe('Nachlesen von außen', () => {
  it('ein Lesen unterwegs setzt den Speicher nie auf die alte Fassung zurück', async () => {
    const { store, db, brann, path } = await setup();
    // Die Ablage liefert beim Lesen langsam die alte Fassung.
    const old = store.files.get(path)!;
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => (release = r));
    const read = store.read.bind(store);
    store.read = async (p: string) => {
      if (p !== path) return read(p);
      await slow;
      return old;
    };
    store.externalWrite(path, old.replace('Brann', 'Brann (fremd)'));
    // Währenddessen schreibt die Datenbank dieselbe Datei.
    db.patch('entities', brann.id, { name: 'Brann neu' });
    await db.flush();
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(db.getSnapshot().entities[brann.id]!.name).toBe('Brann neu');
  });

  it('von außen geändert, während dieselbe Datei wartet → die wartende gilt', async () => {
    const { store, db, brann, path } = await setup();
    db.patch('entities', brann.id, { name: 'Brann hier' });
    store.externalWrite(path, text({ ...brann, name: 'Brann fremd' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(db.getSnapshot().entities[brann.id]!.name).toBe('Brann hier');
  });
});

describe('Geschlossen', () => {
  it('nach close() wirft put, und flush schreibt nichts', async () => {
    const { store, db, brann, path } = await setup();
    db.patch('entities', brann.id, { name: 'ungespeichert' });
    const before = store.files.get(path);
    db.close();
    expect(() => db.patch('entities', brann.id, { name: 'x' })).toThrow('neu geladen');
    expect(() => db.setState({ now: 1 })).toThrow();
    expect(() => db.takeRemote([], new Map())).toThrow();
    await db.flush();
    expect(store.files.get(path)).toBe(before);
  });
});
