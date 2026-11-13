/**
 * Ein Entwurf von nahem: Nummer, Titel, Spielabend und Weltzeit richten, mit der nächsten
 * zusammenlegen oder an einer Zeile trennen. Die Notizen stehen darunter, wie sie geschrieben sind.
 */
import { useState } from 'react';
import { CalendarClock, Merge, RotateCcw, Scissors, X } from 'lucide-react';
import { useData } from '../../data/hooks';
import { MINUTES_PER_DAY } from '../../domain/time/calendar';
import { parseRealDate, realDateInput, timeDraftOf, timeOfDraft } from '../chronik/model';
import { WorldTimeFields } from '../chronik/WorldTimeFields';
import {
  Button,
  Field,
  IconButton,
  Input,
  Panel,
  SectionTitle,
  Written,
  cx,
  toast,
} from '../../ui';
import { draftLines, placedTime, type DraftChange, type TakeOverItem } from './model';
import type { PlacedSession } from './order';

function NumberField({
  value,
  onSave,
}: {
  value: number | null;
  onSave: (n: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const commit = () => {
    const raw = text.trim();
    if (!raw) {
      if (value !== null) onSave(null);
      return;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      setText(value === null ? '' : String(value));
      toast({
        title: 'Keine Nummer',
        body: 'Die Nummer ist eine ganze Zahl, zum Beispiel 5.',
        tone: 'danger',
      });
      return;
    }
    if (n !== value) onSave(n);
  };
  return (
    <Input
      inputMode="numeric"
      aria-label="Nummer der Session"
      value={text}
      placeholder="?"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

function RealDateInput({ value, onSave }: { value: string; onSave: (iso: string) => void }) {
  const [text, setText] = useState(realDateInput(value));
  const commit = () => {
    const parsed = parseRealDate(text);
    if (parsed === null) {
      setText(realDateInput(value));
      toast({
        title: 'Datum nicht erkannt',
        body: 'Schreibe es als Tag.Monat.Jahr, zum Beispiel 3.11.2026.',
        tone: 'danger',
      });
      return;
    }
    setText(realDateInput(parsed));
    if (parsed !== value) onSave(parsed);
  };
  return (
    <Input
      aria-label="Echtes Datum des Spielabends"
      placeholder="TT.MM.JJJJ"
      inputMode="numeric"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

/** Beginn und Ende von Hand setzen. */
function TimeEditor({
  placed,
  onSet,
  onCancel,
}: {
  placed: PlacedSession;
  onSet: (startAt: number, endAt: number) => void;
  onCancel: () => void;
}) {
  const data = useData();
  const cal = data.campaign.calendar;
  const [start, setStart] = useState(() => timeDraftOf(cal, placed.startAt));
  const [end, setEnd] = useState(() =>
    timeDraftOf(
      cal,
      Math.max(placed.startAt, placed.endAt - (placed.endAt % MINUTES_PER_DAY === 0 ? 1 : 0)),
    ),
  );
  const startAt = timeOfDraft(cal, start);
  const endAt = timeOfDraft(cal, end);
  const problem =
    startAt === null
      ? 'Den Beginn gibt es im Kalender nicht.'
      : endAt === null
        ? 'Das Ende gibt es im Kalender nicht.'
        : endAt < startAt
          ? 'Das Ende liegt vor dem Beginn.'
          : endAt > data.state.now
            ? 'Eine nachgetragene Session endet nicht nach dem heutigen Stand der Welt.'
            : '';
  return (
    <div className="wf-nachtragen-time">
      <SectionTitle>Beginn in der Welt</SectionTitle>
      <WorldTimeFields cal={cal} value={start} onChange={setStart} />
      <SectionTitle>Ende in der Welt</SectionTitle>
      <WorldTimeFields cal={cal} value={end} onChange={setEnd} />
      <div className="wf-row">
        <span className="wf-grow wf-nachtragen-tone--warn" role="status">
          {problem}
        </span>
        <Button size="sm" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button
          size="sm"
          disabled={!!problem}
          onClick={() => {
            if (startAt !== null && endAt !== null) onSet(startAt, endAt);
          }}
        >
          Weltzeit setzen
        </Button>
      </div>
    </div>
  );
}

export function DraftDetail({
  placed,
  item,
  hasNext,
  overridden,
  onEdit,
  onMerge,
  onSplit,
  onSetTime,
  onClearTime,
  onClose,
}: {
  placed: PlacedSession;
  item: TakeOverItem;
  hasNext: boolean;
  overridden: boolean;
  onEdit: (change: DraftChange) => void;
  onMerge: () => void;
  onSplit: (offset: number) => void;
  onSetTime: (startAt: number, endAt: number) => void;
  onClearTime: () => void;
  onClose: () => void;
}) {
  const data = useData();
  const cal = data.campaign.calendar;
  const { draft } = placed;
  const [editingTime, setEditingTime] = useState(false);
  const time = placedTime(cal, placed);
  const lines = draftLines(draft);
  const hints = [...new Set([...draft.notes, ...placed.notes, ...item.notes])];
  const name = draft.vorspann
    ? 'Vorspann'
    : item.number !== null
      ? `Session ${item.number}${draft.lastNumber !== null ? `–${draft.lastNumber}` : ''}`
      : 'Session ohne Nummer';

  return (
    <Panel
      className="wf-nachtragen-side"
      title={name}
      actions={
        <IconButton size="sm" variant="ghost" label="Schließen" onClick={onClose}>
          <X />
        </IconButton>
      }
      scroll
    >
      <div className="wf-nachtragen-detail">
        {!draft.vorspann && (
          <div className="wf-nachtragen-fields">
            <Field
              label="Nummer"
              hint={item.numberProposed ? `Vorschlag: ${item.number}` : undefined}
            >
              <NumberField
                key={`${draft.number}`}
                value={draft.number}
                onSave={(number) => onEdit({ number })}
              />
            </Field>
            <Field label="Spielabend">
              <RealDateInput
                key={draft.realDate}
                value={draft.realDate}
                onSave={(realDate) => onEdit({ realDate })}
              />
            </Field>
            <Field label="Titel" className="wf-nachtragen-fields__wide">
              <Written
                label="Titel der Session"
                value={draft.title}
                placeholder="Ohne Titel"
                onSave={(title) => onEdit({ title })}
              />
            </Field>
          </div>
        )}

        {!draft.vorspann && (
          <div className="wf-nachtragen-when">
            <div className="wf-grow">
              <div className="wf-nachtragen-caps">Weltzeit</div>
              <div>
                <b className={cx(time.tone === 'known' ? 'wf-gold' : 'wf-soft')}>{time.text}</b>{' '}
                <span className="wf-mute">· {time.how}</span>
              </div>
            </div>
            {item.action === 'create' && !editingTime && (
              <>
                {overridden && (
                  <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={onClearTime}>
                    Vorschlag nehmen
                  </Button>
                )}
                <Button size="sm" icon={<CalendarClock />} onClick={() => setEditingTime(true)}>
                  Weltzeit setzen
                </Button>
              </>
            )}
          </div>
        )}
        {editingTime && (
          <TimeEditor
            placed={placed}
            onCancel={() => setEditingTime(false)}
            onSet={(startAt, endAt) => {
              setEditingTime(false);
              onSetTime(startAt, endAt);
            }}
          />
        )}

        {(item.problem || hints.length > 0) && (
          <ul className="wf-nachtragen-hints">
            {item.problem && <li className="wf-nachtragen-tone--warn">{item.problem}</li>}
            {hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        )}

        <div className="wf-nachtragen-detail__bar">
          <span className="wf-nachtragen-caps wf-grow">
            Deine Notizen · aus „{draft.source.file}“, Zeile {draft.source.line}
          </span>
          {hasNext && (
            <Button size="sm" icon={<Merge />} onClick={onMerge}>
              Mit der nächsten zusammenlegen
            </Button>
          )}
        </div>
        {draft.heading && <div className="wf-nachtragen-heading">{draft.heading}</div>}
        <div className="wf-nachtragen-text">
          {draft.text ? (
            lines.map((line) => (
              <div
                key={line.offset}
                className={cx(
                  'wf-nachtragen-line',
                  line.boundary && 'wf-nachtragen-line--boundary',
                )}
              >
                <span className="wf-nachtragen-line__text">{line.text || ' '}</span>
                {line.splittable && (
                  <button
                    type="button"
                    className="wf-nachtragen-line__cut"
                    title="Hier eine neue Session beginnen"
                    aria-label="Hier trennen"
                    onClick={() => onSplit(line.offset)}
                  >
                    <Scissors aria-hidden />
                    trennen
                  </button>
                )}
              </div>
            ))
          ) : (
            <span className="wf-mute wf-italic">
              Unter dieser Überschrift stehen keine Notizen.
            </span>
          )}
        </div>
      </div>
    </Panel>
  );
}
