/**
 * Ansicht „Geschichte“ der Welt: was der Vergangenheit angehört, nach Zeitaltern geordnet – mit
 * Suche, Kategorie und „auch Altes, das noch besteht“. Oben ein Feld, um Vergangenes gleich als
 * solches anzulegen: Name, Kategorie, wann es endete. Die Rechnung steht in `history.ts`.
 */
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Hourglass, Plus, Search } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL, KIND_LABEL_PLURAL } from '../../domain/derive';
import { datePointText } from '../../domain/lifespan';
import {
  Button,
  Checkbox,
  EmptyState,
  Input,
  KindIcon,
  Portrait,
  Select,
  StubMark,
  toast,
} from '../../ui';
import {
  createHistoric,
  historyRows,
  historySections,
  type HistoryFilter,
  type HistoryRow,
} from './history';
import { WORLD_KINDS, type WorldKind } from './model';

/** Was man hier am häufigsten anlegt – zuerst in der Auswahl. */
const CREATE_KINDS: WorldKind[] = [
  'person',
  'place',
  'happening',
  'faction',
  'family',
  'realm',
  'item',
];

/** Filter, solange die App läuft. */
let remembered: HistoryFilter = { kind: null, old: false, query: '' };

export function HistoryView() {
  const data = useData();
  const [filter, setFilterState] = useState<HistoryFilter>(remembered);
  const set = (change: Partial<HistoryFilter>) => {
    remembered = { ...filter, ...change };
    setFilterState(remembered);
  };
  const rows = useMemo(() => historyRows(data, filter), [data, filter]);
  const sections = useMemo(() => historySections(data, rows), [data, rows]);
  // Nur Kategorien zur Wahl, die in der Geschichte vorkommen.
  const kinds = useMemo(() => {
    const all = historyRows(data, { ...filter, kind: null, query: '' });
    return WORLD_KINDS.filter((kind) => all.some((row) => row.entity.kind === kind));
  }, [data, filter]);
  return (
    <div className="wf-welt-landing wf-welt-history">
      <header className="wf-welt-landing__head">
        <div className="wf-welt-landing__eyebrow">Welt</div>
        <h1 className="wf-welt-landing__title">Geschichte</h1>
        <p className="wf-welt-landing__lead">
          Was war: Verstorbene, untergegangene Orte, aufgelöste Bünde, Ereignisse – nach deinen
          Zeitaltern geordnet. In der <Link href="/zeitleiste">Zeitleiste</Link> steht dasselbe auf
          einer Achse.
        </p>
      </header>

      <HistoricForm />

      <div className="wf-welt-history__bar">
        <div className="wf-welt-search">
          <Search />
          <Input
            value={filter.query}
            placeholder="Name …"
            aria-label="Geschichte durchsuchen"
            onChange={(e) => set({ query: e.target.value })}
          />
        </div>
        <Select
          value={filter.kind ?? ''}
          aria-label="Kategorie"
          onChange={(e) => set({ kind: (e.target.value || null) as WorldKind | null })}
        >
          <option value="">Alle Kategorien</option>
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL_PLURAL[kind]}
            </option>
          ))}
        </Select>
        <Checkbox checked={filter.old} onChange={(old) => set({ old })}>
          Auch Altes, das noch besteht
        </Checkbox>
      </div>

      {sections.length ? (
        sections.map((section) => (
          <section key={section.title} className="wf-welt-history__age">
            <h2 className="wf-welt-history__agetitle">
              {section.title}
              {section.age && (
                <span>
                  {datePointText(data.campaign.calendar, section.age.age.from)}
                  {section.age.age.to
                    ? ` – ${datePointText(data.campaign.calendar, section.age.age.to)}`
                    : ' – heute'}
                </span>
              )}
            </h2>
            <ol className="wf-welt-history__rows">
              {section.rows.map((row) => (
                <HistoryLine key={row.entity.id} row={row} />
              ))}
            </ol>
          </section>
        ))
      ) : (
        <EmptyState icon={<Hourglass />} title="Noch keine Geschichte">
          {filter.query || filter.kind
            ? 'Nichts passt zu Suche und Kategorie.'
            : 'Wer stirbt, was untergeht oder endet, steht hier von selbst. Oben legst du Vergangenes gleich als solches an – „vor 300 Jahren“ genügt.'}
        </EmptyState>
      )}
    </div>
  );
}

