/** Gerüst der App: Navigation, Weltleiste und die Arbeitsfläche mit den Bereichen. */
import { useEffect, useRef, useState } from 'react';
import { Link, Route, Switch, useLocation } from 'wouter';
import { ChevronDown, Feather, Hourglass, MapPin, Search, Settings, Undo2 } from 'lucide-react';
import { endSession, startSession, undoTimeAdvance } from '../data/actions';
import { useData, useDb, useSaveStatus } from '../data/hooks';
import { currentSession, placeAncestors } from '../domain/derive';
import {
  formatClock,
  formatDate,
  formatYear,
  fromTime,
  nextTimeOfDay,
  weekdayName,
} from '../domain/time/calendar';
import ChronikPage from '../features/chronik';
import EinstellungenPage from '../features/einstellungen';
import GruppePage from '../features/gruppe';
import KalenderPage from '../features/kalender';
import { AREAS } from '../features/registry';
import TischPage from '../features/tisch';
import WeltPage from '../features/welt';
import { Button, ConfirmHost, IconButton, MenuItem, MoonGlyph, Popover, Toaster } from '../ui';
import { openMoveParty, openQuickLog, openSearch, openTimeDialog } from './commands';
import { ShellDialogs, advanceAndReport } from './dialogs';
import { Sigil } from './Sigil';
import './shell.css';

const isActive = (location: string, path: string) =>
  path === '/' ? location === '/' : location === path || location.startsWith(path + '/');

function NavRail() {
  const data = useData();
  const [location] = useLocation();
  const { status, error } = useSaveStatus();
  const db = useDb();
  return (
    <nav className="wf-rail" aria-label="Bereiche">
      <div className="wf-brand">
        <Sigil />
        <div style={{ minWidth: 0 }}>
          <div className="wf-brand__name">Wayfarer</div>
          <div className="wf-brand__campaign wf-clamp-1">{data.campaign.name}</div>
        </div>
      </div>
      <div className="wf-nav">
        {AREAS.map((area, i) => (
          <Link
            key={area.path}
            href={area.path}
            className="wf-nav__item"
            aria-current={isActive(location, area.path) ? 'page' : undefined}
            title={area.hint}
          >
            <area.icon />
            <span className="wf-nav__label">{area.label}</span>
            <span className="wf-nav__key">Alt {i + 1}</span>
          </Link>
        ))}
      </div>
      <div className="wf-rail__foot">
        <Link
          href="/einstellungen"
          className="wf-nav__item"
          aria-current={isActive(location, '/einstellungen') ? 'page' : undefined}
        >
          <Settings />
          <span className="wf-nav__label">Einstellungen</span>
        </Link>
        <div className="wf-save" data-status={status} title={error || db.store.location}>
          <i />
          {status === 'saved'
            ? 'Gespeichert'
            : status === 'saving'
              ? 'Speichert …'
              : 'Speichern fehlgeschlagen'}
        </div>
      </div>
    </nav>
  );
}

