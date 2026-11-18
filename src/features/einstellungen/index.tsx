/** Einstellungen: Kampagne, Abgleich, Sicherung, Übernahme aus der alten Version und aus LegendKeeper, Kalender. */
import { BookOpen, FlaskConical } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFocus } from '../../shell/focus';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  groupOfSection,
  type SettingsGroupId,
  type SettingsSectionId,
} from './sections';
import { useDb } from '../../data/hooks';
import { isDesktopApp } from '../../data/platform';
import { useTestMode } from '../../data/testMode';
import { EmptyState } from '../../ui';
import { LegendKeeperSettings } from '../legendkeeper';
import { BackupSection } from './BackupSection';
import { CalendarSection } from './CalendarSection';
import { CampaignSection } from './CampaignSection';
import { LegacySection } from './LegacySection';
import { Boundary, Notice, Section } from './parts';
import { explainProblems } from './model';
import { ProblemsSection } from './ProblemsSection';
import { AiSection } from './AiSection';
import { AtlasSection } from './AtlasSection';
import { WikiImportSection } from './WikiImportSection';
import { SourcesSection } from './SourcesSection';
import { ScaffoldSection } from './ScaffoldSection';
import { TablesSection } from './TablesSection';
import { TrashSection } from './TrashSection';
import { DismissedSection } from './DismissedSection';
import { TableRulesSheet } from '../tisch/TableRules';
import { SyncSection } from '../abgleich/SyncSection';
import { TestModeSection } from './TestModeSection';
import { SECTION_LEAD } from '../abgleich/model';
import './einstellungen.css';

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'];

