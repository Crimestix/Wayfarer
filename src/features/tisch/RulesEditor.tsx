/**
 * Die Regeln des Tisches schreiben: derselbe Editor wie für die Artikel (gesetzte Ansicht, mit
 * [[Verweisen]]). Gespeichert wird von selbst, kurz nach dem letzten Tastendruck und immer, bevor
 * das Blatt geschlossen wird. Wird erst geladen, wenn das Blatt offen ist.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useData, useDb } from '../../data/hooks';
import { useMediaSrc } from '../../data/media';
import { SAVE_DELAY_MS, registerFlush } from '../wiki/editing';
import { MarkdownEditor, type LinkSuggestion } from '../wiki/editor/MarkdownEditor';
import { articlePath, articleSuggestions } from '../wiki/model';
import { linkIndex } from '../wiki/text';
import { setTableRules } from './commands';

export default function RulesEditor({
  placeholder,
  autoFocus = false,
}: {
  placeholder: string;
  /** Leer gleich hineinschreiben – im Fenster, nicht in den Einstellungen. */
  autoFocus?: boolean;
}) {
  const db = useDb();
  const data = useData();
  const src = useMediaSrc();
  const [, navigate] = useLocation();
  const stored = data.campaign.tableRules;

  /** Der Text, den der Editor gerade zeigt. */
  const shown = useRef(stored);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [initial, setInitial] = useState(stored);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (!pending.current) return;
    pending.current = false;
    setTableRules(db, shown.current);
    setDirty(false);
  }, [db]);

  useEffect(() => {
    const off = registerFlush(flush);
    window.addEventListener('pagehide', flush);
    window.addEventListener('blur', flush);
    return () => {
      off();
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('blur', flush);
      flush();
    };
  }, [flush]);

  // Anderswo geändert (Rückgängig, der andere Rechner): Der Editor zeigt den neuen Stand – außer
  // es wird gerade getippt.
  useEffect(() => {
    if (pending.current || stored === shown.current) return;
    shown.current = stored;
    setInitial(stored);
    setRevision((r) => r + 1);
  }, [stored]);

  const onChange = useCallback(
    (text: string) => {
      if (text === shown.current) return;
      shown.current = text;
      pending.current = true;
      setDirty(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  // Der Editor behält die Funktionen, die er beim Aufbau bekommt; sie lesen den aktuellen Stand.
  const articles = useRef(data.articles);
  useEffect(() => {
    articles.current = data.articles;
  }, [data.articles]);

  const suggestLinks = useCallback((query: string): LinkSuggestion[] => {
    const all = articles.current;
    const index = linkIndex(all);
    return articleSuggestions(all, query, 8).map((entry) => {
      const path = articlePath(all, entry.id)
        .map((step) => step.title)
        .join(' › ');
      return {
        label: entry.title,
        target:
          index.targetOf(entry.id)?.unique === false ? `${entry.title}~${entry.id}` : entry.title,
        ...(path ? { detail: path } : {}),
      };
    });
  }, []);
  const isKnownLink = useCallback(
    (target: string) => linkIndex(articles.current).resolve(target) !== null,
    [],
  );
  const onOpenLink = useCallback(
    (target: string) => {
      const found = linkIndex(articles.current).resolve(target);
      if (found) navigate(`/wiki/${found.id}`);
    },
    [navigate],
  );

  return (
    <div className="wf-tisch-rules__editor">
      <MarkdownEditor
        key={revision}
        className="wf-tisch-rules__text"
        initialValue={initial}
        onChange={onChange}
        mode="live"
        suggestLinks={suggestLinks}
        isKnownLink={isKnownLink}
        onOpenLink={onOpenLink}
        imageSrc={src}
        placeholder={placeholder}
        autoFocus={autoFocus && initial.trim() === ''}
      />
      <span className="wf-tisch-rules__state" aria-live="polite" data-dirty={dirty}>
        {dirty ? 'Wird gespeichert …' : 'Gespeichert'}
      </span>
    </div>
  );
}
