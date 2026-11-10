/** Kleine Bausteine, die mehrere Teile des Dossiers verwenden. */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Eye, Pencil } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import type { Occurrence } from '../../domain/derive';
import { ATTITUDES } from '../../domain/relations';
import type { Entity, EventKind } from '../../domain/schema';
import { formatClock, formatRelative } from '../../domain/time/calendar';
import {
  AttitudeBadge,
  Button,
  EntityLink,
  IconButton,
  Portrait,
  SectionTitle,
  TextArea,
  cx,
  entityHref,
} from '../../ui';
import { entitySubline, formatShortDate, type Fact, type WorldEntity } from './model';

/** CSS-Farbe einer Haltungsstufe. */
export const attitudeVar = (value: number | null): string =>
  value === null ? 'var(--ink-mute)' : `var(--att-${value < 0 ? 'n' + -value : value > 0 ? 'p' + value : '0'})`;

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

/** Sieben Rauten; die aktuelle Stufe leuchtet. Nur Anzeige. */
export function AttitudePips({ value }: { value: number | null }) {
  return (
    <span className="wf-welt-pips" aria-hidden>
      {ATTITUDES.map((level) => (
        <i
          key={level.value}
          data-on={level.value === value}
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
                {i > 0 && <span className="wf-welt-fact__sep"> › </span>}
                <EntityLink id={id} icon={false} />
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
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

/** Text, der an Ort und Stelle bearbeitet werden kann: Strg+Eingabe speichert, Escape verwirft. */
function useInlineText(value: string, onSave: (text: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
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

export function NotesSection({ entity }: { entity: WorldEntity }) {
  const db = useDb();
  const { editing, start, editor } = useInlineText(entity.notes, (notes) =>
    db.put('entities', { ...entity, notes }),
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
            Noch keine Notizen – hierher gehören Auftreten, Hintergründe und Einzelheiten.
          </Hint>
        ))}
    </Section>
  );
}

/** Spielleiterwissen: deutlich abgesetzt, damit es nie mit Vorlesbarem verwechselt wird. */
export function SecretSection({ entity }: { entity: WorldEntity }) {
  const db = useDb();
  const { editing, start, editor } = useInlineText(entity.secret, (secret) =>
    db.put('entities', { ...entity, secret }),
  );
  const empty = !entity.secret && !editing;
  return (
    <section className={cx('wf-welt-secret', empty && 'wf-welt-secret--empty')}>
      <div className="wf-welt-secret__head">
        <Eye />
        <span className="wf-welt-secret__title">Geheimnis</span>
        <span className="wf-welt-secret__note">
          {empty
            ? 'Noch keines – hierher gehört, was nur du weißt.'
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
      {editor ?? (entity.secret ? <div className="wf-prose wf-welt-secret__text">{entity.secret}</div> : null)}
    </section>
  );
}
