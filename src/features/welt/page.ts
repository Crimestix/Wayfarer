/**
 * Die Seite eines Dings in der Welt: was in welcher Reihenfolge dasteht, was leer still wartet
 * („Hinzufügen: …“) und der Steckbrief als Kasten mit Feldern. Eine Seite je Ding, ohne Reiter
 * zum Verstehen – die Gestalt folgt der Art, nie als Filter: Alles Weitere bleibt über
 * „Hinzufügen“ erreichbar. Reine Funktionen; geschrieben wird über `pageActions.ts`.
 */
import { facilityInRoom } from '../../domain/bastion';
import { isWideScale } from '../../domain/placeScale';
import {
  attitudeToParty,
  entityCategory,
  openPromises,
  personPlace,
  placeChildren,
} from '../../domain/derive';
import { creatureOfAnimal } from '../../domain/nature';
import { showsAttitude } from '../../domain/relations';
import { floorCandidates, houseOf, roomCandidates } from '../../domain/rooms';
import { schemesOf } from '../../domain/schemes';
import type { CampaignData, Entity, EntityKind, Place, Shop } from '../../domain/schema';
import { shopsOf } from '../../domain/shop';
import {
  addBlankFactLines,
  hasSteckbrief,
  setSteckbriefField,
  steckbriefFields,
} from '../wiki/factLines';
import { factField, type FactField } from '../wiki/facts';
import { missingScaffold } from '../wiki/scaffold';
import type { WorldEntity } from './model';

// ── Der Steckbrief als Kasten ──────────────────────────────────────────────

export interface BoxRow {
  /** Bezeichnung, wie sie im Steckbrief steht (oder im Gerüst der Art). */
  label: string;
  /** Der Wert, wie er geschrieben steht – leer bei einem leeren Feld. */
  value: string;
  /** Steht die Zeile schon im Text? false = aus dem Gerüst, noch nicht geschrieben. */
  written: boolean;
  /** Was Wayfarer aus dem Feld liest; null = nur für den Spielleiter. */
  field: FactField | null;
}

/**
 * Die Felder des Kastens: erst, was im ersten Steckbrief steht – in seiner Reihenfolge, auch
 * leere Felder –, dann die Felder des Gerüsts der Art, die dort noch fehlen (nicht geschrieben,
 * nur angeboten). Ohne Text (`null`) ist es das ganze Gerüst.
 */
export function boxRows(
  text: string | null,
  kind: EntityKind,
  scaffold: readonly string[],
): BoxRow[] {
  const lines = text ? steckbriefFields(text) : [];
  const written: BoxRow[] = lines.map((line) => ({
    label: line.label,
    value: line.value,
    written: true,
    field: factField(kind, line.label),
  }));
  const offered = missingScaffold(
    kind,
    lines.map((line) => line.label),
    scaffold,
  ).map((label) => ({ label, value: '', written: false, field: factField(kind, label) }));
  return [...written, ...offered];
}

/**
 * Was die Welt zu einem Feld schon weiß, solange es im Steckbrief leer ist – die Art, der Ort
 * darüber, das Zuhause, der Sitz … –, als Name in Worten. Steht im leeren Feld gedämpft da; ein
 * Klick übernimmt es zum Schreiben. Leer, wenn die Welt nichts dazu weiß.
 */
export function worldValue(data: CampaignData, entity: Entity, field: FactField | null): string {
  const name = (id: string | null | undefined) => (id ? (data.entities[id]?.name ?? '') : '');
  switch (field) {
    case 'kind':
      return entityCategory(entity).trim();
    case 'role':
      return entity.kind === 'person' ? entity.person.role.trim() : '';
    case 'species':
      return entity.kind === 'person'
        ? name(entity.person.speciesId) || entity.person.species.trim()
        : '';
    case 'home':
      return entity.kind === 'person' ? name(entity.person.homeId) : '';
    case 'whereabouts':
      return entity.kind === 'person' ? name(personPlace(data, entity)) : '';
    case 'workplace':
      return entity.kind === 'person' ? name(entity.person.workplaceId) : '';
    case 'location':
      return entity.kind === 'place' ? name(entity.place.parentId) : '';
    case 'seat':
      return entity.kind === 'faction'
        ? name(entity.faction.seatId)
        : entity.kind === 'family'
          ? name(entity.family.seatId)
          : '';
    case 'owner':
      return entity.kind === 'item' ? name(entity.item.holderId) : '';
    case 'tool':
      return entity.kind === 'profession' ? entity.profession.tool.trim() : '';
    default:
      return '';
  }
}

