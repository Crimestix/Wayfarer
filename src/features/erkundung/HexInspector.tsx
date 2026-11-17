/**
 * Der Feld-Inspektor der Ansicht „Vorbereiten“: rechts neben der Karte steht alles, was an den
 * gewählten Feldern ist – geordnet wie die Gruppe es erlebt: Gelände, was man von fern und von
 * nebenan merkt, was dort ist, was verborgen liegt, was nur für dich ist. Mehrere Felder lassen
 * sich zugleich ändern; ohne Auswahl steht da, was auf der Karte schon vorbereitet ist. Jeder
 * Schritt geht in Rückgängig ein (`editor.record`).
 */
import { Eraser, Eye, EyeOff, Focus } from 'lucide-react';
import { useMemo } from 'react';
import { useData, useDb } from '../../data/hooks';
import { entityName } from '../../domain/derive';
import { sameHex, type HexCoord } from '../../domain/hex';
import { natureOnHex } from '../../domain/nature';
import { PASSAGE_LABEL, exitsOf, isRock } from '../../domain/passages';
import { ROAD_KINDS, type Area, type Hex, type Landscape } from '../../domain/schema';
import { KIND_GROUP_LABEL, kindKeyOf, kindsByGroup, paintOfKind } from '../../domain/hexKinds';
import {
  Button,
  Checkbox,
  EntityLink,
  EntityPicker,
  Field,
  Input,
  Panel,
  Select,
  TextArea,
  toast,
} from '../../ui';
import { NatureFold } from '../welt/NatureList';
import { lairToPlace, patchHexes, populateArea, setAllDiscovered } from './actions';
import { dwellersOf, lairPlan, lairsOnArea, landscapeOfHex } from '../../domain/landscape';
import type { HexEditor } from './HexEditor';
import { CLEAR_CONTENT, prepOverview, type ManyChange } from './prep';
import { ZoomButton } from './ZoomButton';
import { HazardFields } from '../reise/HazardFields';

const ROAD_LABEL: Record<Hex['road'], string> = {
  none: 'Keine',
  road: 'Straße',
  trail: 'Pfad',
};

const DIR_SHORT = ['NO', 'O', 'SO', 'SW', 'W', 'NW', 'hinauf', 'hinab'];

export function HexInspector({
  area,
  selection,
  editor,
  onSelect,
}: {
  area: Area;
  selection: readonly HexCoord[];
  editor: HexEditor;
  onSelect: (coords: HexCoord[]) => void;
}) {
  const db = useDb();
  const hexes = selection
    .map((coord) => area.hexes.find((hex) => sameHex(hex, coord)))
    .filter((hex): hex is Hex => !!hex);
  /** Ändert die Felder und merkt den Stand davor für Rückgängig. */
  const edit = (coords: readonly HexCoord[], change: ManyChange | Partial<Hex>) => {
    const before = db.getSnapshot().areas[area.id]?.hexes ?? area.hexes;
    editor.record(before);
    patchHexes(db, area.id, coords, change as ManyChange);
  };
  if (hexes.length === 0) return <Overview area={area} onSelect={onSelect} editor={editor} />;
  if (hexes.length > 1) return <Many hexes={hexes} edit={edit} onSelect={onSelect} />;
  return <One area={area} hex={hexes[0]!} edit={edit} onSelect={onSelect} />;
}

type Edit = (coords: readonly HexCoord[], change: ManyChange | Partial<Hex>) => void;

