/**
 * Ein erfundenes Wesen in den Formen, in denen ein Spielleiter Statblöcke einfügt: aus einem PDF
 * im Satz von 2024 kopiert (umbrochene Zeilen, Trennstriche, Tabelle der Attribute flach gelegt),
 * von D&D Beyond kopiert (Bezeichnung und Wert auf eigenen Zeilen, Minuszeichen, geschützte
 * Leerzeichen) und in deutscher Übersetzung. Das Wesen steht in keinem Buch.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityKey, CreatureBlock, FeatureSection } from '../../domain/schema';
import { parseStatblock, type ParsedStatblock } from './parse';

const NBSP = '\u00a0';
const SOFT = '\u00ad';

/** (a) Aus dem PDF im Satz von 2024: Tabelle drei Attribute je Zeile, Zeilen mitten im Satz umbrochen. */
const PDF_FLAT = `Aschenweber
Medium Monstrosity, Neutral Evil
AC 15 Initiative +2 (12)
HP 45 (6d8 + 18)
Speed 30${NBSP}ft., Fly
60 ft.
MOD SAVE MOD SAVE MOD SAVE
STR 16 +3 +3 DEX 14 +2 +4 CON 16 +3 +3
INT 7 −2 −2 WIS 12 +1 +1 CHA 9 −1 −1
Skills Perception +3, Stealth +4
Resistances Fire, Poison
Immunities Poisoned
Gear Spear
Senses Darkvision 60 ft.; Passive Percep-
tion 13
Languages Understands Common but can’t
speak
CR 3 (XP 700; PB +2)
TRAITS
Ash Veil. While in dim light or darkness, the
weaver has advantage on Dexterity (Stealth) checks.
Smol${SOFT}dering Hide. A creature that touches the weav-
er takes 3 (1d6) Fire damage.
ACTIONS
Multiattack. The weaver makes two Claw attacks. It
can replace one attack with a use of Ember Breath.
Claw. Melee Attack Roll: +5, reach 5 ft. Hit: 7 (1d8
+ 3) Slashing damage.
Ember Breath (Recharge 5–6). Dexterity Saving Throw:
DC 13, each creature in a 15-
foot Cone. Failure: 14 (4d6) Fire damage. Success:
Half damage.
BONUS ACTIONS
Drift. The weaver flies up to half its Fly Speed.
REACTIONS
Cinder Flare. Trigger: A creature hits the weaver with
a melee attack. Response: The attacker takes 3 (1d6)
Fire damage.
LEGENDARY ACTIONS
Legendary Action Uses: 3. Immediately after another
creature’s turn, the weaver can expend a use to take one of the following actions.
Swoop. The weaver moves up to its Speed.
`;

/** (a) Aus dem PDF – die Tabelle mit einem Wert je Zeile. */
const PDF_COLUMN = `Aschenweber
Medium Monstrosity, Neutral Evil
AC 15 Initiative +2 (12)
HP 45 (6d8 + 18)
Speed 30 ft., Fly 60 ft.
MOD
SAVE
STR
16
+3
+3
DEX
14
+2
+4
CON
16
+3
+3
INT
7
−2
−2
WIS
12
+1
+1
CHA
9
−1
−1
Skills Perception +3, Stealth +4
Resistances Fire, Poison
Immunities Poisoned
Senses Darkvision 60 ft.; Passive Perception 13
Languages Understands Common but can’t speak
CR 3 (XP 700; PB +2)
Traits
Ash Veil. While in dim light or darkness, the weaver has advantage on Dexterity (Stealth) checks.
Smoldering Hide. A creature that touches the weaver takes 3 (1d6) Fire damage.
Actions
Multiattack. The weaver makes two Claw attacks. It can replace one attack with a use of Ember Breath.
Claw. Melee Attack Roll: +5, reach 5 ft. Hit: 7 (1d8 + 3) Slashing damage.
Ember Breath (Recharge 5–6). Dexterity Saving Throw: DC 13, each creature in a 15-foot Cone. Failure: 14 (4d6) Fire damage. Success: Half damage.
Bonus Actions
Drift. The weaver flies up to half its Fly Speed.
Reactions
Cinder Flare. Trigger: A creature hits the weaver with a melee attack. Response: The attacker takes 3 (1d6) Fire damage.
Legendary Actions
Legendary Action Uses: 3. Immediately after another creature’s turn, the weaver can expend a use to take one of the following actions.
Swoop. The weaver moves up to its Speed.
`;

