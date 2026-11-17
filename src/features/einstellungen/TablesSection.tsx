/**
 * Abschnitt „Würfeltabellen“: die Listen, aus denen Wayfarers Erzeuger wählen – eine Zeile je
 * Möglichkeit, so viele, wie man will. Jede steht als Vorgabe da, bis der Spielleiter sie ändert;
 * „Vorgabe wiederherstellen“ nimmt seine wieder weg. Geschrieben wird beim Verlassen des Feldes.
 */
import { RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { useData, useDb } from '../../data/hooks';
import { IconButton, Written, toast } from '../../ui';
import { generatorTables, generatorText } from '../erkundung/tables';
import { resetGeneratorTable, saveGeneratorTable } from '../erkundung/tableActions';

export function TablesSection() {
  const db = useDb();
  const data = useData();
  const tables = useMemo(() => generatorTables(data), [data]);
  return (
    <div className="wf-einstellungen-tables">
      <p className="wf-mute">
        Eine Zeile je Möglichkeit – Wayfarer wählt beim Erzeugen eine davon aus, jede gleich oft.
        Was häufiger vorkommen soll, bekommt „3×“ davor. Eine leere Tabelle heißt: hier nichts
        erzeugen. Schon erzeugte Karten ändern sich erst, wenn du sie neu würfelst.
      </p>
      {tables.all.map((entry) => {
        const count = entry.table.rows.length;
        return (
          <details key={entry.slot} className="wf-einstellungen-tables__table">
            <summary>
              <span className="wf-einstellungen-tables__name">{entry.table.name}</span>
              <span className="wf-mute">
                {count === 1 ? 'ein Eintrag' : `${count} Einträge`} ·{' '}
                {entry.own ? 'deine eigene' : 'Vorgabe'}
              </span>
            </summary>
            {entry.lead && <p className="wf-mute">{entry.lead}</p>}
            <div className="wf-einstellungen-tables__body">
              <Written
                grow
                value={generatorText(entry)}
                label={`Würfeltabelle: ${entry.table.name}`}
                placeholder="leer – hier erzeugt Wayfarer nichts"
                onSave={(text) => saveGeneratorTable(db, entry.slot, text)}
              />
              {entry.own && (
                <IconButton
                  label="Vorgabe wiederherstellen"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
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
            </div>
          </details>
        );
      })}
    </div>
  );
}
