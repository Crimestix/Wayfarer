/** Übersicht links: suchen, nach Art filtern, Orte als Baum, alles andere als Liste. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronRight, Footprints, Plus, Search, X } from 'lucide-react';
import { useData } from '../../data/hooks';
import { KIND_LABEL, KIND_LABEL_PLURAL, entitiesOfKind } from '../../domain/derive';
import { AttitudeBadge, Button, EmptyState, IconButton, Input, KindIcon, cx } from '../../ui';
import { openEntityDialog } from './editor';
import {
  WORLD_KINDS,
  entitySubline,
  openAncestors,
  partyAttitudes,
  placeTreeRows,
  searchWorld,
  worldCounts,
  type KindFilter,
  type WorldEntity,
  type WorldKind,
} from './model';

/** Merkt sich Filter, Suche und aufgeklappte Orte, solange die App läuft. */
const memory: { filter: KindFilter; query: string; open: Record<string, boolean> } = {
  filter: 'all',
  query: '',
  open: {},
};

const EMPTY_HINT: Record<WorldKind, string> = {
  place: 'Regionen, Städte, Gebäude, Wildnis – alles, wo die Gruppe sein kann.',
  person: 'Alle Figuren der Welt, die nicht von Spielern geführt werden.',
  faction: 'Häuser, Gilden, Orden und Kulte mit eigenen Zielen.',
  item: 'Artefakte, Schriftstücke und andere Dinge von Bedeutung.',
  topic: 'Gerüchte, Glaubensfragen und Handlungsfäden.',
};

