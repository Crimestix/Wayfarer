/** Dialog zum Bearbeiten eines Chronik-Eintrags und zum Nachtragen von Vergangenem. */
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Lock, MapPin, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entityName, sessionsSorted } from '../../domain/derive';
import { createEntity, type ChronicleEntry, type ChronicleKind } from '../../domain/schema';
import {
  dayIndexOf,
  primaryEra,
  weekdayName,
  type CalendarDef,
  type WorldTime,
} from '../../domain/time/calendar';
import {
  Button,
  CHRONICLE_KIND_ICON,
  Checkbox,
  Dialog,
  EntityPicker,
  EntityRefsEditor,
  Field,
  Input,
  Select,
  Tabs,
  TextArea,
  confirmDialog,
  toast,
} from '../../ui';
import {
  defaultDue,
  deleteConsequence,
  draftOf,
  entryChange,
  entryFromDraft,
  entryHeadline,
  entryTimeProblem,
  isManualKind,
  relativeDay,
  sessionAt,
  sessionLabel,
  timeDraftOf,
  timeOfDraft,
  type EntryDraft,
  type ManualKind,
  type TimeDraft,
} from './model';

export type EntryDialogRequest =
  | { mode: 'edit'; entry: ChronicleEntry }
  | { mode: 'new'; sessionId?: string | null; at?: WorldTime };

/** Wie der Eintrag in Überschriften heißt. */
const KIND_NAME: Record<ChronicleKind, string> = {
  note: 'Notiz',
  change: 'Veränderung',
  promise: 'Abmachung',
  travel: 'Ortswechsel',
  attitude: 'Haltungsänderung',
  event: 'Eingetretenen Termin',
};

const KIND_TABS: { id: ManualKind; label: string }[] = [
  { id: 'note', label: 'Notiz' },
  { id: 'change', label: 'Veränderung' },
  { id: 'promise', label: 'Abmachung' },
];

const KIND_HINT: Record<ManualKind, string> = {
  note: 'Was am Tisch passiert ist.',
  change: 'Etwas in der Welt hat sich verändert – erscheint bei den verknüpften Orten und Personen.',
  promise: 'Ein Versprechen, eine Schuld oder ein Auftrag. Bleibt offen, bis du es abhakst.',
};

