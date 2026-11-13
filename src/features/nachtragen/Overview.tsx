/**
 * „Vergangenes nachtragen“: Notizdateien einlesen, in Sessions trennen, Grenzen und Weltzeit von
 * Hand richten und übernehmen. Bis zum Übernehmen lebt alles nur in dieser Seite.
 */
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'wouter';
import { FileText, FileUp, ScrollText, TriangleAlert, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import type { SessionDraft } from './split';
import { missingNumbers, splitSessions } from './split';
import { mergeWithNext, splitAt } from './boundary';
import { NOTES_EXTENSIONS, NotesReadError, readNotesFile, type NotesFile } from './read';
import { placeSessions, type PlaceOverrides } from './order';
import {
  editDraft,
  placedTime,
  planSummary,
  readingStateText,
  sessionCount,
  sessionsPerFile,
  sessionTimeText,
  sourcedSessions,
  takeOverPlan,
  type DraftChange,
  type TakeOverItem,
} from './model';
import { takeOverSessions } from './actions';
import { realDateInput } from '../chronik/model';
import { Button, EmptyState, IconButton, Panel, confirmDialog, cx, toast } from '../../ui';
import { DraftDetail } from './DraftDetail';
import { isReviewed, nextToReview, reviewState } from './review';

const ACCEPT = NOTES_EXTENSIONS.map((ext) => `.${ext}`).join(',');

async function readAll(list: readonly File[]): Promise<{ files: NotesFile[]; errors: string[] }> {
  const files: NotesFile[] = [];
  const errors: string[] = [];
  for (const file of list) {
    try {
      files.push(await readNotesFile(file.name, new Uint8Array(await file.arrayBuffer())));
    } catch (error) {
      errors.push(
        error instanceof NotesReadError ? error.message : `„${file.name}“ ließ sich nicht lesen.`,
      );
    }
  }
  return { files, errors };
}

/** Was ein Eintrag der Liste über sich sagt. */
function itemState(item: TakeOverItem): { text: string; tone: 'ok' | 'warn' | 'mute' | '' } {
  if (item.problem) return { text: item.problem, tone: 'warn' };
  if (item.action === 'skip') return { text: 'Vorspann – bleibt weg', tone: 'mute' };
  if (item.action === 'same') return { text: 'hat diese Notizen schon', tone: 'ok' };
  if (item.action === 'attach') return { text: 'gibt es schon · bekommt die Notizen', tone: '' };
  return { text: item.numberProposed ? 'neu · Nummer vorgeschlagen' : 'neu', tone: '' };
}

export function NotesOverview() {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<NotesFile[]>([]);
  const [drafts, setDrafts] = useState<SessionDraft[]>([]);
  const [overrides, setOverrides] = useState<PlaceOverrides>({});
  const [edited, setEdited] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const placed = useMemo(() => placeSessions(drafts, data, overrides), [drafts, data, overrides]);
  const plan = useMemo(() => takeOverPlan(placed, data), [placed, data]);
  const sourced = useMemo(() => sourcedSessions(data), [data]);
  const toReview = nextToReview(sourced);
  const perFile = useMemo(() => sessionsPerFile(files, drafts), [files, drafts]);
  const missing = useMemo(() => missingNumbers(drafts), [drafts]);
  const selectedIndex = drafts.findIndex((d) => d.key === selected);

  /** Alle Dateien neu trennen – fragt vorher, wenn von Hand schon etwas geändert wurde. */
  const resplit = async (next: NotesFile[]): Promise<boolean> => {
    if (edited && drafts.length) {
      const ok = await confirmDialog({
        title: 'Alle Notizen neu trennen?',
        body: 'Mit einer anderen Auswahl an Dateien trennt Wayfarer alle Notizen neu. Was du an Grenzen, Nummern, Titeln und Weltzeiten geändert hast, geht dabei verloren.',
        confirmLabel: 'Neu trennen',
      });
      if (!ok) return false;
    }
    setFiles(next);
    setDrafts(splitSessions(next, cal, data.state.now));
    setOverrides({});
    setEdited(false);
    setSelected(null);
    return true;
  };

  const addFiles = async (list: readonly File[]) => {
    if (!list.length) return;
    setBusy(true);
    try {
      const read = await readAll(list);
      setErrors(read.errors);
      if (!read.files.length) return;
      // Eine Datei gleichen Namens wird ersetzt – so lässt sich eine geänderte Datei neu lesen.
      const names = new Set(read.files.map((f) => f.name));
      await resplit([...files.filter((f) => !names.has(f.name)), ...read.files]);
    } finally {
      setBusy(false);
    }
  };

  const removeFile = (index: number) => resplit(files.filter((_, i) => i !== index));

  const change = (next: SessionDraft[]) => {
    setDrafts(next);
    setEdited(true);
  };
  const actions = {
    edit: (index: number, value: DraftChange) => change(editDraft(drafts, index, value)),
    merge: (index: number) => change(mergeWithNext(drafts, index)),
    split: (index: number, offset: number) => {
      const next = splitAt(drafts, index, offset);
      if (next.length === drafts.length) return;
      change(next);
      setSelected(next[index + 1]?.key ?? selected);
    },
    setTime: (key: string, startAt: number, endAt: number) => {
      setOverrides({ ...overrides, [key]: { startAt, endAt } });
      setEdited(true);
    },
    clearTime: (key: string) => {
      const next = { ...overrides };
      delete next[key];
      setOverrides(next);
    },
  };

  const takeOver = async () => {
    if (!plan.ready) return;
    const ok = await confirmDialog({
      title: 'Sessions übernehmen?',
      body: (
        <>
          {planSummary(plan)}. Deine Notizen stehen danach wörtlich an jeder Session. Nachgetragenes
          ist Geschichte: Es stellt keine Zeit vor und löst keine Termine, Uhren oder Abläufe aus.
        </>
      ),
      confirmLabel: 'Übernehmen',
    });
    if (!ok) return;
    const result = takeOverSessions(db, plan);
    if (!result) return;
    const kept = { files, drafts, overrides, edited };
    setFiles([]);
    setDrafts([]);
    setOverrides({});
    setEdited(false);
    setSelected(null);
    setErrors([]);
    const count = result.created.length + result.attached.length;
    toast({
      title: `${sessionCount(count)} nachgetragen`,
      body: 'Sie stehen jetzt in der Chronik unter „Sessions“.',
      action: {
        label: 'Rückgängig',
        run: () => {
          result.undo();
          setFiles(kept.files);
          setDrafts(kept.drafts);
          setOverrides(kept.overrides);
          setEdited(kept.edited);
        },
      },
    });
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void addFiles([...event.dataTransfer.files]);
  };
  const onDragOver = (event: DragEvent) => {
    if (![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    setDragging(true);
  };

  const picker = (
    <input
      ref={input}
      type="file"
      multiple
      accept={ACCEPT}
      hidden
      onChange={(e) => {
        const list = [...(e.target.files ?? [])];
        e.target.value = '';
        void addFiles(list);
      }}
    />
  );
  const choose = () => input.current?.click();
  const sessionsInNotes = drafts.filter((d) => !d.vorspann).length;

  return (
    <div
      className={cx('wf-page wf-nachtragen', dragging && 'wf-nachtragen--drag')}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        const into = e.relatedTarget;
        if (!(into instanceof Node && e.currentTarget.contains(into))) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {picker}
      <header className="wf-page__head wf-nachtragen-head">
        <div className="wf-grow">
          <h1 className="wf-page__title">Vergangenes nachtragen</h1>
          <p className="wf-page__lead">
            Deine Notizen bleiben, wie du sie geschrieben hast – sie sind die Quelle. Wayfarer
            trennt sie in Sessions und ordnet sie in die Weltzeit ein; was es geraten hat, sagt es.
            Erst was du übernimmst, steht in der Chronik.
          </p>
        </div>
        <span className="wf-mute wf-nachtragen-head__meta">
          {drafts.length
            ? `${sessionCount(sessionsInNotes)} aus deinen Notizen`
            : sourced.length
              ? `${sessionCount(sourced.length)} nachgetragen · ${sourced.filter(isReviewed).length} geprüft`
              : ''}
        </span>
        {drafts.length > 0 ? (
          <>
            <Button icon={<FileUp />} onClick={choose} disabled={busy}>
              Weitere Dateien
            </Button>
            <Button
              variant="primary"
              onClick={takeOver}
              disabled={!plan.ready}
              title={plan.problems[0] ?? planSummary(plan)}
            >
              Übernehmen
            </Button>
          </>
        ) : toReview ? (
          <>
            <Button icon={<FileUp />} onClick={choose} disabled={busy}>
              Weitere Dateien
            </Button>
            <Link href={`/nachtragen/${toReview.id}`} className="wf-btn wf-btn--primary">
              Session {toReview.number} prüfen
            </Link>
          </>
        ) : (
          <Button variant="primary" icon={<FileUp />} onClick={choose} disabled={busy}>
            Notizen wählen
          </Button>
        )}
      </header>

      <div className="wf-nachtragen-body">
        {drafts.length ? (
          <Panel
            className="wf-nachtragen-list"
            title="Sessions"
            count={sessionsInNotes}
            actions={
              <span className="wf-mute wf-nachtragen-list__hint">
                {missing.length
                  ? `Es fehlen: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ' …' : ''}`
                  : 'in der Reihenfolge des Spiels'}
              </span>
            }
            flush
            scroll
          >
            {plan.problems.length > 0 && (
              <div className="wf-nachtragen-problems" role="status">
                <TriangleAlert aria-hidden />
                <span>
                  {plan.problems.length === 1
                    ? 'Eine Sache hindert noch am Übernehmen'
                    : `${plan.problems.length} Dinge hindern noch am Übernehmen`}
                  : {plan.problems[0]}
                </span>
              </div>
            )}
            {placed.map((p, index) => {
              const item = plan.items[index]!;
              const time = placedTime(cal, p);
              const state = itemState(item);
              const number = item.number ?? p.draft.number;
              return (
                <button
                  key={p.draft.key}
                  type="button"
                  className={cx(
                    'wf-nachtragen-row',
                    p.draft.vorspann && 'wf-nachtragen-row--vorspann',
                  )}
                  aria-current={selected === p.draft.key}
                  onClick={() => setSelected(selected === p.draft.key ? null : p.draft.key)}
                >
                  <span
                    className={cx(
                      'wf-nachtragen-row__no wf-num',
                      item.numberProposed && 'wf-nachtragen-row__no--guess',
                    )}
                  >
                    {p.draft.vorspann
                      ? '–'
                      : number === null
                        ? '?'
                        : p.draft.lastNumber !== null
                          ? `${number}–${p.draft.lastNumber}`
                          : number}
                  </span>
                  <span className="wf-nachtragen-row__main">
                    <span className="wf-nachtragen-row__title wf-clamp-1">
                      {p.draft.vorspann
                        ? 'Vorspann'
                        : p.draft.title || <span className="wf-mute wf-italic">Ohne Titel</span>}
                    </span>
                    <span className="wf-nachtragen-row__sub wf-clamp-1">
                      {[
                        realDateInput(p.draft.realDate),
                        time.text &&
                          (time.tone === 'known'
                            ? `Weltzeit ${time.text}`
                            : time.tone === 'approx'
                              ? `Weltzeit ungefähr ${time.text}`
                              : `Weltzeit unbekannt – etwa ${time.text}`),
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'ohne eigene Weltzeit'}
                    </span>
                  </span>
                  <span
                    className={cx(
                      'wf-nachtragen-row__state',
                      state.tone && `wf-nachtragen-tone--${state.tone}`,
                    )}
                  >
                    {state.text}
                  </span>
                </button>
              );
            })}
          </Panel>
        ) : (
          <Panel
            className="wf-nachtragen-list"
            title="Nachgetragene Sessions"
            count={sourced.length}
            flush
            scroll
          >
            {sourced.length === 0 ? (
              <EmptyState icon={<ScrollText />} title="Noch nichts nachgetragen">
                Wähle deine Notizen oder zieh sie hierher. Wayfarer trennt sie in Sessions, du
                prüfst die Grenzen und die Weltzeit, dann übernimmst du sie.
              </EmptyState>
            ) : (
              sourced.map((session) => {
                const state = reviewState(session);
                return (
                  <Link
                    key={session.id}
                    href={`/nachtragen/${session.id}`}
                    className="wf-nachtragen-row"
                  >
                    <span className="wf-nachtragen-row__no wf-num">{session.number}</span>
                    <span className="wf-nachtragen-row__main">
                      <span className="wf-nachtragen-row__title wf-clamp-1">
                        {session.title || <span className="wf-mute wf-italic">Ohne Titel</span>}
                      </span>
                      <span className="wf-nachtragen-row__sub wf-clamp-1">
                        {[
                          realDateInput(session.realDate),
                          `Weltzeit ${sessionTimeText(cal, session)}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span
                      className={cx(
                        'wf-nachtragen-row__state',
                        state.tone && `wf-nachtragen-tone--${state.tone}`,
                      )}
                    >
                      {readingStateText(session)}
                      {state.bar !== null && (
                        <span className="wf-nachtragen-row__bar" aria-hidden>
                          <i style={{ width: `${state.bar}%` }} />
                        </span>
                      )}
                      <span className="wf-nachtragen-row__file wf-clamp-1">
                        aus „{session.source!.file}“
                      </span>
                    </span>
                  </Link>
                );
              })
            )}
          </Panel>
        )}

        {selectedIndex >= 0 ? (
          <DraftDetail
            key={drafts[selectedIndex]!.key}
            placed={placed[selectedIndex]!}
            item={plan.items[selectedIndex]!}
            hasNext={selectedIndex < drafts.length - 1}
            overridden={!!overrides[drafts[selectedIndex]!.key]}
            onEdit={(value) => actions.edit(selectedIndex, value)}
            onMerge={() => actions.merge(selectedIndex)}
            onSplit={(offset) => actions.split(selectedIndex, offset)}
            onSetTime={(startAt, endAt) =>
              actions.setTime(drafts[selectedIndex]!.key, startAt, endAt)
            }
            onClearTime={() => actions.clearTime(drafts[selectedIndex]!.key)}
            onClose={() => setSelected(null)}
          />
        ) : (
          <Panel className="wf-nachtragen-side" title="Notizen einlesen" scroll>
            <div
              className="wf-nachtragen-drop"
              role="button"
              tabIndex={0}
              onClick={choose}
              onKeyDown={(e) => {
                // Nur die Fläche selbst – Enter auf „entfernen“ darf nicht die Auswahl öffnen.
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  choose();
                }
              }}
            >
              <span className="wf-soft">
                {busy
                  ? 'Liest …'
                  : 'Text-, Markdown-, Word- und RTF-Dateien hierher ziehen – oder auswählen.'}
              </span>
              {perFile.map((file, index) => (
                <div key={file.name} className="wf-nachtragen-file">
                  <FileText aria-hidden />
                  <span className="wf-grow wf-clamp-1">{file.name}</span>
                  <span className="wf-mute">
                    {file.count === 0
                      ? 'keine Session'
                      : file.count === 1
                        ? '1 Session erkannt'
                        : `${file.count} Sessions erkannt`}
                  </span>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`„${file.name}“ entfernen`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeFile(index);
                    }}
                  >
                    <X />
                  </IconButton>
                </div>
              ))}
            </div>
            {errors.length > 0 && (
              <ul className="wf-nachtragen-errors" role="alert">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}
            {perFile.some((f) => f.windows) && (
              <p className="wf-mute wf-nachtragen-note">
                Eine Datei war im alten Windows-Format gespeichert – die Umlaute sind übersetzt.
              </p>
            )}
            <ul className="wf-nachtragen-rules">
              <li>
                <b>Sessions trennen:</b> an Zeilen wie „Session 5“, „Sitzung 5“ oder einem Datum.
                Stimmt eine Grenze nicht, wähle die Session: Dort legst du zusammen oder trennst an
                einer Zeile.
              </li>
              <li>
                <b>Weltzeit:</b> steht ein Tag deines Kalenders in den Notizen, nimmt Wayfarer ihn.
                Sonst reiht es die Sessions nur hintereinander („ungefähr“) – mit Zwischenzeiten wie
                „sechs Wochen später“ –, bis du einen Tag setzt. Alles liegt vor der ersten Session,
                die es schon gibt, und vor dem heutigen Stand der Welt.
              </li>
              <li>
                <b>Übernehmen:</b> legt die Sessions an oder gibt vorhandenen die Notizen –
                wörtlich. Danach liest und prüfst du jede Session einzeln.
              </li>
              <li>
                <b>Nachgetragenes</b> ist Geschichte, keine Gegenwart: Es stellt keine Zeit vor,
                löst keine Termine und keine Uhren aus.
              </li>
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
