import { describe, expect, it } from 'vitest';
import {
  articleBody,
  articleHead,
  convertBlocks,
  convertProperties,
  convertRuns,
  docLabel,
  inlineText,
  internalTarget,
  linkedResourceIds,
  newContext,
  nodeText,
  noteText,
  safeHref,
  safeImageUrl,
  shortPath,
  type ArticleNode,
} from '../model';
import type { LkDocumentBlocks, LkResource } from '../types';
import { fixture } from './fixtures';

const PROJECT = 'cbeispielprojekt000000001';
const blocks = fixture<LkDocumentBlocks>('blocks.json');
const resource = fixture<LkResource>('resource.json');

const one = (block: unknown): ArticleNode[] => convertBlocks([block], newContext(PROJECT));
const ofType = <T extends ArticleNode['type']>(nodes: ArticleNode[], type: T) =>
  nodes.filter((node): node is Extract<ArticleNode, { type: T }> => node.type === type);

describe('Textläufe', () => {
  it('übernimmt Auszeichnungen und lässt Unbekanntes weg', () => {
    const inlines = convertRuns(
      [
        { text: 'fett', bold: true, italic: true },
        { text: ' normal', color: '#FF0000', highlight: '#00FF00', blinkt: true },
        { icon: { name: 'fas fa-heart' } },
        { text: '' },
      ],
      newContext(),
    );
    expect(inlines).toEqual([
      { type: 'text', text: 'fett', bold: true, italic: true },
      { type: 'text', text: ' normal', highlight: true },
    ]);
  });

  it('zeigt Verweise mit Beschriftung, sonst mit dem Namen des Artikels', () => {
    const inlines = convertRuns(
      [
        { mention: { resourceId: 'a1', name: 'Voss', text: 'Hauptmann Voss' } },
        { mention: { resourceId: 'a2', name: 'Nebelküste', documentId: 'd9' } },
        { mention: { resourceId: 'a3' } },
        { mention: { name: 'ohne Ziel' } },
      ],
      newContext(),
    );
    expect(inlines).toEqual([
      { type: 'mention', resourceId: 'a1', label: 'Hauptmann Voss' },
      { type: 'mention', resourceId: 'a2', label: 'Nebelküste', documentId: 'd9' },
      { type: 'mention', resourceId: 'a3', label: 'Unbenannter Artikel' },
      { type: 'text', text: 'ohne Ziel' },
    ]);
  });

  it('lässt nur ungefährliche Adressen als Link zu', () => {
    expect(safeHref('https://example.org/a b')).toBe('https://example.org/a%20b');
    expect(safeHref('mailto:sl@example.org')).toBe('mailto:sl@example.org');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,x')).toBeUndefined();
    expect(safeHref('/relativ')).toBeUndefined();
    expect(safeImageUrl('http://example.org/bild.png')).toBeUndefined();
    expect(safeImageUrl('https://assets.legendkeeper.com/bild.webp')).toBe(
      'https://assets.legendkeeper.com/bild.webp',
    );
    const [inline] = convertRuns([{ text: 'klick', link: 'javascript:alert(1)' }], newContext());
    expect(inline).toEqual({ type: 'text', text: 'klick' });
  });

  it('macht Links auf Artikel des eigenen Projekts zu Verweisen', () => {
    expect(internalTarget(`https://www.legendkeeper.com/p/${PROJECT}/hausdusk`, PROJECT)).toEqual({
      resourceId: 'hausdusk',
    });
    expect(
      internalTarget(`https://www.legendkeeper.com/p/${PROJECT}/hausdusk/doc1/`, PROJECT),
    ).toEqual({
      resourceId: 'hausdusk',
      documentId: 'doc1',
    });
    expect(
      internalTarget('https://www.legendkeeper.com/p/anderesprojekt/hausdusk', PROJECT),
    ).toBeNull();
    expect(
      internalTarget(`https://legendkeeper.com.example.org/p/${PROJECT}/x`, PROJECT),
    ).toBeNull();
    expect(internalTarget(`https://www.legendkeeper.com/p/${PROJECT}/x`, undefined)).toBeNull();
    // Frühere Schreibweise der Adresse; LegendKeeper leitet sie heute um.
    expect(
      internalTarget(`https://www.legendkeeper.com/app/${PROJECT}/hausdusk/`, PROJECT),
    ).toEqual({ resourceId: 'hausdusk' });
    expect(
      internalTarget(`https://www.legendkeeper.com/api/${PROJECT}/hausdusk`, PROJECT),
    ).toBeNull();
  });

  it('entfernt Zeilenumbrüche am Rand', () => {
    const inlines = convertRuns(
      [{ break: true }, { text: 'a' }, { break: true }, { text: 'b' }, { break: true }],
      newContext(),
    );
    expect(inlineText(inlines)).toBe('a\nb');
  });
});

