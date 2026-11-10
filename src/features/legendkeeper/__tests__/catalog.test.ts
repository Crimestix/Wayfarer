import { describe, expect, it } from 'vitest';
import {
  buildCatalog,
  catalogPath,
  mergeHits,
  normalize,
  searchCatalog,
  snippetOf,
  suggestForName,
  type RemoteHit,
} from '../catalog';
import type { LkPage, LkResourceListItem } from '../types';
import { fixture } from './fixtures';

const items = [
  ...fixture<LkPage<LkResourceListItem>>('resources-1.json').data,
  ...fixture<LkPage<LkResourceListItem>>('resources-2.json').data,
];
const catalog = buildCatalog(items);
const titles = (hits: { entry: { title: string } }[]) => hits.map((hit) => hit.entry.title);

describe('Verzeichnis', () => {
  it('lässt Vorlagen und alles darunter weg', () => {
    expect(catalog.entries).toHaveLength(13);
    expect(catalog.byId.has('vorlgnsc')).toBe(false);
    expect(catalog.byId.has('vorlgunt')).toBe(false);
  });

  it('kennt den Pfad im Baum von der Wurzel abwärts', () => {
    expect(catalogPath(catalog, 'persisol')).toEqual(['Elaris', 'Nebelküste', 'Dornhafen', 'Taverne zum Salzigen Raben']);
    expect(catalogPath(catalog, 'weltelar')).toEqual([]);
    expect(catalogPath(catalog, 'gibtesnicht')).toEqual([]);
  });

  it('verkraftet Schleifen und fehlende Eltern', () => {
    const odd = buildCatalog([
      { id: 'a', name: 'A', parentId: 'b', tags: [], aliases: [], documents: [] },
      { id: 'b', name: 'B', parentId: 'a', tags: [], aliases: [], documents: [] },
      { id: 'c', name: 'C', parentId: 'weg', tags: [], aliases: [], documents: [] },
    ]);
    expect(catalogPath(odd, 'a')).toEqual(['B']);
    expect(catalogPath(odd, 'c')).toEqual([]);
  });

  it('nimmt doppelte Einträge nur einmal', () => {
    const first = items[0];
    expect(first && buildCatalog([first, first]).entries).toHaveLength(1);
  });
});

describe('Suche nach Titel', () => {
  it('gleicht Umlaute, Groß- und Kleinschreibung und Satzzeichen an', () => {
    expect(normalize('  Krähenmoor – „Sankt Vael“ ')).toBe('kraehenmoor sankt vael');
    expect(titles(searchCatalog(catalog, 'kraehenmoor'))[0]).toBe('Krähenmoor');
    expect(titles(searchCatalog(catalog, 'KRÄHENMOOR'))[0]).toBe('Krähenmoor');
  });

  it('stellt den genauen Titel vor Titel, die nur damit beginnen oder ihn enthalten', () => {
    expect(titles(searchCatalog(catalog, 'dornhafen'))).toEqual(['Dornhafen']);
    expect(titles(searchCatalog(catalog, 'sankt vael'))).toEqual(['Kloster Sankt Vael', 'Die Glocke von Sankt Vael']);
  });

  it('findet Wortanfänge in beliebiger Reihenfolge', () => {
    expect(titles(searchCatalog(catalog, 'rab salz'))).toEqual(['Taverne zum Salzigen Raben']);
    expect(titles(searchCatalog(catalog, 'dusk'))).toEqual(['Haus Duskryn', 'Kontor der Duskryn']);
  });

  it('findet über Zweitnamen und – nachrangig – über Schlagworte', () => {
    expect(titles(searchCatalog(catalog, 'der eiserne'))).toEqual(['Voss']);
    expect(titles(searchCatalog(catalog, 'graue küste'))).toEqual(['Nebelküste']);
    const byTag = searchCatalog(catalog, 'fraktion');
    expect(titles(byTag).sort()).toEqual(['Bruderschaft der Lotsen', 'Haus Duskryn']);
    expect(byTag.every((hit) => hit.score === 20)).toBe(true);
  });

  it('liefert zu jedem Treffer den Pfad und hält die Obergrenze ein', () => {
    const [hit] = searchCatalog(catalog, 'isolde');
    expect(hit?.path).toEqual(['Elaris', 'Nebelküste', 'Dornhafen', 'Taverne zum Salzigen Raben']);
    expect(searchCatalog(catalog, 'a', 3)).toHaveLength(3);
    expect(searchCatalog(catalog, '   ')).toEqual([]);
    expect(searchCatalog(catalog, 'xyzzy')).toEqual([]);
  });
});