export default function Page() {
  const db = useDb();
  const problems = explainProblems(db.problems).length;
  const desktop = isDesktopApp();
  const [group, setGroup] = useState<SettingsGroupId>('kampagne');
  const [jumpTo, setJumpTo] = useState<SettingsSectionId | null>(null);
  // Die Suche („Würfeltabellen“, „Sicherung“) öffnet die Gruppe und springt zum Abschnitt.
  useFocus(['settings'], (focus) => {
    setGroup(groupOfSection(focus.section));
    setJumpTo(focus.section);
  });
  useEffect(() => {
    if (!jumpTo) return;
    document.getElementById(`wf-einstellungen-${jumpTo}`)?.scrollIntoView({ block: 'start' });
    setJumpTo(null);
  }, [jumpTo, group]);
  const inGroup = SETTINGS_SECTIONS.filter((section) => section.group === group);
  const numeral = (id: SettingsSectionId) => NUMERALS[inGroup.findIndex((s) => s.id === id)] ?? '';
  const current = SETTINGS_GROUPS.find((entry) => entry.id === group)!;

  return (
    <div className="wf-page">
      <header className="wf-page__head">
        <h1 className="wf-page__title">Einstellungen</h1>
        <p className="wf-page__lead">
          Kampagne, Sicherung und Kalender – alles, was nicht am Spieltisch gebraucht wird.
        </p>
      </header>
      <div className="wf-page__body">
        <div className="wf-einstellungen-layout">
          <nav className="wf-einstellungen-nav" aria-label="Gruppen der Einstellungen">
            {SETTINGS_GROUPS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="wf-einstellungen-nav__item"
                aria-pressed={entry.id === group}
                onClick={() => setGroup(entry.id)}
              >
                <span className="wf-einstellungen-nav__title">{entry.title}</span>
                <span className="wf-einstellungen-nav__sub">
                  {SETTINGS_SECTIONS.filter((s) => s.group === entry.id)
                    .map((s) => s.title)
                    .join(' · ')}
                </span>
              </button>
            ))}
          </nav>
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
            <p className="wf-einstellungen__group-lead">{current.lead}</p>
            {inGroup.map((section) => (
              <SectionOf key={section.id} id={section.id} numeral={numeral} desktop={desktop} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Ein Abschnitt der Einstellungen nach seiner Kennung. */
function SectionOf({
  id,
  numeral,
  desktop,
}: {
  id: SettingsSectionId;
  numeral: (id: SettingsSectionId) => string;
  desktop: boolean;
}) {
  const testing = useTestMode();
  switch (id) {
    case 'campaign':
      return (
        <Section
          numeral={numeral('campaign')}
          anchor="campaign"
          title="Kampagne"
          lead={
            desktop
              ? 'Wie die Kampagne heißt und in welchem Ordner ihr Spielstand liegt.'
              : 'Wie die Kampagne heißt und wo ihr Spielstand liegt.'
          }
        >
          <CampaignSection />
        </Section>
      );
    case 'sync':
      return (
        <Section numeral={numeral('sync')} anchor="sync" title="Abgleich" lead={SECTION_LEAD}>
          <Boundary
            fallback={
              <EmptyState icon={<BookOpen />} title="Der Abgleich lässt sich gerade nicht anzeigen">
                Die übrigen Einstellungen sind davon nicht betroffen. Dein Spielstand ist auf diesem
                Rechner gespeichert; ein Neustart von Wayfarer hilft meistens.
              </EmptyState>
            }
          >
            {testing ? (
              <Notice tone="info" icon={<FlaskConical />} title="Im Testmodus ruht der Abgleich">
                Solange der Testmodus läuft, wird nichts hochgeladen und nichts geholt – so erreicht
                nichts davon den anderen Rechner. Schalte ihn unter „Testmodus“ aus, dann gleicht
                Wayfarer wieder ab.
              </Notice>
            ) : (
              <SyncSection />
            )}
          </Boundary>
        </Section>
      );
    case 'testmode':
      return (
        <Section
          numeral={numeral('testmode')}
          anchor="testmode"
          title="Testmodus"
          lead="Ausprobieren, ohne dass etwas bleibt: einschalten, machen, was du willst, ausschalten – und alles ist wie vorher."
        >
          <TestModeSection />
        </Section>
      );
    case 'rules':
      return (
        <Section
          numeral={numeral('rules')}
          anchor="rules"
          title="Regeln des Tisches"
          lead="Hausregeln und Absprachen eurer Runde – am Spieltisch mit einem Klick auf die Schriftrolle im Kopf der Mitschrift zur Hand."
        >
          <TableRulesSheet />
        </Section>
      );
    case 'scaffold':
      return (
        <Section
          numeral={numeral('scaffold')}
          anchor="scaffold"
          title="Steckbrief-Gerüste"
          lead="Welche Felder ein neuer Artikel je Art leer mitbekommt – Person, Ort, Fraktion und so weiter. Nur Feldnamen, nie ein Wert; ausgefüllt wird von dir."
        >
          <ScaffoldSection />
        </Section>
      );
    case 'tables':
      return (
        <Section
          numeral={numeral('tables')}
          anchor="tables"
          title="Würfeltabellen"
          lead="Die Listen, aus denen Wayfarer erzeugt – Fundstellen, Verborgenes und Besonderheiten auf den Hexkarten. Wo andere würfeln, wählt Wayfarer aus deiner Liste."
        >
          <TablesSection />
        </Section>
      );
    case 'trash':
      return (
        <Section
          numeral={numeral('trash')}
          anchor="trash"
          title="Papierkorb"
          lead="Gelöschte Artikel mit allen Seiten. Sie bleiben hier, bis du sie wiederherstellst oder endgültig entfernst. Frühere Fassungen eines Artikels findest du an ihm selbst, im Menü „Mehr“."
        >
          <TrashSection />
        </Section>
      );
    case 'dismissed':
      return (
        <Section
          numeral={numeral('dismissed')}
          anchor="dismissed"
          title="Ausgeblendete Vorschläge"
          lead="Was du an Vorschlägen mit „×“ weggeklickt hast. Es bleibt weg, bis du es hier zurückholst."
        >
          <DismissedSection />
        </Section>
      );
    case 'backup':
      return (
        <Section
          numeral={numeral('backup')}
          anchor="backup"
          title="Sicherung"
          lead="Die ganze Kampagne in einer Datei – zum Aufbewahren vor großen Änderungen oder zum Mitnehmen."
        >
          <BackupSection />
        </Section>
      );
    case 'legacy':
      return (
        <Section
          numeral={numeral('legacy')}
          anchor="legacy"
          title="Alten Spielstand übernehmen"
          lead="Holt Weltzeit, Orte, Personen, Haltungen, Abmachungen, Termine und Timer aus dem bisherigen Wayfarer herüber und zeigt vorher, was mitkommt und was nicht."
        >
          <LegacySection />
        </Section>
      );
    case 'wikiImport':
      return (
        <Section
          numeral={numeral('wikiImport')}
          anchor="wikiImport"
          title="LegendKeeper ganz übernehmen"
          lead="Holt das ganze LegendKeeper-Projekt aus seiner Exportdatei herüber: alle Artikel, Karten und Steckbriefe liegen danach in Wayfarers eigenem Wiki – lesbar ohne LegendKeeper."
        >
          <WikiImportSection />
        </Section>
      );
    case 'atlas':
      return (
        <Section
          numeral={numeral('atlas')}
          anchor="atlas"
          title="Atlas übernehmen"
          lead="Holt den Planeten aus dem alten Atlas herüber: Küsten, Seen, Flüsse und Höhen. Damit weiß Wayfarer, wo Land und Wasser sind – und sobald du Orte auf die Weltkarte setzt, wie weit sie auseinanderliegen."
        >
          <AtlasSection />
        </Section>
      );
    case 'legendkeeper':
      return (
        <Section
          numeral={numeral('legendkeeper')}
          anchor="legendkeeper"
          title="LegendKeeper"
          lead="Die direkte Verbindung: Wayfarer liest Artikel aus LegendKeeper und verknüpft sie mit Orten und Personen. Geschrieben wird dort nie."
        >
          <Boundary
            fallback={
              <EmptyState icon={<BookOpen />} title="LegendKeeper lässt sich gerade nicht anzeigen">
                Die übrigen Einstellungen sind davon nicht betroffen. Ein Neustart von Wayfarer
                hilft meistens.
              </EmptyState>
            }
          >
            <LegendKeeperSettings />
          </Boundary>
        </Section>
      );
    case 'ai':
      return (
        <Section
          numeral={numeral('ai')}
          anchor="ai"
          title="KI-Leser"
          lead="Claude liest deine Artikel und schlägt vor, was sich daraus in der Welt bewegt. Er liest nur – geschrieben und entschieden wird von dir."
        >
          <AiSection />
        </Section>
      );
    case 'calendar':
      return (
        <Section
          numeral={numeral('calendar')}
          anchor="calendar"
          title="Kalender"
          lead="Die Zeitrechnung der Welt: Monate, Wochentage, Zeitrechnungen und Monde zum Nachlesen, die Jahreszeiten zum Festlegen."
        >
          <CalendarSection />
        </Section>
      );
    case 'sources':
      return (
        <Section
          numeral={numeral('sources')}
          anchor="sources"
          title="Quellen"
          lead="Was Wayfarer an Regelwerk mitbringt – als Nachschlagewerk, nie als Inhalt deiner Welt – und woher es stammt."
        >
          <SourcesSection />
        </Section>
      );
  }
}