describe('Blöcke umwandeln', () => {
  it('lässt leere Absätze, Listenpunkte und Tabellen weg', () => {
    expect(one({ kind: 'paragraph', content: [] })).toEqual([]);
    expect(one({ kind: 'paragraph', content: [{ text: '   ' }] })).toEqual([]);
    expect(
      one({
        kind: 'bulletList',
        children: [{ kind: 'listItem', children: [{ kind: 'paragraph', content: [] }] }],
      }),
    ).toEqual([]);
    expect(
      one({
        kind: 'table',
        children: [
          {
            kind: 'tableRow',
            children: [{ kind: 'tableCell', children: [{ kind: 'paragraph', content: [] }] }],
          },
        ],
      }),
    ).toEqual([]);
    expect(one({ kind: 'quote', children: [] })).toEqual([]);
  });

  it('begrenzt Überschriften auf sechs Ebenen und vergibt Sprungmarken', () => {
    const nodes = convertBlocks(
      [
        { kind: 'heading', level: 9, content: [{ text: 'Tief' }] },
        { kind: 'heading', content: [{ text: 'Ohne Ebene' }] },
        { kind: 'heading', level: 1, content: [] },
      ],
      newContext(),
    );
    expect(nodes).toEqual([
      {
        type: 'heading',
        level: 6,
        inlines: [{ type: 'text', text: 'Tief' }],
        anchor: 'lk-abschnitt-1',
      },
      {
        type: 'heading',
        level: 2,
        inlines: [{ type: 'text', text: 'Ohne Ebene' }],
        anchor: 'lk-abschnitt-2',
      },
    ]);
  });

  it('baut verschachtelte Listen', () => {
    const body = articleBody(blocks.blocks, PROJECT).body;
    const [bullets, numbered] = ofType(body, 'list');
    expect(bullets?.ordered).toBe(false);
    // Der leere vierte Punkt entfällt.
    expect(bullets?.items).toHaveLength(3);
    const nested = bullets?.items[1]?.[1];
    expect(nested?.type).toBe('list');
    expect(nested && nodeText(nested)).toBe('Kontor der Duskryn\nZollhaus mit dem Glockenturm');
    expect(numbered).toMatchObject({ ordered: true, start: 1 });
    expect(numbered?.items).toHaveLength(3);
  });

  it('baut Tabellen mit Kopfzeile und behält leere Zellen', () => {
    const [table] = ofType(articleBody(blocks.blocks, PROJECT).body, 'table');
    expect(table?.rows).toHaveLength(4);
    expect(table?.rows[0]?.every((cell) => cell.header)).toBe(true);
    expect(table?.rows[2]?.map((cell) => cell.children.length)).toEqual([1, 1, 0]);
    expect(table?.rows[1]?.[0]).toMatchObject({ header: false, colSpan: 1, rowSpan: 1 });
  });

  it('übernimmt Zusammenfassungen von Zellen', () => {
    const [table] = ofType(
      one({
        kind: 'table',
        children: [
          {
            kind: 'tableRow',
            children: [
              {
                kind: 'tableCell',
                colspan: 3,
                rowspan: 2,
                children: [{ kind: 'paragraph', content: [{ text: 'x' }] }],
              },
            ],
          },
        ],
      }),
      'table',
    );
    expect(table?.rows[0]?.[0]).toMatchObject({ colSpan: 3, rowSpan: 2 });
  });

  it('kennzeichnet Geheimes, Hinweiskästen und Aufklappbares', () => {
    const body = articleBody(blocks.blocks, PROJECT).body;
    const [secret] = ofType(body, 'secret');
    expect(secret?.children.map((child) => child.type)).toEqual(['paragraph', 'tasks']);
    expect(ofType(secret?.children ?? [], 'tasks')[0]?.items.map((item) => item.checked)).toEqual([
      true,
      false,
    ]);
    expect(ofType(body, 'callout')[0]?.tone).toBe('warning');
    expect(ofType(body, 'expand')[0]?.title).toBe('Zufallsbegegnungen am Kai');
    expect(
      one({
        kind: 'callout',
        tone: 'schrill',
        children: [{ kind: 'paragraph', content: [{ text: 'x' }] }],
      }),
    ).toMatchObject([{ tone: 'note' }]);
  });

  it('zeigt Bilder nur mit sicherer Adresse und mit sichtbarem Titel als Bildunterschrift', () => {
    const [image] = ofType(articleBody(blocks.blocks, PROJECT).body, 'image');
    expect(image).toEqual({
      type: 'image',
      url: 'https://assets.legendkeeper.com/beispiel-kai-bei-ebbe.webp',
      alt: 'Kai',
      caption: 'Der Kai bei Ebbe',
    });
    expect(one({ kind: 'image', url: '', title: 'Image', isTitleHidden: true })).toEqual([]);
    expect(one({ kind: 'image', url: 'javascript:alert(1)' })).toMatchObject([
      { type: 'note', reason: 'image' },
    ]);
    expect(
      one({
        kind: 'image',
        url: 'https://assets.legendkeeper.com/x.webp',
        title: 'Image',
        isTitleHidden: true,
      }),
    ).toEqual([{ type: 'image', url: 'https://assets.legendkeeper.com/x.webp', alt: '' }]);
  });

  it('macht aus mehreren Spalten ein Spaltenlayout, aus einer einzigen Fließtext', () => {
    const secrets = fixture<LkDocumentBlocks>('blocks-secrets.json');
    const [columns] = ofType(convertBlocks(secrets.blocks, newContext()), 'columns');
    expect(columns?.columns).toHaveLength(2);
    const single = one({
      kind: 'layout',
      children: [
        { kind: 'layoutColumn', children: [{ kind: 'paragraph', content: [{ text: 'allein' }] }] },
        { kind: 'layoutColumn', children: [{ kind: 'paragraph', content: [] }] },
      ],
    });
    expect(single).toEqual([{ type: 'paragraph', inlines: [{ type: 'text', text: 'allein' }] }]);
  });

  it('zeigt Titel nur, wenn jemand sie vergeben hat – nicht die Vorgaben von LegendKeeper', () => {
    const facts = (title: string, extra: object = {}) =>
      ofType(
        one({ kind: 'keyValue', title, rows: [{ key: 'a', text: 'b' }], ...extra }),
        'facts',
      )[0]?.title;
    expect(facts('Stats')).toBeUndefined();
    expect(facts('STATS')).toBeUndefined();
    expect(facts('Eckdaten')).toBe('Eckdaten');
    expect(facts('Eckdaten', { isTitleHidden: true })).toBeUndefined();
    expect(
      ofType(
        one({ kind: 'image', url: 'https://assets.legendkeeper.com/x.webp', title: 'Image' }),
        'image',
      )[0]?.caption,
    ).toBeUndefined();
    expect(
      ofType(
        one({
          kind: 'textField',
          title: 'Text',
          children: [{ kind: 'paragraph', content: [{ text: 'x' }] }],
        }),
        'group',
      )[0]?.title,
    ).toBeUndefined();
    // „Image“ als Titel eines Textfelds ist kein Vorgabetitel und bleibt stehen.
    expect(
      ofType(
        one({
          kind: 'textField',
          title: 'Image',
          children: [{ kind: 'paragraph', content: [{ text: 'x' }] }],
        }),
        'group',
      )[0]?.title,
    ).toBe('Image');
  });

  it('zeigt Anzeigen (Balken) mit ihren Werten', () => {
    const secrets = fixture<LkDocumentBlocks>('blocks-secrets.json');
    const [meters] = ofType(convertBlocks(secrets.blocks, newContext()), 'meters');
    expect(meters).toEqual({
      type: 'meters',
      title: 'Unruhe in der Stadt',
      items: [
        { name: 'Dornengasse', current: 4, max: 6 },
        { name: 'Oberstadt', current: 1, max: 6 },
      ],
    });
  });
});

