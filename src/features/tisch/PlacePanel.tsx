/** Hauptfläche des Spieltischs: der Ort der Gruppe mit allem, was dort eine Rolle spielt. */
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Compass,
  CornerLeftUp,
  DoorOpen,
  EyeOff,
  Feather,
  Footprints,
  Handshake,
  MapPin,
  Sparkles,
  User,
} from 'lucide-react';
import { moveParty } from '../../data/actions';
import { useData, useDb } from '../../data/hooks';
import { placePath, placeStatus } from '../../domain/derive';
import type { Place } from '../../domain/schema';
import { formatDuration } from '../../domain/time/calendar';
import { openAttitude, openMoveParty, openQuickLog } from '../../shell/commands';
import {
  AttitudeBadge,
  Badge,
  Button,
  ChronicleList,
  EmptyState,
  IconButton,
  Panel,
  Portrait,
  SectionTitle,
  cx,
  entityHref,
  toast,
} from '../../ui';
import { undoMove } from './commands';
import { absenceMinutes, castView, earlierHere, nearbyPlaces, stayLabels, type CastRow } from './model';

/** Wie viele Veränderungen sofort zu sehen sind; der Rest klappt auf. */
const CHANGES_SHOWN = 3;
/** Wie viele Einträge früherer Besuche der Spieltisch zeigt; mehr steht im Dossier. */
const EARLIER_SHOWN = 4;

/**
 * Welcher Aufenthalt gerade eingeklappt ist. Gilt, solange die App läuft, damit die Veränderungen
 * nicht bei jedem Wechsel zwischen den Bereichen wieder aufklappen.
 */
let foldedStay: string | null = null;

function CastLine({ row, away }: { row: CastRow; away?: boolean }) {
  const { entity } = row;
  return (
    <div className={cx('wf-tisch-cast', row.unmet && 'wf-tisch-cast--unmet', away && 'wf-tisch-cast--away')}>
      <Link
        href={entityHref(entity)}
        className="wf-tisch-cast__who"
        title={[entity.name, row.role, row.where, row.tagline].filter(Boolean).join(' · ')}
      >
        <Portrait entity={entity} size={38} />
        <span className="wf-tisch-cast__main">
          <span className="wf-tisch-cast__title">
            <span className="wf-tisch-cast__name wf-clamp-1">{entity.name}</span>
            {row.unmet && (
              <span className="wf-tisch-cast__tag" title="Die Gruppe hat diese Person noch nicht getroffen.">
                fremd
              </span>
            )}
            {row.promises.length > 0 && (
              <span
                className="wf-tisch-cast__promise"
                title={[
                  row.promises.length === 1 ? 'Offene Abmachung:' : `${row.promises.length} offene Abmachungen:`,
                  ...row.promises,
                ].join('\n')}
              >
                <Handshake aria-label="Offene Abmachungen" />
                {row.promises.length}
              </span>
            )}
          </span>
          <span className="wf-tisch-cast__sub wf-clamp-1">
            {row.role}
            {row.fate && (
              <>
                {row.role && ' · '}
                <span className="wf-tisch-cast__fate">{row.fate}</span>
              </>
            )}
            {row.where && (
              <>
                {(row.role || row.fate) && ' · '}
                <MapPin aria-hidden />
                {row.where}
              </>
            )}
          </span>
        </span>
      </Link>
      {row.tagline && (
        <span className="wf-tisch-cast__tagline" title={row.tagline}>
          {row.tagline}
        </span>
      )}
      {row.hasAttitude && (
        <button
          type="button"
          className="wf-tisch-cast__attitude"
          aria-label={`Haltung von ${entity.name} zur Gruppe ändern`}
          onClick={() => openAttitude({ fromId: entity.id })}
        >
          <AttitudeBadge value={row.attitude} />
        </button>
      )}
      <IconButton
        label={`Zu ${entity.name} etwas festhalten`}
        size="sm"
        variant="ghost"
        onClick={() => openQuickLog({ refs: [entity.id] })}
      >
        <Feather />
      </IconButton>
    </div>
  );
}

function CastGroup({ title, rows, away }: { title?: string; rows: CastRow[]; away?: boolean }) {
  if (!rows.length) return null;
  return (
    <div className="wf-tisch-castgroup">
      {title && <div className="wf-tisch-subtitle">{title}</div>}
      <div className="wf-tisch-castlist">
        {rows.map((row) => (
          <CastLine key={row.entity.id} row={row} away={away} />
        ))}
      </div>
    </div>
  );
}

