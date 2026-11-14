/**
 * Abschnitt „Papierkorb“: gelöschte Artikel mit Datum. Wiederherstellen legt den Artikel mit
 * seiner Kennung wieder an (`restoreArticle`); endgültig entfernen nur nach Rückfrage
 * (`purgeArticle`). Die Liste liest `trashEntries` aus `wiki/model.ts`.
 */
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ArchiveRestore, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { Button, Field, IconButton, Input, confirmDialog, toast } from '../../ui';
import { purgeArticle, restoreArticle } from '../wiki/actions';
import { trashEntries, type TrashEntry } from '../wiki/model';
import { formatRealTime } from './backup';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function TrashRow({ entry }: { entry: TrashEntry }) {
  const db = useDb();
  const [, navigate] = useLocation();
  const [look, setLook] = useState(false);
  /** Der neue Titel, wenn der alte inzwischen vergeben ist; `null`: noch nicht gefragt. */
  const [title, setTitle] = useState<string | null>(null);
  const { article, version } = entry;

  const restore = (name?: string) => {
    const result = restoreArticle(db, version.id, name);
    if (result === 'taken' || result === 'empty') {
      setTitle(name ?? article.title);
      return;
    }
    if (result === 'missing') return;
    toast({
      title: `„${result.article.title}“ ist wieder da`,
      body:
        result.article.parentId === article.parentId
          ? 'An seinem alten Platz im Baum.'
          : 'Sein alter Platz im Baum ist nicht mehr da – er steht jetzt ganz oben.',
      action: { label: 'Öffnen', run: () => navigate(`/wiki/${result.article.id}`) },
      duration: 9000,
    });
  };

  const purge = async () => {
    const ok = await confirmDialog({
      title: `„${article.title}“ endgültig entfernen?`,
      body:
        entry.versions > 0
          ? `Der Artikel und ${count(entry.versions, 'frühere Fassung', 'frühere Fassungen')} werden entfernt. Das lässt sich nicht zurücknehmen.`
          : 'Der Artikel wird entfernt. Das lässt sich nicht zurücknehmen.',
      confirmLabel: 'Endgültig entfernen',
      danger: true,
    });
    if (ok) purgeArticle(db, version.id);
  };

  const clean = title?.replace(/\s+/g, ' ').trim() ?? '';

  return (
    <li className="wf-einstellungen-trash__row">
      <div className="wf-einstellungen-trash__main">
        <div className="wf-einstellungen-trash__title">{article.title}</div>
        <div className="wf-einstellungen-trash__meta">
          gelöscht am {formatRealTime(version.savedAt)} ·{' '}
          {entry.pages > 1 ? `${entry.pages} Seiten, ` : ''}
          {count(entry.words, 'Wort', 'Wörter')}
          {entry.versions > 0 &&
            ` · ${count(entry.versions, 'frühere Fassung', 'frühere Fassungen')}`}
        </div>
        {entry.taken && title === null && (
          <div className="wf-einstellungen-trash__note">
            Ein anderer Artikel heißt inzwischen auch so – beim Wiederherstellen braucht er einen
            anderen Titel.
          </div>
        )}
        {title !== null && (
          <form
            className="wf-einstellungen-trash__rename"
            onSubmit={(event) => {
              event.preventDefault();
              if (clean) restore(clean);
            }}
          >
            <Field
              label="Titel beim Wiederherstellen"
              hint="Dieser Titel ist vergeben. Unter welchem soll der Artikel zurückkommen?"
            >
              <Input value={title} data-autofocus onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <div className="wf-row" style={{ gap: 'var(--s-2)' }}>
              <Button onClick={() => setTitle(null)}>Abbrechen</Button>
              <Button type="submit" icon={<ArchiveRestore />} disabled={!clean}>
                Unter diesem Titel wiederherstellen
              </Button>
            </div>
          </form>
        )}
        {look && (
          <div className="wf-einstellungen-trash__text">
            {version.text || <span className="wf-mute">(ohne Text)</span>}
          </div>
        )}
      </div>
      <div className="wf-einstellungen-trash__do">
        <IconButton
          label={look ? 'Text verbergen' : 'Text ansehen'}
          size="sm"
          variant="ghost"
          onClick={() => setLook((open) => !open)}
        >
          {look ? <EyeOff /> : <Eye />}
        </IconButton>
        <Button
          size="sm"
          icon={<ArchiveRestore />}
          disabled={title !== null}
          onClick={() => restore()}
        >
          Wiederherstellen
        </Button>
        <IconButton
          label="Endgültig entfernen"
          size="sm"
          variant="ghost"
          onClick={() => void purge()}
        >
          <Trash2 />
        </IconButton>
      </div>
    </li>
  );
}

export function TrashSection() {
  const data = useData();
  const entries = useMemo(() => trashEntries(data), [data]);
  if (!entries.length)
    return (
      <p className="wf-mute">
        Der Papierkorb ist leer. Löschst du einen Artikel, liegt er hier, bis du ihn
        wiederherstellst oder endgültig entfernst.
      </p>
    );
  return (
    <ul className="wf-einstellungen-trash" aria-label="Gelöschte Artikel">
      {entries.map((entry) => (
        <TrashRow key={entry.version.id} entry={entry} />
      ))}
    </ul>
  );
}
