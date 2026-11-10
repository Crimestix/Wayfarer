import { describe, expect, it } from 'vitest';
import {
  blockInsertion,
  togglePrefix,
  calloutHeader,
  calloutKind,
  calloutLabel,
  continueMarkup,
  factKeyLength,
  hasExactMatch,
  imageLine,
  imageLines,
  isRule,
  linkQueryBefore,
  linkText,
  quotePrefixLength,
  shiftListIndent,
  splitTarget,
  toggleWrap,
  toggledTaskBox,
  wikiLinkParts,
  type WrapResult,
} from './helpers';

/** Wendet das Ergebnis von `toggleWrap` an und zeigt die Auswahl mit ‹ › (Cursor: ‹›). */
function applied(text: string, result: WrapResult): string {
  let out = text;
  for (const change of [...result.changes].reverse())
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  return `${out.slice(0, result.from)}‹${out.slice(result.from, result.to)}›${out.slice(result.to)}`;
}

/** Schaltet die Auszeichnung um die mit ‹ › markierte Auswahl um. */
function toggle(marked: string, before: string, after = before): string {
  const from = marked.indexOf('‹');
  const to = marked.indexOf('›') - 1;
  const text = marked.replace('‹', '').replace('›', '');
  return applied(text, toggleWrap(text, from, to, before, after));
}

describe('Verweise', () => {
  it('trennt Titel und Kennung', () => {
    expect(splitTarget('Morgenfurt')).toEqual({ title: 'Morgenfurt', id: null });
    expect(splitTarget('Morgenfurt~a1B2')).toEqual({ title: 'Morgenfurt', id: 'a1B2' });
    expect(splitTarget('Ungefähr ~ zwei')).toEqual({ title: 'Ungefähr ~ zwei', id: null });
  });

  it('zeigt den Titel, wenn kein anderer Text angegeben ist', () => {
    expect(wikiLinkParts('Morgenfurt')).toEqual({
      target: 'Morgenfurt',
      display: 'Morgenfurt',
      showFrom: 0,
      showTo: 10,
    });
  });

  it('zeigt den Text hinter dem Strich', () => {
    const parts = wikiLinkParts('Morgenfurt|die Stadt am Fluss');
    expect(parts.target).toBe('Morgenfurt');
    expect(parts.display).toBe('die Stadt am Fluss');
    expect('Morgenfurt|die Stadt am Fluss'.slice(parts.showFrom, parts.showTo)).toBe(
      'die Stadt am Fluss',
    );
  });

  it('blendet die Kennung aus', () => {
    const inner = 'Alte Mühle~x9_k';
    const parts = wikiLinkParts(inner);
    expect(parts.target).toBe('Alte Mühle~x9_k');
    expect(parts.display).toBe('Alte Mühle');
    expect(inner.slice(parts.showFrom, parts.showTo)).toBe('Alte Mühle');
  });

  it('kommt mit Leerraum und leerem Text hinter dem Strich zurecht', () => {
    const inner = ' Alte Mühle | ';
    const parts = wikiLinkParts(inner);
    expect(parts.target).toBe('Alte Mühle');
    expect(parts.display).toBe('Alte Mühle');
    expect(inner.slice(parts.showFrom, parts.showTo)).toBe('Alte Mühle');
  });

  it('schreibt einen Verweis ohne störende Zeichen', () => {
    expect(linkText('Alte Mühle')).toBe('[[Alte Mühle]]');
    expect(linkText('Alte [Mühle]\nam Bach')).toBe('[[Alte Mühle am Bach]]');
    expect(linkText('Alte Mühle~x9|die Mühle')).toBe('[[Alte Mühle~x9|die Mühle]]');
  });
});

