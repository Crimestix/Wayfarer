import { describe, expect, it } from 'vitest';
import { PARTY_ID, createEntity, createRelation, type Character } from '../../../domain/schema';
import { demoCampaign } from '../../../data/seed';
import {
  CONDITIONS,
  addLanguages,
  characterBonds,
  classLine,
  clickExhaustionMark,
  conditionRule,
  draftFromCharacter,
  effectiveSpeed,
  emptyDraft,
  exhaustionEffect,
  exhaustionText,
  fitWithin,
  joinNames,
  lacksValues,
  longRestChanges,
  longRestText,
  parseDraft,
  partySummary,
  removeLanguage,
  sheetHref,
  soleLanguages,
  sortConditions,
  toggleCondition,
} from '../model';

const hero = (name: string, details: Partial<Character['character']> = {}): Character =>
  createEntity({ kind: 'character', name, character: details });

describe('Erschöpfung', () => {
  it('kostet je Stufe 2 auf W20-Prüfungen und 5 Fuß Bewegungsrate', () => {
    expect(exhaustionEffect(0)).toEqual({ level: 0, d20: 0, speed: 0, dead: false });
    expect(exhaustionEffect(3)).toEqual({ level: 3, d20: -6, speed: -15, dead: false });
    expect(exhaustionEffect(6).dead).toBe(true);
    expect(exhaustionEffect(9).level).toBe(6);
    expect(exhaustionEffect(-2).level).toBe(0);
  });

  it('beschreibt die Auswirkung in Worten', () => {
    expect(exhaustionText(0)).toBe('nicht erschöpft');
    expect(exhaustionText(2)).toBe('−4 auf W20-Prüfungen, −10 Fuß');
    expect(exhaustionText(2, true)).toBe('−4 auf W20-Prüfungen, −10 Fuß Bewegungsrate');
    expect(exhaustionText(6)).toContain('stirbt');
  });

  it('setzt per Klick die Stufe und nimmt sie beim zweiten Klick zurück', () => {
    expect(clickExhaustionMark(0, 3)).toBe(3);
    expect(clickExhaustionMark(3, 3)).toBe(2);
    expect(clickExhaustionMark(3, 1)).toBe(1);
    expect(clickExhaustionMark(1, 1)).toBe(0);
    expect(clickExhaustionMark(5, 6)).toBe(6);
  });

  it('senkt die Bewegungsrate, aber nie unter 0', () => {
    expect(effectiveSpeed({ speed: 30, exhaustion: 2 })).toBe(20);
    expect(effectiveSpeed({ speed: 10, exhaustion: 4 })).toBe(0);
  });
});

describe('Zustände', () => {
  it('kennt die vierzehn Zustände mit Regeltext', () => {
    expect(CONDITIONS).toHaveLength(14);
    expect(new Set(CONDITIONS.map((c) => c.name)).size).toBe(14);
    for (const c of CONDITIONS) expect(c.rule.length).toBeGreaterThan(10);
    expect(conditionRule('vergiftet')).toContain('Nachteil');
    expect(conditionRule('Verflucht')).toBe('');
  });

  it('schaltet an und aus und hält die Reihenfolge der Regelliste', () => {
    let list = toggleCondition([], 'Vergiftet');
    list = toggleCondition(list, 'Blind');
    list = toggleCondition(list, 'Verflucht');
    expect(list).toEqual(['Blind', 'Vergiftet', 'Verflucht']);
    expect(toggleCondition(list, 'blind')).toEqual(['Vergiftet', 'Verflucht']);
  });

  it('räumt Doppelte und Leeres auf', () => {
    expect(sortConditions(['vergiftet', ' ', 'Vergiftet', 'Taub'])).toEqual(['Taub', 'Vergiftet']);
  });
});

describe('Sprachen', () => {
  it('nimmt mehrere auf einmal auf und überspringt Vorhandenes', () => {
    expect(addLanguages(['Gemeinsprache'], 'Elfisch,  zwergisch; gemeinsprache,,')).toEqual([
      'Gemeinsprache',
      'Elfisch',
      'zwergisch',
    ]);
    expect(removeLanguage(['Gemeinsprache', 'Elfisch'], 'ELFISCH')).toEqual(['Gemeinsprache']);
  });
});

