/**
 * Einen Dungeon bespielen (Schritt 2, Wunsch des Spielleiters 18. 11. 2026: „die Spieler bewegen
 * wie in einem Strategiespiel … Fallen, geheime Türen, Licht, Sichtweite sind von den Charakteren
 * abhängig“). Wayfarer rechnet, was am Tisch lästig ist: den Weg, wer was sieht, wessen passive
 * Wahrnehmung eine Falle oder Geheimtür bemerkt, wo die Gruppe anhält, wie viel Zeit vergeht.
 * Gewürfelt wird am Tisch; was hier steht, ist nie ein Verbot – jede Figur lässt sich von Hand
 * versetzen, jede Tür von Hand öffnen.
 *
 * Der Stand (`dungeon.play`) liegt neben dem Gebauten und ändert es nie: Türen, die die Gruppe
 * öffnet, stehen in `play.doors`; gelesen wird die Ebene dann über `playLevel`.
 */
import {
  STAIR_LABEL,
  cellKey,
  cellOfKey,
  cellsOfEdge,
  edgeBetween,
  edgeName,
  edgeRun,
  findStair,
  isWalkable,
  keyOf,
  levelOf,
  roomAt,
  sameCell,
  tileAt,
  trapSpots,
  type DungeonPick,
} from './dungeon';
import {
  DungeonPlaySchema,
  DungeonTokenSchema,
  newId,
  type Dungeon,
  type DungeonCell,
  type DungeonEdge,
  type DungeonLevel,
  type DungeonLight,
  type DungeonPlay,
  type DungeonToken,
} from './schema';

// ── Regelwerte ─────────────────────────────────────────────────────────────

/** Wie weit ein Licht reicht (hell und dämmrig zusammen), in Fuß. */
export const LIGHT_REACH: Record<DungeonLight, number> = {
  none: 0,
  torch: 40,
  lantern: 60,
  spell: 40,
};
/** Wie lange ein Licht brennt, in Minuten. */
export const LIGHT_MINUTES: Record<DungeonLight, number> = {
  none: 0,
  torch: 60,
  lantern: 360,
  spell: 60,
};
export const LIGHT_LABEL: Record<DungeonLight, string> = {
  none: 'kein Licht',
  torch: 'Fackel',
  lantern: 'Laterne',
  spell: 'Licht (Zauber)',
};
/** Ein Feuer auf der Karte leuchtet so weit, in Fuß. */
export const FIRE_REACH = 40;
/** Weiter als so sieht niemand etwas Genaues, auch im Hellen – in Fuß. */
export const SIGHT_CAP = 120;
/** So nah muss man einer Geheimtür oder einem verborgenen Etagenwechsel sein, um sie zu bemerken – in Fuß. */
export const NOTICE_REACH = 10;
/** Einen Bereich durchsuchen dauert so lange, in Sekunden. */
export const SEARCH_SECONDS = 600;
/** Eine Runde dauert sechs Sekunden. */
export const ROUND_SECONDS = 6;
/** So viele Zeilen behält das Protokoll. */
const LOG_LINES = 40;

// ── Was gefunden ist, wie Türen stehen ─────────────────────────────────────

export const edgeFoundKey = (levelId: string, key: string) => `edge:${levelId}:${key}`;
export const trapFoundKey = (trapId: string) => `trap:${trapId}`;
export const stairFoundKey = (stairId: string) => `stair:${stairId}`;
const doorKey = (levelId: string, key: string) => `${levelId}:${key}`;

/**
 * Die Ebene, wie sie am Tisch gerade ist: mit den Türen, wie die Gruppe sie hinterlassen hat.
 * Das Gebaute bleibt unberührt.
 */
export function playLevel(level: DungeonLevel, play: DungeonPlay | null): DungeonLevel {
  if (!play) return level;
  // Dieselbe Ebene mit denselben Türen ist dasselbe Objekt – die Karte rechnet sonst jedes Mal neu.
  const known = playLevels.get(level);
  if (known && known.doors === play.doors) return known.out;
  let edges: DungeonLevel['edges'] | null = null;
  for (const key of Object.keys(level.edges)) {
    const state = play.doors[doorKey(level.id, key)];
    if (!state) continue;
    edges ??= { ...level.edges };
    edges[key] = { ...level.edges[key]!, ...state };
  }
  // Am Tisch stehen die Bewohner als Figuren auf dem Brett, nicht als Zeichen der Vorbereitung.
  const out = { ...level, edges: edges ?? level.edges, dwellers: [] };
  playLevels.set(level, { doors: play.doors, out });
  return out;
}

const playLevels = new WeakMap<DungeonLevel, { doors: DungeonPlay['doors']; out: DungeonLevel }>();

// ── Gehen und Sehen von Feld zu Feld ───────────────────────────────────────

interface Ctx {
  level: DungeonLevel;
  levelId: string;
  found: Set<string>;
  walk: Map<string, Step>;
  see: Map<string, boolean>;
}

/** Ein Schritt ins Nachbarfeld: frei, durch eine geschlossene Tür (dort hält man an) oder gar nicht. */
type Step = 'open' | 'door' | 'blocked';

function ctxOf(level: DungeonLevel, play: DungeonPlay): Ctx {
  return {
    level: playLevel(level, play),
    levelId: level.id,
    found: new Set(play.found),
    walk: new Map(),
    see: new Map(),
  };
}

function walkStep(ctx: Ctx, a: DungeonCell, b: DungeonCell): Step {
  const id = `${a.x},${a.y}>${b.x},${b.y}`;
  const known = ctx.walk.get(id);
  if (known) return known;
  let step: Step = 'blocked';
  if (isWalkable(tileAt(ctx.level, a)) && isWalkable(tileAt(ctx.level, b))) {
    const view = edgeBetween(ctx.level, a, b);
    if (view.kind === 'open' || view.kind === 'curtain') step = 'open';
    else if (view.kind === 'door' || view.kind === 'gate')
      step = view.edge?.opened ? 'open' : 'door';
    else if (view.kind === 'secret') {
      // Eine Geheimtür, die niemand kennt, ist eine Wand.
      const key = edgeKeyOf(a, b);
      if (key && ctx.found.has(edgeFoundKey(ctx.levelId, key)))
        step = view.edge?.opened ? 'open' : 'door';
    }
  }
  ctx.walk.set(id, step);
  return step;
}

function edgeKeyOf(a: DungeonCell, b: DungeonCell): string | null {
  if (a.x === b.x && Math.abs(a.y - b.y) === 1) return `${a.x},${Math.max(a.y, b.y)},n`;
  if (a.y === b.y && Math.abs(a.x - b.x) === 1) return `${Math.max(a.x, b.x)},${a.y},w`;
  return null;
}

/** Sieht man von einem Feld ins Nachbarfeld? Gitter und Fenster ja, Vorhang und geschlossene Tür nein. */
function seeStep(ctx: Ctx, a: DungeonCell, b: DungeonCell): boolean {
  const id = `${a.x},${a.y}>${b.x},${b.y}`;
  const known = ctx.see.get(id);
  if (known !== undefined) return known;
  let open = false;
  if (tileAt(ctx.level, a) !== null && tileAt(ctx.level, b) !== null) {
    const view = edgeBetween(ctx.level, a, b);
    if (view.kind === 'open' || view.kind === 'gate' || view.kind === 'window') open = true;
    else if (view.kind === 'door') open = !!view.edge?.opened;
    else if (view.kind === 'secret') {
      const key = edgeKeyOf(a, b);
      open = !!key && ctx.found.has(edgeFoundKey(ctx.levelId, key)) && !!view.edge?.opened;
    }
  }
  ctx.see.set(id, open);
  return open;
}

