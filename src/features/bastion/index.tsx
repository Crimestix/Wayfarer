/**
 * Die Bastion: Einrichtungen nach Besitzer, der nächste Bastionszug, die Ereignistabelle und die
 * letzten Züge. Die Rechnung steht in `domain/bastion.ts`.
 */
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Castle, Hammer, Pencil, Plus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { useFocus } from '../../shell/focus';
import {
  ORDER_LABEL,
  STATE_LABEL,
  daysToNextTurn,
  facilityGroups,
  turnsDue,
} from '../../domain/bastion';
import type { Bastion } from '../../domain/schema';
import { trackView } from '../../domain/track';
import { formatDayMonth } from '../../domain/time/calendar';
import {
  Badge,
  Button,
  EmptyState,
  EntityPicker,
  Field,
  Input,
  Panel,
  TextArea,
  cx,
  entityHref,
} from '../../ui';
import { moveTrack } from '../fortschritt/actions';
import { addBastion, patchBastion, setFacilityState, startRepair } from './actions';
import { FacilityDialog } from './FacilityDialog';
import { TurnDialog } from './TurnDialog';
import './bastion.css';

export default function BastionPage() {
  const data = useData();
  const bastions = Object.values(data.bastions).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const [chosen, setChosen] = useState<string | null>(null);
  useFocus(['bastion'], (focus) => setChosen(focus.id));
  const bastion = bastions.find((b) => b.id === chosen) ?? bastions[0];
  return bastion ? (
    // Je Bastion eine eigene Ansicht: Die Felder mit `defaultValue` gehören sonst der vorigen.
    <BastionView key={bastion.id} bastion={bastion} others={bastions} onChoose={setChosen} />
  ) : (
    <NewBastion />
  );
}

function NewBastion() {
  const db = useDb();
  const [name, setName] = useState('');
  const [placeId, setPlaceId] = useState<string | null>(null);
  return (
    <div className="wf-page">
      <header className="wf-page__head">
        <h1 className="wf-page__title">Bastion</h1>
      </header>
      <div className="wf-bastion-blank">
        <EmptyState icon={<Castle />} title="Noch keine Bastion">
          Eure Feste nach den Regeln von 2024: Einrichtungen mit Gefolgsleuten, Befehle je
          Bastionszug, Ereignisse aus deiner eigenen Tabelle. Alle sieben Tage schlägt Wayfarer den
          Zug vor – damit er nicht vergessen wird.
        </EmptyState>
        <div className="wf-bastion-new">
          <Field label="Name">
            <Input
              value={name}
              placeholder="Feste Orvyndra"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Ort" hint="Der Ort der Bastion – ihre Räume trägst du dort ein.">
            <EntityPicker
              value={placeId}
              onChange={setPlaceId}
              kinds={['place']}
              placeholder="Ort wählen …"
            />
          </Field>
          <Button
            variant="primary"
            icon={<Plus />}
            disabled={!name.trim()}
            onClick={() => addBastion(db, name, placeId)}
          >
            Bastion anlegen
          </Button>
        </div>
      </div>
    </div>
  );
}

