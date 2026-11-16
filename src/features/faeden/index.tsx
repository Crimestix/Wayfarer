/**
 * Das Fadenbrett: eine Pinnwand. Geschichten liegen als Karten darauf, daneben die Personen, Orte
 * und Fraktionen, an denen sie hängen – verbunden durch Fäden. Wo zwei Karten am selben Namen
 * hängen, berühren sich ihre Geschichten. Alles lässt sich frei legen; was der Spielleiter nicht
 * hingelegt hat, legt Wayfarer aus. Lose Fäden stehen in der Liste daneben (`LooseDrawer`) – aufs
 * Brett kommt einer nur, wenn der Spielleiter ihn hinlegt oder ins Spiel nimmt; von dort (und aus
 * der Liste) lässt er sich auf eine Geschichte ziehen. Die Rechnung steht in `domain/story.ts`
 * und `domain/looseThreads.ts`.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
} from 'react';
import { useLocation } from 'wouter';
import {
  BookOpen,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  LayoutGrid,
  Link2,
  Maximize,
  Minus,
  Pencil,
  Plus,
  TriangleAlert,
  Waypoints,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { looseThreads, threadTwins } from '../../domain/looseThreads';
import {
  BOARD_CARD,
  ENTRY_STANDING_LABEL,
  NEARNESS_LABEL,
  PACE_LABEL,
  THREAD_STATE_LABEL,
  boardCards,
  boardLayout,
  entryFit,
  hitOnBoard,
  insideOnBoard,
  isLooseThread,
  looseClocks,
  reputeOf,
  threadLive,
  threadWarning,
  touchReason,
  touches,
  untilText,
  type BoardCard,
  type BoardPin,
  type BoardView,
  type Spot,
  type Touch,
} from '../../domain/story';
import {
  THREAD_STATES,
  type Clock,
  type Entity,
  type Thread,
  type ThreadState,
} from '../../domain/schema';
import { boardWeb, pinExists, type BoardKnot, type WebString } from '../../domain/threadWeb';
import { searchWorld } from '../../shell/search';
import { articleExcerpt } from '../tisch/wiki';
import { formatDayMonth } from '../../domain/time/calendar';
import { isNear } from '../../domain/weight';
import { openAttitude } from '../../shell/commands';
import { useFocus } from '../../shell/focus';
import {
  AttitudeBadge,
  Button,
  Checkbox,
  EmptyState,
  EntityPicker,
  IconButton,
  KindIcon,
  Select,
  Written,
  cx,
  entityHref,
  toast,
} from '../../ui';
import { useBoard } from '../../ui/board';
import { ClockDialog } from '../kalender/ClockDialog';
import {
  connectOnBoard,
  moveThread,
  moveThreads,
  newStory,
  pinToCard,
  placeManyOnBoard,
  placeOnBoard,
  setArticleOn,
  setHintLead,
  setStoryUnfolded,
  setTieWord,
  takeFreeOffBoard,
  takeOffBoard,
  unpinFromCard,
  untieThreads,
  writeOnBoard,
  setThreadOnBoard,
  setThreadState,
  storyFromClock,
  tidyBoard,
} from './actions';
import { RelationQuick } from '../welt/RelationQuick';
import { ThreadWeb, findHint } from './WebParts';
import { useHoldDraft } from '../../ui/drafts';
import { ThreadDialog } from './Dialogs';
import { AttachDialog } from './LooseDialogs';
import { LooseDrawer, THREAD_DRAG } from './LooseDrawer';
import './faeden.css';

/** Mit etwas Abstand zueinander, wenn mehrere Fäden auf einmal aufs Brett gezogen werden. */
const DROP_STEP = 36;

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

type OpenDialog =
  | { type: 'thread'; thread: Thread | null; storyId: string | null }
  /** Die Uhr einer Geschichte – `before`: welche Uhren es beim Öffnen schon gab. */
  | { type: 'clock'; clock: Clock | null; storyId: string; before: ReadonlySet<string> }
  /** Lose Fäden an eine Geschichte hängen. */
  | { type: 'attach'; ids: string[] }
  | null;

