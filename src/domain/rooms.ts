/**
 * Räume und Etagen: Orte, die zu einem Ort darüber gehören (Festung, Verlies, Haus) und deshalb
 * nicht einzeln zwischen den Orten der Welt stehen, sondern auf der Seite des Ortes darüber. Eine
 * Etage ist ein Raum, der Räume enthält (Rückmeldung des Spielleiters, 18. 11. 2026:
 * „Dungeonräume, Haus-Räume, Etagen … müssen ihren Platz finden“): Haus › Etage › Raum. Was für
 * ein Raum es ist (Dungeonraum, Wohnraum), sagt seine Unterkategorie. Reine Funktionen.
 */
import { SUGGESTION } from './dismiss';
import { scaleOfWord } from './placeScale';
import type { CampaignData, Entity, Place } from './schema';

/** So viel Text zeigt ein aufgeklappter Raum; der Rest steht auf seiner Seite. */
export const ROOM_TEXT_MAX = 700;

/**
 * Was zu einem Raum geschrieben steht: die Notizen – sonst der Text seines Artikels (Räume aus
 * LegendKeeper), ohne Kästen wie den Steckbrief, gekürzt.
 */
export function roomText(data: Pick<CampaignData, 'articles'>, room: Place): string {
  if (room.notes.trim()) return room.notes.trim();
  const article = room.lk?.resourceId ? data.articles[room.lk.resourceId] : undefined;
  if (!article) return '';
  const text = article.docs
    .map((doc) => doc.text)
    .join('\n\n')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > ROOM_TEXT_MAX ? `${text.slice(0, ROOM_TEXT_MAX).trimEnd()} …` : text;
}

/**
 * Ein Raum, der auf der Seite seines Ortes steht. Gibt es den Ort darüber nicht (mehr) – gelöscht,
 * ganz oben, von Hand gelöst –, steht er für sich, damit er nirgends verloren geht.
 */
export function isRoom(data: Pick<CampaignData, 'entities'>, entity: Entity | undefined): boolean {
  if (entity?.kind !== 'place' || !entity.place.room || !entity.place.parentId) return false;
  return data.entities[entity.place.parentId]?.kind === 'place';
}

const natural = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** Eine Etage: ein Raum, der Räume enthält. */
export const isFloor = (entity: Entity | undefined): entity is Place =>
  entity?.kind === 'place' && entity.place.room && entity.place.floor;

/** Die Räume unmittelbar an einem Ort (oder auf einer Etage), nach Namen („2 Halle“ vor „10 Gruft“). */
export function roomsOf(data: Pick<CampaignData, 'entities'>, placeId: string): Place[] {
  return Object.values(data.entities)
    .filter(
      (entity): entity is Place =>
        entity.kind === 'place' &&
        entity.place.room &&
        !entity.place.floor &&
        entity.place.parentId === placeId,
    )
    .sort((a, b) => natural.compare(a.name, b.name));
}

/** Die Etagen eines Ortes von oben nach unten: erst die geordneten, dann die übrigen nach Namen. */
export function floorsOf(data: Pick<CampaignData, 'entities'>, placeId: string): Place[] {
  return Object.values(data.entities)
    .filter((entity): entity is Place => isFloor(entity) && entity.place.parentId === placeId)
    .sort((a, b) => {
      const [la, lb] = [a.place.level, b.place.level];
      if (la !== null && lb !== null && la !== lb) return lb - la;
      if ((la === null) !== (lb === null)) return la === null ? 1 : -1;
      return natural.compare(a.name, b.name);
    });
}

export interface HouseFloor {
  /** Die Etage – null für Räume, die unmittelbar am Ort hängen. */
  floor: Place | null;
  rooms: Place[];
}

export interface House {
  /** Die Etagen von oben nach unten, zuletzt die Räume ohne Etage. */
  floors: HouseFloor[];
  /** Räume insgesamt – Etagen zählen nicht mit. */
  total: number;
  hasFloors: boolean;
}

/** Ein Ort mit seinen Etagen und Räumen – so steht er auf seiner Seite unter „Räume“. */
export function houseOf(data: Pick<CampaignData, 'entities'>, placeId: string): House {
  const floors: HouseFloor[] = floorsOf(data, placeId).map((floor) => ({
    floor,
    rooms: roomsOf(data, floor.id),
  }));
  const hasFloors = floors.length > 0;
  const direct = roomsOf(data, placeId);
  if (direct.length || !hasFloors) floors.push({ floor: null, rooms: direct });
  return { floors, hasFloors, total: floors.reduce((sum, entry) => sum + entry.rooms.length, 0) };
}

