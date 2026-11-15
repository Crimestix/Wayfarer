/** Ansicht „Sessions“: Liste der Spielabende und die gewählte Session mit Notizen und ihrem Verlauf. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import {
  Check,
  CircleStop,
  Copy,
  Feather,
  History,
  NotebookPen,
  Play,
  ScrollText,
  Trash2,
  Users,
} from 'lucide-react';
import {
  addPastSession,
  deleteSession,
  endSession,
  resumeSession,
  startSession,
} from '../../data/actions';
import { useData, useDb, useSaveStatus } from '../../data/hooks';
import { chronicleSorted } from '../../domain/derive';
import { prepOfSession } from '../../domain/prep';

import type { ChronicleEntry } from '../../domain/schema';
import { formatDateTime, formatDuration } from '../../domain/time/calendar';
import { openQuickLog } from '../../shell/commands';
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Panel,
  SectionTitle,
  TextArea,
  confirmDialog,
  cx,
  toast,
} from '../../ui';
import { WorldTimeFields } from './WorldTimeFields';
import { Caps } from './parts';
import { Timeline } from './Timeline';
import {
  formatRealDate,
  formatWorldRange,
  pastSessionProblem,
  suggestPastSession,
  timeDraftOf,
  timeOfDraft,
  type SummaryAudience,
  parseRealDate,
  realDateInput,
  resumableSessionId,
  sessionLabel,
  sessionSpans,
  sessionSummaryText,
  sessionTitle,
  spanDuration,
  timelineRows,
  type SessionSpan,
} from './model';

/**
 * Textfeld, das beim Tippen mit kurzer Verzögerung speichert. Änderungen von außen werden
 * übernommen, solange hier nichts Ungespeichertes steht.
 */
