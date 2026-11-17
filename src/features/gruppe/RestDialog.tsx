/**
 * Rast: Kurze oder Lange Rast für die Gruppe, mit Wachplan. Zeigt vorab, was sich ändert, und
 * lässt die Rast auch gestört enden – dann steht da, wer gerade wacht.
 */
import { useMemo, useState } from 'react';
import { Moon, Tent } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entitiesOfKind, entityName } from '../../domain/derive';
import {
  LONG_REST_MINUTES,
  SHORT_REST_MINUTES,
  WATCH_MINUTES,
  changesSomething,
  longRestEffects,
  minutesUntilLongRest,
  proposeWatches,
  remainingMinutes,
  restingParty,
  resumableRest,
  watchAt,
  watchMinutes,
  watchViews,
  type Watch,
} from '../../domain/rest';
import { newId, type Rest } from '../../domain/schema';
import { formatClock, formatDate, formatDuration, weekdayName } from '../../domain/time/calendar';
import { Button, Checkbox, Dialog, Field, Input, Select, Tabs, cx } from '../../ui';
import { joinNames } from './model';
import { takeRest, type RestResult } from './rest';

const KINDS = [
  { id: 'short', label: 'Kurze Rast' },
  { id: 'long', label: 'Lange Rast' },
] as const;

