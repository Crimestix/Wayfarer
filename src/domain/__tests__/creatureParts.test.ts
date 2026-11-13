import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOCK, crGuide, type FullBlock } from '../creature';
import {
  FEATURE_TEMPLATES,
  abilityEntryText,
  addToList,
  adoptFeature,
  defenceChange,
  defenceOf,
  extrasOf,
  featureLibrary,
  fillPlaceholders,
  fromTemplate,
  languageChoices,
  namedEntry,
  nextDefence,
  searchLibrary,
  setDefence,
  splitList,
  toggleInList,
  typeChoices,
  withExtras,
  wordsWithEntries,
} from '../creatureParts';
import {
  createCreature,
  createEntity,
  emptyCollections,
  newId,
  type CampaignData,
  type CreatureFeature,
} from '../schema';

const feature = (name: string, more: Partial<CreatureFeature> = {}): CreatureFeature => ({
  id: newId(),
  section: 'trait',
  name,
  text: '',
  attack: null,
  saveAbility: null,
  saveDc: null,
  uses: '',
  ...more,
});

/** Erfundene Welt: Grubenschleicher, ihr Treiber, der Aalwächter, dazu Sprachen und eine Gabe. */
function world() {
  const data = emptyCollections() as unknown as CampaignData;
  const base = createCreature({
    name: 'Grubenschleicher',
    block: { languages: 'Gemeinsprache, Grubenzunge', type: 'Humanoider' },
    features: [
      feature('Dunkelpirsch', { text: 'Im Dunkeln hat der Grubenschleicher Vorteil.' }),
      feature('Krummsäbel', {
        section: 'action',
        attack: {
          ranged: false,
          ability: 'dex',
          bonus: null,
          reach: '5 Fuß',
          dice: '1W6',
          addMod: true,
          damageType: 'Hieb',
        },
      }),
    ],
  });
  const driver = createCreature({
    name: 'Grubenschleicher-Treiber',
    kind: 'variant',
    parentId: base.id,
    features: [feature('Antreiben', { section: 'bonus', text: 'Ein Verbündeter bewegt sich.' })],
  });
  const eel = createCreature({
    name: 'Aalwächter',
    block: { type: 'Salzgrotten-Wächter', languages: 'versteht Gemeinsprache' },
    features: [feature('Dunkelpirsch', { text: 'Im Dunkeln hat der Grubenschleicher Vorteil.' })],
  });
  const common = createEntity({ kind: 'language', name: 'Gemeinsprache' });
  const deep = createEntity({ kind: 'language', name: 'Tiefensprache', aliases: ['Tiefe Zunge'] });
  const gift = createEntity({
    kind: 'ability',
    name: 'Salzblick',
    tagline: 'Sieht durch Salzkristalle hindurch.',
  });
  const twin = createEntity({ kind: 'ability', name: 'Dunkelpirsch' });
  const species = createEntity({ kind: 'species', name: 'Tannhauser Grubenvolk' });
  data.creatures = { [base.id]: base, [driver.id]: driver, [eel.id]: eel };
  data.entities = {
    [common.id]: common,
    [deep.id]: deep,
    [gift.id]: gift,
    [twin.id]: twin,
    [species.id]: species,
  };
  return { data, base, driver, eel, common, deep, gift, twin, species };
}

describe('Listen als Chips', () => {
  it('teilt, verbindet und schaltet Wörter um – ohne Doppeltes', () => {
    expect(splitList('Feuer, Kälte; feuer,  , Gift')).toEqual(['Feuer', 'Kälte', 'Gift']);
    expect(toggleInList('Feuer, Kälte', 'kälte')).toBe('Feuer');
    expect(toggleInList('Feuer', 'Gift')).toBe('Feuer, Gift');
    expect(addToList('Feuer', 'FEUER')).toBe('Feuer');
  });

  it('trennt freie Zusätze von den bekannten Wörtern', () => {
    const text = 'Gemeinsprache, Telepathie 60 Fuß';
    expect(extrasOf(text, ['Gemeinsprache'])).toEqual(['Telepathie 60 Fuß']);
    expect(withExtras(text, ['Gemeinsprache'], 'Telepathie 120 Fuß')).toBe(
      'Gemeinsprache, Telepathie 120 Fuß',
    );
  });
});