/**
 * Schräg sieht man, wenn ein Weg um die Ecke ganz frei ist; schräg geht man nur, wenn beide frei
 * sind (`both`) – nie um eine Mauerecke herum.
 */
function diagonalOpen(
  a: DungeonCell,
  b: DungeonCell,
  open: (from: DungeonCell, to: DungeonCell) => boolean,
  both = false,
): boolean {
  const viaX = { x: b.x, y: a.y };
  const viaY = { x: a.x, y: b.y };
  const overX = open(a, viaX) && open(viaX, b);
  const overY = open(a, viaY) && open(viaY, b);
  return both ? overX && overY : overX || overY;
}

/** Freie Sicht von der Mitte eines Feldes zur Mitte eines anderen. */
function lineOfSight(ctx: Ctx, from: DungeonCell, to: DungeonCell): boolean {
  if (sameCell(from, to)) return true;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.ceil(Math.hypot(dx, dy) * 4);
  let prev = from;
  for (let i = 1; i <= steps; i++) {
    const cell = {
      x: Math.floor(from.x + 0.5 + (dx * i) / steps),
      y: Math.floor(from.y + 0.5 + (dy * i) / steps),
    };
    if (sameCell(cell, prev)) continue;
    const straight = cell.x === prev.x || cell.y === prev.y;
    const open = straight
      ? seeStep(ctx, prev, cell)
      : diagonalOpen(prev, cell, (a, b) => seeStep(ctx, a, b));
    if (!open) return false;
    prev = cell;
  }
  return true;
}

// ── Licht und Sicht ────────────────────────────────────────────────────────

const lightOn = (token: DungeonToken, seconds: number): boolean =>
  token.light !== 'none' && (token.lightEnds === null || token.lightEnds > seconds);

/** Alle Bodenfelder im Umkreis (in Feldern) eines Feldes. */
function cellsAround(level: DungeonLevel, center: DungeonCell, radius: number): DungeonCell[] {
  const out: DungeonCell[] = [];
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const cell = { x: center.x + dx, y: center.y + dy };
      if (level.tiles[keyOf(cell)] !== undefined) out.push(cell);
    }
  return out;
}

/** Die Felder, die gerade beleuchtet sind: von den Lichtern der Figuren und den Feuern der Karte. */
function litCells(ctx: Ctx, play: DungeonPlay, cellFeet: number): Set<string> {
  const lit = new Set<string>();
  const sources: { cell: DungeonCell; reach: number }[] = [
    ...play.tokens
      .filter((token) => token.levelId === ctx.levelId && lightOn(token, play.seconds))
      .map((token) => ({ cell: { x: token.x, y: token.y }, reach: LIGHT_REACH[token.light] })),
    ...ctx.level.markers
      .filter((marker) => marker.kind === 'fire')
      .map((marker) => ({ cell: { x: marker.x, y: marker.y }, reach: FIRE_REACH })),
  ];
  for (const source of sources)
    for (const cell of cellsAround(ctx.level, source.cell, source.reach / cellFeet))
      if (lineOfSight(ctx, source.cell, cell)) lit.add(keyOf(cell));
  return lit;
}

/**
 * Was die Gefährten auf einer Ebene gerade sehen: freie Sicht und entweder Dunkelsicht, Licht auf
 * dem Feld oder eine helle Ebene. Jede Figur sieht für sich; gezeigt wird, was irgendeiner sieht.
 */
export function visibleCells(dungeon: Dungeon, levelId: string): Set<string> {
  const play = dungeon.play;
  const level = levelOf(dungeon, levelId);
  const seen = new Set<string>();
  if (!play || !level) return seen;
  const heroes = play.tokens.filter((t) => t.kind === 'hero' && t.levelId === levelId);
  if (heroes.length === 0) return seen;
  const ctx = ctxOf(level, play);
  const feet = dungeon.cellFeet;
  const lit = level.lit ? null : litCells(ctx, play, feet);
  for (const hero of heroes) {
    const here = { x: hero.x, y: hero.y };
    seen.add(keyOf(here));
    const dark = hero.darkvision / feet;
    for (const cell of cellsAround(ctx.level, here, SIGHT_CAP / feet)) {
      const key = keyOf(cell);
      if (seen.has(key)) continue;
      const near = Math.hypot(cell.x - here.x, cell.y - here.y) <= dark;
      if (!near && lit && !lit.has(key)) continue;
      if (lineOfSight(ctx, here, cell)) seen.add(key);
    }
  }
  return seen;
}

/** Merkt, was die Gruppe jetzt sieht – auf jeder Ebene, auf der ein Gefährte steht. */
function rememberSight(dungeon: Dungeon, play: DungeonPlay): DungeonPlay {
  const levels = new Set(play.tokens.filter((t) => t.kind === 'hero').map((t) => t.levelId));
  let seen = play.seen;
  for (const levelId of levels) {
    const now = visibleCells({ ...dungeon, play }, levelId);
    const before = new Set(seen[levelId] ?? []);
    let grew = false;
    for (const key of now)
      if (!before.has(key)) {
        before.add(key);
        grew = true;
      }
    if (grew) seen = { ...seen, [levelId]: [...before] };
  }
  return seen === play.seen ? play : { ...play, seen };
}

// ── Der Weg ────────────────────────────────────────────────────────────────

