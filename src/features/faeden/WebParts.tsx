/**
 * Bausteine für das Netz der Fäden (`domain/threadWeb.ts`): einen Faden wählen, „Verbunden mit“
 * an einem Faden (Verbindungen mit Wort, Hinweise, die hin- und wegführen, Vorschläge) und die
 * Meldung, wenn ein gefundener Hinweis die Spur weiterführt. Gebraucht auf dem Blatt einer
 * Geschichte und am Fadenbrett.
 */
import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, ArrowRight, Plus, Unlink } from 'lucide-react';
import type { CampaignDb } from '../../data/db';
import { useData, useDb } from '../../data/hooks';
import { SUGGESTION } from '../../domain/dismiss';
import { threadsInOrder } from '../../domain/looseThreads';
import type { CampaignData, Thread } from '../../domain/schema';
import { isLooseThread, threadLive } from '../../domain/story';
import { TIE_FITS, leadNote, neighboursOf, tieFits } from '../../domain/threadWeb';
import { focusOn } from '../../shell/focus';
import { Button, DismissButton, IconButton, Select, Written, cx, toast } from '../../ui';
import { setHintFound, setTieWord, tieThreads, untieThreads } from './actions';

/** Wo ein Faden „wohnt“: auf dem Blatt seiner Geschichte, sonst am Fadenbrett. */
export function useOpenThread(): (thread: Thread) => void {
  const data = useData();
  const [, navigate] = useLocation();
  return (thread) => {
    if (thread.storyId && data.stories[thread.storyId]) {
      navigate(`/geschichte/${thread.storyId}`);
      return;
    }
    focusOn({ type: 'card', key: `thread:${thread.id}` });
    navigate('/faeden');
  };
}

/** „Titel – Geschichte“ oder „Titel – lose“: So steht ein Faden in einer Auswahl. */
function choiceLabel(data: CampaignData, thread: Thread): string {
  const story = thread.storyId ? data.stories[thread.storyId] : undefined;
  return `${thread.title} – ${story && !isLooseThread(data, thread) ? story.title : 'loser Faden'}`;
}

/**
 * Einen Faden wählen – in der Reihung, in der Fäden überall zur Wahl stehen (`threadsInOrder`):
 * lebendige zuerst, was am Ort der Gruppe hängt, zuerst. Die Tastatur springt mit dem ersten
 * Buchstaben.
 */
export function ThreadChoice({
  value,
  exclude = [],
  onChange,
  label,
  empty,
  className,
}: {
  value: string | null;
  exclude?: readonly string[];
  onChange: (threadId: string | null) => void;
  label: string;
  /** Was die leere Zeile sagt. */
  empty: string;
  className?: string;
}) {
  const data = useData();
  const threads = useMemo(
    () =>
      threadsInOrder(data).filter(
        (thread) => thread.id === value || (threadLive(thread) && !exclude.includes(thread.id)),
      ),
    [data, value, exclude],
  );
  return (
    <Select
      className={cx('wf-faden-choice', className)}
      value={value ?? ''}
      aria-label={label}
      title={label}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">{empty}</option>
      {threads.map((thread) => (
        <option key={thread.id} value={thread.id}>
          {choiceLabel(data, thread)}
        </option>
      ))}
    </Select>
  );
}

/**
 * Setzt einen Hinweis auf gefunden oder zurück – mit Meldung und Rückgängig. Führt er zu einem
 * Faden, sagt die Meldung, wohin die Spur jetzt geht.
 */
export function findHint(db: CampaignDb, threadId: string, hintId: string, found: boolean): void {
  setHintFound(db, threadId, hintId, found);
  if (!found) return;
  const note = leadNote(db.getSnapshot(), threadId, hintId);
  if (note)
    toast({
      title: 'Hinweis gefunden',
      body: note,
      action: { label: 'Rückgängig', run: () => setHintFound(db, threadId, hintId, false) },
    });
}

