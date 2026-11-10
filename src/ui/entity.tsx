/** Bausteine, die Einträge der Weltdatenbank darstellen und auswählen. */
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'wouter';
import {
  Castle,
  Dna,
  Feather,
  Flame,
  Gem,
  Languages,
  MapPin,
  Plus,
  ScrollText,
  Shield,
  Swords,
  User,
  Users,
  X,
} from 'lucide-react';
import { useData } from '../data/hooks';
import { KIND_LABEL, placePath, searchEntities } from '../domain/derive';
import { ATTITUDES, attitudeLevel, RULES_ATTITUDE_LABEL } from '../domain/relations';
import { PARTY_ID, type Entity, type EntityKind } from '../domain/schema';
import { Input, MenuItem, Popover, cx } from './components';

const KIND_ICONS: Record<EntityKind, typeof User> = {
  person: User,
  place: MapPin,
  faction: Shield,
  character: Swords,
  item: Gem,
  topic: ScrollText,
  family: Castle,
  species: Dna,
  language: Languages,
  script: Feather,
  ability: Flame,
};

export function KindIcon({ kind, size }: { kind: EntityKind; size?: number }) {
  const Icon = KIND_ICONS[kind];
  return <Icon width={size} height={size} aria-label={KIND_LABEL[kind]} />;
}

/** Wo ein Eintrag in der App zu Hause ist. */
export function entityHref(entity: { id: string; kind: EntityKind }): string {
  return entity.kind === 'character' ? `/gruppe/${entity.id}` : `/welt/${entity.id}`;
}

/** Bild eines Eintrags; ohne Bild das Symbol seiner Art. */
export function Portrait({
  entity,
  size = 40,
  round,
}: {
  entity: Pick<Entity, 'kind' | 'image' | 'name'>;
  size?: number;
  round?: boolean;
}) {
  return (
    <span
      className="wf-portrait"
      style={{ width: size, height: size, borderRadius: round ? '50%' : undefined }}
    >
      {entity.image ? <img src={entity.image} alt="" /> : <KindIcon kind={entity.kind} />}
    </span>
  );
}

/** Verweis auf einen Eintrag; führt zu seiner Seite. Kennt auch „Die Gruppe“. */
export function EntityLink({ id, icon = true }: { id: string | null | undefined; icon?: boolean }) {
  const data = useData();
  if (!id) return null;
  if (id === PARTY_ID)
    return (
      <Link href="/gruppe" className="wf-entity-link">
        {icon && <Users />}
        Die Gruppe
      </Link>
    );
  const entity = data.entities[id];
  if (!entity)
    return <span className="wf-entity-link wf-entity-link--gone">Gelöschter Eintrag</span>;
  return (
    <Link href={entityHref(entity)} className="wf-entity-link">
      {icon && <KindIcon kind={entity.kind} />}
      {entity.name}
    </Link>
  );
}

/** Mehrere Verweise hintereinander, durch Kommas getrennt. */
export function EntityLinks({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && ', '}
          <EntityLink id={id} icon={false} />
        </span>
      ))}
    </>
  );
}

// ── Haltung ────────────────────────────────────────────────────────────────

const attitudeColor = (value: number | null): string =>
  value === null
    ? 'var(--ink-mute)'
    : `var(--att-${value < 0 ? 'n' + -value : value > 0 ? 'p' + value : '0'})`;

/** Haltung als farbige Raute mit Bezeichnung. null = unbekannt. */
export function AttitudeBadge({ value, label = true }: { value: number | null; label?: boolean }) {
  const level = attitudeLevel(value);
  const text = level?.label ?? 'Unbekannt';
  const rules = level
    ? `Nach Regelwerk: ${RULES_ATTITUDE_LABEL[level.rules]}`
    : 'Haltung noch nicht festgelegt';
  return (
    <span
      className={cx('wf-attitude', value === null && 'wf-attitude--unknown')}
      style={{ '--att-color': attitudeColor(value) } as CSSProperties}
      title={label ? rules : `${text} · ${rules}`}
    >
      <i className="wf-attitude__gem" />
      {label && text}
    </span>
  );
}

/** Sieben Stufen zum Anklicken. Ein Klick auf die gewählte Stufe setzt auf „unbekannt“ zurück. */
export function AttitudeScale({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="wf-attitude-scale" role="group" aria-label="Haltung">
      {ATTITUDES.map((level) => (
        <button
          key={level.value}
          type="button"
          title={level.label}
          aria-label={level.label}
          aria-pressed={value === level.value}
          style={{ '--att-color': attitudeColor(level.value) } as CSSProperties}
          onClick={() => onChange(value === level.value ? null : level.value)}
        >
          <i />
        </button>
      ))}
    </div>
  );
}

// ── Auswahl ────────────────────────────────────────────────────────────────

export interface EntityPickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  /** Nur diese Arten anbieten. */
  kinds?: EntityKind[];
  placeholder?: string;
  /** „Die Gruppe“ als Auswahl anbieten. */
  allowParty?: boolean;
  /** Auswahl darf geleert werden (Vorgabe: ja). */
  allowClear?: boolean;
  /** IDs, die nicht angeboten werden. */
  exclude?: string[];
  /** Erlaubt „Neu anlegen“; bekommt den getippten Namen und gibt die neue ID zurück. */
  onCreate?: (name: string) => string;
  autoFocus?: boolean;
}