/** Alle Räume eines Ortes, auch die auf seinen Etagen. */
export function allRoomsOf(data: Pick<CampaignData, 'entities'>, placeId: string): Place[] {
  return houseOf(data, placeId).floors.flatMap((entry) => entry.rooms);
}

/** Wörter, an denen man eine Etage erkennt. */
const FLOOR_WORDS =
  /(\betage\b|stockwerk|\bstock\b|geschoss\b|\bebene\s+[\divx]+\b|\blevel\s+\d+|dachboden)/i;

/**
 * Wo eine Etage dem Namen nach liegt („Keller“ unten, „2. Stock“ oben) – nur für die übliche
 * Reihenfolge beim ersten Mal; null, wenn der Name nichts sagt. Der Spielleiter ordnet danach selbst.
 */
export function guessLevel(name: string): number | null {
  const text = name.toLocaleLowerCase('de');
  const number = Number(/(\d+)/.exec(text)?.[1] ?? NaN);
  if (/untergeschoss|kellergeschoss|\bug\b/.test(text)) return Number.isNaN(number) ? -1 : -number;
  if (/keller|gruft|katakombe|verlies|kerker/.test(text)) return -1;
  if (/erdgeschoss|\beg\b|parterre/.test(text)) return 0;
  if (/obergeschoss|stock|etage|\bog\b/.test(text)) return Number.isNaN(number) ? 1 : number;
  if (/dach|speicher|zinne/.test(text)) return 90;
  if (/turm/.test(text)) return 80;
  return null;
}

/** Sieht ein Ort unter einem anderen aus wie dessen Etage? Er enthält Räume oder heißt so. */
function looksLikeFloor(data: Pick<CampaignData, 'entities'>, place: Place): boolean {
  // Eine Siedlung oder Gegend ist nie eine Etage, auch wenn Räume darin liegen.
  const wide = place.place.scale || scaleOfWord(place.place.category);
  if (wide === 'world' || wide === 'region' || wide === 'settlement') return false;
  if (FLOOR_WORDS.test(place.name) || FLOOR_WORDS.test(place.place.category)) return true;
  return Object.values(data.entities).some(
    (entity) => entity.kind === 'place' && entity.place.parentId === place.id && entity.place.room,
  );
}

/**
 * Orte unter diesem Ort, die wie seine Etagen aussehen, aber noch keine sind („Ebene 1“ mit
 * Räumen darin) – zum einmaligen Umwandeln, nur ein Vorschlag.
 */
export function floorCandidates(
  data: Pick<CampaignData, 'entities'> & Partial<Pick<CampaignData, 'state'>>,
  placeId: string,
): Place[] {
  if (data.state?.dismissed.includes(SUGGESTION.floor(placeId))) return [];
  return Object.values(data.entities)
    .filter(
      (entity): entity is Place =>
        entity.kind === 'place' &&
        !entity.place.room &&
        entity.place.parentId === placeId &&
        looksLikeFloor(data, entity),
    )
    .sort((a, b) => natural.compare(a.name, b.name));
}

/** Die Artikel der Räume – sie stehen nicht im Baum des Wikis. */
export function roomArticleIds(data: Pick<CampaignData, 'entities'>): Set<string> {
  const out = new Set<string>();
  for (const entity of Object.values(data.entities))
    if (isRoom(data, entity) && entity.lk?.resourceId) out.add(entity.lk.resourceId);
  return out;
}

/** Wörter der Art, an denen man einen Raum erkennt („Dungeonraum“, „Kammer“ …). */
const ROOM_WORDS = /(raum|räume|kammer|halle|zelle|gewölbe|gruft|kerker|stube|saal|keller)/i;

/** Der Schlüssel, unter dem der Vorschlag „alle auf einmal“ weggeklickt wird. */
export const ALL_ROOMS = 'alle';

/**
 * Alle Orte der Welt, die wie Räume aussehen, aber noch keine sind (Rückmeldung des Spielleiters,
 * 18. 11. 2026: „Dungeon-Räume sind keine Orte“): ein Wort wie „Dungeonraum“ oder „Kammer“ und
 * ein Ort darüber, zu dem sie gehören. Nur ein Vorschlag – umgewandelt wird auf Klick.
 */