describe('Nichts verschlucken', () => {
  const body = articleBody(blocks.blocks, PROJECT).body;

  it('zeigt Inhalte, die LegendKeeper nicht herausgibt, als einen zusammengefassten Hinweis', () => {
    const notes = ofType(body, 'note').filter((node) => node.reason === 'unsupported');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.count).toBe(2);
    expect(notes[0] && noteText(notes[0])).toBe(
      '2 Abschnitte lassen sich nur in LegendKeeper ansehen.',
    );
  });

  it('rettet den Text aus einer unbekannten Blockart', () => {
    const [unknown] = ofType(body, 'unknown');
    expect(unknown).toEqual({
      type: 'unknown',
      kind: 'sternkarte',
      text: 'Sternbild über dem Hafen\nDer Anker steht im Herbst über der Mole.',
    });
  });

  it('nennt eine unbekannte Blockart ohne Text beim Namen', () => {
    const note = ofType(body, 'note').find((node) => node.reason === 'unknown');
    expect(note?.kind).toBe('klangteppich');
    expect(note && noteText(note)).toContain('klangteppich');
  });

  it('weist auf Medien und Karten hin, statt sie wegzulassen', () => {
    const embed = ofType(body, 'note').find((node) => node.reason === 'embed');
    expect(embed).toMatchObject({
      title: 'Hafenklänge',
      href: 'https://www.youtube.com/watch?v=beispiel',
      kind: 'youtube',
    });
    expect(embed && noteText(embed)).toBe(
      'Eingebettetes Medium (YouTube) „Hafenklänge“ – öffnet sich im Browser.',
    );
    const map = ofType(body, 'note').find((node) => node.reason === 'map');
    expect(map && noteText(map)).toBe('Karte – nur in LegendKeeper zu sehen.');
  });

  it('verkraftet Unsinn, ohne zu scheitern', () => {
    expect(convertBlocks(null, newContext())).toEqual([]);
    expect(convertBlocks('text', newContext())).toEqual([]);
    expect(convertBlocks([null, 7, 'x', [], {}], newContext())).toEqual([
      { type: 'note', reason: 'unknown', kind: 'ohne Art', count: 1 },
    ]);
    expect(one({ kind: 'paragraph', content: 'kein Feld' })).toEqual([]);
    expect(one({ kind: 'bulletList', children: 'kaputt' })).toEqual([]);
  });

  it('bricht bei endloser Verschachtelung ab', () => {
    let deep: Record<string, unknown> = { kind: 'paragraph', content: [{ text: 'unten' }] };
    for (let i = 0; i < 200; i += 1) deep = { kind: 'quote', children: [deep] };
    const text = convertBlocks([deep], newContext()).map(nodeText).join('');
    expect(text).toContain('zu tief verschachtelt');
  });

  it('zeigt verirrte Teile (Listenpunkt ohne Liste) trotzdem', () => {
    expect(
      one({ kind: 'listItem', children: [{ kind: 'paragraph', content: [{ text: 'allein' }] }] }),
    ).toEqual([{ type: 'paragraph', inlines: [{ type: 'text', text: 'allein' }] }]);
  });
});

