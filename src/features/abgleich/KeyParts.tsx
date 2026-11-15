/**
 * Bausteine rund um den Zugangsschlüssel: die Anleitung für GitHubs Seite (Schritt 3), das Feld
 * mit „Speichern und prüfen“ (Schritt 4) – genutzt beim Einrichten, beim Ersetzen und beim Holen
 * am zweiten Rechner.
 */
import { useState, type ReactNode } from 'react';
import { ExternalLink, KeyRound } from 'lucide-react';
import { toSyncFailure, type FoundRepo, type RepoInfo } from '../../data/platform';
import { Button, Field, Input, cx } from '../../ui';
import {
  KEY_HINT,
  MAC_KEYCHAIN,
  SECOND_LOGIN,
  SECOND_MACHINE,
  STEP3_LEAD,
  STEP3_TAIL,
  isMacAgent,
  keyErrorText,
  keyFormProblem,
  probeOutcome,
  probeText,
  progressShare,
  progressText,
  step3Points,
  tokenPageUrl,
  type ProbeOutcome,
} from './model';
import type { SyncPort } from './port';
import type { SyncView } from './state';
import './abgleich.css';

/** Balken und Zeile „Lade hoch … 1 200 von 3 480 Einträgen“. */
export function ProgressLine({
  progress,
  fallback = 'Wird abgeglichen …',
}: {
  progress: SyncView['progress'];
  fallback?: string;
}) {
  const share = progressShare(progress);
  return (
    <div className="wf-einstellungen-progress" role="status" aria-live="polite">
      <div className="wf-einstellungen-progress__bar">
        <span style={{ width: `${(share ?? 0) * 100}%` }} />
      </div>
      <span>{progressText(progress) ?? fallback}</span>
    </div>
  );
}

/** Text mit einem fett gesetzten Namen (der gefundene Name steht immer groß). */
function Emphasized({ text, strong }: { text: string; strong: string | null }) {
  if (!strong || !text.includes(strong)) return <>{text}</>;
  const at = text.indexOf(strong);
  return (
    <>
      {text.slice(0, at)}
      <strong>{strong}</strong>
      {text.slice(at + strong.length)}
    </>
  );
}

/** Ein Knopf, der eine Seite im Browser des Systems öffnet. */
export function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="wf-btn" href={href} target="_blank" rel="noreferrer noopener">
      <ExternalLink />
      {children}
    </a>
  );
}

/** Die Anleitung für den Zugangsschlüssel (Schritt 3). */
export function KeyGuide({
  device,
  second,
  showTail = true,
  loginOnly = false,
  repo,
}: {
  device: string;
  /** Beim Ersetzen: die verbundene Ablage („Besitzer/Name“) statt „die Ablage aus Schritt 2“. */
  repo?: string;
  /** Zweiter Rechner: vorab der Satz „Den Schlüssel vom anderen Rechner …“. */
  second: boolean;
  showTail?: boolean;
  /** Der Satz über den anderen Schlüssel steht schon darüber: nur „Melde dich … an“. */
  loginOnly?: boolean;
}) {
  return (
    <div className="wf-abgleich-guide">
      {second && <p className="wf-soft">{loginOnly ? SECOND_LOGIN : SECOND_MACHINE}</p>}
      <p className="wf-soft">{STEP3_LEAD}</p>
      <ol className="wf-abgleich-points">
        {step3Points(second, repo).map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ol>
      <div>
        <OutLink href={tokenPageUrl(device)}>Seite bei GitHub öffnen</OutLink>
      </div>
      {showTail && !second && <p className="wf-mute">{STEP3_TAIL}</p>}
    </div>
  );
}

export interface KeyResult {
  outcome: ProbeOutcome;
  /** Die gewählte Ablage mit Inhalt (bei `found`). */
  found: FoundRepo | null;
}

/**
 * Feld „Zugangsschlüssel“ mit „Speichern und prüfen“. Bei mehreren Ablagen fragt es nach der
 * richtigen; gilt der Schlüssel für genau eine, prüft es sie gleich.
 */
export function KeyForm({
  port,
  label = 'Speichern und prüfen',
  primary,
  target,
  onResult,
  extra,
  quietFound = false,
}: {
  port: SyncPort;
  label?: string;
  primary: boolean;
  /** Beim Ersetzen: die Ablage, für die der Schlüssel gelten soll. */
  target?: { owner: string; repo: string };
  onResult: (result: KeyResult) => void;
  extra?: ReactNode;
  /** Gefunden wird darunter ausführlicher gesagt (Holen am zweiten Rechner). */
  quietFound?: boolean;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ text: string; error: boolean; strong?: string } | null>(null);
  const [repos, setRepos] = useState<RepoInfo[] | null>(null);

  const finish = (outcome: ProbeOutcome) => {
    const ok = outcome.kind === 'found';
    if (ok && quietFound) {
      setLine(null);
      setRepos(null);
      onResult({ outcome, found: outcome.found });
      return;
    }
    const strong =
      outcome.kind === 'found'
        ? `${outcome.found.info.owner}/${outcome.found.info.repo}`
        : outcome.kind === 'foreign' || outcome.kind === 'public'
          ? outcome.name
          : undefined;
    setLine({
      text: probeText(outcome),
      error: !ok && outcome.kind !== 'choose',
      ...(strong ? { strong } : {}),
    });
    setRepos(outcome.kind === 'choose' ? outcome.repos : null);
    onResult({ outcome, found: ok ? outcome.found : null });
  };

  const check = async (owner?: string, repo?: string) => {
    setBusy(true);
    try {
      let outcome = probeOutcome(await port.probe(owner, repo));
      if (outcome.kind === 'one')
        outcome = probeOutcome(await port.probe(outcome.repo.owner, outcome.repo.repo));
      finish(outcome);
    } catch (e) {
      setLine({ text: keyErrorText(toSyncFailure(e)), error: true });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const problem = keyFormProblem(key);
    if (problem) {
      setLine({ text: problem, error: true });
      return;
    }
    setBusy(true);
    setLine(null);
    try {
      await port.setKey(key.trim());
      setKey('');
    } catch (e) {
      setLine({ text: keyErrorText(toSyncFailure(e)), error: true });
      setBusy(false);
      return;
    }
    await check(target?.owner, target?.repo);
  };

  return (
    <div className="wf-abgleich-keyform">
      <form
        className="wf-abgleich-keyform__row"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Zugangsschlüssel" hint={KEY_HINT} className="wf-grow">
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            placeholder="github_pat_…"
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
        <Button
          type="submit"
          variant={primary ? 'primary' : 'default'}
          icon={<KeyRound />}
          disabled={busy}
        >
          {busy ? 'Wird geprüft …' : label}
        </Button>
      </form>
      {isMacAgent(navigator.userAgent) && <p className="wf-mute">{MAC_KEYCHAIN}</p>}
      {line && (
        <p
          className={cx('wf-abgleich-line', line.error && 'wf-abgleich-error')}
          role={line.error ? 'alert' : 'status'}
        >
          <Emphasized text={line.text} strong={line.strong ?? null} />
        </p>
      )}
      {repos && (
        <div className="wf-abgleich-repos" role="group" aria-label="Ablagen">
          {repos.map((r) => (
            <button
              key={`${r.owner}/${r.repo}`}
              type="button"
              className="wf-einstellungen-choice"
              disabled={busy}
              onClick={() => void check(r.owner, r.repo)}
            >
              <span className="wf-einstellungen-choice__title">
                {r.owner}/{r.repo}
              </span>
            </button>
          ))}
        </div>
      )}
      {extra}
    </div>
  );
}
