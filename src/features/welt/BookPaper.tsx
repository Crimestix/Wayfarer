/**
 * Ein Buch auf Pergament – zum Lesen und für den Druck: Titelseite mit Titel, Verfasser und Jahr,
 * Vorwort, Inhaltsverzeichnis und je Eintrag eine Seite mit Kopfzeile. Zusammengestellt wird in
 * `bookView()` (`domain/book.ts`); hier wird nur gezeigt.
 */
import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { useData } from '../../data/hooks';
import { paragraphs } from '../../domain/handout';
import type { BookPageView, BookView } from '../../domain/book';
import { ArticleNodes, Inlines, type ArticleContext } from '../legendkeeper/Article';
import { readBookPage } from './book';
import '../handouts/handouts.css';
import '../legendkeeper/legendkeeper.css';
import './book.css';

const anchor = (view: BookView, page: BookPageView) => `buch-${view.itemId}-${page.entityId}`;

export function BookPaper({ view, onOpen }: { view: BookView; onOpen?: () => void }) {
  const data = useData();
  const [, navigate] = useLocation();
  const articles = data.articles;
  const ctx = useMemo<ArticleContext>(
    () => ({
      onOpen: (target) => {
        if (!target.resourceId) return;
        onOpen?.();
        navigate(`/wiki/${target.resourceId}`);
      },
      titleOf: (id) => articles[id]?.title ?? null,
      local: true,
    }),
    [articles, navigate, onOpen],
  );
  const jump = (page: BookPageView) =>
    document.getElementById(anchor(view, page))?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="wf-welt-book">
      <section className="wf-welt-book__sheet wf-welt-book__cover">
        <h1 className="wf-welt-book__title">{view.title}</h1>
        {view.author && <p className="wf-welt-book__author">von {view.author}</p>}
        {view.written && <p className="wf-welt-book__year">{view.written}</p>}
      </section>

      {view.intro && (
        <section className="wf-welt-book__sheet">
          <h2 className="wf-welt-book__part">Vorwort</h2>
          <div className="wf-welt-book__intro">
            {paragraphs(view.intro).map((part, index) => (
              <p key={index}>{part}</p>
            ))}
          </div>
        </section>
      )}

      {view.pageCount > 0 && (
        <section className="wf-welt-book__sheet">
          <h2 className="wf-welt-book__part">Inhalt</h2>
          <ol className="wf-welt-book__toc">
            {view.groups.map((group) => (
              <li key={group.label}>
                <span className="wf-welt-book__toc-group">{group.label}</span>
                <ol>
                  {group.pages.map((page) => (
                    <li key={page.entityId}>
                      <button type="button" onClick={() => jump(page)}>
                        {page.title}
                      </button>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </section>
      )}

      {view.groups.map((group) => (
        <section key={group.label} className="wf-welt-book__group">
          <h2 className="wf-welt-book__part">{group.label}</h2>
          {group.pages.map((page) => (
            <Page key={page.entityId} id={anchor(view, page)} view={view} page={page} ctx={ctx} />
          ))}
        </section>
      ))}
    </div>
  );
}

function Page({
  id,
  view,
  page,
  ctx,
}: {
  id: string;
  view: BookView;
  page: BookPageView;
  ctx: ArticleContext;
}) {
  const data = useData();
  const reading = useMemo(() => readBookPage(data.articles, page), [data.articles, page]);
  const empty = !reading.facts.length && !reading.nodes.length;
  return (
    <article id={id} className="wf-welt-book__sheet wf-welt-book__page">
      <header className="wf-welt-book__head">
        <span>{view.title}</span>
        <span>{page.group}</span>
      </header>
      <h3 className="wf-welt-book__entry">{page.title}</h3>
      {reading.facts.length > 0 && (
        <dl className="wf-welt-book__facts">
          {reading.facts.map((fact, index) => (
            <div key={index}>
              <dt>{fact.label}</dt>
              <dd>
                <Inlines inlines={fact.value} ctx={ctx} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {reading.nodes.length > 0 && (
        <div className="wf-welt-book__text wf-lk-flow">
          <ArticleNodes nodes={reading.nodes} ctx={ctx} />
        </div>
      )}
      {empty && <p className="wf-welt-book__blank">Die Seite ist leer.</p>}
    </article>
  );
}
