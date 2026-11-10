import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ATTITUDES,
  ATTITUDE_MAX,
  ATTITUDE_MIN,
  attitudeLabel,
  attitudeLevel,
  attitudeToken,
} from '../relations';
import { RelationSchema } from '../schema';

describe('Haltungsskala', () => {
  it('hat elf lückenlose Stufen von Todfeind bis Ergeben mit neutraler Mitte', () => {
    expect(ATTITUDES.map((a) => a.value)).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
    expect(ATTITUDES[0]!.value).toBe(ATTITUDE_MIN);
    expect(ATTITUDES[ATTITUDES.length - 1]!.value).toBe(ATTITUDE_MAX);
    expect(attitudeLabel(-5)).toBe('Todfeind');
    expect(attitudeLabel(0)).toBe('Neutral');
    expect(attitudeLabel(5)).toBe('Ergeben');
    expect(attitudeLabel(null)).toBe('Unbekannt');
  });

  it('benennt jede Stufe eindeutig und erklärt sie in einem Satz', () => {
    expect(new Set(ATTITUDES.map((a) => a.label)).size).toBe(ATTITUDES.length);
    for (const level of ATTITUDES) {
      expect(level.hint).toMatch(/^[A-ZÄÖÜ].{20,}\.$/);
      expect(level.label).not.toContain(' ');
    }
  });

  it('ordnet nach Regelwerk: feindselig, gleichgültig, freundlich – ohne Sprünge', () => {
    expect(ATTITUDES.map((a) => a.rules[0]).join('')).toBe('hhhhiiiffff');
    expect(attitudeLevel(-2)!.rules).toBe('hostile');
    expect(attitudeLevel(1)!.rules).toBe('indifferent');
    expect(attitudeLevel(2)!.rules).toBe('friendly');
  });

  it('hat für jede Stufe eine Farbe im Designsystem', () => {
    const tokens = readFileSync(new URL('../../ui/tokens.css', import.meta.url), 'utf8');
    for (const level of ATTITUDES) expect(tokens).toContain(`${attitudeToken(level.value)}:`);
    expect(attitudeToken(-5)).toBe('--att-n5');
    expect(attitudeToken(0)).toBe('--att-0');
    expect(attitudeToken(4)).toBe('--att-p4');
  });

  it('wird vom Datenmodell genau in diesen Grenzen angenommen', () => {
    const relation = (attitude: number) =>
      RelationSchema.safeParse({ id: 'r1', from: 'a', to: 'b', attitude }).success;
    expect(relation(-5)).toBe(true);
    expect(relation(5)).toBe(true);
    expect(relation(-6)).toBe(false);
    expect(relation(6)).toBe(false);
  });
});
