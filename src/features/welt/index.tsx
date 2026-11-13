/**
 * Welt – alles, was es in der Welt gibt, auf einer Seite: links die Übersicht (nach Art oder in
 * den Ordnern der Artikel, mit einer Suche für beides), rechts die Seite des gewählten Dings. Ein
 * Eintrag der Welt zeigt seinen Artikel als Reiter „Text“; ein Artikel ohne Eintrag steht für
 * sich. Die Wege `/welt/…` (Eintrag) und `/wiki/…` (Artikel) führen beide hierher.
 */
import { useEffect, useRef } from 'react';
import { Link, Redirect, useParams } from 'wouter';
import { Compass } from 'lucide-react';
import { useData } from '../../data/hooks';
import type { Entity } from '../../domain/schema';
import { EmptyState } from '../../ui';
import { ArticlePage, WikiStart } from '../wiki';
import { entitiesOfArticle } from '../wiki/model';
import { Dossier } from './Dossier';
import { EntityDialogHost } from './EntityDialog';
import { Gallery } from './Gallery';
import { Landing } from './Landing';
import { isLexiconKind } from './lexicon';
import { Lexicon } from './LexiconView';
import { isWorldEntity } from './model';
import { useKindFilter, useWorldLayout } from './overview';
import { FactionNetView } from './FactionNet';
import { Sidebar } from './Sidebar';
import './welt.css';

/** Ein Eintrag der Welt – oder die Startseite. */
export default function WeltPage() {
  const { id } = useParams<{ id?: string }>();
  return <World entityId={id} />;
}

/**
 * Ein Artikel. Gehört er zu einem Eintrag der Welt, gibt es nur eine Seite für beide: die des
 * Eintrags, mit dem Artikel als „Text“.
 */
export function WikiRoute() {
  const data = useData();
  const { id } = useParams<{ id?: string }>();
  if (!id) return <Redirect to="/welt" replace />;
  const owner = entitiesOfArticle(data, id).find((entity: Entity) => isWorldEntity(entity));
  if (owner) return <Redirect to={`/welt/${owner.id}`} replace />;
  return <World articleId={id} />;
}

function World({ entityId, articleId }: { entityId?: string; articleId?: string }) {
  const data = useData();
  const entity = entityId ? data.entities[entityId] : undefined;
  const article = articleId ? data.articles[articleId] : undefined;
  const filter = useKindFilter();
  const layout = useWorldLayout();
  const stage = useRef<HTMLDivElement>(null);
  // Ein anderes Ding beginnt wieder oben.
  useEffect(() => {
    stage.current?.scrollTo(0, 0);
  }, [entityId, articleId]);
  if (entity?.kind === 'character') return <Redirect to={`/gruppe/${entity.id}`} />;
  const selected = isWorldEntity(entity) ? entity : undefined;
  return (
    <div className="wf-welt">
      <Sidebar selected={selected} articleId={article?.id} />
      <div className="wf-welt-stage" ref={stage}>
        {selected ? (
          <Dossier key={selected.id} entity={selected} />
        ) : article ? (
          <ArticlePage key={article.id} article={article} />
        ) : entityId || articleId ? (
          <EmptyState
            icon={<Compass />}
            title={
              articleId ? 'Diesen Artikel gibt es nicht mehr' : 'Diesen Eintrag gibt es nicht mehr'
            }
            action={
              <Link href="/welt" className="wf-btn">
                Zur Übersicht
              </Link>
            }
          >
            Er wurde gelöscht oder auf einem anderen Gerät entfernt.
          </EmptyState>
        ) : layout === 'net' ? (
          <FactionNetView />
        ) : filter === 'person' ? (
          <Gallery />
        ) : filter !== 'all' && isLexiconKind(filter) ? (
          <Lexicon key={filter} kind={filter} />
        ) : (
          <>
            <Landing />
            <WikiStart />
          </>
        )}
      </div>
      <EntityDialogHost />
    </div>
  );
}
