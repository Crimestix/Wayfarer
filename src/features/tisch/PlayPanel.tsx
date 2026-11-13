/**
 * „Im Spiel“: die Geschichten, die gerade am Tisch wichtig sind – mit allem, was an ihnen hängt.
 * Die erste steht aufgeklappt da, die übrigen als Zeile. Welche im Spiel sind, entscheidet der
 * Spielleiter; was den Ort berührt und noch fehlt, bietet Wayfarer unten an. Die Rechnung steht
 * in `domain/play.ts`.
 */
import { useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Check, ChevronDown, ChevronRight, Plus, TriangleAlert, Waypoints, X } from 'lucide-react';
import { logEntry, setPromiseOutcome } from '../../data/actions';
import { useData, useDb } from '../../data/hooks';
import { playView, type PlayCard } from '../../domain/play';
import type { ChronicleEntry } from '../../domain/schema';
import {
  ENTRY_STANDING_LABEL,
  PACE_LABEL,
  THREAD_STATE_LABEL,
  boardCards,
  untilText,
} from '../../domain/story';
import { formatClock, formatDayMonth } from '../../domain/time/calendar';
import { focusOn } from '../../shell/focus';
import { Button, EntityLink, Input, MenuItem, Panel, Popover, TextArea, cx, toast } from '../../ui';
import { newStory, setHintFound, setInPlay, setStoryMemo } from '../faeden/actions';
import { EveningBlock } from './EveningBlock';
import { whenLabel } from './model';

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
/** So hoch, dass der Merkzettel ohne Rollen zu lesen ist – bis zu einer Grenze. */
const memoRows = (memo: string) =>
  memo.trim()
    ? Math.min(
        8,
        memo.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / 42)), 0),
      )
    : 2;

export function PlayPanel() {
  const db = useDb();
  const data = useData();
  const view = useMemo(() => playView(data), [data]);
  /** Von Hand auf- oder zugeklappt; sonst gilt: die erste steht offen. */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const add = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [, navigate] = useLocation();
  /** Was sich hereinnehmen lässt: alles Offene, das noch nicht im Spiel ist. */
  const idle = useMemo(() => {
    const playing = new Set(view.cards.map((play) => play.card.key));
    return boardCards(data).filter((card) => !card.closed && !playing.has(card.key));
  }, [data, view.cards]);

  return (
    <Panel
      flush
      scroll
      className="wf-tisch-play"
      title="Im Spiel"
      count={view.cards.length || undefined}
      actions={
        <>
          <Button
            ref={add}
            size="sm"
            icon={<Plus />}
            aria-haspopup="menu"
            onClick={() => setAdding((open) => !open)}
            title="Eine Geschichte oder einen losen Faden ins Spiel nehmen"
          >
            Geschichte
          </Button>
          <Link
            href="/faeden"
            className="wf-btn wf-btn--ghost wf-btn--sm"
            title="Alle Geschichten auf dem Fadenbrett"
          >
            Fadenbrett
          </Link>
        </>
      }
    >
      <EveningBlock />
      {view.cards.length === 0 && (
        <p className="wf-tisch-play__none">
          Noch keine Geschichte im Spiel. Nimm die herein, die gerade wichtig sind – dann steht hier
          bei jeder der nächste Schritt ihrer Uhr, was am Ort der Gruppe bereitliegt, ihre Fäden,
          Abmachungen und Termine und dein Merkzettel.
        </p>
      )}
      {view.cards.map((play, index) => {
        const open = toggled[play.card.key] ?? index === 0;
        return (
          <PlayStory
            key={play.card.key}
            play={play}
            open={open}
            onToggle={() => setToggled({ ...toggled, [play.card.key]: !open })}
          />
        );
      })}
      {view.offered.length > 0 && (
        <div className="wf-tisch-play__offer">
          Berührt diesen Ort, ist aber nicht im Spiel:
          {view.offered.map((card) => (
            <button
              key={card.key}
              type="button"
              title="Ins Spiel nehmen"
              onClick={() => setInPlay(db, card.key, true)}
            >
              <Plus aria-hidden />
              {card.title}
            </button>
          ))}
        </div>
      )}
      <Popover
        open={adding}
        onClose={() => setAdding(false)}
        anchor={add}
        align="right"
        width={340}
      >
        {idle.length > 0 && <div className="wf-tisch-suggest__head">Ins Spiel nehmen</div>}
        {idle.map((card) => (
          <MenuItem
            key={card.key}
            icon={<Waypoints />}
            onClick={() => {
              setAdding(false);
              setInPlay(db, card.key, true);
            }}
          >
            {card.title}
            <span className="wf-mute"> · {card.story ? 'Geschichte' : 'loser Faden'}</span>
          </MenuItem>
        ))}
        {idle.length > 0 && <div className="wf-menu-sep" />}
        <MenuItem
          icon={<Plus />}
          onClick={() => {
            setAdding(false);
            // Sie entsteht leer, ist gleich im Spiel und wird auf ihrem Blatt geschrieben.
            navigate(`/geschichte/${newStory(db, { inPlay: true }).id}`);
          }}
        >
          Neue Geschichte schreiben …
        </MenuItem>
      </Popover>
    </Panel>
  );
}

