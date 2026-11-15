import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  COLLECTION_SCHEMAS,
  CampaignMetaSchema,
  DATA_SHAPE,
  DATA_VERSION,
  PlayStateSchema,
} from '../schema';

/** Schlüssel sortiert, damit die Reihenfolge im Code den Fingerabdruck nicht ändert. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
    );
  return value;
}

/** Der Fingerabdruck der Gestalt aller Daten, die abgeglichen werden. */
function dataShape(): string {
  const all: Record<string, unknown> = {
    campaign: z.toJSONSchema(CampaignMetaSchema, { unrepresentable: 'any' }),
    state: z.toJSONSchema(PlayStateSchema, { unrepresentable: 'any' }),
  };
  for (const [name, schema] of Object.entries(COLLECTION_SCHEMAS))
    all[name] = z.toJSONSchema(schema, { unrepresentable: 'any' });
  return createHash('sha256')
    .update(JSON.stringify(sorted(all)))
    .digest('hex')
    .slice(0, 16);
}

describe('Datenstand', () => {
  it('der Fingerabdruck der Schemata passt zu DATA_SHAPE', () => {
    const shape = dataShape();
    expect(
      shape,
      `Die Gestalt der Daten hat sich geändert. DATA_VERSION (jetzt ${DATA_VERSION}) um eins erhöhen, ` +
        `DATA_SHAPE auf '${shape}' setzen und bei neuen Feldern in state.json/campaign.json die Regel ` +
        `in STATE_RULES/CAMPAIGN_RULES (domain/syncMerge.ts) prüfen.`,
    ).toBe(DATA_SHAPE);
    expect(Number.isInteger(DATA_VERSION) && DATA_VERSION >= 1).toBe(true);
  });
});
