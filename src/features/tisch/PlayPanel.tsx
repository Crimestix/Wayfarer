/**
 * „Im Spiel“: die Geschichten, die gerade am Tisch wichtig sind – mit allem, was an ihnen hängt.
 * Die erste steht aufgeklappt da, die übrigen als Zeile. Welche im Spiel sind, entscheidet der
 * Spielleiter; was den Ort berührt und noch fehlt, bietet Wayfarer unten an. Die Rechnung steht
 * in `domain/play.ts`.
 */
import { SUGGESTION } from '../../domain/dismiss';
import { useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Check, ChevronDown, ChevronRight, Plus, TriangleAlert, Waypoints, X } from 'lucide-react';
import { logEntry, setPromiseOutcome } from '../../data/actions';
import { useData, useDb } from '../../data/hooks';
import { lootLine, lootRecipient } from '../../domain/loot';
import { playChoices, playView, type PlayCard } from '../../domain/play';
import { tableRecap } from '../../domain/recap';
import type { ChronicleEntry } from '../../domain/schema';
import {
  ENTRY_STANDING_LABEL,
  PACE_LABEL,
  THREAD_STATE_LABEL,
  boardCards,
  untilText,
  type BoardCard,
} from '../../domain/story';
import { formatClock, formatDayMonth } from '../../domain/time/calendar';
import { focusOn } from '../../shell/focus';
import {
  Button,
  DismissButton,
  EntityLink,
  Input,
  MenuItem,
  Panel,
  Popover,
  TextArea,
  cx,
  toast,
} from '../../ui';
import { RecapBox } from '../abend/RecapBox';
import { useGiveLoot } from '../beute/useGive';
import { newStory, setHintFound, setInPlay, setSceneDone, setStoryMemo } from '../faeden/actions';
import { leadNote } from '../../domain/threadWeb';
import { dismissRecap } from './commands';
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

/**
 * „Letztes Mal“ zu Beginn des Abends: steht da, bis im neuen Abend etwas festgehalten ist oder
 * der Spielleiter es wegklickt (`domain/recap.ts`).
 */
function TableRecap() {
  const db = useDb();
  const data = useData();
  const recap = useMemo(() => tableRecap(data), [data]);
  if (!recap) return null;
  return (
    <RecapBox
      recap={recap}
      className="wf-tisch-recap"
      onDismiss={() => {
        dismissRecap(db);
        toast({
          title: '„Letztes Mal“ ausgeblendet',
          body: 'Für diesen Abend. Unter „Abend vorbereiten“ steht der Rückblick weiter.',
          action: { label: 'Rückgängig', run: () => dismissRecap(db, true) },
        });
      }}
    />
  );
}

