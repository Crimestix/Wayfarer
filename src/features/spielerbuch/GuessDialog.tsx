/**
 * Eine Vermutung der Spieler festhalten oder ändern: was sie glauben und worum es geht. Ob sie
 * stimmt, setzt nur die Spielleitung – beim Ändern oder im Spielerbuch.
 */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { GUESS_TRUTH_LABEL } from '../../domain/playerBook';
import { GUESS_TRUTHS, type Guess, type GuessTruth } from '../../domain/schema';
import { formatDateTime } from '../../domain/time/calendar';
import { Button, Dialog, EntityRefsEditor, Field, Input, Select, TextArea, toast } from '../../ui';
import { removeGuess, saveGuess, setGuessTruth } from './actions';

export function GuessDialog({
  guess,
  preset,
  onClose,
}: {
  /** Die Vermutung, die geändert wird; sonst eine neue. */
  guess?: Guess;
  /** Was eine neue Vermutung schon mitbringt – aus „Festhalten“ oder von einer Seite. */
  preset?: { text?: string; refs?: string[]; at?: number };
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const [text, setText] = useState(guess?.text ?? preset?.text ?? '');
  const [refs, setRefs] = useState<string[]>(guess?.refs ?? preset?.refs ?? []);
  const [truth, setTruth] = useState<GuessTruth>(guess?.truth ?? 'open');
  const [note, setNote] = useState(guess?.note ?? '');

  const save = () => {
    if (guess) {
      if (saveGuess(db, { text, refs, note }, guess.id)) setGuessTruth(db, guess.id, truth);
      else toast({ title: 'Nicht gespeichert', body: 'Die Vermutung gibt es nicht mehr.' });
      onClose();
      return;
    }
    const made = saveGuess(db, { text, refs, note, at: preset?.at });
    onClose();
    if (made)
      toast({
        title: 'Vermutung festgehalten',
        body: made.text,
        action: { label: 'Rückgängig', run: () => void removeGuess(db, made.id) },
      });
  };
  const remove = () => {
    if (!guess) return;
    const undo = removeGuess(db, guess.id);
    onClose();
    if (undo)
      toast({
        title: 'Vermutung gelöscht',
        body: guess.text,
        action: { label: 'Rückgängig', run: undo },
      });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={guess ? 'Vermutung ändern' : 'Vermutung festhalten'}
      width={560}
      footer={
        <>
          {guess && (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={remove}
              style={{ marginRight: 'auto' }}
            >
              Löschen
            </Button>
          )}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={save}>
            {guess ? 'Speichern' : 'Festhalten'}
          </Button>
        </>
      }
    >
      <div className="wf-col">
        <Field
          label="Was die Gruppe vermutet"
          hint="In ihren Worten. Für die Spieler bleibt jede Vermutung offen."
        >
          <TextArea
            rows={3}
            value={text}
            autoFocus
            placeholder="Der Fährmann arbeitet für die Gegenseite."
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) {
                e.preventDefault();
                save();
              }
            }}
          />
        </Field>
        <Field label="Betrifft">
          <EntityRefsEditor
            value={refs}
            onChange={setRefs}
            placeholder="Person, Ort, Fraktion … verknüpfen"
          />
        </Field>
        {guess ? (
          <div className="wf-form-grid">
            <Field label="Stimmt sie?" hint="Nur für dich.">
              <Select value={truth} onChange={(e) => setTruth(e.target.value as GuessTruth)}>
                {GUESS_TRUTHS.map((value) => (
                  <option key={value} value={value}>
                    {GUESS_TRUTH_LABEL[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Bemerkung" hint="Nur für dich.">
              <Input
                value={note}
                placeholder="Was wirklich dahintersteckt"
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
        ) : (
          <div className="wf-field__hint">
            {preset?.at !== undefined && preset.at < data.state.now
              ? `Früher – ${formatDateTime(cal, preset.at)}`
              : `Jetzt – ${formatDateTime(cal, data.state.now)}`}
          </div>
        )}
      </div>
    </Dialog>
  );
}
