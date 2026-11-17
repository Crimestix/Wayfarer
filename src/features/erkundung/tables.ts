/**
 * Die Würfeltabellen der Erzeuger (Wunsch des Spielleiters, 17. 11.: „Wie eine normale
 * Würfeltabelle Dinge haben können für unsere Generatoren, damit wir die in den Einstellungen
 * füttern können“). Wayfarer bringt für jede Tabelle eine Vorgabe mit – nur Beiwerk in eigenen
 * Worten, nie etwas aus einer Welt und nie Buchtext. Der Spielleiter überschreibt sie in den
 * Einstellungen („Würfeltabellen“) oder legt eigene an; dann gilt seine (`generatorTables`).
 *
 * Eine Tabelle ist eine Liste (`domain/rollTable.ts`): eine Zeile je Möglichkeit, so viele, wie
 * man will. Jede gehört einem Platz (`slot`), an dem ein Erzeuger sie nimmt. Ein Eintrag einer
 * Fundstelle darf sagen, was man von fern sieht und was verborgen liegt (`entryParts`).
 */
import type { CampaignData, RollTable, Terrain } from '../../domain/schema';
import { readTable, tableToText, type TextTable } from '../../domain/rollTable';
import { TERRAIN_LABEL } from '../../domain/terrain';

/** Besonderheiten der Landschaft – das, wofür andere eine Entdeckungstabelle würfeln. */
export const FEATURES: Record<Terrain, string[]> = {
  grassland: [
    'Einzelner alter Baum',
    'Flacher Bachlauf',
    'Felsblock im offenen Land',
    'Wildblumenwiese',
    'Verfallene Wegmarke',
    'Ausgetretener Wildwechsel',
    'Kleiner Tümpel',
    'Windschiefe Feldscheune',
  ],
  forest: [
    'Lichtung',
    'Uralter Baumriese',
    'Windbruch',
    'Moosbedeckter Findling',
    'Bachlauf',
    'Verlassene Köhlerstelle',
    'Dichtes Unterholz',
    'Hohler Baum',
  ],
  hills: [
    'Aussichtskuppe',
    'Steiniger Hohlweg',
    'Quelle am Hang',
    'Verfallene Schäferhütte',
    'Felsüberhang',
    'Geröllfeld',
    'Alter Grenzstein',
    'Einsame Baumgruppe',
  ],
  mountains: [
    'Schmaler Pass',
    'Geröllhalde',
    'Wasserfall',
    'Höhleneingang',
    'Felsnadel',
    'Schneefeld',
    'Bergsee',
    'Steile Klamm',
  ],
  swamp: [
    'Trockene Insel im Moor',
    'Schwarzes Wasserloch',
    'Nebelsenke',
    'Alter Knüppeldamm',
    'Versunkene Baumstümpfe',
    'Schilfdickicht',
    'Torfstich',
    'Faulig riechender Grund',
  ],
  desert: [
    'Wasserloch',
    'Felsbogen',
    'Wanderdüne',
    'Ausgetrocknetes Flussbett',
    'Salzpfanne',
    'Windgeschliffene Felsen',
    'Dornengestrüpp',
    'Schattige Felsnische',
  ],
  arctic: [
    'Gletscherspalte',
    'Eishöhle',
    'Windgepeitschter Grat',
    'Zugefrorener See',
    'Schneewechte',
    'Heiße Quelle',
    'Blankes Eisfeld',
    'Geschützte Senke',
  ],
  coast: [
    'Felsbucht',
    'Gezeitentümpel',
    'Treibholzstrand',
    'Steilklippe',
    'Sandbank',
    'Seevogelkolonie',
    'Dünengürtel',
    'Angespültes Wrackteil',
  ],
  water: [
    'Sandbank',
    'Felsriff',
    'Starke Strömung',
    'Treibgutfeld',
    'Kleine Felseninsel',
    'Nebelbank',
    'Untiefe',
    'Tangteppich',
  ],
  underdark: [
    'Tropfsteinhalle',
    'Enger Kriechgang',
    'Leuchtende Flechten',
    'Eingestürzter Stollen',
    'Heiße Quelle',
    'Pilzhain',
    'Tiefe Kluft',
    'Kristalladern',
    'Alte Wegmarke',
    'Unterirdischer Wasserlauf',
  ],
  urban: [],
};

