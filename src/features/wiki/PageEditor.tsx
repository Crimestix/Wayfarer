/**
 * Eine Textseite schreiben: der Editor mit Werkzeugleiste. Gespeichert wird von selbst, kurz nach
 * dem letzten Tastendruck und immer, bevor die Seite verlassen wird.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  Bold,
  EyeOff,
  Heading2,
  Heading3,
  IdCard,
  Info,
  Italic,
  Link2,
  List,
  ListCollapse,
  ListOrdered,
  Minus,
  SquarePlus,
  TriangleAlert,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { useMediaSrc } from '../../data/media';
import type { Article, ArticleDoc } from '../../domain/schema';
import { MenuItem, Popover } from '../../ui';
import type { OpenTarget } from '../legendkeeper/Article';
import { savePageText } from './actions';
import { SAVE_DELAY_MS, registerFlush } from './editing';
import {
  MarkdownEditor,
  type EditorMode,
  type LinkSuggestion,
  type MarkdownEditorHandle,
} from './editor/MarkdownEditor';
import { splitTarget } from './markdown';
import { articlePath, articleSuggestions } from './model';
import { linkIndex, pageText } from './text';

/** Kästen, die sich einfügen lassen: Name, Symbol und was in den Text kommt. */
const BOXES: { label: string; hint: string; icon: ReactNode; text: string }[] = [
  {
    label: 'Steckbrief',
    hint: 'Angaben in Zeilen „Feld: Wert“, stehen neben dem Text',
    icon: <IdCard />,
    text: '> [!steckbrief]\n> Art: ',
  },
  {
    label: 'Geheim',
    hint: 'Nur für die Spielleitung',
    icon: <EyeOff />,
    text: '> [!geheim]\n> ',
  },
  { label: 'Hinweis', hint: 'Hervorgehobener Kasten', icon: <Info />, text: '> [!info]\n> ' },
  {
    label: 'Warnung',
    hint: 'Auffälliger Kasten',
    icon: <TriangleAlert />,
    text: '> [!warnung]\n> ',
  },
  {
    label: 'Zum Aufklappen',
    hint: 'Text, der erst auf einen Klick erscheint',
    icon: <ListCollapse />,
    text: '> [!aufklappen] Überschrift\n> ',
  },
];

function Tool({
  label,
  onRun,
  children,
}: {
  label: string;
  onRun: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="wf-wiki-tool"
      title={label}
      aria-label={label}
      // Der Klick soll die Auswahl im Text nicht aufheben.
      onMouseDown={(event: MouseEvent) => event.preventDefault()}
      onClick={onRun}
    >
      {children}
    </button>
  );
}