describe('Abwehr', () => {
  it('kennt den Stand einer Schadensart und schaltet ihn reihum', () => {
    const block: FullBlock = { ...DEFAULT_BLOCK, resistant: 'Feuer', immune: 'Gift' };
    expect(defenceOf(block, 'feuer')).toBe('resistant');
    expect(defenceOf(block, 'Kälte')).toBeNull();
    expect(nextDefence(null)).toBe('resistant');
    expect(nextDefence('resistant')).toBe('immune');
    expect(nextDefence('immune')).toBe('vulnerable');
    expect(nextDefence('vulnerable')).toBeNull();
  });

  it('steht nach dem Setzen in genau einer Liste – Zusätze bleiben', () => {
    const block: FullBlock = {
      ...DEFAULT_BLOCK,
      resistant: 'Feuer, Hieb aus Silberwaffen',
      immune: '',
    };
    expect(setDefence(block, 'Feuer', 'immune')).toEqual({
      resistant: 'Hieb aus Silberwaffen',
      immune: 'Feuer',
      vulnerable: '',
    });
    expect(setDefence(block, 'Feuer', null).resistant).toBe('Hieb aus Silberwaffen');
  });

  it('gibt beim Anklicken nur die Listen zurück, die sich ändern – der Rest bleibt geerbt', () => {
    const block: FullBlock = { ...DEFAULT_BLOCK, resistant: 'Gift', immune: '', vulnerable: '' };
    expect(defenceChange(block, 'Feuer')).toEqual({ resistant: 'Gift, Feuer' });
    const resistant: FullBlock = { ...block, resistant: 'Gift, Feuer' };
    expect(defenceChange(resistant, 'Feuer')).toEqual({ resistant: 'Gift', immune: 'Feuer' });
  });
});

describe('Auswahl aus der Welt', () => {
  it('findet Einträge nur bei gleichem Namen oder Beinamen', () => {
    const { data, deep } = world();
    expect(namedEntry(data, 'language', 'tiefe zunge')?.id).toBe(deep.id);
    expect(namedEntry(data, 'language', 'Tiefen')).toBeNull();
    expect(namedEntry(data, 'species', 'Tiefensprache')).toBeNull();
  });

  it('bietet Sprachen der Welt und des Bestiariums an, ohne die schon gewählten', () => {
    const { data, common, deep } = world();
    const choices = languageChoices(data, 'Gemeinsprache');
    expect(choices.map((choice) => choice.word)).toEqual([
      'Grubenzunge',
      'Tiefensprache',
      'versteht Gemeinsprache',
    ]);
    expect(choices.find((choice) => choice.word === 'Tiefensprache')?.entityId).toBe(deep.id);
    expect(choices.find((choice) => choice.word === 'Grubenzunge')?.entityId).toBeNull();
    expect(wordsWithEntries(data, 'language', 'Gemeinsprache, Grubenzunge')).toEqual([
      { word: 'Gemeinsprache', entityId: common.id },
      { word: 'Grubenzunge', entityId: null },
    ]);
  });

  it('nimmt eigene Typen des Bestiariums zu den Regeltypen', () => {
    const types = typeChoices(world().data);
    expect(types).toContain('Untoter');
    expect(types).toContain('Salzgrotten-Wächter');
    expect(types.filter((type) => type === 'Humanoider')).toHaveLength(1);
  });
});

