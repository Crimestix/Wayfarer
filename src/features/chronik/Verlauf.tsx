/** Ansicht „Verlauf“: Filter, Zeitstrahl aller Einträge und die offenen Abmachungen daneben. */
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  BookOpen,
  Check,
  FilterX,
  Handshake,
  ListFilter,
  Search,
  X,
} from 'lucide-react';
import { setPromiseDone } from '../../data/actions';
import { useData, useDb } from '../../data/hooks';
import { chronicleSorted, openPromises } from '../../domain/derive';
import { CHRONICLE_KINDS, type ChronicleEntry, type ChronicleKind } from '../../domain/schema';
import { openQuickLog } from '../../shell/commands';
import {
  Button,
  CHRONICLE_KIND_ICON,
  EmptyState,
  EntityPicker,
  IconButton,
  Input,
  KindIcon,
  Panel,
  Select,
  cx,
  toast,
} from '../../ui';
import { Caps } from './parts';
import { TIMELINE_PAGE, Timeline } from './Timeline';
import {
  EMPTY_FILTER,
  KIND_SHORT,
  buildSearchIndex,
  filterEntries,
  isFilterActive,
  isOverdue,
  mentionCounts,
  promiseDueLabel,
  promiseParties,
  sessionLabel,
  sessionMarkers,
  sessionSpans,
  timelineRows,
  type ChronicleFilter,
} from './model';

/** Reihenfolge der Marken: erst was man selbst schreibt, dann was automatisch entsteht. */
const KIND_ORDER: ChronicleKind[] = ['note', 'change', 'promise', 'travel', 'attitude', 'event'];

const KIND_COLOR: Record<ChronicleKind, string> = {
  note: 'var(--gold)',
  change: 'var(--blood-bright)',
  promise: 'var(--gold-bright)',
  travel: 'var(--verdigris)',
  attitude: 'var(--arcane)',
  event: 'var(--ember)',
};

function FilterBar({
  filter,
  onChange,
}: {
  filter: ChronicleFilter;
  onChange: (filter: ChronicleFilter) => void;
}) {
  const data = useData();
  const spans = useMemo(() => sessionSpans(data).reverse(), [data]);
  const set = (change: Partial<ChronicleFilter>) => onChange({ ...filter, ...change });
  const toggleKind = (kind: ChronicleKind) =>
    set({ kinds: filter.kinds.includes(kind) ? filter.kinds.filter((k) => k !== kind) : [...filter.kinds, kind] });
  // Strg+F springt in die Suche, wie man es von jedem Programm kennt.
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'f') return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      search.current?.focus();
      search.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="wf-chronik-filter">
      <div className="wf-chronik-filter__row">
        <label className="wf-chronik-search" title="Sucht in Texten und in den Namen von Orten und Beteiligten (Strg+F)">
          <Search aria-hidden />
          <Input
            ref={search}
            value={filter.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="Im Verlauf suchen …"
            aria-label="Im Verlauf suchen"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filter.query) {
                e.stopPropagation();
                set({ query: '' });
              }
            }}
          />
          {filter.query && (
            <button type="button" aria-label="Suche leeren" title="Suche leeren" onClick={() => set({ query: '' })}>
              <X />
            </button>
          )}
        </label>
        <Select
          value={filter.session}
          onChange={(e) => set({ session: e.target.value })}
          aria-label="Session"
          data-active={filter.session !== 'all' || undefined}
        >
          <option value="all">Alle Sessions</option>
          {spans.map(({ session }) => (
            <option key={session.id} value={session.id}>
              {sessionLabel(session)}
            </option>
          ))}
          <option value="none">Ohne Session</option>
        </Select>
        <div data-active={filter.entityId !== null || undefined}>
          <EntityPicker
            value={filter.entityId}
            onChange={(entityId) => set({ entityId })}
            placeholder="Betrifft …"
            allowParty
          />
        </div>
        <div data-active={filter.placeId !== null || undefined} title="Zeigt auch, was an Orten darunter geschah">
          <EntityPicker
            value={filter.placeId}
            onChange={(placeId) => set({ placeId })}
            kinds={['place']}
            placeholder="Ort …"
          />
        </div>
      </div>
      <div className="wf-chronik-filter__row" role="group" aria-label="Art der Einträge">
        {KIND_ORDER.filter((kind) => CHRONICLE_KINDS.includes(kind)).map((kind) => {
          const Icon = CHRONICLE_KIND_ICON[kind];
          return (
            <button
              key={kind}
              type="button"
              className="wf-chronik-chip"
              style={{ '--chip-color': KIND_COLOR[kind] } as CSSProperties}
              aria-pressed={filter.kinds.includes(kind)}
              onClick={() => toggleKind(kind)}
            >
              <Icon />
              {KIND_SHORT[kind]}
            </button>
          );
        })}
        {filter.openPromisesOnly && (
          <button
            type="button"
            className="wf-chronik-chip"
            style={{ '--chip-color': KIND_COLOR.promise } as CSSProperties}
            aria-pressed
            title="Vorwahl aufheben"
            onClick={() => set({ openPromisesOnly: false })}
          >
            <Check />
            Nur offene Abmachungen
            <X />
          </button>
        )}
      </div>
    </div>
  );
}