function WorldBar() {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const date = fromTime(cal, now);
  const secondEra = cal.eras[1];
  const place = data.state.placeId ? data.entities[data.state.placeId] : undefined;
  const parent = place ? placeAncestors(data, place.id)[0] : undefined;
  const session = currentSession(data);
  const moreAnchor = useRef<HTMLButtonElement>(null);
  const sessionAnchor = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const pass = (minutes: number) => advanceAndReport(db, now + minutes);
  const more = (run: () => void) => () => {
    setMoreOpen(false);
    run();
  };

  return (
    <header className="wf-bar">
      <div className="wf-bar__cell">
        <div>
          <div className="wf-bar__date">{formatDate(cal, now)}</div>
          <div className="wf-bar__sub">
            {weekdayName(cal, now)}
            {secondEra && ` · ${formatYear(cal, date.year, secondEra)}`}
          </div>
        </div>
        <div className="wf-bar__clock">{formatClock(now)}</div>
        {cal.moons.length > 0 && (
          <div className="wf-bar__moons">
            {cal.moons.map((moon) => (
              <MoonGlyph key={moon.id} moon={moon} time={now} />
            ))}
          </div>
        )}
      </div>

      <div className="wf-bar__cell">
        <div className="wf-btn-group">
          <Button onClick={() => pass(10)} title="10 Minuten vergehen lassen">
            +10 Min.
          </Button>
          <Button onClick={() => pass(60)} title="1 Stunde vergehen lassen">
            +1 Std.
          </Button>
          <Button
            ref={moreAnchor}
            onClick={() => setMoreOpen((o) => !o)}
            icon={<Hourglass />}
            aria-haspopup="menu"
            aria-label="Zeit vergehen lassen"
            title="Rast, bis zum Morgen, andere Dauer …"
          >
            <span className="wf-bar__mid">Zeit</span> <ChevronDown />
          </Button>
          <IconButton
            label="Letzten Zeitsprung zurücknehmen"
            disabled={data.state.previousNow === null}
            onClick={() => undoTimeAdvance(db)}
          >
            <Undo2 />
          </IconButton>
        </div>
        <Popover open={moreOpen} onClose={() => setMoreOpen(false)} anchor={moreAnchor} width={250}>
          <MenuItem onClick={more(() => pass(60))}>Kurze Rast · 1 Stunde</MenuItem>
          <MenuItem onClick={more(() => pass(480))}>Lange Rast · 8 Stunden</MenuItem>
          <div className="wf-menu-sep" />
          <MenuItem onClick={more(() => advanceAndReport(db, nextTimeOfDay(now, 6)))}>
            Bis zum Morgen · 06:00
          </MenuItem>
          <MenuItem onClick={more(() => advanceAndReport(db, nextTimeOfDay(now, 12)))}>
            Bis zum Mittag · 12:00
          </MenuItem>
          <MenuItem onClick={more(() => advanceAndReport(db, nextTimeOfDay(now, 18)))}>
            Bis zum Abend · 18:00
          </MenuItem>
          <MenuItem onClick={more(() => pass(1440))}>Einen ganzen Tag</MenuItem>
          <div className="wf-menu-sep" />
          <MenuItem onClick={more(openTimeDialog)}>Andere Dauer oder Datum stellen …</MenuItem>
        </Popover>
      </div>

      <div className="wf-bar__cell wf-bar__cell--grow">
        <button
          type="button"
          className="wf-bar__place"
          onClick={() => openMoveParty()}
          title="Ort der Gruppe wechseln"
        >
          <MapPin />
          <span style={{ minWidth: 0 }}>
            <span className="wf-bar__place-name wf-clamp-1" style={{ display: 'block' }}>
              {place?.name ?? 'Aufenthaltsort offen'}
            </span>
            <span className="wf-bar__sub wf-clamp-1" style={{ display: 'block' }}>
              {parent
                ? parent.name
                : place
                  ? 'Aufenthaltsort der Gruppe'
                  : 'Ort der Gruppe festlegen'}
            </span>
          </span>
        </button>
      </div>

      <div className="wf-bar__cell wf-bar__cell--end">
        <Button
          ref={sessionAnchor}
          variant="ghost"
          onClick={() => setSessionOpen((o) => !o)}
          icon={session ? <i className="wf-session-dot" /> : undefined}
          title={session ? `Session ${session.number} läuft` : 'Keine Session läuft'}
        >
          {session ? (
            <>
              <span className="wf-bar__mid">Session</span>
              {session.number}
            </>
          ) : (
            'Keine Session'
          )}
          <ChevronDown />
        </Button>
        <Popover
          open={sessionOpen}
          onClose={() => setSessionOpen(false)}
          anchor={sessionAnchor}
          align="right"
          width={260}
        >
          {session ? (
            <MenuItem
              onClick={() => {
                endSession(db);
                setSessionOpen(false);
              }}
            >
              Session {session.number} beenden
            </MenuItem>
          ) : null}
          <MenuItem
            onClick={() => {
              startSession(db);
              setSessionOpen(false);
            }}
          >
            Neue Session beginnen
          </MenuItem>
        </Popover>
        <Button icon={<Search />} onClick={openSearch} title="Suchen (Strg+K)" aria-label="Suchen">
          <span className="wf-bar__wide">Suchen</span>
        </Button>
        <Button
          variant="primary"
          icon={<Feather />}
          onClick={() => openQuickLog()}
          title="Festhalten (Strg+E)"
        >
          Festhalten
        </Button>
      </div>
    </header>
  );
}

function useShortcuts() {
  const [, navigate] = useLocation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSearch();
      } else if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        openQuickLog();
      } else if (e.altKey && !mod && /^Digit[1-9]$/.test(e.code)) {
        const area = AREAS[Number(e.code.slice(5)) - 1];
        if (area) {
          e.preventDefault();
          navigate(area.path);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}

export function AppShell() {
  useShortcuts();
  return (
    <div className="wf-app">
      <NavRail />
      <WorldBar />
      <main className="wf-main">
        <Switch>
          <Route path="/" component={TischPage} />
          <Route path="/welt/:id?" component={WeltPage} />
          <Route path="/chronik" component={ChronikPage} />
          <Route path="/kalender" component={KalenderPage} />
          <Route path="/gruppe/:id?" component={GruppePage} />
          <Route path="/einstellungen" component={EinstellungenPage} />
          <Route component={TischPage} />
        </Switch>
      </main>
      <ShellDialogs />
      <ConfirmHost />
      <Toaster />
    </div>
  );
}
