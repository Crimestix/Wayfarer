/**
 * Ein Wesen bauen oder ändern. Der Spielleiter trägt ein, was ein Statblock festlegt; Wayfarer
 * rechnet, was daraus folgt, und zeigt es gleich. Bei einer Variante bleibt leer, was sie von
 * ihrer Vorlage erbt – der geerbte Wert steht blass im Feld.
 */
import { useMemo, useState } from 'react';
import { Plus, Trash2, Undo2 } from 'lucide-react';
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
  resolveCreature,
  signed,
  statsOf,
  type FullBlock,
} from '../../domain/creature';
import {
  ABILITY_KEYS,
  CREATURE_KINDS,
  CREATURE_SIZES,
  FEATURE_SECTIONS,
  newId,
  type AbilityKey,
  type Creature,
  type CreatureBlock,
  type CreatureFeature,
  type CreatureKind,
  type CreatureSize,
  type FeatureSection,
} from '../../domain/schema';
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  IconButton,
  Input,
  SectionTitle,
  Select,
  TextArea,
  cx,
} from '../../ui';
import { saveCreature, type CreatureInput } from './actions';

const SPEEDS = ['walk', 'fly', 'swim', 'climb', 'burrow'] as const;
const SPEED_NAME: Record<(typeof SPEEDS)[number], string> = {
  walk: 'Gehen',
  fly: 'Fliegen',
  swim: 'Schwimmen',
  climb: 'Klettern',
  burrow: 'Graben',
};
const SENSES = Object.keys(SENSE_LABEL) as (keyof typeof SENSE_LABEL)[];
type TextKey =
  | 'type'
  | 'tags'
  | 'alignment'
  | 'acNote'
  | 'vulnerable'
  | 'resistant'
  | 'immune'
  | 'conditionImmune'
  | 'languages'
  | 'gear'
  | 'habitat'
  | 'treasure';
type NumberKey = 'ac' | 'hitDice' | 'attacksPerRound';

const blankFeature = (section: FeatureSection): CreatureFeature => ({
  id: newId(),
  section,
  name: '',
  text: '',
  attack: null,
  saveAbility: null,
  saveDc: null,
  uses: '',
});

