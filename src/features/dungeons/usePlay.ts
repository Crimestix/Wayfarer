/**
 * Der Zustand des Spielens: wer gewählt ist, was rechts gezeigt wird, der letzte Halt – und die
 * Handgriffe, die den Stand des Dungeons (`dungeon.play`) schreiben. Gerechnet wird in
 * `domain/dungeonPlay.ts`; hier wird nur ausgelöst und gespeichert.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CampaignDb } from '../../data/db';
import { activeParty } from '../../domain/derive';
import { edgeRun, thingAt, type DungeonPick } from '../../domain/dungeon';
import {
  addToken,
  edgeFoundKey,
  endRounds,
  hiddenNear,
  moveTokens,
  nextTurn,
  passTime,
  patchToken,
  placeToken,
  playLevel,
  playerLevel,
  removeToken,
  routeBetween,
  setDoor,
  setFound,
  setLight,
  setTrapDisarmed,
  startPlay,
  startRounds,
  useStair as takeStair,
  visibleCells,
  LIGHT_LABEL,
  SEARCH_SECONDS,
  type Halt,
  type HeroInit,
  type Hidden,
} from '../../domain/dungeonPlay';
import type {
  CampaignData,
  Dungeon,
  DungeonCell,
  DungeonLight,
  DungeonPlay,
  DungeonToken,
} from '../../domain/schema';
import { marchRows } from '../gruppe/march';
import type { PlayControl } from './DungeonCanvas';
import type { DungeonEditor } from './editor';

/** Frühere Stände je Dungeon – „Zurück“ am Tisch. Übersteht den Wechsel der Seite, nicht den Neustart. */
const pasts = new Map<string, (DungeonPlay | null)[]>();
const PAST_STEPS = 40;

/** Wer mitspielt: die Gefährten in Marschordnung, sonst vier freie Figuren. */
export function heroesOf(data: CampaignData): HeroInit[] {
  const party = activeParty(data);
  if (party.length === 0)
    return [1, 2, 3, 4].map((n) => ({ name: `Figur ${n}`, speed: 30, passive: 10 }));
  const ordered = marchRows(data).flat();
  const list = ordered.length === party.length ? ordered : party;
  return list.map((hero) => ({
    name: hero.name,
    characterId: hero.id,
    speed: hero.character.speed || 30,
    darkvision: hero.character.darkvision ?? 0,
    passive: hero.character.passivePerception ?? 10,
  }));
}

