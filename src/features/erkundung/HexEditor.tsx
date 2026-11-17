/**
 * Hexkarten bearbeiten (Wunsch des Spielleiters, 17. 11.: „Wir müssen in der Vorbereitung
 * Hexkarten perfekt vorbereiten können“ – „Wir brauchen ne richtige Editor-Ansicht“): die
 * Werkzeugleiste links der Karte in der Ansicht „Vorbereiten“ – Auswählen, Gelände und eigene
 * Gegenden malen (mit Pinselgröße), Straßen, Pfade und Flüsse ziehen, radieren, Felder am Rand
 * anfügen oder wegnehmen, unter der Erde Gänge, Fels und Schächte. Jeder Schritt lässt sich mit
 * Strg+Z zurücknehmen und mit Strg+Y wiederholen (`prep.ts`); Neu würfeln behält, was von Hand
 * gemacht ist.
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  Brush,
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
  TERRAINS,
  type Area,
  type Hex,
  type PassageKind,
  type Terrain,
} from '../../domain/schema';
import { TERRAIN_LABEL } from '../../domain/terrain';
import { EntityPicker, IconButton, Input, Select, cx, toast } from '../../ui';
import { EMPTY_HISTORY, recordStep, redoHistory, undoHistory, type HexHistory } from './prep';
import {
  addHex,
  digBetween,
  edgeSlots,
  fillRock,
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
  | 'trail'
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
  region: 'Gegend',
  road: 'Straße',
  trail: 'Pfad',
  river: 'Fluss',
  place: 'Ort',
  erase: 'Radierer',
  cells: 'Felder',
};

const TOOL_HINT: Record<HexTool, string> = {
  select:
    'Klick wählt ein Feld, Umschalt- oder Strg-Klick nimmt weitere dazu. Rechts steht, was dort ist.',
  tunnel:
    'Mit gedrückter Maus von Feld zu Feld einen Gang ziehen – die Seiten dazwischen gehen auf.',
  rock: 'Felder zu Fels machen: kein Ausgang mehr, auch nicht von den Nachbarn.',
  shaft: 'Klick auf ein Feld: Schacht hinab zur Ebene darunter öffnen oder schließen.',
  terrain: 'Mit gedrückter Maus Gelände malen.',
  region:
    'Eine Gegend der Welt auf die Felder malen – ihr Gelände, Tempo und ihre Tabellen gelten dort.',
  road: 'Mit gedrückter Maus eine Straße ziehen: Reisen dort gehen im normalen Tempo.',
  trail: 'Einen Pfad ziehen.',
  river: 'Einen Fluss ziehen – ohne Straße oder Brücke muss die Gruppe ihn überqueren.',
  place: 'Einen Ort der Welt auf ein Feld setzen: wählen, dann aufs Feld klicken.',
  erase: 'Straße, Pfad, Fluss und Gegend von Feldern nehmen.',
  cells: 'Klick auf einen hellen Platz am Rand fügt ein Feld an; Klick auf ein Feld nimmt es weg.',
};

/** Was nach einem Strich in der Meldung steht. */
const DONE_LABEL: Partial<Record<HexTool, string>> = {
  tunnel: 'Gang gezogen',
  rock: 'Fels gesetzt',
  road: 'Straße gezogen',
  trail: 'Pfad gezogen',
  river: 'Fluss gezogen',
  erase: 'Radiert',
};

/** Die Felder unter dem Pinsel: das Feld selbst und bei größerem Pinsel die Nachbarn. */
const under = (area: Area, at: HexCoord, radius: number): HexCoord[] =>
  area.hexes
    .filter((hex) => hex.level === (at.level ?? 0) && hexDistance(hex, at) <= radius - 1)
    .map(({ q, r, level }) => ({ q, r, level }));

