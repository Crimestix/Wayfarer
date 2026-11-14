/** Bausteine, die Einträge der Weltdatenbank darstellen und auswählen. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'wouter';
import {
  Castle,
  Dna,
  Feather,
  Flame,
  Gem,
  Hammer,
  Languages,
  Leaf,
  MapPin,
  PawPrint,
  Pickaxe,
  Plus,
  ScrollText,
  Shield,
  Swords,
  User,
  Users,
  X,
} from 'lucide-react';
import { useData } from '../data/hooks';
import { useMediaSrc } from '../data/media';
import { KIND_LABEL, placePath } from '../domain/derive';
import {
  enterAction,
  moveMark,
  pickRows,
  rowAction,
  type EnterAction,
  type PickRow,
} from '../domain/pick';
import { ATTITUDES, attitudeLevel, attitudeToken, RULES_ATTITUDE_LABEL } from '../domain/relations';
import { PARTY_ID, type Entity, type EntityKind } from '../domain/schema';
import { isStub } from '../domain/stub';
import { Input, MenuItem, Popover, cx } from './components';
import { CreateForm, useWriting, type CreateOptions, type WriteRequest } from './create';

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
  plant: Leaf,
  animal: PawPrint,
  mineral: Pickaxe,
  profession: Hammer,
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
  const src = useMediaSrc();
  return (
    <span
      className="wf-portrait"
      style={{ width: size, height: size, borderRadius: round ? '50%' : undefined }}
    >
      {entity.image ? (
        <img src={src(entity.image)} alt="" loading="lazy" decoding="async" />
      ) : (
        <KindIcon kind={entity.kind} />
      )}
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

/**
 * Das ruhige Zeichen „Platzhalter“ für Listen: Der Eintrag ist beim Schreiben entstanden und noch
 * zu schreiben (`isStub`). Sonst steht nichts da.
 */
