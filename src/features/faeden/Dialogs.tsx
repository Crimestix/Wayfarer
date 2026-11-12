/**
 * Geschichte und Faden schreiben. Alles hier schreibt der Spielleiter selbst – Wayfarer leitet nur
 * ab, was daraus folgt.
 */
import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { ENTRY_STANDING_LABEL, THREAD_STATE_HINT, THREAD_STATE_LABEL } from '../../domain/story';
import {
  ENTRY_STANDINGS,
  THREAD_STATES,
  type EntryStanding,
  createEntity,
  newId,
  type Story,
  type StoryEntry,
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
import {
  removeStory,
  removeThread,
  saveStory,
  saveThread,
  type StoryInput,
  type ThreadInput,
} from './actions';

export function StoryDialog({
  story,
  onClose,
  onSaved,
}: {
  story: Story | null;
  onClose: () => void;
  onSaved: (story: Story) => void;
}) {
  const db = useDb();
  const data = useData();
  const [form, setForm] = useState<StoryInput>(() => ({
    title: story?.title ?? '',
    summary: story?.summary ?? '',
    ownerId: story?.ownerId ?? null,
    clockId: story?.clockId ?? null,
    refs: story?.refs ?? [],
    entries: story?.entries ?? [],
    known: story?.known ?? false,
    closed: story?.closed ?? false,
  }));
  const set = (change: Partial<StoryInput>) => setForm((before) => ({ ...before, ...change }));
  const setEntry = (id: string, change: Partial<StoryEntry>) =>
    set({
      entries: form.entries.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)),
    });
  const clocks = Object.values(data.clocks).sort((a, b) => a.title.localeCompare(b.title, 'de'));
  const place = (name: string) => db.put('entities', createEntity({ kind: 'place', name })).id;
  const remove = async () => {
    if (!story) return;
    const ok = await confirmDialog({
      title: `„${story.title}“ löschen?`,
      body: 'Die Fäden der Geschichte bleiben als lose Fäden auf dem Brett.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    removeStory(db, story.id);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={story ? 'Geschichte ändern' : 'Neue Geschichte'}
      width={640}
      footer={
        <>
          {story && (
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
            onClick={() => onSaved(saveStory(db, form, story?.id))}
          >
            Speichern
          </Button>
        </>
      }
    >
      <div className="wf-col">
        <Field label="Name">
          <Input
            value={form.title}
            autoFocus
            placeholder="etwa „Die Aalfischer wollen den Hafen“"
            onChange={(event) => set({ title: event.target.value })}
          />
        </Field>
        <Field label="Worum es geht" hint="Ein Vorhaben, kein Plot: wer will was?">
          <TextArea
            value={form.summary}
            rows={3}
            onChange={(event) => set({ summary: event.target.value })}
          />
        </Field>
        <div className="wf-form-grid">
          <Field label="Wer sie antreibt">
            <EntityPicker
              value={form.ownerId}
              onChange={(ownerId) => set({ ownerId })}
              kinds={['person', 'faction', 'family']}
              placeholder="Person oder Fraktion …"
            />
          </Field>
          <Field
            label="Wenn niemand eingreift"
            hint={
              clocks.length
                ? 'Die Uhr läuft weiter, auch wenn die Gruppe woanders ist.'
                : 'Uhren legst du im Kalender an.'
            }
          >
            <Select
              value={form.clockId ?? ''}
              onChange={(event) => set({ clockId: event.target.value || null })}
              aria-label="Uhr"
            >
              <option value="">Keine Uhr</option>
              {clocks.map((clock) => (
                <option key={clock.id} value={clock.id}>
                  {clock.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Wer und was dazugehört"
          hint="Personen, Orte, Fraktionen. Daran erkennt Wayfarer, wie nah die Gruppe dran ist und wo Geschichten sich berühren."
        >
          <EntityRefsEditor
            value={form.refs}
            onChange={(refs) => set({ refs })}
            placeholder="Person, Ort, Fraktion … verknüpfen"
          />
        </Field>
        <Field
          label="Einstiege"
          hint="Wo und wie die Gruppe darauf stoßen kann – auf Wunsch nur bei gutem oder schlechtem Ruf beim Antreiber."
        >
          <div className="wf-faden-rows">
            {form.entries.map((entry) => (
              <div key={entry.id} className="wf-faden-formrow wf-faden-formrow--entry">
                <Input
                  value={entry.text}
                  placeholder="etwa „Ein Fischer bittet um Hilfe“"
                  aria-label="Einstieg"
                  onChange={(event) => setEntry(entry.id, { text: event.target.value })}
                />
                <EntityPicker
                  value={entry.placeId}
                  onChange={(placeId) => setEntry(entry.id, { placeId })}
                  kinds={['place']}
                  placeholder="Wo?"
                  onCreate={place}
                />
                <Select
                  value={entry.standing}
                  aria-label="Wann der Einstieg passt"
                  title="Der Ruf beim Antreiber entscheidet, wie die Gruppe hineinkommt"
                  onChange={(event) =>
                    setEntry(entry.id, { standing: event.target.value as EntryStanding })
                  }
                >
                  {ENTRY_STANDINGS.map((standing) => (
                    <option key={standing} value={standing}>
                      {ENTRY_STANDING_LABEL[standing]}
                    </option>
                  ))}
                </Select>
                <IconButton
                  size="sm"
                  label="Einstieg entfernen"
                  onClick={() =>
                    set({ entries: form.entries.filter((other) => other.id !== entry.id) })
                  }
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
                  entries: [
                    ...form.entries,
                    { id: newId(), text: '', placeId: null, standing: 'any' },
                  ],
                })
              }
            >
              Einstieg
            </Button>
          </div>
        </Field>
        <Checkbox checked={form.known} onChange={(known) => set({ known })}>
          Die Gruppe weiß von dieser Geschichte
        </Checkbox>
        {story && (
          <Checkbox checked={form.closed} onChange={(closed) => set({ closed })}>
            Zu Ende erzählt
          </Checkbox>
        )}
      </div>
    </Dialog>
  );
}

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
  const data = useData();
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
  const stories = Object.values(data.stories).sort((a, b) => a.title.localeCompare(b.title, 'de'));
  const place = (name: string) => db.put('entities', createEntity({ kind: 'place', name })).id;
  const remove = async () => {
    if (!thread) return;
    const ok = await confirmDialog({
      title: 'Diesen Faden löschen?',
      body: `„${thread.title}“ verschwindet mit seinen Hinweisen vom Brett.`,
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
            placeholder="etwa „Wer läutet nachts die Glocke am Markt?“"
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
            <Select
              value={form.storyId ?? ''}
              onChange={(event) => set({ storyId: event.target.value || null })}
              aria-label="Geschichte"
            >
              <option value="">Loser Faden</option>
              {stories.map((story) => (
                <option key={story.id} value={story.id}>
                  {story.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Woran er hängt" hint="Personen, Orte, Fraktionen.">
          <EntityRefsEditor
            value={form.refs}
            onChange={(refs) => set({ refs })}
            placeholder="Person, Ort, Fraktion … verknüpfen"
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
                  placeholder="etwa „Wachs an der Glockenschnur“"
                  aria-label="Hinweis"
                  onChange={(event) => setHint(hint.id, { text: event.target.value })}
                />
                <EntityPicker
                  value={hint.placeId}
                  onChange={(placeId) => setHint(hint.id, { placeId })}
                  kinds={['place']}
                  placeholder="Wo?"
                  onCreate={place}
                />
                <EntityPicker
                  value={hint.sourceId}
                  onChange={(sourceId) => setHint(hint.id, { sourceId })}
                  kinds={['person', 'faction']}
                  placeholder="Wer weiß es?"
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
