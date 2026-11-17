/** Ein Gefährte im Ganzen: Werte, Notizen, Geheimnis, Beziehungen, Abmachungen, Chronik. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowLeft,
  EyeOff,
  Feather,
  Handshake,
  Pencil,
  Plus,
  Swords,
  UserPlus,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { FATE_LABEL, fateSinceLabel } from '../../domain/chronicleKinds';
import { chronicleFor, entitiesOfKind, openPromises } from '../../domain/derive';
import { partyCompanions, personasOf } from '../../domain/history';
import { formatGold, lootLine, receivedBy } from '../../domain/loot';
import { attunementOf } from '../../domain/magicItem';
import { relationLabel } from '../../domain/relations';
import type { Character } from '../../domain/schema';
import { openAttitude, openQuickLog } from '../../shell/commands';
import {
  AttitudeBadge,
  Badge,
  Button,
  ChronicleList,
  EmptyState,
  OpenConditions,
  EntityLink,
  IconButton,
  Panel,
  Portrait,
  TextArea,
  cx,
} from '../../ui';
import { patchCharacter, toggleCharacterCondition } from './actions';
import { BondDialog } from './BondDialog';
import { HeroArcPanel } from './HeroArc';
import { BackstoryPanel, FacilitiesPanel } from './Backstory';
import type { EditFocus } from './EditDialog';
import {
  characterBonds,
  classLine,
  partySummary,
  soleLanguages,
  sortConditions,
  type CharacterBond,
} from './model';
import {
  ConditionToggles,
  ExhaustionControl,
  HpControl,
  BodyControl,
  LocationControl,
  SheetLink,
  StatBand,
} from './parts';

// ── Wechsel zwischen den Gefährten ─────────────────────────────────────────

function Roster({ all, currentId }: { all: Character[]; currentId: string }) {
  const sorted = [...all].sort((a, b) => Number(b.character.active) - Number(a.character.active));
  const list = useRef<HTMLDivElement>(null);
  // Bei vielen Gefährten rollt die Leiste; der gewählte soll dabei immer zu sehen sein.
  useEffect(() => {
    list.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [currentId, all.length]);
  return (
    <nav className="wf-gruppe-roster" aria-label="Gefährten">
      <Link href="/gruppe" className="wf-gruppe-roster__back">
        <ArrowLeft />
        Alle Gefährten
      </Link>
      <div
        ref={list}
        className="wf-gruppe-roster__list"
        // Das Mausrad rollt die Leiste seitwärts.
        onWheel={(e) => {
          if (e.deltaY) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {sorted.map((c) => (
          <Link
            key={c.id}
            href={`/gruppe/${c.id}`}
            className={cx(
              'wf-gruppe-roster__item',
              !c.character.active && 'wf-gruppe-roster__item--resting',
            )}
            aria-current={c.id === currentId ? 'page' : undefined}
            title={c.character.active ? c.name : `${c.name} – nicht dabei`}
          >
            <Portrait entity={c} size={30} round />
            <span className="wf-gruppe-roster__name">{c.name}</span>
            {(c.character.exhaustion > 0 || c.character.conditions.length > 0) && (
              <i className="wf-gruppe-roster__flag" aria-label="erschöpft oder mit Zustand" />
            )}
          </Link>
        ))}
      </div>
    </nav>
  );
}

// ── Notizen und Geheimnis ──────────────────────────────────────────────────

function NotePanel({
  title,
  value,
  empty,
  placeholder,
  secret,
  onSave,
}: {
  title: string;
  value: string;
  /** Satz, der bei leerem Feld sagt, was hier hingehört. */
  empty: string;
  placeholder: string;
  secret?: boolean;
  onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  const save = () => {
    onSave(text.trim());
    setEditing(false);
  };
  const cancel = () => {
    setText(value);
    setEditing(false);
  };
  return (
    <Panel
      className={cx('wf-gruppe-note', secret && 'wf-gruppe-note--secret')}
      title={
        <>
          {secret && <EyeOff className="wf-gruppe-note__icon" />}
          {title}
        </>
      }
      actions={
        !editing && (
          <IconButton
            label={`${title} bearbeiten`}
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </IconButton>
        )
      }
    >
      {editing ? (
        <div className="wf-col">
          <TextArea
            autoFocus
            value={text}
            placeholder={placeholder}
            style={{ minHeight: 132 }}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
              if (e.key === 'Escape') {
                e.stopPropagation();
                cancel();
              }
            }}
          />
          <div className="wf-row">
            <span className="wf-grow wf-field__hint">Strg+Eingabe speichert, Escape verwirft.</span>
            <Button size="sm" onClick={cancel}>
              Abbrechen
            </Button>
            <Button size="sm" variant="primary" onClick={save}>
              Speichern
            </Button>
          </div>
        </div>
      ) : value ? (
        <div className="wf-prose wf-gruppe-note__text">{value}</div>
      ) : (
        <p className="wf-gruppe-hint">
          {empty}{' '}
          <button type="button" className="wf-gruppe-textlink" onClick={() => setEditing(true)}>
            Jetzt schreiben
          </button>
        </p>
      )}
    </Panel>
  );
}