export function StubMark({ entity }: { entity: Entity }) {
  const data = useData();
  if (!isStub(data, entity)) return null;
  return (
    <span className="wf-stub" title="Beim Schreiben angelegt – noch zu schreiben">
      Platzhalter
    </span>
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

/** CSS-Farbe einer Haltungsstufe; unbekannt ist gedämpft. */
export const attitudeColor = (value: number | null): string =>
  value === null ? 'var(--ink-mute)' : `var(${attitudeToken(value)})`;

/** Haltung als farbige Raute mit Bezeichnung. null = unbekannt. */
export function AttitudeBadge({ value, label = true }: { value: number | null; label?: boolean }) {
  const level = attitudeLevel(value);
  const text = level?.label ?? 'Unbekannt';
  const rules = level
    ? `${level.hint} Nach Regelwerk: ${RULES_ATTITUDE_LABEL[level.rules].toLowerCase()}.`
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

/**
 * Elf Stufen zum Anklicken, darunter Name und Bedeutung der Stufe unter dem Zeiger (sonst der
 * gewählten). Ein Klick auf die gewählte Stufe setzt auf „unbekannt“ zurück.
 */
export function AttitudeScale({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = attitudeLevel(hover ?? value);
  return (
    <div className="wf-attitude-pick">
      <div
        className="wf-attitude-scale"
        role="group"
        aria-label="Haltung"
        onMouseLeave={() => setHover(null)}
      >
        {ATTITUDES.map((level) => (
          <button
            key={level.value}
            type="button"
            title={level.label}
            aria-label={`${level.label}: ${level.hint}`}
            aria-pressed={value === level.value}
            data-zero={level.value === 0 || undefined}
            style={{ '--att-color': attitudeColor(level.value) } as CSSProperties}
            onMouseEnter={() => setHover(level.value)}
            onFocus={() => setHover(level.value)}
            onBlur={() => setHover(null)}
            onClick={() => onChange(value === level.value ? null : level.value)}
          >
            <i />
          </button>
        ))}
      </div>
      <div
        className="wf-attitude-pick__meaning"
        style={{ '--att-color': attitudeColor(shown?.value ?? null) } as CSSProperties}
        aria-live="polite"
      >
        {shown ? (
          <>
            <b>{shown.label}</b>
            <span>{shown.hint}</span>
            <em>Nach Regelwerk: {RULES_ATTITUDE_LABEL[shown.rules].toLowerCase()}</em>
          </>
        ) : (
          <span>
            Noch nicht festgelegt – wähle eine Stufe von Todfeind (links) bis Ergeben (rechts).
          </span>
        )}
      </div>
    </div>
  );
}

// ── Auswahl ────────────────────────────────────────────────────────────────

/**
 * Die Zeilen einer Auswahl: Treffer, dann „neu als …“. Welche Zeilen dastehen und was die
 * Eingabetaste tut, entscheidet `domain/pick.ts`; hier wird nur gezeigt.
 */
export function PickList({
  rows,
  marked,
  name,
  value,
  kinds,
  detail,
  onAct,
}: {
  rows: readonly PickRow[];
  /** Die mit den Pfeiltasten markierte Zeile. */
  marked: number | null;
  /** Der getippte Name – für „„X“ neu als …“. */
  name: string;
  /** Der gewählte Eintrag, wenn es einen gibt. */
  value?: string | null | undefined;
  /** Die Arten des Feldes – für den Hinweis, wenn ein Name nicht hineinpasst. */
  kinds?: readonly EntityKind[] | undefined;
  /** Zu jedem Treffer sagen, was er ist (beim „@“ im Text). */
  detail?: boolean | undefined;
  onAct: (action: EnterAction) => void;
}) {
  const data = useData();
  /** Hält die markierte Zeile im Blick. */
  const follow = (active: boolean) => (el: HTMLElement | null) => {
    if (active) el?.scrollIntoView({ block: 'nearest' });
  };
  return (
    <>
      {rows.map((row, index) => {
        const active = index === marked;
        if (row.type === 'party')
          return (
            <MenuItem
              key="party"
              ref={follow(active)}
              icon={<Users />}
              onClick={() => onAct(rowAction(row))}
              active={active || value === PARTY_ID}
            >
              Die Gruppe
            </MenuItem>
          );
        if (row.type === 'entity') {
          const { entity } = row;
          const more =
            entity.kind === 'place' && entity.place.parentId
              ? placePath(data, entity.place.parentId)
              : row.foreign || detail
                ? entity.kind === 'person' && entity.person.role
                  ? entity.person.role
                  : KIND_LABEL[entity.kind]
                : '';
          return (
            <MenuItem
              key={entity.id}
              ref={follow(active)}
              icon={<KindIcon kind={entity.kind} />}
              onClick={() => onAct(rowAction(row))}
              active={active || entity.id === value}
            >
              {entity.name}
              {more && <span className="wf-mute"> · {more}</span>}
            </MenuItem>
          );
        }
        if (row.type === 'taken')
          return (
            <div key={`taken:${row.entity.id}`} className="wf-picker__note">
              „{row.entity.name}“ gibt es schon als {KIND_LABEL[row.entity.kind]}.
              {kinds?.length ? ` Dieses Feld nimmt nur: ${kindNames(kinds)}.` : ''}
            </div>
          );
        if (row.type === 'create')
          return (
            <MenuItem
              key={`create:${row.kind}`}
              ref={follow(active)}
              icon={<KindIcon kind={row.kind} />}
              onClick={() => onAct(rowAction(row))}
              active={active}
            >
              <span className="wf-picker__new">
                „{name}“ neu als {KIND_LABEL[row.kind]}
              </span>
            </MenuItem>
          );
        if (row.type === 'more')
          return (
            <MenuItem
              key="more"
              ref={follow(active)}
              icon={<Plus />}
              onClick={() => onAct(rowAction(row))}
              active={active}
            >
              <span className="wf-picker__new">andere Art …</span>
            </MenuItem>
          );
        return (
          <MenuItem
            key="legacy"
            ref={follow(active)}
            icon={<Plus />}
            onClick={() => onAct(rowAction(row))}
            active={active}
          >
            „{name}“ neu anlegen
          </MenuItem>
        );
      })}
    </>
  );
}

const kindNames = (kinds: readonly EntityKind[]) =>
  kinds.map((kind) => KIND_LABEL[kind]).join(', ');

export interface EntityPickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  /** Diese Arten anbieten. Mit `create` heißt das: zuerst – wer genau so heißt, steht trotzdem da. */
  kinds?: EntityKind[];
  placeholder?: string;
  /** „Die Gruppe“ als Auswahl anbieten. */
  allowParty?: boolean;
  /** Auswahl darf geleert werden (Vorgabe: ja). */
  allowClear?: boolean;
  /** IDs, die nicht angeboten werden. */
  exclude?: string[];
  /**
   * Der alte Weg zu „Neu anlegen“: bekommt den getippten Namen und gibt die neue ID zurück – die
   * Art legt der Aufrufer fest. Neues nimmt `create`.
   */
  onCreate?: (name: string) => string;
  /**
   * Fehlendes beim Wählen anlegen: Ohne genauen Treffer steht „„X“ neu als Person“ … da – zuerst
   * die Arten des Feldes, dann jede andere. Es entsteht ein Platzhalter (`addFromWriting`).
   */
  create?: CreateOptions | undefined;
  autoFocus?: boolean;
  /** Beim „Rückgängig“ eines hier angelegten Eintrags: ihn wieder aus dem Feld nehmen. */
  onRevert?: ((id: string) => void) | undefined;
}

/** Sucht und wählt einen Eintrag der Weltdatenbank – und legt an, was fehlt. */
export function EntityPicker({
  value,
  onChange,
  kinds,
  placeholder = 'Auswählen …',
  allowParty,
  allowClear = true,
  exclude,
  onCreate,
  create,
  autoFocus,
  onRevert,
}: EntityPickerProps) {
  const data = useData();
  const write = useWriting();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** Die mit den Pfeiltasten markierte Zeile. */
  const [marked, setMarked] = useState<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  /** Das kleine Formular zum Anlegen ist offen – mit dieser Art. */
  const [form, setForm] = useState<EntityKind | null>(null);
  const rows = useMemo(
    () =>
      open
        ? pickRows(data, {
            query,
            kinds,
            exclude,
            allowParty,
            create: !!create,
            onlyKinds: create?.onlyKinds,
            moreOpen,
            legacy: !!onCreate,
          })
        : [],
    [data, query, kinds, exclude, allowParty, create, moreOpen, onCreate, open],
  );
  const selected = value && value !== PARTY_ID ? data.entities[value] : undefined;
  const name = query.replace(/\s+/g, ' ').trim();

  // Für „Rückgängig“: Das Feld wird nur zurückgestellt, solange es noch da ist und unverändert.
  const latest = useRef({ value, onChange, onRevert });
  latest.current = { value, onChange, onRevert };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const close = () => {
    setOpen(false);
    setQuery('');
    setMarked(null);
    setMoreOpen(false);
    setForm(null);
    // Der Fokus bleibt am Feld – sonst stünde er nach der Wahl im Leeren.
    anchor.current?.focus();
  };
  const pick = (id: string | null) => {
    onChange(id);
    close();
  };
  const act = (action: EnterAction) => {
    if (action.type === 'pick') pick(action.id);
    else if (action.type === 'party') pick(PARTY_ID);
    else if (action.type === 'create') setForm(action.kind);
    else if (action.type === 'more') setMoreOpen((before) => !before);
    else if (action.type === 'legacy' && onCreate && name) pick(onCreate(name));
  };
  const submit = (request: WriteRequest) => {
    const before = value;
    const outcome = write(request, {
      storyId: create?.storyId,
      kinds,
      onlyKinds: create?.onlyKinds,
      exclude,
      revert: (entity) => {
        if (!alive.current) return;
        const now = latest.current;
        if (now.onRevert) now.onRevert(entity.id);
        else if (now.value === entity.id) now.onChange(before);
      },
    });
    if (!outcome) return;
    create?.onCreated?.(outcome.entity);
    if (outcome.taken) pick(outcome.entity.id);
    else close();
  };
  // Was die Eingabetaste gerade täte – als leiser Hinweis unter der Liste.
  const onEnter = enterAction(rows, null, query);
  const hasHits = rows.some((row) => row.type === 'entity');
  const hint = !name
    ? ''
    : onEnter.type === 'create'
      ? hasHits
        ? `Eingabetaste legt „${name}“ neu an · ↑ ↓ wählt einen Treffer`
        : `Eingabetaste legt „${name}“ neu an`
      : onEnter.type === 'none' && hasHits
        ? 'Mit ↑ ↓ markieren – die Eingabetaste nimmt nur den genauen Namen.'
        : '';

  return (
    <div className="wf-picker">
      <button
        ref={anchor}
        type="button"
        className="wf-picker__value"
        autoFocus={autoFocus}
        onClick={() => (open ? close() : setOpen(true))}
        // Wer am Feld einfach lostippt, schreibt schon in die Suche – nach einer Wahl geht so gleich
        // der nächste Name, ohne das Feld erst wieder zu öffnen.
        onKeyDown={(e) => {
          if (open || e.nativeEvent.isComposing) return;
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          if (e.key.length !== 1 || e.key === ' ') return;
          e.preventDefault();
          setQuery(e.key);
          setOpen(true);
        }}
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
      <Popover
        open={open}
        onClose={close}
        // Aus dem Formular führt Escape zurück zur Liste – der getippte Name bleibt stehen.
        onEscape={form ? () => setForm(null) : undefined}
        anchor={anchor}
        width={340}
      >
        {form ? (
          <CreateForm
            name={name}
            kind={form}
            kinds={kinds}
            onSubmit={submit}
            onBack={() => setForm(null)}
          />
        ) : (
          <>
            <Input
              className="wf-picker__search"
              autoFocus
              placeholder={create ? 'Suchen oder neuen Namen schreiben …' : 'Suchen …'}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setMarked(null);
                setMoreOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMarked(moveMark(rows, marked, e.key === 'ArrowDown' ? 1 : -1));
                  return;
                }
                if (e.key !== 'Enter') return;
                e.preventDefault();
                act(enterAction(rows, marked, query));
              }}
            />
            <div className="wf-picker__list" role="listbox">
              <PickList
                rows={rows}
                marked={marked}
                name={name}
                value={value}
                kinds={kinds}
                onAct={act}
              />
              {!rows.length && <div className="wf-picker__empty">Nichts gefunden.</div>}
            </div>
            {hint && <div className="wf-picker__hint">{hint}</div>}
          </>
        )}
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
  create,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  kinds?: EntityKind[];
  placeholder?: string;
  onCreate?: (name: string) => string;
  /** Fehlendes beim Hinzufügen anlegen – mit Wahl der Art (siehe `EntityPicker`). */
  create?: CreateOptions | undefined;
}) {
  const data = useData();
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
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
        onChange={(id) => id && !value.includes(id) && onChange([...value, id])}
        exclude={value}
        placeholder={placeholder}
        create={create}
        onRevert={(id) => {
          const now = latest.current;
          if (now.value.includes(id)) now.onChange(now.value.filter((v) => v !== id));
        }}
        {...(kinds ? { kinds } : {})}
        {...(onCreate ? { onCreate } : {})}
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
          {entity.name} <StubMark entity={entity} />
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
