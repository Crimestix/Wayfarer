/** Hauptfläche des Spieltischs: der Ort der Gruppe mit allem, was dort eine Rolle spielt. */
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
  Library,
  Map as MapIcon,
  MapPin,
  Route as RouteIcon,
  ScrollText,
  Sparkles,
  User,
} from 'lucide-react';
import { useData } from '../../data/hooks';
import { useMediaSrc } from '../../data/media';
import { placePath, placeStatus } from '../../domain/derive';
import { netsOfPlace } from '../../domain/net';
import { scenesHere } from '../../domain/scenesHere';
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
  MenuItem,
  Panel,
  Popover,
  Portrait,
  SectionTitle,
  cx,
  entityHref,
} from '../../ui';
import {
  absenceMinutes,
  castView,
  changesFresh,
  earlierHere,
  nearbyPlaces,
  stayLabels,
  type CastRow,
  type Nearby,
} from './model';
import { articleOf, placeMaps } from './wiki';
import { WeatherLine } from '../wetter';
import { ScenesHere } from './ScenesHere';
import { StocksHere } from './StocksHere';
import { WayRow } from './WayRow';
import { ArticleDialog, MapDialog } from './WikiPeek';

/** Wie viele Veränderungen sofort zu sehen sind; der Rest klappt auf. In niedrigen Fenstern weniger. */
const CHANGES_SHOWN = 3;
const CHANGES_SHOWN_LOW = 2;
/** Wie viele Einträge früherer Besuche der Spieltisch zeigt; mehr steht im Dossier. */
const EARLIER_SHOWN = 4;
/** Ab dieser Länge wird der Ortsname kleiner gesetzt, damit er den Kopf nicht sprengt. */
const LONG_NAME = 30;
/** Niedrige Fenster wie 1280 × 800 – dieselbe Grenze wie in tisch.css. */
const LOW_WINDOW = '(max-height: 860px)';

/**
 * Hat die Spielleitung die Veränderungen eines Aufenthalts von Hand auf- oder zugeklappt, gilt das,
 * solange die App läuft – auch nach einem Wechsel in einen anderen Bereich und zurück.
 */
let foldChoice: { stay: string; folded: boolean } | null = null;

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    },
    () => window.matchMedia(query).matches,
  );
}

