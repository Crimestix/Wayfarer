/** Mitschrift am Spieltisch: eine Zeile zum Festhalten und darunter der Verlauf der Session. */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { CornerDownLeft, Feather, Play, Trash2, X } from 'lucide-react';
import { logEntry, startSession } from '../../data/actions';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL, placePath } from '../../domain/derive';
import type { ChronicleEntry, Entity } from '../../domain/schema';
import {
  Button,
  CHRONICLE_KIND_LABEL,
  ChronicleList,
  Dialog,
  EmptyState,
  EntityRefsEditor,
  Field,
  IconButton,
  KindIcon,
  MenuItem,
  Panel,
  Popover,
  TextArea,
  toast,
} from '../../ui';
import { canDeleteEntry, deleteEntry, restoreEntry, reviseEntry } from './commands';
import {
  activeMention,
  groupByDay,
  insertMention,
  journal,
  keptMentions,
  mentionSuggestions,
  type Mention,
} from './model';

// ── Eingabezeile mit @-Verweisen ───────────────────────────────────────────

/**
 * Eingabefeld, in dem „@“ Einträge der Weltdatenbank vorschlägt. Der gewählte Name bleibt im Text
 * stehen; `onSubmit` bekommt den Text und die IDs der Einträge, deren Name noch darin steht.
 */
