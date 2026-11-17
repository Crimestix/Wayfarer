import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  addBoardArea,
  addBoardLink,
  placeOnBoard,
  setAreaStory,
  setBoardLinkDir,
  setBoardLinkWord,
  setBoardStart,
} from '../../features/faeden/actions';
import { boardFacts, factKindOf, foundAt, knownBy, leadsInto } from '../boardFacts';
import { createEntity } from '../schema';
import { storyAdvice } from '../story';
import { frameReadiness } from '../whiteboard';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const put = (kind: 'person' | 'place' | 'item', name: string) =>
    db.put('entities', createEntity({ kind, name }));
  const daria = put('person', 'Daria Hagel');
  const theo = put('person', 'Theo Becker');
  const diary = put('item', 'Darias Tagebuch');
  const forge = put('place', 'Schmiede');
  const link = (a: string, b: string, word: string, dir: 'to' | 'none' = 'to') => {
    const made = addBoardLink(db, a, b)!;
    if (word) setBoardLinkWord(db, made.id, word);
    if (dir === 'none') setBoardLinkDir(db, made.id, 'none');
    return made.id;
  };
  return { db, data: () => db.getSnapshot(), daria, theo, diary, forge, link };
}

describe('Was die Fäden sagen', () => {
  it('versteht drei Sorten von Wörtern – sonst bleibt es eine Schnur', () => {
    expect(factKindOf('liegt in')).toBe('located');
    expect(factKindOf('versteckt bei')).toBe('located');
    expect(factKindOf('weiß von')).toBe('knows');
    expect(factKindOf('hat belauscht')).toBe('knows');
    expect(factKindOf('führt zu')).toBe('leads');
    expect(factKindOf('Schwester')).toBeNull();
    expect(factKindOf('')).toBeNull();
  });

  it('zeigt, was an einem Ort liegt und wer wovon weiß – auch, wenn der Faden vom Ort ausgeht', async () => {
    const { data, daria, theo, diary, forge, link } = await setup();
    link(`node:${forge.id}`, `node:${diary.id}`, 'liegt in');
    link(`node:${daria.id}`, `node:${theo.id}`, 'weiß von');
    link(`node:${daria.id}`, `node:${forge.id}`, 'Schwester', 'none');
    expect(foundAt(data(), forge.id).map((fact) => fact.from)).toEqual([`node:${diary.id}`]);
    expect(knownBy(data(), daria.id).map((fact) => fact.to)).toEqual([`node:${theo.id}`]);
    expect(boardFacts(data())).toHaveLength(2);
  });

  it('zählt die Fäden zum Kern und macht einen Rahmen spielbar', async () => {
    const { db, data, daria, theo, diary, forge, link } = await setup();
    const { area } = addBoardArea(db, { x: 0, y: 0, w: 1200, h: 800 }, 'Theos Versteck');
    const story = setAreaStory(db, area.id, 'new')!.story!;
    db.patch('stories', story.id, { ownerId: theo.id });
    for (const [key, x] of [
      [`node:${daria.id}`, 100],
      [`node:${theo.id}`, 300],
      [`node:${diary.id}`, 500],
      [`node:${forge.id}`, 700],
    ] as const)
      placeOnBoard(db, key, x, 400);
    let ready = frameReadiness(data(), story.id)!;
    expect(ready).toMatchObject({ playable: false, places: 1, core: `node:${theo.id}` });
    expect(ready.missing[0]).toContain('Einstieg');

    link(`node:${diary.id}`, `node:${forge.id}`, 'liegt in');
    link(`node:${daria.id}`, `node:${theo.id}`, 'weiß von');
    link(`node:${diary.id}`, `node:${theo.id}`, 'führt zu');
    link(`node:${forge.id}`, `node:${theo.id}`, '');
    setBoardStart(db, `node:${daria.id}`, true);
    ready = frameReadiness(data(), story.id)!;
    expect(ready).toMatchObject({ playable: true, leads: 3, found: 1 });
    expect(leadsInto(boardFacts(data()), `node:${theo.id}`)).toBe(3);
    // Der Stand der Geschichte zählt das Brett mit.
    const advice = storyAdvice(data(), data().stories[story.id]!);
    expect(advice.find((entry) => entry.key === 'entry')!.done).toBe(true);
    expect(advice.find((entry) => entry.key === 'threads')!.done).toBe(true);
    expect(advice.find((entry) => entry.key === 'scene')!.done).toBe(true);
  });
});
