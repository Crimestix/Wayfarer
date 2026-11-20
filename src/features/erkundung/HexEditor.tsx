/**
 * Hexkarten bearbeiten (Wunsch des Spielleiters, 17. 11.: „Wir müssen in der Vorbereitung
 * Hexkarten perfekt vorbereiten können“ – „Wir brauchen ne richtige Editor-Ansicht“): die
 * Werkzeugleiste links der Karte in der Ansicht „Vorbereiten“ – Auswählen, Gelände malen (mit
 * Pinselgröße), Felder einem Gebiet der Welt zuordnen, Wege und Flüsse von Feld zu Feld ziehen und
 * ihnen einen Eintrag geben, radieren, die Karte am Rand wachsen lassen, unter der Erde Gänge, Fels
 * und Schächte. Jeder Schritt lässt sich mit Strg+Z zurücknehmen und mit Strg+Y wiederholen
 * (`prep.ts`); Neu würfeln behält, was von Hand gemacht ist.
 */
import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  Brush,
  ChevronDown,
  ChevronRight,
  MousePointer2,
  Redo2,
  Undo2,
  Eraser,
  Grid2x2Plus,
  MapPin,
  MapPinned,
  Mountain,
  Route,
  Spline,
  Waves,
} from 'lucide-react';
import { PASSAGE_LABEL, isRock } from '../../domain/passages';
import { useData, useDb } from '../../data/hooks';
import { hexDistance, hexKey, hexLine, type HexCoord } from '../../domain/hex';
import {
  PASSAGE_KINDS,
  type Area,
  type CampaignData,
  type Hex,
  type PassageKind,
} from '../../domain/schema';
import {
  landscapeLook,
  landscapeOfHex,
  landscapeOfKind,
  landscapesOf,
  paintOfLandscape,
} from '../../domain/landscape';
import {
  KIND_GROUP_LABEL,
  SOLID_ROCK,
  WIDE_CAVE_KINDS,
  hexKind,
  kindKeyOf,
  kindsByGroup,
  paintOfKind,
} from '../../domain/hexKinds';
import {
  connectLine,
  eraseLine,
  hasLine,
  lineEntityId,
  lineRun,
  markLine,
  setLineEntity,
  type LineKind,
  type LineValue,
} from '../../domain/hexLines';
import { TERRAIN_LABEL } from '../../domain/terrain';
import { GLYPH, KIND_GLYPH } from './HexMap';
import { Button, EntityPicker, IconButton, Input, Panel, Select, toast } from '../../ui';
import { addFromWriting } from '../welt/writing';
import { digCave } from './dig';
import { CAVE_GROUND } from './HexLayers';
import { LAND_GROUND } from './HexGround';
import { EMPTY_HISTORY, recordStep, redoHistory, undoHistory, type HexHistory } from './prep';
import {
  addHex,
  digBetween,
  fillRim,
  fillRock,
  mapExtent,
  rimSlots,
  toggleShaft,
  paintHexes,
  placeSuggestions,
  placeWorldPlaces,
  removeHex,
  restoreHexes,
  type HexPaint,
} from './actions';

export type HexTool =
  | 'select'
  | 'tunnel'
  | 'rock'
  | 'shaft'
  | 'terrain'
  | 'region'
  | 'road'
  | 'river'
  | 'place'
  | 'erase'
  | 'cells';

const TOOL_LABEL: Record<HexTool, string> = {
  select: 'Auswählen',
  tunnel: 'Gang',
  rock: 'Fels',
  shaft: 'Schacht',
  terrain: 'Gelände',
  region: 'Gebiet',
  road: 'Weg',
  river: 'Fluss',
  place: 'Ort',
  erase: 'Radierer',
  cells: 'Größe',
};

const TOOL_HINT: Record<HexTool, string> = {
  select:
    'Klick wählt ein Feld, Umschalt- oder Strg-Klick nimmt weitere dazu. Rechts steht, was dort ist.',
  tunnel:
    'Mit gedrückter Maus von Feld zu Feld einen Gang ziehen – die Seiten dazwischen gehen auf. Hier wählst du die Art: eng, Kletterei, unter Wasser, verborgen.',
  rock: 'Felder zu Fels machen: kein Ausgang mehr, auch nicht von den Nachbarn.',
  shaft: 'Klick auf ein Feld: Schacht hinab zur Ebene darunter öffnen oder schließen.',
  terrain:
    'Mit gedrückter Maus Gelände malen – auch auf die leeren Felder am Rand: So wächst die Karte. Unter der Erde gräbt der Pinsel: Ein Gang folgt deinem Strich von Feld zu Feld, Höhlen wachsen mit ihren Nachbarn zusammen, Massivfels schüttet wieder zu.',
  region:
    'Felder anklicken oder überstreichen, die zusammengehören – dann sagst du, zu welchem Ort der Welt. Sein Gelände, sein Tempo und seine Tabellen gelten dort.',
  road: 'Von Feld zu Feld ziehen. Auf Straße und Pfad reist die Gruppe im Tempo offenen Landes – auch durch Wald und Sumpf –, und ein Fluss hält sie dort nicht auf. Ein Klick auf einen Weg wählt ihn.',
  river:
    'Von Feld zu Feld ziehen. Wo keine Straße und kein Pfad hinüberführt, hält die Reise am Fluss: Die Gruppe muss ihn überqueren. Ein Klick auf einen Fluss wählt ihn.',
  place: 'Einen Ort der Welt auf ein Feld setzen: wählen, dann aufs Feld klicken.',
  erase: 'Weg, Fluss und Gebiet von Feldern nehmen.',
  cells:
    'Die leeren Felder mit dem Plus gehören noch nicht zur Karte. Ein Klick fügt eines an, der Gelände-Pinsel malt direkt darauf. Hier: ein Klick auf ein Feld der Karte nimmt es weg.',
};