/** Ein Feld gilt als ausgefüllt, wenn ein Wert dasteht. */
export const isFilled = (row: Pick<BoxRow, 'value'>): boolean => row.value.trim() !== '';

/** Was der Kasten schon sagt: die Felder, die Wayfarer liest und die ausgefüllt sind. */
export function boxCovers(rows: readonly BoxRow[]): Set<FactField> {
  return new Set(
    rows.filter((row) => row.field !== null && isFilled(row)).map((row) => row.field!),
  );
}

/**
 * Der Text nach dem Schreiben eines Feldes. Hat der Text noch keinen Steckbrief, bekommt er mit
 * dem ersten Wort das ganze Gerüst seiner Art (leere Felder) – vorher wird nichts geschrieben.
 * Ein leerer Wert auf einem Feld, das nicht im Text steht, ändert nichts.
 */
export function writeBoxText(
  text: string,
  label: string,
  value: string,
  scaffold: readonly string[],
): string {
  const present = steckbriefFields(text).some(
    (line) => line.label.toLocaleLowerCase('de') === label.trim().toLocaleLowerCase('de'),
  );
  if (!present && !value.trim()) return text;
  const base = hasSteckbrief(text) ? text : addBlankFactLines(text, scaffold);
  return setSteckbriefField(base, label, value);
}

// ── Läden ──────────────────────────────────────────────────────────────────

/** Orte, die kein einzelner Laden sind, sondern Gegenden, in denen Läden liegen. */
const AREA_WORDS =
  /(stadt|städtchen|dorf|weiler|siedlung|metropole|viertel|bezirk|region|gegend|provinz|reich|kontinent|insel|gebirge|wald|ebene|wüste|meer|welt|land)$/i;

/**
 * Ein Ort, in dem andere Orte liegen (Räume zählen nicht) – oder der seiner Art nach eine Gegend
 * ist: Das Wort der Art endet auf „Stadt“, „Dorf“, „Viertel“, „Land“ … („Hafenstadt“ ja,
 * „Waldschmiede“ nein).
 */
function isArea(data: CampaignData, place: Place): boolean {
  if (placeChildren(data, place.id).some((child) => !child.place.room)) return true;
  // Hat der Spielleiter die Größe festgelegt, gilt sie (`domain/placeScale.ts`).
  if (place.place.scale) return isWideScale(place.place.scale);
  return AREA_WORDS.test(place.place.category.trim());
}

export interface PageShops {
  /** Die Läden, die das Ding selbst ist: der Hauptteil der Seite, gleich unter dem Kopf. */
  lead: Shop[];
  /** Läden, die nur hier stehen (an einer Stadt, ohne eigenen Ort): knapp unter „Darin“. */
  listed: Shop[];
}

/**
 * Welche Läden auf der Seite stehen und wie. Ein Laden ist ein Laden: Auf der Seite des Ortes,
 * der selbst der Laden ist (ein einzelner Ort, keine Gegend), und auf der Seite des Händlers, mit
 * dem er geht, ist er der Hauptteil. Steht ein Laden direkt an einer Stadt, einem Viertel oder
 * einer Gegend, ist er dort nur genannt – nie der Hauptteil eines Ortes darüber.
 */
export function pageShops(data: CampaignData, entity: Entity): PageShops {
  const shops = shopsOf(data, entity.id);
  if (entity.kind !== 'place') return { lead: shops, listed: [] };
  // Ein Laden, der mit seinem Händler geht, gehört auf dessen Seite – am Ort nur, wenn er hier steht.
  const here = shops.filter((shop) => shop.placeId === entity.id);
  return isArea(data, entity) ? { lead: [], listed: here } : { lead: here, listed: [] };
}

// ── Gestalt je Art ─────────────────────────────────────────────────────────

/** Was leer still wartet und über „Hinzufügen“ erscheint. */
export type AddKey =
  | 'shop'
  | 'place'
  | 'rooms'
  | 'magic'
  | 'recipe'
  | 'book'
  | 'life'
  | 'scheme'
  | 'promise'
  | 'combat'
  | 'travel'
  | 'notes'
  | 'secret';

