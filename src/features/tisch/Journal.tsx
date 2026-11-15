/** Mitschrift am Spieltisch: eine Zeile zum Festhalten und darunter der Verlauf der Session. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { CornerDownLeft, Feather, Play, Trash2, X } from 'lucide-react';
import { logEntry, startSession } from '../../data/actions';
import { useData, useDb } from '../../data/hooks';
import { recognizeEntry, type Recognized } from '../../domain/recognize';
import type { CampaignData, ChronicleEntry } from '../../domain/schema';
import {
  Button,
  ChronicleList,
  Dialog,
  EmptyState,
  EntityRefsEditor,
  Field,
  IconButton,
  KindIcon,
  MenuItem,
  NameMemory,
  Panel,
  Popover,
  TextArea,
  toast,
  useMention,
} from '../../ui';
import { deleteRecorded, isFixedKind, recordFiled } from '../chronik/actions';
import { choiceOfRecognized, type RecordFieldsKind } from '../chronik/recordDraft';
import {
  openDowntime,
  openMoveParty,
  openQuickLog,
  openRest,
  openShop,
  openSpell,
} from '../../shell/commands';
import { KIND_NAME, TEXT_KINDS, entryHeadline, freeRefsOf, meaningRefsOf } from '../chronik/model';
import { reviseEntry } from './commands';
import { TableRulesButton } from './TableRules';
import { groupByDay, journal, keptMentions, mentionSuggestions, type Mention } from './model';
import { onJournalName, withName } from './journalInsert';
import {
  namedIn,
  placeIn,
  quickChoiceOf,
  quickMatches,
  quickPlan,
  restKindIn,
  routeOf,
  slashOf,
  type QuickChoice,
  type QuickOption,
} from './quick';

// ── Eingabezeile mit @-Verweisen ───────────────────────────────────────────

/** Angefangene Zeilen, solange die App offen ist – nie im Spielstand. */
const drafts = new Map<string, { text: string; mentions: Mention[] }>();

/** Wie viele Arten die Kurzwahl auf einmal zeigt; weitertippen grenzt ein. */
const SLASH_SHOWN = 9;
/** Wie viele erkannte Arten unter der Zeile stehen. */
const RECOGNIZED_SHOWN = 3;
/** Wie lange nach dem letzten Tastendruck Wayfarer den Satz liest. */
const RECOGNIZE_DELAY = 250;

/** Was die Mitschrift über „/“ oder einen erkannten Vorschlag auslöst. */
export type QuickAction =
  | { type: 'choice'; option: QuickOption; text: string; refs: string[] }
  | { type: 'recognized'; item: Recognized; text: string; refs: string[] };

/** Vorschläge aus dem Satz – erst, wenn eine Weile nicht getippt wurde. */
function useRecognizedLater(data: CampaignData, text: string, refs: string[]): Recognized[] {
  const [found, setFound] = useState<Recognized[]>([]);
  const key = refs.join(',');
  useEffect(() => {
    if (!text.trim()) {
      setFound([]);
      return;
    }
    const timer = setTimeout(
      () => setFound(recognizeEntry(data, text, { refs: key ? key.split(',') : [] })),
      RECOGNIZE_DELAY,
    );
    return () => clearTimeout(timer);
  }, [data, text, key]);
  return found;
}

function quickPlaceholder(option: QuickOption): string {
  switch (routeOf(option.choice)) {
    case 'move':
      return 'Wohin? Den Ort nennen …';
    case 'spell':
      return 'Welcher Zauber? Wer wirkt ihn? (@ verknüpft)';
    case 'rest':
      return 'Kurze oder Lange Rast?';
    default:
      return 'Was ist geschehen? (@ verknüpft)';
  }
}

