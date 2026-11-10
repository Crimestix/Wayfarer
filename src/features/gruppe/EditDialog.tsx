/** Dialog „Gefährte anlegen / bearbeiten“. */
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation } from 'wouter';
import { ImagePlus, Trash2, X } from 'lucide-react';
import { deleteEntity } from '../../data/actions';
import { useData, useDb } from '../../data/hooks';
import { entitiesOfKind } from '../../domain/derive';
import { createEntity, type Character } from '../../domain/schema';
import {
  Button,
  Checkbox,
  Dialog,
  EntityPicker,
  Field,
  Input,
  Portrait,
  SectionTitle,
  confirmDialog,
  cx,
  toast,
} from '../../ui';
import { saveCharacter } from './actions';
import { fileToPortrait } from './image';
import {
  addLanguages,
  clickExhaustionMark,
  draftFromCharacter,
  emptyDraft,
  exhaustionText,
  languageSuggestions,
  parseDraft,
  removeLanguage,
  toggleCondition,
  type CharacterDraft,
  type DraftField,
} from './model';
import { ConditionToggles, ExhaustionMarks } from './parts';

export function EditDialog({
  character,
  onClose,
}: {
  character: Character | null;
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const formId = useId();
  const listId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<CharacterDraft>(() =>
    character ? draftFromCharacter(character) : emptyDraft(),
  );
  const [language, setLanguage] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [imageError, setImageError] = useState('');
  const set = <K extends keyof CharacterDraft>(key: K, value: CharacterDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const result = useMemo(() => parseDraft(draft), [draft]);
  const error = (field: DraftField) => (showErrors ? result.errors[field] : undefined);

  // Vorschläge: Sprachen der anderen Gefährten zuerst, dann die des Regelwerks.
  const suggestions = useMemo(
    () =>
      languageSuggestions(
        entitiesOfKind(data, 'character').flatMap((c) => c.character.languages),
        draft.languages,
      ),
    [data, draft.languages],
  );

  const commitLanguage = () => {
    if (!language.trim()) return false;
    set('languages', addLanguages(draft.languages, language));
    setLanguage('');
    return true;
  };

  const save = () => {
    // Eine getippte, noch nicht übernommene Sprache geht nicht verloren.
    const pending = language.trim()
      ? { ...draft, languages: addLanguages(draft.languages, language) }
      : draft;
    const checked = parseDraft(pending);
    if (!checked.value) {
      setShowErrors(true);
      return;
    }
    saveCharacter(db, character?.id ?? null, checked.value);
    onClose();
  };

  const remove = async () => {
    if (!character) return;
    const ok = await confirmDialog({
      title: `${character.name} löschen?`,
      body: (
        <>
          {character.name} verschwindet samt allen Beziehungen aus der Gruppe. Was in der Chronik
          steht, bleibt erhalten. Das lässt sich nicht rückgängig machen – wer nur pausiert, lässt
          sich stattdessen auf „Nicht dabei“ stellen.
        </>
      ),
      confirmLabel: 'Endgültig löschen',
      danger: true,
    });
    if (!ok) return;
    deleteEntity(db, character.id);
    onClose();
    navigate('/gruppe');
    toast({ title: `${character.name} gelöscht` });
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      set('image', await fileToPortrait(file));
      setImageError('');
    } catch (e) {
      setImageError(e instanceof Error ? e.message : 'Das Bild konnte nicht gelesen werden.');
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  };

  // Schlichte Textfelder statt Zahlenfelder: Das Mausrad verstellt sonst beim Rollen durch den
  // Dialog unbemerkt den Wert, über dem der Zeiger gerade steht. Geprüft wird in parseDraft.
  const number = (field: DraftField & keyof CharacterDraft, label: string, placeholder = '–') => (
    <Field
      label={label}
      hint={error(field)}
      className={error(field) ? 'wf-gruppe-field--error' : undefined}
    >
      <Input
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={draft[field] as string}
        onChange={(e) => set(field, e.target.value)}
      />
    </Field>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={character ? `${character.name} bearbeiten` : 'Gefährte anlegen'}
      width={800}
      footer={
        <>
          {character && (
            <Button variant="danger" icon={<Trash2 />} onClick={remove}>
              Löschen
            </Button>
          )}
          <span className="wf-grow wf-gruppe-dialog__note">
            {showErrors && !result.value
              ? 'Bitte die markierten Felder prüfen.'
              : 'Den vollständigen Bogen führt D&D Beyond – hier steht nur, was du am Tisch brauchst.'}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form={formId}>
            {character ? 'Speichern' : 'Anlegen'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="wf-gruppe-form"
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="wf-gruppe-form__top">
          <div className="wf-gruppe-form__image">
            <Portrait
              entity={{ kind: 'character', image: draft.image, name: draft.name }}
              size={132}
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void pickImage(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button size="sm" icon={<ImagePlus />} onClick={() => fileInput.current?.click()}>
              {draft.image ? 'Bild ersetzen' : 'Bild wählen'}
            </Button>
            {draft.image && (
              <Button size="sm" variant="ghost" onClick={() => set('image', null)}>
                Bild entfernen
              </Button>
            )}
            {imageError && <div className="wf-gruppe-form__error">{imageError}</div>}
          </div>
          <div className="wf-gruppe-form__grid wf-grow">
            <Field
              label="Name"
              hint={error('name')}
              className={cx('wf-gruppe-col-4', error('name') && 'wf-gruppe-field--error')}
            >
              <Input
                data-autofocus
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Name des Charakters"
              />
            </Field>
            <Field label="Gespielt von" className="wf-gruppe-col-2">
              <Input
                value={draft.player}
                onChange={(e) => set('player', e.target.value)}
                placeholder="Spieler"
              />
            </Field>
            <Field label="Kurzbeschreibung" className="wf-gruppe-col-6">
              <Input
                value={draft.tagline}
                onChange={(e) => set('tagline', e.target.value)}
                placeholder="Ein Satz, der am Tisch reicht"
              />
            </Field>
            <Field label="Volk" className="wf-gruppe-col-2">
              <Input
                value={draft.species}
                onChange={(e) => set('species', e.target.value)}
                placeholder="z. B. Halbling"
              />
            </Field>
            <Field label="Klasse" className="wf-gruppe-col-3">
              <Input
                value={draft.className}
                onChange={(e) => set('className', e.target.value)}
                placeholder="z. B. Schurke"
              />
            </Field>
            <Field
              label="Stufe"
              hint={error('level')}
              className={cx('wf-gruppe-col-1', error('level') && 'wf-gruppe-field--error')}
            >
              <Input
                inputMode="numeric"
                autoComplete="off"
                value={draft.level}
                onChange={(e) => set('level', e.target.value)}
              />
            </Field>
          </div>
        </div>

        <SectionTitle>Werte für den Tisch</SectionTitle>
        <div className="wf-gruppe-form__grid">
          {number('armorClass', 'Rüstungsklasse')}
          {number('hpMax', 'Max. Trefferpunkte')}
          {number('speed', 'Bewegungsrate (Fuß)', '30')}
          {number('passivePerception', 'Passive Wahrnehmung')}
          {number('passiveInsight', 'Passive Einsicht')}
          {number('passiveInvestigation', 'Passive Nachforschung')}
        </div>

        <SectionTitle>Sprachen</SectionTitle>
        <div className="wf-gruppe-languages">
          {draft.languages.map((l) => (
            <span key={l} className="wf-badge wf-badge--gold">
              {l}
              <button
                type="button"
                className="wf-gruppe-languages__remove"
                aria-label={`${l} entfernen`}
                onClick={() => set('languages', removeLanguage(draft.languages, l))}
              >
                <X />
              </button>
            </span>
          ))}
          <Input
            className="wf-gruppe-languages__input"
            list={listId}
            value={language}
            placeholder={
              draft.languages.length ? 'Weitere Sprache …' : 'Sprache eintragen, Eingabe fügt hinzu'
            }
            onChange={(e) => {
              const value = e.target.value;
              // Ein Komma oder die Auswahl aus den Vorschlägen übernimmt sofort; beim Tippen nicht,
              // sonst ließe sich „Gemeinsprache der Unterreiche“ nie zu Ende schreiben.
              const inputType = (e.nativeEvent as InputEvent).inputType;
              const picked =
                suggestions.includes(value) &&
                (inputType === undefined || inputType === 'insertReplacementText');
              if (value.includes(',') || picked) {
                set('languages', addLanguages(draft.languages, value));
                setLanguage('');
              } else setLanguage(value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && commitLanguage())
                e.preventDefault();
              if (e.key === 'Backspace' && !language && draft.languages.length)
                set('languages', draft.languages.slice(0, -1));
            }}
            onBlur={commitLanguage}
          />
          <datalist id={listId}>
            {suggestions.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>

        {character && (
          <>
            <SectionTitle>Im Augenblick</SectionTitle>
            <div className="wf-gruppe-form__now">
              <Field label="Erschöpfung">
                <div className="wf-gruppe-exhaustion">
                  <ExhaustionMarks
                    level={draft.exhaustion}
                    onMark={(mark) =>
                      set('exhaustion', clickExhaustionMark(draft.exhaustion, mark))
                    }
                  />
                  <span className="wf-gruppe-exhaustion__text">
                    {draft.exhaustion > 0 && draft.exhaustion < 6 && (
                      <b>Stufe {draft.exhaustion}</b>
                    )}
                    {exhaustionText(draft.exhaustion, true)}
                  </span>
                </div>
              </Field>
              <Field
                label="Aufenthaltsort"
                hint="Leer lassen, solange der Gefährte bei der Gruppe ist."
              >
                <EntityPicker
                  value={draft.placeId}
                  onChange={(id) => set('placeId', id)}
                  kinds={['place']}
                  placeholder="Bei der Gruppe"
                  onCreate={(name) => db.put('entities', createEntity({ kind: 'place', name })).id}
                />
              </Field>
              <Field label="Zustände" className="wf-gruppe-form__conditions">
                <ConditionToggles
                  value={draft.conditions}
                  onToggle={(name) => set('conditions', toggleCondition(draft.conditions, name))}
                />
              </Field>
            </div>
          </>
        )}

        <SectionTitle>Zugehörigkeit</SectionTitle>
        <div className="wf-gruppe-form__grid">
          <Field
            label="Link zum Charakterbogen"
            hint={error('sheetUrl') ?? 'Die Adresse des Bogens bei D&D Beyond.'}
            className={cx('wf-gruppe-col-4', error('sheetUrl') && 'wf-gruppe-field--error')}
          >
            <Input
              value={draft.sheetUrl}
              onChange={(e) => set('sheetUrl', e.target.value)}
              placeholder="https://www.dndbeyond.com/characters/…"
            />
          </Field>
          <div className="wf-gruppe-col-2 wf-gruppe-form__active">
            <Checkbox checked={draft.active} onChange={(v) => set('active', v)}>
              Gehört zur aktiven Gruppe
            </Checkbox>
            <div className="wf-field__hint">
              {draft.active
                ? 'Zählt bei den Kennzahlen und der Langen Rast mit.'
                : 'Steht unter „Nicht dabei“.'}
            </div>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