function PlayStory({
  play,
  open,
  onToggle,
}: {
  play: PlayCard;
  open: boolean;
  onToggle: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const { card } = play;
  const story = card.story;
  const next = card.clock?.next;
  const [memo, setMemo] = useState(play.memo);
  const [note, setNote] = useState('');

  const clockLine = card.clock
    ? next
      ? `${card.clock.paused ? 'Angehalten vor' : upper(untilText(next.at - now))}: ${next.step.text}`
      : 'Alles ist geschehen.'
    : null;
  /** Zugeklappt: das Wichtigste in einer Zeile. */
  const brief = [
    clockLine,
    play.hints.length + play.entries.length > 0 &&
      `${count(play.hints.length + play.entries.length, 'Sache liegt', 'Sachen liegen')} hier bereit`,
    play.threads.length > 0 && count(play.threads.length, 'Faden', 'Fäden'),
    play.promises.length > 0 && count(play.promises.length, 'Abmachung', 'Abmachungen'),
    play.present.length > 0 && play.present.map((entity) => entity.name).join(', '),
  ]
    .filter(Boolean)
    .join(' · ');

  const settle = (entry: ChronicleEntry, outcome: 'kept' | 'failed') => {
    setPromiseOutcome(db, entry.id, outcome);
    toast({
      title: outcome === 'kept' ? 'Abmachung erledigt' : 'Abmachung gescheitert',
      body: entry.text.slice(0, 120),
      action: { label: 'Rückgängig', run: () => setPromiseOutcome(db, entry.id, 'open') },
    });
  };
  const found = (threadId: string, hintId: string, text: string) => {
    setHintFound(db, threadId, hintId, true);
    toast({
      title: 'Hinweis gefunden',
      body: text.slice(0, 120),
      action: { label: 'Rückgängig', run: () => setHintFound(db, threadId, hintId, false) },
    });
  };
  const jot = () => {
    if (!story || !note.trim()) return;
    logEntry(db, { text: note, storyId: story.id });
    setNote('');
  };
  const leave = () => {
    setInPlay(db, card.key, false);
    toast({
      title: 'Aus dem Spiel genommen',
      body: card.title,
      action: { label: 'Rückgängig', run: () => setInPlay(db, card.key, true) },
    });
  };

  return (
    <section
      className={cx('wf-tisch-gesch', open && 'wf-tisch-gesch--open')}
      data-near={card.nearness}
    >
      <button
        type="button"
        className="wf-tisch-gesch__head"
        aria-expanded={open}
        onClick={onToggle}
      >
        {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
        <span className="wf-tisch-gesch__title">{card.title}</span>
        <span className="wf-tisch-gesch__where">
          {[
            play.where,
            story
              ? card.pace !== 'none' && PACE_LABEL[card.pace]
              : `loser Faden, ${THREAD_STATE_LABEL[card.threads[0]!.state].toLowerCase()}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </button>
      {!open && brief && <div className="wf-tisch-gesch__brief wf-clamp-2">{brief}</div>}
      {open && card.clock && (
        <div className="wf-tisch-gesch__clock">
          <span className="wf-tisch-gesch__pips" aria-hidden>
            {card.clock.steps.map((step) => (
              <i key={step.step.id} data-state={step.state} />
            ))}
          </span>
          <span>{clockLine}</span>
        </div>
      )}
      {open && (
        <div className="wf-tisch-dazu">
          {play.hints.map(({ thread, hint }) => (
            <Row key={hint.id} label="Liegt hier" here>
              <button
                type="button"
                className="wf-chron__check"
                title="Die Gruppe hat den Hinweis gefunden"
                aria-label={`Hinweis gefunden: ${hint.text}`}
                onClick={() => found(thread.id, hint.id, hint.text)}
              />
              <span>
                Hinweis: {hint.text}
                <em>
                  {' '}
                  – zu „{thread.title}“
                  {hint.sourceId && data.entities[hint.sourceId]
                    ? `; ${data.entities[hint.sourceId]!.name} weiß davon`
                    : ''}
                </em>
              </span>
            </Row>
          ))}
          {play.entries.map(({ entry, fits, note: why }) => (
            <Row key={entry.id} label="Liegt hier" here muted={!fits}>
              <span>
                Einstieg: {entry.text}
                {entry.standing !== 'any' && (
                  <em>
                    {' '}
                    – {ENTRY_STANDING_LABEL[entry.standing]}. {why}
                  </em>
                )}
              </span>
            </Row>
          ))}
          {play.present.length > 0 && (
            <Row label="Hier" here>
              <span>
                {play.present.map((entity, index) => (
                  <span key={entity.id}>
                    {index > 0 && ', '}
                    <EntityLink id={entity.id} icon={false} />
                  </span>
                ))}
                <em> – {play.present.length === 1 ? 'gehört' : 'gehören'} zu dieser Geschichte</em>
              </span>
            </Row>
          )}
          {play.heroes.length > 0 && (
            <Row label="Betrifft">
              <span>
                {play.heroes.map(({ character, why }, index) => (
                  <span key={character.id}>
                    {index > 0 && ' · '}
                    <EntityLink id={character.id} icon={false} />
                    {why && <em> – {why}</em>}
                  </span>
                ))}
              </span>
            </Row>
          )}
          {play.threads.map(({ thread, found: have, warning }) => (
            <Row key={thread.id} label="Faden">
              <span title={warning ?? undefined}>
                {thread.title}
                <em>
                  {' '}
                  – {THREAD_STATE_LABEL[thread.state].toLowerCase()}
                  {thread.hints.length > 0 && `, ${have} von ${thread.hints.length} Hinweisen`}
                </em>
                {warning && <TriangleAlert className="wf-tisch-dazu__warn" aria-label={warning} />}
              </span>
            </Row>
          ))}
          {play.promises.map((entry) => {
            const due = entry.promise?.due ?? null;
            const late = due !== null && due < now;
            return (
              <Row key={entry.id} label="Abmachung">
                <button
                  type="button"
                  className="wf-chron__check"
                  title="Erledigt – die Abmachung wurde eingelöst"
                  aria-label={`Erledigt: ${entry.text}`}
                  onClick={() => settle(entry, 'kept')}
                >
                  <Check />
                </button>
                <button
                  type="button"
                  className="wf-chron__check wf-chron__check--fail"
                  title="Gescheitert – gebrochen, geplatzt oder nicht mehr einzulösen"
                  aria-label={`Gescheitert: ${entry.text}`}
                  onClick={() => settle(entry, 'failed')}
                >
                  <X />
                </button>
                <span>
                  {entry.text || 'Abmachung ohne Wortlaut'}
                  <em className={late ? 'wf-tisch-dazu__late' : undefined}>
                    {' '}
                    –{' '}
                    {due === null
                      ? 'ohne Frist'
                      : late
                        ? `überfällig seit ${formatDayMonth(cal, due)}`
                        : `Frist ${whenLabel(now, due, false)}`}
                  </em>
                </span>
              </Row>
            );
          })}
          {play.events.map(({ event, at }) => (
            <Row key={event.id} label="Termin">
              <span>
                {event.title}
                <em>
                  {' '}
                  – {whenLabel(now, at, event.timed)}
                  {event.placeId && data.entities[event.placeId]
                    ? `, ${data.entities[event.placeId]!.name}`
                    : ''}
                </em>
              </span>
            </Row>
          ))}
          {play.scenes.map((scene) => (
            <Row key={scene.id} label="Szene" muted={scene.odds === 'unlikely'}>
              <span>
                {scene.text || data.encounters[scene.encounterId ?? '']?.name}
                {scene.odds !== 'maybe' && (
                  <em> – {scene.odds === 'sure' ? 'kommt sicher' : 'eher nicht'}</em>
                )}
                {scene.encounterId && data.encounters[scene.encounterId] && (
                  <button
                    type="button"
                    className="wf-tisch-dazu__link"
                    onClick={() => navigate(`/begegnungen/${scene.encounterId}`)}
                  >
                    Begegnung öffnen
                  </button>
                )}
              </span>
            </Row>
          ))}
          {story && (
            <Row label="Merkzettel" block>
              <TextArea
                className="wf-tisch-zettel"
                rows={memoRows(memo)}
                value={memo}
                aria-label={`Merkzettel zu ${card.title}`}
                placeholder="Woran du bei dieser Geschichte denken willst …"
                onChange={(event) => setMemo(event.target.value)}
                onBlur={() => setStoryMemo(db, story.id, memo)}
              />
            </Row>
          )}
          {story && (
            <Row label="Notiert" block>
              {play.notes.map((entry) => (
                <div key={entry.id} className="wf-tisch-dazu__note">
                  <span className="wf-num">
                    {formatDayMonth(cal, entry.at)}, {formatClock(entry.at)}
                  </span>
                  <span>{entry.text}</span>
                </div>
              ))}
              <Input
                value={note}
                aria-label={`Notiz zu ${card.title}`}
                placeholder="Notiz zu dieser Geschichte … (Enter hält fest)"
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') jot();
                }}
              />
            </Row>
          )}
          <div className="wf-tisch-dazu__foot">
            {story && (
              <button type="button" onClick={() => navigate(`/geschichte/${story.id}`)}>
                Blatt öffnen
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                focusOn({ type: 'card', key: card.key });
                navigate('/faeden');
              }}
            >
              Auf dem Fadenbrett zeigen
            </button>
            <button type="button" onClick={leave}>
              Aus dem Spiel nehmen
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Eine Zeile unter einer Geschichte: links, was es ist, rechts der Inhalt. */
function Row({
  label,
  here,
  muted,
  block,
  children,
}: {
  label: string;
  /** Betrifft den Ort, an dem die Gruppe gerade ist. */
  here?: boolean;
  muted?: boolean;
  /** Der Inhalt steht untereinander (Felder), nicht in einer Zeile. */
  block?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <span className="wf-tisch-dazu__label" data-here={here || undefined}>
        {label}
      </span>
      <div
        className={cx('wf-tisch-dazu__row', block && 'wf-tisch-dazu__row--block')}
        data-muted={muted || undefined}
      >
        {children}
      </div>
    </>
  );
}