function OpenPromises({
  onEdit,
  onShow,
  shown,
}: {
  onEdit: (entry: ChronicleEntry) => void;
  onShow: () => void;
  /** Die Vorwahl ist im Verlauf gerade aktiv. */
  shown: boolean;
}) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const open = useMemo(() => openPromises(data), [data]);
  // Die Abmachung verschwindet beim Abhaken aus dieser Liste – ein Fehlgriff muss sich zurücknehmen lassen.
  const done = (entry: ChronicleEntry) => {
    setPromiseDone(db, entry.id, true);
    toast({
      title: 'Abmachung erledigt',
      body: entry.text.slice(0, 120),
      action: { label: 'Rückgängig', run: () => setPromiseDone(db, entry.id, false) },
    });
  };
  return (
    <Panel
      className="wf-chronik-promises"
      title="Offene Abmachungen"
      count={open.length}
      actions={
        open.length > 0 && (
          <IconButton
            size="sm"
            variant="ghost"
            label="Im Verlauf nur offene Abmachungen zeigen"
            onClick={onShow}
            disabled={shown}
          >
            <ListFilter />
          </IconButton>
        )
      }
      flush
      scroll
    >
      {open.length === 0 ? (
        <EmptyState
          icon={<Handshake />}
          title="Nichts offen"
          action={
            <Button size="sm" onClick={() => openQuickLog({ kind: 'promise' })}>
              Abmachung festhalten
            </Button>
          }
        >
          Versprechen, Schulden und Aufträge bleiben hier stehen, bis du sie abhakst.
        </EmptyState>
      ) : (
        open.map((entry) => {
          const late = isOverdue(entry, now);
          const who = promiseParties(data, entry);
          return (
            <div key={entry.id} className={cx('wf-chronik-promise', late && 'wf-chronik-promise--late')}>
              <button
                type="button"
                className="wf-chron__check"
                aria-label="Als erledigt abhaken"
                title="Als erledigt abhaken"
                aria-pressed={false}
                onClick={() => done(entry)}
              />
              <button type="button" className="wf-chronik-promise__body" onClick={() => onEdit(entry)} title="Abmachung öffnen">
                <span className="wf-chronik-promise__text wf-clamp-2">{entry.text || 'Ohne Text'}</span>
                <span className="wf-chronik-promise__meta">
                  {who.length > 0 && <span className="wf-clamp-1">{who.join(', ')}</span>}
                  <span className="wf-chronik-promise__due wf-num">{promiseDueLabel(cal, entry, now)}</span>
                </span>
              </button>
            </div>
          );
        })
      )}
    </Panel>
  );
}

/** Wer und was in der aktuellen Auswahl am häufigsten vorkommt – ein Klick grenzt darauf ein. */
function Mentions({
  entries,
  filtered,
  entityId,
  onPick,
}: {
  entries: ChronicleEntry[];
  /** Es ist ein Filter gesetzt. */
  filtered: boolean;
  entityId: string | null;
  onPick: (entityId: string | null) => void;
}) {
  const data = useData();
  const counts = useMemo(
    () => mentionCounts(entries, 40).filter((c) => data.entities[c.id]).slice(0, 10),
    [entries, data.entities],
  );
  if (!counts.length) return null;
  return (
    <Panel className="wf-chronik-mentions" title={filtered ? 'In dieser Auswahl genannt' : 'Häufig genannt'} flush scroll>
      {counts.map(({ id, count }) => {
        const entity = data.entities[id]!;
        const active = id === entityId;
        return (
          <button
            key={id}
            type="button"
            className="wf-chronik-mention"
            aria-pressed={active}
            title={active ? 'Eingrenzung aufheben' : `Nur zeigen, was ${entity.name} betrifft`}
            onClick={() => onPick(active ? null : id)}
          >
            <KindIcon kind={entity.kind} />
            <span className="wf-grow wf-clamp-1">{entity.name}</span>
            {active ? <X /> : <span className="wf-chronik-mention__count wf-num">{count}</span>}
          </button>
        );
      })}
    </Panel>
  );
}

/**
 * Wo man im Verlauf zuletzt stand – solange die App läuft. Nach einem Abstecher zu einer Person
 * oder einem Ort steht man wieder an derselben Stelle.
 */
const position = { key: '', top: 0, limit: TIMELINE_PAGE };
const rememberLimit = (limit: number) => {
  position.limit = limit;
};

