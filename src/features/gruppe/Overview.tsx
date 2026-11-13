/** Übersicht der Gruppe: Kennzahlen, je Gefährte eine Karte, darunter wer gerade nicht dabei ist. */
import { Link } from 'wouter';
import { Pencil, Swords, Tent, UserPlus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entitiesOfKind } from '../../domain/derive';
import type { Character } from '../../domain/schema';
import { FATE_LABEL } from '../../domain/chronicleKinds';
import { Badge, Button, EmptyState, IconButton, Panel, Portrait, SectionTitle, cx } from '../../ui';
import { openRest } from '../../shell/commands';
import { patchCharacter } from './actions';
import type { EditFocus } from './EditDialog';
import { SpotlightPanel } from './HeroArc';
import { OnTheRoad } from './OnTheRoad';
import {
  classLine,
  exhaustionEffect,
  exhaustionLine,
  groupLine,
  joinNames,
  lacksValues,
  partySummary,
  shortNames,
  slowestLine,
  soleLanguages,
  speakersLabel,
  type PartySummary,
} from './model';
import { ConditionChips, ExhaustionControl, LocationControl, SheetLink, StatBand } from './parts';

// ── Kennzahlen ─────────────────────────────────────────────────────────────

function Figure({
  label,
  value,
  unit,
  sub,
  subTitle,
  tone,
}: {
  label: string;
  value: string | number;
  unit?: string;
  sub: string;
  /** Ausführlicher Hinweis unter dem Zeiger; Vorgabe ist die Unterzeile selbst. */
  subTitle?: string;
  tone?: 'warn' | 'danger' | 'quiet';
}) {
  return (
    <div className={cx('wf-gruppe-figure', tone && `wf-gruppe-figure--${tone}`)}>
      <div className="wf-gruppe-figure__label">{label}</div>
      <div className="wf-gruppe-figure__value wf-num">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      <div className="wf-gruppe-figure__sub wf-clamp-2" title={subTitle ?? sub}>
        {sub}
      </div>
    </div>
  );
}

