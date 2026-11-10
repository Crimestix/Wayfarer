/** Artikel in LegendKeeper finden: Suche nach Titel und Text, Vorschläge, Verknüpfen. */
import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Link2,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { Button, EmptyState, IconButton, Input } from '../../ui';
import type { OpenTarget } from './Article';
import { shortPath } from './model';
import {
  descendantCount,
  finderHits,
  mergeHits,
  suggestForName,
  type Catalog,
  type CatalogEntry,
  type FinderHit,
} from './catalog';
import { searchRemote } from './client';
import { describeError } from './errors';
import { useDebounced, useLoad } from './hooks';
import { entryNames, type EntriesByArticle, type LinkedEntry } from './links';
import { ensureCatalog, useCatalog } from './state';

const HIT_LIMIT = 30;

/** Sagt, dass ein Artikel schon zu einem anderen Eintrag gehört – man verknüpft ihn selten doppelt. */
function TakenNote({ entries }: { entries: LinkedEntry[] }) {
  return (
    <span className="wf-lk-taken">
      <Link2 aria-hidden />
      Schon verknüpft mit {entryNames(entries)}
    </span>
  );
}

function HitRow({
  hit,
  taken,
  active,
  onPeek,
  onLink,
  onHover,
}: {
  hit: FinderHit;
  /** Einträge, die bereits mit diesem Artikel verknüpft sind. */
  taken: LinkedEntry[];
  active: boolean;
  onPeek: () => void;
  onLink: () => void;
  onHover: () => void;
}) {
  const path = shortPath(hit.path);
  return (
    <li className="wf-lk-hit" data-active={active} onMouseMove={onHover}>
      <button
        type="button"
        className="wf-lk-hit__main"
        onClick={onPeek}
        title="Artikel ansehen, ohne ihn zu verknüpfen"
      >
        <span className="wf-lk-hit__title">
          {hit.title}
          {hit.hidden && (
            <span
              title="In LegendKeeper vor den Spielern verborgen"
              style={{ display: 'inline-flex' }}
            >
              <EyeOff aria-label="Verborgen" />
            </span>
          )}
          {hit.tags.length > 0 && (
            <span className="wf-lk-hit__tags">{hit.tags.slice(0, 3).join(' · ')}</span>
          )}
        </span>
        <span className="wf-lk-hit__path" title={hit.path.join(' › ')}>
          {hit.path.length === 0 && 'Oberste Ebene'}
          {path.skipped > 0 && (
            <span>
              …<i aria-hidden>›</i>
            </span>
          )}
          {path.steps.map((step, index) => (
            <span key={index}>
              {index > 0 && <i aria-hidden>›</i>}
              {step}
            </span>
          ))}
        </span>
        {hit.snippet && (
          <span className="wf-lk-hit__snippet">
            {hit.snippet.before}
            <mark>{hit.snippet.match}</mark>
            {hit.snippet.after}
          </span>
        )}
        {taken.length > 0 && <TakenNote entries={taken} />}
      </button>
      <Button size="sm" variant={active ? 'primary' : 'default'} icon={<Link2 />} onClick={onLink}>
        Verknüpfen
      </Button>
    </li>
  );
}

