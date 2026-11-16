import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ATTITUDES,
  ATTITUDE_MAX,
  ATTITUDE_MIN,
  attitudeLabel,
  attitudeLevel,
  attitudeOpen,
  attitudeToken,
  choiceById,
  holdsAttitude,
  presetType,
  RELATION_TYPES,
  relationChoices,
  relationLabel,
  showsAttitude,
  shownAttitude,
  typeOrder,
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

describe('Beziehungen nach Art', () => {
  it('kennt Haltung nur bei Wesen und Gruppen – Eingetragenes bleibt sichtbar', () => {
    for (const kind of ['person', 'faction', 'family', 'character', 'party'])
      expect(holdsAttitude(kind)).toBe(true);
    for (const kind of ['place', 'item', 'language', 'plant', 'topic', null])
      expect(holdsAttitude(kind)).toBe(false);
    expect(showsAttitude('place', null)).toBe(false);
    expect(showsAttitude('place', -2)).toBe(true);
    expect(showsAttitude('family', null)).toBe(true);
    expect(shownAttitude('item', null)).toBeUndefined();
    expect(shownAttitude('person', undefined)).toBeNull();
    expect(shownAttitude('place', 3)).toBe(3);
    // Die Skala steht nur zwischen zweien offen, die eine Haltung haben können.
    expect(attitudeOpen('faction', 'person')).toBe(true);
    expect(attitudeOpen('person', 'party')).toBe(true);
    expect(attitudeOpen('faction', 'place')).toBe(false);
    expect(attitudeOpen('place', 'party')).toBe(false);
  });

  it('schlägt zwischen Orten Orts-Beziehungen vor, nie „kennt“', () => {
    const choices = relationChoices('place', 'place');
    expect(choices.preset.id).toBe('borders');
    expect(choices.fitting.map((c) => c.label)).toEqual(
      expect.arrayContaining(['grenzt an', 'treibt Handel mit', 'wird beherrscht von', 'gehört']),
    );
    expect(choices.inPlaceField).toBe(true);
    expect(choices.fitting.some((c) => c.type === 'knows')).toBe(false);
  });

  it('liest „beherrscht von“, „gehört“, „wichtig für“ vom Ort aus – rückwärts gespeichert', () => {
    const choices = relationChoices('place', 'faction');
    expect(choices.preset).toMatchObject({
      type: 'rules',
      reverse: true,
      label: 'wird beherrscht von',
    });
    expect(choices.fitting.map((c) => c.label)).toEqual([
      'wird beherrscht von',
      'gehört',
      'ist Sitz von',
      'ist wichtig für',
      'treibt Handel mit',
    ]);
    expect(relationChoices('faction', 'place').preset).toMatchObject({
      type: 'rules',
      reverse: false,
    });
  });

  it('beginnt zwischen Personen mit Freundschaft und Verwandtschaft, bei Mitgliedern mit „gehört zu“', () => {
    const people = relationChoices('person', 'person').fitting.map((c) => c.type);
    expect(people.slice(0, 3)).toEqual(['friend', 'lover', 'family']);
    expect(relationChoices('person', 'faction').preset.type).toBe('member');
    expect(relationChoices('faction', 'person').preset).toMatchObject({
      type: 'member',
      reverse: true,
    });
    expect(relationChoices('person', 'language').preset.type).toBe('speaks');
  });

  it('filtert nie weg: jede Art steht passend oder unter „Weitere“', () => {
    for (const [a, b] of [
      ['place', 'place'],
      ['place', 'person'],
      ['item', 'topic'],
      ['person', 'party'],
    ] as const) {
      const { fitting, more } = relationChoices(a, b);
      const forward = new Set([...fitting, ...more].map((c) => c.type));
      for (const type of RELATION_TYPES)
        if (type.key !== 'custom') expect(forward.has(type.key)).toBe(true);
    }
    expect(relationChoices('item', 'topic').preset.id).toBe('custom');
    expect(relationChoices('place', 'party').fitting).toEqual([]);
  });

  it('gibt Gleichlautendes nur vorwärts und findet Wahlen über ihre Kennung', () => {
    expect(choiceById('~borders').id).toBe('custom');
    expect(choiceById('~owns')).toMatchObject({ type: 'owns', reverse: true, label: 'gehört' });
    expect(presetType('place', 'person')).toBe('seat-of');
    expect(presetType('item', 'topic')).toBe('custom');
    expect(typeOrder('person', 'faction').fitting[0]).toBe('member');
    expect(relationLabel({ type: 'resides', label: '' }, 'to')).toBe('ist wichtig für');
  });
});
