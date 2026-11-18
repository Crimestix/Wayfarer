/**
 * Der Zustand des Dungeon-Editors: Werkzeug, Auswahl, Ebene, Rückgängig und Wiederholen. Ein
 * Strich (Malen mit gedrückter Maus) lebt als Entwurf und wird erst beim Loslassen geschrieben –
 * ein Schritt im Verlauf, eine Speicherung.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CampaignDb } from '../../data/db';
import {
  healStairs,
  levelOf,
  levelsSorted,
  pickExists,
  withLevel,
  type DungeonPick,
  type StairRef,
} from '../../domain/dungeon';
import type {
  Dungeon,
  DungeonCell,
  DungeonEdgeKind,
  DungeonLevel,
  DungeonStairKind,
  DungeonThing,
  DungeonTile,
} from '../../domain/schema';
import { saveLevels } from './actions';

export const TOOLS = [
  'select',
  'room',
  'floor',
  'rock',
  'area',
  'wall',
  'door',
  'trap',
  'stair',
  'marker',
  'erase',
] as const;
export type Tool = (typeof TOOLS)[number];

/** Die Werkzeuge in Gruppen, wie sie in der Leiste stehen. */
export const TOOL_GROUPS: readonly (readonly Tool[])[] = [
  ['select'],
  ['room', 'floor', 'rock', 'area'],
  ['wall', 'door'],
  ['trap', 'stair', 'marker'],
  ['erase'],
];

export const TOOL_LABEL: Record<Tool, string> = {
  select: 'Auswählen',
  room: 'Raum',
  floor: 'Boden',
  rock: 'Fels',
  area: 'Raumfläche',
  wall: 'Wand',
  door: 'Tür',
  trap: 'Falle',
  stair: 'Etagenwechsel',
  marker: 'Einrichtung',
  erase: 'Entfernen',
};

export const TOOL_HINT: Record<Tool, string> = {
  select:
    'Anklicken, was du ändern willst: Raum, Tür, Falle, Etagenwechsel. Einen Raum ziehst du mit der Maus an eine andere Stelle.',
  room: 'Einen Raum aufziehen – eckig oder rund. Wände zu allem ringsum stehen von selbst.',
  floor:
    'Gänge und Höhlen malen – mit der Pinselgröße auch zwei oder drei Felder breit. Führt der Strich in einen Raum, entsteht dort ein Durchgang auf ganzer Breite. Umschalt: Rechteck.',
  rock: 'Boden wieder zu Fels machen. Umschalt: Rechteck.',
  area: 'Boden einem Raum zuschlagen oder herausnehmen.',
  wall: 'Eine Wand auf die Kante zwischen zwei Feldern setzen – klicken oder entlangziehen.',
  door: 'Auf eine Kante klicken: Tür, Durchgang, Gitter, Geheimtür, Fenster, Vorhang oder Scheintür. Entlangziehen macht sie breiter – zwei Felder sind eine Doppeltür.',
  trap: 'Ein Feld anklicken, auf dem die Falle auslöst; ziehen für mehrere Felder.',
  stair:
    'Treppe, Wendeltreppe, Leiter, Schacht, Falltür oder Portal setzen – das Ziel wählst du danach.',
  marker: 'Etwas auf ein Feld stellen: Säule, Truhe, Hebel, Altar – oder eine freie Notiz.',
  erase: 'Anklicken, was weg soll: Tür, Wand, Falle, Etagenwechsel, Einrichtung.',
};

export const TOOL_KEY: Record<Tool, string> = {
  select: 'V',
  room: 'R',
  floor: 'B',
  rock: 'X',
  area: 'A',
  wall: 'W',
  door: 'D',
  trap: 'F',
  stair: 'T',
  marker: 'M',
  erase: 'E',
};

