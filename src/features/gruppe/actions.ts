/** Befehle des Bereichs „Gefährten“. Alles, was mehrere Dokumente ändert, läuft hierüber. */
import { logEntry, mergeGroups, sendOff, setAttitude } from '../../data/actions';
import { switchPlan } from '../../domain/body';
import { groupOf, isSplit, ledMembers, settleGroups, syncedGroups } from '../../domain/party';
import type { CampaignDb } from '../../data/db';
import type { AttitudeMode } from '../../domain/attitudeSetting';
import { entityName, findRelation } from '../../domain/derive';
import { createEntity, createRelation, type Character, type Relation } from '../../domain/schema';
import {
  addCustomCondition,
  adjustHp,
  clickExhaustionMark,
  toggleCondition,
  type DraftResult,
} from './model';

type Details = Character['character'];

function getCharacter(db: CampaignDb, id: string): Character | null {
  const entity = db.getSnapshot().entities[id];
  return entity?.kind === 'character' ? entity : null;
}

/** Ändert einzelne Spielwerte eines Gefährten. */
export function patchCharacter(db: CampaignDb, id: string, change: Partial<Details>): void {
  const current = getCharacter(db, id);
  if (!current) return;
  db.put('entities', { ...current, character: { ...current.character, ...change } });
}

// ── Zwei Gefährten, ein Körper (`domain/body.ts`) ─────────────────────────

/**
 * Wechselt, wer den Körper kontrolliert: Schaden, Zustände, Erschöpfung, Platz in Teilgruppe und
 * Marschordnung und Wirkungen am Körper gehen mit. Keine Nachfrage, nichts in der Chronik. Gibt
 * „Rückgängig“ zurück (ein zweiter Wechsel); null, wenn es keinen Partner gibt.
 */
export function switchBody(db: CampaignDb, characterId: string): (() => void) | null {
  const plan = switchPlan(db.getSnapshot(), characterId);
  if (!plan) return null;
  db.batch(() => {
    patchCharacter(db, plan.fromId, plan.from);
    patchCharacter(db, plan.toId, plan.to);
    db.setState(plan.state);
    for (const timer of plan.timers)
      db.patch('timers', timer.id, { refs: timer.refs, participants: timer.participants });
  });
  return () => {
    switchBody(db, plan.toId);
  };
}

/**
 * Verbindet zwei Gefährten zu einem Körper; `controlId` hat die Kontrolle (Vorgabe: der erste).
 * Bestehende Verbindungen beider werden gelöst. Gibt „Rückgängig“ zurück.
 */
export function linkBody(db: CampaignDb, a: string, b: string, controlId = a): (() => void) | null {
  const first = getCharacter(db, a);
  const second = getCharacter(db, b);
  if (!first || !second || a === b) return null;
  const before = [first, second];
  const state = db.getSnapshot().state;
  const party = {
    groups: state.groups,
    leadId: state.leadId,
    now: state.now,
    placeId: state.placeId,
  };
  db.batch(() => {
    for (const id of [a, b]) unlinkBody(db, id);
    patchCharacter(db, a, { bodyWith: b, resting: controlId !== a });
    patchCharacter(db, b, { bodyWith: a, resting: controlId !== b });
    // Getrennte Wege: Der Körper steht dort, wo der steht, der die Kontrolle hat.
    const restingId = controlId === a ? b : a;
    const data = db.getSnapshot();
    if (isSplit(data))
      db.setState(
        settleGroups(
          syncedGroups(data.state).map((group) => ({
            ...group,
            memberIds: group.memberIds.filter((id) => id !== restingId),
          })),
          data.state.leadId,
          data.state,
        ),
      );
  });
  return () =>
    db.batch(() => {
      for (const entity of before) db.put('entities', entity);
      if (party.groups.length) db.setState(party);
    });
}

/**
 * Löst die Verbindung: Beide sind danach eigene Gefährten, keiner ruht mehr. Getrennte Wege: Wer
 * geruht hat, steht danach in der Teilgruppe dessen, der die Kontrolle hatte.
 */
