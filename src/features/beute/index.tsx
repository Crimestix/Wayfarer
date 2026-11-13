/**
 * Das Beute-Buch: was die Gruppe bekommen hat – nach Abenden –, wer was hat, und was noch
 * bereitliegt. Wayfarer führt kein Inventar; es merkt sich, was hinausging, damit nichts
 * verloren geht. Die Rechnung steht in `domain/loot.ts`.
 */
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ClipboardCopy, Coins, HandCoins, Pencil, Plus, Undo2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { formatGold, lootBook, lootLine, lootRecipient, receivedText } from '../../domain/loot';
import type { Loot } from '../../domain/schema';
import { formatDayMonth } from '../../domain/time/calendar';
import { Button, EmptyState, IconButton, Panel, entityHref, toast } from '../../ui';
import { takeBackLoot } from './actions';
import { LootDialog } from './LootDialog';
import { useGiveLoot } from './useGive';
import './beute.css';

type OpenDialog = { loot?: Loot; give?: boolean } | null;

export default function BeutePage() {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const book = useMemo(() => lootBook(data), [data]);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const empty = book.ready.length === 0 && book.sessions.length === 0;

  const give = useGiveLoot();
  const copy = async (sessionId: string) => {
    const text = receivedText(data, sessionId);
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: 'Kopiert',
        body: 'Die Liste liegt in der Zwischenablage – zum Einfügen im Gruppenchat.',
      });
    } catch {
      toast({ title: 'Kopieren ging nicht', body: text, tone: 'danger', duration: 12000 });
    }
  };

  return (
    <div className="wf-page wf-beute">
      <header className="wf-page__head wf-beute-head">
        <h1 className="wf-page__title">Beute-Buch</h1>
        <span className="wf-beute-head__sub">
          {book.gold > 0 ? `${formatGold(book.gold)} ausgegeben` : 'Was die Gruppe bekommen hat'}
        </span>
        <span className="wf-grow" />
        <Button icon={<Plus />} onClick={() => setDialog({})}>
          Bereitlegen
        </Button>
        <Button variant="primary" icon={<HandCoins />} onClick={() => setDialog({ give: true })}>
          Beute ausgeben
        </Button>
      </header>

      {empty ? (
        <div className="wf-beute-blank">
          <EmptyState icon={<Coins />} title="Noch keine Beute">
            Hier steht, was die Gruppe bekommt: jede Ausgabe mit Abend, Ort, Herkunft und Empfänger.
            Das Inventar führen deine Spieler selbst – das Beute-Buch sorgt nur dafür, dass nichts
            verloren geht. Beute kannst du bereitlegen (auch unter „Abend vorbereiten“) und am
            Spieltisch mit einem Klick ausgeben.
          </EmptyState>
        </div>
      ) : (
        <div className="wf-beute-body">
          <div className="wf-beute-main">
            {book.ready.length > 0 && (
              <Panel title="Liegt bereit" count={book.ready.length} flush>
                {book.ready.map((loot) => (
                  <Row
                    key={loot.id}
                    loot={loot}
                    onEdit={() => setDialog({ loot })}
                    action={
                      <Button size="sm" icon={<HandCoins />} onClick={() => give(loot)}>
                        Ausgeben
                      </Button>
                    }
                  />
                ))}
              </Panel>
            )}
            {book.sessions.map(({ session, entries, gold }) => (
              <Panel
                key={session?.id ?? 'ohne'}
                title={session ? `Session ${session.number}` : 'Ohne Abend'}
                count={entries.length}
                flush
                actions={
                  <>
                    {gold > 0 && <span className="wf-beute-sum">{formatGold(gold)}</span>}
                    {session && (
                      <Button
                        size="sm"
                        icon={<ClipboardCopy />}
                        onClick={() => void copy(session.id)}
                        title="Die Beute dieses Abends als Text kopieren – zum Einfügen im Gruppenchat"
                      >
                        Kopieren
                      </Button>
                    )}
                  </>
                }
              >
                {entries.map((loot) => (
                  <Row
                    key={loot.id}
                    loot={loot}
                    when={loot.at === null ? '' : formatDayMonth(cal, loot.at)}
                    onEdit={() => setDialog({ loot })}
                    action={
                      <IconButton
                        label="Zurücknehmen – die Beute liegt dann wieder bereit"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const undo = takeBackLoot(db, loot.id);
                          if (undo)
                            toast({
                              title: 'Zurückgenommen',
                              body: 'Die Beute liegt wieder bereit.',
                              action: { label: 'Rückgängig', run: undo },
                            });
                        }}
                      >
                        <Undo2 />
                      </IconButton>
                    }
                  />
                ))}
              </Panel>
            ))}
          </div>

          <aside className="wf-beute-side">
            <Panel title="Wer was hat" flush>
              {book.shares.map((share) => (
                <div key={share.character?.id ?? 'gruppe'} className="wf-beute-share">
                  <div className="wf-beute-share__head">
                    {share.character ? (
                      <Link href={entityHref(share.character)} className="wf-beute-share__name">
                        {share.character.name}
                      </Link>
                    ) : (
                      <span className="wf-beute-share__name">Die Gruppe</span>
                    )}
                    <span className="wf-beute-sum">
                      {share.gold > 0 ? formatGold(share.gold) : '–'}
                    </span>
                  </div>
                  {share.items
                    .filter((loot) => loot.text.trim() || loot.itemId)
                    .map((loot) => (
                      <div key={loot.id} className="wf-beute-share__item">
                        {lootLine(data, { ...loot, gold: 0 })}
                      </div>
                    ))}
                </div>
              ))}
              <p className="wf-beute-note">
                Gezählt wird, was ausgegeben wurde – nicht, was die Gefährten davon noch haben.
              </p>
            </Panel>
          </aside>
        </div>
      )}

      {dialog && (
        <LootDialog loot={dialog.loot} give={dialog.give} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function Row({
  loot,
  when,
  action,
  onEdit,
}: {
  loot: Loot;
  when?: string;
  action: React.ReactNode;
  onEdit: () => void;
}) {
  const data = useData();
  const story = loot.storyId ? data.stories[loot.storyId] : undefined;
  const place = loot.placeId ? data.entities[loot.placeId] : undefined;
  return (
    <div className="wf-beute-row">
      <div className="wf-beute-row__main">
        <div className="wf-beute-row__what">{lootLine(data, loot)}</div>
        <div className="wf-beute-row__meta">
          <span className="wf-beute-row__to">
            {loot.given ? 'an' : 'für'} {lootRecipient(data, loot)}
          </span>
          {when && <span>{when}</span>}
          {place && <span>{place.name}</span>}
          {loot.source && <span>{loot.source}</span>}
          {story && <span>{story.title}</span>}
        </div>
      </div>
      {action}
      <IconButton label="Eintrag ändern" size="sm" variant="ghost" onClick={onEdit}>
        <Pencil />
      </IconButton>
    </div>
  );
}
