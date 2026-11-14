/**
 * „Lose Fäden“ neben dem Brett: die Liste aller Fäden ohne Geschichte – mit dem, woran jeder
 * hängt, woher er stammt und zu welcher Geschichte er passen könnte. Hier wird aufgeräumt:
 * mehrere wählen und zusammen an eine Geschichte hängen, eine neue Geschichte daraus machen,
 * ruhen lassen, erledigen, löschen; einzeln dasselbe, dazu als Hinweis oder Einstieg übernehmen,
 * aufs Brett legen, ins Spiel nehmen. Zeilen lassen sich auf eine Geschichte des Bretts ziehen.
 * Oben, was es wohl doppelt gibt. Die Rechnung steht in `domain/looseThreads.ts`.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Check,
  Ellipsis,
  LayoutGrid,
  Link2,
  Moon,
  Pencil,
  Play,
  Plus,
  Search,
  Sunrise,
  Trash2,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  filterLoose,
  type LooseThread,
  type StoryFit,
  type ThreadTwins,
} from '../../domain/looseThreads';
import type { Thread } from '../../domain/schema';
import { THREAD_STATE_LABEL, type BoardView } from '../../domain/story';
import { namesLine } from '../../domain/storySheet';
import { Button, IconButton, Input, MenuItem, Popover, cx, toast } from '../../ui';
import {
  markTwinsApart,
  mergeThreads,
  moveThread,
  removeThreads,
  setInPlay,
  setThreadOnBoard,
  setThreadsState,
} from './actions';
import { AttachDialog, NewStoryDialog } from './LooseDialogs';

/** Unter diesem Namen reist eine gezogene Zeile zum Brett: die Kennungen der Fäden. */
export const THREAD_DRAG = 'application/x-wayfarer-threads';

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

type OpenDialog = { type: 'attach' | 'new'; ids: string[] } | null;

