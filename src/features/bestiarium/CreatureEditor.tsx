/**
 * Wesen bearbeiten: links das Formular in Abschnitten, rechts der Statblock, der beim Tippen
 * mitläuft. Der Spielleiter trägt ein, was ein Statblock festlegt; Wayfarer rechnet, was daraus
 * folgt. Bei Varianten und Einzelnen bleibt leer, was geerbt wird – der geerbte Wert steht blass
 * im Feld. Gespeichert wird mit einem Knopf; Strg+Z nimmt Änderungen im Formular zurück.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useParams } from 'wouter';
import { ArrowLeft, Blocks, Library, Plus, Redo2, Skull, Undo2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  ABILITY_NAME,
  ABILITY_SHORT,
  CRS,
  DEFAULT_BLOCK,
  KIND_LABEL,
  SECTION_LABEL,
  SENSE_LABEL,
  SIZE_DIE,
  SIZE_LABEL,
  SKILLS,
  crCheck,
  crGuide,
  resolveCreature,
  signed,
  statsOf,
  type FullBlock,
} from '../../domain/creature';
import {
  ALIGNMENTS,
  FEATURE_TEMPLATES,
  PLACEHOLDER_HELP,
  adoptFeature,
  blankFeature,
  fromTemplate,
  typeChoices,
} from '../../domain/creatureParts';
import {
  ABILITY_KEYS,
  CREATURE_KINDS,
  CREATURE_SIZES,
  FEATURE_SECTIONS,
  type CreatureBlock,
  type CreatureFeature,
  type CreatureKind,
  type CreatureSize,
} from '../../domain/schema';
import { discardUnusedDrafts } from '../welt/actions';
import {
  Button,
  Checkbox,
  EmptyState,
  EntityPicker,
  Field,
  IconButton,
  Input,
  MenuItem,
  Popover,
  SectionTitle,
  Select,
  TextArea,
  confirmDialog,
  cx,
  useHoldDraft,
} from '../../ui';
import { addToWorld, linkAnimalCreature, saveCreature } from './actions';
import {
  EMPTY_HISTORY,
  animalPreset,
  clampNumber,
  draftInherits,
  draftOf,
  draftProblem,
  draftsDiffer,
  forgetImport,
  heirsOf,
  importNoteOf,
  keepHeir,
  moveFeature,
  parentChoices,
  parkDraft,
  parkedDraft,
  presetFor,
  recordStep,
  redoStep,
  resolveDraft,
  switchKind,
  undoStep,
  withBlock,
  type CreatureDraft,
  type DraftHistory,
} from './draft';
import {
  DefenceGrid,
  FeatureEditor,
  FeatureLibrary,
  LanguageChips,
  NumberBox,
  SECTION_ONE,
} from './EditorParts';
import { StatBlock } from './StatBlock';
import './bestiarium.css';

const SPEEDS = ['walk', 'fly', 'swim', 'climb', 'burrow'] as const;
const SPEED_NAME: Record<(typeof SPEEDS)[number], string> = {
  walk: 'Gehen',
  fly: 'Fliegen',
  swim: 'Schwimmen',
  climb: 'Klettern',
  burrow: 'Graben',
};
const SENSES = Object.keys(SENSE_LABEL) as (keyof typeof SENSE_LABEL)[];

const PARTS = [
  { id: 'grund', label: 'Grundlagen' },
  { id: 'werte', label: 'Werte' },
  { id: 'abwehr', label: 'Abwehr' },
  { id: 'sinne', label: 'Sinne und Sprachen' },
  { id: 'faehigkeiten', label: 'Fähigkeiten' },
  { id: 'welt', label: 'Welt' },
] as const;

type TextKey = 'type' | 'tags' | 'alignment' | 'acNote' | 'gear' | 'habitat' | 'treasure';
type NumberKey = 'ac' | 'hitDice' | 'attacksPerRound' | 'legendaryUses';

/** Die Wörter der Adresse für „Variante“ und „Einzelner“. */
const ART_KIND: Record<string, CreatureKind> = { variante: 'variant', einzelner: 'individual' };

