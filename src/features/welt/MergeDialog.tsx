/**
 * „Zusammenlegen“: zwei Einträge zu einem (`merge.ts`). Das Fenster fragt, mit wem – und welcher
 * von beiden bleibt –, sagt in zwei Sätzen, was geschieht, und legt auf Klick zusammen (mit
 * Rückgängig). Dazu `NameTwinsNote` für die Übersicht der Welt: Namen, die es doppelt gibt.
 */
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useData, useDb } from '../../data/hooks';
import { kindPathOf } from '../../domain/ownKind';
import { Button, Dialog, DismissButton, Field, toast } from '../../ui';
import { closeMerge, openMerge, useMergeRequest, type MergeRequest } from './editor';
import { mergeEntities, nameTwins, referencesTo } from './merge';
import { WORLD_KINDS, isWorldEntity, type WorldEntity } from './model';
import { Picker } from './parts';

export function MergeDialogHost() {
  const request = useMergeRequest();
  return request ? (
    <MergeDialog key={`${request.id}:${request.withId ?? ''}`} request={request} />
  ) : null;
}

function MergeDialog({ request }: { request: MergeRequest }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const first = data.entities[request.id];
  const twin = useMemo(
    () =>
      isWorldEntity(first)
        ? (nameTwins(data)
            .find((group) => group.entities.some((entity) => entity.id === first.id))
            ?.entities.find((entity) => entity.id !== first.id)?.id ?? null)
        : null,
    // Nur beim Öffnen: Der Vorschlag soll nicht springen, während man wählt.
    [],
  );
  const [otherId, setOtherId] = useState<string | null>(request.withId ?? twin);
  /** Welcher bleibt – zu Beginn der, von dessen Seite man kommt. */
  const [keepId, setKeepId] = useState(request.id);
  const other = otherId ? data.entities[otherId] : undefined;
  if (!isWorldEntity(first)) return null;
  const pair: WorldEntity[] = isWorldEntity(other) ? [first, other] : [first];
  const keep = pair.find((entity) => entity.id === keepId) ?? first;
  const drop = pair.find((entity) => entity.id !== keep.id);
  const refs = drop ? referencesTo(data, drop.id) : 0;
  const bothTexts =
    !!drop &&
    !!keep.lk &&
    !!drop.lk &&
    keep.lk.resourceId !== drop.lk.resourceId &&
    !!data.articles[keep.lk.resourceId] &&
    !!data.articles[drop.lk.resourceId];

  const merge = () => {
    if (!drop) return;
    const result = mergeEntities(db, keep.id, drop.id);
    closeMerge();
    if (!result) return;
    navigate(`/welt/${result.keepId}`);
    toast({
      title: `Zusammengelegt: „${result.name}“`,
      body: [
        result.moved === 0
          ? 'Nichts zeigte auf den anderen Eintrag.'
          : `${result.moved === 1 ? 'Eine Stelle zeigt' : `${result.moved} Stellen zeigen`} jetzt hierher.`,
        result.textJoined
          ? 'Der Text des anderen steht darunter; sein Artikel liegt im Papierkorb.'
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      duration: 15000,
      action: { label: 'Rückgängig', run: result.undo },
    });
  };

  return (
    <Dialog
      open
      onClose={closeMerge}
      title="Zusammenlegen"
      width={560}
      guard={false}
      footer={
        <>
          <span className="wf-grow" />
          <Button onClick={closeMerge}>Abbrechen</Button>
          <Button variant="primary" disabled={!drop} onClick={merge}>
            Zusammenlegen
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <Field
          label={`„${first.name}“ zusammenlegen mit`}
          hint="Für Einträge, die dasselbe sind – etwa wenn es einen Namen doppelt gibt."
        >
          <Picker
            value={otherId}
            onChange={setOtherId}
            kinds={[...WORLD_KINDS]}
            exclude={[first.id]}
            placeholder="Den anderen Eintrag wählen …"
            openOnMount={!otherId}
          />
        </Field>
        {drop && (
          <>
            <Field label="Es bleibt" hint="Der andere geht in ihm auf – mit Namen als Beiname.">
              <div className="wf-btn-group wf-welt-merge__keep" role="group" aria-label="Es bleibt">
                {pair.map((entity) => (
                  <Button
                    key={entity.id}
                    aria-pressed={keep.id === entity.id}
                    onClick={() => setKeepId(entity.id)}
                  >
                    {entity.name} · {kindPathOf(data, entity)}
                  </Button>
                ))}
              </div>
            </Field>
            <p className="wf-soft">
              {refs === 0
                ? `Auf „${drop.name}“ (${kindPathOf(data, drop)}) zeigt sonst nichts.`
                : `Alles, was auf „${drop.name}“ (${kindPathOf(data, drop)}) zeigt – ${refs === 1 ? 'eine Stelle' : `${refs} Stellen`}: Orte darin, Personen dort, Beziehungen, Chronik –, zeigt danach auf „${keep.name}“.`}{' '}
              Notizen und Geheimnis kommen zusammen.
              {bothTexts &&
                ' Beide haben einen Text: Der des anderen steht danach unter dem des Bleibenden, sein Artikel liegt im Papierkorb.'}
              {keep.kind !== drop.kind &&
                ` Angaben, die nur ${kindPathOf(data, drop)} hat, fallen weg.`}
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Auf der Übersicht der Welt: Namen, die es doppelt gibt. Ein Klick öffnet „Zusammenlegen“ mit
 * beiden; „×“ heißt „sind verschieden“ (zurückzuholen unter den ausgeblendeten Vorschlägen).
 */
export function NameTwinsNote() {
  const data = useData();
  const twins = useMemo(() => nameTwins(data), [data]);
  if (!twins.length) return null;
  return (
    <section className="wf-welt-ownpanel" aria-label="Doppelte Namen">
      <div className="wf-welt-ownpanel__head">
        <span className="wf-caps">Doppelte Namen</span>
        <span className="wf-mute">
          {twins.length === 1 ? 'Ein Name steht' : `${twins.length} Namen stehen`} mehrfach in der
          Welt. Ist es dasselbe, lege sie zusammen.
        </span>
      </div>
      <div className="wf-welt-ownpanel__suggest">
        {twins.slice(0, 24).map((group) => (
          <span key={group.key} className="wf-welt-ownchip">
            <button
              type="button"
              title={`${group.entities.map((entity) => kindPathOf(data, entity)).join(' und ')} – zusammenlegen …`}
              onClick={() =>
                openMerge({ id: group.entities[0]!.id, withId: group.entities[1]!.id })
              }
            >
              {group.name}{' '}
              <em>{group.entities.map((entity) => kindPathOf(data, entity)).join(' · ')}</em>
            </button>
            <DismissButton suggestionKey={group.key} what="Doppelter Name" />
          </span>
        ))}
        {twins.length > 24 && <span className="wf-mute">und {twins.length - 24} weitere</span>}
      </div>
    </section>
  );
}
