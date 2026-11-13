/**
 * Das Fraktionsnetz als Bild: Fraktionen als Siegel, Familien als Wappen, Personen als kleine
 * Siegel um ihre Fraktion, die Gruppe als Kompassrose – dazwischen Fäden nach Art und Haltung.
 * Verschieben, vergrößern, Siegel hinlegen (`useBoard`); Klick öffnet die Seite. Die Rechnung
 * steht in `domain/factionNet.ts`; hier wird nur gezeichnet.
 */
import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useLocation } from 'wouter';
import { LayoutGrid, Maximize, Minus, Network, Plus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { useMediaSrc } from '../../data/media';
import {
  NET_MODE_LABEL,
  factionNet,
  filterNet,
  netBounds,
  netCurve,
  netLabel,
  netMatches,
  netNeighbors,
  type NetEdge,
  type NetMode,
  type NetNode,
} from '../../domain/factionNet';
import { attitudeLabel, attitudeToken } from '../../domain/relations';
import { PARTY_ID } from '../../domain/schema';
import { useBoard } from '../../ui/board';
import { Button, EmptyState, IconButton, cx, entityHref, toast } from '../../ui';
import { openEntityDialog } from './editor';
import { placeInNet, tidyNet } from './netActions';
import { setNetView, useNetView } from './overview';

const MODES: NetMode[] = ['factions', 'people', 'feuds'];

/** Ab dieser Vergrößerung stehen die Namen der Personen da – vorher nur beim Darüberfahren. */
const PERSON_LABELS_FROM = 0.6;

/**
 * Bis zu dieser Verkleinerung bleibt die Schrift gleich groß auf dem Schirm – nie unter
 * `--text-2xs`, auch wenn „Alles zeigen“ ein großes Netz klein macht.
 */
const LABELS_FLOOR = 0.3;

type Moving = { id: string; dx: number; dy: number };

export function FactionNetView() {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const src = useMediaSrc();
  const { mode, hover: listHover, query } = useNetView();
  const full = useMemo(
    () => factionNet(data),
    // Das Netz hängt nur an Einträgen, Beziehungen und der Lage – nicht an der Weltzeit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.entities, data.relations, data.state.netBoard],
  );
  const net = useMemo(() => filterNet(full, mode), [full, mode]);
  const frame = useRef<HTMLDivElement>(null);
  const board = useBoard(frame);
  const [moving, setMoving] = useState<Moving | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);

  const showAll = () => board.fit(netBounds(full), 70);
  // Beim Öffnen liegt das ganze Netz im Bild.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => showAll(), []);

  /** Wo ein Knoten gerade liegt – beim Ziehen samt der Personen, die um ihn kreisen. */
  const at = (node: NetNode) =>
    moving && (node.id === moving.id || (node.orbit === moving.id && !node.placed))
      ? { x: node.x + moving.dx, y: node.y + moving.dy }
      : { x: node.x, y: node.y };
  const byId = useMemo(() => new Map(net.nodes.map((node) => [node.id, node])), [net]);

  const focus = hoverNode ?? listHover;
  const edgeLabel = hoverEdge ? net.edges.find((edge) => edge.key === hoverEdge) : undefined;
  // Über einem Faden leuchten seine zwei Enden, über einem Siegel seine Nachbarn.
  const near = useMemo(
    () =>
      edgeLabel ? new Set([edgeLabel.a, edgeLabel.b]) : focus ? netNeighbors(net, focus) : null,
    [net, focus, edgeLabel],
  );
  const found = useMemo(() => netMatches(net, query), [net, query]);
  const lit = (id: string) => (near ? near.has(id) : found.size ? found.has(id) : true);
  const k = board.view.k;
  // Schrift wächst beim Verkleinern mit, damit Namen lesbar bleiben.
  const grow = 1 / Math.min(1, Math.max(LABELS_FLOOR, k));

  const grab = (node: NetNode) => (event: PointerEvent) => {
    event.stopPropagation();
    board.drag(event, {
      onMove: (dx, dy) => setMoving({ id: node.id, dx, dy }),
      onEnd: (moved, dx, dy) => {
        setMoving(null);
        if (!moved) {
          navigate(
            node.kind === 'party' ? '/gruppe' : entityHref({ id: node.id, kind: node.kind }),
          );
          return;
        }
        // Alles, was nicht um eine Fraktion kreist, bleibt liegen, wo es ist – dazu das Gezogene.
        const spots: Record<string, { x: number; y: number }> = {};
        for (const other of full.nodes)
          if (!other.orbit || other.placed) spots[other.id] = { x: other.x, y: other.y };
        spots[node.id] = { x: node.x + dx, y: node.y + dy };
        placeInNet(db, spots);
      },
    });
  };
  const tidy = () => {
    const undo = tidyNet(db);
    requestAnimationFrame(() => showAll());
    toast({
      title: 'Netz aufgeräumt',
      body: 'Wayfarer hat alles neu ausgelegt.',
      action: { label: 'Rückgängig', run: undo },
    });
  };

  if (!full.nodes.some((node) => node.kind === 'faction' || node.kind === 'family'))
    return (
      <div className="wf-welt-net wf-welt-net--empty">
        <EmptyState
          icon={<Network />}
          title="Noch keine Fraktion"
          action={
            <Button
              icon={<Plus />}
              onClick={() => openEntityDialog({ mode: 'create', kind: 'faction' })}
            >
              Fraktion anlegen
            </Button>
          }
        >
          Das Netz zeigt Fraktionen und Familien, die Personen, die zu ihnen gehören, und wie sie
          zueinander und zur Gruppe stehen – aus den Beziehungen, die du einträgst.
        </EmptyState>
      </div>
    );

  // Beschriftet wird der Faden unter der Maus – beim Siegel genügt das Hervorheben der Nachbarn.
  const labelled: NetEdge[] = edgeLabel ? [edgeLabel] : [];

  return (
    <div
      ref={frame}
      className="wf-welt-net"
      data-focus={focus !== null || found.size > 0}
      onPointerDown={(event) => board.pan(event)}
    >
      <div className="wf-welt-net__layer" style={{ transform: board.transform }}>
        <svg className="wf-welt-net__svg" aria-hidden>
          <defs>
            <radialGradient id="wf-net-leather" cx="50%" cy="38%" r="70%">
              <stop offset="0%" style={{ stopColor: 'var(--bg-3)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--bg-0)' }} />
            </radialGradient>
            <radialGradient id="wf-net-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" style={{ stopColor: 'var(--gold)', stopOpacity: 0.22 }} />
              <stop offset="100%" style={{ stopColor: 'var(--gold)', stopOpacity: 0 }} />
            </radialGradient>
          </defs>
          <Astrolabe nodes={full.nodes} />
          <g className="wf-welt-net__edges">
            {net.edges.map((edge) => {
              const [a, b] = [byId.get(edge.a), byId.get(edge.b)];
              if (!a || !b) return null;
              const curve = netCurve(edge, { ...at(a), r: a.r }, { ...at(b), r: b.r });
              const active =
                hoverEdge === edge.key ||
                (!hoverEdge && focus !== null && (edge.a === focus || edge.b === focus));
              return (
                <g key={edge.key}>
                  <path
                    className="wf-welt-net__edge"
                    d={curve.d}
                    data-tone={edge.tone}
                    data-member={edge.member}
                    data-party={edge.party}
                    data-secret={edge.secret}
                    data-active={active || hoverEdge === edge.key}
                    data-dim={
                      ((focus !== null || hoverEdge !== null) && !active) ||
                      (found.size > 0 && !found.has(edge.a) && !found.has(edge.b))
                    }
                  />
                  {!edge.member && (
                    <path
                      className="wf-welt-net__hit"
                      d={curve.d}
                      onPointerEnter={() => setHoverEdge(edge.key)}
                      onPointerLeave={() => setHoverEdge(null)}
                    />
                  )}
                </g>
              );
            })}
          </g>
          {net.nodes.map((node) => (
            <Seal
              key={node.id}
              node={node}
              at={at(node)}
              image={node.image ? (src(node.image) ?? null) : null}
              dim={!lit(node.id)}
              marked={found.has(node.id)}
              hovered={focus === node.id}
              showName={
                node.kind !== 'person' ||
                node.leader ||
                k >= PERSON_LABELS_FROM ||
                (near?.has(node.id) ?? false) ||
                found.has(node.id)
              }
              grow={grow}
              onGrab={grab(node)}
              onEnter={() => setHoverNode(node.id)}
              onLeave={() => setHoverNode(null)}
            />
          ))}
        </svg>
        {labelled.map((edge) => {
          const [a, b] = [byId.get(edge.a), byId.get(edge.b)];
          if (!a || !b) return null;
          const { mid } = netCurve(edge, { ...at(a), r: a.r }, { ...at(b), r: b.r });
          return (
            <div
              key={edge.key}
              className="wf-welt-net__label"
              data-tone={edge.tone}
              style={{
                left: mid.x,
                top: mid.y,
                transform: `translate(-50%, -50%) scale(${1 / k})`,
              }}
            >
              {edge.lines.map((line) => (
                <span key={line}>{line}</span>
              ))}
              {edge.secret && <em>Die Gruppe weiß nichts davon</em>}
            </div>
          );
        })}
      </div>

      <div
        className="wf-welt-net__modes wf-btn-group"
        role="group"
        aria-label="Sicht des Netzes"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {MODES.map((entry) => (
          <Button
            key={entry}
            size="sm"
            aria-pressed={mode === entry}
            onClick={() => setNetView({ mode: entry })}
          >
            {NET_MODE_LABEL[entry]}
          </Button>
        ))}
      </div>
      <div className="wf-welt-net__tools" onPointerDown={(event) => event.stopPropagation()}>
        <IconButton label="Größer" size="sm" onClick={() => board.zoom(1.25)}>
          <Plus />
        </IconButton>
        <IconButton label="Kleiner" size="sm" onClick={() => board.zoom(0.8)}>
          <Minus />
        </IconButton>
        <IconButton label="Alles zeigen" size="sm" onClick={() => showAll()}>
          <Maximize />
        </IconButton>
        <IconButton
          label="Aufräumen – Wayfarer legt alles neu aus"
          size="sm"
          disabled={Object.keys(data.state.netBoard ?? {}).length === 0}
          onClick={tidy}
        >
          <LayoutGrid />
        </IconButton>
      </div>
      {mode === 'feuds' &&
        !net.edges.some((edge) => edge.tone === 'foe' || edge.tone === 'tense') && (
          <p className="wf-welt-net__note">
            Keine Feindschaft eingetragen. Verfeindet, Rivalität, Furcht oder eine feindselige
            Haltung stehen hier, sobald du sie bei einer Beziehung einträgst.
          </p>
        )}
    </div>
  );
}

