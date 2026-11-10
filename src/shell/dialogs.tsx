/** Dialoge des Gerüsts: festhalten, Haltung ändern, Ort wechseln, Zeit vergehen lassen, suchen. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight, Search } from 'lucide-react';
import { advanceTime, logEntry, moveParty, setAttitude, setTime, undoTimeAdvance } from '../data/actions';
import type { CampaignDb } from '../data/db';
import { useData, useDb } from '../data/hooks';
import { KIND_LABEL, entityName, findRelation, placePath, searchEntities } from '../domain/derive';
import { attitudeLabel } from '../domain/relations';
import { PARTY_ID, createEntity, type CampaignData } from '../domain/schema';
import {
  absoluteYear,
  displayYear,
  formatDate,
  formatDateTime,
  formatDuration,
  fromTime,
  isValidDate,
  primaryEra,
  toTime,
  type WorldTime,
} from '../domain/time/calendar';
import { AREAS } from '../features/registry';
import {
  AttitudeBadge,
  AttitudeScale,
  Button,
  Dialog,
  EntityPicker,
  EntityRefsEditor,
  Field,
  Input,
  KindIcon,
  MenuItem,
  Select,
  Tabs,
  TextArea,
  entityHref,
  toast,
} from '../ui';
import { closeShellRequest, useShellRequest, type AttitudeRequest, type QuickLogRequest } from './commands';

/** Lässt Zeit vergehen und meldet, was dabei eingetreten ist – mit „Rückgängig“. */
export function advanceAndReport(db: CampaignDb, to: WorldTime) {
  try {
    const result = advanceTime(db, to);
    const lines = [
      ...result.occurred.map((o) => `Eingetreten: ${o.event.title}`),
      ...result.expired.map((t) => `Abgelaufen: ${t.label}`),
    ];
    toast({
      title: `${formatDuration(result.to - result.from)} vergangen`,
      body: lines.length ? (
        <>
          {lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </>
      ) : (
        formatDateTime(db.getSnapshot().campaign.calendar, result.to)
      ),
      action: { label: 'Rückgängig', run: () => undoTimeAdvance(db) },
    });
  } catch (error) {
    toast({ title: 'Zeit nicht geändert', body: String((error as Error).message), tone: 'danger' });
  }
}

// ── Festhalten ─────────────────────────────────────────────────────────────

const LOG_KINDS = [
  { id: 'note', label: 'Notiz' },
  { id: 'change', label: 'Veränderung' },
  { id: 'promise', label: 'Abmachung' },
] as const;

function QuickLogDialog({ request }: { request: QuickLogRequest }) {
  const db = useDb();
  const data = useData();
  const [kind, setKind] = useState<(typeof LOG_KINDS)[number]['id']>(request.kind ?? 'note');
  const [text, setText] = useState(request.text ?? '');
  const [refs, setRefs] = useState<string[]>(request.refs ?? []);
  const [dueDays, setDueDays] = useState('');
  const save = () => {
    if (!text.trim()) return;
    const days = Number(dueDays);
    logEntry(db, {
      kind,
      text,
      refs,
      due: kind === 'promise' && dueDays && days >= 0 ? data.state.now + Math.round(days * 1440) : null,
    });
    closeShellRequest();
  };
  const hint =
    kind === 'note'
      ? 'Was gerade am Tisch passiert ist.'
      : kind === 'change'
        ? 'Etwas in der Welt hat sich verändert – erscheint bei den verknüpften Orten und Personen.'
        : 'Ein Versprechen, eine Schuld oder ein Auftrag. Bleibt offen, bis du es abhakst.';
  return (
    <Dialog
      open
      onClose={closeShellRequest}
      title="Festhalten"
      footer={
        <>
          <span className="wf-grow wf-mute" style={{ fontSize: 'var(--text-sm)' }}>
            {formatDateTime(data.campaign.calendar, data.state.now)}
            {data.state.placeId && ` · ${entityName(data, data.state.placeId)}`}
          </span>
          <Button onClick={closeShellRequest}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={!text.trim()}>
            Festhalten
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <Tabs tabs={[...LOG_KINDS]} value={kind} onChange={setKind} />
        <Field label="Was ist geschehen?" hint={hint}>
          <TextArea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
            }}
            placeholder="Strg+Eingabe speichert"
          />
        </Field>
        <Field label="Betrifft">
          <EntityRefsEditor
            value={refs}
            onChange={setRefs}
            placeholder="Person, Ort, Fraktion … verknüpfen"
          />
        </Field>
        {kind === 'promise' && (
          <Field label="Frist in Tagen" hint="Leer lassen, wenn es keine Frist gibt.">
            <Input
              type="number"
              min={0}
              value={dueDays}
              onChange={(e) => setDueDays(e.target.value)}
              style={{ width: 140 }}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

// ── Haltung ────────────────────────────────────────────────────────────────

function AttitudeDialog({ request }: { request: AttitudeRequest }) {
  const db = useDb();
  const data = useData();
  const toId = request.toId ?? PARTY_ID;
  const before = findRelation(data, request.fromId, toId)?.attitude ?? null;
  const [value, setValue] = useState<number | null>(before);
  const [reason, setReason] = useState('');
  const save = () => {
    setAttitude(db, request.fromId, toId, value, reason);
    closeShellRequest();
  };
  return (
    <Dialog
      open
      onClose={closeShellRequest}
      title="Haltung ändern"
      width={520}
      footer={
        <>
          <Button onClick={closeShellRequest}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={value === before && !reason.trim()}>
            Übernehmen
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <div className="wf-row" style={{ fontSize: 'var(--text-lg)' }}>
          <span className="wf-display">{entityName(data, request.fromId)}</span>
          <ArrowRight width={16} height={16} className="wf-mute" />
          <span className="wf-display">{entityName(data, toId)}</span>
        </div>
        <div className="wf-row" style={{ gap: 'var(--s-4)' }}>
          <AttitudeScale value={value} onChange={setValue} />
          <span>
            <AttitudeBadge value={value} />
            {value !== before && <span className="wf-mute"> · bisher {attitudeLabel(before)}</span>}
          </span>
        </div>
        <Field label="Grund" hint="Steht mit Datum im Verlauf der Beziehung.">
          <TextArea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ minHeight: 70 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
            }}
          />
        </Field>
      </div>
    </Dialog>
  );
}

// ── Ort wechseln ───────────────────────────────────────────────────────────

function MovePartyDialog() {
  const db = useDb();
  const data = useData();
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const save = () => {
    moveParty(db, placeId, text);
    closeShellRequest();
  };
  return (
    <Dialog
      open
      onClose={closeShellRequest}
      title="Die Gruppe zieht weiter"
      width={520}
      footer={
        <>
          <Button onClick={closeShellRequest}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={placeId === data.state.placeId}>
            Ort wechseln
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <div className="wf-mute">
          Bisher: {data.state.placeId ? placePath(data, data.state.placeId) : 'kein Ort festgelegt'}
        </div>
        <Field label="Neuer Aufenthaltsort" hint="Der Wechsel steht in der Chronik; daraus entstehen die Besuche.">
          <EntityPicker
            value={placeId}
            onChange={setPlaceId}
            kinds={['place']}
            autoFocus
            placeholder="Ort wählen oder neu anlegen …"
            onCreate={(name) => db.put('entities', createEntity({ kind: 'place', name })).id}
          />
        </Field>
        <Field label="Anmerkung">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="z. B. über die Alte Straße" />
        </Field>
      </div>
    </Dialog>
  );
}

// ── Zeit ───────────────────────────────────────────────────────────────────

function TimeDialog() {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const now = fromTime(cal, data.state.now);
  const [mode, setMode] = useState<'pass' | 'set'>('pass');
  const [days, setDays] = useState('0');
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('0');
  const [date, setDate] = useState({
    year: String(displayYear(cal, now.year)),
    month: now.month,
    day: String(now.day),
    hour: String(now.hour),
    minute: String(now.minute),
  });
  const passMinutes = Math.round(Number(days) * 1440 + Number(hours) * 60 + Number(minutes));
  const target = useMemo(() => {
    const parts = {
      year: absoluteYear(cal, Number(date.year)),
      month: date.month,
      day: Number(date.day),
      hour: Number(date.hour),
      minute: Number(date.minute),
    };
    return isValidDate(cal, parts) ? toTime(cal, parts) : null;
  }, [cal, date]);
  const apply = () => {
    if (mode === 'pass') {
      if (passMinutes > 0) advanceAndReport(db, data.state.now + passMinutes);
    } else if (target !== null) {
      if (target > data.state.now) advanceAndReport(db, target);
      else setTime(db, target);
    }
    closeShellRequest();
  };
  const ok = mode === 'pass' ? passMinutes > 0 : target !== null && target !== data.state.now;
  return (
    <Dialog
      open
      onClose={closeShellRequest}
      title="Weltzeit"
      width={540}
      footer={
        <>
          <Button onClick={closeShellRequest}>Abbrechen</Button>
          <Button variant="primary" onClick={apply} disabled={!ok}>
            {mode === 'pass' || (target ?? 0) > data.state.now ? 'Zeit vergehen lassen' : 'Zeit zurückstellen'}
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <Tabs
          tabs={[
            { id: 'pass', label: 'Dauer' },
            { id: 'set', label: 'Datum stellen' },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'pass' ? (
          <>
            <div className="wf-row" style={{ gap: 'var(--s-4)' }}>
              <Field label="Tage">
                <Input type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} autoFocus />
              </Field>
              <Field label="Stunden">
                <Input type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} />
              </Field>
              <Field label="Minuten">
                <Input type="number" min={0} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              </Field>
            </div>
            <div className="wf-mute">
              {passMinutes > 0
                ? `Danach ist es ${formatDateTime(cal, data.state.now + passMinutes)}.`
                : 'Termine, die in dieser Zeit liegen, treten ein und stehen dann in der Chronik.'}
            </div>
          </>
        ) : (
          <>
            <div className="wf-row" style={{ gap: 'var(--s-3)', alignItems: 'flex-end' }}>
              <Field label="Tag">
                <Input
                  type="number"
                  min={1}
                  value={date.day}
                  onChange={(e) => setDate({ ...date, day: e.target.value })}
                  style={{ width: 70 }}
                />
              </Field>
              <Field label="Monat" className="wf-grow">
                <Select value={date.month} onChange={(e) => setDate({ ...date, month: Number(e.target.value) })}>
                  {cal.months.map((m, i) => (
                    <option key={m.name} value={i}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`Jahr ${primaryEra(cal).label}`}>
                <Input
                  type="number"
                  value={date.year}
                  onChange={(e) => setDate({ ...date, year: e.target.value })}
                  style={{ width: 96 }}
                />
              </Field>
              <Field label="Uhrzeit">
                <span className="wf-row" style={{ gap: 4 }}>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={date.hour}
                    onChange={(e) => setDate({ ...date, hour: e.target.value })}
                    style={{ width: 62 }}
                  />
                  :
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    value={date.minute}
                    onChange={(e) => setDate({ ...date, minute: e.target.value })}
                    style={{ width: 62 }}
                  />
                </span>
              </Field>
            </div>
            <div className="wf-mute">
              {target === null
                ? 'Dieses Datum gibt es im Kalender nicht.'
                : target > data.state.now
                  ? `${formatDuration(target - data.state.now)} vergehen; Termine dazwischen treten ein.`
                  : target < data.state.now
                    ? 'Zurückstellen ist eine Korrektur: Die Chronik bleibt, wie sie ist.'
                    : `Es ist bereits ${formatDate(cal, target)}.`}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ── Suche ──────────────────────────────────────────────────────────────────

interface SearchHit {
  key: string;
  label: string;
  sub: string;
  href: string;
  icon: ReactNode;
}

function searchHits(data: CampaignData, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  const areas: SearchHit[] = AREAS.filter((a) => !q || a.label.toLowerCase().includes(q)).map((a) => ({
    key: 'area:' + a.path,
    label: a.label,
    sub: a.hint,
    href: a.path,
    icon: <a.icon />,
  }));
  const entities: SearchHit[] = q
    ? searchEntities(data, query, { limit: 30 }).map((e) => ({
        key: e.id,
        label: e.name,
        sub: [KIND_LABEL[e.kind], e.tagline].filter(Boolean).join(' · '),
        href: entityHref(e),
        icon: <KindIcon kind={e.kind} />,
      }))
    : [];
  return q ? [...entities, ...areas] : areas;
}

function SearchDialog() {
  const data = useData();
  const [, navigate] = useLocation();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const hits = useMemo(() => searchHits(data, query), [data, query]);
  useEffect(() => setIndex(0), [query]);
  const go = (hit: SearchHit | undefined) => {
    if (!hit) return;
    navigate(hit.href);
    closeShellRequest();
  };
  return (
    <Dialog open onClose={closeShellRequest} title={<span className="wf-row"><Search width={20} height={20} /> Suchen</span>} width={640}>
      <div style={{ margin: 'calc(var(--s-5) * -1)' }}>
        <Input
          className="wf-search__input"
          autoFocus
          placeholder="Person, Ort, Fraktion oder Bereich …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') go(hits[index]);
          }}
        />
        <div className="wf-search__list">
          {hits.map((hit, i) => (
            <MenuItem key={hit.key} icon={hit.icon} active={i === index} onClick={() => go(hit)}>
              {hit.label}
              {hit.sub && <span className="wf-mute"> · {hit.sub}</span>}
            </MenuItem>
          ))}
          {!hits.length && <div className="wf-picker__empty">Nichts gefunden.</div>}
        </div>
      </div>
    </Dialog>
  );
}

/** Zeigt den Dialog, den eine Seite über commands.ts angefordert hat. */
export function ShellDialogs() {
  const request = useShellRequest();
  if (!request) return null;
  switch (request.type) {
    case 'log':
      return <QuickLogDialog request={request.request} />;
    case 'attitude':
      return <AttitudeDialog request={request.request} />;
    case 'move':
      return <MovePartyDialog />;
    case 'time':
      return <TimeDialog />;
    case 'search':
      return <SearchDialog />;
  }
}
