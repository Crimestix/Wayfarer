/**
 * Wiki – die Artikel der Welt. Keine eigene Seite mehr: Baum, Suche, Übersicht und der Artikel
 * selbst sind Bausteine der Seite „Welt“ (`features/welt`).
 */
import { MaterialBox } from '../welt/MaterialBox';
import { roomArticleIds } from '../../domain/rooms';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  BookOpen,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Code,
  EyeOff,
  FilePlus2,
  Library,
  PenLine,
  Plus,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL } from '../../domain/derive';
import { CREATE_KINDS } from '../../domain/pick';
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
import { articleFacts, kindFromFolder, statedKind } from './facts';
import { ArticleMenu, NewArticleDialog } from './ArticleTools';
import { openNew } from '../welt/editor';
import { MODE_LABEL, flushEdits, type WikiMode } from './editing';
import { useShortcut } from '../../shell/shortcuts';
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
  type SearchIndexEntry,
  type TreeNode,
} from './model';
import { ScaffoldHint } from './ScaffoldHint';
import './wiki.css';

/**
 * Als was sich ein Artikel von Hand in die Welt aufnehmen lässt: jede Kategorie der Welt, die
 * häufigen zuerst (Rückmeldung des Spielleiters, 19. 11. 2026: „Bei ‚Art festlegen‘ kann man
 * nicht alle Arten auswählen“). Nie eine eigene, kürzere Liste führen.
 */
const ADOPT_KINDS: readonly EntityKind[] = CREATE_KINDS;

/** Was aufgeklappt ist und wonach gesucht wurde, bleibt beim Wechsel des Bereichs erhalten. */
const memory = {
  open: new Set<string>(),
  query: '',
  mode: 'read' as WikiMode,
  /** Der nächste Artikel auf der Seite eines Dings öffnet sich zum Schreiben. */
  writeNext: false,
};

/** Ein eben angelegter Artikel öffnet sich zum Schreiben, nicht zum Lesen. */
export function openForWriting() {
  if (memory.mode === 'read') memory.mode = 'live';
  memory.writeNext = true;
}