/** Das Werkzeug zu einer Taste; „S“ ist die Tür als Geheimtür. */
export function toolOfKey(key: string): { tool: Tool; edgeKind?: DungeonEdgeKind } | null {
  const upper = key.toUpperCase();
  if (upper === 'S') return { tool: 'door', edgeKind: 'secret' };
  const tool = TOOLS.find((t) => TOOL_KEY[t] === upper);
  return tool ? { tool } : null;
}

/** Werkzeuge mit Pinselgröße. */
export const hasSize = (tool: Tool): boolean =>
  tool === 'floor' || tool === 'rock' || tool === 'area';

/** Worauf der nächste Klick auf die Karte antwortet, statt dem Werkzeug zu folgen. */
export type PickMode =
  | { type: 'trap-cells'; trapId: string }
  | { type: 'trap-spots'; trapId: string }
  | { type: 'stair-target'; from: StairRef };

export const PICK_MODE_TEXT: Record<PickMode['type'], string> = {
  'trap-cells': 'Klicke die Felder an, auf denen die Falle auslöst.',
  'trap-spots': 'Klicke die Felder an, von denen aus die Falle zu bemerken ist.',
  'stair-target': 'Wähle die Ebene und klicke das Feld an, auf dem man ankommt.',
};

export interface ViewCommand {
  type: 'fit' | 'center';
  cell?: DungeonCell;
  nonce: number;
}

/** So viele Schritte lassen sich zurücknehmen. */
export const HISTORY_STEPS = 80;

interface History {
  past: DungeonLevel[][];
  future: DungeonLevel[][];
}

/** Der Verlauf je Dungeon – er übersteht den Wechsel der Seite, nicht den Neustart. */
const histories = new Map<string, History>();
const historyOf = (id: string): History => {
  let history = histories.get(id);
  if (!history) {
    history = { past: [], future: [] };
    histories.set(id, history);
  }
  return history;
};

