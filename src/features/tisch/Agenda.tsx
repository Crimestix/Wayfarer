/**
 * „Sonst noch“: Überfälliges, laufende und kommende Termine, offene Abmachungen, Wirkungen –
 * soweit sie nicht schon bei einer Geschichte im Spiel stehen (`domain/play.ts`).
 */
import { Fragment, useMemo } from 'react';
import { Link } from 'wouter';
import {
  CalendarDays,
  Check,
  Flag,
  Flame,
  Handshake,
  Hourglass,
  Milestone,
  Repeat,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { playClaims, playView } from '../../domain/play';
import { openQuickLog } from '../../shell/commands';
import { Button, EntityLinks, Panel, toast } from '../../ui';
import { settleAgendaItem } from './commands';
import { buildAgenda, type AgendaItem, type AgendaMark } from './model';

/** So viele Tage voraus zeigt der Spieltisch Termine. */
const DAYS_AHEAD = 7;

const MARKS: Record<AgendaMark, LucideIcon> = {
  deadline: Flag,
  plan: Milestone,
  world: CalendarDays,
  promise: Handshake,
  effect: Hourglass,
  task: Hourglass,
  spell: Hourglass,
  light: Flame,
  clock: Milestone,
};

function AgendaRow({ item }: { item: AgendaItem }) {
  const db = useDb();
  const links = [...new Set([item.placeId, ...item.refs])]
    .filter((id): id is string => !!id)
    .slice(0, 3);
  const settle = (failed = false) => {
    settleAgendaItem(db, item, true, failed);
    toast({
      title: failed
        ? 'Abmachung gescheitert'
        : item.source === 'timer'
          ? 'Beendet'
          : item.checkLabel,
      body: item.title,
      action: { label: 'Rückgängig', run: () => settleAgendaItem(db, item, false) },
    });
  };
  const Mark = MARKS[item.mark];
  return (
    <div className="wf-tisch-due" data-tone={item.tone}>
      <span className="wf-tisch-due__mark" title={item.label}>
        <Mark />
      </span>
      <div className="wf-tisch-due__main">
        <div className="wf-tisch-due__title wf-clamp-2" title={item.title}>
          {item.title}
        </div>
        <div className="wf-tisch-due__meta">
          <span className="wf-tisch-due__when" title={item.date}>
            {item.when}
          </span>
          <span>
            {item.label}
            {item.repeats && (
              <Repeat className="wf-tisch-due__repeat" aria-label="kehrt regelmäßig wieder" />
            )}
          </span>
          {links.length > 0 && (
            <span className="wf-tisch-due__links">
              <EntityLinks ids={links} />
            </span>
          )}
        </div>
      </div>
      {item.checkable && (
        <button
          type="button"
          className="wf-chron__check wf-tisch-due__check"
          title={item.checkLabel}
          aria-label={`${item.checkLabel}: ${item.title}`}
          onClick={() => settle()}
        >
          <Check />
        </button>
      )}
      {item.checkable && item.source === 'promise' && (
        <button
          type="button"
          className="wf-chron__check wf-chron__check--fail wf-tisch-due__check"
          title="Gescheitert – gebrochen, geplatzt oder nicht mehr einzulösen"
          aria-label={`Gescheitert: ${item.title}`}
          onClick={() => settle(true)}
        >
          <X />
        </button>
      )}
    </div>
  );
}

export function AgendaPanel() {
  const data = useData();
  const items = useMemo(() => {
    // Was bei einer Geschichte im Spiel steht, steht hier nicht noch einmal.
    const claimed = playClaims(playView(data));
    return buildAgenda(data, DAYS_AHEAD).filter(
      (item) => !claimed.has(`${item.source}:${item.id}`),
    );
  }, [data]);
  const overdue = items.filter((item) => item.tone === 'overdue').length;
  return (
    <Panel
      flush
      scroll
      className="wf-tisch-agenda"
      title={
        <>
          Sonst noch
          {overdue > 0 && <span className="wf-tisch-agenda__overdue">{overdue} überfällig</span>}
        </>
      }
      actions={
        <Link
          href="/kalender"
          className="wf-btn wf-btn--ghost wf-btn--sm"
          title="Den Kalender öffnen"
        >
          Kalender
        </Link>
      }
    >
      {items.length === 0 ? (
        <div className="wf-tisch-agenda__empty">
          <p className="wf-tisch-hint">
            In den nächsten {DAYS_AHEAD} Tagen steht sonst nichts an. Hier erscheinen Termine,
            Fristen, offene Abmachungen und laufende Wirkungen, die zu keiner Geschichte im Spiel
            gehören.
          </p>
          <div className="wf-row-wrap">
            <Link href="/kalender" className="wf-btn wf-btn--sm">
              <CalendarDays />
              Termin anlegen
            </Link>
            <Button
              size="sm"
              icon={<Handshake />}
              onClick={() => openQuickLog({ kind: 'promise' })}
            >
              Abmachung festhalten
            </Button>
          </div>
        </div>
      ) : (
        items.map((item, i) => (
          <Fragment key={item.key}>
            {item.undated && !items[i - 1]?.undated && (
              <div className="wf-tisch-subtitle wf-tisch-agenda__open">Offen, ohne Frist</div>
            )}
            <AgendaRow item={item} />
          </Fragment>
        ))
      )}
    </Panel>
  );
}