export const ADD_LABEL: Record<AddKey, string> = {
  shop: 'Laden',
  place: 'Ort darin',
  rooms: 'Räume',
  magic: 'Magie',
  recipe: 'Rezept',
  book: 'Buch',
  life: 'Lebenslauf',
  scheme: 'Vorhaben',
  promise: 'Abmachung',
  combat: 'Kampfwerte',
  travel: 'Unterwegs hier',
  notes: 'Notiz',
  secret: 'Geheimnis',
};

/** Linke, breite Spalte: verstehen und schreiben. */
export type MainBlock =
  | 'shop'
  | 'box'
  | 'members'
  | 'people'
  | 'facility'
  | 'places'
  | 'inside'
  | 'shopsHere'
  | 'rooms'
  | 'travel'
  | 'items'
  | 'magic'
  | 'recipe'
  | 'book'
  | 'madeBy'
  | 'combat'
  | 'landscape'
  | 'belongings'
  | 'notes'
  | 'secret'
  | 'text';

/** Rechte, schmale Spalte: was jetzt gilt, womit es verbunden ist, was zuletzt geschah. */
export type SideBlock =
  | 'party'
  | 'changes'
  | 'cast'
  | 'whereabouts'
  | 'attitude'
  | 'schemes'
  | 'promises'
  | 'seat'
  | 'holder'
  | 'life'
  | 'usedIn'
  | 'script'
  | 'nature'
  | 'relations'
  | 'stories'
  | 'knows'
  | 'tracks'
  | 'upcoming'
  | 'recent';

export interface PagePlan {
  main: MainBlock[];
  side: SideBlock[];
  /** Leere Abschnitte, die als eine Zeile „Hinzufügen: …“ warten – in dieser Reihenfolge. */
  add: AddKey[];
}

/** Wer einen Laden haben kann (am Ort, als Händler). */
const SHOP_KINDS = new Set<EntityKind>(['place', 'person', 'faction']);

/**
 * Die Gestalt der Seite: welche Abschnitte in welcher Reihenfolge stehen. Was leer ist, steht
 * nicht da, sondern wartet unter „Hinzufügen“ – bis der Spielleiter es dort öffnet (`opened`).
 * Hat das Ding einen Laden, steht er zuerst. Notizen und Geheimnis erscheinen neben einem Text
 * nur, wenn schon etwas darin steht (Neues gehört in den Text); ohne Text bleiben sie.
 */
