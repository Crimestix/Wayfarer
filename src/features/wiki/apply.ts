/**
 * Fügt einen umgewandelten LegendKeeper-Export in den Spielstand ein. Reine Funktion: aus dem
 * jetzigen Stand und dem Export entsteht der neue Stand samt Bericht; geschrieben wird woanders.
 *
 * Grundsätze:
 * - Was der Spielleiter in Wayfarer eingetragen hat, bleibt stehen. Ergänzt wird nur, was leer ist.
 * - Ein zweites Einlesen (etwa eines neueren Exports) legt nichts doppelt an: Einträge finden
 *   ihren Artikel über die Verknüpfung, sonst über den Namen.
 * - In die Welt kommt nur, was eindeutig erkannt wurde (`recognize.ts`).
 */
import {
  EntitySchema,
  RelationSchema,
  nowIso,
  safeId,
  type Article,
  type CampaignData,
  type Entity,
  type GameMap,
  type MapPoint,
  type Relation,
} from '../../domain/schema';
import { nameFixes, type LkArticleName } from '../import/lknames';
import { looseName, type ImportSections } from '../import/v157';
import type { LkConversion, LkResourceInfo } from './lkexport';
import { isDraft, recognizeKind, type RecognizedKind } from './recognize';
import { articleAsText } from './text';

export interface LkImportOptions {
  /** Personen, Orte, Fraktionen und Gegenstände erkennen und in der Welt anlegen. */
  recognize: boolean;
}

export interface LkImportCounts {
  articles: number;
  maps: number;
  /** Neu in der Welt angelegt, je Art. */
  created: Record<RecognizedKind, number>;
  /** Vorhandene Einträge, die ihren Artikel gefunden haben. */
  linked: number;
  /** Einträge, die bisher nur ein Verweis waren und jetzt ihren Namen tragen. */
  named: number;
  relations: number;
}

export interface LkImportPlan {
  data: CampaignData;
  sections: ImportSections;
  counts: LkImportCounts;
  /** Personen, die neu sind oder jetzt ihren Namen tragen – für die Familien aus Nachnamen. */
  personIds: string[];
}

const KIND_WORD: Record<RecognizedKind, [string, string]> = {
  person: ['Person', 'Personen'],
  place: ['Ort', 'Orte'],
  faction: ['Fraktion', 'Fraktionen'],
  item: ['Gegenstand', 'Gegenstände'],
};

const amount = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Welche vorhandenen Arten zu einer erkannten Art passen. */
const COMPATIBLE: Record<RecognizedKind, readonly Entity['kind'][]> = {
  person: ['person', 'character'],
  place: ['place'],
  faction: ['faction', 'family'],
  item: ['item'],
};

/** Überschriften der Verweise im Steckbrief, ohne Groß- und Kleinschreibung und Zeichen. */
const linkKey = (title: string) =>
  title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
const LINK_TITLES = {
  friends: new Set(['friends', 'freunde', 'verbundete']),
  enemies: new Set(['enemies', 'feinde']),
  members: new Set(['members', 'mitglieder']),
  founder: new Set(['founder', 'grunder', 'gegrundetvon']),
  creator: new Set(['creator', 'erschaffer', 'erschaffenvon']),
  locatedIn: new Set(['locatedin', 'liegtin', 'gelegenin']),
  headquarters: new Set(['headquarters', 'hauptsitz']),
};

/** Wie weit oben im Baum ein Ort höchstens stehen darf, um als Wohnort oder Sitz zu gelten. */
const NEAR = 2;