/** Sucht und wählt einen Eintrag der Weltdatenbank. */
export function EntityPicker({
  value,
  onChange,
  kinds,
  placeholder = 'Auswählen …',
  allowParty,
  allowClear = true,
  exclude,
  onCreate,
  autoFocus,
}: EntityPickerProps) {
  const data = useData();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const results = useMemo(
    () =>
      open
        ? searchEntities(data, query, { kinds, limit: 40 }).filter((e) => !exclude?.includes(e.id))
        : [],
    [data, query, kinds, exclude, open],
  );
  const selected = value && value !== PARTY_ID ? data.entities[value] : undefined;
  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };
  const name = query.trim();
  const exact = results.some((e) => e.name.toLowerCase() === name.toLowerCase());

  return (
    <div className="wf-picker">
      <button
        ref={anchor}
        type="button"
        className="wf-picker__value"
        autoFocus={autoFocus}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {value === PARTY_ID ? (
          <>
            <Users width={15} height={15} /> <span className="wf-grow wf-clamp-1">Die Gruppe</span>
          </>
        ) : selected ? (
          <>
            <KindIcon kind={selected.kind} size={15} />
            <span className="wf-grow wf-clamp-1">{selected.name}</span>
          </>
        ) : (
          <span className="wf-grow wf-picker__placeholder">
            {value ? 'Gelöschter Eintrag' : placeholder}
          </span>
        )}
        {value && allowClear && (
          <X
            width={14}
            height={14}
            aria-label="Auswahl leeren"
            onClick={(e) => {
              e.stopPropagation();
              pick(null);
            }}
          />
        )}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={340}>
        <Input
          className="wf-picker__search"
          autoFocus
          placeholder="Suchen …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (results[0]) pick(results[0].id);
            else if (onCreate && name) pick(onCreate(name));
          }}
        />
        <div className="wf-picker__list" role="listbox">
          {allowParty && !query && (
            <MenuItem icon={<Users />} onClick={() => pick(PARTY_ID)} active={value === PARTY_ID}>
              Die Gruppe
            </MenuItem>
          )}
          {results.map((entity) => (
            <MenuItem
              key={entity.id}
              icon={<KindIcon kind={entity.kind} />}
              onClick={() => pick(entity.id)}
              active={entity.id === value}
            >
              {entity.name}
              {entity.kind === 'place' && entity.place.parentId && (
                <span className="wf-mute"> · {placePath(data, entity.place.parentId)}</span>
              )}
            </MenuItem>
          ))}
          {!results.length && !onCreate && <div className="wf-picker__empty">Nichts gefunden.</div>}
          {onCreate && name && !exact && (
            <MenuItem icon={<Plus />} onClick={() => pick(onCreate(name))}>
              „{name}“ neu anlegen
            </MenuItem>
          )}
        </div>
      </Popover>
    </div>
  );
}

/** Liste von Verweisen zum Bearbeiten: vorhandene entfernen, weitere hinzufügen. */
export function EntityRefsEditor({
  value,
  onChange,
  kinds,
  placeholder = 'Eintrag hinzufügen …',
  onCreate,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  kinds?: EntityKind[];
  placeholder?: string;
  onCreate?: (name: string) => string;
}) {
  const data = useData();
  return (
    <div className="wf-col" style={{ gap: 8 }}>
      {value.length > 0 && (
        <div className="wf-row-wrap">
          {value.map((id) => {
            const entity = data.entities[id];
            return (
              <span key={id} className="wf-badge wf-badge--gold">
                {entity ? <KindIcon kind={entity.kind} /> : null}
                {entity?.name ?? 'Gelöschter Eintrag'}
                <X
                  role="button"
                  aria-label={`${entity?.name ?? 'Eintrag'} entfernen`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onChange(value.filter((v) => v !== id))}
                />
              </span>
            );
          })}
        </div>
      )}
      <EntityPicker
        value={null}
        onChange={(id) => id && onChange([...value, id])}
        kinds={kinds}
        exclude={value}
        placeholder={placeholder}
        onCreate={onCreate}
      />
    </div>
  );
}

/** Zeile für Listen: Bild, Name, Unterzeile und rechts ein Zusatz. Mit `href` wird sie zum Link. */
export function EntityRow({
  entity,
  sub,
  aside,
  href,
  active,
}: {
  entity: Entity;
  /** Unterzeile; Vorgabe ist die Kurzbeschreibung. */
  sub?: ReactNode;
  aside?: ReactNode;
  href?: string;
  active?: boolean;
}) {
  const body = (
    <>
      <Portrait entity={entity} size={38} />
      <span className="wf-item__main">
        <span className="wf-item__name wf-clamp-1" style={{ display: 'block' }}>
          {entity.name}
        </span>
        <span className="wf-item__sub wf-clamp-1" style={{ display: 'block' }}>
          {sub ?? entity.tagline}
        </span>
      </span>
      {aside}
    </>
  );
  return href ? (
    <Link href={href} className={cx('wf-item', active && 'wf-item--active')}>
      {body}
    </Link>
  ) : (
    <div className={cx('wf-item', active && 'wf-item--active')}>{body}</div>
  );
}