/** (b) Von D&D Beyond: jede Bezeichnung auf eigener Zeile, die sechs Kürzel untereinander. */
const BEYOND_STACKED = `Aschenweber
Medium monstrosity, neutral evil
Armor Class
15 (natural armor)
Hit Points
45 (6d8${NBSP}+${NBSP}18)
Speed
30${NBSP}ft., fly 60${NBSP}ft.
STR
DEX
CON
INT
WIS
CHA
16 (+3)
14 (+2)
16 (+3)
7 (−2)
12 (+1)
9 (−1)
Saving Throws
Dex +4
Skills
Perception +3, Stealth +4
Damage Resistances
fire, poison
Condition Immunities
poisoned
Senses
darkvision 60 ft., passive Perception 13
Languages
understands Common but can't speak
Challenge
3 (700 XP)
Proficiency Bonus
+2
Ash Veil. While in dim light or darkness, the weaver has advantage on Dexterity (Stealth) checks.
Smoldering Hide. A creature that touches the weaver takes 3 (1d6) fire damage.
Actions
Multiattack. The weaver makes two claw attacks. It can replace one attack with a use of Ember Breath.
Claw. Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) slashing damage.
Ember Breath (Recharge 5–6). The weaver exhales embers in a 15-foot cone. Each creature in that area must make a DC 13 Dexterity saving throw, taking 14 (4d6) fire damage on a failed save, or half as much damage on a successful one.
Bonus Actions
Drift. The weaver flies up to half its flying speed.
Reactions
Cinder Flare. When a creature hits the weaver with a melee attack, the attacker takes 3 (1d6) fire damage.
Legendary Actions
The weaver can take 3 legendary actions, choosing from the options below. Only one legendary action can be used at a time and only at the end of another creature's turn. The weaver regains spent legendary actions at the start of its turn.
Swoop. The weaver moves up to its speed.
`;

/** (b) Von D&D Beyond im Satz von 2014: Kürzel und Werte in einer Zeile. */
const BEYOND_LINE = `Aschenweber
Medium monstrosity, neutral evil
Armor Class 15 (natural armor)
Hit Points 45 (6d8 + 18)
Speed 30 ft., fly 60 ft.
STR DEX CON INT WIS CHA 16 (+3) 14 (+2) 16 (+3) 7 (−2) 12 (+1) 9 (−1)
Saving Throws Dex +4
Skills Perception +3, Stealth +4
Damage Resistances fire, poison
Condition Immunities poisoned
Senses darkvision 60 ft., passive Perception 13
Languages understands Common but can't speak
Challenge 3 (700 XP)
Ash Veil. While in dim light or darkness, the weaver has advantage on Dexterity (Stealth) checks.
Smoldering Hide. A creature that touches the weaver takes 3 (1d6) fire damage.
Actions
Multiattack. The weaver makes two claw attacks. It can replace one attack with a use of Ember Breath.
Claw. Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) slashing damage.
Ember Breath (Recharge 5–6). The weaver exhales embers in a 15-foot cone. Each creature in that area must make a DC 13 Dexterity saving throw, taking 14 (4d6) fire damage on a failed save, or half as much damage on a successful one.
Bonus Actions
Drift. The weaver flies up to half its flying speed.
Reactions
Cinder Flare. When a creature hits the weaver with a melee attack, the attacker takes 3 (1d6) fire damage.
Legendary Actions
The weaver can take 3 legendary actions, choosing from the options below. Only one legendary action can be used at a time and only at the end of another creature's turn.
Swoop. The weaver moves up to its speed.
`;

