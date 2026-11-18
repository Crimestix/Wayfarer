/** Dialoge des Gerüsts: festhalten, Haltung ändern, Ort wechseln, Zeit vergehen lassen, suchen. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import {
  ArrowRight,
  CalendarDays,
  Castle,
  Coins,
  FileText,
  Footprints,
  Gauge,
  Hourglass,
  Library,
  Lightbulb,
  Map as MapIcon,
  MousePointerClick,
  Repeat,
  Settings,
  Route as RouteIcon,
  Search,
  NotebookPen,
  ScrollText,
  Skull,
  Sailboat,
  Store,
  Swords,
  Tent,
  Waypoints,
  DoorOpen,
} from 'lucide-react';
import { advanceTime, moveParty, setAttitude, setTime, undoTimeAdvance } from '../data/actions';
import type { TimeAdvanceResult } from '../data/actions';
import type { CampaignDb } from '../data/db';
import { useData, useDb } from '../data/hooks';
import {
  CHOICE_HINT,
  KIND_HINT,
  RECORD_GROUPS,
  isOwnDialogChoice,
  type RecordChoice,
} from '../domain/chronicleKinds';
import {
  entityName,
  findRelation,
  placePath,
  sessionsSorted,
  signedAttitude,
} from '../domain/derive';
import { placeForEntry, sessionForEntry } from '../domain/history';
import { forcedMarch, marchAfter, marchRule, marchedMinutes } from '../domain/march';
import { ledMembers } from '../domain/party';
import { recognizeDelivery, recognizeEntry, type Recognized } from '../domain/recognize';
import { attitudeLabel } from '../domain/relations';
import { attitudeModeChoice, attitudeTargets, type AttitudeMode } from '../domain/attitudeSetting';
import {
  PARTY_ID,
  createEntity,
  createEvent,
  type CampaignData,
  type ChronicleEntry,
  type Entity,
} from '../domain/schema';
import {
  absoluteYear,
  dayIndexOf,
  displayYear,
  formatClock,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatDuration,
  fromTime,
  isValidDate,
  primaryEra,
  toTime,
  weekdayName,
  type WorldTime,
} from '../domain/time/calendar';
import { AREAS } from '../features/registry';
import {
  AttitudeModePick,
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
  NameMemory,
  Popover,
  Select,
  Tabs,
  TextArea,
  entityHref,
  openSheet,
  sheetOpensAt,
  toast,
} from '../ui';
import {
  WALK_KMH,
  describeVia,
  formatWayTime,
  routeBetween,
  routeDetour,
  routeFit,
  routeMeans,
  routeNotes,
  suggestedKm,
} from '../domain/ways';
import { rememberWay, walk, type WalkResult } from '../features/wege/actions';
import { DurationField } from '../features/wege/DurationField';
import { MeansIcon } from '../features/fortbewegung/parts';
import { TravelBy } from '../features/fortbewegung/TravelBy';
import { meansKmh, partyTravel, travelNotes } from '../domain/mounts';
import { RestDialog } from '../features/gruppe/RestDialog';
import { DowntimeDialog } from '../features/gruppe/DowntimeDialog';
import { LootDialog } from '../features/beute/LootDialog';
import { GuessDialog } from '../features/spielerbuch/GuessDialog';
import { TradeDialog } from '../features/laden/TradeDialog';
import { SpellDialog } from '../features/tisch/SpellDialog';
import { RecordFields } from '../features/chronik/RecordFields';
import { WorldTimeFields } from '../features/chronik/WorldTimeFields';
import {
  entryHeadline,
  relativeDay,
  sessionLabel,
  timeDraftOf,
  timeOfDraft,
} from '../features/chronik/model';
import { deleteRecorded } from '../features/chronik/actions';
import { recordFiled } from '../features/chronik/actions';
import {
  deliveryEvent,
  emptyRecordDraft,
  fieldsLabel,
  hasRecordFields,
  kindOfFields,
  isAccepted,
  partOf,
  prefillFromRefs,
  recordCheck,
  recordInputs,
  recognizedKey,
  toggleChoice,
  toggleRecognized,
  type RecordCommon,
  type RecordDraft,
  type RecordPart,
} from '../features/chronik/recordDraft';
import { activeMention, insertMention, mentionSuggestions } from '../features/tisch/model';
import type { RestResult } from '../features/gruppe/rest';
import type { DowntimeResult } from '../features/gruppe/downtime';
import { focusOn, type Focus } from './focus';
import { hasNews, meanwhile } from './meanwhile';
import { searchWorld, type SearchSort } from './search';
import { JourneyDialog } from '../features/reise/JourneyDialog';
import {
  closeShellRequest,
  openDowntime,
  openJourney,
  openMoveParty,
  openQuickLog,
  openRest,
  openShop,
  openSpell,
  openTimeDialog,
  useShellRequest,
  type AttitudeRequest,
  type QuickLogRequest,
} from './commands';
import { findHandgrips, type GripRun } from './handgrips';
import { openNew } from '../features/welt/editor';
import { newStory } from '../features/faeden/actions';

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

const happened = hasNews;

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
export function walkAndReport(
  db: CampaignDb,
  go: () => WalkResult,
  /** Getrennte Wege: Geht nur ein Teil, wer – die geleitete Teilgruppe bleibt. */
  goers?: string,
  toId?: string,
) {
  try {
    const result = go();
    const data = db.getSnapshot();
    const name = entityName(data, goers ? (toId ?? null) : data.state.placeId);
    // Seit der letzten Langen Rast über acht Stunden unterwegs: nur ein Hinweis, nie ein Halt.
    const march =
      !goers && result.minutes > 0 ? forcedMarch(marchedMinutes(data, data.state.now)) : null;
    const news = result.advance && happened(result.advance);
    toast({
      title: goers
        ? `${goers} ${result.minutes > 0 ? `um ${formatClock(data.state.now + result.minutes)} ` : ''}in ${name} – eigene Teilgruppe`
        : result.minutes > 0
          ? `Angekommen: ${name} – ${formatWayTime(result.minutes)} unterwegs`
          : `Angekommen: ${name}`,
      body:
        news || march ? (
          <>
            {march && <div>{marchRule(march)}</div>}
            {news && meanwhileBody(data, result.advance!, 'Währenddessen:')}
          </>
        ) : undefined,
      action: { label: 'Rückgängig', run: result.undo },
      duration: result.advance?.steps.length || march ? 14000 : undefined,
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

/** Meldet freie Zeit: was fertig wurde, wem es jetzt gehört, und was in der Zeit eingetreten ist. */
function reportDowntime(data: CampaignData, result: DowntimeResult) {
  const finished = result.finished.map((p) => p.name);
  const lead = [
    result.text,
    finished.length ? `Fertig: ${finished.join(', ')}.` : '',
    ...result.handed.map((h) => `${h.item} gehört jetzt ${h.holder}.`),
  ]
    .filter(Boolean)
    .join(' ');
  toast({
    title: `${formatDuration(result.advance.to - result.advance.from)} freie Zeit`,
    body: meanwhileBody(data, result.advance, lead),
    action: { label: 'Rückgängig', run: result.undo },
    duration: 14000,
  });
}

// ── Festhalten ─────────────────────────────────────────────────────────────

/** Wie lange nach dem letzten Tastendruck Wayfarer den Text liest. */
const RECOGNIZE_DELAY = 250;

/** Vorschläge aus dem Text – erst, wenn eine Weile nicht getippt wurde. */
function useRecognized(data: CampaignData, text: string, refs: string[]): Recognized[] {
  const [found, setFound] = useState<Recognized[]>(() => recognizeEntry(data, text, { refs }));
  useEffect(() => {
    const timer = setTimeout(() => setFound(recognizeEntry(data, text, { refs })), RECOGNIZE_DELAY);
    return () => clearTimeout(timer);
  }, [data, text, refs]);
  return found;
}

/**
 * Das Textfeld des Festhaltens: wächst mit dem Text, „@“ schlägt Einträge der Welt vor wie in der
 * Mitschrift. Ein gewählter Name bleibt im Text stehen und kommt zu „Betrifft“.
 */
function MentionArea({
  value,
  onChange,
  onMention,
}: {
  value: string;
  onChange: (text: string) => void;
  onMention: (id: string) => void;
}) {
  const data = useData();
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(value.length);
  /** Position des „@“, dessen Vorschläge weggeklickt wurden. */
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [picked, setPicked] = useState(0);
  const range = useMemo(() => activeMention(value, caret), [value, caret]);
  const suggestions = useMemo(
    () => (range && range.start !== dismissed ? mentionSuggestions(data, range.query) : []),
    [data, range, dismissed],
  );
  const open = suggestions.length > 0;
  const active = Math.min(picked, Math.max(0, suggestions.length - 1));

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
    if (pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const pick = (entity: Entity) => {
    if (!range) return;
    const next = insertMention(value, range, entity.name);
    pendingCaret.current = next.caret;
    setCaret(next.caret);
    setPicked(0);
    onChange(next.text);
    onMention(entity.id);
    field.current?.focus();
  };

  return (
    <div ref={box}>
      <TextArea
        ref={field}
        data-autofocus
        className="wf-shell-log__text"
        aria-label="Was ist geschehen?"
        aria-autocomplete="list"
        aria-expanded={open}
        placeholder="Was ist geschehen? Mit @ verknüpfst du Namen der Welt."
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setPicked(0);
          setDismissed((at) => (at !== null && e.target.value[at] === '@' ? at : null));
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (!open || e.nativeEvent.isComposing || e.ctrlKey || e.metaKey) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setPicked((active + step + suggestions.length) % suggestions.length);
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            pick(suggestions[active]!);
          } else if (e.key === 'Escape') {
            // Nur die Vorschläge schließen, nicht den Dialog.
            e.preventDefault();
            e.stopPropagation();
            setDismissed(range?.start ?? null);
          }
        }}
      />
      <Popover
        open={open}
        onClose={() => setDismissed(range?.start ?? null)}
        anchor={box}
        className="wf-shell-suggest"
      >
        {/* Die Schreibmarke bleibt im Feld, auch wenn man einen Vorschlag anklickt. */}
        <div role="listbox" aria-label="Vorschläge" onMouseDown={(e) => e.preventDefault()}>
          <div className="wf-shell-suggest__head">
            {range?.query ? 'Verknüpfen mit' : 'Hier am Ort · weitertippen sucht überall'}
          </div>
          {suggestions.map((entity, i) => (
            <MenuItem
              key={entity.id}
              icon={<KindIcon kind={entity.kind} />}
              active={i === active}
              onClick={() => pick(entity)}
            >
              {entity.name}
            </MenuItem>
          ))}
        </div>
      </Popover>
    </div>
  );
}

/** Ein Eintrag in einer Zeile für die Meldung danach. */
const toastLine = (data: CampaignData, entry: ChronicleEntry) => {
  const line = entryHeadline(data, entry) || entry.text;
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
};

/**
 * „Festhalten“: Text zuerst, darunter erkannte Vorschläge, die Arten in fünf Gruppen und je Art
 * ihre Felder. Jetzt oder zu einer früheren Weltzeit – alles geht über `recordEntry` bzw.
 * `recordEntries` (mehrere Arten aus einem Satz).
 */
function QuickLogDialog({ request }: { request: QuickLogRequest }) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const [text, setText] = useState(request.text ?? '');
  const [refs, setRefs] = useState<string[]>(request.refs ?? []);
  const [parts, setParts] = useState<RecordPart[]>(() => {
    if (request.parts?.length) return request.parts;
    const choice = request.kind ?? 'note';
    return [partOf(choice, prefillFromRefs(data, choice, emptyRecordDraft(), request.refs ?? []))];
  });
  const [secret, setSecret] = useState(false);
  const earlierAt = request.at !== undefined && request.at < now ? request.at : null;
  const [earlier, setEarlier] = useState(earlierAt !== null);
  const [time, setTimeDraft] = useState(() => timeDraftOf(cal, earlierAt ?? now));
  const [approx, setApprox] = useState(false);
  /** 'auto' = nach der Zeit, '' = keine Session, sonst die gewählte. */
  const [sessionChoice, setSessionChoice] = useState('auto');
  /** undefined = Ort der Gruppe zu dieser Zeit. */
  const [placeChoice, setPlaceChoice] = useState<string | null | undefined>(undefined);
  const [loot, setLoot] = useState(request.own === 'loot');
  /** „Handel“ gewählt: Der Laden öffnet sich – dort wird zusammengestellt, was gekauft wird. */
  const [trading, setTrading] = useState(request.own === 'trade');
  /** „Vermutung“ gewählt: Text und „Betrifft“ gehen ins Spielerbuch, nicht in die Chronik. */
  const [guessing, setGuessing] = useState(request.own === 'guess');
  /** Bestellung oder Lieferung „in 3 Tagen“ zusätzlich als Termin eintragen. */
  const [asEvent, setAsEvent] = useState(false);
  /**
   * Wer mit einer Art hereinkommt (aus der Mitschrift, „Haltung …“), sieht nur sie – die übrigen
   * dreißig erst mit „Andere Art …“. Ohne Art steht das ganze Raster da.
   */
  const [allKinds, setAllKinds] = useState(!(request.parts?.length || request.kind));
  const recognized = useRecognized(data, text, refs);
  const delivery = useMemo(() => recognizeDelivery(text), [text]);

  const at = earlier ? timeOfDraft(cal, time) : now;
  const when = at ?? now;
  const showPlace = parts.some((part) => part.choice !== 'travel' && part.choice !== 'discovery');
  const common: RecordCommon = {
    text,
    at: earlier && at !== null ? at : undefined,
    sessionId: sessionChoice === 'auto' ? undefined : sessionChoice || null,
    // Ist „Wo“ ausgeblendet, gilt eine frühere Wahl dort nicht still als entdeckter Ort.
    placeId: showPlace ? placeChoice : undefined,
    refs,
    secret,
    precision: earlier && approx ? 'approx' : undefined,
  };
  const check =
    at === null
      ? { problem: 'Dieses Datum gibt es im Kalender nicht.', onlyText: false }
      : recordCheck(data, parts, common);
  const problem = check.onlyText && !text.trim() ? '' : check.problem;
  const sessions = useMemo(() => sessionsSorted(data).reverse(), [data]);
  const autoSession = sessionForEntry(data, when);
  const autoPlace = placeForEntry(data, when);
  const planned = delivery ? deliveryEvent(delivery, when, now) : null;

  const toggle = (choice: RecordChoice) => {
    if (choice === 'loot') {
      setLoot(true);
      return;
    }
    if (choice === 'guess') {
      setGuessing(true);
      return;
    }
    if (choice === 'trade') {
      setTrading(true);
      return;
    }
    // Eine neu gewählte Art übernimmt „Wer“ aus „Betrifft“, wenn dort genau einer passt.
    setParts((current) =>
      toggleChoice(current, choice).map((part) =>
        part.source === null && !current.includes(part)
          ? { ...part, draft: prefillFromRefs(data, part.choice, part.draft, refs) }
          : part,
      ),
    );
  };
  const accept = (item: Recognized) => {
    const next = toggleRecognized(parts, item);
    setParts(next.parts);
    if (next.refs.length) setRefs((current) => [...new Set([...current, ...next.refs])]);
  };
  const removePart = (key: string) =>
    setParts((current) => {
      const rest = current.filter((part) => part.key !== key);
      return rest.length ? rest : [partOf('note')];
    });
  const setDraft = (key: string, draft: RecordDraft) =>
    setParts((current) => current.map((part) => (part.key === key ? { ...part, draft } : part)));

  const save = () => {
    if (check.problem) return;
    const inputs = recordInputs(parts, common, now);
    const result = recordFiled(db, inputs);
    if ('problem' in result) {
      toast({ title: 'Nicht festgehalten', body: result.problem, tone: 'danger' });
      return;
    }
    const { entries } = result;
    // Eine umgewandelte Notiz tritt ab: Der neue Eintrag steht an ihrer Stelle.
    const replaced =
      request.replaces && db.getSnapshot().chronicle[request.replaces]?.kind === 'note'
        ? deleteRecorded(db, request.replaces)
        : null;
    request.onSaved?.();
    // Die Lieferung als Termin: ein Vorhaben am Tag, an dem es so weit ist.
    const event =
      asEvent && planned
        ? db.put(
            'events',
            createEvent({
              title: planned.title,
              at: planned.at,
              kind: 'plan',
              placeId: placeChoice === undefined ? autoPlace : placeChoice,
              refs,
            }),
          )
        : null;
    const undo = () =>
      db.batch(() => {
        if (event && db.getSnapshot().events[event.id]?.rev === event.rev)
          db.remove('events', event.id);
        result.undo();
        replaced?.();
      });
    closeShellRequest();
    const after = db.getSnapshot();
    toast({
      title: entries.length > 1 ? `${entries.length} Einträge festgehalten` : 'Festgehalten',
      body: (
        <>
          {entries.map((entry) => (
            <div key={entry.id}>{toastLine(after, entry)}</div>
          ))}
          {event && (
            <div>
              Termin: {event.title} – {formatDate(cal, event.at)}
            </div>
          )}
          {when < now && <div className="wf-mute">Nachgetragen: {formatDateTime(cal, when)}</div>}
        </>
      ),
      action: { label: 'Rückgängig', run: undo },
    });
  };

  if (loot) return <LootDialog give preset={request.loot} onClose={closeShellRequest} />;
  if (trading) return <TradeDialog shopId={null} onClose={closeShellRequest} />;
  if (guessing)
    return (
      <GuessDialog
        preset={{ text, refs, at: earlier && at !== null ? at : undefined }}
        onClose={closeShellRequest}
      />
    );

  // Vorschläge, die übernommen sind, aber nicht mehr im Text stehen, bleiben sichtbar.
  const keys = new Set(recognized.map(recognizedKey));
  const orphans = parts.filter((part) => part.source && !keys.has(part.source));
  const single = parts.length === 1 ? parts[0]!.choice : null;
  const pressed = (choice: RecordChoice) => parts.some((part) => part.choice === choice);

  return (
    <Dialog
      open
      onClose={closeShellRequest}
      title="Festhalten"
      width={760}
      footer={
        <>
          <Checkbox checked={secret} onChange={setSecret}>
            Nur für die Spielleitung
          </Checkbox>
          <span className="wf-grow wf-shell-log__problem" role="alert">
            {problem}
          </span>
          <Button onClick={closeShellRequest}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={!!check.problem} title="Strg+Eingabe">
            Festhalten
          </Button>
        </>
      }
    >
      <div
        className="wf-shell-log"
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.defaultPrevented || !(e.ctrlKey || e.metaKey)) return;
          e.preventDefault();
          save();
        }}
      >
        <div>
          <MentionArea
            value={text}
            onChange={setText}
            onMention={(id) =>
              setRefs((current) => (current.includes(id) ? current : [...current, id]))
            }
          />
          <NameMemory text={text} refs={refs} link={false} />
          <div className="wf-field__hint">
            {single
              ? single === 'job'
                ? CHOICE_HINT.job
                : KIND_HINT[kindOfFields(single)]
              : `${parts.length} Einträge aus einem Text – je Art mit eigenen Angaben.`}
          </div>
        </div>

        <div className="wf-shell-log__seen" aria-live="polite">
          <span className="wf-caps">Erkannt</span>
          {recognized.map((item) => {
            const on = isAccepted(parts, item);
            return (
              <button
                key={recognizedKey(item)}
                type="button"
                className="wf-shell-chip"
                aria-pressed={on}
                title={on ? 'Wieder wegnehmen' : 'Art und Angaben übernehmen'}
                onClick={() => accept(item)}
              >
                {item.label}
              </button>
            );
          })}
          {orphans.map((part) => (
            <button
              key={part.key}
              type="button"
              className="wf-shell-chip"
              aria-pressed
              title="Wieder wegnehmen"
              onClick={() => removePart(part.key)}
            >
              {part.sourceLabel ?? fieldsLabel(part.choice)}
            </button>
          ))}
          {planned && delivery && (
            <Checkbox checked={asEvent} onChange={setAsEvent}>
              Als Termin eintragen: in{' '}
              {delivery.days === 1 ? 'einem Tag' : `${delivery.days} Tagen`} (
              {formatDate(cal, planned.at)})
            </Checkbox>
          )}
          <span className="wf-mute">
            {recognized.length + orphans.length === 0
              ? text.trim()
                ? '– nichts Bestimmtes. Wähle die Art selbst.'
                : '– beim Schreiben schlägt Wayfarer hier Arten vor.'
              : parts.some((part) => part.source)
                ? '– ein Klick auf einen übernommenen nimmt ihn wieder weg'
                : '– ein Klick übernimmt Art und Angaben'}
          </span>
        </div>

        {!allKinds ? (
          <div className="wf-shell-kinds wf-shell-kinds--chosen" role="group" aria-label="Art">
            <div className="wf-shell-kinds__group">
              <div className="wf-caps">Art</div>
              {parts.map((part) => (
                <button
                  key={part.key}
                  type="button"
                  className="wf-shell-kind"
                  aria-pressed
                  title={KIND_HINT[kindOfFields(part.choice)]}
                  onClick={() => setAllKinds(true)}
                >
                  {fieldsLabel(part.choice)}
                </button>
              ))}
              <button
                type="button"
                className="wf-shell-kind wf-shell-kind--more"
                onClick={() => setAllKinds(true)}
              >
                Andere Art …
              </button>
            </div>
          </div>
        ) : (
          <div className="wf-shell-kinds" role="group" aria-label="Art">
            {RECORD_GROUPS.map((group) => (
              <div key={group.id} className="wf-shell-kinds__group">
                <div className="wf-caps">{group.label}</div>
                {group.choices.map(({ choice, label }) => (
                  <button
                    key={choice}
                    type="button"
                    className="wf-shell-kind"
                    aria-pressed={isOwnDialogChoice(choice) ? undefined : pressed(choice)}
                    title={
                      choice === 'loot' ||
                      choice === 'repute' ||
                      choice === 'job' ||
                      choice === 'guess'
                        ? CHOICE_HINT[choice]
                        : KIND_HINT[choice]
                    }
                    onClick={() => toggle(choice)}
                  >
                    {label}
                    {choice === 'repute' && (
                      <span className="wf-shell-kind__aside"> (Fraktion)</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="wf-form-grid">
          <Field label="Wann">
            <Select
              value={earlier ? 'earlier' : 'now'}
              onChange={(e) => setEarlier(e.target.value === 'earlier')}
            >
              <option value="now">Jetzt – {formatDateTime(cal, now)}</option>
              <option value="earlier">Früher …</option>
            </Select>
          </Field>
          {showPlace ? (
            <Field
              label="Wo"
              hint={placeChoice === undefined ? 'Wo die Gruppe zu dieser Zeit war.' : undefined}
            >
              <EntityPicker
                value={placeChoice === undefined ? autoPlace : placeChoice}
                onChange={setPlaceChoice}
                kinds={['place']}
                placeholder="Kein Ort"
                onCreate={(name) => db.put('entities', createEntity({ kind: 'place', name })).id}
              />
            </Field>
          ) : (
            <span />
          )}
          {earlier && (
            <div className="wf-span-2">
              <WorldTimeFields cal={cal} value={time} onChange={setTimeDraft} />
              <div className="wf-spread wf-shell-log__when">
                <span className="wf-field__hint">
                  {at === null
                    ? 'Dieses Datum gibt es im Kalender nicht.'
                    : at > now
                      ? 'Das liegt in der Zukunft.'
                      : `${weekdayName(cal, at)} · ${relativeDay(dayIndexOf(now), dayIndexOf(at))} · nachgetragen, ohne dass Zeit vergeht`}
                </span>
                <Checkbox checked={approx} onChange={setApprox}>
                  Nur ungefähr bekannt
                </Checkbox>
              </div>
            </div>
          )}
        </div>

        {parts
          .filter((part) => hasRecordFields(part.choice))
          .map((part) => (
            <section key={part.key} className="wf-shell-log__part">
              <div className="wf-caps">{fieldsLabel(part.choice)}</div>
              <RecordFields
                kind={part.choice}
                draft={part.draft}
                onChange={(draft) => setDraft(part.key, draft)}
                at={when}
              />
            </section>
          ))}

        <div className="wf-form-grid wf-shell-log__part">
          <Field
            label="Session"
            hint={sessionChoice === 'auto' ? 'Richtet sich nach dem Zeitpunkt.' : undefined}
          >
            <Select value={sessionChoice} onChange={(e) => setSessionChoice(e.target.value)}>
              <option value="auto">
                Nach der Zeit:{' '}
                {autoSession && data.sessions[autoSession]
                  ? sessionLabel(data.sessions[autoSession])
                  : 'keine Session'}
              </option>
              <option value="">Keine Session</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {sessionLabel(session)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Betrifft">
            <EntityRefsEditor
              value={refs}
              onChange={setRefs}
              placeholder="Person, Ort, Fraktion … verknüpfen"
            />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

// ── Haltung ────────────────────────────────────────────────────────────────

function AttitudeDialog({ request }: { request: AttitudeRequest }) {
  const db = useDb();
  const data = useData();
  // Gegenüber: die Gruppe oder ein einzelner Gefährte (`attitudeTargets`); Vorgabe die Gruppe.
  const [targets] = useState(() => attitudeTargets(data, request.fromId, request.toId));
  const [toId, setToId] = useState(request.toId ?? PARTY_ID);
  const before = findRelation(data, request.fromId, toId)?.attitude ?? null;
  const [value, setValue] = useState<number | null>(before);
  const [reason, setReason] = useState('');
  const [choice, setChoice] = useState(() => attitudeModeChoice(data, request.fromId, toId));
  const [mode, setMode] = useState<AttitudeMode>(choice.preset);
  const given = mode === 'given' && choice.givenPossible;
  const pickTarget = (id: string) => {
    if (id === toId) return;
    const next = attitudeModeChoice(data, request.fromId, id);
    setToId(id);
    setValue(findRelation(data, request.fromId, id)?.attitude ?? null);
    setChoice(next);
    setMode(next.preset);
  };
  const save = () => {
    setAttitude(db, request.fromId, toId, value, given ? '' : reason, given ? 'given' : 'change');
    closeShellRequest();
  };
  return (
    <Dialog
      open
      onClose={closeShellRequest}
      title={before === null ? 'Haltung' : 'Haltung ändern'}
      width={520}
      footer={
        <>
          <Button onClick={closeShellRequest}>Abbrechen</Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={value === before && (given || !reason.trim())}
          >
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
        {targets.length > 1 && (
          <Field
            label="Gegenüber"
            hint="Zur ganzen Gruppe oder zu einem Gefährten – etwa wenn jemand Neil nicht mag, Tomlin aber schon."
          >
            <div
              className="wf-btn-group"
              role="group"
              aria-label="Gegenüber"
              style={{ flexWrap: 'wrap' }}
            >
              {targets.map((target) => (
                <Button
                  key={target.id}
                  size="sm"
                  aria-pressed={toId === target.id}
                  title={`Bisher: ${attitudeLabel(target.value)}`}
                  onClick={() => pickTarget(target.id)}
                >
                  {target.id === PARTY_ID ? 'zur Gruppe' : `zu ${target.name}`}
                  {target.value !== null && ` ${signedAttitude(target.value)}`}
                </Button>
              ))}
            </div>
          </Field>
        )}
        <AttitudeScale value={value} onChange={setValue} />
        {value !== before && (
          <div className="wf-mute" style={{ fontSize: 'var(--text-sm)' }}>
            Bisher: {attitudeLabel(before)}
          </div>
        )}
        <AttitudeModePick value={mode} onChange={setMode} givenPossible={choice.givenPossible} />
        {!given && (
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
        )}
      </div>
    </Dialog>
  );
}

// ── Ort wechseln ───────────────────────────────────────────────────────────

function MovePartyDialog({
  preset,
  presetText,
  onSaved,
}: {
  preset?: string;
  presetText?: string;
  onSaved?: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [placeId, setPlaceId] = useState<string | null>(preset ?? null);
  const [text, setText] = useState(presetText ?? '');
  const here = data.state.placeId;
  // Kennt das Wegenetz eine Route, ist ihre Dauer die Vorgabe; sonst wählt der Spielleiter.
  // Womit die Gruppe reist (zu Fuß, Pferd, Schiff), zählt mit (`domain/mounts.ts`).
  const travel = useMemo(() => partyTravel(data), [data]);
  const route = useMemo(
    () => (here && placeId ? routeBetween(data, here, placeId, travel) : null),
    [data, here, placeId, travel],
  );
  const km = here && placeId && !route ? suggestedKm(data, here, placeId) : null;
  const kmh = (travel.by && meansKmh(travel.by)) ?? WALK_KMH.normal;
  const suggested = km === null ? null : Math.max(1, Math.round((km / kmh) * 60));
  const [chosen, setChosen] = useState<number | null>(null);
  const [passTime, setPassTime] = useState(true);
  const [remember, setRemember] = useState(true);
  const minutes = route ? (passTime ? route.minutes : 0) : (chosen ?? suggested ?? 0);
  const moving = placeId !== null && here !== null && placeId !== here;
  // Getrennte Wege: Wer geht? Vorgabe: alle, die gerade geleitet werden.
  const mates = useMemo(() => ledMembers(data), [data]);
  const [goers, setGoers] = useState<string[]>(mates);
  const part = goers.length > 0 && goers.length < mates.length;
  const arrival = data.state.now + minutes;
  const save = () => {
    closeShellRequest();
    onSaved?.();
    if (!placeId) {
      moveParty(db, placeId, text, part ? goers : []);
      return;
    }
    const means = route ? routeMeans(route) : travel.by ? [travel.by] : [];
    const note = [
      text.trim(),
      route ? describeVia(data, route) : '',
      means.length ? `mit ${means.map((mount) => mount.name).join(' und ')}` : '',
      minutes > 0 ? formatWayTime(minutes) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    walkAndReport(
      db,
      () => {
        if (!route && remember && here && minutes > 0) rememberWay(db, here, placeId, minutes);
        return walk(db, placeId, minutes, note, part ? goers : []);
      },
      part ? goers.map((id) => entityName(data, id)).join(', ') : undefined,
      placeId,
    );
  };
  return (
    <Dialog
      open
      onClose={closeShellRequest}
      title="Die Gruppe zieht weiter"
      width={520}
      footer={
        <>
          {/* Eine längere Strecke Tag für Tag: dieselbe Wahl, als Reise am Spieltisch. */}
          <Button
            variant="ghost"
            style={{ marginRight: 'auto' }}
            disabled={!moving}
            onClick={() => {
              closeShellRequest();
              openJourney(placeId);
            }}
            title="Tag für Tag reisen: Wayfarer hält an Orten am Weg, bei Begegnungen, Terminen und zur Rast"
          >
            Als Reise, Tag für Tag …
          </Button>
          <Button onClick={closeShellRequest}>Abbrechen</Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={placeId === data.state.placeId || goers.length === 0}
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
        {mates.length > 1 && (
          <Field
            label="Wer geht?"
            hint={
              part
                ? 'Die anderen bleiben hier in ihrer Zeit; wer geht, wird eine eigene Teilgruppe mit eigener Uhr.'
                : 'Alle, die du gerade leitest.'
            }
          >
            <div
              className="wf-btn-group"
              role="group"
              aria-label="Wer geht?"
              style={{ flexWrap: 'wrap' }}
            >
              {mates.map((id) => (
                <Button
                  key={id}
                  size="sm"
                  aria-pressed={goers.includes(id)}
                  onClick={() =>
                    setGoers((list) =>
                      list.includes(id) ? list.filter((other) => other !== id) : [...list, id],
                    )
                  }
                >
                  {entityName(data, id)}
                </Button>
              ))}
            </div>
          </Field>
        )}
        {Object.keys(data.mounts).length > 0 && (
          <Field
            label="Womit"
            hint="Die Dauer folgt dem Tempo – feste Zeiten eines Weges gelten immer."
          >
            <TravelBy />
          </Field>
        )}
        {moving && minutes > 0 && (
          <div className="wf-mute" style={{ fontSize: 'var(--text-sm)' }}>
            Ankunft {formatClock(arrival)}
            {dayIndexOf(arrival) !== dayIndexOf(data.state.now) &&
              ` am ${formatDayMonth(data.campaign.calendar, arrival)}`}{' '}
            · auf demselben Weg zurück etwa um {formatClock(arrival + minutes)}
            {part && ' · die anderen bleiben bei ' + formatClock(data.state.now)}
          </div>
        )}
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
                  {route.legs[0] && route.legs[0].fromId !== here && (
                    <> ab {entityName(data, route.legs[0].fromId)}</>
                  )}
                  {route.unknown && ' – ein Abschnitt hat noch keine Dauer'}
                  {route.legs.some((leg) => leg.path.conditions) &&
                    ` · ${route.legs
                      .map((leg) => leg.path.conditions)
                      .filter(Boolean)
                      .join('; ')}`}
                </div>
                {route.barred && (
                  <div className="wf-wege-route__warn">
                    Der Weg ist gerade nicht passierbar – eine verschlossene Tür oder das Wetter.
                    Die Gruppe kann trotzdem weiterziehen; wie, entscheidest du.
                  </div>
                )}
                {routeDetour(data, route) && (
                  <div className="wf-wege-route__sub">{routeDetour(data, route)}.</div>
                )}
                {routeNotes(data, route).map((note) => (
                  <div key={note} className="wf-wege-route__sub">
                    Unterwegs: {note}.
                  </div>
                ))}
                {[...routeFit(route), ...travelNotes(travel, route.minutes)].map((note) => (
                  <div key={note} className="wf-wege-route__sub">
                    {note}.
                  </div>
                ))}
                {passTime && marchAfter(data, route.minutes) && (
                  <div className="wf-wege-route__sub">
                    {marchRule(marchAfter(data, route.minutes)!)}
                  </div>
                )}
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
                ? `Nach der Karte etwa ${formatWayTime(suggested)} ${travel.by && meansKmh(travel.by) ? `mit ${travel.by.name}` : 'zu Fuß'}.`
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
  /** Was die Seite gleich zeigen soll: die Karte, die Uhr, den Tag. */
  focus?: Focus;
  /** Ein Handgriff statt einer Seite (`handgrips.ts`). */
  run?: GripRun;
  /** Ein Eintrag der Welt: Außerhalb der Welt öffnet er sich im Seitenblatt. */
  sheetId?: string;
}

const SORT_ICON: Record<Exclude<SearchSort, 'entity'>, ReactNode> = {
  article: <Library />,
  story: <Waypoints />,
  thread: <Waypoints />,
  clock: <Hourglass />,
  run: <Repeat />,
  event: <CalendarDays />,
  creature: <Skull />,
  encounter: <Swords />,
  stock: <Tent />,
  map: <MapIcon />,
  net: <RouteIcon />,
  dungeon: <DoorOpen />,
  track: <Gauge />,
  handout: <FileText />,
  bastion: <Castle />,
  loot: <Coins />,
  guess: <Lightbulb />,
  shop: <Store />,
  mount: <Sailboat />,
  prep: <NotebookPen />,
  rules: <ScrollText />,
};

function searchHits(data: CampaignData, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  // Bereiche und ihre Ansichten: „Chronik“ findet man auch, obwohl sie unter „Zeit“ steht.
  const places = AREAS.flatMap((area) => [
    area,
    ...(area.tabs ?? []).filter((tab) => tab.label !== area.label),
  ]);
  const areas: SearchHit[] = places
    .filter((a) => !q || a.label.toLowerCase().includes(q))
    .map((a) => ({
      key: 'area:' + a.path + a.label,
      label: a.label,
      sub: a.hint,
      href: a.path,
      icon: <a.icon />,
    }));
  // Alles, was der Spielleiter angelegt hat (`search.ts`): Welt, Artikel, Geschichten, Wesen …
  const found: SearchHit[] = searchWorld(data, query).map((hit) => ({
    key: hit.key,
    label: hit.label,
    sub: hit.sub,
    href: hit.entity ? entityHref(hit.entity) : hit.href,
    sheetId: hit.entity && hit.entity.kind !== 'character' ? hit.entity.id : undefined,
    icon: hit.entity ? (
      <KindIcon kind={hit.entity.kind} />
    ) : hit.mountKind ? (
      <MeansIcon kind={hit.mountKind} />
    ) : (
      SORT_ICON[hit.sort as 'article']
    ),
    focus: hit.focus,
  }));
  // Handgriffe zuerst: Wer „Rast“ oder „2 Std.“ tippt, will es tun – dazu steht, wo er zu Hause ist.
  const grips: SearchHit[] = findHandgrips(data, query).map((grip) => ({
    key: 'grip:' + grip.key,
    label: grip.label,
    sub: `sonst unter ${grip.home.replaceAll(' · ', ' › ')}`,
    href: '',
    icon: grip.run.type === 'settings' ? <Settings /> : <MousePointerClick />,
    run: grip.run,
  }));
  return q ? [...grips, ...found, ...areas] : areas;
}

/** Führt einen Handgriff aus der Suche aus. */
function runGrip(db: CampaignDb, run: GripRun, navigate: (to: string) => void): void {
  switch (run.type) {
    case 'log':
      return openQuickLog({ kind: run.kind, own: run.own });
    case 'move':
      return openMoveParty({ placeId: run.placeId });
    case 'journey':
      return openJourney(run.toId ?? null);
    case 'pass':
      return advanceAndReport(db, db.getSnapshot().state.now + run.minutes);
    case 'time':
      return openTimeDialog();
    case 'rest':
      return openRest(run.kind);
    case 'downtime':
      return openDowntime();
    case 'spell':
      return openSpell();
    case 'shop':
      return openShop();
    case 'newEntry':
      navigate('/welt');
      return openNew();
    case 'newStory':
      return navigate(`/geschichte/${newStory(db).id}`);
    case 'rules':
      focusOn({ type: 'rules' });
      return navigate('/');
    case 'page':
      return navigate(run.href);
    case 'settings':
      focusOn({ type: 'settings', section: run.section });
      return navigate('/einstellungen');
  }
}

function SearchDialog() {
  const db = useDb();
  const data = useData();
  const [location, navigate] = useLocation();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const hits = useMemo(() => searchHits(data, query), [data, query]);
  useEffect(() => setIndex(0), [query]);
  const go = (hit: SearchHit | undefined) => {
    if (!hit) return;
    if (hit.run) {
      // Erst die Suche schließen: Der Handgriff öffnet oft selbst ein Fenster.
      closeShellRequest();
      runGrip(db, hit.run, navigate);
      return;
    }
    if (hit.sheetId && sheetOpensAt(location)) {
      // Nachsehen, ohne die Seite zu verlassen: am Spieltisch bleibt der Spieltisch offen.
      closeShellRequest();
      openSheet(hit.sheetId);
      return;
    }
    focusOn(hit.focus ?? null);
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
      // Ein Suchwort ist keine Eingabe, die verloren gehen könnte.
      guard={false}
    >
      <div style={{ margin: 'calc(var(--s-5) * -1)' }}>
        <Input
          className="wf-search__input"
          autoFocus
          placeholder="Person, Ort, Geschichte … oder was du tun willst: Rast, Beute, 2 Std., nach …"
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
      return (
        <MovePartyDialog
          preset={request.placeId}
          presetText={request.text}
          onSaved={request.onSaved}
        />
      );
    case 'spell':
      return <SpellDialog request={request.request} />;
    case 'time':
      return <TimeDialog />;
    case 'rest':
      return (
        <RestDialog
          kind={request.kind}
          disturbed={request.disturbed}
          onClose={closeShellRequest}
          onDone={(result) => reportRest(db.getSnapshot(), result)}
        />
      );
    case 'downtime':
      return (
        <DowntimeDialog
          onClose={closeShellRequest}
          onDone={(result) => reportDowntime(db.getSnapshot(), result)}
        />
      );
    case 'shop':
      return (
        <TradeDialog
          shopId={request.shopId}
          direction={request.direction}
          onClose={closeShellRequest}
        />
      );
    case 'search':
      return <SearchDialog />;
    case 'journey':
      return <JourneyDialog initialTo={request.toId} onClose={closeShellRequest} />;
  }
}