/** Der Baum von LegendKeeper zum Durchblättern – für den Fall, dass einem der Name nicht einfällt. */
function TreeRows({
  catalog,
  linked,
  entries,
  depth,
  open,
  onToggle,
  onPeek,
  onLink,
}: {
  catalog: Catalog;
  linked: EntriesByArticle;
  entries: CatalogEntry[];
  depth: number;
  open: Set<string>;
  onToggle: (id: string) => void;
  onPeek: (entry: CatalogEntry) => void;
  onLink: (entry: CatalogEntry) => void;
}) {
  return (
    <>
      {entries.map((entry) => {
        const children = catalog.children.get(entry.id) ?? [];
        const expanded = open.has(entry.id);
        const taken = linked.get(entry.id) ?? [];
        return (
          <Fragment key={entry.id}>
            <li className="wf-lk-tree__row" style={{ '--wf-lk-depth': depth } as CSSProperties}>
              {children.length > 0 ? (
                <button
                  type="button"
                  className="wf-lk-tree__toggle"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? 'Zuklappen' : 'Aufklappen'}: ${entry.title}`}
                  onClick={() => onToggle(entry.id)}
                >
                  {expanded ? <ChevronDown /> : <ChevronRight />}
                </button>
              ) : (
                <span className="wf-lk-tree__toggle" aria-hidden />
              )}
              <button
                type="button"
                className="wf-lk-tree__name"
                onClick={() => onPeek(entry)}
                title="Artikel ansehen, ohne ihn zu verknüpfen"
              >
                {entry.title}
                {entry.hidden && (
                  <span
                    title="In LegendKeeper vor den Spielern verborgen"
                    style={{ display: 'inline-flex' }}
                  >
                    <EyeOff aria-label="Verborgen" />
                  </span>
                )}
                {children.length > 0 && (
                  <span className="wf-lk-tree__count">{descendantCount(catalog, entry.id)}</span>
                )}
                {taken.length > 0 && <TakenNote entries={taken} />}
              </button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Link2 />}
                className="wf-lk-tree__link"
                onClick={() => onLink(entry)}
              >
                Verknüpfen
              </Button>
            </li>
            {expanded && (
              <TreeRows
                catalog={catalog}
                linked={linked}
                entries={children}
                depth={depth + 1}
                open={open}
                onToggle={onToggle}
                onPeek={onPeek}
                onLink={onLink}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function Tree({
  catalog,
  linked,
  reloading,
  onPeek,
  onLink,
}: {
  catalog: Catalog;
  linked: EntriesByArticle;
  /** Das Verzeichnis wird gerade neu geholt. */
  reloading: boolean;
  onPeek: (entry: CatalogEntry) => void;
  onLink: (entry: CatalogEntry) => void;
}) {
  // Gibt es nur eine Wurzel (die Welt selbst), ist sie von Anfang an aufgeklappt.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(catalog.roots.length === 1 ? [catalog.roots[0]?.id ?? ''] : []),
  );
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section className="wf-lk-tree">
      <div className="wf-lk-tree__head">
        <span className="wf-lk-label">Im Baum von LegendKeeper blättern</span>
        <span className="wf-lk-tree__total">
          {catalog.entries.length.toLocaleString('de-DE')} Artikel
          <IconButton
            label="Verzeichnis neu aus LegendKeeper laden"
            size="sm"
            variant="ghost"
            className={reloading ? 'wf-lk-spinning' : undefined}
            disabled={reloading}
            onClick={() => ensureCatalog(true)}
          >
            <RefreshCw />
          </IconButton>
        </span>
      </div>
      <ul className="wf-lk-tree__list">
        <TreeRows
          catalog={catalog}
          linked={linked}
          entries={catalog.roots}
          depth={0}
          open={open}
          onToggle={toggle}
          onPeek={onPeek}
          onLink={onLink}
        />
      </ul>
    </section>
  );
}

export function Finder({
  suggest,
  projectName,
  linked,
  onLink,
  onPeek,
}: {
  /** Name des Eintrags, zu dem ein Artikel gesucht wird – für Vorschläge. */
  suggest?: string;
  projectName: string;
  /** Welche Artikel schon mit Einträgen verknüpft sind. */
  linked: EntriesByArticle;
  onLink: (target: OpenTarget) => void;
  onPeek: (target: OpenTarget) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const text = query.trim();
  const settled = useDebounced(text, 280);
  const catalog = useCatalog(true);

  // Volltext: erst wenn das Tippen kurz ruht; überholte Anfragen werden abgebrochen.
  const remote = useLoad(settled.length >= 2 ? settled : null, ({ signal }) =>
    searchRemote(settled, HIT_LIMIT, { signal }),
  );
  const remoteCurrent =
    settled === text && remote.load.status === 'ready' ? remote.load.data : null;
  const searching = text.length >= 2 && (settled !== text || remote.load.status === 'loading');
  const remoteError =
    settled === text && remote.load.status === 'failed' ? remote.load.error : null;

  const { hits, more } = useMemo(
    () => finderHits(catalog.catalog, text, remoteCurrent ?? [], HIT_LIMIT),
    [text, catalog.catalog, remoteCurrent],
  );

  const suggestions = useMemo<FinderHit[]>(() => {
    if (!suggest?.trim() || !catalog.catalog) return [];
    return mergeHits(suggestForName(catalog.catalog, suggest, 4), [], catalog.catalog);
  }, [suggest, catalog.catalog]);

  const shown = text ? hits : suggestions;
  useEffect(() => setActive(0), [text]);
  const current = shown[Math.min(active, shown.length - 1)];

  const targetOf = (hit: FinderHit): OpenTarget => ({
    resourceId: hit.resourceId,
    title: hit.title,
    documentId: hit.documentId,
  });
  // Verknüpft wird der Artikel, nicht eine einzelne Seite darin.
  const link = (hit: FinderHit) => onLink({ resourceId: hit.resourceId, title: hit.title });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, Math.max(0, shown.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && current) {
      event.preventDefault();
      link(current);
    } else if (event.key === 'Escape' && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
    }
  };

  const titleCount = hits.filter((hit) => hit.match === 'title').length;
  const loadingLine =
    catalog.status === 'loading' && !catalog.catalog
      ? `Verzeichnis von „${projectName}“ wird geladen${catalog.loaded ? ` – bisher ${catalog.loaded.toLocaleString('de-DE')} Artikel` : ''} …`
      : null;

  return (
    <div className="wf-lk-finder">
      <p className="wf-lk-finder__lead">
        Noch kein Artikel verknüpft. Suche den passenden Artikel in LegendKeeper – nach seinem Namen
        oder nach einem Wort, das darin vorkommt.
      </p>

      <div className="wf-lk-search">
        <Search aria-hidden />
        <Input
          type="text"
          role="searchbox"
          value={query}
          placeholder="Artikel in LegendKeeper suchen …"
          aria-label="Artikel in LegendKeeper suchen"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {query && (
          <IconButton
            className="wf-lk-search__clear"
            label="Suche leeren"
            size="sm"
            variant="ghost"
            onClick={() => setQuery('')}
          >
            <X />
          </IconButton>
        )}
      </div>

      {(shown.length > 0 || searching || (!text && loadingLine)) && (
        <div className="wf-lk-finder__hint">
          {shown.length > 0 && (
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> wählen · <kbd>Eingabe</kbd> verknüpft den markierten Artikel
              · ein Klick auf den Namen zeigt ihn erst an
            </span>
          )}
          {searching && (
            <span className="wf-lk-finder__busy">
              <LoaderCircle className="wf-lk-spin" aria-hidden />
              Texte werden durchsucht …
            </span>
          )}
          {!text && loadingLine && (
            <span className="wf-lk-finder__busy">
              <LoaderCircle className="wf-lk-spin" aria-hidden />
              {loadingLine}
            </span>
          )}
        </div>
      )}

      {catalog.status === 'failed' && catalog.error && (
        <p className="wf-lk-note">
          <span>
            Das Verzeichnis der Artikel ließ sich nicht laden (
            {describeError(catalog.error, 'search').title}). Die Suche arbeitet solange nur über
            LegendKeeper selbst.{' '}
            <button type="button" className="wf-lk-mention" onClick={() => ensureCatalog(true)}>
              Erneut laden
            </button>
          </span>
        </p>
      )}
      {remoteError && (
        <p className="wf-lk-note">
          <span>
            Die Suche in den Texten ist gerade nicht möglich:{' '}
            {describeError(remoteError, 'search').title}.
            {hits.length > 0 ? ' Treffer in den Titeln siehst du trotzdem.' : ''}
          </span>
        </p>
      )}

      {shown.length > 0 && (
        <ul className="wf-lk-hits" aria-label={text ? 'Treffer' : 'Vorschläge'}>
          {!text && <li className="wf-lk-hits__group">Vorschläge zu „{suggest}“</li>}
          {shown.map((hit, index) => (
            <Fragment key={`${hit.resourceId}-${hit.match}`}>
              {text && index === titleCount && titleCount > 0 && (
                <li className="wf-lk-hits__group">Im Text gefunden</li>
              )}
              <HitRow
                hit={hit}
                taken={linked.get(hit.resourceId) ?? []}
                active={hit === current}
                onHover={() => setActive(index)}
                onPeek={() => onPeek(targetOf(hit))}
                onLink={() => link(hit)}
              />
            </Fragment>
          ))}
          {text && more && (
            <li className="wf-lk-hits__more">
              Es gibt weitere Treffer. Tippe genauer, um sie einzugrenzen.
            </li>
          )}
        </ul>
      )}

      {!text && catalog.catalog && catalog.catalog.entries.length === 0 && (
        <div className="wf-lk-state">
          <EmptyState
            icon={<BookOpen />}
            title="In LegendKeeper gibt es noch keine Artikel"
            action={
              <Button
                icon={<RefreshCw />}
                disabled={catalog.status === 'loading'}
                onClick={() => ensureCatalog(true)}
              >
                Verzeichnis neu laden
              </Button>
            }
          >
            Das Projekt „{projectName}“ ist leer – oder der API-Key darf seine Artikel nicht sehen.
            Lege den Artikel in LegendKeeper an und lade das Verzeichnis dann neu.
          </EmptyState>
        </div>
      )}

      {!text && catalog.catalog && catalog.catalog.entries.length > 0 && (
        <Tree
          catalog={catalog.catalog}
          linked={linked}
          reloading={catalog.status === 'loading'}
          onPeek={(entry) => onPeek({ resourceId: entry.id, title: entry.title })}
          onLink={(entry) => onLink({ resourceId: entry.id, title: entry.title })}
        />
      )}

      {text && hits.length === 0 && !searching && !remoteError && (
        <div className="wf-lk-finder__none">
          {text.length < 2 && !catalog.catalog ? (
            'Tippe mindestens zwei Buchstaben.'
          ) : (
            <>
              Kein Artikel passt zu <strong>„{text}“</strong>. Prüfe die Schreibweise – oder lege
              den Artikel erst in LegendKeeper an.
            </>
          )}
        </div>
      )}
    </div>
  );
}
