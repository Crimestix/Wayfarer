/**
 * „Buch“ auf der Seite eines Gegenstands: Verfasser, Entstehung, welche Einträge darin stehen,
 * Vorwort und die Seiten – jede aus dem Artikel des Spielleiters oder in den Worten des
 * Verfassers. Dazu das Buch auf Pergament zum Lesen und Drucken. Was im Buch steht, rechnet
 * `domain/book.ts`; geschrieben wird über `./book.ts`.
 */
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { BookOpen, PenLine, Printer, RotateCcw, ScrollText, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  BOOK_ORDER_LABEL,
  bookView,
  isReadable,
  type BookPageView,
  type BookView,
} from '../../domain/book';
import { datePointText, readDatePoint } from '../../domain/lifespan';
import { BOOK_ORDERS, type BookOrder, type Item } from '../../domain/schema';
import { focusOn } from '../../shell/focus';
import {
  Button,
  Checkbox,
  Dialog,
  EntityLink,
  EntityRefsEditor,
  Field,
  IconButton,
  Select,
  Written,
  confirmDialog,
  toast,
} from '../../ui';
import { usePrint } from '../handouts/print';
import {
  pageToHandout,
  patchBook,
  patchSelection,
  resetBookPage,
  setInBook,
  setIsBook,
  writeBookPage,
} from './book';
import { BookPaper } from './BookPaper';
import { Hint, Picker, Section, useInlineText } from './parts';
import './book.css';

/** So viele Seiten stehen zuerst in der Liste; der Rest auf Wunsch. */
const PAGES_SHOWN = 40;

/** Der Schalter „Ist ein Buch“ – neben dem Verbleib. */
export function BookSwitch({ item }: { item: Item }) {
  const db = useDb();
  const book = item.item.book;
  const change = async (on: boolean) => {
    if (!on && book && (Object.keys(book.pages).length > 0 || book.intro.trim())) {
      const ok = await confirmDialog({
        title: 'Kein Buch mehr?',
        body: 'Vorwort und die Seiten in den Worten des Verfassers gehen dabei verloren.',
        confirmLabel: 'Kein Buch mehr',
        danger: true,
      });
      if (!ok) return;
    }
    setIsBook(db, item.id, on);
  };
  return (
    <Section title="Buch">
      <Checkbox checked={book !== null} onChange={(on) => void change(on)}>
        Ist ein Buch
      </Checkbox>
      {!book && (
        <p className="wf-welt-booksec__sum">
          Ein Kräuterbuch, eine Chronik, ein Bestiarium: Die Seiten kommen aus deinen Artikeln.
        </p>
      )}
    </Section>
  );
}

