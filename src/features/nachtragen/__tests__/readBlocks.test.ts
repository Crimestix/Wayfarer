/** Der Aufbau der Notizen: Rückblick, Fäden, Beute, Einkäufe, Schriftstücke, Regelwerte. */
import { describe, expect, it } from 'vitest';
import {
  blockText,
  coinGold,
  noteBlocks,
  recapOf,
  titleCase,
  writingTitle,
  type NoteBlock,
} from '../readBlocks';
import { ABEND_EINS, ABEND_STADT } from './readWorld';

const kinds = (blocks: NoteBlock[]) => blocks.map((block) => block.kind);
const only = <K extends NoteBlock['kind']>(blocks: NoteBlock[], kind: K) =>
  blocks.filter((block): block is Extract<NoteBlock, { kind: K }> => block.kind === kind);

describe('Rückblick für die Spieler', () => {
  it('löst den Text unter „Intro“ heraus – bis zu zwei Leerzeilen', () => {
    const blocks = noteBlocks(ABEND_EINS);
    expect(blocks[0]!.kind).toBe('recap');
    const recap = recapOf(blocks);
    expect(recap.startsWith('Ihr seid nach langer Reise')).toBe(true);
    expect(recap).toContain('wart ihr müde.');
    expect(recap).not.toContain('Intro');
    expect(recap).not.toContain('Odo');
    // „Notizen“ ist nur ein Abschnittsname.
    expect(blocks[1]).toMatchObject({ kind: 'heading' });
  });

  it('erkennt einen Rückblick ohne Überschrift an der zweiten Person Plural', () => {
    const text =
      'Ihr habt den Turm erreicht.\nDort habt ihr Odo getroffen und euch ausgeruht.\n\nOdo verriet den Weg.';
    const blocks = noteBlocks(text);
    expect(kinds(blocks)).toEqual(['recap', 'text']);
    expect(recapOf(blocks)).toBe(
      'Ihr habt den Turm erreicht.\nDort habt ihr Odo getroffen und euch ausgeruht.',
    );
  });

  it('nimmt gewöhnliche Notizen nicht als Rückblick', () => {
    expect(kinds(noteBlocks('Brann kämpfte.\nMira floh.'))).toEqual(['text', 'text']);
  });
});

describe('Listen', () => {
  it('liest offene Fäden unter „Aktuelle Plothooks:“', () => {
    const [hooks] = only(noteBlocks(ABEND_EINS), 'hooks');
    expect(hooks!.items.map((line) => line.text)).toEqual([
      '* Der Schlüssel der Grotte',
      '* Wer bezahlt die Krähenbande?',
    ]);
  });

  it('teilt eine Beuteliste nach Quellen und zählt Münzen', () => {
    const [loot] = only(noteBlocks(ABEND_EINS), 'loot');
    expect(loot!.groups.map((group) => group.source?.text)).toEqual(['Krummzahn', 'Schmuggler']);
    expect(loot!.groups[0]!.items.map((line) => line.text)).toEqual([
      '12 Goldmünzen',
      '5 Silbermünzen',
      'Rostiger Schlüssel',
    ]);
    // Regelwerte nach einer Leerzeile gehören nicht mehr dazu.
    expect(blockText(loot!.lines)).not.toContain('Lair');
  });

  it('nimmt „Loot:“ ohne Quellen als eine Gruppe', () => {
    const [loot] = only(noteBlocks('Loot:\nStab der Natter\nHeiltrank\n1300 Gold'), 'loot');
    expect(loot!.groups).toHaveLength(1);
    expect(loot!.groups[0]!.source).toBeNull();
    expect(loot!.groups[0]!.items).toHaveLength(3);
  });

  it('liest Einkäufe und eine Bestellung', () => {
    const blocks = noteBlocks(ABEND_STADT);
    const [purchases] = only(blocks, 'purchases');
    expect(purchases!.rows.map((row) => [row.who, row.item, row.note])).toEqual([
      ['Brann', 'Kurzschwert +1', 'Gekauft für Lando'],
      ['Mira', 'Laterne', 'Gekauft, gegeben an Mira'],
      ['Lando', 'Seidenschal', 'Nicht gekauft'],
    ]);
    const [order] = only(blocks, 'order');
    expect(order!.items.map((line) => line.text)).toEqual(['1 Seil', '1 Zelt']);
  });

  it('rechnet Münzen in Gold um', () => {
    expect(coinGold('74 Goldmünzen')).toBe(74);
    expect(coinGold('38 Silbermünzen')).toBe(3.8);
    expect(coinGold('5 Kupfer')).toBe(0.05);
    expect(coinGold('2 Platin')).toBe(20);
    expect(coinGold('1.300 Gold')).toBe(1300);
    expect(coinGold('40 Gold wert Armband')).toBeNull();
  });
});