function BastionView({
  bastion,
  others,
  onChoose,
}: {
  bastion: Bastion;
  others: Bastion[];
  onChoose: (id: string) => void;
}) {
  const db = useDb();
  const data = useData();
  const now = data.state.now;
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [turning, setTurning] = useState(false);
  const due = turnsDue(bastion, now);
  const days = daysToNextTurn(bastion, now);
  const groups = useMemo(() => facilityGroups(data, bastion), [data, bastion]);
  const place = bastion.placeId ? data.entities[bastion.placeId] : undefined;
  const history = useMemo(
    () =>
      Object.values(data.chronicle)
        .filter((e) => e.text.startsWith(`Bastionszug ${bastion.name}`))
        .sort((a, b) => b.at - a.at)
        .slice(0, 8),
    [data.chronicle, bastion.name],
  );

  return (
    <div className="wf-page">
      <header className="wf-page__head wf-bastion-head">
        <h1 className="wf-page__title">{bastion.name}</h1>
        <span className="wf-mute">
          {place ? (
            <Link href={entityHref(place)} className="wf-bastion-place">
              {place.name}
            </Link>
          ) : (
            'ohne Ort'
          )}{' '}
          · {bastion.defenders} Verteidiger
        </span>
        <span className="wf-grow" />
        {others.length > 1 &&
          others
            .filter((b) => b.id !== bastion.id)
            .map((b) => (
              <Button key={b.id} size="sm" onClick={() => onChoose(b.id)}>
                {b.name}
              </Button>
            ))}
        <Button icon={<Plus />} onClick={() => setEditing('new')}>
          Einrichtung
        </Button>
      </header>
      <div className="wf-page__body wf-bastion-body">
        <div className={cx('wf-bastion-turnbar', due > 0 && 'wf-bastion-turnbar--due')}>
          <div>
            <div className="wf-bastion-turnbar__title">
              {due > 1
                ? `${due} Bastionszüge fällig`
                : due === 1
                  ? 'Bastionszug fällig'
                  : `Bastionszug in ${days} ${days === 1 ? 'Tag' : 'Tagen'}`}
            </div>
            <div className="wf-mute">
              {bastion.lastTurnAt !== null &&
                `der letzte war am ${formatDayMonth(data.campaign.calendar, bastion.lastTurnAt)} · alle ${bastion.turnDays} Tage`}
            </div>
          </div>
          <span className="wf-grow" />
          <Button
            variant={due > 0 ? 'primary' : undefined}
            onClick={() => setTurning(true)}
            disabled={due === 0}
          >
            Zug ausführen
          </Button>
        </div>

        <div className="wf-bastion-cols">
          <Panel title="Einrichtungen" count={bastion.facilities.length} flush>
            {bastion.facilities.length === 0 && (
              <p className="wf-bastion-none">
                Noch keine Einrichtung. Trag ein, was die Feste hat – beschädigte Räume, die erst
                repariert werden müssen, gleich mit Stand „beschädigt“.
              </p>
            )}
            {groups.map((group) => (
              <div key={group.owner?.id ?? 'gruppe'}>
                <div className="wf-bastion-owner wf-caps">{group.owner?.name ?? 'Die Gruppe'}</div>
                {group.facilities.map((facility) => {
                  const track = facility.trackId ? data.tracks[facility.trackId] : undefined;
                  const view = track ? trackView(track) : null;
                  return (
                    <div key={facility.id} className="wf-bastion-facility">
                      <div className="wf-bastion-facility__main">
                        <span className="wf-bastion-facility__name">{facility.name}</span>
                        <span className="wf-mute">
                          {[
                            facility.kind === 'basic'
                              ? 'einfach'
                              : facility.orders.map((o) => ORDER_LABEL[o]).join(', '),
                            facility.hirelings,
                            facility.roomId && data.entities[facility.roomId]?.name,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                      <div className="wf-bastion-facility__side">
                        {facility.state === 'ready' ? (
                          facility.order ? (
                            <span className="wf-bastion-facility__order">
                              {ORDER_LABEL[facility.order.name]}
                              {facility.order.text && `: ${facility.order.text}`}
                              {facility.order.turnsLeft > 0 &&
                                ` (noch ${facility.order.turnsLeft})`}
                            </span>
                          ) : (
                            facility.kind === 'special' && (
                              <span className="wf-mute">wartet auf Befehl</span>
                            )
                          )
                        ) : (
                          <>
                            <Badge tone={facility.state === 'damaged' ? 'blood' : 'ember'}>
                              {STATE_LABEL[facility.state]}
                              {view && ` · ${view.current}`}
                            </Badge>
                            {facility.state === 'damaged' && (
                              <Button
                                size="sm"
                                icon={<Hammer />}
                                onClick={() => startRepair(db, bastion.id, facility.id)}
                              >
                                Reparatur beginnen
                              </Button>
                            )}
                            {facility.state === 'repairing' && track && !view?.reached && (
                              <Button
                                size="sm"
                                icon={<Hammer />}
                                onClick={() => moveTrack(db, track.id, 1)}
                                title="Die Reparatur einen Schritt voranbringen – steht in der Chronik"
                              >
                                Weiter
                              </Button>
                            )}
                            {facility.state === 'repairing' && view?.reached && (
                              <Button
                                size="sm"
                                onClick={() =>
                                  setFacilityState(db, bastion.id, facility.id, 'ready')
                                }
                              >
                                Bereit
                              </Button>
                            )}
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Pencil />}
                          onClick={() => setEditing(facility.id)}
                        >
                          Ändern
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </Panel>

          <div className="wf-bastion-side">
            <Panel title="Ereignisse">
              <div className="wf-col" style={{ gap: 'var(--s-3)' }}>
                <Field
                  label={`Deine Tabelle (W${bastion.eventDie})`}
                  hint="Eine Zeile je Ergebnis: „1–50: Alles ruhig“. Gewürfelt wird beim Instandhalten."
                >
                  <TextArea
                    rows={6}
                    defaultValue={bastion.events}
                    placeholder={'1–50: Alles ruhig\n51–55: …'}
                    onBlur={(e) => patchBastion(db, bastion.id, { events: e.target.value })}
                  />
                </Field>
                <div className="wf-form-grid">
                  <Field label="Würfel">
                    <Input
                      inputMode="numeric"
                      defaultValue={String(bastion.eventDie)}
                      onBlur={(e) =>
                        patchBastion(db, bastion.id, {
                          eventDie: Math.max(2, Math.floor(Number(e.target.value)) || 100),
                        })
                      }
                    />
                  </Field>
                  <Field label="Verteidiger">
                    <Input
                      inputMode="numeric"
                      defaultValue={String(bastion.defenders)}
                      onBlur={(e) =>
                        patchBastion(db, bastion.id, {
                          defenders: Math.max(0, Math.floor(Number(e.target.value)) || 0),
                        })
                      }
                    />
                  </Field>
                </div>
              </div>
            </Panel>
            <Panel title="Letzte Züge" count={history.length || undefined} flush>
              {history.length === 0 ? (
                <p className="wf-bastion-none">Noch kein Zug ausgeführt.</p>
              ) : (
                history.map((entry) => (
                  <div key={entry.id} className="wf-bastion-past">
                    <span className="wf-bastion-past__when">
                      {formatDayMonth(data.campaign.calendar, entry.at)}
                    </span>
                    <span className="wf-bastion-past__text">
                      {entry.text.split('\n').slice(1).join(' · ') || 'nur die Zeit vergangen'}
                    </span>
                  </div>
                ))
              )}
            </Panel>
          </div>
        </div>
      </div>
      {editing && (
        <FacilityDialog
          bastion={bastion}
          facility={
            editing === 'new' ? undefined : bastion.facilities.find((f) => f.id === editing)
          }
          onClose={() => setEditing(null)}
        />
      )}
      {turning && <TurnDialog bastion={bastion} onClose={() => setTurning(false)} />}
    </div>
  );
}
