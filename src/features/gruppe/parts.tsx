/** Kleine Bausteine des Bereichs „Gefährten“: Erschöpfung, Zustände, Aufenthaltsort, Werte. */
import { useRef, useState, type ReactNode } from 'react';
import { ExternalLink, MapPin, Plus, Users, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entityName, placePath } from '../../domain/derive';
import { createEntity, type Character } from '../../domain/schema';
import { EntityPicker, MenuItem, Popover, cx, toast } from '../../ui';
import { clickExhaustion, moveCharacter, toggleCharacterCondition } from './actions';
import {
  CONDITIONS,
  EXHAUSTION_MAX,
  EXHAUSTION_RULE,
  conditionRule,
  effectiveSpeed,
  exhaustionEffect,
  exhaustionText,
  hasCondition,
  sheetHref,
  sortConditions,
} from './model';

// ── Erschöpfung ────────────────────────────────────────────────────────────

/** Sechs Marken. Ein Klick setzt die Stufe; ein Klick auf die aktuelle Stufe nimmt eine zurück. */
export function ExhaustionMarks({
  level,
  onMark,
  size = 'md',
}: {
  level: number;
  onMark: (mark: number) => void;
  size?: 'md' | 'lg';
}) {
  return (
    <div
      className={cx('wf-gruppe-marks', size === 'lg' && 'wf-gruppe-marks--lg')}
      role="group"
      aria-label={`Erschöpfung: Stufe ${level} von ${EXHAUSTION_MAX}`}
      title={EXHAUSTION_RULE}
    >
      {Array.from({ length: EXHAUSTION_MAX }, (_, i) => i + 1).map((mark) => (
        <button
          key={mark}
          type="button"
          className="wf-gruppe-mark"
          data-on={mark <= level}
          data-last={mark === EXHAUSTION_MAX}
          aria-pressed={mark <= level}
          aria-label={
            mark === level ? `Erschöpfung auf Stufe ${mark - 1} senken` : `Erschöpfung auf Stufe ${mark} setzen`
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
export function ExhaustionControl({ character, size }: { character: Character; size?: 'md' | 'lg' }) {
  // Auf der Karte ist wenig Platz; dort steht die Stufe in den Marken und der Text bleibt kurz.
  const roomy = size === 'lg';
  const db = useDb();
  const level = character.character.exhaustion;
  const effect = exhaustionEffect(level);
  return (
    <div className="wf-gruppe-exhaustion">
      <ExhaustionMarks level={level} size={size} onMark={(mark) => clickExhaustion(db, character.id, mark)} />
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

/** Alle Zustände als Schalter; darunter der Regeltext des Zustands unter dem Zeiger. */
export function ConditionToggles({
  value,
  onToggle,
  showRule = true,
}: {
  value: readonly string[];
  onToggle: (name: string) => void;
  showRule?: boolean;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const active = sortConditions(value);
  return (
    <div className="wf-gruppe-conditions">
      <div className="wf-gruppe-conditions__grid" role="group" aria-label="Zustände">
        {CONDITIONS.map((condition) => (
          <button
            key={condition.name}
            type="button"
            className="wf-gruppe-condition"
            aria-pressed={hasCondition(value, condition.name)}
            title={condition.rule}
            onClick={() => onToggle(condition.name)}
            onMouseEnter={() => setHover(condition.name)}
            onMouseLeave={() => setHover((h) => (h === condition.name ? null : h))}
            onFocus={() => setHover(condition.name)}
            onBlur={() => setHover((h) => (h === condition.name ? null : h))}
          >
            {condition.name}
          </button>
        ))}
      </div>
      {showRule &&
        (hover ? (
          <p className="wf-gruppe-conditions__rule">
            <b>{hover}.</b> {conditionRule(hover)}
          </p>
        ) : active.length ? (
          <div className="wf-gruppe-conditions__rule">
            {active.map((name) => (
              <p key={name}>
                <b>{name}.</b> {conditionRule(name) || 'Eigener Zustand ohne hinterlegte Regel.'}
              </p>
            ))}
          </div>
        ) : (
          <p className="wf-gruppe-conditions__rule wf-gruppe-conditions__rule--idle">
            Anklicken schaltet einen Zustand an oder aus. Die Regel erscheint, sobald du auf einen zeigst.
          </p>
        ))}
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
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={372} className="wf-gruppe-pop">
        <ConditionToggles value={active} onToggle={toggle} />
      </Popover>
    </div>
  );
}

// ── Aufenthaltsort ─────────────────────────────────────────────────────────

/** Zeigt, wo der Gefährte ist, und lässt ihn sich von der Gruppe trennen oder zurückkehren. */
export function LocationControl({ character }: { character: Character }) {
  const db = useDb();
  const data = useData();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const own = character.character.placeId;
  const partyPlace = data.state.placeId;
  const move = (placeId: string | null) => {
    setOpen(false);
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
        title="Aufenthaltsort ändern"
        onClick={() => setOpen((o) => !o)}
      >
        {own ? <MapPin /> : <Users />}
        <span className="wf-clamp-1">
          {own ? (
            <>
              Abseits: <b>{entityName(data, own)}</b>
            </>
          ) : (
            'Bei der Gruppe'
          )}
        </span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={340} className="wf-gruppe-pop">
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
}: {
  label: string;
  value: number | null;
  unit?: string;
  title?: string;
  tone?: 'warn';
}) {
  return (
    <div className={cx('wf-gruppe-stat', tone === 'warn' && 'wf-gruppe-stat--warn')} title={title}>
      <div className="wf-gruppe-stat__value wf-num">
        {value === null ? <span className="wf-gruppe-stat__none">–</span> : value}
        {value !== null && unit && <small>{unit}</small>}
      </div>
      <div className="wf-gruppe-stat__label">{label}</div>
    </div>
  );
}

/** Die sechs Werte, die der Spielleiter am Tisch braucht. */
export function StatBand({ character }: { character: Character }) {
  const d = character.character;
  const speed = effectiveSpeed(d);
  const slowed = speed !== d.speed;
  return (
    <div className="wf-gruppe-stats">
      <div className="wf-gruppe-stats__inner">
        <div className="wf-gruppe-stats__group">
          <Stat label="Rüstung" value={d.armorClass} title="Rüstungsklasse" />
          <Stat label="Treffer" value={d.hpMax} title="Maximale Trefferpunkte" />
          <Stat
            label="Bewegung"
            value={speed}
            unit="Fuß"
            tone={slowed ? 'warn' : undefined}
            title={
              slowed
                ? `Bewegungsrate ${d.speed} Fuß, durch Erschöpfung auf ${speed} Fuß gesenkt`
                : 'Bewegungsrate in Fuß'
            }
          />
        </div>
        <div className="wf-gruppe-stats__group wf-gruppe-stats__group--passive">
          <span className="wf-gruppe-stats__caption">Passiv</span>
          <Stat label="Wahrnehmung" value={d.passivePerception} title="Passive Wahrnehmung" />
          <Stat label="Einsicht" value={d.passiveInsight} title="Passive Einsicht" />
          <Stat label="Nachforschung" value={d.passiveInvestigation} title="Passive Nachforschung" />
        </div>
      </div>
    </div>
  );
}

/** Link zum Charakterbogen (D&D Beyond); öffnet in einem neuen Fenster. */
export function SheetLink({
  character,
  onMissing,
  children = 'Charakterbogen öffnen',
}: {
  character: Character;
  /** Wird angeboten, wenn noch kein Link eingetragen ist. */
  onMissing?: () => void;
  children?: ReactNode;
}) {
  const href = sheetHref(character.character.sheetUrl);
  if (!href)
    return onMissing ? (
      <button type="button" className="wf-gruppe-sheet wf-gruppe-sheet--missing" onClick={onMissing}>
        Charakterbogen verknüpfen
      </button>
    ) : null;
  return (
    <a className="wf-gruppe-sheet" href={href} target="_blank" rel="noreferrer noopener" title={href}>
      {children}
      <ExternalLink />
    </a>
  );
}
