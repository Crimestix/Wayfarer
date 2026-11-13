/**
 * Die Felder je Art beim Festhalten – geteilt von „Festhalten“ (shell/dialogs.tsx) und dem
 * Eintrag der Chronik (EntryDialog). Nur Anzeige: Was daraus wird, rechnet `recordInputOf` in
 * `recordDraft.ts`; was noch fehlt, sagen `draftProblem` / `recordCheck`.
 *
 * Gebrauch:
 *
 *   <RecordFields kind="fate" draft={draft} onChange={setDraft} />
 *
 * - `kind`: die gewählte Art (`RecordKind`) oder `'repute'` („Ruf“: Haltung, nur Fraktionen).
 * - `draft`: der Entwurf (`RecordDraft`, neu über `emptyRecordDraft()`, aus einem Eintrag über
 *   `draftOfEntry(entry)`, aus einem Vorschlag über `draftFromRecognized(item).draft`).
 * - `onChange`: bekommt den ganzen neuen Entwurf.
 * - `at` (freiwillig): Zeitpunkt des Eintrags – welche Zustände beim Aufheben zur Wahl stehen.
 *   Vorgabe: jetzt.
 *
 * Gibt ein Raster aus zwei Spalten zurück (`wf-form-grid`) – oder nichts, wenn die Art nur aus
 * Text besteht (Notiz, Veränderung, Entscheidung, Weltwissen).
 */
import { useMemo, type ReactNode } from 'react';
import { useData, useDb } from '../../data/hooks';
import { FATE_LABEL, FIGHT_OUTCOME_LABEL, RUMOR_TRUTH_LABEL } from '../../domain/chronicleKinds';
import { PROMISE_OUTCOME_LABEL } from '../../domain/derive';
import { activeConditions } from '../../domain/history';
import { RELATION_TYPES } from '../../domain/relations';
import {
  FIGHT_OUTCOMES,
  PARTY_ID,
  PERSON_STATUS,
  RUMOR_TRUTHS,
  createEntity,
  type EntityKind,
} from '../../domain/schema';
import type { WorldTime } from '../../domain/time/calendar';
import {
  AttitudeScale,
  Checkbox,
  EntityPicker,
  EntityRefsEditor,
  Field,
  Input,
  Select,
} from '../../ui';
import {
  WHO_KINDS,
  clueChoices,
  secretChoices,
  type RecordDraft,
  type RecordFieldsKind,
} from './recordDraft';

export type { RecordDraft, RecordFieldsKind } from './recordDraft';

const PEOPLE: EntityKind[] = WHO_KINDS.attitude!;
const OPPONENTS: EntityKind[] = ['person', 'faction', 'family', 'species', 'character'];

/** Erster Buchstabe groß: „tot“ → „Tot“ für Auswahllisten. */
const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** Beziehungsarten nach Gruppen, ohne die eigene Bezeichnung (die braucht ein eigenes Wort). */
const RELATION_GROUPS = [...new Set(RELATION_TYPES.map((type) => type.group))].map((group) => ({
  group,
  types: RELATION_TYPES.filter((type) => type.group === group && type.key !== 'custom'),
}));