/** Was eine Höhle auszeichnet – erzeugte Gestalt, kein Inhalt der Geschichte. */
export const CAVE_FEATURES = [
  'Große Höhle',
  'Tropfsteinhalle',
  'Pilzwald',
  'Kristallgrotte',
  'Unterirdischer See',
  'Einsturzhalle',
  'Leuchtmooshöhle',
  'Schlotkammer',
  'Säulenhalle',
  'Warme Quellhöhle',
];

/** Woran eine Sackgasse endet. */
export const DEAD_END_FEATURES = [
  'Sackgasse',
  'Verschütteter Gang',
  'Nische mit Tropfwasser',
  'Spalt, zu eng zum Weitergehen',
  'Senkloch voller Wasser',
  'Alter Lagerplatz',
];

/** Eine Tabelle, wie Wayfarer sie mitbringt. */
export interface TableDef {
  name: string;
  /** Wo ein Erzeuger sie nimmt. */
  slot: string;
  /** Wofür sie da ist – steht in den Einstellungen darüber. */
  lead: string;
  entries: readonly string[];
}

/** Die Vorgaben, in der Reihenfolge der Einstellungen. */
export const DEFAULT_TABLES: readonly TableDef[] = [
  {
    name: 'Fundstellen',
    slot: 'site',
    lead: 'Was in manchen Feldern einer Hexkarte liegt – etwa jedes zwölfte Feld, nie dicht beieinander. Dazu darf stehen, was man von fern sieht und was verborgen liegt: „Ein Köhlerlager (von fern: eine Rauchsäule) (verborgen: …)“.',
    entries: [
      'Ein Köhlerlager, drei Leute bei der Arbeit (von fern: eine dünne Rauchsäule)',
      'Ein Jägerlager mit frischer Beute (von fern: Rauch über dem Land)',
      'Ein verfallener Wachturm, überwuchert (von fern: ein Turm auf einer Anhöhe) (verborgen: ein Beutel mit Silber unter einer losen Stufe)',
      'Mauerreste einer alten Kapelle (von fern: Mauern auf einer Kuppe)',
      'Ein Kadaver, kaum einen Tag alt, große Pfotenabdrücke (von fern: kreisende Aasvögel)',
      'Ein Gehöft, die Leute misstrauisch gegenüber Fremden',
      'Ein verlassenes Gehöft, die Türen stehen offen (verborgen: Vorräte im Keller)',
      'Ein Wegschrein mit frischen Opfergaben (verborgen: ein Brief hinter dem Schrein)',
      'Ein Bau unter Wurzeln, Knochen davor',
      'Ein Fels wie ein Gesicht (von fern: ein auffälliger einzelner Fels)',
      'Ein Hügelgrab, aufgebrochen (verborgen: Knochen und ein Ring)',
      'Ein Händler mit lahmem Karren',
      'Ein erloschenes Lagerfeuer, Schleifspuren ins Dickicht',
      'Eine Quelle mit klarem Wasser',
      'Ein verlassenes Lager, die Asche noch warm (verborgen: eine gut gepflegte Waffe unter der Asche)',
      'Ein Steinkreis (von fern: Steine auf einer Höhe)',
      'Eine zerfallene Brücke über einen trockenen Graben',
      'Räuber, die auf Reisende warten (von fern: ein Lichtschein in der Nacht)',
      'Pilger, die rasten',
      'Eine Mühle ohne Flügel (von fern: ein Mühlturm)',
    ],
  },
  {
    name: 'Fundstellen unter der Erde',
    slot: 'site:underdark',
    lead: 'Was in manchen Feldern einer Unterreich-Hexkarte liegt. „(von nebenan: …)“ ist, was die Gruppe aus dem Gang davor bemerkt.',
    entries: [
      'Ein Lager von Grubenarbeitern (von nebenan: ein Hauch von Rauch)',
      'Ein verlassener Stollen mit rostigem Werkzeug (von nebenan: Klopfen in der Ferne) (verborgen: ein Beutel Erzbrocken)',
      'Ein sorgfältig gepflegter Pilzgarten (von nebenan: ein süßlicher Geruch)',
      'Ein Bau voller Knochen und Nester (von nebenan: kratzende Geräusche)',
      'Eine kalte Feuerstelle (von nebenan: ein Luftzug mit Asche) (verborgen: Vorräte für ein paar Tage)',
      'Ein Schrein im Fels, geschändet',
      'Frische Spuren vieler Füße',
      'Ein Grab im Fels mit verwitterter Inschrift (von nebenan: Tropfen, das wie Schritte klingt)',
      'Ein eingestürzter Außenposten (verborgen: eine unvollständige Karte der Gänge)',
      'Eine freiliegende Kristallader (von nebenan: ein leises Summen)',
      'Die Reste einer Gruppe, lange tot (verborgen: ein Heiltrank in einer Gürteltasche)',
      'Händler mit Lasttieren auf dem Weg nach oben',
    ],
  },
  {
    name: 'Verborgenes',
    slot: 'hidden',
    lead: 'Was die Gruppe auf einem sonst unauffälligen Feld nur findet, wenn sie es durchsucht – etwa jedes fünfzehnte Feld.',
    entries: [
      'Ein Beutel mit Silberstücken',
      'Eine verrostete Kiste, leer',
      'Ein in Wachstuch gewickelter Brief',
      'Vorräte für ein paar Tage',
      'Ein überwachsener alter Pfad',
      'Ein alter Grenzstein unter Moos',
      'Eine Felsspalte, dahinter eine kleine Höhle',
      'Eine Falle, längst ausgelöst',
      'Ein vergrabener Topf mit Kupferstücken',
      'Heilkräuter',
      'Ein gut versteckter Unterstand',
      'Knochen und ein Ring',
    ],
  },
  ...(Object.keys(FEATURES) as Terrain[])
    .filter((terrain) => FEATURES[terrain].length > 0)
    .map((terrain) => ({
      name: `Besonderheiten: ${TERRAIN_LABEL[terrain]}`,
      slot: `feature:${terrain}`,
      lead: `Was ein Feld (${TERRAIN_LABEL[terrain]}) auszeichnet – etwa jedes sechste Feld bekommt eine, nie zwei nebeneinander.`,
      entries: FEATURES[terrain],
    })),
  {
    name: 'Höhlen',
    slot: 'feature:cave',
    lead: 'Was eine Höhle unter der Erde auszeichnet.',
    entries: CAVE_FEATURES,
  },
  {
    name: 'Sackgassen',
    slot: 'feature:deadend',
    lead: 'Woran ein Gang unter der Erde endet.',
    entries: DEAD_END_FEATURES,
  },
];