export default function FaedenPage() {
  const db = useDb();
  const data = useData();
  const [view, setView] = useState<BoardView>('truth');
  /** Die gewählte Karte (`story:…`, `thread:…`) oder der gewählte Name (`node:…`). */
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const cards = useMemo(() => boardCards(data, view), [data, view]);
  // Auf dem Brett liegen die Geschichten – und die losen Fäden, die hingelegt wurden.
  const open = useMemo(() => cards.filter((card) => !card.closed && card.onBoard), [cards]);
  const links = useMemo(() => touches(open), [open]);
  const closed = cards.filter((card) => card.closed);
  /** Die losen Fäden – sie stehen in der Liste neben dem Brett. */
  const loose = useMemo(() => looseThreads(data, view, cards), [data, view, cards]);
  const twins = useMemo(() => threadTwins(data), [data]);
  const looseCount = loose.filter((row) => !row.resting).length;
  /** Uhren, die zu keiner Geschichte gehören – sie lassen sich zu einer machen. */
  const orphans = useMemo(() => looseClocks(data), [data]);
  const current = cards.find((card) => card.key === selected) ?? null;
  /** Der Seitenteil: die gewählte Karte – oder die Liste der losen Fäden. */
  const [side, setSide] = useState<'card' | 'loose'>(() => (loose.length ? 'loose' : 'card'));
  /** Der lose Faden, der in der Liste gleich im Bild stehen soll. */
  const [looseFocus, setLooseFocus] = useState<string | null>(null);
  /** Suche und Auswahl der Liste – sie bleiben, wenn zwischendurch eine Karte angesehen wird. */
  const [looseQuery, setLooseQuery] = useState('');
  const [loosePicked, setLoosePicked] = useState<ReadonlySet<string>>(new Set());
  /** Zeigt die gewählte Karte – die Liste springt danach nicht mehr zu einem alten Faden. */
  const showCard = () => {
    setSide('card');
    setLooseFocus(null);
  };
  /** Zeigt einen losen Faden in der Liste – ohne Suche, damit er sicher dasteht. */
  const showLoose = (threadId: string) => {
    setLooseFocus(threadId);
    setLooseQuery('');
    setSide('loose');
  };
  /**
   * Wählt eine Karte. Ein loser Faden, der nicht auf dem Brett liegt, steht in der Liste – dort
   * wird er gezeigt.
   */
  const select = (key: string | null) => {
    const card = key ? cards.find((entry) => entry.key === key) : undefined;
    if (card && !card.story && !card.closed && !card.onBoard) {
      showLoose(card.threads[0]!.id);
      setSelected(null);
      return;
    }
    setSelected(key);
    if (key) showCard();
  };
  // Aus der Suche geöffnet: Die gesuchte Karte ist gleich gewählt.
  useFocus(['card'], (focus) => select(focus.key));

  // Die Pinnwand: frei verschieben, vergrößern, Karten und Namen ziehen.
  const frame = useRef<HTMLDivElement>(null);
  const wall = useBoard(frame);
  /** Was gerade gezogen wird – je Stück seine Stelle, bis es losgelassen wird. */
  const [moving, setMoving] = useState<Record<string, Spot> | null>(null);
  /** Mehrere gewählte Stücke (Umschalt-Klick, Rahmen) – sie ziehen gemeinsam. */
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  /** Die gewählte Schnur. */
  const [lineKey, setLineKey] = useState<string | null>(null);
  /** Der Rahmen, der gerade aufgezogen wird. */
  const [band, setBand] = useState<{ a: Spot; b: Spot } | null>(null);
  /** Hier wird gerade ein Faden hingeschrieben (Doppelklick ins Leere). */
  const [drafting, setDrafting] = useState<Spot | null>(null);
  const clearPicks = () => {
    setPicked(new Set());
    setLineKey(null);
  };
  const [, navigate] = useLocation();
  /** Eine neue Geschichte: Sie entsteht leer und wird auf ihrem Blatt geschrieben. */
  const write = (at?: Spot) => {
    const story = newStory(db);
    if (at) placeOnBoard(db, `story:${story.id}`, at.x, at.y);
    navigate(`/geschichte/${story.id}`);
  };
  const placed = data.state.board;
  /** Das Netz der Fäden: Knoten an den Geschichten und Schnüre zwischen Fäden. */
  const web = useMemo(() => boardWeb(data, cards, view), [data, cards, view]);
  /** Namen und Artikel, die eine Stelle haben – frei hingelegt oder verschoben. */
  const free = useMemo(
    () => Object.keys(placed).filter((key) => pinExists(data, key)),
    [placed, data],
  );
  const layout = useMemo(
    () => boardLayout(web.cards, moving ? { ...placed, ...moving } : placed, web.knots, free),
    [web, placed, moving, free],
  );
  const pin = layout.pins.find((entry) => entry.key === selected) ?? null;
  const knot = web.knots.find((entry) => entry.key === selected) ?? null;
  /** Wo eine Schnur an etwas ansetzt: Karte (oben), Knoten oder Name (Mitte). */
  const anchorOf = (key: string): Spot | null => {
    const card = layout.cards[key];
    if (card) return { x: card.x, y: card.y + 56 };
    const knotAt = layout.knots[key];
    // Am Knoten setzt die Schnur an seinem Kreis an.
    if (knotAt) return { x: knotAt.x + 12, y: knotAt.y };
    const at = layout.pins.find((entry) => entry.key === key);
    return at ? { x: at.x, y: at.y } : null;
  };
  /** Die Stelle eines Stücks in den Maßen, in denen das Brett sie speichert. */
  const spotOf = (key: string): Spot | null =>
    layout.cards[key] ??
    layout.knots[key] ??
    layout.pins.find((entry) => entry.key === key) ??
    null;
  /** Eine Schnur, die gerade frei gezogen wird – von wo, bis wohin. */
  const [linking, setLinking] = useState<{ from: string; start: Spot; end: Spot } | null>(null);
  /** Zwei Namen verbunden: Das Fenster für eine Beziehung der Welt. */
  const [relating, setRelating] = useState<{ self: Entity; otherId: string } | null>(null);
  const startLink = (key: string) => (event: PointerEvent) => {
    event.stopPropagation();
    const start = anchorOf(key);
    if (!start || view !== 'truth') return;
    // Die Schnur beginnt am Ding; wohin sie fällt, sagt die Stelle unter dem Zeiger.
    const grip = wall.toBoard(event.clientX, event.clientY);
    wall.drag(event, {
      onMove: (dx, dy) => setLinking({ from: key, start, end: { x: grip.x + dx, y: grip.y + dy } }),
      onEnd: (moved, dx, dy) => {
        setLinking(null);
        if (!moved) return;
        const target = hitOnBoard(layout, { x: grip.x + dx, y: grip.y + dy });
        if (!target || target === key) return;
        const result = connectOnBoard(db, key, target);
        if (result.done) {
          toast({
            title: result.title,
            body: result.body,
            action: { label: 'Rückgängig', run: result.undo },
          });
          return;
        }
        if ('relate' in result) {
          const self = data.entities[result.relate.fromId];
          if (self) setRelating({ self, otherId: result.relate.toId });
          return;
        }
        if (result.note) toast({ title: 'Nicht verbunden', body: result.note });
      },
    });
  };

  const showAll = (least?: number) =>
    wall.fit(
      [
        ...Object.values(layout.cards).flatMap((at) => [
          at,
          { x: at.x, y: at.y + BOARD_CARD.height },
        ]),
        ...Object.values(layout.knots),
        ...layout.pins,
      ],
      // Die Karten sind breit: Platz für eine halbe Karte am Rand.
      140,
      least,
    );
  // Beim Öffnen liegt das Brett im Bild – aber nie so klein, dass man nichts mehr lesen kann.
  useLayoutEffect(() => showAll(0.62), []);
  /** Eine Karte, die gerade aufs Brett kam: Sobald sie ausgelegt ist, rückt alles ins Bild. */
  const [arriving, setArriving] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!arriving || !layout.cards[arriving]) return;
    showAll();
    setArriving(null);
  }, [arriving, layout]);

  /** Was zum Gewählten gehört – alles andere tritt zurück. */
  const related = useMemo(() => {
    if (!selected) return null;
    const keys = new Set([selected]);
    // Knoten gehören zu ihrer Karte – und über Schnüre zu den Fäden am anderen Ende.
    for (const entry of web.knots)
      if (entry.key === selected || entry.cardKey === selected) {
        keys.add(entry.key);
        keys.add(entry.cardKey);
      }
    for (const line of web.strings)
      if (keys.has(line.a) || keys.has(line.b)) {
        keys.add(line.a);
        keys.add(line.b);
      }
    for (const entry of layout.pins) {
      if (entry.key === selected) entry.cards.forEach((key) => keys.add(key));
      else if (entry.cards.includes(selected)) {
        keys.add(entry.key);
        // Karten, die über diesen Namen berührt werden, bleiben sichtbar.
        entry.cards.forEach((key) => keys.add(key));
      }
    }
    return keys;
  }, [selected, layout.pins, web]);

  const strings = layout.pins.flatMap((entry) =>
    entry.cards.flatMap((key) => {
      const from = anchorOf(key);
      if (!from) return [];
      // Ein Faden hängt leicht durch.
      const [mx, my] = [(from.x + entry.x) / 2, (from.y + entry.y) / 2 + 28];
      const lineId = `name:${key}|${entry.key}`;
      return [
        {
          key: `${key}|${entry.key}`,
          lineId,
          owner: key,
          entityId: entry.id,
          article: entry.article,
          mid: { x: mx, y: (from.y + entry.y) / 2 + 14 },
          d: `M ${from.x} ${from.y} Q ${mx} ${my} ${entry.x} ${entry.y}`,
          shared: entry.cards.length > 1,
          active: selected === key || selected === entry.key || lineKey === lineId,
        },
      ];
    }),
  );

  /** Die Schnüre von einer Geschichte zu ihren Knoten – kurz, ohne Durchhang. */
  const knotStrings = web.knots.flatMap((entry) => {
    const card = layout.cards[entry.cardKey];
    const at = layout.knots[entry.key];
    if (!card || !at) return [];
    const lineId = `knot:${entry.key}`;
    return [
      {
        key: `${entry.cardKey}|${entry.key}`,
        lineId,
        knot: entry,
        mid: { x: (card.x + at.x) / 2, y: (card.y + 56 + at.y) / 2 },
        d: `M ${card.x} ${card.y + 56} L ${at.x + 6} ${at.y}`,
        active: selected === entry.key || selected === entry.cardKey || lineKey === lineId,
      },
    ];
  });
  /** Die Schnüre des Netzes: Faden an Faden (fest), Hinweis führt zu (gestrichelt). */
  const webStrings = web.strings.flatMap((line) => {
    const [a, b] = [anchorOf(line.a), anchorOf(line.b)];
    if (!a || !b) return [];
    const [mx, my] = [(a.x + b.x) / 2, (a.y + b.y) / 2 + 36];
    return [
      {
        line,
        a,
        b,
        mid: { x: mx, y: (a.y + b.y) / 2 + 18 },
        d: `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`,
      },
    ];
  });

  /** Die gewählte Schnur – was sie verbindet und was sich mit ihr tun lässt. */
  const chosenLine: ChosenLine | null = (() => {
    if (!lineKey) return null;
    const name = strings.find((line) => line.lineId === lineKey);
    if (name)
      return {
        kind: 'name',
        at: name.mid,
        owner: name.owner,
        entityId: name.entityId,
        article: name.article,
      };
    const knotLine = knotStrings.find((line) => line.lineId === lineKey);
    if (knotLine) return { kind: 'knot', at: knotLine.mid, knot: knotLine.knot };
    const webLine = webStrings.find(({ line }) => `web:${line.key}` === lineKey);
    if (webLine) return { kind: 'web', at: webLine.mid, line: webLine.line };
    return null;
  })();
  /** Wählt eine Schnur (ein Klick auf sie). */
  const pickLine = (id: string) => (event: PointerEvent) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    setSelected(null);
    setPicked(new Set());
    setLineKey(lineKey === id ? null : id);
  };
  /** Löst die gewählte Schnur – mit Meldung und Rückgängig; manche lassen sich nur dort lösen, wo sie entstehen. */
  const releaseLine = () => {
    const line = chosenLine;
    if (!line) return;
    const done = (title: string, body: string, undo: (() => void) | null) => {
      setLineKey(null);
      if (undo) toast({ title, body, action: { label: 'Rückgängig', run: undo } });
    };
    if (line.kind === 'web') {
      const [a, b] = [data.threads[line.line.from], data.threads[line.line.to]];
      if (line.line.kind === 'tie')
        done(
          'Verbindung gelöst',
          `„${a?.title ?? ''}“ – „${b?.title ?? ''}“`,
          untieThreads(db, line.line.from, line.line.to),
        );
      else if (line.line.hintId)
        done(
          'Hinweis führt nirgendwo mehr hin',
          `„${line.line.word}“ führte zu „${b?.title ?? ''}“.`,
          setHintLead(db, line.line.from, line.line.hintId, null),
        );
      return;
    }
    if (line.kind === 'knot') {
      const thread = data.threads[line.knot.thread.id];
      if (thread)
        done(
          'Von der Geschichte gelöst',
          `„${thread.title}“ ist jetzt ein loser Faden.`,
          moveThread(db, thread.id, null),
        );
      return;
    }
    const cardKey = line.owner.startsWith('knot:') ? `thread:${line.owner.slice(5)}` : line.owner;
    if (!nameIsPinned(cardKey, line.entityId, line.article)) return;
    if (line.article) {
      const [sort, id] = cardKey.split(':') as [string, string];
      done(
        'Gelöst',
        `„${data.articles[line.entityId]?.title ?? ''}“ gehört nicht mehr zu „${ownerTitle(line.owner)}“.`,
        setArticleOn(db, sort === 'story' ? 'stories' : 'threads', id, line.entityId, false),
      );
      return;
    }
    const entity = data.entities[line.entityId];
    unpinFromCard(db, cardKey, line.entityId);
    done('Gelöst', `${entity?.name ?? ''} hängt nicht mehr an „${ownerTitle(line.owner)}“.`, () =>
      pinToCard(db, cardKey, line.entityId),
    );
  };
  /** Ein Name hängt an einer Karte, weil er dort angeheftet ist – nicht über Hinweis, Uhr oder Szene. */
  const nameIsPinned = (cardKey: string, id_: string, article = false): boolean => {
    const [sort, id] = cardKey.split(':') as [string, string];
    const doc = sort === 'story' ? data.stories[id] : data.threads[id];
    return (article ? doc?.articleIds : doc?.refs)?.includes(id_) === true;
  };
  const ownerTitle = (key: string): string => {
    const threadId =
      key.startsWith('knot:') || key.startsWith('thread:') ? key.slice(key.indexOf(':') + 1) : null;
    if (threadId) return data.threads[threadId]?.title ?? '';
    return data.stories[key.slice(6)]?.title ?? '';
  };
  /** Nimmt die gewählten Stücke vom Brett – lose Fäden; alles andere bleibt, mit einem Satz dazu. */
  const takeOff = (all: readonly string[]) => {
    // Was frei liegt (an nichts hängt), geht mit seiner Stelle vom Brett.
    const loosePins = all.filter((key) =>
      layout.pins.some((entry) => entry.key === key && entry.cards.length === 0),
    );
    const keys = all.filter((key) => !loosePins.includes(key));
    const undoPins = takeFreeOffBoard(db, loosePins);
    const threads = takeOffBoard(db, keys);
    const result = {
      taken: threads.taken + (undoPins ? loosePins.length : 0),
      kept: threads.kept,
      undo:
        undoPins || threads.undo
          ? () =>
              db.batch(() => {
                threads.undo?.();
                undoPins?.();
              })
          : null,
    };
    if (result.taken) {
      clearPicks();
      setSelected(null);
    }
    toast({
      title: result.taken
        ? result.taken === 1
          ? 'Vom Brett genommen'
          : `${result.taken} vom Brett genommen`
        : 'Bleibt auf dem Brett',
      body: [
        threads.taken === 1
          ? 'Der Faden steht weiter unter „Lose Fäden“.'
          : threads.taken
            ? 'Die Fäden stehen weiter unter „Lose Fäden“.'
            : '',
        undoPins ? 'Namen und Artikel bleiben in der Welt, nur nicht mehr auf dem Brett.' : '',
        result.kept
          ? 'Geschichten, Fäden einer Geschichte und Namen, an denen etwas hängt, liegen, weil sie dazugehören.'
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      ...(result.undo ? { action: { label: 'Rückgängig', run: result.undo } } : {}),
    });
  };
  // Entf (am Mac die Löschtaste): Schnur lösen oder Gewähltes vom Brett nehmen. Escape hebt auf.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        clearPicks();
        setDrafting(null);
        return;
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (view !== 'truth') return;
      if (chosenLine) {
        event.preventDefault();
        releaseLine();
        return;
      }
      const keys = picked.size ? [...picked] : selected ? [selected] : [];
      if (!keys.length) return;
      event.preventDefault();
      takeOff(keys);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** Die Geschichte, auf der ein gezogener loser Faden gerade liegt – dort würde er angehängt. */
  const [dropOn, setDropOn] = useState<string | null>(null);
  const truth = view === 'truth';
  /** Die Geschichte unter einer Stelle des Bretts (Mitte der Oberkante einer gezogenen Karte). */
  const storyUnder = (x: number, y: number, except: string): string | null =>
    open.find((card) => {
      const at = layout.cards[card.key];
      return (
        card.story !== null &&
        card.key !== except &&
        at !== undefined &&
        Math.abs(x - at.x) < BOARD_CARD.width / 2 &&
        y + 30 > at.y &&
        y + 30 < at.y + BOARD_CARD.height
      );
    })?.key ?? null;
  /**
   * Hängt lose Fäden an eine Geschichte – mit Meldung und Rückgängig. Vom Brett aus ist danach
   * die Geschichte gewählt; aus der Liste gezogen bleibt die Liste offen, für den nächsten.
   */
  const attach = (threadIds: readonly string[], storyKey: string, show: boolean) => {
    const story = data.stories[storyKey.slice('story:'.length)];
    const undo = story ? moveThreads(db, threadIds, story.id) : null;
    if (!story || !undo) return;
    const first = data.threads[threadIds[0]!];
    if (show) select(storyKey);
    toast({
      title: 'An die Geschichte gehängt',
      body:
        threadIds.length === 1
          ? `„${first?.title ?? ''}“ ist jetzt eine Frage von „${story.title}“.`
          : `${threadIds.length} Fäden sind jetzt Fragen von „${story.title}“.`,
      action: { label: 'Rückgängig', run: undo },
    });
  };
  /** Ziehen legt hin, ein Klick wählt. Ein loser Faden, auf eine Geschichte gezogen, hängt an ihr. */
  const grab = (key: string, at: Spot) => (event: PointerEvent) => {
    event.stopPropagation();
    setLineKey(null);
    const shift = event.shiftKey;
    // Ist das Stück Teil einer Auswahl, zieht die ganze Auswahl mit.
    const group = picked.has(key) && picked.size > 1 ? [...picked] : [key];
    const base: Record<string, Spot> = {};
    for (const each of group) {
      const spot = each === key ? at : spotOf(each);
      if (spot) base[each] = { x: spot.x, y: spot.y };
    }
    const threadId = key.startsWith('thread:') ? key.slice('thread:'.length) : null;
    const thread = threadId ? data.threads[threadId] : undefined;
    const hangs =
      group.length === 1 && truth && thread !== undefined && isLooseThread(data, thread);
    const target = (dx: number, dy: number) =>
      hangs ? storyUnder(at.x + dx, at.y + dy, key) : null;
    const shifted = (dx: number, dy: number) =>
      Object.fromEntries(
        Object.entries(base).map(([each, spot]) => [each, { x: spot.x + dx, y: spot.y + dy }]),
      );
    wall.drag(event, {
      onMove: (dx, dy) => {
        setMoving(shifted(dx, dy));
        setDropOn(target(dx, dy));
      },
      onEnd: (moved, dx, dy) => {
        setMoving(null);
        setDropOn(null);
        if (!moved) {
          if (shift) {
            // Umschalt-Klick: zur Auswahl dazu oder wieder heraus.
            const next = new Set(picked);
            if (selected && !next.size) next.add(selected);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            setPicked(next);
            setSelected(next.size === 1 ? [...next][0]! : null);
            return;
          }
          setPicked(new Set());
          select(key === selected ? null : key);
          return;
        }
        const story = target(dx, dy);
        if (story && threadId) attach([threadId], story, true);
        else placeManyOnBoard(db, shifted(dx, dy));
      },
    });
  };
  /** Mit gedrückter Umschalttaste im Leeren: einen Rahmen um mehrere Stücke aufziehen. */
  const startBand = (event: PointerEvent) => {
    const a = wall.toBoard(event.clientX, event.clientY);
    wall.drag(event, {
      onMove: (dx, dy) => setBand({ a, b: { x: a.x + dx, y: a.y + dy } }),
      onEnd: (moved, dx, dy) => {
        setBand(null);
        if (!moved) return;
        const keys = insideOnBoard(layout, a, { x: a.x + dx, y: a.y + dy });
        setLineKey(null);
        setPicked(new Set(keys));
        setSelected(keys.length === 1 ? keys[0]! : null);
        if (keys.length) showCard();
      },
    });
  };
  /** Die Fäden, die gerade aus der Liste herübergezogen werden. */
  const dragged = (event: DragEvent): boolean => event.dataTransfer.types.includes(THREAD_DRAG);
  const cardUnder = (event: DragEvent): string | null => {
    const key = (event.target as HTMLElement).closest<HTMLElement>('[data-card]')?.dataset.card;
    return key?.startsWith('story:') ? key : null;
  };
  /** Aus der Liste aufs Brett: auf eine Geschichte = anhängen, sonst liegt er dort als Karte. */
  const drop = (event: DragEvent) => {
    if (!dragged(event)) return;
    event.preventDefault();
    setDropOn(null);
    let ids: string[] = [];
    try {
      ids = (JSON.parse(event.dataTransfer.getData(THREAD_DRAG)) as string[]).filter(
        (id) => data.threads[id] !== undefined,
      );
    } catch {
      return;
    }
    if (!ids.length) return;
    const story = cardUnder(event);
    if (story) return attach(ids, story, false);
    const at = wall.toBoard(event.clientX, event.clientY);
    const undos = db.batch(() =>
      ids.map((id, index) =>
        setThreadOnBoard(db, id, true, {
          x: at.x + index * DROP_STEP,
          y: at.y + index * DROP_STEP,
        }),
      ),
    );
    toast({
      title: ids.length === 1 ? 'Aufs Brett gelegt' : `${ids.length} Fäden aufs Brett gelegt`,
      body: 'Als Karte – von dort lässt er sich weiter auf eine Geschichte ziehen.',
      action: {
        label: 'Rückgängig',
        run: () => db.batch(() => [...undos].reverse().forEach((undo) => undo?.())),
      },
    });
  };
  const tidy = () => {
    const undo = tidyBoard(db);
    requestAnimationFrame(() => showAll());
    toast({
      title: 'Brett aufgeräumt',
      body: 'Wayfarer hat alles neu ausgelegt.',
      action: { label: 'Rückgängig', run: undo },
    });
  };
  const isEmpty = cards.length === 0;

  return (
    <div className="wf-page wf-faden">
      <header className="wf-page__head wf-faden-head">
        <h1 className="wf-page__title">Fadenbrett</h1>
        <span className="wf-faden-head__sub">
          {count(open.filter((card) => card.story).length, 'Geschichte', 'Geschichten')} ·{' '}
          {count(looseCount, 'loser Faden', 'lose Fäden')}
        </span>
        <span className="wf-grow" />
        <div className="wf-btn-group" role="group" aria-label="Sicht">
          <Button
            icon={<Eye />}
            aria-pressed={view === 'truth'}
            title="Alles, was du weißt"
            onClick={() => setView('truth')}
          >
            Wahrheit
          </Button>
          <Button
            icon={<EyeOff />}
            aria-pressed={view === 'party'}
            title="Nur die Fäden, die die Gruppe kennt, und die Hinweise, die sie hat"
            onClick={() => setView('party')}
          >
            Was die Gruppe weiß
          </Button>
        </div>
        <Button
          icon={<Plus />}
          onClick={() => setDialog({ type: 'thread', thread: null, storyId: null })}
        >
          Faden
        </Button>
        <Button
          variant="primary"
          icon={<Plus />}
          onClick={() => write()}
          title="Eine neue Geschichte schreiben"
        >
          Geschichte
        </Button>
      </header>

      {isEmpty ? (
        <div className="wf-faden-blank">
          <EmptyState
            icon={<Waypoints aria-hidden />}
            title={
              view === 'party' ? 'Die Gruppe kennt noch keinen Faden' : 'Noch keine Geschichte'
            }
          >
            {view === 'party'
              ? 'Sobald die Gruppe einen Faden kennt oder einen Hinweis findet, steht er hier.'
              : 'Eine Geschichte ist ein Vorhaben: Jemand will etwas, und eine Uhr sagt, was geschieht, wenn niemand eingreift. Ein Faden ist eine Frage oder Spur, der die Gruppe folgen kann. Du schreibst beides – auf dem Brett verbinden Fäden jede Geschichte mit den Personen und Orten, an denen sie hängt.'}
          </EmptyState>
        </div>
      ) : (
        <div className="wf-faden-body" data-side={side}>
          <div
            ref={frame}
            className="wf-faden-wall"
            onPointerDown={(event) => {
              if (event.shiftKey) return startBand(event);
              wall.pan(event, () => {
                setSelected(null);
                clearPicks();
              });
            }}
            onDoubleClick={(event) => {
              // Ein Satz, gleich dort hingeschrieben, wird ein loser Faden auf dem Brett.
              if (view === 'truth') setDrafting(wall.toBoard(event.clientX, event.clientY));
            }}
            onDragOver={(event) => {
              if (!truth || !dragged(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDropOn(cardUnder(event));
            }}
            onDragLeave={() => setDropOn(null)}
            onDrop={drop}
          >
            <div className="wf-faden-layer" style={{ transform: wall.transform }}>
              <svg className="wf-faden-strings" aria-hidden>
                {strings.map((line) => (
                  <path
                    key={line.key}
                    d={line.d}
                    data-shared={line.shared}
                    data-active={line.active}
                    data-dim={selected !== null && !line.active}
                  />
                ))}
                {knotStrings.map((line) => (
                  <path
                    key={line.key}
                    d={line.d}
                    data-knot
                    data-active={line.active}
                    data-dim={related !== null && !line.active}
                  />
                ))}
                {webStrings.map(({ line, d }) => (
                  <path
                    key={line.key}
                    d={d}
                    data-web={line.kind}
                    data-dim={related !== null && !(related.has(line.a) && related.has(line.b))}
                  />
                ))}
                {linking && (
                  <path
                    d={`M ${linking.start.x} ${linking.start.y} L ${linking.end.x} ${linking.end.y}`}
                    data-linking
                  />
                )}
                {webStrings
                  .filter(({ line }) => lineKey === `web:${line.key}`)
                  .map(({ line, d }) => (
                    <path key={`chosen:${line.key}`} d={d} data-chosen />
                  ))}
                {/* Breite, unsichtbare Spuren über den Schnüren: Daran klickt man sie an. */}
                {truth &&
                  [
                    ...strings.map((line) => ({ id: line.lineId, d: line.d })),
                    ...knotStrings.map((line) => ({ id: line.lineId, d: line.d })),
                    ...webStrings.map(({ line, d }) => ({ id: `web:${line.key}`, d })),
                  ].map((line) => (
                    <path
                      key={`hit:${line.id}`}
                      className="wf-faden-hit"
                      d={line.d}
                      onPointerDown={pickLine(line.id)}
                    />
                  ))}
              </svg>
              {band && (
                <div
                  className="wf-faden-band"
                  style={{
                    left: Math.min(band.a.x, band.b.x),
                    top: Math.min(band.a.y, band.b.y),
                    width: Math.abs(band.a.x - band.b.x),
                    height: Math.abs(band.a.y - band.b.y),
                  }}
                />
              )}
              {chosenLine && (
                <LineMenu
                  line={chosenLine}
                  pinned={
                    chosenLine.kind === 'name' &&
                    nameIsPinned(
                      chosenLine.owner.startsWith('knot:')
                        ? `thread:${chosenLine.owner.slice(5)}`
                        : chosenLine.owner,
                      chosenLine.entityId,
                      chosenLine.article,
                    )
                  }
                  ownerTitle={chosenLine.kind === 'name' ? ownerTitle(chosenLine.owner) : ''}
                  onRelease={releaseLine}
                  onClose={() => setLineKey(null)}
                />
              )}
              {drafting && (
                <BoardDraft
                  at={drafting}
                  onDone={(title) => {
                    const at = drafting;
                    setDrafting(null);
                    const written = writeOnBoard(db, title, { x: at.x, y: at.y - 20 });
                    if (!written) return;
                    select(`thread:${written.thread.id}`);
                    toast({
                      title: 'Faden hingelegt',
                      body: `„${written.thread.title}“ – zieh ihn auf eine Geschichte oder eine Schnur von ihm weg.`,
                      action: { label: 'Rückgängig', run: written.undo },
                    });
                  }}
                  onCancel={() => setDrafting(null)}
                />
              )}
              {webStrings
                .filter(({ line }) => line.word)
                .map(({ line, mid }) => (
                  <WebWord
                    key={`word:${line.key}`}
                    line={line}
                    at={mid}
                    dim={related !== null && !(related.has(line.a) && related.has(line.b))}
                  />
                ))}
              {web.knots.map((entry) => {
                const at = layout.knots[entry.key];
                if (!at) return null;
                return (
                  <Knot
                    key={entry.key}
                    knot={entry}
                    at={at}
                    selected={entry.key === selected || picked.has(entry.key)}
                    dim={related !== null && !related.has(entry.key)}
                    onGrab={grab(entry.key, at)}
                    onLink={truth ? startLink(entry.key) : undefined}
                  />
                );
              })}
              {layout.pins.map((entry) => {
                const entity = entry.article ? undefined : data.entities[entry.id];
                const article = entry.article ? data.articles[entry.id] : undefined;
                const name = entity?.name ?? article?.title;
                if (!name) return null;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    className={cx('wf-faden-pin', article && 'wf-faden-pin--article')}
                    style={{ left: entry.x, top: entry.y }}
                    data-shared={entry.cards.length > 1}
                    data-free={entry.cards.length === 0}
                    data-dim={related !== null && !related.has(entry.key)}
                    aria-pressed={entry.key === selected || picked.has(entry.key)}
                    title={
                      entry.cards.length > 1
                        ? `${name} – hier berühren sich ${entry.cards.length} Karten`
                        : entry.cards.length === 0
                          ? `${name} – liegt frei; zieh eine Schnur zu einem Faden oder einer Geschichte`
                          : name
                    }
                    onPointerDown={grab(entry.key, entry)}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    {entity ? <KindIcon kind={entity.kind} /> : <BookOpen aria-hidden />}
                    <span className="wf-clamp-1">{name}</span>
                    {truth && (
                      <span
                        className="wf-faden-handle"
                        title="Schnur ziehen: auf einen Faden, eine Geschichte oder einen Namen"
                        onPointerDown={startLink(entry.key)}
                      />
                    )}
                  </button>
                );
              })}
              {open.map((card) => (
                <Card
                  key={card.key}
                  card={card}
                  at={layout.cards[card.key]!}
                  selected={card.key === selected || picked.has(card.key)}
                  dim={related !== null && !related.has(card.key)}
                  drop={card.key === dropOn}
                  lifted={moving !== null && moving[card.key] !== undefined}
                  onGrab={grab(card.key, layout.cards[card.key]!)}
                  onLink={truth ? startLink(card.key) : undefined}
                />
              ))}
            </div>
            {open.length === 0 && (
              <p className="wf-faden-wall__none">
                {truth
                  ? 'Noch liegt nichts auf dem Brett. Ein Doppelklick ins Leere schreibt einen Faden; eine Geschichte entsteht über „Geschichte“ oben.'
                  : 'Von dem, was auf dem Brett liegt, kennt die Gruppe noch nichts.'}
              </p>
            )}
            {truth && (
              <BoardSearch
                pins={layout.pins}
                onPick={(key) => {
                  const there = layout.pins.find((entry) => entry.key === key);
                  if (!there) {
                    const rect = frame.current?.getBoundingClientRect();
                    const at = rect
                      ? wall.toBoard(rect.left + rect.width / 2, rect.top + rect.height / 2)
                      : { x: 0, y: 0 };
                    placeOnBoard(db, key, at.x, at.y);
                  }
                  clearPicks();
                  setSelected(key);
                  showCard();
                }}
              />
            )}
            <div className="wf-faden-tools" onPointerDown={(event) => event.stopPropagation()}>
              <IconButton label="Größer" size="sm" onClick={() => wall.zoom(1.25)}>
                <Plus />
              </IconButton>
              <IconButton label="Kleiner" size="sm" onClick={() => wall.zoom(0.8)}>
                <Minus />
              </IconButton>
              <IconButton label="Alles zeigen" size="sm" onClick={() => showAll()}>
                <Maximize />
              </IconButton>
              <IconButton
                label="Aufräumen – Wayfarer legt alles neu aus"
                size="sm"
                disabled={Object.keys(placed).length === 0}
                onClick={tidy}
              >
                <LayoutGrid />
              </IconButton>
            </div>
            <div
              className="wf-faden-shelf"
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {view === 'truth' && orphans.length > 0 && (
                <details className="wf-faden-closed">
                  <summary title="Uhren aus der Zeit, als sie im Kalender angelegt wurden">
                    Uhren ohne Geschichte · {orphans.length}
                  </summary>
                  {orphans.map((clock) => (
                    <button
                      key={clock.id}
                      type="button"
                      className="wf-faden-closed__row"
                      title="Eine Geschichte daraus machen und ihr Blatt öffnen"
                      onClick={() => {
                        const story = storyFromClock(db, clock.id);
                        if (story) navigate(`/geschichte/${story.id}`);
                      }}
                    >
                      {clock.title}
                      <span>Geschichte daraus machen</span>
                    </button>
                  ))}
                </details>
              )}
              {closed.length > 0 && (
                <details className="wf-faden-closed">
                  <summary>Abgeschlossen · {closed.length}</summary>
                  {closed.map((card) => (
                    <button
                      key={card.key}
                      type="button"
                      className="wf-faden-closed__row"
                      onClick={() => select(card.key)}
                    >
                      {card.title}
                      <span>
                        {card.story ? 'Geschichte' : THREAD_STATE_LABEL[card.threads[0]!.state]}
                      </span>
                    </button>
                  ))}
                </details>
              )}
            </div>
          </div>
          <div className="wf-faden-sidecol">
            <div className="wf-btn-group wf-faden-sidetabs" role="group" aria-label="Seitenteil">
              <Button
                size="sm"
                aria-pressed={side === 'card'}
                title="Alles zur gewählten Karte des Bretts"
                onClick={showCard}
              >
                Gewählte Karte
              </Button>
              <Button
                size="sm"
                aria-pressed={side === 'loose'}
                title="Fäden, die zu keiner Geschichte gehören – zum Aufräumen und Verbinden"
                onClick={() => setSide('loose')}
              >
                Lose Fäden · {looseCount}
              </Button>
            </div>
            {side === 'loose' ? (
              <LooseDrawer
                rows={loose}
                twins={twins}
                view={view}
                focusId={looseFocus}
                query={looseQuery}
                onQuery={setLooseQuery}
                picked={loosePicked}
                onPicked={setLoosePicked}
                onEdit={(thread) => setDialog({ type: 'thread', thread, storyId: thread.storyId })}
                onShow={setArriving}
              />
            ) : picked.size > 1 ? (
              <PickedSide
                count={picked.size}
                loose={
                  [...picked].filter((key) => {
                    const thread = key.startsWith('thread:')
                      ? data.threads[key.slice(7)]
                      : undefined;
                    return thread !== undefined && isLooseThread(data, thread) && !thread.inPlay;
                  }).length
                }
                onTakeOff={() => takeOff([...picked])}
                onClear={clearPicks}
              />
            ) : pin ? (
              <PinSide
                pin={pin}
                cards={cards}
                onSelect={select}
                onTakeOff={() => takeOff([pin.key])}
              />
            ) : knot ? (
              <KnotSide knot={knot} view={view} onSelect={select} />
            ) : (
              <Side
                card={current}
                view={view}
                links={links}
                cards={cards}
                onSelect={select}
                onEdit={setDialog}
              />
            )}
          </div>
        </div>
      )}

      {dialog?.type === 'thread' && (
        <ThreadDialog
          thread={dialog.thread}
          storyId={dialog.storyId}
          onClose={() => setDialog(null)}
          onSaved={(thread) => {
            setDialog(null);
            // Ein loser Faden steht in der Liste – dort wird er gezeigt, wenn er nicht auf dem
            // Brett liegt.
            if (thread.storyId) select(`story:${thread.storyId}`);
            else if (thread.inPlay || thread.onBoard) select(`thread:${thread.id}`);
            else showLoose(thread.id);
          }}
        />
      )}
      {relating && (
        <RelationQuick
          self={relating.self}
          otherId={relating.otherId}
          onClose={() => setRelating(null)}
        />
      )}
      {dialog?.type === 'attach' && (
        <AttachDialog
          ids={dialog.ids}
          onClose={() => setDialog(null)}
          onDone={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'clock' && (
        <ClockDialog
          key={dialog.clock?.id ?? 'neu'}
          clock={dialog.clock}
          onClose={() => {
            // Eine Uhr, die in diesem Fenster entstanden ist, gehört zur Geschichte.
            const now = db.getSnapshot();
            const fresh = Object.keys(now.clocks).filter((id) => !dialog.before.has(id));
            if (fresh.length === 1 && now.stories[dialog.storyId])
              db.patch('stories', dialog.storyId, { clockId: fresh[0]! });
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

/** Eine Karte auf dem Brett: das Wichtigste auf einen Blick – alles Weitere steht im Seitenteil. */
function Card({
  card,
  at,
  selected,
  dim,
  drop,
  lifted,
  onGrab,
  onLink,
}: {
  card: BoardCard;
  at: Spot;
  selected: boolean;
  dim: boolean;
  /** Ein loser Faden wird gerade auf diese Geschichte gezogen. */
  drop: boolean;
  /** Die Karte wird gerade gezogen: Sie liegt über allen anderen. */
  lifted: boolean;
  onGrab: (event: PointerEvent) => void;
  /** Eine Schnur von dieser Karte ziehen (nur in der Sicht „Wahrheit“). */
  onLink?: ((event: PointerEvent) => void) | undefined;
}) {
  const data = useData();
  const now = data.state.now;
  const owner = card.story?.ownerId ? data.entities[card.story.ownerId] : undefined;
  const repute = owner ? reputeOf(data, owner.id).party : null;
  const lone = card.story ? null : card.threads[0]!;
  const live = card.threads.filter(threadLive);
  const warnings = card.threads.filter((thread) => threadWarning(thread)).length;
  const found = lone ? lone.hints.filter((hint) => hint.found).length : 0;
  return (
    <button
      type="button"
      className={cx('wf-faden-card', !card.story && 'wf-faden-card--thread')}
      style={{ left: at.x, top: at.y }}
      data-card={card.key}
      data-near={card.nearness}
      data-dim={dim}
      data-drop={drop}
      data-lifted={lifted}
      aria-pressed={selected}
      onPointerDown={onGrab}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="wf-faden-card__top">
        <span className="wf-faden-card__sort">
          {card.story ? 'Geschichte' : 'Loser Faden'} · {NEARNESS_LABEL[card.nearness]}
        </span>
        {card.story ? (
          card.pace !== 'none' && (
            <span className={`wf-faden-pace wf-faden-pace--${card.pace}`}>
              {PACE_LABEL[card.pace]}
            </span>
          )
        ) : (
          <span className={`wf-faden-state wf-faden-state--${lone!.state}`}>
            {THREAD_STATE_LABEL[lone!.state]}
          </span>
        )}
      </span>
      <span className="wf-faden-card__title wf-clamp-2">{card.title}</span>
      {card.partOf && (
        <span className="wf-faden-card__part wf-clamp-1">Teil von {card.partOf.title}</span>
      )}
      {owner && (
        <span className="wf-faden-card__owner">
          <span className="wf-clamp-1">Treibt an: {owner.name}</span>
          {repute !== null && (
            <span className="wf-faden-card__repute" title={`Ruf der Gruppe bei ${owner.name}`}>
              <AttitudeBadge value={repute} />
            </span>
          )}
        </span>
      )}
      {card.clock && (
        <span className="wf-faden-clock">
          <span className="wf-faden-clock__pips" aria-hidden>
            {card.clock.steps.map((step) => (
              <i key={step.step.id} data-state={step.state} />
            ))}
          </span>
          <span className="wf-faden-clock__next wf-clamp-2">
            {card.clock.next
              ? `${card.clock.paused ? 'Angehalten vor' : upper(untilText(card.clock.next.at - now))}: ${card.clock.next.step.text}`
              : 'Alles ist geschehen.'}
          </span>
        </span>
      )}
      {card.story && live.length > 0 && (
        <span className="wf-faden-card__owner">
          {live.length === 1 ? '1 Faden' : `${live.length} Fäden`}
          {warnings > 0 && (
            <>
              <TriangleAlert aria-hidden />
              {warnings === 1 ? '1 Warnung' : `${warnings} Warnungen`}
            </>
          )}
        </span>
      )}
      {lone && lone.hints.length > 0 && (
        <span className="wf-faden-card__owner">
          {found} von {lone.hints.length} Hinweisen gefunden
          {threadWarning(lone) && <TriangleAlert aria-label="Warnung" />}
        </span>
      )}
      {onLink && (
        <span
          className="wf-faden-handle wf-faden-handle--card"
          title="Schnur ziehen: auf einen Faden, eine Geschichte oder einen Namen"
          onPointerDown={onLink}
        />
      )}
    </button>
  );
}

/** Ein Faden als Knoten an seiner Geschichte: Kreis, Satz, Griff für eine Schnur. */
function Knot({
  knot,
  at,
  selected,
  dim,
  onGrab,
  onLink,
}: {
  knot: BoardKnot;
  at: Spot;
  selected: boolean;
  dim: boolean;
  onGrab: (event: PointerEvent) => void;
  onLink?: ((event: PointerEvent) => void) | undefined;
}) {
  const thread = knot.thread;
  const open = thread.hints.filter((hint) => !hint.found).length;
  return (
    <button
      type="button"
      className="wf-faden-knot"
      style={{ left: at.x, top: at.y }}
      data-state={thread.state}
      data-dim={dim}
      aria-pressed={selected}
      title={`${thread.title} – ${THREAD_STATE_LABEL[thread.state]}${
        thread.hints.length ? `, ${open} von ${thread.hints.length} Hinweisen offen` : ''
      }`}
      onPointerDown={onGrab}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <i aria-hidden />
      <span className="wf-clamp-1">{thread.title}</span>
      {onLink && (
        <span
          className="wf-faden-handle"
          title="Schnur ziehen: auf einen anderen Faden oder einen Namen"
          onPointerDown={onLink}
        />
      )}
    </button>
  );
}

/** Das Wort einer Verbindung, mitten auf der Schnur. */
function WebWord({ line, at, dim }: { line: WebString; at: Spot; dim: boolean }) {
  return (
    <span
      className="wf-faden-webword"
      data-web={line.kind}
      data-dim={dim}
      style={{ left: at.x, top: at.y }}
    >
      {line.kind === 'lead' ? `Hinweis: ${line.word}` : line.word}
    </span>
  );
}

/** Der Seitenteil zu einem Faden als Knoten: was er fragt, seine Hinweise, sein Netz. */
function KnotSide({
  knot,
  view,
  onSelect,
}: {
  knot: BoardKnot;
  view: BoardView;
  onSelect: (key: string) => void;
}) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const truth = view === 'truth';
  const thread = data.threads[knot.thread.id];
  if (!thread) return null;
  const shown = truth ? thread : knot.thread;
  const story = thread.storyId ? data.stories[thread.storyId] : undefined;
  return (
    <aside className="wf-faden-side">
      <div className="wf-faden-side__head">
        <span className="wf-faden-card__sort">Faden · {THREAD_STATE_LABEL[thread.state]}</span>
        {truth && story && (
          <Button
            size="sm"
            icon={<Pencil />}
            onClick={() => navigate(`/geschichte/${story.id}`)}
            title="Auf dem Blatt der Geschichte schreiben"
          >
            Schreiben
          </Button>
        )}
      </div>
      <h2 className="wf-faden-side__title">{thread.title}</h2>
      {story && (
        <p>
          <span className="wf-mute">Gehört zu:</span>{' '}
          <button type="button" className="wf-faden-link" onClick={() => onSelect(knot.cardKey)}>
            {story.title}
          </button>
        </p>
      )}
      {truth && (
        <Select
          value={thread.state}
          aria-label="Zustand des Fadens"
          onChange={(event) => setThreadState(db, thread.id, event.target.value as ThreadState)}
        >
          {THREAD_STATES.map((state) => (
            <option key={state} value={state}>
              {THREAD_STATE_LABEL[state]}
            </option>
          ))}
        </Select>
      )}
      {truth && thread.truth && <p className="wf-faden-block__truth">{thread.truth}</p>}
      <section>
        <h3 className="wf-faden-side__sub">Hinweise</h3>
        {shown.hints.length === 0 && <p className="wf-mute">Noch keine Hinweise eingetragen.</p>}
        {shown.hints.map((hint) => {
          const target = hint.leadsTo ? data.threads[hint.leadsTo] : undefined;
          return (
            <div key={hint.id} className="wf-faden-hint" data-found={hint.found}>
              {truth ? (
                <Checkbox
                  checked={hint.found}
                  onChange={(found) => findHint(db, thread.id, hint.id, found)}
                >
                  {hint.text}
                </Checkbox>
              ) : (
                <span>{hint.text}</span>
              )}
              {target && <span className="wf-faden-hint__where">führt zu „{target.title}“</span>}
            </div>
          );
        })}
      </section>
      {truth && (
        <section>
          <ThreadWeb thread={thread} />
        </section>
      )}
      <p className="wf-mute">
        Am Griff rechts ziehst du eine Schnur: auf einen anderen Faden, eine Person, einen Ort.
      </p>
    </aside>
  );
}

/**
 * Der Seitenteil zu einem Namen oder Artikel auf dem Brett: was er ist, der Anfang seines Textes,
 * welche Karten an ihm hängen – oder dass er frei liegt.
 */
function PinSide({
  pin,
  cards,
  onSelect,
  onTakeOff,
}: {
  pin: BoardPin;
  cards: BoardCard[];
  onSelect: (key: string) => void;
  onTakeOff: () => void;
}) {
  const data = useData();
  const [, navigate] = useLocation();
  const entity = pin.article ? undefined : data.entities[pin.id];
  const article = pin.article
    ? data.articles[pin.id]
    : entity?.lk
      ? data.articles[entity.lk.resourceId]
      : undefined;
  const name = entity?.name ?? article?.title;
  if (!name) return null;
  const excerpt = article ? articleExcerpt(data.articles, article) : null;
  const hanging = pin.cards
    .map((key) => cards.find((card) => card.key === key))
    .filter((card): card is BoardCard => !!card);
  const href = entity ? entityHref(entity) : article ? `/wiki/${article.id}` : null;
  return (
    <aside className="wf-faden-side">
      <div className="wf-faden-side__head">
        <span className="wf-faden-card__sort">
          {pin.article ? 'Artikel' : 'Name'} ·{' '}
          {hanging.length > 1
            ? 'hier berühren sich Geschichten'
            : hanging.length === 1
              ? 'hängt an einer Karte'
              : 'liegt frei'}
        </span>
        {href && (
          <Button size="sm" onClick={() => navigate(href)}>
            {pin.article ? 'Artikel öffnen' : 'Seite öffnen'}
          </Button>
        )}
      </div>
      <h2 className="wf-faden-side__title">{name}</h2>
      {entity?.tagline && <p className="wf-prose">{entity.tagline}</p>}
      {excerpt && excerpt.paragraphs.length > 0 && (
        <section className="wf-faden-side__text">
          {excerpt.paragraphs.map((text, index) => (
            <p key={index} className="wf-prose">
              {text}
            </p>
          ))}
          {excerpt.more && href && (
            <button type="button" className="wf-faden-link" onClick={() => navigate(href)}>
              Weiterlesen …
            </button>
          )}
        </section>
      )}
      {hanging.length > 0 ? (
        <section>
          <h3 className="wf-faden-side__sub">
            {pin.article ? 'Gehört zu' : 'Karten an diesem Namen'}
          </h3>
          {hanging.map((card) => (
            <button
              key={card.key}
              type="button"
              className="wf-faden-touchrow"
              onClick={() => onSelect(card.key)}
            >
              <span>{card.title}</span>
              <em>{card.story ? 'Geschichte' : 'Loser Faden'}</em>
            </button>
          ))}
        </section>
      ) : (
        <>
          <p className="wf-mute">
            Liegt frei auf dem Brett. Zieh am Griff eine Schnur zu einem Faden oder einer Geschichte
            – dann gehört {pin.article ? 'der Artikel' : 'der Name'} dazu.
          </p>
          <div className="wf-faden-side__acts">
            <Button size="sm" variant="ghost" onClick={onTakeOff} title="Auch mit der Löschtaste">
              Vom Brett nehmen
            </Button>
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * Das Suchfeld auf dem Brett: jeden Eintrag der Welt und jeden Artikel ohne Eintrag dazuholen.
 * Was schon daliegt, wird gewählt; das Neue liegt in der Mitte des Bildes.
 */
function BoardSearch({
  pins,
  onPick,
}: {
  pins: readonly BoardPin[];
  onPick: (key: string) => void;
}) {
  const data = useData();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const hits = useMemo(
    () =>
      searchWorld(data, query)
        .filter((hit) => hit.sort === 'entity' || hit.sort === 'article')
        .slice(0, 8),
    [data, query],
  );
  const keyOf = (hit: (typeof hits)[number]) => (hit.entity ? `node:${hit.entity.id}` : hit.key);
  const pick = (index: number) => {
    const hit = hits[index];
    if (!hit) return;
    onPick(keyOf(hit));
    setQuery('');
    setActive(0);
  };
  return (
    <div
      className="wf-faden-search"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <input
        className="wf-input"
        value={query}
        placeholder="Person, Ort, Artikel aufs Brett holen …"
        aria-label="Einen Eintrag oder Artikel aufs Brett holen"
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(hits.length - 1, index + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === 'Enter') pick(active);
          else if (event.key === 'Escape') setQuery('');
        }}
      />
      {query.trim() && (
        <div className="wf-faden-search__hits" role="listbox">
          {hits.length === 0 && <span className="wf-faden-search__none">Nichts gefunden.</span>}
          {hits.map((hit, index) => {
            const there = pins.some((entry) => entry.key === keyOf(hit));
            return (
              <button
                key={hit.key}
                type="button"
                role="option"
                aria-selected={index === active}
                className="wf-faden-search__hit"
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(index)}
              >
                {hit.entity ? <KindIcon kind={hit.entity.kind} /> : <BookOpen aria-hidden />}
                <span className="wf-clamp-1">{hit.label}</span>
                <em className="wf-clamp-1">{there ? 'liegt schon da' : hit.sub}</em>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Der Seitenteil: alles zur gewählten Karte – Uhr, Fäden mit Hinweisen, Einstiege, Berührungen. */
function Side({
  card,
  view,
  links,
  cards,
  onSelect,
  onEdit,
}: {
  card: BoardCard | null;
  view: BoardView;
  links: Touch[];
  cards: BoardCard[];
  onSelect: (key: string) => void;
  onEdit: (dialog: OpenDialog) => void;
}) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const cal = data.campaign.calendar;
  const truth = view === 'truth';

  if (!card)
    return (
      <aside className="wf-faden-side wf-faden-side--blank">
        <p>
          Wähle eine Karte: Dann stehen hier ihre Uhr, ihre Fäden mit den Hinweisen, ihre Einstiege
          und was sie berührt.
        </p>
        <p className="wf-mute">
          Fäden verbinden jede Karte mit den Personen, Orten und Fraktionen, an denen sie hängt.
          Hängen zwei Karten am selben Namen, berühren sich ihre Geschichten – der Name ist dann
          golden.
        </p>
        <p className="wf-mute">
          Karten und Namen legst du frei: einfach ziehen. Das Brett selbst ziehst du am leeren
          Grund, das Mausrad vergrößert. Ein Doppelklick ins Leere schreibt einen Faden.
        </p>
        <p className="wf-mute">
          Am Griff rechts an jedem Stück ziehst du eine Schnur. Eine Schnur klickst du an, um ihr
          Wort zu ändern oder sie zu lösen. Mit gedrückter Umschalttaste wählst du mehrere (Klick
          oder Rahmen) und ziehst sie gemeinsam; die Löschtaste nimmt lose Fäden vom Brett.
        </p>
        <p className="wf-mute">
          Fäden ohne Geschichte stehen unter „Lose Fäden“ – von dort hängst du sie an eine
          Geschichte oder legst sie aufs Brett.
        </p>
      </aside>
    );

  const story = card.story;
  /** Der lose Faden dieser Karte – wie er gespeichert ist. */
  const lone = story ? null : (data.threads[card.threads[0]?.id ?? ''] ?? null);
  const owner = story?.ownerId ? data.entities[story.ownerId] : undefined;
  const repute = owner ? reputeOf(data, owner.id) : { party: null, members: [] };
  const link = (id: string | null | undefined) => {
    const entity = id ? data.entities[id] : undefined;
    return entity ? (
      <button type="button" className="wf-faden-link" onClick={() => navigate(entityHref(entity))}>
        {entity.name}
      </button>
    ) : null;
  };
  const touching = links
    .filter((entry) => entry.a === card.key || entry.b === card.key)
    .map((entry) => ({
      entry,
      other: cards.find((other) => other.key === (entry.a === card.key ? entry.b : entry.a)),
    }))
    .filter((row) => row.other);

  return (
    <aside className="wf-faden-side">
      <div className="wf-faden-side__head">
        <span className="wf-faden-card__sort">
          {story ? 'Geschichte' : 'Loser Faden'} · {NEARNESS_LABEL[card.nearness]}
        </span>
        {truth && story && (
          <Button
            size="sm"
            icon={<Pencil />}
            onClick={() => navigate(`/geschichte/${story.id}`)}
            title="Die Geschichte auf ihrem Blatt schreiben"
          >
            Schreiben
          </Button>
        )}
      </div>
      <h2 className="wf-faden-side__title">{card.title}</h2>
      {story?.summary && truth && <p className="wf-prose">{story.summary}</p>}
      {owner && (
        <p>
          <span className="wf-mute">Treibt an:</span> {link(owner.id)}
        </p>
      )}
      {!truth && (
        <p className="wf-faden-side__note">
          Sicht der Gruppe: nur, was sie kennt. Zum Ändern auf „Wahrheit“ wechseln.
        </p>
      )}
      {truth && lone && (
        <div className="wf-faden-side__acts">
          <Button
            size="sm"
            icon={<Link2 />}
            title="Als Frage, Hinweis oder Einstieg – oder zieh die Karte auf eine Geschichte"
            onClick={() => onEdit({ type: 'attach', ids: [lone.id] })}
          >
            An Geschichte hängen …
          </Button>
          {card.onBoard && !card.closed && (
            <Button
              size="sm"
              variant="ghost"
              disabled={lone.inPlay}
              title={
                lone.inPlay
                  ? 'Er liegt auf dem Brett, solange er im Spiel ist.'
                  : 'Er steht dann nur noch in der Liste „Lose Fäden“.'
              }
              onClick={() => {
                const undo = setThreadOnBoard(db, lone.id, false);
                if (undo)
                  toast({
                    title: 'Vom Brett genommen',
                    body: `„${lone.title}“ steht nur noch in der Liste „Lose Fäden“.`,
                    action: { label: 'Rückgängig', run: undo },
                  });
              }}
            >
              Vom Brett nehmen
            </Button>
          )}
        </div>
      )}

      {truth && story && !card.clock && (
        <section>
          <h3 className="wf-faden-side__sub">
            Wenn niemand eingreift
            <Button
              size="sm"
              icon={<Plus />}
              onClick={() =>
                onEdit({
                  type: 'clock',
                  clock: null,
                  storyId: story.id,
                  before: new Set(Object.keys(data.clocks)),
                })
              }
            >
              Uhr
            </Button>
          </h3>
          <p className="wf-mute">
            Noch keine Uhr. Sie sagt Schritt für Schritt, was geschieht, wenn die Gruppe nichts tut.
          </p>
        </section>
      )}
      {card.clock && (
        <section>
          <h3 className="wf-faden-side__sub">
            Wenn niemand eingreift
            <span className={`wf-faden-pace wf-faden-pace--${card.pace}`}>
              {PACE_LABEL[card.pace]}
            </span>
            {truth && story && (
              <Button
                size="sm"
                icon={<Pencil />}
                onClick={() =>
                  onEdit({
                    type: 'clock',
                    clock: card.clock!.clock,
                    storyId: story.id,
                    before: new Set(Object.keys(data.clocks)),
                  })
                }
              >
                Uhr
              </Button>
            )}
          </h3>
          <ol className="wf-faden-steps">
            {card.clock.steps.map((step) => (
              <li key={step.step.id} data-state={step.state}>
                <i aria-hidden />
                <span>{step.step.text}</span>
                <em>
                  {step.state === 'prevented'
                    ? 'verhindert'
                    : step.state === 'done'
                      ? formatDayMonth(cal, step.at)
                      : card.clock!.paused
                        ? 'angehalten'
                        : formatDayMonth(cal, step.at)}
                </em>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <h3 className="wf-faden-side__sub">
          {story ? 'Fäden' : 'Der Faden'}
          {story && card.threads.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon={story.unfolded ? <ChevronsDownUp /> : <ChevronsUpDown />}
              aria-pressed={story.unfolded}
              title={
                story.unfolded
                  ? 'Nur die Fäden, die mit anderen verbunden sind, bleiben als Knoten auf dem Brett'
                  : 'Alle Fäden als Knoten an der Karte – zum Verbinden Faden für Faden'
              }
              onClick={() => setStoryUnfolded(db, story.id, !story.unfolded)}
            >
              {story.unfolded ? 'Einklappen' : 'Aufs Brett'}
            </Button>
          )}
          {truth && story && (
            <Button
              size="sm"
              icon={<Plus />}
              onClick={() => onEdit({ type: 'thread', thread: null, storyId: story.id })}
            >
              Faden
            </Button>
          )}
        </h3>
        {card.threads.length === 0 && (
          <p className="wf-mute">
            Noch kein Faden. Ein Faden ist eine Frage, die diese Geschichte stellt.
          </p>
        )}
        {card.threads.map((thread) => {
          const warning = truth ? threadWarning(thread) : null;
          const stored = data.threads[thread.id] ?? thread;
          return (
            <div key={thread.id} className={`wf-faden-block wf-faden-thread--${thread.state}`}>
              <div className="wf-faden-block__head">
                <i aria-hidden />
                <span className="wf-faden-block__title">{thread.title}</span>
                {truth && (
                  <button
                    type="button"
                    className="wf-faden-link"
                    onClick={() =>
                      onEdit({ type: 'thread', thread: stored, storyId: stored.storyId })
                    }
                  >
                    Ändern
                  </button>
                )}
              </div>
              <div className="wf-faden-block__meta">
                {truth ? (
                  <Select
                    value={thread.state}
                    aria-label="Zustand des Fadens"
                    onChange={(event) =>
                      setThreadState(db, thread.id, event.target.value as ThreadState)
                    }
                  >
                    {THREAD_STATES.map((state) => (
                      <option key={state} value={state}>
                        {THREAD_STATE_LABEL[state]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span>{THREAD_STATE_LABEL[thread.state]}</span>
                )}
                {truth && !thread.known && <span>Die Gruppe kennt ihn nicht</span>}
              </div>
              {thread.truth && <p className="wf-faden-block__truth">{thread.truth}</p>}
              {warning && (
                <p className="wf-faden-block__warn">
                  <TriangleAlert aria-hidden /> {warning}
                </p>
              )}
              {thread.hints.map((hint) => (
                <div key={hint.id} className="wf-faden-hint" data-found={hint.found}>
                  {truth ? (
                    <Checkbox
                      checked={hint.found}
                      onChange={(found) => findHint(db, thread.id, hint.id, found)}
                    >
                      {hint.text}
                    </Checkbox>
                  ) : (
                    <span>{hint.text}</span>
                  )}
                  {(hint.placeId || hint.sourceId) && (
                    <span className="wf-faden-hint__where">
                      {hint.placeId && <>in {link(hint.placeId)}</>}
                      {hint.placeId && hint.sourceId && ' · '}
                      {hint.sourceId && <>weiß {link(hint.sourceId)}</>}
                      {hint.placeId && isNear(data, hint.placeId) && !hint.found && (
                        <b> – liegt hier bereit</b>
                      )}
                    </span>
                  )}
                </div>
              ))}
              {truth && thread.hints.length === 0 && threadLive(thread) && !warning && (
                <p className="wf-mute">Noch keine Hinweise eingetragen.</p>
              )}
              {truth && lone && <ThreadWeb thread={stored} />}
            </div>
          );
        })}
      </section>

      {truth && owner && (
        <section>
          <h3 className="wf-faden-side__sub">
            Ruf · {owner.name}
            <Button size="sm" onClick={() => openAttitude({ fromId: owner.id })}>
              {repute.party === null ? 'Festlegen' : 'Ändern'}
            </Button>
          </h3>
          <div className="wf-faden-repute">
            <span>Die Gruppe</span>
            {repute.party === null ? (
              <em>noch nicht festgelegt</em>
            ) : (
              <AttitudeBadge value={repute.party} />
            )}
          </div>
          {repute.members.map((member) => (
            <div key={member.id} className="wf-faden-repute">
              <span>{member.name}</span>
              <AttitudeBadge value={member.value} />
            </div>
          ))}
          <p className="wf-mute">
            Der Ruf ändert nicht die Geschichte – nur, wie die Gruppe hineinkommt.
          </p>
        </section>
      )}

      {truth && story && story.entries.length > 0 && (
        <section>
          <h3 className="wf-faden-side__sub">Einstiege</h3>
          {story.entries.map((entry) => {
            const fit = entryFit(data, story, entry);
            return (
              <div key={entry.id} className="wf-faden-hint" data-found={!fit.fits}>
                <span>{entry.text}</span>
                <span className="wf-faden-hint__where wf-faden-hint__where--flat">
                  {entry.placeId && <>in {link(entry.placeId)}</>}
                  {entry.placeId && isNear(data, entry.placeId) && <b> – die Gruppe ist hier</b>}
                  {entry.standing !== 'any' && (
                    <>
                      {entry.placeId && ' · '}
                      {ENTRY_STANDING_LABEL[entry.standing]}: {fit.note}
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </section>
      )}

      {touching.length > 0 && (
        <section>
          <h3 className="wf-faden-side__sub">Berührt</h3>
          {touching.map(({ entry, other }) => (
            <button
              key={other!.key}
              type="button"
              className="wf-faden-touchrow"
              onClick={() => onSelect(other!.key)}
            >
              <span>{other!.title}</span>
              <em>{touchReason(data, entry)}</em>
            </button>
          ))}
        </section>
      )}

      {(card.nodes.length > 0 || truth) && (
        <section>
          <h3 className="wf-faden-side__sub">Hängt an</h3>
          <div className="wf-faden-card__nodes">
            {card.nodes.map((id) => (
              <span key={id} className="wf-faden-node">
                {link(id)}
              </span>
            ))}
            {card.articles.map((id) => (
              <span key={id} className="wf-faden-node">
                <button
                  type="button"
                  className="wf-faden-link"
                  onClick={() => navigate(`/wiki/${id}`)}
                >
                  {data.articles[id]?.title ?? ''}
                </button>
              </span>
            ))}
          </div>
          {truth && (
            <EntityPicker
              value={null}
              onChange={(id) => {
                if (id) pinToCard(db, card.key, id);
              }}
              kinds={['person', 'place', 'faction', 'family', 'item']}
              exclude={card.nodes}
              placeholder="Person, Ort oder Fraktion anheften …"
              create={{ storyId: card.story?.id ?? null }}
            />
          )}
        </section>
      )}
    </aside>
  );
}

/** Die gewählte Schnur: zu einem Namen, von einer Geschichte zu ihrem Faden, zwischen Fäden. */
type ChosenLine =
  | { kind: 'name'; at: Spot; owner: string; entityId: string; article: boolean }
  | { kind: 'knot'; at: Spot; knot: BoardKnot }
  | { kind: 'web'; at: Spot; line: WebString };

/** Das kleine Menü an einer gewählten Schnur: was sie verbindet, ihr Wort, lösen. */
function LineMenu({
  line,
  pinned,
  ownerTitle,
  onRelease,
  onClose,
}: {
  line: ChosenLine;
  /** Bei einem Namen: Er ist angeheftet (und nicht über Hinweis, Uhr oder Szene da). */
  pinned: boolean;
  ownerTitle: string;
  onRelease: () => void;
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const title = (id: string) => data.threads[id]?.title ?? '';
  let what: string;
  let release: string | null = 'Lösen';
  let note = '';
  if (line.kind === 'web' && line.line.kind === 'tie') {
    what = `„${title(line.line.from)}“ – „${title(line.line.to)}“`;
  } else if (line.kind === 'web') {
    what = `Hinweis „${line.line.word}“ führt zu „${title(line.line.to)}“`;
  } else if (line.kind === 'knot') {
    what = `„${line.knot.thread.title}“ gehört zu „${data.stories[line.knot.cardKey.slice(6)]?.title ?? ''}“`;
    release = 'Von der Geschichte lösen';
  } else {
    what = line.article
      ? `„${data.articles[line.entityId]?.title ?? ''}“ gehört zu „${ownerTitle}“`
      : `${data.entities[line.entityId]?.name ?? ''} an „${ownerTitle}“`;
    if (!pinned) {
      release = null;
      note = 'Hängt über einen Hinweis, eine Szene, die Uhr oder die Beteiligten – dort lösen.';
    }
  }
  return (
    <div
      className="wf-faden-linemenu"
      style={{ left: line.at.x, top: line.at.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="wf-faden-linemenu__what">{what}</span>
      {line.kind === 'web' && line.line.kind === 'tie' && (
        <Written
          className="wf-faden-linemenu__word"
          label="Was sie verbindet"
          wrap
          value={line.line.word}
          placeholder="was sie verbindet …"
          onSave={(word) => setTieWord(db, line.line.from, line.line.to, word)}
        />
      )}
      {note && <span className="wf-faden-linemenu__note">{note}</span>}
      <span className="wf-faden-linemenu__acts">
        {release && (
          <Button size="sm" onClick={onRelease} title="Auch mit der Löschtaste">
            {release}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Schließen
        </Button>
      </span>
    </div>
  );
}

/** Ein Faden, gleich auf dem Brett geschrieben: Eingabetaste legt ihn hin, Escape verwirft. */
function BoardDraft({
  at,
  onDone,
  onCancel,
}: {
  at: Spot;
  onDone: (title: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  useHoldDraft(text.trim() !== '', 'fadenbrett-faden');
  return (
    <div
      className="wf-faden-draft"
      style={{ left: at.x, top: at.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="wf-faden-card__sort">Neuer Faden</span>
      <input
        // Der Doppelklick hat den Platz gewählt: Hier wird jetzt geschrieben.
        autoFocus
        className="wf-input"
        value={text}
        placeholder="Eine Frage, eine Spur, ein Gedanke …"
        aria-label="Neuer Faden auf dem Brett"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onDone(text);
          if (event.key === 'Escape') onCancel();
        }}
        onBlur={() => (text.trim() ? onDone(text) : onCancel())}
      />
      <span className="wf-faden-draft__hint">Eingabetaste legt ihn hin · Escape verwirft</span>
    </div>
  );
}

/** Der Seitenteil, wenn mehrere Stücke gewählt sind. */
function PickedSide({
  count,
  loose,
  onTakeOff,
  onClear,
}: {
  count: number;
  loose: number;
  onTakeOff: () => void;
  onClear: () => void;
}) {
  return (
    <aside className="wf-faden-side">
      <div className="wf-faden-side__head">
        <span className="wf-faden-card__sort">Auswahl</span>
      </div>
      <h2 className="wf-faden-side__title">{count} gewählt</h2>
      <p className="wf-mute">
        Zieh eines davon – die anderen ziehen mit. Umschalt-Klick nimmt eines dazu oder heraus.
      </p>
      <div className="wf-faden-side__acts">
        {loose > 0 && (
          <Button size="sm" onClick={onTakeOff} title="Auch mit der Löschtaste">
            {loose === 1 ? 'Losen Faden vom Brett nehmen' : `${loose} lose Fäden vom Brett nehmen`}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClear}>
          Auswahl aufheben
        </Button>
      </div>
    </aside>
  );
}
