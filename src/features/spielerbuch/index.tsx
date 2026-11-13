/**
 * Das Spielerbuch: was die Gruppe weiß und vermutet – „Für dich“ mit dem Stand der Vermutungen,
 * „Für die Spieler“ sauber, ohne alles, was nur die Spielleitung weiß. Was darin steht, sammelt
 * `playerBook()` in `domain/playerBook.ts`; die Worte kommen aus `./model`.
 */
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { BookUser, ClipboardCopy, Lightbulb } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { playerBook, type BookSection, type BookThing } from '../../domain/playerBook';
import type { CampaignData, Guess } from '../../domain/schema';
import { formatDayMonth } from '../../domain/time/calendar';
import { useFocus } from '../../shell/focus';
import { Button, EmptyState, Panel, SectionTitle, Tabs, cx, entityHref, toast } from '../../ui';
import { GuessDialog } from './GuessDialog';
import { GuessRow } from './GuessRow';
import { bookLine, handoutBody, playerBookText, type BookAudience } from './model';
import './spielerbuch.css';

const AUDIENCE_TABS: { id: BookAudience; label: string }[] = [
  { id: 'gm', label: 'Für dich' },
  { id: 'players', label: 'Für die Spieler' },
];

type OpenDialog = { guess?: Guess } | null;

export default function SpielerbuchPage() {
  const db = useDb();
  const data = useData();
  const book = useMemo(() => playerBook(data), [data]);
  const [audience, setAudience] = useState<BookAudience>('gm');
  const [dialog, setDialog] = useState<OpenDialog>(null);
  // Ein Treffer der Suche öffnet die Vermutung zum Ändern.
  useFocus(['guess'], (focus) => {
    const guess = db.getSnapshot().guesses[focus.id];
    if (guess) setDialog({ guess });
  });
  const things = book.sections.filter((s) => s.sort === 'things');
  const rest = book.sections.filter((s) => s.sort !== 'things');

  const copy = async () => {
    const text = playerBookText(db.getSnapshot(), 'players');
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: 'Für die Spieler kopiert',
        body: 'Das Spielerbuch liegt in der Zwischenablage – ohne Geheimnisse und ohne den Stand der Vermutungen.',
      });
    } catch {
      toast({ title: 'Kopieren ging nicht', body: text, tone: 'danger', duration: 12000 });
    }
  };
  const view = { data, audience, onEdit: (guess: Guess) => setDialog({ guess }) };

  return (
    <div className="wf-page wf-spielerbuch">
      <header className="wf-page__head wf-spielerbuch-head">
        <h1 className="wf-page__title">Spielerbuch</h1>
        <span className="wf-spielerbuch-head__sub">
          {audience === 'gm' && book.openGuesses > 0
            ? book.openGuesses === 1
              ? '1 Vermutung noch offen'
              : `${book.openGuesses} Vermutungen noch offen`
            : 'Was die Gruppe weiß und vermutet'}
        </span>
        <span className="wf-grow" />
        <Tabs tabs={AUDIENCE_TABS} value={audience} onChange={setAudience} />
        <Button icon={<ClipboardCopy />} onClick={copy} disabled={!book.sections.length}>
          Für die Spieler kopieren
        </Button>
        <Button variant="primary" icon={<Lightbulb />} onClick={() => setDialog({})}>
          Vermutung festhalten
        </Button>
      </header>

      {book.sections.length === 0 ? (
        <div className="wf-spielerbuch-blank">
          <EmptyState icon={<BookUser />} title="Noch steht nichts im Spielerbuch">
            Hier sammelt sich, was die Gruppe weiß: wen sie getroffen hat, wo sie war, was sie
            gehört, gefunden und bekommen hat – aus allem, was du festhältst und nicht als „nur für
            die Spielleitung“ markierst. Dazu die Vermutungen der Spieler; ob sie stimmen, siehst
            nur du.
          </EmptyState>
        </div>
      ) : (
        <div
          className={cx(
            'wf-spielerbuch-body',
            audience === 'players' && 'wf-spielerbuch-body--players',
          )}
        >
          {things.length > 0 && (
            <Panel title="Wen und was die Gruppe kennt" scroll className="wf-spielerbuch-col">
              {things.map((section) => (
                <Section key={section.id} section={section} {...view} />
              ))}
            </Panel>
          )}
          {rest.length > 0 && (
            <Panel title="Was sie erfahren hat" scroll className="wf-spielerbuch-col">
              {rest.map((section) => (
                <Section key={section.id} section={section} {...view} />
              ))}
            </Panel>
          )}
        </div>
      )}

      {dialog && <GuessDialog guess={dialog.guess} onClose={() => setDialog(null)} />}
    </div>
  );
}