/** (c) Deutsche Übersetzung, aus dem PDF kopiert – mit Trennstrichen und umbrochenen Zeilen. */
const GERMAN = `Aschenweber
Mittelgroße Monstrosität, neutral böse
Rüstungsklasse 15 (natürliche Rüstung)
Trefferpunkte 45 (6W8 + 18)
Bewegungsrate 9 m, Fliegen 18 m
STÄ GES KON INT WEI CHA
16 (+3) 14 (+2) 16 (+3) 7 (−2) 12 (+1) 9 (−1)
Rettungswürfe Ges +4
Fertigkeiten Heimlichkeit +4, Wahrnehmung +3
Schadensresistenzen Feuer, Gift
Zustandsimmunitäten Vergiftet
Sinne Dunkelsicht 18 m, passive Wahrnehmung 13
Sprachen versteht die Gemeinsprache, kann aber
nicht sprechen
Herausforderungsgrad 3 (700 EP)
Merkmale
Aschenschleier. In dämmrigem Licht oder Dunkelheit ist der Aschen-
weber bei Würfen auf Geschicklichkeit (Heimlichkeit) im Vorteil.
Schwelende Haut. Eine Kreatur, die den Aschenweber berührt, erleidet 3 (1W6) Feuer-
schaden.
Aktionen
Mehrfachangriff. Der Aschenweber führt zwei Klauen-
angriffe aus. Er kann einen Angriff durch Glutatem ersetzen.
Klaue. Nahkampfangriffswurf: +5, Reichweite 1,5 m. Treffer: 7 (1W8 + 3) Hiebschaden.
Glutatem (Aufladung 5–6). Rettungswurf auf Geschicklichkeit: SG 13, jede Kreatur in einem
Kegel von 4,5 m. Misserfolg: 14 (4W6) Feuerschaden. Erfolg: Halber Schaden.
Bonusaktionen
Treiben. Der Aschenweber fliegt bis zur Hälfte seiner Flugbewegungsrate.
Reaktionen
Glutfunke. Auslöser: Eine Kreatur trifft den Aschenweber mit einem Nahkampfangriff. Reaktion:
Der Angreifer erleidet 3 (1W6) Feuerschaden.
Legendäre Aktionen
Legendäre Aktionen: 3. Unmittelbar nach dem Zug einer anderen Kreatur kann der Aschenweber eine
Anwendung aufwenden, um eine der folgenden Aktionen auszuführen.
Sturzflug. Der Aschenweber bewegt sich bis zu seiner Bewegungsrate.
`;

interface Expected {
  block: CreatureBlock;
  /** Abschnitt und Name jeder Fähigkeit, in Reihenfolge. */
  features: [FeatureSection, string][];
  /** Ein Stück Text, das in der Fähigkeit stehen muss (zusammengefügte Zeilen). */
  texts: Record<string, string>;
  claw: string;
  breath: string;
}

const ABILITIES: Record<AbilityKey, number> = {
  str: 16,
  dex: 14,
  con: 16,
  int: 7,
  wis: 12,
  cha: 9,
};
const COMMON: CreatureBlock = {
  size: 'medium',
  ac: 15,
  hitDice: 6,
  speed: { walk: 30, fly: 60, swim: 0, climb: 0, burrow: 0 },
  abilities: ABILITIES,
  saves: ['dex'],
  skills: { perception: 1, stealth: 1 },
  senses: { darkvision: 60, blindsight: 0, tremorsense: 0, truesight: 0 },
  cr: '3',
};

const ENGLISH_2024: Expected = {
  block: {
    ...COMMON,
    type: 'Monstrosity',
    alignment: 'Neutral Evil',
    initiative: 0,
    resistant: 'Fire, Poison',
    conditionImmune: 'Poisoned',
    languages: 'Understands Common but can’t speak',
  },
  features: [
    ['trait', 'Ash Veil'],
    ['trait', 'Smoldering Hide'],
    ['action', 'Multiattack'],
    ['action', 'Claw'],
    ['action', 'Ember Breath (Recharge 5–6)'],
    ['bonus', 'Drift'],
    ['reaction', 'Cinder Flare'],
    ['legendary', 'Legendary Action Uses'],
    ['legendary', 'Swoop'],
  ],
  texts: {
    'Ash Veil': 'the weaver has advantage',
    'Smoldering Hide': 'touches the weaver takes 3 (1d6) Fire damage.',
    Multiattack: 'Claw attacks. It can replace',
    'Ember Breath (Recharge 5–6)': 'in a 15-foot Cone. Failure: 14 (4d6) Fire damage.',
    'Cinder Flare': 'with a melee attack. Response:',
    'Legendary Action Uses': 'another creature’s turn',
  },
  claw: 'Hieb',
  breath: 'Ember Breath (Recharge 5–6)',
};