/** Der Abschnitt „Buch“ – nur, wenn der Gegenstand ein Buch ist. */
export function BookSection({ item }: { item: Item }) {
  const db = useDb();
  const data = useData();
  const book = item.item.book;
  const view = useMemo(() => bookView(data, item), [data, item]);
  const [reading, setReading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { print, layer } = usePrint();
  if (!book || !view) return null;

  const cal = data.campaign.calendar;
  const { selection } = book;
  const saveWritten = (text: string) => {
    if (!text.trim()) return patchBook(db, item.id, { written: null });
    const written = readDatePoint(cal, text, data.state.now);
    if (written) patchBook(db, item.id, { written });
    else
      toast({
        title: 'Das verstehe ich nicht',
        body: `„${text.trim()}“ – zum Beispiel „3. Tauwind 667“, „667“ oder „vor 300 Jahren“.`,
        tone: 'danger',
      });
  };
  let left = showAll ? Infinity : PAGES_SHOWN;
  const groups = view.allGroups
    .map((group) => {
      const pages = group.pages.slice(0, Math.max(0, left));
      left -= pages.length;
      return { ...group, pages };
    })
    .filter((group) => group.pages.length > 0);
  const total = view.pageCount + view.withheldCount;
  const hidden = total - groups.reduce((sum, group) => sum + group.pages.length, 0);

  return (
    <Section
      title="Buch"
      count={view.pageCount}
      action={
        <div className="wf-row">
          <Button size="sm" variant="ghost" icon={<BookOpen />} onClick={() => setReading(true)}>
            Lesen
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Printer />}
            onClick={() => print(<BookPaper view={view} />)}
          >
            Drucken
          </Button>
        </div>
      }
    >
      <div className="wf-welt-booksec">
        <p className="wf-welt-booksec__sum">
          {summary(view)} Die Seiten stellt Wayfarer aus deinen Artikeln zusammen – ohne Geheimes.
          Was der Verfasser anders sieht, schreibst du auf seiner Seite in seinen Worten.
        </p>

        <div className="wf-welt-booksec__grid">
          <Field label="Verfasser">
            <Picker
              value={book.authorId}
              onChange={(authorId) => patchBook(db, item.id, { authorId })}
              kinds={['person', 'character', 'faction', 'family']}
              placeholder="Wer hat es geschrieben?"
            />
            {!book.authorId && (
              <Written
                label="Verfasser in Worten"
                value={book.authorText}
                placeholder="oder in Worten: „Bruder Anselm aus Graufels“"
                onSave={(authorText) => patchBook(db, item.id, { authorText: authorText.trim() })}
              />
            )}
          </Field>
          <Field
            label="Entstanden"
            hint={!book.written && item.born ? 'wie der Gegenstand' : undefined}
          >
            <Written
              label="Entstanden"
              value={datePointText(cal, book.written)}
              placeholder={item.born ? datePointText(cal, item.born) : 'z. B. 667'}
              onSave={saveWritten}
            />
          </Field>
          <Field label="Ordnung">
            <Select
              value={book.order}
              onChange={(e) => patchBook(db, item.id, { order: e.target.value as BookOrder })}
            >
              {BOOK_ORDERS.map((order) => (
                <option key={order} value={order}>
                  {BOOK_ORDER_LABEL[order]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="wf-welt-booksec__grid">
          <Field label="Einzeln dazu">
            <EntityRefsEditor
              value={selection.include}
              onChange={(include) => patchSelection(db, item.id, { include })}
              placeholder="Eintrag hinzufügen …"
            />
          </Field>
          <Field label="Einzeln weg">
            <EntityRefsEditor
              value={selection.exclude}
              onChange={(exclude) => patchSelection(db, item.id, { exclude })}
              placeholder="Eintrag weglassen …"
            />
          </Field>
        </div>

        <Field label="Vorwort">
          <Written
            label="Vorwort"
            rows={3}
            value={book.intro}
            placeholder="Was der Verfasser seinem Buch voranstellt – in seinen Worten."
            onSave={(intro) => patchBook(db, item.id, { intro: intro.trim() })}
          />
        </Field>

        {total === 0 ? (
          <Hint>
            Noch steht keine Seite darin – wähle oben Arten, Gegenden oder Einordnungen, oder nimm
            einzelne Einträge dazu.
          </Hint>
        ) : (
          <ul className="wf-welt-booksec__pages">
            {groups.map((group) => (
              <li key={group.label}>
                <div className="wf-welt-booksec__group">{group.label}</div>
                <ul className="wf-welt-booksec__pages">
                  {group.pages.map((page) => (
                    <PageRow key={page.entityId} item={item} view={view} page={page} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
              {hidden === 1 ? 'Noch 1 Seite zeigen' : `Noch ${hidden} Seiten zeigen`}
            </Button>
          </div>
        )}
      </div>

      <Dialog
        open={reading}
        onClose={() => setReading(false)}
        title={view.title}
        width={760}
        guard={false}
        footer={
          <>
            <Button icon={<Printer />} onClick={() => print(<BookPaper view={view} />)}>
              Drucken
            </Button>
            <Button onClick={() => setReading(false)}>Schließen</Button>
          </>
        }
      >
        <BookPaper view={view} onOpen={() => setReading(false)} />
      </Dialog>
      {layer}
    </Section>
  );
}

/** „Verfasser: Ilka Sturmfels. Entstanden 667. 12 Seiten, 2 in den Worten des Verfassers.“ */
function summary(view: BookView): string {
  const by = [
    view.author && `Verfasser: ${view.author}.`,
    view.written && `Entstanden ${view.written}.`,
  ]
    .filter(Boolean)
    .join(' ');
  const pages = view.pageCount === 1 ? '1 Seite' : `${view.pageCount} Seiten`;
  const own = view.ownCount ? `, ${view.ownCount} in den Worten des Verfassers` : '';
  const withheld = !view.withheldCount
    ? ''
    : view.withheldCount === 1
      ? ' 1 Eintrag fehlt, weil sein Artikel verborgen ist.'
      : ` ${view.withheldCount} Einträge fehlen, weil ihr Artikel verborgen ist.`;
  return `${by ? `${by} ` : ''}${pages}${own}.${withheld}`;
}

function PageRow({ item, view, page }: { item: Item; view: BookView; page: BookPageView }) {
  const db = useDb();
  const [, navigate] = useLocation();
  const written = item.item.book?.pages[page.entityId]?.text ?? '';
  const { editing, start, editor } = useInlineText(
    page.own ? written : page.source,
    (text) => writeBookPage(db, item.id, page.entityId, text, page.source),
    (text) => writeBookPage(db, item.id, page.entityId, text, page.source),
  );
  const reset = async () => {
    const ok = await confirmDialog({
      title: 'Auf den Artikel zurücksetzen?',
      body: 'Die Seite in den Worten des Verfassers geht verloren; danach steht dort wieder der Artikel.',
      confirmLabel: 'Zurücksetzen',
      danger: true,
    });
    if (ok) resetBookPage(db, item.id, page.entityId);
  };
  const toHandout = () => {
    const handout = pageToHandout(db, view, page);
    toast({
      title: 'Handout angelegt',
      body: handout.title,
      action: {
        label: 'Öffnen',
        run: () => {
          focusOn({ type: 'handout', id: handout.id });
          navigate('/handouts');
        },
      },
    });
  };
  const note = page.own
    ? page.changed
      ? 'In den Worten des Verfassers · der Artikel hat sich seither geändert'
      : 'In den Worten des Verfassers'
    : page.withheld
      ? 'Der Artikel ist vor den Spielern verborgen – die Seite fehlt im Buch, bis du sie überschreibst'
      : !page.articleId
        ? 'Kein Artikel – die Seite bleibt leer, bis du sie überschreibst'
        : '';
  return (
    <li className="wf-welt-booksec__page">
      <div className="wf-welt-booksec__row">
        <EntityLink id={page.entityId} />
        <span className="wf-grow" />
        {!editing && (
          <IconButton
            label={page.own ? 'Seite ändern' : 'Seite überschreiben'}
            size="sm"
            variant="ghost"
            onClick={start}
          >
            <PenLine />
          </IconButton>
        )}
        {page.own && !editing && (
          <IconButton
            label="Auf den Artikel zurücksetzen"
            size="sm"
            variant="ghost"
            onClick={() => void reset()}
          >
            <RotateCcw />
          </IconButton>
        )}
        {isReadable(page) && (
          <IconButton label="Als Handout übernehmen" size="sm" variant="ghost" onClick={toHandout}>
            <ScrollText />
          </IconButton>
        )}
        <IconButton
          label="Aus dem Buch nehmen"
          size="sm"
          variant="ghost"
          onClick={() => setInBook(db, item.id, [page.entityId], false)}
        >
          <X />
        </IconButton>
      </div>
      {note && (
        <span
          className={
            page.changed
              ? 'wf-welt-booksec__note wf-welt-booksec__note--warn'
              : 'wf-welt-booksec__note'
          }
        >
          {note}
        </span>
      )}
      {editor}
    </li>
  );
}
