import { describe, expect, it } from 'vitest';
import type { ArticleNode, Inline } from '../legendkeeper/model';
import {
  inlineMarkdown,
  parseInline,
  parseMarkdown,
  plainContext,
  plainWriter,
  splitTarget,
  toMarkdown,
  wikiLink,
  type MarkdownContext,
  type WriteContext,
} from './markdown';

const KNOWN: Record<string, string> = { hohenfurt: 'ort1', 'mira tannhaus': 'p1' };
const reader = (): MarkdownContext => ({
  headings: 0,
  resolve: (target) => {
    const { title, id } = splitTarget(target);
    const found = id ?? KNOWN[title.toLowerCase()];
    return found ? { id: found, title } : null;
  },
});
const writer = (): WriteContext => ({
  dropped: 0,
  targetOf: (id) =>
    id === 'ort1'
      ? { title: 'Hohenfurt', unique: true }
      : id === 'p1'
        ? { title: 'Mira Tannhaus', unique: true }
        : id === 'doppelt'
          ? { title: 'Der Markt', unique: false }
          : null,
});
const inline = (text: string) => parseInline(text, reader());
const t = (text: string, marks: Partial<Extract<Inline, { type: 'text' }>> = {}): Inline => ({
  type: 'text',
  text,
  ...marks,
});
/** Hin und zurück: Aus dem Text werden Knoten, aus den Knoten derselbe Text. */
const stable = (text: string) => {
  const nodes = parseMarkdown(text, reader());
  expect(toMarkdown(nodes, writer())).toBe(text);
  return nodes;
};

describe('Fließtext lesen', () => {
  it('erkennt Auszeichnungen, auch verschachtelt', () => {
    expect(inline('Ein **fetter** und *schräger* Satz.')).toEqual([
      t('Ein '),
      t('fetter', { bold: true }),
      t(' und '),
      t('schräger', { italic: true }),
      t(' Satz.'),
    ]);
    expect(inline('***beides*** und **fett mit *schräg* darin**')).toEqual([
      t('beides', { bold: true, italic: true }),
      t(' und '),
      t('fett mit ', { bold: true }),
      t('schräg', { bold: true, italic: true }),
      t(' darin', { bold: true }),
    ]);
    expect(inline('~~weg~~ ==wichtig== `x*y` <u>unter</u> H<sub>2</sub>O')).toEqual([
      t('weg', { strike: true }),
      t(' '),
      t('wichtig', { highlight: true }),
      t(' '),
      t('x*y', { code: true }),
      t(' '),
      t('unter', { underline: true }),
      t(' H'),
      t('2', { sub: true }),
      t('O'),
    ]);
  });

  it('lässt stehen, was keine Auszeichnung ist', () => {
    expect(inline('3 * 4 = 12 und a*')).toEqual([t('3 * 4 = 12 und a*')]);
    expect(inline('**nie geschlossen')).toEqual([t('**nie geschlossen')]);
    expect(inline('ein *offenes und **geschlossenes** Wort')).toEqual([
      t('ein *offenes und '),
      t('geschlossenes', { bold: true }),
      t(' Wort'),
    ]);
    expect(inline('Preis \\*netto\\* und \\[\\[kein Verweis]]')).toEqual([
      t('Preis *netto* und [[kein Verweis]]'),
    ]);
    expect(inline('a == b und ~~ allein')).toEqual([t('a == b und ~~ allein')]);
  });

  it('erkennt Verweise, Links und Zeilenumbrüche', () => {
    expect(inline('In [[Hohenfurt]] herrscht [[Mira Tannhaus|die Vögtin]].')).toEqual([
      t('In '),
      { type: 'mention', resourceId: 'ort1', label: 'Hohenfurt' },
      t(' herrscht '),
      { type: 'mention', resourceId: 'p1', label: 'die Vögtin' },
      t('.'),
    ]);
    // Ein Verweis ohne Artikel bleibt ein Verweis – ohne Ziel.
    expect(inline('[[Graufels]]')).toEqual([
      { type: 'mention', resourceId: '', label: 'Graufels', wanted: 'Graufels' },
    ]);
    // Gezeigt wird der eigene Wortlaut; angelegt würde der Artikel unter seinem Titel.
    expect(inline('[[Graufels|die alte Feste]]')).toEqual([
      { type: 'mention', resourceId: '', label: 'die alte Feste', wanted: 'Graufels' },
    ]);
    expect(inline('[[Der Markt~doppelt]]')).toEqual([
      { type: 'mention', resourceId: 'doppelt', label: 'Der Markt' },
    ]);
    expect(inline('Siehe [die **Karte**](https://example.org/karte).')).toEqual([
      t('Siehe '),
      t('die ', { href: 'https://example.org/karte' }),
      t('Karte', { bold: true, href: 'https://example.org/karte' }),
      t('.'),
    ]);
    // Nur sichere Adressen werden zu Links.
    expect(inline('[x](javascript:alert(1))')).toEqual([t('[x](javascript:alert(1))')]);
    expect(inline('erste Zeile  \nzweite<br>dritte')).toEqual([
      t('erste Zeile'),
      { type: 'break' },
      t('zweite'),
      { type: 'break' },
      t('dritte'),
    ]);
  });
});

