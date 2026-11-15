import { describe, expect, it } from 'vitest';
import { recordEntry } from '../../data/record';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { patchPrep } from '../../features/abend/actions';
import { giveHandout, saveHandout } from '../../features/handouts/actions';
import { handoutSources, paragraphs, prepHintCards, sealMark } from '../handout';
import { secretOfText } from '../prep';
import { newId } from '../schema';

describe('Handouts', () => {
  it('teilt den Wortlaut in Absätze und kürzt das Siegel', () => {
    expect(paragraphs('An euch,\n\nkommt zum Anleger.\nAllein.\n\n\n')).toEqual([
      'An euch,',
      'kommt zum Anleger.\nAllein.',
    ]);
    expect(sealMark(' lfx ')).toBe('LF');
  });

  it('kennt Schriftstücke der Chronik und Hinweiskarten vom Abend-Blatt', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const recorded = recordEntry(db, {
      kind: 'writing',
      text: 'Wartet am Anleger, wenn die Glocke zweimal schlägt.\n— L. F.',
      writing: { title: 'Botschaft vom Fährmann' },
    });
    expect('entry' in recorded).toBe(true);
    expect(handoutSources(db.getSnapshot())[0]).toMatchObject({
      title: 'Botschaft vom Fährmann',
      from: 'Schriftstück aus der Chronik',
    });
    patchPrep(db, {
      secrets: [
        {
          id: newId(),
          text: 'Der Fährmann schmuggelt Salz.',
          storyId: null,
          revealed: false,
          revealedAt: null,
          hint: null,
          carried: 0,
        },
        { ...secretOfText('Schon bekannt.'), revealed: true },
      ],
    });
    expect(prepHintCards(db.getSnapshot()).map((card) => card.text)).toEqual([
      'Der Fährmann schmuggelt Salz.',
    ]);
  });

  it('übergibt ein Handout mit Zeile in der Mitschrift – und nimmt es zurück', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const handout = saveHandout(db, {
      kind: 'letter',
      title: 'Brief an die Gruppe',
      text: 'Kommt.',
    });
    const undo = giveHandout(db, handout.id)!;
    const given = db.getSnapshot().handouts[handout.id]!;
    expect(given.givenAt).toBe(db.getSnapshot().state.now);
    expect(db.getSnapshot().chronicle[given.chronicleId!]!.text).toBe(
      'Brief übergeben: Brief an die Gruppe',
    );
    expect(giveHandout(db, handout.id)).toBeNull();
    undo();
    expect(db.getSnapshot().handouts[handout.id]!.givenAt).toBeNull();
    expect(db.getSnapshot().chronicle[given.chronicleId!]).toBeUndefined();
  });
});
