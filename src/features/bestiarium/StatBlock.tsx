/**
 * Der Statblock eines Wesens im Aufbau von 2024 – alles Gerechnete kommt aus `domain/creature.ts`.
 * Am Tisch: Ein Klick auf einen Angriff würfelt ihn, ein Klick auf den Schaden den Schaden.
 */
import { useState } from 'react';
import { Dices, Minus, Plus } from 'lucide-react';
import { useDb } from '../../data/hooks';
import {
  ABILITY_SHORT,
  KIND_LABEL,
  SECTION_LABEL,
  attackMath,
  crCheck,
  saveDcOf,
  sensesText,
  signed,
  speedText,
  statsOf,
  typeLine,
  type Resolved,
  type ResolvedFeature,
} from '../../domain/creature';
import { ABILITY_KEYS, FEATURE_SECTIONS, type CreatureBlock } from '../../domain/schema';
import { Button, IconButton, Input, cx } from '../../ui';
import { setCreatureHp } from './actions';
import { rollAttack, rollDamage, type Roll } from './model';

/** Wie die Felder heißen, bei denen eine Variante von ihrer Vorlage abweichen kann. */
const FIELD_LABEL: Partial<Record<keyof CreatureBlock, string>> = {
  size: 'Größe',
  type: 'Typ',
  tags: 'Zusatz',
  alignment: 'Gesinnung',
  ac: 'Rüstungsklasse',
  acNote: 'Rüstung',
  hitDice: 'Trefferwürfel',
  hp: 'Trefferpunkte',
  initiative: 'Initiative',
  speed: 'Bewegung',
  hover: 'Schweben',
  abilities: 'Attribute',
  saves: 'Rettungswürfe',
  skills: 'Fertigkeiten',
  vulnerable: 'Anfälligkeiten',
  resistant: 'Resistenzen',
  immune: 'Immunitäten',
  conditionImmune: 'Zustandsimmunitäten',
  senses: 'Sinne',
  languages: 'Sprachen',
  cr: 'Herausforderungsgrad',
  attacksPerRound: 'Angriffe je Runde',
  gear: 'Ausrüstung',
  habitat: 'Lebensraum',
  treasure: 'Schatz',
};

