/** Kleine Bausteine des Bereichs „Gefährten“: Erschöpfung, Zustände, Aufenthaltsort, Werte. */
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ExternalLink, MapPin, Plus, Users, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entityName, placePath } from '../../domain/derive';
import { createEntity, type Character } from '../../domain/schema';
import { EntityPicker, MenuItem, Popover, cx, toast } from '../../ui';
import {
  addOwnCondition,
  changeHp,
  clickExhaustion,
  moveCharacter,
  patchCharacter,
  removeOwnCondition,
  toggleCharacterCondition,
} from './actions';
import {
  CONDITIONS,
  EXHAUSTION_MAX,
  EXHAUSTION_RULE,
  combatFacts,
  conditionRule,
  exhaustionEffect,
  exhaustionText,
  hasCondition,
  ruleOf,
  sheetHref,
  sortConditions,
  speedInfo,
} from './model';

/**
 * Schließt eine Aufklappfläche. Lag der Fokus in ihr (Tastatur), geht er zurück auf den Knopf,
 * der sie geöffnet hat – sonst stünde man nach Escape im Nichts.
 */
function closeToAnchor(anchor: HTMLElement | null, setOpen: (open: boolean) => void) {
  const focused = document.activeElement;
  const inside = focused instanceof HTMLElement && focused.closest('.wf-gruppe-pop') !== null;
  setOpen(false);
  if (inside) anchor?.focus();
}

// ── Erschöpfung ────────────────────────────────────────────────────────────

/**
 * Sechs Marken. Ein Klick setzt die Stufe; ein Klick auf die aktuelle Stufe nimmt eine zurück.
 * Mit der Tastatur ist die Reihe ein einziger Halt: Pfeil rechts erhöht, Pfeil links senkt.
 */
export function ExhaustionMarks({
  level,
  onMark,
  size = 'md',
}: {
  level: number;
  onMark: (mark: number) => void;
  size?: 'md' | 'lg';
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const up = e.key === 'ArrowRight' || e.key === 'ArrowUp';
    const down = e.key === 'ArrowLeft' || e.key === 'ArrowDown';
    if (!up && !down) return;
    e.preventDefault();
    // Dieselbe Regel wie beim Klick: die nächste Marke setzen bzw. die aktuelle zurücknehmen.
    if (up && level < EXHAUSTION_MAX) onMark(level + 1);
    if (down && level > 0) onMark(level);
  };
  return (
    <div
      className={cx('wf-gruppe-marks', size === 'lg' && 'wf-gruppe-marks--lg')}
      role="slider"
      tabIndex={0}
      aria-label="Erschöpfung"
      aria-valuemin={0}
      aria-valuemax={EXHAUSTION_MAX}
      aria-valuenow={level}
      aria-valuetext={`Stufe ${level} von ${EXHAUSTION_MAX}: ${exhaustionText(level, true)}`}
      title={EXHAUSTION_RULE}
      onKeyDown={onKeyDown}
    >
      {Array.from({ length: EXHAUSTION_MAX }, (_, i) => i + 1).map((mark) => (
        <button
          key={mark}
          type="button"
          tabIndex={-1}
          className="wf-gruppe-mark"
          data-on={mark <= level}
          data-last={mark === EXHAUSTION_MAX}
          aria-label={
            mark === level
              ? `Erschöpfung auf Stufe ${mark - 1} senken`
              : `Erschöpfung auf Stufe ${mark} setzen`
          }
          onClick={() => onMark(mark)}
        >
          <i />
        </button>
      ))}
    </div>
  );
}

/** Marken samt Auswirkung in Worten, direkt mit dem Gefährten verbunden. */
export function ExhaustionControl({
  character,
  size,
}: {
  character: Character;
  size?: 'md' | 'lg';
}) {
  // Auf der Karte ist wenig Platz; dort steht die Stufe in den Marken und der Text bleibt kurz.
  const roomy = size === 'lg';
  const db = useDb();
  const level = character.character.exhaustion;
  const effect = exhaustionEffect(level);
  return (
    <div className="wf-gruppe-exhaustion">
      <ExhaustionMarks
        level={level}
        size={size}
        onMark={(mark) => clickExhaustion(db, character.id, mark)}
      />
      <span
        className={cx(
          'wf-gruppe-exhaustion__text',
          level === 0 && 'wf-gruppe-exhaustion__text--none',
          effect.dead && 'wf-gruppe-exhaustion__text--dead',
        )}
      >
        {roomy && level > 0 && !effect.dead && <b>Stufe {level}</b>}
        {exhaustionText(level, roomy)}
      </span>
    </div>
  );
}

