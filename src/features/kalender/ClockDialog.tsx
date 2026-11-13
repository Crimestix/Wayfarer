/**
 * In die Uhr einer Geschichte eingreifen: anhalten, verzögern, den nächsten Schritt jetzt
 * eintreten lassen oder festhalten, dass die Gruppe ihn verhindert hat – dazu Bedingungen der
 * Schritte. Geschrieben werden die Schritte auf dem Blatt der Geschichte (`faeden/StoryPage`);
 * eine Uhr ohne Geschichte (aus früheren Ständen) lässt sich hier zu einer machen.
 */
import { Fragment, useState } from 'react';
import {
  Ban,
  Check,
  Link2,
  Pause,
  Play,
  Plus,
  ShieldOff,
  Trash2,
  Waypoints,
  X,
} from 'lucide-react';
import { blockClock, delayClock, pauseClock, resumeClock, settleStep } from '../../data/actions';
import { useData, useDb } from '../../data/hooks';
import { clockView } from '../../domain/clock';
import { storyOfClock } from '../../domain/story';
import { createClock, newId, type Clock } from '../../domain/schema';
import { MINUTES_PER_DAY, formatDate } from '../../domain/time/calendar';
import {
  Button,
  Checkbox,
  Dialog,
  EntityPicker,
  Field,
  IconButton,
  Input,
  Select,
  confirmDialog,
  toast,
} from '../../ui';
import './kalender.css';

interface StepDraft {
  id: string;
  text: string;
  days: string;
  /** Bedingung in Worten – leer, wenn der Schritt einfach eintritt. */
  needs: string;
  /** Der Ablauf, an dem die Bedingung hängt. */
  runId: string | null;
}

const blankStep = (): StepDraft => ({ id: newId(), text: '', days: '3', needs: '', runId: null });