describe('Blöcke lesen', () => {
  it('liest Überschriften, Absätze, Linien und Code', () => {
    const nodes = parseMarkdown(
      [
        '# Hohenfurt',
        '',
        'Erster Absatz',
        'mit zweiter Zeile.',
        '',
        '---',
        '',
        '```',
        'x = *1*',
        '```',
      ].join('\n'),
    );
    expect(nodes).toEqual([
      { type: 'heading', level: 1, inlines: [t('Hohenfurt')], anchor: 'abschnitt-1' },
      {
        type: 'paragraph',
        inlines: [t('Erster Absatz'), { type: 'break' }, t('mit zweiter Zeile.')],
      },
      { type: 'rule' },
      { type: 'code', text: 'x = *1*' },
    ]);
  });

  it('liest Listen mit Unterpunkten, Absätzen und Aufgaben', () => {
    const nodes = parseMarkdown(
      [
        '- Markt am Fünftag',
        '  - nur vormittags',
        '- Fähre',
        '',
        '  Nachts gesperrt.',
        '',
        '3. dritter',
        '4. vierter',
        '',
        '- [ ] offen',
        '- [x] erledigt',
      ].join('\n'),
    );
    expect(nodes.map((n) => n.type)).toEqual(['list', 'list', 'tasks']);
    const [bullets, numbers, tasks] = nodes;
    if (bullets?.type !== 'list' || numbers?.type !== 'list' || tasks?.type !== 'tasks')
      throw new Error('falsche Blöcke');
    expect(bullets.ordered).toBe(false);
    expect(bullets.items).toHaveLength(2);
    expect(bullets.items[0]!.map((n) => n.type)).toEqual(['paragraph', 'list']);
    expect(bullets.items[1]!.map((n) => n.type)).toEqual(['paragraph', 'paragraph']);
    expect(numbers).toMatchObject({ ordered: true, start: 3 });
    expect(tasks.items.map((i) => i.checked)).toEqual([false, true]);
  });

  it('liest Zitate und Kästen', () => {
    const nodes = parseMarkdown(
      [
        '> Ein Zitat',
        '> über zwei Zeilen.',
        '',
        '> [!geheim]',
        '> Der Rat ist bestochen.',
        '',
        '> [!warnung] Vorsicht',
        '> Brüchiges Eis.',
        '',
        '> [!stand] Vorräte',
        '> Wasser: 3/10',
      ].join('\n'),
    );
    expect(nodes.map((n) => n.type)).toEqual(['quote', 'secret', 'callout', 'meters']);
    expect(nodes[1]).toEqual({
      type: 'secret',
      children: [{ type: 'paragraph', inlines: [t('Der Rat ist bestochen.')] }],
    });
    expect(nodes[2]).toMatchObject({ type: 'callout', tone: 'warning' });
    expect(nodes[3]).toEqual({
      type: 'meters',
      title: 'Vorräte',
      items: [{ name: 'Wasser', current: 3, max: 10 }],
    });
  });

  it('liest den Steckbrief: Bild, Felder mit Überschrift, Kurztext', () => {
    const [box] = parseMarkdown(
      [
        '> [!steckbrief]',
        '> ![Porträt](https://example.org/mira.png)',
        '>',
        '> **Überblick**',
        '>',
        '> Volk: Mensch',
        '> Wohnt in: [[Hohenfurt]]',
        '>',
        '> **Zusammenfassung**',
        '>',
        '> Vögtin, streng und müde.',
      ].join('\n'),
      reader(),
    );
    expect(box).toEqual({
      type: 'infobox',
      beside: true,
      children: [
        { type: 'image', url: 'https://example.org/mira.png', alt: 'Porträt', caption: 'Porträt' },
        {
          type: 'facts',
          title: 'Überblick',
          rows: [
            { key: 'Volk', value: [t('Mensch')] },
            {
              key: 'Wohnt in',
              value: [{ type: 'mention', resourceId: 'ort1', label: 'Hohenfurt' }],
            },
          ],
        },
        {
          type: 'group',
          title: 'Zusammenfassung',
          children: [{ type: 'paragraph', inlines: [t('Vögtin, streng und müde.')] }],
        },
      ],
    });
  });

  it('liest Tabellen und Bilder', () => {
    const nodes = parseMarkdown(
      [
        '| Ware | Preis |',
        '| --- | --- |',
        '| Aal \\| geräuchert | 2 Kupfer |',
        '| Brot | |',
        '',
        '![Der Markt](https://example.org/markt.jpg "Markt am Fünftag")',
      ].join('\n'),
    );
    const [table, image] = nodes;
    if (table?.type !== 'table') throw new Error('keine Tabelle');
    expect(table.rows.map((row) => row.map((cell) => cell.header))).toEqual([
      [true, true],
      [false, false],
      [false, false],
    ]);
    expect(table.rows[1]![0]!.children).toEqual([
      { type: 'paragraph', inlines: [t('Aal | geräuchert')] },
    ]);
    expect(table.rows[2]![1]!.children).toEqual([]);
    expect(image).toEqual({
      type: 'image',
      url: 'https://example.org/markt.jpg',
      alt: 'Der Markt',
      caption: 'Markt am Fünftag',
    });
    // Ohne Kopfzeile: eine leere erste Zeile.
    const [plain] = parseMarkdown('| | |\n| --- | --- |\n| a | b |');
    expect(plain?.type === 'table' && plain.rows).toHaveLength(1);
  });

  it('übersteht Unfertiges, wie es beim Tippen entsteht', () => {
    for (const text of [
      '',
      '#',
      '> ',
      '- ',
      '[[',
      '**',
      '| a |',
      '```',
      '> [!',
      '![](',
      '1.',
      '\\',
    ])
      expect(() => parseMarkdown(text)).not.toThrow();
    expect(parseMarkdown('#keine Überschrift')).toEqual([
      { type: 'paragraph', inlines: [t('#keine Überschrift')] },
    ]);
  });
});

