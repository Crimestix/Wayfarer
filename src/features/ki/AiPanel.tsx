/**
 * Am Artikel im Wiki: den KI-Leser den Text lesen lassen und seine Vorschläge annehmen oder
 * ablehnen. Jeder Vorschlag zeigt den Satz, aus dem er stammt.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Link } from 'wouter';
import { Sparkles } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { aiStatus, isDesktopApp } from '../../data/platform';
import { threadByTitle, threadLike } from '../../domain/looseThreads';
import type { AiHint, Article } from '../../domain/schema';
import { primaryEra, type CalendarDef } from '../../domain/time/calendar';
import { Input, Select, toast } from '../../ui';
import { timeDraftOf, timeOfDraft, type TimeDraft } from '../chronik/model';
import { StorySelect } from '../faeden/StorySelect';
import { flushEdits } from '../wiki/editing';
import { acceptAiHint, dismissAiHint, readArticle } from './actions';
import {
  MIN_TEXT_CHARS,
  articleText,
  formatUsd,
  hintPromiseDate,
  isPromiseHint,
  needsReading,
  promiseWhen,
  threadSort,
  type ThreadSort,
} from './reader';
import './ki.css';

// ── Ist ein Key hinterlegt? Einmal gefragt, für alle Stellen gemerkt. ────────

let hasKey: boolean | null = null;
const listeners = new Set<() => void>();

/** Fragt die App neu, ob ein Claude-Key hinterlegt ist (nach dem Speichern oder Entfernen). */
export async function refreshAiKey(): Promise<void> {
  if (!isDesktopApp()) hasKey = false;
  else
    try {
      hasKey = (await aiStatus()).hasKey;
    } catch {
      hasKey = false;
    }
  listeners.forEach((listener) => listener());
}

/** Ob ein Claude-Key hinterlegt ist: null, solange das noch nicht feststeht. */
export function useAiKey(): boolean | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (hasKey === null && listeners.size === 1) void refreshAiKey();
      return () => listeners.delete(listener);
    },
    () => hasKey,
  );
}

const KIND_LABEL: Record<AiHint['kind'], string> = {
  event: 'Termin',
  relation: 'Beziehung',
  thread: 'Abmachung',
};

const DONE_TITLE: Record<AiHint['kind'], string> = {
  event: 'In den Kalender eingetragen',
  relation: 'In die Welt eingetragen',
  thread: 'Als Abmachung festgehalten',
};

/** Der Knopf sagt, wohin der Vorschlag kommt. */
const ACCEPT_LABEL: Record<AiHint['kind'], string> = {
  event: 'In den Kalender',
  relation: 'Als Beziehung',
  thread: 'Als Abmachung',
};

/** Wo der Spielleiter das Eingetragene danach findet. */
const WHERE: Record<AiHint['kind'], string> = {
  event: 'Wird ein Termin im Kalender – er steht auch am Spieltisch unter „Anstehend“.',
  relation: 'Wird eine Beziehung in der Welt – zu sehen auf den Seiten beider unter „Beziehungen“.',
  thread:
    'Wird eine offene Abmachung in der Chronik – an dem Tag, an dem sie getroffen wurde. Zu sehen unter „Offene Abmachungen“ und am Spieltisch unter „Anstehend“.',
};

const DONE_WHERE: Record<AiHint['kind'], string> = {
  event: 'Zu finden im Kalender und am Spieltisch unter „Anstehend“.',
  relation: 'Zu finden auf den Seiten beider unter „Beziehungen“.',
  thread: 'Zu finden in der Chronik unter „Offene Abmachungen“.',
};

/** Ein Tag im Kalender der Welt: Tag, Monat, Jahr. Ohne Tag gilt „kein Tag bekannt“. */
function DayFields({
  cal,
  value,
  onChange,
}: {
  cal: CalendarDef;
  value: TimeDraft;
  onChange: (value: TimeDraft) => void;
}) {
  const set = (change: Partial<TimeDraft>) => onChange({ ...value, ...change });
  return (
    <span className="wf-ki-when__fields">
      <Input
        type="number"
        min={1}
        max={31}
        placeholder="Tag"
        aria-label="Tag"
        className="wf-ki-when__day"
        value={value.day}
        onChange={(e) => set({ day: e.target.value })}
      />
      <Select
        aria-label="Monat"
        value={value.month}
        onChange={(e) => set({ month: Number(e.target.value) })}
      >
        {cal.months.map((month, i) => (
          <option key={month.name} value={i}>
            {month.name}
          </option>
        ))}
      </Select>
      <Input
        type="number"
        aria-label={`Jahr ${primaryEra(cal).label}`.trim()}
        className="wf-ki-when__year"
        value={value.year}
        onChange={(e) => set({ year: e.target.value })}
      />
      <span className="wf-mute">{primaryEra(cal).label}</span>
    </span>
  );
}

