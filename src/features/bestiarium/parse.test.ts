import { describe, expect, it } from 'vitest';
import { parseStatblock } from './parse';

/** Erfundene Wesen – im Satz der Bücher, aber aus keinem Buch. */
const GERMAN = `
Grubenschleicher
Kleiner Humanoider (Goblinoide), neutral böse
Rüstungsklasse 15 (Lederrüstung, Schild)
Trefferpunkte 9 (2W6 + 2)
Bewegungsrate 9 m, Klettern 6 m
STR GES KON INT WEI CHA
8 (−1) 14 (+2) 12 (+1) 10 (+0) 8 (−1) 8 (−1)
Fertigkeiten Heimlichkeit +6
Sinne Dunkelsicht 18 m, passive Wahrnehmung 9
Sprachen Gemeinsprache, Goblinisch
Herausforderungsgrad 1/4 (50 EP)
Flinke Flucht. Der Grubenschleicher kann in jedem seiner Züge als Bonusaktion die Aktion
Rückzug oder Verstecken ausführen.
Aktionen
Krummsäbel. Nahkampfwaffenangriff: +4 auf Treffer, Reichweite 1,5 m, ein Ziel. Treffer: 5 (1W6 + 2) Hiebschaden.
Kurzbogen. Fernkampfwaffenangriff: +4 auf Treffer, Reichweite 24/96 m, ein Ziel. Treffer: 5 (1W6 + 2) Stichschaden.
`;

const ENGLISH = `
Eel Warden
Large Monstrosity, Unaligned
AC 14 Initiative +2 (12)
HP 45 (6d10 + 12)
Speed 20 ft., Swim 40 ft.
Mod Save
Str 16 +3 +5
Dex 14 +2 +2
Con 15 +2 +2
Int 3 −4 −4
Wis 12 +1 +3
Cha 5 −3 −3
Skills Perception +3, Stealth +4
Resistances Cold
Senses Blindsight 30 ft.; Passive Perception 13
Languages None
CR 2 (XP 450; PB +2)
Traits
Amphibious. The warden can breathe air and water.
Actions
Multiattack. The warden makes two Bite attacks.
Bite. Melee Attack Roll: +5, reach 5 ft. Hit: 10 (2d6 + 3) Piercing damage plus 3 (1d6) Lightning damage.
Shock. Dexterity Saving Throw: DC 12, each creature in the water within 10 feet.
Bonus Actions
Slip Away. The warden moves up to half its Speed.
`;

/** So liefert D&D Beyond einen Block beim Kopieren: Bezeichnung und Wert auf eigenen Zeilen. */
const BEYOND = `
Moorhund
Medium Beast, Unaligned
Armor Class
13 (natural armor)
Hit Points
11 (2d8 + 2)
Speed
40 ft.
STR
13 (+1)
DEX
14 (+2)
CON
12 (+1)
INT
3 (-4)
WIS
12 (+1)
CHA
6 (-2)
Skills
Perception +3
Senses
Passive Perception 13
Languages
—
Challenge
1/4 (50 XP)
Keen Smell. The hound has advantage on Wisdom (Perception) checks that rely on smell.
Actions
Bite. Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4 + 2) piercing damage.
`;

describe('Statblock aus Text – deutsch, Satz von 2014', () => {
  const read = parseStatblock(GERMAN)!;

  it('liest Namen, Art und die Kopfzeilen', () => {
    expect(read.name).toBe('Grubenschleicher');
    expect(read.block).toMatchObject({
      size: 'small',
      type: 'Humanoider',
      tags: 'Goblinoide',
      alignment: 'neutral böse',
      ac: 15,
      acNote: 'Lederrüstung, Schild',
      hitDice: 2,
      speed: { walk: 30, climb: 20, fly: 0, swim: 0, burrow: 0 },
      abilities: { str: 8, dex: 14, con: 12, int: 10, wis: 8, cha: 8 },
      senses: { darkvision: 60 },
      languages: 'Gemeinsprache, Goblinisch',
      cr: '1/4',
    });
    // 9 Trefferpunkte folgen aus 2W6 und Konstitution: Sie werden gerechnet, nicht festgeschrieben.
    expect(read.block.hp).toBeUndefined();
    // +6 bei Geschicklichkeit +2 und Übung +2: Expertise.
    expect(read.block.skills).toEqual({ stealth: 2 });
    expect(read.unread).toEqual([]);
  });

  it('liest Merkmale und Angriffe – und findet das Attribut hinter dem Angriff', () => {
    expect(read.features.map((entry) => [entry.section, entry.name])).toEqual([
      ['trait', 'Flinke Flucht'],
      ['action', 'Krummsäbel'],
      ['action', 'Kurzbogen'],
    ]);
    expect(read.features[0]!.text).toContain('Rückzug oder Verstecken ausführen.');
    expect(read.features[1]!.attack).toEqual({
      ranged: false,
      ability: 'dex',
      bonus: null,
      reach: '5 Fuß',
      dice: '1W6',
      addMod: true,
      damageType: 'Hieb',
    });
    expect(read.features[1]!.text).toBe('');
    expect(read.features[2]!.attack).toMatchObject({
      ranged: true,
      reach: '80/320 Fuß',
      damageType: 'Stich',
    });
  });
});

