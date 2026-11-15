/**
 * Frühere Fassungen eines Artikels: Liste mit Zeitpunkt und Größe der Änderung, eine Fassung
 * lesen oder mit dem heutigen Text vergleichen, und sie zurückholen. Die Befehle stehen in
 * `actions.ts`, die Rechnung in `domain/versions.ts`.
 */
import { useMemo, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import type { Article } from '../../domain/schema';
import { foldDiff, lineDiff, type DiffPart } from '../../domain/versions';
import { Badge, Button, Dialog, EmptyState, Tabs, cx, toast } from '../../ui';
import { formatRealTime } from '../einstellungen/backup';
import { restoreVersion } from './actions';
import { flushEdits } from './editing';
import { articleVersions, changeLabel, type VersionEntry } from './model';

/** Der Unterschied einer Fassung zum heutigen Text, Zeile für Zeile. */
export function DiffView({
  parts,
  marks = { added: 'erst heute', removed: 'nur damals' },
  same = 'Kein Unterschied – die Seite lautet heute genau so.',
  label = 'Unterschied zum heutigen Text',
}: {
  parts: DiffPart[];
  /** Was ein „+“ und ein „−“ bedeuten (für Screenreader). */
  marks?: { added: string; removed: string };
  same?: string;
  label?: string;
}) {
  if (!parts.some((part) => part.kind === 'added' || part.kind === 'removed'))
    return <p className="wf-mute">{same}</p>;
  return (
    <div className="wf-wiki-diff" aria-label={label}>
      {parts.map((part, index) =>
        part.kind === 'gap' ? (
          <div key={index} className="wf-wiki-diff__gap">
            {part.count === 1 ? '1 Zeile' : `${part.count} Zeilen`} unverändert
          </div>
        ) : (
          <div key={index} className="wf-wiki-diff__line" data-kind={part.kind}>
            <span
              className="wf-wiki-diff__mark"
              aria-label={
                part.kind === 'added'
                  ? marks.added
                  : part.kind === 'removed'
                    ? marks.removed
                    : undefined
              }
            >
              {part.kind === 'added' ? '+' : part.kind === 'removed' ? '−' : ''}
            </span>
            {part.kind === 'added' ? (
              <ins>{part.text || ' '}</ins>
            ) : part.kind === 'removed' ? (
              <del>{part.text || ' '}</del>
            ) : (
              <span>{part.text || ' '}</span>
            )}
          </div>
        ),
      )}
    </div>
  );
}

type Look = 'diff' | 'read';

export function VersionsDialog({ article, onClose }: { article: Article; onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const rows = useMemo(() => articleVersions(data, article), [data, article]);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [look, setLook] = useState<Look>('diff');
  const chosen: VersionEntry | undefined =
    rows.find((row) => row.version.id === chosenId) ?? rows[0];
  const parts = useMemo(
    () => (chosen ? foldDiff(lineDiff(chosen.version.text, chosen.now)) : []),
    [chosen],
  );

  const restore = () => {
    if (!chosen) return;
    flushEdits();
    const done = restoreVersion(db, chosen.version.id);
    if (!done) return;
    onClose();
    toast({
      title: 'Frühere Fassung zurückgeholt',
      body: `Stand vom ${formatRealTime(chosen.version.savedAt)}. Der Text von vorhin liegt jetzt selbst unter den früheren Fassungen.`,
      action: { label: 'Rückgängig', run: done.undo },
      duration: 9000,
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      guard={false}
      title={`Frühere Fassungen: ${article.title}`}
      width={rows.length ? 980 : 520}
      footer={
        <>
          <Button onClick={onClose}>Schließen</Button>
          {chosen && (
            <Button
              variant="primary"
              icon={<RotateCcw />}
              disabled={chosen.sameAsNow || !chosen.pageExists}
              title={
                !chosen.pageExists
                  ? 'Die Seite dieser Fassung gibt es nicht mehr.'
                  : chosen.sameAsNow
                    ? 'Die Seite lautet heute genau so.'
                    : undefined
              }
              onClick={restore}
            >
              Diese Fassung zurückholen
            </Button>
          )}
        </>
      }
    >
      {!chosen ? (
        <EmptyState icon={<History />} title="Noch keine früheren Fassungen">
          Sobald du den Text änderst, hebt Wayfarer den Wortlaut von vorher auf – höchstens einen je
          zehn Minuten Schreiben. Die jüngsten zwanzig bleiben, ältere einer je Tag.
        </EmptyState>
      ) : (
        <div className="wf-wiki-versions">
          <ol className="wf-wiki-versions__list" aria-label="Frühere Fassungen">
            {rows.map((row) => (
              <li key={row.version.id}>
                <button
                  type="button"
                  className={cx(
                    'wf-wiki-versions__row',
                    row === chosen && 'wf-wiki-versions__row--on',
                  )}
                  aria-current={row === chosen ? 'true' : undefined}
                  onClick={() => setChosenId(row.version.id)}
                >
                  <span className="wf-wiki-versions__when">
                    {formatRealTime(row.version.savedAt)}
                  </span>
                  <span className="wf-wiki-versions__what">
                    {row.page && <span>{row.page} · </span>}
                    danach {changeLabel(row.change)}
                  </span>
                  {(row.version.reason === 'restore' || row.sameAsNow) && (
                    <span className="wf-wiki-versions__tags">
                      {row.version.reason === 'restore' && <Badge>vor dem Zurückholen</Badge>}
                      {row.sameAsNow && <Badge tone="moss">wie heute</Badge>}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ol>
          <section className="wf-wiki-versions__detail" aria-label="Gewählte Fassung">
            <div className="wf-wiki-versions__head">
              <div>
                <div className="wf-wiki-versions__stand">
                  Stand vom {formatRealTime(chosen.version.savedAt)}
                </div>
                {chosen.version.title !== article.title && (
                  <div className="wf-mute">Damals hieß der Artikel „{chosen.version.title}“.</div>
                )}
              </div>
              <Tabs<Look>
                value={look}
                onChange={setLook}
                tabs={[
                  { id: 'diff', label: 'Vergleich mit heute' },
                  { id: 'read', label: 'Fassung lesen' },
                ]}
              />
            </div>
            {look === 'diff' ? (
              <>
                {chosen.pageExists ? (
                  <>
                    <p className="wf-wiki-versions__legend">
                      <span data-kind="removed">− durchgestrichen: stand damals da</span>
                      <span data-kind="added">+ unterstrichen: ist seither dazugekommen</span>
                    </p>
                    <DiffView parts={parts} />
                  </>
                ) : (
                  <p className="wf-mute">
                    Die Seite dieser Fassung gibt es nicht mehr – lesen lässt sie sich trotzdem.
                  </p>
                )}
              </>
            ) : (
              <div className="wf-wiki-versions__text">
                {chosen.version.text || <span className="wf-mute">(leer)</span>}
              </div>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
