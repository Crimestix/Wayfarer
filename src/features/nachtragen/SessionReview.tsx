/**
 * Eine nachgetragene Session prüfen: links die Notizen, wie sie geschrieben wurden – mit
 * markierten Namen, unbekannten Namen und Zeitangaben; der Satz des gewählten Vorschlags ist
 * hervorgehoben. Rechts die Vorschläge als Zeitleiste: Art, Zeit, Satz, was beim Annehmen
 * zusätzlich geschieht (Häkchen), Widersprüche, Annehmen / Ändern / Stimmt nicht. Darüber die
 * Fragen zu unbekannten Namen und die Weltzeit der Session. Gerechnet wird in `review.ts`,
 * geschrieben in `reviewActions.ts`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Pencil,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL as ENTITY_KIND_LABEL } from '../../domain/derive';
import type { EntityKind, ReadProposal, ReadQuestion, Session } from '../../domain/schema';
import { Button, Checkbox, EmptyState, EntityPicker, Panel, Select, cx, toast } from '../../ui';
import { formatRealDate, timeDraftOf, timeOfDraft } from '../chronik/model';
import { WorldTimeFields } from '../chronik/WorldTimeFields';
import { sessionTimeText, sourcedSessions } from './model';
import { ProposalDialog } from './ProposalDialog';
import { storeReading } from './readActions';
import { isSafeProposal, proposalKindLabel, sessionNotes } from './readSession';
import {
  QUESTION_KINDS,
  checksOf,
  noteView,
  proposalConsequences,
  proposalTone,
  proposalWhen,
  proposalsInOrder,
  questionGuesses,
  reviewProgress,
  safeProposals,
  sessionTimeProblem,
  threadTwinNote,
  type ConsequenceKey,
  type NoteLineView,
  type ProposalChange,
} from './review';
import {
  acceptProposal,
  acceptProposals,
  answerQuestion,
  dismissProposal,
  reopenProposal,
  setSessionTime,
  undoAccepted,
  type QuestionAnswer,
} from './reviewActions';

type Checks = Record<string, Partial<Record<ConsequenceKey, boolean>>>;

export function SessionReview({ sessionId }: { sessionId: string }) {
  const db = useDb();
  const data = useData();
  const session = data.sessions[sessionId];
  const all = useMemo(() => sourcedSessions(data), [data]);
  const at = all.findIndex((s) => s.id === sessionId);
  const previous = at > 0 ? all[at - 1] : undefined;
  const next = at >= 0 ? all[at + 1] : undefined;

  const [active, setActive] = useState<string | null>(null);
  const [checks, setChecks] = useState<Checks>({});
  const [editing, setEditing] = useState<string | null>(null);

  // Noch nicht gelesen: gleich lesen – das legt nichts an, es merkt sich nur die Vorschläge.
  const hasNotes = !!session && !!sessionNotes(session).trim();
  const unread = !!session && !session.reading && hasNotes;
  useEffect(() => {
    if (unread) storeReading(db, sessionId);
  }, [db, sessionId, unread]);

  if (!session)
    return (
      <div className="wf-page wf-nachtragen">
        <div className="wf-nachtragen-body wf-nachtragen-body--single">
          <Panel>
            <EmptyState
              title="Diese Session gibt es nicht"
              action={
                <Link href="/nachtragen" className="wf-btn">
                  Zu den nachgetragenen Sessions
                </Link>
              }
            >
              Vielleicht wurde sie gelöscht oder ihr Übernehmen zurückgenommen.
            </EmptyState>
          </Panel>
        </div>
      </div>
    );

  const reading = session.reading;
  const progress = reviewProgress(session);
  const safe = reading ? safeProposals(reading) : [];

  const report = (title: string, notes: string[], undo?: () => void) =>
    toast({
      title,
      body: notes.length ? notes.join(' ') : undefined,
      action: undo ? { label: 'Rückgängig', run: undo } : undefined,
    });

  const accept = (proposal: ReadProposal, change: ProposalChange = {}) => {
    const result = acceptProposal(db, sessionId, proposal.id, {
      ...change,
      checks: { ...checks[proposal.id], ...change.checks },
    });
    if ('problem' in result) {
      toast({ title: 'Nicht angenommen', body: result.problem, tone: 'danger' });
      return false;
    }
    report(`Angenommen: ${proposal.label}`, result.notes, result.undo);
    return true;
  };

  const acceptSafe = () => {
    const result = acceptProposals(
      db,
      sessionId,
      safe.map((p) => ({ id: p.id, change: { checks: checks[p.id] } })),
    );
    const failed = result.failed.length
      ? [`${result.failed.length} ließen sich nicht annehmen: ${result.failed[0]!.problem}`]
      : [];
    report(
      `${result.accepted.length} ${result.accepted.length === 1 ? 'Vorschlag' : 'Vorschläge'} angenommen`,
      [...failed, ...result.notes],
      result.accepted.length ? result.undo : undefined,
    );
  };

  const reread = () => {
    const result = storeReading(db, sessionId);
    if (result) report('Neu gelesen', ['Was du schon entschieden hast, bleibt.'], result.undo);
  };

  const title = session.title.trim();
  const editingProposal = editing ? reading?.proposals.find((p) => p.id === editing) : undefined;

  return (
    <div className="wf-page wf-nachtragen">
      <header className="wf-page__head wf-nachtragen-head">
        <div className="wf-grow">
          <h1 className="wf-page__title">
            Session {session.number}
            {title && ` · ${title}`}
          </h1>
          <p className="wf-page__lead">
            {[
              session.realDate && `gespielt am ${formatRealDate(session.realDate, 'long')}`,
              reading &&
                `${progress.accepted + progress.dismissed} von ${progress.total} Vorschlägen geprüft`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <Link href="/nachtragen" className="wf-btn">
          <ArrowLeft aria-hidden />
          Zur Übersicht
        </Link>
        {previous && (
          <Link href={`/nachtragen/${previous.id}`} className="wf-btn">
            <ChevronLeft aria-hidden />
            Session {previous.number}
          </Link>
        )}
        {next && (
          <Link href={`/nachtragen/${next.id}`} className="wf-btn">
            Session {next.number}
            <ChevronRight aria-hidden />
          </Link>
        )}
      </header>

      <div className="wf-nachtragen-body wf-nachtragen-body--review">
        <Panel
          className="wf-nachtragen-list"
          title="Deine Notizen"
          actions={
            session.source && (
              <span className="wf-mute wf-nachtragen-list__hint">
                aus „{session.source.file}“
                {session.source.line > 0 && `, ab Zeile ${session.source.line}`}
              </span>
            )
          }
          scroll
        >
          <Notes session={session} active={active} onPick={(id) => setActive(id)} />
          {session.source && session.notes.trim() && (
            <section className="wf-nachtragen-own">
              <div className="wf-nachtragen-caps">Vorbereitung und Mitschrift</div>
              <div className="wf-prose wf-soft">{session.notes}</div>
            </section>
          )}
        </Panel>

        <Panel
          className="wf-nachtragen-side wf-nachtragen-review"
          title="Vorschläge"
          count={progress.total}
          flush
          actions={
            reading && (
              <div className="wf-row">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RefreshCw aria-hidden />}
                  onClick={reread}
                  title="Die Notizen noch einmal lesen – Entscheidungen bleiben."
                >
                  Neu lesen
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!safe.length}
                  onClick={acceptSafe}
                  title="Sicher heißt: keine offene Frage, kein Widerspruch, alles Nötige steht fest."
                >
                  Alle sicheren annehmen ({safe.length})
                </Button>
              </div>
            )
          }
        >
          <SessionTimeBar session={session} />
          {!reading ? (
            <EmptyState title={hasNotes ? 'Wayfarer liest die Notizen …' : 'Keine Notizen'}>
              {hasNotes
                ? 'Gleich stehen hier die Vorschläge – jeder mit dem Satz, aus dem er stammt.'
                : 'Unter dieser Überschrift standen keine Notizen. Es gibt nichts zu prüfen.'}
            </EmptyState>
          ) : (
            <div className="wf-nachtragen-props">
              <Questions session={session} />
              {reading.proposals.length === 0 && (
                <EmptyState title="Nichts vorgeschlagen">
                  In diesen Notizen hat Wayfarer nichts gefunden, das in die Chronik gehört. Was du
                  selbst eintragen willst, geht über „Festhalten“.
                </EmptyState>
              )}
              {proposalsInOrder(reading).map((proposal) => (
                <ProposalRow
                  key={proposal.id}
                  session={session}
                  proposal={proposal}
                  active={active === proposal.id}
                  safe={isSafeProposal(reading, proposal)}
                  checks={checks[proposal.id] ?? {}}
                  onCheck={(key, on) =>
                    setChecks({ ...checks, [proposal.id]: { ...checks[proposal.id], [key]: on } })
                  }
                  onSelect={() => setActive(proposal.id)}
                  onAccept={() => accept(proposal)}
                  onEdit={() => setEditing(proposal.id)}
                  onDismiss={() => {
                    const undo = dismissProposal(db, sessionId, proposal.id);
                    report(`Verworfen: ${proposal.label}`, [], undo);
                  }}
                  onReopen={() => reopenProposal(db, sessionId, proposal.id)}
                  onUndo={() => {
                    const { notes } = undoAccepted(db, sessionId, [proposal.id]);
                    report(`Zurückgenommen: ${proposal.label}`, notes);
                  }}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {editingProposal && (
        <ProposalDialog
          session={session}
          proposal={editingProposal}
          checks={checks[editingProposal.id] ?? {}}
          onClose={() => setEditing(null)}
          onAccept={(change) => {
            if (accept(editingProposal, change)) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ── Notizen ────────────────────────────────────────────────────────────────

function Notes({
  session,
  active,
  onPick,
}: {
  session: Session;
  active: string | null;
  onPick: (id: string) => void;
}) {
  const data = useData();
  const lines: NoteLineView[] = useMemo(() => noteView(data, session), [data, session]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    box.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);
  if (!lines.length)
    return (
      <span className="wf-mute wf-italic">
        {session.source
          ? 'Unter dieser Überschrift standen keine Notizen.'
          : 'Diese Session wurde nicht aus Notizen nachgetragen.'}
      </span>
    );
  return (
    <div className="wf-nachtragen-notes" ref={box}>
      {lines.map((line) => (
        <div key={line.line} className="wf-nachtragen-notes__block">
          {line.heading && <div className="wf-nachtragen-notes__section">{line.heading}</div>}
          <div
            className={cx(
              'wf-nachtragen-notes__line',
              (line.section === 'recap' || line.section === 'rules') &&
                'wf-nachtragen-notes__line--quiet',
            )}
          >
            {line.segments.length === 0 && ' '}
            {line.segments.map((s) => {
              const on = !!active && s.proposals.includes(active);
              return (
                <span
                  key={s.from}
                  data-active={on || undefined}
                  className={cx(
                    s.entityId && 'wf-nachtragen-mark--name',
                    s.question && 'wf-nachtragen-mark--question',
                    s.date && 'wf-nachtragen-mark--date',
                    s.proposals.length > 0 && 'wf-nachtragen-mark--said',
                    on && 'wf-nachtragen-mark--on',
                  )}
                  onClick={s.proposals.length ? () => onPick(s.proposals[0]!) : undefined}
                >
                  {s.text}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Weltzeit der Session ───────────────────────────────────────────────────

function SessionTimeBar({ session }: { session: Session }) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(() => timeDraftOf(cal, session.startAt));
  const [end, setEnd] = useState(() => timeDraftOf(cal, session.endAt ?? session.startAt));
  const startAt = timeOfDraft(cal, start);
  const endAt = timeOfDraft(cal, end);
  const problem = open ? sessionTimeProblem(data, session.id, startAt, endAt) : '';
  const known = (session.source?.precision ?? 'exact') === 'exact';
  const save = () => {
    const result = setSessionTime(db, session.id, startAt, endAt);
    if ('problem' in result) return;
    setOpen(false);
    toast({
      title: 'Weltzeit gesetzt',
      body: 'Die offenen Vorschläge sind neu eingeordnet; angenommene behalten ihre Zeit.',
      action: { label: 'Rückgängig', run: result.undo },
    });
  };
  return (
    <div className="wf-nachtragen-timebar">
      <div className="wf-row">
        <span className="wf-nachtragen-caps">Weltzeit</span>
        <span className={cx('wf-grow', !known && 'wf-nachtragen-tone--approx')}>
          {sessionTimeText(cal, session)}
        </span>
        {!open && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setStart(timeDraftOf(cal, session.startAt));
              setEnd(timeDraftOf(cal, session.endAt ?? session.startAt));
              setOpen(true);
            }}
          >
            Weltzeit setzen
          </Button>
        )}
      </div>
      {open && (
        <div className="wf-nachtragen-time">
          <div className="wf-nachtragen-caps">Beginn</div>
          <WorldTimeFields cal={cal} value={start} onChange={setStart} />
          <div className="wf-nachtragen-caps">Ende</div>
          <WorldTimeFields cal={cal} value={end} onChange={setEnd} />
          <div className="wf-row">
            <span
              className={cx('wf-field__hint wf-grow', problem && 'wf-nachtragen-tone--warn')}
              role="status"
            >
              {problem || 'Die offenen Vorschläge werden danach neu eingeordnet.'}
            </span>
            <Button size="sm" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button size="sm" disabled={!!problem} onClick={save}>
              Setzen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Fragen zu Namen ────────────────────────────────────────────────────────

function Questions({ session }: { session: Session }) {
  const open = (session.reading?.questions ?? []).filter((q) => q.state === 'open');
  if (!open.length) return null;
  return (
    <section className="wf-nachtragen-questions">
      <div className="wf-nachtragen-caps">
        {open.length === 1
          ? 'Ein Name, den Wayfarer nicht kennt'
          : `${open.length} Namen, die Wayfarer nicht kennt`}
      </div>
      {open.map((q) => (
        <QuestionBox key={q.key} session={session} question={q} />
      ))}
    </section>
  );
}

function QuestionBox({ session, question }: { session: Session; question: ReadQuestion }) {
  const db = useDb();
  const data = useData();
  const guesses = useMemo(() => questionGuesses(data, question), [data, question]);
  const [other, setOther] = useState<string | null>(null);
  const [kind, setKind] = useState<EntityKind>('person');
  const answer = (value: QuestionAnswer, title: string) => {
    const result = answerQuestion(db, session.id, question.key, value);
    if (result) toast({ title, action: { label: 'Rückgängig', run: result.undo } });
  };
  const link = (id: string) =>
    answer(
      { link: id },
      `„${question.name}“ ist jetzt ein zweiter Name von ${data.entities[id]?.name ?? 'diesem Eintrag'}`,
    );
  return (
    <div className="wf-nachtragen-question">
      <div className="wf-row">
        <CircleHelp aria-hidden className="wf-nachtragen-question__icon" />
        <span className="wf-grow">
          Wer oder was ist <b>„{question.name}“</b>?{' '}
          <span className="wf-mute">
            {question.count}-mal, {question.lines.length === 1 ? 'Zeile' : 'Zeilen'}{' '}
            {question.lines.join(', ')}
          </span>
        </span>
      </div>
      <div className="wf-row-wrap">
        {guesses.map((entity) => (
          <Button key={entity.id} size="sm" onClick={() => link(entity.id)}>
            {entity.name}
          </Button>
        ))}
        <span className="wf-nachtragen-question__pick">
          <EntityPicker
            value={other}
            onChange={(id) => {
              setOther(id);
              if (id) link(id);
            }}
            placeholder={guesses.length ? 'Jemand anderes …' : 'Eintrag wählen …'}
          />
        </span>
      </div>
      <div className="wf-row-wrap">
        <Select
          value={kind}
          onChange={(e) => setKind(e.target.value as EntityKind)}
          aria-label="Art des neuen Eintrags"
          className="wf-nachtragen-question__kind"
        >
          {QUESTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {ENTITY_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            answer({ create: kind }, `${ENTITY_KIND_LABEL[kind]} „${question.name}“ angelegt`)
          }
        >
          Neu anlegen
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => answer({ none: true }, `„${question.name}“: niemand Bestimmtes`)}
        >
          Niemand Bestimmtes
        </Button>
      </div>
      <div className="wf-field__hint">
        Wählst du einen Eintrag, merkt sich Wayfarer „{question.name}“ als seinen zweiten Namen.
      </div>
    </div>
  );
}

// ── Ein Vorschlag ──────────────────────────────────────────────────────────

function ProposalRow({
  session,
  proposal,
  active,
  safe,
  checks,
  onCheck,
  onSelect,
  onAccept,
  onEdit,
  onDismiss,
  onReopen,
  onUndo,
}: {
  session: Session;
  proposal: ReadProposal;
  active: boolean;
  safe: boolean;
  checks: Partial<Record<ConsequenceKey, boolean>>;
  onCheck: (key: ConsequenceKey, on: boolean) => void;
  onSelect: () => void;
  onAccept: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  onReopen: () => void;
  onUndo: () => void;
}) {
  const data = useData();
  const cal = data.campaign.calendar;
  const isOpen = proposal.state === 'open';
  const consequences = isOpen ? proposalConsequences(data, session, proposal) : [];
  const current = checksOf(consequences, checks);
  const openNames = (session.reading?.questions ?? []).filter(
    (q) => q.state === 'open' && proposal.names.includes(q.key),
  );
  const tone = proposalTone(proposal.kind);
  /** „Gibt es schon“: Annehmen legt keinen zweiten Faden an. */
  const twin = isOpen ? threadTwinNote(data, proposal) : '';
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);
  return (
    <div
      ref={ref}
      className={cx(
        'wf-nachtragen-prop',
        !isOpen && 'wf-nachtragen-prop--done',
        active && 'wf-nachtragen-prop--on',
      )}
      onClick={onSelect}
      onFocus={onSelect}
    >
      <span className={cx('wf-nachtragen-kind', tone && `wf-nachtragen-kind--${tone}`)}>
        {proposalKindLabel(proposal.kind)}
      </span>
      <div className="wf-nachtragen-prop__main">
        <div className="wf-nachtragen-prop__what">{proposal.label}</div>
        <div className="wf-nachtragen-prop__when">
          {proposalWhen(cal, proposal)} · Zeile {proposal.line}
          {proposal.secret && ' · nur für die Spielleitung'}
        </div>
        {proposal.quote && proposal.quote !== proposal.label && (
          <div className="wf-nachtragen-prop__quote">
            „{proposal.kind === 'writing' ? proposal.quote.split('\n')[0] : proposal.quote}“
            {proposal.kind === 'writing' && proposal.quote.includes('\n') && ' …'}
          </div>
        )}
        {consequences.length > 0 && (
          <div className="wf-nachtragen-prop__then" onClick={(e) => e.stopPropagation()}>
            {consequences.map((c) => (
              <Checkbox key={c.key} checked={current[c.key]} onChange={(on) => onCheck(c.key, on)}>
                {c.label}
              </Checkbox>
            ))}
          </div>
        )}
        {isOpen &&
          proposal.hints.map((hint) => (
            <div key={hint} className="wf-nachtragen-prop__hint">
              <TriangleAlert aria-hidden />
              <span>{hint}</span>
            </div>
          ))}
        {isOpen && openNames.length > 0 && (
          <div className="wf-nachtragen-prop__names">
            Wartet auf die Frage zu {openNames.map((q) => `„${q.name}“`).join(', ')} – oben.
          </div>
        )}
        {twin && <div className="wf-nachtragen-prop__note">{twin}</div>}
        {proposal.state === 'accepted' && proposal.edits.some((e) => e.kind === 'source') && (
          <div className="wf-nachtragen-prop__note">
            Den Faden gab es schon – die Session steht bei ihm als Quelle.
          </div>
        )}
        {proposal.stale && (
          <div className="wf-nachtragen-prop__names">Steht nicht mehr so in den Notizen.</div>
        )}
      </div>
      <div className="wf-nachtragen-prop__acts" onClick={(e) => e.stopPropagation()}>
        {isOpen ? (
          <>
            <Button
              size="sm"
              icon={<Check aria-hidden />}
              onClick={onAccept}
              title={safe ? undefined : 'Nicht unter den sicheren – sieh ihn dir vorher genau an.'}
            >
              Annehmen
            </Button>
            <Button size="sm" variant="ghost" icon={<Pencil aria-hidden />} onClick={onEdit}>
              Ändern
            </Button>
            <Button size="sm" variant="ghost" icon={<X aria-hidden />} onClick={onDismiss}>
              Stimmt nicht
            </Button>
          </>
        ) : proposal.state === 'accepted' ? (
          <>
            <span className="wf-nachtragen-tone--ok wf-nachtragen-prop__state">angenommen</span>
            <Button size="sm" variant="ghost" icon={<RotateCcw aria-hidden />} onClick={onUndo}>
              Rückgängig
            </Button>
          </>
        ) : (
          <>
            <span className="wf-mute wf-nachtragen-prop__state">verworfen</span>
            <Button size="sm" variant="ghost" icon={<RotateCcw aria-hidden />} onClick={onReopen}>
              Doch prüfen
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