export function RecordFields({
  kind,
  draft,
  onChange,
  at,
}: {
  kind: RecordFieldsKind;
  draft: RecordDraft;
  onChange: (draft: RecordDraft) => void;
  at?: WorldTime;
}) {
  const db = useDb();
  const data = useData();
  const set = (change: Partial<RecordDraft>) => onChange({ ...draft, ...change });
  const newPlace = (name: string) => db.put('entities', createEntity({ kind: 'place', name })).id;

  const conditions = useMemo(() => {
    if (kind !== 'condition' || !draft.ended || !draft.whoId) return [];
    const open = activeConditions(data, draft.whoId, at ?? data.state.now);
    // Beim Bearbeiten eines Endes ist der Zustand, den es aufhebt, nicht mehr offen – er bleibt wählbar.
    const ends = draft.endsId ? data.chronicle[draft.endsId] : undefined;
    return ends && !open.some(({ entry }) => entry.id === ends.id)
      ? [{ entry: ends }, ...open]
      : open;
  }, [kind, draft.ended, draft.whoId, draft.endsId, data, at]);
  const threads = useMemo(() => (kind === 'clue' ? clueChoices(data) : []), [kind, data]);
  const secrets = useMemo(
    () => (kind === 'reveal' ? secretChoices(data, draft.prepSecretId) : []),
    [kind, data, draft.prepSecretId],
  );

  /** Das Feld „Wer“; welche Einträge passen, sagt `WHO_KINDS`. */
  const who = (label: string, placeholder = 'Wählen …') => (
    <Field label={label}>
      <EntityPicker
        value={draft.whoId}
        onChange={(whoId) => set({ whoId, endsId: null })}
        kinds={WHO_KINDS[kind]}
        placeholder={placeholder}
      />
    </Field>
  );

  let fields: ReactNode = null;
  switch (kind) {
    case 'travel':
      fields = (
        <Field
          label="Wohin"
          className="wf-span-2"
          hint="Nur der Eintrag – die Zeit bleibt stehen. Mit Weg und Dauer zieht die Gruppe über „Ort wechseln“."
        >
          <EntityPicker
            value={draft.placeId}
            onChange={(placeId) => set({ placeId })}
            kinds={['place']}
            placeholder="Ort wählen oder neu anlegen …"
            onCreate={newPlace}
          />
        </Field>
      );
      break;
    case 'attitude':
    case 'repute':
      fields = (
        <>
          {kind === 'repute' ? who('Fraktion', 'Fraktion wählen …') : who('Wessen Haltung')}
          <Field label="Gegenüber">
            <EntityPicker
              value={draft.towardId ?? PARTY_ID}
              onChange={(id) => set({ towardId: id === PARTY_ID ? null : id })}
              kinds={PEOPLE}
              allowParty
              allowClear={false}
            />
          </Field>
          <Field label="Neue Haltung" className="wf-span-2">
            <AttitudeScale value={draft.attitude} onChange={(attitude) => set({ attitude })} />
          </Field>
        </>
      );
      break;
    case 'promise':
      fields = (
        <>
          <Field label="Frist in Tagen" hint="Leer lassen, wenn es keine Frist gibt.">
            <Input
              type="number"
              min={0}
              value={draft.dueDays}
              onChange={(e) => set({ dueDays: e.target.value })}
            />
          </Field>
          <Field label="Stand">
            <Select
              value={draft.promiseOutcome}
              onChange={(e) =>
                set({ promiseOutcome: e.target.value as RecordDraft['promiseOutcome'] })
              }
            >
              {(['open', 'kept', 'failed'] as const).map((value) => (
                <option key={value} value={value}>
                  {PROMISE_OUTCOME_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
        </>
      );
      break;
    case 'fight': {
      const encounters = Object.values(data.encounters).sort((a, b) =>
        a.name.localeCompare(b.name, 'de'),
      );
      fields = (
        <>
          <Field label="Gegen" className="wf-span-2">
            <EntityRefsEditor
              value={draft.withIds}
              onChange={(withIds) => set({ withIds })}
              kinds={OPPONENTS}
              placeholder="Gegner hinzufügen …"
            />
          </Field>
          <Field label="Ausgang">
            <Select
              value={draft.fightOutcome}
              onChange={(e) => set({ fightOutcome: e.target.value as RecordDraft['fightOutcome'] })}
            >
              {FIGHT_OUTCOMES.map((value) => (
                <option key={value} value={value}>
                  {capital(FIGHT_OUTCOME_LABEL[value])}
                </option>
              ))}
            </Select>
          </Field>
          {encounters.length > 0 && (
            <Field label="Begegnung aus dem Bestiarium">
              <Select
                value={draft.encounterId ?? ''}
                onChange={(e) => set({ encounterId: e.target.value || null })}
              >
                <option value="">Keine</option>
                {encounters.map((encounter) => (
                  <option key={encounter.id} value={encounter.id}>
                    {encounter.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </>
      );
      break;
    }
    case 'meeting':
      fields = (
        <Field label="Getroffen" className="wf-span-2" hint="Personen gelten danach als bekannt.">
          <EntityRefsEditor
            value={draft.withIds}
            onChange={(withIds) => set({ withIds })}
            kinds={PEOPLE}
            placeholder="Wen hat die Gruppe getroffen?"
          />
        </Field>
      );
      break;
    case 'rest':
      fields = (
        <Field label="Rast" hint="Nur der Eintrag – die Zeit bleibt stehen.">
          <Select
            value={draft.longRest ? 'long' : 'short'}
            onChange={(e) => set({ longRest: e.target.value === 'long' })}
          >
            <option value="short">Kurze Rast</option>
            <option value="long">Lange Rast</option>
          </Select>
        </Field>
      );
      break;
    case 'quote':
      fields = who('Wer sagte es', 'Niemand Bestimmtes');
      break;
    case 'fate':
      fields = (
        <>
          {who('Wer', 'Person wählen …')}
          <Field label="Neues Schicksal" hint="Gilt auch für den Eintrag der Person.">
            <Select
              value={draft.status}
              onChange={(e) => set({ status: e.target.value as RecordDraft['status'] })}
            >
              {PERSON_STATUS.map((value) => (
                <option key={value} value={value}>
                  {capital(FATE_LABEL[value])}
                </option>
              ))}
            </Select>
          </Field>
        </>
      );
      break;
    case 'whereabouts': {
      const character = draft.whoId && data.entities[draft.whoId]?.kind === 'character';
      fields = (
        <>
          {who('Wer', 'Person oder Gefährte …')}
          <Field label="Hält sich jetzt auf in">
            <EntityPicker
              value={draft.placeId}
              onChange={(placeId) => set({ placeId })}
              kinds={['place']}
              placeholder={character ? 'Wieder bei der Gruppe' : 'Unbekannt'}
              onCreate={newPlace}
            />
          </Field>
        </>
      );
      break;
    }
    case 'discovery':
      fields = (
        <Field label="Was entdeckt wurde" className="wf-span-2">
          <EntityPicker
            value={draft.placeId}
            onChange={(placeId) => set({ placeId })}
            kinds={['place']}
            placeholder="Ort wählen oder neu anlegen …"
            onCreate={newPlace}
          />
        </Field>
      );
      break;
    case 'rumor':
      fields = (
        <>
          {who('Wer erzählt es', 'Niemand Bestimmtes')}
          <Field label="Stand" hint="Ein Gerücht gilt nicht als Tatsache.">
            <Select
              value={draft.truth}
              onChange={(e) => set({ truth: e.target.value as RecordDraft['truth'] })}
            >
              {RUMOR_TRUTHS.map((value) => (
                <option key={value} value={value}>
                  {capital(RUMOR_TRUTH_LABEL[value])}
                </option>
              ))}
            </Select>
          </Field>
        </>
      );
      break;
    case 'bond':
      fields = (
        <>
          {who('Wer')}
          <Field label="Mit wem">
            <EntityPicker
              value={draft.towardId}
              onChange={(towardId) => set({ towardId })}
              kinds={PEOPLE}
              allowParty
              placeholder="Wählen …"
            />
          </Field>
          <Field label="Beziehung">
            <Select
              value={draft.relationType}
              onChange={(e) => set({ relationType: e.target.value })}
            >
              {RELATION_GROUPS.map(({ group, types }) => (
                <optgroup key={group} label={group}>
                  {types.map((type) => (
                    <option key={type.key} value={type.key}>
                      {type.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Beginnt oder endet">
            <Select
              value={draft.ended ? 'ended' : 'begins'}
              onChange={(e) => set({ ended: e.target.value === 'ended' })}
            >
              <option value="begins">Beginnt</option>
              <option value="ended">Endet</option>
            </Select>
          </Field>
        </>
      );
      break;
    case 'condition':
      fields = (
        <>
          {who('Wer', 'Person oder Gefährte …')}
          <Field
            label="Beginnt oder endet"
            hint={draft.ended ? undefined : 'Der Text oben ist der Zustand, etwa „Pfeil im Bein“.'}
          >
            <Select
              value={draft.ended ? 'ended' : 'begins'}
              onChange={(e) => set({ ended: e.target.value === 'ended', endsId: null })}
            >
              <option value="begins">Beginnt</option>
              <option value="ended">Wird aufgehoben</option>
            </Select>
          </Field>
          {draft.ended && (
            <Field
              label="Welcher Zustand"
              className="wf-span-2"
              hint={
                draft.whoId && !conditions.length
                  ? 'Gerade besteht kein Zustand – dann zählt der gleiche Wortlaut.'
                  : undefined
              }
            >
              <Select
                value={draft.endsId ?? ''}
                onChange={(e) => set({ endsId: e.target.value || null })}
              >
                <option value="">Der mit gleichem Wortlaut</option>
                {conditions.map(({ entry }) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.text}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </>
      );
      break;
    case 'milestone':
      fields = (
        <>
          {who('Gefährte', 'Gefährten wählen …')}
          <Field label="Neue Stufe" hint="Leer lassen, wenn sich die Stufe nicht ändert.">
            <Input
              type="number"
              min={1}
              max={20}
              value={draft.level}
              onChange={(e) => set({ level: e.target.value })}
            />
          </Field>
        </>
      );
      break;
    case 'wish':
      fields = (
        <>
          {who('Gefährte', 'Gefährten wählen …')}
          <Field label="Ziel">
            <Checkbox checked={draft.setGoal} onChange={(setGoal) => set({ setGoal })}>
              Als Ziel des Gefährten übernehmen
            </Checkbox>
          </Field>
        </>
      );
      break;
    case 'clue': {
      const thread = threads.find((t) => t.threadId === draft.threadId);
      fields = (
        <>
          <Field label="Faden">
            <Select
              value={draft.threadId ?? ''}
              onChange={(e) => set({ threadId: e.target.value || null, hintId: null })}
            >
              <option value="">Ohne Faden</option>
              {threads.map((t) => (
                <option key={t.threadId} value={t.threadId}>
                  {t.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hinweis">
            <Select
              value={draft.hintId ?? ''}
              disabled={!thread?.hints.length}
              onChange={(e) => set({ hintId: e.target.value || null })}
            >
              <option value="">
                {thread?.hints.length ? 'Keiner von der Liste' : 'Keine Hinweise'}
              </option>
              {thread?.hints.map((hint) => (
                <option key={hint.id} value={hint.id}>
                  {hint.found ? `${hint.text} (schon gefunden)` : hint.text}
                </option>
              ))}
            </Select>
          </Field>
        </>
      );
      break;
    }
    case 'reveal':
      fields = (
        <Field
          label="Geheimnis vom Abend-Blatt"
          className="wf-span-2"
          hint={
            secrets.length
              ? 'Ohne Text oben gilt der Wortlaut des Geheimnisses.'
              : 'Auf den Abend-Blättern steht kein offenes Geheimnis.'
          }
        >
          <Select
            value={draft.prepSecretId ?? ''}
            disabled={!secrets.length}
            onChange={(e) => set({ prepSecretId: e.target.value || null })}
          >
            <option value="">Keines vom Blatt</option>
            {secrets.map((secret) => (
              <option key={secret.id} value={secret.id}>
                {secret.text}
              </option>
            ))}
          </Select>
        </Field>
      );
      break;
    case 'knowledge':
      fields = who('Wer erfährt es');
      break;
    default:
      fields = null;
  }
  return fields ? <div className="wf-form-grid">{fields}</div> : null;
}