export function roomLikes(
  data: Pick<CampaignData, 'entities'> & Partial<Pick<CampaignData, 'state'>>,
): Place[] {
  if (data.state?.dismissed.includes(SUGGESTION.room(ALL_ROOMS))) return [];
  return Object.values(data.entities).filter(
    (entity): entity is Place =>
      entity.kind === 'place' &&
      !entity.place.room &&
      !!entity.place.parentId &&
      data.entities[entity.place.parentId]?.kind === 'place' &&
      ROOM_WORDS.test(entity.place.category),
  );
}

/** Orte unter diesem Ort, die wie Räume aussehen, aber noch keine sind – zum einmaligen Umwandeln. */
export function roomCandidates(
  data: Pick<CampaignData, 'entities'> & Partial<Pick<CampaignData, 'state'>>,
  placeId: string,
): Place[] {
  // „Passt nicht“ am Ort weggeklickt: kein Vorschlag mehr für ihn.
  if (data.state?.dismissed.includes(SUGGESTION.room(placeId))) return [];
  return Object.values(data.entities).filter(
    (entity): entity is Place =>
      entity.kind === 'place' &&
      !entity.place.room &&
      entity.place.parentId === placeId &&
      ROOM_WORDS.test(entity.place.category) &&
      // Was nach einer Etage aussieht, wird als Etage vorgeschlagen, nicht als Raum.
      !looksLikeFloor(data, entity),
  );
}

export interface RoomLine {
  name: string;
  /** Was nach einem Gedankenstrich oder Doppelpunkt steht: die kurze Beschreibung. */
  tagline: string;
}

/** Mehrere Räume auf einmal: eine Zeile je Raum, „1 Eingangshalle – eingestürzt“. */
export function parseRoomLines(text: string): RoomLine[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split(/\s+[–—-]\s+|:\s+/);
      return { name: name!.trim(), tagline: rest.join(' – ').trim() };
    })
    .filter((line) => line.name);
}

export interface RoomPlan {
  /** Etagen in der Reihenfolge, in der sie geschrieben stehen: von oben nach unten. */
  floors: (RoomLine & { rooms: RoomLine[] })[];
  /** Räume ohne Etage. */
  rooms: RoomLine[];
}

/**
 * Ein ganzes Haus auf einmal. Eine Etage ist eine Zeile, die mit einem Doppelpunkt endet
 * („Keller:“) – alle Zeilen darunter sind ihre Räume, bis zu einer Leerzeile oder der nächsten
 * Etage – oder eine Zeile, unter der eingerückte Zeilen stehen. Alles andere sind Räume ohne
 * Etage: So bleibt „eine Zeile je Raum“, wie es war.
 */
export function parseRoomPlan(text: string): RoomPlan {
  const lines = text.split('\n');
  const plan: RoomPlan = { floors: [], rooms: [] };
  let floor: RoomPlan['floors'][number] | null = null;
  /** Nimmt die Etage alles darunter (Doppelpunkt) oder nur Eingerücktes? */
  let takesAll = false;
  lines.forEach((raw, index) => {
    if (!raw.trim()) {
      floor = null;
      return;
    }
    const indented = /^\s/.test(raw);
    const colon = /:\s*$/.test(raw);
    const next = lines[index + 1];
    const heads = colon || (!indented && next !== undefined && /^\s+\S/.test(next));
    const [line] = parseRoomLines(colon ? raw.replace(/:\s*$/, '') : raw);
    if (!line) return;
    if (heads) {
      floor = { ...line, rooms: [] };
      takesAll = colon;
      plan.floors.push(floor);
    } else if (floor && (indented || takesAll)) floor.rooms.push(line);
    else {
      floor = null;
      plan.rooms.push(line);
    }
  });
  return plan;
}

// ── Räume und Etagen aus Geschriebenem ─────────────────────────────────────

export interface RoomSource {
  /** Stabil je Vorschlag: der Ort oder, ohne Ort, `artikel:<id>`. */
  key: string;
  name: string;
  /** Der Ort – null, wenn es bisher nur den Artikel gibt. */
  placeId: string | null;
  articleId: string | null;
  /** Der Vorschlag, unter dem dieser steht – null: unmittelbar am Ort (oder an `anchorId`). */
  parentKey: string | null;
  /** Der nächste Ort darüber, den es schon gibt: der Ort selbst, eine Etage, ein Ort darin. */
  anchorId: string;
  depth: number;
  /** Was es wohl ist – nur die Vorwahl, der Spielleiter entscheidet. */
  guess: 'floor' | 'room';
  /** Vorgewählt? Nicht, was erkennbar eine Siedlung oder Gegend ist. */
  preselect: boolean;
  /** In wenigen Worten, was es bisher ist. */
  note: string;
}