export function CreatureDialog({
  creature,
  onClose,
  onSaved,
}: {
  creature: Creature | null;
  onClose: () => void;
  onSaved: (creature: Creature) => void;
}) {
  const db = useDb();
  const data = useData();
  const [draft, setDraft] = useState<CreatureInput>(() => ({
    name: creature?.name ?? '',
    kind: creature?.kind ?? 'template',
    parentId: creature?.parentId ?? null,
    block: creature?.block ?? {},
    features: creature?.features ?? [],
    dropped: creature?.dropped ?? [],
    source: creature?.source ?? '',
    notes: creature?.notes ?? '',
  }));
  const [borrowFrom, setBorrowFrom] = useState('');
  const set = (change: Partial<CreatureInput>) => setDraft((before) => ({ ...before, ...change }));
  const setBlock = (change: CreatureBlock) =>
    setDraft((before) => ({ ...before, block: { ...before.block, ...change } }));
  const inherits = draft.kind !== 'template' && draft.parentId !== null;

  // Was von oben kommt – und was das Wesen so, wie es gerade eingetragen ist, ergibt.
  const parent = useMemo(
    () => (inherits ? resolveCreature(data.creatures, draft.parentId!) : null),
    [data.creatures, draft.parentId, inherits],
  );
  const base: FullBlock = parent?.block ?? DEFAULT_BLOCK;
  const preview = useMemo(() => {
    const id = creature?.id ?? 'entwurf';
    const stamp = creature ?? { id, rev: 0, created: '', updated: '' };
    const self = {
      ...stamp,
      ...draft,
      id,
      parentId: inherits ? draft.parentId : null,
      speciesId: creature?.speciesId ?? null,
      hpNow: creature?.hpNow ?? null,
      placeId: creature?.placeId ?? null,
    } as Creature;
    return resolveCreature({ ...data.creatures, [id]: self }, id)!;
  }, [creature, data.creatures, draft, inherits]);
  const block = preview.block;
  const stats = statsOf(block);
  const check = crCheck(preview);

  const parents = Object.values(data.creatures)
    .filter(
      (entry) =>
        entry.id !== creature?.id &&
        entry.kind !== 'individual' &&
        // Eine Variante erbt von einer Vorlage; ein Einzelner von Vorlage oder Variante.
        (draft.kind === 'individual' || entry.kind === 'template'),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const others = Object.values(data.creatures)
    .filter((entry) => entry.id !== creature?.id && entry.features.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  const text = (key: TextKey, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input
        value={draft.block[key] ?? ''}
        placeholder={inherits ? base[key] || '—' : undefined}
        onChange={(event) => setBlock({ [key]: event.target.value || undefined })}
      />
    </Field>
  );
  const number = (key: NumberKey, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input
        value={draft.block[key] ?? ''}
        inputMode="numeric"
        placeholder={String(base[key])}
        onChange={(event) => {
          const value = Number(event.target.value);
          setBlock({
            [key]:
              event.target.value.trim() && Number.isFinite(value) ? Math.round(value) : undefined,
          });
        }}
      />
    </Field>
  );
  /** Eine Gruppe von Zahlen (Attribute, Bewegung, Sinne): Sie gilt ganz oder wird ganz geerbt. */
  const group = <K extends 'abilities' | 'speed' | 'senses'>(
    key: K,
    part: keyof FullBlock[K] & string,
    label: string,
    title?: string,
  ) => {
    const own = draft.block[key] as Record<string, number> | undefined;
    const from = base[key] as Record<string, number>;
    return (
      <label key={part} className="wf-best-num" title={title}>
        <span>{label}</span>
        <Input
          value={own ? String(own[part]) : ''}
          inputMode="numeric"
          placeholder={String(from[part])}
          onChange={(event) => {
            const value = Math.round(Number(event.target.value));
            const next = Number.isFinite(value) && event.target.value.trim() ? value : from[part]!;
            setBlock({ [key]: { ...from, ...own, [part]: Math.max(0, next) } } as CreatureBlock);
          }}
        />
      </label>
    );
  };
  const reset = (key: keyof CreatureBlock, label: string) =>
    inherits &&
    draft.block[key] !== undefined && (
      <button
        type="button"
        className="wf-best-reset"
        title={`${label} wieder von der Vorlage erben`}
        onClick={() => setBlock({ [key]: undefined })}
      >
        <Undo2 aria-hidden /> erben
      </button>
    );

  const saves = draft.block.saves ?? base.saves;
  const skills = draft.block.skills ?? base.skills;
  const setFeature = (id: string, change: Partial<CreatureFeature>) =>
    set({
      features: draft.features.map((feature) =>
        feature.id === id ? { ...feature, ...change } : feature,
      ),
    });
  const inherited = parent?.features ?? [];
  const isDropped = (name: string) =>
    draft.dropped.some((entry) => entry.toLowerCase() === name.toLowerCase());
  const isReplaced = (name: string) =>
    draft.features.some((entry) => entry.name.trim().toLowerCase() === name.toLowerCase());

  return (
    <Dialog
      open
      onClose={onClose}
      title={creature ? `${KIND_LABEL[draft.kind]} ändern` : 'Neues Wesen'}
      width={920}
      footer={
        <>
          <span className={cx('wf-best-form__check', `wf-best-check--${check.verdict}`)}>
            {check.text}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            disabled={!draft.name.trim() || (draft.kind !== 'template' && !draft.parentId)}
            onClick={() => onSaved(saveCreature(db, draft, creature?.id))}
          >
            Speichern
          </Button>
        </>
      }
    >
      <div className="wf-best-form">
        <div className="wf-best-form__row wf-best-form__row--head">
          <Field label="Name">
            <Input
              value={draft.name}
              autoFocus={!creature}
              onChange={(event) => set({ name: event.target.value })}
            />
          </Field>
          <Field label="Art">
            <Select
              value={draft.kind}
              aria-label="Art"
              onChange={(event) => set({ kind: event.target.value as CreatureKind })}
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
                onChange={(event) => set({ parentId: event.target.value || null })}
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
        {inherits && (
          <p className="wf-best-form__note">
            Leere Felder erbt das Wesen von „{parent?.creature.name}“ – der geerbte Wert steht blass
            im Feld. Trag nur ein, was abweicht.
          </p>
        )}
        <p className="wf-best-form__math">
          Wayfarer rechnet: <b>TP {stats.hp}</b>
          {block.hp === null ? ` (${stats.hpFormula})` : ' (festgelegt)'} ·{' '}
          <b>Übungsbonus {signed(stats.pb)}</b> · Initiative {signed(stats.initiative)} · passive
          Wahrnehmung {stats.passivePerception} · {stats.xp.toLocaleString('de-DE')} EP
        </p>

        <SectionTitle>Art und Verteidigung</SectionTitle>
        <div className="wf-best-form__row">
          <Field label="Größe" hint={`Trefferwürfel: W${SIZE_DIE[block.size]}`}>
            <Select
              value={draft.block.size ?? ''}
              aria-label="Größe"
              onChange={(event) =>
                setBlock({ size: (event.target.value || undefined) as CreatureSize | undefined })
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
          {text('type', 'Typ', 'etwa Humanoider, Untoter, Tier')}
          {text('tags', 'Zusatz', 'in Klammern, etwa Goblinoide')}
          {text('alignment', 'Gesinnung')}
        </div>
        <div className="wf-best-form__row">
          {number('ac', 'Rüstungsklasse')}
          {text('acNote', 'Rüstung', 'etwa Lederrüstung, Schild')}
          {number('hitDice', 'Trefferwürfel', 'Anzahl')}
          <Field label="TP festlegen" hint="nur, wenn sie nicht aus den Würfeln folgen">
            <Input
              value={draft.block.hp ?? ''}
              inputMode="numeric"
              placeholder={String(stats.hp)}
              onChange={(event) => {
                const value = Math.round(Number(event.target.value));
                setBlock({
                  hp: event.target.value.trim() && value > 0 ? value : inherits ? undefined : null,
                });
              }}
            />
          </Field>
          <Field label="HG">
            <Select
              value={draft.block.cr ?? ''}
              aria-label="Herausforderungsgrad"
              onChange={(event) => setBlock({ cr: event.target.value || undefined })}
            >
              <option value="">{inherits ? `${base.cr} (geerbt)` : base.cr}</option>
              {CRS.map((cr) => (
                <option key={cr} value={cr}>
                  {cr}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <SectionTitle>Attribute {reset('abilities', 'Attribute')}</SectionTitle>
        <div className="wf-best-form__nums">
          {ABILITY_KEYS.map((key) =>
            group(
              'abilities',
              key,
              `${ABILITY_SHORT[key]} ${signed(stats.mods[key])}`,
              ABILITY_NAME[key],
            ),
          )}
        </div>
        <div className="wf-best-form__checks">
          <span className="wf-best-form__label">
            Übung im Rettungswurf {reset('saves', 'Rettungswürfe')}
          </span>
          {ABILITY_KEYS.map((key) => (
            <Checkbox
              key={key}
              checked={saves.includes(key)}
              onChange={(on) =>
                setBlock({ saves: on ? [...saves, key] : saves.filter((entry) => entry !== key) })
              }
            >
              {ABILITY_SHORT[key]}
            </Checkbox>
          ))}
          <Field label="Initiative">
            <Select
              value={draft.block.initiative ?? ''}
              aria-label="Übung in Initiative"
              onChange={(event) =>
                setBlock({
                  initiative: event.target.value === '' ? undefined : Number(event.target.value),
                })
              }
            >
              <option value="">{inherits ? 'geerbt' : 'ohne Übung'}</option>
              <option value="0">ohne Übung</option>
              <option value="1">geübt</option>
              <option value="2">Expertise</option>
            </Select>
          </Field>
        </div>
        <div className="wf-best-form__skills">
          <span className="wf-best-form__label">
            Fertigkeiten – ein Klick: geübt, noch einer: Expertise {reset('skills', 'Fertigkeiten')}
          </span>
          {Object.entries(SKILLS).map(([key, skill]) => {
            const level = skills[key] ?? 0;
            return (
              <button
                key={key}
                type="button"
                className="wf-best-chip"
                data-level={level}
                title={`${skill.label} (${ABILITY_SHORT[skill.ability]})`}
                onClick={() => {
                  const next = { ...skills };
                  if (level === 2) delete next[key];
                  else next[key] = level + 1;
                  setBlock({ skills: next });
                }}
              >
                {skill.label}
                {level > 0 &&
                  ` ${signed(stats.mods[skill.ability] + stats.pb * level)}${level === 2 ? ' ★' : ''}`}
              </button>
            );
          })}
        </div>

        <SectionTitle>Bewegung und Sinne {reset('speed', 'Bewegung')}</SectionTitle>
        <div className="wf-best-form__nums">
          {SPEEDS.map((key) => group('speed', key, SPEED_NAME[key], 'in Fuß'))}
          <Checkbox
            checked={draft.block.hover ?? base.hover}
            onChange={(hover) => setBlock({ hover })}
          >
            schwebt
          </Checkbox>
        </div>
        <div className="wf-best-form__nums">
          {SENSES.map((key) => group('senses', key, SENSE_LABEL[key], 'in Fuß'))}
          {reset('senses', 'Sinne')}
        </div>
        <div className="wf-best-form__row">
          {text('languages', 'Sprachen')}
          {text('resistant', 'Resistenzen')}
          {text('immune', 'Immunitäten')}
        </div>
        <div className="wf-best-form__row">
          {text('vulnerable', 'Anfälligkeiten')}
          {text('conditionImmune', 'Zustandsimmunitäten')}
          {text('gear', 'Ausrüstung')}
        </div>

        <SectionTitle>Fähigkeiten</SectionTitle>
        {inherited.length > 0 && (
          <div className="wf-best-form__inherited">
            <span className="wf-best-form__label">Geerbt von „{parent?.creature.name}“</span>
            {inherited.map((feature) => {
              const replaced = isReplaced(feature.name);
              return (
                <div key={feature.id} className="wf-best-form__heir">
                  <Checkbox
                    checked={!isDropped(feature.name)}
                    onChange={(keep) =>
                      set({
                        dropped: keep
                          ? draft.dropped.filter(
                              (name) => name.toLowerCase() !== feature.name.toLowerCase(),
                            )
                          : [...draft.dropped, feature.name],
                      })
                    }
                  >
                    {feature.name}
                    <em>
                      {' '}
                      · {SECTION_LABEL[feature.section]}
                      {replaced && ' · hier abgewandelt'}
                    </em>
                  </Checkbox>
                  {!replaced && !isDropped(feature.name) && (
                    <button
                      type="button"
                      className="wf-best-reset"
                      title="Eine eigene Fassung anlegen, die die geerbte ersetzt"
                      onClick={() => {
                        const { inherited: _inherited, ...copy } = feature;
                        set({
                          features: [
                            ...draft.features,
                            { ...copy, id: newId(), attack: copy.attack && { ...copy.attack } },
                          ],
                        });
                      }}
                    >
                      abwandeln
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {draft.features.map((feature) => (
          <FeatureEditor
            key={feature.id}
            feature={feature}
            block={block}
            onChange={(change) => setFeature(feature.id, change)}
            onRemove={() =>
              set({ features: draft.features.filter((entry) => entry.id !== feature.id) })
            }
          />
        ))}
        <div className="wf-best-form__add">
          {FEATURE_SECTIONS.map((section) => (
            <Button
              key={section}
              size="sm"
              icon={<Plus aria-hidden />}
              onClick={() => set({ features: [...draft.features, blankFeature(section)] })}
            >
              {SECTION_LABEL[section].replace(/n$/, '').replace('Merkmale', 'Merkmal')}
            </Button>
          ))}
        </div>
        {others.length > 0 && (
          <div className="wf-best-form__borrow">
            <span className="wf-best-form__label">
              Fähigkeit von einem anderen Wesen übernehmen
            </span>
            <Select
              value={borrowFrom}
              aria-label="Wesen"
              onChange={(event) => setBorrowFrom(event.target.value)}
            >
              <option value="">Wesen wählen …</option>
              {others.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
            {(data.creatures[borrowFrom]?.features ?? []).map((feature) => (
              <button
                key={feature.id}
                type="button"
                className="wf-best-chip"
                title={`„${feature.name}“ als eigene Fähigkeit übernehmen`}
                onClick={() =>
                  set({
                    features: [
                      ...draft.features,
                      { ...feature, id: newId(), attack: feature.attack && { ...feature.attack } },
                    ],
                  })
                }
              >
                + {feature.name}
              </button>
            ))}
          </div>
        )}

        <SectionTitle>Welt</SectionTitle>
        <div className="wf-best-form__row">
          {text('habitat', 'Lebensraum', 'mit Komma getrennt: Wald, Hügel')}
          {text('treasure', 'Schatz')}
          {number('attacksPerRound', 'Angriffe je Runde', 'für die Einschätzung des HG')}
          <Field label="Quelle" hint="Eigenbau, ein Buch mit Seite …">
            <Input
              value={draft.source}
              placeholder={parent?.source}
              onChange={(event) => set({ source: event.target.value })}
            />
          </Field>
        </div>
        <Field label="Notizen">
          <TextArea
            value={draft.notes}
            rows={2}
            onChange={(event) => set({ notes: event.target.value })}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/** Eine Fähigkeit bearbeiten – mit Angriff und Rettungswurf, die Wayfarer rechnet. */
function FeatureEditor({
  feature,
  block,
  onChange,
  onRemove,
}: {
  feature: CreatureFeature;
  block: FullBlock;
  onChange: (change: Partial<CreatureFeature>) => void;
  onRemove: () => void;
}) {
  const attack = feature.attack;
  const setAttack = (change: Partial<NonNullable<CreatureFeature['attack']>>) =>
    attack && onChange({ attack: { ...attack, ...change } });
  const stats = statsOf(block);
  return (
    <div className="wf-best-feat">
      <div className="wf-best-feat__head">
        <Select
          value={feature.section}
          aria-label="Abschnitt"
          onChange={(event) => onChange({ section: event.target.value as FeatureSection })}
        >
          {FEATURE_SECTIONS.map((section) => (
            <option key={section} value={section}>
              {SECTION_LABEL[section]}
            </option>
          ))}
        </Select>
        <Input
          value={feature.name}
          placeholder="Name – etwa „Biss“"
          aria-label="Name der Fähigkeit"
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <Checkbox
          checked={attack !== null}
          onChange={(on) =>
            onChange({
              attack: on
                ? {
                    ranged: false,
                    ability: 'str',
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
        <IconButton size="sm" label="Fähigkeit entfernen" onClick={onRemove}>
          <Trash2 aria-hidden />
        </IconButton>
      </div>
      {attack && (
        <div className="wf-best-feat__attack">
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
            title={`Angriffsbonus: ${signed(stats.mods[attack.ability] + stats.pb)}`}
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
          <Input
            value={attack.damageType}
            placeholder="Schadensart"
            aria-label="Schadensart"
            title="etwa Hieb, Stich, Wucht, Feuer"
            onChange={(event) => setAttack({ damageType: event.target.value })}
          />
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
      <div className="wf-best-feat__text">
        <TextArea
          value={feature.text}
          rows={2}
          placeholder={attack ? 'Was sonst noch geschieht' : 'Was die Fähigkeit tut'}
          aria-label="Text der Fähigkeit"
          onChange={(event) => onChange({ text: event.target.value })}
        />
        <Select
          value={feature.saveAbility ?? ''}
          aria-label="Rettungswurf"
          title="Verlangt die Fähigkeit einen Rettungswurf, rechnet Wayfarer den SG aus diesem Attribut"
          onChange={(event) =>
            onChange({ saveAbility: (event.target.value || null) as AbilityKey | null })
          }
        >
          <option value="">kein Rettungswurf</option>
          {ABILITY_KEYS.map((key) => (
            <option key={key} value={key}>
              SG {8 + stats.pb + stats.mods[key]} aus {ABILITY_SHORT[key]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
