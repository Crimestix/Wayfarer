/**
 * „@“ im Text: Tippt der Spielleiter in einem Schreibfeld „@“, klappt darunter dieselbe Auswahl
 * auf wie überall – Treffer, dann „neu als …“. Der gewählte Name steht danach als gewöhnlicher
 * Text da (kein Sonderzeichen bleibt), und das Feld meldet den Eintrag, damit das Blatt ihn zu
 * den Beteiligten nehmen kann. Genutzt von der Mitschrift am Spieltisch und von `Written`.
 * Die Regeln stehen in `domain/mention.ts` und `domain/pick.ts`.
 */
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useData } from '../data/hooks';
import { searchEntities } from '../domain/derive';
import { activeMention, insertMention, type MentionRange } from '../domain/mention';
import { mentionMark, moveMark, pickRows, rowAction, type EnterAction } from '../domain/pick';
import type { CampaignData, Entity, EntityKind } from '../domain/schema';
import { Popover, cx } from './components';
import { CreateForm, useWriting, type WriteRequest } from './create';
import { PickList } from './entity';

/** So viele Treffer zeigt das „@“ – es soll das Schreiben nicht verdecken. */
const MENTION_HITS = 7;
const MENTION_WIDTH = 340;

export interface MentionOptions {
  /** Die Geschichte, an der geschrieben wird – sie steht dann an einem neuen Platzhalter. */
  storyId?: string | null | undefined;
  /** Ein Eintrag wurde über „@“ gewählt oder angelegt. */
  onMention?: ((entityId: string) => void) | undefined;
  /** Die Arten, die „neu als …“ zuerst anbietet. */
  kinds?: readonly EntityKind[] | undefined;
  /** Wer ohne Suchwort zuerst dasteht – etwa, wer schon zum Blatt gehört. */
  near?: readonly string[] | undefined;
}

type Field = HTMLInputElement | HTMLTextAreaElement;

export interface MentionControl {
  /** Die Auswahl ist offen. */
  open: boolean;
  /** Nach jeder Eingabe (`typed`) und jeder Bewegung der Schreibmarke aufrufen. */
  track: (field: Field, typed?: boolean) => void;
  /** Tasten des Feldes zuerst hierhin; `true` heißt: Die Auswahl hat die Taste genommen. */
  onKeyDown: (event: KeyboardEvent<Field>) => boolean;
  /** Liegt dieses Element in der aufgeklappten Auswahl? (Dann hat das Feld den Fokus nur geliehen.) */
  contains: (node: Node | null) => boolean;
  /** Die aufgeklappte Auswahl – neben das Feld setzen. */
  menu: ReactNode;
}

/**
 * Hängt das „@“ an ein Schreibfeld. Das Feld behält seinen Text selbst (`text`, `setText`); hier
 * wird nur vorgeschlagen und der Name eingesetzt. Mit `options = null` ist es aus.
 */
