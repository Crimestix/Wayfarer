/** Einstieg in die Welt, solange keine Seite offen ist. Angelegt wird über das eine „Neu“. */
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Feather, FileQuestion, MapPin, Plus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { openForWriting, preloadEditor } from '../wiki';
import { continueWriting } from '../wiki/actions';
import { startFreeText } from './writing';
import {
  KIND_LABEL,
  KIND_LABEL_PLURAL,
  placeCast,
  placePath,
  placeStatus,
} from '../../domain/derive';
import { openMoveParty } from '../../shell/commands';
import { BlankPage, Button, Divider, KindIcon } from '../../ui';
import { openNew } from './editor';
import { OwnKindsPanel } from './OwnKindsPanel';
import { NameTwinsNote } from './MergeDialog';
import { useGapCount } from './Gaps';
import { setKindFilter, setWorldLayout } from './overview';
import {
  WORLD_KINDS,
  castSubline,
  describeVisit,
  partyAttitudes,
  importedWithoutEntry,
  recentWork,
  worldCounts,
} from './model';
import { EntryRow, Hint, Section } from './parts';

export function Landing() {
  const data = useData();
  const db = useDb();
  const counts = worldCounts(data);
  const total = WORLD_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
  const recent = recentWork(data, 7);
  const [, navigate] = useLocation();
  const [showAllKinds, setShowAllKinds] = useState(false);
  const emptyKinds = WORLD_KINDS.filter((kind) => counts[kind] === 0).length;
  /**
   * Frei schreiben: ein Text ohne Art und ohne Namen (F01). Man tippt in die leere Seite, mit dem
   * ersten Zeichen entsteht der Text und der Editor schreibt weiter.
   */
  const writeFree = (typed: string) => {
    const result = startFreeText(db);
    if (!result?.article) return;
    continueWriting(db, result.article.id, typed);
    openForWriting();
    navigate(`/wiki/${result.article.id}`);
  };
  const stored = data.state.placeId ? data.entities[data.state.placeId] : undefined;
  const place = stored?.kind === 'place' ? stored : undefined;
  const cast = place ? placeCast(data, place.id) : null;
  const attitudes = partyAttitudes(data);
  const current = place ? placeStatus(data, place.id).current : null;
  const stay = current ? describeVisit(data.campaign.calendar, data.state.now, current) : null;
  const present = cast ? [...cast.present, ...cast.homeUnknown, ...cast.away].slice(0, 6) : [];
  const gaps = useGapCount();
  const unsorted = useMemo(() => importedWithoutEntry(data).length, [data]);
  const presentTotal = cast ? cast.present.length + cast.homeUnknown.length + cast.away.length : 0;

  return (
    <div className="wf-welt-landing">
      <header className="wf-welt-landing__head">
        <div className="wf-welt-landing__eyebrow">Welt</div>
        <h1 className="wf-welt-landing__title">{data.campaign.name}</h1>
      </header>

      <div className="wf-welt-landing__write">
        <BlankPage
          size="lead"
          label="Frei schreiben"
          placeholder={
            total === 0 && recent.length === 0
              ? 'Fang einfach an: eine Szene, ein Ort, eine Person, ein Gedanke. Einordnen kannst du später.'
              : 'Etwas Neues – einfach lostippen. Einordnen kannst du später.'
          }
          onFocus={preloadEditor}
          onStart={writeFree}
          footer={
            <span className="wf-welt-landing__or">
              oder gleich mit Namen und Kategorie:{' '}
              <button type="button" className="wf-welt-linkish" onClick={() => openNew()}>
                <Plus aria-hidden /> Neu …
              </button>
            </span>
          }
        />
      </div>

      {recent.length > 0 && (
        <Section title="Weiterarbeiten">
          <div className="wf-welt-rows">
            {recent.map((item) =>
              item.entity ? (
                <EntryRow
                  key={item.key}
                  entity={item.entity}
                  sub={item.entity.tagline || undefined}
                  aside={<span className="wf-welt-kindtag">{item.label}</span>}
                />
              ) : (
                <Link key={item.key} href={item.href} className="wf-welt-row">
                  <span className="wf-welt-row__name wf-grow">{item.title}</span>
                  <span className="wf-welt-kindtag">{item.label}</span>
                </Link>
              ),
            )}
          </div>
        </Section>
      )}

      {total > 0 && (
        <div className="wf-welt-counts">
          {WORLD_KINDS.filter((kind) => counts[kind] > 0 || showAllKinds).map((kind) => (
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
            </div>
          ))}
        </div>
      )}
      {total > 0 && emptyKinds > 0 && (
        <button
          type="button"
          className="wf-welt-landing__more"
          aria-expanded={showAllKinds}
          onClick={() => setShowAllKinds(!showAllKinds)}
        >
          {showAllKinds
            ? 'Leere Kategorien ausblenden'
            : `${emptyKinds} weitere Kategorien ohne Einträge zeigen`}
        </button>
      )}
      {total > 0 && <OwnKindsPanel />}
      <NameTwinsNote />

      {(place || total > 0) && <Divider />}

      {(place || total > 0) && (
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

          {(gaps > 0 || unsorted > 0) && (
            <Section title="Pflege, wenn du magst">
              <div className="wf-welt-landing__care">
                {gaps > 0 && (
                  <button
                    type="button"
                    className="wf-welt-gapslink"
                    title="Verweise, die ins Leere führen, und erwähnte Einträge ohne Text"
                    onClick={() => setWorldLayout('gaps')}
                  >
                    <Feather />
                    Noch zu schreiben: {gaps}
                  </button>
                )}
                {unsorted > 0 && (
                  <button
                    type="button"
                    className="wf-welt-gapslink"
                    title="Übernommene Artikel, die noch zu keinem Eintrag der Welt gehören"
                    onClick={() => setWorldLayout('unsorted')}
                  >
                    <FileQuestion />
                    Übernommen, ohne Kategorie: {unsorted}
                  </button>
                )}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