describe('Kennzahlen der Gruppe', () => {
  const party = [
    hero('Tomlin', { speed: 25, passivePerception: 12, languages: ['Gemeinsprache', 'Zwergisch'], level: 5 }),
    hero('Naelmira', { speed: 30, passivePerception: 17, languages: ['Gemeinsprache', 'Elfisch', 'Sylvanisch'], level: 5 }),
    hero('Neil', { speed: 30, passivePerception: 12, languages: ['gemeinsprache', 'Elfisch'], exhaustion: 2, level: 4 }),
    hero('Corrin', { speed: 30, languages: ['Gemeinsprache'], exhaustion: 2, level: 5 }),
  ];
  const summary = partySummary(party);

  it('zählt und nennt die Stufen', () => {
    expect(summary.count).toBe(4);
    expect(summary.levels).toEqual({ min: 4, max: 5 });
  });

  it('findet die langsamste Bewegungsrate – Erschöpfung eingerechnet', () => {
    // Neil und Corrin: 30 − 10 = 20 Fuß, langsamer als Tomlin mit 25.
    expect(summary.slowest).toEqual({ value: 20, names: ['Corrin', 'Neil'] });
  });

  it('nennt niedrigste und höchste passive Wahrnehmung und wer keinen Wert hat', () => {
    expect(summary.perception?.lowest).toEqual({ value: 12, names: ['Neil', 'Tomlin'] });
    expect(summary.perception?.highest).toEqual({ value: 17, names: ['Naelmira'] });
    expect(summary.perception?.missing).toEqual(['Corrin']);
  });

  it('trennt gemeinsame Sprachen von denen, die nur einzelne sprechen', () => {
    expect(summary.commonLanguages).toEqual(['Gemeinsprache']);
    expect(summary.partialLanguages).toEqual([
      { language: 'Elfisch', speakers: ['Naelmira', 'Neil'] },
      { language: 'Sylvanisch', speakers: ['Naelmira'] },
      { language: 'Zwergisch', speakers: ['Tomlin'] },
    ]);
    expect(soleLanguages(summary, 'Naelmira')).toEqual(['Sylvanisch']);
    expect(soleLanguages(summary, 'Neil')).toEqual([]);
  });

  it('nennt die höchste Erschöpfung', () => {
    expect(summary.exhaustion).toEqual({ value: 2, names: ['Corrin', 'Neil'] });
    expect(summary.exhaustedCount).toBe(2);
    expect(partySummary([hero('A')]).exhaustion).toBeNull();
  });

  it('kommt mit einer leeren Gruppe zurecht', () => {
    const empty = partySummary([]);
    expect(empty).toMatchObject({
      count: 0,
      levels: null,
      slowest: null,
      perception: null,
      commonLanguages: [],
      partialLanguages: [],
      exhaustion: null,
    });
  });

  it('zählt, wer abseits der Gruppe ist', () => {
    expect(partySummary([hero('A', { placeId: 'ort1' }), hero('B')]).away).toEqual(['A']);
  });

  it('reiht Namen lesbar auf', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A und B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B und C');
  });
});

describe('Lange Rast', () => {
  it('senkt die Erschöpfung aktiver Gefährten um 1', () => {
    const party = [
      hero('Tomlin', { exhaustion: 1 }),
      hero('Corrin', { exhaustion: 3 }),
      hero('Neil'),
      hero('Fern', { exhaustion: 2, active: false }),
    ];
    const changes = longRestChanges(party);
    expect(changes.map(({ name, before, after }) => ({ name, before, after }))).toEqual([
      { name: 'Corrin', before: 3, after: 2 },
      { name: 'Tomlin', before: 1, after: 0 },
    ]);
    expect(longRestText(changes)).toBe(
      'Lange Rast abgeschlossen. Erschöpfung um 1 gesenkt: Corrin noch Stufe 2, Tomlin ist wieder frisch.',
    );
    expect(longRestText([])).toBe('Lange Rast abgeschlossen. Niemand war erschöpft.');
  });
});

describe('Darstellung', () => {
  it('baut die Zeile aus Volk, Klasse und Stufe', () => {
    expect(classLine({ species: 'Elfin', className: 'Waldläuferin', level: 5 })).toBe('Elfin · Waldläuferin · Stufe 5');
    expect(classLine({ species: '', className: '', level: 1 })).toBe('Stufe 1');
  });

  it('erkennt Gefährten ohne eingetragene Werte', () => {
    expect(lacksValues(hero('Nex').character)).toBe(true);
    expect(lacksValues(hero('Nex', { armorClass: 15 }).character)).toBe(false);
  });

  it('öffnet nur echte Internetadressen', () => {
    expect(sheetHref('')).toBeNull();
    expect(sheetHref('dndbeyond.com/characters/123')).toBe('https://dndbeyond.com/characters/123');
    expect(sheetHref(' https://www.dndbeyond.com/characters/123 ')).toBe('https://www.dndbeyond.com/characters/123');
    expect(sheetHref('javascript:alert(1)')).toBeNull();
    expect(sheetHref('file:///etc/passwd')).toBeNull();
    expect(sheetHref('irgendwas')).toBeNull();
  });
});

