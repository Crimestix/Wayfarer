/** Aktuelle Trefferpunkte, Initiative, Zauber-SG, Dunkelsicht, eigene Zustände, Trennen in der Chronik. */
import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../../data/db';
import { demoCampaign } from '../../../data/__fixtures__/demoWorld';
import { MemoryStore } from '../../../data/store';
import { chronicleFor, entitiesOfKind } from '../../../domain/derive';
import {
  CampaignMetaSchema,
  EntitySchema,
  type CampaignData,
  type Character,
} from '../../../domain/schema';
import { addOwnCondition, changeHp, removeOwnCondition, saveCharacter } from '../actions';
import {
  addCustomCondition,
  adjustHp,
  combatFacts,
  draftFromCharacter,
  parseDraft,
  parseSigned,
  ruleOf,
  signed,
} from '../model';

const demoDb = () => CampaignDb.create(new MemoryStore(), demoCampaign());
const heroOf = (data: CampaignData, name: string) =>
  entitiesOfKind(data, 'character').find((c) => c.name === name) as Character;
const hero = (db: CampaignDb, name: string) => heroOf(db.getSnapshot(), name);

describe('Neue Werte der Gefährten', () => {
  it('füllt bei alten Dateien Vorgaben ein', () => {
    const old = EntitySchema.parse({ id: 'c1', kind: 'character', name: 'Tomlin' });
    expect(old.kind === 'character' && old.character).toMatchObject({
      hp: null,
      initiative: null,
      spellSaveDc: null,
      darkvision: null,
    });
    const meta = CampaignMetaSchema.parse({
      id: 'campaign',
      schema: 1,
      name: 'Elaris',
      calendar: demoCampaign().campaign.calendar,
    });
    expect(meta.customConditions).toEqual([]);
  });

  it('liest und schreibt Boni mit Vorzeichen', () => {
    expect([3, 0, -1].map(signed)).toEqual(['+3', '0', '−1']);
    expect(parseSigned('+3', -10, 30)).toBe(3);
    expect(parseSigned('−1', -10, 30)).toBe(-1);
    expect(parseSigned('-2', -10, 30)).toBe(-2);
    expect(parseSigned('', -10, 30)).toBeNull();
    expect(parseSigned('schnell', -10, 30)).toBe('invalid');
    expect(parseSigned('99', -10, 30)).toBe('invalid');
  });

  it('prüft die Eingaben des Dialogs', () => {
    const tomlin = heroOf(demoCampaign(), 'Tomlin');
    const base = draftFromCharacter(tomlin);
    const ok = parseDraft({
      ...base,
      hpMax: '38',
      hp: '24',
      initiative: '+3',
      spellSaveDc: '15',
      darkvision: '60',
    });
    expect(ok.value?.character).toMatchObject({
      hp: 24,
      initiative: 3,
      spellSaveDc: 15,
      darkvision: 60,
    });
    expect(parseDraft({ ...base, hpMax: '20', hp: '25' }).errors.hp).toBeTruthy();
    expect(parseDraft({ ...base, initiative: 'flink' }).errors.initiative).toBeTruthy();
    // Hin und zurück bleibt der Bonus lesbar.
    const again = draftFromCharacter({ ...tomlin, character: ok.value!.character });
    expect(again.initiative).toBe('+3');
  });

  it('rechnet Schaden und Heilung in den Grenzen 0 bis Maximum', () => {
    expect(adjustHp(24, 38, -5)).toBe(19);
    expect(adjustHp(3, 38, -5)).toBe(0);
    expect(adjustHp(36, 38, 5)).toBe(38);
    // Noch nichts mitgeführt: Es geht vom Maximum aus.
    expect(adjustHp(null, 38, -1)).toBe(37);
    expect(adjustHp(null, null, 4)).toBe(4);
  });

  it('zeigt unter der Leiste nur, was eingetragen ist', () => {
    expect(combatFacts({ initiative: null, spellSaveDc: null, darkvision: null })).toEqual([]);
    expect(
      combatFacts({ initiative: 2, spellSaveDc: 15, darkvision: 60 }).map(
        (f) => `${f.label} ${f.value}`,
      ),
    ).toEqual(['Initiative +2', 'Zauber-SG 15', 'Dunkelsicht 60 Fuß']);
    expect(combatFacts({ initiative: 0, spellSaveDc: null, darkvision: 0 })).toHaveLength(1);
  });

  it('führt Trefferpunkte am Gefährten mit', async () => {
    const db = await demoDb();
    const tomlin = hero(db, 'Tomlin');
    saveCharacter(db, tomlin.id, {
      name: 'Tomlin',
      tagline: '',
      image: null,
      character: { ...tomlin.character, hpMax: 30, hp: null },
    });
    changeHp(db, tomlin.id, -5);
    expect(hero(db, 'Tomlin').character.hp).toBe(25);
    changeHp(db, tomlin.id, 99);
    expect(hero(db, 'Tomlin').character.hp).toBe(30);
  });
});