export function useDungeonEditor(db: CampaignDb, stored: Dungeon) {
  const [tool, setToolState] = useState<Tool>('room');
  const [tile, setTile] = useState<DungeonTile>('floor');
  const [size, setSize] = useState(1);
  const [edgeKind, setEdgeKind] = useState<DungeonEdgeKind>('door');
  const [stairKind, setStairKind] = useState<DungeonStairKind>('stairs');
  const [roomShape, setRoomShape] = useState<'rect' | 'round'>('rect');
  const [markerKind, setMarkerKind] = useState<DungeonThing>('chest');
  const [areaRoomId, setAreaRoomId] = useState<string | null>(null);
  const [levelId, setLevelId] = useState<string>(() => levelsSorted(stored)[0]?.id ?? '');
  const [selection, setSelection] = useState<DungeonPick | null>(null);
  const [pickMode, setPickMode] = useState<PickMode | null>(null);
  const [ghost, setGhost] = useState(false);
  const [draft, setDraft] = useState<DungeonLevel[] | null>(null);
  const [viewCommand, setViewCommand] = useState<ViewCommand>({ type: 'fit', nonce: 0 });
  const [, bump] = useState(0);

  const dungeon = useMemo(() => (draft ? { ...stored, levels: draft } : stored), [stored, draft]);
  const latest = useRef(dungeon);
  latest.current = dungeon;
  const strokeBase = useRef<DungeonLevel[] | null>(null);

  const level = levelOf(dungeon, levelId) ?? levelsSorted(dungeon)[0] ?? null;
  // Die gewählte Ebene gibt es nicht mehr (gelöscht, von außen geändert): die oberste gilt.
  useEffect(() => {
    if (level && level.id !== levelId) setLevelId(level.id);
  }, [level, levelId]);
  // Was gewählt war, gibt es nicht mehr.
  useEffect(() => {
    if (selection && level && !pickExists(level, selection)) setSelection(null);
  }, [selection, level]);

  const history = historyOf(stored.id);

  const write = useCallback(
    (levels: DungeonLevel[]) => saveLevels(db, stored.id, levels),
    [db, stored.id],
  );

  /** Ein Schritt: ändert den Dungeon, merkt den Stand davor, speichert. */
  const apply = useCallback(
    (change: (dungeon: Dungeon) => Dungeon) => {
      const before = latest.current;
      const next = healStairs(change(before));
      if (next === before || next.levels === before.levels) return;
      if (strokeBase.current) {
        latest.current = next;
        setDraft(next.levels);
        return;
      }
      history.past = [...history.past, before.levels].slice(-HISTORY_STEPS);
      history.future = [];
      latest.current = next;
      write(next.levels);
      bump((n) => n + 1);
    },
    [history, write],
  );

  /** Ändert die Ebene, die gerade offen ist. */
  const applyLevel = useCallback(
    (change: (level: DungeonLevel) => DungeonLevel, id?: string) =>
      apply((d) => withLevel(d, id ?? levelIdRef.current, change)),
    [apply],
  );
  const levelIdRef = useRef(levelId);
  levelIdRef.current = level?.id ?? levelId;

  const beginStroke = useCallback(() => {
    strokeBase.current = latest.current.levels;
  }, []);
  const endStroke = useCallback(() => {
    const base = strokeBase.current;
    strokeBase.current = null;
    if (!base) return;
    const now = latest.current.levels;
    setDraft(null);
    if (now === base) return;
    history.past = [...history.past, base].slice(-HISTORY_STEPS);
    history.future = [];
    write(now);
  }, [history, write]);

  const undo = useCallback(() => {
    const restore = history.past[history.past.length - 1];
    if (!restore || strokeBase.current) return;
    history.past = history.past.slice(0, -1);
    history.future = [...history.future, latest.current.levels];
    write(restore);
    bump((n) => n + 1);
  }, [history, write]);
  const redo = useCallback(() => {
    const restore = history.future[history.future.length - 1];
    if (!restore || strokeBase.current) return;
    history.future = history.future.slice(0, -1);
    history.past = [...history.past, latest.current.levels];
    write(restore);
    bump((n) => n + 1);
  }, [history, write]);

  const setTool = useCallback((next: Tool) => {
    setToolState(next);
    setPickMode(null);
  }, []);

  const openLevel = useCallback((id: string) => {
    setLevelId(id);
    setSelection(null);
  }, []);

  const fit = useCallback(() => setViewCommand((c) => ({ type: 'fit', nonce: c.nonce + 1 })), []);
  const centerOn = useCallback(
    (cell: DungeonCell) => setViewCommand((c) => ({ type: 'center', cell, nonce: c.nonce + 1 })),
    [],
  );

  /** Springt zu etwas: Ebene öffnen, auswählen, in die Mitte holen. */
  const reveal = useCallback(
    (toLevelId: string, pick: DungeonPick | null, cell: DungeonCell | null) => {
      setLevelId(toLevelId);
      setSelection(pick);
      setPickMode(null);
      if (pick) setToolState('select');
      if (cell) setViewCommand((c) => ({ type: 'center', cell, nonce: c.nonce + 1 }));
    },
    [],
  );

  return {
    dungeon,
    level,
    tool,
    setTool,
    tile,
    setTile,
    size,
    setSize,
    edgeKind,
    setEdgeKind,
    stairKind,
    setStairKind,
    roomShape,
    setRoomShape,
    markerKind,
    setMarkerKind,
    areaRoomId,
    setAreaRoomId,
    selection,
    setSelection,
    pickMode,
    setPickMode,
    ghost,
    setGhost,
    openLevel,
    apply,
    applyLevel,
    beginStroke,
    endStroke,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    viewCommand,
    fit,
    centerOn,
    reveal,
  };
}

export type DungeonEditor = ReturnType<typeof useDungeonEditor>;

/**
 * Wird gerade getippt? Dann gehören die Tasten dem Feld. Kästchen und Knöpfe zählen nicht – nach
 * einem Klick auf „verschlossen“ sollen die Tasten der Werkzeuge weiter gelten.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    return true;
  if (target.tagName !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'range'].includes(type);
}
