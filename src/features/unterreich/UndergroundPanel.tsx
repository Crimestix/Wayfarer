/**
 * Unter der Erde: was das Feld in der Weltleiste statt des Wetters zeigt – Licht der Gruppe, wer im
 * Dunkeln sieht, wie es am Ort ist. Die Rechnung steht in `domain/underground.ts`.
 */
import { Eye, EyeOff, Flame, TriangleAlert, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { PLACE_LIGHTS, type PlaceLight } from '../../domain/schema';
import { formatClock, formatDuration } from '../../domain/time/calendar';
import {
  belowSince,
  describeBelow,
  LIGHT_LABEL,
  LIGHT_PRESETS,
  LIGHT_RULE,
  surfaceDaytime,
  type LightStatus,
} from '../../domain/underground';
import { Button, IconButton, Select, toast } from '../../ui';
import { lightUp, putOut, setPlaceLight } from './actions';
import './unterreich.css';

/** Das Zeichen zum Stand des Lichts: Flamme, offenes oder geschlossenes Auge. */
export function LightIcon({ status }: { status: LightStatus }) {
  if (status.state === 'lit') return <Flame aria-hidden />;
  return status.state === 'ambient' ? <Eye aria-hidden /> : <EyeOff aria-hidden />;
}

/** „Unter der Erde · seit 12 Tagen · oben ist es Nacht“ */
export function useBelowLine(): string {
  const data = useData();
  const since = belowSince(data);
  return [
    'Unter der Erde',
    since !== null ? describeBelow(since, data.state.now) : '',
    `oben ist es ${surfaceDaytime(data.state.now)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function UndergroundPanel({ status }: { status: LightStatus }) {
  const db = useDb();
  const data = useData();
  const now = data.state.now;
  const { surroundings, lights, sight } = status;
  const anyDarkvision = sight.sees.length > 0;

  return (
    <div className="wf-unter">
      {status.warning && (
        <p className="wf-unter__warning">
          <TriangleAlert aria-hidden />
          <span>{status.warning}</span>
        </p>
      )}

      <section>
        <h4 className="wf-unter__title">Licht der Gruppe</h4>
        {lights.length === 0 ? (
          <p className="wf-unter__none">Es brennt kein Licht.</p>
        ) : (
          <ul className="wf-unter__lights">
            {lights.map((light) => (
              <li key={light.id}>
                <Flame aria-hidden />
                <span className="wf-unter__light-name" title={light.note}>
                  {light.label}
                </span>
                <span className="wf-unter__light-left">
                  noch {formatDuration(light.end - now)} · bis {formatClock(light.end)}
                </span>
                <IconButton
                  label={`„${light.label}“ löschen`}
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const undo = putOut(db, light.id);
                    if (undo)
                      toast({
                        title: 'Licht gelöscht',
                        body: light.label,
                        action: { label: 'Rückgängig', run: undo },
                      });
                  }}
                >
                  <X />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <div className="wf-unter__presets" aria-label="Ein Licht anzünden">
          {LIGHT_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              size="sm"
              title={`${preset.label} anzünden: brennt ${formatDuration(preset.minutes)}, ${preset.reach}`}
              onClick={() => {
                const undo = lightUp(db, preset);
                toast({
                  title: `${preset.label} brennt`,
                  body: `${formatDuration(preset.minutes)} · ${preset.reach}`,
                  action: { label: 'Rückgängig', run: undo },
                });
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </section>

      <section>
        <h4 className="wf-unter__title">Wer im Dunkeln sieht</h4>
        {anyDarkvision ? (
          <>
            <p className="wf-unter__sight">
              {sight.sees.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ' · '}
                  <strong>{c.name}</strong> {c.character.darkvision} Fuß
                </span>
              ))}
            </p>
            {sight.blind.length > 0 && (
              <p className="wf-unter__none">
                Ohne Dunkelsicht: {sight.blind.map((c) => c.name).join(', ')}
              </p>
            )}
          </>
        ) : (
          <p className="wf-unter__none">
            Bei keinem Gefährten ist Dunkelsicht eingetragen. Das geht unter „Gefährten“ im Dialog
            „Bearbeiten“.
          </p>
        )}
      </section>

      <section>
        <h4 className="wf-unter__title">
          Am Ort <span>{surroundings.manual ? 'festgelegt' : 'errechnet'}</span>
        </h4>
        <p className="wf-unter__place">
          <strong>{LIGHT_LABEL[surroundings.light]}</strong>
          {surroundings.lightFrom !== 'Kein Licht' && ` – ${surroundings.lightFrom}`}.{' '}
          {LIGHT_RULE[surroundings.light]}
        </p>
        <p className="wf-unter__mood">
          {surroundings.air}. {surroundings.sound}.
        </p>
        <Select
          className="wf-unter__select"
          aria-label={`Helligkeit in ${surroundings.place.name}`}
          value={surroundings.place.place.light ?? ''}
          onChange={(e) =>
            setPlaceLight(
              db,
              surroundings.place.id,
              e.target.value === '' ? null : (e.target.value as PlaceLight),
            )
          }
        >
          <option value="">Helligkeit hier: Wayfarer überlassen</option>
          {PLACE_LIGHTS.map((light) => (
            <option key={light} value={light}>
              Helligkeit hier: {LIGHT_LABEL[light]}
            </option>
          ))}
        </Select>
      </section>
    </div>
  );
}
