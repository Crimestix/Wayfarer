/**
 * Zwei „Rechner“ gegen dieselbe Ablage im Speicher – der ganze Ablauf ohne Netz und ohne Rust.
 * Die Welt ist erfunden (Testmaterial).
 */
import { describe, expect, it, vi } from 'vitest';
import { advanceTime } from '../../../data/actions';
import { settleAfterSave } from '../../../data/platform';
import { demoCampaign } from '../../../data/__fixtures__/demoWorld';
import {
  DATA_SHAPE,
  DATA_VERSION,
  createChronicleEntry,
  createEntity,
  createEvent,
  type Entity,
} from '../../../domain/schema';
import { isSyncedPath } from '../../../domain/sync';
import { fetchIntoEmptyFolder } from '../engine';
import { setActiveSync, syncBeforeRestore } from '../index';
import { FakeRepo, gitSha, machine, markerText, settle, type Machine } from './fake';

const text = (v: unknown) => JSON.stringify(v, null, 1) + '\n';

/** Die abgeglichenen Dateien eines Rechners. */
const synced = (m: Machine) =>
  new Map([...m.store.files].filter(([p]) => isSyncedPath(p)).sort(([a], [b]) => (a < b ? -1 : 1)));

/** Dateien in der Ablage (ohne Marke, .gitattributes und README). */
const inRepo = (repo: FakeRepo) =>
  new Map(
    [...repo.files(repo.head)]
      .filter(([p]) => isSyncedPath(p))
      .map(([p, sha]) => [p, repo.blobs.get(sha)!] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );

async function twoMachines() {
  const repo = new FakeRepo();
  const pc = await machine(repo, 'Windows-PC', demoCampaign());
  await pc.engine.firstSync('upload', pc.link);
  const mac = await machine(repo, 'MacBook');
  await fetchIntoEmptyFolder(mac.port, '/MacBook', mac.link);
  await mac.restart();
  return { repo, pc, mac };
}

/** Personen in fester Reihenfolge (nach Kennung), damit beide Rechner dieselbe meinen. */
const people = (m: Machine, kind: Entity['kind']) =>
  Object.values(m.db.getSnapshot().entities)
    .filter((e) => e.kind === kind)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
const firstOf = (m: Machine, kind: Entity['kind'] = 'person') => people(m, kind)[0]!;
const second = (m: Machine, kind: Entity['kind'] = 'person') => people(m, kind)[1]!;
const entity = (m: Machine, id: string) => m.db.getSnapshot().entities[id];

describe('Erster Abgleich', () => {
  it('PC lädt in die leere Ablage, Mac holt in einen leeren Ordner; danach eine Anfrage', async () => {
    const { repo, pc, mac } = await twoMachines();
    expect(synced(mac)).toEqual(synced(pc));
    expect(inRepo(repo)).toEqual(synced(pc));
    expect(repo.text('.gitattributes')).toBe('* -text\n');
    expect(JSON.parse(repo.text('wayfarer.json')!)).toMatchObject({
      format: 'wayfarer-abgleich',
      datenstand: DATA_VERSION,
      gestalt: DATA_SHAPE,
      geraete: { 'Windows-PC': DATA_VERSION },
    });
    expect(mac.port.verbindung).toMatchObject({ device: 'MacBook', root: '/MacBook' });
    const before = repo.log.length;
    await mac.engine.syncNow();
    expect(repo.log.slice(before)).toEqual(['ref']);
    expect(mac.engine.view.get().phase).toBe('synced');
  });

  it('Holen lehnt einen Ordner ab, in dem schon etwas liegt', async () => {
    const { repo, pc } = await twoMachines();
    const other = await machine(repo, 'Laptop', demoCampaign());
    await expect(fetchIntoEmptyFolder(other.port, '/Laptop', other.link)).rejects.toMatchObject({
      kind: 'input',
    });
    expect(pc.engine.view.get().phase).toBe('synced');
  });
});

describe('Alltag', () => {
  it('beide ändern verschiedene Einträge → gleich, keine Rückfrage', async () => {
    const { repo, pc, mac } = await twoMachines();
    pc.db.patch('entities', firstOf(pc).id, { tagline: 'vom PC' });
    mac.db.patch('entities', second(mac).id, { tagline: 'vom Mac' });
    await pc.engine.syncNow();
    await mac.engine.syncNow();
    await pc.engine.syncNow();
    expect(synced(pc)).toEqual(synced(mac));
    expect(inRepo(repo)).toEqual(synced(pc));
    expect(mac.engine.view.get().conflicts).toEqual([]);
    expect(entity(pc, second(pc).id)!.tagline).toBe('vom Mac');
    expect(mac.engine.view.get().last?.down.changed).toBe(1);
  });

  it('derselbe Eintrag, verschiedene Angaben → zusammengeführt', async () => {
    const { pc, mac } = await twoMachines();
    const id = firstOf(pc).id;
    pc.db.patch('entities', id, { tagline: 'vom PC' });
    mac.db.patch('entities', id, { notes: 'Notiz vom Mac' });
    await pc.engine.syncNow();
    await mac.engine.syncNow();
    await pc.engine.syncNow();
    for (const m of [pc, mac])
      expect(entity(m, id)).toMatchObject({ tagline: 'vom PC', notes: 'Notiz vom Mac' });
    expect(synced(pc)).toEqual(synced(mac));
  });

  it('dieselbe Angabe: nur dieser Eintrag wartet, alles andere läuft; Entscheidung', async () => {
    const { repo, pc, mac } = await twoMachines();
    const id = firstOf(pc).id;
    const b = second(pc).id;
    const path = `entities/${id}.json`;
    pc.db.patch('entities', id, { name: 'Brann vom PC' });
    pc.db.patch('entities', b, { tagline: 'auch vom PC' });
    await pc.engine.syncNow();
    mac.db.patch('entities', id, { name: 'Brann vom Mac' });
    const other = mac.db.put(
      'entities',
      createEntity({ kind: 'person', name: 'Ilsa aus Tannhaus' }),
    );
    await mac.engine.syncNow();
    const view = mac.engine.view.get();
    expect(view.phase).toBe('needsYou');
    expect(view.conflicts).toMatchObject([
      { id: path, kind: 'fields', fields: [{ at: ['name'] }] },
    ]);
    // Alles andere desselben Laufs ist geholt und hochgeladen.
    expect(entity(mac, b)!.tagline).toBe('auch vom PC');
    expect(inRepo(repo).has(`entities/${other.id}.json`)).toBe(true);
    expect(JSON.parse(inRepo(repo).get(path)!).name).toBe('Brann vom PC');
    expect(entity(mac, id)!.name).toBe('Brann vom Mac');

    await mac.engine.decide({ [path]: 'remote' });
    expect(entity(mac, id)!.name).toBe('Brann vom PC');
    expect(mac.engine.view.get().conflicts).toEqual([]);
    const aside = await mac.port.asideList();
    expect(aside[0]).toMatchObject({ reason: 'entscheidung', entries: [{ side: 'hier', path }] });
    expect(JSON.parse(await mac.port.asideRead('/MacBook', aside[0]!.run, 'hier', path)).name).toBe(
      'Brann vom Mac',
    );
    await pc.engine.syncNow();
    expect(synced(pc)).toEqual(synced(mac));
  });

  it('„hier behalten“: die Fassung von dort liegt beiseite, die von hier geht hoch', async () => {
    const { repo, pc, mac } = await twoMachines();
    const id = firstOf(pc).id;
    const path = `entities/${id}.json`;
    pc.db.patch('entities', id, { name: 'vom PC' });
    await pc.engine.syncNow();
    mac.db.patch('entities', id, { name: 'vom Mac' });
    await mac.engine.syncNow();
    await mac.engine.decide({ [path]: 'local' });
    expect(JSON.parse(repo.text(path)!).name).toBe('vom Mac');
    const aside = await mac.port.asideList();
    expect(aside[0]!.entries).toMatchObject([{ side: 'dort', path }]);
  });

  it('die Entscheidung bleibt gültig, wenn hier weitergeschrieben wird, und verfällt, wenn sich dort etwas ändert', async () => {
    const { pc, mac } = await twoMachines();
    const id = firstOf(pc).id;
    const path = `entities/${id}.json`;
    pc.db.patch('entities', id, { name: 'vom PC' });
    await pc.engine.syncNow();
    mac.db.patch('entities', id, { name: 'vom Mac' });
    await mac.engine.syncNow();
    // Ein Entwurf ist offen: Die Entscheidung wird gespeichert, aber noch nicht angewendet.
    mac.drafts.held = 1;
    await mac.engine.decide({ [path]: 'remote' });
    expect(mac.port.stand!.decided[path]).toBeDefined();
    mac.db.patch('entities', id, { tagline: 'hier weitergeschrieben' });
    mac.drafts.set(0);
    await settle();
    expect(entity(mac, id)).toMatchObject({ name: 'vom PC', tagline: 'hier weitergeschrieben' });

    // Neue Lage: Die Fassung dort ändert sich nach der Entscheidung → sie verfällt.
    pc.db.patch('entities', id, { name: 'PC 2' });
    await pc.engine.syncNow();
    mac.db.patch('entities', id, { name: 'Mac 2' });
    mac.drafts.held = 1;
    await mac.engine.syncNow();
    await mac.engine.decide({ [path]: 'remote' });
    pc.db.patch('entities', id, { name: 'PC 3' });
    await pc.engine.syncNow();
    mac.drafts.set(0);
    await settle();
    expect(mac.engine.view.get().conflicts).toMatchObject([{ id: path }]);
    expect(entity(mac, id)!.name).toBe('Mac 2');
  });
});

describe('Löschen', () => {
  it('dort gelöscht, hier geändert → Rückfrage; „Behalten“ bringt ihn wieder in die Ablage', async () => {
    const { repo, pc, mac } = await twoMachines();
    const id = firstOf(pc).id;
    const path = `entities/${id}.json`;
    pc.db.remove('entities', id);
    await pc.engine.syncNow();
    mac.db.patch('entities', id, { tagline: 'noch gebraucht' });
    await mac.engine.syncNow();
    expect(mac.engine.view.get().conflicts).toMatchObject([{ id: path, kind: 'deletedThere' }]);
    await mac.engine.decide({ [path]: 'local' });
    expect(repo.text(path)).not.toBeNull();
    await pc.engine.syncNow();
    expect(entity(pc, id)!.tagline).toBe('noch gebraucht');
  });

  it('dort gelöscht, hier geändert → „Auch hier löschen“', async () => {
    const { pc, mac } = await twoMachines();
    const id = firstOf(pc).id;
    const path = `entities/${id}.json`;
    pc.db.remove('entities', id);
    await pc.engine.syncNow();
    mac.db.patch('entities', id, { tagline: 'egal' });
    await mac.engine.syncNow();
    await mac.engine.decide({ [path]: 'remote' });
    expect(entity(mac, id)).toBeUndefined();
    expect((await mac.port.asideList())[0]!.entries).toMatchObject([{ side: 'hier', path }]);
  });

  it('hier gelöscht, dort geändert → „Zurückholen“ und „Gelöscht lassen“', async () => {
    const { repo, pc, mac } = await twoMachines();
    const a = firstOf(pc).id;
    const b = second(pc).id;
    pc.db.patch('entities', a, { tagline: 'PC A' });
    pc.db.patch('entities', b, { tagline: 'PC B' });
    await pc.engine.syncNow();
    mac.db.remove('entities', a);
    mac.db.remove('entities', b);
    await mac.engine.syncNow();
    expect(mac.engine.view.get().conflicts.map((c) => c.kind)).toEqual([
      'deletedHere',
      'deletedHere',
    ]);
    await mac.engine.decide({ [`entities/${a}.json`]: 'remote', [`entities/${b}.json`]: 'local' });
    expect(entity(mac, a)!.tagline).toBe('PC A');
    expect(entity(mac, b)).toBeUndefined();
    expect(repo.text(`entities/${b}.json`)).toBeNull();
  });

  it('„verweist“: dort gelöscht, hier verweist eine neue Zeile darauf → Rückfrage', async () => {
    const { pc, mac } = await twoMachines();
    const id = firstOf(pc).id;
    pc.db.remove('entities', id);
    await pc.engine.syncNow();
    mac.db.put(
      'chronicle',
      createChronicleEntry({ kind: 'note', at: 1, text: 'Treffen', refs: [id] }),
    );
    await mac.engine.syncNow();
    expect(mac.engine.view.get().conflicts).toMatchObject([{ kind: 'referenced' }]);
    expect(entity(mac, id)).toBeDefined();
  });

  it('Löschen ohne Gegenänderung wandert hinüber und liegt beiseite', async () => {
    const { pc, mac } = await twoMachines();
    const id = firstOf(pc).id;
    pc.db.remove('entities', id);
    await pc.engine.syncNow();
    await mac.engine.syncNow();
    expect(entity(mac, id)).toBeUndefined();
    const aside = await mac.port.asideList();
    expect(aside[0]).toMatchObject({ reason: 'abgleich', entries: [{ side: 'hier' }] });
  });
});

describe('Weltzeit', () => {
  it('beidseits vorgestellt → Karte „time“; Wahl ordnet die Folgen und geht hinüber', async () => {
    const { pc, mac } = await twoMachines();
    const now = pc.db.getSnapshot().state.now;
    pc.db.put('events', createEvent({ title: 'Markt in Hohenfurt', at: now + 24 * 60 }));
    await pc.engine.syncNow();
    await mac.engine.syncNow();
    advanceTime(pc.db, now + 60);
    advanceTime(mac.db, now + 3 * 24 * 60);
    await pc.engine.syncNow();
    await mac.engine.syncNow();
    expect(mac.engine.view.get().conflicts).toMatchObject([{ path: 'state.json', kind: 'time' }]);
    await mac.engine.decide({ 'state.json': 'remote' });
    expect(mac.db.getSnapshot().state.now).toBe(now + 60);
    expect(mac.engine.view.get().reopened?.reopened.events).toBeGreaterThanOrEqual(1);
    await pc.engine.syncNow();
    expect(pc.db.getSnapshot().state.now).toBe(now + 60);
    expect(synced(pc)).toEqual(synced(mac));
  });
});

describe('Wettlauf und Abbrüche', () => {
  it('der andere war schneller → von vorn, nichts überschrieben', async () => {
    const { repo, pc, mac } = await twoMachines();
    mac.db.patch('entities', firstOf(mac).id, { tagline: 'vom Mac' });
    let once = true;
    repo.beforeSwitch = () => {
      if (!once) return;
      once = false;
      repo.commitAs('Windows-PC', {
        [`entities/${second(pc).id}.json`]: text({ ...second(pc), tagline: 'eingeschoben' }),
      });
    };
    const patches = repo.log.filter((l) => l === 'patch').length;
    await mac.engine.syncNow();
    expect(entity(mac, second(mac).id)!.tagline).toBe('eingeschoben');
    expect(JSON.parse(repo.text(`entities/${firstOf(pc).id}.json`)!).tagline).toBe('vom Mac');
    expect(repo.log.filter((l) => l === 'patch').length).toBe(patches + 2);
    // Der eingeschobene Commit ist Vorfahr des neuen Kopfs: nichts überschrieben.
    expect(repo.commits.get(repo.head!)!.parent).not.toBeNull();
  });

  it('Ablage hinter dem Gesehenen → nichts angewendet, nichts hochgeladen', async () => {
    const { repo, pc, mac } = await twoMachines();
    const old = repo.head!;
    pc.db.patch('entities', firstOf(pc).id, { tagline: 'neu' });
    await pc.engine.syncNow();
    await mac.engine.syncNow();
    repo.rewindHead(old);
    mac.db.patch('entities', second(mac).id, { tagline: 'Mac' });
    await mac.engine.syncNow();
    expect(mac.engine.view.get().offline?.why).toBe('behind');
    expect(repo.head).toBe(old);
  });

  it('Abbruch vor dem Umschalten: nichts sichtbar; nach dem Umschalten: nur nachziehen', async () => {
    const { repo, pc, mac } = await twoMachines();
    const head = repo.head;
    pc.db.patch('entities', firstOf(pc).id, { tagline: 'eins' });
    pc.port.crashAt('push:beforeSwitch');
    await pc.engine.syncNow();
    expect(repo.head).toBe(head);
    await pc.engine.syncNow();
    expect(repo.head).not.toBe(head);

    pc.db.patch('entities', firstOf(pc).id, { tagline: 'zwei' });
    pc.port.crashAt('push:afterSwitch');
    await pc.engine.syncNow();
    const after = repo.head;
    const commits = repo.commits.size;
    await pc.engine.syncNow();
    expect(repo.head).toBe(after);
    expect(repo.commits.size).toBe(commits);
    await mac.engine.syncNow();
    expect(entity(mac, firstOf(pc).id)!.tagline).toBe('zwei');
  });

  it('Abbruch mitten im Anwenden → Wiederaufnahme; verfälschte Eingangsdatei wird verworfen', async () => {
    const { pc, mac } = await twoMachines();
    const a = firstOf(pc).id;
    const b = second(pc).id;
    pc.db.patch('entities', a, { tagline: 'A' });
    pc.db.patch('entities', b, { tagline: 'B' });
    await pc.engine.syncNow();
    mac.port.crashAt('applyBegin');
    await mac.engine.syncNow();
    expect(mac.port.note).not.toBeNull();
    expect(entity(mac, a)!.tagline).not.toBe('A');
    // Eine Eingangsdatei wird verfälscht.
    const bSha = mac.port.note!.writes.find((w) => w.path === `entities/${b}.json`)!.sha;
    mac.port.eingang.set(bSha, 'kaputt');
    const before = mac.store.files.get(`entities/${b}.json`);
    await mac.restart();
    expect(mac.port.note).toBeNull();
    expect(entity(mac, a)!.tagline).toBe('A');
    expect(mac.store.files.get(`entities/${b}.json`)).toBe(before);
    mac.port.eingang.delete(bSha);
    await mac.engine.syncNow();
    expect(entity(mac, b)!.tagline).toBe('B');
    expect(synced(mac)).toEqual(synced(pc));
  });

  it('weitergeschrieben während des Laufs → nichts angewendet, neuer Versuch', async () => {
    const { pc, mac } = await twoMachines();
    pc.db.patch('entities', firstOf(pc).id, { tagline: 'vom PC' });
    await pc.engine.syncNow();
    const scan = mac.port.scan.bind(mac.port);
    let once = true;
    mac.port.scan = async (...args) => {
      const result = await scan(...args);
      if (once && args[1]) {
        once = false;
        mac.db.patch('entities', second(mac).id, { tagline: 'dazwischen' });
      }
      return result;
    };
    await mac.engine.syncNow();
    expect(mac.port.calls.filter((c) => c === 'applyBegin:run').length).toBe(1);
    expect(entity(mac, firstOf(pc).id)!.tagline).toBe('vom PC');
    await pc.engine.syncNow();
    expect(entity(pc, second(pc).id)!.tagline).toBe('dazwischen');
  });

  it('sync_push mit einer abweichenden Datei → kein Commit', async () => {
    const { repo, pc } = await twoMachines();
    const head = repo.head;
    const path = `entities/${firstOf(pc).id}.json`;
    await expect(
      pc.port.push({
        root: '/Windows-PC',
        head,
        tree: null,
        changes: [{ path, sha: gitSha('etwas anderes') }],
        dataVersion: DATA_VERSION,
        dataShape: DATA_SHAPE,
        counts: { changed: 1, added: 0, removed: 0 },
      }),
    ).rejects.toMatchObject({ kind: 'busy' });
    expect(repo.head).toBe(head);
  });

  it('zwei Läufe hintereinander legen in zwei verschiedene Ordner beiseite', async () => {
    const { pc, mac } = await twoMachines();
    pc.db.remove('entities', firstOf(pc).id);
    await pc.engine.syncNow();
    await mac.engine.syncNow();
    pc.db.remove('entities', firstOf(pc).id);
    await pc.engine.syncNow();
    await mac.engine.syncNow();
    const runs = (await mac.port.asideList()).map((r) => r.run);
    expect(new Set(runs).size).toBe(2);
  });
});

describe('Ruhiger Moment', () => {
  it('Entwurf offen → nichts angewendet, Hochladen geschieht; danach feldweise zusammengeführt', async () => {
    const { repo, pc, mac } = await twoMachines();
    const id = firstOf(pc).id;
    const stale = entity(mac, id)!;
    pc.db.patch('entities', id, { name: 'Brann der Schmied' });
    await pc.engine.syncNow();
    mac.drafts.held = 1;
    mac.db.patch('entities', second(mac).id, { tagline: 'Mac' });
    await mac.engine.syncNow();
    expect(entity(mac, id)!.name).toBe(stale.name);
    expect(JSON.parse(repo.text(`entities/${second(pc).id}.json`)!).tagline).toBe('Mac');
    expect(mac.engine.view.get().due).toBe(true);
    // Das veraltete Formular wird gespeichert, dann der Entwurf freigegeben.
    mac.db.put('entities', { ...stale, tagline: 'aus dem Formular' } as Entity);
    mac.drafts.set(0);
    await settle();
    expect(entity(mac, id)).toMatchObject({
      name: 'Brann der Schmied',
      tagline: 'aus dem Formular',
    });
  });
});

describe('Störungen', () => {
  it('kein Netz → „Kein Netz“, neuer Versuch nach Plan', async () => {
    const { repo, mac } = await twoMachines();
    mac.engine.start();
    await settle();
    repo.failNext('offline');
    await mac.engine.syncNow();
    expect(mac.engine.view.get()).toMatchObject({ phase: 'offline', offline: { why: 'net' } });
    expect(mac.timers.pending()[0]).toBe(60_000);
    await mac.timers.advance(60_000);
    expect(mac.engine.view.get().phase).toBe('synced');
    mac.engine.stop();
  });

  it('Schlüssel ungültig → braucht dich, kein Wiederholen; Schlüsselbund verweigert', async () => {
    const { repo, mac } = await twoMachines();
    mac.engine.start();
    await settle();
    repo.failNext('key');
    await mac.engine.syncNow();
    expect(mac.engine.view.get().needs?.why).toBe('key');
    expect(mac.timers.pending().every((ms) => ms >= 10 * 60_000 - 1)).toBe(true);
    mac.port.key = 'denied';
    await mac.engine.syncNow();
    expect(mac.engine.view.get().needs?.why).toBe('keychain');
    const before = mac.port.calls.length;
    await mac.timers.advance(5 * 60_000);
    mac.engine.wake();
    await settle();
    expect(mac.port.calls.slice(before).filter((c) => c === 'scan')).toEqual([]);
    mac.engine.stop();
  });

  it('unlesbare Datei vom anderen Rechner → nur sie wartet; „Fassung von hier hochladen“', async () => {
    const { repo, pc, mac } = await twoMachines();
    const id = firstOf(pc).id;
    const path = `entities/${id}.json`;
    repo.commitAs('Windows-PC', {
      [path]: '{"id":"' + id + '","kind":"person","name":42}\n',
      [`entities/${second(pc).id}.json`]: text({ ...second(pc), tagline: 'lesbar' }),
    });
    await mac.engine.syncNow();
    expect(mac.engine.view.get().conflicts).toMatchObject([
      { id: path, kind: 'whole', why: 'unreadable' },
    ]);
    expect(entity(mac, second(mac).id)!.tagline).toBe('lesbar');
    await mac.engine.decide({ [path]: 'local' });
    expect(JSON.parse(repo.text(path)!).name).toBe(firstOf(mac).name);
  });

  it('stand.json kaputt → die vorige Fassung gilt; beide kaputt → erster Abgleich', async () => {
    const { pc, mac } = await twoMachines();
    pc.db.patch('entities', firstOf(pc).id, { tagline: 'x' });
    await pc.engine.syncNow();
    await mac.engine.syncNow();
    mac.port.standText = 'kaputt';
    await mac.engine.syncNow();
    expect(mac.engine.view.get().phase).toBe('synced');
    mac.port.standText = 'kaputt';
    mac.port.standVorherText = 'auch kaputt';
    await mac.engine.syncNow();
    expect(mac.engine.view.get().needs?.why).toBe('firstSync');
  });
});

describe('Ganzer Stand und Kopien', () => {
  it('Sicherung eingespielt → nichts still hochgeladen; „Dieser Rechner gilt“', async () => {
    const { repo, pc, mac } = await twoMachines();
    const head = repo.head;
    await pc.port.mark({ root: '/Windows-PC', dropBase: true });
    const restored = demoCampaign();
    pc.db.replaceAll(restored);
    await pc.engine.syncNow();
    expect(repo.head).toBe(head);
    expect(pc.engine.view.get().needs?.why).toBe('firstSync');
    expect(pc.engine.view.get().firstSync?.different.length).toBeGreaterThan(0);
    await pc.engine.firstSync('localWins');
    expect(inRepo(repo)).toEqual(synced(pc));
    const aside = await pc.port.asideList();
    expect(aside[0]!.reason).toBe('erster-abgleich');
    // Am Mac fehlen danach viele Einträge auf einmal: erst nach „Stimmt“.
    await mac.engine.syncNow();
    const mass = mac.engine.view.get().conflicts.find((c) => c.kind === 'mass')!;
    expect(mass.mass!.kind).toBe('deleteThere');
    await mac.engine.decide({ [mass.id]: 'ok' });
    expect(synced(mac)).toEqual(synced(pc));
  });

  it('Sicherung eingespielt → „Der Stand aus der Ablage gilt“', async () => {
    const { repo, pc } = await twoMachines();
    await pc.port.mark({ root: '/Windows-PC', dropBase: true });
    pc.db.replaceAll(demoCampaign());
    await pc.db.flush();
    await pc.engine.firstSync('remoteWins');
    expect(pc.port.note?.kind).toBe('remoteWins');
    await pc.restart();
    expect(synced(pc)).toEqual(inRepo(repo));
    await pc.engine.syncNow();
    expect(pc.engine.view.get().phase).toBe('synced');
  });

  it('Kopie des Ordners → keine Anfrage; „Kopie“ trennt nur die Kopie; „mein Ordner“ übernimmt den Ort', async () => {
    const { repo, mac } = await twoMachines();
    mac.port.location = '/Kopie';
    const before = repo.log.length;
    await mac.engine.syncNow();
    expect(mac.engine.view.get().needs?.why).toBe('moved');
    expect(repo.log.length).toBe(before);
    await mac.engine.confirmMove(true);
    expect(mac.port.verbindung?.root).toBe('/Kopie');
    expect(mac.engine.view.get().phase).toBe('synced');
    mac.port.location = '/Noch-eine-Kopie';
    await mac.engine.confirmMove(false);
    expect(mac.port.verbindung).toBeNull();
    expect(mac.port.stand).toBeNull();
  });
});

describe('Sehr viel auf einmal', () => {
  it('30 Löschungen hier → nur diese warten; „Stimmt nicht“ holt sie zurück', async () => {
    const { repo, pc, mac } = await twoMachines();
    const now = pc.db.getSnapshot().state.now;
    const ids = Array.from(
      { length: 30 },
      (_, i) => pc.db.put('events', createEvent({ title: `Termin ${i}`, at: now + i })).id,
    );
    await pc.engine.syncNow();
    await mac.engine.syncNow();
    pc.db.batch(() => ids.forEach((id) => pc.db.remove('events', id)));
    pc.db.patch('entities', firstOf(pc).id, { tagline: 'läuft trotzdem' });
    await pc.engine.syncNow();
    const conflicts = pc.engine.view.get().conflicts;
    expect(conflicts).toMatchObject([{ kind: 'mass', mass: { kind: 'deleteHere' } }]);
    expect(conflicts[0]!.mass!.paths).toHaveLength(30);
    expect(JSON.parse(repo.text(`entities/${firstOf(pc).id}.json`)!).tagline).toBe(
      'läuft trotzdem',
    );
    expect(repo.text(`events/${ids[0]}.json`)).not.toBeNull();
    await pc.engine.decide({ [conflicts[0]!.id]: 'back' });
    expect(Object.keys(pc.db.getSnapshot().events)).toEqual(expect.arrayContaining(ids));
  });

  it('„Stimmt“ führt genau diese Löschungen aus', async () => {
    const { repo, pc } = await twoMachines();
    const now = pc.db.getSnapshot().state.now;
    const ids = Array.from(
      { length: 25 },
      (_, i) => pc.db.put('events', createEvent({ title: `Termin ${i}`, at: now + i })).id,
    );
    await pc.engine.syncNow();
    pc.db.batch(() => ids.forEach((id) => pc.db.remove('events', id)));
    await pc.engine.syncNow();
    const id = pc.engine.view.get().conflicts[0]!.id;
    await pc.engine.decide({ [id]: 'ok' });
    expect(repo.text(`events/${ids[0]}.json`)).toBeNull();
    expect(pc.engine.view.get().conflicts).toEqual([]);
  });
});

describe('Verschiedene Programmversionen', () => {
  it('älteres Programm holt, lädt nicht hoch; nach dem Aktualisieren wird ergänzt und hochgeladen', async () => {
    const { repo, pc, mac } = await twoMachines();
    const newer = { dataVersion: DATA_VERSION + 1, dataShape: 'neue-gestalt' };
    await pc.restart(newer);
    const id = firstOf(pc).id;
    const path = `entities/${id}.json`;
    // Der neuere PC speichert ein Feld, das der Mac nicht kennt.
    const withNew = { ...firstOf(pc), rev: firstOf(pc).rev + 1, neuesFeld: 'nur neu' };
    expect(pc.db.takeRemote([{ path, content: text(withNew) }], pc.db.diskSnapshot()).ok).toBe(
      true,
    );
    await pc.engine.syncNow();
    expect(JSON.parse(repo.text('wayfarer.json')!)).toMatchObject({
      datenstand: DATA_VERSION + 1,
      gestalt: 'neue-gestalt',
      geraete: { 'Windows-PC': DATA_VERSION + 1 },
    });
    const head = () => repo.head;

    // Der ältere Mac holt …
    await mac.engine.syncNow();
    expect(mac.store.files.get(path)).toBe(text(withNew));
    expect(mac.engine.view.get()).toMatchObject({ older: true, needs: { why: 'version' } });
    // … bearbeitet den Eintrag (und beschneidet dabei das neue Feld) – und lädt nichts hoch.
    mac.db.patch('entities', id, { tagline: 'vom alten Mac' });
    const before = head();
    await mac.engine.syncNow();
    expect(head()).toBe(before);
    expect(mac.port.stand!.olderEdits).toBe(true);

    // Nach dem Aktualisieren: ergänzt, hochgeladen, auf beiden Rechnern da.
    await mac.restart(newer);
    await mac.engine.syncNow();
    const there = JSON.parse(repo.text(path)!);
    expect(there).toMatchObject({ tagline: 'vom alten Mac', neuesFeld: 'nur neu' });
    expect(mac.port.stand!.olderEdits).toBe(false);
    await pc.engine.syncNow();
    expect(JSON.parse(pc.store.files.get(path)!)).toMatchObject({ neuesFeld: 'nur neu' });
    expect(JSON.parse(repo.text('wayfarer.json')!).geraete.MacBook).toBe(DATA_VERSION + 1);
  });

  it('gleiche Zahl, anderer Fingerabdruck → ruht beidseits', async () => {
    const { repo, mac } = await twoMachines();
    repo.commitAs(
      'Windows-PC',
      {},
      {
        datenstand: DATA_VERSION,
        gestalt: 'anders-gebaut',
        geraete: { 'Windows-PC': DATA_VERSION },
      },
    );
    const before = repo.head;
    mac.db.patch('entities', firstOf(mac).id, { tagline: 'x' });
    await mac.engine.syncNow();
    expect(mac.engine.view.get().needs?.why).toBe('shape');
    expect(repo.head).toBe(before);
    expect(markerText({ datenstand: 1, gestalt: 'a', geraete: {} })).toContain('wayfarer-abgleich');
  });
});

describe('Auslöser', () => {
  it('30 s nach dem Speichern; eigenes Anwenden löst keinen Lauf aus; Session beendet → sofort', async () => {
    const { pc, mac } = await twoMachines();
    mac.engine.start();
    await settle();
    const scans = () => mac.port.calls.filter((c) => c === 'scan').length;
    // Eigenes Anwenden: kein weiterer Lauf.
    pc.db.patch('entities', firstOf(pc).id, { tagline: 'PC' });
    await pc.engine.syncNow();
    await mac.engine.syncNow();
    await mac.timers.advance(1000);
    const afterApply = scans();
    await mac.timers.advance(40_000);
    expect(scans()).toBe(afterApply);
    // Eine eigene Änderung: Lauf nach 30 s.
    mac.db.patch('entities', second(mac).id, { tagline: 'Mac' });
    await mac.db.flush();
    await mac.timers.advance(29_000);
    expect(scans()).toBe(afterApply);
    await mac.timers.advance(2000);
    expect(scans()).toBe(afterApply + 1);
    // Session beendet → sofort.
    mac.db.setState({ sessionId: 'abend-13' });
    await mac.db.flush();
    mac.db.setState({ sessionId: null });
    await settle();
    expect(scans()).toBe(afterApply + 2);
    mac.engine.stop();
  });

  it('Fokus nach mehr als 60 s; Fokus verloren → nur hochladen', async () => {
    const { repo, mac } = await twoMachines();
    mac.engine.start();
    await settle();
    const scans = () => mac.port.calls.filter((c) => c === 'scan').length;
    const n = scans();
    mac.engine.wake();
    await settle();
    expect(scans()).toBe(n);
    await mac.timers.advance(61_000);
    mac.engine.wake();
    await settle();
    expect(scans()).toBe(n + 1);
    mac.db.patch('entities', firstOf(mac).id, { tagline: 'kurz vor dem Zuklappen' });
    await mac.db.flush();
    await mac.timers.advance(21_000);
    const heads = repo.head;
    mac.engine.pushSoon();
    await settle();
    expect(repo.head).not.toBe(heads);
    mac.engine.stop();
  });

  it('Schließen: nur hochladen; die Frist endet nach CLOSE_SYNC_MS', async () => {
    const { repo, pc, mac } = await twoMachines();
    pc.db.patch('entities', firstOf(pc).id, { tagline: 'vom PC' });
    await pc.engine.syncNow();
    mac.db.patch('entities', second(mac).id, { tagline: 'beim Schließen' });
    await mac.engine.beforeClose();
    expect(JSON.parse(repo.text(`entities/${second(pc).id}.json`)!).tagline).toBe('beim Schließen');
    // Hereingeholt wird beim Schließen nichts.
    expect(entity(mac, firstOf(pc).id)!.tagline).not.toBe('vom PC');

    vi.useFakeTimers();
    try {
      let done = false;
      const waiting = settleAfterSave([() => new Promise<void>(() => undefined)], 12_000).then(
        () => (done = true),
      );
      await vi.advanceTimersByTimeAsync(11_000);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1_500);
      await waiting;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Wartet, bis der Lauf beim Start fertig ist (WebCrypto braucht echte Zeit). */
async function idle(m: Machine) {
  await settle();
  for (let i = 0; i < 100 && m.engine.view.get().phase === 'running'; i++) await settle();
}

describe('Gegengelesen', () => {
  it('Sicherung einspielen wartet, bis ein laufender Abgleich fertig ist; nichts geht still hinüber', async () => {
    const { repo, pc } = await twoMachines();
    setActiveSync({ engine: pc.engine, port: pc.port, root: '/Windows-PC' });
    try {
      // Ein Lauf schaut gerade in die Ablage (das dauert) …
      let open: () => void = () => undefined;
      pc.port.scanGate = () => new Promise<void>((resolve) => (open = resolve));
      const running = pc.engine.syncNow();
      await settle();
      // … und genau jetzt wird eine Sicherung eingespielt.
      const restoring = syncBeforeRestore();
      await settle();
      expect(pc.port.calls).not.toContain('mark:dropBase');
      pc.port.scanGate = null;
      open();
      await running;
      await restoring;
      expect(pc.port.calls.at(-1)).toBe('mark:dropBase');
      const now = pc.db.getSnapshot();
      const someone = firstOf(pc);
      const backup = {
        ...now,
        entities: { ...now.entities, [someone.id]: { ...someone, tagline: 'aus der Sicherung' } },
      };
      const head = repo.head;
      pc.db.replaceAll(backup);
      await pc.engine.syncNow();
      expect(repo.head).toBe(head);
      expect(pc.engine.view.get().needs?.why).toBe('firstSync');
    } finally {
      setActiveSync(null);
    }
  });

  it('GitHub bittet um eine Pause → auch Speichern fragt vorher nicht wieder', async () => {
    const { repo, mac } = await twoMachines();
    mac.engine.start();
    await idle(mac);
    repo.failNext('limit', 600);
    await mac.engine.syncNow();
    expect(mac.engine.view.get().offline?.why).toBe('limit');
    const before = repo.log.length;
    for (let i = 0; i < 6; i++) {
      mac.db.patch('entities', firstOf(mac).id, { tagline: `Notiz ${i}` });
      await mac.db.flush();
      await mac.timers.advance(60_000);
    }
    mac.engine.wake();
    mac.engine.pushSoon();
    await settle();
    expect(repo.log.length).toBe(before);
    await mac.timers.advance(5 * 60_000);
    expect(repo.log.length).toBeGreaterThan(before);
    expect(mac.engine.view.get().phase).toBe('synced');
    mac.engine.stop();
  });

  it('Schlüssel ungültig → Speichern, Fokus und Takt fragen nicht wieder; „Jetzt abgleichen“ schon', async () => {
    const { repo, mac } = await twoMachines();
    mac.engine.start();
    await idle(mac);
    repo.failNext('key');
    await mac.engine.syncNow();
    expect(mac.engine.view.get().needs?.why).toBe('key');
    const before = repo.log.length;
    mac.db.patch('entities', firstOf(mac).id, { tagline: 'am Tisch' });
    await mac.db.flush();
    await mac.timers.advance(61_000);
    mac.engine.wake();
    mac.engine.pushSoon();
    await settle();
    await mac.timers.advance(11 * 60_000);
    expect(repo.log.length).toBe(before);
    await mac.engine.syncNow();
    expect(repo.log.length).toBeGreaterThan(before);
    expect(mac.engine.view.get().phase).toBe('synced');
    mac.engine.stop();
  });

  it('eine Entscheidung zur Weltzeit gilt erst, wenn der Eintrag wirklich zusammengeht', async () => {
    const { pc, mac } = await twoMachines();
    const now = pc.db.getSnapshot().state.now;
    pc.db.put('events', createEvent({ title: 'Markt in Hohenfurt', at: now + 24 * 60 }));
    await pc.engine.syncNow();
    await mac.engine.syncNow();
    const [a, b] = people(pc, 'place').filter((p) => p.id !== pc.db.getSnapshot().state.placeId);
    advanceTime(pc.db, now + 60);
    pc.db.setState({ placeId: a!.id });
    advanceTime(mac.db, now + 3 * 24 * 60);
    await pc.engine.syncNow();
    await mac.engine.syncNow();
    expect(mac.engine.view.get().conflicts).toMatchObject([{ path: 'state.json', kind: 'time' }]);
    const marketId = Object.values(mac.db.getSnapshot().events).find(
      (e) => e.title === 'Markt in Hohenfurt',
    )!.id;
    // Am Mac ist der Markt eingetreten: Seine Zeile steht in der Chronik.
    const market = () => ({
      done: Object.values(mac.db.getSnapshot().chronicle).some((c) => c.eventId === marketId),
    });
    expect(market().done).toBe(true);
    // Zwischen Dialog und Entscheidung ändert sich hier eine weitere strittige Angabe.
    mac.db.setState({ placeId: b!.id });
    await mac.engine.decide({ 'state.json': 'remote' });
    // Der Eintrag geht nicht zusammen: Nichts von der Wahl darf schon gelten.
    expect(mac.db.getSnapshot().state.now).toBe(now + 3 * 24 * 60);
    expect(market().done).toBe(true);
    expect(mac.engine.view.get().reopened).toBeNull();
    const card = mac.engine.view.get().conflicts.find((c) => c.path === 'state.json')!;
    expect(card.fields.map((f) => f.at[0]).sort()).toEqual(['now', 'placeId']);
    // Die neue Wahl gilt für beides.
    await mac.engine.decide({ 'state.json': 'remote' });
    expect(mac.db.getSnapshot().state).toMatchObject({ now: now + 60, placeId: a!.id });
    expect(market().done).toBe(false);
    await pc.engine.syncNow();
    expect(synced(pc)).toEqual(synced(mac));
  });

  it('„Fassung von hier hochladen“ legt die unlesbare Fassung von dort beiseite', async () => {
    const { repo, pc, mac } = await twoMachines();
    const id = firstOf(pc).id;
    const path = `entities/${id}.json`;
    const broken = '{"id":"' + id + '","kind":"person","name":42}\n';
    repo.commitAs('Windows-PC', { [path]: broken });
    await mac.engine.syncNow();
    await mac.engine.decide({ [path]: 'local' });
    expect(JSON.parse(repo.text(path)!).name).toBe(firstOf(mac).name);
    const aside = await mac.port.asideList();
    expect(aside[0]).toMatchObject({ reason: 'entscheidung', entries: [{ side: 'dort', path }] });
    expect(await mac.port.asideRead('/MacBook', aside[0]!.run, 'dort', path)).toBe(broken);
  });

  it('nach dem Aktualisieren: eine Datei, die sich nicht ergänzen lässt, hält den Abgleich nicht an', async () => {
    const { repo, pc, mac } = await twoMachines();
    const entry = pc.db.put(
      'chronicle',
      createChronicleEntry({
        kind: 'promise',
        at: 1,
        text: 'Brann hilft beim Markt',
        promise: { due: null, done: false, failed: false },
      }),
    );
    await pc.engine.syncNow();
    await mac.engine.syncNow();
    const path = `chronicle/${entry.id}.json`;
    const here = JSON.parse(mac.store.files.get(path)!);
    expect(here.promise).toBeTruthy();
    // Der gemeinsame Stand trägt eine Angabe, die dieses Programm nicht lesen kann; hier fehlt sie.
    const odd = { ...here, text: 'älter', promise: { ...here.promise, sort: 'unbekannt' } };
    const oddSha = repo.putBlob(text(odd));
    await mac.port.mark({ root: '/MacBook', base: [{ path, sha: oddSha }], olderEdits: true });
    pc.db.patch('entities', firstOf(pc).id, { tagline: 'kommt trotzdem an' });
    await pc.engine.syncNow();
    await mac.engine.syncNow();
    expect(entity(mac, firstOf(pc).id)!.tagline).toBe('kommt trotzdem an');
    expect(mac.port.stand!.olderEdits).toBe(false);
  });

  it('Dauerarbeit ohne 30 s Ruhe: spätestens fünf Minuten nach der ersten Änderung', async () => {
    const { mac } = await twoMachines();
    mac.engine.start();
    await idle(mac);
    const scans = () => mac.port.calls.filter((c) => c === 'scan').length;
    const n = scans();
    const write = async (i: number) => {
      mac.db.patch('entities', firstOf(mac).id, { tagline: `Mitschrift ${i}` });
      await mac.db.flush();
      await mac.timers.advance(20_000);
    };
    // Alle 20 s ein Wort – nie 30 s Ruhe.
    for (let i = 0; i < 14; i++) await write(i);
    expect(scans()).toBe(n);
    await write(14);
    expect(scans()).toBe(n + 1);
    await write(15);
    expect(scans()).toBe(n + 1);
    mac.engine.stop();
  });
});