function SummaryBand({ summary }: { summary: PartySummary }) {
  const { count, slowest, perception, exhaustion } = summary;
  const partial = summary.partialLanguages;
  return (
    <Panel className="wf-gruppe-summary" flush>
      <Figure
        label="Aktive Gruppe"
        value={count}
        unit={count === 1 ? 'Gefährte' : 'Gefährten'}
        sub={groupLine(summary)}
        subTitle={
          summary.away.length ? `Abseits der Gruppe: ${joinNames(summary.away)}` : undefined
        }
      />
      <Figure
        label="Bewegung"
        value={slowest ? slowest.value : '–'}
        unit={slowest ? 'Fuß' : undefined}
        sub={slowestLine(summary)}
        subTitle={slowest ? `${joinNames(slowest.names)}: ${slowest.value} Fuß` : undefined}
        tone={slowest && slowest.value === 0 ? 'warn' : undefined}
      />
      <div className="wf-gruppe-figure">
        <div className="wf-gruppe-figure__label">Passive Wahrnehmung</div>
        {!perception ? (
          <>
            <div className="wf-gruppe-figure__value wf-gruppe-figure__value--none">–</div>
            <div className="wf-gruppe-figure__sub">noch bei niemandem eingetragen</div>
          </>
        ) : (
          <div
            className="wf-gruppe-range"
            title={
              perception.missing.length
                ? `Noch nicht eingetragen bei ${joinNames(perception.missing)}`
                : undefined
            }
          >
            {(perception.uniform ? (['lowest'] as const) : (['lowest', 'highest'] as const)).map(
              (end) => (
                <div key={end}>
                  <div className="wf-gruppe-figure__value wf-num">
                    {perception[end].value}
                    <small>
                      {perception.uniform
                        ? 'bei allen'
                        : end === 'lowest'
                          ? 'niedrigste'
                          : 'höchste'}
                    </small>
                  </div>
                  {!perception.uniform && (
                    <div
                      className="wf-gruppe-figure__sub wf-clamp-1"
                      title={joinNames(perception[end].names)}
                    >
                      {shortNames(perception[end].names)}
                    </div>
                  )}
                </div>
              ),
            )}
            {perception.missing.length > 0 && (
              <div className="wf-gruppe-range__missing wf-clamp-1">
                fehlt noch bei {shortNames(perception.missing)}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="wf-gruppe-figure wf-gruppe-figure--tongues">
        <div className="wf-gruppe-figure__label">Sprachen</div>
        {summary.commonLanguages.length || partial.length ? (
          <dl className="wf-gruppe-tongues">
            <dt>Alle sprechen</dt>
            <dd>
              {summary.commonLanguages.length ? (
                summary.commonLanguages.join(', ')
              ) : (
                <span className="wf-mute">keine gemeinsame Sprache</span>
              )}
            </dd>
            <dt>Nur einzelne</dt>
            <dd
              className="wf-gruppe-tongues__rare"
              title={partial.map((l) => `${l.language}: ${joinNames(l.speakers)}`).join('\n')}
            >
              {partial.length ? (
                partial.map((l, i) => (
                  <span key={l.language}>
                    {i > 0 && ' · '}
                    <span className="wf-gruppe-tongues__one">
                      {l.language} <span className="wf-mute">({speakersLabel(l, count)})</span>
                    </span>
                  </span>
                ))
              ) : (
                <span className="wf-mute">keine weiteren</span>
              )}
            </dd>
          </dl>
        ) : (
          <div className="wf-gruppe-figure__sub wf-gruppe-figure__sub--lone">
            Noch keine Sprachen eingetragen. Sie stehen im Dialog „Bearbeiten“ jedes Gefährten.
          </div>
        )}
      </div>
      <Figure
        label="Erschöpfung"
        value={exhaustion ? `Stufe ${exhaustion.value}` : '–'}
        sub={exhaustionLine(summary)}
        subTitle={exhaustion ? joinNames(exhaustion.names) : undefined}
        tone={!exhaustion ? 'quiet' : exhaustionEffect(exhaustion.value).dead ? 'danger' : 'warn'}
      />
    </Panel>
  );
}

// ── Karte ──────────────────────────────────────────────────────────────────

function CharacterCard({
  character,
  summary,
  onEdit,
}: {
  character: Character;
  summary: PartySummary;
  onEdit: (focus?: EditFocus) => void;
}) {
  const d = character.character;
  const sole = soleLanguages(summary, character.id);
  const href = `/gruppe/${character.id}`;
  return (
    <Panel className="wf-gruppe-card" flush>
      <header className="wf-gruppe-card__head">
        <Link
          href={href}
          className="wf-gruppe-card__portrait"
          aria-label={`${character.name} öffnen`}
        >
          <Portrait entity={character} size={72} />
        </Link>
        <div className="wf-grow">
          <Link href={href} className="wf-gruppe-card__name wf-clamp-1" title={character.name}>
            {character.name}
          </Link>
          <div className="wf-gruppe-card__class wf-clamp-1" title={classLine(d)}>
            {d.status !== 'alive' && (
              <>
                <Badge tone="blood">{FATE_LABEL[d.status]}</Badge>{' '}
              </>
            )}
            {classLine(d)}
          </div>
          <div className="wf-gruppe-card__player wf-clamp-1">
            {d.player ? `gespielt von ${d.player}` : character.tagline}
          </div>
        </div>
        <IconButton
          label={`${character.name} bearbeiten`}
          variant="ghost"
          size="sm"
          onClick={() => onEdit()}
        >
          <Pencil />
        </IconButton>
      </header>

      {lacksValues(d) ? (
        <button type="button" className="wf-gruppe-card__invite" onClick={() => onEdit()}>
          <b>Werte eintragen</b>
          <span>Rüstungsklasse, passive Werte und Sprachen fehlen noch.</span>
        </button>
      ) : (
        <StatBand character={character} />
      )}

      <dl className="wf-gruppe-rows">
        <dt>Sprachen</dt>
        <dd className="wf-clamp-2" title={d.languages.join(', ')}>
          {d.languages.length ? (
            d.languages.map((l, i) => (
              <span key={l}>
                {i > 0 && ', '}
                {sole.includes(l) ? (
                  <span className="wf-gruppe-sole" title={`Nur ${character.name} spricht ${l}.`}>
                    {l}
                  </span>
                ) : (
                  l
                )}
              </span>
            ))
          ) : (
            <span className="wf-gruppe-none">keine eingetragen</span>
          )}
        </dd>
        <dt>Erschöpfung</dt>
        <dd>
          <ExhaustionControl character={character} />
        </dd>
        <dt>Zustände</dt>
        <dd>
          <ConditionChips character={character} />
        </dd>
      </dl>

      <footer className="wf-gruppe-card__foot">
        <LocationControl character={character} />
        <span className="wf-grow" />
        <SheetLink character={character} onMissing={() => onEdit('sheet')} />
      </footer>
    </Panel>
  );
}

// ── Seite ──────────────────────────────────────────────────────────────────

export function Overview({
  onEdit,
  onCreate,
}: {
  onEdit: (id: string, focus?: EditFocus) => void;
  onCreate: () => void;
}) {
  const db = useDb();
  const data = useData();
  const all = entitiesOfKind(data, 'character');
  const active = all.filter((c) => c.character.active);
  const resting = all.filter((c) => !c.character.active);
  const summary = partySummary(active);

  return (
    <div className="wf-page">
      <header className="wf-page__head">
        <div className="wf-grow">
          <h1 className="wf-page__title">Gefährten</h1>
        </div>
        <Button
          icon={<Tent />}
          onClick={() => openRest('long')}
          disabled={!active.length}
          title="Kurze oder Lange Rast: Die Zeit vergeht, die Gruppe erholt sich"
        >
          Rast …
        </Button>
        <Button icon={<UserPlus />} onClick={onCreate}>
          Gefährte anlegen
        </Button>
      </header>
      <div className="wf-page__body wf-gruppe-body">
        {all.length === 0 ? (
          <EmptyState
            icon={<Swords />}
            title="Noch keine Gefährten"
            action={
              <Button variant="primary" icon={<UserPlus />} onClick={onCreate}>
                Ersten Gefährten anlegen
              </Button>
            }
          >
            Hier stehen die Spielercharaktere mit dem, was du am Tisch brauchst: Rüstungsklasse,
            passive Werte, Sprachen, Erschöpfung und Zustände.
          </EmptyState>
        ) : (
          <>
            {active.length > 0 ? (
              <>
                <SummaryBand summary={summary} />
                <OnTheRoad />
                <div className="wf-gruppe-grid" data-count={Math.min(active.length, 6)}>
                  {active.map((c) => (
                    <CharacterCard
                      key={c.id}
                      character={c}
                      summary={summary}
                      onEdit={(focus) => onEdit(c.id, focus)}
                    />
                  ))}
                </div>
                <SpotlightPanel />
              </>
            ) : (
              <EmptyState icon={<Swords />} title="Im Augenblick ist niemand dabei">
                Alle Gefährten stehen unter „Nicht dabei“. Nimm jemanden wieder auf, damit er hier
                mit seinen Werten erscheint.
              </EmptyState>
            )}
            {resting.length > 0 && (
              <section className="wf-gruppe-bench">
                <SectionTitle>Nicht dabei</SectionTitle>
                <div className="wf-gruppe-bench__list">
                  {resting.map((c) => (
                    <div key={c.id} className="wf-gruppe-bench__item">
                      <Portrait entity={c} size={40} />
                      <div className="wf-grow">
                        <Link
                          href={`/gruppe/${c.id}`}
                          className="wf-gruppe-bench__name wf-clamp-1"
                          title={c.name}
                        >
                          {c.name}
                        </Link>
                        <div className="wf-gruppe-bench__sub wf-clamp-1">
                          {[
                            classLine(c.character),
                            c.character.player && `gespielt von ${c.character.player}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => patchCharacter(db, c.id, { active: true })}>
                        Wieder aufnehmen
                      </Button>
                      <IconButton
                        label={`${c.name} bearbeiten`}
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(c.id)}
                      >
                        <Pencil />
                      </IconButton>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