describe('Anfrage für Vorschläge', () => {
  it('erkennt das Getippte nach zwei eckigen Klammern', () => {
    expect(linkQueryBefore('Sie reisen nach [[Mor')).toEqual({
      from: 16,
      query: 'Mor',
      trigger: 'brackets',
    });
    expect(linkQueryBefore('[[')).toEqual({ from: 0, query: '', trigger: 'brackets' });
    expect(linkQueryBefore('[[Alte Mü')?.query).toBe('Alte Mü');
  });

  it('schweigt, sobald der Verweis geschlossen ist oder ein eigener Text beginnt', () => {
    expect(linkQueryBefore('[[Morgenfurt]]')).toBeNull();
    expect(linkQueryBefore('[[Morgenfurt]] und')).toBeNull();
    expect(linkQueryBefore('[[Morgenfurt|die St')).toBeNull();
    expect(linkQueryBefore('[Text')).toBeNull();
  });

  it('nimmt nach einem geschlossenen Verweis den nächsten offenen', () => {
    expect(linkQueryBefore('[[Morgenfurt]] und [[Alt')).toEqual({
      from: 19,
      query: 'Alt',
      trigger: 'brackets',
    });
  });

  it('erkennt das @ am Wortanfang', () => {
    expect(linkQueryBefore('@')).toEqual({ from: 0, query: '', trigger: 'at' });
    expect(linkQueryBefore('Gespräch mit @Hil')).toEqual({ from: 13, query: 'Hil', trigger: 'at' });
    expect(linkQueryBefore('(@Hil')?.query).toBe('Hil');
    expect(linkQueryBefore('@Alte Mühle')?.query).toBe('Alte Mühle');
  });

  it('lässt ein @ mitten im Wort und nach einem Leerzeichen in Ruhe', () => {
    expect(linkQueryBefore('bote@hafen')).toBeNull();
    expect(linkQueryBefore('@Hilda ')).toBeNull();
    expect(linkQueryBefore('Preis @ ')).toBeNull();
    expect(linkQueryBefore('@eins zwei drei vier fünf')).toBeNull();
  });

  it('findet einen genauen Treffer unabhängig von der Schreibung', () => {
    const suggestions = [
      { label: 'Alte Mühle', target: 'Alte Mühle~x9' },
      { label: 'Morgenfurt (Stadt)', target: 'Morgenfurt' },
    ];
    expect(hasExactMatch('alte mühle', suggestions)).toBe(true);
    expect(hasExactMatch('Morgenfurt', suggestions)).toBe(true);
    expect(hasExactMatch('Morgen', suggestions)).toBe(false);
  });
});

describe('Auszeichnung umschalten', () => {
  it('setzt Fett um die Auswahl und nimmt es wieder weg', () => {
    expect(toggle('ein ‹wichtiges› Wort', '**')).toBe('ein **‹wichtiges›** Wort');
    expect(toggle('ein **‹wichtiges›** Wort', '**')).toBe('ein ‹wichtiges› Wort');
    expect(toggle('ein ‹**wichtiges**› Wort', '**')).toBe('ein ‹wichtiges› Wort');
  });

  it('lässt Leerraum am Rand der Auswahl draußen', () => {
    expect(toggle('ein‹ wichtiges ›Wort', '**')).toBe('ein **‹wichtiges›** Wort');
  });

  it('setzt ohne Auswahl ein leeres Paar und entfernt es wieder', () => {
    expect(toggle('ein ‹›Wort', '**')).toBe('ein **‹›**Wort');
    expect(toggle('ein **‹›**Wort', '**')).toBe('ein ‹›Wort');
  });

  it('unterscheidet kursiv von fett', () => {
    expect(toggle('‹Wort›', '*')).toBe('*‹Wort›*');
    expect(toggle('*‹Wort›*', '*')).toBe('‹Wort›');
    // Fett allein ist nicht kursiv: Es kommt ein Sternchen dazu.
    expect(toggle('**‹Wort›**', '*')).toBe('***‹Wort›***');
    expect(toggle('***‹Wort›***', '*')).toBe('**‹Wort›**');
    expect(toggle('***‹Wort›***', '**')).toBe('*‹Wort›*');
    // Kursiv allein ist nicht fett.
    expect(toggle('*‹Wort›*', '**')).toBe('***‹Wort›***');
  });

  it('arbeitet auch mit ungleichen Zeichen', () => {
    expect(toggle('‹Wort›', '<u>', '</u>')).toBe('<u>‹Wort›</u>');
    expect(toggle('<u>‹Wort›</u>', '<u>', '</u>')).toBe('‹Wort›');
    expect(toggle('nach ‹Morgenfurt›', '[[', ']]')).toBe('nach [[‹Morgenfurt›]]');
    expect(toggle('nach ‹[[Morgenfurt]]›', '[[', ']]')).toBe('nach ‹Morgenfurt›');
  });

  it('nimmt die Auswahl in jeder Richtung', () => {
    const text = 'ein Wort';
    expect(applied(text, toggleWrap(text, 8, 4, '==', '=='))).toBe('ein ==‹Wort›==');
  });
});

