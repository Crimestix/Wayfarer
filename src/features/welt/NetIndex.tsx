/**
 * Die Liste neben dem Fraktionsnetz: Fraktionen und Familien nach Gewicht, mit Zahl der Personen,
 * Verbündeten und Feinden. Darüberfahren hebt sie im Netz hervor, ein Klick öffnet die Seite.
 * Darunter steht, was die Farben der Fäden bedeuten.
 */
import { useEffect, useMemo } from 'react';
import { Link } from 'wouter';
import { Network } from 'lucide-react';
import { useData } from '../../data/hooks';
import { useMediaSrc } from '../../data/media';
import {
  NET_TONE_LABEL,
  factionNet,
  filterNet,
  netIndex,
  type NetTone,
} from '../../domain/factionNet';
import { EmptyState } from '../../ui';
import { setNetView, useNetView } from './overview';

const LEGEND: NetTone[] = ['friend', 'foe', 'tense', 'bond', 'plain'];

export function NetIndex({ query, selectedId }: { query: string; selectedId?: string }) {
  const data = useData();
  const src = useMediaSrc();
  const { mode } = useNetView();
  const full = useMemo(
    () => factionNet(data),
    // Das Netz hängt nur an Einträgen, Beziehungen und der Lage – nicht an der Weltzeit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.entities, data.relations, data.state.netBoard],
  );
  const rows = useMemo(() => netIndex(filterNet(full, mode), query), [full, mode, query]);
  // Die Suche links hebt im Netz hervor; beim Verlassen ist nichts mehr hervorgehoben.
  useEffect(() => setNetView({ query }), [query]);
  useEffect(() => () => setNetView({ hover: null, query: '' }), []);

  return (
    <div className="wf-welt-netindex">
      {selectedId && (
        <Link href="/welt" className="wf-btn wf-btn--sm wf-welt-netindex__back">
          <Network aria-hidden /> Zurück zum Netz
        </Link>
      )}
      {rows.length ? (
        <div onPointerLeave={() => setNetView({ hover: null })}>
          {rows.map(({ node, people, friends, foes }) => (
            <Link
              key={node.id}
              href={`/welt/${node.id}`}
              className="wf-welt-row"
              aria-current={node.id === selectedId ? 'page' : undefined}
              onPointerEnter={() => setNetView({ hover: node.id })}
              onFocus={() => setNetView({ hover: node.id })}
              title={node.name}
            >
              <span className="wf-welt-row__icon wf-welt-netindex__seal" data-kind={node.kind}>
                {node.image ? (
                  <img src={src(node.image)} alt="" loading="lazy" decoding="async" />
                ) : (
                  node.monogram
                )}
              </span>
              <span className="wf-welt-row__main">
                <span className="wf-welt-row__name wf-clamp-1">{node.name}</span>
                <span className="wf-welt-row__sub wf-clamp-1">
                  {[
                    node.sub,
                    people ? (people === 1 ? 'eine Person' : `${people} Personen`) : '',
                    friends ? `${friends} verbündet` : '',
                    foes ? `${foes} verfeindet` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Network />} title={query.trim() ? 'Nichts gefunden' : 'Noch leer'}>
          {query.trim()
            ? 'Keine Fraktion und keine Familie – und niemand, der zu einer gehört – passt zur Suche.'
            : 'Fraktionen und Familien erscheinen hier, sobald es welche gibt.'}
        </EmptyState>
      )}
      <dl className="wf-welt-netindex__legend">
        {LEGEND.map((tone) => (
          <div key={tone}>
            <dt>
              <svg width="34" height="10" aria-hidden>
                <line className="wf-welt-net__edge" data-tone={tone} x1="1" y1="5" x2="33" y2="5" />
              </svg>
            </dt>
            <dd>{NET_TONE_LABEL[tone]}</dd>
          </div>
        ))}
        <div>
          <dt>
            <svg width="34" height="10" aria-hidden>
              <line
                className="wf-welt-net__edge"
                data-tone="plain"
                data-secret="true"
                x1="1"
                y1="5"
                x2="33"
                y2="5"
              />
            </svg>
          </dt>
          <dd>die Gruppe weiß nichts davon</dd>
        </div>
      </dl>
      <p className="wf-welt-netindex__hint">
        Fäden entstehen aus den Beziehungen der Einträge. Ziehen legt ein Siegel hin, das Rad
        vergrößert.
      </p>
    </div>
  );
}
