/**
 * Wiki – die Artikel der Welt. Keine eigene Seite mehr: Baum, Suche, Übersicht und der Artikel
 * selbst sind Bausteine der Seite „Welt“ (`features/welt`).
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  BookOpen,
  ChevronRight,
  Code,
  EyeOff,
  FilePlus2,
  Library,
  PenLine,
  Plus,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL } from '../../domain/derive';
import type { Article, EntityKind } from '../../domain/schema';
import {
  Button,
  EmptyState,
  EntityLink,
  KindIcon,
  MenuItem,
  Popover,
  cx,
  entityHref,
  toast,
} from '../../ui';
import type { OpenTarget } from '../legendkeeper/Article';
import { adoptArticle } from './actions';
import { ArticleMenu, NewArticleDialog } from './ArticleTools';
import { MODE_LABEL, flushEdits, type WikiMode } from './editing';
import { AiOverview } from '../ki/AiOverview';
import { AiPanel } from '../ki/AiPanel';
import { FactsHint, FactsOverview } from './FactsHint';
import { ArticleIcon } from './icons';
import { LocalArticle } from './LocalArticle';
import {
  articlePath,
  articleTree,
  entitiesOfArticle,
  searchArticles,
  searchIndex,
  wantedArticles,
  type SearchIndexEntry,
  type TreeNode,
  type WantedArticle,
} from './model';
import './wiki.css';

/** Als was sich ein Artikel von Hand in die Welt aufnehmen lässt. */
const ADOPT_KINDS: EntityKind[] = [
  'person',
  'place',
  'faction',
  'item',
  'family',
  'species',
  'language',
  'topic',
];

/** Was aufgeklappt ist und wonach gesucht wurde, bleibt beim Wechsel des Bereichs erhalten. */
const memory = { open: new Set<string>(), query: '', mode: 'read' as WikiMode };

const MODES: { id: WikiMode; icon: ReactNode; hint: string }[] = [
  { id: 'read', icon: <BookOpen />, hint: 'Der fertige Artikel, wie am Tisch' },
  { id: 'live', icon: <PenLine />, hint: 'Schreiben in der schönen Ansicht' },
  { id: 'source', icon: <Code />, hint: 'Der reine Text mit allen Zeichen' },
];

/** Umschalter zwischen Lesen, Schreiben und Quelltext. */
function ModeSwitch({ mode, onChange }: { mode: WikiMode; onChange: (mode: WikiMode) => void }) {
  return (
    <div className="wf-wiki-mode" role="group" aria-label="Ansicht des Artikels">
      {MODES.map((entry) => (
        <button
          key={entry.id}
          type="button"
          aria-pressed={entry.id === mode}
          title={`${entry.hint} (Strg+E wechselt zwischen Lesen und Schreiben)`}
          onClick={() => onChange(entry.id)}
        >
          {entry.icon}
          <span>{MODE_LABEL[entry.id]}</span>
        </button>
      ))}
    </div>
  );
}

const indexCache = new WeakMap<object, SearchIndexEntry[]>();

