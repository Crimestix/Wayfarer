/**
 * Dialog zum Bearbeiten eines Chronik-Eintrags und zum Nachtragen von Vergangenem – für jede Art,
 * die man festhält, auch Ortswechsel und Haltung zu einer früheren Zeit. Die Felder je Art teilt
 * er mit „Festhalten“ (`RecordFields`); gespeichert wird über `recordEntry` bzw.
 * `reviseRecorded`, gelöscht über `deleteRecorded` – so zieht die Wirkung eines Eintrags mit.
 */
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Lock, MapPin, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  CHOICE_HINT,
  KIND_HINT,
  PRECISION_LABEL,
  RECORD_GROUPS,
  type RecordKind,
} from '../../domain/chronicleKinds';
import { entityName, sessionsSorted } from '../../domain/derive';
import { placeForEntry, sessionForEntry } from '../../domain/history';
import {
  CHRONICLE_PRECISIONS,
  createEntity,
  type ChronicleEntry,
  type ChroniclePrecision,
} from '../../domain/schema';
import { dayIndexOf, weekdayName, type WorldTime } from '../../domain/time/calendar';
import {
  Button,
  CHRONICLE_KIND_ICON,
  Checkbox,
  Dialog,
  EntityPicker,
  EntityRefsEditor,
  Field,
  Select,
  TextArea,
  confirmDialog,
  toast,
} from '../../ui';
import {
  deleteRecorded,
  isFixedKind,
  isLootLine,
  recordFiled,
  reviseRecorded,
  revisionNeedsEffect,
  revisionPatch,
  withoutEntry,
} from './actions';
import {
  KIND_NAME,
  deleteConsequence,
  draftOf,
  entryChange,
  entryHeadline,
  entryTimeProblem,
  freeRefsOf,
  relativeDay,
  sessionLabel,
  timeDraftOf,
  timeOfDraft,
} from './model';
import { RecordFields } from './RecordFields';
import {
  choiceOfEntry,
  kindOfFields,
  draftOfEntry,
  emptyRecordDraft,
  partOf,
  recordCheck,
  recordInputOf,
  type RecordCommon,
  type RecordDraft,
  type RecordFieldsKind,
} from './recordDraft';
import { WorldTimeFields } from './WorldTimeFields';

/** Weiter hier zu haben, damit bestehende Importe gelten. */
export { WorldTimeFields };

export type EntryDialogRequest =
  | { mode: 'edit'; entry: ChronicleEntry }
  | { mode: 'new'; sessionId?: string | null; at?: WorldTime };

/** Wie das Textfeld je Art heißt – der Text ist bei manchen Arten das Eigentliche. */
const TEXT_LABEL: Partial<Record<RecordKind, string>> = {
  quote: 'Wortlaut',
  rumor: 'Was man sich erzählt',
  lore: 'Was festgelegt wurde',
  condition: 'Zustand',
  wish: 'Was der Spieler will',
  knowledge: 'Was erfahren wurde',
  decision: 'Was entschieden wurde',
  reveal: 'Was die Gruppe erfahren hat',
  travel: 'Anmerkung',
  attitude: 'Grund',
  writing: 'Wortlaut',
  downtime: 'Was in der Zeit geschah',
  transformation: 'Was sich wandelt',
  companion: 'Anmerkung',
};

/** Wie genau der Zeitpunkt bekannt ist – als Wahl im Dialog. */
const PRECISION_CHOICE: Record<ChroniclePrecision, string> = {
  exact: 'Genau',
  day: 'Nur der Tag',
  approx: 'Ungefähr',
  order: 'Nur die Reihenfolge',
};

/** Die Arten zum Wählen, in den Gruppen des Festhaltens („Beute“ geht über das Beute-Buch). */
const CHOICE_GROUPS = RECORD_GROUPS.map((group) => ({
  label: group.label,
  choices: group.choices.flatMap((c) =>
    c.choice === 'loot'
      ? []
      : [
          {
            choice: c.choice as RecordFieldsKind,
            label: c.choice === 'repute' ? 'Ruf (Haltung einer Fraktion)' : c.label,
          },
        ],
  ),
}));

