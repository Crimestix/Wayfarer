/**
 * Das Seitenteil des Wegenetzes: was am gewählten Punkt ist, was auf dem gewählten Weg wartet –
 * und, wenn nichts gewählt ist, das Netz selbst. Geschrieben wird sofort; es gibt kein Speichern.
 */
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { BookOpen, Footprints, Link2, Trash2, Unlink } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  hangingAt,
  parseDurationText,
  type NetLinkView,
  type NetPointView,
  type NetView,
} from '../../domain/net';
import type { Net } from '../../domain/schema';
import {
  WAY_SORTS,
  WAY_SORT_HINT,
  WAY_SORT_LABEL,
  WAY_SORT_VALUES,
  sortOfWay,
  type WaySort,
} from '../../domain/wayState';
import { formatWayTime, routeBetween } from '../../domain/ways';
import { openMoveParty } from '../../shell/commands';
import { focusOn, type Focus } from '../../shell/focus';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Written,
  entityHref,
  toast,
} from '../../ui';
import { removeWay } from '../wege/actions';
import { addNextPoint, patchNet, removeNet, removePoint } from './actions';

type Select = { type: 'point'; id: string } | { type: 'link'; id: string } | null;

/** Kurze Namen für die Art der Wege – in der Auswahl des Netzes. */
const SORT_SHORT: Record<WaySort, string> = {
  street: 'Gassen und Straßen einer Stadt',
  road: 'Befestigte Straßen',
  trail: 'Pfade und Feldwege',
  swamp: 'Pfade durch Sumpf oder Moor',
  underground: 'Gänge unter der Erde',
};

function Head({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="wf-netz-panel__head">
      <div className="wf-netz-panel__kicker">{kicker}</div>
      <h2 className="wf-netz-panel__title">{title}</h2>
      {children}
    </header>
  );
}

// ── Das Netz ───────────────────────────────────────────────────────────────

