/**
 * Verstümmelte Backups: Der Import darf an keiner Stelle abbrechen, und was er liefert, muss
 * durch alle Schemata gehen und sich als ganzer Stand einspielen lassen. Die Verstümmelungen
 * folgen einem festen Zufallsgenerator, damit ein Fehlschlag wiederholbar ist.
 */
import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../../data/db';
import { MemoryStore } from '../../../data/store';
import { elarisCampaign } from '../../../data/seed';
import { COLLECTION_NAMES, COLLECTION_SCHEMAS } from '../../../domain/schema';
import fullBackup from '../__fixtures__/v157-voll.json';
import { previewV157Backup } from '../v157';

/** Kleiner, fester Zufallsgenerator (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const JUNK: unknown[] = [
  null,
  undefined,
  '',
  'x',
  '__proto__',
  -1,
  0,
  1.5,
  Number.MAX_SAFE_INTEGER + 2,
  Number.NaN,
  true,
  [],
  {},
  [null],
  { id: 7 },
  'ÄÖÜ/\\:*?"<>|.CON ',
  'a'.repeat(5000),
];

/** Alle Stellen (Objektfelder und Listenplätze) eines Wertes. */
function slots(value: unknown, out: { holder: Record<string, unknown>; key: string }[] = []) {
  if (value && typeof value === 'object') {
    const holder = value as Record<string, unknown>;
    for (const key of Object.keys(holder)) {
      out.push({ holder, key });
      slots(holder[key], out);
    }
  }
  return out;
}

function mutate(seed: number): Record<string, unknown> {
  const rnd = random(seed);
  const raw = structuredClone(fullBackup) as unknown as Record<string, unknown>;
  const hits = 1 + Math.floor(rnd() * 12);
  for (let i = 0; i < hits; i++) {
    const all = slots(raw).filter(({ holder, key }) => !(holder === raw && key === 'version'));
    const { holder, key } = all[Math.floor(rnd() * all.length)]!;
    const kind = rnd();
    if (kind < 0.3) delete holder[key];
    else if (kind < 0.85) holder[key] = JUNK[Math.floor(rnd() * JUNK.length)];
    else {
      // Verweis vertauschen: den Wert einer anderen Stelle hierher kopieren.
      const other = all[Math.floor(rnd() * all.length)]!;
      holder[key] = structuredClone(other.holder[other.key]);
    }
  }
  return raw;
}

describe('Verstümmelte Backups', () => {
  it('werden nie zum Absturz und ergeben immer einen gültigen, einspielbaren Stand', async () => {
    for (let seed = 1; seed <= 160; seed++) {
      const raw = mutate(seed);
      let result;
      try {
        result = previewV157Backup(raw);
      } catch (error) {
        throw new Error(`Durchlauf ${seed}: Import brach ab – ${String(error)}`);
      }
      for (const name of COLLECTION_NAMES)
        for (const [key, doc] of Object.entries(result.data[name])) {
          const parsed = COLLECTION_SCHEMAS[name].safeParse(doc);
          if (!parsed.success || parsed.data.id !== key)
            throw new Error(`Durchlauf ${seed}: ungültiges Dokument ${name}/${key}`);
        }
      for (const line of result.report) expect(line, `Durchlauf ${seed}`).toMatch(/[.!]$/);
      const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
      try {
        db.replaceAll(result.data);
      } catch (error) {
        throw new Error(`Durchlauf ${seed}: Einspielen scheiterte – ${String(error)}`);
      }
      db.close();
    }
  });
});
