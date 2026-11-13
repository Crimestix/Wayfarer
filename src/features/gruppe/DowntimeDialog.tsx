/**
 * Freie Zeit: wie viele Tage, und je Gefährte, was er tut – ein Vorhaben fortsetzen, bei einem
 * anderen helfen oder ein neues beginnen. Zeigt vorab, wie weit die Vorhaben kommen und was in
 * der Chronik stehen wird. Gerechnet wird in `domain/downtime.ts`, geschrieben in `downtime.ts`.
 */
import { useMemo, useState } from 'react';
import { Hourglass } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { craftableItems, recipeTool } from '../../domain/crafting';
import { activeParty, entityName } from '../../domain/derive';
import {
  DOWNTIME_HINT,
  NO_CHOICE,
  downtimeInput,
  downtimeOptions,
  keepByDefault,
  newProjectKey,
  newProjectOf,
  planDowntime,
  progressLine,
  type DowntimeChoice,
} from '../../domain/downtime';
import type { DowntimeActivity } from '../../domain/schema';
import { MINUTES_PER_DAY, formatDate } from '../../domain/time/calendar';
import { Button, Checkbox, Dialog, Field, Input, Select } from '../../ui';
import { spendDowntime, type DowntimeResult } from './downtime';

const GROUPS = [
  { id: 'continue', label: 'Fortsetzen' },
  { id: 'help', label: 'Mithelfen' },
  { id: 'new', label: 'Neues Vorhaben' },
] as const;

