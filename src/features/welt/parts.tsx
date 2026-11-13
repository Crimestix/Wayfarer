/** Kleine Bausteine, die mehrere Teile des Dossiers verwenden. */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Eye, Pencil, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import type { Occurrence } from '../../domain/derive';
import { ATTITUDES } from '../../domain/relations';
import type { Entity, EventKind } from '../../domain/schema';
import { formatClock, formatRelative } from '../../domain/time/calendar';
import {
  AttitudeBadge,
  attitudeColor,
  Button,
  EntityLink,
  EntityPicker,
  IconButton,
  Input,
  Portrait,
  SectionTitle,
  TextArea,
  cx,
  entityHref,
  toast,
  type EntityPickerProps,
} from '../../ui';
import { patchEntityIfPresent } from './actions';
import { entitySubline, formatShortDate, type Fact, type WorldEntity } from './model';

/** CSS-Farbe einer Haltungsstufe. */
export const attitudeVar = attitudeColor;

/** Abschnitt mit Titel in Versalien und optionalen Knöpfen rechts. */
export function Section({
  title,
  count,
  action,
  children,
  className,
}: {
  title: ReactNode;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('wf-welt-sec', className)}>
      <div className="wf-welt-sec__head">
        <SectionTitle>
          {title}
          {count !== undefined && <span className="wf-welt-sec__count">{count}</span>}
        </SectionTitle>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Ein Satz, der sagt, was hier hingehört – mit dem nächsten Schritt daneben. */
export function Hint({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="wf-welt-hint">
      <p>{children}</p>
      {action}
    </div>
  );
}

/** Elf Rauten; die aktuelle Stufe leuchtet. Nur Anzeige. */
export function AttitudePips({ value }: { value: number | null }) {
  return (
    <span className="wf-welt-pips" aria-hidden>
      {ATTITUDES.map((level) => (
        <i
          key={level.value}
          data-on={level.value === value}
          data-zero={level.value === 0 || undefined}
          title={level.label}
          style={{ '--att-color': attitudeVar(level.value) } as CSSProperties}
        />
      ))}
    </span>
  );
}

/** Die Fakten unter dem Namen: Etikett und Wert, Einträge als Verweise. */
export function Facts({ facts }: { facts: Fact[] }) {
  if (!facts.length) return null;
  return (
    <dl className="wf-welt-facts">
      {facts.map((fact) => (
        <div key={fact.label} className="wf-welt-fact">
          <dt>{fact.label}</dt>
          <dd className={fact.tone === 'danger' ? 'wf-welt-fact--danger' : undefined}>
            {fact.text}
            {fact.ids?.map((id, i) => (
              <span key={id}>
                {i > 0 && <span className="wf-welt-fact__sep">{fact.list ? ', ' : ' › '}</span>}
                {i === 1 && !!fact.skipped && (
                  <span
                    className="wf-welt-fact__sep"
                    title={
                      fact.skipped === 1
                        ? 'Eine Ebene dazwischen'
                        : `${fact.skipped} Ebenen dazwischen`
                    }
                  >
                    … ›{' '}
                  </span>
                )}
                <EntityLink id={id} icon={false} />
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Auswahl eines Eintrags, die nach der Wahl den Fokus behält. Ohne das stünde der Fokus danach
 * im Leeren, und Tab oder Strg+Eingabe griffen im Dialog nicht mehr.
 */
export function Picker({
  openOnMount = false,
  ...props
}: EntityPickerProps & {
  /** Klappt die Suche gleich beim Öffnen auf – wenn ohnehin zuerst gewählt werden muss. */
  openOnMount?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openOnMount) return;
    // Erst nach dem Dialog, der beim Öffnen selbst den Fokus setzt.
    const timer = window.setTimeout(() =>
      box.current?.querySelector<HTMLElement>('.wf-picker__value')?.click(),
    );
    return () => window.clearTimeout(timer);
  }, [openOnMount]);
  return (
    <div ref={box} className="wf-welt-picker">
      <EntityPicker
        {...props}
        onChange={(id) => {
          props.onChange(id);
          // Sofort, solange das Suchfeld der Auswahl noch da ist – so springt der Fokus nie ins Leere.
          box.current?.querySelector<HTMLElement>('.wf-picker__value')?.focus();
        }}
      />
    </div>
  );
}

/**
 * Wörter als Chips: Lebensräume, Jahreszeiten. Eingabe oder Komma nimmt das Wort auf, die Liste
 * schlägt übliche Wörter vor; ein Klick auf das Kreuz nimmt es wieder heraus.
 */
export function WordChips({
  value,
  onChange,
  suggestions,
  placeholder,
  label,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  suggestions: readonly string[];
  placeholder: string;
  /** Für Vorleser: „Lebensraum hinzufügen“. */
  label: string;
}) {
  const list = useId();
  const [typed, setTyped] = useState('');
  const has = (word: string) =>
    value.some((w) => w.toLocaleLowerCase('de') === word.toLocaleLowerCase('de'));
  const add = (text: string) => {
    const words = text
      .split(',')
      .map((w) => w.replace(/\s+/g, ' ').trim())
      .filter((w) => w && !has(w));
    if (words.length) onChange([...value, ...words]);
    setTyped('');
  };
  return (
    <div className="wf-welt-chips">
      {value.map((word) => (
        <span key={word} className="wf-welt-chip">
          {word}
          <button
            type="button"
            title={`„${word}“ entfernen`}
            aria-label={`„${word}“ entfernen`}
            onClick={() => onChange(value.filter((w) => w !== word))}
          >
            <X aria-hidden />
          </button>
        </span>
      ))}
      <Input
        className="wf-welt-chips__input"
        value={typed}
        list={list}
        placeholder={value.length ? 'Weiteres …' : placeholder}
        aria-label={label}
        onChange={(event) => {
          const next = event.target.value;
          // Aus der Vorschlagsliste gewählt: gleich übernehmen.
          const picked =
            (event.nativeEvent as InputEvent).inputType === 'insertReplacementText' ||
            (event.nativeEvent as InputEvent).inputType === undefined;
          if (next.endsWith(',') || (picked && suggestions.includes(next))) add(next);
          else setTyped(next);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !typed.trim()) return;
          event.preventDefault();
          add(typed);
        }}
        onBlur={() => typed.trim() && add(typed)}
      />
      <datalist id={list}>
        {suggestions
          .filter((word) => !has(word))
          .map((word) => (
            <option key={word} value={word} />
          ))}
      </datalist>
    </div>
  );
}

/** Zeile mit Bild, Name, Unterzeile und rechts einem Zusatz; führt zum Eintrag. */
export function EntryRow({
  entity,
  sub,
  aside,
  attitude,
}: {
  entity: Entity;
  sub?: ReactNode;
  aside?: ReactNode;
  /** Haltung zur Gruppe; undefined blendet sie aus. */
  attitude?: number | null;
}) {
  const data = useData();
  return (
    <Link href={entityHref(entity)} className="wf-welt-entry">
      <Portrait entity={entity} size={34} />
      <span className="wf-welt-entry__main">
        <span className="wf-welt-entry__name wf-clamp-1">{entity.name}</span>
        <span className="wf-welt-entry__sub wf-clamp-1">{sub ?? entitySubline(data, entity)}</span>
      </span>
      {aside}
      {attitude !== undefined && <AttitudeBadge value={attitude} />}
    </Link>
  );
}

const EVENT_KIND_LABEL: Record<EventKind, string> = {
  world: 'Weltereignis',
  plan: 'Vorhaben',
  deadline: 'Frist',
};

/** Kommende Termine in Kurzform. */
export function UpcomingList({ occurrences }: { occurrences: Occurrence[] }) {
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  return (
    <ul className="wf-welt-dates">
      {occurrences.map(({ event, at }) => (
        <li key={event.id + at}>
          <span className="wf-welt-dates__when">
            {formatShortDate(cal, now, at)}
            {event.timed && `, ${formatClock(at)}`}
          </span>
          <span className="wf-welt-dates__title">{event.title}</span>
          <span className="wf-welt-dates__meta">
            {formatRelative(now, at)} · {EVENT_KIND_LABEL[event.kind]}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Text, der an Ort und Stelle bearbeitet werden kann: Strg+Eingabe speichert, Escape verwirft.
 * Wer mitten im Schreiben woandershin klickt, verliert nichts – dann ruft der Baustein `onLeave`.
 */
function useInlineText(
  value: string,
  onSave: (text: string) => void,
  onLeave: (text: string) => void,
) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const latest = useRef({ draft, value, onLeave });
  latest.current = { draft, value, onLeave };
  useEffect(
    () => () => {
      const { draft, value, onLeave } = latest.current;
      if (draft !== null && draft.trim() !== value) onLeave(draft.trim());
    },
    [],
  );
  const start = () => setDraft(value);
  const cancel = () => setDraft(null);
  const save = () => {
    if (draft === null) return;
    if (draft.trim() !== value) onSave(draft.trim());
    setDraft(null);
  };
  const editor = editing ? (
    <div className="wf-col" style={{ gap: 'var(--s-2)' }}>
      <TextArea
        autoFocus
        value={draft}
        rows={Math.min(18, Math.max(5, draft.split('\n').length + 1))}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
      />
      <div className="wf-row">
        <span className="wf-grow wf-welt-keys">Strg+Eingabe speichert · Escape verwirft</span>
        <Button size="sm" onClick={cancel}>
          Abbrechen
        </Button>
        <Button size="sm" variant="primary" onClick={save}>
          Speichern
        </Button>
      </div>
    </div>
  ) : null;
  return { editing, start, editor };
}

/** Was in die Notizen gehört – je Art. */
const NOTES_HINT: Record<WorldEntity['kind'], string> = {
  place: 'Beschreibung, Stimmung und Einzelheiten',
  person: 'Auftreten, Stimme, Hintergründe und Einzelheiten',
  faction: 'Ziele, Mittel, Geschichte und Einzelheiten',
  item: 'Aussehen, Wirkung und Herkunft',
  topic: 'was man weiß und was gemunkelt wird',
  family: 'Herkunft, Ruf, Geschichte und Einzelheiten',
  species: 'Aussehen, Lebensweise und Eigenheiten',
  language: 'Klang, Verbreitung und Eigenheiten',
  script: 'Aussehen, Herkunft und Verbreitung',
  ability: 'Wirkung, Herkunft und Grenzen',
  plant: 'Aussehen, Wirkung und Nutzen',
  animal: 'Aussehen, Verhalten und Nutzen',
  mineral: 'Aussehen, Eigenschaften und Nutzen',
  profession: 'was man dafür können muss, Ansehen und Lohn',
};

export function NotesSection({ entity }: { entity: WorldEntity }) {
  const db = useDb();
  const { editing, start, editor } = useInlineText(
    entity.notes,
    (notes) => patchEntityIfPresent(db, entity.id, { notes }),
    (notes) => {
      if (patchEntityIfPresent(db, entity.id, { notes }))
        toast({ title: 'Notizen gespeichert', body: entity.name });
    },
  );
  return (
    <Section
      title="Notizen"
      action={
        !editing &&
        entity.notes && (
          <IconButton label="Notizen bearbeiten" size="sm" variant="ghost" onClick={start}>
            <Pencil />
          </IconButton>
        )
      }
    >
      {editor ??
        (entity.notes ? (
          <div className="wf-prose wf-welt-notes">{entity.notes}</div>
        ) : (
          <Hint
            action={
              <Button size="sm" icon={<Pencil />} onClick={start}>
                Notizen schreiben
              </Button>
            }
          >
            Noch keine Notizen – hierher gehören {NOTES_HINT[entity.kind]}.
          </Hint>
        ))}
    </Section>
  );
}

/** Spielleiterwissen: deutlich abgesetzt, damit es nie mit Vorlesbarem verwechselt wird. */
export function SecretSection({ entity }: { entity: WorldEntity }) {
  const db = useDb();
  const { editing, start, editor } = useInlineText(
    entity.secret,
    (secret) => patchEntityIfPresent(db, entity.id, { secret }),
    (secret) => {
      if (patchEntityIfPresent(db, entity.id, { secret }))
        toast({ title: 'Geheimnis gespeichert', body: entity.name });
    },
  );
  const empty = !entity.secret && !editing;
  return (
    <section className={cx('wf-welt-secret', empty && 'wf-welt-secret--empty')}>
      <div className="wf-welt-secret__head">
        <Eye />
        <span className="wf-welt-secret__title">Geheimnis</span>
        <span className="wf-welt-secret__note">
          {empty
            ? 'Noch keines – hier steht, was nur du weißt.'
            : 'Nur für dich – die Gruppe weiß das nicht.'}
        </span>
        {empty ? (
          <Button size="sm" variant="ghost" icon={<Pencil />} onClick={start}>
            Eintragen
          </Button>
        ) : (
          !editing && (
            <IconButton label="Geheimnis bearbeiten" size="sm" variant="ghost" onClick={start}>
              <Pencil />
            </IconButton>
          )
        )}
      </div>
      {editor ??
        (entity.secret ? (
          <div className="wf-prose wf-welt-secret__text">{entity.secret}</div>
        ) : null)}
    </section>
  );
}