export function planLkImport(
  data: CampaignData,
  conversion: LkConversion,
  options: LkImportOptions = { recognize: true },
): LkImportPlan {
  const stamp = nowIso();
  const infos = new Map(conversion.resources.map((info) => [info.id, info]));
  const counts: LkImportCounts = {
    articles: conversion.articles.length,
    maps: conversion.maps.length,
    created: { person: 0, place: 0, faction: 0, item: 0 },
    linked: 0,
    named: 0,
    relations: 0,
  };

  // ── Karten: Bild, Punkte und Linien kommen aus dem Export; Maßstab, Ort und Verknüpfungen,
  //    die schon in Wayfarer stehen, bleiben.
  const maps: Record<string, GameMap> = { ...data.maps };
  const mapIdOf = new Map<string, string>();
  const knownMaps = new Map(
    Object.values(data.maps)
      .filter((m) => m.lk)
      .map((m) => [`${m.lk!.resourceId}/${m.lk!.docId}`, m]),
  );
  for (const incoming of conversion.maps) {
    const old =
      knownMaps.get(`${incoming.lk?.resourceId}/${incoming.lk?.docId}`) ?? data.maps[incoming.id];
    if (!old) {
      maps[incoming.id] = incoming;
      continue;
    }
    mapIdOf.set(incoming.id, old.id);
    // Der Maßstab einer vorhandenen Karte rechnet in deren Bildgröße – die bleibt maßgeblich.
    const factor = old.frame && incoming.frame ? old.frame.width / incoming.frame.width : 1;
    const scaled = (p: MapPoint): MapPoint => [p[0] * factor, p[1] * factor];
    const oldByFeature = new Map(
      old.markers.filter((m) => m.lkFeatureId).map((m) => [m.lkFeatureId!, m]),
    );
    const seen = new Set<string>();
    const markers = incoming.markers.map((marker) => {
      const before = marker.lkFeatureId ? oldByFeature.get(marker.lkFeatureId) : undefined;
      if (marker.lkFeatureId) seen.add(marker.lkFeatureId);
      const [x, y] = scaled([marker.x, marker.y]);
      return before
        ? {
            ...marker,
            id: before.id,
            x,
            y,
            entityId: before.entityId,
            label: before.label || marker.label,
          }
        : { ...marker, x, y };
    });
    // Von Hand gesetzte Marker und solche, die es in LegendKeeper nicht mehr gibt, bleiben.
    for (const marker of old.markers)
      if (!marker.lkFeatureId || !seen.has(marker.lkFeatureId)) markers.push(marker);
    maps[old.id] = {
      ...old,
      rev: old.rev + 1,
      updated: stamp,
      name: old.name || incoming.name,
      lk: incoming.lk,
      frame: old.frame ?? incoming.frame,
      image: incoming.image,
      markers,
      shapes: incoming.shapes.map((shape) => ({ ...shape, points: shape.points.map(scaled) })),
    };
  }

  // ── Artikel: Die aus LegendKeeper werden durch den Export ersetzt. Eigene Artikel und
  //    solche, die in Wayfarer geändert wurden, bleiben, wie sie sind.
  const raw: Record<string, Article> = {};
  for (const article of Object.values(data.articles))
    if (article.source !== 'legendkeeper') raw[article.id] = article;
  let kept = 0;
  for (const incoming of conversion.articles) {
    const old = data.articles[incoming.id];
    if (old && old.source !== 'legendkeeper') {
      kept++;
      continue;
    }
    const docs = incoming.docs.map((doc) =>
      doc.mapId && mapIdOf.has(doc.mapId) ? { ...doc, mapId: mapIdOf.get(doc.mapId)! } : doc,
    );
    raw[incoming.id] = old
      ? { ...incoming, docs, created: old.created, rev: old.rev + 1 }
      : { ...incoming, docs };
  }
  // Erst wenn alle Titel bekannt sind, lassen sich die Verweise als Text schreiben.
  const articles: Record<string, Article> = {};
  let placeholders = 0;
  for (const article of Object.values(raw)) {
    if (article.source !== 'legendkeeper') {
      articles[article.id] = article;
      continue;
    }
    const converted = articleAsText(raw, article);
    articles[article.id] = converted.article;
    placeholders += converted.dropped;
  }

  // ── Namen für Einträge, die bisher nur ein Verweis auf LegendKeeper waren.
  const entities: Record<string, Entity> = { ...data.entities };
  const personIds = new Set<string>();
  const names = new Map<string, LkArticleName>(
    conversion.articles.map((a) => [a.id, { title: a.title, aliases: a.aliases }]),
  );
  const fixes = nameFixes(data, names);
  for (const entity of fixes.changed) {
    entities[entity.id] = { ...entity, rev: entity.rev + 1, updated: stamp };
    if (entity.kind === 'person' && entity.name !== data.entities[entity.id]?.name)
      personIds.add(entity.id);
  }
  counts.named = fixes.named;

  // ── Erkennen: Was beschreibt ein Artikel, und gibt es den Eintrag schon?
  const entityOfArticle = new Map<string, string>();
  for (const entity of Object.values(entities))
    if (entity.lk && !entityOfArticle.has(entity.lk.resourceId))
      entityOfArticle.set(entity.lk.resourceId, entity.id);

  const draftCache = new Map<string, boolean>();
  const inDraft = (info: LkResourceInfo, depth = 0): boolean => {
    const cached = draftCache.get(info.id);
    if (cached !== undefined) return cached;
    const parent = info.parentId ? infos.get(info.parentId) : undefined;
    const result =
      info.template || isDraft(info) || (parent && depth < 64 ? inDraft(parent, depth + 1) : false);
    draftCache.set(info.id, result);
    return result;
  };

  const byName = new Map<string, Entity[]>();
  const byFirstName = new Map<string, Entity[]>();
  const remember = (map: Map<string, Entity[]>, key: string, entity: Entity) => {
    if (!key) return;
    const found = map.get(key);
    if (found) found.push(entity);
    else map.set(key, [entity]);
  };
  for (const entity of Object.values(entities)) {
    remember(byName, looseName(entity.name), entity);
    if (entity.kind === 'character')
      remember(byFirstName, looseName(entity.name).split(' ')[0] ?? '', entity);
  }

  /** Artikel, um die sich diese Übernahme gekümmert hat (neu angelegt oder verknüpft). */
  const handled: LkResourceInfo[] = [];
  let unclear = 0;
  let drafts = 0;

  if (options.recognize)
    for (const info of conversion.resources) {
      if (inDraft(info)) {
        drafts++;
        continue;
      }
      const known = entityOfArticle.get(info.id);
      const recognized = recognizeKind(info);
      if (!recognized) {
        if (known) handled.push(info);
        else unclear++;
        continue;
      }
      const lk = { resourceId: info.id, title: info.name };
      let entity = known ? entities[known] : undefined;
      if (!entity) {
        const fits = (e: Entity) => COMPATIBLE[recognized.kind].includes(e.kind) && !e.lk;
        const sameName = (byName.get(looseName(info.name)) ?? []).filter(fits);
        const firstName =
          recognized.kind === 'person'
            ? (byFirstName.get(looseName(info.name).split(' ')[0] ?? '') ?? []).filter(fits)
            : [];
        const match =
          sameName.length === 1 ? sameName[0] : firstName.length === 1 ? firstName[0] : undefined;
        // Zwischen den Durchläufen kann der Eintrag schon einen anderen Artikel bekommen haben.
        const current = match ? entities[match.id] : undefined;
        if (current && !current.lk) {
          entity = { ...current, lk, rev: current.rev + 1, updated: stamp };
          counts.linked++;
        }
      }
      if (!entity) {
        let id = safeId(`lk-${info.id}`);
        while (entities[id]) id = safeId(`${id}-x`);
        const article = articles[info.id];
        entity = EntitySchema.parse({
          id,
          created: stamp,
          updated: stamp,
          kind: recognized.kind,
          name: info.name,
          aliases: article?.aliases ?? [],
          lk,
          ...(recognized.kind === 'place' ? { place: { category: recognized.category } } : {}),
        });
        counts.created[recognized.kind]++;
        if (entity.kind === 'person') personIds.add(entity.id);
        remember(byName, looseName(entity.name), entity);
      }
      // Ergänzt wird nur, was leer ist.
      const filled: Entity = {
        ...entity,
        tagline: entity.tagline || info.summary,
        image: entity.image ?? info.image,
      };
      entities[filled.id] =
        filled.kind === 'place' && !filled.place.category && recognized.kind === 'place'
          ? { ...filled, place: { ...filled.place, category: recognized.category } }
          : filled;
      entityOfArticle.set(info.id, filled.id);
      handled.push(info);
    }

  // ── Einordnen: Lage im Baum und Verweise im Steckbrief.
  const entityFor = (articleId: string | null | undefined): Entity | undefined => {
    const id = articleId ? entityOfArticle.get(articleId) : undefined;
    return id ? entities[id] : undefined;
  };
  /** Der nächste Ort über einem Artikel und wie viele Stufen er entfernt ist. */
  const placeAbove = (info: LkResourceInfo): { place: Entity; distance: number } | null => {
    let current = info.parentId ? infos.get(info.parentId) : undefined;
    for (let distance = 1; current && distance < 64; distance++) {
      const entity = entityFor(current.id);
      if (entity?.kind === 'place') return { place: entity, distance };
      current = current.parentId ? infos.get(current.parentId) : undefined;
    }
    return null;
  };
  const linked = (info: LkResourceInfo, titles: Set<string>): Entity[] =>
    info.links
      .filter((link) => titles.has(linkKey(link.title)))
      .flatMap((link) => link.ids)
      .map((id) => entityFor(id))
      .filter((e): e is Entity => e !== undefined);
  /** Liegt `candidate` unter `placeId`? Dann darf `placeId` nicht unter `candidate` rücken. */
  const isBelow = (candidate: string, placeId: string): boolean => {
    let current: string | null = candidate;
    for (let i = 0; current && i < 64; i++) {
      if (current === placeId) return true;
      const entity: Entity | undefined = entities[current];
      current = entity?.kind === 'place' ? entity.place.parentId : null;
    }
    return false;
  };

  const relations: Record<string, Relation> = { ...data.relations };
  const relationKeys = new Set(
    Object.values(relations).map((r) => `${r.from}>${r.type}:${r.label}>${r.to}`),
  );
  const relationKinds = { friend: 0, enemy: 0, member: 0, other: 0 };
  const relate = (from: string, to: string, type: string, label = '', mutual = false) => {
    if (from === to) return;
    const key = `${from}>${type}:${label}>${to}`;
    if (relationKeys.has(key) || (mutual && relationKeys.has(`${to}>${type}:${label}>${from}`)))
      return;
    let id = safeId(`lk-${from}-${label ? linkKey(label) : type}-${to}`);
    while (relations[id]) id = safeId(`${id.slice(0, 60)}-x`);
    relations[id] = RelationSchema.parse({
      id,
      created: stamp,
      updated: stamp,
      from,
      to,
      type,
      label,
    });
    relationKeys.add(key);
    counts.relations++;
    relationKinds[type === 'friend' || type === 'enemy' || type === 'member' ? type : 'other']++;
  };

  let parents = 0;
  let homes = 0;
  let seats = 0;
  for (const info of handled) {
    const entity = entityFor(info.id);
    if (!entity) continue;
    const above = placeAbove(info);
    if (entity.kind === 'place' && entity.place.parentId === null) {
      const target =
        linked(info, LINK_TITLES.locatedIn).find((e) => e.kind === 'place') ?? above?.place;
      if (target && target.id !== entity.id && !isBelow(target.id, entity.id)) {
        entities[entity.id] = { ...entity, place: { ...entity.place, parentId: target.id } };
        parents++;
      }
    }
    if (entity.kind === 'person') {
      if (entity.person.homeId === null && above && above.distance <= NEAR) {
        entities[entity.id] = { ...entity, person: { ...entity.person, homeId: above.place.id } };
        homes++;
      }
      // Eine Person, die direkt unter einer Fraktion abgelegt ist, gehört zu ihr.
      const parent = entityFor(info.parentId);
      if (parent?.kind === 'faction') relate(entity.id, parent.id, 'member');
    }
    if (entity.kind === 'faction' && entity.faction.seatId === null) {
      const seat =
        linked(info, LINK_TITLES.headquarters).find((e) => e.kind === 'place') ??
        (above && above.distance <= NEAR ? above.place : undefined);
      if (seat) {
        entities[entity.id] = { ...entity, faction: { ...entity.faction, seatId: seat.id } };
        seats++;
      }
    }
    for (const other of linked(info, LINK_TITLES.friends))
      relate(entity.id, other.id, 'friend', '', true);
    for (const other of linked(info, LINK_TITLES.enemies))
      relate(entity.id, other.id, 'enemy', '', true);
    for (const member of linked(info, LINK_TITLES.members))
      if (member.kind !== 'place') relate(member.id, entity.id, 'member');
    for (const founder of linked(info, LINK_TITLES.founder))
      relate(entity.id, founder.id, 'custom', 'gegründet von');
    for (const creator of linked(info, LINK_TITLES.creator))
      relate(entity.id, creator.id, 'custom', 'erschaffen von');
  }

  // ── Karten mit der Welt verbinden: der Ort der Karte und die Orte an ihren Punkten.
  let placedPins = 0;
  for (const map of Object.values(maps)) {
    if (!map.lk) continue;
    const place = entityFor(map.lk.resourceId);
    let changed = false;
    const markers = map.markers.map((marker) => {
      const target = marker.entityId ? undefined : entityFor(marker.articleId);
      if (!target) return marker;
      changed = true;
      placedPins++;
      return { ...marker, entityId: target.id };
    });
    const placeId = map.placeId ?? (place?.kind === 'place' ? place.id : null);
    if (changed || placeId !== map.placeId) maps[map.id] = { ...map, markers, placeId };
  }

  // ── Bericht
  const { stats } = conversion;
  const adopted: string[] = [
    `${amount(stats.articles, 'Artikel', 'Artikel')} mit ${amount(stats.pages, 'Textseite', 'Textseiten')} ${stats.articles === 1 ? 'liegt' : 'liegen'} jetzt in Wayfarers eigenem Wiki – lesbar ohne LegendKeeper.`,
  ];
  if (stats.maps)
    adopted.push(
      `${amount(stats.maps, 'Karte', 'Karten')} mit ${amount(stats.pins, 'Kartenpunkt', 'Kartenpunkten')}${stats.shapes ? ` und ${amount(stats.shapes, 'eingezeichneten Weg oder Gebiet', 'eingezeichneten Wegen und Gebieten')}` : ''}.${placedPins ? ` ${amount(placedPins, 'Kartenpunkt führt', 'Kartenpunkte führen')} zu einem Eintrag der Welt.` : ''}`,
    );
  if (counts.named)
    adopted.push(
      `${amount(counts.named, 'Person, die', 'Personen, die')} bisher nur als Verweis auf LegendKeeper bekannt ${counts.named === 1 ? 'war, trägt jetzt ihren' : 'waren, tragen jetzt ihren'} Namen.`,
    );
  const createdParts = (Object.keys(counts.created) as RecognizedKind[])
    .filter((kind) => counts.created[kind] > 0)
    .map((kind) => amount(counts.created[kind], ...KIND_WORD[kind]));
  if (createdParts.length)
    adopted.push(`Erkannt und in der Welt angelegt: ${createdParts.join(', ')}.`);
  if (counts.linked)
    adopted.push(
      `${amount(counts.linked, 'vorhandener Eintrag der Welt hat', 'vorhandene Einträge der Welt haben')} den passenden Artikel gefunden und ${counts.linked === 1 ? 'ist' : 'sind'} jetzt damit verknüpft.`,
    );
  if (parents || homes || seats) {
    const parts = [
      parents ? `${amount(parents, 'Ort', 'Orte')} den übergeordneten Ort` : '',
      homes ? `${amount(homes, 'Person', 'Personen')} den Wohnort` : '',
      seats ? `${amount(seats, 'Fraktion', 'Fraktionen')} den Sitz` : '',
    ].filter(Boolean);
    adopted.push(`Aus dem Aufbau des Wikis abgeleitet: ${parts.join(', ')}.`);
  }
  if (counts.relations) {
    const parts = [
      relationKinds.member
        ? amount(relationKinds.member, 'Mitgliedschaft', 'Mitgliedschaften')
        : '',
      relationKinds.friend ? amount(relationKinds.friend, 'Freundschaft', 'Freundschaften') : '',
      relationKinds.enemy ? amount(relationKinds.enemy, 'Feindschaft', 'Feindschaften') : '',
      relationKinds.other ? amount(relationKinds.other, 'weitere', 'weitere') : '',
    ].filter(Boolean);
    adopted.push(
      `${amount(counts.relations, 'Beziehung', 'Beziehungen')} aus den Steckbriefen und dem Aufbau des Wikis: ${parts.join(', ')}.`,
    );
  }

  const hints: string[] = [];
  if (stats.images)
    hints.push(
      `${amount(stats.images, 'Bild liegt', 'Bilder liegen')} weiterhin bei LegendKeeper und ${stats.images === 1 ? 'wird' : 'werden'} von dort geladen. Bevor du LegendKeeper kündigst, müssen sie auf deinen Rechner geholt werden.`,
    );
  if (unclear)
    hints.push(
      `${amount(unclear, 'Artikel bleibt ein reiner Wiki-Artikel', 'Artikel bleiben reine Wiki-Artikel')}, weil nicht eindeutig ist, ob ${unclear === 1 ? 'er' : 'sie'} eine Person, einen Ort, eine Fraktion oder einen Gegenstand ${unclear === 1 ? 'beschreibt' : 'beschreiben'}. Im Wiki lässt sich jeder mit einem Klick in die Welt aufnehmen.`,
    );
  if (drafts)
    hints.push(
      `${amount(drafts, 'Artikel ist eine Vorlage oder ein Entwurf', 'Artikel sind Vorlagen oder Entwürfe')} und ${drafts === 1 ? 'steht' : 'stehen'} nur im Wiki, nicht in der Welt.`,
    );
  if (!options.recognize)
    hints.push('Die Erkennung war abgewählt: In der Welt wurde nichts angelegt.');
  if (kept)
    hints.push(
      `${amount(kept, 'Artikel wurde', 'Artikel wurden')} in Wayfarer geändert und ${kept === 1 ? 'bleibt' : 'bleiben'}, wie ${kept === 1 ? 'er ist' : 'sie sind'} – der Stand aus LegendKeeper überschreibt ${kept === 1 ? 'ihn' : 'sie'} nicht.`,
    );
  if (placeholders)
    hints.push(
      `${amount(placeholders, 'Stelle', 'Stellen')}, die es so nur in LegendKeeper gibt (selbst zusammengestellte Sammlungen), ${placeholders === 1 ? 'fehlt' : 'fehlen'} im Text.`,
    );

  const omitted: string[] = [];
  if (stats.timelines)
    omitted.push(
      `${amount(stats.timelines, 'Zeitleiste', 'Zeitleisten')}: Die Seite ist im Wiki vermerkt, die Ereignisse darauf sind noch nicht übernommen.`,
    );
  if (stats.boards)
    omitted.push(
      `${amount(stats.boards, 'Zeichenfläche', 'Zeichenflächen')} („Board“): Die Seite ist im Wiki vermerkt, die Zeichnung selbst nicht.`,
    );
  const skipped: string[] = stats.skipped
    ? [
        `${amount(stats.skipped, 'Artikel oder Karte war', 'Artikel oder Karten waren')} unlesbar und ${stats.skipped === 1 ? 'fehlt' : 'fehlen'}.`,
      ]
    : [];

  return {
    data: { ...data, entities, relations, maps, articles },
    sections: { adopted, hints, omitted, skipped },
    counts,
    personIds: [...personIds],
  };
}