function CastLine({ row, away }: { row: CastRow; away?: boolean }) {
  const { entity } = row;
  return (
    <div
      className={cx(
        'wf-tisch-cast',
        row.unmet && 'wf-tisch-cast--unmet',
        away && 'wf-tisch-cast--away',
      )}
    >
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
              <span
                className="wf-tisch-cast__tag"
                title="Die Gruppe hat diese Person noch nicht getroffen."
              >
                fremd
              </span>
            )}
            {row.promises.length > 0 && (
              <span
                className="wf-tisch-cast__promise"
                title={[
                  row.promises.length === 1
                    ? 'Offene Abmachung:'
                    : `${row.promises.length} offene Abmachungen:`,
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

/**
 * „Orte hier“: zurück zum Ort darüber, hinein in die Orte darunter. Die Zeile bleibt einzeilig;
 * was nicht mehr hineinpasst, steht in einer Liste hinter „weitere“.
 */
function Ways({ nearby, onGo }: { nearby: Nearby; onGo: (place: Place) => void }) {
  const row = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const total = nearby.children.length;
  const [fit, setFit] = useState(total);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => {
      let count = 0;
      for (const chip of Array.from(el.children) as HTMLElement[]) {
        if (chip.offsetLeft + chip.offsetWidth > el.clientWidth + 0.5) break;
        count++;
      }
      setFit(count);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [nearby]);

  const hidden = total - Math.min(fit, total);
  return (
    <>
      <nav className="wf-tisch-ways" aria-label="Orte hier">
        <span className="wf-tisch-ways__label">Orte hier</span>
        {nearby.parent && (
          <button
            type="button"
            className="wf-tisch-way wf-tisch-way--back"
            onClick={() => onGo(nearby.parent!)}
            title={`Die Gruppe nach ${nearby.parent.name} versetzen …`}
          >
            <CornerLeftUp />
            <span className="wf-clamp-1">Zurück nach {nearby.parent.name}</span>
          </button>
        )}
        <div className="wf-tisch-ways__row" ref={row}>
          {nearby.children.map(({ place: child, people }, i) => (
            <button
              key={child.id}
              type="button"
              className="wf-tisch-way"
              onClick={() => onGo(child)}
              // Was nicht mehr in die Zeile passt, bleibt zum Messen da, ist aber weder sicht- noch erreichbar.
              style={i >= fit ? { visibility: 'hidden' } : undefined}
              tabIndex={i >= fit ? -1 : undefined}
              aria-hidden={i >= fit || undefined}
              title={[
                `Die Gruppe hierher versetzen: ${child.name} …`,
                child.place.category,
                child.tagline,
              ]
                .filter(Boolean)
                .join('\n')}
            >
              <DoorOpen />
              <span className="wf-clamp-1">{child.name}</span>
              {people > 0 && (
                <span className="wf-tisch-way__count" aria-label={`${people} Personen dort`}>
                  <User />
                  {people}
                </span>
              )}
            </button>
          ))}
        </div>
        {hidden > 0 && (
          <button
            ref={more}
            type="button"
            className="wf-tisch-way wf-tisch-way--more"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            title="Alle Orte hier zeigen"
          >
            {fit === 0 ? `${total} Orte` : `+ ${hidden} weitere`}
            <ChevronDown />
          </button>
        )}
      </nav>
      {/* Außerhalb der Zeile, damit die Liste am Fenster ausgerichtet wird und nicht an der Zeile. */}
      <Popover
        open={open && hidden > 0}
        onClose={() => setOpen(false)}
        anchor={more}
        align="right"
        width={340}
        className="wf-tisch-waymenu"
      >
        <div className="wf-tisch-suggest__head">Hineingehen</div>
        {nearby.children.map(({ place: child, people }) => (
          <MenuItem
            key={child.id}
            icon={<DoorOpen />}
            onClick={() => {
              setOpen(false);
              onGo(child);
            }}
          >
            {child.name}
            <span className="wf-mute">
              {child.place.category && ` · ${child.place.category}`}
              {people > 0 && ` · ${people === 1 ? '1 Person' : `${people} Personen`}`}
            </span>
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}

export function PlacePanel({ place }: { place: Place }) {
  const data = useData();
  const src = useMediaSrc();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const status = useMemo(() => placeStatus(data, place.id), [data, place.id]);
  const cast = useMemo(() => castView(data, place.id), [data, place.id]);
  const nearby = useMemo(() => nearbyPlaces(data, place.id), [data, place.id]);
  const earlier = useMemo(() => earlierHere(data, place.id, status), [data, place.id, status]);
  const stay = stayLabels(cal, now, status);
  const absence = absenceMinutes(status, now);
  const parentPath = place.place.parentId ? placePath(data, place.place.parentId) : '';

  // Frisch angekommen stehen die Veränderungen offen da, nach einem Tag am Ort nur noch als Zeile
  // zum Aufklappen. Von Hand auf- oder zugeklappt gilt je Aufenthalt.
  const stayKey = `${place.id}:${status.current?.from ?? ''}`;
  const [choice, setChoice] = useState(foldChoice);
  const folded = choice?.stay === stayKey ? choice.folded : !changesFresh(status, now);
  const setFolded = (next: boolean) => {
    foldChoice = { stay: stayKey, folded: next };
    setChoice(foldChoice);
  };
  const [expanded, setExpanded] = useState<string | null>(null);
  const changes = status.changesSince;
  const shownAtOnce = useMediaQuery(LOW_WINDOW) ? CHANGES_SHOWN_LOW : CHANGES_SHOWN;
  const showAll = expanded === stayKey || changes.length <= shownAtOnce;
  const shownChanges = showAll ? changes : changes.slice(-shownAtOnce);

  // Ein Klick versetzt die Gruppe nicht: Er schlägt den Ort nur vor, der Spielleiter bestätigt.
  const go = (target: Place) => openMoveParty({ placeId: target.id });

  // Wer hier wohnt und von dem nichts anderes bekannt ist, ist vermutlich da – nur wer
  // nachweislich woanders ist (oder wessen Schicksal ungewiss ist), gilt als fort. Tote und
  // Verschollene stehen für sich (`cast.lost`).
  const atHome = cast.away.filter((row) => row.whereId === null && !row.fate);
  const gone = cast.away.filter((row) => row.whereId !== null || row.fate);

  // Aus dem Wiki: der Artikel zum Ort und die Karten, auf denen die Gruppe steht.
  const article = articleOf(data, place);
  const maps = useMemo(() => placeMaps(data, place), [data, place]);
  const nets = useMemo(() => netsOfPlace(data, place.id), [data, place.id]);
  const [reading, setReading] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  const hasAside = Boolean(place.notes.trim() || place.secret.trim() || earlier.length);
  /** Über den Ort ist noch gar nichts eingetragen. */
  const sceneCount = useMemo(() => scenesHere(data).length, [data]);
  const bare = cast.total === 0 && !hasAside && changes.length === 0 && sceneCount === 0;

  return (
    <Panel flush className="wf-tisch-place">
      <header className="wf-tisch-hero">
        {place.image && (
          <div
            className="wf-tisch-hero__image"
            style={{ backgroundImage: `url(${JSON.stringify(src(place.image))})` }}
            aria-hidden
          />
        )}
        <div className="wf-tisch-hero__top">
          <div className="wf-tisch-hero__heading">
            <div className="wf-tisch-hero__kicker">
              <span className="wf-tisch-hero__category">{place.place.category || 'Ort'}</span>
              {parentPath && <span className="wf-tisch-hero__path wf-clamp-1">{parentPath}</span>}
            </div>
            <h1
              className={cx(
                'wf-tisch-hero__name',
                place.name.length > LONG_NAME && 'wf-tisch-hero__name--long',
              )}
              title={place.name}
            >
              {place.name}
            </h1>
          </div>
          <div className="wf-tisch-hero__actions">
            {maps.length > 0 && (
              <Button
                size="sm"
                icon={<MapIcon />}
                onClick={() => setMapOpen(true)}
                title={
                  maps[0]!.own
                    ? 'Die Karte dieses Ortes'
                    : `Die Karte der Umgebung: ${maps[0]!.of.name}`
                }
                aria-label="Karte"
              >
                <span className="wf-tisch-hero__label">Karte</span>
              </Button>
            )}
            {article && (
              <Button
                size="sm"
                icon={<Library />}
                onClick={() => setReading(article.id)}
                title="Den Artikel zu diesem Ort lesen, ohne den Spieltisch zu verlassen"
                aria-label="Artikel"
              >
                <span className="wf-tisch-hero__label">Artikel</span>
              </Button>
            )}
            {nets[0] && (
              <Link
                href={`/wegenetze/${nets[0].id}`}
                className="wf-btn wf-btn--sm"
                title={`Das Wegenetz „${nets[0].name}“: wo die Gruppe steht und wohin es von hier geht`}
                aria-label="Wegenetz"
              >
                <RouteIcon />
                <span className="wf-tisch-hero__label">Wegenetz</span>
              </Link>
            )}
            <Link
              href={entityHref(place)}
              className="wf-btn wf-btn--sm"
              title="Alles über diesen Ort"
            >
              <BookOpen />
              Seite
            </Link>
            <Button
              size="sm"
              icon={<Footprints />}
              onClick={() => openMoveParty()}
              title="Die Gruppe zieht an einen anderen Ort"
            >
              Weiterziehen
            </Button>
          </div>
        </div>
        {place.tagline && (
          <p className="wf-tisch-hero__tagline" title={place.tagline}>
            {place.tagline}
          </p>
        )}
        <div className="wf-tisch-hero__status">
          <Badge tone={stay.first ? 'gold' : 'ember'} icon={<Footprints />}>
            {stay.headline}
          </Badge>
          {stay.visit && <span>{stay.visit}</span>}
          {stay.since && <span>{stay.since}</span>}
          <WeatherLine />
        </div>
      </header>

      {(nearby.parent || nearby.children.length > 0) && <Ways nearby={nearby} onGo={go} />}
      <WayRow placeId={place.id} />

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
                label={folded ? 'Veränderungen zeigen' : 'Veränderungen einklappen'}
                size="sm"
                variant="ghost"
                aria-expanded={!folded}
                onClick={() => setFolded(!folded)}
              >
                {folded ? <ChevronDown /> : <ChevronUp />}
              </IconButton>
            </header>
            {!folded && (
              <>
                <ChronicleList entries={shownChanges} showDate hideRefs={[place.id]} />
                {!showAll && (
                  <button
                    type="button"
                    className="wf-tisch-more"
                    onClick={() => setExpanded(stayKey)}
                  >
                    {changes.length - shownAtOnce === 1
                      ? '1 ältere Veränderung zeigen'
                      : `${changes.length - shownAtOnce} ältere Veränderungen zeigen`}
                  </button>
                )}
              </>
            )}
          </section>
        )}

        {bare && (
          <div className="wf-tisch-bare">
            <EmptyState
              icon={<ScrollText />}
              title="Über diesen Ort ist noch nichts eingetragen"
              action={
                <Link href={entityHref(place)} className="wf-btn">
                  <BookOpen />
                  Im Dossier ausarbeiten
                </Link>
              }
            >
              Wer hier lebt oder sich aufhält, Fraktionen mit Sitz hier und deine Notizen zum Ort
              erscheinen an dieser Stelle, sobald du sie in der Welt einträgst.
            </EmptyState>
          </div>
        )}

        {!bare && (
          <div className="wf-tisch-cols">
            <section className="wf-col" aria-label="Wer hier ist">
              <SectionTitle>
                Wer hier ist
                {cast.present.length + atHome.length > 0 && (
                  <span className="wf-tisch-count">{cast.present.length + atHome.length}</span>
                )}
              </SectionTitle>
              {cast.total === 0 ? (
                <p className="wf-tisch-hint">
                  Hier ist noch niemand eingetragen. Wer in der Welt diesen Ort als Aufenthalt oder
                  Zuhause hat, erscheint hier von selbst. <Link href="/welt">Zur Welt</Link>
                </p>
              ) : (
                <>
                  {cast.present.length + atHome.length === 0 && (
                    <p className="wf-tisch-hint">
                      Gerade hält sich hier niemand auf, den du eingetragen hast.
                    </p>
                  )}
                  <CastGroup rows={cast.present} />
                  <CastGroup
                    title={cast.present.length > 0 ? 'Hier zu Hause' : undefined}
                    rows={atHome}
                  />
                  <CastGroup title="Fraktionen mit Sitz hier" rows={cast.factions} />
                  <CastGroup title="Hier zu Hause, aber fort" rows={gone} away />
                  <CastGroup title="Tot oder verschollen" rows={cast.lost} away />
                  <CastGroup title="Gegenstände hier" rows={cast.items} />
                  <CastGroup title="Mit dem Ort verbunden" rows={cast.linked} />
                </>
              )}
            </section>

            <ScenesHere />
            <StocksHere />

            {hasAside && (
              <div className="wf-col wf-tisch-aside">
                {place.notes.trim() && (
                  <section className="wf-col" aria-label="Was hier ist">
                    <SectionTitle>Was hier ist</SectionTitle>
                    <p className="wf-prose wf-soft">{place.notes.trim()}</p>
                  </section>
                )}
                {place.secret.trim() && (
                  <section className="wf-tisch-secret" aria-label="Spielleiterwissen">
                    <div className="wf-tisch-secret__label">
                      <EyeOff />
                      Nur für dich
                    </div>
                    <p className="wf-prose">{place.secret.trim()}</p>
                  </section>
                )}
                {earlier.length > 0 && (
                  <section className="wf-col" aria-label="Was hier bisher geschah">
                    <SectionTitle>Was hier bisher geschah</SectionTitle>
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
        )}
      </div>
      <ArticleDialog articleId={reading} onClose={() => setReading(null)} />
      <MapDialog maps={maps} open={mapOpen} onClose={() => setMapOpen(false)} />
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
          <Button variant="primary" icon={<MapPin />} onClick={() => openMoveParty()}>
            Ort der Gruppe festlegen
          </Button>
        }
      >
        Sobald die Gruppe an einem Ort ist, siehst du hier, wer dort ist, wie er zur Gruppe steht
        und was sich seit dem letzten Besuch verändert hat.
      </EmptyState>
    </Panel>
  );
}
