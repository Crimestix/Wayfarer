/** Namen beim Lesen: tolerant geschrieben, unbekannte Namen als Frage. */
import { describe, expect, it } from 'vitest';
import { recognizeEntry } from '../../../domain/recognize';
import {
  entitiesNamed,
  foldName,
  mentions,
  readingText,
  tolerantWorld,
  unknownNames,
} from '../../../domain/readNames';
import { readWorld } from './readWorld';

describe('Tolerante Namen', () => {
  it('faltet Groß/Klein, doppelte Buchstaben und Apostrophe', () => {
    expect(foldName('Odo Kesssler')).toBe(foldName('Odo Kessler'));
    expect(foldName('Hagen’s Rast')).toBe(foldName("Hagen's Rast"));
    expect(foldName('KRUMMZAHN')).toBe('krumzahn');
  });

  it('bessert Tippfehler beim Lesen, ohne Stellen zu verschieben', () => {
    const text = 'BRann sprach mit der SChwester. Die Spieler zogen weiter. Fast sofort fiel er.';
    const work = readingText(text);
    expect(work).toHaveLength(text.length);
    expect(work).toContain('Brann sprach mit der Schwester.');
    expect(work).toContain('Die Gruppe  zogen');
    expect(work).toContain('kurz sofort');
  });

  it('findet Namen trotz Schreibweise – nur eindeutige', () => {
    const w = readWorld();
    const text = 'Gestern traf Lando den Odo Kesssler und Krumzahn, nicht aber Hagens Bruder.';
    const found = mentions(w.data, text).map((m) => m.id);
    expect(found).toEqual([w.lando.id, w.odo.id, w.krummzahn.id, w.hagen.id]);
  });

  it('macht Schreibweisen für das Erkennen bekannt, ohne die Welt zu ändern', () => {
    const w = readWorld();
    const text = 'Brann hat Krumzahn erschlagen.';
    expect(recognizeEntry(w.data, text).find((i) => i.kind === 'fate')).toBeUndefined();
    const world = tolerantWorld(w.data, text);
    expect(world.entities[w.krummzahn.id]!.aliases).toEqual(['Krumzahn']);
    expect(w.data.entities[w.krummzahn.id]!.aliases).toEqual([]);
    expect(recognizeEntry(world, text).find((i) => i.kind === 'fate')?.refs).toEqual([
      w.krummzahn.id,
    ]);
  });

  it('sucht Einträge nach Namen und Art', () => {
    const w = readWorld();
    expect(entitiesNamed(w.data, 'Lando', ['character'])).toEqual([w.lando.id]);
    expect(entitiesNamed(w.data, 'Landos', ['character'])).toEqual([w.lando.id]);
    expect(entitiesNamed(w.data, 'Lando', ['person'])).toEqual([]);
    expect(entitiesNamed(w.data, 'Niemand')).toEqual([]);
  });
});

describe('Unbekannte Namen', () => {
  const piece = (text: string, line = 0) => ({ text, line });

  it('fragt nach Namen, die mehrfach und nicht nur am Satzanfang stehen', () => {
    const w = readWorld();
    const questions = unknownNames(w.data, [
      piece('Lando sprach mit Tessa am Brunnen.', 0),
      piece('Tessa gab ihnen einen Apfel.', 1),
    ]);
    expect(questions).toEqual([{ key: 'tesa', name: 'Tessa', count: 2, lines: [0, 1] }]);
  });

  it('fragt nicht nach gewöhnlichen Hauptwörtern, Bekannten oder einmal Genanntem', () => {
    const w = readWorld();
    const questions = unknownNames(w.data, [
      piece('Die Gruppe fand eine Truhe. Brann öffnete die Truhe.'),
      piece('Vor 80 Jahren stand hier ein Turm aus grauem Fels, alles aus grauem Fels.'),
      piece('Lando Furtner und Krummzahn sprachen mit Odo. Lando lachte. Einmal kam Wilmar.'),
    ]);
    expect(questions).toEqual([]);
  });

  it('nimmt zusammenstehende Namen zusammen, wenn sie sich wiederholen', () => {
    const w = readWorld();
    const questions = unknownNames(w.data, [
      piece('Brann traf Elsa Morgentau am Tor.', 0),
      piece('Später sprach Mira mit Elsa Morgentau.', 1),
      piece('Danach ging Elsa fort.', 2),
    ]);
    expect(questions).toEqual([
      { key: 'elsa morgentau', name: 'Elsa Morgentau', count: 3, lines: [0, 1, 2] },
    ]);
  });

  it('trennt zwei Namen, die nur einmal nebeneinander stehen („erschlug A B“)', () => {
    const w = readWorld();
    const questions = unknownNames(w.data, [
      piece('Im Hof erschlug Wilmar Gundolf.', 0),
      piece('Danach sprach Mira mit Gundolf und Wilmar.', 1),
    ]);
    expect(questions.map((q) => q.name).sort()).toEqual(['Gundolf', 'Wilmar']);
  });

  it('lernt gewöhnliche Hauptwörter auch aus anderen Sessions', () => {
    const w = readWorld();
    const pieces = [piece('Mira sah Graufang.'), piece('Brann jagte Graufang.')];
    expect(unknownNames(w.data, pieces).map((q) => q.name)).toEqual(['Graufang']);
    expect(unknownNames(w.data, pieces, ['Der Graufang heulte.'])).toEqual([]);
  });
});