describe('Kästen', () => {
  it('nennt die Art auf Deutsch', () => {
    expect(calloutLabel('geheim')).toBe('Geheim');
    expect(calloutLabel('steckbrief')).toBe('Steckbrief');
    expect(calloutLabel('info')).toBe('Hinweis');
    expect(calloutLabel('notiz')).toBe('Notiz');
    expect(calloutLabel('tipp')).toBe('Tipp');
    expect(calloutLabel('warnung')).toBe('Warnung');
    expect(calloutLabel('gefahr')).toBe('Gefahr');
    expect(calloutLabel('aufklappen')).toBe('Aufklappen');
    expect(calloutLabel('stand')).toBe('Stand');
  });

  it('kennt die anderen Schreibweisen und fällt sonst auf den Hinweis zurück', () => {
    expect(calloutKind('SECRET')).toBe('geheim');
    expect(calloutKind('Zähler')).toBe('stand');
    expect(calloutKind('warning')).toBe('warnung');
    expect(calloutKind('irgendwas')).toBe('info');
  });

  it('liest die erste Zeile eines Kastens', () => {
    expect(calloutHeader('> [!geheim]')).toEqual({
      kind: 'geheim',
      label: 'Geheim',
      markerLength: 11,
      title: '',
    });
    const header = calloutHeader('> [!aufklappen]- Was im Keller liegt');
    expect(header?.kind).toBe('aufklappen');
    expect(header?.title).toBe('Was im Keller liegt');
    expect('> [!aufklappen]- Was im Keller liegt'.slice(header!.markerLength)).toBe(
      'Was im Keller liegt',
    );
    expect(calloutHeader('>[!stand] Vorräte')?.title).toBe('Vorräte');
  });

  it('hält gewöhnliche Zitate und Text nicht für Kästen', () => {
    expect(calloutHeader('> Ein Zitat')).toBeNull();
    expect(calloutHeader('[!geheim]')).toBeNull();
    expect(calloutHeader('> > [!geheim]')).toBeNull();
  });

  it('misst die Zitatzeichen am Zeilenanfang', () => {
    expect(quotePrefixLength('> Text')).toBe(2);
    expect(quotePrefixLength('>Text')).toBe(1);
    expect(quotePrefixLength('> > Text')).toBe(4);
    expect(quotePrefixLength('Text > mehr')).toBe(0);
  });

  it('erkennt das Feld einer Steckbriefzeile', () => {
    expect(factKeyLength('Herkunft: Morgenfurt')).toBe(9);
    expect(factKeyLength('Herkunft:')).toBe(9);
    expect(factKeyLength('Ohne Feld')).toBe(0);
    expect(factKeyLength('**Gruppentitel**')).toBe(0);
    expect(factKeyLength('Zeit:12 Uhr')).toBe(0);
  });
});

describe('Eingabetaste', () => {
  it('setzt eine Liste fort', () => {
    expect(continueMarkup('- Fackeln', 9)).toEqual({ kind: 'continue', insert: '\n- ' });
    expect(continueMarkup('  * Seil', 8)).toEqual({ kind: 'continue', insert: '\n  * ' });
  });

  it('zählt nummerierte Listen weiter', () => {
    expect(continueMarkup('1. Aufbruch', 11)).toEqual({ kind: 'continue', insert: '\n2. ' });
    expect(continueMarkup('9) Rast', 7)).toEqual({ kind: 'continue', insert: '\n10) ' });
  });

  it('setzt Aufgaben mit einem leeren Kästchen fort', () => {
    expect(continueMarkup('- [x] Karte zeichnen', 20)).toEqual({
      kind: 'continue',
      insert: '\n- [ ] ',
    });
  });

  it('beendet die Liste bei einem leeren Punkt', () => {
    expect(continueMarkup('- ', 2)).toEqual({ kind: 'end', from: 0, to: 2, insert: '' });
    expect(continueMarkup('3. ', 3)).toEqual({ kind: 'end', from: 0, to: 3, insert: '' });
    expect(continueMarkup('- [ ] ', 6)).toEqual({ kind: 'end', from: 0, to: 6, insert: '' });
  });

  it('rückt einen leeren eingerückten Punkt erst aus', () => {
    expect(continueMarkup('    - ', 6)).toEqual({ kind: 'end', from: 0, to: 2, insert: '' });
  });

  it('setzt Zitate und Kästen fort', () => {
    expect(continueMarkup('> Ein Zitat', 11)).toEqual({ kind: 'continue', insert: '\n> ' });
    expect(continueMarkup('> [!geheim]', 11)).toEqual({ kind: 'continue', insert: '\n> ' });
    expect(continueMarkup('>eng', 4)).toEqual({ kind: 'continue', insert: '\n> ' });
  });

  it('beendet das Zitat bei einer leeren Zeile', () => {
    expect(continueMarkup('> ', 2)).toEqual({ kind: 'end', from: 0, to: 2, insert: '' });
    expect(continueMarkup('>', 1)).toEqual({ kind: 'end', from: 0, to: 1, insert: '' });
  });

  it('führt Listen im Kasten weiter und beendet sie dort', () => {
    expect(continueMarkup('> - Dolch', 9)).toEqual({ kind: 'continue', insert: '\n> - ' });
    expect(continueMarkup('> - ', 4)).toEqual({ kind: 'end', from: 2, to: 4, insert: '' });
  });

  it('mischt sich sonst nicht ein', () => {
    expect(continueMarkup('Gewöhnlicher Text', 5)).toBeNull();
    expect(continueMarkup('---', 3)).toBeNull();
    expect(continueMarkup('- - -', 5)).toBeNull();
    expect(continueMarkup('*kursiv* am Anfang', 18)).toBeNull();
    // Cursor noch vor dem Text des Punktes: gewöhnlicher Umbruch.
    expect(continueMarkup('- Fackeln', 0)).toBeNull();
    expect(continueMarkup('> Zitat', 1)).toBeNull();
  });
});