/** Die Felder unter dem Pinsel: das Feld selbst und bei größerem Pinsel die Nachbarn. */
const under = (area: Area, at: HexCoord, radius: number): HexCoord[] =>
  area.hexes
    .filter((hex) => hex.level === (at.level ?? 0) && hexDistance(hex, at) <= radius - 1)
    .map(({ q, r, level }) => ({ q, r, level }));

/** Was gerade gewählt ist, wenn mit „Weg“ oder „Fluss“ gearbeitet wird: eine zusammenhängende Linie. */
export interface LineSelection {
  kind: LineKind;
  coords: HexCoord[];
}

const coordOf = (hex: Hex): HexCoord => ({ q: hex.q, r: hex.r, level: hex.level });

export function useHexEditor(area: Area) {
  const db = useDb();
  const caves = area.hexes.some((hex) => hex.exits !== null);
  const [tool, setToolState] = useState<HexTool>('select');
  /** Rückgängig und Wiederholen über viele Schritte (`prep.ts`). */
  const [history, setHistory] = useState<HexHistory>(EMPTY_HISTORY);
  const current = () => db.getSnapshot().areas[area.id]?.hexes ?? area.hexes;
  /** Merkt den Stand der Felder vor einem Schritt. */
  const record = useCallback((before: Hex[]) => setHistory((h) => recordStep(h, before)), []);
  const undo = () => {
    const step = undoHistory(history, current());
    if (!step) return false;
    restoreHexes(db, area.id, step.restore);
    setHistory(step.history);
    return true;
  };
  const redo = () => {
    const step = redoHistory(history, current());
    if (!step) return false;
    restoreHexes(db, area.id, step.restore);
    setHistory(step.history);
    return true;
  };
  const [passage, setPassageKind] = useState<PassageKind>('open');
  /** Das Feld, an dem der Gang oder die Linie gerade angekommen ist. */
  const lastCell = useRef<HexCoord | null>(null);
  /** Die Geländeart des Pinsels (`domain/hexKinds.ts`) und die zuletzt benutzten. */
  const [kind, setKindState] = useState<string>(caves ? 'cave-floor' : 'forest');
  const [recent, setRecent] = useState<string[]>([]);
  const setKind = (key: string) => {
    setKindState(key);
    setRecent((list) => [key, ...list.filter((entry) => entry !== key)].slice(0, 8));
  };
  /** Werkzeug „Gebiet“: die Felder, die gerade gewählt sind. */
  const [regionSel, setRegionSel] = useState<HexCoord[]>([]);
  const regionAdd = useRef(true);
  /** Werkzeug „Weg“: Straße oder Pfad; „Fluss“: der Name für einen neuen Fluss. */
  const [roadKind, setRoadKind] = useState<'road' | 'trail'>('road');
  const [river, setRiver] = useState('');
  const [lineSel, setLineSel] = useState<LineSelection | null>(null);
  const strokeStart = useRef<HexCoord | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [radius, setRadius] = useState(1);
  /** Wie viele Felder weit der leere Rand um die Karte reicht (nur Ansicht). */
  const [rim, setRim] = useState(1);
  /** Der Stand der Felder vor dem laufenden Strich – zum Zurücknehmen. */
  const before = useRef<Hex[] | null>(null);
  const touched = useRef(0);

  const setTool = (next: HexTool) => {
    setToolState(next);
    setLineSel(null);
    if (next !== 'region') setRegionSel([]);
  };
  const write = (hexes: Hex[]) => db.patch('areas', area.id, { hexes });
  const lineValue = (): LineValue =>
    tool === 'river' ? { kind: 'river', name: river } : { kind: 'road', road: roadKind };

  const change = (): HexPaint | null =>
    tool === 'terrain' ? brushPaint(db.getSnapshot(), kind) : null;
  const apply = (at: HexCoord) => {
    if (tool === 'tunnel') {
      const last = lastCell.current;
      lastCell.current = at;
      if (!last || (last.level ?? 0) !== (at.level ?? 0)) return;
      // Fährt die Maus schnell, liegen Felder dazwischen: Der Gang geht durch alle.
      const path = hexLine(last, at).map((c) => ({ ...c, level: at.level ?? 0 }));
      for (let i = 1; i < path.length; i++)
        if (digBetween(db, area.id, path[i - 1]!, path[i]!, passage)) touched.current++;
      return;
    }
    if (tool === 'rock') {
      if (fillRock(db, area.id, at)) touched.current++;
      return;
    }
    if (tool === 'road' || tool === 'river') {
      const value = lineValue();
      const last = lastCell.current;
      lastCell.current = at;
      let hexes = current();
      if (!last) hexes = markLine(hexes, at, value);
      else if (hexKey(last) !== hexKey(at)) {
        // Von Feld zu Feld – auch wenn die Maus schnell über mehrere hinwegfährt.
        const path = hexLine(last, at).map((c) => ({ ...c, level: at.level ?? 0 }));
        for (let i = 1; i < path.length; i++)
          hexes = connectLine(hexes, path[i - 1]!, path[i]!, value);
        touched.current += path.length - 1;
      } else return;
      write(hexes);
      return;
    }
    if (tool === 'erase') {
      const coords = under(area, at, radius);
      const keys = new Set(coords.map(hexKey));
      const cleared = eraseLine(eraseLine(current(), coords, 'road'), coords, 'river').map((hex) =>
        keys.has(hexKey(hex)) && hex.regionId ? { ...hex, regionId: null, manual: true } : hex,
      );
      write(cleared);
      touched.current += coords.length;
      return;
    }
    if (tool === 'region') {
      const coords = under(area, at, radius);
      setRegionSel((sel) => {
        const keys = new Set(coords.map(hexKey));
        if (!regionAdd.current) return sel.filter((entry) => !keys.has(hexKey(entry)));
        const have = new Set(sel.map(hexKey));
        return [...sel, ...coords.filter((entry) => !have.has(hexKey(entry)))];
      });
      return;
    }
    const paint = change();
    if (!paint) return;
    // Unter der Erde gräbt der Pinsel (`dig.ts`): Gänge folgen dem Strich, Höhlen wachsen zusammen.
    if (caves && hexKind(kind)?.group === 'underdark') {
      const from = lastCell.current;
      lastCell.current = at;
      const wide = WIDE_CAVE_KINDS.has(kind) || kind === SOLID_ROCK;
      write(
        digCave(current(), { at, coords: under(area, at, wide ? radius : 1), kind, paint, from }),
      );
      touched.current++;
      return;
    }
    const coords = under(area, at, radius);
    paintHexes(db, area.id, coords, paint);
    touched.current += coords.length;
  };
  const onStart = (at: HexCoord, pick = false) => {
    // Pipette: Strg- oder Alt-Klick nimmt die Geländeart eines Feldes auf.
    if (pick && tool === 'terrain') {
      const hex = current().find((entry) => hexKey(entry) === hexKey(at));
      const land = hex ? landscapeOfHex(db.getSnapshot(), hex) : undefined;
      const key = land ? `landscape:${land.id}` : hex ? kindKeyOf(hex) : null;
      if (key) {
        setKind(key);
        toast({
          slot: 'hexkarte',
          title: `Aufgenommen: ${land?.name ?? hexKind(key)?.label ?? key}`,
        });
      }
      return;
    }
    if (tool === 'shaft') {
      const old = db.getSnapshot().areas[area.id]?.hexes ?? area.hexes;
      const open = toggleShaft(db, area.id, at);
      if (open !== null) record(old);
      toast({
        slot: 'hexkarte',
        title:
          open === null
            ? 'Darunter liegt keine Ebene'
            : open
              ? 'Schacht hinab geöffnet'
              : 'Schacht geschlossen',
        ...(open && lowerIsPocket(db.getSnapshot().areas[area.id]?.hexes ?? [], at)
          ? { body: 'Unten ist noch Fels – zieh dort einen Gang weiter.' }
          : {}),
        ...(open === null
          ? {}
          : { action: { label: 'Rückgängig', run: () => restoreHexes(db, area.id, old) } }),
      });
      return;
    }
    if (tool === 'place') {
      const current = db.getSnapshot().areas[area.id] ?? area;
      const hex = current.hexes.find((entry) => hexKey(entry) === hexKey(at));
      if (!placeId || !hex) return;
      if (hex.placeId && (hex.placeId === current.fromId || hex.placeId === current.toId)) {
        toast({ slot: 'hexkarte', title: 'Hier stehen Start oder Ziel' });
        return;
      }
      const old = current.hexes;
      record(old);
      // Ein Ort steht auf einem Feld: Stand er schon woanders, zieht er um.
      restoreHexes(
        db,
        area.id,
        old.map((entry) =>
          hexKey(entry) === hexKey(at)
            ? { ...entry, placeId, manual: true }
            : entry.placeId === placeId
              ? { ...entry, placeId: null }
              : entry,
        ),
      );
      toast({
        slot: 'hexkarte',
        title: 'Ort gesetzt',
        ...(isRock(hex) ? { body: 'Hier ist noch Fels – zieh einen Gang hierher.' } : {}),
        action: { label: 'Rückgängig', run: () => restoreHexes(db, area.id, old) },
      });
      return;
    }
    if (tool === 'cells') {
      const fresh = db.getSnapshot().areas[area.id]?.hexes ?? area.hexes;
      if (removeHex(db, area.id, at)) {
        record(fresh);
        toast({
          slot: 'hexkarte',
          title: 'Feld weggenommen',
          action: { label: 'Rückgängig', run: () => restoreHexes(db, area.id, fresh) },
        });
      } else
        toast({
          slot: 'hexkarte',
          title: 'Dieses Feld bleibt',
          body: 'Start, Ziel und das Feld der Gruppe lassen sich nicht wegnehmen.',
        });
      return;
    }
    if (tool === 'region') {
      // Auf einem gewählten Feld begonnen: der Strich nimmt Felder wieder heraus.
      regionAdd.current = !regionSel.some((entry) => hexKey(entry) === hexKey(at));
      before.current = current();
      touched.current = 0;
      apply(at);
      return;
    }
    before.current = current();
    touched.current = 0;
    lastCell.current = null;
    strokeStart.current = at;
    if (tool === 'road' || tool === 'river') {
      // Ein Klick auf eine Linie, die es schon gibt, wählt sie nur – gezogen wird erst mit der Maus.
      const hex = before.current.find((entry) => hexKey(entry) === hexKey(at));
      if (hex && hasLine(hex, tool)) {
        lastCell.current = at;
        return;
      }
      touched.current = 1;
    }
    apply(at);
  };
  const onMove = (at: HexCoord) => {
    if (before.current && tool !== 'cells') apply(at);
  };
  const onEnd = () => {
    const old = before.current;
    before.current = null;
    const start = strokeStart.current;
    strokeStart.current = null;
    const end = lastCell.current;
    lastCell.current = null;
    if (!old) return;
    if (tool === 'region') return;
    if (tool === 'road' || tool === 'river') {
      // Danach ist die Linie gewählt, zu der der Strich gehört: So bekommt sie gleich ihren Eintrag.
      const at = end ?? start;
      const run = at ? lineRun(current(), at, tool) : [];
      setLineSel(run.length ? { kind: tool, coords: run.map(coordOf) } : null);
    }
    if (!touched.current) return;
    // Ein Strich ist ein Schritt für „Rückgängig“ (Leiste links, Strg+Z). Keine Meldung: Wer
    // malt, setzt Strich an Strich – eine Meldung nach jedem stört nur.
    record(old);
  };
  /** Ein leeres Feld am Rand: Klick fügt es an; der Gelände-Pinsel malt im Strich darüber hinweg. */
  const onSlot = (at: HexCoord, phase: 'down' | 'move') => {
    const painting = tool === 'terrain';
    if (phase === 'move' && !(painting && before.current)) return;
    const old = current();
    if (phase === 'down' && painting) {
      before.current = old;
      touched.current = 0;
    }
    const paint = painting ? brushPaint(db.getSnapshot(), kind) : null;
    if (!addHex(db, area.id, at, paint)) return;
    // Unter der Erde gräbt der Pinsel auch ins neue Feld hinein.
    if (caves && paint && hexKind(kind)?.group === 'underdark') {
      const from = lastCell.current;
      lastCell.current = at;
      write(digCave(current(), { at, coords: [at], kind, paint, from }));
    }
    if (before.current) {
      touched.current++;
      return;
    }
    record(old);
    toast({
      slot: 'hexkarte',
      title: 'Feld angefügt',
      action: { label: 'Rückgängig', run: () => restoreHexes(db, area.id, old) },
    });
  };

  /** Ordnet die gewählten Felder einem Ort der Welt zu (oder löst sie). */
  const assignRegion = (regionId: string | null) => {
    if (!regionSel.length) return;
    const old = current();
    paintHexes(db, area.id, regionSel, { regionId });
    record(old);
    const name = regionId ? db.getSnapshot().entities[regionId]?.name : null;
    toast({
      slot: 'hexkarte',
      title: name
        ? `${regionSel.length === 1 ? 'Ein Feld gehört' : `${regionSel.length} Felder gehören`} jetzt zu „${name}“`
        : 'Zuordnung gelöst',
      action: { label: 'Rückgängig', run: () => restoreHexes(db, area.id, old) },
    });
  };
  /** Alle Felder der Karte, die schon zu diesem Ort gehören, zur Auswahl dazu. */
  const selectRegion = (regionId: string) =>
    setRegionSel(
      current()
        .filter((hex) => hex.regionId === regionId)
        .map(coordOf),
    );

  /** Gibt der gewählten Linie ihren Eintrag der Welt (oder nimmt ihn weg). */
  const setLineEntry = (entityId: string | null) => {
    if (!lineSel) return;
    const old = current();
    const name = entityId ? (db.getSnapshot().entities[entityId]?.name ?? '') : '';
    write(setLineEntity(old, lineSel.coords, lineSel.kind, entityId, name));
    record(old);
    toast({
      slot: 'hexkarte',
      title: entityId
        ? `${lineSel.kind === 'river' ? 'Der Fluss' : 'Der Weg'} ist jetzt „${name}“`
        : 'Eintrag gelöst',
      action: { label: 'Rückgängig', run: () => restoreHexes(db, area.id, old) },
    });
  };
  /** Ändert die gewählte Linie: Straße oder Pfad, bzw. den Namen des Flusses. */
  const patchLine = (patch: { road?: 'road' | 'trail'; river?: string }) => {
    if (!lineSel) return;
    const keys = new Set(lineSel.coords.map(hexKey));
    const old = current();
    write(
      old.map((hex) =>
        keys.has(hexKey(hex))
          ? {
              ...hex,
              ...(patch.road && hex.road !== 'none' ? { road: patch.road } : {}),
              ...(patch.river !== undefined && hex.river
                ? { river: patch.river.trim() || 'Fluss' }
                : {}),
              manual: true,
            }
          : hex,
      ),
    );
    record(old);
  };
  const removeLine = () => {
    if (!lineSel) return;
    const old = current();
    write(eraseLine(old, lineSel.coords, lineSel.kind));
    record(old);
    setLineSel(null);
    toast({
      slot: 'hexkarte',
      title: lineSel.kind === 'river' ? 'Fluss entfernt' : 'Weg entfernt',
      action: { label: 'Rückgängig', run: () => restoreHexes(db, area.id, old) },
    });
  };
  /** Füllt den ganzen leeren Rand mit dem Gelände des Pinsels – die Karte wächst ringsum. */
  const growRim = () => {
    const old = current();
    const added = fillRim(db, area.id, rim, brushPaint(db.getSnapshot(), kind));
    if (!added) return;
    record(old);
    toast({
      slot: 'hexkarte',
      title: `${added} Felder angefügt`,
      action: { label: 'Rückgängig', run: () => restoreHexes(db, area.id, old) },
    });
  };

  /** Was auf der Karte hervorgehoben ist, solange dieses Werkzeug gewählt ist. */
  const marks: HexCoord[] | null =
    tool === 'region'
      ? regionSel
      : (tool === 'road' || tool === 'river') && lineSel?.kind === tool
        ? lineSel.coords
        : null;
  return {
    area,
    caves,
    tool,
    setTool,
    passage,
    setPassageKind,
    kind,
    setKind,
    recent,
    regionSel,
    setRegionSel,
    assignRegion,
    selectRegion,
    roadKind,
    setRoadKind,
    river,
    setRiver,
    lineSel: lineSel?.kind === tool ? lineSel : null,
    setLineEntry,
    patchLine,
    removeLine,
    placeId,
    setPlaceId,
    radius,
    setRadius,
    rim,
    setRim,
    growRim,
    marks,
    record,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    /**
     * Die leeren Felder am Rand – zu sehen, solange vorbereitet wird. Nicht auf Karten mit mehreren
     * Ebenen: Dort müsste jede Ebene mitwachsen.
     */
    slots: area.hexes.some((hex) => hex.level > 0) ? undefined : rimSlots(area, rim),
    onSlot,
    /**
     * Wie viele Felder weit der Pinsel gerade reicht – für die Vorschau unter dem Zeiger. Ein Gang
     * ist immer ein Feld breit; Werkzeuge ohne Pinsel haben keine.
     */
    brush:
      tool === 'terrain'
        ? caves &&
          hexKind(kind)?.group === 'underdark' &&
          !(WIDE_CAVE_KINDS.has(kind) || kind === SOLID_ROCK)
          ? 1
          : radius
        : tool === 'erase' || tool === 'region'
          ? radius
          : null,
    paint:
      tool === 'select'
        ? undefined
        : {
            onStart,
            onMove,
            onEnd,
          },
  };
}

