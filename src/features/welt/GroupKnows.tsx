/**
 * „Was die Gruppe weiß“ auf der Seite eines Eintrags: drei Schichten – was die Gruppe weiß, was
 * sie vermutet (mit Stand) und was nur die Spielleitung weiß. Die Rechnung steht in
 * `knowledgeOf()` (`domain/playerBook.ts`); das Geheimnis des Eintrags steht schon darüber.
 */
import { useMemo, useState } from 'react';
import { BookOpen, BookUser, EyeOff, Lightbulb } from 'lucide-react';
import { useData } from '../../data/hooks';
import { pagePlainText } from '../../domain/book';
import { knowledgeOf } from '../../domain/playerBook';
import type { Entity, Guess } from '../../domain/schema';
import { Button, EntityLink } from '../../ui';
import { GuessDialog } from '../spielerbuch/GuessDialog';
import { GuessRow } from '../spielerbuch/GuessRow';
import { bookLine } from '../spielerbuch/model';
import { Section } from './parts';

type OpenDialog = { guess?: Guess } | null;

export function GroupKnows({ entity }: { entity: Entity }) {
  const data = useData();
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const k = useMemo(() => knowledgeOf(data, entity.id), [data, entity.id]);
  const visible =
    k.inBook ||
    k.known.length > 0 ||
    k.books.length > 0 ||
    k.guesses.length > 0 ||
    k.secretCount > 0;
  const dialogs = dialog && (
    <GuessDialog
      guess={dialog.guess}
      preset={{ refs: [entity.id] }}
      onClose={() => setDialog(null)}
    />
  );
  if (!visible) return null;
  const olderKnown = k.knownCount - k.known.length;
  const olderSecret = k.secretCount - k.secretLines.length;

  return (
    <Section
      title="Was die Gruppe weiß"
      action={
        <Button size="sm" variant="ghost" icon={<Lightbulb />} onClick={() => setDialog({})}>
          Vermutung
        </Button>
      }
    >
      <div className="wf-welt-knows">
        {/* Weiß die Gruppe nur aus einem Buch etwas, steht das für sich. */}
        {(k.known.length > 0 || k.books.length === 0) && (
          <div className="wf-welt-knows__layer">
            <div className="wf-welt-knows__head">
              <BookUser />
              <span className="wf-caps">Weiß die Gruppe</span>
            </div>
            {k.known.length > 0 ? (
              <ul className="wf-welt-knows__lines">
                {olderKnown > 0 && (
                  <li className="wf-welt-knows__more">
                    {olderKnown === 1 ? '1 frühere Zeile' : `${olderKnown} frühere Zeilen`}
                  </li>
                )}
                {k.known.map((entry) => (
                  <li key={entry.id} className="wf-prose">
                    {bookLine(data, entry, 'players')}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="wf-welt-knows__more">
                {k.inBook
                  ? 'Die Gruppe kennt den Eintrag – mehr steht für sie noch nicht fest.'
                  : 'Die Gruppe kennt den Eintrag noch nicht.'}
              </div>
            )}
          </div>
        )}

        {k.books.map(({ bookId, page }) => {
          const text = pagePlainText(page);
          return (
            <div key={bookId} className="wf-welt-knows__layer">
              <div className="wf-welt-knows__head">
                <BookOpen />
                <span className="wf-caps">Weiß die Gruppe – aus</span>
                <EntityLink id={bookId} icon={false} />
              </div>
              {text ? (
                <div className="wf-prose wf-welt-knows__book">{text}</div>
              ) : (
                <div className="wf-welt-knows__more">Die Seite im Buch ist leer.</div>
              )}
              {page.own && (
                <div className="wf-welt-knows__more">
                  In den Worten des Verfassers – nicht unbedingt, wie es ist.
                </div>
              )}
            </div>
          );
        })}

        {k.guesses.length > 0 && (
          <div className="wf-welt-knows__layer">
            <div className="wf-welt-knows__head">
              <Lightbulb />
              <span className="wf-caps">Vermutet die Gruppe</span>
            </div>
            <div className="wf-col" style={{ gap: 'var(--s-1)' }}>
              {k.guesses.map((guess) => (
                <GuessRow
                  key={guess.id}
                  guess={guess}
                  audience="gm"
                  onEdit={(g) => setDialog({ guess: g })}
                />
              ))}
            </div>
          </div>
        )}

        {k.secretLines.length > 0 && (
          <div className="wf-welt-knows__layer wf-welt-knows__layer--secret">
            <div className="wf-welt-knows__head">
              <EyeOff />
              <span className="wf-caps">Nur du</span>
            </div>
            <ul className="wf-welt-knows__lines">
              {olderSecret > 0 && (
                <li className="wf-welt-knows__more">
                  {olderSecret === 1 ? '1 frühere Zeile' : `${olderSecret} frühere Zeilen`}
                </li>
              )}
              {k.secretLines.map((entry) => (
                <li key={entry.id} className="wf-prose">
                  {bookLine(data, entry, 'gm')}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {dialogs}
    </Section>
  );
}
