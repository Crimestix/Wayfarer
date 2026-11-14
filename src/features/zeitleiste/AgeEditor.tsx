/**
 * Zeitalter festlegen: Name, Beginn und Ende (leer = bis heute), in Worten wie bei den
 * Lebensdaten – „412“, „Tauwind 412“, „vor 300 Jahren“. Sie liegen als breite Bänder über allen
 * Bahnen der Zeitleiste. Die Rechnung steht in `domain/ages.ts`, die Befehle in `actions.ts`.
 */
import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { agesSorted } from '../../domain/ages';
import { datePointText, formatDatePoint } from '../../domain/lifespan';
import { Button, Field, IconButton, Input } from '../../ui';
import { removeAge, saveAge } from './actions';

const BLANK = { name: '', from: '', to: '' };

export function AgeEditor({
  editing,
  onEdit,
  onClose,
}: {
  /** Das Zeitalter, das geändert wird; null = ein neues. */
  editing: string | null;
  onEdit: (id: string | null) => void;
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const spans = agesSorted(data);
  const [form, setForm] = useState(BLANK);
  const [problem, setProblem] = useState('');

  // Beim Wechsel des Zeitalters stehen seine Angaben in den Feldern.
  useEffect(() => {
    const age = editing ? data.campaign.ages.find((a) => a.id === editing) : undefined;
    setForm(
      age
        ? { name: age.name, from: datePointText(cal, age.from), to: datePointText(cal, age.to) }
        : BLANK,
    );
    setProblem('');
    // Nur beim Wechsel – nicht bei jeder Änderung am Spielstand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const save = () => {
    const result = saveAge(db, form, editing ?? undefined);
    if ('problem' in result) {
      setProblem(result.problem);
      return;
    }
    setProblem('');
    if (editing) onClose();
    else setForm(BLANK);
  };

  return (
    <div className="wf-zeitleiste-ages">
      <span className="wf-zeitleiste-chooser__title">Zeitalter der Welt</span>
      {spans.length === 0 && (
        <p className="wf-zeitleiste-ages__empty">
          Noch keine. Ein Zeitalter liegt als breites Band über allen Bahnen – etwa „Das Zeitalter
          der Asche“ von 412 bis 650.
        </p>
      )}
      {spans.length > 0 && (
        <ul className="wf-zeitleiste-ages__list">
          {spans.map((span) => (
            <li
              key={span.age.id}
              className="wf-zeitleiste-ages__item"
              data-active={span.age.id === editing || undefined}
            >
              <span className="wf-zeitleiste-ages__swatch" data-shade={span.shade} aria-hidden />
              <span className="wf-zeitleiste-ages__text">
                <span className="wf-zeitleiste-ages__name wf-clamp-1">{span.age.name}</span>
                <span className="wf-zeitleiste-ages__when">
                  {formatDatePoint(cal, span.age.from)} –{' '}
                  {span.age.to ? formatDatePoint(cal, span.age.to) : 'heute'}
                </span>
              </span>
              <IconButton label="Ändern" size="sm" onClick={() => onEdit(span.age.id)}>
                <Pencil />
              </IconButton>
              <IconButton
                label="Zeitalter entfernen"
                size="sm"
                onClick={() => {
                  removeAge(db, span.age.id);
                  if (editing === span.age.id) onEdit(null);
                }}
              >
                <Trash2 />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="wf-zeitleiste-ages__form"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Field label={editing ? 'Name des Zeitalters' : 'Neues Zeitalter'}>
          <Input
            value={form.name}
            placeholder="Das Zeitalter der Asche"
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <div className="wf-zeitleiste-ages__dates">
          <Field label="Von">
            <Input
              value={form.from}
              placeholder="412"
              onChange={(event) => setForm({ ...form, from: event.target.value })}
            />
          </Field>
          <Field label="Bis" hint="Leer: bis heute">
            <Input
              value={form.to}
              placeholder="650"
              onChange={(event) => setForm({ ...form, to: event.target.value })}
            />
          </Field>
        </div>
        {problem && <p className="wf-zeitleiste-ages__problem">{problem}</p>}
        <div className="wf-zeitleiste-ages__actions">
          {editing && (
            <Button size="sm" onClick={() => onEdit(null)}>
              Abbrechen
            </Button>
          )}
          <Button size="sm" type="submit">
            {editing ? 'Übernehmen' : 'Hinzufügen'}
          </Button>
        </div>
      </form>
    </div>
  );
}