describe('Vorschläge zu einem Eintragsnamen', () => {
  it('findet den gleichnamigen Artikel zuerst', () => {
    expect(titles(suggestForName(catalog, 'Dornhafen'))[0]).toBe('Dornhafen');
    expect(titles(suggestForName(catalog, 'Haus Duskryn'))[0]).toBe('Haus Duskryn');
  });

  it('findet einen Artikel, dessen Titel im Eintragsnamen steckt', () => {
    expect(titles(suggestForName(catalog, 'Hauptmann Voss'))[0]).toBe('Voss');
  });

  it('findet einen Artikel, dessen Titel den Eintragsnamen enthält', () => {
    expect(titles(suggestForName(catalog, 'Zum Salzigen Raben'))[0]).toBe('Taverne zum Salzigen Raben');
  });

  it('schlägt bei teilweiser Übereinstimmung vor, aber nicht bei bloßen Füllwörtern oder Schlagworten', () => {
    expect(titles(suggestForName(catalog, 'Glocke Sankt Vael'))).toContain('Die Glocke von Sankt Vael');
    expect(suggestForName(catalog, 'Der von und zu')).toEqual([]);
    expect(suggestForName(catalog, 'Fraktion')).toEqual([]);
    expect(suggestForName(catalog, 'Bruder Teoric')).toEqual([]);
  });
});

describe('Trefferliste', () => {
  const remote = fixture<LkPage<RemoteHit>>('search.json').data;

  it('schneidet die Fundstelle lesbar aus', () => {
    const segment = 'Ohne einen Lotsen der Bruderschaft läuft kein Schiff in Dornhafen ein.';
    expect(snippetOf(segment, 56, 65)).toEqual({
      before: 'Ohne einen Lotsen der Bruderschaft läuft kein Schiff in ',
      match: 'Dornhafen',
      after: ' ein.',
    });
    const long = `${'vorher '.repeat(40)}TREFFER${' danach'.repeat(40)}`;
    const cut = snippetOf(long, 280, 287, 30);
    expect(cut.match).toBe('TREFFER');
    expect(cut.before.startsWith('… ')).toBe(true);
    expect(cut.after.endsWith(' …')).toBe(true);
    expect(cut.before.length).toBeLessThanOrEqual(34);
    expect(cut.after.length).toBeLessThanOrEqual(34);
  });

  it('verkraftet Fundstellen außerhalb des Texts', () => {
    expect(snippetOf('kurz', 10, 20)).toEqual({ before: 'kurz', match: '', after: '' });
    expect(snippetOf('kurz', -5, 2)).toEqual({ before: '', match: 'ku', after: 'rz' });
  });

  it('stellt Titeltreffer vor Fundstellen im Text und zeigt jeden Artikel einmal', () => {
    const merged = mergeHits(searchCatalog(catalog, 'dornhafen'), remote, catalog);
    expect(merged.map((hit) => `${hit.match}:${hit.title}`)).toEqual([
      'title:Dornhafen',
      'text:Bruderschaft der Lotsen',
      'text:Elaris',
    ]);
    expect(merged[1]?.snippet?.match).toBe('Dornhafen');
    expect(merged[1]?.documentId).toBe('doclots1');
    expect(merged[1]?.path).toEqual(['Elaris', 'Nebelküste', 'Dornhafen']);
  });

  it('kommt ohne Verzeichnis aus und nimmt dann Pfad und Namen aus der Suche', () => {
    const merged = mergeHits([], remote, null);
    expect(merged.map((hit) => `${hit.match}:${hit.title}`)).toEqual([
      'title:Dornhafen',
      'text:Bruderschaft der Lotsen',
      'text:Elaris',
    ]);
    expect(merged[0]?.path).toEqual(['Elaris', 'Nebelküste']);
    expect(merged[2]?.path).toEqual([]);
  });

  it('hält die Obergrenze ein', () => {
    expect(mergeHits(searchCatalog(catalog, 'a'), remote, catalog, 2)).toHaveLength(2);
  });
});
