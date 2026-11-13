/**
 * Teile der Seite „Wesen bearbeiten“: Abwehr zum Anklicken, Sprachen als Chips, eine Fähigkeit
 * bearbeiten und die Bibliothek der Fähigkeiten. Gerechnet wird in `domain/creatureParts.ts` und
 * `domain/creature.ts`.
 */
import { useId, useMemo, useState } from 'react';
import { BookPlus, ChevronDown, ChevronUp, Globe, Plus, Trash2, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  ABILITY_SHORT,
  SECTION_LABEL,
  attackMath,
  saveDcOf,
  signed,
  statsOf,
  type FullBlock,
} from '../../domain/creature';
import {
  CONDITIONS,
  DAMAGE_TYPES,
  DEFENCE_LABEL,
  DEFENCE_LEVELS,
  USES_CHOICES,
  abilityEntryText,
  adoptFeature,
  defenceChange,
  defenceOf,
  extrasOf,
  featureLibrary,
  languageChoices,
  listHas,
  namedEntry,
  removeFromList,
  addToList,
  searchLibrary,
  toggleInList,
  withExtras,
  wordsWithEntries,
  type DefenceLevel,
} from '../../domain/creatureParts';
import {
  ABILITY_KEYS,
  FEATURE_SECTIONS,
  type AbilityKey,
  type CreatureBlock,
  type CreatureFeature,
  type FeatureSection,
} from '../../domain/schema';
import { Button, Checkbox, IconButton, Input, Select, TextArea } from '../../ui';
import { addToWorld } from './actions';

/** Ein Wort für die Mehrzahl der Abschnitte – „Aktion“ statt „Aktionen“. */
export const SECTION_ONE: Record<FeatureSection, string> = {
  trait: 'Merkmal',
  action: 'Aktion',
  bonus: 'Bonusaktion',
  reaction: 'Reaktion',
  legendary: 'Legendäre Aktion',
};

const DEFENCE_TITLE: Record<DefenceLevel, string> = {
  resistant: 'Weitere Resistenzen',
  immune: 'Weitere Immunitäten',
  vulnerable: 'Weitere Anfälligkeiten',
};

// ── Abwehr ─────────────────────────────────────────────────────────────────

/**
 * Schadensarten zum Anklicken: keiner → resistent → immun → anfällig. Was nicht zu den
 * Schadensarten gehört („Hieb aus Silberwaffen“), steht frei darunter.
 */
export function DefenceGrid({
  block,
  onChange,
}: {
  block: FullBlock;
  onChange: (change: CreatureBlock) => void;
}) {
  return (
    <div className="wf-best-edit__defence">
      <div className="wf-best-edit__chips">
        {DAMAGE_TYPES.map((word) => {
          const level = defenceOf(block, word);
          return (
            <button
              key={word}
              type="button"
              className="wf-best-chip wf-best-edit__def"
              data-state={level ?? 'none'}
              title={`${word}: ${level ? DEFENCE_LABEL[level] : 'nichts Besonderes'} – klicken zum Ändern`}
              onClick={() => onChange(defenceChange(block, word))}
            >
              {word}
              {level && <em>{DEFENCE_LABEL[level]}</em>}
            </button>
          );
        })}
      </div>
      <div className="wf-best-edit__row3">
        {DEFENCE_LEVELS.map((level) => (
          <ExtrasInput
            key={level}
            label={DEFENCE_TITLE[level]}
            value={extrasOf(block[level], DAMAGE_TYPES).join(', ')}
            onCommit={(extras) =>
              onChange({ [level]: withExtras(block[level], DAMAGE_TYPES, extras) })
            }
          />
        ))}
      </div>
      <div className="wf-best-edit__label">Zustandsimmunitäten</div>
      <div className="wf-best-edit__chips">
        {CONDITIONS.map((word) => (
          <button
            key={word}
            type="button"
            className="wf-best-chip"
            data-level={listHas(block.conditionImmune, word) ? 1 : 0}
            onClick={() => onChange({ conditionImmune: toggleInList(block.conditionImmune, word) })}
          >
            {word}
          </button>
        ))}
        <ExtrasInput
          label="Weitere"
          inline
          value={extrasOf(block.conditionImmune, CONDITIONS).join(', ')}
          onCommit={(extras) =>
            onChange({ conditionImmune: withExtras(block.conditionImmune, CONDITIONS, extras) })
          }
        />
      </div>
    </div>
  );
}