describe('Listen einrücken', () => {
  it('rückt ein und aus', () => {
    expect(shiftListIndent('- Seil', 1)).toEqual({ from: 0, to: 0, insert: '  ' });
    expect(shiftListIndent('  - Seil', -1)).toEqual({ from: 0, to: 2, insert: '' });
    expect(shiftListIndent(' 1. Seil', -1)).toEqual({ from: 0, to: 1, insert: '' });
  });

  it('rückt im Kasten hinter den Zitatzeichen ein', () => {
    expect(shiftListIndent('> - Seil', 1)).toEqual({ from: 2, to: 2, insert: '  ' });
    expect(shiftListIndent('>   - Seil', -1)).toEqual({ from: 2, to: 4, insert: '' });
  });

  it('lässt alles andere stehen', () => {
    expect(shiftListIndent('- Seil', -1)).toBeNull();
    expect(shiftListIndent('Text', 1)).toBeNull();
    expect(shiftListIndent('---', 1)).toBeNull();
  });

  it('schaltet ein Aufgabenkästchen um', () => {
    expect(toggledTaskBox('[ ]')).toBe('[x]');
    expect(toggledTaskBox('[x]')).toBe('[ ]');
    expect(toggledTaskBox('[X]')).toBe('[ ]');
    expect(toggledTaskBox('[y]')).toBeNull();
  });
});

describe('Linien und Bilder', () => {
  it('erkennt eine Linie', () => {
    expect(isRule('---')).toBe(true);
    expect(isRule('* * *')).toBe(true);
    expect(isRule('--')).toBe(false);
    expect(isRule('- Punkt')).toBe(false);
  });

  it('liest eine Bildzeile', () => {
    expect(imageLine('![Die Mühle](https://example.org/muehle.jpg)')).toEqual({
      alt: 'Die Mühle',
      url: 'https://example.org/muehle.jpg',
    });
    expect(imageLine('> ![](https://example.org/a.png "Am Abend")')).toEqual({
      alt: '',
      url: 'https://example.org/a.png',
    });
  });

  it('nimmt nur ganze Zeilen und sichere Adressen', () => {
    expect(imageLine('Text ![Bild](https://example.org/a.png)')).toBeNull();
    expect(imageLine('![Bild](https://example.org/a.png) und Text')).toBeNull();
    expect(imageLine('![Bild](http://example.org/a.png)')).toBeNull();
    expect(imageLine('![Bild](javascript:alert(1))')).toBeNull();
  });

  it('erkennt Bilder nicht als Steckbrieffeld', () => {
    expect(factKeyLength('- Feld: Wert')).toBe(0);
    expect(factKeyLength('![Bild: Mühle](https://example.org/a.png)')).toBe(0);
  });

  it('findet Bildzeilen im Text, aber nicht im Codeblock', () => {
    const text = [
      '# Die Mühle',
      '![Vorn](https://example.org/vorn.jpg)',
      '```',
      '![Im Code](https://example.org/code.jpg)',
      '```',
      '> [!steckbrief]',
      '> ![Hinten](https://example.org/hinten.jpg)',
    ];
    expect(imageLines(text)).toEqual([
      { index: 1, alt: 'Vorn', url: 'https://example.org/vorn.jpg' },
      { index: 6, alt: 'Hinten', url: 'https://example.org/hinten.jpg' },
    ]);
  });
});

