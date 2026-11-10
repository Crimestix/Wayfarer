/** Artikel in LegendKeeper finden: Suche nach Titel und Text, Vorschläge, Verknüpfen. */
import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { EyeOff, Link2, LoaderCircle, Search, X } from 'lucide-react';
import { Button, IconButton, Input } from '../../ui';
import type { OpenTarget } from './Article';
import { mergeHits, searchCatalog, suggestForName, type FinderHit } from './catalog';
import { searchRemote } from './client';
import { describeError } from './errors';
import { useDebounced, useLoad } from './hooks';
import { ensureCatalog, useCatalog } from './state';

const HIT_LIMIT = 30;

function HitRow({
  hit,
  active,
  onPeek,
  onLink,
  onHover,
}: {
  hit: FinderHit;
  active: boolean;
  onPeek: () => void;
  onLink: () => void;
  onHover: () => void;
}) {
  return (
    <li className="wf-lk-hit" data-active={active} onMouseMove={onHover}>
      <button type="button" className="wf-lk-hit__main" onClick={onPeek} title="Artikel ansehen, ohne ihn zu verknüpfen">
        <span className="wf-lk-hit__title">
          {hit.title}
          {hit.hidden && (
            <span title="In LegendKeeper vor den Spielern verborgen" style={{ display: 'inline-flex' }}>
              <EyeOff aria-label="Verborgen" />
            </span>
          )}
        </span>
        <span className="wf-lk-hit__path">
          {hit.path.length === 0
            ? 'Oberste Ebene'
            : hit.path.map((step, index) => (
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
      </button>
      <Button size="sm" variant={active ? 'primary' : 'default'} icon={<Link2 />} onClick={onLink}>
        Verknüpfen
      </Button>
    </li>
  );
}

export function Finder({
  suggest,
  projectName,
  onLink,
  onPeek,
}: {
  /** Name des Eintrags, zu dem ein Artikel gesucht wird – für Vorschläge. */
  suggest?: string;
  projectName: string;
  onLink: (target: OpenTarget) => void;
  onPeek: (target: OpenTarget) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const text = query.trim();
  const settled = useDebounced(text, 280);
  const catalog = useCatalog(true);

  // Volltext: erst wenn das Tippen kurz ruht; überholte Anfragen werden abgebrochen.
  const remote = useLoad(settled.length >= 2 ? settled : null, ({ signal }) => searchRemote(settled, HIT_LIMIT, { signal }));
  const remoteCurrent = settled === text && remote.load.status === 'ready' ? remote.load.data : null;
  const searching = text.length >= 2 && (settled !== text || remote.load.status === 'loading');
  const remoteError = settled === text && remote.load.status === 'failed' ? remote.load.error : null;

  const hits = useMemo(() => {
    if (!text) return [];
    const local = catalog.catalog ? searchCatalog(catalog.catalog, text, HIT_LIMIT) : [];
    return mergeHits(local, remoteCurrent ?? [], catalog.catalog, HIT_LIMIT);
  }, [text, catalog.catalog, remoteCurrent]);

  const suggestions = useMemo<FinderHit[]>(() => {
    if (!suggest?.trim() || !catalog.catalog) return [];
    return mergeHits(suggestForName(catalog.catalog, suggest, 4), [], catalog.catalog);
  }, [suggest, catalog.catalog]);

  const shown = text ? hits : suggestions;
  useEffect(() => setActive(0), [text]);
  const current = shown[Math.min(active, shown.length - 1)];

  const targetOf = (hit: FinderHit): OpenTarget => ({ resourceId: hit.resourceId, title: hit.title, documentId: hit.documentId });
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
  const catalogLine =
    catalog.status === 'ready'
      ? `${catalog.loaded.toLocaleString('de-DE')} Artikel in „${projectName}“`
      : catalog.status === 'loading'
        ? `Verzeichnis von „${projectName}“ wird geladen${catalog.loaded ? ` – ${catalog.loaded.toLocaleString('de-DE')} Artikel` : ''} …`
        : null;

  return (
    <div className="wf-lk-finder">
      <p className="wf-lk-finder__lead">
        Noch kein Artikel verknüpft. Suche den passenden Artikel in LegendKeeper – nach seinem Namen oder nach einem
        Wort, das darin vorkommt.
      </p>

      <div className="wf-lk-search">
        <Search aria-hidden />
        <Input
          type="search"
          value={query}
          placeholder="Artikel in LegendKeeper suchen …"
          aria-label="Artikel in LegendKeeper suchen"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {query && (
          <IconButton className="wf-lk-search__clear" label="Suche leeren" size="sm" variant="ghost" onClick={() => setQuery('')}>
            <X />
          </IconButton>
        )}
      </div>

      <div className="wf-lk-finder__hint">
        {shown.length > 0 && (
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> wählen · <kbd>Eingabe</kbd> verknüpft den markierten Artikel · ein Klick auf den
            Namen zeigt ihn erst an
          </span>
        )}
        {searching && (
          <span className="wf-lk-finder__busy">
            <LoaderCircle className="wf-lk-spin" aria-hidden />
            Texte werden durchsucht …
          </span>
        )}
        {!text && shown.length === 0 && catalogLine && <span>{catalogLine}</span>}
      </div>

      {catalog.status === 'failed' && catalog.error && (
        <p className="wf-lk-note">
          <span>
            Das Verzeichnis der Artikel ließ sich nicht laden ({describeError(catalog.error, 'search').title}). Die Suche
            arbeitet solange nur über LegendKeeper selbst.{' '}
            <button type="button" className="wf-lk-mention" onClick={() => ensureCatalog(true)}>
              Erneut laden
            </button>
          </span>
        </p>
      )}
      {remoteError && (
        <p className="wf-lk-note">
          <span>
            Die Suche in den Texten ist gerade nicht möglich: {describeError(remoteError, 'search').title}.
            {hits.length > 0 ? ' Treffer in den Titeln siehst du trotzdem.' : ''}
          </span>
        </p>
      )}

      {shown.length > 0 && (
        <ul className="wf-lk-hits" aria-label={text ? 'Treffer' : 'Vorschläge'}>
          {!text && <li className="wf-lk-hits__group">Vorschläge zu „{suggest}“</li>}
          {shown.map((hit, index) => (
            <Fragment key={`${hit.resourceId}-${hit.match}`}>
              {text && index === titleCount && titleCount > 0 && <li className="wf-lk-hits__group">Im Text gefunden</li>}
              <HitRow
                hit={hit}
                active={hit === current}
                onHover={() => setActive(index)}
                onPeek={() => onPeek(targetOf(hit))}
                onLink={() => link(hit)}
              />
            </Fragment>
          ))}
        </ul>
      )}

      {text && hits.length === 0 && !searching && !remoteError && (
        <div className="wf-lk-finder__none">
          {text.length < 2 && !catalog.catalog ? (
            'Tippe mindestens zwei Buchstaben.'
          ) : (
            <>
              Kein Artikel passt zu <strong>„{text}“</strong>. Prüfe die Schreibweise – oder lege den Artikel erst in
              LegendKeeper an.
            </>
          )}
        </div>
      )}
    </div>
  );
}
