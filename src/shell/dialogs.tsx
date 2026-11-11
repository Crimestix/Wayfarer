/** Dialoge des Gerüsts: festhalten, Haltung ändern, Ort wechseln, Zeit vergehen lassen, suchen. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight, Footprints, Library, Search } from 'lucide-react';
import {
  advanceTime,
  logEntry,
  moveParty,
  setAttitude,
  setTime,
  undoTimeAdvance,
} from '../data/actions';
import type { TimeAdvanceResult } from '../data/actions';
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
  AttitudeScale,
  Button,
  Checkbox,
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
import { WALK_KMH, describeVia, formatWayTime, routeBetween, suggestedKm } from '../domain/ways';
import { rememberWay, walk, type WalkResult } from '../features/wege/actions';
import { DurationField } from '../features/wege/DurationField';
import { RestDialog } from '../features/gruppe/RestDialog';
import type { RestResult } from '../features/gruppe/rest';
import { meanwhile } from './meanwhile';
import {
  closeShellRequest,
  useShellRequest,
  type AttitudeRequest,
  type QuickLogRequest,
} from './commands';

/** Die Zeilen der Meldung „währenddessen“: Wichtiges hell, Routinen gedämpft, der Rest gezählt. */
function meanwhileBody(data: CampaignData, result: TimeAdvanceResult, lead?: string): ReactNode {
  const { lines, elsewhere } = meanwhile(data, result);
  return (
    <>
      {lead && <div>{lead}</div>}
      {lines.map((line, i) => (
        <div key={i} className={line.weight === 'side' ? 'wf-mute' : undefined}>
          {line.text}
        </div>
      ))}
      {elsewhere > 0 && (
        <div className="wf-mute">
          … und {elsewhere === 1 ? 'eine weitere Routine' : `${elsewhere} weitere Routinen`}{' '}
          anderswo
        </div>
      )}
    </>
  );
}

const happened = (result: TimeAdvanceResult) =>
  result.occurred.length + result.expired.length + result.steps.length > 0;

/** Lässt Zeit vergehen und meldet, was dabei eingetreten ist – mit „Rückgängig“. */
export function advanceAndReport(db: CampaignDb, to: WorldTime) {
  try {
    const result = advanceTime(db, to);
    toast({
      title: happened(result)
        ? `${formatDuration(result.to - result.from)} vergangen – währenddessen`
        : `${formatDuration(result.to - result.from)} vergangen`,
      body: happened(result)
        ? meanwhileBody(db.getSnapshot(), result)
        : formatDateTime(db.getSnapshot().campaign.calendar, result.to),
      action: { label: 'Rückgängig', run: () => undoTimeAdvance(db) },
      duration: result.steps.length ? 14000 : undefined,
    });
  } catch (error) {
    toast({ title: 'Zeit nicht geändert', body: String((error as Error).message), tone: 'danger' });
  }
}

/**
 * Die Gruppe geht einen Weg: Die Zeit vergeht, sie kommt an – eine Meldung nennt beides, und
 * „Rückgängig“ nimmt beides zurück.
 */
export function walkAndReport(db: CampaignDb, go: () => WalkResult) {
  try {
    const result = go();
    const data = db.getSnapshot();
    const name = entityName(data, data.state.placeId);
    toast({
      title:
        result.minutes > 0
          ? `Angekommen: ${name} – ${formatWayTime(result.minutes)} unterwegs`
          : `Angekommen: ${name}`,
      body:
        result.advance && happened(result.advance)
          ? meanwhileBody(data, result.advance, 'Währenddessen:')
          : undefined,
      action: { label: 'Rückgängig', run: result.undo },
      duration: result.advance?.steps.length ? 14000 : undefined,
    });
  } catch (error) {
    toast({
      title: 'Ort nicht gewechselt',
      body: String((error as Error).message),
      tone: 'danger',
    });
  }
}

