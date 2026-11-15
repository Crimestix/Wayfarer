/** Einstellungen: Kampagne, Abgleich, Sicherung, Übernahme aus der alten Version und aus LegendKeeper, Kalender. */
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
import { AiSection } from './AiSection';
import { AtlasSection } from './AtlasSection';
import { WikiImportSection } from './WikiImportSection';
import { SourcesSection } from './SourcesSection';
import { ScaffoldSection } from './ScaffoldSection';
import { TrashSection } from './TrashSection';
import { TableRulesSheet } from '../tisch/TableRules';
import { SyncSection } from '../abgleich/SyncSection';
import { SECTION_LEAD } from '../abgleich/model';
import './einstellungen.css';

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'];

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

          <Section numeral={numeral()} title="Abgleich" lead={SECTION_LEAD}>
            <Boundary
              fallback={
                <EmptyState
                  icon={<BookOpen />}
                  title="Der Abgleich lässt sich gerade nicht anzeigen"
                >
                  Die übrigen Einstellungen sind davon nicht betroffen. Dein Spielstand ist auf
                  diesem Rechner gespeichert; ein Neustart von Wayfarer hilft meistens.
                </EmptyState>
              }
            >
              <SyncSection />
            </Boundary>
          </Section>

          <Section
            numeral={numeral()}
            title="Regeln des Tisches"
            lead="Hausregeln und Absprachen eurer Runde – am Spieltisch mit einem Klick auf die Schriftrolle im Kopf der Mitschrift zur Hand."
          >
            <TableRulesSheet />
          </Section>

          <Section
            numeral={numeral()}
            title="Steckbrief-Gerüste"
            lead="Welche Felder ein neuer Artikel je Art leer mitbekommt – Person, Ort, Fraktion und so weiter. Nur Feldnamen, nie ein Wert; ausgefüllt wird von dir."
          >
            <ScaffoldSection />
          </Section>

          <Section
            numeral={numeral()}
            title="Papierkorb"
            lead="Gelöschte Artikel mit allen Seiten. Sie bleiben hier, bis du sie wiederherstellst oder endgültig entfernst. Frühere Fassungen eines Artikels findest du an ihm selbst, im Menü „Mehr“."
          >
            <TrashSection />
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
            title="LegendKeeper ganz übernehmen"
            lead="Holt das ganze LegendKeeper-Projekt aus seiner Exportdatei herüber: alle Artikel, Karten und Steckbriefe liegen danach in Wayfarers eigenem Wiki – lesbar ohne LegendKeeper."
          >
            <WikiImportSection />
          </Section>

          <Section
            numeral={numeral()}
            title="Atlas übernehmen"
            lead="Holt den Planeten aus dem alten Atlas herüber: Küsten, Seen, Flüsse und Höhen. Damit weiß Wayfarer, wo Land und Wasser sind – und sobald du Orte auf die Weltkarte setzt, wie weit sie auseinanderliegen."
          >
            <AtlasSection />
          </Section>

          <Section
            numeral={numeral()}
            title="LegendKeeper"
            lead="Die direkte Verbindung: Wayfarer liest Artikel aus LegendKeeper und verknüpft sie mit Orten und Personen. Geschrieben wird dort nie."
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
            title="KI-Leser"
            lead="Claude liest deine Artikel und schlägt vor, was sich daraus in der Welt bewegt. Er liest nur – geschrieben und entschieden wird von dir."
          >
            <AiSection />
          </Section>

          <Section
            numeral={numeral()}
            title="Kalender"
            lead="Die Zeitrechnung der Welt: Monate, Wochentage, Zeitrechnungen und Monde zum Nachlesen, die Jahreszeiten zum Festlegen."
          >
            <CalendarSection />
          </Section>

          <Section
            numeral={numeral()}
            title="Quellen"
            lead="Was Wayfarer an Regelwerk mitbringt – als Nachschlagewerk, nie als Inhalt deiner Welt – und woher es stammt."
          >
            <SourcesSection />
          </Section>
        </div>
      </div>
    </div>
  );
}
