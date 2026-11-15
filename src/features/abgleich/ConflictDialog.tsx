/**
 * „Abgleich: Das entscheidest du“ (Entwurf 1.8). Öffnet nur auf einen Klick und erst nach einem
 * frischen Lauf (`openDecide`). Die nicht gewählte Fassung geht nie verloren: Der Ablauf legt sie
 * beiseite (Einstellungen → Abgleich → „Beiseitegelegte Fassungen“).
 */
import { useEffect, useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import { useData } from '../../data/hooks';
import { foldDiff, lineDiff } from '../../domain/versions';
import { Button, Dialog, toast } from '../../ui';
import { DiffView } from '../wiki/Versions';
import type { Choice } from './engine';
import { activeSync, useSync } from './index';
import {
  canApply,
  conflictCards,
  decidedToast,
  other,
  type CardRow,
  type ConflictCard,
} from './model';
import { closeDecide, useSurface } from './open';
import './abgleich.css';

/** Text in die Zwischenablage; der Text selbst bleibt markierbar, falls das nicht geht. */
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: 'Text kopiert' });
  } catch {
    toast({ title: 'Kopieren ging nicht', body: 'Markiere den Text und kopiere ihn von Hand.' });
  }
}

function LongRow({ row, device }: { row: CardRow; device: string | null }) {
  const parts = useMemo(() => foldDiff(lineDiff(row.here, row.there)), [row.here, row.there]);
  const dev = other(device);
  return (
    <div className="wf-abgleich-row wf-abgleich-row--long">
      <div className="wf-abgleich-row__label">{row.label}</div>
      <DiffView
        parts={parts}
        marks={{ added: `nur ${dev.at}`, removed: 'nur hier' }}
        label={`Unterschied: hier und ${dev.at}`}
        same="Beide Texte lauten gleich."
      />
      <div className="wf-row-wrap">
        <Button size="sm" icon={<Copy />} onClick={() => void copy(row.here)}>
          Text von hier kopieren
        </Button>
        <Button size="sm" icon={<Copy />} onClick={() => void copy(row.there)}>
          Text {dev.from} kopieren
        </Button>
      </div>
    </div>
  );
}

function Card({
  card,
  device,
  choice,
  onChoose,
}: {
  card: ConflictCard;
  device: string | null;
  choice: Choice | undefined;
  onChoose: (choice: Choice) => void;
}) {
  const dev = other(device);
  return (
    <section className="wf-abgleich-card" aria-label={card.heading}>
      <h3 className="wf-abgleich-card__head">{card.heading}</h3>
      {card.stamps && <div className="wf-abgleich-card__stamps">{card.stamps}</div>}
      {card.lead && <p className="wf-abgleich-card__lead">{card.lead}</p>}
      {card.rows.length > 0 && (
        <div className="wf-abgleich-rows">
          {card.rows.map((row, i) =>
            row.long ? (
              <LongRow key={i} row={row} device={device} />
            ) : (
              <div key={i} className="wf-abgleich-row">
                <div className="wf-abgleich-row__label">{row.label}</div>
                <div className="wf-abgleich-row__side">
                  <span className="wf-caps">hier</span> {row.here}
                </div>
                <div className="wf-abgleich-row__side">
                  <span className="wf-caps">{dev.name}</span> {row.there}
                </div>
              </div>
            ),
          )}
        </div>
      )}
      <div className="wf-btn-group wf-abgleich-card__choice" role="group" aria-label="Wahl">
        {card.options.map((option) => (
          <Button
            key={option.choice}
            aria-pressed={choice === option.choice}
            onClick={() => onChoose(option.choice)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {card.note && <p className="wf-abgleich-card__note">{card.note}</p>}
    </section>
  );
}

export function ConflictDialog() {
  const surface = useSurface();
  const view = useSync();
  const data = useData();
  const open = surface.decide === 'open';
  const self = view.link?.device ?? null;
  const cards = useMemo(
    () => conflictCards(view.conflicts, { data, self, peer: view.peer }),
    [view.conflicts, data, self, view.peer],
  );
  const [choices, setChoices] = useState<Record<string, Choice | undefined>>({});
  useEffect(() => {
    if (open) setChoices(Object.fromEntries(cards.map((c) => [c.id, c.preset ?? undefined])));
    // Nur beim Öffnen vorbelegen; danach gilt, was der Spielleiter wählt.
  }, [open]);
  const remoteDevice = view.conflicts[0]?.remote.device ?? view.other.device;
  const device = remoteDevice && remoteDevice !== self ? remoteDevice : view.peer;

  const apply = async () => {
    const chosen = Object.fromEntries(
      Object.entries(choices).filter((e): e is [string, Choice] => !!e[1]),
    );
    // Erst schließen: Solange ein Dialog offen ist, wendet der Abgleich nichts an.
    closeDecide();
    const sync = activeSync();
    if (!sync) return;
    try {
      await sync.engine.decide(chosen);
      toast(decidedToast(Object.keys(chosen).length));
    } catch (e) {
      toast({
        title: 'Nicht abgeglichen',
        body: e instanceof Error ? e.message : String(e),
        tone: 'danger',
      });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={closeDecide}
      title="Abgleich: Das entscheidest du"
      width={760}
      guard={false}
      footer={
        <>
          <Button onClick={closeDecide}>Später entscheiden</Button>
          <Button variant="primary" disabled={!canApply(choices)} onClick={() => void apply()}>
            Anwenden und abgleichen
          </Button>
        </>
      }
    >
      <div className="wf-abgleich-decide">
        <p className="wf-soft">
          Diese Einträge wurden an beiden Rechnern geändert. Was sich nicht widerspricht, hat
          Wayfarer schon zusammengeführt. Bis du entscheidest, bleibt auf jedem Rechner seine
          Fassung dieser Einträge; alles andere wird abgeglichen.
        </p>
        {cards.map((card) => (
          <Card
            key={card.id}
            card={card}
            device={device}
            choice={choices[card.id]}
            onChoose={(choice) => setChoices((c) => ({ ...c, [card.id]: choice }))}
          />
        ))}
        {!cards.length && <p className="wf-mute">Nichts wartet mehr auf eine Entscheidung.</p>}
      </div>
    </Dialog>
  );
}
