import { describe, expect, it } from 'vitest';
import { ArticleSchema, type Article } from '../../domain/schema';
import type { ArticleNode, Inline } from '../legendkeeper/model';
import { backlinks, coMentions } from './model';
import { isLinkableName, nameMatcher } from './names';
import { linkIndex, pageNodes } from './text';

const stamp = '2026-01-01T00:00:00.000Z';
const article = (id: string, title: string, text = '', more: Partial<Article> = {}): Article =>
  ArticleSchema.parse({
    id,
    created: stamp,
    updated: stamp,
    title,
    docs: [{ id: `${id}-seite`, kind: 'page', text }],
    source: 'wayfarer',
    ...more,
  });

const world = (...list: Article[]) => Object.fromEntries(list.map((a) => [a.id, a]));

const base = () =>
  world(
    article('mira', 'Mira Tannhaus', '', { aliases: ['Die Fährfrau'] }),
    article('odo', 'Odo'),
    article('furt', 'Hohenfurt'),
    article('fischer', 'Die Aalfischer'),
    article('haus', 'Haus Tannhaus'),
    article('zeit', 'Geschichte'),
    article('klein', 'entwurf'),
    article('kurz', 'Ur'),
    article('vorlage', 'Vorlagenperson', '', { template: true }),
    article('still', 'Graufels', '', { autoLink: false }),
  );

/** Die erkannten Namen eines Textes als „Wortlaut→Artikel“. */
const found = (articles: Record<string, Article>, text: string) => {
  const matcher = nameMatcher(articles, linkIndex(articles).resolve);
  return matcher.find(text).map((hit) => `${text.slice(hit.from, hit.to)}→${hit.id}`);
};

/** Die Verweise eines Absatzes, erkannte mit „~“ davor. */
const mentions = (nodes: ArticleNode[]): string[] => {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === 'object' && value !== null) {
      const inline = value as Inline;
      if (inline.type === 'mention')
        out.push(`${inline.implicit ? '~' : ''}${inline.label}→${inline.resourceId}`);
      else Object.values(value).forEach(walk);
    }
  };
  walk(nodes);
  return out;
};

