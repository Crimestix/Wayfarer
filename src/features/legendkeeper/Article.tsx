/** Stellt die Knoten eines Artikels dar (siehe model.ts). Rechnet nichts, zeigt nur. */
import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { ExternalLink, EyeOff, Info } from 'lucide-react';
import { Divider, cx } from '../../ui';
import { noteText, type ArticleNode, type Inline } from './model';

export interface OpenTarget {
  resourceId: string;
  documentId?: string;
  title: string;
}

export interface ArticleContext {
  /** Ein Verweis auf einen anderen Artikel wurde angeklickt. */
  onOpen: (target: OpenTarget) => void;
  /**
   * Titel eines Artikels aus dem Verzeichnis: `undefined`, solange das Verzeichnis lädt,
   * `null`, wenn es den Artikel nicht (mehr) gibt.
   */
  titleOf: (resourceId: string) => string | null | undefined;
  /** Der Artikel liegt im eigenen Wiki – Verweise führen dorthin, nicht nach LegendKeeper. */
  local?: boolean;
}

/**
 * Verweis auf einen anderen Artikel. Bewusst kein <button>: ein Knopf im Fließtext zählt als
 * eigener Kasten, und der Satz bräche vor dem folgenden Punkt oder Komma um.
 */
export function Mention({ target, ctx }: { target: OpenTarget; ctx: ArticleContext }) {
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    ctx.onOpen(target);
  };
  return (
    <span
      role="link"
      tabIndex={0}
      className="wf-lk-mention"
      title={
        ctx.local ? `„${target.title}“ öffnen` : `„${target.title}“ in LegendKeeper nachschlagen`
      }
      onClick={() => ctx.onOpen(target)}
      onKeyDown={onKeyDown}
    >
      {target.title}
    </span>
  );
}

export function Inlines({ inlines, ctx }: { inlines: Inline[]; ctx: ArticleContext }) {
  return (
    <>
      {inlines.map((inline, index) => {
        if (inline.type === 'break') return <br key={index} />;
        if (inline.type === 'mention') {
          return (
            <Mention
              key={index}
              ctx={ctx}
              target={{
                resourceId: inline.resourceId,
                documentId: inline.documentId,
                title: inline.label,
              }}
            />
          );
        }
        let node: ReactNode = inline.text;
        if (inline.code) node = <code className="wf-lk-inline-code">{node}</code>;
        if (inline.sub) node = <sub>{node}</sub>;
        if (inline.sup) node = <sup>{node}</sup>;
        if (inline.strike) node = <s>{node}</s>;
        if (inline.underline) node = <u>{node}</u>;
        if (inline.italic) node = <em>{node}</em>;
        if (inline.bold) node = <strong>{node}</strong>;
        if (inline.highlight) node = <mark className="wf-lk-mark">{node}</mark>;
        if (inline.href) {
          node = (
            <a
              className="wf-lk-link"
              href={inline.href}
              target="_blank"
              rel="noreferrer noopener"
              title="Öffnet im Browser"
            >
              {node}
              <ExternalLink aria-hidden />
            </a>
          );
        }
        return <span key={index}>{node}</span>;
      })}
    </>
  );
}

function Note({ children, href, hint }: { children: ReactNode; href?: string; hint?: string }) {
  return (
    <p className="wf-lk-note" title={hint}>
      <Info aria-hidden />
      <span>
        {children}
        {href && (
          <>
            {' '}
            <a className="wf-lk-link" href={href} target="_blank" rel="noreferrer noopener">
              Öffnen
              <ExternalLink aria-hidden />
            </a>
          </>
        )}
      </span>
    </p>
  );
}

/** Bild aus LegendKeeper; lässt es sich nicht laden, steht ein Hinweis an seiner Stelle. */
function Figure({ node }: { node: Extract<ArticleNode, { type: 'image' }> }) {
  const [broken, setBroken] = useState(false);
  if (broken)
    return (
      <Note>
        Ein Bild{node.caption ? ` („${node.caption}“)` : ''} lässt sich gerade nicht laden.
      </Note>
    );
  return (
    <figure className="wf-lk-figure">
      <a
        href={node.url}
        target="_blank"
        rel="noreferrer noopener"
        title="Bild in voller Größe im Browser öffnen"
      >
        <img
          src={node.url}
          alt={node.alt}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      </a>
      {node.caption && <figcaption>{node.caption}</figcaption>}
    </figure>
  );
}

const Label = ({ children }: { children: ReactNode }) => (
  <div className="wf-lk-label">{children}</div>
);

const alignStyle = (align: 'center' | 'right' | undefined): CSSProperties | undefined =>
  align ? { textAlign: align } : undefined;

function Heading({
  node,
  ctx,
}: {
  node: Extract<ArticleNode, { type: 'heading' }>;
  ctx: ArticleContext;
}) {
  // Im Dossier sind h1 und h2 vergeben; der Artikel beginnt eine Ebene darunter.
  const Tag = (['h3', 'h4', 'h5', 'h6', 'h6', 'h6'] as const)[node.level - 1] ?? 'h6';
  return (
    <Tag
      id={node.anchor}
      className={cx('wf-lk-h', `wf-lk-h--${Math.min(node.level, 4)}`)}
      style={alignStyle(node.align)}
    >
      <Inlines inlines={node.inlines} ctx={ctx} />
    </Tag>
  );
}

