import { describe, expect, it } from 'vitest';
import { createMount } from '../../domain/schema';
import { meansDraft, meansInputOf, readNumber } from './model';

describe('Das Formular eines Fortbewegungsmittels', () => {
  it('liest Zahlen mit Komma und lässt Leeres leer', () => {
    expect(readNumber('1,5')).toBe(1.5);
    expect(readNumber(' ')).toBeNull();
    expect(readNumber('viel')).toBeUndefined();
    expect(readNumber('-2')).toBeUndefined();
  });

  it('gibt die Werte zurück, wie sie eingetragen wurden', () => {
    const seewind = createMount({
      name: 'Seewind',
      kind: 'ship',
      pace: 2.5,
      crew: 20,
      upkeep: 0.5,
      cargo: 0.5,
    });
    const draft = meansDraft(seewind);
    expect([draft.pace, draft.crew, draft.upkeep, draft.cargo]).toEqual([
      '2,5',
      '20',
      '5 SM',
      '0,5',
    ]);
    const result = meansInputOf(draft);
    expect(result).toMatchObject({
      input: { name: 'Seewind', kind: 'ship', pace: 2.5, crew: 20, upkeep: 0.5, cargo: 0.5 },
    });
  });

  it('nennt, was keine Zahl ist', () => {
    const draft = { ...meansDraft(), name: 'Maultier', pace: 'schnell', crew: 'zwei' };
    expect(meansInputOf(draft)).toEqual({ problem: 'Tempo und Besatzung sind keine Zahlen.' });
    expect(meansInputOf({ ...meansDraft(), name: 'Maultier', upkeep: 'Futter' })).toEqual({
      problem: 'Unterhalt ist keine Zahl.',
    });
    expect(meansInputOf(meansDraft())).toEqual({ problem: 'Wie heißt es?' });
    // Ein Tempo von null heißt: im Tempo der Gruppe.
    expect(meansInputOf({ ...meansDraft(), name: 'Pony', pace: '0' })).toMatchObject({
      input: { pace: null },
    });
  });
});
