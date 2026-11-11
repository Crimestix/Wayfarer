/**
 * Der Stammbaum einer Familie: ihre Mitglieder und deren Verwandte, Generation für Generation.
 * Die Anordnung rechnet `domain/kinTree.ts`; hier wird nur gezeichnet.
 */
import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { GitFork } from 'lucide-react';
import { useData } from '../../data/hooks';
import { useMediaSrc } from '../../data/media';
import { TREE, familyTree } from '../../domain/kinTree';
import type { Entity } from '../../domain/schema';
import { EmptyState, EntityLink, cx, entityHref } from '../../ui';

const line = (points: [number, number][]) => points.map((p) => p.join(',')).join(' ');

/** „Schmied“ oder „Hauptmann der Wache“ – was unter dem Namen steht. */
const subline = (entity: Entity): string =>
  entity.kind === 'person' ? entity.person.role || entity.tagline : entity.tagline;

const isDead = (entity: Entity): boolean =>
  entity.kind === 'person' && entity.person.status === 'dead';

export function FamilyTree({ family }: { family: Entity }) {
  const data = useData();
  const [, navigate] = useLocation();
  const src = useMediaSrc();
  const tree = useMemo(() => familyTree(data, family.id), [data, family.id]);

  if (!tree.nodes.length)
    return (
      <EmptyState icon={<GitFork />} title="Noch kein Stammbaum">
        {tree.loose.length
          ? `${family.name} hat ${tree.loose.length === 1 ? 'ein Mitglied' : `${tree.loose.length} Mitglieder`}, aber noch ist keine Verwandtschaft eingetragen. Öffne eine Person und trage unter „Beziehungen“ ein, wessen Mutter, Bruder oder Tante sie ist – der Baum entsteht daraus von selbst.`
          : `Zu ${family.name} gehört noch niemand. Ordne Personen der Familie zu und trage bei ihnen ein, wie sie miteinander verwandt sind.`}
      </EmptyState>
    );

  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  const mid = TREE.cardH / 2;
  return (
    <div className="wf-welt-tree">
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
            {tree.couples.map(({ a, b }) => {
              const [left, right] = [byId.get(a)!, byId.get(b)!].sort((x, y) => x.x - y.x);
              return (
                <line
                  key={`${a}-${b}`}
                  className="wf-welt-tree__couple"
                  x1={left!.x + TREE.cardW}
                  y1={left!.y + mid}
                  x2={right!.x}
                  y2={right!.y + mid}
                />
              );
            })}
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
            return (
              <button
                key={node.id}
                type="button"
                className={cx(
                  'wf-welt-tree__card',
                  !node.member && 'wf-welt-tree__card--other',
                  isDead(entity) && 'wf-welt-tree__card--dead',
                )}
                style={{ left: node.x, top: node.y, width: TREE.cardW, height: TREE.cardH }}
                title={
                  node.member
                    ? `${entity.name} – im Dossier öffnen`
                    : `${entity.name} gehört nicht zu ${family.name} – im Dossier öffnen`
                }
                onClick={() => navigate(entityHref(entity))}
              >
                {entity.image && <img src={src(entity.image)} alt="" draggable={false} />}
                <span className="wf-welt-tree__text">
                  <span className="wf-welt-tree__name wf-clamp-1">
                    {isDead(entity) && '† '}
                    {entity.name}
                  </span>
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
        <span className="wf-welt-tree__key wf-welt-tree__key--couple" /> Paar
        <span className="wf-welt-tree__key" /> Eltern und Kinder, Geschwister
        <span className="wf-welt-tree__key wf-welt-tree__key--link" /> sonst eingetragen
        <span className="wf-welt-tree__key wf-welt-tree__key--other" /> gehört nicht zur Familie
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