interface ViewProps {
  data: CampaignData;
  audience: BookAudience;
  onEdit: (guess: Guess) => void;
}

const count = (section: BookSection): number => {
  switch (section.sort) {
    case 'things':
      return section.things.length;
    case 'lines':
      return section.entries.length;
    case 'handouts':
      return section.handouts.length;
    case 'guesses':
      return section.guesses.length;
  }
};

function Section({ section, ...view }: ViewProps & { section: BookSection }) {
  const { data, audience } = view;
  return (
    <section className="wf-spielerbuch-sec">
      <SectionTitle>
        {section.label}
        <span className="wf-spielerbuch-sec__count">{count(section)}</span>
      </SectionTitle>
      {section.sort === 'things' && (
        <div className="wf-spielerbuch-things">
          {section.things.map((thing) => (
            <Thing key={thing.id} thing={thing} {...view} />
          ))}
        </div>
      )}
      {section.sort === 'lines' && (
        <ul className="wf-spielerbuch-lines">
          {section.entries.map((entry) => (
            <li key={entry.id} className="wf-prose">
              {bookLine(data, entry, audience)}
            </li>
          ))}
        </ul>
      )}
      {section.sort === 'handouts' && (
        <ul className="wf-spielerbuch-lines">
          {section.handouts.map((handout) => (
            <li key={handout.id}>
              <span className="wf-spielerbuch-handout__title">
                {handout.title.trim() || 'Ohne Titel'}
              </span>
              <span className="wf-mute">
                {' '}
                · übergeben am {formatDayMonth(data.campaign.calendar, handout.givenAt!)}
              </span>
              {handoutBody(handout) && (
                <div className="wf-prose wf-spielerbuch-handout__text">{handoutBody(handout)}</div>
              )}
            </li>
          ))}
        </ul>
      )}
      {section.sort === 'guesses' && (
        <div className="wf-spielerbuch-guesses">
          {section.guesses.map((guess) => (
            <GuessRow key={guess.id} guess={guess} {...view} />
          ))}
        </div>
      )}
    </section>
  );
}

function Thing({ thing, ...view }: ViewProps & { thing: BookThing }) {
  const { data, audience } = view;
  const entity = thing.kind === 'story' ? undefined : data.entities[thing.id];
  const href = entity ? entityHref(entity) : `/geschichte/${thing.id}`;
  const older = thing.lineCount - thing.lines.length;
  return (
    <div className="wf-spielerbuch-thing">
      <Link href={href} className="wf-spielerbuch-thing__name">
        {thing.name}
      </Link>
      {thing.lines.length > 0 && (
        <ul className="wf-spielerbuch-thing__lines">
          {older > 0 && (
            <li className="wf-spielerbuch-thing__older">
              {older === 1 ? '1 frühere Zeile' : `${older} frühere Zeilen`}
            </li>
          )}
          {thing.lines.map((entry) => (
            <li key={entry.id} className="wf-prose">
              {bookLine(data, entry, audience)}
            </li>
          ))}
        </ul>
      )}
      {thing.guesses.length > 0 && (
        <div className="wf-spielerbuch-guesses">
          {thing.guesses.map((guess) => (
            <GuessRow key={guess.id} guess={guess} {...view} />
          ))}
        </div>
      )}
    </div>
  );
}