/** Ein Tag als Eingabe; ohne bekannten Tag ist das Feld „Tag“ leer. */
const dayDraft = (cal: CalendarDef, at: number, known: boolean): TimeDraft => ({
  ...timeDraftOf(cal, at),
  day: known ? timeDraftOf(cal, at).day : '',
  hour: '0',
  minute: '0',
});

/** Ein Vorschlag mit dem Satz, aus dem er stammt – zum Eintragen oder Verwerfen. */
export function HintRow({ article, hint }: { article: Article; hint: AiHint }) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  // Eine Abmachung kommt an dem Tag in die Chronik, an dem sie getroffen wurde.
  const promise = isPromiseHint(hint);
  const found = promise ? hintPromiseDate(data, hint) : null;
  /** Der Tag, den der Spielleiter selbst setzt; null = das Feld ist zu. */
  const [draft, setDraft] = useState<TimeDraft | null>(() =>
    promise && found === null ? dayDraft(cal, data.state.now, false) : null,
  );
  const chosen = draft ? timeOfDraft(cal, draft) : undefined;
  const when = promise ? promiseWhen(data, chosen === undefined ? found : chosen) : null;
  const line = when ? `${hint.line} – ${when.text}` : hint.line;
  // Ein offener Punkt ist entweder eine Abmachung oder Wissen, das jemand hat oder nicht hat.
  const payload = hint.payload as { text?: unknown; sort?: unknown };
  const sort =
    hint.kind === 'thread'
      ? threadSort(typeof payload.text === 'string' ? payload.text : hint.line, payload.sort)
      : null;
  const secret = sort === 'secret';
  const lead = sort === 'lead';
  /** Die Geschichte, an die ein Faden gleich kommt; null = er wird ein loser Faden. */
  const [storyId, setStoryId] = useState<string | null>(null);
  const leadText = typeof payload.text === 'string' ? payload.text : hint.line;
  const like = useMemo(
    () =>
      threadLike(leadText, Array.isArray(hint.payload.refs) ? (hint.payload.refs as string[]) : []),
    [leadText, hint.payload.refs],
  );
  const hasStories = Object.values(data.stories).some((story) => !story.closed);
  const accept = (as?: ThreadSort) => {
    const asLead = as === 'lead' || (as === undefined && lead);
    // Gibt es den Faden mit demselben Satz schon, entsteht kein zweiter.
    const twin = asLead ? threadByTitle(data, leadText) : null;
    const story = asLead && !twin && storyId ? data.stories[storyId] : undefined;
    const undo = acceptAiHint(
      db,
      article.id,
      hint.id,
      as,
      asLead ? undefined : chosen,
      asLead ? storyId : null,
    );
    if (!undo) {
      toast({
        title: 'Der Vorschlag lässt sich nicht eintragen',
        body: 'Was er nennt, gibt es in der Welt nicht (mehr).',
        tone: 'danger',
      });
      return;
    }
    toast({
      title: twin
        ? 'Den Faden gibt es schon'
        : asLead
          ? 'Als Faden eingetragen'
          : secret
            ? 'Als Geheimnis eingetragen'
            : DONE_TITLE[hint.kind],
      body: (
        <>
          <div>{asLead ? hint.line : line}</div>
          <div className="wf-mute">
            {twin
              ? 'Es wurde kein zweiter angelegt.'
              : story
                ? `Zu finden als Frage der Geschichte „${story.title}“.`
                : asLead
                  ? 'Zu finden am Fadenbrett unter „Lose Fäden“.'
                  : secret
                    ? 'Zu finden auf der Seite der genannten Person, im Feld „Geheimnis“.'
                    : DONE_WHERE[hint.kind]}
          </div>
        </>
      ),
      action: { label: 'Rückgängig', run: undo },
      duration: 9000,
    });
  };
  const dismiss = () => {
    const undo = dismissAiHint(db, article.id, hint.id);
    toast({
      title: 'Vorschlag verworfen',
      body: 'Er wird für diesen Artikel nicht wieder gezeigt.',
      action: { label: 'Rückgängig', run: undo },
    });
  };
  return (
    <div className="wf-ki-row">
      <div className="wf-wiki-facts__row">
        <span className="wf-wiki-facts__label">
          {lead ? 'Faden' : secret ? 'Geheimnis' : KIND_LABEL[hint.kind]}
        </span>
        <span className="wf-wiki-facts__what">{line}</span>
        <button
          type="button"
          className="wf-wiki-facts__act"
          onClick={() => accept()}
          title={
            lead
              ? 'Wird ein Faden – eine Spur, der die Gruppe folgen kann. Ohne Geschichte steht er am Fadenbrett unter „Lose Fäden“.'
              : secret
                ? 'Kommt ohne Datum auf die Seite der genannten Person, ins Feld „Geheimnis“ – das siehst nur du.'
                : WHERE[hint.kind]
          }
        >
          {lead ? 'Als Faden' : secret ? 'Als Geheimnis' : ACCEPT_LABEL[hint.kind]}
        </button>
        {hint.kind === 'thread' && !lead && (
          <button
            type="button"
            className="wf-wiki-facts__act"
            onClick={() => accept('lead')}
            title="Das ist eher eine Spur oder offene Frage: als Faden ans Fadenbrett – unter „Lose Fäden“"
          >
            Als Faden
          </button>
        )}
        <button type="button" className="wf-wiki-facts__act" onClick={dismiss}>
          Stimmt nicht
        </button>
      </div>
      {lead && hasStories && (
        <div className="wf-ki-when">
          <span className="wf-ki-when__label">Gehört zur Geschichte</span>
          <StorySelect thread={like} value={storyId} onChange={setStoryId} />
        </div>
      )}
      {when && draft && (
        <div className="wf-ki-when">
          <span className="wf-ki-when__label">Getroffen am</span>
          <DayFields cal={cal} value={draft} onChange={setDraft} />
          <span className="wf-mute">
            {draft.day.trim() && chosen === null
              ? 'Diesen Tag gibt es im Kalender nicht – so kommt sie vor den Beginn der Mitschrift.'
              : when.how === 'undated'
                ? 'Im Text steht kein Tag. Ohne Tag kommt sie vor den Beginn der Mitschrift, nicht auf heute.'
                : when.how === 'later'
                  ? 'Nichts wird in die Zukunft eingetragen.'
                  : ''}
          </span>
        </div>
      )}
      {when && !draft && (
        <div className="wf-ki-when">
          {when.how === 'later' && (
            <span className="wf-mute">Nichts wird in die Zukunft eingetragen.</span>
          )}
          <button
            type="button"
            className="wf-wiki-facts__act"
            onClick={() => setDraft(dayDraft(cal, found ?? data.state.now, found !== null))}
          >
            Anderer Tag
          </button>
        </div>
      )}
      {hint.quote && <div className="wf-ki-quote">„{hint.quote}“</div>}
    </div>
  );
}