/** Auf der Seite eines Dings beginnt der Text gesetzt – außer er wurde eben angelegt. */
function embeddedMode(): WikiMode {
  if (!memory.writeNext) return 'read';
  return memory.mode === 'source' ? 'source' : 'live';
}

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
  const data = useData();
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
  // Der Ordner oder der Steckbrief schlägt die Art vor; sie steht dann oben.
  const folder = kindFromFolder(data.articles, article);
  const stated = folder ? null : statedKind(articleFacts(data.articles, article));
  const suggested = folder?.kind ?? stated?.kind ?? null;
  const kinds = suggested
    ? [suggested, ...ADOPT_KINDS.filter((kind) => kind !== suggested)]
    : ADOPT_KINDS;
  return (
    <>
      <Button
        ref={anchor}
        size="sm"
        icon={<Plus />}
        onClick={() => setOpen((o) => !o)}
        title="Sagen, was dieser Text beschreibt – dann hat er eine eigene Seite mit Steckbrief"
        aria-label="Art festlegen"
      >
        <span className="wf-lk-act__label">Art festlegen</span>
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        align="right"
        width={230}
        className="wf-wiki-adopt"
      >
        {kinds.map((kind) => (
          <MenuItem
            key={kind}
            icon={<KindIcon kind={kind} />}
            active={kind === suggested}
            onClick={() => adopt(kind)}
          >
            als {KIND_LABEL[kind]}
            {kind === suggested && (
              <span className="wf-mute">
                {folder ? ` – liegt in „${folder.folder}“` : ' – laut Steckbrief'}
              </span>
            )}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}

/**
 * Die Artikel als Übersicht: die obersten Ordner als Regal, darunter was der KI-Leser und die
 * Steckbriefe vorschlagen. Was noch zu schreiben ist, steht in der Sicht „Noch zu schreiben“
 * (`welt/Gaps.tsx`). Steht auf der Startseite der Welt.
 */
export function WikiStart() {
  const data = useData();
  const [, navigate] = useLocation();
  const articles = data.articles;
  const hidden = useMemo(() => roomArticleIds(data), [data]);
  const tree = useMemo(() => articleTree(articles, hidden), [articles, hidden]);
  const total = Object.keys(articles).length - tree.templates.length;
  if (!Object.keys(articles).length)
    return (
      <div className="wf-wiki-landing">
        <EmptyState
          icon={<Library />}
          title="Noch keine Artikel"
          action={
            <div className="wf-row" style={{ gap: 'var(--s-3)' }}>
              <Button icon={<FilePlus2 />} onClick={() => openNew({ kind: null, withText: true })}>
                Ersten Text schreiben
              </Button>
              <Button onClick={() => navigate('/einstellungen')}>LegendKeeper übernehmen</Button>
            </div>
          }
        >
          Hier stehen die Artikel über deine Welt. Schreib sie direkt hier – oder lies in den
          Einstellungen unter „LegendKeeper ganz übernehmen“ die Exportdatei deines
          LegendKeeper-Projekts ein, mit allen Artikeln, Karten und Steckbriefen.
        </EmptyState>
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
  const data = useData();
  const articles = data.articles;
  // Die Räume eines Ortes stehen auf seiner Seite, nicht im Baum – außer der gerade offene.
  const hidden = useMemo(() => {
    const ids = roomArticleIds(data);
    if (current) ids.delete(current);
    return ids;
  }, [data, current]);
  const tree = useMemo(() => articleTree(articles, hidden), [articles, hidden]);
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

  /** Alle Ordner auf einmal auf- oder zuklappen. */
  const unfoldAll = (show: boolean) => {
    const ids = new Set<string>();
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes)
        if (node.children.length) {
          ids.add(node.article.id);
          walk(node.children);
        }
    };
    if (show) walk(tree.roots);
    setOpen(ids);
  };
  const hasFolders = tree.roots.some((node) => node.children.length > 0);

  return (
    <div role="tree">
      {hasFolders && (
        <div className="wf-welt-unfold wf-wiki-unfold">
          <button
            type="button"
            className="wf-welt-linkish"
            title="Alle Ordner aufklappen"
            onClick={() => unfoldAll(true)}
          >
            <ChevronsUpDown aria-hidden /> Alles aufklappen
          </button>
          <button
            type="button"
            className="wf-welt-linkish"
            title="Alle Ordner zuklappen"
            onClick={() => unfoldAll(false)}
          >
            <ChevronsDownUp aria-hidden /> Alles zuklappen
          </button>
        </div>
      )}
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
 * Ein Artikel zum Lesen und Schreiben – für sich oder als Text auf der Seite eines
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
  const [mode, setMode] = useState<WikiMode>(() => (embedded ? embeddedMode() : memory.mode));
  /** Zuletzt benutzte Schreibansicht – dorthin wechselt Strg+E. */
  const lastEdit = useRef<WikiMode>(memory.mode === 'source' ? 'source' : 'live');
  const [creating, setCreating] = useState<{ parent: Article | null; title: string } | null>(null);
  useEffect(() => {
    // Die Seite eines Dings merkt sich keine Ansicht: Dort beginnt der Text immer gesetzt.
    if (!embedded) memory.mode = mode;
    memory.writeNext = false;
    if (mode !== 'read') lastEdit.current = mode;
  }, [mode, embedded]);

  // Strg+E (am Mac Befehl+E) wechselt zwischen Lesen und Schreiben – solange ein Artikel offen
  // ist, gehört ihm das Kürzel allein (F17; `shell/shortcuts.ts`), Festhalten bleibt in der Leiste.
  useShortcut('e', () => {
    flushEdits();
    setMode((current) => (current === 'read' ? lastEdit.current : 'read'));
  });

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
        embedded={embedded}
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
            {/* Auf der Seite eines Dings stehen Gerüst und Steckbrief im Kasten oben. */}
            {!embedded && <ScaffoldHint article={article} />}
            {!embedded && <FactsHint article={article} />}
            {!article.template && <MaterialBox owner={{ type: 'article', id: article.id }} />}
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