/** Ein Feld: alles, was daran steht. */
function One({
  area,
  hex,
  edit,
  onSelect,
}: {
  area: Area;
  hex: Hex;
  edit: Edit;
  onSelect: (coords: HexCoord[]) => void;
}) {
  const data = useData();
  const key = `${hex.q},${hex.r},${hex.level}`;
  const caves = hex.exits !== null;
  /** Schreibt ein Textfeld beim Verlassen – nur, wenn sich etwas geändert hat. */
  const text =
    (field: 'afar' | 'sign' | 'feature' | 'prepared' | 'hidden' | 'note' | 'river') =>
    (value: string) => {
      if (value.trim() !== hex[field]) edit([hex], { [field]: value.trim() });
    };
  const exits = exitsOf(hex);
  return (
    <Panel
      title={hex.placeId ? entityName(data, hex.placeId) : hex.feature || 'Feld'}
      actions={
        <Button size="sm" variant="ghost" onClick={() => onSelect([])}>
          Zur Übersicht
        </Button>
      }
    >
      <div className="wf-erk-inspect">
        {!hex.manual && (hex.feature || hex.afar || hex.hidden || hex.sign) && (
          <p className="wf-erk-detail__where">
            Von Wayfarer erzeugt – aus den Würfeltabellen der Einstellungen. Was du hier änderst,
            bleibt beim Neu würfeln.
          </p>
        )}

        <ZoomButton area={area} hex={hex} />
        <section className="wf-erk-inspect__part">
          <h4 className="wf-caps">Gelände und Wege</h4>
          {isRock(hex) ? (
            <p className="wf-erk-detail__where">Fels – hier führt kein Gang hindurch.</p>
          ) : (
            caves && (
              <p className="wf-erk-detail__where">
                Ausgänge:{' '}
                {exits
                  .map((exit) => `${DIR_SHORT[exit.dir]} (${PASSAGE_LABEL[exit.kind]})`)
                  .join(', ') || 'keine'}
                {area.hexes.some((other) => other.level > 0) ? ` · Ebene ${hex.level + 1}` : ''}
              </p>
            )
          )}
          <div className="wf-erk-inspect__row">
            <Field label="Gelände">
              <KindSelect
                value={kindKeyOf(hex) ?? ''}
                onChange={(key) => {
                  const paint = paintOfKind(key);
                  if (paint) edit([hex], paint);
                }}
              />
            </Field>
            {!caves && (
              <Field label="Straße">
                <Select
                  value={hex.road}
                  onChange={(e) => edit([hex], { road: e.target.value as Hex['road'] })}
                >
                  {ROAD_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {ROAD_LABEL[kind]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          {landscapeOfHex(data, hex) && (
            <p className="wf-erk-detail__where">
              Landschaft: <EntityLink id={hex.landscapeId} />
            </p>
          )}
          <Field label="Gegend" hint="Ihr Gelände, Tempo und ihre Begegnungen gelten hier.">
            <EntityPicker
              value={hex.regionId}
              onChange={(regionId) => edit([hex], { regionId })}
              kinds={['place']}
              placeholder="Keine Gegend"
            />
          </Field>
          {!caves && (
            <Field label="Fluss">
              <Input
                key={`${key},w`}
                defaultValue={hex.river}
                placeholder="kein Fluss"
                onBlur={(e) => text('river')(e.target.value)}
              />
            </Field>
          )}
        </section>

        <section className="wf-erk-inspect__part">
          <h4 className="wf-caps">Was man merkt</h4>
          {!caves && (
            <Field
              label="Von fern zu sehen"
              hint="Aus mehreren Feldern Entfernung – ein Turm, eine Rauchsäule. Die Reise hält, sobald es in Sicht kommt."
            >
              <Input
                key={`${key},a`}
                defaultValue={hex.afar}
                onBlur={(e) => text('afar')(e.target.value)}
              />
            </Field>
          )}
          <Field
            label="Woran man es von nebenan merkt"
            hint="Steht bei der Gruppe, wenn sie auf einem Nachbarfeld steht – etwa „Schwefelgeruch“."
          >
            <Input
              key={`${key},s`}
              defaultValue={hex.sign}
              onBlur={(e) => text('sign')(e.target.value)}
            />
          </Field>
        </section>

        <section className="wf-erk-inspect__part">
          <h4 className="wf-caps">Was hier ist</h4>
          <Field label="Ort">
            <EntityPicker
              value={hex.placeId}
              onChange={(placeId) => edit([hex], { placeId })}
              kinds={['place']}
              placeholder="Kein Ort auf diesem Feld"
            />
          </Field>
          <HexLairs area={area} hex={hex} />
          <Field label="Besonderheit" hint="Was die Landschaft hier auszeichnet.">
            <Input
              key={`${key},f`}
              defaultValue={hex.feature}
              onBlur={(e) => text('feature')(e.target.value)}
            />
          </Field>
          <Field
            label="Gefahr beim Betreten"
            hint="Abhang, Geröll, Eis: Die Reise hält hier mit SG und Sturzschaden nach den Regeln."
          >
            <HazardFields
              value={hex.hazard ?? null}
              onChange={(hazard) => edit([hex], { hazard })}
            />
          </Field>
          <Field label="Was hier wartet" hint="Für den Moment, in dem die Gruppe das Feld betritt.">
            <TextArea
              key={`${key},p`}
              defaultValue={hex.prepared}
              onBlur={(e) => text('prepared')(e.target.value)}
              style={{ minHeight: 56 }}
            />
          </Field>
        </section>

        <section className="wf-erk-inspect__part">
          <h4 className="wf-caps">Verborgen</h4>
          <Field
            label="Was die Gruppe beim Durchsuchen findet"
            hint="Nur, wenn sie sich die Zeit nimmt. Nicht jedes Feld braucht etwas."
          >
            <TextArea
              key={`${key},h`}
              defaultValue={hex.hidden}
              onBlur={(e) => text('hidden')(e.target.value)}
              style={{ minHeight: 48 }}
            />
          </Field>
        </section>

        <section className="wf-erk-inspect__part">
          <h4 className="wf-caps">Nur für dich</h4>
          <Field label="Notiz">
            <TextArea
              key={`${key},n`}
              defaultValue={hex.note}
              onBlur={(e) => text('note')(e.target.value)}
              style={{ minHeight: 56 }}
            />
          </Field>
          <div className="wf-erk-inspect__row">
            <Checkbox
              checked={hex.discovered}
              onChange={(discovered) => edit([hex], { discovered })}
            >
              Entdeckt
            </Checkbox>
            <Checkbox checked={hex.searched} onChange={(searched) => edit([hex], { searched })}>
              Durchsucht
            </Checkbox>
          </div>
        </section>
        <NatureFold spot={`feld:${area.id}`} hits={natureOnHex(data, area, hex)} />
      </div>
    </Panel>
  );
}

/** Mehrere Felder: was sich an allen zugleich ändern lässt. */
function Many({
  hexes,
  edit,
  onSelect,
}: {
  hexes: Hex[];
  edit: Edit;
  onSelect: (coords: HexCoord[]) => void;
}) {
  const caves = hexes.some((hex) => hex.exits !== null);
  const same = <T,>(pick: (hex: Hex) => T): T | '' =>
    hexes.every((hex) => pick(hex) === pick(hexes[0]!)) ? pick(hexes[0]!) : '';
  const kind = same((hex) => kindKeyOf(hex) ?? '');
  const road = same((hex) => hex.road);
  const regionId = same((hex) => hex.regionId);
  const filled = hexes.filter(
    (hex) => hex.feature || hex.afar || hex.sign || hex.hidden || hex.prepared || hex.note,
  ).length;
  return (
    <Panel
      title={`${hexes.length} Felder gewählt`}
      actions={
        <Button size="sm" variant="ghost" onClick={() => onSelect([])}>
          Auswahl aufheben
        </Button>
      }
    >
      <div className="wf-erk-inspect">
        <p className="wf-erk-detail__where">
          Was du hier wählst, gilt für alle {hexes.length} Felder. Umschalt-Klick auf der Karte
          nimmt Felder dazu oder heraus.
        </p>
        <div className="wf-erk-inspect__row">
          <Field label="Gelände">
            <KindSelect
              value={kind}
              mixed={kind === ''}
              onChange={(key) => {
                const paint = paintOfKind(key);
                if (paint) edit(hexes, paint);
              }}
            />
          </Field>
          {!caves && (
            <Field label="Straße">
              <Select
                value={road}
                onChange={(e) => {
                  if (e.target.value) edit(hexes, { road: e.target.value as Hex['road'] });
                }}
              >
                {road === '' && <option value="">verschieden</option>}
                {ROAD_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {ROAD_LABEL[kind]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Gegend">
          <EntityPicker
            value={regionId === '' ? null : regionId}
            onChange={(id) => edit(hexes, { regionId: id })}
            kinds={['place']}
            placeholder={regionId === '' ? 'verschiedene Gegenden' : 'Keine Gegend'}
          />
        </Field>
        <div className="wf-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" icon={<Eye />} onClick={() => edit(hexes, { discovered: true })}>
            Aufdecken
          </Button>
          <Button size="sm" icon={<EyeOff />} onClick={() => edit(hexes, { discovered: false })}>
            Zudecken
          </Button>
          <Button
            size="sm"
            icon={<Eraser />}
            disabled={!filled}
            onClick={() => {
              edit(hexes, CLEAR_CONTENT);
              toast({
                slot: 'hexkarte',
                title: `Inhalt von ${filled === 1 ? 'einem Feld' : `${filled} Feldern`} geleert`,
                body: 'Strg+Z holt ihn zurück.',
              });
            }}
            title="Besonderheit, von fern, von nebenan, Vorbereitetes, Verborgenes und Notiz wegnehmen – Gelände und Orte bleiben"
          >
            Inhalt leeren
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/** Ohne Auswahl: was auf der Karte schon vorbereitet ist, und alles zeigen. */
function Overview({
  area,
  onSelect,
  editor,
}: {
  area: Area;
  onSelect: (coords: HexCoord[]) => void;
  editor: HexEditor;
}) {
  const db = useDb();
  const rows = useMemo(() => prepOverview(area), [area]);
  const discovered = area.hexes.filter((hex) => hex.discovered).length;
  return (
    <Panel title="Vorbereitet">
      <div className="wf-erk-inspect">
        <p className="wf-erk-detail__where">
          {area.hexes.length} Felder. Wähle ein Feld oder mit Umschalt-Klick mehrere – rechts steht
          dann, was dort ist. „Zeigen“ wählt alle Felder einer Sorte.
        </p>
        <ul className="wf-erk-inspect__counts">
          {rows.map((row) => (
            <li key={row.key}>
              <span>{row.label}</span>
              <b className="wf-num">{row.coords.length}</b>
              <Button
                size="sm"
                variant="ghost"
                icon={<Focus />}
                onClick={() => onSelect(row.coords)}
              >
                Zeigen
              </Button>
            </li>
          ))}
        </ul>
        <Populate area={area} />
        <div className="wf-erk-detail__found">
          <span>
            Entdeckt: <b className="wf-num">{discovered}</b> von {area.hexes.length}
          </span>
          <div className="wf-row" style={{ gap: 6 }}>
            <Button
              size="sm"
              icon={<Eye />}
              disabled={discovered === area.hexes.length}
              onClick={() => {
                editor.record(area.hexes);
                setAllDiscovered(db, area.id, true);
              }}
            >
              Alles aufdecken
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<EyeOff />}
              disabled={discovered <= 1}
              onClick={() => {
                editor.record(area.hexes);
                setAllDiscovered(db, area.id, false);
              }}
            >
              Zudecken
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** Auswahl einer Geländeart, nach Gruppen. */
function KindSelect({
  value,
  onChange,
  mixed = false,
}: {
  value: string;
  onChange: (key: string) => void;
  mixed?: boolean;
}) {
  return (
    <Select
      value={value}
      onChange={(e) => {
        if (e.target.value) onChange(e.target.value);
      }}
    >
      {mixed && <option value="">verschieden</option>}
      {kindsByGroup().map(({ group, kinds }) => (
        <optgroup key={group} label={KIND_GROUP_LABEL[group]}>
          {kinds.map((kind) => (
            <option key={kind.key} value={kind.key}>
              {kind.label}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

/** Die Baue auf einem Feld: wer dort haust, „Als Ort anlegen“, wegnehmen. */
function HexLairs({ area, hex }: { area: Area; hex: Hex }) {
  const db = useDb();
  const data = useData();
  const lairs = lairsOnArea(data, area.id).filter((stock) => sameHex(stock.at!, hex));
  if (!lairs.length) return null;
  return (
    <div className="wf-erk-lairs">
      {lairs.map((stock) => (
        <div key={stock.id} className="wf-erk-lair">
          <b>{stock.placeId ? <EntityLink id={stock.placeId} /> : stock.name}</b>
          <span className="wf-mute">
            {stock.groups
              .map((group) => {
                const left = group.count - group.lost;
                return `${data.creatures[group.creatureId]?.name ?? 'Wesen'} (${left})`;
              })
              .join(', ')}
            {stock.generated ? ' · von „Beleben“' : ''}
          </span>
          <span className="wf-row" style={{ gap: 6 }}>
            {!stock.placeId && (
              <Button
                size="sm"
                onClick={() => {
                  const done = lairToPlace(db, stock.id);
                  if (done)
                    toast({
                      slot: 'hexkarte',
                      title: 'Als Ort angelegt',
                      body: 'Ein Platzhalter in der Welt – er steht auf diesem Feld.',
                      action: { label: 'Rückgängig', run: done.undo },
                    });
                }}
              >
                Als Ort anlegen
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const before = db.getSnapshot().stocks[stock.id];
                db.remove('stocks', stock.id);
                if (before)
                  toast({
                    slot: 'hexkarte',
                    title: 'Bau weggenommen',
                    action: { label: 'Rückgängig', run: () => db.put('stocks', before) },
                  });
              }}
            >
              Wegnehmen
            </Button>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * „Beleben“: welche Landschaften gemalt sind, wer in ihnen lebt – und ein Knopf, der ihre Baue
 * setzt. Fehlt etwas, sagt ein Satz, woran es liegt (keine Landschaft gemalt, niemand lebt dort).
 */
function Populate({ area }: { area: Area }) {
  const db = useDb();
  const data = useData();
  const painted = [...new Set(area.hexes.map((hex) => hex.landscapeId).filter(Boolean))]
    .map((id) => data.entities[id!])
    .filter((entity): entity is Landscape => entity?.kind === 'landscape');
  const lairs = lairsOnArea(data, area.id).length;
  const plan = useMemo(() => lairPlan(data, area), [data, area]);
  const dwellers = painted.flatMap((land) =>
    dwellersOf(data, land.id).map((dweller) => `${dweller.name} (${land.name})`),
  );
  return (
    <section className="wf-erk-inspect__part">
      <h4 className="wf-caps">Bewohner</h4>
      {!painted.length ? (
        <p className="wf-erk-detail__where">
          Mal eine Landschaft deiner Welt auf die Karte (Gelände-Pinsel, „Landschaften deiner Welt“)
          – dann setzt „Beleben“ die Baue derer, die dort leben.
        </p>
      ) : !dwellers.length ? (
        <p className="wf-erk-detail__where">
          In {painted.map((land) => `„${land.name}“`).join(', ')} lebt noch niemand mit Werten im
          Bestiarium. Trag es auf der Seite der Landschaft unter „Wer hier lebt“ ein.
        </p>
      ) : (
        <p className="wf-erk-detail__where">
          Hier leben: {dwellers.join(', ')}. Auf der Karte: {lairs} {lairs === 1 ? 'Bau' : 'Baue'}.
        </p>
      )}
      {dwellers.length > 0 && (
        <Button
          size="sm"
          disabled={!plan.length}
          title={
            plan.length
              ? `Setzt ${plan.length} ${plan.length === 1 ? 'Bau' : 'Baue'} – so viele, wie ihre Reviere Platz haben`
              : 'Alle Reviere sind besetzt'
          }
          onClick={() => {
            const done = populateArea(db, area.id);
            if (done)
              toast({
                slot: 'hexkarte',
                title: done.added
                  ? `${done.added} ${done.added === 1 ? 'Bau' : 'Baue'} gesetzt`
                  : 'Nichts mehr zu setzen',
                body: done.added
                  ? 'Sie stehen an ihren Feldern; „Als Ort anlegen“ macht einen zum Ort der Welt.'
                  : undefined,
                ...(done.added ? { action: { label: 'Rückgängig', run: done.undo } } : {}),
              });
          }}
        >
          Beleben
        </Button>
      )}
    </section>
  );
}
