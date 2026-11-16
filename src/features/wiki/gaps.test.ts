import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity, type Entity } from '../../domain/schema';
import { adoptArticle, createArticle } from './actions';
import { STUB_WORDS, gapCount, groupByKind, newArticleParent, wikiGaps } from './gaps';

const LONG = Array.from({ length: STUB_WORDS + 5 }, (_, i) => `Wort${i}`).join(' ');

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const data = () => db.getSnapshot();
  const write = (title: string, text: string, parentId: string | null = null) =>
    createArticle(db, { title, text, parentId })!;
  const add = <E extends Entity>(entity: E): E => db.put('entities', entity) as E;
  return { db, data, write, add };
}

describe('Noch zu schreiben: Verweise ins Leere', () => {
  it('zählt je Titel, wie oft und wo verwiesen wird – am häufigsten zuerst', async () => {
    const { data, write } = await setup();
    write(
      'Hohenfurt',
      `Am Fluss liegt die [[Salzgrotte]]. ${LONG}\n\nDie [[salzgrotte]] ist tief.`,
    );
    write('Mira Tannhaus', `Mira kennt die [[Salzgrotte|Grotte]] und [[Burg Graufels]]. ${LONG}`);
    write('Odo Tannhaus', `Odo war nie in [[Burg Graufels~abc]]. ${LONG}`);
    write('Lando Furtner', `Lando wohnt am [[Nebelsteg]]. ${LONG}\n\n\`\`\`\n[[Im Code]]\n\`\`\``);
    const gaps = wikiGaps(data());
    expect(gaps.missing.map((m) => [m.title, m.count, m.mentions.length])).toEqual([
      ['Salzgrotte', 3, 2],
      ['Burg Graufels', 2, 2],
      ['Nebelsteg', 1, 1],
    ]);
    const grotte = gaps.missing[0]!;
    expect(grotte.mentions.map((m) => [m.title, m.count])).toEqual([
      ['Hohenfurt', 2],
      ['Mira Tannhaus', 1],
    ]);
    expect(grotte.mentions[1]!.snippet).toContain('Mira kennt die Grotte');
    // Gibt es den Artikel, ist die Lücke geschlossen.
    write('Salzgrotte', LONG);
    expect(wikiGaps(data()).missing.map((m) => m.title)).not.toContain('Salzgrotte');
  });

  it('liest die Art aus dem Feld des Steckbriefs, in dem der Verweis steht', async () => {
    const { db, data, write } = await setup();
    const mira = write(
      'Mira Tannhaus',
      `> [!steckbrief]\n> Wohnort: [[Hohenfurt]]\n> Fraktion: [[Fährgilde]]\n\n${LONG}`,
    );
    adoptArticle(db, mira, 'person');
    write('Notiz', `Irgendwo: [[Hohenfurt]]. ${LONG}`);
    const gaps = wikiGaps(data());
    expect(gaps.missing.find((m) => m.title === 'Hohenfurt')?.kinds).toEqual(['place']);
    expect(gaps.missing.find((m) => m.title === 'Fährgilde')?.kinds).toEqual(['faction', 'family']);
  });
});

describe('Noch zu schreiben: Einträge ohne Artikel', () => {
  it('stehen getrennt – erwähnte zuerst, Gefährten und Räume nicht', async () => {
    const { data, write, add } = await setup();
    const brann = add(createEntity({ kind: 'person', name: 'Brann Eichwald' }));
    const ilka = add(createEntity({ kind: 'person', name: 'Ilka Sturmfels' }));
    const burg = add(createEntity({ kind: 'place', name: 'Burg Graufels' }));
    add(createEntity({ kind: 'place', name: 'Halle', place: { room: true, parentId: burg.id } }));
    write('Hohenfurt', `Hier schmiedet [[Brann Eichwald]]. ${LONG}`);
    const gaps = wikiGaps(data());
    expect(gaps.missing).toEqual([]);
    const names = gaps.entries.map((entry) => [entry.entity.id, entry.count]);
    expect(names[0]).toEqual([brann.id, 1]);
    expect(names.map(([id]) => id)).toContain(ilka.id);
    expect(gaps.entries.some((e) => e.entity.kind === 'character')).toBe(false);
    expect(gaps.entries.some((e) => e.entity.name === 'Halle')).toBe(false);
    // Die Zahl zählt nur Erwähntes: Brann und Hohenfurt ist kein Stummel.
    expect(gapCount(gaps)).toBe(1);
  });

  it('verschwinden, sobald der Eintrag einen Artikel hat', async () => {
    const { data, write, add } = await setup();
    add(createEntity({ kind: 'person', name: 'Lando Furtner' }));
    write('Lando Furtner', LONG);
    expect(wikiGaps(data()).entries.map((e) => e.entity.name)).not.toContain('Lando Furtner');
  });
});

describe('Noch zu schreiben: Waisen und Stummel', () => {
  it('findet Artikel, auf die nichts verweist – ohne Ordnerseiten und Vorlagen', async () => {
    const { db, data, write } = await setup();
    const orte = write('Orte', '');
    write('Hohenfurt', `Die Stadt am Fluss. ${LONG}`, orte.id);
    write('Salzgrotte', `Nahe [[Hohenfurt]]. ${LONG}`, orte.id);
    const vorlage = write('Vorlage Ort', '');
    db.put('articles', { ...data().articles[vorlage.id]!, template: true });
    const gaps = wikiGaps(data());
    expect(gaps.orphans.map((a) => a.title)).toEqual(['Salzgrotte']);
  });

  it('findet sehr kurze Artikel; der Steckbrief zählt nicht mit', async () => {
    const { data, write } = await setup();
    write('Hohenfurt', `> [!steckbrief]\n> Art: Stadt\n> Liegt in: Talmark\n\nEine Stadt.`);
    write('Odo Tannhaus', 'Fährmann. [[Hohenfurt]] [[Mira Tannhaus]]');
    write('Mira Tannhaus', LONG);
    const gaps = wikiGaps(data());
    expect(gaps.stubs.map((s) => [s.article.title, s.words, s.mentionedBy])).toEqual([
      ['Hohenfurt', 2, 1],
      ['Odo Tannhaus', 4, 0],
    ]);
    expect(gapCount(gaps)).toBe(2);
  });
});

describe('Wo ein neuer Artikel hingehört', () => {
  it('in den Ordner der Art, sonst neben den, der ihn erwähnt', async () => {
    const { data, write } = await setup();
    const orte = write('Orte', '');
    const personen = write('Personen', '');
    const mira = write('Mira Tannhaus', 'Text', personen.id);
    expect(newArticleParent(data().articles, 'place', [mira.id])?.id).toBe(orte.id);
    expect(newArticleParent(data().articles, 'item', [mira.id])?.id).toBe(personen.id);
    expect(newArticleParent(data().articles, null, [])).toBeNull();
  });
});

describe('Noch zu schreiben nach Art', () => {
  it('teilt nach Art in fester Reihenfolge, ohne Art zuletzt, und behält die Reihenfolge darin', () => {
    const items = [
      { name: 'Mira', kind: 'person' as const },
      { name: 'Grotte', kind: null },
      { name: 'Hohenfurt', kind: 'place' as const },
      { name: 'Odo', kind: 'person' as const },
    ];
    const groups = groupByKind(items, (item) => item.kind);
    expect(groups.map((g) => g.kind)).toEqual(['place', 'person', null]);
    expect(groups[1]!.items.map((i) => i.name)).toEqual(['Mira', 'Odo']);
  });
});