export function LooseDrawer({
  rows,
  twins,
  view,
  focusId,
  onEdit,
  onShow,
}: {
  rows: readonly LooseThread[];
  twins: readonly ThreadTwins[];
  view: BoardView;
  /** Ein Faden, der gleich im Bild stehen soll (aus der Suche, nach dem Anlegen). */
  focusId: string | null;
  onEdit: (thread: Thread) => void;
  /** Zeigt die Karte eines Fadens auf dem Brett. */
  onShow: (key: string) => void;
}) {
  const db = useDb();
  const data = useData();
  const truth = view === 'truth';
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<string | null>(focusId);
  const [menu, setMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);

  const found = useMemo(() => filterLoose(rows, query), [rows, query]);
  const open = found.filter((row) => !row.resting);
  const resting = found.filter((row) => row.resting);
  // Gewählt bleibt nur, was es noch gibt und was gerade zu sehen ist.
  const chosen = found.filter((row) => picked.has(row.thread.id)).map((row) => row.thread.id);
  const allPicked = open.length > 0 && open.every((row) => picked.has(row.thread.id));
  const menuRow = rows.find((row) => row.thread.id === menu) ?? null;

  useEffect(() => {
    if (!focusId) return;
    setOpened(focusId);
    setQuery('');
  }, [focusId]);

  const pick = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  const done = (title: string, body: string, undo: (() => void) | null) => {
    if (!undo) return;
    setPicked(new Set());
    toast({ title, body, action: { label: 'Rückgängig', run: undo } });
  };
  const what = (ids: readonly string[]) =>
    ids.length === 1
      ? `„${data.threads[ids[0]!]?.title ?? ''}“`
      : count(ids.length, 'Faden', 'Fäden');
  const rest = (ids: readonly string[]) =>
    done(
      ids.length === 1 ? 'Ruht' : `${ids.length} Fäden ruhen`,
      `${what(ids)} ${ids.length === 1 ? 'steht' : 'stehen'} jetzt unten unter „Ruht“.`,
      setThreadsState(db, ids, 'dormant'),
    );
  const wake = (ids: readonly string[]) =>
    done(
      'Wieder aufgenommen',
      `${what(ids)} ${ids.length === 1 ? 'steht' : 'stehen'} wieder in der Liste.`,
      setThreadsState(db, ids, 'open'),
    );
  const settle = (ids: readonly string[]) =>
    done(
      'Erledigt',
      `${what(ids)} ${ids.length === 1 ? 'steht' : 'stehen'} jetzt unter „Abgeschlossen“ – unten links am Brett.`,
      setThreadsState(db, ids, 'solved'),
    );
  const remove = (ids: readonly string[]) =>
    done(
      ids.length === 1 ? 'Faden gelöscht' : `${ids.length} Fäden gelöscht`,
      `${what(ids)} ${ids.length === 1 ? 'ist' : 'sind'} weg. Termine, die daran hingen, bleiben.`,
      removeThreads(db, ids),
    );
  const attachFit = (row: LooseThread, fit: StoryFit) =>
    done(
      'An die Geschichte gehängt',
      `„${row.thread.title}“ ist jetzt eine Frage von „${fit.story.title}“.`,
      moveThread(db, row.thread.id, fit.story.id),
    );
  const lay = (row: LooseThread) => {
    const on = !(row.thread.onBoard || data.state.board[`thread:${row.thread.id}`] !== undefined);
    const undo = setThreadOnBoard(db, row.thread.id, on);
    if (!undo) return;
    if (on) onShow(`thread:${row.thread.id}`);
    toast({
      title: on ? 'Aufs Brett gelegt' : 'Vom Brett genommen',
      body: on
        ? `„${row.thread.title}“ liegt jetzt als Karte auf dem Brett.`
        : `„${row.thread.title}“ steht nur noch in der Liste.`,
      action: { label: 'Rückgängig', run: undo },
    });
  };
  const merge = (group: ThreadTwins) => {
    const keep = group.threads.find((thread) => thread.id === group.keepId) ?? group.threads[0]!;
    done(
      'Zusammengelegt',
      `${count(group.threads.length, 'Faden ist', 'Fäden sind')} jetzt einer: „${keep.title}“.`,
      mergeThreads(
        db,
        keep.id,
        group.threads.map((thread) => thread.id),
      ),
    );
  };
  const apart = (group: ThreadTwins) => {
    const undo = markTwinsApart(db, group.key);
    toast({
      title: 'Als verschieden gemerkt',
      body: 'Diese Fäden werden nicht mehr als doppelt gemeldet.',
      action: { label: 'Rückgängig', run: undo },
    });
  };
  /** Eine gezogene Zeile nimmt die gewählten mit, wenn sie selbst gewählt ist. */
  const drag = (row: LooseThread) => (event: DragEvent) => {
    const ids = picked.has(row.thread.id) && chosen.length > 1 ? chosen : [row.thread.id];
    event.dataTransfer.setData(THREAD_DRAG, JSON.stringify(ids));
    event.dataTransfer.effectAllowed = 'move';
  };

  const line = (row: LooseThread) => (
    <LooseRow
      key={row.thread.id}
      row={row}
      truth={truth}
      picked={picked.has(row.thread.id)}
      opened={opened === row.thread.id}
      focused={focusId === row.thread.id}
      onPick={(on) => pick(row.thread.id, on)}
      onOpen={() => setOpened(opened === row.thread.id ? null : row.thread.id)}
      onAttach={(fit) => attachFit(row, fit)}
      onDrag={drag(row)}
      onMenu={(anchor) => {
        menuAnchor.current = anchor;
        setMenu(menu === row.thread.id ? null : row.thread.id);
      }}
    />
  );

  return (
    <aside className="wf-faden-side wf-faden-loose">
      {rows.length === 0 ? (
        <p className="wf-faden-side__note">
          {truth
            ? 'Kein loser Faden. Was du festhältst, ohne dass es schon zu einer Geschichte gehört, sammelt sich hier – bis du es an eine hängst.'
            : 'Die Gruppe kennt keinen losen Faden.'}
        </p>
      ) : (
        <>
          <label className="wf-faden-loose__search">
            <Search aria-hidden />
            <Input
              value={query}
              placeholder="Suchen: Satz, Text oder Name"
              aria-label="Lose Fäden durchsuchen"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          {truth && twins.length > 0 && (
            <details className="wf-faden-twins">
              <summary title="Fäden mit demselben oder fast demselben Satz – nur ein Hinweis">
                Doppelt? {twins.length === 1 ? 'Ein Faden steht' : `${twins.length} Fäden stehen`}{' '}
                wohl mehrfach da
              </summary>
              {twins.map((group) => (
                <div key={group.key} className="wf-faden-twins__group">
                  <ul>
                    {group.threads.map((thread) => {
                      const story = thread.storyId ? data.stories[thread.storyId] : undefined;
                      return (
                        <li key={thread.id}>
                          {thread.title}
                          <em>
                            {thread.id === group.keepId && ' – bleibt'}
                            {story && ` · Frage in „${story.title}“`}
                          </em>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="wf-faden-twins__acts">
                    <Button size="sm" onClick={() => merge(group)}>
                      Zusammenlegen
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => apart(group)}>
                      Sind verschieden
                    </Button>
                  </div>
                </div>
              ))}
            </details>
          )}

          {truth && (
            <div className="wf-faden-loose__bar">
              <label className="wf-check">
                <input
                  type="checkbox"
                  checked={allPicked}
                  disabled={open.length === 0}
                  onChange={(event) =>
                    setPicked(
                      event.target.checked ? new Set(open.map((row) => row.thread.id)) : new Set(),
                    )
                  }
                />
                {chosen.length > 0 ? `${chosen.length} gewählt` : 'alle'}
              </label>
              {chosen.length === 0 ? (
                <span className="wf-faden-loose__hint">
                  Wähle Fäden aus – oder zieh einen auf eine Geschichte des Bretts.
                </span>
              ) : (
                <div className="wf-faden-loose__acts">
                  <Button
                    size="sm"
                    icon={<Link2 />}
                    onClick={() => setDialog({ type: 'attach', ids: chosen })}
                  >
                    An Geschichte hängen …
                  </Button>
                  <Button
                    size="sm"
                    icon={<Plus />}
                    onClick={() => setDialog({ type: 'new', ids: chosen })}
                  >
                    Neue Geschichte daraus …
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => rest(chosen)}>
                    Ruht
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => settle(chosen)}>
                    Erledigt
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(chosen)}>
                    Löschen
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="wf-faden-loose__list">
            {open.map(line)}
            {found.length === 0 && (
              <p className="wf-faden-side__note">Kein loser Faden passt zu dieser Suche.</p>
            )}
            {found.length > 0 && open.length === 0 && (
              <p className="wf-faden-side__note">Alle losen Fäden ruhen.</p>
            )}
          </div>

          {resting.length > 0 && (
            <details
              className="wf-faden-loose__rest"
              // Aufgeklappt, wenn dort etwas gesucht ist oder gleich im Bild stehen soll.
              open={
                query.trim() !== '' || resting.some((row) => row.thread.id === focusId) || undefined
              }
            >
              <summary title="Liegen gelassen – für später">Ruht · {resting.length}</summary>
              {resting.map(line)}
            </details>
          )}
        </>
      )}

      <Popover
        open={menuRow !== null}
        onClose={() => setMenu(null)}
        anchor={menuAnchor}
        align="right"
        width={270}
      >
        {menuRow && (
          <RowMenu
            row={menuRow}
            close={() => setMenu(null)}
            onAttach={() => setDialog({ type: 'attach', ids: [menuRow.thread.id] })}
            onNew={() => setDialog({ type: 'new', ids: [menuRow.thread.id] })}
            onLay={() => lay(menuRow)}
            onPlay={() => setInPlay(db, `thread:${menuRow.thread.id}`, !menuRow.thread.inPlay)}
            onRest={() => (menuRow.resting ? wake : rest)([menuRow.thread.id])}
            onSettle={() => settle([menuRow.thread.id])}
            onEdit={() => onEdit(data.threads[menuRow.thread.id] ?? menuRow.thread)}
            onRemove={() => remove([menuRow.thread.id])}
          />
        )}
      </Popover>
      {dialog?.type === 'attach' && (
        <AttachDialog
          ids={dialog.ids}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setPicked(new Set());
          }}
        />
      )}
      {dialog?.type === 'new' && (
        <NewStoryDialog
          ids={dialog.ids}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setPicked(new Set());
          }}
        />
      )}
    </aside>
  );
}

