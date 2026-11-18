/**
 * Rechts neben der Karte, wenn gespielt wird: der Halt (worüber gerade zu entscheiden ist), die
 * Gruppe, was am gewählten Ding zu tun ist, und was bisher geschah.
 */
import { Eye, Flame, Hammer, Search, Swords, Trash2, Undo2, UserPlus, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  ACT_LABEL,
  STAIR_LABEL,
  SWITCH_LABEL,
  WHEN_LABEL,
  SAVE_LABEL,
  THING_LABEL,
  edgeName,
  edgeRun,
  findStair,
  linkWords,
  trapLine,
} from '../../domain/dungeon';
import {
  COVER_LABEL,
  LIGHT_LABEL,
  SEARCH_SECONDS,
  coverBetween,
  markerFoundKey,
  markerLit,
  switchOn,
  clockWords,
  edgeFoundKey,
  playLevel,
  stairFoundKey,
  trapFoundKey,
  trapState,
  turnOrder,
  unsyncedMinutes,
} from '../../domain/dungeonPlay';
import {
  DUNGEON_LIGHTS,
  type DungeonLevel,
  type DungeonLight,
  type DungeonToken,
} from '../../domain/schema';
import {
  Button,
  Checkbox,
  Field,
  IconButton,
  Input,
  Panel,
  Select,
  Written,
  confirmDialog,
} from '../../ui';
import type { DungeonEditor } from './editor';
import type { DungeonPlayer } from './usePlay';

function Fact({ children }: { children: ReactNode }) {
  return <p className="wf-dungeon-fact">{children}</p>;
}

