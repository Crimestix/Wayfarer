/**
 * Auf der Startseite des Wikis: alle offenen Vorschläge des KI-Lesers an einer Stelle – nach
 * Artikel geordnet, zum Eintragen oder Verwerfen, ohne jeden Artikel einzeln zu öffnen.
 */
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Sparkles } from 'lucide-react';
import { useData } from '../../data/hooks';
import type { Article } from '../../domain/schema';
import { Button } from '../../ui';
import { HintRow } from './AiPanel';
import './ki.css';

/** So viele Artikel zeigt die Übersicht, bevor „alle zeigen“ nötig ist. */
const SHOWN = 6;

/** Die Artikel mit offenen Vorschlägen – die mit den meisten zuerst. */
export function articlesWithHints(articles: Record<string, Article>): Article[] {
  return Object.values(articles)
    .filter((article) => article.aiHints.some((hint) => hint.state === 'open'))
    .sort(
      (a, b) =>
        b.aiHints.filter((h) => h.state === 'open').length -
          a.aiHints.filter((h) => h.state === 'open').length ||
        a.title.localeCompare(b.title, 'de'),
    );
}

export function AiOverview() {
  const data = useData();
  const [all, setAll] = useState(false);
  const withHints = useMemo(() => articlesWithHints(data.articles), [data.articles]);
  if (!withHints.length) return null;
  const total = withHints.reduce(
    (sum, article) => sum + article.aiHints.filter((h) => h.state === 'open').length,
    0,
  );
  const shown = all ? withHints : withHints.slice(0, SHOWN);
  return (
    <section className="wf-wiki-factsall wf-ki-all" aria-label="Vorschläge des KI-Lesers">
      <h2 className="wf-lk-label">
        <Sparkles aria-hidden className="wf-ki__icon" /> Vorschläge des KI-Lesers
      </h2>
      <p className="wf-mute">
        {total === 1 ? 'Ein Vorschlag wartet' : `${total} Vorschläge warten`} in{' '}
        {withHints.length === 1 ? 'einem Artikel' : `${withHints.length} Artikeln`}. Jeder nennt den
        Satz, aus dem er stammt, und gilt erst, wenn du ihn einträgst.
      </p>
      {shown.map((article) => (
        <div key={article.id} className="wf-ki-all__article">
          <Link href={`/wiki/${article.id}`} className="wf-ki-all__title">
            {article.title}
          </Link>
          {article.aiHints
            .filter((hint) => hint.state === 'open')
            .map((hint) => (
              <HintRow key={hint.id} article={article} hint={hint} />
            ))}
        </div>
      ))}
      {withHints.length > SHOWN && (
        <Button size="sm" onClick={() => setAll((on) => !on)}>
          {all ? 'Weniger zeigen' : `Alle ${withHints.length} Artikel zeigen`}
        </Button>
      )}
    </section>
  );
}