export function useHexEditor(area: Area) {
  const db = useDb();
  const caves = area.hexes.some((hex) => hex.exits !== null);
  const [tool, setTool] = useState<HexTool>('select');
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
  /** Das Feld, an dem der Gang gerade angekommen ist. */
  const lastCell = useRef<HexCoord | null>(null);
  const [terrain, setTerrain] = useState<Terrain>('forest');
  const [regionId, setRegionId] = useState<string | null>(null);
  const [river, setRiver] = useState('Fluss');
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [radius, setRadius] = useState(1);
  /** Der Stand der Felder vor dem laufenden Strich – zum Zurücknehmen. */
  const before = useRef<Hex[] | null>(null);
  const touched = useRef(0);

  const change = (): HexPaint | null => {
    switch (tool) {
      case 'terrain':
        return { terrain };
      case 'region':
        return { regionId };
      case 'road':
        return { road: 'road' };
      case 'trail':
        return { road: 'trail' };
      case 'river':
        return { river: river.trim() || 'Fluss' };
      case 'erase':
        return { road: 'none', river: '', regionId: null };
      case 'select':
      case 'cells':
      case 'place':
      case 'tunnel':
      case 'rock':
      case 'shaft':
        return null;
    }
  };
  const lineTool = tool === 'road' || tool === 'trail' || tool === 'river' || tool === 'erase';
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
    const paint = change();
    if (!paint) return;
    const coords = under(area, at, lineTool && tool !== 'erase' ? 1 : radius);
    paintHexes(db, area.id, coords, paint);
    touched.current += coords.length;
  };
  const onStart = (at: HexCoord) => {
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
    before.current = db.getSnapshot().areas[area.id]?.hexes ?? area.hexes;
    touched.current = 0;
    lastCell.current = null;
    apply(at);
  };
  const onMove = (at: HexCoord) => {
    if (before.current && tool !== 'cells') apply(at);
  };
  const onEnd = () => {
    const old = before.current;
    before.current = null;
    lastCell.current = null;
    if (!old || !touched.current) return;
    record(old);
    toast({
      slot: 'hexkarte',
      title: DONE_LABEL[tool] ?? `${TOOL_LABEL[tool]} gemalt`,
      action: { label: 'Rückgängig', run: () => restoreHexes(db, area.id, old) },
    });
  };
  const onSlot = (at: HexCoord) => {
    const old = db.getSnapshot().areas[area.id]?.hexes ?? area.hexes;
    if (addHex(db, area.id, at)) {
      record(old);
      toast({
        slot: 'hexkarte',
        title: 'Feld angefügt',
        action: { label: 'Rückgängig', run: () => restoreHexes(db, area.id, old) },
      });
    }
  };
  return {
    area,
    caves,
    tool,
    setTool,
    passage,
    setPassageKind,
    terrain,
    setTerrain,
    regionId,
    setRegionId,
    river,
    setRiver,
    placeId,
    setPlaceId,
    radius,
    setRadius,
    record,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    paint:
      tool === 'select'
        ? undefined
        : {
            onStart,
            onMove,
            onEnd,
            onSlot,
            slots: tool === 'cells' ? edgeSlots(area) : undefined,
            regionId: tool === 'region' ? regionId : null,
          },
  };
}

export type HexEditor = ReturnType<typeof useHexEditor>;

