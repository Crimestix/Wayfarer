/**
 * Erkundung – Hexkarten zwischen zwei Orten: links die Karten, in der Mitte die Karte, rechts das
 * Feld. Zwei Ansichten (Wunsch des Spielleiters, 17. 11.): „Vorbereiten“ ist der Editor –
 * Werkzeuge links der Karte, alles sichtbar, rechts der Feld-Inspektor für ein oder mehrere Felder,
 * Strg+Z/Strg+Y; „Spielen“ zeigt die Reise mit Nebel, Felder nur zum Ansehen.
 */
import { kindLabelOf } from '../../domain/hexKinds';
import { natureOnHex } from '../../domain/nature';
import { NatureFold } from '../welt/NatureList';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import {
  Dices,
  Eye,
  EyeOff,
  Footprints,
  Hexagon,
  Minus,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { byName, entityName } from '../../domain/derive';
import { hexCenter, hexDistance, sameHex, type HexCoord } from '../../domain/hex';
import {
  DIR_DOWN,
  DIR_UP,
  PASSAGE_LABEL,
  across,
  indexHexes,
  isRock,
  levelCount,
  passagesFrom,
} from '../../domain/passages';
import { senseLine, sensesAt } from '../../domain/senses';
import { afarFrom, sightingLine } from '../../domain/afar';
import { PACES, type Area, type Hex } from '../../domain/schema';
import { PACE_LABEL, TERRAIN_LABEL, formatDays, travelDays } from '../../domain/terrain';
import { formatDuration } from '../../domain/time/calendar';
import {
  Button,
  EmptyState,
  EntityLink,
  IconButton,
  Panel,
  confirmDialog,
  cx,
  toast,
} from '../../ui';
import {
  placeParty,
  removeArea,
  rerollArea,
  setAllDiscovered,
  travelTo,
  searchHex,
  type TravelResult,
} from './actions';
import { CreateDialog } from './CreateDialog';
import { ZoomBack, ZoomButton } from './ZoomButton';
import { scaleWords } from './freeMap';
import { terrainShares } from './generate';
import { HexMap } from './HexMap';
import { HexToolPanel, HexToolRail, brushTool, toolOfKey, useHexEditor } from './HexEditor';
import { HexInspector } from './HexInspector';
import { toggleSelection } from './prep';
import { partyMeans } from '../../domain/mounts';
import {
  STEP_PROBLEM,
  hexMinutes,
  hexOfPlace,
  routeTo,
  searchMinutes,
  stepProblem,
} from './travel';
import { TravelPanel } from './TravelPanel';
import './erkundung.css';

/** Feldgrößen in Bildpunkten, von „ganze Karte im Blick“ bis „jedes Feld lesbar“. */
const SIZES = [9, 13, 18, 26, 36, 48, 64];

/**
 * Die größte Darstellung, bei der die ganze Karte in die Breite passt – in den Platz, den die
 * Kartenfläche wirklich hat (`room`); solange sie noch nicht gemessen ist, geschätzt aus der
 * Fensterbreite abzüglich Navigation, Liste und Feldansicht.
 */
function fitZoom(area: Area, room?: number): number {
  if (!area.hexes.length) return 4;
  const xs = area.hexes.map((hex) => hexCenter(hex, area.orientation).x);
  const units = Math.max(...xs) - Math.min(...xs) + 2.4;
  room ??= Math.max(320, window.innerWidth - 212 - (window.innerWidth <= 1500 ? 508 : 610) - 40);
  let best = 0;
  SIZES.forEach((size, i) => {
    if (units * size <= room) best = i;
  });
  return best;
}

const km = (n: number) => `${Math.round(n).toLocaleString('de-DE')} km`;

export default function ErkundungPage() {
  const data = useData();
  const { id } = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);
  const areas = useMemo(() => Object.values(data.areas).sort(byName), [data.areas]);
  const area = id ? data.areas[id] : areas[0];

  return (
    <div className="wf-erk">
      <aside className="wf-erk-side" aria-label="Hexkarten">
        <div className="wf-erk-side__head">
          <span className="wf-erk-side__title">Hexkarten</span>
          <Button size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
            Neu
          </Button>
        </div>
        <div className="wf-erk-side__list">
          {areas.length === 0 && (
            <p className="wf-erk-side__none">Hier stehen später deine Hexkarten.</p>
          )}
          {areas.map((a) => (
            <Link
              key={a.id}
              href={`/erkundung/${a.id}`}
              className="wf-erk-row"
              aria-current={a.id === area?.id ? 'page' : undefined}
            >
              <span className="wf-erk-row__name wf-clamp-1">{a.name}</span>
              <span className="wf-erk-row__sub wf-clamp-1">
                {[
                  a.distanceKm ? km(a.distanceKm) : '',
                  a.biome ? TERRAIN_LABEL[a.biome] : '',
                  `${a.hexes.length} Felder`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </Link>
          ))}
        </div>
      </aside>

      {area ? (
        <AreaView key={area.id} area={area} />
      ) : (
        <div className="wf-erk-empty">
          <EmptyState
            icon={<Hexagon />}
            title={id ? 'Diese Karte gibt es nicht mehr' : 'Noch keine Hexkarte'}
            action={
              <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                Hexkarte erzeugen
              </Button>
            }
          >
            Wähle zwei Orte – Wayfarer erkennt Entfernung und Landschaft aus deiner Welt und baut
            das Gelände dazwischen: zusammenhängend, mit Besonderheiten, und jedes Mal dasselbe,
            wenn die Gruppe zurückkehrt.
          </EmptyState>
        </div>
      )}

      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(areaId) => {
            setCreating(false);
            navigate(`/erkundung/${areaId}`);
          }}
        />
      )}
    </div>
  );
}