export function DowntimeDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (result: DowntimeResult) => void;
}) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const party = useMemo(() => activeParty(data), [data]);
  const craftable = useMemo(() => craftableItems(data), [data]);
  const [daysText, setDaysText] = useState('5');
  const [choices, setChoices] = useState<Record<string, DowntimeChoice>>({});
  const [keep, setKeep] = useState<Record<string, boolean>>({});

  const days = Math.max(0, Math.min(3650, Math.floor(Number(daysText) || 0)));
  const choiceOf = (id: string) => choices[id] ?? NO_CHOICE;
  const change = (id: string, next: Partial<DowntimeChoice>) =>
    setChoices((current) => ({ ...current, [id]: { ...(current[id] ?? NO_CHOICE), ...next } }));
  const input = downtimeInput(data, days, choices, keep);
  const plan = planDowntime(data, input);
  const end = data.state.now + days * MINUTES_PER_DAY;

  const spend = () => {
    const result = spendDowntime(db, input);
    onClose();
    if (result) onDone(result);
  };

  const place = entityName(data, data.state.placeId);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Freie Zeit"
      width={720}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            icon={<Hourglass />}
            disabled={days < 1}
            onClick={spend}
            data-autofocus
          >
            {days === 1 ? 'Einen Tag freie Zeit verbringen' : `${days} Tage freie Zeit verbringen`}
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <div className="wf-gruppe-downtime__days">
          <Field label="Tage">
            <Input
              type="number"
              min={1}
              max={3650}
              value={daysText}
              onChange={(e) => setDaysText(e.target.value)}
            />
          </Field>
          <p className="wf-soft">
            {place ? `${place} · ` : ''}
            {days >= 1
              ? `bis ${formatDate(cal, end)}. Die Weltzeit vergeht um diese Tage; Termine und Uhren treten dabei ein wie sonst auch.`
              : 'Mindestens ein ganzer Tag.'}
          </p>
        </div>

        {party.length ? (
          <div className="wf-gruppe-downtime__list">
            {party.map((character) => {
              const choice = choiceOf(character.id);
              const options = downtimeOptions(data, character.id, choices);
              const activity = choice.value.startsWith('n:')
                ? (choice.value.slice(2) as DowntimeActivity)
                : null;
              const project = newProjectOf(data, character.id, choice);
              const item = project?.itemId ? data.entities[project.itemId] : undefined;
              const continued = choice.value.startsWith('t:')
                ? data.tracks[choice.value.slice(2)]
                : undefined;
              const craftItemId =
                item?.id ??
                (continued?.downtime?.activity === 'craft' ? continued.downtime.itemId : null);
              const craftItem = craftItemId ? data.entities[craftItemId] : undefined;
              const keepKey = continued ? continued.id : newProjectKey(character.id);
              const owns = continued ? continued.ownerId === character.id : true;
              return (
                <div key={character.id} className="wf-gruppe-downtime__row">
                  <span className="wf-gruppe-downtime__name">{character.name}</span>
                  <div className="wf-gruppe-downtime__what">
                    <Select
                      value={choice.value}
                      aria-label={`Was tut ${character.name}?`}
                      onChange={(e) => change(character.id, { value: e.target.value })}
                    >
                      <option value="">Nichts Besonderes</option>
                      {GROUPS.map((group) => {
                        const list = options.filter((o) => o.group === group.id);
                        return list.length ? (
                          <optgroup key={group.id} label={group.label}>
                            {list.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </optgroup>
                        ) : null;
                      })}
                    </Select>
                    {activity === 'craft' &&
                      (craftable.length ? (
                        <div className="wf-gruppe-downtime__more">
                          <Select
                            value={choice.itemId ?? ''}
                            aria-label="Was wird hergestellt?"
                            onChange={(e) =>
                              change(character.id, { itemId: e.target.value || null, target: '' })
                            }
                          >
                            <option value="">Was wird hergestellt?</option>
                            {craftable.map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.name}
                              </option>
                            ))}
                          </Select>
                          <Input
                            value={choice.target}
                            aria-label="Arbeitstage"
                            placeholder={
                              project?.target ? `${project.target} Arbeitstage` : 'Arbeitstage'
                            }
                            onChange={(e) => change(character.id, { target: e.target.value })}
                          />
                        </div>
                      ) : (
                        <p className="wf-mute">
                          Noch kein Gegenstand mit Rezept. Lege es auf der Seite des Gegenstands
                          unter „Herstellung“ an.
                        </p>
                      ))}
                    {activity && activity !== 'craft' && (
                      <div className="wf-gruppe-downtime__more">
                        <Input
                          value={choice.subject}
                          aria-label="Was wird getan?"
                          placeholder={DOWNTIME_HINT[activity]}
                          onChange={(e) => change(character.id, { subject: e.target.value })}
                        />
                        <Input
                          value={choice.target}
                          aria-label="Ziel in Tagen"
                          placeholder="Ziel in Tagen (leer: ohne)"
                          onChange={(e) => change(character.id, { target: e.target.value })}
                        />
                      </div>
                    )}
                    {craftItem?.kind === 'item' && craftItem.item.recipe && (
                      <p className="wf-gruppe-downtime__hint">
                        {[
                          recipeTool(data, craftItem.item.recipe) &&
                            `Werkzeug: ${recipeTool(data, craftItem.item.recipe)}`,
                          'wer mithilft, braucht es auch und teilt sich die Arbeitstage',
                        ]
                          .filter(Boolean)
                          .join(' – ')}
                      </p>
                    )}
                    {craftItem?.kind === 'item' && owns && (
                      <Checkbox
                        checked={keep[keepKey] ?? keepByDefault(data, craftItem.id, character.id)}
                        onChange={(on) => setKeep((current) => ({ ...current, [keepKey]: on }))}
                      >
                        Wenn fertig, gehört {craftItem.name} {character.name}
                      </Checkbox>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="wf-mute">Kein aktiver Gefährte. Lege unter „Gefährten“ jemanden an.</p>
        )}

        {days >= 1 && (
          <div>
            <div className="wf-gruppe-rest__label">Danach</div>
            {plan.progress.length ? (
              <ul className="wf-gruppe-restlist">
                {plan.progress.map((p) => (
                  <li key={p.key}>
                    <b>{progressLine(p)}</b>
                    <span className="wf-num">
                      {p.finished && p.doneAfter !== null
                        ? p.doneAfter === 0
                          ? 'schon fertig'
                          : `fertig nach ${p.doneAfter === 1 ? 'einem Tag' : `${p.doneAfter} Tagen`}`
                        : p.target > 0
                          ? `noch ${p.target - p.after} Arbeitstage`
                          : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="wf-mute">
                Niemand verfolgt ein Vorhaben; es vergeht nur die Zeit, und die freie Zeit steht in
                der Chronik.
              </p>
            )}
            <div className="wf-gruppe-downtime__entry">
              In der Chronik: Zwischenzeit, {days === 1 ? 'ein Tag' : `${days} Tage`}
              {plan.activities.length > 0 && (
                <ul>
                  {plan.activities.map((activity) => (
                    <li key={activity.characterId}>
                      {entityName(data, activity.characterId)}: {activity.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
