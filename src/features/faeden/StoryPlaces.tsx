/**
 * „Schauplätze und Wege“ auf dem Blatt einer Geschichte: ihre Orte (unter den Beteiligten, aus
 * Einstiegen, Szenen und Hinweisen) und die Wegenetze, die für sie vorbereitet sind – anlegen,
 * öffnen, anhängen, lösen. Eine Strecke lässt sich gleich hier schreiben („A -> B (4 Std.) -> C“);
 * Orte, die dabei neu entstehen, sind Platzhalter dieser Geschichte.
 */
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { MapPin, Plus, Route as RouteIcon, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { netsOfStory } from '../../domain/net';
import type { Story } from '../../domain/schema';
import { PLACE_VIA_LABEL, storyPlaces } from '../../domain/storySheet';
import {
  Button,
  EntityPicker,
  IconButton,
  NewLine,
  Select,
  SheetSection,
  StubMark,
  entityHref,
  toast,
} from '../../ui';
import { addStoryNet, addStoryRoute, setNetStory } from '../wegenetz/actions';
import { detachFromStory, listInStory } from './actions';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function StoryPlaces({ story }: { story: Story }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const places = storyPlaces(data, story);
  const nets = netsOfStory(data, story.id);
  const free = Object.values(data.nets)
    .filter((net) => !(net.storyId && data.stories[net.storyId]))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  /** In welches Netz eine geschriebene Strecke geht, wenn die Geschichte mehrere hat. */
  const [target, setTarget] = useState<string | null>(null);
  const open = (netId: string) => navigate(`/wegenetze/${netId}`);

  const create = () => {
    const made = addStoryNet(db, story.id);
    if (!made) return;
    toast({
      title: 'Wegenetz angelegt',
      body: made.net.points.length
        ? `„${made.net.name}“ – ${count(made.net.points.length, 'Ort', 'Orte')} der Geschichte ${made.net.points.length === 1 ? 'liegt' : 'liegen'} schon darauf.`
        : `„${made.net.name}“ – noch ohne Orte. Schreib darunter eine Strecke, oder öffne es.`,
      action: { label: 'Rückgängig', run: made.undo },
    });
  };
  const write = (text: string) => {
    const added = addStoryRoute(db, story.id, text, target);
    if (!added) return;
    const parts = [
      added.places ? `${count(added.places, 'Ort', 'Orte')} neu als Platzhalter` : '',
      added.ways ? `${count(added.ways, 'Weg', 'Wege')} neu` : '',
    ].filter(Boolean);
    toast({
      title: 'Strecke übernommen',
      body: `In „${added.net.name}“${parts.length ? ` – ${parts.join(', ')}` : ' – alles gab es schon'}.`,
      action: { label: 'Rückgängig', run: added.undo },
    });
  };

  return (
    <SheetSection
      id="places"
      title="Schauplätze und Wege"
      hint="Wo spielt sie – und wie kommt man von einem Ort zum anderen?"
    >
      {places.length > 0 && (
        <div className="wf-row-wrap wf-faden-orte">
          {places.map(({ place, via, own }) => (
            <span
              key={place.id}
              className="wf-faden-ort"
              data-own={own}
              title={
                own
                  ? via.map((entry) => PLACE_VIA_LABEL[entry]).join(', ')
                  : 'Liegt auf dem Wegenetz – ein Ort unterwegs. Zur Geschichte gehört er, wenn du ihn dazunimmst.'
              }
            >
              <MapPin aria-hidden />
              <Link href={entityHref(place)}>{place.name}</Link>
              <StubMark entity={place} />
              {!own && (
                <button
                  type="button"
                  className="wf-faden-ort__take"
                  aria-label={`${place.name} zur Geschichte nehmen`}
                  onClick={() => listInStory(db, story.id, place.id)}
                >
                  <Plus aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <EntityPicker
        value={null}
        onChange={(id) => id && listInStory(db, story.id, id)}
        kinds={['place']}
        exclude={story.refs}
        placeholder="Ort hinzufügen – oder neu anlegen …"
        create={{ storyId: story.id, onlyKinds: true }}
        onRevert={(id) => detachFromStory(db, story.id, id)}
      />
      {nets.map((net) => (
        <div key={net.id} className="wf-faden-netz">
          <RouteIcon aria-hidden />
          <button type="button" className="wf-faden-link" onClick={() => open(net.id)}>
            {net.name}
          </button>
          <em>{count(net.points.length, 'Ort', 'Orte')}</em>
          <Button size="sm" onClick={() => open(net.id)}>
            Öffnen
          </Button>
          <IconButton
            label={`„${net.name}“ von der Geschichte lösen – das Netz bleibt`}
            size="sm"
            variant="ghost"
            onClick={() => {
              const undo = setNetStory(db, net.id, null);
              if (undo)
                toast({
                  title: 'Wegenetz gelöst',
                  body: `„${net.name}“ steht wieder für sich.`,
                  action: { label: 'Rückgängig', run: undo },
                });
            }}
          >
            <X />
          </IconButton>
        </div>
      ))}
      <div className="wf-faden-netzwahl">
        <Button size="sm" icon={<RouteIcon />} onClick={create}>
          {nets.length ? 'Weiteres Wegenetz' : 'Wegenetz anlegen'}
        </Button>
        {free.length > 0 && (
          <Select
            value=""
            aria-label="Ein vorhandenes Wegenetz an die Geschichte hängen"
            onChange={(event) => {
              if (event.target.value) setNetStory(db, event.target.value, story.id);
            }}
          >
            <option value="">Vorhandenes Wegenetz anhängen …</option>
            {free.map((net) => (
              <option key={net.id} value={net.id}>
                {net.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className="wf-faden-strecke">
        <NewLine
          label="Eine Strecke schreiben"
          placeholder="Strecke schreiben: A -> B (4 Std.) -> C"
          onAdd={write}
        />
        {nets.length > 1 && (
          <Select
            value={target ?? nets[0]!.id}
            aria-label="In welches Wegenetz die Strecke geht"
            onChange={(event) => setTarget(event.target.value)}
          >
            {nets.map((net) => (
              <option key={net.id} value={net.id}>
                in „{net.name}“
              </option>
            ))}
          </Select>
        )}
      </div>
    </SheetSection>
  );
}
