/**
 * „Kommt vor in“ auf der Seite eines Eintrags: die Geschichten, an denen er hängt – als
 * Beteiligter, Schauplatz, über einen Hinweis –, mit seiner Rolle dort. Was jemand selbst
 * antreibt, steht bei Personen, Fraktionen und Familien schon unter „Vorhaben“. Gelesen über
 * `storiesOf` (`domain/storySheet.ts`); ohne Geschichten steht hier nichts.
 */
import { Link } from 'wouter';
import { useData } from '../../data/hooks';
import { storiesOf } from '../../domain/storySheet';
import type { WorldEntity } from './model';
import { Section } from './parts';

/** Arten, auf deren Seite „Vorhaben“ steht (`Schemes`). */
const WITH_SCHEMES = new Set(['person', 'faction', 'family']);

export function InStories({ entity }: { entity: WorldEntity }) {
  const data = useData();
  const rows = storiesOf(data, entity.id).filter(
    (row) => !(row.driver && WITH_SCHEMES.has(entity.kind)),
  );
  if (!rows.length) return null;
  return (
    <Section title="Kommt vor in" count={rows.length} className="wf-welt-instories">
      <ul className="wf-welt-schemes">
        {rows.map((row) => (
          <li key={row.story.id} className="wf-welt-scheme" data-closed={row.story.closed}>
            <Link href={`/geschichte/${row.story.id}`} className="wf-welt-scheme__title">
              {row.story.title}
            </Link>
            <span className="wf-welt-scheme__pace">
              {row.story.closed ? 'zu Ende erzählt' : row.role}
            </span>
            {row.wants && <div className="wf-welt-instories__wants">will hier: {row.wants}</div>}
          </li>
        ))}
      </ul>
    </Section>
  );
}