/** Eine Zeile der Liste: der Satz, woran er hängt, woher er stammt, wozu er passen könnte. */
function LooseRow({
  row,
  truth,
  picked,
  opened,
  focused,
  onPick,
  onOpen,
  onAttach,
  onDrag,
  onMenu,
}: {
  row: LooseThread;
  truth: boolean;
  picked: boolean;
  opened: boolean;
  focused: boolean;
  onPick: (on: boolean) => void;
  onOpen: () => void;
  onAttach: (fit: StoryFit) => void;
  onDrag: (event: DragEvent) => void;
  onMenu: (anchor: HTMLElement) => void;
}) {
  const { thread } = row;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);
  const fit = row.fits[0];
  const found = thread.hints.filter((hint) => hint.found).length;
  const marks = [
    row.nearness === 'here' && 'am Ort der Gruppe',
    thread.state === 'active' && THREAD_STATE_LABEL.active,
    thread.inPlay ? 'im Spiel' : row.onBoard && 'auf dem Brett',
  ].filter((mark): mark is string => !!mark);
  return (
    <div
      ref={ref}
      className={cx('wf-faden-loose__row', `wf-faden-thread--${thread.state}`)}
      data-near={row.nearness}
      data-on={picked}
      data-focus={focused}
      draggable={truth}
      onDragStart={onDrag}
    >
      {truth && (
        <label className="wf-check">
          <input
            type="checkbox"
            checked={picked}
            aria-label={`„${thread.title}“ auswählen`}
            onChange={(event) => onPick(event.target.checked)}
          />
        </label>
      )}
      <div className="wf-faden-loose__main">
        <button
          type="button"
          className={cx('wf-faden-loose__title', !opened && 'wf-clamp-2')}
          aria-expanded={opened}
          title={opened ? undefined : 'Mehr zeigen'}
          onClick={onOpen}
        >
          {thread.title}
        </button>
        <div className="wf-faden-loose__meta">
          {marks.map((mark) => (
            <b key={mark}>{mark}</b>
          ))}
          {row.nodes.length > 0 && <span>hängt an {namesLine(row.nodes)}</span>}
          {row.origin.text && <span>{row.origin.text}</span>}
        </div>
        {fit && (
          <div className="wf-faden-loose__fit">
            <span>
              passt zu „{fit.story.title}“ – {fit.reason}
              {row.fits.length > 1 && ` (und ${row.fits.length - 1} weitere)`}
            </span>
            {truth && (
              <button type="button" className="wf-faden-link" onClick={() => onAttach(fit)}>
                Anhängen
              </button>
            )}
          </div>
        )}
        {opened && (
          <div className="wf-faden-loose__more">
            {thread.truth && <p className="wf-faden-block__truth">{thread.truth}</p>}
            {thread.hints.map((hint) => (
              <div key={hint.id} className="wf-faden-hint" data-found={hint.found}>
                <span>{hint.text}</span>
              </div>
            ))}
            {thread.hints.length > 0 && (
              <p className="wf-mute">
                {found} von {thread.hints.length} Hinweisen gefunden
              </p>
            )}
            {truth && !thread.known && <p className="wf-mute">Die Gruppe kennt ihn nicht.</p>}
            {!thread.truth && thread.hints.length === 0 && (
              <p className="wf-mute">
                {truth
                  ? 'Noch nichts dazu geschrieben – über „Ändern“ im Menü der Zeile.'
                  : 'Mehr weiß die Gruppe dazu nicht.'}
              </p>
            )}
          </div>
        )}
      </div>
      {truth && (
        <IconButton
          label={`Was mit „${thread.title}“ geschehen soll`}
          size="sm"
          variant="ghost"
          onClick={(event) => onMenu(event.currentTarget)}
        >
          <Ellipsis />
        </IconButton>
      )}
    </div>
  );
}

