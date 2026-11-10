/** Einstieg in die Weltdatenbank, solange kein Eintrag gewählt ist. */
import { Link } from 'wouter';
import { ArrowRight, MapPin, Plus } from 'lucide-react';
import { useData } from '../../data/hooks';
import {
  KIND_LABEL,
  KIND_LABEL_PLURAL,
  placeCast,
  placePath,
  placeStatus,
} from '../../domain/derive';
import { openMoveParty } from '../../shell/commands';
import { Button, Divider, KindIcon } from '../../ui';
import { openEntityDialog } from './editor';
import { setKindFilter } from './overview';
import {
  WORLD_KINDS,
  castSubline,
  describeVisit,
  partyAttitudes,
  recentlyChanged,
  worldCounts,
} from './model';
import { EntryRow, Hint, Section } from './parts';

export function Landing() {
  const data = useData();
  const counts = worldCounts(data);
  const total = WORLD_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
  const recent = recentlyChanged(data, 7);
  const stored = data.state.placeId ? data.entities[data.state.placeId] : undefined;
  const place = stored?.kind === 'place' ? stored : undefined;
  const cast = place ? placeCast(data, place.id) : null;
  const attitudes = partyAttitudes(data);
  const current = place ? placeStatus(data, place.id).current : null;
  const stay = current ? describeVisit(data.campaign.calendar, data.state.now, current) : null;
  const present = cast ? [...cast.present, ...cast.away].slice(0, 6) : [];
  const presentTotal = cast ? cast.present.length + cast.away.length : 0;

  return (
    <div className="wf-welt-landing">
      <header className="wf-welt-landing__head">
        <div className="wf-welt-landing__eyebrow">Weltdatenbank</div>
        <h1 className="wf-welt-landing__title">{data.campaign.name}</h1>
        <p className="wf-welt-landing__lead">
          {total === 0
            ? 'Noch ist hier nichts verzeichnet. Lege den ersten Ort an – alles Weitere findet dort seinen Platz.'
            : 'Wähle links einen Eintrag, um sein Dossier aufzuschlagen.'}
        </p>
      </header>

      <div className="wf-welt-counts">
        {WORLD_KINDS.map((kind) => (
          <div key={kind} className="wf-welt-count">
            <button
              type="button"
              className="wf-welt-count__show"
              onClick={() => setKindFilter(kind)}
              title={`${KIND_LABEL_PLURAL[kind]} in der Übersicht zeigen`}
            >
              <KindIcon kind={kind} />
              <span className="wf-welt-count__n">{counts[kind]}</span>
              <span className="wf-welt-count__label">
                {counts[kind] === 1 ? KIND_LABEL[kind] : KIND_LABEL_PLURAL[kind]}
              </span>
            </button>
            <button
              type="button"
              className="wf-welt-count__add"
              onClick={() => openEntityDialog({ mode: 'create', kind })}
              aria-label={`${KIND_LABEL[kind]} anlegen`}
            >
              <Plus /> anlegen
            </button>
          </div>
        ))}
      </div>

      <Divider />

      <div className="wf-welt-landing__cols">
        <Section title="Wo die Gruppe ist">
          {place ? (
            <>
              <Link href={`/welt/${place.id}`} className="wf-welt-here">
                <MapPin />
                <span className="wf-grow">
                  <span className="wf-welt-here__name">{place.name}</span>
                  <span className="wf-welt-here__sub">
                    {placePath(data, place.id)}
                    {stay && ` · seit dem ${stay.from}`}
                  </span>
                </span>
                <ArrowRight />
              </Link>
              {present.length > 0 ? (
                <>
                  <div className="wf-welt-cast__label">
                    Wer hier eine Rolle spielt <span>{presentTotal}</span>
                  </div>
                  <div className="wf-welt-rows">
                    {present.map((person) => (
                      <EntryRow
                        key={person.id}
                        entity={person}
                        sub={castSubline(data, person, place.id, !cast!.present.includes(person))}
                        attitude={attitudes.get(person.id) ?? null}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <Hint>Hier ist noch niemand verzeichnet, der eine Rolle spielt.</Hint>
              )}
            </>
          ) : (
            <Hint
              action={
                <Button size="sm" onClick={() => openMoveParty()}>
                  Ort der Gruppe festlegen
                </Button>
              }
            >
              Die Gruppe hat noch keinen Aufenthaltsort. Sobald sie einen hat, siehst du hier, wer
              dort eine Rolle spielt.
            </Hint>
          )}
        </Section>

        <Section title="Zuletzt bearbeitet">
          {recent.length ? (
            <div className="wf-welt-rows">
              {recent.map((entity) => (
                <EntryRow
                  key={entity.id}
                  entity={entity}
                  sub={entity.tagline || undefined}
                  aside={<span className="wf-welt-kindtag">{KIND_LABEL[entity.kind]}</span>}
                />
              ))}
            </div>
          ) : (
            <Hint
              action={
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Plus />}
                  onClick={() => openEntityDialog({ mode: 'create', kind: 'place' })}
                >
                  Ersten Ort anlegen
                </Button>
              }
            >
              Noch keine Einträge. Was du anlegst oder änderst, steht hier griffbereit.
            </Hint>
          )}
        </Section>
      </div>
    </div>
  );
}