/** Eine Zahl einer Figur, geschrieben beim Verlassen. */
function NumberLine({
  label,
  value,
  onSave,
  step,
}: {
  label: string;
  value: number | null;
  onSave: (value: number | null) => void;
  step?: number;
}) {
  return (
    <Field label={label} className="wf-dungeon-dc">
      <Input
        key={value ?? 'leer'}
        inputMode="numeric"
        defaultValue={value ?? ''}
        placeholder="–"
        aria-label={label}
        step={step}
        onBlur={(event) => {
          const text = event.target.value.trim();
          const parsed = text === '' ? null : Math.round(Number(text));
          if (parsed !== null && Number.isNaN(parsed)) return;
          if (parsed !== value) onSave(parsed);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </Field>
  );
}

// ── Der Halt ───────────────────────────────────────────────────────────────

function HaltCard({ player }: { player: DungeonPlayer }) {
  const halt = player.halt;
  if (!halt) return null;
  return (
    <section className="wf-dungeon-halt" data-type={halt.type} role="status">
      <h3 className="wf-dungeon-halt__title">{halt.title}</h3>
      {halt.text && <p className="wf-dungeon-halt__text">{halt.text}</p>}
      <div className="wf-dungeon-halt__actions">
        {halt.type === 'foe' && !player.play?.rounds && (
          <Button size="sm" icon={<Swords />} onClick={() => player.rounds(true)}>
            Runden beginnen
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => player.setHalt(null)}>
          Zur Kenntnis
        </Button>
      </div>
    </section>
  );
}

// ── Was gewählt ist ────────────────────────────────────────────────────────

function PickBox({
  player,
  level,
  editor,
}: {
  player: DungeonPlayer;
  level: DungeonLevel;
  editor: DungeonEditor;
}) {
  const { pick, play } = player;
  if (!pick || !play) return null;
  const now = playLevel(level, play);

  if (pick.type === 'edge') {
    const edge = now.edges[pick.key];
    if (!edge) return null;
    const width = edgeRun(now, pick.key).length;
    const secret = edge.kind === 'secret';
    const known = !secret || play.found.includes(edgeFoundKey(level.id, pick.key));
    const moves = edge.kind === 'door' || edge.kind === 'gate' || secret;
    return (
      <Panel title={edgeName(edge.kind, width)}>
        <div className="wf-dungeon-form">
          {secret && (
            <Fact>
              {known
                ? 'Die Gruppe kennt sie.'
                : 'Die Gruppe kennt sie nicht – für sie ist hier eine Wand.'}
              {edge.findDc !== null && ` Finden SG ${edge.findDc}.`}
            </Fact>
          )}
          {moves && (
            <Fact>
              {edge.opened ? 'Steht offen.' : edge.locked ? 'Verschlossen.' : 'Geschlossen.'}
              {!edge.opened && edge.stuck && ' Klemmt – geht nur mit Kraft auf.'}
              {edge.locked && edge.lockDc !== null && ` Schloss SG ${edge.lockDc}.`}
              {!edge.opened && edge.breakDc !== null && ` Aufbrechen SG ${edge.breakDc}.`}
            </Fact>
          )}
          {edge.kind === 'false' && <Fact>Eine Scheintür – dahinter ist Wand.</Fact>}
          {edge.kind === 'squeeze' && (
            <Fact>Eine Engstelle – hindurch nur einzeln und langsam.</Fact>
          )}
          {edge.oneWay !== 'none' && <Fact>Lässt sich nur von einer Seite öffnen.</Fact>}
          {edge.note.trim() && <p className="wf-dungeon-gmnote">{edge.note}</p>}
          <div className="wf-dungeon-actions">
            {secret && (
              <Button size="sm" onClick={() => player.foundEdge(pick.key, !known)}>
                {known ? 'Doch nicht gefunden' : 'Gefunden'}
              </Button>
            )}
            {moves && known && edge.locked && (
              <>
                <Button size="sm" onClick={() => player.door(pick.key, { locked: false })}>
                  Aufgeschlossen
                </Button>
                <Button
                  size="sm"
                  title="Sie steht offen – und wer in der Nähe ist, hört es."
                  onClick={() => player.forceDoor(pick.key)}
                >
                  Aufgebrochen
                </Button>
              </>
            )}
            {moves && known && !edge.locked && !edge.opened && edge.stuck && (
              <Button
                size="sm"
                variant="primary"
                title="Sie steht offen – und wer in der Nähe ist, hört es."
                onClick={() => player.forceDoor(pick.key)}
              >
                Aufgestemmt
              </Button>
            )}
            {moves && known && !edge.locked && !(edge.stuck && !edge.opened) && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => player.door(pick.key, { opened: !edge.opened })}
              >
                {edge.opened ? 'Schließen' : 'Öffnen'}
              </Button>
            )}
            {moves && known && !edge.locked && !edge.opened && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => player.door(pick.key, { locked: true })}
              >
                Verschließen
              </Button>
            )}
          </div>
        </div>
      </Panel>
    );
  }

  if (pick.type === 'trap') {
    const trap = now.traps.find((t) => t.id === pick.id);
    if (!trap) return null;
    const state = trapState(play, trap);
    const words = {
      hidden: 'Die Gruppe weiß nichts von ihr.',
      found: 'Die Gruppe hat sie bemerkt.',
      sprung: trap.once
        ? 'Hat ausgelöst – jetzt harmlos.'
        : 'Hat ausgelöst. Sie löst nicht von selbst wieder aus, bis du sie scharf stellst.',
      disarmed: 'Entschärft.',
    }[state];
    return (
      <Panel title={trap.name.trim() || 'Falle'}>
        <div className="wf-dungeon-form">
          <Fact>{words}</Fact>
          {trapLine(trap) && <Fact>{trapLine(trap)}</Fact>}
          {trap.save !== 'none' && (
            <Fact>
              Rettungswurf: {SAVE_LABEL[trap.save]}
              {trap.saveDc !== null ? ` SG ${trap.saveDc}` : ''}
              {trap.damage.trim() ? ` – sonst ${trap.damage.trim()}` : ''}
            </Fact>
          )}
          {trap.effect.trim() && <p className="wf-dungeon-gmnote">{trap.effect}</p>}
          {trap.note.trim() && <p className="wf-dungeon-gmnote">{trap.note}</p>}
          <div className="wf-dungeon-actions">
            {state === 'hidden' && (
              <Button size="sm" onClick={() => player.found([trapFoundKey(trap.id)], true)}>
                Gefunden
              </Button>
            )}
            {state === 'found' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => player.found([trapFoundKey(trap.id)], false)}
              >
                Doch nicht gefunden
              </Button>
            )}
            {state !== 'disarmed' && state !== 'sprung' ? (
              <Button size="sm" variant="primary" onClick={() => player.disarm(trap.id, true)}>
                Entschärft
              </Button>
            ) : (
              <Button size="sm" onClick={() => player.disarm(trap.id, false)}>
                Wieder scharf
              </Button>
            )}
          </div>
        </div>
      </Panel>
    );
  }

  if (pick.type === 'stair') {
    const stair = now.stairs.find((s) => s.id === pick.id);
    if (!stair) return null;
    const target = findStair(editor.dungeon, stair.to);
    const known = !stair.secret || play.found.includes(stairFoundKey(stair.id));
    return (
      <Panel title={STAIR_LABEL[stair.kind]}>
        <div className="wf-dungeon-form">
          <Fact>
            {stair.kind === 'portal'
              ? 'Führt'
              : stair.dir === 'up'
                ? 'Führt hinauf'
                : 'Führt hinab'}{' '}
            {target ? `nach ${target.level.name.trim() || 'Ebene'}.` : '– noch ohne Ziel.'}
            {stair.locked ? ' Verschlossen.' : ''}
            {!stair.usable ? ' Nur Ankunft.' : ''}
          </Fact>
          {stair.secret && (
            <Fact>
              {known
                ? 'Verborgen – die Gruppe kennt ihn.'
                : 'Verborgen – die Gruppe kennt ihn nicht.'}
              {stair.findDc !== null && ` Finden SG ${stair.findDc}.`}
            </Fact>
          )}
          {stair.note.trim() && <p className="wf-dungeon-gmnote">{stair.note}</p>}
          <div className="wf-dungeon-actions">
            {stair.secret && (
              <Button size="sm" onClick={() => player.found([stairFoundKey(stair.id)], !known)}>
                {known ? 'Doch nicht gefunden' : 'Gefunden'}
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              disabled={player.movers.length === 0}
              onClick={() => player.stairs(stair.id)}
            >
              Benutzen
            </Button>
          </div>
        </div>
      </Panel>
    );
  }

  if (pick.type === 'zone') {
    const zone = now.zones.find((z) => z.id === pick.id);
    if (!zone) return null;
    const done = play.fired.includes(zone.id);
    return (
      <Panel title={zone.name.trim() || 'Auslöser'}>
        <div className="wf-dungeon-form">
          <Fact>
            {WHEN_LABEL[zone.when]}
            {zone.act !== 'none' ? ` – ${ACT_LABEL[zone.act]}` : ''}.
            {done ? ' Ist schon geschehen.' : ''}
          </Fact>
          {zone.links.map((link) => (
            <Fact key={`${link.kind}:${link.levelId}:${link.ref}`}>
              Wirkt: {linkWords(editor.dungeon, link) ?? 'auf etwas, das es nicht mehr gibt'}.
            </Fact>
          ))}
          {zone.note.trim() && <p className="wf-dungeon-gmnote">{zone.note}</p>}
          <div className="wf-dungeon-actions">
            <Button size="sm" variant="primary" onClick={() => player.trigger(zone.id)}>
              {done ? 'Noch einmal auslösen' : 'Jetzt auslösen'}
            </Button>
          </div>
        </div>
      </Panel>
    );
  }

  if (pick.type === 'marker') {
    const marker = now.markers.find((m) => m.id === pick.id);
    if (!marker) return null;
    const on = switchOn(play, marker.id);
    const stays = marker.switch === 'lever' || marker.switch === 'plate';
    const isLight = marker.kind === 'fire' || marker.kind === 'torch';
    const lit = markerLit(play, marker);
    const known = !marker.hidden || play.found.includes(markerFoundKey(marker.id));
    const useWord = {
      lever: on ? 'Zurücklegen' : 'Umlegen',
      button: 'Drücken',
      plate: on ? 'Entlasten' : 'Belasten',
      timer: 'Auslösen',
      key: 'Schlüssel passt',
      riddle: 'Gelöst',
    }[marker.switch];
    return (
      <Panel title={marker.label.trim() || THING_LABEL[marker.kind]}>
        <div className="wf-dungeon-form">
          {marker.label.trim() && marker.kind !== 'note' && <Fact>{THING_LABEL[marker.kind]}</Fact>}
          {marker.note.trim() ? (
            <p className="wf-dungeon-gmnote">{marker.note}</p>
          ) : (
            marker.links.length === 0 && <Fact>Dazu steht nichts.</Fact>
          )}
          {marker.links.map((link) => (
            <Fact key={`${link.kind}:${link.levelId}:${link.ref}`}>
              Wirkt: {linkWords(editor.dungeon, link) ?? 'auf etwas, das es nicht mehr gibt'}.
            </Fact>
          ))}
          {marker.links.length > 0 && (
            <Fact>
              {SWITCH_LABEL[marker.switch]}
              {marker.switch === 'key' && marker.keyName.trim()
                ? ` – ${marker.keyName.trim()}`
                : ''}
              {marker.switch === 'timer'
                ? ` – springt nach ${clockWords(marker.seconds ?? 60)} zurück`
                : ''}
              {on
                ? stays || marker.switch === 'timer'
                  ? '. Ist gerade betätigt.'
                  : '. Hat schon gewirkt.'
                : '.'}
            </Fact>
          )}
          {marker.hidden && (
            <Fact>
              {known
                ? 'Verborgen – die Gruppe kennt es.'
                : 'Verborgen – die Gruppe kennt es nicht.'}
              {marker.findDc !== null && ` Finden SG ${marker.findDc}.`}
            </Fact>
          )}
          {isLight && <Fact>{lit ? 'Brennt.' : 'Ist aus.'}</Fact>}
          <div className="wf-dungeon-actions">
            {marker.hidden && (
              <Button size="sm" onClick={() => player.found([markerFoundKey(marker.id)], !known)}>
                {known ? 'Doch nicht gefunden' : 'Gefunden'}
              </Button>
            )}
            {marker.links.length > 0 && (
              <Button
                size="sm"
                variant="primary"
                disabled={on && !stays}
                onClick={() => player.useThing(marker.id)}
              >
                {useWord}
              </Button>
            )}
            {isLight && (
              <Button size="sm" onClick={() => player.mapLight(marker.id, !lit)}>
                {lit ? 'Löschen' : 'Entzünden'}
              </Button>
            )}
          </div>
        </div>
      </Panel>
    );
  }

  const room = now.rooms.find((r) => r.id === pick.id);
  if (!room) return null;
  return (
    <Panel title={room.name.trim() || 'Raum'}>
      {room.note.trim() ? (
        <p className="wf-dungeon-gmnote">{room.note}</p>
      ) : (
        <Fact>Zu diesem Raum steht nichts.</Fact>
      )}
    </Panel>
  );
}

// ── Die Gruppe ─────────────────────────────────────────────────────────────

function TokenBox({ player, token }: { player: DungeonPlayer; token: DungeonToken }) {
  const play = player.play!;
  const left =
    token.light !== 'none' && token.lightEnds !== null
      ? Math.max(0, token.lightEnds - play.seconds)
      : null;
  return (
    <Panel
      title={token.kind === 'foe' ? 'Gegner' : 'Figur'}
      actions={
        <IconButton
          label="Vom Brett nehmen"
          size="sm"
          variant="ghost"
          onClick={() => player.remove(token.id)}
        >
          <Trash2 />
        </IconButton>
      }
    >
      <div className="wf-dungeon-form">
        <Field label="Name">
          <Written
            label="Name der Figur"
            value={token.name}
            selectAll
            onSave={(name) => player.token(token.id, { name })}
          />
        </Field>
        <div className="wf-dungeon-dcs">
          <NumberLine
            label="Bewegung"
            value={token.speed}
            onSave={(speed) => player.token(token.id, { speed: Math.max(0, speed ?? 30) })}
          />
          <NumberLine
            label="Initiative"
            value={token.init}
            onSave={(init) => player.token(token.id, { init })}
          />
        </div>
        <div className="wf-dungeon-dcs">
          <NumberLine
            label="Trefferpunkte"
            value={token.hp}
            onSave={(hp) => player.token(token.id, { hp: hp === null ? null : Math.max(0, hp) })}
          />
          <NumberLine
            label="von"
            value={token.hpMax}
            onSave={(hpMax) => player.token(token.id, { hpMax: hpMax && hpMax > 0 ? hpMax : null })}
          />
        </div>
        <Fact>
          Bewegung{token.kind === 'hero' ? ' und Dunkelsicht' : ''} in Fuß.
          {token.hp === 0 ? ' Besiegt – bewegt sich nicht mehr von selbst.' : ''}
          {token.kind === 'foe' && token.alert && token.hp !== 0 ? ' Hat die Gruppe bemerkt.' : ''}
          {token.kind === 'foe' && !token.alert && token.heard
            ? ' Hat etwas gehört und sieht nach.'
            : ''}
        </Fact>
        {token.kind === 'hero' && (
          <div className="wf-dungeon-dcs">
            <Checkbox checked={token.sneak} onChange={(sneak) => player.token(token.id, { sneak })}>
              schleicht
            </Checkbox>
            {token.sneak && (
              <NumberLine
                label="Heimlichkeit"
                value={token.stealth}
                onSave={(stealth) => player.token(token.id, { stealth })}
              />
            )}
          </div>
        )}
        {token.kind === 'hero' && token.sneak && (
          <Fact>
            Geht halb so schnell. Wer ihn sehen könnte, bemerkt ihn nur, wenn seine passive
            Wahrnehmung den Wurf auf Heimlichkeit erreicht – ohne Wurf bemerkt ihn jeder.
          </Fact>
        )}
        {token.kind === 'hero' && (
          <>
            <div className="wf-dungeon-dcs">
              <NumberLine
                label="Dunkelsicht"
                value={token.darkvision}
                onSave={(darkvision) =>
                  player.token(token.id, { darkvision: Math.max(0, darkvision ?? 0) })
                }
              />
              <NumberLine
                label="Passive Wahrn."
                value={token.passive}
                onSave={(passive) =>
                  player.token(token.id, { passive: Math.max(0, passive ?? 10) })
                }
              />
            </div>
            <Field
              label="Licht"
              hint={left !== null ? `brennt noch ${clockWords(left)}` : undefined}
            >
              <Select
                value={token.light}
                onChange={(event) => player.light(token.id, event.target.value as DungeonLight)}
              >
                {DUNGEON_LIGHTS.map((light) => (
                  <option key={light} value={light}>
                    {LIGHT_LABEL[light]}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
      </div>
    </Panel>
  );
}

function GroupPanel({ player, editor }: { player: DungeonPlayer; editor: DungeonEditor }) {
  const play = player.play!;
  const rounds = play.rounds;
  const list = rounds ? turnOrder(play) : play.tokens;
  const moving = new Set(player.movers.map((t) => t.id));
  const levelName = (id: string) =>
    editor.dungeon.levels.find((l) => l.id === id)?.name.trim() || 'Ebene';
  return (
    <Panel
      title={rounds ? `Runde ${rounds.round}` : 'Die Gruppe'}
      actions={
        <span className="wf-dungeon-clock" title="Vergangene Zeit im Dungeon">
          {clockWords(play.seconds)}
        </span>
      }
    >
      <div className="wf-dungeon-form">
        <div className="wf-dungeon-list">
          {list.map((token) => (
            <button
              key={token.id}
              type="button"
              className="wf-dungeon-token"
              data-kind={token.kind}
              aria-pressed={moving.has(token.id)}
              data-turn={rounds?.turn === token.id ? '' : undefined}
              onClick={(event) => {
                if (rounds) return;
                player.setPick(null);
                player.setSelected(
                  event.shiftKey
                    ? player.selected.includes(token.id)
                      ? player.selected.filter((id) => id !== token.id)
                      : [...player.selected, token.id]
                    : player.selected.length === 1 && player.selected[0] === token.id
                      ? []
                      : [token.id],
                );
                if (token.levelId !== editor.level?.id) editor.openLevel(token.levelId);
              }}
            >
              <span className="wf-dungeon-token__dot" aria-hidden />
              <span className="wf-dungeon-token__name wf-clamp-1">
                {token.name.trim() || 'Figur'}
              </span>
              <span className="wf-dungeon-token__sub">
                {[
                  rounds && (token.init !== null ? `Init. ${token.init}` : 'ohne Init.'),
                  token.light !== 'none' && LIGHT_LABEL[token.light],
                  token.levelId !== editor.level?.id && levelName(token.levelId),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          ))}
        </div>
        {!rounds && (
          <Fact>
            {player.selected.length === 0
              ? 'Alle gehen gemeinsam. Eine Figur anklicken, um sie allein zu schicken.'
              : 'Nur die Gewählten gehen. Umschalt-Klick wählt mehrere.'}
          </Fact>
        )}
        {rounds && (
          <div className="wf-dungeon-actions">
            <Button size="sm" variant="primary" onClick={player.endTurn}>
              Zug beenden
            </Button>
            {play.tokens.find((t) => t.id === rounds.turn)?.kind === 'foe' && (
              <Button
                size="sm"
                title="Er geht auf den nächsten Gefährten zu, so weit seine Bewegung reicht."
                onClick={() => player.foeMove(rounds.turn!)}
              >
                Auf die Gruppe zu
              </Button>
            )}
            {play.tokens.some((t) => t.init === null) && (
              <Button size="sm" onClick={player.rollInit}>
                Initiative würfeln
              </Button>
            )}
            <Button size="sm" onClick={() => player.rounds(false)}>
              Runden beenden
            </Button>
          </div>
        )}
        {rounds &&
          (() => {
            const turn = play.tokens.find((t) => t.id === rounds.turn);
            if (!turn || turn.hp === 0) return null;
            const others = play.tokens.filter(
              (t) => t.kind !== turn.kind && t.levelId === turn.levelId && t.hp !== 0,
            );
            const lines = others
              .map((t) => ({
                t,
                cover: coverBetween(
                  editor.dungeon,
                  turn.levelId,
                  { x: turn.x, y: turn.y },
                  { x: t.x, y: t.y },
                ),
              }))
              .filter((row) => row.cover !== 'none');
            if (lines.length === 0) return null;
            return (
              <Fact>
                Deckung gegen {turn.name.trim() || 'die Figur'}:{' '}
                {lines
                  .map((row) => `${row.t.name.trim() || 'Figur'} ${COVER_LABEL[row.cover]}`)
                  .join(' · ')}
              </Fact>
            );
          })()}
        {rounds && (
          <Fact>
            {(() => {
              const turn = play.tokens.find((t) => t.id === rounds.turn);
              return turn
                ? `${turn.name.trim() || 'Die Figur'} ist am Zug: ${rounds.moved} von ${turn.speed} Fuß gegangen.`
                : 'Niemand ist am Zug.';
            })()}
          </Fact>
        )}
        {!rounds && (
          <div className="wf-dungeon-actions">
            <Button
              size="sm"
              icon={<Search />}
              disabled={player.movers.length === 0}
              title="Wer vorn steht, durchsucht zehn Fuß ringsum. Wayfarer nennt, was dort verborgen ist, und den SG."
              onClick={player.searchAround}
            >
              Durchsuchen ({clockWords(SEARCH_SECONDS)})
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => player.wait(60, 'Eine Minute vergeht')}
            >
              +1 Min.
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => player.wait(600, 'Zehn Minuten vergehen')}
            >
              +10 Min.
            </Button>
          </div>
        )}
        {unsyncedMinutes(play) >= 1 && (
          <div className="wf-dungeon-pickrow">
            <span>Die Weltzeit steht noch {clockWords(unsyncedMinutes(play) * 60)} zurück.</span>
            <Button
              size="sm"
              variant="ghost"
              title="Stellt die Weltzeit um die im Dungeon vergangenen Minuten vor – Termine und Uhren treten dabei ein."
              onClick={player.syncTime}
            >
              Übernehmen
            </Button>
          </div>
        )}
        {!rounds && (
          <div className="wf-dungeon-actions">
            <Button size="sm" icon={<Swords />} onClick={() => player.rounds(true)}>
              Runden
            </Button>
            <Button
              size="sm"
              icon={<UserPlus />}
              aria-pressed={player.placing === 'foe'}
              onClick={() => player.setPlacing(player.placing === 'foe' ? null : 'foe')}
            >
              Gegner
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={player.placing === 'hero'}
              onClick={() => player.setPlacing(player.placing === 'hero' ? null : 'hero')}
            >
              Figur
            </Button>
          </div>
        )}
        {!rounds && (
          <div className="wf-dungeon-actions">
            <Button
              size="sm"
              variant="ghost"
              icon={<Volume2 />}
              disabled={player.movers.length === 0}
              title="Lärm dort, wo die Gruppe steht: Wer ihn hört, wacht auf und kommt nachsehen."
              onClick={() => player.noise(60)}
            >
              Lärm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Hammer />}
              aria-pressed={player.breaching}
              title="Der nächste Klick auf eine Wand oder in den Fels bricht dort durch."
              onClick={() => player.setBreaching(!player.breaching)}
            >
              Durchbrechen
            </Button>
          </div>
        )}
        {player.breaching && <Fact>Klicke die Wand oder den Fels an, der durchbrochen wird.</Fact>}
        {player.placing && (
          <Fact>
            Klicke das Feld an, auf dem {player.placing === 'foe' ? 'der Gegner' : 'die Figur'}{' '}
            steht.
          </Fact>
        )}
      </div>
    </Panel>
  );
}

function SearchBox({ player }: { player: DungeonPlayer }) {
  const search = player.search;
  if (!search) return null;
  return (
    <Panel title="Durchsucht">
      <div className="wf-dungeon-form">
        {search.found.length === 0 ? (
          <Fact>Hier ist nichts verborgen.</Fact>
        ) : (
          <>
            <Fact>
              Das liegt hier verborgen. Gewürfelt wird am Tisch – klick an, was gefunden ist.
            </Fact>
            {search.found.map((hidden) => (
              <div key={hidden.keys[0]} className="wf-dungeon-pickrow">
                <span>
                  {hidden.label}
                  {hidden.dc !== null ? ` · SG ${hidden.dc}` : ' · ohne SG'}
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    player.found(hidden.keys, true);
                    player.setPick(hidden.pick);
                  }}
                >
                  Gefunden
                </Button>
              </div>
            ))}
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => player.setSearch(null)}>
          Schließen
        </Button>
      </div>
    </Panel>
  );
}

// ── Die ganze Tafel ────────────────────────────────────────────────────────

export function PlayPanel({ player, editor }: { player: DungeonPlayer; editor: DungeonEditor }) {
  const play = player.play;
  const level = editor.level;
  if (!level) return null;
  if (!play)
    return (
      <Panel title="Spielen">
        <div className="wf-dungeon-form">
          <p className="wf-dungeon-hint">
            Klicke das Feld an, auf dem die Gruppe beginnt. Wayfarer stellt deine Gefährten dort auf
            – mit ihrer Bewegungsrate, Dunkelsicht und passiven Wahrnehmung. Ohne Gefährten stehen
            vier freie Figuren da.
          </p>
          <p className="wf-dungeon-hint">
            Danach: ein Feld anklicken, und die Gruppe geht dorthin. Sie hält von selbst an Türen,
            Fallen, Geheimtüren und wenn ein Gegner in Sicht kommt.
          </p>
        </div>
      </Panel>
    );
  const one =
    !play.rounds && player.selected.length === 1
      ? play.tokens.find((t) => t.id === player.selected[0])
      : play.rounds
        ? play.tokens.find((t) => t.id === play.rounds?.turn)
        : undefined;
  const restart = async () => {
    const ok = await confirmDialog({
      title: 'Neu beginnen?',
      body: 'Figuren, Gesehenes, geöffnete Türen und Gefundenes werden zurückgesetzt. Der Dungeon selbst bleibt, wie er gebaut ist.',
      confirmLabel: 'Neu beginnen',
      danger: true,
    });
    if (ok) player.restart();
  };
  return (
    <>
      <HaltCard player={player} />
      <GroupPanel player={player} editor={editor} />
      <SearchBox player={player} />
      <PickBox player={player} level={level} editor={editor} />
      {one && <TokenBox key={one.id} player={player} token={one} />}
      <Panel title="Ansicht">
        <div className="wf-dungeon-form">
          <Checkbox checked={player.playerView} onChange={player.setPlayerView}>
            <Eye aria-hidden className="wf-dungeon-inline" /> Sicht der Spieler – nur, was die
            Gruppe kennt
          </Checkbox>
          <Checkbox
            checked={level.lit}
            onChange={(lit) => editor.applyLevel((lv) => ({ ...lv, lit }))}
          >
            <Flame aria-hidden className="wf-dungeon-inline" /> Auf dieser Ebene ist es hell
          </Checkbox>
          <div className="wf-dungeon-actions">
            <Button size="sm" icon={<Undo2 />} disabled={!player.canBack} onClick={player.back}>
              Zurück
            </Button>
            <Button size="sm" variant="ghost" onClick={restart}>
              Neu beginnen
            </Button>
          </div>
        </div>
      </Panel>
      {play.log.length > 0 && (
        <Panel title="Was geschah">
          <ol className="wf-dungeon-log">
            {[...play.log]
              .reverse()
              .slice(0, 10)
              .map((line, index) => (
                <li key={`${line.at}-${index}`}>
                  <span className="wf-dungeon-log__at">{clockWords(line.at)}</span> {line.text}
                </li>
              ))}
          </ol>
        </Panel>
      )}
    </>
  );
}
