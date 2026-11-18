/**
 * „Ohne Kategorie“ auf der Bühne der Welt: alle Artikel, die noch zu keinem Eintrag gehören
 * (`unsortedRows`). Je Zeile: Kategorie geben (der Vorschlag aus Ordner oder Steckbrief steht als
 * Knopf da) oder löschen; mehrere auf einmal über die Kästchen. Gelöschtes liegt im Papierkorb.
 */
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL } from '../../domain/derive';
import type { EntityKind } from '../../domain/schema';
import { Button, IconButton, Input, Select, toast } from '../../ui';
import { WORLD_KINDS } from './model';
import { dropArticles, filterUnsorted, sortArticles, unsortedRows } from './unsorted';

/** So viele Zeilen stehen zuerst da; mehr auf Klick – die Liste kann Hunderte lang sein. */
const PAGE = 150;

function KindPick({ label, onPick }: { label: string; onPick: (kind: EntityKind) => void }) {
  return (
    <span className="wf-welt-unsorted__pick">
      <Select
        value=""
        aria-label={label}
        onChange={(event) => {
          if (event.target.value) onPick(event.target.value as EntityKind);
        }}
      >
        <option value="">Kategorie …</option>
        {WORLD_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {KIND_LABEL[kind]}
          </option>
        ))}
      </Select>
    </span>
  );
}

