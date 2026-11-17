/**
 * Hexkarten bearbeiten (Wunsch des Spielleiters, 17. 11.: „Wir müssen in der Vorbereitung
 * Hexkarten perfekt vorbereiten können“): Werkzeuge über der Karte – Gelände und eigene Gegenden
 * malen (mit Pinselgröße), Straßen, Pfade und Flüsse ziehen, radieren, Felder am Rand anfügen
 * oder wegnehmen. Jeder Strich lässt sich zurücknehmen; Neu würfeln behält, was von Hand gemacht ist.
 */
import { useRef, useState } from 'react';
import { Brush, Eraser, Grid2x2Plus, MapPinned, Route, Waves } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { hexDistance, hexKey, type HexCoord } from '../../domain/hex';
import { TERRAINS, type Area, type Hex, type Terrain } from '../../domain/schema';
import { TERRAIN_LABEL } from '../../domain/terrain';
import { EntityPicker, Input, Select, cx, toast } from '../../ui';
import { addHex, edgeSlots, paintHexes, removeHex, restoreHexes, type HexPaint } from './actions';

export type HexTool = 'terrain' | 'region' | 'road' | 'trail' | 'river' | 'erase' | 'cells';

const TOOL_LABEL: Record<HexTool, string> = {
  terrain: 'Gelände',
  region: 'Gegend',
  road: 'Straße',
  trail: 'Pfad',
  river: 'Fluss',
  erase: 'Radierer',
  cells: 'Felder',
};

const TOOL_HINT: Record<HexTool, string> = {
  terrain: 'Mit gedrückter Maus Gelände malen.',
  region:
    'Eine Gegend der Welt auf die Felder malen – ihr Gelände, Tempo und ihre Tabellen gelten dort.',
  road: 'Mit gedrückter Maus eine Straße ziehen: Reisen dort gehen im normalen Tempo.',
  trail: 'Einen Pfad ziehen.',
  river: 'Einen Fluss ziehen.',
  erase: 'Straße, Pfad, Fluss und Gegend von Feldern nehmen.',
  cells: 'Klick auf einen hellen Platz am Rand fügt ein Feld an; Klick auf ein Feld nimmt es weg.',
};

/** Die Felder unter dem Pinsel: das Feld selbst und bei größerem Pinsel die Nachbarn. */
const under = (area: Area, at: HexCoord, radius: number): HexCoord[] =>
  area.hexes.filter((hex) => hexDistance(hex, at) <= radius - 1).map(({ q, r }) => ({ q, r }));

export function useHexEditor(area: Area) {
  const db = useDb();
  const [tool, setTool] = useState<HexTool>('terrain');
  const [terrain, setTerrain] = useState<Terrain>('forest');
  const [regionId, setRegionId] = useState<string | null>(null);
  const [river, setRiver] = useState('Fluss');
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
      case 'cells':
        return null;
    }
  };
  const lineTool = tool === 'road' || tool === 'trail' || tool === 'river' || tool === 'erase';
  const apply = (at: HexCoord) => {
    const paint = change();
    if (!paint) return;
    const coords = under(area, at, lineTool && tool !== 'erase' ? 1 : radius);
    paintHexes(db, area.id, coords, paint);
    touched.current += coords.length;
  };
  const onStart = (at: HexCoord) => {
    if (tool === 'cells') {
      const fresh = db.getSnapshot().areas[area.id]?.hexes ?? area.hexes;
      if (removeHex(db, area.id, at))
        toast({
          slot: 'hexkarte',
          title: 'Feld weggenommen',
          action: { label: 'Rückgängig', run: () => restoreHexes(db, area.id, fresh) },
        });
      else
        toast({
          slot: 'hexkarte',
          title: 'Dieses Feld bleibt',
          body: 'Start, Ziel und das Feld der Gruppe lassen sich nicht wegnehmen.',
        });
      return;
    }
    before.current = db.getSnapshot().areas[area.id]?.hexes ?? area.hexes;
    touched.current = 0;
    apply(at);
  };
  const onMove = (at: HexCoord) => {
    if (before.current && tool !== 'cells') apply(at);
  };
  const onEnd = () => {
    const old = before.current;
    before.current = null;
    if (!old || !touched.current) return;
    toast({
      slot: 'hexkarte',
      title: `${TOOL_LABEL[tool]} gemalt`,
      action: { label: 'Rückgängig', run: () => restoreHexes(db, area.id, old) },
    });
  };
  const onSlot = (at: HexCoord) => {
    const old = db.getSnapshot().areas[area.id]?.hexes ?? area.hexes;
    if (addHex(db, area.id, at))
      toast({
        slot: 'hexkarte',
        title: 'Feld angefügt',
        action: { label: 'Rückgängig', run: () => restoreHexes(db, area.id, old) },
      });
  };
  return {
    tool,
    setTool,
    terrain,
    setTerrain,
    regionId,
    setRegionId,
    river,
    setRiver,
    radius,
    setRadius,
    paint: {
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

/** Die Werkzeugleiste über der Karte. */
export function HexToolbar({ editor }: { editor: HexEditor }) {
  const data = useData();
  const tools: { tool: HexTool; icon: React.ReactNode }[] = [
    { tool: 'terrain', icon: <Brush aria-hidden /> },
    { tool: 'region', icon: <MapPinned aria-hidden /> },
    { tool: 'road', icon: <Route aria-hidden /> },
    { tool: 'trail', icon: <Route aria-hidden /> },
    { tool: 'river', icon: <Waves aria-hidden /> },
    { tool: 'erase', icon: <Eraser aria-hidden /> },
    { tool: 'cells', icon: <Grid2x2Plus aria-hidden /> },
  ];
  const brush = editor.tool === 'terrain' || editor.tool === 'region' || editor.tool === 'erase';
  const region = editor.regionId ? data.entities[editor.regionId] : undefined;
  return (
    <div className="wf-erk-tools">
      <span className="wf-btn-group" role="group" aria-label="Werkzeug">
        {tools.map(({ tool, icon }) => (
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
      </span>
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
      <span className="wf-erk-tools__hint">{TOOL_HINT[editor.tool]}</span>
    </div>
  );
}

export { hexKey };
