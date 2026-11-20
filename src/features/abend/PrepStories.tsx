/**
 * „Geschichten im Spiel“ auf dem Abend-Blatt: je Geschichte eine aufklappbare Karte mit dem
 * nächsten Schritt ihrer Uhr (und woran die Gruppe ihn merkt), dem, was zuletzt geschah, ihren
 * Fragen mit den Hinweisen, die noch fehlen, Einstiegen, Szenen, Begegnungen und Beute. An jedem
 * Stück hängt ein Handgriff „auf den Abend legen“ – nichts landet ohne Klick auf dem Blatt, und
 * abgehakt wird danach beides zusammen. Die Rechnung steht in `domain/prepOffers.ts`.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { lootLine, lootRecipient } from '../../domain/loot';
import { playChoices } from '../../domain/play';
import { secretOfText } from '../../domain/prep';
import {
  prepStoryCards,
  prepThreadCards,
  type CardQuestion,
  type PrepStoryCard,
} from '../../domain/prepOffers';
import { PACE_LABEL, STAGE_LABEL, boardCards, untilText } from '../../domain/story';
import { formatDayMonth } from '../../domain/time/calendar';
import { Button, IconButton, Select, cx, toast } from '../../ui';
import { newStory, setInPlay } from '../faeden/actions';
import { addSecret, addToStart, takeHint, takeStoryScene } from './actions';
import { OfferRow } from './Fach';
import { useSheet } from './sheet';

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** Meldet, was auf den Abend gelegt wurde – mit „Rückgängig“. */
function laid(what: string, text: string, undo: (() => void) | null) {
  if (undo)
    toast({
      title: `${what} auf den Abend gelegt`,
      body: text.slice(0, 120),
      action: { label: 'Rückgängig', run: undo },
    });
}

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="wf-abend-dazu__label">{label}</span>
      <div className="wf-abend-dazu__rows">{children}</div>
    </>
  );
}

/** Eine Frage mit den Hinweisen, die die Gruppe noch nicht hat. */
function Question({ question }: { question: CardQuestion }) {
  const db = useDb();
  const { which } = useSheet();
  const { thread, open, found } = question;
  return (
    <div className="wf-abend-frage">
      <div className="wf-abend-frage__title">
        {thread.title}
        <em>
          {' – '}
          {open.length === 0
            ? thread.hints.length
              ? 'die Gruppe hat alle Hinweise'
              : 'noch ohne Hinweis'
            : `${count(open.length, 'Hinweis', 'Hinweise')} noch nicht gefunden`}
          {found > 0 && open.length > 0 && `, ${found} gefunden`}
        </em>
      </div>
      {open.map(({ hint, onSheet }) => (
        <OfferRow
          key={hint.id}
          text={hint.text}
          taken={onSheet}
          takenText="Liegt auf dem Abend"
          action="auf den Abend legen"
          title="Der Hinweis wird ein Geheimnis des Abends – aufgedeckt heißt danach gefunden"
          onTake={() => laid('Hinweis', hint.text, takeHint(db, thread.id, hint.id, which))}
        />
      ))}
    </div>
  );
}