export function PlayPanel() {
  const db = useDb();
  const data = useData();
  const view = useMemo(() => playView(data), [data]);
  /** Von Hand auf- oder zugeklappt; sonst gilt: die erste steht offen. */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const add = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [, navigate] = useLocation();
  const [query, setQuery] = useState('');
  /**
   * Was sich hereinnehmen lässt: Geschichten und lose Fäden, die noch nicht im Spiel sind – was
   * am Ort der Gruppe hängt zuerst, nie eine endlose Liste (`playChoices`).
   */
  const cards = useMemo(() => boardCards(data), [data]);
  const choices = useMemo(() => playChoices(data, cards, query), [data, cards, query]);
  const take = (card: BoardCard) => {
    setAdding(false);
    setQuery('');
    setInPlay(db, card.key, true);
  };
  const choice = (card: BoardCard) => (
    <MenuItem key={card.key} icon={<Waypoints />} onClick={() => take(card)}>
      {/* Ein langer Satz nimmt der Auswahl nicht den Platz: zwei Zeilen, der Rest im Tooltip. */}
      <span className="wf-clamp-2" title={card.title}>
        {card.title}
      </span>
      {card.nearness === 'here' && (
        <span className="wf-tisch-play__picknear">hängt an diesem Ort</span>
      )}
    </MenuItem>
  );
  const none = choices.stories.length + choices.threads.length === 0;

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
      <TableRecap />
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
            <span key={card.key} className="wf-tisch-play__offered">
              <button
                type="button"
                title="Ins Spiel nehmen"
                onClick={() => setInPlay(db, card.key, true)}
              >
                <Plus aria-hidden />
                {card.title}
              </button>
              <DismissButton
                suggestionKey={SUGGESTION.here(card.key, data.state.placeId ?? '')}
                what={`„${card.title}“ hier`}
              />
            </span>
          ))}
          {view.offeredMore > 0 && (
            <button
              type="button"
              title="Über „Geschichte“ suchen und ins Spiel nehmen"
              onClick={() => setAdding(true)}
            >
              {view.offeredMore === 1
                ? 'und 1 weiterer loser Faden …'
                : `und ${view.offeredMore} weitere lose Fäden …`}
            </button>
          )}
        </div>
      )}
      <Popover
        open={adding}
        onClose={() => {
          setAdding(false);
          setQuery('');
        }}
        anchor={add}
        align="right"
        width={360}
        className="wf-tisch-play__pick"
      >
        {choices.search && (
          <div className="wf-tisch-play__picksearch">
            <Input
              value={query}
              autoFocus
              placeholder="Suchen: Satz oder Name"
              aria-label="Geschichten und lose Fäden durchsuchen"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        )}
        {choices.stories.length > 0 && (
          <div className="wf-tisch-suggest__head">Geschichte ins Spiel nehmen</div>
        )}
        {choices.stories.map(choice)}
        {choices.moreStories > 0 && (
          <div className="wf-tisch-play__pickmore">
            und {choices.moreStories} weitere – tippe, um zu suchen
          </div>
        )}
        {choices.threads.length > 0 && (
          <div className="wf-tisch-suggest__head">Losen Faden ins Spiel nehmen</div>
        )}
        {choices.threads.map(choice)}
        {choices.moreThreads > 0 && (
          <div className="wf-tisch-play__pickmore">
            und {choices.moreThreads} weitere – tippe, um zu suchen
          </div>
        )}
        {none && query.trim() !== '' && (
          <div className="wf-tisch-play__pickmore">Nichts heißt so.</div>
        )}
        {!none && <div className="wf-menu-sep" />}
        <MenuItem
          icon={<Plus />}
          onClick={() => {
            setAdding(false);
            setQuery('');
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
  const give = useGiveLoot();
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
    // Führt der Hinweis zu einem Faden, sagt die Meldung, wohin die Spur jetzt geht.
    const lead = leadNote(db.getSnapshot(), threadId, hintId);
    toast({
      title: 'Hinweis gefunden',
      body: lead ? `${text.slice(0, 90)} – ${lead}` : text.slice(0, 120),
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
          <span>
            {clockLine}
            {next?.step.sign && <em> – Woran man es merkt: {next.step.sign}</em>}
          </span>
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
          {play.threads.map(({ thread, found: have, warning, here, next: onward }) => (
            <Row key={thread.id} label={here ? 'Faden hier' : 'Faden'} here={here}>
              <span title={warning ?? undefined}>
                {thread.title}
                <em>
                  {' '}
                  – {THREAD_STATE_LABEL[thread.state].toLowerCase()}
                  {thread.hints.length > 0 && `, ${have} von ${thread.hints.length} Hinweisen`}
                </em>
                {warning && <TriangleAlert className="wf-tisch-dazu__warn" aria-label={warning} />}
                {onward.length > 0 && (
                  <span className="wf-tisch-dazu__onward">
                    {onward.map((step) => (
                      <span key={step.thread.id}>
                        {step.step === 'ledFrom' ? '←' : '→'} {step.thread.title}
                        {step.word && (
                          <em>
                            {' '}
                            – {step.step === 'tie' ? step.word : `Hinweis: ${step.word}`}
                          </em>
                        )}
                      </span>
                    ))}
                  </span>
                )}
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
                {story && (
                  <button
                    type="button"
                    className="wf-tisch-dazu__link"
                    title="Die Szene ist gespielt – sie steht dann abgehakt auf dem Blatt der Geschichte"
                    onClick={() => {
                      setSceneDone(db, story.id, scene.id, true);
                      toast({
                        title: 'Szene gespielt',
                        body: (scene.text || 'Begegnung').slice(0, 120),
                        action: {
                          label: 'Rückgängig',
                          run: () => setSceneDone(db, story.id, scene.id, false),
                        },
                      });
                    }}
                  >
                    Gespielt
                  </button>
                )}
              </span>
            </Row>
          ))}
          {play.loot.map((loot) => (
            <Row key={loot.id} label="Beute">
              <span>
                {lootLine(data, loot)}
                <em> – für {lootRecipient(data, loot)}</em>
                <button
                  type="button"
                  className="wf-tisch-dazu__link"
                  title="Steht danach im Beute-Buch und in der Mitschrift"
                  onClick={() => give(loot)}
                >
                  ausgeben
                </button>
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