describe('Text schreiben', () => {
  it('setzt Auszeichnungen so, dass sie gelten', () => {
    const w = writer();
    // Leerraum am Rand wandert nach außen.
    expect(inlineMarkdown([t('Ein '), t('fetter ', { bold: true }), t('Satz')], w)).toBe(
      'Ein **fetter** Satz',
    );
    expect(
      inlineMarkdown(
        [t('fett ', { bold: true }), t('und schräg', { bold: true, italic: true })],
        w,
      ),
    ).toBe('**fett** ***und schräg***');
    expect(inlineMarkdown([t('2 * 3 [[x]] `y` <u>z</u> a==b')], w)).toBe(
      '2 \\* 3 \\[[x]] \\`y\\` \\<u>z\\</u> a\\==b',
    );
    expect(
      inlineMarkdown([t('die Karte', { href: 'https://example.org/k', italic: true }), t('.')], w),
    ).toBe('[*die Karte*](https://example.org/k).');
  });

  it('schreibt Verweise mit Titel, anderem Text und Kennung', () => {
    const w = writer();
    const mention = (resourceId: string, label: string): Inline => ({
      type: 'mention',
      resourceId,
      label,
    });
    expect(inlineMarkdown([mention('ort1', 'Hohenfurt')], w)).toBe('[[Hohenfurt]]');
    expect(inlineMarkdown([mention('ort1', 'der Stadt')], w)).toBe('[[Hohenfurt|der Stadt]]');
    expect(inlineMarkdown([mention('doppelt', 'Der Markt')], w)).toBe('[[Der Markt~doppelt]]');
    // Ein Verweis auf einen gelöschten Artikel behält seinen Namen.
    expect(inlineMarkdown([mention('weg', 'Graufels')], w)).toBe('[[Graufels]]');
    expect(inlineMarkdown([mention('weg', '')], w)).toBe('');
    expect(wikiLink('Ein [böser] Titel|x')).toBe('[[Ein böser Titel x]]');
  });

  it('schützt Zeilenanfänge, die sonst etwas anderes wären', () => {
    const paragraph = (text: string): ArticleNode => ({ type: 'paragraph', inlines: [t(text)] });
    const lines = ['# keine Überschrift', '- kein Punkt', '1. keine Zahl', '> kein Zitat', '---'];
    for (const line of lines) {
      const text = toMarkdown([paragraph(line)]);
      expect(text.startsWith('\\') || /^\d\\/.test(text)).toBe(true);
      expect(parseMarkdown(text)).toEqual([paragraph(line)]);
    }
  });

  it('lässt Platzhalter weg und zählt sie', () => {
    const w = plainWriter();
    const text = toMarkdown(
      [
        { type: 'note', reason: 'collection', count: 1 },
        {
          type: 'note',
          reason: 'embed',
          href: 'https://example.org/lied',
          kind: 'Spotify',
          count: 1,
        },
        { type: 'unknown', kind: 'x', text: 'Geretteter Text' },
      ],
      w,
    );
    expect(text).toBe('[Spotify](https://example.org/lied)\n\nGeretteter Text');
    expect(w.dropped).toBe(1);
  });
});