describe('Bibliothek der Fähigkeiten', () => {
  it('sammelt eigene Fähigkeiten aller Wesen einmal, mit Herkunft – Geerbtes nicht doppelt', () => {
    const { data, twin, gift } = world();
    const library = featureLibrary(data);
    const names = library.map((entry) => entry.feature.name);
    expect(names).toEqual(['Antreiben', 'Dunkelpirsch', 'Krummsäbel', 'Salzblick']);
    const stalk = library.find((entry) => entry.feature.name === 'Dunkelpirsch')!;
    expect(stalk.origins).toEqual(['Aalwächter', 'Grubenschleicher', 'Welt']);
    expect(stalk.entityId).toBe(twin.id);
    const salt = library.find((entry) => entry.feature.name === 'Salzblick')!;
    expect(salt).toMatchObject({ from: 'world', entityId: gift.id });
    expect(salt.feature.text).toBe('Sieht durch Salzkristalle hindurch.');
  });

  it('lässt das Wesen aus, das gerade gebaut wird', () => {
    const { data, driver } = world();
    expect(featureLibrary(data, driver.id).map((e) => e.feature.name)).not.toContain('Antreiben');
  });

  it('sucht im Namen zuerst, dann im Text und bei der Herkunft', () => {
    const library = featureLibrary(world().data);
    expect(searchLibrary(library, 'salz').map((e) => e.feature.name)).toEqual(['Salzblick']);
    expect(searchLibrary(library, 'aalw').map((e) => e.feature.name)).toEqual(['Dunkelpirsch']);
    expect(searchLibrary(library, '', 'action').map((e) => e.feature.name)).toEqual([
      'Krummsäbel',
      'Salzblick',
    ]);
  });

  it('übernimmt eine Abschrift mit neuer Kennung', () => {
    const { data } = world();
    const saber = featureLibrary(data).find((entry) => entry.feature.name === 'Krummsäbel')!;
    const copy = adoptFeature(saber.feature);
    expect(copy.id).toBeTruthy();
    expect(copy.attack).toEqual(saber.feature.attack);
    expect(copy.attack).not.toBe(saber.feature.attack);
    expect(adoptFeature(saber.feature, 'reaction').section).toBe('reaction');
  });

  it('macht aus einer Fähigkeit einen Eintrag mit kurzer Beschreibung', () => {
    expect(abilityEntryText({ text: 'Sieht im Dunkeln. Und hört gut.' })).toEqual({
      tagline: 'Sieht im Dunkeln.',
      notes: 'Sieht im Dunkeln. Und hört gut.',
    });
  });
});

describe('Gerüste', () => {
  it('baut Angriffe mit dem passenden Attribut und Zauber mit dem stärksten Geist', () => {
    const block: FullBlock = {
      ...DEFAULT_BLOCK,
      attacksPerRound: 3,
      abilities: { str: 8, dex: 16, con: 12, int: 10, wis: 14, cha: 11 },
    };
    expect(fromTemplate('multiattack', block)?.text).toBe('Das Wesen greift dreimal an.');
    expect(fromTemplate('melee', block)?.attack?.ability).toBe('dex');
    const spells = fromTemplate('spells', block)!;
    expect(spells.saveAbility).toBe('wis');
    expect(spells.text).toContain('Weisheit');
    expect(fromTemplate('save', block)).toMatchObject({
      uses: 'Aufladung 5–6',
      saveAbility: 'con',
    });
    expect(fromTemplate('gibt-es-nicht', block)).toBeNull();
    expect(new Set(FEATURE_TEMPLATES.map((t) => t.key)).size).toBe(FEATURE_TEMPLATES.length);
  });
});

describe('Platzhalter', () => {
  const block: FullBlock = {
    ...DEFAULT_BLOCK,
    cr: '5',
    abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
  };

  it('rechnet SG, Angriff, Modifikator und Würfel aus den Werten', () => {
    expect(fillPlaceholders(block, 'Rettungswurf [SG KON], Angriff [ANG STÄ], [MOD GES].')).toBe(
      'Rettungswurf SG 13, Angriff +6, +2.',
    );
    expect(fillPlaceholders(block, 'Treffer: [2W6 STÄ] Wucht, dazu [3W6] Feuer.')).toBe(
      'Treffer: 10 (2W6 + 3) Wucht, dazu 10 (3W6) Feuer.',
    );
    expect(fillPlaceholders(block, '[1W8+2] und [SG DEX]')).toBe('6 (1W8 + 2) und SG 13');
  });

  it('lässt stehen, was es nicht lesen kann', () => {
    expect(fillPlaceholders(block, '[Name] und [2W6 Hut] und [SG XYZ]')).toBe(
      '[Name] und [2W6 Hut] und [SG XYZ]',
    );
  });
});

describe('Richtwerte', () => {
  it('nennt RK, Trefferpunkte, Angriff und Schaden für einen HG', () => {
    expect(crGuide('1/4')).toEqual({ ac: 13, hp: 49, attack: 3, damage: 5 });
    expect(crGuide('5')).toEqual({ ac: 15, hp: 145, attack: 6, damage: 38 });
  });
});