export function RestDialog({
  kind: initialKind = 'long',
  disturbed,
  onClose,
  onDone,
}: {
  kind?: Rest['kind'];
  /** Eine Störung, die schon feststeht (Nachtprüfung im Lager): vorgewählt, abwählbar. */
  disturbed?: { hour: number; reason: string };
  onClose: () => void;
  /** Die Rast ist vorbei (oder gestört) – zum Melden, was in der Zeit eingetreten ist. */
  onDone: (result: RestResult) => void;
}) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const party = useMemo(() => restingParty(entitiesOfKind(data, 'character')), [data]);
  const rests = useMemo(() => Object.values(data.rests), [data.rests]);
  const open = useMemo(() => resumableRest(rests, now), [rests, now]);

  const [kind, setKind] = useState<Rest['kind']>(open ? 'long' : initialKind);
  const [resume, setResume] = useState(open !== null);
  const [chosen, setChosen] = useState<string[]>(() => party.map((c) => c.id));
  const [edited, setEdited] = useState<Watch[] | null>(null);
  const [stopHours, setStopHours] = useState(disturbed?.hour ?? 0);
  const [reason, setReason] = useState(disturbed?.reason ?? '');

  const resuming = kind === 'long' && resume && open !== null;
  const total = resuming
    ? remainingMinutes(open)
    : kind === 'long'
      ? LONG_REST_MINUTES
      : SHORT_REST_MINUTES;
  const participants = party.filter((c) => chosen.includes(c.id));
  const end = now + total;

  // Der Wachplan folgt den Teilnehmern, bis er von Hand geändert wird.
  const proposed = useMemo(
    () =>
      kind === 'long'
        ? proposeWatches(
            now,
            participants.map((c) => c.id),
            newId,
            total,
            // Bei einer fortgesetzten Rast zählt mit, wer vor der Störung schon gewacht hat.
            resuming
              ? Object.fromEntries(party.map((c) => [c.id, watchMinutes(open.watches, c.id)]))
              : {},
          )
        : [],
    // Die Kennungen der Teilnehmer genügen als Auslöser.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, now, total, resuming, chosen.join('|')],
  );
  const watches = edited ?? proposed;
  const views = watchViews(watches, participants);
  const effects =
    kind === 'long'
      ? longRestEffects(participants, resuming ? [...open.watches, ...watches] : watches)
      : [];
  const changed = effects.filter(changesSomething);
  const overWatched = effects.filter((e) => e.overWatched);
  const wait = kind === 'long' && !resuming ? minutesUntilLongRest(rests, now) : 0;
  // Eine vorgewählte Störung passt immer in die Rast – auch in den Rest einer fortgesetzten.
  const stopAt = Math.min(stopHours, Math.max(0, Math.ceil(total / 60) - 1));
  const stop = kind === 'long' && stopAt > 0 ? stopAt * 60 : null;
  const stopWatch = stop === null ? undefined : watchAt(watches, now + stop - 1);
  const stopView = stopWatch ? views.find((view) => view.watch.id === stopWatch.id) : undefined;
  const hours = Array.from({ length: Math.max(0, Math.ceil(total / 60) - 1) }, (_, i) => i + 1);

  const toggle = (id: string) => {
    setEdited(null);
    setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  };
  const toggleWatch = (watchId: string, characterId: string) =>
    setEdited(
      watches.map((watch) =>
        watch.id !== watchId
          ? watch
          : {
              ...watch,
              characterIds: watch.characterIds.includes(characterId)
                ? watch.characterIds.filter((id) => id !== characterId)
                : [...watch.characterIds, characterId],
            },
      ),
    );

  const start = () => {
    const result = takeRest(db, {
      kind,
      participants: participants.map((c) => c.id),
      watches,
      ...(stop !== null ? { interruptedAfter: stop, reason } : {}),
      ...(resuming ? { resumeId: open.id } : {}),
    });
    onClose();
    onDone(result);
  };

  const place = entityName(data, data.state.placeId);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Rast"
      width={680}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            icon={kind === 'long' ? <Moon /> : <Tent />}
            disabled={!participants.length}
            onClick={start}
            data-autofocus
          >
            {stop !== null
              ? `Bis zur Störung rasten · ${formatDuration(stop)}`
              : `${formatDuration(total)} rasten`}
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <Tabs
          tabs={KINDS.map((entry) => ({ id: entry.id, label: entry.label }))}
          value={kind}
          onChange={(next) => {
            setKind(next);
            setEdited(null);
            setStopHours(0);
          }}
        />

        <p className="wf-soft">
          {place ? `${place} · ` : ''}
          {formatClock(now)} bis {formatClock(end)} ({weekdayName(cal, end)}, {formatDate(cal, end)}
          ).{' '}
          {kind === 'short'
            ? 'Eine Stunde Ruhe; Termine in dieser Zeit treten ein.'
            : 'Acht Stunden, davon mindestens sechs Schlaf. Danach sind die Trefferpunkte voll und die Erschöpfung sinkt um eine Stufe.'}
        </p>

        {open && kind === 'long' && (
          <Checkbox
            checked={resume}
            onChange={(next) => {
              setResume(next);
              setEdited(null);
              setStopHours(0);
            }}
          >
            Die unterbrochene Rast fortsetzen – noch {formatDuration(remainingMinutes(open))} (je
            Unterbrechung eine Stunde mehr)
          </Checkbox>
        )}
        {wait > 0 && (
          <p className="wf-gruppe-rest__warn">
            Eine Lange Rast ist nur einmal in 24 Stunden möglich – nach den Regeln erst wieder in{' '}
            {formatDuration(wait)}; du kannst sie trotzdem gewähren.
          </p>
        )}

        <div>
          <div className="wf-gruppe-rest__label">Wer rastet</div>
          {party.length ? (
            <div className="wf-gruppe-rest__chips">
              {party.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="wf-gruppe-rest__chip"
                  aria-pressed={chosen.includes(c.id)}
                  onClick={() => toggle(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="wf-mute">
              Kein aktiver Gefährte ist bei der Gruppe. Lege unter „Gefährten“ jemanden an.
            </p>
          )}
        </div>

        {kind === 'long' && participants.length > 0 && (
          <div>
            <div className="wf-gruppe-rest__label">
              Wachplan
              <span className="wf-gruppe-rest__hint">
                anklicken, wer wann wacht – höchstens {formatDuration(WATCH_MINUTES)} je Gefährte
              </span>
            </div>
            <div className="wf-gruppe-rest__watches">
              {views.map(({ watch, characters, best }) => (
                <div key={watch.id} className="wf-gruppe-rest__watch">
                  <span className="wf-num wf-gruppe-rest__time">
                    {formatClock(watch.start)}–{formatClock(watch.end)}
                  </span>
                  <span className="wf-gruppe-rest__chips">
                    {participants.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="wf-gruppe-rest__chip wf-gruppe-rest__chip--small"
                        aria-pressed={watch.characterIds.includes(c.id)}
                        onClick={() => toggleWatch(watch.id, c.id)}
                      >
                        {c.name}
                      </button>
                    ))}
                  </span>
                  <span
                    className={cx(
                      'wf-gruppe-rest__sense',
                      !characters.length && 'wf-gruppe-rest__sense--none',
                    )}
                    title={
                      best
                        ? `Höchste Passive Wahrnehmung dieser Wache: ${best.name}`
                        : characters.length
                          ? 'Bei den Wachenden ist keine Passive Wahrnehmung eingetragen'
                          : 'In dieser Zeit wacht niemand'
                    }
                  >
                    {characters.length
                      ? best
                        ? `Wahrnehmung ${best.value}`
                        : 'Wahrnehmung –'
                      : 'unbewacht'}
                  </span>
                </div>
              ))}
            </div>
            {overWatched.length > 0 && (
              <p className="wf-gruppe-rest__warn">
                {joinNames(overWatched.map((e) => e.name))}{' '}
                {overWatched.length === 1 ? 'wacht' : 'wachen'} länger als{' '}
                {formatDuration(WATCH_MINUTES)} und{' '}
                {overWatched.length === 1 ? 'erholt' : 'erholen'} sich deshalb nicht.
              </p>
            )}
          </div>
        )}

        {kind === 'long' && participants.length > 0 && (
          <Field label="Verlauf der Nacht">
            <Select value={String(stopAt)} onChange={(e) => setStopHours(Number(e.target.value))}>
              <option value="0">Ungestört bis zum Ende</option>
              {hours.map((hour) => (
                <option key={hour} value={hour}>
                  Störung nach {formatDuration(hour * 60)} – um {formatClock(now + hour * 60)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {stop !== null ? (
          <div className="wf-col" style={{ gap: 'var(--s-2)' }}>
            <p className="wf-soft">
              Um {formatClock(now + stop)} wacht:{' '}
              <b>
                {stopView?.characters.length
                  ? joinNames(stopView.characters.map((c) => c.name))
                  : 'niemand'}
              </b>
              {stopView?.best &&
                ` – höchste Passive Wahrnehmung ${stopView.best.value} (${stopView.best.name})`}
              . Die Rast bringt bis dahin noch keine Erholung; sie lässt sich danach fortsetzen.
            </p>
            <Input
              value={reason}
              placeholder="Was stört die Rast? (steht in der Chronik)"
              aria-label="Was stört die Rast?"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        ) : (
          kind === 'long' &&
          participants.length > 0 && (
            <div>
              <div className="wf-gruppe-rest__label">Nach der Rast</div>
              {changed.length ? (
                <ul className="wf-gruppe-restlist">
                  {changed.map((e) => (
                    <li key={e.id}>
                      <b>{e.name}</b>
                      <span className="wf-num">
                        {[
                          e.hpAfter !== e.hpBefore
                            ? `Trefferpunkte ${e.hpBefore} → ${e.hpAfter}`
                            : '',
                          e.exhaustionAfter !== e.exhaustionBefore
                            ? e.exhaustionAfter === 0
                              ? 'nicht mehr erschöpft'
                              : `Erschöpfung ${e.exhaustionBefore} → ${e.exhaustionAfter}`
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="wf-mute">
                  Niemand ist verletzt oder erschöpft; es vergeht nur die Zeit, und die Rast steht
                  in der Chronik.
                </p>
              )}
            </div>
          )
        )}
      </div>
    </Dialog>
  );
}
