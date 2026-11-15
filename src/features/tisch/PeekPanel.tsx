/**
 * Kurzblick: eine Person auf einen Blick, mitten am Spieltisch statt der Geschichten im Spiel.
 * ↑ ↓ blättert durch die Liste, aus der sie geöffnet wurde, Escape schließt. Die ganze Seite
 * bleibt einen Klick entfernt.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'wouter';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  EyeOff,
  Feather,
  Handshake,
  Pin,
  PinOff,
  X,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entityName } from '../../domain/derive';
import { openAttitude } from '../../shell/commands';
import {
  AttitudeBadge,
  Button,
  ChronicleList,
  IconButton,
  Panel,
  Portrait,
  SectionTitle,
  entityHref,
} from '../../ui';
import { toggleInView } from './commands';
import { nameIntoJournal } from './journalInsert';
import { closePeek, peekView, stepPeek, usePeek } from './peek';

export function PeekPanel() {
  const db = useDb();
  const data = useData();
  const peek = usePeek();
  const view = useMemo(() => (peek.id ? peekView(data, peek.id) : null), [data, peek.id]);
  const box = useRef<HTMLDivElement>(null);
  // Beim Öffnen und Blättern liegt der Fokus auf dem Blatt – so wirken ↑ ↓ und Escape sofort.
  useEffect(() => {
    box.current?.focus({ preventScroll: true });
    box.current?.querySelector('.wf-panel__body, .wf-tisch-peek__body')?.scrollTo?.(0, 0);
  }, [peek.id]);
  useEffect(() => {
    if (peek.id && !view) closePeek();
  }, [peek.id, view]);
  if (!view) return null;
  const { entity } = view;
  const inView = data.state.inView.includes(entity.id);
  const many = peek.list.length > 1;
  const at = peek.list.indexOf(entity.id);
  const neighbour = (step: 1 | -1) => {
    if (!many || at < 0) return null;
    const id = peek.list[(at + step + peek.list.length) % peek.list.length]!;
    return entityName(data, id);
  };

  return (
    <div
      ref={box}
      tabIndex={-1}
      className="wf-tisch-peek"
      aria-label={`Kurzblick: ${entity.name}`}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('input, textarea, [contenteditable="true"]')) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          stepPeek(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closePeek();
        }
      }}
    >
      <Panel
        flush
        className="wf-tisch-peek__panel"
        title={
          <span className="wf-tisch-peek__title">
            Kurzblick
            {many && <span className="wf-tisch-peek__keys">↑ ↓ blättert · Esc schließt</span>}
          </span>
        }
        actions={
          <span className="wf-row">
            {many && (
              <>
                <IconButton
                  label={`Zurück: ${neighbour(-1) ?? ''}`}
                  size="sm"
                  variant="ghost"
                  onClick={() => stepPeek(-1)}
                >
                  <ChevronUp />
                </IconButton>
                <IconButton
                  label={`Weiter: ${neighbour(1) ?? ''}`}
                  size="sm"
                  variant="ghost"
                  onClick={() => stepPeek(1)}
                >
                  <ChevronDown />
                </IconButton>
              </>
            )}
            <IconButton
              label="Kurzblick schließen (Esc)"
              size="sm"
              variant="ghost"
              onClick={closePeek}
            >
              <X />
            </IconButton>
          </span>
        }
      >
        <div className="wf-tisch-peek__body">
          <header className="wf-tisch-peek__head">
            <Portrait entity={entity} size={56} />
            <div className="wf-tisch-peek__who">
              <h2 className="wf-tisch-peek__name">{entity.name}</h2>
              {entity.tagline && <p className="wf-tisch-peek__tagline">{entity.tagline}</p>}
              <div className="wf-tisch-peek__actions">
                {view.hasAttitude && (
                  <button
                    type="button"
                    className="wf-tisch-cast__attitude"
                    aria-label={`Haltung von ${entity.name} zur Gruppe`}
                    onClick={() => openAttitude({ fromId: entity.id })}
                  >
                    <AttitudeBadge value={view.attitude} />
                  </button>
                )}
                {view.mates && (
                  <span
                    className="wf-tisch-cast__mates"
                    title="Haltung zu einzelnen Gefährten, wo sie von der zur Gruppe abweicht"
                  >
                    {view.mates}
                  </span>
                )}
                <Button
                  size="sm"
                  icon={inView ? <PinOff /> : <Pin />}
                  aria-pressed={inView}
                  title={
                    inView
                      ? 'Aus „Im Blick“ nehmen'
                      : 'Oben über „Wer hier ist“ halten – auch an anderen Orten'
                  }
                  onClick={() => toggleInView(db, entity.id)}
                >
                  Im Blick
                </Button>
                <Button
                  size="sm"
                  icon={<Feather />}
                  title="Den Namen in die Mitschrift setzen"
                  onClick={() => nameIntoJournal({ id: entity.id, name: entity.name })}
                >
                  In die Mitschrift
                </Button>
                <Link href={entityHref(entity)} className="wf-btn wf-btn--sm wf-btn--ghost">
                  <BookOpen />
                  Ganze Seite
                </Link>
              </div>
            </div>
          </header>

          {view.memory.length > 0 && (
            <ul className="wf-tisch-peek__memory">
              {view.memory.map((fact) => (
                <li key={fact.kind}>{fact.text}</li>
              ))}
            </ul>
          )}

          {view.promises.length > 0 && (
            <section className="wf-col">
              <SectionTitle>Offene Abmachungen</SectionTitle>
              <ul className="wf-tisch-peek__list">
                {view.promises.map((entry) => (
                  <li key={entry.id}>
                    <Handshake aria-hidden />
                    {entry.text || 'Abmachung ohne Wortlaut'}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {view.facts.length > 0 && (
            <section className="wf-col">
              <SectionTitle>Steckbrief</SectionTitle>
              <dl className="wf-tisch-peek__facts">
                {view.facts.map((fact) => (
                  <div key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {view.ties.length > 0 && (
            <section className="wf-col">
              <SectionTitle>Beziehungen</SectionTitle>
              <ul className="wf-tisch-peek__list">
                {view.ties.map((tie) => (
                  <li key={tie.otherId}>{tie.text}</li>
                ))}
              </ul>
            </section>
          )}

          {(view.notes || view.secret) && (
            <section className="wf-col">
              <SectionTitle>Notizen</SectionTitle>
              {view.notes && <p className="wf-prose wf-soft">{view.notes}</p>}
              {view.secret && (
                <p className="wf-prose wf-tisch-peek__secret">
                  <EyeOff aria-label="Nur für dich" />
                  {view.secret}
                </p>
              )}
            </section>
          )}

          {view.recent.length > 0 && (
            <section className="wf-col">
              <SectionTitle>Zuletzt</SectionTitle>
              <ChronicleList entries={view.recent} />
            </section>
          )}
        </div>
      </Panel>
    </div>
  );
}