function TreeRows({
  nodes,
  depth,
  open,
  toggle,
  current,
}: {
  nodes: TreeNode[];
  depth: number;
  open: Set<string>;
  toggle: (id: string) => void;
  current: string | undefined;
}) {
  return (
    <>
      {nodes.map(({ article, children, size }) => {
        const expanded = open.has(article.id);
        return (
          <div
            key={article.id}
            role="treeitem"
            aria-expanded={children.length ? expanded : undefined}
          >
            <div
              className="wf-wiki-row"
              data-current={article.id === current}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {children.length > 0 ? (
                <button
                  type="button"
                  className={cx('wf-wiki-row__toggle', expanded && 'wf-wiki-row__toggle--open')}
                  aria-label={expanded ? 'Zuklappen' : 'Aufklappen'}
                  onClick={() => toggle(article.id)}
                >
                  <ChevronRight />
                </button>
              ) : (
                <span className="wf-wiki-row__toggle" aria-hidden />
              )}
              <Link href={`/wiki/${article.id}`} className="wf-wiki-row__link">
                <ArticleIcon icon={article.icon} />
                <span className="wf-wiki-row__title">{article.title}</span>
                {article.hidden && (
                  <EyeOff className="wf-wiki-row__hidden" aria-label="verborgen" />
                )}
                {children.length > 0 && !expanded && (
                  <span className="wf-wiki-row__count">{size}</span>
                )}
              </Link>
            </div>
            {expanded && children.length > 0 && (
              <div role="group">
                <TreeRows
                  nodes={children}
                  depth={depth + 1}
                  open={open}
                  toggle={toggle}
                  current={current}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function AdoptButton({ article }: { article: Article }) {
  const db = useDb();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const adopt = (kind: EntityKind) => {
    setOpen(false);
    const entity = adoptArticle(db, article, kind);
    toast({
      title: `„${entity.name}“ steht jetzt in der Welt`,
      body: `als ${KIND_LABEL[kind]} – mit diesem Artikel verknüpft.`,
      action: { label: 'Öffnen', run: () => navigate(entityHref(entity)) },
    });
  };
  return (
    <>
      <Button
        ref={anchor}
        size="sm"
        icon={<Plus />}
        onClick={() => setOpen((o) => !o)}
        title="Diesen Artikel als Eintrag in die Welt aufnehmen"
        aria-label="In die Welt aufnehmen"
      >
        <span className="wf-lk-act__label">In die Welt aufnehmen</span>
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} align="right" width={230}>
        {ADOPT_KINDS.map((kind) => (
          <MenuItem key={kind} icon={<KindIcon kind={kind} />} onClick={() => adopt(kind)}>
            als {KIND_LABEL[kind]}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}

const wantedCache = new WeakMap<object, WantedArticle[]>();
const WANTED_SHOWN = 24;

/** Titel, auf die verwiesen wird, die aber noch keinen Artikel haben. */
function Wanted({
  articles,
  onCreate,
}: {
  articles: Record<string, Article>;
  onCreate: (title: string, from: Article) => void;
}) {
  const [all, setAll] = useState(false);
  const wanted = useMemo(() => {
    let list = wantedCache.get(articles);
    if (!list) {
      list = wantedArticles(articles);
      wantedCache.set(articles, list);
    }
    return list;
  }, [articles]);
  if (!wanted.length) return null;
  const shown = all ? wanted : wanted.slice(0, WANTED_SHOWN);
  return (
    <section className="wf-wiki-wanted" aria-label="Erwähnt, aber noch nicht angelegt">
      <h2 className="wf-lk-label">Erwähnt, aber noch nicht angelegt</h2>
      <p className="wf-mute">
        Auf diese Namen verweist dein Text, ohne dass es den Artikel gibt. Ein Klick legt ihn an.
      </p>
      <ul className="wf-wiki-wanted__list">
        {shown.map((entry) => (
          <li key={entry.title}>
            <button
              type="button"
              className="wf-wiki-wanted__name"
              title={`Artikel „${entry.title}“ anlegen`}
              onClick={() => onCreate(entry.title, entry.from[0]!)}
            >
              <FilePlus2 aria-hidden />
              {entry.title}
            </button>
            <span className="wf-wiki-wanted__from">
              erwähnt in{' '}
              {entry.from.slice(0, 3).map((article, index) => (
                <Fragment key={article.id}>
                  {index > 0 && ', '}
                  <Link href={`/wiki/${article.id}`}>{article.title}</Link>
                </Fragment>
              ))}
              {entry.from.length > 3 && ` und ${entry.from.length - 3} weiteren`}
            </span>
          </li>
        ))}
      </ul>
      {wanted.length > shown.length && (
        <button type="button" className="wf-wiki-more" onClick={() => setAll(true)}>
          und {wanted.length - shown.length} weitere
        </button>
      )}
    </section>
  );
}

/**
 * Die Artikel als Übersicht: die obersten Ordner als Regal, darunter was der KI-Leser und die
 * Steckbriefe vorschlagen und worauf verwiesen wird, ohne dass es einen Artikel gibt. Steht auf
 * der Startseite der Welt.
 */
export function WikiStart() {
  const data = useData();
  const [, navigate] = useLocation();
  const articles = data.articles;
  const tree = useMemo(() => articleTree(articles), [articles]);
  const total = Object.keys(articles).length - tree.templates.length;
  const [creating, setCreating] = useState<{ parent: Article | null; title: string } | null>(null);
  const dialog = creating && (
    <NewArticleDialog
      parent={creating.parent}
      initialTitle={creating.title}
      onClose={() => setCreating(null)}
      onCreated={(created) => {
        setCreating(null);
        memory.mode = memory.mode === 'read' ? 'live' : memory.mode;
        navigate(`/wiki/${created.id}`);
      }}
    />
  );
  if (!Object.keys(articles).length)
    return (
      <div className="wf-wiki-landing">
        <EmptyState
          icon={<Library />}
          title="Noch keine Artikel"
          action={
            <div className="wf-row" style={{ gap: 'var(--s-3)' }}>
              <Button icon={<FilePlus2 />} onClick={() => setCreating({ parent: null, title: '' })}>
                Ersten Artikel schreiben
              </Button>
              <Button onClick={() => navigate('/einstellungen')}>LegendKeeper übernehmen</Button>
            </div>
          }
        >
          Hier stehen die Artikel über deine Welt. Schreib sie direkt hier – oder lies in den
          Einstellungen unter „LegendKeeper ganz übernehmen“ die Exportdatei deines
          LegendKeeper-Projekts ein, mit allen Artikeln, Karten und Steckbriefen.
        </EmptyState>
        {dialog}
      </div>
    );
  return (
    <div className="wf-wiki-landing">
      <div className="wf-wiki-landing__head">
        <h2 className="wf-wiki-landing__title">Artikel</h2>
        <span className="wf-mute">
          {total === 1 ? 'ein Artikel' : `${total} Artikel`} – die Suche links findet auch Wörter
          mitten im Text
        </span>
        <span className="wf-grow" />
        <Button icon={<FilePlus2 />} onClick={() => setCreating({ parent: null, title: '' })}>
          Neuer Artikel
        </Button>
      </div>
      <div className="wf-wiki-shelf">
        {tree.roots.map(({ article, size }) => (
          <Link key={article.id} href={`/wiki/${article.id}`} className="wf-wiki-book">
            <ArticleIcon icon={article.icon} />
            <span className="wf-wiki-book__title">{article.title}</span>
            <span className="wf-wiki-book__count">
              {size === 0 ? 'ein Artikel' : `${size + 1} Artikel`}
            </span>
          </Link>
        ))}
      </div>
      <AiOverview />
      <FactsOverview />
      <Wanted
        articles={articles}
        onCreate={(title, from) => setCreating({ parent: from, title })}
      />
      {dialog}
    </div>
  );
}

/** Die Artikel, in denen die Suche etwas findet – auch mitten im Text. Null ohne Suche. */
export function useArticleHits(query: string) {
  const articles = useData().articles;
  return useMemo(() => {
    if (!query.trim()) return null;
    let index = indexCache.get(articles);
    if (!index) {
      index = searchIndex(articles);
      indexCache.set(articles, index);
    }
    return searchArticles(index, query);
  }, [articles, query]);
}

/**
 * Der Baum aller Artikel – die Ordner des Wikis. Der gewählte Artikel wird aufgeklappt und in den
 * Blick geholt.
 */
export function ArticleTree({ current }: { current: string | undefined }) {
  const articles = useData().articles;
  const tree = useMemo(() => articleTree(articles), [articles]);
  const [open, setOpen] = useState(memory.open);
  const [showTemplates, setShowTemplates] = useState(false);
  useEffect(() => {
    memory.open = open;
  }, [open]);

  // Hängt am Platz im Baum, nicht am Inhalt: Beim Schreiben ändert sich das Wiki laufend, ohne
  // dass die Ansicht springen darf.
  const place = current
    ? articlePath(articles, current)
        .map((step) => step.id)
        .join('/')
    : '';
  useEffect(() => {
    if (!current) return;
    const path = place ? place.split('/') : [];
    if (path.length)
      setOpen((before) => {
        if (path.every((step) => before.has(step))) return before;
        const next = new Set(before);
        for (const step of path) next.add(step);
        return next;
      });
    // Erst nach dem Aufklappen steht die Zeile im Baum.
    const timer = setTimeout(
      () =>
        document
          .querySelector('.wf-wiki-row[data-current="true"]')
          ?.scrollIntoView({ block: 'nearest' }),
      30,
    );
    return () => clearTimeout(timer);
  }, [current, place]);

  const toggle = useCallback(
    (nodeId: string) =>
      setOpen((before) => {
        const next = new Set(before);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return next;
      }),
    [],
  );

  return (
    <div role="tree">
      <TreeRows nodes={tree.roots} depth={0} open={open} toggle={toggle} current={current} />
      {tree.templates.length > 0 && (
        <div className="wf-wiki-templates">
          <button
            type="button"
            className="wf-wiki-templates__head"
            aria-expanded={showTemplates}
            onClick={() => setShowTemplates((shown) => !shown)}
          >
            <ChevronRight
              className={cx('wf-wiki-row__chevron', showTemplates && 'wf-wiki-row__chevron--open')}
            />
            Vorlagen
            <span className="wf-wiki-row__count">{tree.templates.length}</span>
          </button>
          {showTemplates &&
            tree.templates.map((template) => (
              <div
                key={template.id}
                className="wf-wiki-row"
                data-current={template.id === current}
                style={{ paddingLeft: 22 }}
              >
                <Link href={`/wiki/${template.id}`} className="wf-wiki-row__link">
                  <ArticleIcon icon={template.icon} />
                  <span className="wf-wiki-row__title">{template.title}</span>
                </Link>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * Ein Artikel zum Lesen und Schreiben – für sich oder als Reiter „Text“ auf der Seite eines
 * Eintrags der Welt (`embedded`). Ein Verweis führt immer nach `/wiki/…`; gehört der Artikel zu
 * einem Eintrag, öffnet sich dort dessen Seite.
 */
export function ArticlePage({
  article,
  embedded = false,
}: {
  article: Article;
  embedded?: boolean;
}) {
  const data = useData();
  const [, navigate] = useLocation();
  const articles = data.articles;
  const [mode, setMode] = useState<WikiMode>(memory.mode);
  /** Zuletzt benutzte Schreibansicht – dorthin wechselt Strg+E. */
  const lastEdit = useRef<WikiMode>(memory.mode === 'source' ? 'source' : 'live');
  const [creating, setCreating] = useState<{ parent: Article | null; title: string } | null>(null);
  useEffect(() => {
    memory.mode = mode;
    if (mode !== 'read') lastEdit.current = mode;
  }, [mode]);

  // Strg+E (am Mac Befehl+E) wechselt zwischen Lesen und Schreiben.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'e')
        return;
      event.preventDefault();
      flushEdits();
      setMode((current) => (current === 'read' ? lastEdit.current : 'read'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onOpen = useCallback(
    (target: OpenTarget) => {
      if (articles[target.resourceId]) navigate(`/wiki/${target.resourceId}`);
      else if (!target.resourceId && (target.wanted ?? target.title))
        // Ein Verweis auf etwas, das noch keinen Artikel hat: anbieten, ihn anzulegen.
        setCreating({
          parent: article.template ? null : article,
          title: target.wanted ?? target.title,
        });
      else
        toast({
          title: `„${target.title || 'Dieser Artikel'}“ gibt es nicht`,
          body: 'Der Verweis führt zu einem Artikel, der gelöscht wurde.',
        });
    },
    [articles, article, navigate],
  );
  const owners = entitiesOfArticle(data, article.id);

  return (
    <div className={cx('wf-lk wf-wiki-article', embedded && 'wf-wiki-article--embedded')}>
      <LocalArticle
        key={article.id}
        article={article}
        onOpen={onOpen}
        mode={mode}
        actions={
          <>
            <ModeSwitch
              mode={mode}
              onChange={(next) => {
                flushEdits();
                setMode(next);
              }}
            />
            {!article.template && owners.length === 0 && <AdoptButton article={article} />}
            <ArticleMenu
              article={article}
              onNewChild={() => setCreating({ parent: article, title: '' })}
            />
          </>
        }
        below={
          <>
            {!embedded && owners.length > 0 && (
              <div className="wf-wiki-owners">
                In der Welt:
                {owners.map((owner) => (
                  <EntityLink key={owner.id} id={owner.id} />
                ))}
              </div>
            )}
            <FactsHint article={article} />
            <AiPanel article={article} />
          </>
        }
      />
      {creating && (
        <NewArticleDialog
          parent={creating.parent}
          initialTitle={creating.title}
          onClose={() => setCreating(null)}
          onCreated={(created) => {
            setCreating(null);
            setMode((current) => (current === 'read' ? lastEdit.current : current));
            navigate(`/wiki/${created.id}`);
          }}
        />
      )}
    </div>
  );
}