export function NetPanel({ net, view }: { net: Net; view: NetView }) {
  const db = useDb();
  const [, navigate] = useLocation();
  const open = view.links.filter((link) => link.minutes === null).length;
  const remove = () => {
    const undo = removeNet(db, net.id);
    navigate('/wegenetze');
    if (undo)
      toast({
        title: 'Wegenetz gelöscht',
        body: `${net.name} – Orte und Wege stehen weiter in der Welt.`,
        action: {
          label: 'Rückgängig',
          run: () => {
            undo();
            navigate(`/wegenetze/${net.id}`);
          },
        },
      });
  };
  return (
    <div className="wf-netz-panel__body">
      <Head kicker="Wegenetz" title={net.name}>
        <p className="wf-netz-panel__sub">
          {view.points.length === 1 ? '1 Punkt' : `${view.points.length} Punkte`} ·{' '}
          {view.links.length === 1 ? '1 Weg' : `${view.links.length} Wege`}
          {open > 0 && ` · ${open === 1 ? 'bei einem' : `bei ${open}`} ist die Dauer offen`}
        </p>
      </Head>
      <Field label="Name">
        <Written label="Name" value={net.name} onSave={(name) => patchNet(db, net.id, { name })} />
      </Field>
      <Field label="Worum es geht" hint="Nur für dich.">
        <Written
          label="Worum es geht"
          rows={4}
          value={net.note}
          placeholder="Wohin die Strecke führt, was auf ihr auf dem Spiel steht …"
          onSave={(note) => patchNet(db, net.id, { note })}
        />
      </Field>
      <Field label="Neue Wege sind" hint={WAY_SORT_HINT[net.waySort]}>
        <Select
          value={net.waySort}
          aria-label="Neue Wege sind"
          onChange={(event) => patchNet(db, net.id, { waySort: event.target.value as WaySort })}
        >
          {WAY_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {SORT_SHORT[sort]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="wf-netz-tips">
        <p>
          <b>Punkt wählen:</b> anklicken. Dann schreibst du hier, was dort ist, und hängst den
          nächsten Punkt an.
        </p>
        <p>
          <b>Weg wählen:</b> die Linie oder ihre Dauer anklicken – Dauer, Art, was unterwegs wartet.
        </p>
        <p>
          <b>Verschieben:</b> Punkte ziehen. Das Blatt selbst ziehst du am leeren Grund, das Mausrad
          vergrößert.
        </p>
        <p>
          <b>Neuer Ort:</b> Doppelklick aufs Blatt.
        </p>
      </div>
      <div className="wf-netz-panel__foot">
        <Button variant="ghost" icon={<Trash2 />} onClick={remove}>
          Wegenetz löschen
        </Button>
      </div>
    </div>
  );
}

// ── Ein Punkt ──────────────────────────────────────────────────────────────

export function PointPanel({
  net,
  point,
  links,
  linking,
  onLink,
  onSelect,
}: {
  net: Net;
  point: NetPointView;
  /** Die Wege, die an diesem Punkt hängen. */
  links: NetLinkView[];
  /** Von diesem Punkt aus wird gerade ein Weg gezogen. */
  linking: boolean;
  onLink: () => void;
  onSelect: (selected: Select) => void;
}) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const place = point.place;
  const hanging = hangingAt(data, place.id);
  const party = data.state.placeId;
  const route = party && !point.here ? routeBetween(data, party, place.id) : null;
  const [next, setNext] = useState('');
  const [nextTime, setNextTime] = useState('');
  const minutes = parseDurationText(nextTime);

  const addNext = () => {
    const added = addNextPoint(db, net.id, place.id, next, minutes);
    if (!added) return;
    setNext('');
    setNextTime('');
    onSelect({ type: 'point', id: added.place.id });
  };
  const leave = () => {
    const undo = removePoint(db, net.id, place.id);
    onSelect(null);
    if (undo)
      toast({
        title: 'Aus dem Netz genommen',
        body: `${place.name} – der Ort und seine Wege stehen weiter in der Welt.`,
        action: { label: 'Rückgängig', run: undo },
      });
  };
  const open = (href: string, focus?: Focus) => {
    focusOn(focus ?? null);
    navigate(href);
  };
  const hung: { key: string; sort: string; name: string; go: () => void }[] = [
    ...hanging.stories.map((story) => ({
      key: story.id,
      sort: 'Geschichte',
      name: story.title,
      go: () => open('/faeden', { type: 'card', key: `story:${story.id}` }),
    })),
    ...hanging.threads.map((thread) => ({
      key: thread.id,
      sort: 'Faden',
      name: thread.title,
      go: () => open('/faeden', { type: 'card', key: `thread:${thread.id}` }),
    })),
    ...hanging.clocks.map((clock) => ({
      key: clock.id,
      sort: 'Uhr',
      name: clock.title,
      go: () => open('/geschehen', { type: 'clock', id: clock.id }),
    })),
    ...hanging.stocks.map((stock) => ({
      key: stock.id,
      sort: 'Bestand',
      name: stock.name,
      go: () => open(`/bestaende/${stock.id}`),
    })),
    ...hanging.encounters.map((encounter) => ({
      key: encounter.id,
      sort: 'Begegnung',
      name: encounter.name,
      go: () => open(`/begegnungen/${encounter.id}`),
    })),
  ];

  return (
    <div className="wf-netz-panel__body">
      <Head kicker={place.place.category || 'Punkt'} title={place.name}>
        <div className="wf-netz-panel__acts">
          {point.here ? (
            <Badge tone="gold" icon={<Footprints />}>
              Die Gruppe ist hier
            </Badge>
          ) : (
            <Button
              size="sm"
              icon={<Footprints />}
              onClick={() => openMoveParty({ placeId: place.id })}
              title="Die Gruppe zieht hierher – die Zeit des Weges vergeht"
            >
              {route
                ? `Hierher gehen · ${route.minutes > 0 ? formatWayTime(route.minutes) : 'Dauer offen'}${route.unknown && route.minutes > 0 ? ' und mehr' : ''}`
                : 'Gruppe hierher'}
            </Button>
          )}
          <Link
            href={entityHref(place)}
            className="wf-btn wf-btn--sm"
            title="Alles über diesen Ort"
          >
            <BookOpen />
            Seite
          </Link>
        </div>
      </Head>

      <Field label="Was hier ist" hint="Steht auch am Spieltisch, wenn die Gruppe hier ist.">
        <Written
          label="Was hier ist"
          rows={5}
          value={place.notes}
          placeholder="Was die Gruppe vorfindet: wer hier ist, was auffällt, was zu holen ist …"
          onSave={(notes) => db.patch('entities', place.id, { notes })}
        />
      </Field>
      <Field label="Nur für dich" hint="Was dahintersteckt.">
        <Written
          label="Nur für dich"
          rows={3}
          value={place.secret}
          onSave={(secret) => db.patch('entities', place.id, { secret })}
        />
      </Field>

      {hung.length > 0 && (
        <section className="wf-netz-list" aria-label="Hängt an diesem Punkt">
          <h3 className="wf-netz-list__title">Hängt an diesem Punkt</h3>
          {hung.map((item) => (
            <button key={item.key} type="button" className="wf-netz-list__row" onClick={item.go}>
              <span className="wf-netz-list__sort">{item.sort}</span>
              <span className="wf-clamp-1">{item.name}</span>
            </button>
          ))}
        </section>
      )}

      <section className="wf-netz-list" aria-label="Wege von hier">
        <h3 className="wf-netz-list__title">Wege von hier</h3>
        {links.map((link) => {
          const other = link.from === point ? link.to : link.from;
          const blocked = link.path.oneWay && link.to === point;
          return (
            <button
              key={link.path.id}
              type="button"
              className="wf-netz-list__row"
              onClick={() => onSelect({ type: 'link', id: link.path.id })}
              title="Diesen Weg öffnen"
            >
              <span className="wf-clamp-1">
                {blocked ? 'von ' : ''}
                {other.place.name}
                {blocked ? ' (nur hierher)' : ''}
              </span>
              <span className="wf-netz-list__time">
                {link.minutes === null ? 'Dauer offen' : formatWayTime(link.minutes)}
              </span>
            </button>
          );
        })}
        {links.length === 0 && <p className="wf-netz-none">Noch kein Weg führt von hier weg.</p>}
      </section>

      <Field
        label="Nächster Punkt"
        hint="Name und – wenn du magst – die Dauer des Weges dorthin. Enter hängt ihn an."
      >
        <div className="wf-netz-next">
          <Input
            value={next}
            aria-label="Name des nächsten Punktes"
            placeholder="Name …"
            onChange={(event) => setNext(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addNext();
            }}
          />
          <Input
            value={nextTime}
            aria-label="Dauer des Weges dorthin"
            placeholder="z. B. 4 Std."
            aria-invalid={nextTime.trim() !== '' && minutes === null}
            onChange={(event) => setNextTime(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addNext();
            }}
          />
        </div>
      </Field>

      <div className="wf-netz-panel__foot">
        <Button icon={<Link2 />} aria-pressed={linking} onClick={onLink}>
          {linking ? 'Abbrechen' : 'Weg zu einem Punkt ziehen'}
        </Button>
        <Button variant="ghost" icon={<Unlink />} onClick={leave}>
          Aus dem Netz nehmen
        </Button>
      </div>
    </div>
  );
}

// ── Ein Weg ────────────────────────────────────────────────────────────────

export function LinkPanel({ link, onGone }: { link: NetLinkView; onGone: () => void }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const path = link.path;
  const patch = (change: Partial<typeof path>) => db.patch('paths', path.id, change);
  const [time, setTime] = useState(path.minutes === null ? '' : formatWayTime(path.minutes));
  const parsed = parseDurationText(time);
  const bad = time.trim() !== '' && parsed === null;
  const encounters = Object.values(data.encounters).sort((a, b) =>
    a.name.localeCompare(b.name, 'de'),
  );
  const [from, to] = [link.from.place.name, link.to.place.name];
  /** Die Dauer folgt der Länge oder einer Karte – dann ist hier nichts einzutragen. */
  const measured = path.minutes === null && link.minutes !== null;
  const slowed = path.minutes !== null && link.minutes !== null && link.minutes !== path.minutes;

  const saveTime = () => {
    if (bad) return;
    const minutes = time.trim() === '' ? null : parsed;
    if (minutes !== path.minutes) patch({ minutes });
    setTime(minutes === null ? '' : formatWayTime(minutes));
  };
  const remove = () => {
    const undo = removeWay(db, path.id);
    onGone();
    if (undo)
      toast({
        title: 'Weg gelöscht',
        body: `${from} – ${to}`,
        action: { label: 'Rückgängig', run: undo },
      });
  };

  return (
    <div className="wf-netz-panel__body">
      <Head kicker="Weg" title={`${from} ${path.oneWay ? '→' : '–'} ${to}`}>
        {link.barred && (
          <p className="wf-netz-panel__warn">Gerade nicht passierbar – eine Tür oder das Wetter.</p>
        )}
      </Head>

      <Field
        label="Dauer"
        hint={
          bad
            ? 'Das verstehe ich nicht – schreib etwa „2 Tage“, „4 Std.“ oder „30 Min.“.'
            : measured
              ? `Folgt der Länge des Weges: ${formatWayTime(link.minutes!)}. Eine Angabe hier geht vor.`
              : slowed
                ? `Heute ${formatWayTime(link.minutes!)} – das Wetter bremst.`
                : 'Zu Fuß. Leer = noch offen.'
        }
      >
        <Input
          value={time}
          aria-label="Dauer"
          aria-invalid={bad}
          placeholder="z. B. 2 Tage, 4 Std., 30 Min."
          onChange={(event) => setTime(event.target.value)}
          onBlur={saveTime}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </Field>
      <Field label="Was für ein Weg" hint={WAY_SORT_HINT[sortOfWay(path)]}>
        <Select
          value={sortOfWay(path)}
          aria-label="Was für ein Weg"
          onChange={(event) => patch(WAY_SORT_VALUES[event.target.value as WaySort])}
        >
          {WAY_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {WAY_SORT_LABEL[sort]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Name des Weges" hint="Nur wenn er einen hat.">
        <Written label="Name des Weges" value={path.name} onSave={(name) => patch({ name })} />
      </Field>
      <Field label="Besonderheiten" hint="Zoll, Wachen, nur bei Ebbe, eingestürzt …">
        <Written
          label="Besonderheiten"
          value={path.conditions}
          onSave={(conditions) => patch({ conditions })}
        />
      </Field>
      <Field
        label="Unterwegs"
        hint="Was auf diesem Weg wartet – nur für dich. Steht beim Aufbruch dabei."
      >
        <Written
          label="Unterwegs"
          rows={4}
          value={path.onTheWay}
          placeholder="Ein Hindernis, eine Szene, eine Probe, eine Spur …"
          onSave={(onTheWay) => patch({ onTheWay })}
        />
      </Field>
      <Field label="Begegnung unterwegs" hint="Eine vorbereitete Begegnung aus dem Bestiarium.">
        <div className="wf-netz-next">
          <Select
            value={path.encounterId ?? ''}
            aria-label="Begegnung unterwegs"
            onChange={(event) => patch({ encounterId: event.target.value || null })}
          >
            <option value="">Keine</option>
            {encounters.map((encounter) => (
              <option key={encounter.id} value={encounter.id}>
                {encounter.name}
              </option>
            ))}
          </Select>
          {path.encounterId && data.encounters[path.encounterId] && (
            <Button size="sm" onClick={() => navigate(`/begegnungen/${path.encounterId}`)}>
              Öffnen
            </Button>
          )}
        </div>
      </Field>
      <Checkbox checked={path.oneWay} onChange={(oneWay) => patch({ oneWay })}>
        Nur von {from} nach {to}
      </Checkbox>
      <Checkbox checked={path.secret} onChange={(secret) => patch({ secret })}>
        Die Gruppe kennt diesen Weg noch nicht
      </Checkbox>

      <div className="wf-netz-panel__foot">
        <Button variant="ghost" icon={<Trash2 />} onClick={remove}>
          Weg löschen
        </Button>
      </div>
    </div>
  );
}
