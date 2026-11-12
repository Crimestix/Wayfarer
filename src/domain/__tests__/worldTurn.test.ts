import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { saveWay } from '../../features/wege/actions';
import { setManualWeather } from '../../features/wetter/actions';
import {
  createChronicleEntry,
  createClock,
  createEntity,
  newId,
  type ChronicleKind,
  type Place,
  type Weather,
} from '../schema';
import { MINUTES_PER_DAY, dayIndexOf } from '../time/calendar';
import { weatherZone } from '../weatherZone';
import { TURN_DAYS_ALL, turnWeight, watchedEntities, worldTurn } from '../worldTurn';

/**
 * Erfundene Welt: Die Gruppe steht am Markt von Graufels. Der Hafen liegt in derselben Stadt,
 * Hohenfurt weit weg. Mira kennt die Gruppe, Odo nicht.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string, parentId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'place', name, place: { parentId } })) as Place;
  const town = place('Graufels');
  const market = place('Markt', town.id);
  const harbour = place('Hafen', town.id);
  const gate = place('Nordtor', town.id);
  const far = place('Hohenfurt');
  const mill = place('Alte Mühle', far.id);
  const mira = db.put(
    'entities',
    createEntity({ kind: 'person', name: 'Mira Tannhaus', person: { placeId: far.id, met: true } }),
  );
  const odo = db.put(
    'entities',
    createEntity({ kind: 'person', name: 'Odo Tannhaus', person: { placeId: far.id } }),
  );
  db.setState({ placeId: market.id });
  const data = () => db.getSnapshot();
  const now = data().state.now;
  const happen = (
    text: string,
    placeId: string | null,
    more: { daysAgo?: number; refs?: string[]; kind?: ChronicleKind } = {},
  ) =>
    db.put(
      'chronicle',
      createChronicleEntry({
        kind: more.kind ?? 'change',
        at: now - (more.daysAgo ?? 1) * MINUTES_PER_DAY,
        text,
        placeId,
        refs: more.refs ?? [],
      }),
    );
  const sky = (back: number, precipitation: Weather['precipitation']) => {
    // Jeder Ort kann seine eigene Wetterzone haben (den Hafen erkennt Wayfarer am Namen).
    for (const where of [town, market, harbour, gate, far, mill])
      setManualWeather(db, weatherZone(data(), where.id), dayIndexOf(now) - back, {
        temperature: 12,
        precipitation,
        wind: 'none',
        fog: false,
        note: '',
      });
  };
  const dry = () => [0, 1, 2].forEach((back) => sky(back, 'none'));
  dry();
  return { db, data, now, town, market, harbour, gate, far, mill, mira, odo, happen, sky };
}

const titles = (items: { title: string }[]) => items.map((item) => item.title);

describe('Was wie schwer wiegt', () => {
  it('am Ort der Gruppe, in ihrer Nähe, bei Bekannten – oder weit weg', async () => {
    const { db, data, market, harbour, far, mira, odo } = await setup();
    expect(turnWeight(data(), [market.id])).toEqual({ weight: 3, why: 'am Ort der Gruppe' });
    expect(turnWeight(data(), [harbour.id])).toEqual({ weight: 2, why: 'in der Nähe der Gruppe' });
    expect(turnWeight(data(), [far.id, mira.id])).toEqual({
      weight: 2,
      why: 'betrifft Mira Tannhaus – die Gruppe kennt die Person',
    });
    expect(turnWeight(data(), [far.id, odo.id])).toEqual({
      weight: 1,
      why: 'weit weg von der Gruppe',
    });
    // Ein Weg von höchstens einem Tagesmarsch macht es nah; ein längerer nicht.
    const way = saveWay(db, { fromId: market.id, toId: far.id, minutes: 240 });
    expect(turnWeight(data(), [far.id, odo.id])).toEqual({
      weight: 2,
      why: '4 Std. von der Gruppe entfernt',
    });
    saveWay(db, { id: way.id, fromId: market.id, toId: far.id, minutes: 900 });
    expect(turnWeight(data(), [far.id, odo.id]).weight).toBe(1);
  });
});

describe('Die Welt dreht sich weiter', () => {
  it('ordnet das Geschehen nach Gewicht – das Entfernte steht im Rest', async () => {
    const { data, market, harbour, far, mira, happen } = await setup();
    happen('Der Zoll wird verdoppelt', harbour.id, { daysAgo: 3 });
    happen('Die Glocke bleibt stumm', market.id, { daysAgo: 2 });
    happen('Mira verliert ihr Boot', far.id, { refs: [mira.id], kind: 'event' });
    happen('In Hohenfurt brennt eine Scheune', far.id);
    // Notizen der Gruppe gehören nicht hierher.
    happen('Die Gruppe trinkt Tee', market.id, { kind: 'note' });
    const turn = worldTurn(data());
    expect(titles(turn.weighty)).toEqual([
      'Die Glocke bleibt stumm',
      'Mira verliert ihr Boot',
      'Der Zoll wird verdoppelt',
    ]);
    expect(turn.weighty.map((item) => item.weight)).toEqual([3, 2, 2]);
    expect(titles(turn.rest)).toEqual(['In Hohenfurt brennt eine Scheune']);
    expect(turn.watched).toEqual([]);
  });

  it('zeigt nur die letzten Tage – „Alles“ reicht weiter zurück', async () => {
    const { data, market, happen } = await setup();
    happen('Der alte Brunnen versiegt', market.id, { daysAgo: 40 });
    expect(worldTurn(data()).weighty).toEqual([]);
    expect(titles(worldTurn(data(), TURN_DAYS_ALL).weighty)).toEqual(['Der alte Brunnen versiegt']);
  });

  it('was der Spielleiter beobachtet, steht oben – auch Orte darin', async () => {
    const { db, data, far, mill, odo, happen } = await setup();
    happen('In Hohenfurt brennt eine Scheune', far.id);
    happen('Die Mühle steht still', mill.id);
    happen('Odo verschwindet', null, { refs: [odo.id] });
    db.setState({ watch: [far.id] });
    let turn = worldTurn(data());
    expect(titles(turn.watched).sort()).toEqual([
      'Die Mühle steht still',
      'In Hohenfurt brennt eine Scheune',
    ]);
    expect(titles(turn.rest)).toEqual(['Odo verschwindet']);
    db.setState({ watch: [far.id, odo.id, 'gibt-es-nicht'] });
    turn = worldTurn(data());
    expect(turn.watched).toHaveLength(3);
    expect(watchedEntities(data()).map((entity) => entity.name)).toEqual([
      'Hohenfurt',
      'Odo Tannhaus',
    ]);
  });

  it('bündelt Wege, die das Wetter verändert hat', async () => {
    const { db, data, market, harbour, gate, far, mill, sky } = await setup();
    saveWay(db, { fromId: market.id, toId: harbour.id, minutes: 10, sort: 'trail' });
    saveWay(db, { fromId: market.id, toId: gate.id, minutes: 15, sort: 'trail' });
    saveWay(db, { fromId: harbour.id, toId: gate.id, minutes: 20, sort: 'street' });
    saveWay(db, { fromId: far.id, toId: mill.id, minutes: 30, sort: 'swamp', name: 'Moorsteg' });
    expect(worldTurn(data()).weighty).toEqual([]);
    sky(0, 'heavy');
    const turn = worldTurn(data());
    expect(turn.weighty).toHaveLength(1);
    expect(turn.weighty[0]).toMatchObject({
      kind: 'ways',
      at: null,
      title: 'Zwei Wege verschlammt in Graufels',
      detail: ['Markt – Hafen', 'Markt – Nordtor'],
      weight: 3,
    });
    expect(turn.rest).toHaveLength(1);
    expect(turn.rest[0]).toMatchObject({
      title: 'Weg Moorsteg (Hohenfurt – Alte Mühle) nicht passierbar',
      weight: 1,
    });
    expect(turn.rest[0]!.detail[0]).toContain('Starkregen heute');
  });

  it('nennt die Uhren, die noch laufen – die mit dem nächsten Schritt zuerst', async () => {
    const { db, data, now } = await setup();
    const step = (text: string, days: number) => ({
      id: newId(),
      text,
      days,
      delay: 0,
      at: null,
      skipped: false,
      needs: '',
      runId: null,
    });
    db.put(
      'clocks',
      createClock({ title: 'Später', start: now, steps: [step('Der Graf bricht auf', 9)] }),
    );
    db.put(
      'clocks',
      createClock({ title: 'Bald', start: now, steps: [step('Die Flut kommt', 2)] }),
    );
    expect(worldTurn(data()).clocks.map((view) => view.clock.title)).toEqual(['Bald', 'Später']);
  });
});
