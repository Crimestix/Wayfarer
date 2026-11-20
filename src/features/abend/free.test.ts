/** F21: Das Abendblatt ist frei; Fächer stehen da, wenn sie etwas tragen. */
import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { prepView, sectionFilled } from '../../domain/prep';
import { patchPrep } from './actions';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  return { db, data: () => db.getSnapshot() };
}

describe('F21: freie Vorbereitung', () => {
  it('ohne Führung als Vorgabe; der freie Text wird gespeichert', async () => {
    const { db, data } = await setup();
    expect(data().campaign.prepGuide).toBe(false);
    patchPrep(db, { text: 'Erst die Fähre, dann der Nebel.' }, 'next');
    expect(prepView(data(), 'next').content.text).toBe('Erst die Fähre, dann der Nebel.');
  });

  it('ein Fach gilt als gefüllt, sobald etwas darin steht', async () => {
    const { db, data } = await setup();
    const empty = prepView(data(), 'next').content;
    expect(sectionFilled(data(), empty, 'start')).toBe(false);
    patchPrep(db, { start: 'Ein Schrei vom Steg.' }, 'next');
    expect(sectionFilled(data(), prepView(data(), 'next').content, 'start')).toBe(true);
  });
});