describe('Namen ohne Klammern erkennen', () => {
  it('findet Titel und Zweitnamen als ganze Wörter', () => {
    const articles = base();
    expect(found(articles, 'Gestern traf Mira Tannhaus in Hohenfurt ein.')).toEqual([
      'Mira Tannhaus→mira',
      'Hohenfurt→furt',
    ]);
    expect(found(articles, 'Die Fährfrau kennt jeden.')).toEqual(['Die Fährfrau→mira']);
    // Nur als ganzes Wort – und genau so geschrieben.
    expect(found(articles, 'Die Hohenfurter Brücke, hohenfurt, Odoaker')).toEqual([]);
    // Der längere Name geht vor.
    expect(found(articles, 'Das Haus Tannhaus ist alt.')).toEqual(['Haus Tannhaus→haus']);
  });

  it('kennt das angehängte „s“ und Titel ohne ihren Artikel', () => {
    const articles = base();
    expect(found(articles, 'Hohenfurts Mauern, Odos Boot')).toEqual(['Hohenfurt→furt', 'Odo→odo']);
    // Ohne „der/die/das“ davor gilt der Titel ohne Artikel nicht – „Aalfischer“ kann jeder sein.
    expect(found(articles, 'Drei Aalfischer saßen am Ufer.')).toEqual([]);
    expect(found(articles, 'Er schuldet den Aalfischern Geld, der Aalfischer aber nicht.')).toEqual(
      ['Aalfischer→fischer'],
    );
    expect(found(articles, 'Die Aalfischer fahren aus.')).toEqual(['Die Aalfischer→fischer']);
  });

  it('lässt aus, was zu oft danebenläge', () => {
    const articles = base();
    // Allerweltswörter, klein geschriebene Titel, sehr kurze Namen, Vorlagen, Abgeschaltetes.
    expect(
      found(
        articles,
        'Die Geschichte von Graufels: ein entwurf über den Ur der Vorlagenperson, am Tor.',
      ),
    ).toEqual([]);
    expect(isLinkableName('Geschichte')).toBe(false);
    expect(isLinkableName('Ur')).toBe(false);
    expect(isLinkableName('Tor')).toBe(false);
    expect(isLinkableName('entwurf')).toBe(false);
    expect(isLinkableName('Zum Krummen Aal')).toBe(true);
    expect(isLinkableName('Odo')).toBe(true);
  });

  it('macht erkannte Namen beim Lesen zu Verweisen', () => {
    const articles = world(
      ...Object.values(base()),
      article(
        'text',
        'Der Markt',
        [
          '# Hohenfurt am Morgen',
          '',
          '**Mira Tannhaus** kam nach [[Hohenfurt]]. Später ging Mira Tannhaus wieder; Hohenfurt blieb.',
          '',
          'Auf dem Markt (Der Markt) trifft man die Aalfischer. `Hohenfurt` im Code bleibt.',
          '',
          '> [!steckbrief]',
          '> Besitzer: Haus Tannhaus, Unbekannte Dritte',
        ].join('\n'),
      ),
    );
    const page = articles.text!;
    expect(mentions(pageNodes(articles, page, page.docs[0]!))).toEqual([
      // Die Überschrift bleibt Text. Im Absatz: der fette Name, der Verweis in Klammern – und
      // jedes weitere Vorkommen.
      '~Mira Tannhaus→mira',
      'Hohenfurt→furt',
      '~Mira Tannhaus→mira',
      '~Hohenfurt→furt',
      // Der eigene Titel wird nie zum Verweis; Code bleibt Code.
      '~Aalfischer→fischer',
      // Auch im Steckbrief – dort zählt der erkannte Name als Verweis.
      '~Haus Tannhaus→haus',
    ]);
    // Die Auszeichnung bleibt am erkannten Namen.
    const first = pageNodes(articles, page, page.docs[0]!)[1] as Extract<
      ArticleNode,
      { type: 'paragraph' }
    >;
    expect(first.inlines[0]).toMatchObject({
      type: 'mention',
      implicit: true,
      style: { bold: true },
    });
    // Erkannte Namen zählen als Rückverweis.
    expect(
      backlinks(articles)
        .get('mira')
        ?.map((a) => a.title),
    ).toEqual(['Der Markt']);
  });

  it('weiß, wer oft im selben Absatz genannt wird', () => {
    const articles = world(
      ...Object.values(base()),
      article('a', 'Erster Bericht', 'Mira Tannhaus kam mit Odo nach Hohenfurt.\n\nOdo blieb.'),
      article('b', 'Zweiter Bericht', '[[Mira Tannhaus]] und Odo stritten.\n\nHohenfurt schlief.'),
    );
    // Odo steht zweimal mit Mira im selben Absatz, Hohenfurt nur einmal – das zählt noch nicht.
    expect(coMentions(articles, 'mira').map((c) => [c.article.title, c.count])).toEqual([
      ['Odo', 2],
    ]);
    expect(coMentions(articles, 'furt')).toEqual([]);
  });

  it('folgt Umbenennungen und dem Abschalten', () => {
    const one = world(
      article('furt', 'Hohenfurt'),
      article('text', 'Notiz', 'In Hohenfurt regnet es.'),
    );
    const page = (articles: Record<string, Article>) =>
      mentions(pageNodes(articles, articles.text!, articles.text!.docs[0]!));
    expect(page(one)).toEqual(['~Hohenfurt→furt']);
    const renamed = { ...one, furt: { ...one.furt!, title: 'Hohenfurt am Fluss' } };
    expect(page(renamed)).toEqual([]);
    const off = { ...one, furt: { ...one.furt!, autoLink: false } };
    expect(page(off)).toEqual([]);
  });
});
