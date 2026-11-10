/** Übersicht der Gruppe: Kennzahlen, je Gefährte eine Karte, darunter wer gerade nicht dabei ist. */
import { Link } from 'wouter';
import { Pencil, Swords, Tent, UserPlus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entitiesOfKind } from '../../domain/derive';
import type { Character } from '../../domain/schema';
import { Button, EmptyState, IconButton, Panel, Portrait, SectionTitle, confirmDialog, cx, toast } from '../../ui';
import { completeLongRest, patchCharacter } from './actions';
import {
  classLine,
  exhaustionEffect,
  joinNames,
  lacksValues,
  longRestChanges,
  partySummary,
  soleLanguages,
  type NamedValue,
  type PartySummary,
} from './model';
import { ConditionChips, ExhaustionControl, LocationControl, SheetLink, StatBand } from './parts';

// ── Kennzahlen ─────────────────────────────────────────────────────────────

/** „alle“, wenn es jeden betrifft, sonst die Namen. */
const slowestText = (value: NamedValue, count: number) =>
  value.names.length === count && count > 1 ? 'alle gleich schnell' : `${joinNames(value.names)} am langsamsten`;

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
  const { count, levels, slowest, perception, exhaustion } = summary;
  const levelText = !levels
    ? ''
    : levels.min === levels.max
      ? `alle Stufe ${levels.min}`
      : `Stufe ${levels.min}–${levels.max}`;
  const groupSub = summary.away.length ? `${levelText}, ${summary.away.length} abseits` : levelText;
  const alsoExhausted = exhaustion ? summary.exhaustedCount - exhaustion.names.length : 0;
  const partial = summary.partialLanguages;
  return (
    <Panel className="wf-gruppe-summary" flush>
      <Figure
        label="Aktive Gruppe"
        value={count}
        unit={count === 1 ? 'Gefährte' : 'Gefährten'}
        sub={groupSub}
        subTitle={summary.away.length ? `Abseits der Gruppe: ${joinNames(summary.away)}` : undefined}
      />
      <Figure
        label="Bewegung"
        value={slowest ? slowest.value : '–'}
        unit={slowest ? 'Fuß' : undefined}
        sub={slowest ? slowestText(slowest, count) : ''}
      />
      <div className="wf-gruppe-figure">
        <div className="wf-gruppe-figure__label">Passive Wahrnehmung</div>
        {perception ? (
          <div className="wf-gruppe-range">
            {(['lowest', 'highest'] as const).map((end) => (
              <div key={end}>
                <div className="wf-gruppe-figure__value wf-num">
                  {perception[end].value}
                  <small>{end === 'lowest' ? 'niedrigste' : 'höchste'}</small>
                </div>
                <div className="wf-gruppe-figure__sub wf-clamp-1" title={joinNames(perception[end].names)}>
                  {joinNames(perception[end].names)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="wf-gruppe-figure__value">–</div>
            <div className="wf-gruppe-figure__sub">noch bei niemandem eingetragen</div>
          </>
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
                    {l.language} <span className="wf-mute">({l.speakers.join(', ')})</span>
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
        sub={
          !exhaustion
            ? 'niemand ist erschöpft'
            : alsoExhausted
              ? `${joinNames(exhaustion.names)}, dazu ${alsoExhausted} ${alsoExhausted === 1 ? 'weiterer' : 'weitere'}`
              : joinNames(exhaustion.names)
        }
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
  onEdit: () => void;
}) {
  const d = character.character;
  const sole = soleLanguages(summary, character.name);
  const href = `/gruppe/${character.id}`;
  return (
    <Panel className="wf-gruppe-card" flush>
      <header className="wf-gruppe-card__head">
        <Link href={href} className="wf-gruppe-card__portrait" aria-label={`${character.name} öffnen`}>
          <Portrait entity={character} size={72} />
        </Link>
        <div className="wf-grow">
          <Link href={href} className="wf-gruppe-card__name wf-clamp-1">
            {character.name}
          </Link>
          <div className="wf-gruppe-card__class wf-clamp-1">{classLine(d)}</div>
          <div className="wf-gruppe-card__player wf-clamp-1">
            {d.player ? `gespielt von ${d.player}` : character.tagline}
          </div>
        </div>
        <IconButton label={`${character.name} bearbeiten`} variant="ghost" size="sm" onClick={onEdit}>
          <Pencil />
        </IconButton>
      </header>

      {lacksValues(d) ? (
        <button type="button" className="wf-gruppe-card__invite" onClick={onEdit}>
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
        <SheetLink character={character} onMissing={onEdit} />
      </footer>
    </Panel>
  );
}

// ── Seite ──────────────────────────────────────────────────────────────────

export function Overview({ onEdit, onCreate }: { onEdit: (id: string) => void; onCreate: () => void }) {
  const db = useDb();
  const data = useData();
  const all = entitiesOfKind(data, 'character');
  const active = all.filter((c) => c.character.active);
  const resting = all.filter((c) => !c.character.active);
  const summary = partySummary(active);

  const longRest = async () => {
    const changes = longRestChanges(active);
    const ok = await confirmDialog({
      title: 'Lange Rast abschließen?',
      confirmLabel: 'Rast abschließen',
      body: (
        <div className="wf-col">
          <p>
            Nach einer Langen Rast sinkt die Erschöpfung jedes aktiven Gefährten um eine Stufe. Das wird
            als Notiz in der Chronik festgehalten.
          </p>
          {changes.length ? (
            <ul className="wf-gruppe-restlist">
              {changes.map((c) => (
                <li key={c.id}>
                  <b>{c.name}</b>
                  <span className="wf-num">
                    Stufe {c.before} → {c.after === 0 ? 'nicht mehr erschöpft' : `Stufe ${c.after}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wf-mute">Im Augenblick ist niemand erschöpft; es wird nur die Rast vermerkt.</p>
          )}
          <p className="wf-mute">
            Die Weltzeit bleibt dabei stehen – die acht Stunden lässt du oben in der Weltleiste vergehen
            (Zeit › Lange Rast).
          </p>
        </div>
      ),
    });
    if (!ok) return;
    const result = completeLongRest(db);
    toast({
      title: 'Lange Rast abgeschlossen',
      body: result.changes.length
        ? `Erschöpfung gesenkt bei ${joinNames(result.changes.map((c) => c.name))}.`
        : 'Niemand war erschöpft. Die Rast steht in der Chronik.',
      action: { label: 'Rückgängig', run: result.undo },
    });
  };

  return (
    <div className="wf-page">
      <header className="wf-page__head">
        <div className="wf-grow">
          <h1 className="wf-page__title">Gefährten</h1>
        </div>
        <Button icon={<Tent />} onClick={longRest} disabled={!active.length} title="Senkt die Erschöpfung aller um 1">
          Lange Rast abschließen
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
            Hier stehen die Spielercharaktere mit dem, was du am Tisch brauchst: Rüstungsklasse, passive
            Werte, Sprachen, Erschöpfung und Zustände.
          </EmptyState>
        ) : (
          <>
            {active.length > 0 ? (
              <>
                <SummaryBand summary={summary} />
                <div className="wf-gruppe-grid" data-count={Math.min(active.length, 6)}>
                  {active.map((c) => (
                    <CharacterCard key={c.id} character={c} summary={summary} onEdit={() => onEdit(c.id)} />
                  ))}
                </div>
              </>
            ) : (
              <EmptyState icon={<Swords />} title="Im Augenblick ist niemand dabei">
                Alle Gefährten stehen unter „Nicht dabei“. Nimm jemanden wieder auf, damit er hier mit
                seinen Werten erscheint.
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
                        <Link href={`/gruppe/${c.id}`} className="wf-gruppe-bench__name wf-clamp-1">
                          {c.name}
                        </Link>
                        <div className="wf-gruppe-bench__sub wf-clamp-1">
                          {[classLine(c.character), c.character.player && `gespielt von ${c.character.player}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => patchCharacter(db, c.id, { active: true })}>
                        Wieder aufnehmen
                      </Button>
                      <IconButton label={`${c.name} bearbeiten`} variant="ghost" size="sm" onClick={() => onEdit(c.id)}>
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