const kindOf = (choice: RecordFieldsKind): RecordKind => kindOfFields(choice);

export function EntryDialog({
  request,
  onClose,
}: {
  request: EntryDialogRequest;
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const entry = request.mode === 'edit' ? request.entry : null;
  /** Ortswechsel, Haltung und Termin behalten beim Bearbeiten ihre Bedeutung. */
  const fixed = !!entry && isFixedKind(entry.kind);
  const timeLocked = entry?.kind === 'event';

  // Der Dialog arbeitet mit dem Stand beim Öffnen.
  const opened = useMemo(
    () => ({
      draft: entry ? draftOfEntry(entry) : emptyRecordDraft(),
      /** Die Zeile einer Ausgabe im Beute-Buch behält ihre Art. */
      lootLine: !!entry && isLootLine(data, entry.id),
      at: entry ? entry.at : request.mode === 'new' && request.at !== undefined ? request.at : now,
    }),
    [],
  );

  const [choice, setChoice] = useState<RecordFieldsKind>(entry ? choiceOfEntry(entry) : 'note');
  const [draft, setDraft] = useState<RecordDraft>(opened.draft);
  const [text, setText] = useState(entry?.text ?? '');
  const [time, setTime] = useState(() => timeDraftOf(cal, opened.at));
  /** undefined = der Ort der Gruppe zu dieser Zeit (nur beim Nachtragen). */
  const [placeChoice, setPlaceChoice] = useState<string | null | undefined>(
    entry ? entry.placeId : undefined,
  );
  const [refs, setRefs] = useState<string[]>(() =>
    entry ? (fixed ? draftOf(entry).refs : freeRefsOf(entry)) : [],
  );
  /** 'auto' = die Session, in deren Weltzeit der Zeitpunkt fällt. */
  const [sessionChoice, setSessionChoice] = useState<string | null>(
    entry
      ? entry.sessionId
      : request.mode === 'new' && request.sessionId !== undefined
        ? request.sessionId
        : 'auto',
  );
  const [precision, setPrecision] = useState<ChroniclePrecision>(entry?.precision ?? 'exact');
  const [secret, setSecret] = useState(entry?.secret ?? false);

  const kind = kindOf(choice);
  const at = timeLocked ? opened.at : timeOfDraft(cal, time);
  const sessions = useMemo(() => sessionsSorted(data).reverse(), [data]);
  const sessionId =
    sessionChoice === 'auto' ? (at !== null ? sessionForEntry(data, at) : null) : sessionChoice;
  const autoPlace = at !== null ? placeForEntry(data, at) : null;
  /** Bei Ortswechsel und Entdeckung ist der Ort das Ziel – er steht dann in den Angaben. */
  const placeInFields = !fixed && (kind === 'travel' || kind === 'discovery');

  const common: RecordCommon = {
    text,
    at: at ?? undefined,
    sessionId,
    // Ist „Ort“ ausgeblendet, gilt eine frühere Wahl dort nicht still als entdeckter Ort.
    placeId: placeInFields ? undefined : placeChoice,
    refs,
    secret,
    precision,
    storyId: entry ? entry.storyId : undefined,
  };
  const needsEffect = !!entry && !fixed && revisionNeedsEffect(entry, choice, draft, text);
  // Eine Änderung mit Wirkung wird geprüft, als gäbe es den alten Eintrag nicht mehr.
  const check = fixed
    ? null
    : recordCheck(
        entry && needsEffect ? withoutEntry(data, entry.id) : data,
        [partOf(choice, draft)],
        common,
      );
  const orderProblem =
    at === null
      ? 'Dieses Datum gibt es im Kalender nicht.'
      : entry && !needsEffect
        ? entryTimeProblem(data, entry, at)
        : '';
  const problem = orderProblem || (check?.problem ?? '');
  const ready = !problem && (entry?.kind !== 'event' || text.trim() !== '');
  // Fehlt nur der Text und ist noch nichts geschrieben, muss das nicht laut gesagt werden.
  const shownProblem = !orderProblem && check?.onlyText && !text.trim() ? '' : problem;

  const save = () => {
    if (!ready || at === null) return;
    try {
      if (entry && fixed) {
        db.patch('chronicle', entry.id, {
          ...entryChange(entry, {
            ...draftOf(entry),
            text,
            at,
            placeId: placeChoice ?? null,
            refs,
            sessionId,
            secret,
          }),
          precision,
        });
        onClose();
        return;
      }
      const input = recordInputOf(choice, draft, common, now);
      if (entry) {
        if (needsEffect) {
          const failed = reviseRecorded(db, entry.id, input);
          if (failed) {
            toast({ title: 'Nicht gespeichert', body: failed, tone: 'danger' });
            return;
          }
        } else
          db.patch(
            'chronicle',
            entry.id,
            revisionPatch(entry, input, { keepDue: draft.dueDays === opened.draft.dueDays }),
          );
        onClose();
        return;
      }
      const result = recordFiled(db, [input]);
      if ('problem' in result) {
        toast({ title: 'Nicht festgehalten', body: result.problem, tone: 'danger' });
        return;
      }
      const made = result.entries[0]!;
      onClose();
      toast({
        title: at < now ? 'Nachgetragen' : 'Festgehalten',
        body: entryHeadline(db.getSnapshot(), made) || made.text.slice(0, 120),
        action: { label: 'Rückgängig', run: result.undo },
      });
    } catch (error) {
      toast({ title: 'Nicht gespeichert', body: (error as Error).message, tone: 'danger' });
    }
  };

  const remove = async () => {
    if (!entry) return;
    const current = db.getSnapshot().chronicle[entry.id];
    if (!current) return onClose();
    const ok = await confirmDialog({
      title: `${KIND_NAME[entry.kind]} löschen?`,
      body: deleteConsequence(db.getSnapshot(), current),
      confirmLabel: 'Eintrag löschen',
      danger: true,
    });
    if (!ok) return;
    const headline = entryHeadline(db.getSnapshot(), current);
    const undo = deleteRecorded(db, entry.id);
    onClose();
    if (undo)
      toast({
        title: 'Eintrag gelöscht',
        body: headline || current.text.slice(0, 120),
        action: { label: 'Rückgängig', run: undo },
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
  const headline = entry && fixed && entry.kind !== 'event' ? entryHeadline(data, entry) : '';
  const today = dayIndexOf(now);
  const earlier = at !== null && at < now;
  const textLabel =
    entry?.kind === 'event' ? 'Bezeichnung' : (TEXT_LABEL[kind] ?? 'Was ist geschehen?');

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        entry
          ? `${KIND_NAME[entry.kind]} bearbeiten`
          : earlier
            ? 'Eintrag nachtragen'
            : 'Eintrag festhalten'
      }
      width={680}
      footer={
        <>
          {entry && (
            <Button variant="danger" icon={<Trash2 />} onClick={remove}>
              Löschen
            </Button>
          )}
          <span className="wf-grow wf-chronik-dialog__problem" role="alert">
            {shownProblem}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={!ready} title="Strg+Eingabe">
            {entry ? 'Speichern' : earlier ? 'Nachtragen' : 'Festhalten'}
          </Button>
        </>
      }
    >
      <div className="wf-col wf-chronik-dialog" onKeyDown={onKeyDown}>
        {fixed ? (
          <div className="wf-chronik-dialog__auto">
            {KindIcon && <KindIcon />}
            <div>
              {headline && <div className="wf-chronik-dialog__headline">{headline}</div>}
              <div className="wf-mute">
                <Lock /> Steht fest.{' '}
                {entry?.kind === 'travel'
                  ? 'Weg und Ziel bleiben; Anmerkung, Zeitpunkt und Verweise kannst du ergänzen.'
                  : entry?.kind === 'attitude'
                    ? 'Der Schritt bleibt; Grund, Zeitpunkt, Ort und Verweise kannst du ergänzen.'
                    : 'Der Zeitpunkt bleibt; Bezeichnung, Ort und Verweise kannst du ergänzen.'}
              </div>
            </div>
          </div>
        ) : (
          <Field
            label="Art"
            hint={
              opened.lootLine
                ? 'Die Zeile einer Ausgabe im Beute-Buch behält ihre Art.'
                : needsEffect
                  ? 'Beim Speichern gilt die Wirkung neu – die alte wird zurückgenommen.'
                  : choice === 'job'
                    ? CHOICE_HINT.job
                    : KIND_HINT[kind]
            }
          >
            <Select
              value={choice}
              disabled={opened.lootLine}
              aria-label="Art des Eintrags"
              onChange={(e) => setChoice(e.target.value as RecordFieldsKind)}
            >
              {CHOICE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.choices.map((c) => (
                    <option key={c.choice} value={c.choice}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
        )}

        <Field label={textLabel}>
          <TextArea
            ref={textRef}
            data-autofocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={fixed ? '' : 'Strg+Eingabe speichert'}
            style={fixed ? { minHeight: 64 } : undefined}
          />
        </Field>

        {!fixed && <RecordFields kind={choice} draft={draft} onChange={setDraft} at={at ?? now} />}

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
              <div
                className="wf-chronik-dialog__fixed"
                title="Bei einem Ortswechsel ist der Ort immer das Ziel."
              >
                <MapPin />
                <span className="wf-clamp-1">
                  {entityName(data, entry.placeId) || 'Unterwegs, ohne festen Ort'}
                </span>
              </div>
            </Field>
          ) : (
            !placeInFields && (
              <Field
                label="Ort"
                hint={
                  placeChoice === undefined
                    ? 'Wo die Gruppe zu dieser Zeit war, solange du nichts wählst.'
                    : undefined
                }
              >
                <EntityPicker
                  value={placeChoice === undefined ? autoPlace : placeChoice}
                  onChange={setPlaceChoice}
                  kinds={['place']}
                  placeholder="Kein Ort"
                  onCreate={(name) => db.put('entities', createEntity({ kind: 'place', name })).id}
                />
              </Field>
            )
          )}
          <Field
            label="Session"
            hint={
              sessionChoice === 'auto'
                ? 'Richtet sich nach dem Zeitpunkt, solange du nichts wählst.'
                : undefined
            }
          >
            <Select
              value={sessionId ?? ''}
              onChange={(e) => setSessionChoice(e.target.value || null)}
            >
              <option value="">Keine Session</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {sessionLabel(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Zeitpunkt bekannt"
            hint={
              precision === 'exact' || precision === 'day'
                ? undefined
                : `In der Chronik steht „${PRECISION_LABEL.approx}“.`
            }
          >
            <Select
              value={precision}
              disabled={timeLocked}
              onChange={(e) => setPrecision(e.target.value as ChroniclePrecision)}
            >
              {CHRONICLE_PRECISIONS.map((value) => (
                <option key={value} value={value}>
                  {PRECISION_CHOICE[value]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Betrifft">
          <EntityRefsEditor
            value={refs}
            onChange={setRefs}
            placeholder="Person, Ort, Fraktion … verknüpfen"
          />
        </Field>

        <Checkbox checked={secret} onChange={setSecret}>
          Nur für die Spielleitung – fehlt in der Zusammenfassung für die Spieler
        </Checkbox>
      </div>
    </Dialog>
  );
}