const NEIGHBOURS: readonly DungeonCell[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

/** Was ein Schritt auf ein Feld kostet, in Fuß: Geröll und Wasser sind schwieriges Gelände. */
function stepFeet(level: DungeonLevel, cell: DungeonCell, cellFeet: number): number {
  const tile = tileAt(level, cell);
  return tile === 'rubble' || tile === 'water' ? cellFeet * 2 : cellFeet;
}

/** Felder bekannter, scharfer Fallen – der Weg meidet sie, wenn es anders geht. */
function knownTrapCells(level: DungeonLevel, play: DungeonPlay): Set<string> {
  const cells = new Set<string>();
  for (const trap of level.traps) {
    if (!play.found.includes(trapFoundKey(trap.id)) || !trapArmed(play, trap.id, trap.once))
      continue;
    for (const cell of trap.cells) cells.add(keyOf(cell));
  }
  return cells;
}

/**
 * Löst die Falle noch von selbst aus? Nicht, wenn sie entschärft ist – und nicht, nachdem sie
 * ausgelöst hat: Sonst träfe sie jeden, der dem Ersten folgt. „Wieder scharf“ stellt sie zurück.
 */
const trapArmed = (play: DungeonPlay, trapId: string, _once?: boolean): boolean =>
  !play.disarmed.includes(trapId) && !play.sprung.includes(trapId);

export interface Route {
  cells: DungeonCell[];
  /** Länge in Fuß (schwieriges Gelände zählt doppelt). */
  feet: number;
}

/**
 * Der kürzeste Weg von Feld zu Feld – auch schräg, nie durch Mauerecken. Geschlossene Türen
 * liegen auf dem Weg (dort hält die Gruppe an); bekannte Fallen meidet er, wenn es anders geht.
 */
export function routeBetween(
  dungeon: Dungeon,
  levelId: string,
  from: DungeonCell,
  to: DungeonCell,
): Route | null {
  const play = dungeon.play;
  const level = levelOf(dungeon, levelId);
  if (!play || !level) return null;
  const ctx = ctxOf(level, play);
  if (!isWalkable(tileAt(ctx.level, to))) return null;
  if (sameCell(from, to)) return { cells: [from], feet: 0 };
  const avoid = knownTrapCells(ctx.level, play);
  const feet = dungeon.cellFeet;
  const cost = new Map<string, number>([[keyOf(from), 0]]);
  const before = new Map<string, string>();
  // Eine einfache Warteschlange nach Kosten – Dungeons sind klein.
  const open: { key: string; cost: number }[] = [{ key: keyOf(from), cost: 0 }];
  const goal = keyOf(to);
  let visited = 0;
  while (open.length > 0 && visited++ < 20000) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.cost < open[best]!.cost) best = i;
    const current = open.splice(best, 1)[0]!;
    if (current.key === goal) break;
    if (current.cost > (cost.get(current.key) ?? Infinity)) continue;
    const cell = cellOfKey(current.key);
    for (const delta of NEIGHBOURS) {
      const next = { x: cell.x + delta.x, y: cell.y + delta.y };
      const straight = delta.x === 0 || delta.y === 0;
      const ok = straight
        ? walkStep(ctx, cell, next) !== 'blocked'
        : isWalkable(tileAt(ctx.level, next)) &&
          diagonalOpen(cell, next, (a, b) => walkStep(ctx, a, b) === 'open', true);
      if (!ok) continue;
      const key = keyOf(next);
      const total = current.cost + stepFeet(ctx.level, next, feet) + (avoid.has(key) ? 5000 : 0);
      if (total >= (cost.get(key) ?? Infinity)) continue;
      cost.set(key, total);
      before.set(key, current.key);
      open.push({ key, cost: total });
    }
  }
  if (!before.has(goal)) return null;
  const cells: DungeonCell[] = [];
  for (let key: string | undefined = goal; key; key = before.get(key))
    cells.unshift(cellOfKey(key));
  let length = 0;
  for (const cell of cells.slice(1)) length += stepFeet(ctx.level, cell, feet);
  return { cells, feet: length };
}

// ── Halt: wo die Gruppe stehen bleibt ──────────────────────────────────────

export type HaltType =
  | 'door'
  | 'locked'
  | 'trap-found'
  | 'trap-sprung'
  | 'secret-found'
  | 'room'
  | 'foe'
  | 'light'
  | 'spent'
  | 'no-way'
  | 'stairs'
  | 'alert';

export interface Halt {
  type: HaltType;
  title: string;
  text: string;
  levelId: string;
  /** Worum es geht – zum Anzeigen rechts. */
  pick: DungeonPick | null;
  cell: DungeonCell | null;
}

function logged(play: DungeonPlay, text: string): DungeonPlay {
  return { ...play, log: [...play.log, { at: play.seconds, text }].slice(-LOG_LINES) };
}

const names = (tokens: readonly DungeonToken[]): string =>
  tokens.map((t) => t.name.trim() || 'Jemand').join(', ');

/** Die Zeit vergeht; Lichter, deren Zeit um ist, erlöschen. Meldet das erste, das ausgeht. */
function advance(
  play: DungeonPlay,
  seconds: number,
): { play: DungeonPlay; out: DungeonToken | null } {
  const now = play.seconds + Math.max(0, Math.round(seconds));
  let out: DungeonToken | null = null;
  const tokens = play.tokens.map((token) => {
    if (token.light === 'none' || token.lightEnds === null || token.lightEnds > now) return token;
    out ??= token;
    return { ...token, light: 'none' as const, lightEnds: null };
  });
  return { play: { ...play, seconds: now, tokens }, out };
}

/**
 * Was die Gefährten von dort, wo sie stehen, von selbst bemerken: Fallen (von den Feldern aus, von
 * denen sie zu bemerken sind), Geheimtüren und verborgene Etagenwechsel in der Nähe – jeweils,
 * wenn die passive Wahrnehmung den SG erreicht. Ohne SG bemerkt niemand etwas von selbst.
 */
function noticeHidden(
  dungeon: Dungeon,
  play: DungeonPlay,
  levelId: string,
): { play: DungeonPlay; halt: Halt } | null {
  const level = levelOf(dungeon, levelId);
  if (!level) return null;
  const heroes = play.tokens.filter((t) => t.kind === 'hero' && t.levelId === levelId);
  const reach = NOTICE_REACH / dungeon.cellFeet + 0.5;
  for (const trap of level.traps) {
    if (trap.findDc === null || play.found.includes(trapFoundKey(trap.id))) continue;
    if (!trapArmed(play, trap.id, trap.once)) continue;
    const spots = new Set(trapSpots(level, trap).map(keyOf));
    const who = heroes.filter((h) => h.passive >= trap.findDc! && spots.has(cellKey(h.x, h.y)));
    if (who.length === 0) continue;
    const title = `${names(who)} bemerkt eine Falle`;
    return {
      play: logged({ ...play, found: [...play.found, trapFoundKey(trap.id)] }, title),
      halt: {
        type: 'trap-found',
        title,
        text: trap.name.trim() || 'Eine Falle',
        levelId,
        pick: { type: 'trap', id: trap.id },
        cell: trap.cells[0] ?? null,
      },
    };
  }
  for (const [key, edge] of Object.entries(level.edges)) {
    if (edge.kind !== 'secret' || edge.findDc === null) continue;
    if (play.found.includes(edgeFoundKey(levelId, key))) continue;
    const { a, b, side } = cellsOfEdge(key);
    const mid = side === 'n' ? { x: b.x + 0.5, y: b.y } : { x: b.x, y: b.y + 0.5 };
    const who = heroes.filter(
      (h) =>
        h.passive >= edge.findDc! &&
        Math.hypot(h.x + 0.5 - mid.x, h.y + 0.5 - mid.y) <= reach &&
        // Bemerkt wird sie nur von der Seite, auf der man steht – nicht durch die Wand.
        (roomSide(level, h, a) || roomSide(level, h, b)),
    );
    if (who.length === 0) continue;
    const run = edgeRun(level, key);
    const title = `${names(who)} bemerkt eine Geheimtür`;
    return {
      play: logged(
        { ...play, found: [...play.found, ...run.map((k) => edgeFoundKey(levelId, k))] },
        title,
      ),
      halt: {
        type: 'secret-found',
        title,
        text: edge.note.trim(),
        levelId,
        pick: { type: 'edge', key },
        cell: isWalkable(tileAt(level, a)) ? a : b,
      },
    };
  }
  for (const stair of level.stairs) {
    if (!stair.secret || stair.findDc === null) continue;
    if (play.found.includes(stairFoundKey(stair.id))) continue;
    const who = heroes.filter(
      (h) => h.passive >= stair.findDc! && Math.hypot(h.x - stair.x, h.y - stair.y) <= reach,
    );
    if (who.length === 0) continue;
    const title = `${names(who)} bemerkt: ${STAIR_LABEL[stair.kind]}, verborgen`;
    return {
      play: logged({ ...play, found: [...play.found, stairFoundKey(stair.id)] }, title),
      halt: {
        type: 'secret-found',
        title,
        text: stair.note.trim(),
        levelId,
        pick: { type: 'stair', id: stair.id },
        cell: { x: stair.x, y: stair.y },
      },
    };
  }
  return null;
}