export function Sidebar({ selected }: { selected: WorldEntity | undefined }) {
  const data = useData();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<KindFilter>(memory.filter);
  const [query, setQuery] = useState(memory.query);
  const [open, setOpen] = useState(memory.open);
  const list = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    memory.filter = filter;
    memory.query = query;
    memory.open = open;
  }, [filter, query, open]);

  // Der gewählte Eintrag soll in der Übersicht zu sehen sein.
  const selectedId = selected?.id;
  const selectedKind = selected?.kind;
  useEffect(() => {
    if (!selectedId || !selectedKind) return;
    setFilter((f) => (f === 'all' || f === selectedKind ? f : 'all'));
    if (selectedKind === 'place') setOpen((o) => openAncestors(dataRef.current, selectedId, o));
  }, [selectedId, selectedKind]);
  // Erst rollen, wenn die Zeile nach dem Aufklappen wirklich da ist – und nur nach einer neuen Auswahl.
  const scrollPending = useRef(true);
  useEffect(() => {
    scrollPending.current = true;
  }, [selectedId]);
  useEffect(() => {
    if (!scrollPending.current) return;
    const row = list.current?.querySelector('[aria-current="page"]');
    if (!row) return;
    scrollPending.current = false;
    row.scrollIntoView({ block: 'nearest' });
  });

  const counts = useMemo(() => worldCounts(data), [data]);
  const total = WORLD_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
  const attitudes = useMemo(() => partyAttitudes(data), [data]);
  const searching = query.trim() !== '';
  const hits = useMemo(
    () => (searching ? searchWorld(data, query, filter) : []),
    [data, query, filter, searching],
  );
  const tree = useMemo(() => placeTreeRows(data, open), [data, open]);
  const createKind: WorldKind = filter === 'all' ? 'person' : filter;
  const create = (preset?: { name: string }) =>
    openEntityDialog({ mode: 'create', kind: createKind, preset });

  const row = (entity: WorldEntity, withKind: boolean): ReactNode => (
    <Link
      key={entity.id}
      href={`/welt/${entity.id}`}
      className="wf-welt-row"
      aria-current={entity.id === selectedId ? 'page' : undefined}
    >
      <span className="wf-welt-row__icon">
        {entity.image ? <img src={entity.image} alt="" /> : <KindIcon kind={entity.kind} />}
      </span>
      <span className="wf-welt-row__main">
        <span className="wf-welt-row__name wf-clamp-1">{entity.name}</span>
        <span className="wf-welt-row__sub wf-clamp-1">
          {[withKind && KIND_LABEL[entity.kind], entitySubline(data, entity)]
            .filter(Boolean)
            .join(' · ') || entity.tagline}
        </span>
      </span>
      {(entity.kind === 'person' || entity.kind === 'faction') && (
        <AttitudeBadge value={attitudes.get(entity.id) ?? null} label={false} />
      )}
    </Link>
  );

  const places = (
    <div className="wf-welt-tree">
      {tree.map(({ place, depth, childCount, open: isOpen, partyHere, partyBelow }) => (
        <div key={place.id} className="wf-welt-tree__row" style={{ paddingLeft: 6 + depth * 16 }}>
          {childCount > 0 ? (
            <button
              type="button"
              className="wf-welt-twist"
              aria-expanded={isOpen}
              aria-label={isOpen ? `${place.name} zuklappen` : `${place.name} aufklappen`}
              onClick={() => setOpen((o) => ({ ...o, [place.id]: !isOpen }))}
            >
              <ChevronRight />
            </button>
          ) : (
            <span className="wf-welt-twist wf-welt-twist--leaf" />
          )}
          <Link
            href={`/welt/${place.id}`}
            className="wf-welt-row wf-welt-row--place"
            aria-current={place.id === selectedId ? 'page' : undefined}
          >
            <span className="wf-welt-row__name wf-clamp-1">{place.name}</span>
            <span className="wf-welt-row__sub wf-clamp-1">
              {place.place.category}
              {!isOpen && childCount > 0 && ` · ${childCount}`}
            </span>
            {(partyHere || (partyBelow && !isOpen)) && (
              <span
                className={cx('wf-welt-row__party', !partyHere && 'wf-welt-row__party--below')}
                title={partyHere ? 'Die Gruppe ist hier' : 'Die Gruppe ist in einem Ort darunter'}
              >
                <Footprints />
              </span>
            )}
          </Link>
        </div>
      ))}
    </div>
  );

  const kinds = filter === 'all' ? WORLD_KINDS.filter((kind) => counts[kind] > 0) : [filter];

  return (
    <aside className="wf-welt-side" aria-label="Übersicht der Weltdatenbank">
      <div className="wf-welt-side__head">
        <div className="wf-spread">
          <Link href="/welt" className="wf-welt-side__title">
            Welt
          </Link>
          <Button variant="primary" size="sm" icon={<Plus />} onClick={() => create()}>
            Neu
          </Button>
        </div>
        <div className="wf-welt-search">
          <Search />
          <Input
            value={query}
            placeholder="Suchen …"
            aria-label="In der Welt suchen"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits[0]) navigate(`/welt/${hits[0].id}`);
              else if (e.key === 'Escape' && query) {
                e.preventDefault();
                setQuery('');
              }
            }}
          />
          {query && (
            <IconButton label="Suche leeren" size="sm" variant="ghost" onClick={() => setQuery('')}>
              <X />
            </IconButton>
          )}
        </div>
        <div className="wf-welt-filter" role="tablist" aria-label="Nach Art filtern">
          {(['all', ...WORLD_KINDS] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={filter === kind}
              onClick={() => setFilter(kind)}
            >
              {kind === 'all' ? 'Alle' : KIND_LABEL_PLURAL[kind]}
              <span>{kind === 'all' ? total : counts[kind]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="wf-welt-side__list" ref={list}>
        {searching ? (
          hits.length ? (
            <>
              <div className="wf-welt-group">
                {hits.length === 1 ? 'Ein Treffer' : `${hits.length} Treffer`}
                <span className="wf-welt-group__hint">Eingabe öffnet den ersten</span>
              </div>
              {hits.map((entity) => row(entity, filter === 'all'))}
            </>
          ) : (
            <EmptyState
              icon={<Search />}
              title="Nichts gefunden"
              action={
                <Button size="sm" icon={<Plus />} onClick={() => create({ name: query.trim() })}>
                  „{query.trim()}“ anlegen
                </Button>
              }
            >
              Kein Eintrag passt zu dieser Suche
              {filter === 'all' ? '' : ` unter ${KIND_LABEL_PLURAL[filter]}`}.
            </EmptyState>
          )
        ) : total === 0 ? (
          <EmptyState
            title="Die Welt ist noch leer"
            action={
              <Button
                size="sm"
                variant="primary"
                icon={<Plus />}
                onClick={() => openEntityDialog({ mode: 'create', kind: 'place' })}
              >
                Ersten Ort anlegen
              </Button>
            }
          >
            Beginne mit einem Ort – Personen und Fraktionen finden dort ihren Platz.
          </EmptyState>
        ) : kinds.length === 1 && counts[kinds[0]!] === 0 ? (
          <EmptyState
            icon={<KindIcon kind={kinds[0]!} />}
            title={`Noch keine ${KIND_LABEL_PLURAL[kinds[0]!]}`}
            action={
              <Button size="sm" icon={<Plus />} onClick={() => create()}>
                {KIND_LABEL[kinds[0]!]} anlegen
              </Button>
            }
          >
            {EMPTY_HINT[kinds[0]!]}
          </EmptyState>
        ) : (
          kinds.map((kind) => (
            <div key={kind}>
              {filter === 'all' && (
                <div className="wf-welt-group">
                  {KIND_LABEL_PLURAL[kind]} <span>{counts[kind]}</span>
                </div>
              )}
              {kind === 'place'
                ? places
                : entitiesOfKind(data, kind).map((entity) => row(entity, false))}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