export function Verlauf({
  filter,
  onFilter,
  newestFirst,
  onNewestFirst,
  onEdit,
  onBackfill,
  onOpenSession,
}: {
  filter: ChronicleFilter;
  onFilter: (filter: ChronicleFilter) => void;
  newestFirst: boolean;
  onNewestFirst: (value: boolean) => void;
  onEdit: (entry: ChronicleEntry) => void;
  onBackfill: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const data = useData();
  const scroll = useRef<HTMLDivElement>(null);
  // Tippen bleibt flüssig, auch wenn die Liste lang ist.
  const applied = useDeferredValue(filter);
  const { chronicle, entities, sessions } = data;
  const sorted = useMemo(() => chronicleSorted(data), [chronicle]);
  const searchIndex = useMemo(() => buildSearchIndex(data), [chronicle, entities]);
  const spans = useMemo(() => sessionSpans(data), [chronicle, sessions, data.state.sessionId]);
  const visible = useMemo(
    () => filterEntries(data, sorted, applied, searchIndex),
    [sorted, applied, searchIndex, entities],
  );
  const active = isFilterActive(applied);
  const rows = useMemo(() => {
    const markers =
      applied.session !== 'all'
        ? []
        : sessionMarkers(spans, active ? new Set(visible.map((e) => e.sessionId ?? '')) : undefined);
    return timelineRows(visible, markers, newestFirst);
  }, [visible, spans, applied.session, active, newestFirst]);

  const resetKey = JSON.stringify([applied, newestFirst]);
  const initialLimit = position.key === resetKey ? position.limit : TIMELINE_PAGE;
  useLayoutEffect(() => {
    if (scroll.current && position.key === resetKey) scroll.current.scrollTop = position.top;
    // Nur beim Öffnen der Ansicht.
  }, []);
  // Andere Auswahl oder Reihenfolge: wieder von oben.
  const shownKey = useRef(resetKey);
  useEffect(() => {
    if (shownKey.current === resetKey) return;
    shownKey.current = resetKey;
    Object.assign(position, { key: resetKey, top: 0, limit: TIMELINE_PAGE });
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [resetKey]);

  const total = sorted.length;
  return (
    <div className="wf-chronik-verlauf">
      <div className="wf-chronik-main">
        {total > 0 && <FilterBar filter={filter} onChange={onFilter} />}
        <Panel
          className="wf-chronik-fill"
          flush
          title={
            <Caps>
              {total === 0
                ? 'Verlauf'
                : active
                  ? `${visible.length.toLocaleString('de-DE')} von ${total.toLocaleString('de-DE')} Einträgen`
                  : total === 1
                    ? '1 Eintrag'
                    : `${total.toLocaleString('de-DE')} Einträge`}
            </Caps>
          }
          actions={
            total > 0 && (
              <>
                {isFilterActive(filter) && (
                  <Button size="sm" icon={<FilterX />} onClick={() => onFilter(EMPTY_FILTER)}>
                    Filter zurücksetzen
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={newestFirst ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
                  onClick={() => onNewestFirst(!newestFirst)}
                  title="Reihenfolge umkehren"
                >
                  {newestFirst ? 'Neueste zuerst' : 'Älteste zuerst'}
                </Button>
              </>
            )
          }
        >
          <div
            className="wf-chronik-scroll"
            ref={scroll}
            onScroll={(e) => {
              position.key = resetKey;
              position.top = e.currentTarget.scrollTop;
            }}
          >
            {total === 0 ? (
              <EmptyState
                icon={<BookOpen />}
                title="Die Chronik ist noch leer"
                action={
                  <div className="wf-row">
                    <Button variant="primary" onClick={() => openQuickLog()}>
                      Etwas festhalten
                    </Button>
                    <Button onClick={onBackfill}>Vergangenes nachtragen</Button>
                  </div>
                }
              >
                Hier sammelt sich alles, was am Tisch geschieht: Notizen, Ortswechsel, Abmachungen und
                Veränderungen der Welt.
              </EmptyState>
            ) : visible.length === 0 ? (
              <EmptyState
                icon={<Search />}
                title="Nichts gefunden"
                action={
                  <Button icon={<FilterX />} onClick={() => onFilter(EMPTY_FILTER)}>
                    Filter zurücksetzen
                  </Button>
                }
              >
                Kein Eintrag passt zu dieser Auswahl.
              </EmptyState>
            ) : (
              <Timeline
                key={resetKey}
                rows={rows}
                onEdit={onEdit}
                onOpenSession={onOpenSession}
                initialLimit={initialLimit}
                onLimit={rememberLimit}
              />
            )}
          </div>
        </Panel>
      </div>
      <aside className="wf-chronik-side">
        <OpenPromises
          onEdit={onEdit}
          shown={filter.openPromisesOnly}
          onShow={() => onFilter({ ...EMPTY_FILTER, openPromisesOnly: true })}
        />
        <Mentions
          entries={visible}
          filtered={active}
          entityId={filter.entityId}
          onPick={(entityId) => onFilter({ ...filter, entityId })}
        />
      </aside>
    </div>
  );
}