export function pagePlan(
  data: CampaignData,
  entity: WorldEntity,
  options: {
    hasText: boolean;
    /** Im Text steht schon mehr als der Steckbrief – dann folgt er gleich ihm (F11). */
    written?: boolean;
    opened?: ReadonlySet<AddKey>;
  },
): PagePlan {
  const opened = options.opened ?? new Set<AddKey>();
  const main: MainBlock[] = [];
  const side: SideBlock[] = [];
  const add: AddKey[] = [];
  /** Ein Abschnitt, der leer still wartet: steht da, wenn er Inhalt hat oder geöffnet wurde. */
  const maybe = (key: AddKey, has: boolean, into: () => void) => {
    if (has || opened.has(key)) into();
    else add.push(key);
  };

  const shops = pageShops(data, entity);
  if (shops.lead.length) main.push('shop');
  else if (SHOP_KINDS.has(entity.kind) && !shops.listed.length)
    maybe('shop', false, () => main.push('shop'));
  main.push('box');

  const promises = openPromises(data, entity.id).length > 0;
  const schemes = schemesOf(data, entity.id).length > 0;

  switch (entity.kind) {
    case 'person':
      main.push('belongings');
      side.push('whereabouts', 'attitude');
      if (promises) side.push('promises');
      maybe('scheme', schemes, () => side.push('schemes'));
      if (!promises) add.push('promise');
      break;
    case 'place': {
      // Liegt hier eine Einrichtung der Bastion, steht sie zuerst da: Der Artikel ist ihre Seite.
      if (facilityInRoom(data, entity.id)) main.push('facility');
      maybe(
        'place',
        placeChildren(data, entity.id).some((child) => !child.place.room),
        () => main.push('places'),
      );
      if (shops.listed.length) main.push('shopsHere');
      maybe(
        'rooms',
        houseOf(data, entity.id).total > 0 ||
          houseOf(data, entity.id).hasFloors ||
          roomCandidates(data, entity.id).length > 0 ||
          floorCandidates(data, entity.id).length > 0,
        () => main.push('rooms'),
      );
      maybe(
        'travel',
        !!entity.place.ground ||
          entity.place.groundSlow ||
          // Auch Klima, Ertrag, Trinkwasser und der SG der Orientierung stehen dort.
          !!entity.place.climateId ||
          entity.place.yield !== null ||
          entity.place.water !== null ||
          entity.place.navDc !== null ||
          Object.values(data.tables).some((table) => table.placeId === entity.id),
        () => main.push('travel'),
      );
      main.push('items');
      side.push('party', 'changes', 'cast', 'nature');
      break;
    }
    case 'faction':
    case 'family':
      main.push('members', 'belongings');
      side.push('attitude');
      maybe('scheme', schemes, () => side.push('schemes'));
      side.push('seat');
      if (promises) side.push('promises');
      else add.push('promise');
      break;
    case 'item': {
      const item = entity.item;
      maybe('magic', item.magic !== null, () => main.push('magic'));
      maybe('recipe', item.recipe !== null, () => main.push('recipe'));
      maybe('book', item.book !== null, () => main.push('book'));
      side.push('holder');
      maybe('life', item.history, () => side.push('life'));
      side.push('usedIn');
      break;
    }
    case 'plant':
    case 'animal':
    case 'mineral':
      if (entity.kind === 'animal')
        maybe('combat', creatureOfAnimal(data, entity) !== null, () => main.push('combat'));
      side.push('usedIn');
      break;
    case 'species':
    case 'language':
    case 'script':
    case 'ability':
    case 'profession':
      main.push('people');
      if (entity.kind === 'profession') main.push('madeBy');
      if (entity.kind === 'language' || entity.kind === 'script') side.push('script');
      break;
    case 'topic':
      break;
    case 'landscape':
      main.push('landscape');
      break;
    case 'celestial':
    case 'dimension':
      // Was darin liegt – der Abschnitt steht immer da: Hier ordnet man die Welt ein.
      main.push('inside');
      break;
  }

  // Haltung haben Wesen und Gruppen; bei allem anderen steht sie nur, wenn sie eingetragen ist.
  if (!side.includes('attitude') && showsAttitude(entity.kind, attitudeToParty(data, entity.id)))
    side.unshift('attitude');

  // Notiz und Geheimnis stehen da, wenn etwas darin steht – leer warten sie unter „Hinzufügen“
  // (Rundgang 17. 11.: drei leere Felder untereinander machten die Seite voll).
  maybe('notes', !!entity.notes.trim(), () => main.push('notes'));
  maybe('secret', !!entity.secret.trim(), () => main.push('secret'));
  // Steht ein Text da, folgt er gleich dem Steckbrief – vor Listen wie Orten darin und Räumen
  // (F11: der Artikel ist das Eigentliche). Ohne Text wartet die Schreibfläche am Ende.
  if (options.written ?? options.hasText) main.splice(main.indexOf('box') + 1, 0, 'text');
  else main.push('text');
  side.push('relations', 'stories', 'knows', 'tracks', 'upcoming', 'recent');
  return { main, side, add };
}

/**
 * Angaben im Kopf, die schon anderswo stehen – die Art neben dem Namen, Rolle und Volk im
 * Steckbrief, der Ort darüber im Pfad, Aufenthalt, Sitz und Verbleib rechts unter „Jetzt“ –,
 * nicht noch einmal.
 */
const SHOWN_ELSEWHERE = new Set([
  'Art',
  'Rolle',
  'Spezies',
  'Volk',
  'Aufenthalt',
  'Zustand',
  'Zuhause',
  'Befindet sich bei',
  'Verbleib',
  'Liegt in',
  'Sitz',
  'Stammsitz',
]);

/** Die Angaben unter dem Namen ohne das, was die Seite an anderer Stelle zeigt. */
export function headFacts<F extends { label: string }>(facts: readonly F[]): F[] {
  return facts.filter((fact) => !SHOWN_ELSEWHERE.has(fact.label));
}
