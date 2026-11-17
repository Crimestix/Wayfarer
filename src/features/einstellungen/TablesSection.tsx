/**
 * Abschnitt „Würfeltabellen“: die Tabellen, aus denen Wayfarers Erzeuger wählen – eine Zeile je
 * Möglichkeit, so viele, wie man will (Wunsch des Spielleiters, 17. 11.: „Es müssen Tabellen sein,
 * keine Textfelder – das macht die Bedienung einfacher“). Jede steht als Vorgabe da, bis der
 * Spielleiter sie ändert; „Vorgabe wiederherstellen“ nimmt seine wieder weg. Geschrieben wird beim
 * Verlassen eines Feldes; neue Zeilen entstehen mit dem ersten Wort.
 */
import { RotateCcw, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useData, useDb } from '../../data/hooks';
import { composeEntry, entryParts, weightOf, type EntryParts } from '../../domain/rollTable';
import { FrequencySelect, IconButton, NewLine, Written, toast } from '../../ui';
import { generatorTables, type GeneratorTable } from '../erkundung/tables';
import { resetGeneratorTable, saveGeneratorRows } from '../erkundung/tableActions';

export function TablesSection() {
  const data = useData();
  const tables = useMemo(() => generatorTables(data), [data]);
  return (
    <div className="wf-einstellungen-tables">
      <p className="wf-mute">
        Eine Zeile je Möglichkeit – Wayfarer wählt beim Erzeugen eine davon aus, nach Häufigkeit:
        Häufiges kommt doppelt so oft wie Gelegentliches, das doppelt so oft wie Seltenes. Eine
        leere Tabelle heißt: hier nichts erzeugen. Schon erzeugte Karten ändern sich erst, wenn du
        sie neu würfelst.
      </p>
      {tables.all.map((entry) => (
        <TableBlock key={entry.slot} entry={entry} />
      ))}
    </div>
  );
}

interface Line {
  parts: EntryParts;
  weight: number;
}

function TableBlock({ entry }: { entry: GeneratorTable }) {
  const db = useDb();
  const site = entry.slot.startsWith('site');
  const below = entry.slot === 'site:underdark';
  const lines: Line[] = entry.table.rows.map((row) => ({
    parts: entryParts(row.text),
    weight: weightOf(row),
  }));
  const save = (next: Line[]) =>
    saveGeneratorRows(
      db,
      entry.slot,
      next.map((line) => ({ text: composeEntry(line.parts, below), weight: line.weight })),
    );
  const change = (index: number, patch: Partial<Line>) =>
    save(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const setPart = (index: number, part: keyof EntryParts, text: string) => {
    const line = lines[index]!;
    if (line.parts[part] !== text.trim()) change(index, { parts: { ...line.parts, [part]: text } });
  };
  const count = lines.length;
  const columns = site ? 6 : 4;

  return (
    <details className="wf-einstellungen-tables__table">
      <summary>
        <span className="wf-einstellungen-tables__name">{entry.table.name}</span>
        <span className="wf-mute">
          {count === 1 ? 'ein Eintrag' : `${count} Einträge`} ·{' '}
          {entry.own ? 'deine eigene' : 'Vorgabe'}
        </span>
        {entry.own && (
          <IconButton
            label="Vorgabe wiederherstellen"
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.preventDefault();
              const undo = resetGeneratorTable(db, entry.slot);
              toast({
                title: 'Vorgabe wiederhergestellt',
                body: entry.table.name,
                action: { label: 'Rückgängig', run: undo },
              });
            }}
          >
            <RotateCcw />
          </IconButton>
        )}
      </summary>
      {entry.lead && <p className="wf-mute">{entry.lead}</p>}
      <table className="wf-einstellungen-rolltable">
        <thead>
          <tr>
            <th scope="col" className="wf-einstellungen-rolltable__nr">
              Nr.
            </th>
            <th scope="col">{site ? 'Was die Gruppe vorfindet' : 'Eintrag'}</th>
            {site && <th scope="col">{below ? 'Von nebenan' : 'Von fern'}</th>}
            {site && <th scope="col">Verborgen</th>}
            <th
              scope="col"
              className="wf-einstellungen-rolltable__weight"
              title="Wie oft im Vergleich zu den anderen Zeilen"
            >
              Häufigkeit
            </th>
            <th scope="col" aria-label="Zeile entfernen" />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            const row = entry.table.rows[index]!;
            return (
              <tr key={index}>
                <td className="wf-einstellungen-rolltable__nr">
                  {row.min === row.max ? row.min : `${row.min}–${row.max}`}
                </td>
                <td>
                  <Written
                    wrap
                    value={line.parts.here}
                    label={`${entry.table.name}, Zeile ${index + 1}`}
                    placeholder="–"
                    onSave={(text) => setPart(index, 'here', text)}
                  />
                </td>
                {site && (
                  <td>
                    <Written
                      wrap
                      value={line.parts.afar}
                      label={`${entry.table.name}, Zeile ${index + 1}: ${below ? 'von nebenan' : 'von fern'}`}
                      placeholder="–"
                      onSave={(text) => setPart(index, 'afar', text)}
                    />
                  </td>
                )}
                {site && (
                  <td>
                    <Written
                      wrap
                      value={line.parts.hidden}
                      label={`${entry.table.name}, Zeile ${index + 1}: verborgen`}
                      placeholder="–"
                      onSave={(text) => setPart(index, 'hidden', text)}
                    />
                  </td>
                )}
                <td className="wf-einstellungen-rolltable__weight">
                  <FrequencySelect
                    weight={line.weight}
                    label={`${entry.table.name}, Zeile ${index + 1}: Häufigkeit`}
                    onChange={(weight) => change(index, { weight })}
                  />
                </td>
                <td>
                  <IconButton
                    label="Zeile entfernen"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const undo = save(lines.filter((_, i) => i !== index));
                      toast({
                        title: 'Zeile entfernt',
                        body: line.parts.here || line.parts.afar || line.parts.hidden,
                        action: { label: 'Rückgängig', run: undo },
                      });
                    }}
                  >
                    <Trash2 />
                  </IconButton>
                </td>
              </tr>
            );
          })}
          <tr>
            <td className="wf-einstellungen-rolltable__nr">
              {(entry.table.rows[entry.table.rows.length - 1]?.max ?? 0) + 1}
            </td>
            <td colSpan={columns - 1}>
              <NewLine
                label={`${entry.table.name}: neue Zeile`}
                placeholder="Neue Zeile …"
                onAdd={(text) =>
                  save([...lines, { parts: { here: text, afar: '', hidden: '' }, weight: 2 }])
                }
              />
            </td>
          </tr>
        </tbody>
      </table>
    </details>
  );
}
