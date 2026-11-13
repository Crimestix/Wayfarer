/**
 * „Was hier wächst und lebt“: Pflanzen, Tiere und Gesteine aus den Einträgen des Spielleiters,
 * die an einer Stelle vorkommen können (`domain/nature.ts`) – je Eintrag mit Grund. Ruhig und
 * eingeklappt: am Spieltisch, auf einem Feld der Hexkarte und auf der Seite eines Ortes.
 */
import { useState } from 'react';
import { Link } from 'wouter';
import { ChevronDown, ChevronUp, Leaf } from 'lucide-react';
import { RARITY_LABEL, natureOf, type NatureHit } from '../../domain/nature';
import { KindIcon } from '../../ui';
import './nature.css';

/** Je Stelle, ob der Abschnitt offen ist – solange die App läuft. */
const opened = new Set<string>();

export function NatureFold({
  hits,
  spot,
  title = 'Was hier wächst und lebt',
}: {
  hits: NatureHit[];
  /** Woran sich das Aufklappen merkt, etwa die Kennung des Ortes. */
  spot: string;
  title?: string;
}) {
  const [open, setOpen] = useState(() => opened.has(spot));
  if (!hits.length) return null;
  const toggle = () => {
    if (open) opened.delete(spot);
    else opened.add(spot);
    setOpen(!open);
  };
  return (
    <section className="wf-welt-nature" aria-label={title}>
      <button type="button" className="wf-welt-nature__head" aria-expanded={open} onClick={toggle}>
        <Leaf aria-hidden />
        <span className="wf-welt-nature__title">{title}</span>
        <span className="wf-welt-nature__count">{hits.length}</span>
        {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
      </button>
      {open && <NatureList hits={hits} />}
    </section>
  );
}

export function NatureList({ hits }: { hits: NatureHit[] }) {
  return (
    <ul className="wf-welt-nature__list">
      {hits.map(({ entity, reasons, seasonal }) => {
        const details = natureOf(entity);
        const sub = [
          details.category,
          details.rarity && RARITY_LABEL[details.rarity],
          reasons.map((reason) => reason.text).join(', '),
          seasonal && `nur ${seasonal}`,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <li key={entity.id}>
            <Link
              href={`/welt/${entity.id}`}
              className="wf-welt-nature__row"
              title={entity.tagline}
            >
              <KindIcon kind={entity.kind} />
              <span className="wf-welt-nature__main">
                <span className="wf-welt-nature__name">{entity.name}</span>
                <span className="wf-welt-nature__sub wf-clamp-1">{sub}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
