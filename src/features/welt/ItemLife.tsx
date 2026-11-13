/**
 * Abschnitt „Lebenslauf“ auf der Seite eines Gegenstands: ausgeschaltet nur der Schalter,
 * eingeschaltet alles, was ihm geschah, und wer ihn nacheinander hatte (`domain/itemHistory.ts`).
 */
import { EyeOff, Feather } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  holdersOf,
  holdingName,
  holdingSpan,
  itemEventWhen,
  itemEventWho,
  itemHistory,
  readyFor,
  type ItemEvent,
} from '../../domain/itemHistory';
import { lootLine } from '../../domain/loot';
import type { CampaignData, Item } from '../../domain/schema';
import { openQuickLog } from '../../shell/commands';
import { Button, Checkbox, EntityLink, EntityLinks } from '../../ui';
import { patchDetails } from './actions';
import { Hint, Section } from './parts';

const EXPLAIN =
  'Wayfarer sammelt dann, was diesem Gegenstand geschah – Beute, Wechsel des Besitzers, Einträge der Chronik – und wer ihn nacheinander hatte.';

export function ItemLife({ item }: { item: Item }) {
  const db = useDb();
  const data = useData();
  const toggle = (history: boolean) => patchDetails(db, item, { history });

  if (!item.item.history)
    return (
      <Section title="Lebenslauf">
        <div className="wf-welt-life__off">
          <Checkbox checked={false} onChange={toggle}>
            Lebenslauf führen
          </Checkbox>
          <span className="wf-welt-life__explain">{EXPLAIN}</span>
        </div>
      </Section>
    );

  const events = [...itemHistory(data, item.id)].reverse();
  const holders = holdersOf(data, item.id);
  const ready = readyFor(data, item.id);
  const cal = data.campaign.calendar;
  const now = data.state.now;
  return (
    <Section
      title="Lebenslauf"
      count={events.length || undefined}
      action={
        <Button
          size="sm"
          variant="ghost"
          icon={<Feather />}
          onClick={() => openQuickLog({ refs: [item.id] })}
        >
          Festhalten
        </Button>
      }
    >
      {events.length ? (
        <ol className="wf-welt-life">
          {events.map((event) => (
            <li key={event.key}>
              <span className="wf-welt-life__when">{itemEventWhen(cal, now, event)}</span>
              <span className="wf-welt-life__what">
                <span className="wf-welt-life__label">
                  {event.label}
                  {event.secret && <EyeOff aria-label="Nur für die Spielleitung" />}
                </span>
                {event.text && <span className="wf-welt-life__text">{event.text}</span>}
                <EventMeta data={data} event={event} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <Hint>
          Noch nichts – Beute, ein neuer Besitzer und alles, was in der Chronik diesen Gegenstand
          nennt, erscheint hier.
        </Hint>
      )}
      {ready.length > 0 && (
        <p className="wf-welt-life__ready">
          Liegt im Beute-Buch bereit: {ready.map((loot) => lootLine(data, loot)).join('; ')}
        </p>
      )}
      <h4 className="wf-welt-life__sub">Bisherige Besitzer</h4>
      {holders.length ? (
        <ol className="wf-welt-life__holders">
          {holders.map((holding, i) => (
            <li key={i} data-current={holding.current || undefined}>
              <span className="wf-welt-life__holder">
                {holding.holderId ? (
                  <EntityLink id={holding.holderId} icon={false} />
                ) : (
                  holdingName(data, holding)
                )}
                {holding.secret && <EyeOff aria-label="Nur für die Spielleitung" />}
              </span>
              <span className="wf-welt-life__span">{holdingSpan(cal, now, holding)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <Hint>Noch niemand bekannt – trag ein, bei wem er sich befindet.</Hint>
      )}
      <div className="wf-welt-life__switch">
        <Checkbox checked onChange={toggle}>
          Lebenslauf führen
        </Checkbox>
      </div>
    </Section>
  );
}

/** Wer, wo, an welchem Abend, woher – soweit bekannt. */
function EventMeta({ data, event }: { data: CampaignData; event: ItemEvent }) {
  const session = event.sessionId ? data.sessions[event.sessionId] : undefined;
  const who = itemEventWho(data, event);
  const parts = [
    who && (
      <span key="who">
        {who} {!event.party && <EntityLinks ids={event.whoIds} />}
      </span>
    ),
    event.placeId && (
      <span key="where">
        in <EntityLink id={event.placeId} icon={false} />
      </span>
    ),
    session && <span key="session">Session {session.number}</span>,
    event.source && <span key="source">{event.source}</span>,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <span className="wf-welt-life__meta">{parts}</span>;
}