export function StatBlock({ resolved }: { resolved: Resolved }) {
  const db = useDb();
  const { creature, block, features, chain } = resolved;
  const stats = statsOf(block);
  const check = crCheck(resolved);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [amount, setAmount] = useState('');
  const add = (roll: Roll) => setRolls((before) => [roll, ...before].slice(0, 6));
  const parent = chain.length > 1 ? chain[chain.length - 2]! : null;
  const own = [...resolved.own].map((key) => FIELD_LABEL[key]).filter(Boolean);
  const hpNow = creature.hpNow ?? stats.hp;
  const change = (sign: 1 | -1) => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    setCreatureHp(db, creature.id, hpNow + sign * value);
    setAmount('');
  };
  const line = (label: string, value: string) =>
    value ? (
      <div className="wf-best-line">
        <b>{label}</b> {value}
      </div>
    ) : null;

  return (
    <article className="wf-best-block">
      <header className="wf-best-block__head">
        <div>
          <h2 className="wf-best-block__name">{creature.name}</h2>
          <div className="wf-best-block__type">{typeLine(block)}</div>
        </div>
        <div className="wf-best-block__cr" title={`${stats.xp.toLocaleString('de-DE')} EP`}>
          <span>HG</span>
          <b>{block.cr}</b>
        </div>
      </header>
      {parent && (
        <p className="wf-best-block__from">
          {KIND_LABEL[creature.kind]} von „{parent.name}“
          {creature.kind === 'variant' &&
            (own.length || creature.features.length || creature.dropped.length
              ? ` – weicht ab bei: ${[
                  ...own,
                  ...creature.features.map((feature) => feature.name),
                  ...creature.dropped.map((name) => `ohne ${name}`),
                ].join(', ')}`
              : ' – weicht noch in nichts ab')}
          .
        </p>
      )}

      {creature.kind === 'individual' && (
        <div className="wf-best-hp">
          <div className="wf-best-hp__now" data-low={hpNow <= stats.hp / 2} data-zero={hpNow === 0}>
            <b>{hpNow}</b>
            <span>von {stats.hp} Trefferpunkten</span>
          </div>
          <Input
            value={amount}
            inputMode="numeric"
            placeholder="Zahl"
            aria-label="Schaden oder Heilung"
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') change(-1);
            }}
          />
          <Button size="sm" icon={<Minus />} onClick={() => change(-1)}>
            Schaden
          </Button>
          <Button size="sm" icon={<Plus />} onClick={() => change(1)}>
            Heilung
          </Button>
        </div>
      )}

      <div className="wf-best-top">
        <div className="wf-best-line">
          <b>RK</b> {block.ac}
          {block.acNote && ` (${block.acNote})`}
        </div>
        <div className="wf-best-line">
          <b>Initiative</b> {signed(stats.initiative)} ({10 + stats.initiative})
        </div>
        <div className="wf-best-line">
          <b>TP</b> {stats.hp}
          {block.hp === null ? ` (${stats.hpFormula})` : ' (festgelegt)'}
        </div>
        <div className="wf-best-line">
          <b>Bewegung</b> {speedText(block)}
        </div>
      </div>

      <table className="wf-best-abilities">
        <thead>
          <tr>
            <th />
            {ABILITY_KEYS.map((key) => (
              <th key={key}>{ABILITY_SHORT[key]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Wert</th>
            {ABILITY_KEYS.map((key) => (
              <td key={key}>{block.abilities[key]}</td>
            ))}
          </tr>
          <tr>
            <th>Mod.</th>
            {ABILITY_KEYS.map((key) => (
              <td key={key}>{signed(stats.mods[key])}</td>
            ))}
          </tr>
          <tr>
            <th title="Rettungswurf">RW</th>
            {ABILITY_KEYS.map((key) => (
              <td key={key} data-own={block.saves.includes(key)}>
                {signed(stats.saves[key])}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      <div className="wf-best-lines">
        {line(
          'Fertigkeiten',
          stats.skills.map((skill) => `${skill.label} ${signed(skill.bonus)}`).join(', '),
        )}
        {line('Anfälligkeiten', block.vulnerable)}
        {line('Resistenzen', block.resistant)}
        {line('Immunitäten', [block.immune, block.conditionImmune].filter(Boolean).join('; '))}
        {line('Ausrüstung', block.gear)}
        {line('Sinne', sensesText(block))}
        {line('Sprachen', block.languages || '—')}
        {line(
          'HG',
          `${block.cr} (${stats.xp.toLocaleString('de-DE')} EP; Übungsbonus ${signed(stats.pb)})`,
        )}
      </div>

      {FEATURE_SECTIONS.map((section) => {
        const list = features.filter((feature) => feature.section === section);
        if (!list.length) return null;
        return (
          <section key={section} className="wf-best-section">
            <h3>{SECTION_LABEL[section]}</h3>
            {list.map((feature) => (
              <Feature key={feature.id} resolved={resolved} feature={feature} onRoll={add} />
            ))}
          </section>
        );
      })}

      {rolls.length > 0 && (
        <div className="wf-best-rolls" aria-live="polite">
          {rolls.map((roll, index) => (
            <div key={rolls.length - index} className="wf-best-roll" data-mark={roll.mark}>
              <b>{roll.total}</b>
              <span>{roll.label}</span>
              <em>
                {roll.detail}
                {roll.mark === 'crit' && ' – gewürfelte 20: kritischer Treffer'}
                {roll.mark === 'fumble' && ' – gewürfelte 1: daneben'}
              </em>
            </div>
          ))}
        </div>
      )}

      <footer className="wf-best-foot">
        {line('Lebensraum', block.habitat)}
        {line('Schatz', block.treasure)}
        {line('Quelle', resolved.source)}
        {creature.notes && <p className="wf-prose">{creature.notes}</p>}
        <p className={cx('wf-best-check', `wf-best-check--${check.verdict}`)}>
          <b>Einschätzung:</b> {check.text} Merkmale und Zauber rechnet die Faustregel nicht mit.
        </p>
      </footer>
    </article>
  );
}

/** Eine Fähigkeit – mit gerechnetem Angriff und Knöpfen zum Würfeln. */
function Feature({
  resolved,
  feature,
  onRoll,
}: {
  resolved: Resolved;
  feature: ResolvedFeature;
  onRoll: (roll: Roll) => void;
}) {
  const { block } = resolved;
  const math = feature.attack ? attackMath(block, feature.attack) : null;
  const dc = saveDcOf(block, feature);
  const attack = feature.attack;
  return (
    <div className="wf-best-feature">
      <p>
        <b className="wf-best-feature__name">{feature.name}.</b>{' '}
        {attack && math && (
          <>
            <i>{attack.ranged ? 'Fernkampfangriff' : 'Nahkampfangriff'}:</i> {signed(math.bonus)}
            {attack.reach && `, Reichweite ${attack.reach}`}.{' '}
            {(math.average !== null || attack.dice) && (
              <>
                <i>Treffer:</i> {math.average ?? attack.dice}
                {math.dice?.count ? ` (${math.formula})` : ''}{' '}
                {attack.damageType ? `${attack.damageType}schaden` : 'Schaden'}.{' '}
              </>
            )}
          </>
        )}
        {dc !== null && feature.saveAbility && (
          <>
            <i>Rettungswurf:</i> SG {dc}.{' '}
          </>
        )}
        {feature.text}
      </p>
      {attack && math && (
        <span className="wf-best-feature__rolls">
          <IconButton
            size="sm"
            label={`${feature.name}: Angriff würfeln (W20 ${signed(math.bonus)})`}
            onClick={() => onRoll(rollAttack(feature.name, math.bonus))}
          >
            <Dices />
          </IconButton>
          {math.dice && (
            <>
              <button
                type="button"
                className="wf-best-chip"
                title={`Schaden würfeln: ${math.formula}`}
                onClick={() => onRoll(rollDamage(feature.name, math.dice!, attack.damageType))}
              >
                Schaden
              </button>
              {math.dice.count > 0 && (
                <button
                  type="button"
                  className="wf-best-chip"
                  title="Kritischer Treffer: doppelt so viele Würfel"
                  onClick={() =>
                    onRoll(rollDamage(feature.name, math.dice!, attack.damageType, true))
                  }
                >
                  kritisch
                </button>
              )}
            </>
          )}
        </span>
      )}
    </div>
  );
}
