/**
 * Graben unter der Erde (Rückmeldung des Spielleiters, 20. 11. 2026: „Die Gänge sollten ein
 * smartes System sein, das sich quasi durch den Fels gräbt und dabei mittig bleibt“): Auf einer
 * Karte mit Gängen malt der Gelände-Pinsel nicht nur, wie ein Feld aussieht – er **gräbt**.
 *
 * - Ein **Gang** (Ganggeflecht) folgt dem Strich von Feld zu Feld: Verbunden wird, worüber die
 *   Maus fährt, nicht jeder Nachbar. Beginnt der Strich im Fels neben etwas Offenem, schließt er
 *   dort an – am liebsten an ein Gangende. Führt er durch eine Höhle, bleibt sie Höhle.
 * - Eine **Höhle** (Höhlenboden, Kaverne, Pilzwald, See …) wächst mit allen Höhlen zusammen, die
 *   an sie grenzen; allein steht sie als geschlossene Kammer, bis ein Gang hinführt.
 * - **Massivfels** schüttet zu: kein Ausgang mehr, auch nicht von den Nachbarn.
 * - Ein Gang, der als Sackgasse **vor einer Höhle endet**, führt hinein (`joinTunnelEnd`, am Ende
 *   des Strichs) – und eine Höhle, die neben ein Gangende gemalt wird, nimmt es auf (Rückmeldung
 *   20. 11.: „Stellen, wo der Gang nicht vernünftig an Höhlen anschließt“).
 *
 * Gerechnet wird nur mit den Ausgängen der Felder (`domain/passages.ts`) – das Bild der Karte
 * folgt daraus. Reine Funktionen.
 */
import { HEX_DIRECTIONS, hexKey, hexLine, type HexCoord } from '../../domain/hex';
import { SOLID_ROCK, WIDE_CAVE_KINDS, kindKeyOf } from '../../domain/hexKinds';
import { dirTo, setPassage } from '../../domain/passages';
import type { Hex } from '../../domain/schema';

const keyOf = (c: HexCoord) => hexKey({ q: c.q, r: c.r, level: c.level ?? 0 });

/** Eine Höhle: eine Geländeart, die ihr Feld weit ausfüllt. */
export const isWideCave = (hex: Pick<Hex, 'kind' | 'terrain'>): boolean =>
  WIDE_CAVE_KINDS.has(kindKeyOf(hex) ?? '');

/** Offen: ein Feld mit Ausgängen – oder eine Höhle, auch wenn noch kein Gang hinführt. */
const isOpen = (hex: Hex): boolean =>
  kindKeyOf(hex) !== SOLID_ROCK && ((hex.exits ?? []).length > 0 || isWideCave(hex));

const hasExit = (hex: Hex, dir: number) => (hex.exits ?? []).some((exit) => exit.dir === dir);

/** Ein Gangende: ein Gang (keine Höhle) mit genau einem Ausgang zur Seite. */
const isDeadEnd = (hex: Hex): boolean =>
  kindKeyOf(hex) !== SOLID_ROCK &&
  !isWideCave(hex) &&
  (hex.exits ?? []).filter((exit) => exit.dir < 6).length === 1;

/** Öffnet den Durchgang zwischen zwei Nachbarn, wenn dort noch keiner ist (ein vorhandener bleibt, wie er ist). */
function open(hexes: Hex[], a: HexCoord, b: HexCoord): Hex[] {
  const dir = dirTo(a, b);
  const from = hexes.find((hex) => hexKey(hex) === keyOf(a));
  if (dir === null || !from || hasExit(from, dir)) return hexes;
  if (!hexes.some((hex) => hexKey(hex) === keyOf(b))) return hexes;
  return setPassage(hexes, from, dir, 'open');
}

/** Schüttet ein Feld zu: keine Ausgänge mehr, auch nicht von den Nachbarn her. */
function seal(hexes: Hex[], at: HexCoord): Hex[] {
  const key = keyOf(at);
  const hex = hexes.find((entry) => hexKey(entry) === key);
  if (!hex) return hexes;
  let next = hexes;
  for (const exit of hex.exits ?? []) next = setPassage(next, hex, exit.dir, null);
  return next.map((entry) => {
    if (hexKey(entry) === key) return { ...entry, exits: [], kind: SOLID_ROCK, landscapeId: null };
    // Wer nur einseitig hierher führte (Abbruch), verliert den Ausgang auch.
    const back = entry.exits?.filter((exit) => {
      const d = HEX_DIRECTIONS[exit.dir];
      return !d || keyOf({ q: entry.q + d.q, r: entry.r + d.r, level: entry.level }) !== key;
    });
    return back && back.length !== entry.exits!.length ? { ...entry, exits: back } : entry;
  });
}

export interface DigStep {
  /** Das Feld unter dem Zeiger. */
  at: HexCoord;
  /** Alle Felder unter dem Pinsel (bei Größe 1 nur `at`). */
  coords: readonly HexCoord[];
  /** Der Schlüssel der Geländeart (`domain/hexKinds.ts`). */
  kind: string;
  /** Was der Pinsel an einem Feld setzt: Grundgelände, Art, Landschaft. */
  paint: Partial<Pick<Hex, 'terrain' | 'kind' | 'landscapeId'>>;
  /** Das Feld, über dem der Strich zuletzt war – null am Anfang des Strichs. */
  from: HexCoord | null;
}

/**
 * Ein Schritt des Pinsels unter der Erde. Gibt die Felder der Karte danach zurück; was sich
 * geändert hat, gilt als von Hand gegraben (`manual`, `dug`) und übersteht „Neu würfeln“.
 */