/** Feine Ringe um die Gruppe – wie auf einem Astrolabium. Schmuck aus Linien, kein Bild. */
function Astrolabe({ nodes }: { nodes: NetNode[] }) {
  const party = nodes.find((node) => node.id === PARTY_ID);
  if (!party) return null;
  const far = Math.max(
    300,
    ...nodes.map((node) => Math.hypot(node.x - party.x, node.y - party.y) + node.r),
  );
  const rings = [0.33, 0.62, 0.92].map((part) => Math.round(far * part));
  return (
    <g className="wf-welt-net__astrolabe" transform={`translate(${party.x} ${party.y})`}>
      <circle r={party.r * 3} fill="url(#wf-net-glow)" stroke="none" />
      {rings.map((radius, index) => (
        <circle key={radius} r={radius} data-ring={index} />
      ))}
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index * Math.PI) / 6;
        const [inner, outer] = [rings[0]! - 8, rings[2]! + 14];
        return (
          <line
            key={index}
            x1={Math.cos(angle) * inner}
            y1={Math.sin(angle) * inner}
            x2={Math.cos(angle) * outer}
            y2={Math.sin(angle) * outer}
          />
        );
      })}
    </g>
  );
}

/** Ein Schild für Familien – oben gerade, unten spitz. */
function shieldPath(r: number): string {
  const w = r * 0.86;
  const top = -r * 0.92;
  return `M ${-w} ${top} L ${w} ${top} L ${w} ${r * 0.05} Q ${w} ${r * 0.62} 0 ${r} Q ${-w} ${r * 0.62} ${-w} ${r * 0.05} Z`;
}

