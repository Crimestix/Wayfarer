/**
 * Landschaften (Wunsch des Spielleiters, 17. 11. 2026: „Unsere Gelände funktionieren ähnlich wie
 * Minecrafts Biome“): Eine Landschaft ist ein Eintrag der Welt („Nebelwald“, „Schwarzmoor“), den
 * man auf Hexkarten malt. Sie sagt, welches Grundgelände für die Regeln zählt (`base`), wie sie
 * aussieht (`look`, eine Geländeart) und wer dort lebt (`dwellersOf`). „Beleben“ setzt nach festen
 * Regeln die Baue ihrer Bewohner auf die Felder (`lairPlan`) – so viele, wie ihre Reviere Platz
 * haben. Erzeugt wird nur Beiwerk: wo ein Bau liegt, nie wer dort eine Geschichte hat.
 *
 * Reine Rechnung.
 */
import { creatureChain } from './creature';
import { hexDistance, hexKey, type HexCoord } from './hex';
import { hexKind, HEX_KINDS } from './hexKinds';
import { natureOf } from './nature';
import { rngOf, seedOf } from './random';
import { rollAppearing } from './roaming';
import type { Area, CampaignData, Hex, Landscape, Stock } from './schema';

/** Ein Revier, wenn das Wesen keins nennt: groß genug, dass ein Wald nicht voller Baue ist. */
export const DEFAULT_TERRITORY_KM2 = 1000;

/** Fläche eines Feldes in km² – `hexKm` ist der Abstand zweier gegenüberliegender Seiten. */
export const hexAreaKm2 = (hexKm: number): number => (Math.sqrt(3) / 2) * hexKm * hexKm;

