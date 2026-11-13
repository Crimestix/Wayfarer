/**
 * Handouts: Briefe, Notizen, Erlasse und Hinweiskarten schreiben, auf Pergament ansehen und
 * drucken. Links die Liste, in der Mitte das Schreiben, rechts das Blatt. Die Rechnung steht in
 * `domain/handout.ts`.
 */
import { useMemo, useState } from 'react';
import { Check, FileText, Plus, Printer, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { useFocus } from '../../shell/focus';
import {
  HANDOUT_KIND_HINT,
  HANDOUT_KIND_LABEL,
  handoutList,
  handoutSources,
  prepHintCards,
} from '../../domain/handout';
import { HANDOUT_KINDS, type Handout, type HandoutKind } from '../../domain/schema';
import { formatDayMonth } from '../../domain/time/calendar';
import {
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  Panel,
  Select,
  TextArea,
  cx,
  toast,
} from '../../ui';
import { giveHandout, removeHandout, saveHandout } from './actions';
import { Paper } from './Paper';
import { usePrint } from './print';
import './handouts.css';

export default function HandoutsPage() {
  const db = useDb();
  const data = useData();
  const list = useMemo(() => handoutList(data), [data]);
  const [selectedId, setSelectedId] = useState<string | null>(list[0]?.id ?? null);
  const selected = selectedId ? data.handouts[selectedId] : undefined;
  useFocus(['handout'], (focus) => setSelectedId(focus.id));
  const { print, layer } = usePrint();
  const cards = useMemo(() => prepHintCards(data), [data]);

  const create = (kind: HandoutKind = 'letter') => {
    const handout = saveHandout(db, { kind, title: '' });
    setSelectedId(handout.id);
  };
  const printOne = (handout: Handout) =>
    handout.kind === 'card'
      ? print(
          <div className="wf-print-cards">
            <Paper {...handout} />
          </div>,
        )
      : print(<Paper {...handout} />);
  const printCards = () => {
    const own = list.filter((handout) => handout.kind === 'card' && handout.givenAt === null);
    print(
      <div className="wf-print-cards">
        {own.map((handout) => (
          <Paper key={handout.id} {...handout} />
        ))}
        {cards.map((card) => (
          <Paper
            key={card.key}
            kind="card"
            title=""
            text={card.text}
            signature={card.story}
            seal=""
          />
        ))}
      </div>,
    );
  };

  return (
    <div className="wf-page wf-handouts">
      <header className="wf-page__head">
        <h1 className="wf-page__title wf-grow">Handouts</h1>
        <Button
          icon={<Printer />}
          onClick={printCards}
          disabled={!cards.length && !list.some((h) => h.kind === 'card' && h.givenAt === null)}
          title="Alle offenen Hinweiskarten und die Geheimnisse vom Abend-Blatt – acht je Blatt"
        >
          Hinweiskarten drucken
        </Button>
        <Button variant="primary" icon={<Plus />} onClick={() => create()}>
          Neues Handout
        </Button>
      </header>
      {list.length === 0 ? (
        <div className="wf-handouts-blank">
          <EmptyState icon={<FileText />} title="Noch kein Handout">
            Briefe, Botschaften, Aushänge und Hinweiskarten für deine Spieler: schreiben, auf
            Pergament ansehen, drucken. Schriftstücke aus der Chronik lassen sich übernehmen; die
            Geheimnisse vom Abend-Blatt werden mit einem Klick zu Hinweiskarten.
          </EmptyState>
        </div>
      ) : (
        <div className="wf-handouts-body">
          <Panel title="Alle" count={list.length} flush className="wf-handouts-list">
            {list.map((handout) => (
              <button
                key={handout.id}
                type="button"
                className={cx(
                  'wf-handouts-item',
                  handout.id === selectedId && 'wf-handouts-item--on',
                  handout.givenAt !== null && 'wf-handouts-item--given',
                )}
                onClick={() => setSelectedId(handout.id)}
              >
                <span className="wf-handouts-item__title">{handout.title || 'Ohne Titel'}</span>
                <span className="wf-handouts-item__meta">
                  {HANDOUT_KIND_LABEL[handout.kind]}
                  {handout.givenAt !== null &&
                    ` · übergeben am ${formatDayMonth(data.campaign.calendar, handout.givenAt)}`}
                </span>
              </button>
            ))}
          </Panel>
          {selected ? (
            <Editor
              key={selected.id}
              handout={selected}
              onPrint={() => printOne(selected)}
              onRemoved={() => setSelectedId(null)}
            />
          ) : (
            <div className="wf-handouts-pick">Wähle links ein Handout.</div>
          )}
        </div>
      )}
      {layer}
    </div>
  );
}

function Editor({
  handout,
  onPrint,
  onRemoved,
}: {
  handout: Handout;
  onPrint: () => void;
  onRemoved: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [draft, setDraft] = useState(handout);
  const sources = useMemo(() => handoutSources(data), [data]);
  const stories = Object.values(data.stories)
    .filter((story) => !story.closed)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
  const set = (change: Partial<Handout>) => {
    setDraft((current) => ({ ...current, ...change }));
    saveHandout(db, change, handout.id);
  };
  const remove = () => {
    const undo = removeHandout(db, handout.id);
    onRemoved();
    if (undo) toast({ title: 'Handout gelöscht', action: { label: 'Rückgängig', run: undo } });
  };
  const give = () => {
    const undo = giveHandout(db, handout.id);
    if (undo)
      toast({
        title: 'Übergeben',
        body: 'Steht in der Mitschrift.',
        action: { label: 'Rückgängig', run: undo },
      });
  };
  const take = (sourceId: string) => {
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return;
    set({ sourceId, text: source.text, title: draft.title || source.title });
  };

  return (
    <>
      <Panel
        title="Schreiben"
        className="wf-handouts-write"
        actions={
          <IconButton label="Handout löschen" size="sm" variant="ghost" onClick={remove}>
            <Trash2 />
          </IconButton>
        }
      >
        <div className="wf-col" style={{ gap: 'var(--s-3)' }}>
          <div className="wf-form-grid">
            <Field label="Titel" hint="Für dich; beim Erlass steht er oben auf dem Blatt.">
              <Input
                value={draft.title}
                placeholder="Brief an die Gruppe"
                onChange={(event) => set({ title: event.target.value })}
              />
            </Field>
            <Field label="Art" hint={HANDOUT_KIND_HINT[draft.kind]}>
              <Select
                value={draft.kind}
                aria-label="Art des Handouts"
                onChange={(event) => set({ kind: event.target.value as HandoutKind })}
              >
                {HANDOUT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {HANDOUT_KIND_LABEL[kind]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {sources.length > 0 && (
            <Field label="Aus einem Schriftstück übernehmen" hint="Ersetzt den Wortlaut unten.">
              <Select
                value=""
                aria-label="Aus einem Schriftstück übernehmen"
                onChange={(event) => take(event.target.value)}
              >
                <option value="">Schriftstück wählen …</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title} ({source.from})
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Wortlaut" hint="Eine Leerzeile beginnt einen neuen Absatz.">
            <TextArea
              rows={10}
              value={draft.text}
              onChange={(event) => set({ text: event.target.value })}
            />
          </Field>
          <div className="wf-form-grid">
            <Field label="Unterschrift">
              <Input
                value={draft.signature}
                placeholder="— K."
                onChange={(event) => set({ signature: event.target.value })}
              />
            </Field>
            <Field label="Siegel" hint="Ein oder zwei Buchstaben; leer = keins.">
              <Input
                value={draft.seal}
                maxLength={2}
                onChange={(event) => set({ seal: event.target.value })}
              />
            </Field>
          </div>
          <Field label="Gehört zur Geschichte">
            <Select
              value={draft.storyId ?? ''}
              aria-label="Gehört zur Geschichte"
              onChange={(event) => set({ storyId: event.target.value || null })}
            >
              <option value="">zu keiner</option>
              {stories.map((story) => (
                <option key={story.id} value={story.id}>
                  {story.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Panel>
      <div className="wf-handouts-preview">
        <div className="wf-handouts-preview__bar">
          <Button icon={<Printer />} onClick={onPrint}>
            Drucken
          </Button>
          {handout.givenAt === null ? (
            <Button
              icon={<Check />}
              onClick={give}
              title="Die Gruppe hat es bekommen – mit Zeile in der Mitschrift"
            >
              Übergeben
            </Button>
          ) : (
            <span className="wf-mute">
              übergeben am {formatDayMonth(data.campaign.calendar, handout.givenAt)}
            </span>
          )}
        </div>
        <div className="wf-handouts-preview__desk">
          <Paper {...draft} />
        </div>
      </div>
    </>
  );
}