describe('Schriftstücke und Zitate', () => {
  it('nimmt einen Brief nach „Dort stand:“ bis zum Gruß – wörtlich', () => {
    const blocks = noteBlocks(ABEND_EINS);
    const [writing] = only(blocks, 'writing');
    expect(blockText(writing!.body)).toBe(
      'Mira,\nkommt nicht in die Grotte. Dort wartet die Bande.\nGrüße, Hagen',
    );
    const before = 'Der Bote brachte eine Nachricht von Hagen Brack.';
    expect(writingTitle(writing!, before)).toBe('Nachricht von Hagen Brack');
  });

  it('nimmt einen Zitatblock mit Überschrift als Schriftstück', () => {
    const [writing] = only(noteBlocks(ABEND_STADT), 'writing');
    expect(writing!.title).toBe('Recht der Furt');
    expect(blockText(writing!.body)).toBe(
      '## Recht der Furt\n> **Über den Zoll**\n> Wer die Furt quert, zahlt zwei Kupfer.',
    );
  });

  it('nimmt ein mehrzeiliges Zitat mit Unterschrift als Schriftstück', () => {
    const text =
      'Ein Zettel flatterte herein.\n„Geht nicht allein.\nWir sehen alles.\n— O.“\nDanach war es still.';
    const blocks = noteBlocks(text);
    expect(kinds(blocks)).toEqual(['text', 'writing', 'text']);
    const [writing] = only(blocks, 'writing');
    expect(writingTitle(writing!, 'Ein Zettel flatterte herein.')).toBe('Zettel von O.');
  });

  it('nennt die Sprache im Titel („Auf Zwergisch:“)', () => {
    const text = 'Brann fand eine Botschaft von Odo.\nAuf Zwergisch:\nDas Tor ist offen.\n— O.';
    const [writing] = only(noteBlocks(text), 'writing');
    expect(writingTitle(writing!, 'Brann fand eine Botschaft von Odo.')).toBe(
      'Botschaft von Odo (Zwergisch)',
    );
  });

  it('liest „X fragte:“ und das Gesagte darunter als Zitat', () => {
    const [quote] = only(noteBlocks(ABEND_STADT), 'quote');
    expect(quote!.intro.text).toBe('Brann fragte:');
    expect(quote!.said.text).toBe('„Wohin jetzt?“');
  });

  it('schreibt Großbuchstaben-Zeilen als Titel', () => {
    expect(titleCase('NACHRICHT VON HAGEN BRACK')).toBe('Nachricht von Hagen Brack');
    expect(titleCase('Schon gut')).toBe('Schon gut');
  });
});

describe('Regelwerte', () => {
  it('hält Werte und Zauberlisten für sich – auch mit Satzpunkt', () => {
    const text =
      'Lair Actions: Felssturz - 2W6 Schaden gegen SG 13\nLv.1: Licht, Schild\nLv 2: Nebel, Klinge, Ruf, Spur, Sicht, Gang, Ruhe, Glanz, Lied, Wort.\nBrann gewann den Kampf.';
    expect(kinds(noteBlocks(text))).toEqual(['rules', 'text']);
  });

  it('lässt einen erzählenden Satz mit Würfelwert erzählend', () => {
    const text =
      'Mira erinnerte sich an einen Traum, den sie wegen eines misslungenen Wurfs (SG 15) nicht verstand.';
    expect(kinds(noteBlocks(text))).toEqual(['text']);
  });
});
