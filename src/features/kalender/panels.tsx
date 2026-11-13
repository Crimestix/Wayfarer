/** Leiste unter dem Raster: Anstehendes und Überfälliges, laufende Wirkungen, Monde. */
import { useRef, useState } from 'react';
import { Flame, Hammer, Plus, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { useDb } from '../../data/hooks';
import { entityName, overdueEvents, runningTimers, upcomingOccurrences } from '../../domain/derive';
import { isEveryday } from '../../domain/weight';
import type { CampaignData, Timer } from '../../domain/schema';
import {
  dayIndexOf,
  formatClock,
  formatDate,
  formatDayMonth,
  formatDuration,
  formatRelative,
  fromTime,
  moonPhase,
  type MoonDef,
  type WorldTime,
} from '../../domain/time/calendar';
import {
  Button,
  IconButton,
  MenuItem,
  MoonGlyph,
  Panel,
  Popover,
  confirmDialog,
  cx,
  toast,
} from '../../ui';
import { EventCheck } from './DayPanel';
import {
  EVENT_KIND_LABEL,
  TIMER_KIND_LABEL,
  calibrateMoon,
  overdueLabel,
  relativeDay,
  timerProgress,
} from './model';

/** Wie weit „Anstehend“ vorausschaut. */
export const UPCOMING_DAYS = 30;

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

// ── Anstehend und überfällig ───────────────────────────────────────────────

export function UpcomingPanel({
  data,
  onGoToDay,
  onCreate,
}: {
  data: CampaignData;
  onGoToDay: (dayIndex: number) => void;
  onCreate: () => void;
}) {
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const today = dayIndexOf(now);
  const overdue = overdueEvents(data);
  // Der Alltag steht hier nicht: Er liefe sonst jeden Tag durch die Liste.
  // Was sich nach Tagen wiederholt (und trotzdem zählt), steht nur mit dem nächsten Mal da.
  const daily = new Set<string>();
  const upcoming = upcomingOccurrences(data, UPCOMING_DAYS, 400)
    .filter((o) => {
      if (isEveryday(data, o.event)) return false;
      if (o.event.repeat?.unit !== 'day') return true;
      if (daily.has(o.event.id)) return false;
      daily.add(o.event.id);
      return true;
    })
    .slice(0, 40);
  return (
    <Panel
      title="Anstehend"
      flush
      scroll
      actions={<span className="wf-caps">{UPCOMING_DAYS} Tage</span>}
    >
      {overdue.length > 0 && (
        <div className="wf-kal-overdue">
          <div className="wf-kal-sub wf-kal-sub--blood">Überfällig</div>
          {overdue.map((event) => (
            <div key={event.id} className={cx('wf-kal-row', `wf-kal-kind--${event.kind}`)}>
              <EventCheck event={event} />
              <button
                type="button"
                className="wf-kal-row__main"
                onClick={() => onGoToDay(dayIndexOf(event.at))}
                title="Im Kalender zeigen"
              >
                <span className="wf-kal-row__title">{event.title}</span>
                <span className="wf-kal-row__meta">
                  <b>{overdueLabel(now, event)}</b> · {EVENT_KIND_LABEL[event.kind]} ·{' '}
                  {formatDayMonth(cal, event.at)}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
      {upcoming.map((o) => {
        const day = dayIndexOf(o.at);
        const when =
          day === today && o.event.timed ? formatRelative(now, o.at) : relativeDay(today, day);
        return (
          <button
            key={o.event.id + o.at}
            type="button"
            className={cx('wf-kal-row', `wf-kal-kind--${o.event.kind}`)}
            onClick={() => onGoToDay(day)}
            title={`${EVENT_KIND_LABEL[o.event.kind]} – im Kalender zeigen`}
          >
            <i className="wf-kal-gem" />
            <span className="wf-kal-row__main">
              <span className="wf-kal-row__title">{o.event.title}</span>
              <span className="wf-kal-row__meta">
                <b>{when}</b> · {formatDayMonth(cal, o.at)}
                {o.event.timed && `, ${formatClock(o.at)} Uhr`}
                {o.event.placeId && ` · ${entityName(data, o.event.placeId)}`}
              </span>
            </span>
          </button>
        );
      })}
      {upcoming.length === 0 && (
        <div className="wf-kal-hint">
          In den nächsten {UPCOMING_DAYS} Tagen steht nichts an. Trage ein, was in der Welt
          geschehen wird oder was die Gruppe vorhat.
          <br />
          <Button size="sm" icon={<Plus />} onClick={onCreate}>
            Termin anlegen
          </Button>
        </div>
      )}
    </Panel>
  );
}

// ── Wirkungen und Tätigkeiten ──────────────────────────────────────────────

export function TimersPanel({
  data,
  onAdd,
  onEdit,
}: {
  data: CampaignData;
  onAdd: () => void;
  onEdit: (timer: Timer) => void;
}) {
  const db = useDb();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const timers = runningTimers(data);
  const endLabel = (end: WorldTime) =>
    dayIndexOf(end) === dayIndexOf(now)
      ? `bis ${formatClock(end)} Uhr`
      : `bis ${formatDayMonth(cal, end)}, ${formatClock(end)} Uhr`;
  const finish = (id: string, label: string) => {
    db.patch('timers', id, { done: true });
    toast({
      title: 'Vorzeitig beendet',
      body: label,
      action: {
        label: 'Rückgängig',
        run: () => {
          if (db.getSnapshot().timers[id]) db.patch('timers', id, { done: false });
        },
      },
    });
  };
  return (
    <Panel
      title="Läuft gerade"
      flush
      scroll
      actions={
        <IconButton
          label="Wirkung oder Tätigkeit beginnen"
          size="sm"
          variant="ghost"
          onClick={onAdd}
        >
          <Plus />
        </IconButton>
      }
    >
      {timers.map((timer) => {
        const Icon = timer.kind === 'task' ? Hammer : timer.kind === 'light' ? Flame : Sparkles;
        const refs = timer.refs.map((id) => entityName(data, id)).join(', ');
        return (
          <div
            key={timer.id}
            className={cx('wf-kal-row wf-kal-timer', `wf-kal-timer--${timer.kind}`)}
          >
            <Icon className="wf-kal-timer__icon" aria-label={TIMER_KIND_LABEL[timer.kind]} />
            <button
              type="button"
              className="wf-kal-row__main"
              onClick={() => onEdit(timer)}
              title={`${TIMER_KIND_LABEL[timer.kind]}: ${timer.label}${
                refs ? ` – ${refs}` : ''
              }\nAnklicken zum Ändern.`}
            >
              <span className="wf-kal-row__title">
                {timer.label}
                {refs && <span className="wf-mute"> · {refs}</span>}
              </span>
              <span className="wf-kal-row__meta">
                <b>noch {formatDuration(timer.end - now)}</b> <span>{endLabel(timer.end)}</span>
              </span>
              <span className="wf-kal-timer__bar">
                <i style={{ width: `${Math.round(timerProgress(timer, now) * 100)}%` }} />
              </span>
            </button>
            <IconButton
              label={`„${timer.label}“ vorzeitig beenden`}
              size="sm"
              variant="ghost"
              onClick={() => finish(timer.id, timer.label)}
            >
              <X />
            </IconButton>
          </div>
        );
      })}
      {timers.length === 0 && (
        <div className="wf-kal-hint">
          Keine Wirkung, keine Tätigkeit. Halte hier fest, was eine Weile andauert – ein Zauber,
          eine Fackel, eine Reparatur.
          <br />
          <Button size="sm" icon={<Plus />} onClick={onAdd}>
            Beginnen
          </Button>
        </div>
      )}
    </Panel>
  );
}

// ── Monde ──────────────────────────────────────────────────────────────────

export function MoonsPanel({ data }: { data: CampaignData }) {
  const db = useDb();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const today = dayIndexOf(now);
  const anchor = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const thisYear = fromTime(cal, now).year;

  const when = (time: WorldTime) => (
    <>
      {fromTime(cal, time).year === thisYear ? formatDayMonth(cal, time) : formatDate(cal, time)}
      <span> · {lowerFirst(relativeDay(today, dayIndexOf(time)))}</span>
    </>
  );

  const calibrate = async (moon: MoonDef, phase: 'full' | 'new') => {
    setMenu(false);
    const name = phase === 'full' ? 'Vollmond' : 'Neumond';
    const ok = await confirmDialog({
      title: `${moon.name} neu stellen?`,
      body: (
        <>
          Der Lauf von {moon.name} wird so verschoben, dass jetzt – am {formatDate(cal, now)} –{' '}
          {name} ist. Alle Mondphasen im Kalender richten sich danach, auch die vergangenen.
        </>
      ),
      confirmLabel: `Heute ist ${name}`,
    });
    if (!ok) return;
    const before = db.getSnapshot().campaign.calendar;
    db.setCampaign({ calendar: calibrateMoon(before, moon.id, now, phase) });
    toast({
      title: `${moon.name} gestellt`,
      body: `Heute ist ${name}.`,
      action: {
        label: 'Rückgängig',
        run: () => {
          const current = db.getSnapshot().campaign.calendar;
          const old = before.moons.find((m) => m.id === moon.id);
          if (!old) return;
          db.setCampaign({
            calendar: {
              ...current,
              moons: current.moons.map((m) =>
                m.id === moon.id ? { ...m, anchor: old.anchor } : m,
              ),
            },
          });
        },
      },
    });
  };

  return (
    <Panel
      title="Monde"
      flush
      scroll
      actions={
        <>
          <IconButton
            ref={anchor}
            label="Monde stellen"
            size="sm"
            variant="ghost"
            onClick={() => setMenu((open) => !open)}
          >
            <SlidersHorizontal />
          </IconButton>
          <Popover
            open={menu}
            onClose={() => setMenu(false)}
            anchor={anchor}
            align="right"
            width={260}
          >
            <div className="wf-kal-menu-head">Mond neu stellen</div>
            {cal.moons.map((moon) => (
              <div key={moon.id}>
                <MenuItem
                  icon={
                    <MoonGlyph moon={{ ...moon, anchor: 0 }} time={moon.period / 2} size={15} />
                  }
                  onClick={() => calibrate(moon, 'full')}
                >
                  {moon.name}: Heute ist Vollmond
                </MenuItem>
                <MenuItem
                  icon={<MoonGlyph moon={{ ...moon, anchor: 0 }} time={0} size={15} />}
                  onClick={() => calibrate(moon, 'new')}
                >
                  {moon.name}: Heute ist Neumond
                </MenuItem>
              </div>
            ))}
          </Popover>
        </>
      }
    >
      <div className="wf-kal-moons">
        {cal.moons.map((moon) => {
          const phase = moonPhase(moon, now);
          return (
            <div key={moon.id} className="wf-kal-moonrow">
              <MoonGlyph moon={moon} time={now} size={32} />
              <div>
                <div className="wf-kal-moonrow__name">{moon.name}</div>
                <div className="wf-kal-moonrow__phase">
                  {phase.label} · {phase.light} %<span> beleuchtet</span>
                </div>
              </div>
              <dl>
                <dt>Vollmond</dt>
                <dd>{when(phase.nextFull)}</dd>
                <dt>Neumond</dt>
                <dd>{when(phase.nextNew)}</dd>
              </dl>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
