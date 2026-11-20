/** F01, F03, F04: frei schreiben, ohne Pflichtangaben und ohne neue Aufgaben. */
import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity } from '../../domain/schema';
import { gapCount, wikiGaps } from '../wiki/gaps';
import { importedWithoutEntry, recentWork, textsWithoutEntry } from './model';
import { draftTitle, startFreeText } from './writing';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  return { db, data: () => db.getSnapshot() };
}

describe('F01: frei schreiben', () => {
  it('ein Text ohne Namen heißt „Entwurf“, der nächste „Entwurf 2“', async () => {
    const { db, data } = await setup();
    const first = startFreeText(db)!;
    expect(first.created).toBe(true);
    expect(first.entity).toBeNull();
    expect(first.article!.title).toBe('Entwurf');
    expect(draftTitle(data().articles)).toBe('Entwurf 2');
    expect(startFreeText(db)!.article!.title).toBe('Entwurf 2');
  });

  it('mit Namen trägt er den Namen – und es gibt keinen zweiten gleichen Namens', async () => {
    const { db } = await setup();
    const a = startFreeText(db, 'Reise nach Norden')!;
    const b = startFreeText(db, 'Reise nach Norden')!;
    expect(b.created).toBe(false);
    expect(b.article!.id).toBe(a.article!.id);
  });
});

describe('F03: ein kurzer freier Text ist keine offene Arbeit', () => {
  it('zählt weder bei „Noch zu schreiben“ noch als zu sortieren', async () => {
    const { db, data } = await setup();
    const before = gapCount(wikiGaps(data()));
    startFreeText(db, 'Reise nach Norden');
    expect(gapCount(wikiGaps(data()))).toBe(before);
    // In „Ohne Kategorie“ steht er (erreichbar), als Aufgabe zählt er nicht.
    expect(textsWithoutEntry(data()).map((a) => a.title)).toContain('Reise nach Norden');
    expect(importedWithoutEntry(data()).map((a) => a.title)).not.toContain('Reise nach Norden');
  });
});

describe('F04: Weiterarbeiten', () => {
  it('zeigt eigenständige Texte und Einträge der Welt, jüngstes zuerst', async () => {
    const { db, data } = await setup();
    db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const text = startFreeText(db, 'Reise nach Norden')!.article!;
    const work = recentWork(data(), 5);
    expect(work[0]).toMatchObject({ key: text.id, label: 'Text', href: `/wiki/${text.id}` });
    expect(work.map((w) => w.title)).toContain('Hohenfurt');
  });
});