function AreaView({ area }: { area: Area }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const [zoom, setZoom] = useState(() => fitZoom(area));
  const [selected, setSelected] = useState<HexCoord | null>(null);
  // Die gezeigte Ebene folgt der Gruppe, wenn sie einen Schacht nimmt.
  const levels = levelCount(area.hexes);
  const [level, setLevel] = useState(() => area.party?.level ?? 0);
  const partyLevel = area.party?.level ?? null;
  useEffect(() => {
    if (partyLevel !== null) setLevel(partyLevel);
  }, [partyLevel]);
  const caves = area.hexes.some((h) => h.exits !== null);
  /** Vorbereiten (Editor) oder Spielen (Reise mit Nebel). Eine neue Karte beginnt beim Vorbereiten. */
  const [mode, setMode] = useState<'prep' | 'play'>(() => (area.party ? 'play' : 'prep'));
  const editing = mode === 'prep';
  // Die Karte füllt die Fläche, die sie hat: Beim Vorbereiten klappt die Liste weg, dann passt
  // sie größer. Wer selbst vergrößert oder verkleinert hat, behält seine Größe.
  const mapRef = useRef<HTMLDivElement>(null);
  const zoomedByHand = useRef(false);
  useLayoutEffect(() => {
    const width = mapRef.current?.clientWidth;
    if (!zoomedByHand.current && width) setZoom(fitZoom(area, width - 32));
    // Nur beim Wechsel der Ansicht neu einpassen – nicht bei jeder Änderung der Karte.
  }, [mode]);
  /** Die gewählten Felder beim Vorbereiten – eins oder mehrere. */
  const [picked, setPicked] = useState<HexCoord[]>([]);
  const editor = useHexEditor(area);
  // Tastenkürzel beim Vorbereiten: Strg+Z, Strg+Y (Strg+Umschalt+Z), Escape hebt die Auswahl auf.
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
        if (editor.undo()) event.preventDefault();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        (key === 'y' || (key === 'z' && event.shiftKey))
      ) {
        if (editor.redo()) event.preventDefault();
      } else if (key === 'escape') setPicked([]);
      else if (event.ctrlKey || event.metaKey || event.altKey) return;
      else if (key === ',' && brushTool(editor.tool))
        editor.setRadius(Math.max(1, editor.radius - 1));
      else if (key === '.' && brushTool(editor.tool))
        editor.setRadius(Math.min(5, editor.radius + 1));
      else {
        const tool = toolOfKey(key, editor.caves);
        if (tool) editor.setTool(tool);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, editor]);
  const size = SIZES[zoom]!;
  const hex = selected ? area.hexes.find((h) => sameHex(h, selected)) : undefined;
  const start = area.hexes.find((h) => h.placeId !== null && h.placeId === area.fromId);
  const shares = useMemo(() => terrainShares(area), [area]);
  const discovered = area.hexes.filter((h) => h.discovered).length;
  const features = area.hexes.filter((h) => h.feature).length;

  // Reise: der schnellste Weg zum Ziel der Karte und der letzte Schritt (zum Zurücknehmen).
  const goal = hexOfPlace(area, area.toId);
  const by = partyMeans(data);
  const route = useMemo(() => (goal ? routeTo(area, goal, by) : null), [area, goal, by]);
  const [last, setLast] = useState<TravelResult | null>(null);
  const move = (coord: HexCoord) => {
    const result = travelTo(db, area.id, coord);
    if (typeof result === 'string') {
      toast({ title: 'Dorthin geht es nicht', body: STEP_PROBLEM[result] });
      return;
    }
    setLast(result);
    setSelected(null);
  };
  const undoLast = () => {
    last?.undo();
    setLast(null);
  };
  /** Was ein Schritt auf das gewählte Feld kostet – oder warum er nicht geht. */
  const problem = hex ? stepProblem(area, hex, by) : null;
  const stepMinutes =
    hex && area.party && !problem ? hexMinutes(area.hexKm, hex.terrain, area.party.pace, by) : null;
  const partyHere = !!hex && !!area.party && sameHex(area.party, hex);
  // Schächte vom Feld der Gruppe aus: hinauf oder hinab.
  const shafts =
    partyHere && hex
      ? passagesFrom(indexHexes(area.hexes), hex).filter(
          (p) => p.dir === DIR_UP || p.dir === DIR_DOWN,
        )
      : [];
  const senses = partyHere && hex ? sensesAt(data, area, hex) : [];
  const far = partyHere && hex ? afarFrom(area, hex) : [];
  const searchTime = partyHere && hex ? searchMinutes(data, area, hex) : null;
  const search = () => {
    const result = searchHex(db, area.id);
    if (!result) return;
    setLast(null);
    toast({
      title: result.search.found ? 'Beim Durchsuchen gefunden' : 'Nichts gefunden',
      body: [
        `${formatDuration(result.search.minutes)} gesucht.`,
        result.search.found ?? '',
        ...result.search.encounters.map((e) => `Dabei: ${e.text}`),
      ]
        .filter(Boolean)
        .join(' '),
      action: { label: 'Rückgängig', run: result.undo },
    });
  };

  const reroll = async () => {
    const ok = await confirmDialog({
      title: 'Gelände neu würfeln?',
      body: 'Die Landschaft entsteht neu. Was du von Hand gemalt, gezogen, angefügt oder an Feldern eingetragen hast, bleibt.',
      confirmLabel: 'Neu würfeln',
    });
    if (!ok) return;
    const undo = rerollArea(db, area.id);
    setSelected(null);
    if (undo) toast({ title: 'Neu gewürfelt', action: { label: 'Rückgängig', run: undo } });
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `„${area.name}“ löschen?`,
      body: 'Die Karte mit allen Einträgen an den Feldern wird entfernt.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    const undo = removeArea(db, area.id);
    navigate('/erkundung');
    if (undo)
      toast({
        title: 'Karte gelöscht',
        body: area.name,
        action: {
          label: 'Rückgängig',
          run: () => {
            undo();
            navigate(`/erkundung/${area.id}`);
          },
        },
      });
  };

  return (
    <>
      <section className="wf-erk-stage">
        <header className="wf-erk-head">
          <div className="wf-erk-head__main">
            <input
              className="wf-erk-head__name"
              aria-label="Name der Karte"
              defaultValue={area.name}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== area.name) db.patch('areas', area.id, { name });
                else e.target.value = area.name;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
            <div className="wf-erk-head__facts">
              <ZoomBack area={area} />
              {area.fromId && area.toId && (
                <span>
                  <EntityLink id={area.fromId} icon={false} /> →{' '}
                  <EntityLink id={area.toId} icon={false} />
                </span>
              )}
              {area.distanceKm && <span>{km(area.distanceKm)}</span>}
              <span>{scaleWords(area.hexKm)}</span>
              {area.distanceKm && (
                <span
                  title={PACES.map(
                    (p) => `${PACE_LABEL[p]}: ${formatDays(travelDays(area.distanceKm!, p))}`,
                  ).join('\n')}
                >
                  zu Fuß etwa {formatDays(travelDays(area.distanceKm))}
                </span>
              )}
            </div>
          </div>
          <div className="wf-erk-head__tools">
            {levels > 1 && (
              <span className="wf-btn-group" role="group" aria-label="Ebene">
                {Array.from({ length: levels }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    className="wf-btn wf-btn--sm"
                    aria-pressed={level === i}
                    title={
                      i === 0
                        ? 'Die oberste Ebene: Start und Ziel'
                        : `${i} ${i === 1 ? 'Ebene' : 'Ebenen'} tiefer`
                    }
                    onClick={() => {
                      setLevel(i);
                      setSelected(null);
                    }}
                  >
                    Ebene {i + 1}
                    {area.party?.level === i ? ' ●' : ''}
                  </button>
                ))}
              </span>
            )}
            <IconButton
              label="Kleiner"
              size="sm"
              disabled={zoom === 0}
              onClick={() => {
                zoomedByHand.current = true;
                setZoom((z) => Math.max(0, z - 1));
              }}
            >
              <Minus />
            </IconButton>
            <IconButton
              label="Größer"
              size="sm"
              disabled={zoom === SIZES.length - 1}
              onClick={() => {
                zoomedByHand.current = true;
                setZoom((z) => Math.min(SIZES.length - 1, z + 1));
              }}
            >
              <Plus />
            </IconButton>
            <span className="wf-btn-group" role="group" aria-label="Ansicht">
              <button
                type="button"
                className="wf-btn wf-btn--sm"
                aria-pressed={editing}
                title="Der Editor: malen, ziehen, Felder füllen – alles sichtbar"
                onClick={() => {
                  setMode('prep');
                  setPicked(selected ? [selected] : []);
                }}
              >
                <Pencil aria-hidden /> Vorbereiten
              </button>
              <button
                type="button"
                className="wf-btn wf-btn--sm"
                aria-pressed={!editing}
                title="Die Reise am Tisch: Gruppe ziehen, Nebel über Unentdecktem"
                onClick={() => {
                  setMode('play');
                  setSelected(null);
                }}
              >
                <Play aria-hidden /> Spielen
              </button>
            </span>
            {area.seed !== null && (
              <Button
                size="sm"
                icon={<Dices />}
                onClick={reroll}
                title="Die Landschaft neu entstehen lassen"
              >
                Neu würfeln
              </Button>
            )}
            <IconButton label="Karte löschen" size="sm" variant="danger" onClick={remove}>
              <Trash2 />
            </IconButton>
          </div>
        </header>
        {editing ? (
          <div className="wf-erk-prep">
            <aside className="wf-erk-prep__rail" aria-label="Werkzeuge">
              <HexToolRail editor={editor} />
            </aside>
            <div className="wf-erk-map" ref={mapRef}>
              <HexMap
                area={area}
                data={data}
                size={size}
                selected={picked[0] ?? null}
                marked={picked}
                fog={false}
                onSelect={(coord, add) =>
                  setPicked((current) => (coord ? toggleSelection(current, coord, !!add) : []))
                }
                level={level}
                paint={editor.paint}
              />
            </div>
            <div className="wf-erk-prep__keys" aria-hidden>
              {editor.tool === 'select'
                ? 'Klick: ein Feld · Umschalt-Klick: mehrere · Escape: Auswahl aufheben · Strg+Z / Strg+Y'
                : editor.tool === 'terrain'
                  ? 'Mit gedrückter Maus malen · Strg-Klick: Gelände aufnehmen · „,“ und „.“: Pinselgröße · V: Auswählen'
                  : 'Mit gedrückter Maus ziehen · Strg+Z: zurück · V: Auswählen'}
            </div>
          </div>
        ) : (
          <div className="wf-erk-map" ref={mapRef}>
            <HexMap
              area={area}
              data={data}
              size={size}
              selected={selected}
              onSelect={setSelected}
              plan={route?.steps}
              level={level}
            />
          </div>
        )}
      </section>

      <aside className="wf-erk-detail">
        {editing && editor.tool !== 'select' ? (
          <HexToolPanel editor={editor} />
        ) : editing ? (
          <HexInspector area={area} selection={picked} editor={editor} onSelect={setPicked} />
        ) : (
          <>
            <TravelPanel area={area} route={route} last={last} onMove={move} onUndo={undoLast} />
            {hex ? (
              <Panel
                title={hex.placeId ? entityName(data, hex.placeId) : hex.feature || 'Feld'}
                actions={
                  <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                    Zur Übersicht
                  </Button>
                }
              >
                <div className="wf-col" style={{ gap: 'var(--s-3)' }}>
                  {partyHere ? (
                    <>
                      <p className="wf-erk-travel__here">
                        <Footprints aria-hidden /> Hier steht die Gruppe.
                      </p>
                      {shafts.map((shaft) => (
                        <Button
                          key={shaft.dir}
                          icon={<Footprints />}
                          onClick={() => move(across(hex, shaft.dir))}
                          title={PASSAGE_LABEL[shaft.kind]}
                        >
                          {shaft.dir === DIR_DOWN ? 'Hinab' : 'Hinauf'} – Ebene {shaft.to.level + 1}
                        </Button>
                      ))}
                      {senses.length > 0 && (
                        <div className="wf-erk-senses">
                          <span className="wf-caps">Ringsum</span>
                          {senses.map((sense) => (
                            <p key={sense.dir}>{senseLine(sense)}</p>
                          ))}
                        </div>
                      )}
                      {far.length > 0 && (
                        <div className="wf-erk-senses">
                          <span className="wf-caps">In der Ferne</span>
                          {far.map((sight) => (
                            <p key={`${sight.hex.q},${sight.hex.r}`}>{sightingLine(sight)}</p>
                          ))}
                        </div>
                      )}
                      {searchTime !== null && (
                        <Button
                          icon={<Search />}
                          onClick={search}
                          title="Die Gruppe sucht das Feld ab – es dauert so lange wie das Durchqueren, und einmal wird auf Begegnungen gewürfelt"
                        >
                          {hex.searched ? 'Noch einmal durchsuchen' : 'Durchsuchen'} ·{' '}
                          {formatDuration(searchTime)}
                        </Button>
                      )}
                    </>
                  ) : hex && isRock(hex) ? (
                    <p className="wf-erk-detail__where">Fels – hier führt kein Gang hindurch.</p>
                  ) : stepMinutes !== null ? (
                    <Button variant="primary" icon={<Footprints />} onClick={() => move(hex)}>
                      Hierher ziehen · {formatDuration(stepMinutes)}
                    </Button>
                  ) : (
                    <div className="wf-erk-travel__set">
                      {area.party && problem && problem !== 'no-party' && (
                        <span className="wf-erk-detail__where">{STEP_PROBLEM[problem]}</span>
                      )}
                      <Button
                        size="sm"
                        icon={<Footprints />}
                        onClick={() => {
                          placeParty(db, area.id, hex);
                          setLast(null);
                        }}
                        title="Stellt die Gruppe auf dieses Feld, ohne dass Zeit vergeht"
                      >
                        {area.party ? 'Gruppe hierher setzen' : 'Gruppe hier aufstellen'}
                      </Button>
                    </div>
                  )}
                  {start && (
                    <p className="wf-erk-detail__where">
                      {hexDistance(start, hex) === 0
                        ? 'Hier beginnt der Weg.'
                        : `${hexDistance(start, hex)} ${hexDistance(start, hex) === 1 ? 'Feld' : 'Felder'} vom Start · etwa ${km(hexDistance(start, hex) * area.hexKm)}`}
                    </p>
                  )}
                  <HexFacts hex={hex} />
                  <ZoomButton area={area} hex={hex} />
                  <Button
                    size="sm"
                    icon={<Pencil />}
                    onClick={() => {
                      setPicked([hex]);
                      setMode('prep');
                    }}
                    title="Dieses Feld in der Ansicht „Vorbereiten“ bearbeiten"
                  >
                    Feld vorbereiten
                  </Button>
                  <NatureFold spot={`feld:${area.id}`} hits={natureOnHex(data, area, hex)} />
                </div>
              </Panel>
            ) : (
              <Panel title="Die Karte">
                <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
                  <p className="wf-erk-detail__where">
                    {area.hexes.length} Felder, {features} mit einer Besonderheit. Klick auf ein
                    Feld, um es anzusehen oder zu ändern.
                  </p>
                  {caves && (
                    <p className="wf-erk-detail__where">
                      {levels > 1 ? `${levels} Ebenen. ` : ''}
                      Gänge sind hell gezeichnet, Höhlen als Kammer, Schächte als Dreieck.
                      Gepunktet: verborgen, blau: Wasser, gestrichelt: Kletterei.
                    </p>
                  )}
                  {!caves && (
                    <div className="wf-erk-legend">
                      {shares.map(({ terrain, count }) => (
                        <div key={terrain} className="wf-erk-legend__row">
                          <i data-terrain={terrain} />
                          <span>{TERRAIN_LABEL[terrain]}</span>
                          <em className="wf-num">
                            {Math.round((count / area.hexes.length) * 100)} %
                          </em>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="wf-erk-detail__found">
                    <span>
                      Entdeckt: <b className="wf-num">{discovered}</b> von {area.hexes.length}
                    </span>
                    <div className="wf-row" style={{ gap: 6 }}>
                      <Button
                        size="sm"
                        icon={<Eye />}
                        disabled={discovered === area.hexes.length}
                        onClick={() => setAllDiscovered(db, area.id, true)}
                      >
                        Alles aufdecken
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<EyeOff />}
                        disabled={discovered <= 1}
                        onClick={() => setAllDiscovered(db, area.id, false)}
                      >
                        Zudecken
                      </Button>
                    </div>
                  </div>
                  <div className={cx('wf-erk-key')}>
                    <span>
                      <i className="wf-erk-key__route" /> direkter Weg
                    </span>
                    <span>
                      <i className="wf-erk-key__feature" /> Besonderheit
                    </span>
                    <span>
                      <i className="wf-erk-key__note" /> eigener Eintrag
                    </span>
                  </div>
                </div>
              </Panel>
            )}
          </>
        )}
      </aside>
    </>
  );
}

/** Beim Spielen: was an einem Feld steht, nur zum Ansehen. */
function HexFacts({ hex }: { hex: Hex }) {
  const data = useData();
  const region = hex.regionId ? data.entities[hex.regionId] : undefined;
  const rows: [string, string][] = [
    ['Gelände', isRock(hex) ? 'Fels' : kindLabelOf(hex)],
    ['Gegend', region?.name ?? ''],
    ['Von fern', hex.exits === null ? hex.afar : ''],
    ['Von nebenan', hex.sign],
    ['Besonderheit', hex.feature],
    ['Was hier wartet', hex.prepared],
    ['Verborgen', hex.hidden ? `${hex.hidden}${hex.searched ? ' (gefunden)' : ''}` : ''],
    ['Notiz', hex.note],
  ];
  const shown = rows.filter(([, value]) => value.trim());
  return (
    <dl className="wf-erk-facts">
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
