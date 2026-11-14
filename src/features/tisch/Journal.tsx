/** Mitschrift am Spieltisch: eine Zeile zum Festhalten und darunter der Verlauf der Session. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { CornerDownLeft, Feather, Play, Trash2, X } from 'lucide-react';
import { logEntry, startSession } from '../../data/actions';
import { useData, useDb } from '../../data/hooks';
import type { ChronicleEntry } from '../../domain/schema';
import {
  Button,
  ChronicleList,
  Dialog,
  EmptyState,
  EntityRefsEditor,
  Field,
  IconButton,
  KindIcon,
  NameMemory,
  Panel,
  TextArea,
  toast,
  useMention,
} from '../../ui';
import { deleteRecorded, isFixedKind } from '../chronik/actions';
import { KIND_NAME, TEXT_KINDS, entryHeadline, freeRefsOf, meaningRefsOf } from '../chronik/model';
import { reviseEntry } from './commands';
import { TableRulesButton } from './TableRules';
import { groupByDay, journal, keptMentions, mentionSuggestions, type Mention } from './model';

// ── Eingabezeile mit @-Verweisen ───────────────────────────────────────────

/** Angefangene Zeilen, solange die App offen ist – nie im Spielstand. */
const drafts = new Map<string, { text: string; mentions: Mention[] }>();

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
}: {
  onSubmit: (text: string, refs: string[]) => void;
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
  const kept = keptMentions(text, mentions);
  const keptIds = kept.map((m) => m.id);

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

  const submit = () => {
    const clean = text.trim();
    if (!clean) return;
    onSubmit(
      clean,
      kept.map((m) => m.id),
    );
    setText('');
    setMentions([]);
    field.current?.focus();
  };

  return (
    <div className="wf-tisch-composer">
      <div className="wf-tisch-composer__box" ref={box}>
        <Feather className="wf-tisch-composer__quill" aria-hidden />
        <textarea
          ref={field}
          rows={1}
          autoFocus={autoFocus}
          className="wf-tisch-composer__field"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={at.open}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            at.track(e.target, true);
          }}
          onSelect={(e) => at.track(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            // Die offene Auswahl nimmt Pfeile und – auf einer markierten Zeile – die Eingabetaste.
            if (at.onKeyDown(e)) return;
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
          disabled={!text.trim()}
          onClick={submit}
        >
          <CornerDownLeft />
        </IconButton>
      </div>
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