describe('Seite als Ganzes', () => {
  const article = articleBody(blocks.blocks, PROJECT);

  it('stellt den Steckbrief in die Randspalte und nimmt leere Zeilen heraus', () => {
    expect(article.body.some((node) => node.type === 'infobox')).toBe(false);
    expect(article.aside.map((node) => node.type)).toEqual(['image', 'facts', 'group']);
    const [facts] = ofType(article.aside, 'facts');
    expect(facts?.title).toBeUndefined();
    expect(facts?.rows.map((row) => row.key)).toEqual([
      'Einwohner',
      'Herrschaft',
      'Wache',
      'Handel',
    ]);
    expect(facts?.rows[1]?.value).toEqual([
      { type: 'mention', resourceId: 'hausdusk', label: 'Haus Duskryn' },
    ]);
    expect(ofType(article.aside, 'group')[0]?.title).toBe('Wahlspruch');
  });

  it('lässt einen Steckbrief ohne Umfließen im Text stehen', () => {
    const inline = articleBody(
      [
        {
          kind: 'infobox',
          layout: 'center',
          rows: [{ kind: 'keyValue', rows: [{ key: 'Rang', text: 'Hauptmann' }] }],
        },
      ],
      PROJECT,
    );
    expect(inline.aside).toEqual([]);
    expect(inline.body).toMatchObject([{ type: 'infobox', beside: false }]);
  });

  it('liest Werte aus dem schlichten Text, wenn keine Läufe da sind', () => {
    const [facts] = ofType(
      convertProperties(
        [{ kind: 'keyValue', rows: [{ key: 'Rang', text: 'Hauptmann' }] }],
        newContext(),
      ),
      'facts',
    );
    expect(facts?.rows).toEqual([{ key: 'Rang', value: [{ type: 'text', text: 'Hauptmann' }] }]);
  });

  it('erstellt das Inhaltsverzeichnis aus den Überschriften des Fließtexts', () => {
    expect(article.outline.map((entry) => `${entry.level} ${entry.text}`)).toEqual([
      '1 Dornhafen',
      '2 Viertel',
      '2 Was jeder weiß',
      '2 Preise und Abgaben',
      '2 Für die Spielleitung',
    ]);
    expect(new Set(article.outline.map((entry) => entry.anchor)).size).toBe(article.outline.length);
  });

  it('verschiebt die Ebenen, wenn eine Seite erst bei Ebene 2 beginnt', () => {
    const secrets = articleBody(fixture<LkDocumentBlocks>('blocks-secrets.json').blocks);
    expect(secrets.outline.map((entry) => entry.level)).toEqual([1, 2, 2]);
  });

  it('erkennt den Link auf einen eigenen Artikel im Fließtext als Verweis', () => {
    const [, intro] = article.body;
    expect(intro?.type).toBe('paragraph');
    const mentions =
      intro?.type === 'paragraph'
        ? intro.inlines.filter((inline) => inline.type === 'mention')
        : [];
    expect(mentions.map((mention) => (mention.type === 'mention' ? mention.label : ''))).toEqual([
      'Nebelküste',
      'Moor',
      'Hauses Duskryn',
    ]);
  });

  it('lässt eine erste Überschrift weg, die nur den Titel des Artikels wiederholt', () => {
    const titled = articleBody(blocks.blocks, PROJECT, 'dornhafen ');
    expect(titled.body[0]?.type).toBe('paragraph');
    expect(titled.outline.map((entry) => entry.text)).toEqual([
      'Viertel',
      'Was jeder weiß',
      'Preise und Abgaben',
      'Für die Spielleitung',
    ]);
    // Die übrigen Ebenen rücken dadurch auf.
    expect(titled.outline.every((entry) => entry.level === 1)).toBe(true);
    // Ein anderer Titel lässt die Überschrift stehen; eine spätere gleichlautende ebenfalls.
    expect(articleBody(blocks.blocks, PROJECT, 'Dornhafen bei Nacht').body[0]?.type).toBe(
      'heading',
    );
    const later = articleBody(
      [
        { kind: 'paragraph', content: [{ text: 'Vorweg.' }] },
        { kind: 'heading', level: 1, content: [{ text: 'Dornhafen' }] },
      ],
      PROJECT,
      'Dornhafen',
    );
    expect(later.body.map((node) => node.type)).toEqual(['paragraph', 'heading']);
  });

  it('ergibt für eine leere Seite nichts', () => {
    expect(articleBody([], PROJECT)).toEqual({ body: [], aside: [], outline: [] });
  });
});