export function MentionInput({
  onSubmit,
  placeholder,
  autoFocus,
}: {
  onSubmit: (text: string, refs: string[]) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const data = useData();
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [mentions, setMentions] = useState<Mention[]>([]);
  /** Position des „@“, dessen Vorschläge mit Escape weggeklickt wurden. */
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [picked, setPicked] = useState(0);

  const range = useMemo(() => activeMention(text, caret), [text, caret]);
  const suggestions = useMemo(
    () => (range && range.start !== dismissed ? mentionSuggestions(data, range.query) : []),
    [data, range, dismissed],
  );
  const open = suggestions.length > 0;
  const active = Math.min(picked, Math.max(0, suggestions.length - 1));
  const kept = keptMentions(text, mentions);

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

  const closeSuggestions = useCallback(() => setDismissed(range?.start ?? null), [range?.start]);

  const pick = (entity: Entity) => {
    if (!range) return;
    const next = insertMention(text, range, entity.name);
    pendingCaret.current = next.caret;
    setText(next.text);
    setCaret(next.caret);
    setMentions((list) => [...list, { id: entity.id, name: entity.name }]);
    setPicked(0);
    field.current?.focus();
  };

  const submit = () => {
    const clean = text.trim();
    if (!clean) return;
    onSubmit(
      clean,
      kept.map((m) => m.id),
    );
    setText('');
    setCaret(0);
    setMentions([]);
    setDismissed(null);
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
          aria-label={placeholder}
          aria-autocomplete="list"
          aria-expanded={open}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setPicked(0);
            setDismissed((at) => (at !== null && e.target.value[at] === '@' ? at : null));
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (open) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const step = e.key === 'ArrowDown' ? 1 : -1;
                setPicked((active + step + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                pick(suggestions[active]!);
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
          disabled={!text.trim()}
          onClick={submit}
        >
          <CornerDownLeft />
        </IconButton>
      </div>
      {kept.length > 0 ? (
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
      ) : (
        <div className="wf-tisch-composer__hint">
          Eingabetaste hält fest · <b>@</b> verknüpft Personen, Orte und mehr
        </div>
      )}
      <Popover open={open} onClose={closeSuggestions} anchor={box} className="wf-tisch-suggest">
        {/* Die Schreibmarke bleibt im Feld, auch wenn man einen Vorschlag anklickt. */}
        <div role="listbox" aria-label="Vorschläge" onMouseDown={(e) => e.preventDefault()}>
          <div className="wf-tisch-suggest__head">
            {range?.query ? 'Verknüpfen mit' : 'Hier und in der Gruppe – tippe weiter, um zu suchen'}
          </div>
          {suggestions.map((entity, i) => (
            <MenuItem
              key={entity.id}
              icon={<KindIcon kind={entity.kind} />}
              active={i === active}
              onClick={() => pick(entity)}
            >
              {entity.name}
              <span className="wf-mute">
                {' · '}
                {entity.kind === 'person' && entity.person.role
                  ? entity.person.role
                  : entity.kind === 'place' && entity.place.parentId
                    ? placePath(data, entity.place.parentId)
                    : KIND_LABEL[entity.kind]}
              </span>
            </MenuItem>
          ))}
        </div>
      </Popover>
    </div>
  );
}

// ── Eintrag bearbeiten ─────────────────────────────────────────────────────

function EntryDialog({ entry, onClose }: { entry: ChronicleEntry; onClose: () => void }) {
  const db = useDb();
  const [text, setText] = useState(entry.text);
  const [refs, setRefs] = useState(entry.refs);
  const free = canDeleteEntry(entry);
  const save = () => {
    if (free && !text.trim()) return;
    reviseEntry(db, entry.id, free ? { text, refs } : { text });
    onClose();
  };
  const remove = () => {
    const removed = deleteEntry(db, entry.id);
    onClose();
    if (removed)
      toast({
        title: 'Eintrag gelöscht',
        body: removed.text.length > 90 ? removed.text.slice(0, 90) + ' …' : removed.text,
        action: { label: 'Rückgängig', run: () => restoreEntry(db, removed) },
      });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={free ? `${CHRONICLE_KIND_LABEL[entry.kind]} bearbeiten` : 'Anmerkung bearbeiten'}
      footer={
        <>
          {free && (
            <Button variant="danger" icon={<Trash2 />} onClick={remove}>
              Löschen
            </Button>
          )}
          <span className="wf-grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={free && !text.trim()}>
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
            <EntityRefsEditor value={refs} onChange={setRefs} placeholder="Person, Ort, Fraktion … verknüpfen" />
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
  const groups = useMemo(() => groupByDay(cal, data.state.now, log.entries), [cal, data.state.now, log.entries]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? data.chronicle[editingId] : undefined;
  const placeId = data.state.placeId;
  const hidden = useMemo(() => (placeId ? [placeId] : []), [placeId]);

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
        <Link href="/chronik" className="wf-btn wf-btn--ghost wf-btn--sm" title="Die ganze Chronik öffnen">
          Chronik
        </Link>
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
              toast({ title: `Session ${session.number} hat begonnen`, body: 'Die Mitschrift beginnt neu.' });
            }}
          >
            Session beginnen
          </Button>
        </div>
      )}
      <MentionInput
        autoFocus
        placeholder="Was passiert gerade?"
        onSubmit={(text, refs) => logEntry(db, { text, refs })}
      />
      <div className="wf-tisch-journal__log">
        {groups.length === 0 ? (
          <EmptyState icon={<Feather />} title={log.session ? 'Die Seite ist noch leer' : 'Noch nichts festgehalten'}>
            Schreib oben in einem Satz auf, was gerade geschieht. Ortswechsel, geänderte Haltungen und
            eingetretene Termine tragen sich von selbst ein.
          </EmptyState>
        ) : (
          <>
            {!log.session && <div className="wf-tisch-subtitle wf-tisch-journal__recent">Zuletzt festgehalten</div>}
            {groups.map((group) => (
              <section key={group.day}>
                <h4 className="wf-tisch-day">
                  <span>{group.label}</span>
                  <span className="wf-tisch-day__date">{group.date}</span>
                </h4>
                <ChronicleList entries={group.entries} hideRefs={hidden} onEdit={(entry) => setEditingId(entry.id)} />
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
      {editing && <EntryDialog key={editing.id} entry={editing} onClose={() => setEditingId(null)} />}
    </Panel>
  );
}
