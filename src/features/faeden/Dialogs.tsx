/**
 * Einen Faden schreiben – einen losen oder einen einer Geschichte, vom Brett aus. Eine Geschichte
 * selbst schreibt man auf ihrem Blatt (`StoryPage`). Alles hier schreibt der Spielleiter selbst –
 * Wayfarer leitet nur ab, was daraus folgt.
 */
import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useDb } from '../../data/hooks';
import { THREAD_STATE_HINT, THREAD_STATE_LABEL } from '../../domain/story';
import {
  THREAD_STATES,
  newId,
  type Thread,
  type ThreadHint,
  type ThreadState,
} from '../../domain/schema';
import {
  Button,
  Checkbox,
  Dialog,
  EntityPicker,
  EntityRefsEditor,
  Field,
  IconButton,
  Input,
  Select,
  TextArea,
  confirmDialog,
} from '../../ui';
import { removeThread, saveThread, type ThreadInput } from './actions';
import { StorySelect } from './StorySelect';

export function ThreadDialog({
  thread,
  storyId,
  onClose,
  onSaved,
}: {
  thread: Thread | null;
  /** Für einen neuen Faden: die Geschichte, zu der er gehören soll. */
  storyId: string | null;
  onClose: () => void;
  onSaved: (thread: Thread) => void;
}) {
  const db = useDb();
  const [form, setForm] = useState<ThreadInput>(() => ({
    title: thread?.title ?? '',
    truth: thread?.truth ?? '',
    state: thread?.state ?? 'open',
    storyId: thread ? thread.storyId : storyId,
    refs: thread?.refs ?? [],
    known: thread?.known ?? false,
    hints: thread?.hints ?? [],
  }));
  const set = (change: Partial<ThreadInput>) => setForm((before) => ({ ...before, ...change }));
  const setHint = (id: string, change: Partial<ThreadHint>) =>
    set({ hints: form.hints.map((hint) => (hint.id === id ? { ...hint, ...change } : hint)) });
  const remove = async () => {
    if (!thread) return;
    const ok = await confirmDialog({
      title: 'Diesen Faden löschen?',
      body: `„${thread.title}“ verschwindet mit seinen Hinweisen.`,
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    removeThread(db, thread.id);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={thread ? 'Faden ändern' : 'Neuer Faden'}
      width={680}
      footer={
        <>
          {thread && (
            <Button variant="ghost" icon={<Trash2 aria-hidden />} onClick={remove}>
              Löschen
            </Button>
          )}
          <span className="wf-grow" />
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            disabled={!form.title.trim()}
            onClick={() => onSaved(saveThread(db, form, thread?.id))}
          >
            Speichern
          </Button>
        </>
      }
    >
      <div className="wf-col">
        <Field
          label="Die Frage oder die Spur"
          hint="In einem Satz – so, wie die Gruppe sie stellen würde."
        >
          <TextArea
            value={form.title}
            rows={2}
            autoFocus
            placeholder="Was will die Gruppe wissen?"
            onChange={(event) => set({ title: event.target.value })}
          />
        </Field>
        <div className="wf-form-grid">
          <Field label="Zustand" hint={THREAD_STATE_HINT[form.state]}>
            <Select
              value={form.state}
              onChange={(event) => set({ state: event.target.value as ThreadState })}
              aria-label="Zustand"
            >
              {THREAD_STATES.map((state) => (
                <option key={state} value={state}>
                  {THREAD_STATE_LABEL[state]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Gehört zur Geschichte">
            <StorySelect
              thread={form}
              value={form.storyId}
              onChange={(storyId) => set({ storyId })}
            />
          </Field>
        </div>
        <Field label="Woran er hängt" hint="Personen, Orte, Fraktionen.">
          <EntityRefsEditor
            value={form.refs}
            onChange={(refs) => set({ refs })}
            placeholder="Person, Ort, Fraktion … verknüpfen"
            create={{ storyId: form.storyId }}
          />
        </Field>
        <Field label="Was dahintersteckt" hint="Die Antwort – das siehst nur du.">
          <TextArea
            value={form.truth}
            rows={2}
            onChange={(event) => set({ truth: event.target.value })}
          />
        </Field>
        <Field
          label="Hinweise"
          hint="Was die Gruppe finden kann, wo es liegt und wer davon weiß. Ein Haken heißt: Sie hat ihn."
        >
          <div className="wf-faden-rows">
            {form.hints.map((hint) => (
              <div key={hint.id} className="wf-faden-formrow wf-faden-formrow--hint">
                <Checkbox
                  checked={hint.found}
                  onChange={(found) => setHint(hint.id, { found })}
                  aria-label="Die Gruppe hat den Hinweis"
                >
                  {''}
                </Checkbox>
                <Input
                  value={hint.text}
                  placeholder="Was die Gruppe findet oder erfährt"
                  aria-label="Hinweis"
                  onChange={(event) => setHint(hint.id, { text: event.target.value })}
                />
                <EntityPicker
                  value={hint.placeId}
                  onChange={(placeId) => setHint(hint.id, { placeId })}
                  kinds={['place']}
                  placeholder="Wo?"
                  create={{ storyId: form.storyId, onlyKinds: true }}
                />
                <EntityPicker
                  value={hint.sourceId}
                  onChange={(sourceId) => setHint(hint.id, { sourceId })}
                  kinds={['person', 'faction']}
                  placeholder="Wer weiß es?"
                  create={{ storyId: form.storyId }}
                />
                <IconButton
                  size="sm"
                  label="Hinweis entfernen"
                  onClick={() => set({ hints: form.hints.filter((other) => other.id !== hint.id) })}
                >
                  <X aria-hidden />
                </IconButton>
              </div>
            ))}
            <Button
              size="sm"
              icon={<Plus aria-hidden />}
              onClick={() =>
                set({
                  hints: [
                    ...form.hints,
                    { id: newId(), text: '', placeId: null, sourceId: null, found: false },
                  ],
                })
              }
            >
              Hinweis
            </Button>
          </div>
        </Field>
        <Checkbox checked={form.known} onChange={(known) => set({ known })}>
          Die Gruppe kennt diesen Faden
        </Checkbox>
      </div>
    </Dialog>
  );
}