// ── Beziehungen ────────────────────────────────────────────────────────────

function BondRow({
  bond,
  character,
  onEdit,
}: {
  bond: CharacterBond;
  character: Character;
  onEdit: () => void;
}) {
  const { other, incoming, outgoing } = bond;
  const secret = incoming?.secret || outgoing?.secret;
  return (
    <div className={cx('wf-gruppe-bond', bond.ended && 'wf-gruppe-bond--ended')}>
      <Portrait entity={other} size={40} />
      <div className="wf-grow">
        <div className="wf-gruppe-bond__name">
          <EntityLink id={other.id} icon={false} />
          {secret && (
            <Badge tone="arcane" icon={<EyeOff />} title="Die Gruppe weiß nichts davon">
              geheim
            </Badge>
          )}
          {bond.ended && <Badge>besteht nicht mehr</Badge>}
        </div>
        <div className="wf-gruppe-bond__line">
          {incoming && (
            <span>
              {relationLabel(incoming, 'from')} {character.name}
            </span>
          )}
          {outgoing && (
            <span className="wf-mute">
              {incoming && ' · '}
              {character.name} {relationLabel(outgoing, 'from')} {other.name}
            </span>
          )}
        </div>
        {(incoming?.note || outgoing?.note) && (
          <div className="wf-gruppe-bond__note">{incoming?.note || outgoing?.note}</div>
        )}
      </div>
      <button
        type="button"
        className="wf-gruppe-bond__attitude"
        title={`Haltung von ${other.name} gegenüber ${character.name} ändern`}
        onClick={() => openAttitude({ fromId: other.id, toId: character.id })}
      >
        <AttitudeBadge value={incoming?.attitude ?? null} />
      </button>
      <IconButton label="Beziehung bearbeiten" variant="ghost" size="sm" onClick={onEdit}>
        <Pencil />
      </IconButton>
    </div>
  );
}

// ── Seite ──────────────────────────────────────────────────────────────────

/** So viele Einträge des Beute-Buchs stehen beim Gefährten; der Rest steht im Buch. */
const RECEIVED_SHOWN = 6;