/**
 * „Verbunden mit“: das Netz rund um einen Faden – Verbindungen (mit freiem Wort, lösbar), die
 * Fäden, zu denen seine Hinweise führen und von denen her Hinweise zu ihm führen, ein neuer Faden
 * zum Verbinden und Vorschläge (gleicher Ort, gleicher Name), jeder wegklickbar.
 */
export function ThreadWeb({ thread }: { thread: Thread }) {
  const db = useDb();
  const data = useData();
  const open = useOpenThread();
  const steps = neighboursOf(data, thread.id);
  const fits = tieFits(data, thread.id).slice(0, TIE_FITS);
  const tie = (otherId: string | null) => {
    if (!otherId) return;
    const undo = tieThreads(db, thread.id, otherId);
    if (undo)
      toast({
        title: 'Fäden verbunden',
        body: `„${thread.title}“ – „${data.threads[otherId]?.title ?? ''}“`,
        action: { label: 'Rückgängig', run: undo },
      });
  };
  const untie = (other: Thread) => {
    const undo = untieThreads(db, thread.id, other.id);
    if (undo)
      toast({
        title: 'Verbindung gelöst',
        body: `„${thread.title}“ – „${other.title}“`,
        action: { label: 'Rückgängig', run: undo },
      });
  };
  return (
    <div className="wf-faden-web">
      <div className="wf-faden-frage__sub">
        <span>Verbunden mit</span>
      </div>
      {steps.map((step) => (
        <div key={step.thread.id} className="wf-faden-web__row" data-step={step.step}>
          {step.step === 'tie' ? (
            <i className="wf-faden-web__knot" aria-hidden />
          ) : step.step === 'leads' ? (
            <ArrowRight aria-label="Ein Hinweis führt dorthin" />
          ) : (
            <ArrowLeft aria-label="Ein Hinweis von dort führt hierher" />
          )}
          <button
            type="button"
            className="wf-faden-link wf-faden-web__title"
            title={choiceLabel(data, step.thread)}
            onClick={() => open(step.thread)}
          >
            {step.thread.title}
          </button>
          {step.step === 'tie' ? (
            <>
              <Written
                className="wf-faden-web__word"
                label={`Was „${thread.title}“ und „${step.thread.title}“ verbindet`}
                wrap
                value={step.word}
                placeholder="was sie verbindet …"
                onSave={(word) => setTieWord(db, thread.id, step.thread.id, word)}
              />
              <IconButton
                label="Verbindung lösen"
                size="sm"
                variant="ghost"
                onClick={() => untie(step.thread)}
              >
                <Unlink />
              </IconButton>
            </>
          ) : (
            <em className="wf-faden-web__via">
              {step.step === 'leads'
                ? `über den Hinweis „${step.word}“`
                : `sein Hinweis „${step.word}“ führt hierher`}
            </em>
          )}
        </div>
      ))}
      <ThreadChoice
        value={null}
        exclude={[thread.id, ...steps.map((step) => step.thread.id)]}
        onChange={tie}
        label={`„${thread.title}“ mit einem anderen Faden verbinden`}
        empty={
          steps.length ? '+ mit einem weiteren Faden verbinden …' : '+ mit einem Faden verbinden …'
        }
      />
      {fits.map((fit) => (
        <div key={fit.thread.id} className="wf-faden-fit wf-faden-web__fit">
          <span className="wf-faden-fit__title">
            Passt vielleicht: {fit.thread.title} <em>– {fit.reason}</em>
          </span>
          <span className="wf-faden-fit__acts">
            <Button size="sm" icon={<Plus />} onClick={() => tie(fit.thread.id)}>
              Verbinden
            </Button>
            <DismissButton
              suggestionKey={SUGGESTION.tie(thread.id, fit.thread.id)}
              what={`„${fit.thread.title}“ als Faden zum Verbinden`}
            />
          </span>
        </div>
      ))}
    </div>
  );
}