/** Ein freies Feld, das beim Verlassen schreibt – damit Kommas beim Tippen nicht springen. */
function ExtrasInput({
  label,
  value,
  onCommit,
  inline = false,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  inline?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label
      className={inline ? 'wf-best-edit__extra wf-best-edit__extra--inline' : 'wf-best-edit__extra'}
    >
      <span>{label}</span>
      <Input
        value={text ?? value}
        placeholder="mit Komma getrennt"
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text !== null && text !== value) onCommit(text);
          setText(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

/**
 * Ein Zahlenfeld, das beim Tippen nicht dazwischenfährt: Was gerade im Feld steht, bleibt
 * stehen, bis man es verlässt – auch ein leeres Feld oder eine Zahl außerhalb der Grenzen.
 * Weitergegeben wird nur, was sich lesen lässt; leer heißt `undefined`.
 */
export function NumberBox({
  value,
  placeholder,
  onValue,
  onCleared,
  ...rest
}: {
  value: number | null | undefined;
  placeholder?: string;
  onValue: (value: number | undefined) => void;
  /** Das Feld wurde leer verlassen. */
  onCleared?: () => void;
  'aria-label'?: string;
  title?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = value === null || value === undefined ? '' : String(value);
  return (
    <Input
      {...rest}
      value={text ?? shown}
      inputMode="numeric"
      placeholder={placeholder}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        const number = Math.round(Number(raw.replace(',', '.')));
        onValue(raw.trim() && Number.isFinite(number) ? number : undefined);
      }}
      onBlur={() => {
        if (text !== null && !text.trim()) onCleared?.();
        setText(null);
      }}
    />
  );
}

// ── Sprachen ───────────────────────────────────────────────────────────────

/**
 * Sprachen als Chips: wählen aus den Sprachen der Welt und dem, was andere Wesen sprechen; was
 * die Welt noch nicht kennt, lässt sich dort anlegen. „Telepathie 60 Fuß“ oder „versteht
 * Gemeinsprache“ schreibt man frei dazu.
 */
export function LanguageChips({
  value,
  onChange,
  onCreated,
}: {
  value: string;
  onChange: (value: string) => void;
  onCreated: (entityId: string) => void;
}) {
  const db = useDb();
  const data = useData();
  const list = useId();
  const [typed, setTyped] = useState('');
  const chosen = useMemo(() => wordsWithEntries(data, 'language', value), [data, value]);
  const choices = useMemo(() => languageChoices(data, value), [data, value]);
  const add = () => {
    if (!typed.trim()) return;
    onChange(addToList(value, typed));
    setTyped('');
  };
  return (
    <div className="wf-best-edit__chips">
      {chosen.map(({ word, entityId }) => (
        <span key={word} className="wf-best-edit__lang" data-world={entityId !== null}>
          {entityId && <Globe aria-hidden />}
          {word}
          {!entityId && (
            <button
              type="button"
              title={`„${word}“ in der Welt als Sprache anlegen`}
              onClick={() => {
                const result = addToWorld(db, 'language', word);
                if (result?.created) onCreated(result.entity.id);
              }}
            >
              <BookPlus aria-hidden />
            </button>
          )}
          <button
            type="button"
            title={`„${word}“ entfernen`}
            onClick={() => onChange(removeFromList(value, word))}
          >
            <X aria-hidden />
          </button>
        </span>
      ))}
      <Input
        className="wf-best-edit__lang-input"
        value={typed}
        list={list}
        placeholder={chosen.length ? 'Weitere Sprache …' : 'Sprache wählen oder schreiben …'}
        aria-label="Sprache hinzufügen"
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          add();
        }}
        onBlur={add}
      />
      <datalist id={list}>
        {choices.map((choice) => (
          <option key={choice.word} value={choice.word} />
        ))}
      </datalist>
    </div>
  );
}

// ── Eine Fähigkeit ─────────────────────────────────────────────────────────