export function AiPanel({ article }: { article: Article }) {
  const db = useDb();
  const key = useAiKey();
  const [busy, setBusy] = useState(false);
  const open = article.aiHints.filter((hint) => hint.state === 'open');
  const desktop = isDesktopApp();
  const enough = articleText(article).length >= MIN_TEXT_CHARS;
  // In der Vorschau im Browser gibt es keinen Leser; dort erscheint nur, was schon vorliegt.
  if (!open.length && (!desktop || !enough || article.template)) return null;

  const read = async () => {
    if (busy) return;
    flushEdits();
    setBusy(true);
    try {
      const result = await readArticle(db, article.id);
      toast({
        title:
          result.added === 0
            ? 'Nichts Neues gefunden'
            : result.added === 1
              ? 'Ein Vorschlag'
              : `${result.added} Vorschläge`,
        body: (
          <>
            <div>Gelesen für {formatUsd(result.usd)}.</div>
            {result.skipped.map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </>
        ),
        duration: result.skipped.length ? 12000 : undefined,
      });
    } catch (cause) {
      toast({
        title: 'Der Artikel ließ sich nicht lesen',
        body: cause instanceof Error ? cause.message : 'Unerwarteter Fehler.',
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const changed = article.aiRead !== null && needsReading(article);
  return (
    <div className="wf-wiki-facts wf-ki">
      <div className="wf-wiki-facts__row">
        <span className="wf-wiki-facts__label">
          <Sparkles aria-hidden className="wf-ki__icon" /> KI-Leser
        </span>
        {!desktop ? (
          <span>Der KI-Leser arbeitet nur in der installierten App.</span>
        ) : key === false ? (
          <span>
            Noch kein Claude-Key hinterlegt – das geht in den{' '}
            <Link href="/einstellungen">Einstellungen</Link>.
          </span>
        ) : key === null ? (
          <span>…</span>
        ) : (
          <>
            <span>
              {busy
                ? 'Claude liest …'
                : article.aiRead === null
                  ? 'Noch nicht gelesen.'
                  : changed
                    ? 'Der Text hat sich seit dem Lesen geändert.'
                    : open.length
                      ? 'Gelesen.'
                      : 'Gelesen – keine offenen Vorschläge.'}
            </span>
            {!busy && (
              <button type="button" className="wf-wiki-facts__act" onClick={() => void read()}>
                {article.aiRead === null ? 'Lesen lassen' : 'Neu lesen lassen'}
              </button>
            )}
          </>
        )}
      </div>
      {open.map((hint) => (
        <HintRow key={hint.id} article={article} hint={hint} />
      ))}
    </div>
  );
}
