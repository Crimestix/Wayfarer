import { describe, expect, it } from 'vitest';
import { advanceTime, moveParty } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { lightUp, putOut, setPlaceLight } from '../../features/unterreich/actions';
import { meanwhile } from '../../shell/meanwhile';
import { createEntity } from '../schema';
import {
  belowSince,
  burningLights,
  describeBelow,
  isUnderground,
  LIGHT_PRESETS,
  lightStatus,
  partySight,
  surfaceDaytime,
  surroundingsAt,
} from '../underground';

const DAY = 24 * 60;
const torch = LIGHT_PRESETS.find((p) => p.id === 'torch')!;
const lantern = LIGHT_PRESETS.find((p) => p.id === 'lantern')!;

/**
 * Eine erfundene Welt: oben Hohenfurt, darunter die Tiefen Stollen mit dem Pilzgrund (Wildnis)
 * und der Stadt Graufels.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  for (const c of Object.values(db.getSnapshot().entities))
    if (c.kind === 'character') db.remove('entities', c.id);
  const place = (name: string, parentId: string | null = null, category = '') =>
    db.put('entities', createEntity({ kind: 'place', name, place: { parentId, category } }));
  const town = place('Hohenfurt', null, 'Stadt');
  const deep = place('Die Tiefen Stollen', null, 'Unterreich');
  const wild = place('Pilzgrund', deep.id, 'Wildnis');
  const city = place('Graufels', deep.id, 'Stadt');
  const mate = (name: string, darkvision: number | null) =>
    db.put(
      'entities',
      createEntity({ kind: 'character', name, character: { active: true, darkvision } }),
    );
  const mira = mate('Mira Tannhaus', 60);
  const odo = mate('Odo Tannhaus', null);
  const now = () => db.getSnapshot().state.now;
  return { db, town, deep, wild, city, mira, odo, now };
}

describe('Unter der Erde', () => {
  it('erkennt, was unter der Erde liegt – auch für die Orte darunter', async () => {
    const { db, town, deep, wild } = await setup();
    const data = db.getSnapshot();
    expect(isUnderground(data, town.id)).toBe(false);
    expect(isUnderground(data, deep.id)).toBe(true);
    expect(isUnderground(data, wild.id)).toBe(true);
    expect(isUnderground(data, null)).toBe(false);
    expect(surroundingsAt(data, town.id, data.state.now)).toBeNull();
    expect(lightStatus(data, town.id)).toBeNull();
  });

  it('errechnet die Umgebung wiederholbar: Licht und Luft bleiben, Geräusche wechseln', async () => {
    const { db, wild, city, now } = await setup();
    const data = db.getSnapshot();
    const today = surroundingsAt(data, wild.id, now())!;
    expect(surroundingsAt(data, wild.id, now())).toEqual(today);
    expect(['dark', 'dim']).toContain(today.light);
    expect(today.manual).toBe(false);
    // Über viele Tage: dieselbe Luft, dasselbe Licht – aber nicht immer dasselbe Geräusch.
    const days = Array.from({ length: 30 }, (_, i) =>
      surroundingsAt(data, wild.id, now() + i * DAY)!,
    );
    expect(new Set(days.map((d) => d.air)).size).toBe(1);
    expect(new Set(days.map((d) => d.light)).size).toBe(1);
    expect(new Set(days.map((d) => d.sound)).size).toBeGreaterThan(1);
    // Wo jemand wohnt, brennt Licht.
    expect(surroundingsAt(data, city.id, now())).toMatchObject({
      light: 'dim',
      lightFrom: 'Lichter der Bewohner',
    });
  });

  it('lässt die Helligkeit von Hand festlegen – sie gilt auch für die Orte darunter', async () => {
    const { db, deep, wild, city, now } = await setup();
    setPlaceLight(db, deep.id, 'bright');
    expect(surroundingsAt(db.getSnapshot(), wild.id, now())).toMatchObject({
      light: 'bright',
      manual: true,
    });
    // Der nähere Ort gilt.
    setPlaceLight(db, city.id, 'dark');
    expect(surroundingsAt(db.getSnapshot(), city.id, now())).toMatchObject({ light: 'dark' });
    setPlaceLight(db, city.id, null);
    setPlaceLight(db, deep.id, null);
    expect(surroundingsAt(db.getSnapshot(), city.id, now())).toMatchObject({
      light: 'dim',
      manual: false,
    });
  });

  it('weiß, wer im Dunkeln sieht, und warnt, wenn kein Licht brennt', async () => {
    const { db, deep, mira, odo } = await setup();
    setPlaceLight(db, deep.id, 'dark');
    const sight = partySight(db.getSnapshot());
    expect(sight.sees.map((c) => c.id)).toEqual([mira.id]);
    expect(sight.blind.map((c) => c.id)).toEqual([odo.id]);
    expect(lightStatus(db.getSnapshot(), deep.id)).toMatchObject({
      state: 'dark',
      summary: 'Dunkelheit',
      warning: 'Kein Licht: Odo Tannhaus sieht nichts.',
    });
    // Sieht gar niemand etwas, zählt Wayfarer die Namen nicht einzeln auf.
    const seer = db.getSnapshot().entities[mira.id];
    if (seer?.kind === 'character')
      db.patch('entities', seer.id, { character: { ...seer.character, darkvision: null } });
    expect(lightStatus(db.getSnapshot(), deep.id)!.warning).toBe(
      'Kein Licht: Niemand in der Gruppe sieht etwas.',
    );
    // Im dämmrigen Licht einer Siedlung braucht niemand eine Warnung.
    setPlaceLight(db, deep.id, 'dim');
    expect(lightStatus(db.getSnapshot(), deep.id)).toMatchObject({
      state: 'ambient',
      summary: 'Dämmriges Licht',
      warning: null,
    });
  });

  it('führt Buch über die Lichter: anzünden, herunterbrennen, erlöschen, löschen', async () => {
    const { db, deep, now } = await setup();
    setPlaceLight(db, deep.id, 'dark');
    moveParty(db, deep.id);
    const start = now();
    lightUp(db, torch);
    lightUp(db, lantern);
    expect(burningLights(db.getSnapshot()).map((t) => t.label)).toEqual(['Fackel', 'Laterne']);
    expect(lightStatus(db.getSnapshot())).toMatchObject({
      state: 'lit',
      summary: 'Fackel · 1 Std.',
      warning: null,
    });
    // Kurz vor dem Erlöschen der Fackel: ein Hinweis – die Laterne brennt aber weiter.
    advanceTime(db, start + 52);
    expect(lightStatus(db.getSnapshot())).toMatchObject({
      summary: 'Fackel · 8 Min.',
      warning: 'Fackel erlischt in 8 Min.',
    });
    // Die Fackel ist herunter: Wayfarer meldet es und zeigt das nächste Licht.
    const result = advanceTime(db, start + 60);
    expect(meanwhile(db.getSnapshot(), result).lines).toContainEqual({
      text: 'Erloschen: Fackel',
      weight: 'main',
    });
    expect(lightStatus(db.getSnapshot())).toMatchObject({ summary: 'Laterne · 5 Std.' });
    // Die Laterne von Hand löschen – und es ist dunkel.
    const laterne = burningLights(db.getSnapshot())[0]!;
    const undo = putOut(db, laterne.id)!;
    expect(lightStatus(db.getSnapshot())).toMatchObject({ state: 'dark' });
    undo();
    expect(lightStatus(db.getSnapshot())).toMatchObject({ state: 'lit' });
    // Das letzte Licht: Der Hinweis sagt, dass danach keines mehr brennt.
    advanceTime(db, start + 355);
    expect(lightStatus(db.getSnapshot())!.warning).toBe(
      'Laterne erlischt in 5 Min. – danach brennt kein Licht mehr.',
    );
  });

  it('zählt, wie lange die Gruppe schon ohne Himmel ist', async () => {
    const { db, town, wild, city, now } = await setup();
    moveParty(db, town.id);
    expect(belowSince(db.getSnapshot())).toBeNull();
    advanceTime(db, now() + DAY);
    moveParty(db, wild.id);
    const went = now();
    advanceTime(db, now() + 3 * DAY);
    // Ein Ortswechsel unter der Erde unterbricht die Folge nicht.
    moveParty(db, city.id);
    advanceTime(db, now() + 2 * DAY);
    expect(belowSince(db.getSnapshot())).toBe(went);
    expect(describeBelow(went, now())).toBe('seit 5 Tagen');
    expect(describeBelow(went, went)).toBe('seit heute');
    expect(describeBelow(went, went + DAY)).toBe('seit gestern');
    // Zurück an der Oberfläche: Die Zählung endet.
    moveParty(db, town.id);
    expect(belowSince(db.getSnapshot())).toBeNull();
  });

  it('nennt die Tageszeit an der Oberfläche', () => {
    const at = (hour: number) => surfaceDaytime(100 * DAY + hour * 60);
    expect([at(2), at(6), at(10), at(13), at(16), at(20), at(23)]).toEqual([
      'Nacht',
      'Morgen',
      'Vormittag',
      'Mittag',
      'Nachmittag',
      'Abend',
      'Nacht',
    ]);
  });
});