/** Eine Fähigkeit bearbeiten – mit Angriff, Rettungswurf und Nutzung, die Wayfarer rechnet. */
export function FeatureEditor({
  feature,
  block,
  first,
  last,
  onChange,
  onRemove,
  onMove,
  onKept,
}: {
  feature: CreatureFeature;
  block: FullBlock;
  first: boolean;
  last: boolean;
  onChange: (change: Partial<CreatureFeature>) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
  onKept: (entityId: string) => void;
}) {
  const db = useDb();
  const data = useData();
  const usesList = useId();
  const attack = feature.attack;
  const setAttack = (change: Partial<NonNullable<CreatureFeature['attack']>>) =>
    attack && onChange({ attack: { ...attack, ...change } });
  const stats = statsOf(block);
  const math = attack ? attackMath(block, attack) : null;
  const dc = saveDcOf(block, feature);
  const inWorld = feature.name.trim() ? namedEntry(data, 'ability', feature.name) : null;
  return (
    <div className="wf-best-edit__feat">
      <div className="wf-best-edit__feat-head">
        <Input
          value={feature.name}
          placeholder="Name – etwa „Biss“"
          aria-label="Name der Fähigkeit"
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <Input
          value={feature.uses}
          list={usesList}
          placeholder="Nutzung"
          title="Wie oft: Aufladung 5–6, 3/Tag, kostet 2 Aktionen – leer, wenn ohne Grenze"
          aria-label="Nutzung"
          onChange={(event) => onChange({ uses: event.target.value })}
        />
        <datalist id={usesList}>
          {USES_CHOICES.map((choice) => (
            <option key={choice} value={choice} />
          ))}
        </datalist>
        <Select
          value={feature.section}
          aria-label="Abschnitt"
          onChange={(event) => onChange({ section: event.target.value as FeatureSection })}
        >
          {FEATURE_SECTIONS.map((section) => (
            <option key={section} value={section}>
              {SECTION_ONE[section]}
            </option>
          ))}
        </Select>
        <span className="wf-best-edit__feat-tools">
          <IconButton size="sm" label="Nach oben" disabled={first} onClick={() => onMove(-1)}>
            <ChevronUp aria-hidden />
          </IconButton>
          <IconButton size="sm" label="Nach unten" disabled={last} onClick={() => onMove(1)}>
            <ChevronDown aria-hidden />
          </IconButton>
          <IconButton size="sm" label="Fähigkeit entfernen" onClick={onRemove}>
            <Trash2 aria-hidden />
          </IconButton>
        </span>
      </div>
      <div className="wf-best-edit__feat-opts">
        <Checkbox
          checked={attack !== null}
          onChange={(on) =>
            onChange({
              attack: on
                ? {
                    ranged: false,
                    ability: block.abilities.dex > block.abilities.str ? 'dex' : 'str',
                    bonus: null,
                    reach: '5 Fuß',
                    dice: '1W6',
                    addMod: true,
                    damageType: '',
                  }
                : null,
            })
          }
        >
          Angriff
        </Checkbox>
        <Select
          value={feature.saveAbility ?? ''}
          aria-label="Rettungswurf"
          title="Verlangt die Fähigkeit einen Rettungswurf, rechnet Wayfarer den SG aus diesem Attribut des Wesens"
          onChange={(event) =>
            onChange({ saveAbility: (event.target.value || null) as AbilityKey | null })
          }
        >
          <option value="">kein Rettungswurf</option>
          {ABILITY_KEYS.map((key) => (
            <option key={key} value={key}>
              SG {saveDcOf(block, { saveAbility: key, saveDc: null })} aus {ABILITY_SHORT[key]}
            </option>
          ))}
        </Select>
        {math && (
          <span className="wf-best-edit__feat-math">
            {signed(math.bonus)} zum Treffen
            {math.average !== null && ` · ${math.average} (${math.formula}) Schaden`}
          </span>
        )}
        {dc !== null && !math && <span className="wf-best-edit__feat-math">SG {dc}</span>}
      </div>
      {attack && (
        <div className="wf-best-edit__feat-attack">
          <Select
            value={attack.ranged ? 'r' : 'm'}
            aria-label="Nah- oder Fernkampf"
            onChange={(event) => setAttack({ ranged: event.target.value === 'r' })}
          >
            <option value="m">Nahkampf</option>
            <option value="r">Fernkampf</option>
          </Select>
          <Select
            value={attack.ability}
            aria-label="Attribut des Angriffs"
            onChange={(event) => setAttack({ ability: event.target.value as AbilityKey })}
          >
            {ABILITY_KEYS.map((key) => (
              <option key={key} value={key}>
                {ABILITY_SHORT[key]} {signed(stats.mods[key] + stats.pb)}
              </option>
            ))}
          </Select>
          <Input
            value={attack.dice}
            placeholder="1W6"
            aria-label="Schadenswürfel"
            title="Schadenswürfel, etwa 1W6 oder 2W8"
            onChange={(event) => setAttack({ dice: event.target.value })}
          />
          <Select
            value={DAMAGE_TYPES.includes(attack.damageType) ? attack.damageType : ''}
            aria-label="Schadensart"
            onChange={(event) => setAttack({ damageType: event.target.value })}
          >
            <option value="">{attack.damageType || 'Schadensart'}</option>
            {DAMAGE_TYPES.map((word) => (
              <option key={word} value={word}>
                {word}
              </option>
            ))}
          </Select>
          <Input
            value={attack.reach}
            placeholder="Reichweite"
            aria-label="Reichweite"
            onChange={(event) => setAttack({ reach: event.target.value })}
          />
          <Checkbox checked={attack.addMod} onChange={(addMod) => setAttack({ addMod })}>
            Attribut zum Schaden
          </Checkbox>
        </div>
      )}
      <TextArea
        value={feature.text}
        rows={2}
        placeholder={attack ? 'Was beim Treffer sonst noch geschieht' : 'Was die Fähigkeit tut'}
        aria-label="Text der Fähigkeit"
        onChange={(event) => onChange({ text: event.target.value })}
      />
      {!attack && feature.name.trim() && (
        <div className="wf-best-edit__feat-world">
          {inWorld ? (
            <span>
              <Globe aria-hidden /> Steht in der Welt als Fähigkeit „{inWorld.name}“.
            </span>
          ) : (
            <button
              type="button"
              className="wf-best-reset"
              title="Als Eintrag der Art „Fähigkeit“ in der Welt ablegen – damit Personen sie haben können"
              onClick={() => {
                const result = addToWorld(db, 'ability', feature.name, abilityEntryText(feature));
                if (result?.created) onKept(result.entity.id);
              }}
            >
              <BookPlus aria-hidden /> In der Welt als Fähigkeit ablegen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Bibliothek ─────────────────────────────────────────────────────────────

/** Fähigkeiten aus dem Bestiarium und der Welt suchen und als eigene übernehmen. */
export function FeatureLibrary({
  exceptId,
  onAdopt,
}: {
  exceptId: string | null;
  onAdopt: (feature: CreatureFeature) => void;
}) {
  const data = useData();
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<FeatureSection | ''>('');
  const library = useMemo(() => featureLibrary(data, exceptId), [data, exceptId]);
  const hits = useMemo(
    () => searchLibrary(library, query, section || null),
    [library, query, section],
  );
  return (
    <div className="wf-best-edit__library">
      <div className="wf-best-edit__library-search">
        <Input
          value={query}
          autoFocus
          placeholder="Fähigkeit suchen – Name, Text oder Wesen …"
          aria-label="Fähigkeit suchen"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          value={section}
          aria-label="Abschnitt"
          onChange={(event) => setSection(event.target.value as FeatureSection | '')}
        >
          <option value="">Alle Abschnitte</option>
          {FEATURE_SECTIONS.map((entry) => (
            <option key={entry} value={entry}>
              {SECTION_LABEL[entry]}
            </option>
          ))}
        </Select>
      </div>
      {!library.length ? (
        <p className="wf-best-edit__hint">
          Noch steht keine Fähigkeit bei einem anderen Wesen und keine Fähigkeit in der Welt. Was du
          hier schreibst, steht danach für alle Wesen bereit.
        </p>
      ) : !hits.length ? (
        <p className="wf-best-edit__hint">Keine Fähigkeit passt.</p>
      ) : (
        <ul className="wf-best-edit__library-list">
          {hits.map((entry) => (
            <li key={entry.key}>
              <div>
                <b>
                  {entry.feature.name}
                  {entry.feature.uses && ` (${entry.feature.uses})`}
                </b>
                <span>
                  {' '}
                  · {SECTION_ONE[entry.feature.section]} ·{' '}
                  {entry.from === 'world' ? 'aus der Welt' : `bei ${entry.origins.join(', ')}`}
                </span>
                {entry.feature.text && <p>{entry.feature.text}</p>}
              </div>
              <Button
                size="sm"
                icon={<Plus aria-hidden />}
                onClick={() =>
                  // Eine Fähigkeit der Welt kommt in den Abschnitt, nach dem gerade gesucht wird.
                  onAdopt(
                    adoptFeature(
                      entry.feature,
                      entry.from === 'world' && section ? section : undefined,
                    ),
                  )
                }
              >
                Übernehmen
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
