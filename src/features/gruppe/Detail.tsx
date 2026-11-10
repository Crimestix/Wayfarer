/** Ein Gefährte im Ganzen: Werte, Notizen, Geheimnis, Beziehungen, Abmachungen, Chronik. */
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, EyeOff, Feather, Handshake, Pencil, Plus, Swords, UserPlus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { chronicleFor, entitiesOfKind, openPromises } from '../../domain/derive';
import { relationLabel } from '../../domain/relations';
import type { Character } from '../../domain/schema';
import { openAttitude, openQuickLog } from '../../shell/commands';
import {
  AttitudeBadge,
  Badge,
  Button,
  ChronicleList,
  EmptyState,
  EntityLink,
  IconButton,
  Panel,
  Portrait,
  TextArea,
  cx,
} from '../../ui';
import { toggleCharacterCondition } from './actions';
import { BondDialog } from './BondDialog';
import { characterBonds, classLine, partySummary, soleLanguages, sortConditions, type CharacterBond } from './model';
import { ConditionToggles, ExhaustionControl, LocationControl, SheetLink, StatBand } from './parts';

// ── Wechsel zwischen den Gefährten ─────────────────────────────────────────

function Roster({ all, currentId }: { all: Character[]; currentId: string }) {
  const sorted = [...all].sort((a, b) => Number(b.character.active) - Number(a.character.active));
  return (
    <nav className="wf-gruppe-roster" aria-label="Gefährten">
      <Link href="/gruppe" className="wf-gruppe-roster__back">
        <ArrowLeft />
        Alle Gefährten
      </Link>
      <div className="wf-gruppe-roster__list">
        {sorted.map((c) => (
          <Link
            key={c.id}
            href={`/gruppe/${c.id}`}
            className={cx('wf-gruppe-roster__item', !c.character.active && 'wf-gruppe-roster__item--resting')}
            aria-current={c.id === currentId ? 'page' : undefined}
            title={c.character.active ? c.name : `${c.name} – nicht dabei`}
          >
            <Portrait entity={c} size={30} round />
            <span className="wf-clamp-1">{c.name}</span>
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
          <IconButton label={`${title} bearbeiten`} variant="ghost" size="sm" onClick={() => setEditing(true)}>
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

export function Detail({ id, onEdit, onCreate }: { id: string; onEdit: (id: string) => void; onCreate: () => void }) {
  const db = useDb();
  const data = useData();
  const all = entitiesOfKind(data, 'character');
  const entity = data.entities[id];
  const character = entity?.kind === 'character' ? entity : null;
  /** undefined = zu, null = neue Beziehung, sonst das Gegenüber. */
  const [bondFor, setBondFor] = useState<string | null | undefined>(undefined);
  useEffect(() => setBondFor(undefined), [id]);

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
  const sole = soleLanguages(partySummary(all.filter((c) => c.character.active)), character.name);
  const active = sortConditions(d.conditions);
  const log = (kind?: 'promise') => openQuickLog({ kind, refs: [character.id] });

  return (
    <div className="wf-gruppe-detail">
      <Roster all={all} currentId={character.id} />
      <div className="wf-gruppe-dossier">
        <header className="wf-gruppe-hero">
          <Portrait entity={character} size={124} />
          <div className="wf-grow">
            <div className="wf-caps">{d.active ? 'Gefährte' : 'Gefährte · im Augenblick nicht dabei'}</div>
            <h1 className="wf-gruppe-hero__name">{character.name}</h1>
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
              <Button icon={<Pencil />} onClick={() => onEdit(character.id)}>
                Bearbeiten
              </Button>
            </div>
            <SheetLink character={character} onMissing={() => onEdit(character.id)} />
          </div>
        </header>

        <div className="wf-gruppe-cols">
          <div className="wf-gruppe-col">
            <Panel title="Am Tisch" flush>
              <StatBand character={character} />
              <dl className="wf-gruppe-rows wf-gruppe-rows--roomy">
                <dt>Erschöpfung</dt>
                <dd>
                  <ExhaustionControl character={character} size="lg" />
                </dd>
                <dt>Zustände</dt>
                <dd>
                  <ConditionToggles
                    value={active}
                    onToggle={(name) => toggleCharacterCondition(db, character.id, name)}
                  />
                </dd>
                <dt>Sprachen</dt>
                <dd>
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
                    <button type="button" className="wf-gruppe-textlink" onClick={() => onEdit(character.id)}>
                      Sprachen eintragen
                    </button>
                  )}
                  {sole.length > 0 && (
                    <div className="wf-field__hint">Hervorgehoben: spricht in der Gruppe sonst niemand.</div>
                  )}
                </dd>
                <dt>Aufenthalt</dt>
                <dd>
                  <LocationControl character={character} />
                </dd>
              </dl>
            </Panel>
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
              title={`Wer wie zu ${character.name} steht`}
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
                  Wer kennt {character.name}, sucht nach ihm oder schuldet ihm etwas? Solche Beziehungen
                  von Personen und Fraktionen stehen hier – jede mit eigener Haltung.{' '}
                  <button type="button" className="wf-gruppe-textlink" onClick={() => setBondFor(null)}>
                    Beziehung anlegen
                  </button>
                </p>
              )}
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
                    Nichts offen. Versprechen, Schulden und Aufträge, die {character.name} betreffen,
                    bleiben hier stehen, bis du sie abhakst.
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
                    Noch nichts festgehalten. Was am Tisch mit {character.name} geschieht, erscheint
                    hier, sobald du es mit ihm verknüpfst.
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
