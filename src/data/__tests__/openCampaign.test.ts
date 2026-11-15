import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../db';
import { SyncInterruptedError, openCampaign } from '../openCampaign';
import { SyncFailure } from '../platform';
import { elarisCampaign } from '../seed';
import { MemoryStore } from '../store';

describe('Kampagne öffnen', () => {
  it('bringt erst einen liegenden Merkzettel zu Ende, dann wird geöffnet', async () => {
    const store = new MemoryStore();
    await CampaignDb.create(store, elarisCampaign());
    const order: string[] = [];
    const db = await openCampaign('/kampagne', {
      recover: async () => {
        order.push('recover');
        return { finished: 3, left: [] };
      },
      open: async () => {
        order.push('open');
        return CampaignDb.open(store);
      },
    });
    expect(order).toEqual(['recover', 'open']);
    expect(db.getSnapshot().campaign.name).toBeTruthy();
  });

  it('bleibt ein Merkzettel liegen, wird nicht geöffnet', async () => {
    let opened = false;
    const open = async () => {
      opened = true;
      return CampaignDb.open(new MemoryStore());
    };
    await expect(
      openCampaign('/kampagne', {
        recover: async () => ({ finished: 1, left: [{ path: 'state.json', sha: 'abc' }] }),
        open,
      }),
    ).rejects.toBeInstanceOf(SyncInterruptedError);
    await expect(
      openCampaign('/kampagne', {
        recover: async () => {
          throw new SyncFailure('local', 'Der Merkzettel passt nicht.');
        },
        open,
      }),
    ).rejects.toBeInstanceOf(SyncInterruptedError);
    expect(opened).toBe(false);
  });
});