/** Steht die Figur auf derselben Seite wie das Feld – im selben Raum oder Gang, höchstens zwei Schritte weg? */
function roomSide(level: DungeonLevel, token: DungeonToken, cell: DungeonCell): boolean {
  if (tileAt(level, cell) === null) return false;
  return (
    roomAt(level, cell) === roomAt(level, token) &&
    tileAt(level, cell) !== 'secret' &&
    Math.hypot(cell.x - token.x, cell.y - token.y) <= 3
  );
}

/** Gegner, die die Gruppe jetzt zum ersten Mal sieht. */
function spotFoes(
  dungeon: Dungeon,
  play: DungeonPlay,
  levelId: string,
): { play: DungeonPlay; halt: Halt } | null {
  const foes = play.tokens.filter(
    (t) => t.kind === 'foe' && t.levelId === levelId && !play.spotted.includes(t.id),
  );
  if (foes.length === 0) return null;
  const visible = visibleCells({ ...dungeon, play }, levelId);
  const seen = foes.filter((foe) => visible.has(cellKey(foe.x, foe.y)));
  if (seen.length === 0) return null;
  const title = `In Sicht: ${names(seen)}`;
  return {
    play: logged({ ...play, spotted: [...play.spotted, ...seen.map((f) => f.id)] }, title),
    halt: {
      type: 'foe',
      title,
      text: 'Wer bemerkt wen zuerst? Danach vielleicht Runden.',
      levelId,
      pick: null,
      cell: { x: seen[0]!.x, y: seen[0]!.y },
    },
  };
}

// ── Bewegen ────────────────────────────────────────────────────────────────

export interface MoveResult {
  play: DungeonPlay;
  halt: Halt | null;
  /** Wie weit es ging, in Fuß. */
  feet: number;
}

/**
 * Bewegt Figuren zu einem Feld: Die erste geht voran, die anderen folgen in ihrer Reihenfolge auf
 * ihrer Spur. Schritt für Schritt vergeht Zeit, die Sicht wächst mit, und die Gruppe hält, wo
 * etwas zu entscheiden ist: geschlossene Tür, bemerkte oder ausgelöste Falle, Geheimtür, ein Raum
 * mit Notiz, ein Gegner in Sicht, ein Licht, das erlischt. In Runden endet der Weg mit der
 * Bewegungsrate.
 */
export function moveTokens(
  dungeon: Dungeon,
  tokenIds: readonly string[],
  to: DungeonCell,
): MoveResult | null {
  const start = dungeon.play;
  if (!start) return null;
  const movers = start.tokens.filter((t) => tokenIds.includes(t.id));
  const leader = movers[0];
  if (!leader) return null;
  const levelId = leader.levelId;
  const level = levelOf(dungeon, levelId);
  if (!level) return null;
  const from = { x: leader.x, y: leader.y };
  const route = routeBetween(dungeon, levelId, from, to);
  if (!route)
    return {
      play: start,
      feet: 0,
      halt: {
        type: 'no-way',
        title: 'Dorthin führt kein Weg',
        text: 'Eine Wand, ein Abgrund oder eine Tür, die niemand kennt. Von Hand versetzen geht immer: die Figur ziehen.',
        levelId,
        pick: null,
        cell: to,
      },
    };

  // Wer folgt: die übrigen Gewählten auf derselben Ebene, die den Anführer erreichen können.
  const followers = movers
    .slice(1)
    .filter(
      (t) =>
        t.levelId === levelId &&
        (routeBetween(dungeon, levelId, { x: t.x, y: t.y }, from)?.cells.length ?? Infinity) <= 14,
    );
  const heroLed = leader.kind === 'hero';
  const speed = Math.max(5, Math.min(...[leader, ...followers].map((t) => t.speed || 30)));
  const feetPer = dungeon.cellFeet;
  let play = start;
  let halt: Halt | null = null;
  let feet = 0;
  let seconds = 0;
  // Die Spur: wo der Anführer war – dahinter gehen die anderen.
  let chain: DungeonCell[] = [from, ...followers.map((t) => ({ x: t.x, y: t.y }))];
  const order = [leader, ...followers].map((t) => t.id);
  const rounds = start.rounds;
  let moved = rounds?.moved ?? 0;

  for (let i = 1; i < route.cells.length && !halt; i++) {
    const prev = route.cells[i - 1]!;
    const cell = route.cells[i]!;
    const ctx = ctxOf(level, play);
    // Eine geschlossene Tür: davor bleibt man stehen.
    if ((prev.x === cell.x || prev.y === cell.y) && walkStep(ctx, prev, cell) === 'door') {
      const key = edgeKeyOf(prev, cell)!;
      const edge = ctx.level.edges[key];
      const width = edgeRun(ctx.level, key).length;
      const what = edge ? edgeName(edge.kind, width) : 'Tür';
      halt = {
        type: edge?.locked ? 'locked' : 'door',
        title: edge?.locked ? `${what} – verschlossen` : `${what} – geschlossen`,
        text: edge?.locked
          ? [
              edge.lockDc !== null && `Schloss SG ${edge.lockDc}`,
              edge.breakDc !== null && `Aufbrechen SG ${edge.breakDc}`,
            ]
              .filter(Boolean)
              .join(' · ')
          : '',
        levelId,
        pick: { type: 'edge', key },
        cell: prev,
      };
      break;
    }
    const cost = stepFeet(ctx.level, cell, feetPer);
    if (rounds && moved + cost > speed) {
      halt = {
        type: 'spent',
        title: 'Bewegung aufgebraucht',
        text: `${leader.name.trim() || 'Die Figur'} ist ${moved} von ${speed} Fuß gegangen.`,
        levelId,
        pick: null,
        cell: prev,
      };
      break;
    }
    // Der Schritt.
    chain = [cell, ...chain.slice(0, -1)];
    const at = new Map(order.map((id, index) => [id, chain[index]!]));
    play = {
      ...play,
      tokens: play.tokens.map((t) => (at.has(t.id) ? { ...t, ...at.get(t.id)! } : t)),
    };
    feet += cost;
    moved += cost;
    const stepSeconds = (cost / speed) * ROUND_SECONDS;
    seconds += stepSeconds;
    // In Runden zählt die Uhr rundenweise, nicht schrittweise.
    if (!rounds) {
      const passed = advance(play, Math.round(seconds) - Math.round(seconds - stepSeconds));
      play = passed.play;
      if (passed.out) {
        const title = `${LIGHT_LABEL[passed.out.light]} von ${passed.out.name.trim() || 'jemandem'} erlischt`;
        play = logged(play, title);
        halt = { type: 'light', title, text: '', levelId, pick: null, cell };
      }
    }
    play = rememberSight(dungeon, play);
    // Der Rest des Dungeons bewegt sich mit: Runden werden gegangen, wer die Gruppe sieht, merkt auf.
    let noticedBy: Halt | null = null;
    if (!rounds) {
      const stirred = stirFoes(dungeon, play, stepSeconds);
      play = stirred.play;
      noticedBy = stirred.halt;
    }
    if (!heroLed || halt) {
      halt ??= noticedBy;
      continue;
    }

    // Eine Falle löst aus, wo jemand auf ihr Feld tritt.
    const stepped = [leader, ...followers]
      .map((t) => play.tokens.find((p) => p.id === t.id)!)
      .filter((t) => t.kind === 'hero');
    const sprung = level.traps.find(
      (trap) =>
        trapArmed(play, trap.id, trap.once) &&
        stepped.some((t) => trap.cells.some((c) => c.x === t.x && c.y === t.y)),
    );
    if (sprung) {
      const who = stepped.filter((t) => sprung.cells.some((c) => c.x === t.x && c.y === t.y));
      const title = `${sprung.name.trim() || 'Eine Falle'} löst aus – ${names(who)}`;
      play = logged(
        {
          ...play,
          sprung: play.sprung.includes(sprung.id) ? play.sprung : [...play.sprung, sprung.id],
          found: play.found.includes(trapFoundKey(sprung.id))
            ? play.found
            : [...play.found, trapFoundKey(sprung.id)],
        },
        title,
      );
      halt = {
        type: 'trap-sprung',
        title,
        text: sprung.effect.trim(),
        levelId,
        pick: { type: 'trap', id: sprung.id },
        cell,
      };
      break;
    }
    const noticed = noticeHidden(dungeon, play, levelId);
    if (noticed) {
      play = noticed.play;
      halt = noticed.halt;
      break;
    }
    const foes = spotFoes(dungeon, play, levelId);
    if (foes) {
      play = foes.play;
      // Sehen sich beide zugleich, steht es in einem Halt.
      halt = noticedBy ? { ...foes.halt, text: `${noticedBy.title}.` } : foes.halt;
      break;
    }
    if (noticedBy) {
      halt = noticedBy;
      break;
    }
    // Ein Raum, den die Gruppe zum ersten Mal betritt.
    const roomId = roomAt(level, cell);
    if (roomId && !play.rooms.includes(roomId)) {
      const room = level.rooms.find((r) => r.id === roomId);
      const span = room?.spanId
        ? dungeon.levels.flatMap((l) => l.rooms.filter((r) => r.spanId === room.spanId))
        : [];
      play = logged(
        { ...play, rooms: [...play.rooms, roomId, ...span.map((r) => r.id)] },
        `Betreten: ${room?.name.trim() || 'ein Raum'}`,
      );
      if (room?.note.trim())
        halt = {
          type: 'room',
          title: room.name.trim() || 'Ein Raum',
          text: room.note.trim(),
          levelId,
          pick: { type: 'room', id: roomId },
          cell,
        };
    }
  }
  if (rounds) play = { ...play, rounds: { ...rounds, moved } };
  return { play, halt, feet };
}