const parseDays = (text: string): number | null => {
  const n = Number(text.replace(',', '.'));
  return text.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

export function ClockDialog({
  clock,
  onClose,
  onStory,
}: {
  clock: Clock | null;
  onClose: () => void;
  /** Für eine Uhr ohne Geschichte: macht eine daraus und öffnet ihr Blatt. */
  onStory?: (clockId: string) => void;
}) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  // Die Uhr, wie sie jetzt im Spielstand steht – Eingriffe wirken sofort.
  const live = clock ? (data.clocks[clock.id] ?? clock) : null;
  const view = live ? clockView(live, now) : null;
  const behind = view
    ? view.steps.filter((s) => s.state === 'done' || s.state === 'prevented')
    : [];

  const [title, setTitle] = useState(clock?.title ?? '');
  const [ownerId, setOwnerId] = useState<string | null>(clock?.ownerId ?? null);
  const [placeId, setPlaceId] = useState<string | null>(clock?.placeId ?? null);
  const [secret, setSecret] = useState(clock?.secret ?? true);
  const [steps, setSteps] = useState<StepDraft[]>(() => {
    const open = clock?.steps.filter((step) => step.at === null) ?? [];
    return open.length
      ? open.map((step) => ({
          id: step.id,
          text: step.text,
          days: String(step.days),
          needs: step.needs,
          runId: step.runId,
        }))
      : [blankStep()];
  });
  /** Schritte, bei denen die Zeile für die Bedingung offen ist. */
  const [conditional, setConditional] = useState<ReadonlySet<string>>(
    () => new Set(steps.filter((step) => step.needs || step.runId).map((step) => step.id)),
  );
  const runs = Object.values(data.runs).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const [attempted, setAttempted] = useState(false);

  const filled = steps.filter((step) => step.text.trim());
  const problem = !title.trim()
    ? 'Gib der Uhr einen Namen – worum geht es?'
    : !filled.length && !behind.length
      ? 'Schreib mindestens einen Schritt: Was tritt ein?'
      : filled.some((step) => parseDays(step.days) === null)
        ? 'Trag bei jedem Schritt ein, nach wie vielen Tagen er eintritt.'
        : '';

  const patchStep = (id: string, change: Partial<StepDraft>) =>
    setSteps((list) => list.map((step) => (step.id === id ? { ...step, ...change } : step)));

  const save = () => {
    setAttempted(true);
    if (problem) return;
    const next = filled.map((step) => {
      const before = live?.steps.find((old) => old.id === step.id);
      return {
        id: step.id,
        text: step.text.trim(),
        days: parseDays(step.days)!,
        delay: before?.delay ?? 0,
        at: null,
        skipped: false,
        needs: step.needs.trim(),
        runId: step.runId && data.runs[step.runId] ? step.runId : null,
      };
    });
    const common = { title: title.trim(), ownerId, placeId, secret };
    if (live)
      db.patch('clocks', live.id, {
        ...common,
        steps: [...live.steps.filter((step) => step.at !== null), ...next],
      });
    else db.put('clocks', createClock({ ...common, start: now, steps: next }));
    onClose();
  };

  const remove = async () => {
    if (!live) return;
    const ok = await confirmDialog({
      title: 'Uhr löschen?',
      body: `„${live.title}“ wird entfernt. Was schon eingetreten ist, bleibt in der Chronik stehen.`,
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    if (db.getSnapshot().clocks[live.id]) db.remove('clocks', live.id);
    onClose();
  };

  const settle = (prevented: boolean) => {
    if (!live || !view?.next) return;
    const text = view.next.step.text;
    const undo = settleStep(db, live.id, prevented);
    if (!undo) return;
    // Der Schritt liegt jetzt hinter der Uhr und steht nicht mehr zum Ändern da.
    setSteps((list) => list.filter((step) => step.id !== view.next!.step.id));
    toast({
      title: prevented ? 'Verhindert' : 'Eingetreten',
      body: text,
      action: { label: 'Rückgängig', run: undo },
    });
  };

  // Wann die offenen Schritte nach den Eingaben eintreten würden.
  let anchor = view?.next ? view.next.at - Math.round(view.next.step.days * MINUTES_PER_DAY) : now;
  if (behind.length && !view?.next) anchor = behind[behind.length - 1]!.at;
  const dates = steps.map((step) => {
    const days = parseDays(step.days);
    if (days === null) return null;
    anchor += Math.round(days * MINUTES_PER_DAY);
    return anchor;
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={clock ? 'Uhr ändern' : 'Neue Uhr'}
      width={640}
      footer={
        <>
          {live && (
            <Button variant="danger" icon={<Trash2 />} onClick={() => void remove()}>
              Löschen
            </Button>
          )}
          {live && !storyOfClock(data, live.id) && onStory && (
            <Button
              icon={<Waypoints />}
              title="Die Uhr bekommt eine Geschichte: mit Fragen, Einstiegen und allem, was dazugehört"
              onClick={() => onStory(live.id)}
            >
              Geschichte daraus machen
            </Button>
          )}
          <span className="wf-grow wf-kal-clock__problem" role="status">
            {attempted && problem}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" icon={<Check />} onClick={save}>
            {clock ? 'Speichern' : 'Uhr starten'}
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        {!clock && (
          <p className="wf-soft">
            Eine Uhr ist etwas, das in der Welt weiterläuft, auch wenn die Gruppe nicht hinsieht:
            Wer verfolgt was, und was tritt der Reihe nach ein? Die Schritte schreibst du. Wayfarer
            lässt sie mit der Weltzeit eintreten und meldet es dir.
          </p>
        )}
        <Field label="Worum geht es?">
          <Input
            value={title}
            data-autofocus={!clock || undefined}
            placeholder="z. B. Die Aalfischer übernehmen den Hafen"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <div className="wf-form-grid">
          <Field label="Wer betreibt es?">
            <EntityPicker
              value={ownerId}
              onChange={setOwnerId}
              kinds={['faction', 'person', 'family']}
              placeholder="Fraktion oder Person …"
            />
          </Field>
          <Field label="Wo spielt es sich ab?">
            <EntityPicker
              value={placeId}
              onChange={setPlaceId}
              kinds={['place']}
              placeholder="Ort …"
            />
          </Field>
        </div>
        <Checkbox checked={secret} onChange={setSecret}>
          Die Spieler wissen nichts davon – eingetretene Schritte stehen nur für dich in der Chronik
        </Checkbox>

        {behind.length > 0 && (
          <div>
            <div className="wf-kal-clock__label">Schon geschehen</div>
            {behind.map((s) => (
              <div key={s.step.id} className="wf-kal-clock__past" data-state={s.state}>
                <span>{s.state === 'prevented' ? 'Verhindert' : 'Eingetreten'}</span>
                <span className="wf-grow">{s.step.text}</span>
                <span className="wf-mute">{formatDate(cal, s.at)}</span>
              </div>
            ))}
          </div>
        )}

        <div>
          <div className="wf-kal-clock__label">
            {behind.length ? 'Was noch kommt' : 'Die Schritte, der Reihe nach'}
          </div>
          {steps.map((step, index) => (
            <Fragment key={step.id}>
              <div className="wf-kal-clock__step">
                <Input
                  value={step.text}
                  aria-label={`Schritt ${index + 1}: Was tritt ein?`}
                  placeholder={
                    index === 0
                      ? 'Was tritt als Nächstes ein?'
                      : 'Und danach? (leer lassen = entfällt)'
                  }
                  onChange={(event) => patchStep(step.id, { text: event.target.value })}
                />
                <span className="wf-mute">nach</span>
                <Input
                  className="wf-kal-clock__days"
                  inputMode="decimal"
                  value={step.days}
                  aria-label={`Schritt ${index + 1}: nach wie vielen Tagen`}
                  onChange={(event) => patchStep(step.id, { days: event.target.value })}
                />
                <span className="wf-mute">
                  {parseDays(step.days) === 1 ? 'Tag' : 'Tagen'}
                  {dates[index] !== null && !view?.paused && ` · ${formatDate(cal, dates[index]!)}`}
                </span>
                <IconButton
                  label={`Schritt ${index + 1}: Bedingung – tritt nur ein, wenn …`}
                  size="sm"
                  variant="ghost"
                  aria-pressed={conditional.has(step.id)}
                  onClick={() =>
                    setConditional((before) => {
                      const next = new Set(before);
                      if (next.has(step.id)) {
                        next.delete(step.id);
                        patchStep(step.id, { needs: '', runId: null });
                      } else next.add(step.id);
                      return next;
                    })
                  }
                >
                  <Link2 />
                </IconButton>
                <IconButton
                  label={`Schritt ${index + 1} entfernen`}
                  size="sm"
                  variant="ghost"
                  onClick={() => setSteps((list) => list.filter((entry) => entry.id !== step.id))}
                >
                  <X />
                </IconButton>
              </div>
              {conditional.has(step.id) && (
                <div className="wf-kal-clock__step wf-kal-clock__needs">
                  <span className="wf-mute">nur wenn</span>
                  <Input
                    value={step.needs}
                    aria-label={`Schritt ${index + 1}: Bedingung`}
                    placeholder="etwa „Die letzte Lieferung trifft im Lager ein“"
                    onChange={(event) => patchStep(step.id, { needs: event.target.value })}
                  />
                  {runs.length > 0 && (
                    <Select
                      value={step.runId ?? ''}
                      aria-label={`Schritt ${index + 1}: hängt an einem Ablauf`}
                      title="Bleibt dieser Ablauf aus, steht die Uhr: blockiert"
                      onChange={(event) =>
                        patchStep(step.id, { runId: event.target.value || null })
                      }
                    >
                      <option value="">hängt an keinem Ablauf</option>
                      {runs.map((run) => (
                        <option key={run.id} value={run.id}>
                          hängt an: {run.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              )}
            </Fragment>
          ))}
          <Button
            size="sm"
            icon={<Plus />}
            onClick={() => setSteps((list) => [...list, blankStep()])}
          >
            Schritt hinzufügen
          </Button>
        </div>

        {live && view?.next && (
          <div className="wf-kal-clock__now">
            <div className="wf-kal-clock__label">Eingreifen</div>
            <p className="wf-soft">
              {view.blocked
                ? `Die Uhr ist blockiert – ${view.blocked}. Sie plant nicht von selbst um: Wie es weitergeht, entscheidest du.`
                : view.paused
                  ? 'Die Uhr ist angehalten – solange tritt nichts ein.'
                  : `Als Nächstes, am ${formatDate(cal, view.next.at)}: ${view.next.step.text}`}
            </p>
            <div className="wf-kal-clock__acts">
              {view.paused ? (
                <Button size="sm" icon={<Play />} onClick={() => resumeClock(db, live.id)}>
                  {view.blocked ? 'Trotzdem weiterlaufen lassen' : 'Weiterlaufen lassen'}
                </Button>
              ) : (
                <Button size="sm" icon={<Pause />} onClick={() => pauseClock(db, live.id)}>
                  Anhalten
                </Button>
              )}
              {!view.paused && view.next.step.needs && (
                <Button
                  size="sm"
                  icon={<Ban />}
                  title="Die Bedingung des nächsten Schrittes gilt nicht mehr: Die Uhr bleibt stehen"
                  onClick={() =>
                    blockClock(db, live.id, `${view.next!.step.needs} – gilt nicht mehr`)
                  }
                >
                  Bedingung ist weggefallen
                </Button>
              )}
              <Button size="sm" onClick={() => delayClock(db, live.id, MINUTES_PER_DAY)}>
                Einen Tag später
              </Button>
              <Button size="sm" onClick={() => delayClock(db, live.id, 7 * MINUTES_PER_DAY)}>
                Eine Woche später
              </Button>
              <Button size="sm" icon={<Check />} onClick={() => settle(false)}>
                Jetzt eintreten lassen
              </Button>
              <Button size="sm" icon={<ShieldOff />} onClick={() => settle(true)}>
                Die Gruppe hat es verhindert
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