describe('Zeilenanfänge umschalten', () => {
  it('setzt den Anfang vor jede Zeile und nimmt ihn wieder weg', () => {
    expect(togglePrefix(['Seil', 'Fackeln'], '- ')).toEqual(['- Seil', '- Fackeln']);
    expect(togglePrefix(['- Seil', '- Fackeln'], '- ')).toEqual(['Seil', 'Fackeln']);
    expect(togglePrefix(['Ein Zitat'], '> ')).toEqual(['> Ein Zitat']);
    expect(togglePrefix(['> Ein Zitat'], '> ')).toEqual(['Ein Zitat']);
  });

  it('ergänzt, wenn nur manche Zeilen ihn schon haben', () => {
    expect(togglePrefix(['- Seil', 'Fackeln'], '- ')).toEqual(['- Seil', '- Fackeln']);
  });

  it('lässt leere Zeilen zwischen mehreren aus, füllt aber eine einzelne', () => {
    expect(togglePrefix(['Seil', '', 'Fackeln'], '- ')).toEqual(['- Seil', '', '- Fackeln']);
    expect(togglePrefix(['- Seil', '', '- Fackeln'], '- ')).toEqual(['Seil', '', 'Fackeln']);
    expect(togglePrefix([''], '- ')).toEqual(['- ']);
  });

  it('ersetzt eine Überschrift durch eine andere', () => {
    expect(togglePrefix(['Die Mühle'], '## ')).toEqual(['## Die Mühle']);
    expect(togglePrefix(['# Die Mühle'], '## ')).toEqual(['## Die Mühle']);
    expect(togglePrefix(['### Die Mühle'], '# ')).toEqual(['# Die Mühle']);
    expect(togglePrefix(['## Die Mühle'], '## ')).toEqual(['Die Mühle']);
  });

  it('zählt nummerierte Listen durch', () => {
    expect(togglePrefix(['Aufbruch', 'Rast', 'Ankunft'], '1. ')).toEqual([
      '1. Aufbruch',
      '2. Rast',
      '3. Ankunft',
    ]);
    expect(togglePrefix(['1. Aufbruch', '2. Rast'], '1. ')).toEqual(['Aufbruch', 'Rast']);
    expect(togglePrefix(['7. Aufbruch', 'Rast'], '1. ')).toEqual(['1. Aufbruch', '2. Rast']);
  });
});

describe('Absatz einfügen', () => {
  const insert = (text: string, pos: number, block: string) => {
    const change = blockInsertion(text, pos, block);
    const out = text.slice(0, change.from) + change.insert + text.slice(change.to);
    return `${out.slice(0, change.cursor)}‸${out.slice(change.cursor)}`;
  };

  it('fügt hinter dem Absatz ein, in dem die Schreibmarke steht', () => {
    expect(insert('Erster Absatz\nzweite Zeile\n\nZweiter Absatz', 3, '---')).toBe(
      'Erster Absatz\nzweite Zeile\n\n---‸\n\nZweiter Absatz',
    );
  });

  it('erzeugt keine doppelten Leerzeilen', () => {
    expect(insert('Eins\n\n\n\nZwei', 2, 'Neu')).toBe('Eins\n\nNeu‸\n\nZwei');
    expect(insert('Eins\nZwei', 0, 'Neu')).toBe('Eins\nZwei\n\nNeu‸');
  });

  it('nutzt die Leerzeile, in der die Schreibmarke steht', () => {
    expect(insert('Eins\n\nZwei', 5, 'Neu')).toBe('Eins\n\nNeu‸\n\nZwei');
    expect(insert('Eins\n\n\nZwei', 6, 'Neu')).toBe('Eins\n\nNeu‸\n\nZwei');
  });

  it('kommt mit leerem Text, Anfang und Ende zurecht', () => {
    expect(insert('', 0, 'Neu')).toBe('Neu‸');
    expect(insert('\nEins', 0, 'Neu')).toBe('Neu‸\n\nEins');
    expect(insert('Eins\n', 5, 'Neu')).toBe('Eins\n\nNeu‸');
    expect(insert('Eins', 4, '> [!geheim]\n> Text\n')).toBe('Eins\n\n> [!geheim]\n> Text‸');
  });

  it('hält einen Kasten zusammen', () => {
    expect(insert('> [!info]\n> Zeile\n\nText', 4, 'Neu')).toBe(
      '> [!info]\n> Zeile\n\nNeu‸\n\nText',
    );
  });
});
