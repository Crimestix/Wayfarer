/** Reiter „Beziehungen“: je Gegenüber eine Zeile, dazu der Dialog zum Anlegen und Bearbeiten. */
import { useState, type KeyboardEvent } from 'react';
import { Link } from 'wouter';
import { EyeOff, Pencil, Plus, Users, Waypoints } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL, entityName, findRelation } from '../../domain/derive';
import { attitudeModeChoice, type AttitudeMode } from '../../domain/attitudeSetting';
import { attitudeLabel, holdsAttitude, relationType, typeOrder } from '../../domain/relations';
import { PARTY_ID, type Relation } from '../../domain/schema';
import {
  AttitudeBadge,
  AttitudeModePick,
  AttitudeScale,
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Portrait,
  Select,
  Tabs,
  TextArea,
  cx,
  entityHref,
  toast,
} from '../../ui';
import { relate, removeRelation } from './actions';
import type { RelationIntent } from './PageParts';
import { Picker } from './parts';
import {
  canRelateFrom,
  entitySubline,
  relationDrafts,
  relationKind,
  relationPresets,
  relationRows,
  relationSentence,
  savesDirection,
  startDirection,
  type RelationDraft,
  type RelationRow,
  type WorldEntity,
} from './model';

import { KinSection } from './KinSection';
import { RelationQuick } from './RelationQuick';