function RowMenu({
  row,
  close,
  onAttach,
  onNew,
  onLay,
  onPlay,
  onRest,
  onSettle,
  onEdit,
  onRemove,
}: {
  row: LooseThread;
  close: () => void;
  onAttach: () => void;
  onNew: () => void;
  onLay: () => void;
  onPlay: () => void;
  onRest: () => void;
  onSettle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { thread } = row;
  const run = (act: () => void) => () => {
    close();
    act();
  };
  return (
    <>
      <MenuItem icon={<Link2 />} onClick={run(onAttach)}>
        An Geschichte hängen …<span className="wf-mute"> als Frage, Hinweis oder Einstieg</span>
      </MenuItem>
      <MenuItem icon={<Plus />} onClick={run(onNew)}>
        Neue Geschichte daraus …
      </MenuItem>
      <div className="wf-menu-sep" />
      <MenuItem icon={<LayoutGrid />} disabled={thread.inPlay} onClick={run(onLay)}>
        {thread.inPlay
          ? 'Liegt auf dem Brett, solange er im Spiel ist'
          : row.onBoard
            ? 'Vom Brett nehmen'
            : 'Aufs Brett legen'}
      </MenuItem>
      <MenuItem icon={<Play />} onClick={run(onPlay)}>
        {thread.inPlay ? 'Aus dem Spiel nehmen' : 'Ins Spiel nehmen'}
      </MenuItem>
      <div className="wf-menu-sep" />
      <MenuItem icon={row.resting ? <Sunrise /> : <Moon />} onClick={run(onRest)}>
        {row.resting ? 'Wieder aufnehmen' : 'Ruht – für später'}
      </MenuItem>
      <MenuItem icon={<Check />} onClick={run(onSettle)}>
        Erledigt
      </MenuItem>
      <MenuItem icon={<Pencil />} onClick={run(onEdit)}>
        Ändern …
      </MenuItem>
      <MenuItem icon={<Trash2 />} onClick={run(onRemove)}>
        Löschen
      </MenuItem>
    </>
  );
}
