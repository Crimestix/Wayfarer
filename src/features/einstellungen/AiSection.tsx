/**
 * Abschnitt der Einstellungen: der KI-Leser. Key hinterlegen, Modell wählen, sehen, was es
 * bisher gekostet hat, und alle noch ungelesenen Artikel auf einmal lesen lassen.
 */
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { KeyRound, Play, Square, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { aiClearKey, aiSetKey, isDesktopApp } from '../../data/platform';
import { Button, Field, Input, Select, confirmDialog, toast } from '../../ui';
import { modelOf, readArticle, readingTotals, unreadArticles } from '../ki/actions';
import { refreshAiKey, useAiKey } from '../ki/AiPanel';
import { AI_MODELS, articleText, costUsd, estimateTokens, formatUsd } from '../ki/reader';
import '../ki/ki.css';

/** Der Auftrag an das Modell kommt bei jedem Artikel dazu; die Antwort ist kurz. */
const TASK_TOKENS = 1200;
const REPLY_TOKENS = 500;

export function AiSection() {
  const db = useDb();
  const data = useData();
  const desktop = isDesktopApp();
  const hasKey = useAiKey();
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; usd: number } | null>(
    null,
  );
  const stop = useRef(false);

  const model = modelOf(data);
  const totals = useMemo(() => readingTotals(data), [data]);
  const unread = useMemo(() => unreadArticles(data), [data]);
  const estimate = useMemo(
    () =>
      unread.reduce(
        (sum, article) =>
          sum + costUsd(model, estimateTokens(articleText(article)) + TASK_TOKENS, REPLY_TOKENS),
        0,
      ),
    [unread, model],
  );

  const save = (event: FormEvent) => {
    event.preventDefault();
    const value = key.trim();
    if (!value) {
      setError('Bitte füge zuerst den Key ein.');
      return;
    }
    setSaving(true);
    setError('');
    aiSetKey(value)
      .then(async () => {
        setKey('');
        await refreshAiKey();
        toast({ title: 'Key gespeichert', body: 'Er liegt im Schlüsselbund deines Rechners.' });
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Das hat nicht geklappt.'),
      )
      .finally(() => setSaving(false));
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Claude-Key entfernen?',
      body: 'Der Key wird aus dem Schlüsselbund gelöscht. Vorschläge, die schon vorliegen, bleiben.',
      confirmLabel: 'Entfernen',
      danger: true,
    });
    if (!ok) return;
    try {
      await aiClearKey();
      await refreshAiKey();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Das hat nicht geklappt.');
    }
  };

  const readAll = async () => {
    const list = unread;
    if (!list.length || progress) return;
    const ok = await confirmDialog({
      title: `${list.length} ${list.length === 1 ? 'Artikel' : 'Artikel'} lesen lassen?`,
      body: `Der Text dieser Artikel wird an Anthropic geschickt. Geschätzte Kosten mit ${model.label.split(' – ')[0]}: rund ${formatUsd(estimate)}. Du kannst jederzeit anhalten; was gelesen ist, bleibt.`,
      confirmLabel: 'Lesen lassen',
    });
    if (!ok) return;
    stop.current = false;
    let usd = 0;
    let found = 0;
    setProgress({ done: 0, total: list.length, usd: 0 });
    for (const [index, article] of list.entries()) {
      if (stop.current) break;
      try {
        const result = await readArticle(db, article.id);
        usd += result.usd;
        found += result.added;
      } catch (cause) {
        toast({
          title: `Angehalten bei „${article.title}“`,
          body: cause instanceof Error ? cause.message : 'Unerwarteter Fehler.',
          tone: 'danger',
          duration: 12000,
        });
        break;
      }
      setProgress({ done: index + 1, total: list.length, usd });
    }
    setProgress(null);
    toast({
      title: found === 1 ? 'Ein Vorschlag liegt bereit' : `${found} Vorschläge liegen bereit`,
      body: `Gelesen für ${formatUsd(usd)}. Die Vorschläge stehen im Wiki an den Artikeln.`,
      duration: 10000,
    });
  };

  return (
    <div className="wf-ki-set">
      <p>
        Der KI-Leser liest einen Artikel und schlägt vor, was daraus für die Welt folgt: was
        regelmäßig oder an einem Tag geschieht, wer wie zu wem steht, was offen ist. Er schreibt
        nichts und ändert nichts – jeder Vorschlag zeigt den Satz, aus dem er stammt, und gilt erst,
        wenn du ihn annimmst. Alles andere in Wayfarer läuft ohne ihn.
      </p>
      <p className="wf-ki-set__note">
        Zum Lesen wird der Text des Artikels an Anthropic geschickt, den Hersteller von Claude.
        Abgerechnet wird dort nach Textmenge über ein eigenes Konto mit Guthaben – das Claude-Abo
        gilt dafür nicht. Den Key erstellst du in der Konsole von Anthropic (platform.claude.com).
      </p>

      {!desktop ? (
        <p>Der KI-Leser arbeitet nur in der installierten App, nicht in der Vorschau im Browser.</p>
      ) : hasKey ? (
        <div className="wf-ki-set__row">
          <span>Ein Claude-Key ist hinterlegt.</span>
          <Button size="sm" icon={<Trash2 />} onClick={() => void remove()}>
            Key entfernen
          </Button>
        </div>
      ) : (
        <form className="wf-ki-set__key" onSubmit={save}>
          <Field label="Claude-Key" hint="Er wird im Schlüsselbund deines Rechners abgelegt.">
            <Input
              type="password"
              autoComplete="off"
              value={key}
              placeholder="sk-ant-…"
              onChange={(event) => setKey(event.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" icon={<KeyRound />} disabled={saving}>
            Key speichern
          </Button>
        </form>
      )}
      {error && <p className="wf-ki-set__error">{error}</p>}

      <Field label="Modell" hint={model.hint}>
        <Select
          value={model.id}
          onChange={(event) => db.setCampaign({ aiModel: event.target.value })}
        >
          {AI_MODELS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </Select>
      </Field>

      <p>
        Bisher gelesen: {totals.articles} Artikel für rund {formatUsd(totals.usd)}.{' '}
        {totals.open > 0 &&
          `${totals.open === 1 ? 'Ein Vorschlag wartet' : `${totals.open} Vorschläge warten`} im Wiki.`}
      </p>

      <div className="wf-ki-set__row">
        {progress ? (
          <>
            <span>
              Claude liest … {progress.done} von {progress.total} Artikeln, bisher{' '}
              {formatUsd(progress.usd)}.
            </span>
            <Button size="sm" icon={<Square />} onClick={() => (stop.current = true)}>
              Anhalten
            </Button>
          </>
        ) : (
          <>
            <Button
              icon={<Play />}
              disabled={!desktop || !hasKey || unread.length === 0}
              onClick={() => void readAll()}
            >
              Alle ungelesenen Artikel lesen lassen
            </Button>
            <span>
              {unread.length === 0
                ? 'Alle Artikel mit genug Text sind in ihrem jetzigen Wortlaut gelesen.'
                : `${unread.length} Artikel, geschätzt rund ${formatUsd(estimate)}.`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
