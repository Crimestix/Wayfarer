/**
 * Karten – zeichnen und ansehen. Links alle Karten, rechts die gewählte: eine gezeichnete Karte
 * öffnet die Zeichenfläche, eine Bildkarte aus dem Wiki ihre Ansicht mit Punkten.
 */
import { useMemo, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { Image as ImageIcon, Map as MapIcon, PenLine, Plus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { GROUNDS, LEVEL_GROUNDS } from '../../domain/mapDraw';
import { createEntity, type GameMap, type MapGround } from '../../domain/schema';
import {
  Button,
  Dialog,
  EmptyState,
  EntityPicker,
  Field,
  Input,
  Select,
  confirmDialog,
  toast,
} from '../../ui';
import { MapView } from '../wiki/MapView';
import { createDrawnMap, removeDrawnMap, updateDrawnMap, type NewMap } from './actions';
import { MapEditor } from './MapEditor';
import { mapRows } from './model';
import './karten.css';

export default function KartenPage() {
  const db = useDb();
  const data = useData();
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<'new' | 'edit' | null>(null);

  const total = Object.keys(data.maps).length;
  const rows = useMemo(() => mapRows(data, query), [data, query]);
  const map = params.id ? data.maps[params.id] : undefined;

  const remove = async (target: GameMap) => {
    const ways = target.lines.filter((line) => line.pathId).length;
    const sure = await confirmDialog({
      title: `„${target.name}“ löschen?`,
      body:
        ways > 0
          ? ways === 1
            ? 'Die Karte wird gelöscht – und mit ihr der Weg, der aus einer ihrer Linien entstanden ist. Die Orte bleiben.'
            : `Die Karte wird gelöscht – und mit ihr die ${ways} Wege, die aus ihren Linien entstanden sind. Die Orte bleiben.`
          : 'Die Karte wird gelöscht. Die Orte darauf bleiben in der Welt.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!sure) return;
    removeDrawnMap(db, target.id);
    navigate('/karten');
    toast({ title: `„${target.name}“ gelöscht.` });
  };

  return (
    <div className="wf-karten">
      <aside className="wf-karten-side" aria-label="Karten">
        <div className="wf-karten-side__head">
          <h1 className="wf-karten-side__title">Karten</h1>
          <span className="wf-karten-side__total">{total}</span>
        </div>
        <div className="wf-karten-side__new">
          <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setDialog('new')}>
            Neue Karte
          </Button>
        </div>
        {total > 8 && (
          <div className="wf-karten-side__search">
            <Input
              value={query}
              placeholder="Karte suchen …"
              aria-label="Karte suchen"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        )}
        <div className="wf-karten-side__list">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className="wf-karten-row"
              data-current={row.id === map?.id}
              onClick={() => navigate(`/karten/${row.id}`)}
            >
              {row.drawn ? <PenLine aria-hidden /> : <ImageIcon aria-hidden />}
              <span className="wf-karten-row__text">
                <span className="wf-karten-row__name">{row.name}</span>
                <span className="wf-karten-row__line">{row.line}</span>
              </span>
            </button>
          ))}
          {total > 0 && !rows.length && (
            <p className="wf-karten-side__none">Keine Karte heißt so.</p>
          )}
          {!total && (
            <p className="wf-karten-side__none">
              Hier stehen deine Karten – gezeichnete und die Bildkarten aus dem Wiki.
            </p>
          )}
        </div>
      </aside>

      <div className="wf-karten-main">
        {!map ? (
          <div className="wf-karten-blank">
            <EmptyState
              icon={<MapIcon aria-hidden />}
              title={total ? 'Wähle links eine Karte' : 'Noch keine Karte'}
            >
              In Wayfarer gezeichnete Karten bedeuten etwas: Du malst Gelände, ziehst Straßen und
              Flüsse und setzt Orte. Wayfarer liest daraus Entfernungen, Reisezeiten und Wege
              zwischen den Orten.
            </EmptyState>
          </div>
        ) : map.kind === 'drawn' ? (
          <MapEditor
            key={map.id}
            map={map}
            onEdit={() => setDialog('edit')}
            onRemove={() => void remove(map)}
          />
        ) : (
          <div className="wf-karten-image">
            <h2 className="wf-karten-image__title">{map.name}</h2>
            <MapView key={map.id} map={map} />
          </div>
        )}
      </div>

      {dialog && (
        <MapDialog
          map={dialog === 'edit' ? map : undefined}
          onClose={() => setDialog(null)}
          onSave={(input) => {
            if (dialog === 'edit' && map) updateDrawnMap(db, map.id, input);
            else navigate(`/karten/${createDrawnMap(db, input).id}`);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

const number = (text: string) => Number.parseFloat(text.replace(',', '.'));

/** Eine Karte anlegen oder ihre Angaben ändern. */
function MapDialog({
  map,
  onClose,
  onSave,
}: {
  map: GameMap | undefined;
  onClose: () => void;
  onSave: (input: NewMap) => void;
}) {
  const db = useDb();
  const [name, setName] = useState(map?.name ?? '');
  const [placeId, setPlaceId] = useState<string | null>(map?.placeId ?? null);
  const [width, setWidth] = useState(() =>
    map?.scale && map.frame
      ? String(Math.round(map.scale.kmPerUnit * map.frame.width * 100) / 100).replace('.', ',')
      : '50',
  );
  const [ground, setGround] = useState<MapGround>(map?.ground ?? 'plain');
  const [level, setLevel] = useState<GameMap['level']>(map?.level ?? 'surface');
  const below = level === 'underground';
  const widthKm = number(width);
  const ready = name.trim() !== '' && widthKm > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      title={map ? 'Angaben der Karte' : 'Neue Karte'}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => onSave({ name, placeId, widthKm, ground, level })}
          >
            {map ? 'Übernehmen' : 'Anlegen'}
          </Button>
        </>
      }
    >
      <div className="wf-form-grid">
        <Field label="Name" className="wf-span-2">
          <Input
            value={name}
            autoFocus
            placeholder="etwa „Das Umland von Hohenfurt“"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field
          className="wf-span-2"
          label="Zeigt"
          hint="Der Ort der Welt, den die Karte zeigt – darf leer bleiben."
        >
          <EntityPicker
            value={placeId}
            onChange={setPlaceId}
            kinds={['place']}
            placeholder="Ort suchen oder neu anlegen …"
            onCreate={(text) => db.put('entities', createEntity({ kind: 'place', name: text })).id}
          />
        </Field>
        <Field
          className="wf-span-2"
          label="Breite in Kilometern"
          hint={
            below
              ? 'Von West nach Ost. Daraus rechnet Wayfarer Entfernungen und Wegzeiten – ein Gewölbe etwa 0,2 (das sind 200 Meter), ein Höhlensystem 5, ein Stück Unterreich 100.'
              : 'Von West nach Ost. Daraus rechnet Wayfarer Entfernungen und Reisezeiten – eine Stadt etwa 2, ein Umland 50, ein Reich 800.'
          }
        >
          <Input
            value={width}
            inputMode="decimal"
            aria-invalid={!(widthKm > 0)}
            onChange={(event) => setWidth(event.target.value)}
          />
        </Field>
        <Field label="Ebene" hint="Unter der Erde: heller Strich auf dunklem Fels.">
          <Select
            value={level}
            onChange={(event) => {
              const next = event.target.value as GameMap['level'];
              setLevel(next);
              if (!LEVEL_GROUNDS[next].includes(ground)) setGround(LEVEL_GROUNDS[next][0]!);
            }}
          >
            <option value="surface">Oberwelt</option>
            <option value="underground">Unterreich</option>
          </Select>
        </Field>
        <Field
          label="Grund"
          hint={
            below
              ? 'Das Gelände, wo nichts gemalt ist – meist Fels, aus dem Höhlen und Gänge entstehen.'
              : 'Das Gelände, wo nichts gemalt ist. Für eine Insel: Wasser.'
          }
        >
          <Select value={ground} onChange={(event) => setGround(event.target.value as MapGround)}>
            {LEVEL_GROUNDS[level].map((entry) => (
              <option key={entry} value={entry}>
                {GROUNDS[entry].label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
