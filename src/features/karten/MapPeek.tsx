/**
 * Eine gezeichnete Karte zum Ansehen – am Spieltisch. Sie zeigt, wo die Gruppe steht; ein Klick
 * auf einen Ort nennt den Weg dorthin und lässt die Gruppe aufbrechen. Gezeichnet wird hier nicht.
 */
import { useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { BookOpen, Footprints, Maximize2, Minus, Plus } from 'lucide-react';
import { useData } from '../../data/hooks';
import { GROUNDS, markerOfPlace } from '../../domain/mapDraw';
import type { GameMap } from '../../domain/schema';
import { openMoveParty } from '../../shell/commands';
import { Button, IconButton, cx, entityHref } from '../../ui';
import { LineSummary } from './Facts';
import { groundFacts, lineFacts, pickAt, routeText, type Picked, type View } from './model';
import { useMapStage } from './useMapStage';
import './karten.css';

export function MapPeek({
  map,
  onLeave,
}: {
  map: GameMap;
  /** Wird gerufen, bevor ein Klick von der Karte wegführt – etwa um einen Dialog zu schließen. */
  onLeave?: () => void;
}) {
  const data = useData();
  const [, navigate] = useLocation();
  const [selection, setSelection] = useState<Picked | null>(null);
  /** Die Angaben weichen dem Gewählten aus: liegt es links, stehen sie rechts. */
  const [cardRight, setCardRight] = useState(false);
  const gesture = useRef<{ x: number; y: number; moved: boolean; from: View } | null>(null);

  const partyPlaceId = data.state.placeId;
  const here = useMemo(() => markerOfPlace(data, map, partyPlaceId), [data, map, partyPlaceId]);
  const { stage, canvas, view, size, paint, local, zoomBy, fit, panFrom } = useMapStage(
    map,
    () => ({
      draft: null,
      brush: null,
      selected: selection && selection.kind !== 'ground' ? selection.id : null,
      here: here?.id ?? null,
    }),
  );

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view.current) return;
    const [x, y] = local(event);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Ohne Zeigerfang geht es auch – dann endet das Ziehen am Rand der Karte.
    }
    gesture.current = { x, y, moved: false, from: view.current };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const active = gesture.current;
    if (!active) return;
    const [x, y] = local(event);
    if (Math.hypot(x - active.x, y - active.y) > 4) active.moved = true;
    if (!active.moved) return;
    panFrom(active.from, x - active.x, y - active.y);
    paint();
  };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const active = gesture.current;
    gesture.current = null;
    if (!active || active.moved || event.button !== 0 || !view.current) return;
    const [x, y] = local(event);
    const current = view.current;
    const at: [number, number] = [current.x + x / current.zoom, current.y + y / current.zoom];
    setCardRight(x < size.current.width / 2);
    setSelection(pickAt(map, at, current.zoom));
  };

  const leave = (href: string) => {
    onLeave?.();
    navigate(href);
  };

  return (
    <div className="wf-karten-peek">
      <div className="wf-karten-peek__bar">
        {here && (
          <span className="wf-karten-peek__here">
            <i aria-hidden />
            Hier ist die Gruppe
          </span>
        )}
        <span className="wf-karten-peek__hint">
          Ziehen verschiebt die Karte, das Mausrad vergrößert. Ein Klick zeigt, was dort ist.
        </span>
      </div>
      <div className="wf-karten-stage wf-karten-peek__stage" ref={stage}>
        <canvas
          ref={canvas}
          className="wf-karten-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            gesture.current = null;
          }}
          onContextMenu={(event) => event.preventDefault()}
        />
        <div className="wf-karten-zoom">
          <IconButton size="sm" label="Vergrößern" onClick={() => zoomBy(1.5)}>
            <Plus aria-hidden />
          </IconButton>
          <IconButton size="sm" label="Verkleinern" onClick={() => zoomBy(1 / 1.5)}>
            <Minus aria-hidden />
          </IconButton>
          <IconButton size="sm" label="Die ganze Karte zeigen" onClick={fit}>
            <Maximize2 aria-hidden />
          </IconButton>
        </div>
        {selection && (
          <PeekCard
            map={map}
            selection={selection}
            right={cardRight}
            hereId={here?.id ?? null}
            onOpen={leave}
            onMove={(placeId) => {
              onLeave?.();
              openMoveParty({ placeId });
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Was das Angeklickte ist – und bei einem Ort: wie die Gruppe hinkommt. */
function PeekCard({
  map,
  selection,
  right,
  hereId,
  onOpen,
  onMove,
}: {
  map: GameMap;
  selection: Picked;
  right: boolean;
  hereId: string | null;
  onOpen: (href: string) => void;
  onMove: (placeId: string) => void;
}) {
  const data = useData();
  const box = cx('wf-karten-card', right && 'wf-karten-card--right');

  if (selection.kind === 'ground') {
    const facts = groundFacts(map, selection.at[0], selection.at[1]);
    return (
      <div className={box}>
        <div className="wf-karten-card__sort">Gelände</div>
        <div className="wf-karten-card__name">{GROUNDS[facts.ground].label}</div>
        <p>{facts.note}</p>
      </div>
    );
  }

  if (selection.kind === 'line') {
    const line = map.lines.find((entry) => entry.id === selection.id);
    if (!line) return null;
    const facts = lineFacts(data, map, line);
    return (
      <div className={box}>
        <div className="wf-karten-card__sort">{facts.sort}</div>
        {line.name && <div className="wf-karten-card__name">{line.name}</div>}
        <LineSummary facts={facts} kind={line.kind} />
        {facts.way && (
          <p>
            Weg zwischen {facts.way.from} und {facts.way.to}.
          </p>
        )}
      </div>
    );
  }

  const marker = map.markers.find((entry) => entry.id === selection.id);
  if (!marker) return null;
  const entity = marker.entityId ? data.entities[marker.entityId] : undefined;
  const isHere = marker.id === hereId;
  const route =
    entity?.kind === 'place' && !isHere ? routeText(data, data.state.placeId, entity.id) : null;
  return (
    <div className={box}>
      <div className="wf-karten-card__sort">
        {isHere ? 'Hier ist die Gruppe' : entity ? 'Ort der Welt' : 'Punkt auf der Karte'}
      </div>
      <div className="wf-karten-card__name">{entity?.name ?? (marker.label || 'Ohne Namen')}</div>
      {entity?.kind === 'place' &&
        !isHere &&
        (route ? (
          <dl className="wf-karten-card__facts">
            <dt>Zu Fuß von hier</dt>
            <dd>{route}</dd>
          </dl>
        ) : (
          <p className="wf-mute">
            {data.state.placeId
              ? 'Von hier ist kein Weg dorthin bekannt.'
              : 'Der Aufenthaltsort der Gruppe ist offen.'}
          </p>
        ))}
      {entity && (
        <div className="wf-karten-card__acts">
          <Button
            size="sm"
            variant="ghost"
            icon={<BookOpen aria-hidden />}
            onClick={() => onOpen(entityHref(entity))}
          >
            Eintrag öffnen
          </Button>
          {entity.kind === 'place' && !isHere && (
            <Button size="sm" icon={<Footprints aria-hidden />} onClick={() => onMove(entity.id)}>
              Hierher ziehen …
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