function useAutosave(value: string, save: (value: string) => void, delay = 600) {
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(false);
  const latest = useRef(value);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    saveRef.current(latest.current);
    setPending(false);
  }, []);

  useEffect(() => {
    // Der eigene, eben gespeicherte Stand kommt zurück: nichts tun, sonst springt die Eingabe.
    if (dirty.current || value.trim() === latest.current.trim()) return;
    latest.current = value;
    setDraft(value);
  }, [value]);
  // Beim Verlassen der Ansicht nichts verlieren.
  useEffect(() => flush, [flush]);
  useEffect(() => {
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [flush]);

  const change = (next: string) => {
    latest.current = next;
    dirty.current = true;
    setDraft(next);
    setPending(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };
  return { draft, change, flush, pending };
}

/** Echtes Datum des Spielabends, deutsch getippt („3.11.2026“). */
function RealDateField({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const [text, setText] = useState(realDateInput(value));
  useEffect(() => setText(realDateInput(value)), [value]);
  const commit = () => {
    const parsed = parseRealDate(text);
    if (parsed === null) {
      setText(realDateInput(value));
      toast({
        title: 'Datum nicht erkannt',
        body: 'Schreibe es als Tag.Monat.Jahr, zum Beispiel 3.11.2026.',
        tone: 'danger',
      });
    } else {
      setText(realDateInput(parsed));
      if (parsed !== value) onChange(parsed);
    }
  };
  return (
    <>
      <Input
        className="wf-chronik-facts__date"
        aria-label="Echtes Datum des Spielabends"
        placeholder="TT.MM.JJJJ"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      {value ? (
        <span className="wf-mute">{formatRealDate(value).split(',')[0]}</span>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange(new Date().toLocaleDateString('sv-SE'))}
        >
          Heute
        </Button>
      )}
    </>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function worldRange(span: SessionSpan, data: ReturnType<typeof useData>): string {
  const cal = data.campaign.calendar;
  return span.to === null
    ? `seit ${formatDateTime(cal, span.from)}`
    : formatWorldRange(cal, span.from, span.to);
}

const entryCount = (n: number) => (n === 1 ? '1 Eintrag' : `${n.toLocaleString('de-DE')} Einträge`);

function SessionDetail({
  span,
  resumable,
  onEdit,
  onBackfill,
  onSheet,
}: {
  span: SessionSpan;
  /** Die Session ist beendet, lässt sich aber fortsetzen. */
  resumable: boolean;
  onEdit: (entry: ChronicleEntry) => void;
  onBackfill: (sessionId: string) => void;
  /** Das Blatt dieses Abends zum Nachlesen öffnen. */
  onSheet: (sessionId: string) => void;
}) {
  const db = useDb();
  const data = useData();
  const { status } = useSaveStatus();
  const { session } = span;
  const exists = () => !!db.getSnapshot().sessions[session.id];
  // Ein Titel, der nur „Session 12“ wiederholt, gilt als leer.
  const title = useAutosave(sessionTitle(session), (value) => {
    if (exists()) db.patch('sessions', session.id, { title: value.trim() });
  });
  const notes = useAutosave(session.notes, (value) => {
    if (exists()) db.patch('sessions', session.id, { notes: value });
  });
  const [summary, setSummary] = useState<string | null>(null);
  const hasSheet = useMemo(() => prepOfSession(data, session.id) !== null, [data, session.id]);

  // Titel und Notizen wachsen mit ihrem Text.
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    for (const el of [titleRef.current, notesRef.current]) {
      if (!el) continue;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + 2}px`;
    }
  }, [title.draft, notes.draft]);

  const { chronicle } = data;
  const rows = useMemo(
    () =>
      timelineRows(
        chronicleSorted(data).filter((entry) => entry.sessionId === session.id),
        [],
        false,
      ),
    [chronicle, session.id],
  );

  const copy = async (audience: SummaryAudience = 'gm') => {
    title.flush();
    notes.flush();
    const text = sessionSummaryText(db.getSnapshot(), session.id, audience);
    if (await copyText(text))
      toast({
        title:
          audience === 'players' ? 'Fassung für die Spieler kopiert' : 'Zusammenfassung kopiert',
        body:
          audience === 'players'
            ? 'Ohne deine Notizen, ohne Haltungen und ohne alles, was nur für die Spielleitung markiert ist.'
            : `${sessionLabel(session)} · ${entryCount(span.entryCount)}`,
      });
    else setSummary(text);
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Session ${session.number} löschen?`,
      body: (
        <>
          Titel, Datum und Notizen dieser Session gehen verloren.{' '}
          {span.entryCount > 0
            ? `Was in ihr festgehalten wurde (${entryCount(span.entryCount)}), bleibt in der Chronik, gehört dann aber zu keiner Session mehr.`
            : 'In ihr wurde nichts festgehalten.'}
          {span.running && ' Die Session läuft gerade und endet damit.'}
        </>
      ),
      confirmLabel: 'Session löschen',
      danger: true,
    });
    if (!ok) return;
    deleteSession(db, session.id);
    toast({
      title: `Session ${session.number} gelöscht`,
      body: 'Ihre Einträge stehen weiter im Verlauf.',
    });
  };

  const unsaved = title.pending || notes.pending || status === 'saving';
  return (
    <Panel className="wf-chronik-fill wf-chronik-detail" flush>
      <div className="wf-chronik-scroll">
        <header className="wf-chronik-detail__head">
          <div className="wf-chronik-detail__top">
            <span className="wf-chronik-detail__eyebrow">
              <span>
                <Caps>{`Session ${session.number}`}</Caps>
              </span>
              {span.running && (
                <span className="wf-chronik-running">
                  <i className="wf-session-dot" /> läuft gerade
                </span>
              )}
            </span>
            <span className="wf-grow" />
            {resumable && (
              <Button
                size="sm"
                icon={<Play />}
                onClick={() => resumeSession(db, session.id)}
                title="Die Session läuft weiter, als wäre sie nicht beendet worden"
              >
                Fortsetzen
              </Button>
            )}
            <Button
              size="sm"
              icon={<Copy />}
              onClick={() => copy('gm')}
              title="Die Chronik dieser Session als Text in die Zwischenablage legen"
            >
              Zusammenfassung kopieren
            </Button>
            <Button
              size="sm"
              icon={<Users />}
              onClick={() => copy('players')}
              title="Zum Weitergeben: ohne deine Notizen, ohne Haltungen, ohne Einträge nur für die Spielleitung und ohne Personen, die die Gruppe noch nicht kennt"
            >
              Für die Spieler
            </Button>
            <IconButton size="sm" variant="danger" label="Session löschen" onClick={remove}>
              <Trash2 />
            </IconButton>
          </div>
          <textarea
            ref={titleRef}
            rows={1}
            className="wf-chronik-detail__title"
            value={title.draft}
            placeholder="Titel des Spielabends …"
            aria-label="Titel der Session"
            onChange={(e) => title.change(e.target.value.replace(/\s*\n\s*/g, ' '))}
            onBlur={title.flush}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              e.currentTarget.blur();
            }}
          />
          <dl className="wf-chronik-facts">
            <div>
              <dt>Spielabend</dt>
              <dd>
                <RealDateField
                  value={session.realDate}
                  onChange={(realDate) => db.patch('sessions', session.id, { realDate })}
                />
              </dd>
            </div>
            <div>
              <dt>Weltzeit</dt>
              <dd>{worldRange(span, data)}</dd>
            </div>
            <div>
              <dt>Dauer</dt>
              <dd>{formatDuration(spanDuration(span, data.state.now))}</dd>
            </div>
            <div>
              <dt>Festgehalten</dt>
              <dd>{entryCount(span.entryCount)}</dd>
            </div>
            {hasSheet && (
              <div>
                <dt>Vorbereitet</dt>
                <dd>
                  {span.running ? (
                    <Link href="/abend" className="wf-chronik-source">
                      <NotebookPen aria-hidden />
                      Blatt des Abends öffnen
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="wf-chronik-source"
                      title="Was für diesen Abend vorbereitet war – und was davon gespielt und aufgedeckt wurde"
                      onClick={() => onSheet(session.id)}
                    >
                      <NotebookPen aria-hidden />
                      Blatt des Abends ansehen
                    </button>
                  )}
                </dd>
              </div>
            )}
            {session.source && (
              <div>
                <dt>Nachgetragen</dt>
                <dd>
                  <Link
                    href={`/nachtragen/${session.id}`}
                    className="wf-chronik-source"
                    title="Die Notizen, aus denen diese Session nachgetragen wurde"
                  >
                    <ScrollText aria-hidden />
                    aus deinen Notizen („{session.source.file}“)
                  </Link>
                </dd>
              </div>
            )}
          </dl>
        </header>

        <section className="wf-chronik-detail__section">
          <div className="wf-chronik-detail__sechead">
            <SectionTitle>Vorbereitung und Mitschrift</SectionTitle>
            <span
              className="wf-chronik-saved"
              data-state={status === 'error' ? 'error' : unsaved ? 'saving' : 'saved'}
            >
              {status === 'error' ? (
                'Speichern fehlgeschlagen'
              ) : unsaved ? (
                'Speichert …'
              ) : (
                <>
                  <Check /> Gespeichert
                </>
              )}
            </span>
          </div>
          <TextArea
            ref={notesRef}
            className="wf-chronik-notes"
            value={notes.draft}
            onChange={(e) => notes.change(e.target.value)}
            onBlur={notes.flush}
            placeholder="Was du vorbereitest, was am Abend passiert, was du dir für das nächste Mal merken willst …"
            aria-label="Vorbereitung und Mitschrift"
          />
        </section>

        <section className="wf-chronik-detail__section wf-chronik-detail__section--flush">
          <div className="wf-chronik-detail__sechead">
            <SectionTitle>Verlauf dieser Session</SectionTitle>
            <Button
              size="sm"
              variant="ghost"
              icon={<History />}
              onClick={() => onBackfill(session.id)}
            >
              Eintrag nachtragen
            </Button>
          </div>
          {span.entryCount === 0 ? (
            <EmptyState
              icon={<Feather />}
              title="Noch nichts festgehalten"
              action={
                span.running ? (
                  <Button variant="primary" icon={<Feather />} onClick={() => openQuickLog()}>
                    Festhalten
                  </Button>
                ) : (
                  <Button icon={<History />} onClick={() => onBackfill(session.id)}>
                    Eintrag nachtragen
                  </Button>
                )
              }
            >
              {span.running
                ? 'Alles, was du während dieser Session festhältst, erscheint hier.'
                : 'In dieser Session steht nichts in der Chronik. Du kannst Vergangenes nachtragen.'}
            </EmptyState>
          ) : (
            <Timeline rows={rows} onEdit={onEdit} stickyDays={false} />
          )}
        </section>
      </div>

      <Dialog
        open={summary !== null}
        onClose={() => setSummary(null)}
        title="Zusammenfassung"
        width={640}
        footer={<Button onClick={() => setSummary(null)}>Schließen</Button>}
      >
        <div className="wf-col">
          <div className="wf-mute">
            Die Zwischenablage ließ sich nicht direkt füllen. Der Text ist schon markiert – kopiere
            ihn mit Strg+C (am Mac: Cmd+C).
          </div>
          <TextArea
            readOnly
            data-autofocus
            className="wf-chronik-summary"
            value={summary ?? ''}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      </Dialog>
    </Panel>
  );
}