export function unlinkBody(db: CampaignDb, characterId: string): void {
  const self = getCharacter(db, characterId);
  const otherId = self?.character.bodyWith;
  if (!self || !otherId) return;
  const data = db.getSnapshot();
  const [controlId, restingId] = self.character.resting
    ? [otherId, characterId]
    : [characterId, otherId];
  const home = isSplit(data) ? groupOf(data, controlId) : null;
  db.batch(() => {
    patchCharacter(db, characterId, { bodyWith: null, resting: false });
    const other = getCharacter(db, otherId);
    if (other?.character.bodyWith === characterId)
      patchCharacter(db, otherId, { bodyWith: null, resting: false });
    if (home)
      db.setState({
        groups: db.getSnapshot().state.groups.map((group) => ({
          ...group,
          memberIds:
            group.id === home.id
              ? [...new Set([...group.memberIds, restingId])]
              : group.memberIds.filter((id) => id !== restingId),
        })),
      });
  });
}

/** Klick auf eine Erschöpfungsmarke. */
export function clickExhaustion(db: CampaignDb, id: string, mark: number): void {
  const current = getCharacter(db, id);
  if (!current) return;
  patchCharacter(db, id, { exhaustion: clickExhaustionMark(current.character.exhaustion, mark) });
}

export function toggleCharacterCondition(db: CampaignDb, id: string, name: string): void {
  const current = getCharacter(db, id);
  if (!current) return;
  patchCharacter(db, id, { conditions: toggleCondition(current.character.conditions, name) });
}

/** Schaden (negativ) oder Heilung (positiv). Beginnt bei den maximalen Trefferpunkten, wenn noch nichts mitgeführt wird. */
export function changeHp(db: CampaignDb, id: string, delta: number): void {
  const current = getCharacter(db, id);
  if (!current) return;
  const { hp, hpMax } = current.character;
  patchCharacter(db, id, { hp: adjustHp(hp, hpMax, delta) });
}

/** Legt einen eigenen Zustand für die Kampagne an (falls neu) und setzt ihn beim Gefährten. */
export function addOwnCondition(db: CampaignDb, id: string | null, name: string, rule = ''): void {
  const campaign = db.getSnapshot().campaign;
  const next = addCustomCondition(campaign.customConditions, name, rule);
  db.batch(() => {
    if (next.length !== campaign.customConditions.length)
      db.setCampaign({ customConditions: next });
    const current = id ? getCharacter(db, id) : null;
    const clean = name.trim().replace(/\s+/g, ' ');
    if (current && clean && !current.character.conditions.some((c) => c === clean))
      patchCharacter(db, current.id, {
        conditions: toggleCondition(
          current.character.conditions.filter((c) => c !== clean),
          clean,
        ),
      });
  });
}

/** Entfernt einen eigenen Zustand aus der Liste der Kampagne. Wer ihn gerade hat, behält ihn. */
export function removeOwnCondition(db: CampaignDb, name: string): void {
  const campaign = db.getSnapshot().campaign;
  db.setCampaign({ customConditions: campaign.customConditions.filter((c) => c.name !== name) });
}

/** Satz für die Chronik, wenn ein Gefährte die Gruppe verlässt oder zu ihr zurückkehrt. */
function placeChangeText(db: CampaignDb, name: string, placeId: string | null): string {
  return placeId
    ? `${name} ist abseits der Gruppe unterwegs: ${entityName(db.getSnapshot(), placeId)}.`
    : `${name} ist wieder bei der Gruppe.`;
}

export interface PlaceChangeResult {
  /** Stellt den vorigen Aufenthaltsort wieder her und nimmt die Chroniknotiz zurück. */
  undo: () => void;
  text: string;
}

/**
 * Ein Gefährte trennt sich von der Gruppe (placeId) oder stößt wieder zu ihr (null). Getrennte
 * Wege: Er wird eine Teilgruppe aus einer Person mit eigener Uhr (`sendOff`, ein Ortswechsel mit
 * ihm allein); zurück führt seine Teilgruppe mit der geleiteten zusammen (`mergeGroups`). Ein
 * Aufenthalt aus früheren Ständen (`character.placeId`) wird wie bisher zurückgesetzt.
 */
