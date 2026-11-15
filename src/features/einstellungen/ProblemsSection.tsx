/** Abschnitt „Probleme beim Laden“: Dateien, die Wayfarer nicht lesen konnte – mit Erklärung. */
import { Copy, FileWarning } from 'lucide-react';
import { useDb } from '../../data/hooks';
import { Badge } from '../../ui';
import { explainProblems, type ProblemKind } from './model';

const KIND_BADGE: Record<ProblemKind, { label: string; tone: 'ember' | 'blood' | 'arcane' }> = {
  conflict: { label: 'Konfliktkopie', tone: 'ember' },
  damaged: { label: 'Beschädigt', tone: 'blood' },
  shape: { label: 'Unerwarteter Inhalt', tone: 'arcane' },
};

export function ProblemsSection() {
  const db = useDb();
  // db.problems ist eine Liste, die wachsen kann – deshalb nicht nach db zwischenspeichern.
  const problems = explainProblems(db.problems);
  const conflicts = problems.some((p) => p.kind === 'conflict');
  const others = problems.some((p) => p.kind !== 'conflict');
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
        {conflicts && (
          <p>
            <strong>Konfliktkopien:</strong> Wurde der Kampagnenordner von Hand kopiert oder liegt
            er in einem Cloud-Laufwerk, entsteht manchmal eine zweite Datei daneben – oft mit einem
            Zusatz wie „(Konflikt)“, „(1)“ oder dem Namen des Rechners. Wayfarer lädt solche Dateien
            nicht und überschreibt oder löscht sie nie; der eigene Abgleich lässt sie aus. Schließe
            Wayfarer und suche die Datei im Kampagnenordner: Ist die Kopie die ältere Fassung,
            kannst du sie löschen. Ist sie die neuere, benenne sie auf den Namen der Datei ohne
            Zusatz um und ersetze diese damit.
          </p>
        )}
        {others && (
          <p>
            <strong>Beschädigte oder unerwartete Dateien:</strong> Oft schreibt gerade noch ein
            anderes Programm an der Datei – dann hilft es, kurz zu warten und Wayfarer neu zu
            starten. Bleibt die Meldung, hilft eine Sicherung. Wayfarer überschreibt die Datei
            nicht, und der Abgleich lässt sie aus, bis sie wieder lesbar ist.
          </p>
        )}
        <p>
          Beim nächsten Start verschwindet die Meldung. Im Zweifel vorher unter „Sicherung“ den
          jetzigen Stand sichern.
        </p>
      </div>
    </div>
  );
}