export function digCave(before: readonly Hex[], step: DigStep): Hex[] {
  const keys = new Set(step.coords.map(keyOf));
  let hexes = [...before];
  const level = step.at.level ?? 0;

  if (step.kind === SOLID_ROCK) {
    // Nie das Feld eines Ortes zumauern.
    for (const coord of step.coords) {
      const hex = hexes.find((entry) => hexKey(entry) === keyOf(coord));
      if (hex && !hex.placeId) hexes = seal(hexes, coord);
    }
    return marked(before, hexes);
  }

  const wide = WIDE_CAVE_KINDS.has(step.kind);
  // Der Strich seit dem letzten Feld: Fährt die Maus schnell, liegen Felder dazwischen – auch
  // durch sie wird gegraben.
  const path =
    step.from && keyOf(step.from) !== keyOf(step.at)
      ? hexLine(step.from, step.at).map((c) => ({ ...c, level }))
      : [];
  for (const coord of path.slice(1)) keys.add(keyOf(coord));

  // Erst aussehen lassen, wie gemalt …
  hexes = hexes.map((hex) => {
    if (!keys.has(hexKey(hex))) return hex;
    // Ein Gang, der in einer Höhle beginnt, in sie hinein oder durch sie hindurch führt, lässt
    // sie Höhle – er schließt nur an. Wer aus einer Höhle einen Gang machen will, schüttet sie
    // erst zu.
    if (!wide && isWideCave(hex)) return { ...hex, exits: hex.exits ?? [] };
    return { ...hex, ...step.paint, exits: hex.exits ?? [] };
  });

  // … dann dem Strich folgen: Verbunden wird, worüber die Maus gefahren ist.
  for (let i = 1; i < path.length; i++) hexes = open(hexes, path[i - 1]!, path[i]!);

  if (wide) {
    // Höhlen wachsen zusammen: mit jeder Höhle nebenan.
    for (const coord of step.coords)
      for (const d of HEX_DIRECTIONS) {
        const other = { q: coord.q + d.q, r: coord.r + d.r, level: coord.level ?? level };
        const there = hexes.find((hex) => hexKey(hex) === keyOf(other));
        // … und nimmt ein Gangende auf, das vor ihr liegt.
        if (there && (isWideCave(there) || (!keys.has(hexKey(there)) && isDeadEnd(there))))
          hexes = open(hexes, coord, other);
      }
  } else if (!step.from) {
    // Ein Gang beginnt im Fels: Er schließt an, was nebenan schon offen ist – am liebsten an ein Ende.
    const start = hexes.find((hex) => hexKey(hex) === keyOf(step.at));
    if (start && (start.exits ?? []).length === 0) {
      const near = HEX_DIRECTIONS.map((d) =>
        hexes.find(
          (hex) => hexKey(hex) === keyOf({ q: step.at.q + d.q, r: step.at.r + d.r, level }),
        ),
      ).filter((hex): hex is Hex => !!hex && !keys.has(hexKey(hex)) && isOpen(hex));
      const pick = near.sort(
        (a, b) =>
          Number(isWideCave(a)) - Number(isWideCave(b)) ||
          (a.exits ?? []).length - (b.exits ?? []).length,
      )[0];
      if (pick) hexes = open(hexes, step.at, pick);
    }
  }
  return marked(before, hexes);
}

/**
 * Am Ende eines Strichs: Endet der Gang als Sackgasse vor etwas Offenem – einer Höhle, einem
 * anderen Gang –, führt er hinein: geradeaus weiter oder mit einem leichten Knick, nie in einer
 * Kehre zurück und nie als Dreieck zu dem Feld, aus dem er kam. So gilt am Ende dasselbe wie am
 * Anfang eines Strichs. Unterwegs schließt ein Gang nirgends an: Zwei Gänge dürfen nebeneinander
 * liegen. Ändert sich nichts, kommt dieselbe Liste zurück.
 */
export function joinTunnelEnd(before: readonly Hex[], at: HexCoord): readonly Hex[] {
  const level = at.level ?? 0;
  const end = before.find((hex) => hexKey(hex) === keyOf(at));
  if (!end || !isDeadEnd(end)) return before;
  const back = end.exits!.find((exit) => exit.dir < 6)!.dir;
  const ahead = (back + 3) % 6;
  const turn = (dir: number) => Math.min(Math.abs(dir - ahead), 6 - Math.abs(dir - ahead));
  const behind = HEX_DIRECTIONS[back]!;
  const from = { q: end.q + behind.q, r: end.r + behind.r, level };
  const options = HEX_DIRECTIONS.map((d, dir) => ({
    dir,
    hex: before.find((hex) => hexKey(hex) === keyOf({ q: end.q + d.q, r: end.r + d.r, level })),
  })).filter((option): option is { dir: number; hex: Hex } => {
    if (!option.hex || !isOpen(option.hex) || turn(option.dir) > 1) return false;
    // Kein Dreieck: Was schon mit dem Feld davor verbunden ist, ist auf kurzem Weg erreichbar.
    const side = dirTo(option.hex, from);
    return side === null || !hasExit(option.hex, side);
  });
  const pick = options.sort(
    (a, b) => turn(a.dir) - turn(b.dir) || Number(isWideCave(b.hex)) - Number(isWideCave(a.hex)),
  )[0];
  if (!pick) return before;
  return marked(before, open([...before], at, pick.hex));
}

/** Was sich geändert hat, ist von Hand gegraben. */
function marked(before: readonly Hex[], after: Hex[]): Hex[] {
  const old = new Map(before.map((hex) => [hexKey(hex), hex]));
  return after.map((hex) =>
    old.get(hexKey(hex)) === hex ? hex : { ...hex, manual: true, dug: true },
  );
}