/** Meldet eine Rast: was sie gebracht hat und was in der Zeit eingetreten ist. */
function reportRest(data: CampaignData, result: RestResult) {
  toast({
    title: result.interrupted
      ? 'Rast unterbrochen'
      : `${formatDuration(result.advance.to - result.advance.from)} gerastet`,
    body: meanwhileBody(data, result.advance, result.text),
    action: { label: 'Rückgängig', run: result.undo },
    duration: 12000,
  });
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
  const [secret, setSecret] = useState(false);
  const save = () => {
    if (!text.trim()) return;
    const days = Number(dueDays);
    logEntry(db, {
      kind,
      text,
      refs,
      secret,
      due:
        kind === 'promise' && dueDays && days >= 0
          ? data.state.now + Math.round(days * 1440)
          : null,
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
        <Checkbox checked={secret} onChange={setSecret}>
          Nur für die Spielleitung
        </Checkbox>
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
        <AttitudeScale value={value} onChange={setValue} />
        {value !== before && (
          <div className="wf-mute" style={{ fontSize: 'var(--text-sm)' }}>
            Bisher: {attitudeLabel(before)}
          </div>
        )}
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

function MovePartyDialog({ preset }: { preset?: string }) {
  const db = useDb();
  const data = useData();
  const [placeId, setPlaceId] = useState<string | null>(preset ?? null);
  const [text, setText] = useState('');
  const here = data.state.placeId;
  // Kennt das Wegenetz eine Route, ist ihre Dauer die Vorgabe; sonst wählt der Spielleiter.
  const route = useMemo(
    () => (here && placeId ? routeBetween(data, here, placeId) : null),
    [data, here, placeId],
  );
  const km = here && placeId && !route ? suggestedKm(data, here, placeId) : null;
  const suggested = km === null ? null : Math.max(1, Math.round((km / WALK_KMH.normal) * 60));
  const [chosen, setChosen] = useState<number | null>(null);
  const [passTime, setPassTime] = useState(true);
  const [remember, setRemember] = useState(true);
  const minutes = route ? (passTime ? route.minutes : 0) : (chosen ?? suggested ?? 0);
  const moving = placeId !== null && here !== null && placeId !== here;
  const save = () => {
    closeShellRequest();
    if (!placeId) {
      moveParty(db, placeId, text);
      return;
    }
    const note = [
      text.trim(),
      route ? describeVia(data, route) : '',
      minutes > 0 ? formatWayTime(minutes) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    walkAndReport(db, () => {
      if (!route && remember && here && minutes > 0) rememberWay(db, here, placeId, minutes);
      return walk(db, placeId, minutes, note);
    });
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
          <Button
            variant="primary"
            onClick={save}
            disabled={placeId === data.state.placeId}
            data-autofocus={preset ? true : undefined}
          >
            Ort wechseln
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <div className="wf-mute">
          Bisher: {data.state.placeId ? placePath(data, data.state.placeId) : 'kein Ort festgelegt'}
        </div>
        <Field
          label="Neuer Aufenthaltsort"
          hint="Der Wechsel steht in der Chronik; daraus entstehen die Besuche."
        >
          <EntityPicker
            value={placeId}
            onChange={setPlaceId}
            kinds={['place']}
            autoFocus={!preset}
            placeholder="Ort wählen oder neu anlegen …"
            onCreate={(name) => db.put('entities', createEntity({ kind: 'place', name })).id}
          />
        </Field>
        {moving && route && (
          <>
            <div className="wf-wege-route">
              <Footprints aria-hidden />
              <div>
                <div className="wf-wege-route__main">
                  {route.minutes > 0 ? formatWayTime(route.minutes) : 'Dauer offen'}
                  {route.unknown && route.minutes > 0 && ' und mehr'}
                </div>
                <div className="wf-wege-route__sub">
                  {describeVia(data, route) ||
                    (route.legs[0]?.path.name
                      ? `Direkter Weg über ${route.legs[0].path.name}`
                      : 'Direkter Weg')}
                  {route.unknown && ' – ein Abschnitt hat noch keine Dauer'}
                  {route.legs.some((leg) => leg.path.conditions) &&
                    ` · ${route.legs
                      .map((leg) => leg.path.conditions)
                      .filter(Boolean)
                      .join('; ')}`}
                </div>
              </div>
            </div>
            {route.minutes > 0 && (
              <Checkbox checked={passTime} onChange={setPassTime}>
                Die Zeit vergeht mit ({formatWayTime(route.minutes)})
              </Checkbox>
            )}
          </>
        )}
        {moving && !route && (
          <Field
            label="Wie lange dauert der Weg?"
            hint={
              suggested !== null
                ? `Nach der Karte etwa ${formatWayTime(suggested)} zu Fuß.`
                : 'Die Zeit vergeht mit dem Weg: Termine treten ein, Lichter brennen herunter.'
            }
          >
            <DurationField value={minutes} onChange={setChosen} />
          </Field>
        )}
        {moving && !route && minutes > 0 && (
          <Checkbox checked={remember} onChange={setRemember}>
            Diesen Weg merken – beim nächsten Mal und auf dem Rückweg ist die Dauer schon da
          </Checkbox>
        )}
        <Field label="Anmerkung">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="z. B. über die Alte Straße"
          />
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
            {mode === 'pass' || (target ?? 0) > data.state.now
              ? 'Zeit vergehen lassen'
              : 'Zeit zurückstellen'}
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
                <Input
                  type="number"
                  min={0}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="Stunden">
                <Input
                  type="number"
                  min={0}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </Field>
              <Field label="Minuten">
                <Input
                  type="number"
                  min={0}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
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
                <Select
                  value={date.month}
                  onChange={(e) => setDate({ ...date, month: Number(e.target.value) })}
                >
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
  const areas: SearchHit[] = AREAS.filter((a) => !q || a.label.toLowerCase().includes(q)).map(
    (a) => ({
      key: 'area:' + a.path,
      label: a.label,
      sub: a.hint,
      href: a.path,
      icon: <a.icon />,
    }),
  );
  const entities: SearchHit[] = q
    ? searchEntities(data, query, { limit: 30 }).map((e) => ({
        key: e.id,
        label: e.name,
        sub: [KIND_LABEL[e.kind], e.tagline].filter(Boolean).join(' · '),
        href: entityHref(e),
        icon: <KindIcon kind={e.kind} />,
      }))
    : [];
  // Artikel des Wikis, die keinen Eintrag in der Welt haben – die anderen stehen schon oben.
  const owned = new Set(
    Object.values(data.entities)
      .map((e) => e.lk?.resourceId)
      .filter(Boolean),
  );
  const articles: SearchHit[] = q
    ? Object.values(data.articles)
        .filter(
          (a) =>
            !a.template &&
            !owned.has(a.id) &&
            (a.title.toLowerCase().includes(q) ||
              a.aliases.some((alias) => alias.toLowerCase().includes(q))),
        )
        .sort((a, b) => a.title.localeCompare(b.title, 'de'))
        .slice(0, 20)
        .map((a) => ({
          key: 'article:' + a.id,
          label: a.title,
          sub: 'Wiki-Artikel',
          href: `/wiki/${a.id}`,
          icon: <Library />,
        }))
    : [];
  return q ? [...entities, ...articles, ...areas] : areas;
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
    <Dialog
      open
      onClose={closeShellRequest}
      title={
        <span className="wf-row">
          <Search width={20} height={20} /> Suchen
        </span>
      }
      width={640}
    >
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
  const db = useDb();
  const request = useShellRequest();
  if (!request) return null;
  switch (request.type) {
    case 'log':
      return <QuickLogDialog request={request.request} />;
    case 'attitude':
      return <AttitudeDialog request={request.request} />;
    case 'move':
      return <MovePartyDialog preset={request.placeId} />;
    case 'time':
      return <TimeDialog />;
    case 'rest':
      return (
        <RestDialog
          kind={request.kind}
          onClose={closeShellRequest}
          onDone={(result) => reportRest(db.getSnapshot(), result)}
        />
      );
    case 'search':
      return <SearchDialog />;
  }
}