/** Stellt eine Figur von Hand irgendwohin – ohne Regeln, ohne Zeit. Die Sicht zieht mit. */
export function placeToken(
  dungeon: Dungeon,
  tokenId: string,
  levelId: string,
  cell: DungeonCell,
): DungeonPlay | null {
  const play = dungeon.play;
  if (!play || !play.tokens.some((t) => t.id === tokenId)) return play;
  const next = {
    ...play,
    tokens: play.tokens.map((t) => (t.id === tokenId ? { ...t, levelId, ...cell } : t)),
  };
  return rememberSight(dungeon, next);
}

// ── Etagenwechsel benutzen ─────────────────────────────────────────────────

/** Freie Felder um eine Stelle – für alle, die gemeinsam ankommen. */
function landing(level: DungeonLevel, at: DungeonCell, count: number): DungeonCell[] {
  // Nur die Stelle – was sonst an `at` hängt (eine Treppe), gehört nicht in die Figur.
  const first = { x: at.x, y: at.y };
  const out: DungeonCell[] = [first];
  const seen = new Set([keyOf(first)]);
  for (let i = 0; i < out.length && out.length < count; i++)
    for (const delta of NEIGHBOURS.slice(0, 4)) {
      const next = { x: out[i]!.x + delta.x, y: out[i]!.y + delta.y };
      const key = keyOf(next);
      if (seen.has(key) || !isWalkable(tileAt(level, next))) continue;
      if (edgeBetween(level, out[i]!, next).kind !== 'open') continue;
      seen.add(key);
      out.push(next);
    }
  while (out.length < count) out.push(first);
  return out;
}

/**
 * Die Figuren nehmen einen Etagenwechsel: Sie kommen am Gegenstück an, auf seinem Feld und den
 * freien daneben. Ohne Ziel, verschlossen oder nur Ankunft: ein Halt, der es sagt.
 */
export function useStair(
  dungeon: Dungeon,
  tokenIds: readonly string[],
  levelId: string,
  stairId: string,
): (MoveResult & { levelId: string }) | null {
  const play = dungeon.play;
  const level = levelOf(dungeon, levelId);
  const stair = level?.stairs.find((s) => s.id === stairId);
  if (!play || !level || !stair) return null;
  const target = findStair(dungeon, stair.to);
  const stop = (title: string, text: string): MoveResult & { levelId: string } => ({
    play,
    feet: 0,
    levelId,
    halt: {
      type: 'stairs',
      title,
      text,
      levelId,
      pick: { type: 'stair', id: stairId },
      cell: { x: stair.x, y: stair.y },
    },
  });
  const what = STAIR_LABEL[stair.kind];
  if (!target) return stop(`${what} – führt noch nirgendhin`, 'Im Editor fehlt das Ziel.');
  if (stair.locked && !play.unlocked.includes(stair.id))
    return stop(`${what} – verschlossen`, stair.note.trim());
  if (!stair.usable) return stop(`${what} – von hier kein Weg`, 'Nur Ankunft.');
  const movers = play.tokens.filter((t) => tokenIds.includes(t.id));
  if (movers.length === 0) return null;
  const spots = landing(playLevel(target.level, play), target.stair, movers.length);
  const at = new Map(movers.map((t, index) => [t.id, spots[index]!]));
  let next: DungeonPlay = {
    ...play,
    tokens: play.tokens.map((t) =>
      at.has(t.id) ? { ...t, levelId: target.level.id, ...at.get(t.id)! } : t,
    ),
  };
  const passed = advance(next, play.rounds ? 0 : ROUND_SECONDS * 2);
  next = logged(
    passed.play,
    `${names(movers)}: ${what} ${stair.kind === 'portal' ? '' : stair.dir === 'up' ? 'hinauf ' : 'hinab '}nach ${target.level.name.trim() || 'Ebene'}`,
  );
  next = rememberSight(dungeon, next);
  const noticed =
    noticeHidden(dungeon, next, target.level.id) ?? spotFoes(dungeon, next, target.level.id);
  return {
    play: noticed?.play ?? next,
    halt: noticed?.halt ?? null,
    feet: 0,
    levelId: target.level.id,
  };
}

// ── Türen, Fallen, Suchen ──────────────────────────────────────────────────

/** Öffnet, schließt, ent- oder verriegelt eine Tür auf ganzer Breite. Die Sicht zieht mit. */
export function setDoor(
  dungeon: Dungeon,
  levelId: string,
  key: string,
  change: { opened?: boolean; locked?: boolean },
): DungeonPlay | null {
  const play = dungeon.play;
  const level = levelOf(dungeon, levelId);
  if (!play || !level) return play;
  const now = playLevel(level, play);
  const doors = { ...play.doors };
  for (const k of edgeRun(now, key)) {
    const edge = now.edges[k];
    if (!edge) continue;
    doors[doorKey(levelId, k)] = {
      opened: change.opened ?? edge.opened,
      locked: change.locked ?? edge.locked,
    };
  }
  return rememberSight(dungeon, { ...play, doors });
}

