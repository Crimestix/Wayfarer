/** Eine Vermutung in einer Zeile – für die Spielleitung mit Stand zum Abhaken und Bemerkung. */
import { Lightbulb, Pencil } from 'lucide-react';
import { useDb } from '../../data/hooks';
import { GUESS_TRUTH_LABEL } from '../../domain/playerBook';
import type { Guess, GuessTruth } from '../../domain/schema';
import { IconButton, cx } from '../../ui';
import { setGuessTruth } from './actions';
import type { BookAudience } from './model';
import './spielerbuch.css';

const TRUTH_CHOICES: Exclude<GuessTruth, 'open'>[] = ['true', 'half', 'false'];

export function GuessRow({
  guess,
  audience,
  onEdit,
}: {
  guess: Guess;
  audience: BookAudience;
  onEdit: (guess: Guess) => void;
}) {
  const db = useDb();
  const forGm = audience === 'gm';
  return (
    <div className={cx('wf-spielerbuch-guess', forGm && `wf-spielerbuch-guess--${guess.truth}`)}>
      <Lightbulb className="wf-spielerbuch-guess__icon" aria-hidden />
      <div className="wf-grow">
        <div className="wf-spielerbuch-guess__text">{guess.text}</div>
        {forGm && guess.note.trim() && (
          <div className="wf-spielerbuch-guess__note">{guess.note.trim()}</div>
        )}
      </div>
      {forGm && (
        <>
          <div className="wf-spielerbuch-truth" role="group" aria-label="Stimmt die Vermutung?">
            {TRUTH_CHOICES.map((truth) => (
              <button
                key={truth}
                type="button"
                className="wf-spielerbuch-truth__btn"
                data-truth={truth}
                aria-pressed={guess.truth === truth}
                title={
                  guess.truth === truth
                    ? 'Wieder offen'
                    : `Als „${GUESS_TRUTH_LABEL[truth]}“ abhaken`
                }
                onClick={() => setGuessTruth(db, guess.id, guess.truth === truth ? 'open' : truth)}
              >
                {GUESS_TRUTH_LABEL[truth]}
              </button>
            ))}
          </div>
          <IconButton
            label="Vermutung ändern"
            size="sm"
            variant="ghost"
            onClick={() => onEdit(guess)}
          >
            <Pencil />
          </IconButton>
        </>
      )}
    </div>
  );
}
