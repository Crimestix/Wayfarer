/** Erkundung – Hexkarten zwischen zwei Orten: links die Karten, in der Mitte die Karte, rechts das Feld. */
import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { Dices, Eye, EyeOff, Footprints, Hexagon, Minus, Plus, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { byName, entityName } from '../../domain/derive';
import { hexCenter, hexDistance, type HexCoord } from '../../domain/hex';
import { PACES, TERRAINS, type Area, type Terrain } from '../../domain/schema';
import { PACE_LABEL, TERRAIN_LABEL, formatDays, travelDays } from '../../domain/terrain';
import { formatDuration } from '../../domain/time/calendar';
import {
  Button,
  Checkbox,
  EmptyState,
  EntityLink,
  EntityPicker,
  Field,
  IconButton,
  Input,
  Panel,
  Select,
  TextArea,
  confirmDialog,
  cx,
  toast,
} from '../../ui';
import {
  patchHex,
  placeParty,
  removeArea,
  rerollArea,
  setAllDiscovered,
  travelTo,
  type TravelResult,
} from './actions';
import { CreateDialog } from './CreateDialog';
import { terrainShares } from './generate';
import { HexMap } from './HexMap';
import { STEP_PROBLEM, hexMinutes, hexOfPlace, routeTo, stepProblem } from './travel';
import { TravelPanel } from './TravelPanel';
import './erkundung.css';

/** Feldgrößen in Bildpunkten, von „ganze Karte im Blick“ bis „jedes Feld lesbar“. */
const SIZES = [9, 13, 18, 26, 36, 48, 64];

/**
 * Die größte Darstellung, bei der die ganze Karte in die Breite passt – gerechnet aus der
 * Fensterbreite abzüglich Navigation, Liste und Feldansicht.
 */
function fitZoom(area: Area): number {
  if (!area.hexes.length) return 4;
  const xs = area.hexes.map((hex) => hexCenter(hex, area.orientation).x);
  const units = Math.max(...xs) - Math.min(...xs) + 2.4;
  const room = Math.max(
    320,
    window.innerWidth - 212 - (window.innerWidth <= 1500 ? 508 : 610) - 40,
  );
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
  const size = SIZES[zoom]!;
  const hex = selected
    ? area.hexes.find((h) => h.q === selected.q && h.r === selected.r)
    : undefined;
  const start = area.hexes.find((h) => h.placeId !== null && h.placeId === area.fromId);
  const shares = useMemo(() => terrainShares(area), [area]);
  const discovered = area.hexes.filter((h) => h.discovered).length;
  const features = area.hexes.filter((h) => h.feature).length;

  // Reise: der schnellste Weg zum Ziel der Karte und der letzte Schritt (zum Zurücknehmen).
  const goal = hexOfPlace(area, area.toId);
  const route = useMemo(() => (goal ? routeTo(area, goal) : null), [area, goal]);
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
  const problem = hex ? stepProblem(area, hex) : null;
  const stepMinutes =
    hex && area.party && !problem ? hexMinutes(area.hexKm, hex.terrain, area.party.pace) : null;
  const partyHere = !!hex && !!area.party && area.party.q === hex.q && area.party.r === hex.r;

  const reroll = async () => {
    const ok = await confirmDialog({
      title: 'Gelände neu würfeln?',
      body: 'Die Landschaft entsteht neu. Was du an einzelnen Feldern eingetragen oder aufgedeckt hast, geht dabei verloren.',
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
              {area.fromId && area.toId && (
                <span>
                  <EntityLink id={area.fromId} icon={false} /> →{' '}
                  <EntityLink id={area.toId} icon={false} />
                </span>
              )}
              {area.distanceKm && <span>{km(area.distanceKm)}</span>}
              <span>{area.hexKm} km je Feld</span>
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
            <IconButton
              label="Kleiner"
              size="sm"
              disabled={zoom === 0}
              onClick={() => setZoom((z) => Math.max(0, z - 1))}
            >
              <Minus />
            </IconButton>
            <IconButton
              label="Größer"
              size="sm"
              disabled={zoom === SIZES.length - 1}
              onClick={() => setZoom((z) => Math.min(SIZES.length - 1, z + 1))}
            >
              <Plus />
            </IconButton>
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
        <div className="wf-erk-map">
          <HexMap
            area={area}
            data={data}
            size={size}
            selected={selected}
            onSelect={setSelected}
            plan={route?.steps}
          />
        </div>
      </section>

      <aside className="wf-erk-detail">
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
                <p className="wf-erk-travel__here">
                  <Footprints aria-hidden /> Hier steht die Gruppe.
                </p>
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
              <Checkbox
                checked={hex.discovered}
                onChange={(discovered) => patchHex(db, area.id, hex, { discovered })}
              >
                Von der Gruppe entdeckt
              </Checkbox>
              <Field label="Gelände">
                <Select
                  value={hex.terrain ?? ''}
                  onChange={(e) =>
                    patchHex(db, area.id, hex, {
                      terrain: (e.target.value || null) as Terrain | null,
                    })
                  }
                >
                  {TERRAINS.map((t) => (
                    <option key={t} value={t}>
                      {TERRAIN_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Besonderheit" hint="Was die Landschaft hier auszeichnet.">
                <Input
                  key={`${hex.q},${hex.r},f`}
                  defaultValue={hex.feature}
                  onBlur={(e) => patchHex(db, area.id, hex, { feature: e.target.value.trim() })}
                />
              </Field>
              <Field label="Ort">
                <EntityPicker
                  value={hex.placeId}
                  onChange={(placeId) => patchHex(db, area.id, hex, { placeId })}
                  kinds={['place']}
                  placeholder="Kein Ort auf diesem Feld"
                />
              </Field>
              <Field
                label="Was hier wartet"
                hint="Vorbereitetes für den Moment, in dem die Gruppe das Feld betritt."
              >
                <TextArea
                  key={`${hex.q},${hex.r},p`}
                  defaultValue={hex.prepared}
                  onBlur={(e) => patchHex(db, area.id, hex, { prepared: e.target.value.trim() })}
                  style={{ minHeight: 64 }}
                />
              </Field>
              <Field label="Notiz">
                <TextArea
                  key={`${hex.q},${hex.r},n`}
                  defaultValue={hex.note}
                  onBlur={(e) => patchHex(db, area.id, hex, { note: e.target.value.trim() })}
                  style={{ minHeight: 64 }}
                />
              </Field>
            </div>
          </Panel>
        ) : (
          <Panel title="Die Karte">
            <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
              <p className="wf-erk-detail__where">
                {area.hexes.length} Felder, {features} mit einer Besonderheit. Klick auf ein Feld,
                um es anzusehen oder zu ändern.
              </p>
              <div className="wf-erk-legend">
                {shares.map(({ terrain, count }) => (
                  <div key={terrain} className="wf-erk-legend__row">
                    <i data-terrain={terrain} />
                    <span>{TERRAIN_LABEL[terrain]}</span>
                    <em className="wf-num">{Math.round((count / area.hexes.length) * 100)} %</em>
                  </div>
                ))}
              </div>
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
      </aside>
    </>
  );
}
