/**
 * „Wenn niemand eingreift“ auf dem Blatt einer Geschichte: die Schritte ihrer Uhr – je Schritt,
 * was eintritt, nach wie vielen Tagen und woran die Gruppe es merkt – und der Schalter, ob die
 * Uhr läuft. Eine neue Uhr steht noch; nichts tritt ein, bis der Spielleiter sie laufen lässt.
 * „Eingreifen“ (verzögern, verhindern, Bedingungen) bleibt der Dialog der Uhr.
 */
import { useState } from 'react';
import { Hourglass, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { clockView } from '../../domain/clock';
import { newId, type Story } from '../../domain/schema';
import { untilText } from '../../domain/story';
import { clockStand } from '../../domain/storySheet';
import { formatDayMonth } from '../../domain/time/calendar';
import { Button, IconButton, Input, NewLine, SheetSection, Written, useDraftList } from '../../ui';
import { ClockDialog } from '../kalender/ClockDialog';
import { runStoryClock, setStorySteps, type StepInput } from './actions';
import { useStoryMention } from './storyMention';

interface StepDraft {
  id: string;
  text: string;
  days: string;
  sign: string;
}

/** So viele Tage nach dem vorigen steht ein neuer Schritt – der Spielleiter ändert es. */
const DAYS_DEFAULT = '3';

const daysOf = (text: string): number => {
  const days = Number(text.replace(',', '.'));
  return Number.isFinite(days) && days > 0 ? days : 0;
};

export function StorySteps({ story }: { story: Story }) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const mention = useStoryMention(story);
  const clock = story.clockId ? data.clocks[story.clockId] : undefined;
  const view = clock ? clockView(clock, now) : null;
  const stand = clockStand(data, story);
  const running = stand.pace === 'running';
  const behind = view?.steps.filter((s) => s.state === 'done' || s.state === 'prevented') ?? [];
  const [dialog, setDialog] = useState(false);
  const source: StepDraft[] = (clock?.steps ?? [])
    .filter((step) => step.at === null)
    .map((step) => ({
      id: step.id,
      text: step.text,
      days: String(step.days),
      sign: step.sign,
    }));
  const save = (items: readonly StepDraft[]) =>
    setStorySteps(
      db,
      story.id,
      items.map((item): StepInput => ({
        id: item.id,
        text: item.text,
        days: daysOf(item.days),
        sign: item.sign,
      })),
    );
  const list = useDraftList<StepDraft>(source, save, (item) => !item.text.trim());
  const dueAt = (id: string) => view?.steps.find((step) => step.step.id === id)?.at;

  return (
    <SheetSection
      id="clock"
      title="Wenn niemand eingreift"
      hint="Was geschieht Schritt für Schritt, wenn die Gruppe nichts tut? Genau sein muss nur der nächste Schritt."
      action={
        clock && (
          <Button
            size="sm"
            icon={<Hourglass />}
            onClick={() => setDialog(true)}
            title="Verzögern, einen Schritt jetzt eintreten lassen oder verhindern, Bedingungen setzen"
          >
            Eingreifen
          </Button>
        )
      }
    >
      {stand.pace !== 'none' && (
        <div className="wf-faden-uhr">
          {stand.pace !== 'done' && (
            <div className="wf-faden-uhr__switch" role="group" aria-label="Die Uhr">
              <button
                type="button"
                aria-pressed={!running}
                onClick={() => runStoryClock(db, story.id, false)}
              >
                {stand.fresh ? 'Die Uhr steht noch' : 'Die Uhr steht'}
              </button>
              <button
                type="button"
                aria-pressed={running}
                onClick={() => runStoryClock(db, story.id, true)}
              >
                Die Uhr läuft
              </button>
            </div>
          )}
          <span className="wf-faden-uhr__line">
            {stand.line}
            {running && view?.next
              ? ` Nächster Schritt ${untilText(view.next.at - now)} – am ${formatDayMonth(cal, view.next.at)}.`
              : ''}
          </span>
        </div>
      )}
      <ol className="wf-sheet-list">
        {behind.map((step) => (
          <li key={step.step.id} className="wf-sheet-list__row wf-sheet-list__row--done">
            <span className="wf-sheet-list__mark">{step.state === 'prevented' ? '×' : '✓'}</span>
            <span>{step.step.text}</span>
            <em>
              {step.state === 'prevented' ? 'verhindert' : `am ${formatDayMonth(cal, step.at)}`}
            </em>
          </li>
        ))}
        {list.items.map((step, index) => {
          const number = behind.length + index + 1;
          const due = running ? dueAt(step.id) : undefined;
          return (
            <li key={step.id} className="wf-faden-step" data-next={index === 0}>
              <span className="wf-sheet-list__mark">{number}.</span>
              <Written
                label={`Schritt ${number}`}
                wrap
                value={step.text}
                placeholder="Was tritt ein?"
                mention={mention}
                onSave={(text) => list.set(step.id, { text })}
              />
              <span className="wf-sheet-list__unit">nach</span>
              <Input
                className="wf-sheet-list__days"
                value={step.days}
                inputMode="decimal"
                aria-label="Tage nach dem vorigen Schritt"
                aria-invalid={daysOf(step.days) === 0}
                onChange={(event) => list.edit(step.id, { days: event.target.value })}
                onBlur={list.flush}
              />
              <span className="wf-sheet-list__unit">Tagen</span>
              <IconButton
                label="Schritt entfernen"
                size="sm"
                variant="ghost"
                onClick={() => list.remove(step.id)}
              >
                <X />
              </IconButton>
              <div className="wf-faden-step__sign">
                <Written
                  label={`Woran die Gruppe Schritt ${number} merkt`}
                  wrap
                  value={step.sign}
                  placeholder="Woran merkt die Gruppe das?"
                  mention={mention}
                  onSave={(sign) => list.set(step.id, { sign })}
                />
                {due !== undefined && (
                  <em className="wf-faden-step__when">am {formatDayMonth(cal, due)}</em>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <NewLine
        label="Neuer Schritt"
        placeholder={
          list.items.length || behind.length ? 'Und danach?' : 'Was tritt als Nächstes ein?'
        }
        mention={mention}
        onAdd={(text) => save([...source, { id: newId(), text, days: DAYS_DEFAULT, sign: '' }])}
      />
      {dialog && clock && (
        <ClockDialog key={clock.id} clock={clock} onClose={() => setDialog(false)} />
      )}
    </SheetSection>
  );
}