/** Trägt einen vergangenen Spielabend nach: Nummer, Titel, echtes Datum und Zeitraum in der Welt. */
function PastSessionDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (sessionId: string) => void;
}) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const [suggested] = useState(() => suggestPastSession(data));
  const [number, setNumber] = useState(String(suggested.number));
  const [title, setTitle] = useState('');
  const [realDate, setRealDate] = useState('');
  const [start, setStart] = useState(() => timeDraftOf(cal, suggested.startAt));
  const [end, setEnd] = useState(() => timeDraftOf(cal, suggested.startAt + 6 * 60));
  const startAt = timeOfDraft(cal, start);
  const endAt = timeOfDraft(cal, end);
  const real = realDate.trim() ? parseRealDate(realDate) : '';
  const problem =
    pastSessionProblem(data, { number: Number(number), startAt, endAt }) ||
    (real === null ? 'Der Spielabend ist kein gültiges Datum (Tag.Monat.Jahr).' : '');
  const save = () => {
    if (problem || startAt === null || endAt === null) return;
    const session = addPastSession(db, {
      number: Number(number),
      title,
      realDate: real ?? '',
      startAt,
      endAt,
    });
    toast({
      title: `Session ${session.number} nachgetragen`,
      body: 'Was in diesem Zeitraum schon in der Chronik stand, gehört jetzt dazu.',
    });
    onCreated(session.id);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Frühere Session nachtragen"
      width={560}
      footer={
        <>
          <span className="wf-grow wf-chronik-dialog__problem" role="status">
            {problem}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={!!problem}>
            Nachtragen
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <div className="wf-form-grid">
          <Field label="Nummer">
            <Input
              inputMode="numeric"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              data-autofocus
            />
          </Field>
          <Field label="Spielabend" hint="Echtes Datum, z. B. 3.11.2026 – oder leer lassen.">
            <Input value={realDate} onChange={(e) => setRealDate(e.target.value)} />
          </Field>
          <Field label="Titel" className="wf-span-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <SectionTitle>Beginn in der Welt</SectionTitle>
        <WorldTimeFields cal={cal} value={start} onChange={setStart} />
        <SectionTitle>Ende in der Welt</SectionTitle>
        <WorldTimeFields cal={cal} value={end} onChange={setEnd} />
      </div>
    </Dialog>
  );
}