describe('Hin und zurück', () => {
  it('bleibt gleich: ein ganzer Artikel', () => {
    const nodes = stable(
      [
        '> [!steckbrief]',
        '> ![Wappen](https://example.org/wappen.png)',
        '>',
        '> **Überblick**',
        '>',
        '> Art: Stadt',
        '> Liegt in: [[Hohenfurt]], [[Graufels]]',
        '>',
        '> **Zusammenfassung**',
        '>',
        '> Eine Hafenstadt.',
        '',
        '# Überblick',
        '',
        'Hier herrscht [[Mira Tannhaus|die Vögtin]] – **streng**, aber *gerecht*.',
        'Zweite Zeile desselben Absatzes.',
        '',
        '## Viertel',
        '',
        '- Hafen',
        '  - Speicher',
        '  - Kai',
        '- Markt',
        '',
        '1. Erst zahlen',
        '2. Dann fahren',
        '',
        '> Wer die Fähre nimmt, zahlt doppelt.',
        '',
        '> [!geheim]',
        '> Der Rat ist bestochen.',
        '>',
        '> - Zeuge: der Fährmann',
        '',
        '| Ware | Preis |',
        '| --- | --- |',
        '| Aal | 2 Kupfer |',
        '',
        '![Der Markt](https://example.org/markt.jpg)',
        '',
        '---',
        '',
        '```',
        'Losung: *Aal*',
        '```',
      ].join('\n'),
    );
    expect(nodes.map((n) => n.type)).toEqual([
      'infobox',
      'heading',
      'paragraph',
      'heading',
      'list',
      'list',
      'quote',
      'secret',
      'table',
      'image',
      'rule',
      'code',
    ]);
  });

  it('bleibt gleich: Knoten → Text → Knoten', () => {
    const nodes: ArticleNode[] = [
      {
        type: 'paragraph',
        inlines: [
          t('Sterne *zählen*, '),
          t(' fett mit Rand ', { bold: true }),
          t('und'),
          { type: 'break' },
          t('# kein Titel', { italic: true }),
        ],
      },
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [
          [
            { type: 'paragraph', inlines: [t('Punkt')] },
            { type: 'quote', children: [{ type: 'paragraph', inlines: [t('darin ein Zitat')] }] },
          ],
        ],
      },
      { type: 'expand', title: 'Mehr', children: [{ type: 'paragraph', inlines: [t('Text')] }] },
    ];
    const back = parseMarkdown(toMarkdown(nodes), plainContext());
    // Leerraum am Rand der Auszeichnung wandert nach außen – der Wortlaut bleibt.
    expect(back).toEqual([
      {
        type: 'paragraph',
        inlines: [
          t('Sterne *zählen*,  '),
          t('fett mit Rand', { bold: true }),
          t(' und'),
          { type: 'break' },
          t('# kein Titel', { italic: true }),
        ],
      },
      nodes[1],
      nodes[2],
    ]);
  });
});
