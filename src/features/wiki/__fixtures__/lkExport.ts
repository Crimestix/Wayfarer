/**
 * Ein erfundener LegendKeeper-Export in der Form der echten Datei – nur für Tests. Die Welt
 * „Brackwasser“ gibt es nirgends; sie zeigt jede Form, die der Leser kennen muss.
 */

const text = (value: string, marks?: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const heading = (level: number, value: string) => ({
  type: 'heading',
  attrs: { level, id: 'h' },
  content: [text(value)],
});
const mention = (id: string, label: string) => ({
  type: 'mention',
  attrs: { id, text: `@${label}` },
});
const page = (id: string, pos: string, content: unknown[], name = 'Main') => ({
  id,
  name,
  type: 'page',
  pos,
  isHidden: false,
  content: { type: 'doc', content },
});
const blank = (id: string, pos: string) => ({ id, name: 'Untitled', type: 'blank', pos });

const textField = (title: string, value: string, pos: string) => ({
  type: 'TEXT_FIELD',
  title,
  pos,
  data: { fragment: { type: 'doc', content: [paragraph(text(value))] } },
});
const image = (title: string, url: string, pos: string) => ({
  type: 'IMAGE',
  title,
  pos,
  data: { url },
});
const links = (title: string, ids: string[], pos: string) => ({
  type: 'RESOURCE_LINK',
  title,
  pos,
  data: { items: ids.map((resourceId, i) => ({ id: `l${i}`, resourceId, pos: `a${i}` })) },
});
const tagsField = (pos: string) => ({ type: 'TAGS', title: 'TAGS', pos, data: {} });

interface ResourceInit {
  id: string;
  name: string;
  parentId?: string | null;
  pos?: string;
  icon?: string;
  tags?: string[];
  aliases?: string[];
  hidden?: boolean;
  banner?: string;
  properties?: unknown[];
  documents?: unknown[];
}

const resource = (init: ResourceInit) => ({
  schemaVersion: 1,
  id: init.id,
  name: init.name,
  parentId: init.parentId ?? null,
  pos: init.pos ?? 'a',
  iconGlyph: init.icon ?? 'fas fa-file-lines',
  iconColor: '#888888',
  iconShape: 'circle',
  isHidden: init.hidden ?? false,
  isLocked: false,
  aliases: init.aliases ?? [],
  tags: init.tags ?? [],
  banner: init.banner ? { enabled: true, url: init.banner, yPosition: 40 } : { enabled: false },
  properties: init.properties ?? [],
  documents: init.documents ?? [blank(`${init.id}-d`, 'a')],
  showPropertyBar: true,
});

const ASSET = 'https://assets.example.org';

/** Die Karte von Hohenfurt: 2000 × 1000 Bildpunkte, im Kachelraster also Faktor 8. */
const cityMap = {
  id: 'kartehf',
  name: 'Map',
  type: 'map',
  pos: 'b',
  map: {
    mapId: `${ASSET}/hohenfurt.png`,
    min_x: 0,
    max_x: 2000,
    min_y: -1000,
    max_y: 0,
    max_zoom: 3,
  },
  content: {
    pins: [
      // Nur die Kennung des Artikels.
      { id: 'pin1', name: 'Krummer Aal', pos: [-50, 100], uri: 'aal00001' },
      // Als Adresse.
      { id: 'pin2', name: 'Speicher', pos: [-100, 200], uri: 'lk://resources/speich01' },
      // Ohne Artikel.
      { id: 'pin3', name: 'Alte Eiche', pos: [-10, 10] },
      {
        id: 'weg1',
        name: 'Uferweg',
        type: 'path',
        pos: [0, 0],
        polyline: [
          [-10, 10],
          [-20, 40],
          [-30, 90],
        ],
      },
      {
        id: 'gebiet1',
        name: 'Hafenviertel',
        type: 'region',
        pos: [0, 0],
        polygon: [
          [-40, 80],
          [-40, 120],
          [-70, 120],
        ],
        uri: 'lk://resources/hafen001/docs/x',
      },
    ],
  },
};

export function lkExportFixture(): unknown {
  return {
    version: 1,
    exportId: 'fixture',
    exportedAt: '2026-01-05T10:00:00.000Z',
    resourceCount: 13,
    hash: 'x',
    calendars: [],
    resources: [
      resource({
        id: 'laender1',
        name: 'Länder und Städte',
        pos: 'a',
        icon: 'city',
      }),
      resource({
        id: 'hohenf01',
        name: 'Hohenfurt',
        parentId: 'laender1',
        pos: 'a',
        icon: 'city',
        tags: ['Stadt'],
        aliases: ['Die Furt'],
        banner: `${ASSET}/banner.jpg`,
        documents: [
          page('hf-p1', 'a', [
            heading(1, 'Überblick'),
            paragraph(
              text('Hohenfurt liegt an der Brack. '),
              text('Hier', [{ type: 'strong' }]),
              text(' herrscht '),
              mention('mira0001', 'Mira Tannhaus'),
              text('.'),
            ),
            {
              type: 'bulletList',
              content: [
                { type: 'listItem', content: [paragraph(text('Markt am Fünftag'))] },
                { type: 'listItem', content: [paragraph(text('Fähre bei Nacht gesperrt'))] },
              ],
            },
            paragraph(),
            {
              type: 'bodiedExtension',
              attrs: { extensionKey: 'block-secret', parameters: {} },
              content: [paragraph(text('Der Rat ist bestochen.'))],
            },
            { type: 'extension', attrs: { extensionKey: 'block-subpage-index', parameters: {} } },
            {
              type: 'extension',
              attrs: {
                extensionKey: 'block-image',
                parameters: { url: `${ASSET}/markt.jpg`, blockTitle: 'Der Markt' },
              },
            },
            { type: 'ganzNeu', content: [paragraph(text('Gerettet.'))] },
          ]),
          cityMap,
          { id: 'hf-zeit', name: 'Chronik', type: 'time', pos: 'c', content: { events: [] } },
          { id: 'hf-brett', name: 'Skizze', type: 'board', pos: 'd', content: {} },
        ],
      }),
      resource({
        id: 'aal00001',
        name: 'Zum Krummen Aal',
        parentId: 'hohenf01',
        pos: 'a',
        icon: 'fas fa-place-of-worship',
        tags: ['location'],
        properties: [
          image('IMAGE', `${ASSET}/aal.jpg`, 'a'),
          textField('SUMMARY', 'Eine Hafenschenke mit schiefem Giebel. Der Wirt schweigt.', 'b'),
          links('LOCATED IN', ['hafen001'], 'c'),
          tagsField('d'),
        ],
        documents: [page('aal-p', 'a', [paragraph(text('Es riecht nach Teer.'))])],
      }),
      resource({
        id: 'hafen001',
        name: 'Hafenviertel',
        parentId: 'hohenf01',
        pos: 'b',
        icon: 'map-pin',
        documents: [page('hafen-p', 'a', [paragraph(text('Kräne, Netze, Möwen.'))])],
      }),
      resource({
        id: 'speich01',
        name: 'Der Speicher',
        parentId: 'hafen001',
        pos: 'a',
        icon: 'house',
        documents: [page('sp-p', 'a', [paragraph(text('Leer bis auf Ratten.'))])],
      }),
      resource({
        id: 'mira0001',
        name: 'Mira Tannhaus',
        parentId: 'hohenf01',
        pos: 'c',
        icon: 'fas fa-user',
        tags: ['character'],
        properties: [
          textField('SUMMARY', 'Vögtin von Hohenfurt, streng und müde.', 'a'),
          links('FRIENDS', ['odo00001'], 'b'),
          links('ENEMIES', ['fischer1'], 'c'),
        ],
        documents: [page('mira-p', 'a', [paragraph(text('Sie trägt den Schlüssel der Fähre.'))])],
      }),
      resource({
        id: 'odo00001',
        name: 'Odo Tannhaus',
        parentId: 'hohenf01',
        pos: 'd',
        icon: 'user',
        documents: [page('odo-p', 'a', [paragraph(text('Miras Bruder, Fährmann.'))])],
      }),
      resource({
        id: 'fischer1',
        name: 'Die Aalfischer',
        parentId: 'hohenf01',
        pos: 'e',
        icon: 'fas fa-users',
        tags: ['organization'],
        properties: [
          image('LOGO', `${ASSET}/aal-wappen.png`, 'a'),
          links('FOUNDER', ['odo00001'], 'b'),
          links('HEADQUARTERS', ['aal00001'], 'c'),
          links('MEMBERS', ['odo00001', 'gibtsnicht'], 'd'),
        ],
        documents: [page('fi-p', 'a', [paragraph(text('Eine Zunft mit langem Gedächtnis.'))])],
      }),
      resource({
        id: 'jost0001',
        name: 'Jost Reuse',
        parentId: 'fischer1',
        pos: 'a',
        icon: 'user',
        documents: [page('jost-p', 'a', [paragraph(text('Zunftmeister.'))])],
      }),
      // Ein Ordner mit dem Symbol seines Inhalts – selbst keine Person.
      resource({
        id: 'leute001',
        name: 'Wichtige Leute',
        pos: 'b',
        icon: 'user',
        documents: [blank('leute-d', 'a')],
      }),
      resource({
        id: 'vera0001',
        name: 'Vera Kohl',
        parentId: 'leute001',
        pos: 'a',
        icon: 'user',
        hidden: true,
        documents: [page('vera-p', 'a', [paragraph(text('Schmugglerin.'))])],
      }),
      // Entwürfe gehören nicht in die Welt.
      resource({
        id: 'entwurf1',
        name: 'Alte Idee',
        pos: 'c',
        icon: 'user',
        tags: ['draft'],
        documents: [page('ent-p', 'a', [paragraph(text('Verworfen.'))])],
      }),
      // Vorlagen hängen an einem eigenen Ast.
      resource({
        id: 'vorlage1',
        name: 'Person',
        parentId: 'templates',
        pos: 'a',
        icon: 'user',
        tags: ['character'],
      }),
      // Unlesbar: ohne Namen.
      { id: 'kaputt01', name: '   ', documents: [] },
    ],
  };
}