export function RelationsTab({
  entity,
  startNew,
}: {
  entity: WorldEntity;
  /** Öffnet gleich den Dialog zum Anlegen – bei „member“ für ein neues Mitglied. */
  startNew?: RelationIntent;
}) {
  const data = useData();
  const rows = relationRows(data, entity.id);
  // Haltungsspalten nur, wenn irgendwo eine Haltung eingetragen ist.
  const withAttitude = rows.some(
    (r) => (r.outgoing?.attitude ?? null) !== null || (r.incoming?.attitude ?? null) !== null,
  );
  /** null = geschlossen; sonst die ID des Gegenübers, dessen Beziehung bearbeitet wird. */
  const [editing, setEditing] = useState<string | null>(null);
  /** Neu eintragen geht über den schlanken Dialog (`RelationQuick`). */
  const [adding, setAdding] = useState<RelationIntent | null>(startNew ?? null);
  const edit = (otherId: string) => {
    if (otherId) setEditing(otherId);
    else setAdding('relation');
  };

  return (
    <div className="wf-welt-rel">
      {entity.kind === 'person' && <KinSection entity={entity} />}
      <div className="wf-welt-rel__bar">
        <p className="wf-welt-lead">
          Wer mit {entity.name} verbunden ist – und wie beide Seiten zueinander stehen.
        </p>
        <Button icon={<Plus />} onClick={() => edit('')}>
          Beziehung anlegen
        </Button>
      </div>
      {rows.length ? (
        <div
          className={cx('wf-welt-rel__table', !withAttitude && 'wf-welt-rel__table--plain')}
          role="table"
        >
          <div className="wf-welt-rel__row wf-welt-rel__row--head" role="row">
            <span role="columnheader">Gegenüber</span>
            {withAttitude && (
              <>
                <span
                  role="columnheader"
                  className="wf-clamp-2"
                  title={`Haltung von ${entity.name} gegenüber dem anderen`}
                >
                  Haltung von {entity.name}
                </span>
                <span
                  role="columnheader"
                  className="wf-clamp-2"
                  title={`Haltung des anderen gegenüber ${entity.name}`}
                >
                  Haltung zu {entity.name}
                </span>
              </>
            )}
            <span />
          </div>
          {rows.map((row) => (
            <RelationLine
              key={row.otherId}
              row={row}
              withAttitude={withAttitude}
              onEdit={() => edit(row.otherId)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Waypoints />}
          title="Noch keine Beziehungen"
          action={
            <Button icon={<Plus />} onClick={() => edit('')}>
              Beziehung anlegen
            </Button>
          }
        >
          Hier steht, wer mit {entity.name} verbunden ist: Verbündete, Feinde, Dienstherren,
          Mitglieder – und wie der Eintrag zur Gruppe steht.
        </EmptyState>
      )}
      {editing !== null && (
        <RelationDialog
          key={editing}
          self={entity}
          otherId={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {adding !== null && (
        <RelationQuick
          self={entity}
          asMember={adding === 'member'}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}

function RelationLine({
  row,
  withAttitude,
  onEdit,
}: {
  row: RelationRow;
  withAttitude: boolean;
  onEdit: () => void;
}) {
  const data = useData();
  const isParty = row.otherId === PARTY_ID;
  return (
    <div className={cx('wf-welt-rel__row', row.ended && 'wf-welt-rel__row--ended')} role="row">
      <div className="wf-welt-rel__who" role="cell">
        {row.entity ? (
          <Portrait entity={row.entity} size={38} />
        ) : (
          <span className="wf-portrait" style={{ width: 38, height: 38 }}>
            <Users />
          </span>
        )}
        <div className="wf-grow">
          <div
            className={cx('wf-welt-rel__label', row.freeText && 'wf-welt-rel__label--free')}
            title={row.freeText ? row.label : undefined}
          >
            <span className="wf-welt-rel__main">{row.label}</span>
          </div>
          <div className="wf-welt-rel__name">
            {row.entity ? (
              <Link href={entityHref(row.entity)} className="wf-entity-link">
                {row.name}
              </Link>
            ) : isParty ? (
              <Link href="/gruppe" className="wf-entity-link">
                Die Gruppe
              </Link>
            ) : (
              <span className="wf-mute wf-italic">Gelöschter Eintrag</span>
            )}
            {row.entity && (
              <span className="wf-welt-rel__kind">
                {[KIND_LABEL[row.entity.kind], entitySubline(data, row.entity)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </div>
          {row.notes.map((note) => (
            <div key={note} className="wf-welt-rel__note">
              {note}
            </div>
          ))}
          {(row.secret || row.ended) && (
            <div className="wf-row" style={{ marginTop: 4 }}>
              {row.secret && (
                <Badge tone="arcane" icon={<EyeOff />} title="Die Gruppe weiß nichts davon.">
                  Geheim
                </Badge>
              )}
              {row.ended && <Badge title="Die Beziehung besteht nicht mehr.">Beendet</Badge>}
            </div>
          )}
        </div>
      </div>
      {withAttitude && (
        <>
          <div role="cell">
            {row.outgoing && row.outgoing.attitude !== null ? (
              <AttitudeBadge value={row.outgoing.attitude} />
            ) : (
              <span className="wf-welt-rel__none">–</span>
            )}
          </div>
          <div role="cell">
            {row.incoming && row.incoming.attitude !== null ? (
              <AttitudeBadge value={row.incoming.attitude} />
            ) : (
              <span className="wf-welt-rel__none">–</span>
            )}
          </div>
        </>
      )}
      <div role="cell">
        <IconButton
          label={`Beziehung zu ${row.name} bearbeiten`}
          size="sm"
          variant="ghost"
          onClick={onEdit}
        >
          <Pencil />
        </IconButton>
      </div>
    </div>
  );
}

type Direction = 'out' | 'in';

function RelationDialog({
  self,
  otherId: initialOther,
  asMember = false,
  onClose,
}: {
  self: WorldEntity;
  otherId: string | null;
  /** Ein neues Mitglied eintragen: Personen und Gefährten, Beziehung vom Mitglied aus. */
  asMember?: boolean;
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const isNew = initialOther === null;
  const [otherId, setOtherId] = useState<string | null>(initialOther);
  const stored = (other: string | null, dir: Direction): Relation | undefined =>
    !other
      ? undefined
      : dir === 'out'
        ? findRelation(data, self.id, other)
        : findRelation(data, other, self.id);
  const [drafts, setDrafts] = useState<Record<Direction, RelationDraft>>(() =>
    relationDrafts(
      stored(initialOther, 'out'),
      stored(initialOther, 'in'),
      false,
      relationPresets(data, self.id, initialOther),
    ),
  );
  /** Haltung bei einem, der keine haben kann: aufgeklappt über „Haltung trotzdem eintragen“. */
  const [attitudeOpen, setAttitudeOpen] = useState(false);
  const [dir, setDir] = useState<Direction>(() =>
    startDirection(stored(initialOther, 'out'), stored(initialOther, 'in')),
  );
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);

  const twoWay = otherId !== null && canRelateFrom(otherId);
  const fromId = dir === 'out' ? self.id : (otherId ?? '');
  const toId = dir === 'out' ? (otherId ?? '') : self.id;
  const draft = drafts[dir];
  const existing = stored(otherId, dir);
  const set = (change: Partial<RelationDraft>) =>
    setDrafts((d) => ({ ...d, [dir]: { ...d[dir], ...change } }));
  const otherName = otherId ? entityName(data, otherId) : 'das Gegenüber';
  const towardsParty = toId === PARTY_ID;
  const attitudeChanged = draft.attitude !== (existing?.attitude ?? null);
  // „War schon so“: die Haltung zur Gruppe ohne Eintrag in der Chronik (`attitudeModeChoice`).
  const [pickedMode, setMode] = useState<AttitudeMode | null>(null);
  const modeChoice = towardsParty && fromId ? attitudeModeChoice(data, fromId, toId) : null;
  const mode: AttitudeMode = modeChoice?.givenPossible
    ? (pickedMode ?? modeChoice.preset)
    : 'change';
  const labelMissing = (d: RelationDraft) => d.type === 'custom' && !d.label.trim();
  const problem = !otherId
    ? 'Wähle zuerst, mit wem die Beziehung besteht.'
    : labelMissing(drafts.out) || (twoWay && labelMissing(drafts.in))
      ? 'Die eigene Bezeichnung fehlt noch.'
      : null;

  const pickOther = (id: string | null) => {
    const outgoing = stored(id, 'out');
    const incoming = stored(id, 'in');
    setOtherId(id);
    setDir(
      id && canRelateFrom(id) ? startDirection(outgoing, incoming, asMember ? 'in' : 'out') : 'out',
    );
    setDrafts(relationDrafts(outgoing, incoming, asMember, relationPresets(data, self.id, id)));
    setAttitudeOpen(false);
  };
  const presets = relationPresets(data, self.id, otherId);
  const order = typeOrder(relationKind(data, fromId), relationKind(data, toId));
  const fromHolds = holdsAttitude(relationKind(data, fromId));
  const showScale =
    fromHolds || attitudeOpen || draft.attitude !== null || (existing?.attitude ?? null) !== null;

  const save = () => {
    setTried(true);
    if (problem || !otherId) return;
    const pairExists = !!stored(otherId, 'out') || !!stored(otherId, 'in');
    db.batch(() => {
      for (const d of ['out', 'in'] as const) {
        const from = d === 'out' ? self.id : otherId;
        const to = d === 'out' ? otherId : self.id;
        if (!canRelateFrom(from)) continue;
        const current = stored(otherId, d);
        const next = drafts[d];
        // Eine Richtung, die es nicht gibt und die niemand angefasst hat, bleibt leer.
        if (!savesDirection(next, current, { active: d === dir, pairExists, preset: presets[d] }))
          continue;
        // Je Richtung eine Beziehung; die Haltung zur Gruppe steht dabei im Verlauf (`relate`).
        relate(db, {
          from,
          to,
          type: next.type,
          label: next.label,
          note: next.note,
          secret: next.secret,
          ended: next.ended,
          attitude: next.attitude,
          reason: mode === 'given' ? '' : reason,
          mode,
        });
      }
    });
    onClose();
  };

  const remove = () => {
    if (!existing) return;
    const undo = removeRelation(db, existing);
    toast({
      title: 'Beziehung gelöscht',
      body: relationSentence(data, existing.from, existing.to, existing),
      action: { label: 'Rückgängig', run: undo },
    });
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    const plainInput = target.tagName === 'INPUT' && target.closest('.wf-picker') === null;
    if (e.ctrlKey || e.metaKey || plainInput) {
      e.preventDefault();
      save();
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={asMember ? 'Mitglied eintragen' : isNew ? 'Beziehung anlegen' : 'Beziehung bearbeiten'}
      width={640}
      footer={
        <>
          {existing && (
            <Button
              variant="danger"
              onClick={remove}
              title="Löscht nur diese Richtung der Beziehung"
            >
              Löschen
            </Button>
          )}
          <span className="wf-grow wf-welt-form__status" role="status">
            {tried && problem ? <span className="wf-welt-form__problem">{problem}</span> : null}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={!otherId}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="wf-col wf-welt-form" onKeyDown={onKeyDown}>
        <Field label="Beziehung zwischen">
          <div className="wf-welt-relpair">
            <span className="wf-welt-relpair__self wf-clamp-1">{self.name}</span>
            <span className="wf-mute">und</span>
            {isNew ? (
              <div className="wf-grow">
                <Picker
                  value={otherId}
                  onChange={pickOther}
                  allowParty={asMember ? false : holdsAttitude(self.kind) ? true : 'named'}
                  kinds={asMember ? ['person', 'character'] : undefined}
                  exclude={[self.id]}
                  autoFocus
                  openOnMount
                  placeholder={
                    asMember
                      ? 'Person oder Gefährte …'
                      : holdsAttitude(self.kind)
                        ? 'Person, Ort, Fraktion … oder die Gruppe'
                        : 'Ort, Person, Fraktion …'
                  }
                />
              </div>
            ) : (
              <span className="wf-welt-relpair__self wf-clamp-1">{otherName}</span>
            )}
          </div>
        </Field>

        {otherId && (
          <>
            {twoWay && (
              <Tabs
                tabs={[
                  { id: 'out', label: `Von ${self.name} aus` },
                  { id: 'in', label: `Von ${otherName} aus` },
                ]}
                value={dir}
                onChange={setDir}
              />
            )}
            {isNew && existing && (
              <p className="wf-welt-form__kindhint">
                Diese Beziehung gibt es schon – du bearbeitest die vorhandene.
              </p>
            )}
            {!isNew && !existing && (
              <p className="wf-welt-form__kindhint">
                In dieser Richtung ist noch nichts eingetragen. Was du hier festlegst, kommt beim
                Speichern dazu.
              </p>
            )}
            <div className="wf-form-grid">
              <Field label="Art der Beziehung">
                <Select value={draft.type} onChange={(e) => set({ type: e.target.value })}>
                  {order.fitting.length > 0 && (
                    <optgroup label="Passend">
                      {order.fitting.map((key) => (
                        <option key={key} value={key}>
                          {relationType(key).label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Weitere">
                    {order.more.map((key) => (
                      <option key={key} value={key}>
                        {relationType(key).label}
                      </option>
                    ))}
                    <option value="custom">Eigene Bezeichnung …</option>
                  </optgroup>
                </Select>
              </Field>
              {draft.type === 'custom' ? (
                <Field
                  label="Eigene Bezeichnung"
                  hint="Als Satzteil, z. B. „erpresst“ oder „ist verlobt mit“."
                >
                  <Input
                    value={draft.label}
                    onChange={(e) => set({ label: e.target.value })}
                    aria-invalid={tried && labelMissing(draft)}
                  />
                </Field>
              ) : (
                <div />
              )}
              <div className="wf-span-2 wf-welt-sentence">
                {relationSentence(data, fromId, toId, {
                  type: draft.type,
                  label: draft.label.trim() || '…',
                })}
                .
              </div>
              {!showScale && (
                <button
                  type="button"
                  className="wf-welt-linkish wf-span-2"
                  onClick={() => setAttitudeOpen(true)}
                >
                  Haltung trotzdem eintragen
                </button>
              )}
              {showScale && (
                <Field
                  label={`Haltung von ${entityName(data, fromId)} gegenüber ${towardsParty ? 'der Gruppe' : entityName(data, toId)}`}
                  className="wf-span-2"
                >
                  <div className="wf-row" style={{ gap: 'var(--s-4)' }}>
                    <AttitudeScale
                      value={draft.attitude}
                      onChange={(attitude) => set({ attitude })}
                    />
                    <span>
                      <AttitudeBadge value={draft.attitude} />
                      {existing && attitudeChanged && (
                        <span className="wf-mute">
                          {' '}
                          · bisher {attitudeLabel(existing.attitude)}
                        </span>
                      )}
                    </span>
                  </div>
                </Field>
              )}
              {towardsParty && attitudeChanged && modeChoice?.givenPossible && (
                <div className="wf-span-2">
                  <AttitudeModePick value={mode} onChange={setMode} givenPossible />
                </div>
              )}
              {towardsParty && attitudeChanged && mode === 'change' && (
                <Field
                  label="Grund der Änderung"
                  hint="Steht mit Datum im Verlauf der Haltung und in der Chronik."
                  className="wf-span-2"
                >
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
              )}
              <Field label="Notiz" className="wf-span-2">
                <TextArea
                  value={draft.note}
                  onChange={(e) => set({ note: e.target.value })}
                  rows={2}
                  style={{ minHeight: 62 }}
                />
              </Field>
              <Checkbox checked={draft.secret} onChange={(secret) => set({ secret })}>
                Geheim – die Gruppe weiß nichts davon
              </Checkbox>
              <Checkbox checked={draft.ended} onChange={(ended) => set({ ended })}>
                Beendet – besteht nicht mehr
              </Checkbox>
            </div>
          </>
        )}
        {!otherId && (
          <p className="wf-welt-form__kindhint">
            Wähle das Gegenüber. Danach legst du fest, wie die beiden zueinander stehen – wenn nötig
            für jede Richtung einzeln.
          </p>
        )}
      </div>
    </Dialog>
  );
}