/**
 * Eine Vorgabe als Tabelle: jede Zeile „gelegentlich“ (Gewicht 2), damit der Spielleiter einzelne
 * häufiger oder seltener machen kann.
 */
export const defaultTable = (def: TableDef): TextTable =>
  readTable(def.name, def.entries.map((entry) => `2× ${entry}`).join('\n'));

/** Eine Tabelle, wie sie gilt: die eigene des Spielleiters oder die Vorgabe. */
export interface GeneratorTable {
  table: TextTable;
  slot: string;
  lead: string;
  def: TableDef;
  /** Die eigene des Spielleiters, wenn es eine gibt. */
  own: RollTable | null;
}

export interface GeneratorTables {
  /** Alle Tabellen in der Reihenfolge der Vorgaben. */
  all: GeneratorTable[];
  /** Die Tabelle eines Platzes. */
  slot: (slot: string) => TextTable | undefined;
}

/** Die Tabellen, die gelten: die eigene des Spielleiters vor der Vorgabe (gleicher Platz). */
export function generatorTables(data: Pick<CampaignData, 'tables'>): GeneratorTables {
  const own = new Map<string, RollTable>();
  for (const table of Object.values(data.tables))
    if (table.kind === 'generator' && table.slot && !own.has(table.slot))
      own.set(table.slot, table);
  const all = DEFAULT_TABLES.map((def): GeneratorTable => {
    const mine = own.get(def.slot) ?? null;
    return {
      table: mine
        ? {
            name: def.name,
            die: mine.entries.reduce((n, row) => n + row.max - row.min + 1, 0),
            rows: mine.entries,
          }
        : readTable(def.name, def.entries.join('\n')),
      slot: def.slot,
      lead: def.lead,
      def,
      own: mine,
    };
  });
  const bySlot = new Map(all.map((entry) => [entry.slot, entry.table]));
  return { all, slot: (slot) => bySlot.get(slot) };
}

/** Die Tabellen, wenn der Spielleiter keine eigenen hat. */
export const DEFAULT_GENERATOR_TABLES = generatorTables({ tables: {} });

/** Der Text einer Tabelle, wie er in den Einstellungen steht. */
export const generatorText = (entry: GeneratorTable): string => tableToText(entry.table.rows);