/** Alle Landschaften, nach Namen. */
export function landscapesOf(data: Pick<CampaignData, 'entities'>): Landscape[] {
  return Object.values(data.entities)
    .filter((entity): entity is Landscape => entity.kind === 'landscape')
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

const norm = (text: string) => text.trim().toLocaleLowerCase('de');

/**
 * Wie eine Landschaft aussieht: ihre eigene Geländeart, sonst die Geländeart gleichen Namens
 * („Moor“ sieht aus wie Moor), sonst ihr Grundgelände.
 */
export function landscapeLook(landscape: Landscape): string {
  const own = hexKind(landscape.landscape.look);
  if (own) return own.key;
  const named = HEX_KINDS.find((kind) => norm(kind.label) === norm(landscape.name));
  return named?.key ?? landscape.landscape.base;
}

/** Was ein Pinsel mit dieser Landschaft an einem Feld setzt. */
export function paintOfLandscape(
  landscape: Landscape,
): Pick<Hex, 'terrain' | 'kind' | 'landscapeId'> {
  const look = hexKind(landscapeLook(landscape));
  // Die Geländeart zählt nur, wenn sie zum Grundgelände der Landschaft passt.
  const kind =
    look && look.base === landscape.landscape.base && look.key !== look.base ? look.key : null;
  return { terrain: landscape.landscape.base, kind, landscapeId: landscape.id };
}

/**
 * Die Landschaft gleichen Namens wie eine Geländeart – sie tritt in der Palette an deren Stelle
 * (Entscheidung 17. 11.: „Die 46 Arten bleiben die Palette; eine Landschaft gleichen Namens
 * übernimmt“).
 */
export function landscapeOfKind(
  data: Pick<CampaignData, 'entities'>,
  kindKey: string,
): Landscape | undefined {
  const kind = hexKind(kindKey);
  if (!kind) return undefined;
  return landscapesOf(data).find((landscape) => norm(landscape.name) === norm(kind.label));
}

/** Wie ein Feld heißt: die Landschaft, wenn eine darauf gemalt ist – sonst undefined. */
export function landscapeOfHex(
  data: Pick<CampaignData, 'entities'>,
  hex: Pick<Hex, 'landscapeId'>,
): Landscape | undefined {
  const entity = hex.landscapeId ? data.entities[hex.landscapeId] : undefined;
  return entity?.kind === 'landscape' ? entity : undefined;
}

export interface Dweller {
  /** Das Wesen des Bestiariums – „Beleben“ braucht seine Werte. */
  creatureId: string;
  name: string;
  /** Woher Wayfarer es weiß: „steht an der Landschaft“ oder „Lebensraum des Tiers“. */
  via: 'listed' | 'habitat';
}

/**
 * Wer in einer Landschaft lebt – in beide Richtungen verknüpft: was an der Landschaft steht
 * (Wesen, Tier mit Kampfwerten, Spezies mit ihren Wesen) und Tiere, deren Lebensraum den Namen
 * der Landschaft nennt („Lebensraum: Nebelwald“). Nur, was Kampfwerte im Bestiarium hat.
 */
export function dwellersOf(data: CampaignData, landscapeId: string): Dweller[] {
  const landscape = data.entities[landscapeId];
  if (landscape?.kind !== 'landscape') return [];
  const out = new Map<string, Dweller>();
  const add = (creatureId: string | null | undefined, via: Dweller['via']) => {
    const creature = creatureId ? data.creatures[creatureId] : undefined;
    if (!creature || out.has(creature.id)) return;
    out.set(creature.id, { creatureId: creature.id, name: creature.name, via });
  };
  for (const id of landscape.landscape.dwellerIds) {
    if (data.creatures[id]) add(id, 'listed');
    const entity = data.entities[id];
    if (entity?.kind === 'animal') add(entity.animal.creatureId, 'listed');
    if (entity?.kind === 'species')
      for (const creature of Object.values(data.creatures))
        if (creature.speciesId === entity.id) add(creature.id, 'listed');
  }
  const name = norm(landscape.name);
  for (const entity of Object.values(data.entities)) {
    if (entity.kind !== 'animal' || !entity.animal.creatureId) continue;
    if (natureOf(entity).habitat.some((word) => norm(word) === name))
      add(entity.animal.creatureId, 'habitat');
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Das Revier eines Wesens in km² – eigene Angabe vor geerbter, sonst die Vorgabe. */
export function territoryOf(data: Pick<CampaignData, 'creatures'>, creatureId: string): number {
  let km2: number | null = null;
  for (const link of creatureChain(data.creatures, creatureId))
    if (link.roaming.territoryKm2) km2 = link.roaming.territoryKm2;
  return km2 ?? DEFAULT_TERRITORY_KM2;
}

/** Ein Bau, den „Beleben“ setzen würde. */
export interface LairPlan {
  landscapeId: string;
  creatureId: string;
  name: string;
  at: HexCoord & { level: number };
  count: number;
}

/** Baue auf einer Karte: was schon liegt (eigene oder erzeugte). */
export function lairsOnArea(data: Pick<CampaignData, 'stocks'>, areaId: string): Stock[] {
  return Object.values(data.stocks).filter((stock) => stock.at?.areaId === areaId);
}

/**
 * Was „Beleben“ auf einer Karte setzt: je Landschaft und Bewohner so viele Baue, wie Reviere auf
 * ihre Fläche passen (gerundet; ab einem Viertel Revier einer), auf Feldern dieser Landschaft ohne
 * Ort, so weit auseinander, wie ein Revier reicht. Fest: gleiche Karte → gleiche Baue. Baue, die
 * schon auf der Karte liegen, zählen mit – es kommen nur die fehlenden dazu.
 */
export function lairPlan(data: CampaignData, area: Area): LairPlan[] {
  const fieldKm2 = hexAreaKm2(area.hexKm);
  const existing = lairsOnArea(data, area.id);
  const plans: LairPlan[] = [];
  const byLandscape = new Map<string, Hex[]>();
  for (const hex of area.hexes) {
    if (!hex.landscapeId || hex.placeId) continue;
    if (hex.exits && hex.exits.length === 0) continue;
    byLandscape.set(hex.landscapeId, [...(byLandscape.get(hex.landscapeId) ?? []), hex]);
  }
  for (const [landscapeId, cells] of byLandscape) {
    const painted = area.hexes.filter((hex) => hex.landscapeId === landscapeId).length;
    const km2 = painted * fieldKm2;
    for (const dweller of dwellersOf(data, landscapeId)) {
      const territory = territoryOf(data, dweller.creatureId);
      const share = km2 / territory;
      let wanted = share >= 0.25 ? Math.max(1, Math.round(share)) : 0;
      wanted = Math.min(wanted, Math.ceil(cells.length / 2));
      const taken: HexCoord[] = existing
        .filter((stock) => stock.groups.some((group) => group.creatureId === dweller.creatureId))
        .map((stock) => stock.at!)
        .filter((at) => cells.some((cell) => cell.q === at.q && cell.r === at.r));
      wanted -= taken.length;
      if (wanted <= 0) continue;
      // So weit liegen zwei Baue mindestens auseinander: der Halbmesser eines Reviers in Feldern.
      const apart = Math.max(1, Math.round(Math.sqrt(territory / fieldKm2 / Math.PI)));
      const rng = rngOf(seedOf(area.id, 'beleben', landscapeId, dweller.creatureId));
      const order = cells
        .map((cell) => ({ cell, at: rng.next() }))
        .sort((a, b) => a.at - b.at || hexKey(a.cell).localeCompare(hexKey(b.cell)))
        .map((entry) => entry.cell);
      const occupied = new Set(existing.map((stock) => hexKey(stock.at!)));
      for (const plan of plans) occupied.add(hexKey(plan.at));
      for (const cell of order) {
        if (wanted <= 0) break;
        if (occupied.has(hexKey(cell))) continue;
        if (taken.some((other) => hexDistance(other, cell) < apart)) continue;
        const appearing = creatureChain(data.creatures, dweller.creatureId)
          .map((link) => link.roaming.appearing.trim())
          .filter(Boolean)
          .pop();
        const count = (appearing && rollAppearing(appearing, (sides) => rng.int(1, sides))) || 1;
        plans.push({
          landscapeId,
          creatureId: dweller.creatureId,
          name: `Bau: ${dweller.name}`,
          at: { q: cell.q, r: cell.r, level: cell.level },
          count,
        });
        taken.push(cell);
        occupied.add(hexKey(cell));
        wanted--;
      }
    }
  }
  return plans;
}