describe('Eigene Zustände', () => {
  it('nimmt neue Namen auf, aber keine doppelten und keine aus dem Regelwerk', () => {
    const one = addCustomCondition([], '  Verflucht ', 'Nachteil auf Rettungswürfe.');
    expect(one).toEqual([{ name: 'Verflucht', rule: 'Nachteil auf Rettungswürfe.' }]);
    expect(addCustomCondition(one, 'verflucht')).toEqual(one);
    expect(addCustomCondition(one, 'Vergiftet')).toEqual(one);
    expect(addCustomCondition(one, 'Besessen').map((c) => c.name)).toEqual([
      'Besessen',
      'Verflucht',
    ]);
    expect(ruleOf('Verflucht', one)).toBe('Nachteil auf Rettungswürfe.');
    expect(ruleOf('Vergiftet', one)).not.toBe('');
  });

  it('gelten für die ganze Kampagne und lassen sich wieder aus der Liste nehmen', async () => {
    const db = await demoDb();
    const id = hero(db, 'Neil').id;
    addOwnCondition(db, id, 'Verflucht');
    expect(db.getSnapshot().campaign.customConditions.map((c) => c.name)).toEqual(['Verflucht']);
    expect(hero(db, 'Neil').character.conditions).toContain('Verflucht');
    // Noch einmal dasselbe ändert nichts.
    addOwnCondition(db, id, 'Verflucht');
    expect(db.getSnapshot().campaign.customConditions).toHaveLength(1);
    removeOwnCondition(db, 'Verflucht');
    expect(db.getSnapshot().campaign.customConditions).toEqual([]);
    // Wer ihn gerade hat, behält ihn.
    expect(hero(db, 'Neil').character.conditions).toContain('Verflucht');
  });
});

describe('Trennen und Zurückkehren', () => {
  it('steht auch dann in der Chronik, wenn es im Bearbeiten-Dialog geschieht', async () => {
    const db = await demoDb();
    const corrin = hero(db, 'Corrin');
    const place = Object.values(db.getSnapshot().entities).find((e) => e.kind === 'place')!;
    const before = chronicleFor(db.getSnapshot(), corrin.id).length;
    const save = (placeId: string | null, tagline = corrin.tagline) =>
      saveCharacter(db, corrin.id, {
        name: corrin.name,
        tagline,
        image: corrin.image,
        character: { ...corrin.character, placeId },
      });
    save(place.id);
    const texts = () => chronicleFor(db.getSnapshot(), corrin.id).map((e) => e.text);
    expect(texts()).toHaveLength(before + 1);
    expect(texts()).toContain(`Corrin ist abseits der Gruppe unterwegs: ${place.name}.`);
    save(null);
    const after = texts();
    expect(after).toHaveLength(before + 2);
    expect(after).toContain('Corrin ist wieder bei der Gruppe.');
    // Ohne Ortswechsel entsteht kein Eintrag.
    save(null, 'neu');
    expect(chronicleFor(db.getSnapshot(), corrin.id)).toHaveLength(after.length);
  });
});
