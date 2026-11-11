/**
 * Am Artikel im Wiki: den KI-Leser den Text lesen lassen und seine Vorschläge annehmen oder
 * ablehnen. Jeder Vorschlag zeigt den Satz, aus dem er stammt.
 */
import { useState, useSyncExternalStore } from 'react';
import { Link } from 'wouter';
import { Sparkles } from 'lucide-react';
import { useDb } from '../../data/hooks';
import { aiStatus, isDesktopApp } from '../../data/platform';
import type { AiHint, Article } from '../../domain/schema';
import { toast } from '../../ui';
import { flushEdits } from '../wiki/editing';
import { acceptAiHint, dismissAiHint, readArticle } from './actions';
import { MIN_TEXT_CHARS, articleText, formatUsd, needsReading, threadSort } from './reader';
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
  relation: 'Wird eine Beziehung in der Welt – zu sehen im Dossier beider unter „Beziehungen“.',
  thread:
    'Wird eine offene Abmachung – zu sehen in der Chronik unter „Offene Abmachungen“ und am Spieltisch unter „Anstehend“.',
};

const DONE_WHERE: Record<AiHint['kind'], string> = {
  event: 'Zu finden im Kalender und am Spieltisch unter „Anstehend“.',
  relation: 'Zu finden im Dossier beider unter „Beziehungen“.',
  thread: 'Zu finden in der Chronik unter „Offene Abmachungen“.',
};

/** Ein Vorschlag mit dem Satz, aus dem er stammt – zum Eintragen oder Verwerfen. */
export function HintRow({ article, hint }: { article: Article; hint: AiHint }) {
  const db = useDb();
  // Ein offener Punkt ist entweder eine Abmachung oder Wissen, das jemand hat oder nicht hat.
  const payload = hint.payload as { text?: unknown; sort?: unknown };
  const secret =
    hint.kind === 'thread' &&
    threadSort(typeof payload.text === 'string' ? payload.text : hint.line, payload.sort) ===
      'secret';
  const accept = () => {
    const undo = acceptAiHint(db, article.id, hint.id);
    if (!undo) {
      toast({
        title: 'Der Vorschlag lässt sich nicht eintragen',
        body: 'Was er nennt, gibt es in der Welt nicht (mehr).',
        tone: 'danger',
      });
      return;
    }
    toast({
      title: secret ? 'Als Geheimnis eingetragen' : DONE_TITLE[hint.kind],
      body: (
        <>
          <div>{hint.line}</div>
          <div className="wf-mute">
            {secret
              ? 'Zu finden im Dossier der genannten Person, im Feld „Geheimnis“.'
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
        <span className="wf-wiki-facts__label">{secret ? 'Geheimnis' : KIND_LABEL[hint.kind]}</span>
        <span className="wf-wiki-facts__what">{hint.line}</span>
        <button
          type="button"
          className="wf-wiki-facts__act"
          onClick={accept}
          title={
            secret
              ? 'Kommt ohne Datum ins Dossier der genannten Person, ins Feld „Geheimnis“ – das siehst nur du.'
              : WHERE[hint.kind]
          }
        >
          {secret ? 'Als Geheimnis' : ACCEPT_LABEL[hint.kind]}
        </button>
        <button type="button" className="wf-wiki-facts__act" onClick={dismiss}>
          Stimmt nicht
        </button>
      </div>
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
