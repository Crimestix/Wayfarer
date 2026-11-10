/**
 * Handgriffe rund um einen Artikel: neu anlegen, verschieben, Schlagworte und Zweitnamen,
 * löschen. Die Befehle selbst stehen in `actions.ts`; hier sind nur die Fenster und Menüs.
 */
import { useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import {
  ArrowUpToLine,
  CornerDownRight,
  Ellipsis,
  FilePlus2,
  FolderInput,
  PenLine,
  Plus,
  Tags,
  Trash2,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import type { Article, ArticleDoc } from '../../domain/schema';
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  IconButton,
  Input,
  MenuItem,
  Popover,
  confirmDialog,
  toast,
} from '../../ui';
import {
  createArticle,
  deleteArticle,
  isWithin,
  moveArticle,
  removePage,
  renamePage,
  setArticleMeta,
} from './actions';
import { flushEdits } from './editing';
import { ArticleIcon } from './icons';
import { articlePath, articleSuggestions, childArticles } from './model';

/** „Welt › Hohenfurt“ – wo ein Artikel im Baum steht. */
function PathLine({ article }: { article: Article }) {
  const data = useData();
  const path = articlePath(data.articles, article.id);
  return (
    <span className="wf-wiki-pick__path">
      {path.length ? path.map((step) => step.title).join(' › ') : 'ganz oben'}
    </span>
  );
}

/** Neuen Artikel anlegen: Titel und wo er hingehört. */
export function NewArticleDialog({
  parent,
  initialTitle = '',
  onClose,
  onCreated,
}: {
  /** Vorgeschlagener Ort: unter diesem Artikel; null = ganz oben. */
  parent: Article | null;
  initialTitle?: string;
  onClose: () => void;
  onCreated: (article: Article) => void;
}) {
  const db = useDb();
  const [title, setTitle] = useState(initialTitle);
  const [under, setUnder] = useState(parent !== null);
  const clean = title.replace(/\s+/g, ' ').trim();
  const create = () => {
    flushEdits();
    const article = createArticle(db, { title: clean, parentId: under ? parent?.id : null });
    if (article) onCreated(article);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Neuer Artikel"
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" icon={<FilePlus2 />} disabled={!clean} onClick={create}>
            Anlegen
          </Button>
        </>
      }
    >
      <form
        className="wf-col"
        style={{ gap: 'var(--s-4)' }}
        onSubmit={(event) => {
          event.preventDefault();
          if (clean) create();
        }}
      >
        <Field label="Titel">
          <Input
            value={title}
            data-autofocus
            placeholder="z. B. Das alte Zollhaus"
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        {parent && (
          <Checkbox checked={under} onChange={setUnder}>
            Unter „{parent.title}“ ablegen
          </Checkbox>
        )}
        <p className="wf-mute">
          {under && parent
            ? 'Der Artikel erscheint im Baum unter diesem Artikel. Verschieben lässt er sich jederzeit.'
            : 'Der Artikel erscheint im Baum ganz oben. Verschieben lässt er sich jederzeit.'}
        </p>
      </form>
    </Dialog>
  );
}