describe('Beziehungen zu einem Gefährten', () => {
  it('fasst beide Richtungen je Gegenüber zusammen und lässt die Gruppe aus', () => {
    const data = demoCampaign();
    const tomlin = Object.values(data.entities).find((e) => e.name === 'Tomlin')!;
    const brann = Object.values(data.entities).find((e) => e.name === 'Brann Eisenhaken')!;
    const maera = Object.values(data.entities).find((e) => e.name === 'Maera Duskryn')!;
    const relations = [
      createRelation({ from: brann.id, to: tomlin.id, type: 'owes', attitude: 1 }),
      createRelation({ from: tomlin.id, to: brann.id, type: 'knows' }),
      createRelation({ from: maera.id, to: tomlin.id, type: 'seeks', ended: true }),
      createRelation({ from: tomlin.id, to: PARTY_ID, type: 'member' }),
    ];
    const next = { ...data, relations: { ...data.relations, ...Object.fromEntries(relations.map((r) => [r.id, r])) } };
    const bonds = characterBonds(next, tomlin.id);
    expect(bonds.map((b) => b.other.name)).toEqual(['Brann Eisenhaken', 'Maera Duskryn']);
    expect(bonds[0]!.incoming?.type).toBe('owes');
    expect(bonds[0]!.outgoing?.type).toBe('knows');
    expect(bonds[0]!.ended).toBe(false);
    expect(bonds[1]!.ended).toBe(true);
    expect(characterBonds(next, 'gibt-es-nicht')).toEqual([]);
  });
});

describe('Bearbeiten-Dialog', () => {
  it('übernimmt gültige Eingaben', () => {
    const result = parseDraft({
      ...emptyDraft(),
      name: '  Naelmira ',
      player: 'Jana',
      species: 'Elfin',
      className: 'Waldläuferin',
      level: '5',
      speed: '35',
      armorClass: '16',
      hpMax: '',
      passivePerception: '17',
      languages: ['Gemeinsprache', 'Elfisch', 'elfisch'],
      conditions: ['Vergiftet', 'Blind'],
      sheetUrl: 'dndbeyond.com/characters/1',
    });
    expect(result.errors).toEqual({});
    expect(result.value).toMatchObject({
      name: 'Naelmira',
      character: {
        player: 'Jana',
        level: 5,
        speed: 35,
        armorClass: 16,
        hpMax: null,
        passivePerception: 17,
        passiveInsight: null,
        languages: ['Gemeinsprache', 'Elfisch'],
        conditions: ['Blind', 'Vergiftet'],
        sheetUrl: 'https://dndbeyond.com/characters/1',
        active: true,
      },
    });
  });

  it('meldet fehlenden Namen und unmögliche Zahlen', () => {
    const result = parseDraft({
      ...emptyDraft(),
      name: ' ',
      level: '21',
      speed: '',
      armorClass: '-3',
      hpMax: 'viel',
      sheetUrl: 'javascript:alert(1)',
    });
    expect(result.value).toBeNull();
    expect(Object.keys(result.errors).sort()).toEqual(['armorClass', 'hpMax', 'level', 'name', 'sheetUrl', 'speed']);
  });

  it('füllt den Dialog aus einem vorhandenen Gefährten und zurück ohne Verlust', () => {
    const original = hero('Veres', {
      player: 'Max',
      className: 'Paladin',
      species: 'Mensch',
      level: 5,
      armorClass: 18,
      hpMax: 44,
      passivePerception: 11,
      passiveInsight: 13,
      passiveInvestigation: 9,
      languages: ['Gemeinsprache', 'Celestisch'],
      exhaustion: 1,
      conditions: ['Vergiftet'],
      active: false,
      sheetUrl: 'https://www.dndbeyond.com/characters/42',
    });
    const result = parseDraft(draftFromCharacter(original));
    expect(result.value?.name).toBe('Veres');
    expect(result.value?.character).toEqual(original.character);
  });
});

describe('Bild verkleinern', () => {
  it('begrenzt die längere Seite auf 512 und vergrößert nie', () => {
    expect(fitWithin(2048, 1024)).toEqual({ width: 512, height: 256 });
    expect(fitWithin(900, 1600)).toEqual({ width: 288, height: 512 });
    expect(fitWithin(300, 200)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(5000, 3)).toEqual({ width: 512, height: 1 });
  });
});