/** Etwas gilt als gefunden – oder wieder als verborgen. */
export function setFound(play: DungeonPlay, keys: readonly string[], found: boolean): DungeonPlay {
  const set = new Set(play.found);
  for (const key of keys) {
    if (found) set.add(key);
    else set.delete(key);
  }
  return { ...play, found: [...set] };
}

/** Eine Falle ist entschärft oder wieder scharf. */
export function setTrapDisarmed(play: DungeonPlay, trapId: string, disarmed: boolean): DungeonPlay {
  const without = play.disarmed.filter((id) => id !== trapId);
  return {
    ...play,
    disarmed: disarmed ? [...without, trapId] : without,
    sprung: disarmed ? play.sprung : play.sprung.filter((id) => id !== trapId),
  };
}

/** Wie eine Falle am Tisch steht. */
export function trapState(
  play: DungeonPlay | null,
  trap: { id: string; once: boolean },
): 'hidden' | 'found' | 'sprung' | 'disarmed' {
  if (!play) return 'hidden';
  if (play.disarmed.includes(trap.id)) return 'disarmed';
  if (play.sprung.includes(trap.id)) return 'sprung';
  return play.found.includes(trapFoundKey(trap.id)) ? 'found' : 'hidden';
}

export interface Hidden {
  /** Der Schlüssel in `play.found`. */
  keys: string[];
  label: string;
  dc: number | null;
  pick: DungeonPick;
}

/**
 * Was um eine Figur herum verborgen liegt (zehn Fuß): Fallen, Geheimtüren, verborgene
 * Etagenwechsel – mit dem SG, gegen den am Tisch gewürfelt wird. Die Gruppe findet nichts von
 * selbst; der Spielleiter klickt an, was gefunden wurde.
 */
export function hiddenNear(dungeon: Dungeon, tokenId: string): Hidden[] {
  const play = dungeon.play;
  const token = play?.tokens.find((t) => t.id === tokenId);
  const level = token ? levelOf(dungeon, token.levelId) : null;
  if (!play || !token || !level) return [];
  const reach = NOTICE_REACH / dungeon.cellFeet + 0.5;
  const out: Hidden[] = [];
  const done = new Set<string>();
  for (const trap of level.traps) {
    if (play.found.includes(trapFoundKey(trap.id)) || !trapArmed(play, trap.id, trap.once))
      continue;
    if (!trap.cells.some((c) => Math.hypot(c.x - token.x, c.y - token.y) <= reach)) continue;
    out.push({
      keys: [trapFoundKey(trap.id)],
      label: trap.name.trim() || 'Falle',
      dc: trap.findDc,
      pick: { type: 'trap', id: trap.id },
    });
  }
  for (const [key, edge] of Object.entries(level.edges)) {
    if (edge.kind !== 'secret' || done.has(key)) continue;
    if (play.found.includes(edgeFoundKey(level.id, key))) continue;
    const { b, side } = cellsOfEdge(key);
    const mid = side === 'n' ? { x: b.x + 0.5, y: b.y } : { x: b.x, y: b.y + 0.5 };
    if (Math.hypot(token.x + 0.5 - mid.x, token.y + 0.5 - mid.y) > reach) continue;
    const run = edgeRun(level, key);
    run.forEach((k) => done.add(k));
    out.push({
      keys: run.map((k) => edgeFoundKey(level.id, k)),
      label: 'Geheimtür',
      dc: edge.findDc,
      pick: { type: 'edge', key },
    });
  }
  for (const stair of level.stairs) {
    if (!stair.secret || play.found.includes(stairFoundKey(stair.id))) continue;
    if (Math.hypot(stair.x - token.x, stair.y - token.y) > reach) continue;
    out.push({
      keys: [stairFoundKey(stair.id)],
      label: `${STAIR_LABEL[stair.kind]}, verborgen`,
      dc: stair.findDc,
      pick: { type: 'stair', id: stair.id },
    });
  }
  return out;
}

/** Zeit vergeht (Durchsuchen, Warten); ein Licht, das dabei ausgeht, wird gemeldet. */
export function passTime(
  dungeon: Dungeon,
  seconds: number,
  why: string,
): { play: DungeonPlay; halt: Halt | null } | null {
  const play = dungeon.play;
  if (!play) return null;
  const passed = advance(play, seconds);
  let next = logged(passed.play, why);
  let halt: Halt | null = null;
  if (passed.out) {
    const title = `${LIGHT_LABEL[passed.out.light]} von ${passed.out.name.trim() || 'jemandem'} erlischt`;
    next = logged(next, title);
    halt = { type: 'light', title, text: '', levelId: passed.out.levelId, pick: null, cell: null };
  }
  next = rememberSight(dungeon, next);
  // Während die Gruppe wartet oder sucht, gehen die anderen ihre Runden.
  if (!next.rounds) {
    const slices = Math.min(120, Math.max(1, Math.ceil(seconds / ROUND_SECONDS)));
    for (let i = 0; i < slices && !halt; i++) {
      const stirred = stirFoes(dungeon, next, seconds / slices);
      next = stirred.play;
      halt = stirred.halt;
    }
    if (!halt) {
      const levels = new Set(next.tokens.filter((t) => t.kind === 'hero').map((t) => t.levelId));
      for (const levelId of levels) {
        const foes = spotFoes(dungeon, next, levelId);
        if (!foes) continue;
        next = foes.play;
        halt = foes.halt;
        break;
      }
    }
  }
  return { play: next, halt };
}

// ── Bewohner: der Rest des Dungeons ────────────────────────────────────────

/** So weit sieht ein Bewohner im Dunkeln, in Fuß – wer hier lebt, ist das Dunkel gewohnt. */
export const DWELLER_SIGHT = 60;

function dwellerOf(dungeon: Dungeon, token: DungeonToken) {
  if (!token.dwellerId) return null;
  for (const level of dungeon.levels) {
    const dweller = level.dwellers.find((d) => d.id === token.dwellerId);
    if (dweller) return dweller;
  }
  return null;
}