export type HexEditor = ReturnType<typeof useHexEditor>;

/** Tastenkürzel der Werkzeuge (Ansicht „Vorbereiten“). */
export const TOOL_KEY: Record<HexTool, string> = {
  select: 'V',
  terrain: 'B',
  region: 'G',
  road: 'S',
  river: 'F',
  erase: 'E',
  place: 'O',
  cells: 'X',
  tunnel: 'T',
  rock: 'K',
  shaft: 'H',
};

const TOOL_ICON: Record<HexTool, ReactNode> = {
  select: <MousePointer2 aria-hidden />,
  terrain: <Brush aria-hidden />,
  region: <MapPinned aria-hidden />,
  road: <Route aria-hidden />,
  river: <Waves aria-hidden />,
  erase: <Eraser aria-hidden />,
  place: <MapPin aria-hidden />,
  cells: <Grid2x2Plus aria-hidden />,
  tunnel: <Spline aria-hidden />,
  rock: <Mountain aria-hidden />,
  shaft: <ArrowDownToLine aria-hidden />,
};

/** Die Werkzeuge einer Karte in Gruppen: oben, unter der Erde. */
export function toolsOf(caves: boolean): HexTool[][] {
  return caves
    ? [['select'], ['terrain', 'tunnel', 'rock', 'shaft'], ['region', 'place', 'cells']]
    : [['select'], ['terrain', 'region'], ['road', 'river', 'erase'], ['place', 'cells']];
}