// ── Zustände ───────────────────────────────────────────────────────────────

/**
 * Alle Zustände als Schalter. Darunter wahlweise die Regel des Zustands unter dem Zeiger
 * (`hover`, feste Höhe, damit nichts springt) oder die Regeln der gesetzten Zustände (`active`).
 */
export function ConditionToggles({
  value,
  onToggle,
  rules = 'none',
}: {
  value: readonly string[];
  onToggle: (name: string) => void;
  rules?: 'hover' | 'active' | 'none';
}) {
  const db = useDb();
  const custom = useData().campaign.customConditions;
  const [hover, setHover] = useState<string | null>(null);
  const [own, setOwn] = useState('');
  const active = sortConditions(value);
  const track = rules === 'hover';
  // Eigene Zustände der Kampagne, dazu gesetzte, die es in keiner Liste (mehr) gibt.
  const extra = [
    ...custom.map((c) => c.name),
    ...active.filter((name) => !conditionRule(name) && !custom.some((c) => c.name === name)),
  ];
  const listed = [
    ...CONDITIONS.map((c) => ({ name: c.name, own: false })),
    ...extra.map((name) => ({ name, own: true })),
  ];
  const addOwn = () => {
    const name = own.trim();
    if (!name) return;
    addOwnCondition(db, null, name);
    if (!hasCondition(value, name)) onToggle(name);
    setOwn('');
  };
  return (
    <div className="wf-gruppe-conditions">
      <div className="wf-gruppe-conditions__grid" role="group" aria-label="Zustände">
        {listed.map((condition) => (
          <button
            key={condition.name}
            type="button"
            className={cx('wf-gruppe-condition', condition.own && 'wf-gruppe-condition--own')}
            aria-pressed={hasCondition(value, condition.name)}
            title={
              track
                ? undefined
                : ruleOf(condition.name, custom) || (condition.own ? 'Eigener Zustand' : undefined)
            }
            onClick={() => onToggle(condition.name)}
            onMouseEnter={track ? () => setHover(condition.name) : undefined}
            onFocus={track ? () => setHover(condition.name) : undefined}
          >
            {condition.name}
          </button>
        ))}
      </div>
      {/* Kein eigenes Formular: Die Schalter stehen auch im Bearbeiten-Dialog, der selbst eines ist. */}
      <div className="wf-gruppe-conditions__own">
        <input
          className="wf-input"
          value={own}
          onChange={(e) => setOwn(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;
            e.preventDefault();
            e.stopPropagation();
            addOwn();
          }}
          placeholder="Eigener Zustand, z. B. Verflucht"
          aria-label="Eigenen Zustand anlegen"
          maxLength={40}
        />
        <button type="button" className="wf-btn wf-btn--sm" disabled={!own.trim()} onClick={addOwn}>
          Anlegen
        </button>
        {hover && custom.some((c) => c.name === hover) && (
          <button
            type="button"
            className="wf-btn wf-btn--sm wf-btn--ghost"
            title="Aus der Liste der eigenen Zustände nehmen. Wer ihn gerade hat, behält ihn."
            onClick={() => {
              removeOwnCondition(db, hover);
              setHover(null);
            }}
          >
            „{hover}“ aus der Liste nehmen
          </button>
        )}
      </div>
      {rules === 'hover' && (
        <p
          className={cx('wf-gruppe-conditions__rule', !hover && 'wf-gruppe-conditions__rule--idle')}
        >
          {hover ? (
            <>
              <b>{hover}.</b> {ruleOf(hover, custom) || 'Eigener Zustand ohne hinterlegte Regel.'}
            </>
          ) : (
            'Anklicken schaltet einen Zustand an oder aus. Zeig auf einen Zustand, um seine Regel zu lesen.'
          )}
        </p>
      )}
      {rules === 'active' && active.length > 0 && (
        <div className="wf-gruppe-conditions__active">
          {active.map((name) => (
            <p key={name}>
              <b>{name}.</b> {ruleOf(name, custom) || 'Eigener Zustand ohne hinterlegte Regel.'}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Aktive Zustände als Marken (Klick entfernt) und ein Knopf, der die ganze Liste aufklappt. */
export function ConditionChips({ character }: { character: Character }) {
  const db = useDb();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const active = sortConditions(character.character.conditions);
  const toggle = (name: string) => toggleCharacterCondition(db, character.id, name);
  return (
    <div className="wf-gruppe-chips">
      {active.map((name) => (
        <button
          key={name}
          type="button"
          className="wf-gruppe-chip"
          title={[conditionRule(name), 'Anklicken beendet den Zustand.'].filter(Boolean).join('\n')}
          aria-label={`${name} beenden`}
          onClick={() => toggle(name)}
        >
          {name}
          <X />
        </button>
      ))}
      <button
        ref={anchor}
        type="button"
        className="wf-gruppe-chip wf-gruppe-chip--add"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus />
        {active.length ? 'Weiterer' : 'Zustand setzen'}
      </button>
      <Popover
        open={open}
        onClose={() => closeToAnchor(anchor.current, setOpen)}
        anchor={anchor}
        width={372}
        className="wf-gruppe-pop"
      >
        <ConditionToggles value={active} onToggle={toggle} rules="hover" />
      </Popover>
    </div>
  );
}

// ── Aufenthaltsort ─────────────────────────────────────────────────────────

/** Zeigt, wo der Gefährte ist, und lässt ihn sich von der Gruppe trennen oder zurückkehren. */
export function LocationControl({
  character,
  roomy,
}: {
  character: Character;
  /** Wo Platz ist, steht dabei, wo die Gruppe gerade ist. */
  roomy?: boolean;
}) {
  const db = useDb();
  const data = useData();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const own = character.character.placeId;
  const partyPlace = data.state.placeId;
  const move = (placeId: string | null) => {
    closeToAnchor(anchor.current, setOpen);
    const result = moveCharacter(db, character.id, placeId);
    if (result)
      toast({
        title: 'In der Chronik festgehalten',
        body: result.text,
        action: { label: 'Rückgängig', run: result.undo },
      });
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={cx('wf-gruppe-place', own && 'wf-gruppe-place--away')}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          own
            ? `Abseits der Gruppe: ${placePath(data, own)} – anklicken, um den Aufenthaltsort zu ändern`
            : 'Aufenthaltsort ändern'
        }
        onClick={() => setOpen((o) => !o)}
      >
        {own ? <MapPin /> : <Users />}
        <span className="wf-clamp-1">
          {own ? (
            <>
              Abseits: <b>{entityName(data, own)}</b>
            </>
          ) : roomy && partyPlace ? (
            <>
              Bei der Gruppe · <b>{entityName(data, partyPlace)}</b>
            </>
          ) : (
            'Bei der Gruppe'
          )}
        </span>
      </button>
      <Popover
        open={open}
        onClose={() => closeToAnchor(anchor.current, setOpen)}
        anchor={anchor}
        width={340}
        className="wf-gruppe-pop"
      >
        <MenuItem icon={<Users />} active={!own} onClick={() => move(null)}>
          Bei der Gruppe
          {partyPlace && <span className="wf-mute"> · {entityName(data, partyPlace)}</span>}
        </MenuItem>
        <div className="wf-menu-sep" />
        <div className="wf-gruppe-pop__field">
          <div className="wf-field__label">Abseits der Gruppe in</div>
          <EntityPicker
            value={own}
            onChange={(id) => id && move(id)}
            kinds={['place']}
            allowClear={false}
            placeholder="Ort wählen oder neu anlegen …"
            onCreate={(name) => db.put('entities', createEntity({ kind: 'place', name })).id}
          />
          <p className="wf-field__hint">
            {own ? placePath(data, own) : 'Der Wechsel wird als Notiz in der Chronik festgehalten.'}
          </p>
        </div>
      </Popover>
    </>
  );
}

// ── Werte ──────────────────────────────────────────────────────────────────

export function Stat({
  label,
  value,
  unit,
  title,
  tone,
  of,
}: {
  label: string;
  value: number | null;
  unit?: string;
  title?: string;
  tone?: 'warn';
  /** Maximum hinter dem Wert: „24 / 38“. */
  of?: number | null;
}) {
  return (
    <div className={cx('wf-gruppe-stat', tone === 'warn' && 'wf-gruppe-stat--warn')} title={title}>
      <div className="wf-gruppe-stat__value wf-num">
        {value === null ? <span className="wf-gruppe-stat__none">–</span> : value}
        {value !== null && of !== undefined && of !== null && <small>/ {of}</small>}
        {value !== null && unit && <small>{unit}</small>}
      </div>
      <div className="wf-gruppe-stat__label">{label}</div>
    </div>
  );
}

/** Die sechs Werte, die der Spielleiter am Tisch braucht. */
export function StatBand({ character }: { character: Character }) {
  const d = character.character;
  const speed = speedInfo(d);
  const facts = combatFacts(d);
  const hurt = d.hp !== null && d.hpMax !== null && d.hp * 2 <= d.hpMax;
  return (
    <div className="wf-gruppe-stats">
      <div className="wf-gruppe-stats__inner">
        <div className="wf-gruppe-stats__group">
          <Stat label="Rüstung" value={d.armorClass} title="Rüstungsklasse" />
          {d.hp === null ? (
            <Stat label="Treffer" value={d.hpMax} title="Maximale Trefferpunkte" />
          ) : (
            <Stat
              label="Treffer"
              value={d.hp}
              of={d.hpMax}
              tone={hurt ? 'warn' : undefined}
              title={
                d.hpMax === null
                  ? 'Aktuelle Trefferpunkte'
                  : `Aktuelle von maximalen Trefferpunkten${hurt ? ' – höchstens die Hälfte' : ''}`
              }
            />
          )}
          <Stat
            label="Bewegung"
            value={speed.value}
            unit="Fuß"
            tone={speed.reason ? 'warn' : undefined}
            title={speed.reason ?? 'Bewegungsrate in Fuß'}
          />
        </div>
        <div className="wf-gruppe-stats__group wf-gruppe-stats__group--passive">
          <span className="wf-gruppe-stats__caption">Passiv</span>
          <Stat label="Wahrnehmung" value={d.passivePerception} title="Passive Wahrnehmung" />
          <Stat label="Einsicht" value={d.passiveInsight} title="Passive Einsicht" />
          <Stat
            label="Nachforschung"
            value={d.passiveInvestigation}
            title="Passive Nachforschung"
          />
        </div>
      </div>
      {facts.length > 0 && (
        <dl className="wf-gruppe-stats__extra">
          {facts.map((fact) => (
            <div key={fact.label} title={fact.title}>
              <dt>{fact.label}</dt>
              <dd className="wf-num">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Schaden und Heilung mit einem Handgriff: −5, −1, +1, +5 und „voll“. */
export function HpControl({ character }: { character: Character }) {
  const db = useDb();
  const { hp, hpMax } = character.character;
  if (hp === null && hpMax === null)
    return <span className="wf-mute">Noch keine Trefferpunkte eingetragen.</span>;
  const current = hp ?? hpMax ?? 0;
  const step = (delta: number, label: string) => (
    <button
      type="button"
      className="wf-gruppe-hp__step"
      aria-label={label}
      title={label}
      disabled={delta < 0 ? current <= 0 : hpMax !== null && current >= hpMax}
      onClick={() => changeHp(db, character.id, delta)}
    >
      {delta > 0 ? `+${delta}` : `−${-delta}`}
    </button>
  );
  return (
    <div className="wf-gruppe-hp">
      {step(-5, '5 Trefferpunkte Schaden')}
      {step(-1, '1 Trefferpunkt Schaden')}
      <span className="wf-gruppe-hp__value wf-num" data-down={current === 0 || undefined}>
        {current}
        {hpMax !== null && <small> / {hpMax}</small>}
      </span>
      {step(1, '1 Trefferpunkt heilen')}
      {step(5, '5 Trefferpunkte heilen')}
      {hpMax !== null && current < hpMax && (
        <button
          type="button"
          className="wf-gruppe-hp__full"
          onClick={() => patchCharacter(db, character.id, { hp: hpMax })}
        >
          voll
        </button>
      )}
    </div>
  );
}

/** Link zum Charakterbogen (D&D Beyond); öffnet in einem neuen Fenster. */
export function SheetLink({
  character,
  onMissing,
  children = (
    <span>
      Charakterbogen<span className="wf-gruppe-sheet__verb"> öffnen</span>
    </span>
  ),
}: {
  character: Character;
  /** Wird angeboten, wenn noch kein Link eingetragen ist. */
  onMissing?: () => void;
  children?: ReactNode;
}) {
  const href = sheetHref(character.character.sheetUrl);
  if (!href)
    return onMissing ? (
      <button
        type="button"
        className="wf-gruppe-sheet wf-gruppe-sheet--missing"
        title="Den Link zum Charakterbogen bei D&D Beyond eintragen"
        onClick={onMissing}
      >
        Bogen verknüpfen
      </button>
    ) : null;
  return (
    <a
      className="wf-gruppe-sheet"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={`Charakterbogen öffnen: ${href}`}
    >
      {children}
      <ExternalLink />
    </a>
  );
}