/** Der nächste Gefährte auf derselben Ebene. */
function nearestHero(play: DungeonPlay, foe: DungeonToken): DungeonToken | null {
  let best: DungeonToken | null = null;
  let bestDist = Infinity;
  for (const hero of play.tokens) {
    if (hero.kind !== 'hero' || hero.levelId !== foe.levelId) continue;
    const dist = Math.hypot(hero.x - foe.x, hero.y - foe.y);
    if (dist < bestDist) {
      best = hero;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Die Bewohner bewegen sich, während Zeit vergeht: Wer eine Runde geht, geht sie gemächlich
 * (halbe Bewegungsrate) von Wegpunkt zu Wegpunkt; wer die Gruppe bemerkt hat und auf sie losgeht,
 * kommt mit voller Rate. Geschlossene Türen halten sie auf. Wer einen Gefährten sieht (freie
 * Sicht; im Dunkeln 60 Fuß, sonst so weit das Licht reicht), merkt auf – dann hält die Gruppe.
 */
export function stirFoes(
  dungeon: Dungeon,
  start: DungeonPlay,
  seconds: number,
): { play: DungeonPlay; halt: Halt | null } {
  let play = start;
  let halt: Halt | null = null;
  const feet = dungeon.cellFeet;
  for (const token of start.tokens) {
    if (token.kind !== 'foe' || token.hp === 0) continue;
    const dweller = dwellerOf(dungeon, token);
    const level = levelOf(dungeon, token.levelId);
    if (!level) continue;
    let foe = token;
    const hunting = foe.alert && dweller?.behave === 'hunt';
    const patrolling = !foe.alert && dweller?.behave === 'patrol' && dweller.route.length > 0;
    if (hunting || patrolling) {
      let budget = foe.carry + (seconds / ROUND_SECONDS) * foe.speed * (hunting ? 1 : 0.5);
      const stops = dweller ? [...dweller.route, { x: dweller.x, y: dweller.y }] : [];
      for (let guard = 0; budget >= feet && guard < 40; guard++) {
        const here = { x: foe.x, y: foe.y };
        let goal: DungeonCell;
        if (hunting) {
          const hero = nearestHero(play, foe);
          if (!hero || Math.max(Math.abs(hero.x - foe.x), Math.abs(hero.y - foe.y)) <= 1) break;
          goal = { x: hero.x, y: hero.y };
        } else {
          goal = stops[foe.routeAt % stops.length]!;
          if (sameCell(goal, here)) {
            foe = { ...foe, routeAt: (foe.routeAt + 1) % stops.length };
            continue;
          }
        }
        const route = routeBetween({ ...dungeon, play }, foe.levelId, here, goal);
        const next = route?.cells[1];
        if (!next) break;
        // Türen öffnen sie nicht – davor bleiben sie stehen.
        const ctx = ctxOf(level, play);
        const straight = next.x === here.x || next.y === here.y;
        if (straight && walkStep(ctx, here, next) !== 'open') break;
        const cost = stepFeet(ctx.level, next, feet);
        if (budget < cost) break;
        budget -= cost;
        foe = { ...foe, x: next.x, y: next.y };
      }
      foe = { ...foe, carry: Math.min(budget, foe.speed) };
    }
    // Sieht er jemanden?
    if (!foe.alert) {
      const ctx = ctxOf(level, play);
      const here = { x: foe.x, y: foe.y };
      const lit = level.lit ? null : litCells(ctx, play, feet);
      const seen = play.tokens.find((hero) => {
        if (hero.kind !== 'hero' || hero.levelId !== foe.levelId) return false;
        const dist = Math.hypot(hero.x - foe.x, hero.y - foe.y) * feet;
        const bright = lit === null || lit.has(cellKey(hero.x, hero.y));
        if (dist > (bright ? SIGHT_CAP : DWELLER_SIGHT)) return false;
        return lineOfSight(ctx, here, { x: hero.x, y: hero.y });
      });
      if (seen) {
        foe = { ...foe, alert: true };
        if (!halt) {
          const title = `${foe.name.trim() || 'Jemand'} hat die Gruppe bemerkt`;
          play = logged(play, title);
          halt = {
            type: 'alert',
            title,
            text: dweller?.note.trim() ?? '',
            levelId: foe.levelId,
            pick: null,
            cell: here,
          };
        }
      }
    }
    if (foe !== token)
      play = { ...play, tokens: play.tokens.map((t) => (t.id === foe.id ? foe : t)) };
  }
  return { play, halt };
}

/** In Runden: Der Gegner am Zug geht auf den nächsten Gefährten zu, so weit seine Bewegung reicht. */
export function foeTurn(dungeon: Dungeon, tokenId: string): MoveResult | null {
  const play = dungeon.play;
  const foe = play?.tokens.find((t) => t.id === tokenId);
  if (!play || !foe) return null;
  const hero = nearestHero(play, foe);
  if (!hero) return null;
  const route = routeBetween(dungeon, foe.levelId, { x: foe.x, y: foe.y }, hero);
  const goal = route?.cells[route.cells.length - 2];
  if (!goal || sameCell(goal, foe)) return { play, halt: null, feet: 0 };
  return moveTokens(dungeon, [tokenId], goal);
}

// ── Schalter ───────────────────────────────────────────────────────────────

/**
 * Jemand benutzt ein Ding mit Wirkung (einen Hebel): Türen und Gitter gehen auf oder zu,
 * Geheimtüren zeigen und öffnen sich, Fallen sind entschärft, Etagenwechsel entriegelt.
 */
export function useMarker(dungeon: Dungeon, levelId: string, markerId: string): DungeonPlay | null {
  let play: DungeonPlay | null = dungeon.play;
  const marker = levelOf(dungeon, levelId)?.markers.find((m) => m.id === markerId);
  if (!play || !marker) return play;
  for (const link of marker.links) {
    const level = levelOf(dungeon, link.levelId);
    if (!level) continue;
    if (link.kind === 'edge') {
      const edge: DungeonEdge | undefined = playLevel(level, play).edges[link.ref];
      if (!edge) continue;
      if (edge.kind === 'secret')
        play = setFound(
          play,
          edgeRun(level, link.ref).map((k) => edgeFoundKey(link.levelId, k)),
          true,
        );
      play =
        setDoor({ ...dungeon, play }, link.levelId, link.ref, {
          opened: !edge.opened,
          locked: false,
        }) ?? play;
    } else if (link.kind === 'trap') play = setTrapDisarmed(play, link.ref, true);
    else if (!play.unlocked.includes(link.ref))
      play = { ...play, unlocked: [...play.unlocked, link.ref] };
  }
  return rememberSight(
    dungeon,
    logged(play, `${marker.label.trim() || 'Ein Schalter'} wird benutzt`),
  );
}

// ── Initiative, Weltzeit ───────────────────────────────────────────────────

/** Würfelt Initiative für alle, die noch keine haben: W20 plus Bonus. */
export function rollInits(
  play: DungeonPlay,
  die: (sides: number) => number,
  bonusOf: (token: DungeonToken) => number,
): DungeonPlay {
  return {
    ...play,
    tokens: play.tokens.map((token) =>
      token.init === null ? { ...token, init: die(20) + bonusOf(token) } : token,
    ),
  };
}

/** Ganze Minuten im Dungeon, die noch nicht in die Weltzeit übernommen sind. */
export const unsyncedMinutes = (play: DungeonPlay): number =>
  Math.floor((play.seconds - play.synced) / 60);

/** Merkt, dass diese Minuten in der Weltzeit stehen. */
export const markSynced = (play: DungeonPlay, minutes: number): DungeonPlay => ({
  ...play,
  synced: play.synced + minutes * 60,
});

// ── Figuren ────────────────────────────────────────────────────────────────

export interface HeroInit {
  name: string;
  characterId?: string | null;
  speed?: number;
  darkvision?: number;
  passive?: number;
}

/** Stellt die Gruppe auf: die Gefährten auf einem Feld und den freien daneben. */
export function startPlay(
  dungeon: Dungeon,
  heroes: readonly HeroInit[],
  levelId: string,
  at: DungeonCell,
): DungeonPlay | null {
  const level = levelOf(dungeon, levelId);
  if (!level || !isWalkable(tileAt(level, at))) return null;
  const spots = landing(level, at, heroes.length);
  const play = DungeonPlaySchema.parse({
    tokens: [
      ...heroes.map((hero, index) => ({
        id: newId(),
        kind: 'hero',
        levelId,
        ...spots[index]!,
        ...hero,
      })),
      // Wer vorbereitet wartet, steht auf seinem Platz.
      ...dungeon.levels.flatMap((lv) =>
        lv.dwellers.map((dweller) => ({
          id: newId(),
          kind: 'foe',
          levelId: lv.id,
          x: dweller.x,
          y: dweller.y,
          name: dweller.name,
          speed: dweller.speed,
          dwellerId: dweller.id,
          hp: dweller.hp,
          hpMax: dweller.hp,
        })),
      ),
    ],
  });
  const roomId = roomAt(level, at);
  return rememberSight(dungeon, { ...play, rooms: roomId ? [roomId] : [] });
}

/** Der nächste freie Name „Gegner N“. */
function nextFoeName(play: DungeonPlay): string {
  const taken = new Set(play.tokens.map((t) => t.name.trim().toLowerCase()));
  for (let n = 1; ; n++) if (!taken.has(`gegner ${n}`)) return `Gegner ${n}`;
}

export function addToken(
  play: DungeonPlay,
  kind: 'hero' | 'foe',
  levelId: string,
  cell: DungeonCell,
): { play: DungeonPlay; token: DungeonToken } {
  const token = DungeonTokenSchema.parse({
    id: newId(),
    kind,
    levelId,
    ...cell,
    name: kind === 'foe' ? nextFoeName(play) : `Figur ${play.tokens.length + 1}`,
  });
  return { play: { ...play, tokens: [...play.tokens, token] }, token };
}

export function patchToken(
  dungeon: Dungeon,
  tokenId: string,
  change: Partial<Omit<DungeonToken, 'id'>>,
): DungeonPlay | null {
  const play = dungeon.play;
  if (!play) return null;
  const next = {
    ...play,
    tokens: play.tokens.map((t) =>
      t.id === tokenId ? DungeonTokenSchema.parse({ ...t, ...change }) : t,
    ),
  };
  return rememberSight(dungeon, next);
}

/** Zündet ein Licht an (es brennt ab jetzt seine Zeit) oder löscht es. */
export function setLight(
  dungeon: Dungeon,
  tokenId: string,
  light: DungeonLight,
): DungeonPlay | null {
  const play = dungeon.play;
  if (!play) return null;
  return patchToken(dungeon, tokenId, {
    light,
    lightEnds: light === 'none' ? null : play.seconds + LIGHT_MINUTES[light] * 60,
  });
}

export function removeToken(play: DungeonPlay, tokenId: string): DungeonPlay {
  const rounds =
    play.rounds && play.rounds.turn === tokenId ? { ...play.rounds, turn: null } : play.rounds;
  return { ...play, rounds, tokens: play.tokens.filter((t) => t.id !== tokenId) };
}

// ── Runden ─────────────────────────────────────────────────────────────────

/** Die Reihenfolge in Runden: nach Initiative, wer keine hat, zuletzt; bei Gleichstand Gefährten zuerst. */
export function turnOrder(play: DungeonPlay): DungeonToken[] {
  return [...play.tokens].sort(
    (a, b) =>
      (b.init ?? -Infinity) - (a.init ?? -Infinity) ||
      Number(b.kind === 'hero') - Number(a.kind === 'hero'),
  );
}

/** Beginnt Runden: Der Erste der Reihenfolge ist am Zug. */
export function startRounds(play: DungeonPlay): DungeonPlay {
  const first = turnOrder(play)[0];
  return logged(
    { ...play, rounds: { turn: first?.id ?? null, moved: 0, round: 1 } },
    'Runden beginnen',
  );
}

/** Beendet Runden: Es wird wieder frei erkundet. */
export const endRounds = (play: DungeonPlay): DungeonPlay =>
  logged({ ...play, rounds: null }, 'Runden enden');

/** Der Nächste ist am Zug; nach dem Letzten beginnt eine neue Runde, und sechs Sekunden vergehen. */
export function nextTurn(play: DungeonPlay): { play: DungeonPlay; out: DungeonToken | null } {
  if (!play.rounds) return { play, out: null };
  const order = turnOrder(play);
  const index = order.findIndex((t) => t.id === play.rounds!.turn);
  const next = order[index + 1];
  if (next)
    return { play: { ...play, rounds: { ...play.rounds, turn: next.id, moved: 0 } }, out: null };
  const passed = advance(play, ROUND_SECONDS);
  return {
    play: {
      ...passed.play,
      rounds: { turn: order[0]?.id ?? null, moved: 0, round: play.rounds.round + 1 },
    },
    out: passed.out,
  };
}

// ── Die Sicht der Spieler ──────────────────────────────────────────────────

/**
 * Die Ebene, wie die Spieler sie kennen: nur Gesehenes, Geheimtüren, die niemand kennt, als Wand,
 * verborgene Fallen und Etagenwechsel gar nicht. Am Rand des Gesehenen steht ein Feld Dunkel,
 * damit ein Gang nicht wie zugemauert aussieht.
 */
export function playerLevel(level: DungeonLevel, play: DungeonPlay): DungeonLevel {
  const now = playLevel(level, play);
  const seen = new Set(play.seen[level.id] ?? []);
  const tiles: DungeonLevel['tiles'] = {};
  const roomOf: DungeonLevel['roomOf'] = {};
  for (const key of seen) {
    const tile = now.tiles[key];
    if (tile === undefined) continue;
    tiles[key] = tile === 'secret' ? 'floor' : tile;
    if (now.roomOf[key]) roomOf[key] = now.roomOf[key]!;
  }
  // Der Rand: Felder, in die es vom Gesehenen aus offen weitergeht.
  for (const key of seen) {
    const cell = cellOfKey(key);
    for (const delta of NEIGHBOURS.slice(0, 4)) {
      const next = { x: cell.x + delta.x, y: cell.y + delta.y };
      const nextKey = keyOf(next);
      if (seen.has(nextKey) || now.tiles[nextKey] === undefined) continue;
      const kind = edgeBetween(now, cell, next).kind;
      if (kind !== 'open') continue;
      tiles[nextKey] = 'floor';
      if (now.roomOf[nextKey]) roomOf[nextKey] = now.roomOf[nextKey]!;
    }
  }
  const edges: DungeonLevel['edges'] = {};
  for (const [key, edge] of Object.entries(now.edges)) {
    const { a, b } = cellsOfEdge(key);
    if (!seen.has(keyOf(a)) && !seen.has(keyOf(b))) continue;
    const hidden = edge.kind === 'secret' && !play.found.includes(edgeFoundKey(level.id, key));
    edges[key] =
      hidden || edge.kind === 'false' ? { ...edge, kind: hidden ? 'wall' : 'door' } : edge;
  }
  const known = new Set(play.rooms);
  return {
    ...now,
    tiles,
    roomOf,
    edges,
    rooms: now.rooms.map((room) =>
      known.has(room.id) ? room : { ...room, name: '', round: null },
    ),
    traps: now.traps.filter((trap) => play.found.includes(trapFoundKey(trap.id))),
    stairs: now.stairs.filter(
      (stair) =>
        seen.has(cellKey(stair.x, stair.y)) &&
        (!stair.secret || play.found.includes(stairFoundKey(stair.id))),
    ),
    markers: now.markers.filter(
      (marker) => seen.has(cellKey(marker.x, marker.y)) && marker.kind !== 'note',
    ),
  };
}

/** Die Zeit im Dungeon in Worten: „12 Min.“, „1 Std. 5 Min.“. */
export function clockWords(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `${seconds} Sek.`;
  if (minutes < 60) return `${minutes} Min.`;
  const rest = minutes % 60;
  return rest === 0
    ? `${Math.floor(minutes / 60)} Std.`
    : `${Math.floor(minutes / 60)} Std. ${rest} Min.`;
}