/** Das Werkzeug zu einer Taste – nur, wenn es auf dieser Karte eins gibt. */
export function toolOfKey(key: string, caves: boolean): HexTool | null {
  const tools = toolsOf(caves).flat();
  return tools.find((tool) => TOOL_KEY[tool] === key.toUpperCase()) ?? null;
}

/** Mit Pinselgröße: Gelände, Gebiet, Radierer. */
export const brushTool = (tool: HexTool) =>
  tool === 'terrain' || tool === 'region' || tool === 'erase';

/** Die schmale Werkzeugleiste links der Karte: Symbole mit Tastenkürzel, oben Rückgängig. */
export function HexToolRail({ editor }: { editor: HexEditor }) {
  return (
    <div className="wf-erk-rail">
      <IconButton
        label="Rückgängig (Strg+Z)"
        size="sm"
        disabled={!editor.canUndo}
        onClick={() => editor.undo()}
      >
        <Undo2 />
      </IconButton>
      <IconButton
        label="Wiederholen (Strg+Y)"
        size="sm"
        disabled={!editor.canRedo}
        onClick={() => editor.redo()}
      >
        <Redo2 />
      </IconButton>
      {toolsOf(editor.caves).map((group, index) => (
        <div key={index} className="wf-erk-rail__group" role="group">
          {group.map((tool) => (
            <button
              key={tool}
              type="button"
              className="wf-erk-rail__tool"
              aria-pressed={editor.tool === tool}
              aria-label={`${TOOL_LABEL[tool]} (${TOOL_KEY[tool]})`}
              title={`${TOOL_LABEL[tool]} (${TOOL_KEY[tool]}) – ${TOOL_HINT[tool]}`}
              onClick={() => editor.setTool(tool)}
            >
              {TOOL_ICON[tool]}
              <kbd>{TOOL_KEY[tool]}</kbd>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Rechts neben der Karte, wenn ein Werkzeug gewählt ist: was es braucht. */
export function HexToolPanel({ editor }: { editor: HexEditor }) {
  const tool = editor.tool;
  return (
    <Panel
      title={TOOL_LABEL[tool]}
      actions={
        brushTool(tool) ? (
          <span className="wf-erk-size" role="group" aria-label="Pinselgröße">
            {[1, 2, 3, 4, 5].map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={editor.radius === size}
                title={
                  size === 1 ? 'Ein Feld' : `Bis ${size - 1} ${size === 2 ? 'Feld' : 'Felder'} weit`
                }
                onClick={() => editor.setRadius(size)}
              >
                {size}
              </button>
            ))}
          </span>
        ) : undefined
      }
    >
      <div className="wf-erk-toolpanel">
        {tool === 'terrain' && <KindPalette editor={editor} />}
        {tool === 'region' && <RegionTool editor={editor} />}
        {(tool === 'road' || tool === 'river') && <LineTool editor={editor} kind={tool} />}
        {tool === 'cells' && <SizeTool editor={editor} />}
        {tool === 'place' && <PlaceTool editor={editor} />}
        {tool === 'tunnel' && (
          <Select
            value={editor.passage}
            aria-label="Art des Gangs"
            onChange={(event) => editor.setPassageKind(event.target.value as PassageKind)}
          >
            {PASSAGE_KINDS.filter((kind) => kind !== 'drop').map((kind) => (
              <option key={kind} value={kind}>
                {PASSAGE_LABEL[kind]}
              </option>
            ))}
          </Select>
        )}
        <p className="wf-erk-tools__hint">{TOOL_HINT[tool]}</p>
      </div>
    </Panel>
  );
}

/**
 * Werkzeug „Gebiet“ (Rückmeldung 20. 11. 2026: „Gegend wählen ist ein komisches Ding … ein Hex
 * anwählen und dann über eine Suche oder dieses typische Artikel-erzeugen-Ding“): erst die Felder
 * wählen, dann den Ort der Welt suchen – oder an Ort und Stelle anlegen.
 */
function RegionTool({ editor }: { editor: HexEditor }) {
  const data = useData();
  const area = data.areas[editor.area.id] ?? editor.area;
  const keys = new Set(editor.regionSel.map(hexKey));
  const chosen = area.hexes.filter((hex) => keys.has(hexKey(hex)));
  const ids = [...new Set(chosen.map((hex) => hex.regionId).filter((id): id is string => !!id))];
  const common =
    ids.length === 1 && chosen.every((hex) => hex.regionId === ids[0]) ? ids[0]! : null;
  const region = common ? data.entities[common] : undefined;
  /** Welche Orte auf dieser Karte schon ein Gebiet haben – zum schnellen Wiederwählen. */
  const onMap = [
    ...new Set(area.hexes.map((hex) => hex.regionId).filter((id): id is string => !!id)),
  ]
    .map((id) => data.entities[id])
    .filter((entity) => !!entity);
  return (
    <div className="wf-erk-tools__region">
      <span className="wf-erk-tools__caption">
        {chosen.length === 0
          ? 'Noch kein Feld gewählt'
          : chosen.length === 1
            ? 'Ein Feld gewählt'
            : `${chosen.length} Felder gewählt`}
      </span>
      {chosen.length > 0 && (
        <>
          <EntityPicker
            value={common}
            onChange={(id) => editor.assignRegion(id)}
            kinds={['place']}
            create={{ onlyKinds: true }}
            placeholder="Gehört zu … (Ort suchen oder neu anlegen)"
          />
          {ids.length > 1 && (
            <em>
              Die Felder gehören zu verschiedenen Orten:{' '}
              {ids.map((id) => data.entities[id]?.name ?? '?').join(', ')}. Eine Wahl oben gilt für
              alle.
            </em>
          )}
          {region?.kind === 'place' && (
            <em>
              {region.place.ground || 'ohne Gelände-Wort'}
              {region.place.groundSlow ? ' · langsam' : ''}
            </em>
          )}
          <span className="wf-row" style={{ gap: 'var(--s-2)' }}>
            {ids.length > 0 && (
              <Button size="sm" onClick={() => editor.assignRegion(null)}>
                Zuordnung lösen
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => editor.setRegionSel([])}>
              Auswahl aufheben
            </Button>
          </span>
        </>
      )}
      {onMap.length > 0 && (
        <div className="wf-erk-palette__group">
          <span className="wf-erk-tools__caption">Gebiete auf dieser Karte</span>
          {onMap.map((entity) => (
            <button
              key={entity!.id}
              type="button"
              className="wf-erk-kind"
              title="Alle Felder dieses Gebiets wählen"
              onClick={() => editor.selectRegion(entity!.id)}
            >
              <span>{entity!.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Werkzeug „Weg“ und „Fluss“: Straße oder Pfad ist eine Wahl im selben Werkzeug; die gewählte
 * Linie bekommt einen Eintrag der Welt – gesucht oder an Ort und Stelle angelegt.
 */
function LineTool({ editor, kind }: { editor: HexEditor; kind: LineKind }) {
  const data = useData();
  const area = data.areas[editor.area.id] ?? editor.area;
  const sel = editor.lineSel;
  const keys = new Set((sel?.coords ?? []).map(hexKey));
  const run = area.hexes.filter((hex) => keys.has(hexKey(hex)) && hasLine(hex, kind));
  const entryId = lineEntityId(run, kind);
  const trail = run.length > 0 && run.every((hex) => hex.road === 'trail');
  const riverName = run.find((hex) => hex.river)?.river ?? '';
  return (
    <div className="wf-erk-tools__region">
      {kind === 'road' ? (
        <div className="wf-btn-group" role="group" aria-label="Art des Weges">
          {(['road', 'trail'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              aria-pressed={(run.length ? (trail ? 'trail' : 'road') : editor.roadKind) === value}
              onClick={() => {
                editor.setRoadKind(value);
                if (run.length) editor.patchLine({ road: value });
              }}
            >
              {value === 'road' ? 'Straße' : 'Pfad'}
            </Button>
          ))}
        </div>
      ) : (
        !run.length && (
          <Input
            value={editor.river}
            aria-label="Name eines neuen Flusses"
            placeholder="Name für einen neuen Fluss (kann leer bleiben)"
            onChange={(event) => editor.setRiver(event.target.value)}
          />
        )
      )}
      {run.length > 0 ? (
        <>
          <span className="wf-erk-tools__caption">
            {kind === 'road' ? (trail ? 'Gewählter Pfad' : 'Gewählte Straße') : 'Gewählter Fluss'} ·{' '}
            {run.length === 1 ? 'ein Feld' : `${run.length} Felder`}
          </span>
          <EntityPicker
            value={entryId}
            onChange={(id) => editor.setLineEntry(id)}
            kinds={['place']}
            create={{ onlyKinds: true }}
            placeholder={
              kind === 'road'
                ? 'Eintrag der Welt – suchen oder neu anlegen'
                : 'Eintrag der Welt – suchen oder neu anlegen'
            }
          />
          {kind === 'river' && !entryId && (
            <Input
              key={sel!.coords.length}
              defaultValue={riverName === 'Fluss' ? '' : riverName}
              aria-label="Name des Flusses"
              placeholder="Name des Flusses, ohne Eintrag"
              onBlur={(event) => {
                if ((event.target.value.trim() || 'Fluss') !== riverName)
                  editor.patchLine({ river: event.target.value });
              }}
            />
          )}
          <Button size="sm" onClick={() => editor.removeLine()}>
            {kind === 'road' ? 'Diesen Weg entfernen' : 'Diesen Fluss entfernen'}
          </Button>
        </>
      ) : (
        <span className="wf-erk-tools__caption">
          {kind === 'road' ? 'Kein Weg gewählt' : 'Kein Fluss gewählt'}
        </span>
      )}
    </div>
  );
}

/**
 * Werkzeug „Größe“ (Rückmeldung 20. 11. 2026: „Man sollte im Editor bestimmen können, wie groß man
 * die Karte macht“): wie weit der leere Rand reicht, und ein Handgriff, der ihn ganz füllt.
 */
function SizeTool({ editor }: { editor: HexEditor }) {
  const data = useData();
  const area = data.areas[editor.area.id] ?? editor.area;
  const extent = mapExtent(area);
  const label = editor.kind.startsWith('landscape:')
    ? (data.entities[editor.kind.slice('landscape:'.length)]?.name ?? 'Gelände')
    : (hexKind(editor.kind)?.label ?? 'Gelände');
  return (
    <div className="wf-erk-tools__region">
      <span className="wf-erk-tools__caption">
        Die Karte: {extent.cells} Felder · {extent.width} breit, {extent.height} hoch
      </span>
      {!editor.slots && <em>Diese Karte hat mehrere Ebenen – sie wächst noch nicht am Rand.</em>}
      <span className="wf-erk-tools__caption">Leerer Rand, so viele Felder weit</span>
      <span className="wf-erk-size" role="group" aria-label="Breite des leeren Randes">
        {[1, 2, 3, 4, 6, 8].map((rings) => (
          <button
            key={rings}
            type="button"
            aria-pressed={editor.rim === rings}
            onClick={() => editor.setRim(rings)}
          >
            {rings}
          </button>
        ))}
      </span>
      <Button
        size="sm"
        title="Alle leeren Felder am Rand werden Felder der Karte – mit dem Gelände des Pinsels"
        onClick={() => editor.growRim()}
      >
        Rand füllen mit „{label}“
      </Button>
    </div>
  );
}

/**
 * Was der Gelände-Pinsel malt: eine Landschaft deiner Welt (`landscape:<id>`) – oder eine
 * Geländeart. Gibt es eine Landschaft gleichen Namens wie die Art, malt der Pinsel sie; sonst ist
 * das Feld danach keine Landschaft mehr.
 */
export function brushPaint(data: CampaignData, key: string): HexPaint | null {
  if (key.startsWith('landscape:')) {
    const land = data.entities[key.slice('landscape:'.length)];
    return land?.kind === 'landscape' ? paintOfLandscape(land) : null;
  }
  const same = landscapeOfKind(data, key);
  if (same) return paintOfLandscape(same);
  const paint = paintOfKind(key);
  return paint ? { ...paint, landscapeId: null } : null;
}

const SWATCH_POINTS = '0,-0.55 0.48,-0.27 0.48,0.27 0,0.55 -0.48,0.27 -0.48,-0.27';

/**
 * Ein Feld im Kleinen: Farbe und Zeichen einer Geländeart – oder ihr gemalter Boden, wenn sie
 * unter der Erde einen eigenen hat (so sieht die Palette aus wie die Karte).
 */
export function KindSwatch({ kind }: { kind: string }) {
  const base = hexKind(kind)?.base;
  const land = LAND_GROUND[kind];
  const ground = CAVE_GROUND[kind] ?? land?.src;
  const clip = useId();
  return (
    <svg className="wf-kind-swatch" data-kind={kind} viewBox="-0.55 -0.6 1.1 1.2" aria-hidden>
      <polygon points={SWATCH_POINTS} />
      {ground ? (
        <>
          <clipPath id={clip}>
            <polygon points={SWATCH_POINTS} />
          </clipPath>
          <image
            href={ground}
            x={-0.6}
            y={-0.6}
            width={1.2}
            height={1.2}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clip})`}
          />
          {land && land.tint > 0 && (
            <polygon
              points={SWATCH_POINTS}
              opacity={land.tint}
              style={{ fill: `var(--terrain-${kind})` }}
            />
          )}
        </>
      ) : (
        <g className="wf-hex__glyph">{KIND_GLYPH[kind] ?? (base ? GLYPH[base] : null)}</g>
      )}
    </svg>
  );
}

/**
 * Die Palette des Gelände-Pinsels: Suche, zuletzt benutzt, die Landschaften deiner Welt und die
 * Geländearten nach Gruppen. Eine neue Landschaft entsteht hier, ohne die Karte zu verlassen
 * (Wunsch 17. 11.: „neues Gelände direkt aus der Palette – es wird zugleich Artikel“): Name genügt,
 * Gelände und Aussehen nimmt sie von der gewählten Geländeart; geschrieben wird sie später.
 */
/**
 * Welche Gruppen der Palette zugeklappt sind – gilt, solange die App läuft, je Kartenart (oben,
 * unter der Erde). Nur Ansicht, nie Spielstand.
 */
const foldedGroups: { surface: Set<string> | null; caves: Set<string> | null } = {
  surface: null,
  caves: null,
};

function KindPalette({ editor }: { editor: HexEditor }) {
  const db = useDb();
  const data = useData();
  const [query, setQuery] = useState('');
  const [naming, setNaming] = useState<string | null>(null);
  const groups = kindsByGroup(query, editor.caves ? 'underdark' : null);
  const memory = editor.caves ? 'caves' : 'surface';
  // Zu Beginn ist zugeklappt, was nicht zur Karte passt: unter der Erde die Oberwelt und umgekehrt.
  const [folded, setFoldedState] = useState<Set<string>>(() => {
    foldedGroups[memory] ??= new Set(
      (Object.keys(KIND_GROUP_LABEL) as string[]).filter(
        (group) => (group === 'underdark') !== editor.caves,
      ),
    );
    return foldedGroups[memory]!;
  });
  const toggleFold = (group: string) =>
    setFoldedState((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      foldedGroups[memory] = next;
      return next;
    });
  /** Beim Suchen ist alles offen – sonst fände man nichts. */
  const isOpen = (group: string) => !!query.trim() || !folded.has(group);
  const caption = (group: string, label: string, count: number) => (
    <button
      type="button"
      className="wf-erk-palette__fold"
      aria-expanded={isOpen(group)}
      onClick={() => toggleFold(group)}
    >
      {isOpen(group) ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
      <span>{label}</span>
      <span className="wf-erk-palette__count">{count}</span>
    </button>
  );
  const lands = landscapesOf(data).filter(
    (land) =>
      !query.trim() ||
      land.name.toLocaleLowerCase('de').includes(query.trim().toLocaleLowerCase('de')),
  );
  const button = (key: string) => {
    if (key.startsWith('landscape:')) {
      const land = data.entities[key.slice('landscape:'.length)];
      if (land?.kind !== 'landscape') return null;
      return (
        <button
          key={key}
          type="button"
          className="wf-erk-kind wf-erk-kind--land"
          aria-pressed={editor.kind === key}
          title={`${land.name} – Landschaft deiner Welt, zählt als ${TERRAIN_LABEL[land.landscape.base]}`}
          onClick={() => editor.setKind(key)}
        >
          <KindSwatch kind={landscapeLook(land)} />
          <span>{land.name}</span>
        </button>
      );
    }
    const kind = hexKind(key);
    if (!kind) return null;
    const same = landscapeOfKind(data, key);
    return (
      <button
        key={key}
        type="button"
        className="wf-erk-kind"
        aria-pressed={editor.kind === key}
        title={
          same
            ? `${kind.label} – malt deine Landschaft „${same.name}“`
            : `${kind.label} – zählt als ${TERRAIN_LABEL[kind.base]}`
        }
        onClick={() => editor.setKind(key)}
      >
        <KindSwatch kind={key} />
        <span>{kind.label}</span>
      </button>
    );
  };
  /** Legt eine Landschaft an – mit Gelände und Aussehen der gerade gewählten Geländeart. */
  const create = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    const result = addFromWriting(db, { name, kind: 'landscape' });
    setNaming(null);
    setQuery('');
    if (!result) return;
    if (!result.created) {
      if (result.entity.kind === 'landscape') editor.setKind(`landscape:${result.entity.id}`);
      toast({
        slot: 'hexkarte',
        title: result.otherKind ? `„${name}“ gibt es schon` : `„${name}“ ist schon eine Landschaft`,
        body: result.otherKind ? 'Als andere Kategorie – such dir einen anderen Namen.' : undefined,
      });
      return;
    }
    const from = editor.kind.startsWith('landscape:') ? undefined : hexKind(editor.kind);
    const land = db.getSnapshot().entities[result.entity.id];
    if (land?.kind === 'landscape' && from)
      db.put('entities', {
        ...land,
        landscape: {
          ...land.landscape,
          base: from.base,
          look: from.key === from.base ? null : from.key,
        },
      });
    editor.setKind(`landscape:${result.entity.id}`);
    toast({
      slot: 'hexkarte',
      title: `Landschaft „${name}“ angelegt`,
      body: 'Sie steht als Platzhalter in der Welt – schreib dort später, wer hier lebt.',
      action: { label: 'Rückgängig', run: result.undo },
    });
  };
  return (
    <div className="wf-erk-palette">
      <Input
        value={query}
        type="search"
        aria-label="Landschaft oder Geländeart suchen"
        placeholder="Landschaft oder Geländeart suchen …"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && query.trim() && !lands.length && !groups.length)
            create(query);
        }}
      />
      {!query && editor.recent.length > 1 && (
        <div className="wf-erk-palette__group">
          <span className="wf-erk-tools__caption">Zuletzt</span>
          <div className="wf-erk-palette__kinds">{editor.recent.map(button)}</div>
        </div>
      )}
      <div className="wf-erk-palette__group">
        {caption('lands', 'Landschaften deiner Welt', lands.length)}
        {isOpen('lands') && (
          <div className="wf-erk-palette__kinds">
            {lands.map((land) => button(`landscape:${land.id}`))}
          </div>
        )}
        {!isOpen('lands') ? null : naming === null ? (
          <button
            type="button"
            className="wf-erk-palette__new"
            onClick={() => setNaming(query.trim())}
            title="Eine Landschaft deiner Welt – sie wird zugleich ein Eintrag in der Welt"
          >
            {query.trim() && !lands.some((land) => land.name === query.trim())
              ? `+ „${query.trim()}“ als neue Landschaft`
              : '+ Neue Landschaft'}
          </button>
        ) : (
          <Input
            autoFocus
            value={naming}
            aria-label="Name der neuen Landschaft"
            placeholder="Name, z. B. Nebelwald – Eingabe legt an"
            onChange={(event) => setNaming(event.target.value)}
            onBlur={() => !naming.trim() && setNaming(null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') create(naming);
              if (event.key === 'Escape') setNaming(null);
            }}
          />
        )}
      </div>
      {groups.map(({ group, kinds }) => (
        <div key={group} className="wf-erk-palette__group">
          {caption(group, KIND_GROUP_LABEL[group], kinds.length)}
          {isOpen(group) && (
            <div className="wf-erk-palette__kinds">{kinds.map((kind) => button(kind.key))}</div>
          )}
        </div>
      ))}
      {groups.length === 0 && !lands.length && (
        <p className="wf-erk-tools__hint">
          Keine Geländeart mit diesem Wort – Eingabe legt „{query.trim()}“ als Landschaft an.
        </p>
      )}
    </div>
  );
}

export { hexKey };

/** Werkzeug „Ort“: Vorschläge aus den Gegenden von Start und Ziel, jeder Ort der Welt, Orte mit Lage. */
function PlaceTool({ editor }: { editor: HexEditor }) {
  const db = useDb();
  const data = useData();
  const area = editor.area;
  const suggestions = placeSuggestions(data, area);
  return (
    <span className="wf-erk-tools__region">
      <Select
        value={editor.placeId ?? ''}
        aria-label="Ort aus der Gegend"
        onChange={(event) => editor.setPlaceId(event.target.value || null)}
      >
        <option value="">{suggestions.length ? 'Ort aus der Gegend …' : 'Keine Vorschläge'}</option>
        {suggestions.map((place) => (
          <option key={place.id} value={place.id}>
            {place.name}
          </option>
        ))}
      </Select>
      <EntityPicker
        value={editor.placeId}
        onChange={editor.setPlaceId}
        kinds={['place']}
        placeholder="… oder jeder andere Ort"
      />
      <button
        type="button"
        className="wf-btn wf-btn--sm"
        title="Orte mit einer Lage in der Welt auf ihr Feld setzen"
        onClick={() => {
          const done = placeWorldPlaces(db, area.id);
          toast({
            slot: 'hexkarte',
            title: done?.added
              ? `${done.added} Orte aus der Welt gesetzt`
              : 'Keine weiteren Orte mit Lage',
            ...(done?.added ? { action: { label: 'Rückgängig', run: done.undo } } : {}),
          });
        }}
      >
        Orte aus der Welt
      </button>
    </span>
  );
}

/** Führt aus dem Feld unter einem Schacht nur der Schacht selbst hinaus? */
function lowerIsPocket(hexes: readonly Hex[], at: HexCoord): boolean {
  const below = hexes.find(
    (hex) => hex.q === at.q && hex.r === at.r && hex.level === (at.level ?? 0) + 1,
  );
  return !!below && (below.exits ?? []).every((exit) => exit.dir === 6);
}