describe('Kopf eines Artikels', () => {
  const head = articleHead(resource, PROJECT);

  it('liest Titel, Pfad, Schlagworte und Banner', () => {
    expect(head.title).toBe('Dornhafen');
    expect(head.path.map((step) => step.name)).toEqual(['Elaris', 'Nebelküste']);
    expect(head.tags).toEqual(['Stadt', 'Hafen']);
    expect(head.aliases).toEqual(['Die Dornenstadt']);
    expect(head.banner).toEqual({
      url: 'https://assets.legendkeeper.com/beispiel-banner-dornhafen.webp',
      position: 42,
    });
  });

  it('ordnet die Seiten wie in LegendKeeper und trennt Karten und Zeitleisten ab', () => {
    expect(head.pages.map((doc) => `${doc.name}${doc.hidden ? ' (verborgen)' : ''}`)).toEqual([
      'Überblick',
      'Geheimnisse (verborgen)',
    ]);
    expect(head.others.map((doc) => `${doc.kind}:${doc.name}`)).toEqual([
      'map:Stadtplan',
      'time:Stadtgeschichte',
    ]);
  });

  it('wandelt die Seitenleiste um und lässt Leeres weg', () => {
    expect(head.side.map((node) => node.type)).toEqual(['image', 'group', 'links']);
    expect(ofType(head.side, 'group')[0]?.title).toBe('Am Tisch');
    expect(ofType(head.side, 'links')[0]?.items.map((item) => item.resourceId)).toEqual([
      'salzrabe',
      'hausdusk',
      'geloesch',
    ]);
    expect(linkedResourceIds(head.side)).toEqual(['salzrabe', 'hausdusk', 'geloesch']);
  });

  it('sammelt, was LegendKeeper von der Seitenleiste nicht herausgibt – ohne die Schlagwort-Anzeige', () => {
    expect(head.sideMissing).toEqual(['Stimmung', 'Wetter']);
    const odd = articleHead({
      ...resource,
      properties: [
        { kind: 'unsupported', id: 'a', title: 'Tags' },
        { kind: 'unsupported', id: 'b', title: '  ' },
        { kind: 'unsupported', id: 'c' },
      ],
    });
    expect(odd.side).toEqual([]);
    expect(odd.sideMissing).toEqual(['Abschnitt ohne Titel', 'Abschnitt ohne Titel']);
  });

  it('nennt Karten und Zeitleisten beim Namen, ohne die Art zu doppeln', () => {
    expect(head.others.map(docLabel)).toEqual([
      'Karte „Stadtplan“',
      'Zeitleiste „Stadtgeschichte“',
    ]);
    expect(docLabel({ id: 'm', name: 'Karte', kind: 'map', hidden: false })).toBe('Karte');
    expect(docLabel({ id: 'b', name: 'Stammbaum', kind: 'board', hidden: false })).toBe(
      'Tafel „Stammbaum“',
    );
  });

  it('zeigt ein abgeschaltetes oder unsicheres Banner nicht', () => {
    expect(
      articleHead({
        ...resource,
        banner: { enabled: false, url: 'https://assets.legendkeeper.com/x.webp' },
      }).banner,
    ).toBeNull();
    expect(articleHead({ ...resource, banner: { enabled: true, url: '' } }).banner).toBeNull();
    expect(articleHead({ ...resource, banner: null }).banner).toBeNull();
  });

  it('kürzt lange Pfade auf die letzten Schritte', () => {
    expect(shortPath(['a', 'b', 'c', 'd'])).toEqual({ skipped: 0, steps: ['a', 'b', 'c', 'd'] });
    expect(shortPath(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual({
      skipped: 3,
      steps: ['d', 'e', 'f'],
    });
    expect(shortPath([])).toEqual({ skipped: 0, steps: [] });
    expect(shortPath(['a', 'b', 'c'], 1)).toEqual({ skipped: 2, steps: ['c'] });
  });

  it('kommt mit einem kargen Artikel zurecht', () => {
    const bare = articleHead({ id: 'x1', name: '  ' });
    expect(bare).toMatchObject({
      title: 'Unbenannter Artikel',
      path: [],
      tags: [],
      pages: [],
      others: [],
      side: [],
      banner: null,
    });
  });
});
