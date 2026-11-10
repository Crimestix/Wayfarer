/** Abschnitt „Probleme beim Laden“: Dateien, die Wayfarer nicht lesen konnte – mit Erklärung. */
import { useMemo } from 'react';
import { Copy, FileWarning } from 'lucide-react';
import { useDb } from '../../data/hooks';
import { Badge } from '../../ui';
import { explainProblem, type ProblemKind } from './model';

const KIND_BADGE: Record<ProblemKind, { label: string; tone: 'ember' | 'blood' | 'arcane' }> = {
  conflict: { label: 'Konfliktkopie', tone: 'ember' },
  damaged: { label: 'Beschädigt', tone: 'blood' },
  shape: { label: 'Unerwarteter Inhalt', tone: 'arcane' },
};

export function ProblemsSection() {
  const db = useDb();
  const problems = useMemo(() => db.problems.map(explainProblem), [db]);
  return (
    <div className="wf-einstellungen-stack">
      <div className="wf-einstellungen-problems">
        {problems.map((p) => (
          <div key={p.path} className="wf-einstellungen-problem">
            <div className="wf-einstellungen-problem__icon">
              {p.kind === 'conflict' ? <Copy /> : <FileWarning />}
            </div>
            <div className="wf-grow">
              <div className="wf-einstellungen-problem__head">
                <span className="wf-einstellungen-path">{p.path}</span>
                <Badge tone={KIND_BADGE[p.kind].tone}>{KIND_BADGE[p.kind].label}</Badge>
              </div>
              <div className="wf-soft">
                {p.what}: {p.reason}
              </div>
              {p.kind !== 'conflict' && (
                <details className="wf-einstellungen-problem__detail">
                  <summary>Genaue Meldung</summary>
                  <pre>{p.detail}</pre>
                </details>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="wf-einstellungen-help">
        <p>
          <strong>Was ist passiert?</strong> Ändern zwei Rechner dieselbe Datei, bevor das
          Cloud-Laufwerk abgeglichen hat, legt es eine zweite Datei daneben – eine Konfliktkopie,
          oft mit einem Zusatz wie „(Konflikt)“, „(1)“ oder dem Namen des Rechners. Wayfarer lädt
          solche Dateien nicht und überschreibt oder löscht sie nie.
        </p>
        <p>
          <strong>Was tun?</strong> Wayfarer schließen und die genannte Datei im Kampagnenordner
          suchen. Ist die Kopie die ältere Fassung, kannst du sie löschen. Ist sie die neuere,
          benenne sie auf den Namen der Datei ohne Zusatz um und ersetze diese damit. Beim nächsten
          Start verschwindet die Meldung. Im Zweifel vorher unter „Sicherung“ den jetzigen Stand
          sichern.
        </p>
      </div>
    </div>
  );
}
