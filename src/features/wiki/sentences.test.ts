import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import type { CampaignData } from '../../domain/schema';
import { lkExportFixture } from './__fixtures__/lkExport';
import { acceptHint, dismissHint, savePageText } from './actions';
import { planLkImport } from './apply';
import { convertLkExport } from './lkexport';
import { relationHints } from './sentences';

const imported = (): CampaignData =>
  planLkImport(elarisCampaign(), convertLkExport(lkExportFixture())).data;

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), imported());
  const data = () => db.getSnapshot();
  const write = (articleId: string, text: string) =>
    savePageText(db, articleId, data().articles[articleId]!.docs[0]!.id, text);
  /** Die Vorschläge eines Artikels als „Von – Art – Zu“. */
  const hints = (articleId: string) => {
    const article = data().articles[articleId]!;
    const owner = Object.values(data().entities).find((e) => e.lk?.resourceId === articleId);
    return relationHints(data(), article, owner);
  };
  const shown = (articleId: string) =>
    hints(articleId).map((hint) => `${hint.from.name} – ${hint.type} – ${hint.to.name}`);
  return { db, data, write, hints, shown };
}

describe('Beziehungen aus Sätzen', () => {
  it('liest, was unmittelbar vor einem bekannten Namen steht', async () => {
    const { write, shown } = await setup();
    write(
      'vera0001',
      [
        // Kein Subjekt im Satz: Die Aussage gilt dem Eintrag des Artikels.
        'Sie ist die Schwester von Jost Reuse und arbeitet für [[Die Aalfischer]].',
        // Subjekt und Objekt im selben Satz.
        'Jost Reuse dient dem alten Odo Tannhaus seit Jahren.',
        'Vera lebt in Hohenfurt.',
        // Namen in einer Liste.
        '- Schülerin von Mira Tannhaus',
        '- Mitglied der Aalfischer',
      ].join('\n\n'),
    );
    expect(shown('vera0001')).toEqual([
      'Vera Kohl – family – Jost Reuse',
      // „arbeitet für“: Die Fraktion beschäftigt sie.
      'Die Aalfischer – employs – Vera Kohl',
      'Jost Reuse – serves – Odo Tannhaus',
      'Vera Kohl – home – Hohenfurt',
      // „Schülerin von“: Mira lehrt.
      'Mira Tannhaus – mentor – Vera Kohl',
      'Vera Kohl – member – Die Aalfischer',
    ]);
  });

  it('liest nichts aus Verneintem, Vergangenem und Vermutetem', async () => {
    const { write, shown } = await setup();
    write(
      'vera0001',
      [
        'Sie ist nicht die Schwester von Jost Reuse.',
        'Früher war sie befreundet mit Mira Tannhaus.',
        'Angeblich dient sie Odo Tannhaus.',
        // Das Schlüsselwort steht nicht unmittelbar vor dem Namen.
        'Sie dient treu, doch Odo Tannhaus weiß nichts davon.',
        // Art des Eintrags passt nicht: Man ist nicht die Schwester einer Stadt.
        'Sie ist die Schwester von Hohenfurt.',
        // Das Subjekt steht hinter dem Verb – wer hier wen fürchtet, sagt die Wortstellung nicht.
        'Im Hafen fürchtet Jost Reuse niemanden.',
      ].join('\n\n'),
    );
    expect(shown('vera0001')).toEqual([]);
  });

  it('liest bloße Verben nur, wenn der Satz vom Eintrag spricht', async () => {
    const { write, shown } = await setup();
    write(
      'vera0001',
      'Vera führt die Aalfischer. Sie hasst Odo Tannhaus. Heimlich jagt Mira Tannhaus.',
    );
    expect(shown('vera0001')).toEqual([
      'Vera Kohl – leads – Die Aalfischer',
      'Vera Kohl – enemy – Odo Tannhaus',
    ]);
  });

  it('zeigt nicht, was schon in der Welt steht oder abgelehnt wurde', async () => {
    const { db, data, write, hints, shown } = await setup();
    // Mira und Odo sind seit der Übernahme befreundet; Odo gehört zu den Aalfischern.
    write(
      'mira0001',
      'Sie ist befreundet mit Odo Tannhaus. Odo Tannhaus ist Mitglied der Aalfischer. Sie fürchtet Jost Reuse.',
    );
    expect(shown('mira0001')).toEqual(['Mira Tannhaus – fears – Jost Reuse']);

    // Zustimmen trägt die Beziehung ein; danach ist der Vorschlag weg.
    const [hint] = hints('mira0001');
    const undo = acceptHint(db, hint!);
    expect(
      Object.values(data().relations).some(
        (r) => r.type === 'fears' && r.from === 'lk-mira0001' && r.to === 'lk-jost0001',
      ),
    ).toBe(true);
    expect(shown('mira0001')).toEqual([]);
    undo();
    expect(shown('mira0001')).toEqual(['Mira Tannhaus – fears – Jost Reuse']);

    // Ablehnen merkt sich der Artikel.
    const back = dismissHint(db, 'mira0001', hint!.key);
    expect(shown('mira0001')).toEqual([]);
    expect(data().articles.mira0001!.dismissedHints).toEqual([hint!.key]);
    back();
    expect(shown('mira0001')).toHaveLength(1);
  });

  it('setzt mit „lebt in“ das Zuhause, wenn noch keines eingetragen ist', async () => {
    const { db, data, write, hints, shown } = await setup();
    write('vera0001', 'Vera wohnt im Hafenviertel. Mira Tannhaus lebt in Hohenfurt.');
    // Mira hat schon ein Zuhause; Vera noch nicht.
    expect(shown('vera0001')).toEqual(['Vera Kohl – home – Hafenviertel']);
    const undo = acceptHint(db, hints('vera0001')[0]!);
    expect(data().entities['lk-vera0001']).toMatchObject({ person: { homeId: 'lk-hafen001' } });
    undo();
    expect(data().entities['lk-vera0001']).toMatchObject({ person: { homeId: null } });
  });
});
