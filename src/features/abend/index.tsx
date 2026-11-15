/**
 * „Abend vorbereiten“: das Blatt für einen Spielabend – geführt von oben nach unten, damit klar
 * ist, wo man anfängt: wo die Gruppe steht, die Gefährten, die Geschichten im Spiel (mit allem,
 * was sich davon auf den Abend legen lässt), ein starker Einstieg, mögliche Szenen, Geheimnisse,
 * Orte, Personen, Begegnungen, Beute. Jedes Fach ist freiwillig und lässt sich einklappen oder
 * für diesen Abend abwählen; der Rat am Rand nennt den nächsten sinnvollen Schritt zuerst.
 * Läuft ein Abend, gibt es zwei Blätter: seines und das des nächsten. Die Rechnung steht in
 * `domain/prep.ts` und `domain/prepOffers.ts`. Wayfarer schreibt nichts davon selbst.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Flame, Printer } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  prepAdvice,
  prepNext,
  prepStand,
  prepView,
  suggestedWhich,
  type PrepSection,
  type PrepView,
  type PrepWhich,
} from '../../domain/prep';
import { useFocus } from '../../shell/focus';
import { Button, SheetAdvice, Tabs, focusSheetSection } from '../../ui';
import { usePrint } from '../handouts/print';
import { setSkipped } from './actions';
import { Fach } from './Fach';
import { Leftovers } from './Leftovers';
import { spareNames } from './model';
import { PrepPaper } from './PrepPaper';
import { StoriesAction, StoriesBody } from './PrepStories';
import { PartyBody, WhereBody } from './PrepWhere';
import { EncountersAction, EncountersBody, LootBody, PeopleBody, PlacesBody } from './PrepWorld';
import { ScenesBody, SecretsBody, StartBody } from './PrepWriting';
import { SheetCtx } from './sheet';
import './abend.css';

/** Das Datum von heute, wie es an einer Session steht (JJJJ-MM-TT). */
const today = () => new Date().toISOString().slice(0, 10);

const BODY: Record<PrepSection, () => ReactNode> = {
  where: () => <WhereBody />,
  party: () => <PartyBody />,
  stories: () => <StoriesBody />,
  start: () => <StartBody />,
  scenes: () => <ScenesBody />,
  secrets: () => <SecretsBody />,
  places: () => <PlacesBody />,
  people: () => <PeopleBody />,
  encounters: () => <EncountersBody />,
  loot: () => <LootBody />,
};

const ACTION: Partial<Record<PrepSection, () => ReactNode>> = {
  stories: () => <StoriesAction />,
  encounters: () => <EncountersAction />,
};

export default function AbendPage() {
  const data = useData();
  // Läuft ein Abend von gestern noch, wird fast immer schon der nächste vorbereitet.
  const [asked, setAsked] = useState<PrepWhich>(() => suggestedWhich(data, today()));
  useFocus(['prep'], (focus) => setAsked(focus.which));

  const view = useMemo(() => prepView(data, asked), [data, asked]);
  // Wechselt das Blatt (eine Session beginnt oder endet, der andere Reiter), beginnen die Felder
  // neu. Das erste gespeicherte Wort legt das Blatt an, ist aber kein Wechsel: Sonst ginge der
  // Klick verloren, der das Feld verlassen hat, und das nächste Feld verlöre die Schreibmarke.
  return (
    <PrepSheet
      key={`${view.which}:${view.session?.id ?? 'offen'}:${view.number}`}
      view={view}
      onWhich={setAsked}
    />
  );
}