export function UnsortedView() {
  const db = useDb();
  const data = useData();
  const rows = useMemo(() => unsortedRows(data), [data]);
  const [query, setQuery] = useState('');
  const [emptyOnly, setEmptyOnly] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [limit, setLimit] = useState(PAGE);
  const shown = filterUnsorted(rows, query, emptyOnly);
  // Gewählt bleibt nur, was noch dasteht.
  const chosen = shown.filter((row) => picked.has(row.article.id)).map((row) => row.article.id);
  const suggestedOf = new Map(rows.map((row) => [row.article.id, row.suggested]));
  const withSuggestion = chosen.filter((id) => suggestedOf.get(id));

  const sorted = (count: number, what: string, undo: () => void) => {
    if (!count) return;
    toast({
      title: count === 1 ? `Ein Artikel ist jetzt ${what}` : `${count} Artikel sind jetzt ${what}`,
      body: 'Sie stehen in der Welt bei ihrer Kategorie. Der Text ist geblieben, wie er war.',
      action: { label: 'Rückgängig', run: undo },
    });
  };
  const give = (ids: readonly string[], kind: EntityKind) => {
    const result = sortArticles(db, ids, kind);
    sorted(result.count, `„${KIND_LABEL[kind]}“`, result.undo);
  };
  const giveSuggested = (ids: readonly string[]) => {
    const result = sortArticles(db, ids, (id) => suggestedOf.get(id) ?? null);
    sorted(result.count, 'eingeordnet', result.undo);
  };
  const drop = (ids: readonly string[]) => {
    const result = dropArticles(db, ids);
    if (!result.count) return;
    toast({
      title: result.count === 1 ? 'Ein Artikel gelöscht' : `${result.count} Artikel gelöscht`,
      body: 'Er liegt im Papierkorb (Einstellungen) und lässt sich von dort zurückholen.',
      duration: 12000,
      action: { label: 'Rückgängig', run: result.undo },
    });
  };
  const toggle = (id: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const allPicked = shown.length > 0 && chosen.length === shown.length;

  return (
    <div className="wf-welt-landing wf-welt-unsorted">
      <header className="wf-welt-landing__head">
        <div className="wf-welt-landing__eyebrow">Wiki</div>
        <h1 className="wf-welt-landing__title">Ohne Kategorie</h1>
        <p className="wf-welt-landing__lead">
          {rows.length === 0
            ? 'Jeder Artikel gehört zu einem Eintrag der Welt. Hier ist nichts zu tun.'
            : 'Artikel, die noch zu keinem Eintrag der Welt gehören – alte Ordnerseiten, Übersichten, Abhandlungen. Gib ihnen eine Kategorie, lass sie als reinen Text stehen oder lösche, wofür Wayfarer einen besseren Ort hat.'}
        </p>
      </header>
      {rows.length > 0 && (
        <>
          <div className="wf-welt-unsorted__bar">
            <Input
              value={query}
              placeholder="In Titeln und Ordnern suchen …"
              aria-label="Artikel ohne Kategorie durchsuchen"
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(PAGE);
              }}
            />
            <div className="wf-btn-group">
              <Button size="sm" aria-pressed={!emptyOnly} onClick={() => setEmptyOnly(false)}>
                Alle {rows.length}
              </Button>
              <Button
                size="sm"
                aria-pressed={emptyOnly}
                title="Artikel ohne Text – oft Ordnerseiten aus der alten Struktur"
                onClick={() => setEmptyOnly(true)}
              >
                Nur leere {rows.filter((row) => row.words === 0).length}
              </Button>
            </div>
          </div>
          <div className="wf-welt-unsorted__bulk">
            <label className="wf-check">
              <input
                type="checkbox"
                checked={allPicked}
                onChange={(event) =>
                  setPicked(
                    event.target.checked ? new Set(shown.map((row) => row.article.id)) : new Set(),
                  )
                }
              />
              {chosen.length ? `${chosen.length} gewählt` : 'Alle wählen'}
            </label>
            <span className="wf-grow" />
            {chosen.length > 0 && (
              <>
                {withSuggestion.length > 0 && (
                  <Button
                    size="sm"
                    title="Jeder bekommt die Kategorie, die sein Ordner oder sein Steckbrief nahelegt"
                    onClick={() => giveSuggested(withSuggestion)}
                  >
                    {withSuggestion.length === chosen.length
                      ? 'Wie vorgeschlagen einordnen'
                      : `${withSuggestion.length} wie vorgeschlagen einordnen`}
                  </Button>
                )}
                <KindPick
                  label="Den gewählten Artikeln eine Kategorie geben"
                  onPick={(kind) => give(chosen, kind)}
                />
                <Button size="sm" icon={<Trash2 />} onClick={() => drop(chosen)}>
                  Löschen
                </Button>
              </>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="wf-mute">Dazu steht hier nichts.</p>
          ) : (
            <div className="wf-welt-unsorted__list">
              {shown.slice(0, limit).map((row) => (
                <div key={row.article.id} className="wf-welt-unsorted__row">
                  <input
                    type="checkbox"
                    aria-label={`${row.article.title} wählen`}
                    checked={picked.has(row.article.id)}
                    onChange={(event) => toggle(row.article.id, event.target.checked)}
                  />
                  <div className="wf-welt-unsorted__text">
                    <Link href={`/wiki/${row.article.id}`} className="wf-welt-unsorted__title">
                      {row.article.title}
                    </Link>
                    <span className="wf-welt-unsorted__sub">
                      {[
                        row.path,
                        row.words === 0
                          ? 'leer'
                          : row.words === 1
                            ? 'ein Wort'
                            : `${row.words} Wörter`,
                        row.children > 0 &&
                          (row.children === 1
                            ? 'ein Artikel darunter'
                            : `${row.children} Artikel darunter`),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  {row.suggested && (
                    <Button
                      size="sm"
                      title="Legt der Ordner oder der Steckbrief nahe"
                      onClick={() => give([row.article.id], row.suggested!)}
                    >
                      als {KIND_LABEL[row.suggested]}
                    </Button>
                  )}
                  <KindPick
                    label={`${row.article.title}: Kategorie geben`}
                    onPick={(kind) => give([row.article.id], kind)}
                  />
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`${row.article.title} löschen`}
                    onClick={() => drop([row.article.id])}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              ))}
              {shown.length > limit && (
                <Button size="sm" variant="ghost" onClick={() => setLimit(limit + PAGE)}>
                  {shown.length - limit} weitere zeigen
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