function HistoryLine({ row }: { row: HistoryRow }) {
  const data = useData();
  const { entity } = row;
  const when = entity.ended
    ? datePointText(data.campaign.calendar, entity.ended)
    : entity.born
      ? datePointText(data.campaign.calendar, entity.born)
      : '';
  return (
    <li className="wf-welt-history__row" data-past={row.past || undefined}>
      <span className="wf-welt-history__when">{when || '–'}</span>
      <Link href={`/welt/${entity.id}`} className="wf-welt-history__link">
        <Portrait entity={entity} size={36} />
        <span>
          <b>{entity.name}</b> <StubMark entity={entity} />
          <span className="wf-welt-history__sub">
            <KindIcon kind={entity.kind} /> {KIND_LABEL[entity.kind]}
            {row.line ? ` · ${row.line}` : ''}
            {entity.tagline ? ` · ${entity.tagline}` : ''}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Vergangenes gleich als solches anlegen – ohne die Seite zu verlassen. */
function HistoricForm() {
  const db = useDb();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<WorldKind>('person');
  const [ended, setEnded] = useState('');
  const [born, setBorn] = useState('');
  const [line, setLine] = useState('');
  const [problem, setProblem] = useState('');
  const create = () => {
    if (!name.trim()) return;
    const done = createHistoric(db, { name, kind, ended, born, line });
    if ('problem' in done) {
      setProblem(done.problem);
      return;
    }
    setProblem('');
    setName('');
    setEnded('');
    setBorn('');
    setLine('');
    toast({
      title: done.created
        ? `„${name.trim()}“ in die Geschichte gelegt`
        : `„${name.trim()}“ gab es schon`,
      body: done.created
        ? 'Als Platzhalter – geschrieben wird später.'
        : 'Er hat sein Ende bekommen, wenn er noch keins hatte.',
      action: { label: 'Rückgängig', run: done.undo },
    });
  };
  const endWord = kind === 'person' ? 'Gestorben' : kind === 'place' ? 'Untergegangen' : 'Endete';
  const startWord = kind === 'person' ? 'Geboren' : kind === 'happening' ? 'Begann' : 'Gegründet';
  return (
    <form
      className="wf-welt-history__form"
      onSubmit={(event) => {
        event.preventDefault();
        create();
      }}
    >
      <Input
        value={name}
        placeholder="Was war – ein Name"
        aria-label="Name"
        onChange={(e) => setName(e.target.value)}
      />
      <Select
        value={kind}
        aria-label="Kategorie"
        onChange={(e) => setKind(e.target.value as WorldKind)}
      >
        {CREATE_KINDS.map((option) => (
          <option key={option} value={option}>
            {KIND_LABEL[option]}
          </option>
        ))}
      </Select>
      <Input
        value={ended}
        placeholder={`${endWord}: vor 300 Jahren`}
        aria-label={endWord}
        onChange={(e) => setEnded(e.target.value)}
      />
      <Input
        value={born}
        placeholder={`${startWord} (freiwillig)`}
        aria-label={startWord}
        onChange={(e) => setBorn(e.target.value)}
      />
      <Input
        className="wf-welt-history__line"
        value={line}
        placeholder="Ein Satz dazu (freiwillig)"
        aria-label="Ein Satz dazu"
        onChange={(e) => setLine(e.target.value)}
      />
      <Button type="submit" icon={<Plus />} disabled={!name.trim()}>
        In die Geschichte
      </Button>
      {problem && (
        <p className="wf-welt-history__problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}