function PrepSheet({ view, onWhich }: { view: PrepView; onWhich: (which: PrepWhich) => void }) {
  const db = useDb();
  const data = useData();
  const { content, which, number } = view;
  const stand = useMemo(() => prepStand(data, content), [data, content]);
  const advice = useMemo(() => prepAdvice(data, content, stand), [data, content, stand]);
  const next = prepNext(stand);
  /** Ein Fach steht offen – zuerst das, bei dem es weitergeht. */
  const [open, setOpen] = useState<PrepSection | null>(() => next?.key ?? 'where');
  /** Wohin gesprungen wird, sobald das Fach aufgeklappt ist. */
  const [target, setTarget] = useState<{ key: PrepSection } | null>(null);
  useEffect(() => {
    if (target) focusSheetSection(target.key);
  }, [target]);
  const jump = (key: PrepSection) => {
    setOpen(key);
    setTarget({ key });
  };
  const { print, layer } = usePrint();
  const title = view.session ? `Session ${number}` : `Für Session ${number}`;
  const ctx = useMemo(
    () => ({ which, view, content, number, jump }),
    // `jump` ist bei jedem Zeichnen neu; gemeint ist das Blatt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [which, view, content, number],
  );

  return (
    <SheetCtx.Provider value={ctx}>
      <div className="wf-sheet">
        <div className="wf-sheet__main">
          <header className="wf-sheet__top">
            <div className="wf-sheet__kicker">Abend vorbereiten</div>
            {view.running && (
              <Tabs<PrepWhich>
                tabs={[
                  { id: 'now', label: `Dieser Abend (läuft) · Session ${view.running.number}` },
                  { id: 'next', label: 'Nächster Abend' },
                ]}
                value={which}
                onChange={onWhich}
              />
            )}
            <h1 className="wf-abend-title">
              {view.session ? `Session ${number} läuft` : `Für Session ${number}`}
            </h1>
            <p className="wf-sheet__hint">
              {view.session
                ? 'Dieses Blatt gehört zum laufenden Abend. Am Spieltisch hakst du ab, was gespielt und aufgedeckt wurde.'
                : view.running
                  ? 'Der laufende Abend endet erst von Hand – hier bereitest du schon den nächsten vor. Sobald er beginnt, liegt dieses Blatt am Spieltisch; was vom laufenden übrig bleibt, kommt dann dazu.'
                  : 'Was hier steht, liegt am Spieltisch bereit, sobald der Abend beginnt. Von oben nach unten – und nur so weit, wie es dir hilft.'}
            </p>
          </header>

          <Leftovers />

          <div className="wf-abend-faecher">
            {stand.map((entry, index) => {
              const after = stand[index + 1];
              return (
                <Fach
                  key={entry.key}
                  stand={entry}
                  open={open === entry.key}
                  first={next?.key === entry.key}
                  onToggle={() => setOpen(open === entry.key ? null : entry.key)}
                  onSkip={(skipped) => setSkipped(db, entry.key, skipped, which)}
                  next={after ? { title: after.title, go: () => jump(after.key) } : null}
                  action={ACTION[entry.key]?.()}
                >
                  {BODY[entry.key]()}
                </Fach>
              );
            })}
          </div>
        </div>

        <aside className="wf-sheet__side">
          <section>
            <h3 className="wf-abend-sub">{next ? 'Fang hier an' : 'Das reicht für einen Abend'}</h3>
            {next ? (
              <button type="button" className="wf-abend-next" onClick={() => jump(next.key)}>
                <b>{next.title}</b>
                <span>{next.note}</span>
              </button>
            ) : (
              <p className="wf-mute">
                Alles Weitere entsteht am Tisch. Vorbereitung dient dem Improvisieren – nicht dem
                Ablauf.
              </p>
            )}
          </section>
          <section>
            <h3 className="wf-abend-sub">Das Blatt</h3>
            <p className="wf-mute">
              Ein Rat, keine Pflicht – in der Reihenfolge des Blatts. Ein Klick führt zum Fach; was
              du heute nicht brauchst, wählst du am Punkt ab.
            </p>
            <SheetAdvice
              items={advice}
              onPick={(entry) => jump(entry.key)}
              onOff={(entry, off) => setSkipped(db, entry.key, off, which)}
            />
          </section>
          <section>
            <h3 className="wf-abend-sub">Am Tisch</h3>
            <p className="wf-mute">
              Am Spieltisch liegt das Blatt bereit zum Abhaken. Was aus einer Geschichte kam, ist
              dann auch dort gespielt oder gefunden; was offen bleibt, wartet auf dem nächsten
              Blatt.
            </p>
            <Link href="/" className="wf-btn wf-btn--sm">
              <Flame />
              Zum Spieltisch
            </Link>
            <Button
              size="sm"
              icon={<Printer />}
              title="Einstieg, Namen, Szenen, Geheimnisse, Orte und Personen auf einer Seite"
              onClick={() =>
                print(
                  <PrepPaper
                    title={title}
                    content={content}
                    names={spareNames(data, number, content.namesRound)}
                  />,
                )
              }
            >
              Eine Seite drucken
            </Button>
          </section>
        </aside>
        {layer}
      </div>
    </SheetCtx.Provider>
  );
}