export function Sessions({
  selectedId,
  onSelect,
  onEdit,
  onBackfill,
  onSheet,
}: {
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
  onEdit: (entry: ChronicleEntry) => void;
  onBackfill: (sessionId: string) => void;
  /** Das Blatt eines Abends zum Nachlesen öffnen. */
  onSheet: (sessionId: string) => void;
}) {
  const db = useDb();
  const data = useData();
  const spans = useMemo(() => sessionSpans(data).reverse(), [data]);
  const running = spans.find((span) => span.running) ?? null;
  const selected =
    spans.find((span) => span.session.id === selectedId) ?? running ?? spans[0] ?? null;

  const resumableId = useMemo(() => resumableSessionId(data), [data]);

  const begin = () => onSelect(startSession(db).id);
  const [pastOpen, setPastOpen] = useState(false);
  const past = (
    <>
      <Button icon={<History />} onClick={() => setPastOpen(true)}>
        Frühere Session nachtragen
      </Button>
      {pastOpen && (
        <PastSessionDialog
          onClose={() => setPastOpen(false)}
          onCreated={(id) => {
            setPastOpen(false);
            onSelect(id);
          }}
        />
      )}
    </>
  );
  // Ein Fehlgriff am Tisch darf die Session nicht kosten: Beenden lässt sich zurücknehmen.
  const end = () => {
    if (!running) return;
    const { id, number } = running.session;
    endSession(db);
    toast({
      title: `Session ${number} beendet`,
      body: 'Was du ab jetzt festhältst, gehört zu keiner Session.',
      action: {
        label: 'Rückgängig',
        run: () => {
          if (!db.getSnapshot().state.sessionId) resumeSession(db, id);
        },
      },
    });
  };
  const toggle = running ? (
    <Button icon={<CircleStop />} onClick={end}>
      Session {running.session.number} beenden
    </Button>
  ) : (
    <Button variant="primary" icon={<Play />} onClick={begin}>
      Session beginnen
    </Button>
  );

  if (!spans.length)
    return (
      <div className="wf-chronik-sessions wf-chronik-sessions--empty">
        <Panel>
          <EmptyState
            icon={<Users />}
            title="Noch keine Session"
            action={
              <div className="wf-row" style={{ gap: 8 }}>
                <Button variant="primary" icon={<Play />} onClick={begin}>
                  Session beginnen
                </Button>
                {past}
              </div>
            }
          >
            Eine Session bündelt, was an einem Spielabend geschieht – mit Titel, Datum und deinen
            Notizen. Beginne eine, sobald ihr spielt.
          </EmptyState>
        </Panel>
      </div>
    );

  return (
    <div className="wf-chronik-sessions">
      <Panel className="wf-chronik-list" title="Spielabende" count={spans.length} flush scroll>
        <div className="wf-chronik-list__action">
          {toggle}
          {past}
        </div>
        {spans.map((span) => {
          const { session } = span;
          const title = sessionTitle(session);
          const real = session.realDate ? formatRealDate(session.realDate) : '';
          return (
            <button
              key={session.id}
              type="button"
              className={cx('wf-chronik-session', span.running && 'wf-chronik-session--running')}
              aria-current={selected?.session.id === session.id}
              onClick={() => onSelect(session.id)}
            >
              <span className="wf-chronik-session__no wf-num">{session.number}</span>
              <span className="wf-chronik-session__main">
                <span className="wf-chronik-session__title wf-clamp-1">
                  {session.source && (
                    <ScrollText
                      className="wf-chronik-session__sourced"
                      aria-label="Aus deinen Notizen nachgetragen"
                    />
                  )}
                  {title || real || <span className="wf-mute wf-italic">Ohne Titel</span>}
                </span>
                {(title || !real || span.running) && (
                  <span className="wf-chronik-session__real">
                    {title && real ? real : !real ? 'Datum offen' : null}
                    {span.running && (
                      <span className="wf-chronik-running">
                        <i className="wf-session-dot" /> läuft
                      </span>
                    )}
                  </span>
                )}
                <span className="wf-chronik-session__world wf-clamp-1">
                  {worldRange(span, data)}
                </span>
                <span className="wf-chronik-session__world">
                  {formatDuration(spanDuration(span, data.state.now))} ·{' '}
                  {entryCount(span.entryCount)}
                </span>
              </span>
            </button>
          );
        })}
      </Panel>
      {selected && (
        <SessionDetail
          key={selected.session.id}
          span={selected}
          resumable={selected.session.id === resumableId}
          onEdit={onEdit}
          onBackfill={onBackfill}
          onSheet={onSheet}
        />
      )}
    </div>
  );
}