export default function CreatureEditorPage() {
  const params = useParams<{ id?: string; art?: string; erbt?: string }>();
  const data = useData();
  const stored = params.id ? (data.creatures[params.id] ?? null) : null;
  if (params.id && !stored)
    return (
      <div className="wf-best-blank">
        <EmptyState icon={<Skull aria-hidden />} title="Dieses Wesen gibt es nicht mehr">
          Es wurde gelöscht oder nie gespeichert. Im Bestiarium stehen alle Wesen, die es gibt.
        </EmptyState>
      </div>
    );
  // „/bestiarium/neu/variante/<id>“ und „/bestiarium/neu/einzelner/<id>“ erben von <id>;
  // „/bestiarium/neu/tier/<id>“ legt die Kampfwerte eines Tieres der Welt an.
  const forAnimal = params.art === 'tier';
  const kind = params.art ? (ART_KIND[params.art] ?? null) : null;
  const parentId = forAnimal ? null : (params.erbt ?? null);
  const animal = forAnimal && params.erbt ? data.entities[params.erbt] : undefined;
  const key = stored ? stored.id : `neu/${params.art ?? ''}/${params.erbt ?? ''}`;
  return (
    <Editor
      key={key}
      parkKey={key}
      storedId={stored?.id ?? null}
      kind={kind}
      parentId={parentId}
      animalId={animal?.kind === 'animal' ? animal.id : null}
    />
  );
}

