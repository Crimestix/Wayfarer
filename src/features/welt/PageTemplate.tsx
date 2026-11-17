/**
 * Am Rand der Seite eines Dings: leise Leitfragen zur Kategorie (wegklickbar, Inspiration statt
 * Felder) und „Als Vorlage für <Wort> merken“ – die Form dieser Seite wird die eigene Vorlage
 * für das nächste Ding mit diesem Wort (`domain/pageTemplate.ts`). Nichts davon ist Pflicht.
 */
import { BookmarkPlus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entityCategory } from '../../domain/derive';
import { SUGGESTION } from '../../domain/dismiss';
import { hasTemplateForm, pageQuestions, templateFor } from '../../domain/pageTemplate';
import type { Entity } from '../../domain/schema';
import { Button, DismissButton, toast } from '../../ui';
import { rememberPageTemplate } from '../wiki/actions';
import { pageText } from '../wiki/text';

export function PageTemplateTools({ entity }: { entity: Entity }) {
  const db = useDb();
  const data = useData();
  if (entity.kind === 'character') return null;
  const article = entity.lk ? data.articles[entity.lk.resourceId] : undefined;
  // Die Form steht auf der ersten Textseite (dort ist auch der Steckbrief).
  const first = article?.docs.find((doc) => doc.kind === 'page');
  const text = article && first ? pageText(data.articles, article, first) : '';
  const word = (entity.kind === 'person' ? entity.person.role : entityCategory(entity)).trim();
  const questions = pageQuestions(data, entity.kind, text);
  const saved = word ? templateFor(data.campaign, entity.kind, word) : null;
  const canRemember = !!word && hasTemplateForm(text);
  if (!questions.length && !canRemember) return null;
  const remember = () => {
    const undo = rememberPageTemplate(db, entity.kind, word, text);
    if (!undo) return;
    toast({
      title: `Vorlage für „${word}“ gemerkt`,
      body: 'Legst du das nächste Mal etwas mit diesem Wort an, bietet Wayfarer sie an.',
      action: { label: 'Rückgängig', run: undo },
    });
  };
  return (
    <aside className="wf-welt-template">
      {questions.length > 0 && (
        <div className="wf-welt-template__questions">
          <span className="wf-caps">Zum Weiterdenken</span>
          {questions.map((question) => (
            <span key={question} className="wf-welt-template__question">
              {question}
              <DismissButton
                suggestionKey={SUGGESTION.question(entity.kind, question)}
                what="Frage"
              />
            </span>
          ))}
        </div>
      )}
      {canRemember && (
        <Button
          size="sm"
          variant="ghost"
          icon={<BookmarkPlus />}
          title="Steckbrief-Zeilen, Überschriften und eigene Fragen dieser Seite – ohne den Text"
          onClick={remember}
        >
          {saved ? `Vorlage für „${word}“ neu merken` : `Als Vorlage für „${word}“ merken`}
        </Button>
      )}
    </aside>
  );
}
