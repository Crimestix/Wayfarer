/**
 * Abschnitt „Quellen“: woher das Nachschlagewerk stammt, das Wayfarer mitbringt – mit der
 * Namensnennung, die seine Lizenz verlangt. Nie entfernen.
 */
import { SRD_ATTRIBUTION, SRD_EQUIPMENT } from '../../domain/srd/lookup';
import { SectionTitle } from '../../ui';

export function SourcesSection() {
  return (
    <div className="wf-einstellungen-stack">
      <div>
        <SectionTitle>Diese Fassung</SectionTitle>
        <p className="wf-soft">Wayfarer {__APP_VERSION__}</p>
      </div>
      <div>
        <SectionTitle>Ausrüstung aus dem Regelwerk</SectionTitle>
        <p className="wf-soft">{SRD_ATTRIBUTION.de}</p>
        <p className="wf-mute">
          {SRD_EQUIPMENT.length} Gegenstände, Tiere, Fahrzeuge und Dienste mit Preis. In einen Laden
          kommt davon nur, was du unter „Aus dem Regelwerk“ ankreuzt.
        </p>
      </div>
      <blockquote className="wf-einstellungen-credit" lang="en">
        {SRD_ATTRIBUTION.en}
      </blockquote>
    </div>
  );
}