function quickHint(option: QuickOption): string {
  switch (routeOf(option.choice)) {
    case 'move':
      return 'Eingabetaste: Die Gruppe zieht weiter – mit der Zeit des Weges.';
    case 'rest':
      return 'Eingabetaste öffnet die Rast.';
    case 'downtime':
      return 'Eingabetaste öffnet „Freie Zeit“.';
    case 'shop':
      return 'Eingabetaste öffnet den Laden.';
    case 'loot':
      return 'Eingabetaste öffnet das Beute-Buch.';
    case 'spell':
      return 'Eingabetaste: Dauer und Konzentration wählen.';
    default:
      return 'Eingabetaste hält fest; fehlt etwas, fragt Wayfarer nach. Rücktaste nimmt die Art weg.';
  }
}

/**
 * Eingabefeld, in dem „@“ Einträge der Weltdatenbank vorschlägt – und anlegt, was fehlt
 * (`useMention`). Der gewählte Name bleibt im Text stehen; `onSubmit` bekommt den Text und die
 * IDs der Einträge, deren Name noch darin steht.
 */
export function MentionInput({
  onSubmit,
  label,
  placeholder,
  autoFocus,
  draftKey,
  onQuick,
}: {
  onSubmit: (text: string, refs: string[]) => void;
  /**
   * Die Mitschrift kann alles, was die Chronik kann: „/“ am Zeilenanfang wählt die Art, und was
   * Wayfarer im Satz erkennt, steht als Knopf darunter. `clear` leert die Zeile – sofort oder
   * erst, wenn ein geöffneter Handgriff festgehalten hat.
   */
  onQuick?: (action: QuickAction, clear: () => void) => void;
  /** Name des Feldes für Vorleseprogramme. */
  label: string;
  placeholder: string;
  autoFocus?: boolean;
  /**
   * Was angefangen, aber noch nicht festgehalten ist, bleibt unter diesem Schlüssel stehen, wenn
   * man die Seite kurz verlässt (etwa über einen Namen im Gedächtnis darunter).
   */
  draftKey?: string;
}) {
  const data = useData();
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const draft = draftKey ? drafts.get(draftKey) : undefined;
  // Eine zurückgeholte Zeile: die Schreibmarke ans Ende, ohne gleich Vorschläge zu öffnen.
  const pendingCaret = useRef<number | null>(draft ? draft.text.length : null);
  const [text, setText] = useState(() => draft?.text ?? '');
  const [mentions, setMentions] = useState<Mention[]>(() => draft?.mentions ?? []);
  /** Die mit „/“ gewählte Art; null = eine Notiz (oder was der Satz sagt). */
  const [chosen, setChosen] = useState<QuickOption | null>(null);
  /** Die markierte Zeile der Kurzwahl. */
  const [marked, setMarked] = useState(0);
  /** Die Kurzwahl wurde mit Escape geschlossen – bis die Zeile wieder ohne „/“ beginnt. */
  const [slashClosed, setSlashClosed] = useState(false);
  /** Die Zeile der erkannten Arten – Tab springt auf den ersten Vorschlag. */
  const quickRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!draftKey) return;
    if (text) drafts.set(draftKey, { text, mentions });
    else drafts.delete(draftKey);
  }, [draftKey, text, mentions]);
  // Das „@“: zuerst, wer am Ort der Gruppe ist; mit Suchwort die ganze Welt und „neu als …“.
  const at = useMention({
    field,
    anchor: box,
    text,
    setText,
    options: {},
    suggest: mentionSuggestions,
    onPick: (entity) => setMentions((list) => [...list, { id: entity.id, name: entity.name }]),
    header: (query) =>
      query.trim() ? 'Verknüpfen mit' : 'Hier am Ort · weitertippen sucht überall',
  });
  // Nur, wen es noch gibt – „Rückgängig“ nach dem Anlegen nimmt auch die Verknüpfung.
  const kept = keptMentions(text, mentions, (id) => data.entities[id] !== undefined);
  const keptIds = kept.map((m) => m.id);
  const slash = onQuick && !chosen ? slashOf(text) : null;
  const slashTyping = slash?.typing ?? false;
  const slashQuery = slash?.query ?? '';
  const options = useMemo(
    () => (slashTyping && !slashClosed ? quickMatches(slashQuery).slice(0, SLASH_SHOWN) : []),
    [slashTyping, slashQuery, slashClosed],
  );
  const slashOpen = options.length > 0;
  const markedIndex = Math.min(marked, Math.max(0, options.length - 1));
  const recognized = useRecognizedLater(data, onQuick && !chosen && !slash ? text : '', keptIds);
  useEffect(() => {
    if (!text.startsWith('/')) setSlashClosed(false);
  }, [text]);
  // Ein Klick auf einen Gefährten in der Leiste setzt seinen Namen in die Zeile.
  useEffect(() => {
    if (!onQuick) return;
    return onJournalName(({ id, name }) => {
      setText((current) => {
        const next = withName(current, name);
        pendingCaret.current = next.length;
        return next;
      });
      setMentions((list) => (list.some((m) => m.id === id) ? list : [...list, { id, name }]));
      field.current?.focus();
    });
  }, [onQuick]);

  // Höhe folgt dem Text; die Schreibmarke springt nach dem Einsetzen eines Namens dahinter.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    if (pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [text]);

  const clear = () => {
    setText('');
    setMentions([]);
    setChosen(null);
    if (draftKey) drafts.delete(draftKey);
    // Nach einem Fenster (Ortswechsel, Zauber …) erst, wenn es zu ist – sonst bliebe der Fokus dort.
    setTimeout(() => field.current?.focus(), 0);
  };
  const choose = (option: QuickOption, rest: string) => {
    setChosen(option);
    setMarked(0);
    setText(rest);
    pendingCaret.current = rest.length;
    field.current?.focus();
  };
  const submit = () => {
    const clean = text.trim();
    const refs = kept.map((m) => m.id);
    if (onQuick && chosen) {
      onQuick({ type: 'choice', option: chosen, text: clean, refs }, clear);
      return;
    }
    // „/ort Menzoberranzan“ in einem Zug getippt: Die Art gilt wie gewählt.
    const typed = slash && !slash.typing ? quickChoiceOf(slash.query) : null;
    if (onQuick && typed && slash) {
      onQuick({ type: 'choice', option: typed, text: slash.rest.trim(), refs }, clear);
      return;
    }
    if (!clean) return;
    onSubmit(clean, refs);
    setText('');
    setMentions([]);
    field.current?.focus();
  };
  const takeRecognized = (item: Recognized) =>
    onQuick?.({ type: 'recognized', item, text: text.trim(), refs: keptIds }, clear);

  return (
    <div className="wf-tisch-composer">
      <div className="wf-tisch-composer__box" ref={box}>
        <Feather className="wf-tisch-composer__quill" aria-hidden />
        {chosen && (
          <button
            type="button"
            className="wf-tisch-composer__kind"
            title="Art wieder wegnehmen – dann wird es eine Notiz"
            onClick={() => {
              setChosen(null);
              field.current?.focus();
            }}
          >
            {chosen.label}
            <X aria-label="Art wegnehmen" />
          </button>
        )}
        <textarea
          ref={field}
          rows={1}
          autoFocus={autoFocus}
          className="wf-tisch-composer__field"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={at.open}
          placeholder={chosen ? quickPlaceholder(chosen) : placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            at.track(e.target, true);
          }}
          onSelect={(e) => at.track(e.currentTarget)}
          onBlur={(e) => at.leave(e.relatedTarget)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            // Die offene Auswahl nimmt Pfeile und – auf einer markierten Zeile – die Eingabetaste.
            if (at.onKeyDown(e)) return;
            if (slashOpen) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const step = e.key === 'ArrowDown' ? 1 : -1;
                setMarked((markedIndex + step + options.length) % options.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                choose(options[markedIndex]!, '');
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setSlashClosed(true);
                return;
              }
            }
            // Am Anfang der Zeile nimmt die Rücktaste die gewählte Art wieder weg.
            if (
              e.key === 'Backspace' &&
              chosen &&
              e.currentTarget.selectionStart === 0 &&
              e.currentTarget.selectionEnd === 0
            ) {
              e.preventDefault();
              setChosen(null);
              return;
            }
            // Tab springt auf den ersten erkannten Vorschlag, die Eingabetaste nimmt ihn dann.
            if (e.key === 'Tab' && !e.shiftKey && recognized.length > 0 && !chosen) {
              const chip = quickRow.current?.querySelector<HTMLButtonElement>('button');
              if (chip) {
                e.preventDefault();
                chip.focus();
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <IconButton
          label="Festhalten (Eingabetaste)"
          size="sm"
          variant="ghost"
          className="wf-tisch-composer__send"
          disabled={!text.trim() && !chosen}
          onClick={submit}
        >
          <CornerDownLeft />
        </IconButton>
      </div>
      {onQuick && (
        <div className="wf-tisch-quick" aria-live="polite" ref={quickRow}>
          {chosen ? (
            <span className="wf-tisch-composer__hint">{quickHint(chosen)}</span>
          ) : recognized.length > 0 ? (
            <>
              <span className="wf-tisch-composer__hint">Festhalten als</span>
              {recognized.slice(0, RECOGNIZED_SHOWN).map((item) => (
                <button
                  key={`${item.kind}:${item.from}:${item.label}`}
                  type="button"
                  className="wf-tisch-quick__chip"
                  title="Als diese Art festhalten (Tab, dann Eingabetaste). Die Eingabetaste im Feld hält eine Notiz fest."
                  onClick={() => takeRecognized(item)}
                >
                  {item.label}
                </button>
              ))}
            </>
          ) : (
            <span className="wf-tisch-composer__hint">
              „/“ wählt die Art · Eingabetaste hält eine Notiz fest
            </span>
          )}
        </div>
      )}
      <Popover
        open={slashOpen}
        onClose={() => setSlashClosed(true)}
        anchor={box}
        width={300}
        className="wf-tisch-slash"
      >
        <div className="wf-tisch-suggest__head">Festhalten als …</div>
        {options.map((option, i) => (
          <MenuItem
            key={option.choice}
            active={i === markedIndex}
            onClick={() => choose(option, '')}
          >
            {option.label}
          </MenuItem>
        ))}
      </Popover>
      <NameMemory text={text} refs={keptIds} />
      {kept.length > 0 && (
        <div className="wf-tisch-composer__refs">
          <span className="wf-tisch-composer__hint">Verknüpft mit</span>
          {kept.map((m) => {
            const entity = data.entities[m.id];
            return (
              <span key={m.id} className="wf-badge wf-badge--gold">
                {entity && <KindIcon kind={entity.kind} />}
                {m.name}
                <X
                  role="button"
                  aria-label={`Verknüpfung mit ${m.name} lösen`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setMentions((list) => list.filter((other) => other.id !== m.id))}
                />
              </span>
            );
          })}
        </div>
      )}
      {at.menu}
    </div>
  );
}