export default function PageEditor({
  article,
  doc,
  mode,
  onOpen,
}: {
  article: Article;
  doc: ArticleDoc;
  mode: EditorMode;
  /** Ein Verweis im Text wurde geöffnet; ohne `resourceId` gibt es den Artikel noch nicht. */
  onOpen: (target: OpenTarget) => void;
}) {
  const db = useDb();
  const data = useData();
  const src = useMediaSrc();
  const stored = pageText(data.articles, article, doc);

  const editor = useRef<MarkdownEditorHandle>(null);
  /** Der Text, den der Editor gerade zeigt. */
  const shown = useRef(stored);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [initial, setInitial] = useState(stored);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [boxes, setBoxes] = useState(false);
  const boxAnchor = useRef<HTMLButtonElement>(null);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (!pending.current) return;
    pending.current = false;
    savePageText(db, article.id, doc.id, shown.current);
    setDirty(false);
  }, [db, article.id, doc.id]);

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

  // Der Text wurde anderswo geändert (Verweise nachgezogen, Rückgängig, Abgleich mit dem anderen
  // Rechner): Der Editor zeigt den neuen Stand – außer es wird gerade getippt.
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

  // Der Editor behält die Funktionen, die er beim Aufbau bekommt; sie lesen deshalb den jeweils
  // aktuellen Stand des Wikis.
  const live = useRef({ articles: data.articles, onOpen });
  useEffect(() => {
    live.current = { articles: data.articles, onOpen };
  }, [data.articles, onOpen]);

  const suggestLinks = useCallback(
    (query: string): LinkSuggestion[] => {
      const { articles } = live.current;
      const index = linkIndex(articles);
      return articleSuggestions(articles, query, 9)
        .filter((entry) => entry.id !== article.id)
        .slice(0, 8)
        .map((entry) => {
          const path = articlePath(articles, entry.id)
            .map((step) => step.title)
            .join(' › ');
          return {
            label: entry.title,
            target:
              index.targetOf(entry.id)?.unique === false
                ? `${entry.title}~${entry.id}`
                : entry.title,
            ...(path ? { detail: path } : {}),
          };
        });
    },
    [article.id],
  );
  const isKnownLink = useCallback(
    (target: string) => linkIndex(live.current.articles).resolve(target) !== null,
    [],
  );
  const onOpenLink = useCallback((target: string) => {
    const found = linkIndex(live.current.articles).resolve(target);
    const title = splitTarget(target).title;
    live.current.onOpen(
      found
        ? { resourceId: found.id, title: found.title }
        : { resourceId: '', title, wanted: title },
    );
  }, []);

  const run = (act: (handle: MarkdownEditorHandle) => void) => () => {
    if (editor.current) act(editor.current);
  };

  return (
    <div className="wf-wiki-edit" data-mode={mode}>
      <div className="wf-wiki-edit__bar" role="toolbar" aria-label="Text gestalten">
        <Tool label="Fett" onRun={run((e) => e.wrapSelection('**', '**'))}>
          <Bold />
        </Tool>
        <Tool label="Kursiv" onRun={run((e) => e.wrapSelection('*', '*'))}>
          <Italic />
        </Tool>
        <span className="wf-wiki-edit__sep" aria-hidden />
        <Tool label="Überschrift" onRun={run((e) => e.prefixLines('## '))}>
          <Heading2 />
        </Tool>
        <Tool label="Kleinere Überschrift" onRun={run((e) => e.prefixLines('### '))}>
          <Heading3 />
        </Tool>
        <Tool label="Liste" onRun={run((e) => e.prefixLines('- '))}>
          <List />
        </Tool>
        <Tool label="Nummerierte Liste" onRun={run((e) => e.prefixLines('1. '))}>
          <ListOrdered />
        </Tool>
        <span className="wf-wiki-edit__sep" aria-hidden />
        <Tool
          label="Verweis auf einen Artikel – oder im Text [[ oder @ tippen"
          onRun={run((e) => e.wrapSelection('[[', ']]'))}
        >
          <Link2 />
        </Tool>
        <button
          ref={boxAnchor}
          type="button"
          className="wf-wiki-tool wf-wiki-tool--wide"
          aria-haspopup="menu"
          aria-expanded={boxes}
          title="Kasten einfügen: Steckbrief, Geheimes, Hinweis …"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setBoxes((open) => !open)}
        >
          <SquarePlus />
          Kasten
        </button>
        <Tool label="Trennlinie" onRun={run((e) => e.insertBlock('---'))}>
          <Minus />
        </Tool>
        <span className="wf-wiki-edit__state" aria-live="polite" data-dirty={dirty}>
          {dirty ? 'Wird gespeichert …' : 'Gespeichert'}
        </span>
      </div>
      <Popover open={boxes} onClose={() => setBoxes(false)} anchor={boxAnchor} width={300}>
        {BOXES.map((box) => (
          <MenuItem
            key={box.label}
            icon={box.icon}
            onClick={() => {
              setBoxes(false);
              editor.current?.insertBlock(box.text);
            }}
          >
            {box.label}
            <span className="wf-wiki-edit__hint">{box.hint}</span>
          </MenuItem>
        ))}
      </Popover>
      <MarkdownEditor
        key={revision}
        ref={editor}
        className="wf-wiki-edit__text"
        initialValue={initial}
        onChange={onChange}
        mode={mode}
        suggestLinks={suggestLinks}
        isKnownLink={isKnownLink}
        onOpenLink={onOpenLink}
        imageSrc={src}
        placeholder="Schreib los. Mit [[ oder @ verweist du auf einen anderen Artikel."
        autoFocus={initial.trim() === ''}
      />
    </div>
  );
}