function Node({ node, ctx }: { node: ArticleNode; ctx: ArticleContext }) {
  switch (node.type) {
    case 'paragraph':
      return (
        <p className="wf-lk-p" style={alignStyle(node.align)}>
          <Inlines inlines={node.inlines} ctx={ctx} />
        </p>
      );
    case 'heading':
      return <Heading node={node} ctx={ctx} />;
    case 'quote':
      return (
        <blockquote className="wf-lk-quote">
          <ArticleNodes nodes={node.children} ctx={ctx} />
        </blockquote>
      );
    case 'code':
      return <pre className="wf-lk-code">{node.text}</pre>;
    case 'rule':
      return (
        <div className="wf-lk-rule">
          <Divider />
        </div>
      );
    case 'list': {
      const items = node.items.map((item, index) => (
        <li key={index}>
          <ArticleNodes nodes={item} ctx={ctx} />
        </li>
      ));
      return node.ordered ? (
        <ol className="wf-lk-list wf-lk-list--ordered" start={node.start}>
          {items}
        </ol>
      ) : (
        <ul className="wf-lk-list">{items}</ul>
      );
    }
    case 'tasks':
      return (
        <ul className="wf-lk-tasks">
          {node.items.map((item, index) => (
            <li key={index} data-checked={item.checked}>
              <i aria-hidden />
              <span>
                <span className="wf-lk-sr">{item.checked ? 'Erledigt: ' : 'Offen: '}</span>
                <Inlines inlines={item.inlines} ctx={ctx} />
              </span>
            </li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div className="wf-lk-table-wrap">
          <table className="wf-lk-table">
            <tbody>
              {node.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => {
                    const Cell = cell.header ? 'th' : 'td';
                    return (
                      <Cell
                        key={cellIndex}
                        colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                        rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                      >
                        <ArticleNodes nodes={cell.children} ctx={ctx} />
                      </Cell>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'callout':
      return (
        <aside className={cx('wf-lk-callout', `wf-lk-callout--${node.tone}`)}>
          <ArticleNodes nodes={node.children} ctx={ctx} />
        </aside>
      );
    case 'expand':
      return (
        <details className="wf-lk-expand">
          <summary>{node.title}</summary>
          <div className="wf-lk-expand__body">
            <ArticleNodes nodes={node.children} ctx={ctx} />
          </div>
        </details>
      );
    case 'columns':
      return (
        <div
          className="wf-lk-columns"
          style={{ '--wf-lk-cols': node.columns.length } as CSSProperties}
        >
          {node.columns.map((column, index) => (
            <div key={index} className="wf-lk-flow">
              <ArticleNodes nodes={column} ctx={ctx} />
            </div>
          ))}
        </div>
      );
    case 'image':
      return <Figure node={node} />;
    case 'facts':
      return (
        <div className="wf-lk-block">
          {node.title && <Label>{node.title}</Label>}
          <dl className="wf-lk-facts">
            {node.rows.map((row, index) => (
              <div key={index} className={cx(!row.key && 'wf-lk-facts__bare')}>
                {row.key && <dt>{row.key}</dt>}
                <dd>
                  <Inlines inlines={row.value} ctx={ctx} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      );
    case 'meters':
      return (
        <div className="wf-lk-block">
          {node.title && <Label>{node.title}</Label>}
          <ul className="wf-lk-meters">
            {node.items.map((item, index) => (
              <li key={index}>
                <span className="wf-lk-meters__name">{item.name || 'Wert'}</span>
                <span className="wf-lk-meters__bar" aria-hidden>
                  <i style={{ width: `${Math.min(100, (item.current / item.max) * 100)}%` }} />
                </span>
                <span className="wf-num wf-lk-meters__value">
                  {item.current} / {item.max}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'links':
      return (
        <div className="wf-lk-block">
          {node.title && <Label>{node.title}</Label>}
          <ul className="wf-lk-links">
            {node.items.map((item, index) => {
              const title = ctx.titleOf(item.resourceId);
              return (
                <li key={index}>
                  {title ? (
                    <Mention ctx={ctx} target={{ ...item, title }} />
                  ) : (
                    <span className="wf-lk-links__gone">
                      {title === undefined
                        ? 'Wird nachgeschlagen …'
                        : 'Artikel nicht mehr vorhanden'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      );
    case 'group':
      return (
        <div className="wf-lk-block">
          {node.title && <Label>{node.title}</Label>}
          <div className="wf-lk-flow">
            <ArticleNodes nodes={node.children} ctx={ctx} />
          </div>
        </div>
      );
    case 'infobox':
      return (
        <div className="wf-lk-infobox wf-lk-flow">
          <ArticleNodes nodes={node.children} ctx={ctx} />
        </div>
      );
    case 'secret':
      return (
        <section className="wf-lk-secret">
          <div className="wf-lk-secret__label">
            <EyeOff aria-hidden />
            Geheim – nur für die Spielleitung
          </div>
          <div className="wf-lk-flow">
            <ArticleNodes nodes={node.children} ctx={ctx} />
          </div>
        </section>
      );
    case 'note':
      return (
        <Note
          href={node.href}
          hint={
            node.reason === 'unknown' && node.kind ? `Art in LegendKeeper: ${node.kind}` : undefined
          }
        >
          {noteText(node)}
        </Note>
      );
    case 'unknown':
      return (
        <div className="wf-lk-unknown" title={`Art in LegendKeeper: ${node.kind}`}>
          <div className="wf-lk-unknown__label">
            Diesen Abschnitt kann Wayfarer nicht in seiner Form zeigen – hier steht nur sein Text
          </div>
          <p className="wf-prose">{node.text}</p>
        </div>
      );
  }
}

export function ArticleNodes({ nodes, ctx }: { nodes: ArticleNode[]; ctx: ArticleContext }) {
  return (
    <>
      {nodes.map((node, index) => (
        <Node key={index} node={node} ctx={ctx} />
      ))}
    </>
  );
}