// ── Alle Arten aus der Mitschrift ──────────────────────────────────────────

/**
 * Führt aus, was „/“ oder ein erkannter Vorschlag in der Mitschrift gewählt hat: Ortswechsel,
 * Rast, freie Zeit, Handel, Beute und Zauber öffnen ihren Handgriff; alles andere wird
 * festgehalten – ohne Rückfrage, wenn nichts fehlt, sonst öffnet „Festhalten“ mit Art und Text.
 */
function useQuickRun() {
  const db = useDb();
  return (action: QuickAction, clear: () => void) => {
    const data = db.getSnapshot();
    const { text, refs } = action;
    const choice: QuickChoice =
      action.type === 'choice' ? action.option.choice : choiceOfRecognized(action.item);
    switch (routeOf(choice)) {
      case 'move': {
        const toId =
          action.type === 'recognized'
            ? (action.item.payload.travel?.toId ?? null)
            : placeIn(data, text, refs);
        openMoveParty({ placeId: toId ?? undefined, text, onSaved: clear });
        return;
      }
      case 'rest': {
        const long =
          action.type === 'recognized'
            ? (action.item.payload.rest?.long ?? true)
            : restKindIn(text) === 'long';
        openRest(long ? 'long' : 'short');
        clear();
        return;
      }
      case 'downtime':
        openDowntime();
        clear();
        return;
      case 'shop':
        openShop();
        clear();
        return;
      case 'loot':
        openQuickLog({ own: 'loot' });
        clear();
        return;
      case 'guess':
        openQuickLog({ own: 'guess', text, refs });
        clear();
        return;
      case 'spell':
        openSpell({ text, refs: namedIn(data, text, refs), onSaved: clear });
        return;
      case 'record': {
        const plan = quickPlan(
          data,
          { text, refs },
          action.type === 'recognized'
            ? { recognized: action.item }
            : { choice: choice as RecordFieldsKind },
        );
        const result = plan.direct ? recordFiled(db, plan.direct) : null;
        if (!result || 'problem' in result) {
          openQuickLog({ text, refs: plan.refs, parts: plan.parts, onSaved: clear });
          return;
        }
        clear();
        const after = db.getSnapshot();
        toast({
          title: 'Festgehalten',
          body: result.entries
            .map(
              (entry) => `${KIND_NAME[entry.kind]}: ${entryHeadline(after, entry) || entry.text}`,
            )
            .join(' · '),
          action: { label: 'Rückgängig', run: result.undo },
        });
        return;
      }
    }
  };
}

