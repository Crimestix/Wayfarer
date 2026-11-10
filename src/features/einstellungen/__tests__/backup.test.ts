import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../../data/db';
import { demoCampaign, elarisCampaign } from '../../../data/seed';
import { MemoryStore } from '../../../data/store';
import { entitiesOfKind } from '../../../domain/derive';
import { COLLECTION_NAMES } from '../../../domain/schema';
import fullBackup from '../../import/__fixtures__/v157-voll.json';
import { importV157Backup } from '../../import/v157';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  createBackup,
  formatRealTime,
  parseBackupText,
  readBackup,
  serializeBackup,
  summarize,
} from '../backup';

const STAMP = '2026-11-10T13:05:00.000Z';

describe('Sicherung: Hin- und Rückweg', () => {
  it('schreibt die gesamte Kampagne in eine Datei und liest sie unverändert zurück', () => {
    const data = demoCampaign();
    const text = serializeBackup(data, STAMP);
    const restored = parseBackupText(text);
    expect(restored.data).toEqual(data);
    expect(restored.skipped).toEqual([]);
    expect(restored.repaired).toBe(0);
    expect(restored.exportedAt).toBe(STAMP);
  });

  it('trägt Format und Version und enthält jede Sammlung vollständig', () => {
    const data = demoCampaign();
    const file = createBackup(data, STAMP);
    expect(file.format).toBe(BACKUP_FORMAT);
    expect(file.version).toBe(BACKUP_VERSION);
    expect(Object.keys(file)).toEqual([
      'format',
      'version',
      'exportedAt',
      'campaign',
      'state',
      ...COLLECTION_NAMES,
    ]);
    for (const name of COLLECTION_NAMES)
      expect(file[name]).toHaveLength(Object.keys(data[name]).length);
    // Gleicher Stand, gleiche Datei: die Reihenfolge hängt nicht vom Zufall ab.
    expect(serializeBackup(data, STAMP)).toBe(
      serializeBackup(
        { ...data, entities: Object.fromEntries(Object.entries(data.entities).reverse()) },
        STAMP,
      ),
    );
  });

  it('übersteht den ganzen Weg: sichern, in eine andere Kampagne einspielen, speichern, neu laden', async () => {
    const original = importV157Backup(structuredClone(fullBackup)).data;
    const text = serializeBackup(original);
    const store = new MemoryStore();
    const db = await CampaignDb.create(store, demoCampaign());
    db.replaceAll(parseBackupText(text).data);
    await db.flush();
    const reopened = await CampaignDb.open(store);
    expect(reopened.problems).toEqual([]);
    expect(reopened.getSnapshot()).toEqual(original);
    // Von der Beispielwelt ist nichts übrig.
    expect(
      entitiesOfKind(reopened.getSnapshot(), 'place').some((p) => p.name === 'Dornhafen'),
    ).toBe(false);
  });
});