export function PlacePanel({ place }: { place: Place }) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const status = useMemo(() => placeStatus(data, place.id), [data, place.id]);
  const cast = useMemo(() => castView(data, place.id), [data, place.id]);
  const nearby = useMemo(() => nearbyPlaces(data, place.id), [data, place.id]);
  const earlier = useMemo(() => earlierHere(data, place.id, status), [data, place.id, status]);
  const stay = stayLabels(cal, now, status);
  const absence = absenceMinutes(status, now);
  const parentPath = place.place.parentId ? placePath(data, place.place.parentId) : '';

  // Aufgeklappt bzw. eingeklappt gilt je Aufenthalt; beim nächsten Besuch ist alles wieder offen.
  const stayKey = `${place.id}:${status.current?.from ?? ''}`;
  const [folded, setFoldedState] = useState<string | null>(foldedStay);
  const setFolded = (key: string | null) => {
    foldedStay = key;
    setFoldedState(key);
  };
  const [expanded, setExpanded] = useState<string | null>(null);
  const changes = status.changesSince;
  const showAll = expanded === stayKey || changes.length <= CHANGES_SHOWN;
  const shownChanges = showAll ? changes : changes.slice(-CHANGES_SHOWN);

  const go = (target: Place) => {
    const entry = moveParty(db, target.id);
    if (!entry) return;
    toast({
      title: target.name,
      body: 'Die Gruppe ist jetzt hier. Der Ortswechsel steht in der Chronik.',
      action: {
        label: 'Rückgängig',
        run: () => {
          if (!undoMove(db, entry.id))
            toast({
              title: 'Lässt sich nicht mehr zurücknehmen',
              body: 'Die Gruppe ist inzwischen weitergezogen.',
            });
        },
      },
    });
  };

  const hasAside = Boolean(place.notes.trim() || place.secret.trim() || earlier.length);

  return (
    <Panel flush className="wf-tisch-place">
      <header className="wf-tisch-hero">
        {place.image && (
          <div className="wf-tisch-hero__image" style={{ backgroundImage: `url(${place.image})` }} aria-hidden />
        )}
        <div className="wf-tisch-hero__top">
          <div className="wf-tisch-hero__heading">
            <div className="wf-tisch-hero__kicker">
              <span className="wf-tisch-hero__category">{place.place.category || 'Ort'}</span>
              {parentPath && <span className="wf-tisch-hero__path wf-clamp-1">{parentPath}</span>}
            </div>
            <h1 className="wf-tisch-hero__name">{place.name}</h1>
          </div>
          <div className="wf-tisch-hero__actions">
            <Link href={entityHref(place)} className="wf-btn" title="Alles über diesen Ort">
              <BookOpen />
              Dossier
            </Link>
            <Button icon={<Footprints />} onClick={openMoveParty} title="Die Gruppe zieht an einen anderen Ort">
              Weiterziehen
            </Button>
          </div>
        </div>
        {place.tagline && <p className="wf-tisch-hero__tagline">{place.tagline}</p>}
        <div className="wf-tisch-hero__status">
          <Badge tone={stay.first ? 'gold' : 'ember'} icon={<Footprints />}>
            {stay.headline}
          </Badge>
          {stay.visit && <span>{stay.visit}</span>}
          {stay.since && <span>{stay.since}</span>}
        </div>
      </header>

      {(nearby.parent || nearby.children.length > 0) && (
        <nav className="wf-tisch-ways" aria-label="Orte hier">
          <span className="wf-tisch-ways__label">Orte hier</span>
          {nearby.parent && (
            <button
              type="button"
              className="wf-tisch-way wf-tisch-way--back"
              onClick={() => go(nearby.parent!)}
              title={`Die Gruppe geht zurück nach ${nearby.parent.name}`}
            >
              <CornerLeftUp />
              Zurück nach {nearby.parent.name}
            </button>
          )}
          {nearby.children.map(({ place: child, people }) => (
            <button
              key={child.id}
              type="button"
              className="wf-tisch-way"
              onClick={() => go(child)}
              title={[`Die Gruppe geht hinein: ${child.name}`, child.place.category, child.tagline]
                .filter(Boolean)
                .join('\n')}
            >
              <DoorOpen />
              {child.name}
              {people > 0 && (
                <span className="wf-tisch-way__count" aria-label={`${people} Personen dort`}>
                  <User />
                  {people}
                </span>
              )}
            </button>
          ))}
        </nav>
      )}

      <div className="wf-tisch-place__body">
        {changes.length > 0 && (
          <section className="wf-tisch-since" aria-label="Seit eurem letzten Besuch">
            <header className="wf-tisch-since__head">
              <Sparkles />
              <h2 className="wf-tisch-since__title">Seit eurem letzten Besuch</h2>
              <span className="wf-tisch-since__lead">
                {changes.length === 1 ? '1 Veränderung' : `${changes.length} Veränderungen`}
                {absence ? `, während ihr ${formatDuration(absence)} fort wart` : ''}
              </span>
              <IconButton
                label={folded === stayKey ? 'Veränderungen zeigen' : 'Veränderungen einklappen'}
                size="sm"
                variant="ghost"
                onClick={() => setFolded(folded === stayKey ? null : stayKey)}
              >
                {folded === stayKey ? <ChevronDown /> : <ChevronUp />}
              </IconButton>
            </header>
            {folded !== stayKey && (
              <>
                <ChronicleList entries={shownChanges} showDate hideRefs={[place.id]} />
                {!showAll && (
                  <button type="button" className="wf-tisch-more" onClick={() => setExpanded(stayKey)}>
                    {changes.length - CHANGES_SHOWN === 1
                      ? '1 ältere Veränderung zeigen'
                      : `${changes.length - CHANGES_SHOWN} ältere Veränderungen zeigen`}
                  </button>
                )}
              </>
            )}
          </section>
        )}

        <div className={cx('wf-tisch-cols', hasAside && 'wf-tisch-cols--split')}>
          <section className="wf-col" aria-label="Wer hier ist">
            <SectionTitle>
              Wer hier ist
              {cast.present.length > 0 && <span className="wf-tisch-count">{cast.present.length}</span>}
            </SectionTitle>
            {cast.total === 0 ? (
              <p className="wf-tisch-hint">
                Hier ist noch niemand eingetragen. Wer in der Welt diesen Ort als Aufenthalt oder Zuhause hat,
                erscheint hier von selbst. <Link href="/welt">Zur Welt</Link>
              </p>
            ) : (
              <>
                {cast.present.length === 0 && (
                  <p className="wf-tisch-hint">Gerade hält sich hier niemand auf, den du eingetragen hast.</p>
                )}
                <CastGroup rows={cast.present} />
                <CastGroup title="Fraktionen mit Sitz hier" rows={cast.factions} />
                <CastGroup title="Hier zu Hause, aber fort" rows={cast.away} away />
                <CastGroup title="Gegenstände hier" rows={cast.items} />
                <CastGroup title="Mit dem Ort verbunden" rows={cast.linked} />
              </>
            )}
          </section>

          {hasAside && (
            <div className="wf-col wf-tisch-aside">
              {place.notes.trim() && (
                <section className="wf-col" aria-label="Notizen">
                  <SectionTitle>Notizen</SectionTitle>
                  <p className="wf-prose wf-soft">{place.notes.trim()}</p>
                </section>
              )}
              {place.secret.trim() && (
                <section className="wf-tisch-secret" aria-label="Spielleiterwissen">
                  <div className="wf-tisch-secret__label">
                    <EyeOff />
                    Spielleiterwissen
                  </div>
                  <p className="wf-prose">{place.secret.trim()}</p>
                </section>
              )}
              {earlier.length > 0 && (
                <section className="wf-col" aria-label="Früher hier">
                  <SectionTitle>Früher hier</SectionTitle>
                  <div className="wf-tisch-earlier">
                    <ChronicleList
                      entries={earlier.slice(-EARLIER_SHOWN)}
                      newestFirst
                      showDate
                      hideRefs={[place.id]}
                    />
                    {earlier.length > EARLIER_SHOWN && (
                      <Link href={entityHref(place)} className="wf-tisch-more">
                        {earlier.length - EARLIER_SHOWN === 1
                          ? '1 älterer Eintrag steht im Dossier'
                          : `${earlier.length - EARLIER_SHOWN} ältere Einträge stehen im Dossier`}
                      </Link>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** Solange kein Ort gesetzt ist: einladen, einen festzulegen. */
export function NoPlace() {
  return (
    <Panel className="wf-tisch-place wf-tisch-place--empty">
      <EmptyState
        icon={<Compass />}
        title="Wo ist die Gruppe gerade?"
        action={
          <Button variant="primary" icon={<MapPin />} onClick={openMoveParty}>
            Ort der Gruppe festlegen
          </Button>
        }
      >
        Sobald die Gruppe an einem Ort ist, siehst du hier, wer dort ist, wie er zur Gruppe steht und was sich
        seit dem letzten Besuch verändert hat.
      </EmptyState>
    </Panel>
  );
}