export function usePlay(db: CampaignDb, dungeon: Dungeon, editor: DungeonEditor) {
  const play = dungeon.play;
  const level = editor.level;
  const levelId = level?.id ?? '';
  const [selected, setSelected] = useState<string[]>([]);
  const [pick, setPick] = useState<DungeonPick | null>(null);
  const [halt, setHalt] = useState<Halt | null>(null);
  const [playerView, setPlayerView] = useState(false);
  /** Der nächste Klick auf die Karte stellt einen Gegner oder eine Figur hin. */
  const [placing, setPlacing] = useState<'foe' | 'hero' | null>(null);
  const [search, setSearch] = useState<{ tokenId: string; found: Hidden[] } | null>(null);
  const [, bump] = useState(0);

  const latest = useRef(dungeon);
  latest.current = dungeon;

  const write = useCallback(
    (next: DungeonPlay | null, remember = true) => {
      const before = latest.current.play;
      if (next === before) return;
      if (remember) {
        const past = pasts.get(dungeon.id) ?? [];
        pasts.set(dungeon.id, [...past, before].slice(-PAST_STEPS));
      }
      latest.current = { ...latest.current, play: next };
      db.patch('dungeons', dungeon.id, { play: next });
      bump((n) => n + 1);
    },
    [db, dungeon.id],
  );

  const back = useCallback(() => {
    const past = pasts.get(dungeon.id) ?? [];
    if (past.length === 0) return;
    pasts.set(dungeon.id, past.slice(0, -1));
    write(past[past.length - 1] ?? null, false);
    setHalt(null);
    setSearch(null);
  }, [dungeon.id, write]);

  // Was gewählt war, gibt es nicht mehr.
  useEffect(() => {
    const ids = new Set(play?.tokens.map((t) => t.id));
    if (selected.some((id) => !ids.has(id))) setSelected(selected.filter((id) => ids.has(id)));
  }, [play, selected]);

  const tokensHere = useMemo(
    () => (play ? play.tokens.filter((t) => t.levelId === levelId) : []),
    [play, levelId],
  );

  /**
   * Wer sich bewegt: in Runden, wer am Zug ist; sonst die Gewählten – ohne Auswahl alle Gefährten
   * dieser Ebene, in ihrer Reihenfolge.
   */
  const movers = useMemo((): DungeonToken[] => {
    if (!play) return [];
    if (play.rounds) return play.tokens.filter((t) => t.id === play.rounds!.turn);
    const chosen = play.tokens.filter((t) => selected.includes(t.id) && t.levelId === levelId);
    return chosen.length > 0 ? chosen : tokensHere.filter((t) => t.kind === 'hero');
  }, [play, selected, levelId, tokensHere]);

  const visible = useMemo(() => visibleCells(dungeon, levelId), [dungeon, levelId]);
  const seen = useMemo(() => new Set(play?.seen[levelId] ?? []), [play, levelId]);

  /** Nach einem Schritt: der Halt, und was er meint, steht rechts. */
  const settle = useCallback(
    (next: DungeonPlay, stop: Halt | null) => {
      write(next);
      setHalt(stop);
      setSearch(null);
      if (stop?.pick) setPick(stop.pick);
    },
    [write],
  );

  const moveTo = useCallback(
    (cell: DungeonCell) => {
      const result = moveTokens(
        latest.current,
        movers.map((t) => t.id),
        cell,
      );
      if (result) settle(result.play, result.halt);
    },
    [movers, settle],
  );

  const control: PlayControl | null = useMemo(() => {
    if (!level) return null;
    if (!play)
      return {
        level,
        overlay: { visible: new Set(), seen: new Set(), playerView: false, tokens: [] },
        pick: null,
        tokenAt: () => null,
        preview: () => null,
        onToken: () => {},
        onPlace: () => {},
        // Noch nicht begonnen: Der erste Klick stellt die Gruppe auf.
        onCell: (cell) => {
          const started = startPlay(latest.current, heroesOf(db.getSnapshot()), level.id, cell);
          if (started) write(started);
        },
      };
    const shown = playerView ? playerLevel(level, play) : playLevel(level, play);
    return {
      level: shown,
      pick,
      overlay: {
        visible,
        seen,
        playerView,
        tokens: tokensHere
          // In der Sicht der Spieler steht ein Gegner nur da, wenn ihn gerade jemand sieht.
          .filter((t) => !playerView || t.kind === 'hero' || visible.has(`${t.x},${t.y}`))
          .map((t) => ({
            id: t.id,
            x: t.x,
            y: t.y,
            name: t.name,
            kind: t.kind,
            selected: movers.some((m) => m.id === t.id),
            turn: play.rounds?.turn === t.id,
            light: t.light !== 'none',
          })),
      },
      tokenAt: (cell) => tokensHere.find((t) => t.x === cell.x && t.y === cell.y)?.id ?? null,
      preview: (cell) => {
        const first = movers[0];
        if (!first || placing) return null;
        const route = routeBetween(latest.current, level.id, { x: first.x, y: first.y }, cell);
        return route && route.cells.length > 1 ? route : null;
      },
      onToken: (id, add) => {
        setSelected((now) =>
          add ? (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]) : [id],
        );
        setPick(null);
      },
      onPlace: (id, cell) => {
        const next = placeToken(latest.current, id, level.id, cell);
        if (next) write(next);
      },
      onCell: (cell, edge) => {
        if (placing) {
          const made = addToken(latest.current.play!, placing, level.id, cell);
          write(made.play);
          setSelected([made.token.id]);
          setPlacing(null);
          return;
        }
        // Eine Tür, ein Gitter, eine Geheimtür: anklicken zeigt sie rechts.
        const here = playLevel(level, latest.current.play);
        const hit = edge ? here.edges[edge] : undefined;
        if (edge && hit && hit.kind !== 'wall' && hit.kind !== 'open') {
          setPick({ type: 'edge', key: edge });
          setHalt(null);
          return;
        }
        const thing = thingAt(here, cell);
        setPick(thing);
        moveTo(cell);
      },
    };
  }, [
    level,
    play,
    playerView,
    pick,
    visible,
    seen,
    tokensHere,
    movers,
    placing,
    db,
    write,
    moveTo,
  ]);

  // ── Handgriffe ───────────────────────────────────────────────────────────

  const door = useCallback(
    (key: string, change: { opened?: boolean; locked?: boolean }) => {
      const next = setDoor(latest.current, levelId, key, change);
      if (next) write(next);
      setHalt(null);
    },
    [levelId, write],
  );

  const found = useCallback(
    (keys: string[], on: boolean) => {
      const now = latest.current.play;
      if (!now) return;
      write(setFound(now, keys, on));
      setSearch((s) => (s ? { ...s, found: s.found.filter((h) => h.keys[0] !== keys[0]) } : s));
    },
    [write],
  );

  /** Eine Geheimtür auf ganzer Breite als gefunden merken. */
  const foundEdge = useCallback(
    (key: string, on: boolean) => {
      const lv = latest.current.levels.find((l) => l.id === levelId);
      if (!lv) return;
      found(
        edgeRun(lv, key).map((k) => edgeFoundKey(levelId, k)),
        on,
      );
    },
    [levelId, found],
  );

  const disarm = useCallback(
    (trapId: string, on: boolean) => {
      const now = latest.current.play;
      if (now) write(setTrapDisarmed(now, trapId, on));
      setHalt(null);
    },
    [write],
  );

  const stairs = useCallback(
    (stairId: string) => {
      const result = takeStair(
        latest.current,
        movers.map((t) => t.id),
        levelId,
        stairId,
      );
      if (!result) return;
      settle(result.play, result.halt);
      if (result.levelId !== levelId) editor.openLevel(result.levelId);
    },
    [movers, levelId, settle, editor],
  );

  const wait = useCallback(
    (seconds: number, why: string) => {
      const result = passTime(latest.current, seconds, why);
      if (result) settle(result.play, result.halt);
    },
    [settle],
  );

  const searchAround = useCallback(() => {
    const who = movers[0];
    if (!who) return;
    const result = passTime(
      latest.current,
      SEARCH_SECONDS,
      `${who.name.trim() || 'Jemand'} durchsucht die Umgebung`,
    );
    if (!result) return;
    write(result.play);
    setHalt(result.halt);
    setSearch({
      tokenId: who.id,
      found: hiddenNear({ ...latest.current, play: result.play }, who.id),
    });
  }, [movers, write]);

  const token = useCallback(
    (id: string, change: Partial<Omit<DungeonToken, 'id'>>) => {
      const next = patchToken(latest.current, id, change);
      if (next) write(next);
    },
    [write],
  );

  const light = useCallback(
    (id: string, kind: DungeonLight) => {
      const next = setLight(latest.current, id, kind);
      if (next) write(next);
    },
    [write],
  );

  const remove = useCallback(
    (id: string) => {
      const now = latest.current.play;
      if (now) write(removeToken(now, id));
    },
    [write],
  );

  const rounds = useCallback(
    (on: boolean) => {
      const now = latest.current.play;
      if (!now) return;
      write(on ? startRounds(now) : endRounds(now));
      setHalt(null);
    },
    [write],
  );

  const endTurn = useCallback(() => {
    const now = latest.current.play;
    if (!now) return;
    const result = nextTurn(now);
    write(result.play);
    setHalt(
      result.out
        ? {
            type: 'light',
            title: `${LIGHT_LABEL[result.out.light]} von ${result.out.name.trim() || 'jemandem'} erlischt`,
            text: '',
            levelId: result.out.levelId,
            pick: null,
            cell: null,
          }
        : null,
    );
    // Wer am Zug ist, steht im Bild.
    const turn = result.play.tokens.find((t) => t.id === result.play.rounds?.turn);
    if (turn && turn.levelId !== levelId) editor.openLevel(turn.levelId);
  }, [write, levelId, editor]);

  const restart = useCallback(() => {
    write(null);
    setSelected([]);
    setPick(null);
    setHalt(null);
    setSearch(null);
  }, [write]);

  return {
    play,
    control,
    selected,
    setSelected,
    movers,
    tokensHere,
    pick,
    setPick,
    halt,
    setHalt,
    playerView,
    setPlayerView,
    placing,
    setPlacing,
    search,
    setSearch,
    canBack: (pasts.get(dungeon.id) ?? []).length > 0,
    back,
    door,
    found,
    foundEdge,
    disarm,
    stairs,
    wait,
    searchAround,
    token,
    light,
    remove,
    rounds,
    endTurn,
    restart,
  };
}

export type DungeonPlayer = ReturnType<typeof usePlay>;