/** Die Werkzeugleiste links der Karte (Ansicht „Vorbereiten“), in Gruppen. */
export function HexToolbar({ editor }: { editor: HexEditor }) {
  const data = useData();
  const groups: { title: string; tools: { tool: HexTool; icon: ReactNode }[] }[] = editor.caves
    ? [
        { title: 'Ansehen', tools: [{ tool: 'select', icon: <MousePointer2 aria-hidden /> }] },
        {
          title: 'Gänge',
          tools: [
            { tool: 'tunnel', icon: <Spline aria-hidden /> },
            { tool: 'rock', icon: <Mountain aria-hidden /> },
            { tool: 'shaft', icon: <ArrowDownToLine aria-hidden /> },
          ],
        },
        {
          title: 'Welt',
          tools: [
            { tool: 'region', icon: <MapPinned aria-hidden /> },
            { tool: 'place', icon: <MapPin aria-hidden /> },
          ],
        },
      ]
    : [
        { title: 'Ansehen', tools: [{ tool: 'select', icon: <MousePointer2 aria-hidden /> }] },
        {
          title: 'Malen',
          tools: [
            { tool: 'terrain', icon: <Brush aria-hidden /> },
            { tool: 'region', icon: <MapPinned aria-hidden /> },
          ],
        },
        {
          title: 'Linien',
          tools: [
            { tool: 'road', icon: <Route aria-hidden /> },
            { tool: 'trail', icon: <Route aria-hidden /> },
            { tool: 'river', icon: <Waves aria-hidden /> },
            { tool: 'erase', icon: <Eraser aria-hidden /> },
          ],
        },
        {
          title: 'Welt und Rand',
          tools: [
            { tool: 'place', icon: <MapPin aria-hidden /> },
            { tool: 'cells', icon: <Grid2x2Plus aria-hidden /> },
          ],
        },
      ];
  const brush = editor.tool === 'terrain' || editor.tool === 'region' || editor.tool === 'erase';
  const region = editor.regionId ? data.entities[editor.regionId] : undefined;
  return (
    <div className="wf-erk-tools">
      <div className="wf-erk-tools__history">
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
      </div>
      {groups.map((group) => (
        <div key={group.title} className="wf-erk-tools__group">
          <span className="wf-erk-tools__caption">{group.title}</span>
          <div className="wf-erk-tools__buttons" role="group" aria-label={group.title}>
            {group.tools.map(({ tool, icon }) => (
              <button
                key={tool}
                type="button"
                className={cx('wf-btn wf-btn--sm')}
                aria-pressed={editor.tool === tool}
                title={TOOL_HINT[tool]}
                onClick={() => editor.setTool(tool)}
              >
                {icon}
                {TOOL_LABEL[tool]}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="wf-erk-tools__options">
        {editor.tool === 'terrain' && (
          <Select
            value={editor.terrain}
            aria-label="Gelände zum Malen"
            onChange={(event) => editor.setTerrain(event.target.value as Terrain)}
          >
            {TERRAINS.map((terrain) => (
              <option key={terrain} value={terrain}>
                {TERRAIN_LABEL[terrain]}
              </option>
            ))}
          </Select>
        )}
        {editor.tool === 'region' && (
          <span className="wf-erk-tools__region">
            <EntityPicker
              value={editor.regionId}
              onChange={editor.setRegionId}
              kinds={['place']}
              placeholder="Gegend wählen – leer nimmt sie weg"
            />
            {region?.kind === 'place' && (
              <em>
                {region.place.ground || 'ohne Gelände-Wort'}
                {region.place.groundSlow ? ' · langsam' : ''}
              </em>
            )}
          </span>
        )}
        {editor.tool === 'place' && <PlaceTool editor={editor} />}
        {editor.tool === 'tunnel' && (
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
        {editor.tool === 'river' && (
          <Input
            value={editor.river}
            aria-label="Name des Flusses"
            placeholder="Name des Flusses"
            onChange={(event) => editor.setRiver(event.target.value)}
          />
        )}
        {brush && (
          <span className="wf-btn-group" role="group" aria-label="Pinselgröße">
            {[1, 2, 3].map((size) => (
              <button
                key={size}
                type="button"
                className="wf-btn wf-btn--sm"
                aria-pressed={editor.radius === size}
                title={size === 1 ? 'Ein Feld' : `Mit Nachbarn (${size === 2 ? '7' : '19'} Felder)`}
                onClick={() => editor.setRadius(size)}
              >
                {size === 1 ? '·' : size === 2 ? '●' : '⬤'}
              </button>
            ))}
          </span>
        )}
      </div>
      <p className="wf-erk-tools__hint">{TOOL_HINT[editor.tool]}</p>
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
