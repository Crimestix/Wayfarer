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
            <strong>Konfliktkopien:</strong> Ändern zwei Rechner dieselbe Datei, bevor das
            Cloud-Laufwerk abgeglichen hat, legt es eine zweite Datei daneben – oft mit einem Zusatz
            wie „(Konflikt)“, „(1)“ oder dem Namen des Rechners. Wayfarer lädt solche Dateien nicht
            und überschreibt oder löscht sie nie. Schließe Wayfarer und suche die Datei im
            Kampagnenordner: Ist die Kopie die ältere Fassung, kannst du sie löschen. Ist sie die
            neuere, benenne sie auf den Namen der Datei ohne Zusatz um und ersetze diese damit.
          </p>
        )}
        {others && (
          <p>
            <strong>Beschädigte oder unerwartete Dateien:</strong> Oft ist das Cloud-Laufwerk noch
            nicht fertig mit dem Abgleich – dann hilft es, kurz zu warten und Wayfarer neu zu
            starten. Bleibt die Meldung, lässt sich die Datei meist über den Versionsverlauf des
            Cloud-Laufwerks wiederherstellen. Wayfarer überschreibt sie nicht.
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