function Editor({
  parkKey,
  storedId,
  kind,
  parentId,
  animalId,
}: {
  parkKey: string;
  storedId: string | null;
  kind: CreatureKind | null;
  parentId: string | null;
  /** Das Tier der Welt, dessen Kampfwerte hier entstehen. */
  animalId: string | null;
}) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const stored = storedId ? (data.creatures[storedId] ?? null) : null;
  const [baseline] = useState<CreatureDraft>(() =>
    draftOf(stored, {
      ...presetFor(data.creatures, kind, parentId),
      ...animalPreset(data.entities[animalId ?? '']),
    }),
  );
  const [restored, setRestored] = useState(() => parkedDraft(parkKey) !== null);
  const [draft, setDraft] = useState<CreatureDraft>(() => parkedDraft(parkKey) ?? baseline);
  const [history, setHistory] = useState<DraftHistory>(EMPTY_HISTORY);
  const [tried, setTried] = useState(false);
  const [library, setLibrary] = useState(false);
  const [templates, setTemplates] = useState(false);
  const templateAnchor = useRef<HTMLButtonElement>(null);
  const typeList = useId();
  const alignmentList = useId();
  /** Einträge der Welt, die auf dieser Seite entstanden sind. */
  const created = useRef<string[]>([]);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const done = useRef(false);

  const dirty = draftsDiffer(draft, baseline);
  // Der Entwurf weicht ab: Der Abgleich übernimmt nichts, bis er gespeichert oder verworfen ist.
  useHoldDraft(dirty, 'creature');
  const inherits = draftInherits(draft);
  const parent = useMemo(
    () => (inherits && draft.parentId ? resolveCreature(data.creatures, draft.parentId) : null),
    [data.creatures, draft.parentId, inherits],
  );
  const base: FullBlock = parent?.block ?? DEFAULT_BLOCK;
  const preview = useMemo(
    () =>
      resolveDraft(data.creatures, { ...draft, name: draft.name.trim() || 'Neues Wesen' }, stored),
    [data.creatures, draft, stored],
  );
  const block = preview.block;
  const stats = statsOf(block);
  const check = crCheck(preview);
  const guide = crGuide(block.cr);
  const parents = useMemo(
    () => parentChoices(data.creatures, draft.kind, storedId),
    [data.creatures, draft.kind, storedId],
  );
  const types = useMemo(() => typeChoices(data), [data]);
  const problem = draftProblem(draft, data.creatures, storedId);
  const note = storedId ? importNoteOf(storedId) : null;

  // ── Ändern, Rückgängig ──
  const change = (field: string, next: (before: CreatureDraft) => CreatureDraft) => {
    const before = draftRef.current;
    const after = next(before);
    if (!draftsDiffer(before, after)) return;
    setHistory((past) => recordStep(past, before, field, Date.now()));
    draftRef.current = after;
    setDraft(after);
  };
  const setBlock = (field: string, part: CreatureBlock) =>
    change(field, (before) => withBlock(before, part));
  const set = (field: string, part: Partial<CreatureDraft>) =>
    change(field, (before) => ({ ...before, ...part }));
  const step = (direction: 'undo' | 'redo') => {
    const result =
      direction === 'undo'
        ? undoStep(history, draftRef.current)
        : redoStep(history, draftRef.current);
    if (!result) return;
    draftRef.current = result.draft;
    setDraft(result.draft);
    setHistory(result.history);
  };

  // ── Speichern, Abbrechen ──
  const save = () => {
    setTried(true);
    if (problem) return;
    const saved = db.batch(() => {
      const creature = saveCreature(db, draft, storedId ?? undefined);
      // Kampfwerte eines Tieres: Das Tier zeigt danach auf sie.
      if (animalId) linkAnimalCreature(db, animalId, creature.id);
      // Eine Spezies, die hier angelegt und dann doch nicht gewählt wurde, bleibt nicht liegen.
      discardUnusedDrafts(
        db,
        created.current.filter((id) => data.entities[id]?.kind === 'species'),
        creature.speciesId ? [creature.speciesId] : [],
      );
      return creature;
    });
    done.current = true;
    parkDraft(parkKey, null);
    forgetImport(saved.id);
    navigate(`/bestiarium/${saved.id}`);
  };
  const leave = () =>
    navigate(`/bestiarium/${storedId ?? draft.parentId ?? ''}`.replace(/\/$/, ''));
  const cancel = async () => {
    // Auch was hier in der Welt angelegt wurde, räumt Abbrechen weg – also erst fragen.
    const madeHere = created.current.filter((id) => db.getSnapshot().entities[id]);
    if (dirty || madeHere.length) {
      const ok = await confirmDialog({
        title: 'Änderungen verwerfen?',
        body: madeHere.length
          ? 'Was du seit dem Öffnen eingetragen hast, geht verloren – auch was du dabei in der Welt angelegt hast, sofern es nirgends gebraucht wird.'
          : 'Was du seit dem Öffnen eingetragen hast, geht verloren.',
        confirmLabel: 'Verwerfen',
        danger: true,
      });
      if (!ok) return;
    }
    done.current = true;
    discardUnusedDrafts(db, created.current, []);
    parkDraft(parkKey, null);
    if (storedId) forgetImport(storedId);
    leave();
  };

  // Wer die Seite ohne Speichern verlässt, findet seinen Entwurf beim Zurückkommen wieder.
  useEffect(
    () => () => {
      if (done.current) return;
      parkDraft(parkKey, draftsDiffer(draftRef.current, baseline) ? draftRef.current : null);
    },
    [parkKey, baseline],
  );

  // Strg+Z, Strg+Umschalt+Z (oder Strg+Y), Strg+S – nur, solange kein Dialog darüber liegt.
  const keys = useRef({ step, save });
  keys.current = { step, save };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const letter = event.key.toLowerCase();
      if (letter === 'z' || letter === 'y') {
        event.preventDefault();
        keys.current.step(letter === 'y' || event.shiftKey ? 'redo' : 'undo');
      } else if (letter === 's') {
        event.preventDefault();
        keys.current.save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Felder ──
  const text = (field: TextKey, label: string, hint?: string, list?: string) => (
    <Field label={label} hint={hint}>
      <Input
        value={draft.block[field] ?? ''}
        list={list}
        placeholder={inherits ? base[field] || '—' : undefined}
        onChange={(event) => setBlock(field, { [field]: event.target.value || undefined })}
      />
    </Field>
  );
  const number = (field: NumberKey, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <NumberBox
        value={draft.block[field]}
        placeholder={String(base[field])}
        onValue={(value) =>
          setBlock(field, {
            [field]: value === undefined ? undefined : clampNumber(field, value),
          })
        }
      />
    </Field>
  );
  /** Eine Gruppe von Zahlen (Attribute, Bewegung, Sinne): Sie gilt ganz oder wird ganz geerbt. */
  const groupValue = <K extends 'abilities' | 'speed' | 'senses'>(
    field: K,
    part: keyof FullBlock[K] & string,
  ) => {
    const own = draft.block[field] as Record<string, number> | undefined;
    const from = base[field] as Record<string, number>;
    return {
      value: own ? own[part] : undefined,
      placeholder: String(from[part]),
      onValue: (value: number | undefined) => {
        if (value === undefined) return;
        setBlock(`${field}.${part}`, {
          [field]: { ...from, ...own, [part]: clampNumber(field, value) },
        } as CreatureBlock);
      },
      // Leer verlassen heißt: wieder der Wert, der ohne eigene Angabe gälte. Die ganze Gruppe
      // setzt „erben“ zurück.
      onCleared: () => {
        if (!own) return;
        setBlock(`${field}.${part}`, {
          [field]: { ...from, ...own, [part]: from[part] },
        } as CreatureBlock);
      },
    };
  };
  const group = <K extends 'speed' | 'senses'>(
    field: K,
    part: keyof FullBlock[K] & string,
    label: string,
  ) => {
    const box = groupValue(field, part);
    return (
      <label key={part} className="wf-best-num" title={`${label} in Fuß`}>
        <span>{label}</span>
        <NumberBox
          value={box.value}
          placeholder={box.placeholder}
          onValue={box.onValue}
          onCleared={box.onCleared}
        />
      </label>
    );
  };
  const reset = (field: keyof CreatureBlock, label: string) =>
    inherits &&
    draft.block[field] !== undefined && (
      <button
        type="button"
        className="wf-best-reset"
        title={`${label} wieder von „${parent?.creature.name}“ erben`}
        onClick={() => setBlock(field, { [field]: undefined })}
      >
        <Undo2 aria-hidden /> erben
      </button>
    );

  const saves = block.saves;
  const skills = block.skills;
  const addFeature = (feature: CreatureFeature) =>
    change(`feature+${feature.id}`, (before) => ({
      ...before,
      features: [...before.features, feature],
    }));
  const setFeature = (id: string, part: Partial<CreatureFeature>) =>
    change(`feature.${id}.${Object.keys(part).join()}`, (before) => ({
      ...before,
      features: before.features.map((entry) => (entry.id === id ? { ...entry, ...part } : entry)),
    }));
  const createdHere = (id: string) => created.current.push(id);
  const title = stored ? `„${stored.name}“ bearbeiten` : 'Neues Wesen';

  return (
    <div className="wf-best-edit">
      <header className="wf-best-edit__bar">
        <IconButton size="sm" variant="ghost" label="Zurück ohne Speichern" onClick={cancel}>
          <ArrowLeft aria-hidden />
        </IconButton>
        <div className="wf-best-edit__title">
          <span className="wf-best-bar__kind">{KIND_LABEL[draft.kind]}</span>
          <h1>{title}</h1>
        </div>
        <span className="wf-grow" />
        <span
          className={cx('wf-best-edit__state', tried && problem && 'wf-best-edit__state--problem')}
        >
          {tried && problem ? problem : dirty ? 'Nicht gespeichert' : 'Nichts geändert'}
        </span>
        <IconButton
          size="sm"
          label="Rückgängig (Strg+Z)"
          disabled={!history.past.length}
          onClick={() => step('undo')}
        >
          <Undo2 aria-hidden />
        </IconButton>
        <IconButton
          size="sm"
          label="Wiederholen (Strg+Umschalt+Z)"
          disabled={!history.future.length}
          onClick={() => step('redo')}
        >
          <Redo2 aria-hidden />
        </IconButton>
        <Button variant="ghost" onClick={cancel}>
          Abbrechen
        </Button>
        <Button variant="primary" title="Speichern (Strg+S)" onClick={save}>
          Speichern
        </Button>
      </header>

      <div className="wf-best-edit__body">
        <div className="wf-best-edit__form">
          <nav className="wf-best-edit__jump" aria-label="Abschnitte">
            {PARTS.map((part) => (
              <button
                key={part.id}
                type="button"
                onClick={() =>
                  document
                    .getElementById(`wf-best-edit-${part.id}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                {part.label}
              </button>
            ))}
          </nav>

          {restored && (
            <p className="wf-best-edit__notice">
              Dein Entwurf von vorhin ist wieder da – er war noch nicht gespeichert.{' '}
              <button
                type="button"
                className="wf-best-reset"
                onClick={() => {
                  setRestored(false);
                  change('alles', () => baseline);
                }}
              >
                Verwerfen
              </button>
            </p>
          )}
          {note && (
            <div className="wf-best-edit__notice">
              <b>Eingelesen – bitte prüfen.</b>
              {note.missing.length > 0 && <span>Nicht gefunden: {note.missing.join(', ')}.</span>}
              {note.unread.length > 0 && <span>Nicht verstanden: {note.unread.join(' · ')}</span>}
              {note.notes.map((line, index) => (
                <span key={index}>{line}</span>
              ))}
            </div>
          )}

          <Part id="grund" title="Grundlagen">
            <div className="wf-best-form__row wf-best-form__row--head">
              <Field label="Name">
                <Input
                  value={draft.name}
                  autoFocus={!stored}
                  onChange={(event) => set('name', { name: event.target.value })}
                />
              </Field>
              <Field
                label="Art"
                hint={draft.kind === 'template' ? 'der Statblock selbst' : undefined}
              >
                <Select
                  value={draft.kind}
                  aria-label="Art"
                  onChange={(event) =>
                    change('kind', (before) =>
                      switchKind(
                        data.creatures,
                        before,
                        stored,
                        event.target.value as CreatureKind,
                      ),
                    )
                  }
                >
                  {CREATURE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABEL[kind]}
                    </option>
                  ))}
                </Select>
              </Field>
              {draft.kind !== 'template' && (
                <Field label="Erbt von">
                  <Select
                    value={draft.parentId ?? ''}
                    aria-label="Erbt von"
                    onChange={(event) => set('parentId', { parentId: event.target.value || null })}
                  >
                    <option value="">Bitte wählen …</option>
                    {parents.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <div className="wf-best-form__row">
              <Field label="Spezies" hint="aus der Welt – fehlt sie, lege sie hier an">
                <EntityPicker
                  value={draft.speciesId}
                  kinds={['species']}
                  placeholder="Spezies wählen oder neu anlegen …"
                  onChange={(speciesId) => set('speciesId', { speciesId })}
                  onCreate={(name) => {
                    const result = addToWorld(db, 'species', name)!;
                    if (result.created) createdHere(result.entity.id);
                    return result.entity.id;
                  }}
                />
              </Field>
              <Field label="Quelle" hint="Eigenbau, ein Buch mit Seite …">
                <Input
                  value={draft.source}
                  placeholder={parent?.source}
                  onChange={(event) => set('source', { source: event.target.value })}
                />
              </Field>
            </div>
            {inherits && (
              <p className="wf-best-form__note">
                Leere Felder erbt das Wesen von „{parent?.creature.name}“ – der geerbte Wert steht
                blass im Feld. Trag nur ein, was abweicht.
              </p>
            )}
          </Part>

          <Part id="werte" title="Werte">
            <div className="wf-best-form__row">
              <Field label="Größe" hint={`Trefferwürfel: W${SIZE_DIE[block.size]}`}>
                <Select
                  value={draft.block.size ?? ''}
                  aria-label="Größe"
                  onChange={(event) =>
                    setBlock('size', {
                      size: (event.target.value || undefined) as CreatureSize | undefined,
                    })
                  }
                >
                  <option value="">
                    {inherits ? `${SIZE_LABEL[base.size]} (geerbt)` : SIZE_LABEL[base.size]}
                  </option>
                  {CREATURE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {SIZE_LABEL[size]}
                    </option>
                  ))}
                </Select>
              </Field>
              {text('type', 'Typ', 'wählen oder schreiben', typeList)}
              {text('tags', 'Zusatz', 'in Klammern, etwa Goblinoide')}
              {text('alignment', 'Gesinnung', undefined, alignmentList)}
              <datalist id={typeList}>
                {types.map((type) => (
                  <option key={type} value={type} />
                ))}
              </datalist>
              <datalist id={alignmentList}>
                {ALIGNMENTS.map((alignment) => (
                  <option key={alignment} value={alignment} />
                ))}
              </datalist>
            </div>
            <div className="wf-best-form__row">
              {number('ac', 'Rüstungsklasse')}
              {text('acNote', 'Rüstung', 'etwa Lederrüstung, Schild')}
              {number('hitDice', 'Trefferwürfel', 'Anzahl')}
              <Field label="TP festlegen" hint="nur, wenn sie nicht aus den Würfeln folgen">
                <NumberBox
                  value={draft.block.hp}
                  placeholder={String(stats.hp)}
                  onValue={(value) =>
                    // Leer heißt: aus den Würfeln rechnen (oder erben) – nichts festlegen.
                    setBlock('hp', {
                      hp: value && value > 0 ? clampNumber('hp', value) : undefined,
                    })
                  }
                />
              </Field>
            </div>
            <div className="wf-best-form__row">
              <Field label="Herausforderungsgrad" hint={`${stats.xp.toLocaleString('de-DE')} EP`}>
                <Select
                  value={draft.block.cr ?? ''}
                  aria-label="Herausforderungsgrad"
                  onChange={(event) => setBlock('cr', { cr: event.target.value || undefined })}
                >
                  <option value="">{inherits ? `${base.cr} (geerbt)` : base.cr}</option>
                  {CRS.map((cr) => (
                    <option key={cr} value={cr}>
                      {cr}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Initiative"
                hint={`${signed(stats.initiative)} (${10 + stats.initiative})`}
              >
                <Select
                  value={draft.block.initiative ?? ''}
                  aria-label="Übung in Initiative"
                  onChange={(event) =>
                    setBlock('initiative', {
                      initiative:
                        event.target.value === '' ? undefined : Number(event.target.value),
                    })
                  }
                >
                  <option value="">{inherits ? 'geerbt' : 'ohne Übung'}</option>
                  <option value="0">ohne Übung</option>
                  <option value="1">geübt</option>
                  <option value="2">Expertise</option>
                </Select>
              </Field>
              {number('attacksPerRound', 'Angriffe je Runde', 'für die Einschätzung des HG')}
            </div>
            <p className="wf-best-form__math">
              Wayfarer rechnet: <b>TP {stats.hp}</b>
              {block.hp === null ? ` (${stats.hpFormula})` : ' (festgelegt)'} ·{' '}
              <b>Übungsbonus {signed(stats.pb)}</b> · Initiative {signed(stats.initiative)} ·
              passive Wahrnehmung {stats.passivePerception}
            </p>

            <div className="wf-best-edit__label">
              Attribute – darunter die Übung im Rettungswurf {reset('abilities', 'Attribute')}{' '}
              {reset('saves', 'Rettungswürfe')}
            </div>
            <div className="wf-best-edit__abilities">
              {ABILITY_KEYS.map((ability) => {
                const box = groupValue('abilities', ability);
                return (
                  <div key={ability} className="wf-best-edit__ability">
                    <span title={ABILITY_NAME[ability]}>{ABILITY_SHORT[ability]}</span>
                    <NumberBox
                      value={box.value}
                      placeholder={box.placeholder}
                      aria-label={ABILITY_NAME[ability]}
                      onValue={box.onValue}
                      onCleared={box.onCleared}
                    />
                    <b>{signed(stats.mods[ability])}</b>
                    <button
                      type="button"
                      className="wf-best-chip"
                      data-level={saves.includes(ability) ? 1 : 0}
                      title={`Übung im Rettungswurf auf ${ABILITY_NAME[ability]}`}
                      onClick={() =>
                        setBlock('saves', {
                          saves: saves.includes(ability)
                            ? saves.filter((entry) => entry !== ability)
                            : ABILITY_KEYS.filter(
                                (entry) => entry === ability || saves.includes(entry),
                              ),
                        })
                      }
                    >
                      RW {signed(stats.saves[ability])}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="wf-best-form__skills">
              <span className="wf-best-form__label">
                Fertigkeiten – ein Klick: geübt, noch einer: Expertise{' '}
                {reset('skills', 'Fertigkeiten')}
              </span>
              {Object.entries(SKILLS).map(([skill, entry]) => {
                const level = skills[skill] ?? 0;
                return (
                  <button
                    key={skill}
                    type="button"
                    className="wf-best-chip"
                    data-level={level}
                    title={`${entry.label} (${ABILITY_SHORT[entry.ability]})`}
                    onClick={() => {
                      const next = { ...skills };
                      if (level === 2) delete next[skill];
                      else next[skill] = level + 1;
                      setBlock('skills', { skills: next });
                    }}
                  >
                    {entry.label}
                    {level > 0 &&
                      ` ${signed(stats.mods[entry.ability] + stats.pb * level)}${level === 2 ? ' ★' : ''}`}
                  </button>
                );
              })}
            </div>
          </Part>

          <Part id="abwehr" title="Abwehr">
            <p className="wf-best-edit__hint">
              Ein Klick auf eine Schadensart: resistent, noch einer: immun, dann anfällig, dann
              wieder nichts. {reset('resistant', 'Resistenzen')} {reset('immune', 'Immunitäten')}{' '}
              {reset('vulnerable', 'Anfälligkeiten')}{' '}
              {reset('conditionImmune', 'Zustandsimmunitäten')}
            </p>
            <DefenceGrid block={block} onChange={(part) => setBlock('abwehr', part)} />
          </Part>

          <Part id="sinne" title="Bewegung, Sinne und Sprachen">
            <div className="wf-best-form__nums">
              {SPEEDS.map((speed) => group('speed', speed, SPEED_NAME[speed]))}
              <Checkbox checked={block.hover} onChange={(hover) => setBlock('hover', { hover })}>
                schwebt
              </Checkbox>
              {reset('speed', 'Bewegung')}
            </div>
            <div className="wf-best-form__nums">
              {SENSES.map((sense) => group('senses', sense, SENSE_LABEL[sense]))}
              <span className="wf-best-edit__hint">
                passive Wahrnehmung {stats.passivePerception}
              </span>
              {reset('senses', 'Sinne')}
            </div>
            <div className="wf-best-edit__label">
              Sprachen – aus der Welt oder frei, etwa „Telepathie 60 Fuß“{' '}
              {reset('languages', 'Sprachen')}
            </div>
            <LanguageChips
              value={block.languages}
              onChange={(languages) => setBlock('languages', { languages })}
              onCreated={createdHere}
            />
          </Part>

          <Part id="faehigkeiten" title="Fähigkeiten">
            <div className="wf-best-edit__tools">
              <Button
                size="sm"
                icon={<Library aria-hidden />}
                aria-pressed={library}
                onClick={() => setLibrary((open) => !open)}
              >
                {library ? 'Bibliothek schließen' : 'Aus der Bibliothek'}
              </Button>
              <Button
                ref={templateAnchor}
                size="sm"
                icon={<Blocks aria-hidden />}
                onClick={() => setTemplates((open) => !open)}
              >
                Gerüst einfügen
              </Button>
              <Popover
                open={templates}
                onClose={() => setTemplates(false)}
                anchor={templateAnchor}
                width={340}
              >
                {FEATURE_TEMPLATES.map((template) => (
                  <MenuItem
                    key={template.key}
                    onClick={() => {
                      setTemplates(false);
                      const feature = fromTemplate(template.key, block);
                      if (feature) addFeature(feature);
                    }}
                  >
                    {template.label}
                    <span className="wf-best-edit__menu-hint">{template.hint}</span>
                  </MenuItem>
                ))}
              </Popover>
              <span className="wf-best-edit__hint">{PLACEHOLDER_HELP}</span>
            </div>
            {library && (
              <FeatureLibrary exceptId={storedId} onAdopt={(feature) => addFeature(feature)} />
            )}
            {FEATURE_SECTIONS.map((section) => {
              const heirs = heirsOf(parent, draft, section);
              const own = draft.features.filter((feature) => feature.section === section);
              return (
                <div key={section} className="wf-best-edit__section">
                  <div className="wf-best-edit__section-head">
                    <span>{SECTION_LABEL[section]}</span>
                    {section === 'legendary' && (
                      <label className="wf-best-edit__legendary">
                        je Runde
                        <NumberBox
                          value={draft.block.legendaryUses}
                          placeholder={String(base.legendaryUses || '–')}
                          aria-label="Legendäre Aktionen je Runde"
                          onValue={(value) =>
                            setBlock('legendaryUses', {
                              legendaryUses:
                                value === undefined
                                  ? undefined
                                  : clampNumber('legendaryUses', value),
                            })
                          }
                        />
                      </label>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Plus aria-hidden />}
                      onClick={() => addFeature(blankFeature(section))}
                    >
                      {SECTION_ONE[section]}
                    </Button>
                  </div>
                  {heirs.map(({ feature, dropped, replaced }) => (
                    <div key={feature.id} className="wf-best-form__heir">
                      <Checkbox
                        checked={!dropped}
                        onChange={(keep) =>
                          change(`drop.${feature.name}`, (before) =>
                            keepHeir(before, feature.name, keep),
                          )
                        }
                      >
                        {feature.name}
                        <em>
                          {' '}
                          · geerbt{replaced && ', hier abgewandelt'}
                          {dropped && ', abgelegt'}
                        </em>
                      </Checkbox>
                      {!replaced && !dropped && (
                        <button
                          type="button"
                          className="wf-best-reset"
                          title="Eine eigene Fassung anlegen, die die geerbte ersetzt"
                          onClick={() => addFeature(adoptFeature(feature))}
                        >
                          abwandeln
                        </button>
                      )}
                    </div>
                  ))}
                  {own.map((feature, index) => (
                    <FeatureEditor
                      key={feature.id}
                      feature={feature}
                      block={block}
                      first={index === 0}
                      last={index === own.length - 1}
                      onChange={(part) => setFeature(feature.id, part)}
                      onMove={(delta) =>
                        change(`move.${feature.id}`, (before) => ({
                          ...before,
                          features: moveFeature(before.features, feature.id, delta),
                        }))
                      }
                      onRemove={() =>
                        change(`remove.${feature.id}`, (before) => ({
                          ...before,
                          features: before.features.filter((entry) => entry.id !== feature.id),
                        }))
                      }
                      onKept={createdHere}
                    />
                  ))}
                </div>
              );
            })}
          </Part>

          <Part id="welt" title="Welt">
            <div className="wf-best-form__row">
              {text('habitat', 'Lebensraum', 'mit Komma getrennt: Wald, Hügel')}
              {text('treasure', 'Schatz')}
              {text('gear', 'Ausrüstung')}
            </div>
            <Field label="Notizen">
              <TextArea
                value={draft.notes}
                rows={3}
                onChange={(event) => set('notes', { notes: event.target.value })}
              />
            </Field>
          </Part>
        </div>

        <aside className="wf-best-edit__preview" aria-label="Vorschau">
          <div
            className={cx(
              'wf-best-check',
              `wf-best-check--${check.verdict}`,
              'wf-best-edit__check',
            )}
          >
            <b>Einschätzung:</b> {check.text} Merkmale und Zauber rechnet die Faustregel nicht mit.
            <span className="wf-best-edit__guide">
              Richtwerte für HG {block.cr}: RK {guide.ac} · bis {guide.hp} TP · Angriff{' '}
              {signed(guide.attack)} · bis {guide.damage} Schaden je Runde
            </span>
          </div>
          <StatBlock resolved={preview} preview />
        </aside>
      </div>
    </div>
  );
}

/** Ein Abschnitt des Formulars – Ziel der Sprungleiste. */
function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`wf-best-edit-${id}`} className="wf-best-edit__part">
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  );
}