function StoryCard({
  card,
  open,
  onToggle,
}: {
  card: PrepStoryCard;
  open: boolean;
  onToggle: () => void;
}) {
  const db = useDb();
  const data = useData();
  const { which, content, patch } = useSheet();
  const { story, next } = card;
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const when = next
    ? card.clock.pace === 'running'
      ? `${upper(untilText(next.at - now))} (${formatDayMonth(cal, next.at)})`
      : card.clock.pace === 'blocked'
        ? 'Blockiert vor'
        : 'Die Uhr steht – als Nächstes'
    : '';
  const brief = [
    next ? `${when}: ${next.step.text}` : card.clock.pace === 'done' ? 'Alles ist geschehen.' : '',
    card.ready > 0 &&
      (card.ready === 1
        ? 'Eines lässt sich auf den Abend legen'
        : `${card.ready} lassen sich auf den Abend legen`),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <article className={cx('wf-abend-story', open && 'wf-abend-story--open')}>
      <header className="wf-abend-story__head">
        <button
          type="button"
          className="wf-abend-story__toggle"
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          <span className="wf-abend-name wf-clamp-1">{story.title}</span>
        </button>
        <span className="wf-abend-story__stand">
          {[
            story.guide ? STAGE_LABEL[card.stage] : '',
            card.clock.pace !== 'none' ? `Uhr ${PACE_LABEL[card.clock.pace]}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <Link href={`/geschichte/${story.id}`} className="wf-abend-link">
          Blatt öffnen
        </Link>
        <IconButton
          label={`„${story.title}“ aus dem Spiel nehmen`}
          size="sm"
          variant="ghost"
          onClick={() => setInPlay(db, `story:${story.id}`, false)}
        >
          <X />
        </IconButton>
      </header>
      {!open && brief && <div className="wf-abend-story__brief wf-clamp-2">{brief}</div>}
      {open && (
        <div className="wf-abend-dazu">
          <Part label="Uhr">
            {card.clock.pace === 'none' ? (
              <span className="wf-sheet__none">
                Ohne Uhr. Ein nächster Schritt entsteht auf dem Blatt der Geschichte.
              </span>
            ) : (
              <span className="wf-abend-dazu__line">{card.clock.line}</span>
            )}
            {next && (
              <div className="wf-abend-step">
                <div>
                  <b>{when}:</b> {next.step.text}
                </div>
                {next.step.sign.trim() ? (
                  <div className="wf-abend-step__sign">
                    Woran die Gruppe es merkt: {next.step.sign}
                  </div>
                ) : (
                  <div className="wf-abend-step__sign wf-abend-step__sign--none">
                    Woran die Gruppe es merkt, steht noch nicht da.
                  </div>
                )}
                <div className="wf-abend-step__acts">
                  {next.asSecret ? (
                    <span className="wf-abend-offer__done">Liegt als Geheimnis auf dem Abend</span>
                  ) : (
                    <button
                      type="button"
                      className="wf-abend-link"
                      title="Wörtlich als Geheimnis auf den Abend: Die Gruppe weiß noch nicht, dass es kommt"
                      onClick={() =>
                        laid(
                          'Schritt',
                          next.line,
                          addSecret(db, secretOfText(next.line, story.id), which),
                        )
                      }
                    >
                      als Geheimnis auf den Abend
                    </button>
                  )}
                  {next.inStart ? (
                    <span className="wf-abend-offer__done">Steht im Einstieg</span>
                  ) : (
                    <button
                      type="button"
                      className="wf-abend-link"
                      title="Wörtlich in den Einstieg – unter dem, was schon dasteht"
                      onClick={() => addToStart(db, next.line, which)}
                    >
                      in den Einstieg
                    </button>
                  )}
                </div>
              </div>
            )}
          </Part>
          {card.since.length > 0 && (
            <Part label="Zuletzt">
              {card.since.map((entry) => (
                <span key={entry.id} className="wf-abend-dazu__line">
                  <em>{formatDayMonth(cal, entry.at)}</em> {entry.text}
                </span>
              ))}
            </Part>
          )}
          {card.heroes.length > 0 && (
            <Part label="Betrifft">
              {card.heroes.map(({ character, why }) => (
                <span key={character.id} className="wf-abend-dazu__line">
                  {character.name}
                  {why && <em> – {why}</em>}
                </span>
              ))}
            </Part>
          )}
          <Part label="Fragen">
            {card.questions.length === 0 && (
              <span className="wf-sheet__none">Noch keine offene Frage.</span>
            )}
            {card.questions.map((question) => (
              <Question key={question.thread.id} question={question} />
            ))}
          </Part>
          {card.entries.length > 0 && (
            <Part label="Einstiege">
              {card.entries.map(({ entry, fits, note, inStart }) => (
                <OfferRow
                  key={entry.id}
                  text={entry.text}
                  sub={!fits ? note : undefined}
                  taken={inStart}
                  takenText="Steht im Einstieg"
                  action="in den Einstieg"
                  title="Wörtlich in den starken Einstieg – unter dem, was schon dasteht"
                  onTake={() => addToStart(db, entry.text, which)}
                />
              ))}
            </Part>
          )}
          <Part label="Szenen">
            {card.scenes.length === 0 && (
              <span className="wf-sheet__none">Keine Szene liegt bereit.</span>
            )}
            {card.scenes.map(({ scene, encounter, onSheet }) => {
              const place = scene.placeId ? data.entities[scene.placeId] : undefined;
              const ready = !!encounter && content.encounterIds.includes(encounter.id);
              return (
                <div key={scene.id} className="wf-abend-scene-offer">
                  {scene.text.trim() ? (
                    <OfferRow
                      text={scene.text}
                      sub={place?.name}
                      taken={onSheet}
                      takenText="Liegt auf dem Abend"
                      action="auf den Abend legen"
                      title="Die Szene wird eine Szene des Abends – abgehakt wird beides zusammen"
                      onTake={() =>
                        laid('Szene', scene.text, takeStoryScene(db, story.id, scene.id, which))
                      }
                    />
                  ) : null}
                  {encounter && (
                    <OfferRow
                      label="Begegnung"
                      text={encounter.name}
                      taken={ready}
                      action="bereitlegen"
                      onTake={() =>
                        patch({ encounterIds: [...content.encounterIds, encounter.id] })
                      }
                    />
                  )}
                </div>
              );
            })}
          </Part>
          {card.loot.length > 0 && (
            <Part label="Beute">
              {card.loot.map((entry) => (
                <span key={entry.id} className="wf-abend-dazu__line">
                  {lootLine(data, entry)}
                  <em> – für {lootRecipient(data, entry)}, liegt bereit</em>
                </span>
              ))}
            </Part>
          )}
        </div>
      )}
    </article>
  );
}

export function StoriesAction() {
  const db = useDb();
  const [, navigate] = useLocation();
  return (
    <Button
      size="sm"
      icon={<Plus />}
      onClick={() => navigate(`/geschichte/${newStory(db, { inPlay: true }).id}`)}
      title="Eine neue Geschichte schreiben – sie ist gleich im Spiel. Von ihrem Blatt führt der Weg hierher zurück."
    >
      Neue Geschichte
    </Button>
  );
}

export function StoriesBody() {
  const db = useDb();
  const data = useData();
  const { content, number } = useSheet();
  const cards = useMemo(() => prepStoryCards(data, content, number), [data, content, number]);
  const threads = useMemo(() => prepThreadCards(data, content), [data, content]);
  const choices = useMemo(() => playChoices(data, boardCards(data)), [data]);
  /** Welche Karten aufgeklappt sind – eine einzelne Geschichte steht gleich offen da. */
  const [open, setOpen] = useState<readonly string[] | null>(null);
  const isOpen = (id: string) => (open ? open.includes(id) : cards.length === 1);
  const toggle = (id: string) =>
    setOpen((before) => {
      const list = before ?? (cards.length === 1 ? cards.map((card) => card.story.id) : []);
      return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
    });
  return (
    <>
      {cards.length + threads.length === 0 && (
        <p className="wf-sheet__none">Noch nichts im Spiel.</p>
      )}
      {cards.map((card) => (
        <StoryCard
          key={card.story.id}
          card={card}
          open={isOpen(card.story.id)}
          onToggle={() => toggle(card.story.id)}
        />
      ))}
      {threads.map((question) => (
        <article key={question.thread.id} className="wf-abend-story wf-abend-story--open">
          <header className="wf-abend-story__head">
            <span className="wf-abend-story__toggle">
              <span className="wf-abend-name wf-clamp-1">{question.thread.title}</span>
            </span>
            <span className="wf-abend-story__stand">loser Faden</span>
            <IconButton
              label={`„${question.thread.title}“ aus dem Spiel nehmen`}
              size="sm"
              variant="ghost"
              onClick={() => setInPlay(db, `thread:${question.thread.id}`, false)}
            >
              <X />
            </IconButton>
          </header>
          {question.open.length > 0 && (
            <div className="wf-abend-dazu">
              <Part label="Hinweise">
                <Question question={question} />
              </Part>
            </div>
          )}
        </article>
      ))}
      {(choices.stories.length > 0 || choices.threads.length > 0) && (
        <div className="wf-abend-take">
          {choices.stories.length > 0 && (
            <Select
              className="wf-abend-add"
              value=""
              aria-label="Geschichte ins Spiel nehmen"
              onChange={(event) => {
                if (event.target.value) setInPlay(db, event.target.value, true);
              }}
            >
              <option value="">Geschichte ins Spiel nehmen …</option>
              {choices.stories.map((card) => (
                <option key={card.key} value={card.key}>
                  {card.title}
                </option>
              ))}
            </Select>
          )}
          {choices.threads.length > 0 && (
            <Select
              className="wf-abend-add"
              value=""
              aria-label="Losen Faden ins Spiel nehmen"
              onChange={(event) => {
                if (event.target.value) setInPlay(db, event.target.value, true);
              }}
            >
              <option value="">Losen Faden ins Spiel nehmen …</option>
              {choices.threads.map((card) => (
                <option key={card.key} value={card.key}>
                  {card.title}
                </option>
              ))}
            </Select>
          )}
          {(choices.moreStories > 0 || choices.moreThreads > 0) && (
            <Link href="/faeden" className="wf-abend-link">
              alle am Fadenbrett …
            </Link>
          )}
        </div>
      )}
    </>
  );
}
