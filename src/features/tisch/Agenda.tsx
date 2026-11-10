/** „Anstehend“: Überfälliges, kommende Termine, Fristen von Abmachungen und laufende Wirkungen. */
import { useMemo } from 'react';
import { Link } from 'wouter';
import { CalendarDays, Check, Flag, Handshake, Hourglass, Milestone } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { openQuickLog } from '../../shell/commands';
import { Button, EntityLinks, Panel, toast } from '../../ui';
import { settleAgendaItem } from './commands';
import { buildAgenda, type AgendaItem } from './model';

/** So viele Tage voraus zeigt der Spieltisch Termine. */
const DAYS_AHEAD = 7;

function icon(item: AgendaItem) {
  if (item.source === 'timer') return <Hourglass />;
  if (item.source === 'promise') return <Handshake />;
  if (item.label === 'Frist') return <Flag />;
  if (item.label === 'Vorhaben') return <Milestone />;
  return <CalendarDays />;
}

function AgendaRow({ item }: { item: AgendaItem }) {
  const db = useDb();
  const links = [...new Set([item.placeId, ...item.refs])]
    .filter((id): id is string => !!id)
    .slice(0, 3);
  const settle = () => {
    settleAgendaItem(db, item);
    toast({
      title: item.source === 'timer' ? 'Beendet' : item.checkLabel,
      body: item.title,
      action: { label: 'Rückgängig', run: () => settleAgendaItem(db, item, false) },
    });
  };
  return (
    <div className="wf-tisch-due" data-tone={item.tone}>
      <span className="wf-tisch-due__mark" title={item.label}>
        {icon(item)}
      </span>
      <div className="wf-tisch-due__main">
        <div className="wf-tisch-due__title wf-clamp-2" title={item.title}>
          {item.title}
        </div>
        <div className="wf-tisch-due__meta">
          <span className="wf-tisch-due__when" title={item.date}>
            {item.when}
          </span>
          <span>{item.label}</span>
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
          onClick={settle}
        >
          <Check />
        </button>
      )}
    </div>
  );
}

export function AgendaPanel() {
  const data = useData();
  const items = useMemo(() => buildAgenda(data, DAYS_AHEAD), [data]);
  const overdue = items.filter((item) => item.tone === 'overdue').length;
  return (
    <Panel
      flush
      scroll
      className="wf-tisch-agenda"
      title={
        <>
          Anstehend
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
            In den nächsten {DAYS_AHEAD} Tagen steht nichts an. Hier erscheinen Termine, Fristen,
            Abmachungen mit Frist und laufende Wirkungen.
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
        items.map((item) => <AgendaRow key={item.key} item={item} />)
      )}
    </Panel>
  );
}
