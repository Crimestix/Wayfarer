/** Einstellungen: Kampagne, Sicherung, Übernahme aus der alten Version, LegendKeeper, Kalender. */
import { BookOpen } from 'lucide-react';
import { useDb } from '../../data/hooks';
import { isDesktopApp } from '../../data/platform';
import { EmptyState } from '../../ui';
import { LegendKeeperSettings } from '../legendkeeper';
import { BackupSection } from './BackupSection';
import { CalendarSection } from './CalendarSection';
import { CampaignSection } from './CampaignSection';
import { LegacySection } from './LegacySection';
import { Boundary, Section } from './parts';
import { explainProblems } from './model';
import { ProblemsSection } from './ProblemsSection';
import './einstellungen.css';

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI'];

export default function Page() {
  const db = useDb();
  const problems = explainProblems(db.problems).length;
  const desktop = isDesktopApp();
  let n = 0;
  const numeral = () => NUMERALS[n++] ?? '';

  return (
    <div className="wf-page">
      <header className="wf-page__head">
        <h1 className="wf-page__title">Einstellungen</h1>
        <p className="wf-page__lead">
          Kampagne, Sicherung und Kalender – alles, was nicht am Spieltisch gebraucht wird.
        </p>
      </header>
      <div className="wf-page__body">
        <div className="wf-einstellungen">
          {problems > 0 && (
            <Section
              numeral="!"
              alert
              title="Probleme beim Laden"
              lead={
                problems === 1
                  ? 'Eine Datei im Kampagnenordner konnte nicht gelesen werden. Sie fehlt im Spielstand, liegt aber unverändert im Ordner.'
                  : `${problems} Dateien im Kampagnenordner konnten nicht gelesen werden. Sie fehlen im Spielstand, liegen aber unverändert im Ordner.`
              }
            >
              <ProblemsSection />
            </Section>
          )}

          <Section
            numeral={numeral()}
            title="Kampagne"
            lead={
              desktop
                ? 'Wie die Kampagne heißt und in welchem Ordner ihr Spielstand liegt.'
                : 'Wie die Kampagne heißt und wo ihr Spielstand liegt.'
            }
          >
            <CampaignSection />
          </Section>

          <Section
            numeral={numeral()}
            title="Sicherung"
            lead="Die ganze Kampagne in einer Datei – zum Aufbewahren vor großen Änderungen oder zum Mitnehmen."
          >
            <BackupSection />
          </Section>

          <Section
            numeral={numeral()}
            title="Alten Spielstand übernehmen"
            lead="Holt Weltzeit, Orte, Personen, Haltungen, Abmachungen, Termine und Timer aus dem bisherigen Wayfarer herüber und zeigt vorher, was mitkommt und was nicht."
          >
            <LegacySection />
          </Section>

          <Section
            numeral={numeral()}
            title="LegendKeeper"
            lead="Wayfarer liest Artikel aus LegendKeeper und verknüpft sie mit Orten und Personen. Geschrieben wird dort nie."
          >
            <Boundary
              fallback={
                <EmptyState
                  icon={<BookOpen />}
                  title="LegendKeeper lässt sich gerade nicht anzeigen"
                >
                  Die übrigen Einstellungen sind davon nicht betroffen. Ein Neustart von Wayfarer
                  hilft meistens.
                </EmptyState>
              }
            >
              <LegendKeeperSettings />
            </Boundary>
          </Section>

          <Section
            numeral={numeral()}
            title="Kalender"
            lead="Die Zeitrechnung der Welt zum Nachlesen: Monate, Wochentage, Zeitrechnungen und Monde."
          >
            <CalendarSection />
          </Section>
        </div>
      </div>
    </div>
  );
}