describe('Sicherung einspielen: Prüfung', () => {
  const valid = () => JSON.parse(serializeBackup(demoCampaign(), STAMP)) as Record<string, unknown>;

  it('lehnt fremde Dateien mit einem verständlichen Satz ab', () => {
    for (const raw of [null, 5, 'text', [], {}, { format: 'etwas-anderes', version: 1 }])
      expect(() => readBackup(raw)).toThrow('Diese Datei ist keine Wayfarer-Sicherung.');
    expect(() => parseBackupText('{ kaputt')).toThrow(/lässt sich nicht lesen/);
  });

  it('erkennt ein Backup der alten Version und verweist auf die Übernahme', () => {
    expect(() => readBackup(structuredClone(fullBackup))).toThrow(/Alten Spielstand übernehmen/);
  });

  it('lehnt Sicherungen aus einer neueren Version ab', () => {
    expect(() => readBackup({ ...valid(), version: BACKUP_VERSION + 1 })).toThrow(
      /neueren Version/,
    );
    expect(() => readBackup({ ...valid(), version: 'eins' })).toThrow(/Versionsangabe/);
    expect(() => readBackup({ ...valid(), version: 0 })).toThrow(/Versionsangabe/);
  });

  it('lehnt Sicherungen ohne lesbare Kampagne oder Weltzeit ab', () => {
    expect(() => readBackup({ ...valid(), campaign: { name: 'Ohne Kalender' } })).toThrow(
      /Name und Kalender/,
    );
    expect(() => readBackup({ ...valid(), state: { id: 'state', now: -5 } })).toThrow(/Weltzeit/);
  });

  it('lässt unlesbare und doppelte Dokumente aus und meldet sie', () => {
    const raw = valid();
    const entities = raw.entities as Record<string, unknown>[];
    const total = entities.length;
    (entities as unknown[]).push(
      { ...entities[0]! },
      { id: 'kaputt', kind: 'drache', name: 'Smaragd' },
      'kein Dokument',
    );
    (raw.chronicle as unknown[]).push({ id: 'ohne-zeit', text: 'Ohne Zeitangabe' });
    delete raw.timers;
    const result = readBackup(raw);
    expect(Object.keys(result.data.entities)).toHaveLength(total);
    expect(result.data.timers).toEqual({});
    expect(result.skipped).toEqual([
      {
        label: `Eintrag der Welt ${total + 1} („${entities[0]!.name as string}“)`,
        reason: 'Die Kennung kommt doppelt vor.',
      },
      {
        label: `Eintrag der Welt ${total + 2} („Smaragd“)`,
        reason: 'Die Angaben sind unvollständig oder haben eine falsche Form.',
      },
      {
        label: `Eintrag der Welt ${total + 3}`,
        reason: 'Die Angaben sind unvollständig oder haben eine falsche Form.',
      },
      {
        label: `Chronikeintrag ${(raw.chronicle as unknown[]).length} („Ohne Zeitangabe“)`,
        reason: 'Die Angaben sind unvollständig oder haben eine falsche Form.',
      },
      { label: 'Timer', reason: 'Der ganze Bereich fehlt in der Sicherung.' },
    ]);
  });

  it('entfernt Verweise auf Dokumente, die in der Sicherung fehlen', () => {
    const raw = valid();
    const placeId = (raw.state as { placeId: string }).placeId;
    expect(placeId).toBeTruthy();
    raw.entities = (raw.entities as { id: string }[]).filter((e) => e.id !== placeId);
    const result = readBackup(raw);
    expect(result.repaired).toBeGreaterThan(0);
    expect(result.data.state.placeId).toBeNull();
    expect(result.data.entities[placeId]).toBeUndefined();
    // Der bereinigte Stand lässt sich einspielen.
    return CampaignDb.create(new MemoryStore(), elarisCampaign()).then((db) => {
      expect(() => db.replaceAll(result.data)).not.toThrow();
    });
  });

  it('füllt Felder, die einer älteren Sicherung noch fehlen, mit den Vorgaben', () => {
    const raw = valid();
    for (const entity of raw.entities as Record<string, unknown>[]) {
      delete entity.tags;
      delete entity.secret;
    }
    const result = readBackup(raw);
    expect(result.skipped).toEqual([]);
    expect(
      Object.values(result.data.entities).every((e) => Array.isArray(e.tags) && e.secret === ''),
    ).toBe(true);
  });
});

describe('Dateiname und Zusammenfassung', () => {
  it('bildet einen Dateinamen, der auf macOS und Windows gilt', () => {
    const day = new Date(2026, 10, 10, 9, 5);
    expect(backupFileName('Elaris', day)).toBe('wayfarer-sicherung-elaris-2026-11-10-0905.json');
    expect(backupFileName('Die Gezeichneten: Käfig & Süßholz?', day)).toBe(
      'wayfarer-sicherung-die-gezeichneten-kaefig-suessholz-2026-11-10-0905.json',
    );
    expect(backupFileName('   ', day)).toBe('wayfarer-sicherung-kampagne-2026-11-10-0905.json');
    const long = backupFileName('x'.repeat(200), new Date(2026, 0, 5, 23, 59));
    expect(long).toBe(`wayfarer-sicherung-${'x'.repeat(40)}-2026-01-05-2359.json`);
    // Keine Zeichen, die Windows oder der Kampagnenordner ablehnen.
    expect(long).toMatch(/^[a-z0-9-]+\.json$/);
  });

  it('fasst einen Spielstand in Worten zusammen', () => {
    const summary = summarize(importV157Backup(structuredClone(fullBackup)).data);
    expect(summary).toEqual({
      name: 'Elaris',
      worldDate: '19. Tauwind 701 AD, 21:00',
      parts: [
        '7 Personen',
        '6 Orte',
        '4 Fraktionen',
        '6 Gefährten',
        '8 Themen',
        '16 Beziehungen',
        '17 Chronikeinträge',
        '6 Termine',
        '2 Sessions',
        '4 Timer',
      ],
    });
    const single = summarize({ ...elarisCampaign() });
    expect(single.parts).toEqual(['6 Gefährten', '1 Termin', '1 Session']);
  });

  it('schreibt den Zeitpunkt einer Sicherung aus', () => {
    expect(formatRealTime('')).toBe('');
    expect(formatRealTime('kein Datum')).toBe('');
    expect(formatRealTime(STAMP)).toMatch(/^10\. November 2026, \d\d:05 Uhr$/);
  });
});