export function Detail({
  id,
  onEdit,
  onCreate,
}: {
  id: string;
  onEdit: (id: string, focus?: EditFocus) => void;
  onCreate: () => void;
}) {
  const db = useDb();
  const data = useData();
  const all = entitiesOfKind(data, 'character');
  const entity = data.entities[id];
  const character = entity?.kind === 'character' ? entity : null;
  /** undefined = zu, null = neue Beziehung, sonst das Gegenüber. */
  const [bondFor, setBondFor] = useState<string | null | undefined>(undefined);

  if (!character)
    return (
      <div className="wf-page">
        <header className="wf-page__head">
          <h1 className="wf-page__title">Gefährten</h1>
        </header>
        <div className="wf-page__body">
          <EmptyState
            icon={<Swords />}
            title="Diesen Gefährten gibt es nicht mehr"
            action={
              <div className="wf-row">
                <Link href="/gruppe" className="wf-btn">
                  <ArrowLeft />
                  Zu allen Gefährten
                </Link>
                <Button icon={<UserPlus />} onClick={onCreate}>
                  Gefährte anlegen
                </Button>
              </div>
            }
          >
            Vielleicht wurde er gelöscht oder auf einem anderen Gerät entfernt.
          </EmptyState>
        </div>
      </div>
    );

  const d = character.character;
  const bonds = characterBonds(data, character.id);
  const promises = openPromises(data, character.id);
  const chronicle = chronicleFor(data, character.id);
  /** Was dieser Gefährte am Tisch bekommen hat (Beute-Buch). */
  const received = receivedBy(data, character.id);
  const sole = soleLanguages(partySummary(all.filter((c) => c.character.active)), character.id);
  const active = sortConditions(d.conditions);
  /** Tiere und Wesen, die mit diesem Gefährten ziehen. */
  const beasts = partyCompanions(data, character.id);
  /** Zweite Gestalten: eigene Einträge, verbunden über „ist die zweite Gestalt von“. */
  const personas = personasOf(data, character.id);
  const attuned = attunementOf(data, character.id);
  const fate =
    d.status === 'alive'
      ? null
      : (fateSinceLabel(data, character.id) ??
        `${FATE_LABEL[d.status].charAt(0).toUpperCase()}${FATE_LABEL[d.status].slice(1)}`);
  const log = (kind?: 'promise') => openQuickLog({ kind, refs: [character.id] });

  return (
    <div className="wf-gruppe-detail">
      <Roster all={all} currentId={character.id} />
      <div className="wf-gruppe-dossier">
        <header className="wf-gruppe-hero">
          <Portrait entity={character} size={124} />
          <div className="wf-grow">
            <div className="wf-caps">
              {d.active ? 'Gefährte' : 'Gefährte · im Augenblick nicht dabei'}
            </div>
            <h1 className="wf-gruppe-hero__name">
              {character.name}
              {fate && (
                <>
                  {' '}
                  <Badge tone="blood" title="Schicksal aus der Chronik">
                    {fate}
                  </Badge>
                </>
              )}
            </h1>
            {character.aliases.length > 0 && (
              <div className="wf-mute">Auch: {character.aliases.join(', ')}</div>
            )}
            <div className="wf-gruppe-hero__class">
              {classLine(d)}
              {d.player && <span className="wf-mute"> · gespielt von {d.player}</span>}
            </div>
            {character.tagline && <p className="wf-gruppe-hero__tagline">{character.tagline}</p>}
          </div>
          <div className="wf-gruppe-hero__actions">
            <div className="wf-row">
              <Button variant="primary" icon={<Feather />} onClick={() => log()}>
                Festhalten
              </Button>
              {!d.active && (
                <Button onClick={() => patchCharacter(db, character.id, { active: true })}>
                  Wieder aufnehmen
                </Button>
              )}
              <Button icon={<Pencil />} onClick={() => onEdit(character.id)}>
                Bearbeiten
              </Button>
            </div>
            <SheetLink character={character} onMissing={() => onEdit(character.id, 'sheet')} />
          </div>
        </header>

        <div className="wf-gruppe-cols">
          <div className="wf-gruppe-col">
            <Panel title="Am Tisch" flush>
              <StatBand character={character} />
              <dl className="wf-gruppe-rows wf-gruppe-rows--roomy">
                <dt>Trefferpunkte</dt>
                <dd>
                  <HpControl character={character} />
                </dd>
                <dt>Erschöpfung</dt>
                <dd>
                  <ExhaustionControl character={character} size="lg" />
                </dd>
                <dt>Zustände</dt>
                <dd className="wf-gruppe-stack">
                  <ConditionToggles
                    value={active}
                    rules="active"
                    onToggle={(name) => toggleCharacterCondition(db, character.id, name)}
                  />
                  <OpenConditions entityId={character.id} />
                </dd>
                {personas.length > 0 && (
                  <>
                    <dt>Zweite Gestalt</dt>
                    <dd className="wf-gruppe-stack">
                      {personas.map((id) => (
                        <EntityLink key={id} id={id} />
                      ))}
                    </dd>
                  </>
                )}
                {beasts.length > 0 && (
                  <>
                    <dt>Begleiter</dt>
                    <dd className="wf-gruppe-stack">
                      {beasts.map((beast) => (
                        <EntityLink key={beast.relationId} id={beast.entityId} />
                      ))}
                    </dd>
                  </>
                )}
                {attuned.count > 0 && (
                  <>
                    <dt>Eingestimmt</dt>
                    <dd className="wf-gruppe-stack">
                      <span>
                        {attuned.count} von {attuned.limit}
                      </span>
                      {attuned.items.map((item) => (
                        <EntityLink key={item.id} id={item.id} />
                      ))}
                      {attuned.hint && <div className="wf-field__hint">{attuned.hint}</div>}
                    </dd>
                  </>
                )}
                <dt>Sprachen</dt>
                <dd>
                  {d.languages.length ? (
                    d.languages.map((l, i) => (
                      <span key={l}>
                        {i > 0 && ', '}
                        {sole.includes(l) ? (
                          <span
                            className="wf-gruppe-sole"
                            title={`Nur ${character.name} spricht ${l}.`}
                          >
                            {l}
                          </span>
                        ) : (
                          l
                        )}
                      </span>
                    ))
                  ) : (
                    <button
                      type="button"
                      className="wf-gruppe-textlink"
                      onClick={() => onEdit(character.id, 'languages')}
                    >
                      Sprachen eintragen
                    </button>
                  )}
                  {sole.length > 0 && (
                    <div className="wf-field__hint">
                      Hervorgehoben: spricht in der Gruppe sonst niemand.
                    </div>
                  )}
                </dd>
                <dt>Aufenthalt</dt>
                <dd>
                  <LocationControl character={character} roomy />
                </dd>
                <dt>Körper</dt>
                <dd>
                  <BodyControl character={character} />
                </dd>
              </dl>
            </Panel>
            <BackstoryPanel character={character} />
            <NotePanel
              title="Notizen"
              value={character.notes}
              empty="Hintergrund, Ziele, lose Fäden – was du über diesen Charakter im Kopf behalten willst."
              placeholder="Was du über diesen Charakter im Kopf behalten willst"
              onSave={(notes) => db.patch('entities', character.id, { notes })}
            />
            <NotePanel
              secret
              title="Geheimnis der Spielleitung"
              value={character.secret}
              empty="Was der Spieler oder die Gruppe über diesen Charakter noch nicht weiß."
              placeholder="Was der Spieler oder die Gruppe noch nicht weiß"
              onSave={(secret) => db.patch('entities', character.id, { secret })}
            />
          </div>

          <div className="wf-gruppe-col">
            <Panel
              title={
                <span className="wf-gruppe-clip" title={`Wer wie zu ${character.name} steht`}>
                  Wer wie zu {character.name} steht
                </span>
              }
              count={bonds.length || undefined}
              flush
              actions={
                <Button size="sm" icon={<Plus />} onClick={() => setBondFor(null)}>
                  Beziehung
                </Button>
              }
            >
              {bonds.length ? (
                bonds.map((bond) => (
                  <BondRow
                    key={bond.other.id}
                    bond={bond}
                    character={character}
                    onEdit={() => setBondFor(bond.other.id)}
                  />
                ))
              ) : (
                <p className="wf-gruppe-hint wf-gruppe-hint--pad">
                  Wer {character.name} kennt, sucht oder etwas schuldet, steht hier: Personen und
                  Fraktionen, jede mit eigener Haltung.{' '}
                  <button
                    type="button"
                    className="wf-gruppe-textlink"
                    onClick={() => setBondFor(null)}
                  >
                    Beziehung anlegen
                  </button>
                </p>
              )}
            </Panel>

            <HeroArcPanel character={character} />
            <FacilitiesPanel character={character} />

            <Panel
              title="Erhalten"
              count={received.items.length || undefined}
              flush
              actions={
                received.gold > 0 ? (
                  <span className="wf-gruppe-gold">{formatGold(received.gold)}</span>
                ) : undefined
              }
            >
              {received.items.slice(0, RECEIVED_SHOWN).map((loot) => (
                <div key={loot.id} className="wf-gruppe-tie wf-gruppe-tie--plain">
                  <span className="wf-gruppe-tie__title">{lootLine(data, loot)}</span>
                  <span className="wf-gruppe-tie__why">
                    {[
                      loot.sessionId && data.sessions[loot.sessionId]
                        ? `Session ${data.sessions[loot.sessionId]!.number}`
                        : '',
                      loot.source,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
              ))}
              <p className="wf-gruppe-hint wf-gruppe-hint--pad">
                {received.items.length === 0
                  ? `Noch nichts. Was ${character.name} am Tisch bekommt, steht hier und im `
                  : received.items.length > RECEIVED_SHOWN
                    ? `Und ${received.items.length - RECEIVED_SHOWN} mehr im `
                    : 'Alles im '}
                <Link href="/beute" className="wf-gruppe-textlink">
                  Beute-Buch
                </Link>
                .
              </p>
            </Panel>

            <Panel
              title="Offene Abmachungen"
              count={promises.length || undefined}
              flush
              actions={
                <Button size="sm" icon={<Handshake />} onClick={() => log('promise')}>
                  Abmachung
                </Button>
              }
            >
              <ChronicleList
                entries={promises}
                showDate
                hideRefs={[character.id]}
                empty={
                  <p className="wf-gruppe-hint wf-gruppe-hint--pad">
                    Nichts offen. Versprechen, Schulden und Aufträge, die {character.name}{' '}
                    betreffen, bleiben hier stehen, bis du sie abhakst.
                  </p>
                }
              />
            </Panel>

            <Panel
              title="Chronik"
              count={chronicle.length || undefined}
              flush
              actions={
                <Button size="sm" icon={<Feather />} onClick={() => log()}>
                  Festhalten
                </Button>
              }
            >
              <ChronicleList
                entries={chronicle}
                newestFirst
                showDate
                hideRefs={[character.id]}
                empty={
                  <p className="wf-gruppe-hint wf-gruppe-hint--pad">
                    Noch nichts festgehalten. Was am Tisch geschieht, erscheint hier, sobald du es
                    mit {character.name} verknüpfst.
                  </p>
                }
              />
            </Panel>
          </div>
        </div>
      </div>
      {bondFor !== undefined && (
        <BondDialog
          key={bondFor ?? 'new'}
          character={character}
          fromId={bondFor}
          onClose={() => setBondFor(undefined)}
        />
      )}
    </div>
  );
}
