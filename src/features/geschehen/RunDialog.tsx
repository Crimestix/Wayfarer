/**
 * Einen regelmäßigen Ablauf schreiben: wer oder was fährt, von wo nach wo, wie oft. Der Fahrplan
 * gehört dazu – ohne ihn wüsste Wayfarer nicht, wann etwas fehlt.
 */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { runRoute, runStatus, scheduleText } from '../../domain/runs';
import { createEntity, type Repeat, type Run } from '../../domain/schema';
import { MINUTES_PER_DAY, formatDate, startOfDay } from '../../domain/time/calendar';
import { describeVia, formatWayTime } from '../../domain/ways';
import {
  Button,
  Checkbox,
  Dialog,
  EntityPicker,
  Field,
  Input,
  Select,
  TextArea,
  confirmDialog,
} from '../../ui';
import { removeRun, saveRun } from './actions';

/** Abfahrt um sechs Uhr morgens. */
const DEPARTURE = 6 * 60;

export function RunDialog({ run, onClose }: { run: Run | null; onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const now = data.state.now;
  const [name, setName] = useState(run?.name ?? '');
  const [fromId, setFromId] = useState<string | null>(run?.fromId ?? data.state.placeId);
  const [toId, setToId] = useState<string | null>(run?.toId ?? null);
  const [every, setEvery] = useState(String(run?.every.every ?? 1));
  const [unit, setUnit] = useState<Repeat['unit']>(run?.every.unit ?? 'week');
  /** In wie vielen Tagen die nächste Abfahrt ist – leer = bleibt, wie sie ist. */
  const [inDays, setInDays] = useState(run ? '' : '1');
  const [carrier, setCarrier] = useState(run?.carrier ?? '');
  const [operatorId, setOperatorId] = useState<string | null>(run?.operatorId ?? null);
  const [stopped, setStopped] = useState(run ? run.stoppedAt !== null : false);
  const [stopReason, setStopReason] = useState(run?.stopReason ?? '');
  const [note, setNote] = useState(run?.note ?? '');

  const days = Number(inDays);
  const restart = inDays.trim() !== '' && Number.isFinite(days) && days >= 0;
  const start = restart
    ? startOfDay(now) + Math.round(days) * MINUTES_PER_DAY + DEPARTURE
    : (run?.start ?? now);
  const count = Math.max(1, Math.round(Number(every)) || 1);
  const ready = name.trim() !== '' && fromId !== null && toId !== null && fromId !== toId;
  const draft: Run | null =
    fromId && toId
      ? ({
          ...(run ?? { id: 'entwurf', rev: 0, created: '', updated: '', missed: [], decided: [] }),
          name,
          fromId,
          toId,
          start,
          every: { every: count, unit },
          carrier,
          carrierId: run?.carrierId ?? null,
          operatorId,
          stoppedAt: stopped ? (run?.stoppedAt ?? now) : null,
          stopReason,
          note,
        } as Run)
      : null;
  const route = draft ? runRoute(data, draft) : null;
  const next = draft && !stopped ? runStatus(data, draft).next : null;
  const place = (text: string) =>
    db.put('entities', createEntity({ kind: 'place', name: text })).id;

  const save = () => {
    if (!ready || !draft) return;
    saveRun(
      db,
      {
        name,
        fromId: draft.fromId,
        toId: draft.toId,
        start,
        every: draft.every,
        carrier,
        operatorId,
        stoppedAt: draft.stoppedAt,
        stopReason,
        note,
      },
      run?.id,
    );
    onClose();
  };
  const remove = async () => {
    if (!run) return;
    const ok = await confirmDialog({
      title: `„${run.name}“ löschen?`,
      body: 'Der Ablauf verschwindet. Uhren, deren Schritte an ihm hingen, laufen ohne diese Bedingung weiter.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    removeRun(db, run.id);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={run ? 'Ablauf ändern' : 'Neuer Ablauf'}
      width={620}
      footer={
        <>
          {run && (
            <Button variant="ghost" icon={<Trash2 aria-hidden />} onClick={remove}>
              Löschen
            </Button>
          )}
          <span className="wf-grow" />
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="primary" disabled={!ready} onClick={save}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="wf-col">
        <Field label="Name" hint="Was regelmäßig geschieht – etwa „Salzkahn nach Graufels“.">
          <Input value={name} autoFocus={!run} onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className="wf-form-grid">
          <Field label="Von">
            <EntityPicker
              value={fromId}
              onChange={setFromId}
              kinds={['place']}
              placeholder="Ort …"
              onCreate={place}
            />
          </Field>
          <Field label="Nach">
            <EntityPicker
              value={toId}
              onChange={setToId}
              kinds={['place']}
              placeholder="Ort …"
              onCreate={place}
            />
          </Field>
        </div>
        {draft && (
          <p className="wf-turn-none">
            {route
              ? `Strecke: ${formatWayTime(route.minutes)}${route.unknown ? ' und mehr' : ''} ${describeVia(data, route)} – bei gutem Wetter.`
              : 'Zwischen den beiden Orten gibt es keinen Weg im Wegenetz: Die Reisezeit ist unbekannt, und das Wetter kann die Fahrt nicht aufhalten.'}
          </p>
        )}
        <div className="wf-form-grid">
          <Field label="Fahrplan" hint={scheduleText({ every: { every: count, unit } })}>
            <span className="wf-row" style={{ gap: 'var(--s-2)' }}>
              <span className="wf-mute">alle</span>
              <Input
                value={every}
                inputMode="numeric"
                aria-label="Abstand"
                style={{ width: 64, textAlign: 'center' }}
                onChange={(event) => setEvery(event.target.value)}
              />
              <Select
                value={unit}
                aria-label="Einheit"
                onChange={(event) => setUnit(event.target.value as Repeat['unit'])}
              >
                <option value="day">Tage</option>
                <option value="week">Wochen</option>
                <option value="month">Monate</option>
              </Select>
            </span>
          </Field>
          <Field
            label={run ? 'Neu ansetzen' : 'Erste Abfahrt'}
            hint={
              next
                ? `Nächste Abfahrt: ${formatDate(data.campaign.calendar, next.departs)}`
                : stopped
                  ? 'Ausgesetzt – es fährt niemand.'
                  : ''
            }
          >
            <span className="wf-row" style={{ gap: 'var(--s-2)' }}>
              <span className="wf-mute">in</span>
              <Input
                value={inDays}
                inputMode="numeric"
                aria-label="In wie vielen Tagen"
                placeholder={run ? '–' : '1'}
                style={{ width: 64, textAlign: 'center' }}
                onChange={(event) => setInDays(event.target.value)}
              />
              <span className="wf-mute">Tagen, morgens</span>
            </span>
          </Field>
        </div>
        <div className="wf-form-grid">
          <Field label="Träger" hint="Womit: Boot, Karawane, Bote.">
            <Input value={carrier} onChange={(event) => setCarrier(event.target.value)} />
          </Field>
          <Field label="Betreiber" hint="Fehlt er – tot, verschollen, gelöscht –, fährt niemand.">
            <EntityPicker
              value={operatorId}
              onChange={setOperatorId}
              kinds={['faction', 'person', 'family']}
              placeholder="Fraktion oder Person …"
            />
          </Field>
        </div>
        <Checkbox checked={stopped} onChange={setStopped}>
          Ausgesetzt – der Ablauf fährt zurzeit nicht
        </Checkbox>
        {stopped && (
          <Field label="Warum">
            <Input
              value={stopReason}
              placeholder="etwa „Das Boot liegt im Dock“"
              onChange={(event) => setStopReason(event.target.value)}
            />
          </Field>
        )}
        <Field label="Notizen">
          <TextArea value={note} rows={2} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
