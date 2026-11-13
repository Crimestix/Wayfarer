/**
 * Erfundene Beispielwelt – nur für automatische Tests. Kommt in der App nicht vor.
 * Alle Orte und Personen hier sind erfunden und gehören nicht zur echten Kampagne.
 */
import {
  PARTY_ID,
  createChronicleEntry,
  createEntity,
  createEvent,
  createRelation,
  type CampaignData,
  type ChronicleEntry,
  type Entity,
  type Relation,
} from '../../domain/schema';
import { MINUTES_PER_DAY } from '../../domain/time/calendar';
import { elarisCampaign } from '../seed';

const index = <T extends { id: string }>(docs: T[]): Record<string, T> =>
  Object.fromEntries(docs.map((d) => [d.id, d]));

export function demoCampaign(): CampaignData {
  const base = elarisCampaign();
  const now = base.state.now;
  const day = MINUTES_PER_DAY;

  const kueste = createEntity({
    kind: 'place',
    name: 'Nebelküste',
    tagline: 'Zerklüfteter Küstenstrich, im Frühjahr tagelang im Dunst.',
    place: { category: 'Region' },
  });
  const hafen = createEntity({
    kind: 'place',
    name: 'Dornhafen',
    tagline: 'Hafenstadt unter der Hand von Haus Duskryn. Hier fragt niemand zweimal.',
    notes: 'Drei Kais, eine Zollkette, ein Leuchtfeuer, das seit dem Winter nicht mehr brennt.',
    tags: ['Hafen', 'Duskryn'],
    place: { parentId: kueste.id, category: 'Stadt' },
  });
  const taverne = createEntity({
    kind: 'place',
    name: 'Zum Salzigen Raben',
    tagline: 'Taverne am Fischkai. Treffpunkt der Lotsen und Schmuggler.',
    place: { parentId: hafen.id, category: 'Taverne' },
  });
  const kontor = createEntity({
    kind: 'place',
    name: 'Kontor der Duskryn',
    tagline: 'Lagerhaus und Schreibstube des Hauses am Nordkai.',
    place: { parentId: hafen.id, category: 'Gebäude' },
  });
  const moor = createEntity({
    kind: 'place',
    name: 'Krähenmoor',
    tagline: 'Sumpfland östlich der Stadt. Die Alte Straße endet hier im Schilf.',
    place: { parentId: kueste.id, category: 'Wildnis' },
  });
  const kloster = createEntity({
    kind: 'place',
    name: 'Kloster Sankt Vael',
    tagline: 'Verlassene Abtei auf dem Moorhügel. Die Glocke schlägt trotzdem.',
    place: { parentId: moor.id, category: 'Ruine' },
  });

  const haus = createEntity({
    kind: 'faction',
    name: 'Haus Duskryn',
    tagline: 'Handelshaus, das Hafen, Zoll und Stadtwache kontrolliert.',
    faction: { seatId: kontor.id, category: 'Adelshaus' },
  });
  const lotsen = createEntity({
    kind: 'faction',
    name: 'Bruderschaft der Lotsen',
    tagline: 'Gilde der Hafenlotsen. Kennt jede Sandbank – und jeden, der sie umfährt.',
    faction: { seatId: taverne.id, category: 'Gilde' },
  });

  const maera = createEntity({
    kind: 'person',
    name: 'Maera Duskryn',
    tagline: 'Hausherrin. Höflich, geduldig und nie ohne Gegenleistung.',
    secret: 'Lässt den Grauen Fang heimlich mit Klosterglocken-Bronze beladen.',
    tags: ['Adel'],
    person: {
      species: 'Mensch',
      role: 'Herrin von Haus Duskryn',
      placeId: kontor.id,
      homeId: kontor.id,
      met: true,
    },
  });
  const brann = createEntity({
    kind: 'person',
    name: 'Brann Eisenhaken',
    tagline: 'Hafenmeister. Schuldet der Gruppe einen Gefallen und hasst es.',
    person: {
      species: 'Zwerg',
      role: 'Hafenmeister',
      placeId: hafen.id,
      homeId: hafen.id,
      met: true,
    },
  });
  const isolde = createEntity({
    kind: 'person',
    name: 'Isolde Rabenschwinge',
    tagline: 'Wirtin des Salzigen Raben. Hört alles, erzählt wenig.',
    person: {
      species: 'Halbelfin',
      role: 'Wirtin',
      placeId: taverne.id,
      homeId: taverne.id,
      met: true,
    },
  });
  const teoric = createEntity({
    kind: 'person',
    name: 'Bruder Teoric',
    tagline: 'Letzter Mönch von Sankt Vael. Seit dem Winter verschwunden.',
    person: { species: 'Mensch', role: 'Mönch', status: 'missing', homeId: kloster.id, met: false },
  });
  const kessa = createEntity({
    kind: 'person',
    name: 'Kessa Flutwind',
    tagline: 'Junge Lotsin. Hat den Grauen Fang nachts auslaufen sehen.',
    person: {
      species: 'Mensch',
      role: 'Lotsin',
      placeId: taverne.id,
      homeId: hafen.id,
      met: false,
    },
  });
  const voss = createEntity({
    kind: 'person',
    name: 'Hauptmann Voss',
    tagline: 'Führt die Hafenwache im Sold der Duskryn.',
    person: {
      species: 'Mensch',
      role: 'Hauptmann der Wache',
      placeId: hafen.id,
      homeId: hafen.id,
      met: true,
    },
  });
  const glocke = createEntity({
    kind: 'item',
    name: 'Die Glocke von Sankt Vael',
    tagline: 'Bronzeglocke, die schlägt, wenn jemand im Moor stirbt.',
    item: { holderId: kloster.id, category: 'Artefakt' },
  });

  const entities: Entity[] = [
    ...Object.values(base.entities),
    kueste,
    hafen,
    taverne,
    kontor,
    moor,
    kloster,
    haus,
    lotsen,
    maera,
    brann,
    isolde,
    teoric,
    kessa,
    voss,
    glocke,
  ];

  const relations: Relation[] = [
    createRelation({ from: maera.id, to: haus.id, type: 'leads' }),
    createRelation({ from: voss.id, to: maera.id, type: 'serves', attitude: 2 }),
    createRelation({
      from: haus.id,
      to: brann.id,
      type: 'employs',
      note: 'Wird vom Haus bezahlt, nicht von der Stadt.',
    }),
    createRelation({ from: isolde.id, to: lotsen.id, type: 'member' }),
    createRelation({ from: kessa.id, to: lotsen.id, type: 'member' }),
    createRelation({ from: isolde.id, to: maera.id, type: 'fears', attitude: -1, secret: true }),
    createRelation({ from: lotsen.id, to: haus.id, type: 'rival', attitude: -2 }),
    createRelation({ from: haus.id, to: hafen.id, type: 'rules' }),
    createRelation({
      from: maera.id,
      to: PARTY_ID,
      attitude: 0,
      note: 'Sieht die Gruppe als nützliches Werkzeug.',
    }),
    createRelation({ from: brann.id, to: PARTY_ID, attitude: -1, type: 'owes' }),
    createRelation({ from: isolde.id, to: PARTY_ID, attitude: 2 }),
    createRelation({ from: voss.id, to: PARTY_ID, attitude: -2 }),
  ];

  const session = Object.values(base.sessions)[0]!;
  const chronicle: ChronicleEntry[] = [
    createChronicleEntry({
      kind: 'travel',
      at: now - 9 * day,
      placeId: hafen.id,
      refs: [hafen.id],
      travel: { fromId: null, toId: hafen.id },
      text: 'Ankunft mit dem Küstensegler.',
    }),
    createChronicleEntry({
      kind: 'note',
      at: now - 9 * day + 180,
      placeId: taverne.id,
      refs: [isolde.id, taverne.id],
      text: 'Isolde vermittelt ein Zimmer und warnt vor der Hafenwache.',
    }),
    createChronicleEntry({
      kind: 'attitude',
      at: now - 8 * day,
      placeId: hafen.id,
      refs: [voss.id],
      attitude: { fromId: voss.id, toId: PARTY_ID, before: 0, after: -2 },
      text: 'Die Gruppe hat seine Leute am Zollhaus bloßgestellt.',
    }),
    createChronicleEntry({
      kind: 'promise',
      at: now - 8 * day + 300,
      placeId: hafen.id,
      refs: [brann.id],
      promise: { due: now + 2 * day, done: false, failed: false },
      text: 'Brann besorgt die Ladeliste des Grauen Fangs – bis das Schiff ablegt.',
    }),
    createChronicleEntry({
      kind: 'travel',
      at: now - 6 * day,
      placeId: moor.id,
      refs: [moor.id, hafen.id],
      travel: { fromId: hafen.id, toId: moor.id },
      text: 'Aufbruch über die Alte Straße.',
    }),
    createChronicleEntry({
      kind: 'travel',
      at: now - 5 * day,
      placeId: kloster.id,
      refs: [kloster.id, moor.id],
      travel: { fromId: moor.id, toId: kloster.id },
    }),
    createChronicleEntry({
      kind: 'note',
      at: now - 5 * day + 240,
      placeId: kloster.id,
      refs: [kloster.id, glocke.id, teoric.id],
      text: 'Die Glocke schlägt dreimal. Teorics Zelle ist leer, das Bett noch warm.',
    }),
    createChronicleEntry({
      kind: 'change',
      at: now - 3 * day,
      placeId: hafen.id,
      refs: [hafen.id, haus.id],
      text: 'Haus Duskryn lässt die Zollkette nachts schließen. Kein Boot verlässt den Hafen ohne Siegel.',
    }),
    createChronicleEntry({
      kind: 'change',
      at: now - 2 * day,
      placeId: taverne.id,
      refs: [kessa.id, taverne.id],
      text: 'Kessa Flutwind taucht im Salzigen Raben unter – die Wache sucht sie.',
    }),
    createChronicleEntry({
      kind: 'travel',
      at: now - 120,
      placeId: moor.id,
      refs: [moor.id, kloster.id],
      travel: { fromId: kloster.id, toId: moor.id },
      text: 'Rückweg Richtung Dornhafen.',
    }),
  ].map((entry) => ({ ...entry, sessionId: session.id }));

  const events = [
    ...Object.values(base.events).map((e) => ({ ...e, placeId: hafen.id, refs: [haus.id] })),
    createEvent({
      title: 'Vollmondmarkt in Dornhafen',
      at: now + 5 * day,
      timed: false,
      kind: 'world',
      placeId: hafen.id,
      details: 'Händler aus dem Umland; die Wache ist abgelenkt.',
    }),
    createEvent({
      title: 'Treffen mit Brann am Nordkai',
      at: now + day + 6 * 60,
      timed: true,
      kind: 'plan',
      placeId: hafen.id,
      refs: [brann.id],
    }),
  ];

  return {
    ...base,
    campaign: { ...base.campaign, name: 'Elaris (Beispielwelt)' },
    state: { ...base.state, placeId: moor.id },
    entities: index(entities),
    relations: index(relations),
    chronicle: index(chronicle),
    events: index(events),
  };
}