describe('Statblock aus Text – englisch, Satz von 2024', () => {
  const read = parseStatblock(ENGLISH)!;

  it('liest die Tabelle der Attribute mit Rettungswürfen', () => {
    expect(read.block).toMatchObject({
      size: 'large',
      type: 'Monstrosity',
      alignment: 'Unaligned',
      ac: 14,
      initiative: 0,
      hitDice: 6,
      speed: { walk: 20, swim: 40 },
      abilities: { str: 16, dex: 14, con: 15, int: 3, wis: 12, cha: 5 },
      saves: ['str', 'wis'],
      skills: { perception: 1, stealth: 1 },
      resistant: 'Cold',
      senses: { blindsight: 30 },
      cr: '2',
    });
    expect(read.block.hp).toBeUndefined();
    expect(read.unread).toEqual([]);
  });

  it('ordnet Fähigkeiten ihren Abschnitten zu und liest Angriff und SG', () => {
    expect(read.features.map((entry) => [entry.section, entry.name])).toEqual([
      ['trait', 'Amphibious'],
      ['action', 'Multiattack'],
      ['action', 'Bite'],
      ['action', 'Shock'],
      ['bonus', 'Slip Away'],
    ]);
    const bite = read.features[2]!;
    expect(bite.attack).toMatchObject({
      ability: 'str',
      bonus: null,
      dice: '2W6',
      addMod: true,
      reach: '5 Fuß',
      damageType: 'Stich',
    });
    expect(bite.text).toBe('plus 3 (1d6) Lightning damage.');
    expect(read.features[3]!.saveDc).toBe(12);
  });
});

describe('Statblock aus Text – wie D&D Beyond ihn kopiert', () => {
  const read = parseStatblock(BEYOND)!;

  it('liest Bezeichnung und Wert von getrennten Zeilen', () => {
    expect(read.name).toBe('Moorhund');
    expect(read.block).toMatchObject({
      size: 'medium',
      type: 'Beast',
      ac: 13,
      acNote: 'natural armor',
      hitDice: 2,
      speed: { walk: 40 },
      abilities: { str: 13, dex: 14, con: 12, int: 3, wis: 12, cha: 6 },
      skills: { perception: 1 },
      cr: '1/4',
    });
    expect(read.features.map((entry) => entry.name)).toEqual(['Keen Smell', 'Bite']);
    // +4 bei Geschicklichkeit +2 und Übung +2 – nicht Stärke +1.
    expect(read.features[1]!.attack).toMatchObject({ ability: 'dex', dice: '2W4', addMod: true });
    expect(read.unread).toEqual([]);
  });
});

describe('Was sich nicht lesen lässt', () => {
  it('wird genannt statt geraten', () => {
    const read = parseStatblock(`Rätselwesen
Etwas ganz ohne Regeln
Rüstungsklasse 12
Trefferpunkte 30
Herausforderungsgrad 1
Biss. Nahkampfangriffswurf: +9, Reichweite 1,5 m. Treffer: 4 Stichschaden.`)!;
    expect(read.unread).toEqual(['Etwas ganz ohne Regeln']);
    // Trefferpunkte ohne Würfel gelten fest.
    expect(read.block.hp).toBe(30);
    // Kein Attribut erklärt +9: Der Bonus bleibt, wie er dasteht.
    expect(read.features[0]!.attack).toMatchObject({ bonus: 9, dice: '4', addMod: false });
    expect(parseStatblock('   \n ')).toBeNull();
  });
});