/**
 * Was unter einem Ort schon geschrieben steht und Raum oder Etage werden könnte (Rückmeldung des
 * Spielleiters, 18. 11. 2026: „Auch hier brauchen wir die Artikel der einzelnen Räume, der
 * Etagen“): Orte darin, die noch keine Räume sind, und Artikel unter seinem Artikel, zu denen es
 * noch keinen Eintrag gibt – in der Ordnung, in der sie untereinander hängen. Nur eine Liste zum
 * Ankreuzen; übernommen wird auf Klick (`takeRoomSources`).
 */
export function roomSources(
  data: Pick<CampaignData, 'entities' | 'articles'>,
  placeId: string,
): RoomSource[] {
  const home = data.entities[placeId];
  if (home?.kind !== 'place') return [];
  const placesUnder = new Map<string, Place[]>();
  const ownerOf = new Map<string, Entity>();
  for (const entity of Object.values(data.entities)) {
    if (entity.lk) ownerOf.set(entity.lk.resourceId, entity);
    if (entity.kind !== 'place' || !entity.place.parentId) continue;
    const list = placesUnder.get(entity.place.parentId);
    if (list) list.push(entity);
    else placesUnder.set(entity.place.parentId, [entity]);
  }
  const articlesUnder = new Map<string, { id: string; title: string }[]>();
  for (const article of Object.values(data.articles)) {
    if (!article.parentId || article.template) continue;
    const list = articlesUnder.get(article.parentId);
    if (list) list.push(article);
    else articlesUnder.set(article.parentId, [article]);
  }
  const byName = <T extends { name?: string; title?: string }>(list: T[] | undefined): T[] =>
    [...(list ?? [])].sort((a, b) =>
      natural.compare(a.name ?? a.title ?? '', b.name ?? b.title ?? ''),
    );
  const out: RoomSource[] = [];
  const seen = new Set<string>();

  const walkArticles = (
    articleId: string,
    parentKey: string | null,
    anchorId: string,
    depth: number,
  ) => {
    for (const article of byName(articlesUnder.get(articleId))) {
      const key = `artikel:${article.id}`;
      // Gehört der Artikel schon einem Eintrag, ist er dort zu Hause – als Ort darin steht er
      // ohnehin zur Wahl, alles andere (eine Person, ein Ort anderswo) ist kein Raum.
      if (seen.has(key) || ownerOf.has(article.id)) continue;
      seen.add(key);
      out.push({
        key,
        name: article.title,
        placeId: null,
        articleId: article.id,
        parentKey,
        anchorId,
        depth,
        guess: 'room',
        preselect: true,
        note: 'Artikel ohne Eintrag',
      });
      walkArticles(article.id, key, anchorId, depth + 1);
    }
  };
  const walkPlace = (place: Place, parentKey: string | null, depth: number) => {
    for (const child of byName(placesUnder.get(place.id))) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      if (child.place.room) {
        // Schon ein Raum oder eine Etage: steht nicht zur Wahl – aber was darin noch offen ist.
        walkPlace(child, null, 0);
        continue;
      }
      const wide = child.place.scale || scaleOfWord(child.place.category);
      out.push({
        key: child.id,
        name: child.name,
        placeId: child.id,
        articleId: child.lk && data.articles[child.lk.resourceId] ? child.lk.resourceId : null,
        parentKey,
        anchorId: place.id,
        depth,
        guess: 'room',
        preselect: wide !== 'world' && wide !== 'region' && wide !== 'settlement',
        note: child.place.category.trim() || 'Ort darin',
      });
      walkPlace(child, child.id, depth + 1);
    }
    const articleId = place.lk?.resourceId;
    if (articleId && data.articles[articleId]) walkArticles(articleId, parentKey, place.id, depth);
  };
  seen.add(home.id);
  walkPlace(home, null, 0);

  // Unmittelbar am Ort und mit etwas darunter (oder mit einem Namen wie „Ebene 2“): eine Etage.
  const withKids = new Set(out.map((source) => source.parentKey).filter(Boolean));
  return out.map((source) => {
    const place = source.placeId ? (data.entities[source.placeId] as Place) : null;
    const floorLike =
      withKids.has(source.key) ||
      FLOOR_WORDS.test(source.name) ||
      (place ? looksLikeFloor(data, place) : false);
    const atHome = source.depth === 0 && source.anchorId === home.id;
    return atHome && floorLike ? { ...source, guess: 'floor' as const } : source;
  });
}