/** Tag, Monat, Jahr und Uhrzeit im Weltkalender. */
export function WorldTimeFields({
  cal,
  value,
  onChange,
  disabled,
}: {
  cal: CalendarDef;
  value: TimeDraft;
  onChange: (value: TimeDraft) => void;
  disabled?: boolean;
}) {
  const set = (change: Partial<TimeDraft>) => onChange({ ...value, ...change });
  return (
    <div className="wf-chronik-time">
      <Field label="Tag">
        <Input
          type="number"
          min={1}
          max={31}
          value={value.day}
          disabled={disabled}
          onChange={(e) => set({ day: e.target.value })}
        />
      </Field>
      <Field label="Monat">
        <Select value={value.month} disabled={disabled} onChange={(e) => set({ month: Number(e.target.value) })}>
          {cal.months.map((month, i) => (
            <option key={month.name} value={i}>
              {month.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`Jahr ${primaryEra(cal).label}`.trim()}>
        <Input type="number" value={value.year} disabled={disabled} onChange={(e) => set({ year: e.target.value })} />
      </Field>
      <Field label="Uhrzeit">
        <span className="wf-chronik-time__clock">
          <Input
            type="number"
            min={0}
            max={23}
            aria-label="Stunde"
            value={value.hour}
            disabled={disabled}
            onChange={(e) => set({ hour: e.target.value })}
          />
          <span className="wf-mute">:</span>
          <Input
            type="number"
            min={0}
            max={59}
            aria-label="Minute"
            value={value.minute}
            disabled={disabled}
            onChange={(e) => set({ minute: e.target.value })}
          />
        </span>
      </Field>
    </div>
  );
}

export function EntryDialog({ request, onClose }: { request: EntryDialogRequest; onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const entry = request.mode === 'edit' ? request.entry : null;
  const initial: EntryDraft = useMemo(
    () =>
      entry
        ? draftOf(entry)
        : {
            kind: 'note',
            text: '',
            at: request.mode === 'new' && request.at !== undefined ? request.at : now,
            placeId: null,
            refs: [],
            sessionId: null,
            due: null,
            done: false,
          },
    // Der Dialog arbeitet mit dem Stand beim Öffnen.
    [],
  );
  const manual = isManualKind(initial.kind);
  const timeLocked = entry?.kind === 'event';

  const [kind, setKind] = useState<ManualKind>(isManualKind(initial.kind) ? initial.kind : 'note');
  const [text, setText] = useState(initial.text);
  const [time, setTime] = useState(() => timeDraftOf(cal, initial.at));
  const [placeId, setPlaceId] = useState(initial.placeId);
  const [refs, setRefs] = useState(initial.refs);
  /** 'auto' = die Session, in deren Weltzeit der Zeitpunkt fällt (nur beim Nachtragen). */
  const [sessionChoice, setSessionChoice] = useState<string | null>(
    entry ? initial.sessionId : request.mode === 'new' && request.sessionId !== undefined ? request.sessionId : 'auto',
  );
  const [hasDue, setHasDue] = useState(initial.due !== null);
  const [due, setDue] = useState(() => timeDraftOf(cal, initial.due ?? defaultDue(now)));
  const [done, setDone] = useState(initial.done);

  const at = timeLocked ? initial.at : timeOfDraft(cal, time);
  const dueAt = hasDue ? timeOfDraft(cal, due) : null;
  const sessions = useMemo(() => sessionsSorted(data).reverse(), [data]);
  const sessionId =
    sessionChoice === 'auto' ? (at !== null ? (sessionAt(data, at)?.id ?? null) : null) : sessionChoice;
  const isPromise = manual && kind === 'promise';
  const needsText = manual || entry?.kind === 'event';
  const problem =
    entryTimeProblem(data, entry, at) ||
    (isPromise && hasDue && dueAt === null ? 'Die Frist ist kein gültiges Datum.' : '');
  const ready = !problem && (!needsText || text.trim() !== '');

  const save = () => {
    if (!ready || at === null) return;
    const draft: EntryDraft = {
      kind: manual ? kind : initial.kind,
      text,
      at,
      placeId,
      refs,
      sessionId,
      due: isPromise ? dueAt : null,
      done: isPromise && done,
    };
    try {
      if (entry) db.patch('chronicle', entry.id, entryChange(entry, draft));
      else db.put('chronicle', entryFromDraft(draft));
      onClose();
    } catch (error) {
      toast({ title: 'Nicht gespeichert', body: (error as Error).message, tone: 'danger' });
    }
  };

  const remove = async () => {
    if (!entry) return;
    const ok = await confirmDialog({
      title: `${KIND_NAME[entry.kind]} löschen?`,
      body: deleteConsequence(data, entry),
      confirmLabel: 'Eintrag löschen',
      danger: true,
    });
    if (!ok) return;
    const current = db.getSnapshot().chronicle[entry.id];
    db.remove('chronicle', entry.id);
    onClose();
    if (current)
      toast({
        title: 'Eintrag gelöscht',
        body: entryHeadline(data, current) || current.text.slice(0, 120),
        action: { label: 'Rückgängig', run: () => db.put('chronicle', current) },
      });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    const singleLine = target instanceof HTMLInputElement && !target.closest('.wf-popover');
    if (e.ctrlKey || e.metaKey || singleLine) {
      e.preventDefault();
      save();
    }
  };

  // Das Textfeld wächst mit dem Text, damit auch lange Einträge am Stück zu lesen sind.
  const textRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);

  const KindIcon = entry ? CHRONICLE_KIND_ICON[entry.kind] : null;
  const headline = entry && !manual ? (entry.kind === 'event' ? '' : entryHeadline(data, entry)) : '';
  const today = dayIndexOf(now);

  return (
    <Dialog
      open
      onClose={onClose}
      title={entry ? `${KIND_NAME[entry.kind]} bearbeiten` : 'Eintrag nachtragen'}
      width={660}
      footer={
        <>
          {entry && (
            <Button variant="danger" icon={<Trash2 />} onClick={remove}>
              Löschen
            </Button>
          )}
          <span className="wf-grow wf-chronik-dialog__problem" role="alert">
            {problem}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={!ready} title="Strg+Eingabe">
            {entry ? 'Speichern' : 'Nachtragen'}
          </Button>
        </>
      }
    >
      <div className="wf-col wf-chronik-dialog" onKeyDown={onKeyDown}>
        {manual ? (
          <Tabs tabs={KIND_TABS} value={kind} onChange={setKind} />
        ) : (
          <div className="wf-chronik-dialog__auto">
            {KindIcon && <KindIcon />}
            <div>
              {headline && <div className="wf-chronik-dialog__headline">{headline}</div>}
              <div className="wf-mute">
                <Lock /> Automatisch entstanden.{' '}
                {entry?.kind === 'travel'
                  ? 'Weg und Ziel stehen fest; Anmerkung, Zeitpunkt und Verweise kannst du ergänzen.'
                  : entry?.kind === 'attitude'
                    ? 'Der Schritt steht fest; Grund, Zeitpunkt, Ort und Verweise kannst du ergänzen.'
                    : 'Der Zeitpunkt steht fest; Bezeichnung, Ort und Verweise kannst du ergänzen.'}
              </div>
            </div>
          </div>
        )}

        <Field
          label={
            manual
              ? 'Was ist geschehen?'
              : entry?.kind === 'travel'
                ? 'Anmerkung'
                : entry?.kind === 'attitude'
                  ? 'Grund'
                  : 'Bezeichnung'
          }
          hint={manual ? KIND_HINT[kind] : undefined}
        >
          <TextArea
            ref={textRef}
            data-autofocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={manual ? 'Strg+Eingabe speichert' : ''}
            style={manual ? undefined : { minHeight: 64 }}
          />
        </Field>

        <div>
          <WorldTimeFields cal={cal} value={time} onChange={setTime} disabled={timeLocked} />
          <div className="wf-field__hint wf-chronik-dialog__when">
            {at === null
              ? ' '
              : `${weekdayName(cal, at)} · ${relativeDay(today, dayIndexOf(at))}${
                  timeLocked ? ' · so im Kalender eingetreten' : ''
                }`}
          </div>
        </div>

        <div className="wf-form-grid">
          {entry?.kind === 'travel' ? (
            <Field label="Ort">
              <div className="wf-chronik-dialog__fixed" title="Bei einem Ortswechsel ist der Ort immer das Ziel.">
                <MapPin />
                <span className="wf-clamp-1">{entityName(data, placeId) || 'Unterwegs, ohne festen Ort'}</span>
              </div>
            </Field>
          ) : (
            <Field label="Ort">
              <EntityPicker
                value={placeId}
                onChange={setPlaceId}
                kinds={['place']}
                placeholder="Kein Ort"
                onCreate={(name) => db.put('entities', createEntity({ kind: 'place', name })).id}
              />
            </Field>
          )}
          <Field label="Session" hint={sessionChoice === 'auto' ? 'Richtet sich nach dem Zeitpunkt, solange du nichts wählst.' : undefined}>
            <Select value={sessionId ?? ''} onChange={(e) => setSessionChoice(e.target.value || null)}>
              <option value="">Keine Session</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {sessionLabel(s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Betrifft">
          <EntityRefsEditor value={refs} onChange={setRefs} placeholder="Person, Ort, Fraktion … verknüpfen" />
        </Field>

        {isPromise && (
          <div className="wf-chronik-dialog__promise">
            <div className="wf-spread">
              <Checkbox checked={hasDue} onChange={setHasDue}>
                Mit Frist
              </Checkbox>
              <Checkbox checked={done} onChange={setDone}>
                Erledigt
              </Checkbox>
            </div>
            {hasDue && <WorldTimeFields cal={cal} value={due} onChange={setDue} />}
          </div>
        )}
      </div>
    </Dialog>
  );
}