/** Einen Artikel an eine andere Stelle des Baums hängen. */
export function MoveDialog({ article, onClose }: { article: Article; onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const [query, setQuery] = useState('');
  const options = useMemo(
    () =>
      articleSuggestions(data.articles, query, 40).filter(
        (entry) => !entry.template && !isWithin(data.articles, entry.id, article.id),
      ),
    [data.articles, query, article.id],
  );
  const move = (parent: Article | null) => {
    flushEdits();
    if (moveArticle(db, article.id, parent?.id ?? null))
      toast({
        title: `„${article.title}“ verschoben`,
        body: parent ? `Liegt jetzt unter „${parent.title}“.` : 'Liegt jetzt ganz oben.',
      });
    onClose();
  };
  return (
    <Dialog open onClose={onClose} title={`„${article.title}“ verschieben`} width={560}>
      <div className="wf-col" style={{ gap: 'var(--s-3)' }}>
        <Input
          value={query}
          data-autofocus
          placeholder="Unter welchen Artikel? Titel eintippen …"
          aria-label="Zielartikel suchen"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="wf-wiki-pick" role="listbox" aria-label="Mögliche Ziele">
          {article.parentId !== null && (
            <button type="button" className="wf-wiki-pick__row" onClick={() => move(null)}>
              <ArrowUpToLine aria-hidden />
              <span className="wf-wiki-pick__title">Ganz nach oben</span>
              <span className="wf-wiki-pick__path">ohne übergeordneten Artikel</span>
            </button>
          )}
          {options.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="wf-wiki-pick__row"
              disabled={entry.id === article.parentId}
              onClick={() => move(entry)}
            >
              <ArticleIcon icon={entry.icon} />
              <span className="wf-wiki-pick__title">{entry.title}</span>
              {entry.id === article.parentId ? (
                <span className="wf-wiki-pick__path">liegt schon hier</span>
              ) : (
                <PathLine article={entry} />
              )}
            </button>
          ))}
          {!options.length && <p className="wf-wiki-side__none">Kein Artikel passt dazu.</p>}
        </div>
      </div>
    </Dialog>
  );
}

const toList = (value: string) =>
  value
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);

/** Schlagworte, Zweitnamen und Sichtbarkeit eines Artikels. */
export function MetaDialog({ article, onClose }: { article: Article; onClose: () => void }) {
  const db = useDb();
  const [tags, setTags] = useState(article.tags.join(', '));
  const [aliases, setAliases] = useState(article.aliases.join(', '));
  const [hidden, setHidden] = useState(article.hidden);
  const [autoLink, setAutoLink] = useState(article.autoLink);
  const save = () => {
    flushEdits();
    setArticleMeta(db, article.id, {
      tags: toList(tags),
      aliases: toList(aliases),
      hidden,
      autoLink,
    });
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`„${article.title}“ – Schlagworte und Zweitnamen`}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <Field
          label="Zweitnamen"
          hint="Andere Namen für dasselbe, durch Komma getrennt. Ein Verweis mit einem Zweitnamen führt hierher."
        >
          <Input
            value={aliases}
            data-autofocus
            placeholder="z. B. Die Furt, Stadt am Fluss"
            onChange={(e) => setAliases(e.target.value)}
          />
        </Field>
        <Field label="Schlagworte" hint="Durch Komma getrennt.">
          <Input
            value={tags}
            placeholder="z. B. Stadt, Hafen"
            onChange={(e) => setTags(e.target.value)}
          />
        </Field>
        <Checkbox checked={hidden} onChange={setHidden}>
          Vor den Spielern verborgen
        </Checkbox>
        <Checkbox checked={autoLink} onChange={setAutoLink}>
          Den Namen im Text anderer Artikel von selbst erkennen
        </Checkbox>
        <p className="wf-mute">
          Steht der Titel oder ein Zweitname irgendwo im Text, wird er dort anklickbar – auch ohne
          Klammern. Abschalten, wenn der Titel ein gewöhnliches Wort ist und zu oft trifft.
        </p>
      </div>
    </Dialog>
  );
}

