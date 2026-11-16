/**
 * Das eine „Neu“ der Welt: Name und Art – mehr braucht es nicht. Der Steckbrief der Art steht
 * danach gleich auf der Seite. Gibt es den Namen schon, öffnet sich der vorhandene Eintrag statt
 * eines zweiten (`newEntry`, `entryForTitle`). Auf Wunsch gleich der Text mit dem Gerüst.
 */
import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight, Plus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL } from '../../domain/derive';
import type { EntityKind } from '../../domain/schema';
import { Button, Checkbox, Dialog, Field, Input, Select } from '../../ui';
import { openForWriting } from '../wiki';
import { entryForTitle } from '../wiki/facts';
import { newArticleParent } from '../wiki/gaps';
import { scaffoldOf } from '../wiki/scaffold';
import { linkIndex } from '../wiki/text';
import { closeNew, useNewRequest, type NewRequest } from './editor';
import { COMMON_KINDS, WORLD_KINDS, isWorldKind } from './model';
import { newEntry } from './writing';

/** Hängt am Gerüst der Welt-Seite: öffnet sich über `openNew` von überall. */
export function NewDialogHost() {
  const request = useNewRequest();
  if (!request) return null;
  return <NewDialog request={request} />;
}

const NO_KIND = 'text';

function NewDialog({ request }: { request: NewRequest }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const [name, setName] = useState(request.name ?? '');
  const [kind, setKind] = useState<EntityKind | null>(
    request.kind === undefined ? 'person' : request.kind,
  );
  const [withText, setWithText] = useState(request.withText ?? kind === null);
  const [inFolder, setInFolder] = useState(true);
  const clean = name.replace(/\s+/g, ' ').trim();

  // Gibt es den Namen schon? Dann wird nur geöffnet – nie ein zweiter.
  const owner = clean ? entryForTitle(data, clean) : null;
  const existing = owner ? ('free' in owner ? owner.free : owner.taken) : null;
  const found =
    !existing && kind === null && clean ? linkIndex(data.articles).resolve(clean) : null;
  const existingText = found ? (data.articles[found.id] ?? null) : null;
  const labels = kind ? scaffoldOf(data.campaign, kind) : [];
  const writes = kind === null || withText;
  const folder = writes ? newArticleParent(data.articles, kind, []) : null;

  const submit = () => {
    if (!clean) return;
    const result = newEntry(db, {
      name: clean,
      kind,
      withText,
      parentId: folder && inFolder ? folder.id : null,
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
            disabled={!clean}
            onClick={submit}
          >
            {opening ? 'Öffnen' : 'Anlegen'}
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
            placeholder="z. B. Salzgrotte, Mira Tannhaus, Die Lotsen …"
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
            label="Art"
            hint={
              kind
                ? labels.length
                  ? `Steckbrief: ${labels.join(', ')} – steht gleich auf der Seite.`
                  : 'Ohne Steckbrief-Felder; eigene lassen sich jederzeit dazuschreiben.'
                : 'Nur ein Text, ohne Art – eine Art lässt sich später festlegen.'
            }
          >
            <Select
              value={kind ?? NO_KIND}
              aria-label="Art"
              onChange={(e) => {
                const next = isWorldKind(e.target.value) ? e.target.value : null;
                setKind(next);
                if (next === null) setWithText(true);
              }}
            >
              <optgroup label="Übliche">
                {COMMON_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {KIND_LABEL[option]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Weitere">
                {WORLD_KINDS.filter((option) => !COMMON_KINDS.includes(option)).map((option) => (
                  <option key={option} value={option}>
                    {KIND_LABEL[option]}
                  </option>
                ))}
                <option value={NO_KIND}>Nur ein Text, ohne Art</option>
              </optgroup>
            </Select>
          </Field>
        )}
        {!opening && kind !== null && (
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
