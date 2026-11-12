/**
 * „Was diesen Ort gerade berührt“: die Geschichten und losen Fäden, die an dem Ort hängen, an dem
 * die Gruppe ist – mit dem Stand ihrer Uhr und dem, was hier bereitliegt: Einstiege, Hinweise,
 * und wer hier etwas weiß. Die Rechnung steht in `domain/story.ts`.
 */
import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { Waypoints } from 'lucide-react';
import { useData } from '../../data/hooks';
import { ENTRY_STANDING_LABEL, PACE_LABEL, storiesHere, untilText } from '../../domain/story';

export function StoriesHere() {
  const data = useData();
  const [, navigate] = useLocation();
  const cards = useMemo(() => storiesHere(data), [data]);
  if (!cards.length) return null;
  const now = data.state.now;
  const name = (id: string | null) => (id ? data.entities[id]?.name : undefined);
  return (
    <section className="wf-tisch-stories" aria-label="Was diesen Ort gerade berührt">
      <header className="wf-tisch-stories__head">
        <Waypoints aria-hidden />
        <h2 className="wf-tisch-stories__title">Was diesen Ort gerade berührt</h2>
        <button
          type="button"
          className="wf-tisch-stories__link"
          onClick={() => navigate('/faeden')}
        >
          Zum Fadenbrett
        </button>
      </header>
      {cards.map(({ card, entries, hints }) => (
        <div key={card.key} className="wf-tisch-story">
          <div className="wf-tisch-story__title">
            <b>{card.title}</b>
            {card.story ? (
              card.pace !== 'none' && <span>{PACE_LABEL[card.pace]}</span>
            ) : (
              <span>loser Faden</span>
            )}
          </div>
          {card.clock?.next && (
            <div className="wf-tisch-story__line">
              {card.clock.paused
                ? 'Angehalten vor'
                : `I${untilText(card.clock.next.at - now).slice(1)}`}
              : {card.clock.next.step.text}
            </div>
          )}
          {entries.map(({ entry, fits, note }) => (
            <div key={entry.id} className="wf-tisch-story__line" data-muted={!fits}>
              <em>Einstieg</em> {entry.text}
              {entry.standing !== 'any' && (
                <span>
                  {' '}
                  – {ENTRY_STANDING_LABEL[entry.standing]}. {note}
                </span>
              )}
            </div>
          ))}
          {hints.map(({ thread, hint }) => (
            <div key={hint.id} className="wf-tisch-story__line">
              <em>Hinweis</em> {hint.text}
              <span>
                {' '}
                – zu „{thread.title}“
                {name(hint.sourceId) ? `; ${name(hint.sourceId)} weiß davon` : ''}
              </span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