/** Das Menü „Mehr“ am Artikel. */
export function ArticleMenu({ article, onNewChild }: { article: Article; onNewChild: () => void }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'move' | 'meta' | null>(null);
  const pick = (run: () => void) => () => {
    setOpen(false);
    run();
  };

  const remove = async () => {
    const children = childArticles(data.articles, article.id).length;
    const ok = await confirmDialog({
      title: `„${article.title}“ löschen?`,
      body: [
        'Der Artikel mit all seinen Seiten wird entfernt.',
        children
          ? ` ${children === 1 ? 'Der Unterartikel rückt' : `Die ${children} Unterartikel rücken`} eine Ebene nach oben.`
          : '',
        ' Verweise auf ihn bleiben als Name stehen.',
      ].join(''),
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    flushEdits();
    const parentId = article.parentId;
    const undo = deleteArticle(db, article.id);
    navigate(parentId ? `/wiki/${parentId}` : '/wiki');
    if (undo)
      toast({
        title: 'Artikel gelöscht',
        body: article.title,
        action: {
          label: 'Rückgängig',
          run: () => {
            undo();
            navigate(`/wiki/${article.id}`);
          },
        },
      });
  };

  return (
    <>
      <IconButton
        ref={anchor}
        label="Mehr"
        size="sm"
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        <Ellipsis />
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} align="right" width={270}>
        <MenuItem icon={<CornerDownRight />} onClick={pick(onNewChild)}>
          Unterartikel anlegen
        </MenuItem>
        <MenuItem icon={<FolderInput />} onClick={pick(() => setDialog('move'))}>
          Verschieben …
        </MenuItem>
        <MenuItem icon={<Tags />} onClick={pick(() => setDialog('meta'))}>
          Schlagworte und Zweitnamen …
        </MenuItem>
        <div className="wf-menu-sep" />
        <MenuItem icon={<Trash2 />} onClick={pick(() => void remove())}>
          Artikel löschen
        </MenuItem>
      </Popover>
      {dialog === 'move' && <MoveDialog article={article} onClose={() => setDialog(null)} />}
      {dialog === 'meta' && <MetaDialog article={article} onClose={() => setDialog(null)} />}
    </>
  );
}

/** Seiten eines Artikels: weitere hinzufügen, die gezeigte umbenennen oder entfernen. */
export function PageTools({
  article,
  doc,
  name,
  canRemove,
  onAdd,
}: {
  article: Article;
  doc: ArticleDoc;
  /** Wie die Seite im Reiter heißt. */
  name: string;
  canRemove: boolean;
  onAdd: () => void;
}) {
  const db = useDb();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState<string | null>(null);

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Seite „${name}“ löschen?`,
      body: 'Der Text dieser Seite wird entfernt. Der Artikel und seine anderen Seiten bleiben.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    flushEdits();
    const undo = removePage(db, article.id, doc.id);
    if (undo)
      toast({ title: 'Seite gelöscht', body: name, action: { label: 'Rückgängig', run: undo } });
  };
  const rename = () => {
    if (title === null) return;
    flushEdits();
    renamePage(db, article.id, doc.id, title);
    setTitle(null);
  };

  return (
    <>
      <button
        type="button"
        className="wf-wiki-pagetool"
        title="Weitere Seite hinzufügen"
        aria-label="Weitere Seite hinzufügen"
        onClick={onAdd}
      >
        <Plus />
      </button>
      <button
        ref={anchor}
        type="button"
        className="wf-wiki-pagetool"
        title="Diese Seite umbenennen oder löschen"
        aria-label="Diese Seite umbenennen oder löschen"
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        <Ellipsis />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={230}>
        <MenuItem
          icon={<PenLine />}
          onClick={() => {
            setOpen(false);
            setTitle(doc.title);
          }}
        >
          Seite umbenennen …
        </MenuItem>
        {canRemove && doc.kind === 'page' && (
          <MenuItem
            icon={<Trash2 />}
            onClick={() => {
              setOpen(false);
              void remove();
            }}
          >
            Seite löschen
          </MenuItem>
        )}
      </Popover>
      {title !== null && (
        <Dialog
          open
          onClose={() => setTitle(null)}
          title="Seite umbenennen"
          width={460}
          footer={
            <>
              <Button onClick={() => setTitle(null)}>Abbrechen</Button>
              <Button variant="primary" onClick={rename}>
                Speichern
              </Button>
            </>
          }
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              rename();
            }}
          >
            <Field label="Name der Seite" hint="Steht im Reiter über dem Text.">
              <Input
                value={title}
                data-autofocus
                placeholder="z. B. Geschichte"
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
          </form>
        </Dialog>
      )}
    </>
  );
}
