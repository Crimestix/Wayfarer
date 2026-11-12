/**
 * Einen Statblock als Text einfügen: Wayfarer liest, was dasteht, und zeigt vor dem Übernehmen,
 * was es verstanden hat – und was nicht.
 */
import { useMemo, useState } from 'react';
import { useDb } from '../../data/hooks';
import { DEFAULT_BLOCK, speedText, statsOf, typeLine } from '../../domain/creature';
import type { Creature } from '../../domain/schema';
import { Button, Dialog, Field, Input, TextArea } from '../../ui';
import { importStatblock } from './actions';
import { parseStatblock } from './parse';

export function PasteDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (creature: Creature) => void;
}) {
  const db = useDb();
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const parsed = useMemo(() => parseStatblock(text), [text]);
  const block = parsed ? { ...DEFAULT_BLOCK, ...parsed.block } : null;
  const stats = block ? statsOf(block) : null;
  const missing = parsed
    ? [
        parsed.block.abilities ? '' : 'Attribute',
        parsed.block.ac === undefined ? 'Rüstungsklasse' : '',
        parsed.block.hitDice === undefined && parsed.block.hp === undefined ? 'Trefferpunkte' : '',
        parsed.block.cr === undefined ? 'Herausforderungsgrad' : '',
      ].filter(Boolean)
    : [];
  return (
    <Dialog
      open
      onClose={onClose}
      title="Statblock als Text einfügen"
      width={860}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            disabled={!parsed}
            onClick={() => parsed && onSaved(importStatblock(db, parsed, source))}
          >
            Übernehmen
          </Button>
        </>
      }
    >
      <div className="wf-best-paste">
        <div className="wf-col">
          <Field
            label="Statblock"
            hint="Deutsch oder englisch, aus einem Buch abgetippt, aus eigenen Notizen oder von D&D Beyond kopiert."
          >
            <TextArea
              value={text}
              rows={18}
              autoFocus
              placeholder={'Name\nGröße Typ, Gesinnung\nRüstungsklasse …\nTrefferpunkte …'}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <Field label="Quelle" hint="Woher der Statblock stammt – etwa ein Buch mit Seite.">
            <Input value={source} onChange={(event) => setSource(event.target.value)} />
          </Field>
        </div>
        <div className="wf-best-paste__read">
          <div className="wf-best-bar__kind">Das liest Wayfarer</div>
          {!parsed || !block || !stats ? (
            <p className="wf-mute">
              Füge links einen Statblock ein. Hier steht dann, was Wayfarer verstanden hat – bevor
              etwas übernommen wird.
            </p>
          ) : (
            <>
              <div className="wf-best-block__name">{parsed.name}</div>
              <div className="wf-best-block__type">{typeLine(block)}</div>
              <div className="wf-best-lines">
                <div className="wf-best-line">
                  <b>RK</b> {block.ac} · <b>TP</b> {stats.hp}
                  {block.hp === null ? ` (${stats.hpFormula})` : ''} · <b>HG</b> {block.cr}
                </div>
                <div className="wf-best-line">
                  <b>Bewegung</b> {speedText(block)}
                </div>
                <div className="wf-best-line">
                  <b>Fähigkeiten</b>{' '}
                  {parsed.features.length
                    ? parsed.features
                        .map((feature) => feature.name + (feature.attack ? ' (Angriff)' : ''))
                        .join(', ')
                    : 'keine erkannt'}
                </div>
              </div>
              {missing.length > 0 && (
                <p className="wf-best-check wf-best-check--high">
                  Nicht gefunden: {missing.join(', ')}. Das lässt sich nach dem Übernehmen
                  nachtragen.
                </p>
              )}
              {parsed.unread.length > 0 && (
                <div className="wf-best-paste__unread">
                  <b>Nicht zugeordnet – bitte selbst prüfen:</b>
                  {parsed.unread.map((line, index) => (
                    <span key={index}>{line}</span>
                  ))}
                </div>
              )}
              {!missing.length && !parsed.unread.length && (
                <p className="wf-mute">Alles zugeordnet.</p>
              )}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
