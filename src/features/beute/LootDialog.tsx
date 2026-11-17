/**
 * Beute bereitlegen, ändern oder gleich ausgeben: was es ist, wie viel Gold, für wen, woher. Wer
 * am Tisch etwas ausgibt, das nicht vorbereitet war, tut es hier in einem Zug (`give`).
 */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entitiesOfKind } from '../../domain/derive';
import { createEntity, type Loot } from '../../domain/schema';
import { Button, Dialog, EntityPicker, Field, Input, Select, toast } from '../../ui';
import { parseGold } from '../../domain/loot';
import { giveLoot, removeLoot, saveLoot } from './actions';
import './beute.css';

export function LootDialog({
  loot,
  give,
  storyId,
  preset,
  onClose,
}: {
  /** Vorhandener Eintrag zum Ändern; sonst entsteht ein neuer. */
  loot?: Loot;
  /** Ein neuer Eintrag wird gleich ausgegeben (am Tisch). */
  give?: boolean;
  /** Für einen neuen Eintrag: die Geschichte, zu der er gehört. */
  storyId?: string | null;
  /** Für einen neuen Eintrag: was die Mitschrift schon sagt („/beute 30 Gold für Mira“). */
  preset?: { text: string; gold: number | null; toId: string | null };
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [text, setText] = useState(loot?.text ?? preset?.text ?? '');
  const [gold, setGold] = useState(
    loot?.gold
      ? loot.gold.toLocaleString('de-DE')
      : preset?.gold
        ? preset.gold.toLocaleString('de-DE')
        : '',
  );
  const [itemId, setItemId] = useState<string | null>(loot?.itemId ?? null);
  const [toId, setToId] = useState<string | null>(loot?.toId ?? preset?.toId ?? null);
  const [source, setSource] = useState(loot?.source ?? '');
  const [story, setStory] = useState<string | null>(loot?.storyId ?? storyId ?? null);
  /**
   * Was, Gold, für wen reichen fast immer. Gegenstand der Welt, Herkunft und Geschichte stehen
   * hinter „Mehr …“ – offen, wenn darin schon etwas steht oder die Geschichte nicht vorgegeben ist.
   */
  const [more, setMore] = useState(
    !!loot?.itemId || !!loot?.source || (!!loot?.storyId && loot.storyId !== storyId),
  );

  const parsed = parseGold(gold);
  const badGold = parsed === null;
  const amount = parsed ?? 0;
  const ready = !badGold && (text.trim() !== '' || amount > 0 || itemId !== null);
  const characters = entitiesOfKind(data, 'character').sort((a, b) =>
    a.name.localeCompare(b.name, 'de'),
  );
  const stories = Object.values(data.stories)
    .filter((entry) => !entry.closed || entry.id === story)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));

  const save = () => {
    if (!ready) return;
    const saved = saveLoot(
      db,
      { text, gold: amount, itemId, toId, source, storyId: story },
      loot?.id,
    );
    onClose();
    if (!saved || !give || loot) return;
    const undo = giveLoot(db, saved.id);
    toast({
      title: 'Beute ausgegeben',
      body: 'Steht im Beute-Buch und in der Mitschrift.',
      action: undo
        ? {
            label: 'Rückgängig',
            run: () => {
              undo();
              removeLoot(db, saved.id);
            },
          }
        : undefined,
    });
  };
  const remove = () => {
    if (!loot) return;
    const undo = removeLoot(db, loot.id);
    onClose();
    if (undo) toast({ title: 'Eintrag gelöscht', action: { label: 'Rückgängig', run: undo } });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={loot ? 'Beute ändern' : give ? 'Beute ausgeben' : 'Beute bereitlegen'}
      width={560}
      footer={
        <>
          {loot && (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={remove}
              style={{ marginRight: 'auto' }}
            >
              Löschen
            </Button>
          )}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!ready} onClick={save}>
            {loot ? 'Speichern' : give ? 'Ausgeben' : 'Bereitlegen'}
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <Field label="Was" hint="In deinen Worten – ein Gegenstand, ein Lohn, ein Fund.">
          <Input
            autoFocus
            value={text}
            placeholder="Ein Kompass, der nach unten zeigt"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
            }}
          />
        </Field>
        <div className="wf-form-grid">
          <Field
            label="Gold"
            hint={
              badGold ? 'Eine Zahl wie 20, 12,5 oder 1.250 – oder leer lassen.' : 'In Goldmünzen.'
            }
          >
            <Input
              value={gold}
              inputMode="decimal"
              aria-invalid={badGold}
              placeholder="0"
              onChange={(event) => setGold(event.target.value)}
            />
          </Field>
          <Field label="Für wen" hint="Ein Gefährte – oder die Gruppe gemeinsam.">
            <Select
              value={toId ?? ''}
              aria-label="Für wen"
              onChange={(event) => setToId(event.target.value || null)}
            >
              <option value="">Die Gruppe</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {!more && (
          <button type="button" className="wf-beute-more" onClick={() => setMore(true)}>
            Mehr … Gegenstand der Welt, Herkunft
            {stories.length ? ', Geschichte' : ''}
            {story && data.stories[story] ? ` (gehört zu „${data.stories[story]!.title}“)` : ''}
          </button>
        )}
        {more && (
          <>
            <Field
              label="Gegenstand der Welt"
              hint="Nur wenn es ein besonderes Stück ist, das in deiner Welt steht. Es gehört danach dem, der es bekommt."
            >
              <EntityPicker
                value={itemId}
                onChange={setItemId}
                kinds={['item']}
                placeholder="Gegenstand wählen oder neu anlegen …"
                onCreate={(name) => db.put('entities', createEntity({ kind: 'item', name })).id}
              />
            </Field>
            <div className="wf-form-grid">
              <Field label="Woher" hint="Die Herkunft – für später.">
                <Input
                  value={source}
                  placeholder="aus dem Hort des Aalwächters"
                  onChange={(event) => setSource(event.target.value)}
                />
              </Field>
              <Field label="Gehört zur Geschichte">
                <Select
                  value={story ?? ''}
                  aria-label="Gehört zur Geschichte"
                  onChange={(event) => setStory(event.target.value || null)}
                >
                  <option value="">zu keiner</option>
                  {stories.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
