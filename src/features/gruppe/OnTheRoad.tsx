/**
 * „Unterwegs“: die Marschordnung in Reihen, wer im Dunkeln sieht, wer ein Licht trägt und das Gold
 * der Gruppe. Die Rechnung steht in `march.ts`.
 */
import { useMemo } from 'react';
import { Link } from 'wouter';
import { ChevronDown, ChevronUp, Eye, Flame } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { formatGold } from '../../domain/loot';
import { formatDuration } from '../../domain/time/calendar';
import { IconButton, Panel } from '../../ui';
import { marchIds, moveInMarch, onTheRoad, rowLabel } from './march';

/** Gold mit Vorzeichen, wenn beim Handel mehr ausgegeben als eingenommen wurde: „−12 GM“. */
const formatSigned = (gold: number) => (gold < 0 ? `−${formatGold(-gold)}` : formatGold(gold));

export function OnTheRoad() {
  const db = useDb();
  const data = useData();
  const road = useMemo(() => onTheRoad(data), [data]);
  const ids = marchIds(road.rows);
  const move = (id: string, step: -1 | 1) => db.setState({ march: moveInMarch(ids, id, step) });
  const now = data.state.now;

  return (
    <Panel title="Unterwegs" className="wf-gruppe-road" flush>
      <div className="wf-gruppe-road__march" aria-label="Marschordnung">
        {road.rows.map((row, index) => (
          <div key={index} className="wf-gruppe-road__row">
            <span className="wf-gruppe-road__label">{rowLabel(index, road.rows.length)}</span>
            <div className="wf-gruppe-road__members">
              {row.map((c) => {
                const light = road.lightOf.get(c.id);
                const dark = c.character.darkvision ?? 0;
                return (
                  <span key={c.id} className="wf-gruppe-road__member">
                    <Link href={`/gruppe/${c.id}`} className="wf-gruppe-road__name">
                      {c.name}
                    </Link>
                    {dark > 0 && (
                      <span className="wf-gruppe-road__sign" title={`Dunkelsicht ${dark} Fuß`}>
                        <Eye aria-hidden />
                        {dark}
                      </span>
                    )}
                    {light && (
                      <span
                        className="wf-gruppe-road__sign wf-gruppe-road__sign--light"
                        title={`${light.label} – noch ${formatDuration(light.end - now)}`}
                      >
                        <Flame aria-hidden />
                      </span>
                    )}
                    <IconButton
                      label={`${c.name} eine Reihe nach vorn`}
                      size="sm"
                      variant="ghost"
                      onClick={() => move(c.id, -1)}
                    >
                      <ChevronUp />
                    </IconButton>
                    <IconButton
                      label={`${c.name} eine Reihe nach hinten`}
                      size="sm"
                      variant="ghost"
                      onClick={() => move(c.id, 1)}
                    >
                      <ChevronDown />
                    </IconButton>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <dl className="wf-gruppe-road__facts">
        <dt>Licht</dt>
        <dd>
          {road.lightOf.size + road.looseLights.length === 0 ? (
            <span className="wf-mute">Es brennt kein Licht.</span>
          ) : (
            [
              ...[...road.lightOf].map(([id, light]) => {
                const who = road.rows.flat().find((c) => c.id === id)?.name ?? '';
                return `${light.label} bei ${who}`;
              }),
              ...road.looseLights.map((light) => light.label),
            ].join(' · ')
          )}
        </dd>
        <dt>Gold der Gruppe</dt>
        <dd
          title={
            road.totalTrade !== 0
              ? `Beute ${formatSigned(road.totalGold - road.totalTrade)}, Handel ${formatSigned(road.totalTrade)}`
              : undefined
          }
        >
          {road.groupGold !== 0 ? formatSigned(road.groupGold) : '–'}
          {road.totalGold !== road.groupGold && (
            <span className="wf-mute"> · alles zusammen {formatSigned(road.totalGold)}</span>
          )}{' '}
          <Link href="/beute" className="wf-gruppe-textlink">
            Beute-Buch
          </Link>
        </dd>
      </dl>
    </Panel>
  );
}
