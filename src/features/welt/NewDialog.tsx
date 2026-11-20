/**
 * Das eine „Neu“ der Welt: Name und Art – mehr braucht es nicht. Der Steckbrief der Art steht
 * danach gleich auf der Seite. Gibt es den Namen schon, öffnet sich der vorhandene Eintrag statt
 * eines zweiten (`newEntry`, `entryForTitle`). Auf Wunsch gleich der Text mit dem Gerüst.
 */
import { KindSelect } from './KindSelect';
import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight, Plus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL } from '../../domain/derive';
import type { EntityKind } from '../../domain/schema';
import { Button, Checkbox, Dialog, Field, Input } from '../../ui';
import { openForWriting } from '../wiki';
import { entryForTitle } from '../wiki/facts';
import { newArticleParent } from '../wiki/gaps';
import { scaffoldOf } from '../wiki/scaffold';
import { linkIndex } from '../wiki/text';
import { closeNew, useNewRequest, type NewRequest } from './editor';
import { isWorldKind, wordChoices } from './model';
import { templateFor } from '../../domain/pageTemplate';
import { draftTitle, newEntry } from './writing';

/** Hängt am Gerüst der Welt-Seite: öffnet sich über `openNew` von überall. */
export function NewDialogHost() {
  const request = useNewRequest();
  if (!request) return null;
  return <NewDialog request={request} />;
}

function NewDialog({ request }: { request: NewRequest }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const [name, setName] = useState(request.name ?? '');
  const [kind, setKind] = useState<EntityKind | null>(
    // Ohne Vorgabe beginnt „Neu“ als freier Text – eingeordnet wird später, wenn überhaupt (F01).
    request.kind === undefined ? null : request.kind,
  );
  const [ownKindId, setOwnKindId] = useState<string | null>(request.ownKindId ?? null);
  const [withText, setWithText] = useState(request.withText ?? kind === null);
  const [inFolder, setInFolder] = useState(true);
  /** Das eigene Wort unter der Kategorie – mit ihm kommt die eigene Vorlage. */
  const [word, setWord] = useState('');
  const [useTemplate, setUseTemplate] = useState(true);
  const clean = name.replace(/\s+/g, ' ').trim();
  const template = kind && word.trim() ? templateFor(data.campaign, kind, word) : null;
  const words = kind && isWorldKind(kind) ? wordChoices(data, kind) : [];

  // Gibt es den Namen schon? Dann wird nur geöffnet – nie ein zweiter.
  const owner = clean ? entryForTitle(data, clean) : null;
  const existing = owner ? ('free' in owner ? owner.free : owner.taken) : null;
  const found =
    !existing && kind === null && clean ? linkIndex(data.articles).resolve(clean) : null;
  const existingText = found ? (data.articles[found.id] ?? null) : null;
  const labels = kind ? scaffoldOf(data.campaign, kind) : [];
  const writes = kind === null || withText || (!!template && useTemplate);
  const folder = writes ? newArticleParent(data.articles, kind, []) : null;

  // Ein freier Text braucht keinen Namen: Er heißt „Entwurf“, bis er einen bekommt.
  const freeDraft = kind === null && !clean;
  const submit = () => {
    if (!clean && !freeDraft) return;
    const result = newEntry(db, {
      name: clean || draftTitle(db.getSnapshot().articles),
      kind,
      withText: writes,
      parentId: folder && inFolder ? folder.id : null,
      word,
      ownKindId,
      ...(template && useTemplate ? { template: template.text } : {}),
    });
    closeNew();
    if (!result) return;
    if (result.created && writes && result.article) openForWriting();
    if (result.entity) navigate(`/welt/${result.entity.id}`);
    else if (result.article) navigate(`/wiki/${result.article.id}`);
  };

  const opening = existing !== null || existingText !== null;
  return (
    <Dialog
      open
      onClose={closeNew}
      title="Neu"
      width={500}
      footer={
        <>
          <span className="wf-grow" />
          <Button onClick={closeNew}>Abbrechen</Button>
          <Button
            variant="primary"
            icon={opening ? <ArrowRight /> : <Plus />}
            disabled={!clean && !freeDraft}
            onClick={submit}
          >
            {opening ? 'Öffnen' : kind === null ? 'Schreiben' : 'Anlegen'}
          </Button>
        </>
      }
    >
      <form
        className="wf-col wf-welt-new"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="Name">
          <Input
            value={name}
            data-autofocus
            placeholder={
              kind === null
                ? 'Darf leer bleiben – der Text heißt dann „Entwurf“'
                : 'z. B. Salzgrotte, Mira Tannhaus, Die Lotsen …'
            }
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {existing ? (
          <p className="wf-welt-new__found" role="status">
            „{existing.name}“ gibt es schon ({KIND_LABEL[existing.kind]}) – die Eingabetaste öffnet
            die Seite.
          </p>
        ) : existingText ? (
          <p className="wf-welt-new__found" role="status">
            Einen Text „{existingText.title}“ gibt es schon – die Eingabetaste öffnet ihn.
          </p>
        ) : null}
        {!existing && (
          <Field
            label="Kategorie"
            hint={
              kind
                ? labels.length
                  ? `Steckbrief: ${labels.join(', ')} – steht gleich auf der Seite.`
                  : 'Ohne Steckbrief-Felder; eigene lassen sich jederzeit dazuschreiben.'
                : 'Nur ein Text, ohne Art – eine Art lässt sich später festlegen.'
            }
          >
            <KindSelect
              textOption
              value={{ kind: kind && isWorldKind(kind) ? kind : null, ownKindId }}
              onChange={(next) => {
                setKind(next.kind);
                setOwnKindId(next.ownKindId);
                if (next.kind === null) setWithText(true);
              }}
            />
          </Field>
        )}
        {!existing && kind !== null && (
          <Field
            label="Genauer"
            hint={
              template
                ? `Du hast eine eigene Vorlage für „${template.word}“.`
                : 'Dein eigenes Wort: Fischerdorf, Gilde, Tagebuch, Pilz … – frei, nie Pflicht.'
            }
          >
            <Input
              value={word}
              list="wf-welt-new-words"
              aria-label="Genauer"
              placeholder={words.slice(0, 3).join(', ') + (words.length ? ' …' : '')}
              onChange={(e) => setWord(e.target.value)}
            />
            <datalist id="wf-welt-new-words">
              {words.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
          </Field>
        )}
        {!opening && template && (
          <Checkbox checked={useTemplate} onChange={setUseTemplate}>
            Mit deiner Vorlage für „{template.word}“ anfangen
          </Checkbox>
        )}
        {!opening && kind !== null && !(template && useTemplate) && (
          <Checkbox checked={withText} onChange={setWithText}>
            Gleich den Text anfangen
          </Checkbox>
        )}
        {!opening && writes && folder && (
          <Checkbox checked={inFolder} onChange={setInFolder}>
            Den Text unter „{folder.title}“ ablegen
          </Checkbox>
        )}
      </form>
    </Dialog>
  );
}