const ENGLISH_2014: Expected = {
  block: {
    ...COMMON,
    type: 'monstrosity',
    alignment: 'neutral evil',
    acNote: 'natural armor',
    resistant: 'fire, poison',
    conditionImmune: 'poisoned',
    languages: "understands Common but can't speak",
  },
  features: [
    ['trait', 'Ash Veil'],
    ['trait', 'Smoldering Hide'],
    ['action', 'Multiattack'],
    ['action', 'Claw'],
    ['action', 'Ember Breath (Recharge 5–6)'],
    ['bonus', 'Drift'],
    ['reaction', 'Cinder Flare'],
    ['legendary', 'Nutzung'],
    ['legendary', 'Swoop'],
  ],
  texts: {
    Nutzung: 'can take 3 legendary actions',
    'Ember Breath (Recharge 5–6)': 'DC 13 Dexterity saving throw',
  },
  claw: 'Hieb',
  breath: 'Ember Breath (Recharge 5–6)',
};

const GERMAN_EXPECTED: Expected = {
  block: {
    ...COMMON,
    type: 'Monstrosität',
    alignment: 'neutral böse',
    acNote: 'natürliche Rüstung',
    resistant: 'Feuer, Gift',
    conditionImmune: 'Vergiftet',
    languages: 'versteht die Gemeinsprache, kann aber nicht sprechen',
  },
  features: [
    ['trait', 'Aschenschleier'],
    ['trait', 'Schwelende Haut'],
    ['action', 'Mehrfachangriff'],
    ['action', 'Klaue'],
    ['action', 'Glutatem (Aufladung 5–6)'],
    ['bonus', 'Treiben'],
    ['reaction', 'Glutfunke'],
    ['legendary', 'Legendäre Aktionen'],
    ['legendary', 'Sturzflug'],
  ],
  texts: {
    Aschenschleier: 'ist der Aschenweber bei Würfen',
    'Schwelende Haut': 'erleidet 3 (1W6) Feuerschaden.',
    Mehrfachangriff: 'zwei Klauenangriffe aus. Er kann',
    'Glutatem (Aufladung 5–6)': 'jede Kreatur in einem Kegel von 4,5 m.',
    Glutfunke: 'Reaktion: Der Angreifer erleidet',
    'Legendäre Aktionen': 'kann der Aschenweber eine Anwendung aufwenden',
  },
  claw: 'Hieb',
  breath: 'Glutatem (Aufladung 5–6)',
};

const CASES: [string, string, Expected][] = [
  [
    'PDF 2024, Tabelle flach',
    PDF_FLAT,
    { ...ENGLISH_2024, block: { ...ENGLISH_2024.block, gear: 'Spear' } },
  ],
  ['PDF 2024, ein Wert je Zeile', PDF_COLUMN, ENGLISH_2024],
  ['D&D Beyond, Kürzel untereinander', BEYOND_STACKED, ENGLISH_2014],
  ['D&D Beyond, Kürzel in einer Zeile', BEYOND_LINE, ENGLISH_2014],
  ['deutsche Übersetzung', GERMAN, GERMAN_EXPECTED],
];

describe.each(CASES)('Statblock – %s', (_label, text, expected) => {
  const read = parseStatblock(text) as ParsedStatblock;

  it('Name', () => expect(read.name).toBe('Aschenweber'));
  it.each(Object.keys(expected.block) as (keyof CreatureBlock)[])('Feld %s', (key) =>
    expect(read.block[key]).toEqual(expected.block[key]),
  );
  it('keine festen Trefferpunkte (folgen aus 6W8 und Konstitution)', () =>
    expect(read.block.hp).toBeUndefined());
  it('keine Schadensimmunität', () => expect(read.block.immune).toBeUndefined());
  it('Fähigkeiten und Abschnitte', () =>
    expect(read.features.map((feature) => [feature.section, feature.name])).toEqual(
      expected.features,
    ));
  it.each(Object.entries(expected.texts))('Text von %s', (name, part) =>
    expect(read.features.find((feature) => feature.name === name)?.text).toContain(part),
  );
  it('Angriff der Klaue', () => {
    const claw = read.features.find((feature) => feature.attack);
    expect(claw?.attack).toEqual({
      ranged: false,
      ability: 'str',
      bonus: null,
      reach: '5 Fuß',
      dice: '1W8',
      addMod: true,
      damageType: expected.claw,
    });
    expect(claw?.text).toBe('');
  });
  it('SG des Atems', () =>
    expect(read.features.find((feature) => feature.name === expected.breath)?.saveDc).toBe(13));
  it('nichts übrig', () => expect(read.unread).toEqual([]));
});
