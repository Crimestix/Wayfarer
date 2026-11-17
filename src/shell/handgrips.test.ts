import { describe, expect, it } from 'vitest';
import { elarisCampaign } from '../data/seed';
import { CampaignDb } from '../data/db';
import { MemoryStore } from '../data/store';
import { createEntity } from '../domain/schema';
import { SETTINGS_SECTIONS } from '../features/einstellungen/sections';
import type { ShellRequest } from './commands';
import { HANDGRIPS, findHandgrips, readDuration, type GripRun } from './handgrips';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const home = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  db.put('entities', createEntity({ kind: 'place', name: 'Graufels' }));
  db.setState({ placeId: home.id });
  return db.getSnapshot();
}

const labels = (list: { label: string }[]) => list.map((grip) => grip.label);

describe('Die Suche findet jeden Handgriff', () => {
  it('jedes Fenster, das das Gerüst öffnen kann, ist ein Handgriff', () => {
    // Haltung braucht eine Person, die Suche ist sie selbst – alles andere muss sich finden lassen.
    const needed: Exclude<NonNullable<ShellRequest>['type'], 'search' | 'attitude'>[] = [
      'log',
      'move',
      'spell',
      'time',
      'rest',
      'downtime',
      'shop',
      'journey',
    ];
    const runs = new Set<GripRun['type']>(HANDGRIPS.map((grip) => grip.run.type));
    for (const type of needed) expect(runs.has(type), type).toBe(true);
  });

  it('jeder Abschnitt der Einstellungen ist unter seinem Namen zu finden', async () => {
    const data = await setup();
    for (const section of SETTINGS_SECTIONS)
      expect(labels(findHandgrips(data, section.title)), section.title).toContain(section.title);
  });

  it('findet unter gewöhnlichen Wörtern, was man tun will', async () => {
    const data = await setup();
    expect(labels(findHandgrips(data, 'rast'))).toEqual(
      expect.arrayContaining(['Kurze Rast', 'Lange Rast']),
    );
    expect(labels(findHandgrips(data, 'beute'))[0]).toBe('Beute verteilen');
    expect(labels(findHandgrips(data, 'kaufen'))).toContain('Handeln – kaufen oder verkaufen');
    expect(labels(findHandgrips(data, 'jahreszeiten'))).toContain('Kalender');
    expect(findHandgrips(data, 'xyzq')).toEqual([]);
  });

  it('liest eine Dauer und lässt so lange Zeit vergehen', async () => {
    const data = await setup();
    expect(readDuration('2 Std.')).toBe(120);
    expect(readDuration('+30 min')).toBe(30);
    expect(readDuration('zeit 3 tage')).toBe(3 * 1440);
    expect(readDuration('1,5 h')).toBe(90);
    expect(readDuration('Rast')).toBeNull();
    expect(findHandgrips(data, '2 std')[0]).toMatchObject({
      label: '2 Stunden vergehen lassen',
      run: { type: 'pass', minutes: 120 },
    });
  });

  it('liest ein Ziel: dorthin ziehen oder reisen – nie zum Ort, an dem die Gruppe schon ist', async () => {
    const data = await setup();
    expect(labels(findHandgrips(data, 'nach Grau'))).toEqual(
      expect.arrayContaining(['Gruppe nach Graufels ziehen', 'Reise nach Graufels antreten']),
    );
    expect(labels(findHandgrips(data, 'nach Hohenfurt')).join()).not.toContain('Hohenfurt');
  });
});
