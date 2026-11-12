/**
 * „Was diesen Ort gerade berührt“: die Geschichten und losen Fäden, die an dem Ort hängen, an dem
 * die Gruppe ist – mit dem Stand ihrer Uhr und dem, was hier bereitliegt: Einstiege, Hinweise,
 * und wer hier etwas weiß. Die Rechnung steht in `domain/story.ts`.
 *
 * Jede Geschichte ist eine Zeile; was hier bereitliegt, klappt ein Klick auf. So bleibt darunter
 * im Blick, wer hier ist. Berührt nur eine Geschichte den Ort, steht sie offen da.
 */
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ChevronDown, ChevronRight, Waypoints } from 'lucide-react';
import { useData } from '../../data/hooks';
import { ENTRY_STANDING_LABEL, PACE_LABEL, storiesHere, untilText } from '../../domain/story';

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function StoriesHere() {
  const data = useData();
  const [, navigate] = useLocation();
  const cards = useMemo(() => storiesHere(data), [data]);
  /** Von Hand auf- oder zugeklappt; sonst gilt: eine allein steht offen. */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  if (!cards.length) return null;
  const isOpen = (key: string) => toggled[key] ?? cards.length === 1;
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
      {cards.map(({ card, entries, hints }) => {
        const open = isOpen(card.key);
        const next = card.clock?.next;
        const more = entries.length + hints.length + (next ? 1 : 0);
        // In der Zeile: wann der nächste Schritt kommt und was hier bereitliegt.
        const brief = [
          next && (card.clock!.paused ? 'angehalten' : untilText(next.at - now)),
          entries.length > 0 &&
            (entries.length === 1 ? '1 Einstieg' : `${entries.length} Einstiege`),
          hints.length > 0 && (hints.length === 1 ? '1 Hinweis' : `${hints.length} Hinweise`),
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div key={card.key} className="wf-tisch-story">
            <button
              type="button"
              className="wf-tisch-story__title"
              aria-expanded={open}
              disabled={more === 0}
              onClick={() => setToggled({ ...toggled, [card.key]: !open })}
            >
              {more > 0 && (open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />)}
              <b className="wf-clamp-1">{card.title}</b>
              {card.story ? (
                card.pace !== 'none' && <span>{PACE_LABEL[card.pace]}</span>
              ) : (
                <span>loser Faden</span>
              )}
              {!open && brief && <span className="wf-tisch-story__brief">{brief}</span>}
            </button>
            {open && next && (
              <div className="wf-tisch-story__line">
                {card.clock!.paused ? 'Angehalten vor' : upper(untilText(next.at - now))}:{' '}
                {next.step.text}
              </div>
            )}
            {open &&
              entries.map(({ entry, fits, note }) => (
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
            {open &&
              hints.map(({ thread, hint }) => (
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
        );
      })}
    </section>
  );
}
