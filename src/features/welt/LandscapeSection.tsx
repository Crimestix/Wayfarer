/**
 * Abschnitt „Landschaft“ auf der Seite einer Landschaft: wofür sie auf Hexkarten zählt
 * (Grundgelände, Aussehen, schwer zu durchqueren) und wer dort lebt – Wesen des Bestiariums,
 * Tiere, Spezies; was es noch nicht gibt, entsteht an Ort und Stelle als Platzhalter. Dazu, wer
 * sie von selbst als Lebensraum nennt, und auf wie vielen Feldern sie gemalt ist.
 */
import { Link } from 'wouter';
import { useData, useDb } from '../../data/hooks';
import { HEX_KINDS, hexKind } from '../../domain/hexKinds';
import { dwellersOf, hexAreaKm2, landscapeLook, territoryOf } from '../../domain/landscape';
import { TERRAINS, type Landscape, type Terrain } from '../../domain/schema';
import { TERRAIN_LABEL } from '../../domain/terrain';
import { Checkbox, EntityRefsEditor, Field, Select } from '../../ui';
import { KindSwatch } from '../erkundung/HexEditor';
import { Section } from './parts';
import { BountyFields } from '../reise/RegionFields';

export function LandscapeSection({ landscape }: { landscape: Landscape }) {
  const db = useDb();
  const data = useData();
  const details = landscape.landscape;
  const patch = (change: Partial<Landscape['landscape']>) => {
    const now = db.getSnapshot().entities[landscape.id];
    if (now?.kind === 'landscape')
      db.put('entities', { ...now, landscape: { ...now.landscape, ...change } });
  };
  const looks = HEX_KINDS.filter((kind) => kind.base === details.base && kind.key !== kind.base);
  const dwellers = dwellersOf(data, landscape.id);
  const creatures = Object.values(data.creatures)
    .filter((creature) => !details.dwellerIds.includes(creature.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const listedEntities = details.dwellerIds.filter((id) => !!data.entities[id]);
  const listedCreatures = details.dwellerIds.filter((id) => !!data.creatures[id]);
  // Wo sie gemalt ist: Karten und Felder.
  const maps = Object.values(data.areas)
    .map((area) => ({
      area,
      cells: area.hexes.filter((hex) => hex.landscapeId === landscape.id).length,
    }))
    .filter((entry) => entry.cells > 0);
  return (
    <Section title="Landschaft">
      <div className="wf-col" style={{ gap: 'var(--s-3)' }}>
        <div className="wf-form-grid">
          <Field label="Gelände" hint="Für Tempo, Sicht, Orientierung und Begegnungen.">
            <Select
              value={details.base}
              onChange={(event) => {
                const base = event.target.value as Terrain;
                // Ein Aussehen, das nicht zum neuen Gelände passt, fällt weg.
                patch({ base, look: hexKind(details.look)?.base === base ? details.look : null });
              }}
            >
              {TERRAINS.map((terrain) => (
                <option key={terrain} value={terrain}>
                  {TERRAIN_LABEL[terrain]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sieht aus wie" hint="Farbe und Zeichen auf der Hexkarte.">
            <span className="wf-row" style={{ gap: 'var(--s-2)' }}>
              <KindSwatch kind={landscapeLook(landscape)} />
              <Select
                value={details.look ?? ''}
                onChange={(event) => patch({ look: event.target.value || null })}
              >
                <option value="">{TERRAIN_LABEL[details.base]}</option>
                {looks.map((kind) => (
                  <option key={kind.key} value={kind.key}>
                    {kind.label}
                  </option>
                ))}
              </Select>
            </span>
          </Field>
        </div>
        <BountyFields id={landscape.id} value={{ yield: details.yield, water: details.water }} />
        <Checkbox checked={details.slow} onChange={(slow) => patch({ slow })}>
          Schwer zu durchqueren – jede Reisedauer verdoppelt sich
        </Checkbox>
        <Field
          label="Wer hier lebt"
          hint="Tiere und Spezies deiner Welt; was es noch nicht gibt, legst du hier an. „Beleben“ auf der Hexkarte setzt ihre Baue."
        >
          <EntityRefsEditor
            value={listedEntities}
            onChange={(ids) => patch({ dwellerIds: [...listedCreatures, ...ids] })}
            kinds={['animal', 'species']}
            placeholder="Tier oder Spezies …"
            create={{ onlyKinds: true }}
          />
        </Field>
        <Field label="Aus dem Bestiarium">
          <div className="wf-row" style={{ gap: 'var(--s-2)', flexWrap: 'wrap' }}>
            {listedCreatures.map((id) => (
              <button
                key={id}
                type="button"
                className="wf-btn wf-btn--sm"
                title="Wieder herausnehmen"
                onClick={() => patch({ dwellerIds: details.dwellerIds.filter((d) => d !== id) })}
              >
                {data.creatures[id]!.name} ×
              </button>
            ))}
            <Select
              value=""
              aria-label="Wesen aus dem Bestiarium dazunehmen"
              onChange={(event) =>
                event.target.value &&
                patch({ dwellerIds: [...details.dwellerIds, event.target.value] })
              }
            >
              <option value="">Wesen dazunehmen …</option>
              {creatures.map((creature) => (
                <option key={creature.id} value={creature.id}>
                  {creature.name}
                </option>
              ))}
            </Select>
          </div>
        </Field>
        {dwellers.length > 0 && (
          <p className="wf-mute">
            Mit Werten im Bestiarium:{' '}
            {dwellers
              .map(
                (dweller) =>
                  `${dweller.name}${dweller.via === 'habitat' ? ' (nennt sie als Lebensraum)' : ''} – Revier ${territoryOf(data, dweller.creatureId).toLocaleString('de-DE')} km²`,
              )
              .join(' · ')}
          </p>
        )}
        {maps.length > 0 && (
          <p className="wf-mute">
            Gemalt auf:{' '}
            {maps.map(({ area, cells }, index) => (
              <span key={area.id}>
                {index > 0 && ', '}
                <Link href={`/erkundung/${area.id}`}>{area.name}</Link> ({cells} Felder, etwa{' '}
                {Math.round(cells * hexAreaKm2(area.hexKm)).toLocaleString('de-DE')} km²)
              </span>
            ))}
          </p>
        )}
      </div>
    </Section>
  );
}
