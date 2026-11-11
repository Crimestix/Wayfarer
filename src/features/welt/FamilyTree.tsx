/**
 * Der Stammbaum einer Familie nach Art eines Genogramms: Quadrat für Männer, Kreis für Frauen,
 * Raute für Unbekannt; ein Kreuz für Verstorbene; eine Linie unter jedem Paar, von der die Kinder
 * abgehen. Die Anordnung rechnet `domain/kinTree.ts`; hier wird nur gezeichnet.
 */
import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { GitFork } from 'lucide-react';
import { useData } from '../../data/hooks';
import { useMediaSrc } from '../../data/media';
import { kinSuggestions } from '../../domain/kin';
import { TREE, familyTree } from '../../domain/kinTree';
import type { Entity } from '../../domain/schema';
import { EmptyState, EntityLink, cx, entityHref } from '../../ui';
import { KinSuggestions } from './KinSuggestions';

const line = (points: [number, number][]) => points.map((p) => p.join(',')).join(' ');

/** „Schmied“ oder „Hauptmann der Wache“ – was unter dem Namen steht. */
const subline = (entity: Entity): string =>
  entity.kind === 'person' ? entity.person.role || entity.tagline : entity.tagline;

const isDead = (entity: Entity): boolean =>
  entity.kind === 'person' && entity.person.status === 'dead';

const SHAPE = { f: 'circle', m: 'square' } as const;

export function FamilyTree({ family }: { family: Entity }) {
  const data = useData();
  const [, navigate] = useLocation();
  const src = useMediaSrc();
  const tree = useMemo(() => familyTree(data, family.id), [data, family.id]);
  const suggestions = useMemo(() => {
    const shown = new Set(tree.nodes.map((node) => node.id));
    return kinSuggestions(data).filter((s) => shown.has(s.fromId) || shown.has(s.toId));
  }, [data, tree]);

  if (!tree.nodes.length)
    return (
      <EmptyState icon={<GitFork />} title="Noch kein Stammbaum">
        {tree.loose.length
          ? `${family.name} hat ${tree.loose.length === 1 ? 'ein Mitglied' : `${tree.loose.length} Mitglieder`}, aber noch ist keine Verwandtschaft eingetragen. Öffne eine Person und trage unter „Beziehungen“ ein, wessen Mutter, Bruder oder Tante sie ist – der Baum entsteht daraus von selbst.`
          : `Zu ${family.name} gehört noch niemand. Ordne Personen der Familie zu und trage bei ihnen ein, wie sie miteinander verwandt sind.`}
      </EmptyState>
    );

  return (
    <div className="wf-welt-tree">
      <KinSuggestions suggestions={suggestions} />
      <div className="wf-welt-tree__scroll">
        <div className="wf-welt-tree__sheet" style={{ width: tree.width, height: tree.height }}>
          <svg width={tree.width} height={tree.height} aria-hidden>
            {tree.links.map((link) => {
              const [a, b] = link.points;
              return (
                <g key={`${link.from}-${link.to}`}>
                  <polyline className="wf-welt-tree__link" points={line(link.points)} />
                  <text
                    className="wf-welt-tree__word"
                    x={(a![0] + b![0]) / 2}
                    y={(a![1] + b![1]) / 2 - 4}
                    textAnchor="middle"
                  >
                    {link.label}
                  </text>
                </g>
              );
            })}
            {tree.couples.map((couple) => (
              <polyline
                key={`${couple.a}-${couple.b}`}
                className="wf-welt-tree__couple"
                points={line(couple.points)}
              />
            ))}
            {tree.descents.map((descent, index) => (
              <polyline
                key={`${descent.child}-${index}`}
                className="wf-welt-tree__descent"
                points={line(descent.points)}
              />
            ))}
            {tree.brackets.flatMap((bracket) =>
              bracket.points.map((points, index) => (
                <polyline
                  key={`${bracket.ids[0]}-${index}`}
                  className="wf-welt-tree__descent"
                  points={line(points)}
                />
              )),
            )}
          </svg>
          {tree.nodes.map((node) => {
            const entity = data.entities[node.id];
            if (!entity) return null;
            const dead = isDead(entity);
            return (
              <button
                key={node.id}
                type="button"
                className={cx('wf-welt-tree__node', !node.member && 'wf-welt-tree__node--other')}
                style={{ left: node.x, top: node.y, width: TREE.cardW, height: TREE.symbol }}
                title={[
                  entity.name,
                  node.gender === null
                    ? 'Geschlecht unbekannt – es ergibt sich aus dem ersten eingetragenen Wort'
                    : '',
                  dead ? 'verstorben' : '',
                  node.member ? '' : `gehört nicht zu ${family.name}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onClick={() => navigate(entityHref(entity))}
              >
                <span
                  className={cx(
                    'wf-welt-tree__symbol',
                    `wf-welt-tree__symbol--${node.gender ? SHAPE[node.gender] : 'diamond'}`,
                    dead && 'wf-welt-tree__symbol--dead',
                  )}
                  style={{ width: TREE.symbol, height: TREE.symbol }}
                >
                  {entity.image && node.gender && (
                    <img src={src(entity.image)} alt="" draggable={false} />
                  )}
                </span>
                <span className="wf-welt-tree__text">
                  <span className="wf-welt-tree__name wf-clamp-2">{entity.name}</span>
                  {subline(entity) && (
                    <span className="wf-welt-tree__sub wf-clamp-1">{subline(entity)}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="wf-welt-tree__legend">
        <i className="wf-welt-tree__key wf-welt-tree__key--square" /> Mann
        <i className="wf-welt-tree__key wf-welt-tree__key--circle" /> Frau
        <i className="wf-welt-tree__key wf-welt-tree__key--diamond" /> unbekannt
        <i className="wf-welt-tree__key wf-welt-tree__key--dead" /> verstorben
        <i className="wf-welt-tree__key wf-welt-tree__key--line" /> Paar und Kinder
        <i className="wf-welt-tree__key wf-welt-tree__key--link" /> sonst eingetragen
        <i className="wf-welt-tree__key wf-welt-tree__key--other" /> nicht aus der Familie
      </p>
      {tree.loose.length > 0 && (
        <p className="wf-welt-tree__loose">
          Noch ohne eingetragene Verwandtschaft:{' '}
          {tree.loose.map((id, index) => (
            <span key={id}>
              {index > 0 && ', '}
              <EntityLink id={id} icon={false} />
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