export function moveCharacter(
  db: CampaignDb,
  id: string,
  placeId: string | null,
): PlaceChangeResult | null {
  const current = getCharacter(db, id);
  if (!current) return null;
  const data = db.getSnapshot();
  const before = current.character.placeId;
  if (before !== null) {
    // Aus einem früheren Stand: zuerst der alte Aufenthalt, wie bisher mit Notiz.
    const text = placeChangeText(db, current.name, placeId);
    const entry = db.batch(() => {
      patchCharacter(db, id, { placeId });
      return logEntry(db, {
        text,
        refs: [id, placeId ?? before].filter((ref): ref is string => !!ref),
        placeId: placeId ?? data.state.placeId,
      });
    });
    return {
      text,
      undo: () =>
        db.batch(() => {
          patchCharacter(db, id, { placeId: before });
          db.remove('chronicle', entry.id);
        }),
    };
  }
  const group = groupOf(data, id);
  if (placeId === null) {
    if (!group || group.led || !data.state.leadId) return null;
    const result = mergeGroups(db, [group.id, data.state.leadId]);
    return result
      ? { text: `${current.name} ist wieder bei der Gruppe.`, undo: result.undo }
      : null;
  }
  if (group && !group.led) return null;
  if (ledMembers(data).length < 2) return null;
  const result = sendOff(db, [id], placeId, 0);
  return {
    text: `${current.name} ist für sich unterwegs: ${entityName(data, placeId)} – eine eigene Teilgruppe.`,
    undo: result.undo,
  };
}

/** Legt einen Gefährten an (id = null) oder speichert die Eingaben des Dialogs. Gibt die ID zurück. */
export function saveCharacter(
  db: CampaignDb,
  id: string | null,
  value: NonNullable<DraftResult['value']>,
): string {
  const current = id ? getCharacter(db, id) : null;
  if (current) {
    const before = current.character.placeId;
    const after = value.character.placeId;
    db.batch(() => {
      db.put('entities', {
        ...current,
        name: value.name,
        tagline: value.tagline,
        image: value.image,
        character: {
          ...value.character,
          bodyWith: current.character.bodyWith,
          resting: current.character.resting,
        },
      });
      // Trennen und Zurückkehren steht immer in der Chronik – auch wenn es im Dialog geschieht.
      if (before !== after)
        logEntry(db, {
          text: placeChangeText(db, value.name, after),
          refs: [current.id, after ?? before].filter((ref): ref is string => !!ref),
          placeId: after ?? db.getSnapshot().state.placeId,
        });
    });
    return current.id;
  }
  return db.put(
    'entities',
    createEntity({
      kind: 'character',
      name: value.name,
      tagline: value.tagline,
      image: value.image,
      character: value.character,
    }),
  ).id;
}

export interface BondInput {
  /** Von wem die Beziehung ausgeht (Person, Fraktion …). */
  fromId: string;
  /** Der Gefährte, auf den sie sich richtet. */
  characterId: string;
  type: string;
  label: string;
  attitude: number | null;
  note: string;
  secret: boolean;
  ended: boolean;
  /** „War schon so“: die Haltung ohne Eintrag in der Chronik (`setAttitude`). */
  mode?: AttitudeMode;
}

/**
 * Legt die Beziehung eines Eintrags zu einem Gefährten an oder ändert sie. Eine neue oder
 * geänderte Haltung steht – wie überall – in der Chronik.
 */
export function saveBond(db: CampaignDb, input: BondInput): Relation {
  const existing = findRelation(db.getSnapshot(), input.fromId, input.characterId);
  const fields = {
    type: input.type,
    label: input.type === 'custom' ? input.label.trim() : '',
    note: input.note.trim(),
    secret: input.secret,
    ended: input.ended,
  };
  return db.batch(() => {
    if ((existing?.attitude ?? null) !== input.attitude) {
      const relation = setAttitude(
        db,
        input.fromId,
        input.characterId,
        input.attitude,
        '',
        input.mode,
      );
      return db.patch('relations', relation.id, fields);
    }
    if (existing) return db.patch('relations', existing.id, fields);
    return db.put(
      'relations',
      createRelation({
        from: input.fromId,
        to: input.characterId,
        attitude: input.attitude,
        ...fields,
      }),
    );
  });
}

export function removeBond(db: CampaignDb, relationId: string): void {
  db.remove('relations', relationId);
}