// ── Eintrag bearbeiten ─────────────────────────────────────────────────────

function EntryDialog({ entry, onClose }: { entry: ChronicleEntry; onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const [text, setText] = useState(entry.text);
  // Verweise, die zur Bedeutung gehören (wer gestorben ist, wer getroffen wurde …), bleiben.
  const [refs, setRefs] = useState(() => freeRefsOf(entry));
  /** Ortswechsel, Haltungen und Termine gehören zum Lauf der Welt: nur die Anmerkung ist frei. */
  const free = !isFixedKind(entry.kind);
  /** Arten, die ohne Text nichts sagen. */
  const needsText = free && TEXT_KINDS.includes(entry.kind);
  const save = () => {
    if (needsText && !text.trim()) return;
    reviseEntry(db, entry.id, free ? { text, refs: [...meaningRefsOf(entry), ...refs] } : { text });
    onClose();
  };
  // Gelöscht wird samt Wirkung (ein Schicksal, ein Zustand …); „Rückgängig“ holt beides zurück.
  const remove = () => {
    const headline = entryHeadline(data, entry);
    const undo = deleteRecorded(db, entry.id);
    onClose();
    if (undo)
      toast({
        title: 'Eintrag gelöscht',
        body: headline || (entry.text.length > 90 ? entry.text.slice(0, 90) + ' …' : entry.text),
        action: { label: 'Rückgängig', run: undo },
      });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={free ? `${KIND_NAME[entry.kind]} bearbeiten` : 'Anmerkung bearbeiten'}
      footer={
        <>
          {free && (
            <Button variant="danger" icon={<Trash2 />} onClick={remove}>
              Löschen
            </Button>
          )}
          {entry.kind === 'note' && (
            <Button
              onClick={() => {
                onClose();
                openQuickLog({
                  text,
                  refs: [...meaningRefsOf(entry), ...refs],
                  at: entry.at,
                  replaces: entry.id,
                });
              }}
              title="Die Notiz als Ortswechsel, Haltung, Schicksal … festhalten – sie tritt dann an deren Stelle"
            >
              Als andere Art …
            </Button>
          )}
          <span className="wf-grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={needsText && !text.trim()}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <Field
          label={free ? 'Was ist geschehen?' : 'Anmerkung'}
          hint={
            free
              ? 'Strg+Eingabe speichert.'
              : 'Ortswechsel, Haltungen und eingetretene Termine gehören zum Lauf der Welt. Hier änderst du nur die Anmerkung dazu. Strg+Eingabe speichert.'
          }
        >
          <TextArea
            data-autofocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                save();
              }
            }}
          />
        </Field>
        {free && (
          <Field label="Betrifft">
            <EntityRefsEditor
              value={refs}
              onChange={setRefs}
              placeholder="Person, Ort, Fraktion … verknüpfen"
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

// ── Mitschrift ─────────────────────────────────────────────────────────────

export function JournalPanel() {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const log = useMemo(() => journal(data), [data]);
  const groups = useMemo(
    () => groupByDay(cal, data.state.now, log.entries),
    [cal, data.state.now, log.entries],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? data.chronicle[editingId] : undefined;
  const runQuick = useQuickRun();
  const placeId = data.state.placeId;
  const hidden = useMemo(() => (placeId ? [placeId] : []), [placeId]);
  // Kommt oben etwas Neues dazu, rollt der Verlauf dorthin – sonst bliebe es ungesehen.
  const logBox = useRef<HTMLDivElement>(null);
  const newestId = log.entries[0]?.id;
  useEffect(() => {
    if (logBox.current) logBox.current.scrollTop = 0;
  }, [newestId]);

  return (
    <Panel
      flush
      className="wf-tisch-journal"
      title={
        <>
          Mitschrift
          {log.session && <span className="wf-panel__count">Session {log.session.number}</span>}
        </>
      }
      actions={
        <span className="wf-row">
          <TableRulesButton />
          <Link
            href="/chronik"
            className="wf-btn wf-btn--ghost wf-btn--sm"
            title="Die ganze Chronik öffnen"
          >
            Chronik
          </Link>
        </span>
      }
    >
      {!log.session && (
        <div className="wf-tisch-nosession">
          <span>Es läuft keine Session. Was du festhältst, steht trotzdem in der Chronik.</span>
          <Button
            size="sm"
            icon={<Play />}
            onClick={() => {
              const session = startSession(db);
              toast({
                title: `Session ${session.number} hat begonnen`,
                body: 'Die Mitschrift beginnt neu.',
              });
            }}
          >
            Session beginnen
          </Button>
        </div>
      )}
      <MentionInput
        autoFocus
        draftKey="mitschrift"
        label="Was passiert gerade?"
        placeholder="Was passiert gerade? (@ verknüpft)"
        onSubmit={(text, refs) => logEntry(db, { text, refs })}
        onQuick={runQuick}
      />
      <div className="wf-tisch-journal__log" ref={logBox}>
        {groups.length === 0 ? (
          <EmptyState
            icon={<Feather />}
            title={log.session ? 'Die Seite ist noch leer' : 'Noch nichts festgehalten'}
          >
            Schreib oben in einem Satz auf, was gerade geschieht. Ortswechsel, geänderte Haltungen
            und eingetretene Termine tragen sich von selbst ein.
          </EmptyState>
        ) : (
          <>
            {!log.session && (
              <div className="wf-tisch-subtitle wf-tisch-journal__recent">Zuletzt festgehalten</div>
            )}
            {groups.map((group) => (
              <section key={group.day}>
                <h4 className="wf-tisch-day">
                  <span>{group.label}</span>
                  <span className="wf-tisch-day__date">{group.date}</span>
                </h4>
                <ChronicleList
                  entries={group.entries}
                  hideRefs={hidden}
                  onEdit={(entry) => setEditingId(entry.id)}
                />
              </section>
            ))}
            {log.total > log.entries.length && (
              <Link href="/chronik" className="wf-tisch-more">
                {log.total - log.entries.length} ältere Einträge stehen in der Chronik
              </Link>
            )}
          </>
        )}
      </div>
      {editing && (
        <EntryDialog key={editing.id} entry={editing} onClose={() => setEditingId(null)} />
      )}
    </Panel>
  );
}