/** Die Kompassrose der Gruppe: acht Spitzen, lange und kurze. */
function roseShape(r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 16; i++) {
    const angle = (i * Math.PI) / 8 - Math.PI / 2;
    const reach = i % 4 === 0 ? r : i % 2 === 0 ? r * 0.62 : r * 0.24;
    points.push(`${(Math.cos(angle) * reach).toFixed(1)},${(Math.sin(angle) * reach).toFixed(1)}`);
  }
  return points.join(' ');
}

function Seal({
  node,
  at,
  image,
  dim,
  marked,
  hovered,
  showName,
  grow,
  onGrab,
  onEnter,
  onLeave,
}: {
  node: NetNode;
  at: { x: number; y: number };
  image: string | null;
  dim: boolean;
  marked: boolean;
  hovered: boolean;
  showName: boolean;
  grow: number;
  onGrab: (event: PointerEvent) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const r = node.r;
  const clip = `wf-net-clip-${node.id}`;
  const title = [
    node.name,
    node.sub,
    node.leader ? 'führt die Fraktion' : '',
    node.attitude !== null ? `zur Gruppe: ${attitudeLabel(node.attitude)}` : '',
    node.more ? `${node.more} weitere Personen gehören dazu` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const nameSize = (node.kind === 'person' ? 13.5 : 17) * grow;
  const subSize = 12.5 * grow;
  const label = netLabel(node);
  const labelY = label.y;
  return (
    <g
      className={cx('wf-welt-net__node', `wf-welt-net__node--${node.kind}`)}
      transform={`translate(${at.x} ${at.y})`}
      data-dim={dim}
      data-marked={marked}
      data-hovered={hovered}
      data-leader={node.leader}
      onPointerDown={onGrab}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      role="link"
      aria-label={title}
    >
      <title>{title}</title>
      {(marked || hovered) && <circle className="wf-welt-net__halo" r={r + 10} />}
      {node.kind === 'party' ? (
        <>
          <circle className="wf-welt-net__disc" r={r} />
          <circle className="wf-welt-net__rim" r={r - 5} />
          <polygon className="wf-welt-net__rose" points={roseShape(r - 9)} />
          <circle className="wf-welt-net__hub" r={5} />
        </>
      ) : node.kind === 'family' ? (
        <>
          <path className="wf-welt-net__disc" d={shieldPath(r)} />
          {image ? (
            <>
              <clipPath id={clip}>
                <path d={shieldPath(r - 4)} />
              </clipPath>
              <image
                href={image}
                x={-r}
                y={-r}
                width={r * 2}
                height={r * 2}
                clipPath={`url(#${clip})`}
                preserveAspectRatio="xMidYMid slice"
              />
            </>
          ) : (
            <text
              className="wf-welt-net__mono"
              y={r * 0.02}
              fontSize={r * (node.monogram.length > 1 ? 0.56 : 0.72)}
            >
              {node.monogram}
            </text>
          )}
          <path className="wf-welt-net__rim" d={shieldPath(r - 5)} />
        </>
      ) : (
        <>
          {node.kind === 'faction' && <circle className="wf-welt-net__milled" r={r + 4} />}
          <circle className="wf-welt-net__disc" r={r} />
          {image ? (
            <>
              <clipPath id={clip}>
                <circle r={r - (node.kind === 'faction' ? 5 : 2)} />
              </clipPath>
              <image
                href={image}
                x={-r}
                y={-r}
                width={r * 2}
                height={r * 2}
                clipPath={`url(#${clip})`}
                preserveAspectRatio="xMidYMid slice"
              />
            </>
          ) : (
            <text
              className="wf-welt-net__mono"
              fontSize={
                r * (node.monogram.length > 1 ? (node.kind === 'person' ? 0.72 : 0.62) : 0.8)
              }
            >
              {node.monogram}
            </text>
          )}
          {node.kind === 'faction' && <circle className="wf-welt-net__rim" r={r - 6} />}
        </>
      )}
      {node.kind === 'person' && node.attitude !== null && (
        <circle
          className="wf-welt-net__pip"
          cx={r * 0.72}
          cy={-r * 0.72}
          r={4.5}
          style={{ fill: `var(${attitudeToken(node.attitude)})` }}
        />
      )}
      {showName && (
        <text
          className="wf-welt-net__name"
          x={label.x}
          y={label.y}
          fontSize={nameSize}
          textAnchor={label.anchor}
          dominantBaseline={label.baseline}
        >
          {node.name}
        </text>
      )}
      {showName && node.kind !== 'person' && (node.sub || node.more > 0) && (
        <text className="wf-welt-net__sub" y={labelY + nameSize + 2} fontSize={subSize}>
          {[node.sub, node.more ? `+${node.more} weitere` : ''].filter(Boolean).join(' · ')}
        </text>
      )}
    </g>
  );
}