export function useMention({
  field,
  anchor,
  text,
  setText,
  options,
  suggest,
  create = true,
  onPick,
  onClose,
  header,
  className,
}: {
  field: RefObject<Field | null>;
  /** Woran die Auswahl hängt; Vorgabe: das Feld. */
  anchor?: RefObject<HTMLElement | null> | undefined;
  text: string;
  setText: (text: string) => void;
  options: MentionOptions | null | undefined;
  /** Eigene Treffer statt der Suche – am Spieltisch zuerst, wer am Ort ist. */
  suggest?: ((data: CampaignData, query: string) => Entity[]) | undefined;
  /** „neu als …“ anbieten (Vorgabe: ja). */
  create?: boolean | undefined;
  onPick?: ((entity: Entity) => void) | undefined;
  /** Die Auswahl wurde weggeklickt. */
  onClose?: (() => void) | undefined;
  /** Die Zeile über den Treffern. */
  header?: ((query: string) => string) | undefined;
  className?: string | undefined;
}): MentionControl {
  const data = useData();
  const write = useWriting();
  const box = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  /** Position des „@“, dessen Vorschläge weggeklickt wurden. */
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [marked, setMarked] = useState<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  /** Das kleine Formular zum Anlegen ist offen – mit dieser Art, für diese Stelle. */
  const [form, setForm] = useState<{ kind: EntityKind; range: MentionRange } | null>(null);
  /** Wohin die Schreibmarke nach dem Einsetzen eines Namens springt. */
  const pendingCaret = useRef<number | null>(null);

  const enabled = options !== null && options !== undefined;
  const found = useMemo(
    () => (enabled ? activeMention(text, caret) : null),
    [enabled, text, caret],
  );
  const range = found && found.start !== dismissed ? found : null;
  const query = range?.query ?? '';
  const near = options?.near;
  const rows = useMemo(() => {
    if (!range) return [];
    const hits = suggest
      ? suggest(data, range.query)
      : range.query.trim()
        ? searchEntities(data, range.query, { limit: MENTION_HITS })
        : (near ?? [])
            .map((id) => data.entities[id])
            .filter((entity): entity is Entity => entity !== undefined)
            .slice(0, MENTION_HITS);
    return pickRows(data, {
      query: range.query,
      kinds: options?.kinds,
      hits,
      create: create && range.query.trim() !== '',
      moreOpen,
    });
  }, [data, range, suggest, near, options?.kinds, create, moreOpen]);
  const open = range !== null || form !== null;
  const active = mentionMark(rows, marked);

  useLayoutEffect(() => {
    const el = field.current;
    if (!el || pendingCaret.current === null) return;
    el.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [text, field]);

  const reset = () => {
    setMarked(null);
    setMoreOpen(false);
    setForm(null);
  };
  const insert = (entity: Entity, at: MentionRange) => {
    const next = insertMention(text, at, entity.name);
    pendingCaret.current = next.caret;
    setText(next.text);
    setCaret(next.caret);
    reset();
    field.current?.focus();
    options?.onMention?.(entity.id);
    onPick?.(entity);
  };
  const act = (action: EnterAction) => {
    if (!range) return;
    if (action.type === 'pick') {
      const entity = data.entities[action.id];
      if (entity) insert(entity, range);
    } else if (action.type === 'create') setForm({ kind: action.kind, range });
    else if (action.type === 'more') setMoreOpen((before) => !before);
  };
  const submit = (request: WriteRequest) => {
    if (!form) return;
    const outcome = write(request, { storyId: options?.storyId });
    if (outcome) insert(outcome.entity, form.range);
  };
  const close = () => {
    const hadForm = form !== null;
    setDismissed(found?.start ?? null);
    reset();
    // Aus dem Formular zurück an die Schreibstelle.
    if (hadForm) field.current?.focus();
    onClose?.();
  };

  const menu = (
    <Popover
      open={open}
      onClose={close}
      anchor={anchor ?? field}
      // So breit wie das Feld, aber nie schmaler als eine Auswahl.
      width={Math.max(MENTION_WIDTH, (anchor ?? field).current?.offsetWidth ?? 0)}
      className={cx('wf-mention', className)}
    >
      <div ref={box}>
        {form ? (
          <CreateForm
            name={form.range.query.replace(/\s+/g, ' ').trim()}
            kind={form.kind}
            kinds={options?.kinds}
            onSubmit={submit}
            onBack={() => {
              setForm(null);
              field.current?.focus();
            }}
          />
        ) : (
          // Die Schreibmarke bleibt im Feld, auch wenn man eine Zeile anklickt.
          <div role="listbox" aria-label="Vorschläge" onMouseDown={(e) => e.preventDefault()}>
            <div className="wf-mention__head">
              {!query.trim()
                ? header
                  ? header(query)
                  : 'Namen tippen – oder einen neuen anlegen'
                : rows.some((row) => row.type === 'entity')
                  ? header
                    ? header(query)
                    : 'Verknüpfen mit'
                  : 'Noch nicht in der Welt'}
            </div>
            <PickList rows={rows} marked={active} name={query.trim()} detail onAct={act} />
          </div>
        )}
      </div>
    </Popover>
  );

  return {
    open,
    track: (el, typed = false) => {
      setCaret(el.selectionStart ?? el.value.length);
      if (!typed) return;
      setMarked(null);
      setMoreOpen(false);
      setDismissed((at) => (at !== null && el.value[at] === '@' ? at : null));
    },
    onKeyDown: (event) => {
      if (!range || form || event.nativeEvent.isComposing) return false;
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && rows.length) {
        event.preventDefault();
        setMarked(moveMark(rows, active, event.key === 'ArrowDown' ? 1 : -1));
        return true;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && active !== null) {
        event.preventDefault();
        act(rowAction(rows[active]));
        return true;
      }
      return false;
    },
    contains: (node) => !!node && !!box.current?.contains(node),
    menu,
  };
}
