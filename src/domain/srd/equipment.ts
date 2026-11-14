/**
 * Ausrüstung aus dem System Reference Document 5.2.1 (D&D 2024, Kapitel „Equipment“ und die
 * Richtwerte magischer Gegenstände nach Seltenheit) – als Nachschlagewerk für Läden, nicht als
 * Inhalt der Welt: Nichts davon wird von selbst angelegt; der Spielleiter wählt, was ein Laden
 * führt. Übernommen sind nur Name, Gruppe, Preis und Gewicht – keine Beschreibungen, keine
 * Eigenschaften. Die Preise stehen so da wie im SRD (`cost`); `price` ist derselbe Betrag in Gold.
 * Die deutschen Namen sind eigene Übersetzungen, der englische Name steht daneben (für die Suche).
 * Monster-Werteblöcke aus dem SRD gehören nicht hierher. Namensnennung: `attribution.ts`.
 */

/** Die Gruppen zum Durchsehen – in der Reihenfolge des SRD. */
export const SRD_GROUPS = [
  { id: 'weapons', label: 'Waffen' },
  { id: 'armor', label: 'Rüstungen und Schilde' },
  { id: 'ammunition', label: 'Munition' },
  { id: 'gear', label: 'Abenteuerausrüstung' },
  { id: 'kits', label: 'Pakete und Ausrüstungen' },
  { id: 'tools', label: 'Werkzeuge' },
  { id: 'instruments', label: 'Instrumente und Spiele' },
  { id: 'mounts', label: 'Reittiere und Tiere' },
  { id: 'tack', label: 'Sattelzeug und Fuhrwerke' },
  { id: 'ships', label: 'Schiffe' },
  { id: 'food', label: 'Essen, Trinken und Unterkunft' },
  { id: 'services', label: 'Dienste' },
  { id: 'magic', label: 'Magische Gegenstände (Richtwerte)' },
] as const;

export type SrdGroup = (typeof SRD_GROUPS)[number]['id'];

export interface SrdItem {
  /** Stabil: „srd-longsword“. */
  readonly id: string;
  /** Deutsch: „Langschwert“. */
  readonly name: string;
  /** Englisch, wie im SRD: „Longsword“. */
  readonly en: string;
  readonly group: SrdGroup;
  /** Unterteilung in der Gruppe: „Nahkampf-Kriegswaffe“. */
  readonly sub: string;
  /** Preis in Gold. */
  readonly price: number;
  /** Der Preis, wie er im SRD steht: „15 GP“. */
  readonly cost: string;
  /** Gewicht in Pfund (lb.), wie im SRD; null = keins angegeben. */
  readonly lb: number | null;
}

/** [Kennung, deutscher Name, englischer Name, Preis wie im SRD, Gewicht in Pfund] */
type Row = readonly [slug: string, name: string, en: string, cost: string, lb?: number | null];

/** Wert einer Münze in Gold (SRD: „Coin Values“). */
const COIN: Record<string, number> = { CP: 0.01, SP: 0.1, EP: 0.5, GP: 1, PP: 10 };

/** „15 GP“ → 15; „5 CP“ → 0,05; „Free“ → 0. */
export function srdCostToGold(cost: string): number {
  if (cost === 'Free') return 0;
  const match = /^(\d+) (CP|SP|EP|GP|PP)$/.exec(cost);
  if (!match) throw new Error(`SRD-Preis nicht lesbar: ${cost}`);
  return Math.round(Number(match[1]) * COIN[match[2]!]! * 100) / 100;
}

const SECTIONS: readonly { group: SrdGroup; sub: string; rows: readonly Row[] }[] = [
  // ── Waffen (Weapons table) ──────────────────────────────────────────────
  {
    group: 'weapons',
    sub: 'Einfache Nahkampfwaffe',
    rows: [
      ['club', 'Knüppel', 'Club', '1 SP', 2],
      ['dagger', 'Dolch', 'Dagger', '2 GP', 1],
      ['greatclub', 'Zweihandknüppel', 'Greatclub', '2 SP', 10],
      ['handaxe', 'Handbeil', 'Handaxe', '5 GP', 2],
      ['javelin', 'Wurfspeer', 'Javelin', '5 SP', 2],
      ['light-hammer', 'Leichter Hammer', 'Light Hammer', '2 GP', 2],
      ['mace', 'Streitkolben', 'Mace', '5 GP', 4],
      ['quarterstaff', 'Kampfstab', 'Quarterstaff', '2 SP', 4],
      ['sickle', 'Sichel', 'Sickle', '1 GP', 2],
      ['spear', 'Speer', 'Spear', '1 GP', 3],
    ],
  },
  {
    group: 'weapons',
    sub: 'Einfache Fernkampfwaffe',
    rows: [
      ['dart', 'Wurfpfeil', 'Dart', '5 CP', 0.25],
      ['light-crossbow', 'Leichte Armbrust', 'Light Crossbow', '25 GP', 5],
      ['shortbow', 'Kurzbogen', 'Shortbow', '25 GP', 2],
      ['sling', 'Schleuder', 'Sling', '1 SP', null],
    ],
  },
  {
    group: 'weapons',
    sub: 'Nahkampf-Kriegswaffe',
    rows: [
      ['battleaxe', 'Streitaxt', 'Battleaxe', '10 GP', 4],
      ['flail', 'Flegel', 'Flail', '10 GP', 2],
      ['glaive', 'Glefe', 'Glaive', '20 GP', 6],
      ['greataxe', 'Zweihandaxt', 'Greataxe', '30 GP', 7],
      ['greatsword', 'Zweihandschwert', 'Greatsword', '50 GP', 6],
      ['halberd', 'Hellebarde', 'Halberd', '20 GP', 6],
      ['lance', 'Lanze', 'Lance', '10 GP', 6],
      ['longsword', 'Langschwert', 'Longsword', '15 GP', 3],
      ['maul', 'Zweihandhammer', 'Maul', '10 GP', 10],
      ['morningstar', 'Morgenstern', 'Morningstar', '15 GP', 4],
      ['pike', 'Pike', 'Pike', '5 GP', 18],
      ['rapier', 'Rapier', 'Rapier', '25 GP', 2],
      ['scimitar', 'Krummsäbel', 'Scimitar', '25 GP', 3],
      ['shortsword', 'Kurzschwert', 'Shortsword', '10 GP', 2],
      ['trident', 'Dreizack', 'Trident', '5 GP', 4],
      ['warhammer', 'Kriegshammer', 'Warhammer', '15 GP', 5],
      ['war-pick', 'Kriegspicke', 'War Pick', '5 GP', 2],
      ['whip', 'Peitsche', 'Whip', '2 GP', 3],
    ],
  },
  {
    group: 'weapons',
    sub: 'Fernkampf-Kriegswaffe',
    rows: [
      ['blowgun', 'Blasrohr', 'Blowgun', '10 GP', 1],
      ['hand-crossbow', 'Handarmbrust', 'Hand Crossbow', '75 GP', 3],
      ['heavy-crossbow', 'Schwere Armbrust', 'Heavy Crossbow', '50 GP', 18],
      ['longbow', 'Langbogen', 'Longbow', '50 GP', 2],
      ['musket', 'Muskete', 'Musket', '500 GP', 10],
      ['pistol', 'Pistole', 'Pistol', '250 GP', 3],
    ],
  },
  // ── Rüstungen (Armor table) ─────────────────────────────────────────────
  {
    group: 'armor',
    sub: 'Leichte Rüstung',
    rows: [
      ['padded-armor', 'Gepolsterte Rüstung', 'Padded Armor', '5 GP', 8],
      ['leather-armor', 'Lederrüstung', 'Leather Armor', '10 GP', 10],
      ['studded-leather-armor', 'Beschlagene Lederrüstung', 'Studded Leather Armor', '45 GP', 13],
    ],
  },
  {
    group: 'armor',
    sub: 'Mittelschwere Rüstung',
    rows: [
      ['hide-armor', 'Fellrüstung', 'Hide Armor', '10 GP', 12],
      ['chain-shirt', 'Kettenhemd', 'Chain Shirt', '50 GP', 20],
      ['scale-mail', 'Schuppenpanzer', 'Scale Mail', '50 GP', 45],
      ['breastplate', 'Brustplatte', 'Breastplate', '400 GP', 20],
      ['half-plate-armor', 'Halbplattenrüstung', 'Half Plate Armor', '750 GP', 40],
    ],
  },
  {
    group: 'armor',
    sub: 'Schwere Rüstung',
    rows: [
      ['ring-mail', 'Ringpanzer', 'Ring Mail', '30 GP', 40],
      ['chain-mail', 'Kettenpanzer', 'Chain Mail', '75 GP', 55],
      ['splint-armor', 'Schienenpanzer', 'Splint Armor', '200 GP', 60],
      ['plate-armor', 'Plattenrüstung', 'Plate Armor', '1500 GP', 65],
    ],
  },
  {
    group: 'armor',
    sub: 'Schild',
    rows: [['shield', 'Schild', 'Shield', '10 GP', 6]],
  },
  // ── Munition (Ammunition table: Menge je Kauf) ──────────────────────────
  {
    group: 'ammunition',
    sub: 'Munition',
    rows: [
      ['arrows', 'Pfeile (20)', 'Arrows (20)', '1 GP', 1],
      ['bolts', 'Bolzen (20)', 'Bolts (20)', '1 GP', 1.5],
      ['firearm-bullets', 'Kugeln für Feuerwaffen (10)', 'Bullets, Firearm (10)', '3 GP', 2],
      ['sling-bullets', 'Schleuderkugeln (20)', 'Bullets, Sling (20)', '4 CP', 1.5],
      ['needles', 'Blasrohrnadeln (50)', 'Needles (50)', '1 GP', 1],
    ],
  },
  // ── Abenteuerausrüstung (Adventuring Gear table) ────────────────────────
  {
    group: 'gear',
    sub: 'Abenteuerausrüstung',
    rows: [
      ['acid', 'Säure (Phiole)', 'Acid', '25 GP', 1],
      ['alchemists-fire', 'Alchemistenfeuer', "Alchemist's Fire", '50 GP', 1],
      ['antitoxin', 'Gegengift (Phiole)', 'Antitoxin', '50 GP', null],
      ['backpack', 'Rucksack', 'Backpack', '2 GP', 5],
      ['ball-bearings', 'Stahlkugeln (Beutel)', 'Ball Bearings', '1 GP', 2],
      ['barrel', 'Fass', 'Barrel', '2 GP', 70],
      ['basket', 'Korb', 'Basket', '4 SP', 2],
      ['bedroll', 'Schlafsack', 'Bedroll', '1 GP', 7],
      ['bell', 'Glocke', 'Bell', '1 GP', null],
      ['blanket', 'Decke', 'Blanket', '5 SP', 3],
      ['block-and-tackle', 'Flaschenzug', 'Block and Tackle', '1 GP', 5],
      ['book', 'Buch', 'Book', '25 GP', 5],
      ['glass-bottle', 'Glasflasche', 'Bottle, Glass', '2 GP', 2],
      ['bucket', 'Eimer', 'Bucket', '5 CP', 2],
      ['caltrops', 'Krähenfüße (Beutel)', 'Caltrops', '1 GP', 2],
      ['candle', 'Kerze', 'Candle', '1 CP', null],
      ['crossbow-bolt-case', 'Bolzenköcher', 'Case, Crossbow Bolt', '1 GP', 1],
      ['map-case', 'Karten- oder Schriftrollenhülle', 'Case, Map or Scroll', '1 GP', 1],
      ['chain', 'Kette', 'Chain', '5 GP', 10],
      ['chest', 'Truhe', 'Chest', '5 GP', 25],
      ['fine-clothes', 'Feine Kleidung', 'Clothes, Fine', '15 GP', 6],
      ['travelers-clothes', 'Reisekleidung', "Clothes, Traveler's", '2 GP', 4],
      ['component-pouch', 'Komponentenbeutel', 'Component Pouch', '25 GP', 2],
      ['costume', 'Kostüm', 'Costume', '5 GP', 4],
      ['crowbar', 'Brechstange', 'Crowbar', '2 GP', 5],
      ['flask', 'Flasche', 'Flask', '2 CP', 1],
      ['grappling-hook', 'Enterhaken', 'Grappling Hook', '2 GP', 4],
      ['holy-water', 'Weihwasser (Flasche)', 'Holy Water', '25 GP', 1],
      ['hunting-trap', 'Jagdfalle', 'Hunting Trap', '5 GP', 25],
      ['ink', 'Tinte (Fässchen)', 'Ink', '10 GP', null],
      ['ink-pen', 'Schreibfeder', 'Ink Pen', '2 CP', null],
      ['jug', 'Krug', 'Jug', '2 CP', 4],
      ['ladder', 'Leiter', 'Ladder', '1 SP', 25],
      ['lamp', 'Lampe', 'Lamp', '5 SP', 1],
      ['bullseye-lantern', 'Blendlaterne', 'Lantern, Bullseye', '10 GP', 2],
      ['hooded-lantern', 'Abblendbare Laterne', 'Lantern, Hooded', '5 GP', 2],
      ['lock', 'Schloss', 'Lock', '10 GP', 1],
      ['magnifying-glass', 'Lupe', 'Magnifying Glass', '100 GP', null],
      ['manacles', 'Handschellen', 'Manacles', '2 GP', 6],
      ['map', 'Karte', 'Map', '1 GP', null],
      ['mirror', 'Spiegel', 'Mirror', '5 GP', 0.5],
      ['net', 'Netz', 'Net', '1 GP', 3],
      ['oil', 'Öl (Flasche)', 'Oil', '1 SP', 1],
      ['paper', 'Papier (Blatt)', 'Paper', '2 SP', null],
      ['parchment', 'Pergament (Blatt)', 'Parchment', '1 SP', null],
      ['perfume', 'Parfüm', 'Perfume', '5 GP', null],
      ['basic-poison', 'Einfaches Gift (Phiole)', 'Poison, Basic', '100 GP', null],
      ['pole', 'Stange', 'Pole', '5 CP', 7],
      ['iron-pot', 'Eisentopf', 'Pot, Iron', '2 GP', 10],
      ['potion-of-healing', 'Heiltrank', 'Potion of Healing', '50 GP', 0.5],
      ['pouch', 'Beutel', 'Pouch', '5 SP', 1],
      ['quiver', 'Köcher', 'Quiver', '1 GP', 1],
      ['portable-ram', 'Tragbarer Rammbock', 'Ram, Portable', '4 GP', 35],
      ['rations', 'Rationen (1 Tag)', 'Rations', '5 SP', 2],
      ['robe', 'Robe', 'Robe', '1 GP', 4],
      ['rope', 'Seil', 'Rope', '1 GP', 5],
      ['sack', 'Sack', 'Sack', '1 CP', 0.5],
      ['shovel', 'Schaufel', 'Shovel', '2 GP', 5],
      ['signal-whistle', 'Signalpfeife', 'Signal Whistle', '5 CP', null],
      [
        'spell-scroll-cantrip',
        'Zauberschriftrolle (Zaubertrick)',
        'Spell Scroll (Cantrip)',
        '30 GP',
        null,
      ],
      ['spell-scroll-1', 'Zauberschriftrolle (1. Grad)', 'Spell Scroll (Level 1)', '50 GP', null],
      ['iron-spikes', 'Eisenstifte (10)', 'Spikes, Iron', '1 GP', 5],
      ['spyglass', 'Fernrohr', 'Spyglass', '1000 GP', 1],
      ['string', 'Schnur', 'String', '1 SP', null],
      ['tent', 'Zelt', 'Tent', '2 GP', 20],
      ['tinderbox', 'Zunderkästchen', 'Tinderbox', '5 SP', 1],
      ['torch', 'Fackel', 'Torch', '1 CP', 1],
      ['vial', 'Phiole', 'Vial', '1 GP', null],
      ['waterskin', 'Wasserschlauch', 'Waterskin', '2 SP', 5],
    ],
  },
  {
    group: 'gear',
    sub: 'Arkaner Fokus',
    rows: [
      ['crystal', 'Kristall (arkaner Fokus)', 'Crystal (Arcane Focus)', '10 GP', 1],
      ['orb', 'Kugel (arkaner Fokus)', 'Orb (Arcane Focus)', '20 GP', 3],
      ['rod', 'Zepter (arkaner Fokus)', 'Rod (Arcane Focus)', '10 GP', 2],
      ['arcane-staff', 'Stab (arkaner Fokus)', 'Staff (Arcane Focus)', '5 GP', 4],
      ['wand', 'Zauberstab (arkaner Fokus)', 'Wand (Arcane Focus)', '10 GP', 1],
    ],
  },
  {
    group: 'gear',
    sub: 'Druidischer Fokus',
    rows: [
      [
        'mistletoe',
        'Mistelzweig (druidischer Fokus)',
        'Sprig of Mistletoe (Druidic Focus)',
        '1 GP',
        null,
      ],
      ['wooden-staff', 'Holzstab (druidischer Fokus)', 'Wooden Staff (Druidic Focus)', '5 GP', 4],
      ['yew-wand', 'Eibenstab (druidischer Fokus)', 'Yew Wand (Druidic Focus)', '10 GP', 1],
    ],
  },
  {
    group: 'gear',
    sub: 'Heiliges Symbol',
    rows: [
      ['amulet', 'Amulett (heiliges Symbol)', 'Amulet (Holy Symbol)', '5 GP', 1],
      ['emblem', 'Emblem (heiliges Symbol)', 'Emblem (Holy Symbol)', '5 GP', null],
      ['reliquary', 'Reliquiar (heiliges Symbol)', 'Reliquary (Holy Symbol)', '5 GP', 2],
    ],
  },
  // ── Pakete und Ausrüstungen (Packs, Kits) ────────────────────────────────
  {
    group: 'kits',
    sub: 'Ausrüstungspaket',
    rows: [
      ['burglars-pack', 'Einbrecherpaket', "Burglar's Pack", '16 GP', 42],
      ['diplomats-pack', 'Diplomatenpaket', "Diplomat's Pack", '39 GP', 39],
      ['dungeoneers-pack', 'Verliesforscherpaket', "Dungeoneer's Pack", '12 GP', 55],
      ['entertainers-pack', 'Gauklerpaket', "Entertainer's Pack", '40 GP', 58.5],
      ['explorers-pack', 'Entdeckerpaket', "Explorer's Pack", '10 GP', 55],
      ['priests-pack', 'Priesterpaket', "Priest's Pack", '33 GP', 29],
      ['scholars-pack', 'Gelehrtenpaket', "Scholar's Pack", '40 GP', 22],
    ],
  },
  {
    group: 'kits',
    sub: 'Ausrüstung für Fertigkeiten',
    rows: [
      ['climbers-kit', 'Kletterausrüstung', "Climber's Kit", '25 GP', 12],
      ['disguise-kit', 'Verkleidungsausrüstung', 'Disguise Kit', '25 GP', 3],
      ['forgery-kit', 'Fälscherausrüstung', 'Forgery Kit', '15 GP', 5],
      ['healers-kit', 'Heilerausrüstung', "Healer's Kit", '5 GP', 3],
      ['herbalism-kit', 'Kräuterkundeausrüstung', 'Herbalism Kit', '5 GP', 3],
      ['poisoners-kit', 'Giftmischerausrüstung', "Poisoner's Kit", '50 GP', 2],
    ],
  },
  // ── Werkzeuge (Tools) ───────────────────────────────────────────────────
  {
    group: 'tools',
    sub: 'Handwerkszeug',
    rows: [
      ['alchemists-supplies', 'Alchemistenausrüstung', "Alchemist's Supplies", '50 GP', 8],
      ['brewers-supplies', 'Brauerausrüstung', "Brewer's Supplies", '20 GP', 9],
      ['calligraphers-supplies', 'Kalligrafenausrüstung', "Calligrapher's Supplies", '10 GP', 5],
      ['carpenters-tools', 'Zimmermannswerkzeug', "Carpenter's Tools", '8 GP', 6],
      ['cartographers-tools', 'Kartografenwerkzeug', "Cartographer's Tools", '15 GP', 6],
      ['cobblers-tools', 'Schusterwerkzeug', "Cobbler's Tools", '5 GP', 5],
      ['cooks-utensils', 'Kochgeschirr', "Cook's Utensils", '1 GP', 8],
      ['glassblowers-tools', 'Glasbläserwerkzeug', "Glassblower's Tools", '30 GP', 5],
      ['jewelers-tools', 'Juwelierwerkzeug', "Jeweler's Tools", '25 GP', 2],
      ['leatherworkers-tools', 'Lederwerkzeug', "Leatherworker's Tools", '5 GP', 5],
      ['masons-tools', 'Steinmetzwerkzeug', "Mason's Tools", '10 GP', 8],
      ['painters-supplies', 'Malerausrüstung', "Painter's Supplies", '10 GP', 5],
      ['potters-tools', 'Töpferwerkzeug', "Potter's Tools", '10 GP', 3],
      ['smiths-tools', 'Schmiedewerkzeug', "Smith's Tools", '20 GP', 8],
      ['tinkers-tools', 'Tüftlerwerkzeug', "Tinker's Tools", '50 GP', 10],
      ['weavers-tools', 'Weberwerkzeug', "Weaver's Tools", '1 GP', 5],
      ['woodcarvers-tools', 'Holzschnitzwerkzeug', "Woodcarver's Tools", '1 GP', 5],
    ],
  },
  {
    group: 'tools',
    sub: 'Anderes Werkzeug',
    rows: [
      ['navigators-tools', 'Navigationswerkzeug', "Navigator's Tools", '25 GP', 2],
      ['thieves-tools', 'Diebeswerkzeug', "Thieves' Tools", '25 GP', 1],
    ],
  },
  // ── Instrumente und Spiele ──────────────────────────────────────────────
  {
    group: 'instruments',
    sub: 'Musikinstrument',
    rows: [
      ['bagpipes', 'Dudelsack', 'Bagpipes', '30 GP', 6],
      ['drum', 'Trommel', 'Drum', '6 GP', 3],
      ['dulcimer', 'Hackbrett', 'Dulcimer', '25 GP', 10],
      ['flute', 'Flöte', 'Flute', '2 GP', 1],
      ['horn', 'Horn', 'Horn', '3 GP', 2],
      ['lute', 'Laute', 'Lute', '35 GP', 2],
      ['lyre', 'Leier', 'Lyre', '30 GP', 2],
      ['pan-flute', 'Panflöte', 'Pan Flute', '12 GP', 2],
      ['shawm', 'Schalmei', 'Shawm', '2 GP', 1],
      ['viol', 'Gambe', 'Viol', '30 GP', 1],
    ],
  },
  {
    group: 'instruments',
    sub: 'Spiel',
    rows: [
      ['dice', 'Würfelspiel', 'Dice', '1 SP', null],
      ['dragonchess', 'Drachenschach', 'Dragonchess', '1 GP', null],
      ['playing-cards', 'Spielkarten', 'Playing Cards', '5 SP', null],
      ['three-dragon-ante', 'Drei-Drachen-Ante', 'Three-Dragon Ante', '1 GP', null],
    ],
  },
  // ── Reittiere und Tiere (Mounts and Other Animals) ──────────────────────
  {
    group: 'mounts',
    sub: 'Reittier oder Tier',
    rows: [
      ['camel', 'Kamel', 'Camel', '50 GP'],
      ['elephant', 'Elefant', 'Elephant', '200 GP'],
      ['draft-horse', 'Zugpferd', 'Horse, Draft', '50 GP'],
      ['riding-horse', 'Reitpferd', 'Horse, Riding', '75 GP'],
      ['mastiff', 'Mastiff', 'Mastiff', '25 GP'],
      ['mule', 'Maultier', 'Mule', '8 GP'],
      ['pony', 'Pony', 'Pony', '30 GP'],
      ['warhorse', 'Schlachtross', 'Warhorse', '400 GP'],
    ],
  },
  // ── Sattelzeug und Fuhrwerke (Tack, Harness, and Drawn Vehicles) ────────
  {
    group: 'tack',
    sub: 'Sattelzeug und Versorgung',
    rows: [
      ['exotic-saddle', 'Exotischer Sattel', 'Saddle, Exotic', '60 GP', 40],
      ['military-saddle', 'Militärsattel', 'Saddle, Military', '20 GP', 30],
      ['riding-saddle', 'Reitsattel', 'Saddle, Riding', '10 GP', 25],
      ['feed', 'Futter (pro Tag)', 'Feed (per day)', '5 CP', 10],
      ['stabling', 'Stallplatz (pro Tag)', 'Stabling (per day)', '5 SP', null],
    ],
  },
  {
    group: 'tack',
    sub: 'Fuhrwerk',
    rows: [
      ['carriage', 'Kutsche', 'Carriage', '100 GP', 600],
      ['cart', 'Karren', 'Cart', '15 GP', 200],
      ['chariot', 'Streitwagen', 'Chariot', '250 GP', 100],
      ['sled', 'Schlitten', 'Sled', '20 GP', 300],
      ['wagon', 'Fuhrwagen', 'Wagon', '35 GP', 400],
    ],
  },
  // ── Schiffe (Airborne and Waterborne Vehicles) ──────────────────────────
  {
    group: 'ships',
    sub: 'Schiff oder Boot',
    rows: [
      ['galley', 'Galeere', 'Galley', '30000 GP'],
      ['keelboat', 'Kielboot', 'Keelboat', '3000 GP'],
      ['longship', 'Langschiff', 'Longship', '10000 GP'],
      ['rowboat', 'Ruderboot', 'Rowboat', '50 GP', 100],
      ['sailing-ship', 'Segelschiff', 'Sailing Ship', '10000 GP'],
      ['warship', 'Kriegsschiff', 'Warship', '25000 GP'],
    ],
  },
  {
    group: 'ships',
    sub: 'Luftschiff',
    rows: [['airship', 'Luftschiff', 'Airship', '40000 GP']],
  },
  // ── Essen, Trinken und Unterkunft (Food, Drink, and Lodging) ────────────
  {
    group: 'food',
    sub: 'Essen und Trinken',
    rows: [
      ['ale', 'Bier (Krug)', 'Ale (mug)', '4 CP'],
      ['bread', 'Brot (Laib)', 'Bread (loaf)', '2 CP'],
      ['cheese', 'Käse (Stück)', 'Cheese (wedge)', '1 SP'],
      ['common-wine', 'Wein, einfach (Flasche)', 'Wine, Common (bottle)', '2 SP'],
      ['fine-wine', 'Wein, edel (Flasche)', 'Wine, Fine (bottle)', '10 GP'],
    ],
  },
  {
    group: 'food',
    sub: 'Mahlzeit',
    rows: [
      ['meal-squalid', 'Mahlzeit, ärmlich', 'Meal, Squalid', '1 CP'],
      ['meal-poor', 'Mahlzeit, arm', 'Meal, Poor', '2 CP'],
      ['meal-modest', 'Mahlzeit, bescheiden', 'Meal, Modest', '1 SP'],
      ['meal-comfortable', 'Mahlzeit, gut', 'Meal, Comfortable', '2 SP'],
      ['meal-wealthy', 'Mahlzeit, wohlhabend', 'Meal, Wealthy', '3 SP'],
      ['meal-aristocratic', 'Mahlzeit, fürstlich', 'Meal, Aristocratic', '6 SP'],
    ],
  },
  {
    group: 'food',
    sub: 'Übernachtung im Gasthaus',
    rows: [
      ['inn-squalid', 'Übernachtung, ärmlich', 'Inn Stay, Squalid (per day)', '7 CP'],
      ['inn-poor', 'Übernachtung, arm', 'Inn Stay, Poor (per day)', '1 SP'],
      ['inn-modest', 'Übernachtung, bescheiden', 'Inn Stay, Modest (per day)', '5 SP'],
      ['inn-comfortable', 'Übernachtung, gut', 'Inn Stay, Comfortable (per day)', '8 SP'],
      ['inn-wealthy', 'Übernachtung, wohlhabend', 'Inn Stay, Wealthy (per day)', '2 GP'],
      ['inn-aristocratic', 'Übernachtung, fürstlich', 'Inn Stay, Aristocratic (per day)', '4 GP'],
    ],
  },
  // ── Dienste (Hirelings, Spellcasting Services, Lifestyle, Schiffsreisen) ─
  {
    group: 'services',
    sub: 'Mietlinge',
    rows: [
      [
        'skilled-hireling',
        'Ausgebildete Hilfskraft (pro Tag)',
        'Skilled Hireling (per day)',
        '2 GP',
      ],
      [
        'untrained-hireling',
        'Ungelernte Hilfskraft (pro Tag)',
        'Untrained Hireling (per day)',
        '2 SP',
      ],
      ['messenger', 'Bote (je Meile)', 'Messenger (per mile)', '2 CP'],
    ],
  },
  {
    group: 'services',
    sub: 'Zauber wirken lassen',
    rows: [
      [
        'spellcasting-cantrip',
        'Zauber wirken lassen: Zaubertrick',
        'Spellcasting: Cantrip',
        '30 GP',
      ],
      ['spellcasting-1', 'Zauber wirken lassen: 1. Grad', 'Spellcasting: Level 1', '50 GP'],
      ['spellcasting-2', 'Zauber wirken lassen: 2. Grad', 'Spellcasting: Level 2', '200 GP'],
      ['spellcasting-3', 'Zauber wirken lassen: 3. Grad', 'Spellcasting: Level 3', '300 GP'],
      [
        'spellcasting-4-5',
        'Zauber wirken lassen: 4. oder 5. Grad',
        'Spellcasting: Level 4–5',
        '2000 GP',
      ],
      [
        'spellcasting-6-8',
        'Zauber wirken lassen: 6. bis 8. Grad',
        'Spellcasting: Level 6–8',
        '20000 GP',
      ],
      ['spellcasting-9', 'Zauber wirken lassen: 9. Grad', 'Spellcasting: Level 9', '100000 GP'],
    ],
  },
  {
    group: 'services',
    sub: 'Lebensstil (pro Tag)',
    rows: [
      ['lifestyle-wretched', 'Lebensstil: elend', 'Lifestyle: Wretched', 'Free'],
      ['lifestyle-squalid', 'Lebensstil: ärmlich', 'Lifestyle: Squalid', '1 SP'],
      ['lifestyle-poor', 'Lebensstil: arm', 'Lifestyle: Poor', '2 SP'],
      ['lifestyle-modest', 'Lebensstil: bescheiden', 'Lifestyle: Modest', '1 GP'],
      ['lifestyle-comfortable', 'Lebensstil: gut', 'Lifestyle: Comfortable', '2 GP'],
      ['lifestyle-wealthy', 'Lebensstil: wohlhabend', 'Lifestyle: Wealthy', '4 GP'],
      ['lifestyle-aristocratic', 'Lebensstil: fürstlich', 'Lifestyle: Aristocratic', '10 GP'],
    ],
  },
  {
    group: 'services',
    sub: 'Schiffsreise',
    rows: [
      [
        'passage-hammock',
        'Überfahrt in der Hängematte (pro Tag)',
        'Ship Passage, Hammock (per day)',
        '5 SP',
      ],
      [
        'passage-cabin',
        'Überfahrt in eigener Kabine (pro Tag)',
        'Ship Passage, Private Cabin (per day)',
        '2 GP',
      ],
      ['ship-repair', 'Schiffsreparatur (je Trefferpunkt)', 'Ship Repair (per Hit Point)', '20 GP'],
    ],
  },
  // ── Magische Gegenstände (Magic Item Rarities and Values) ───────────────
  {
    group: 'magic',
    sub: 'Magischer Gegenstand',
    rows: [
      ['magic-common', 'Magischer Gegenstand, gewöhnlich', 'Magic Item, Common', '100 GP'],
      ['magic-uncommon', 'Magischer Gegenstand, ungewöhnlich', 'Magic Item, Uncommon', '400 GP'],
      ['magic-rare', 'Magischer Gegenstand, selten', 'Magic Item, Rare', '4000 GP'],
      ['magic-very-rare', 'Magischer Gegenstand, sehr selten', 'Magic Item, Very Rare', '40000 GP'],
      ['magic-legendary', 'Magischer Gegenstand, legendär', 'Magic Item, Legendary', '200000 GP'],
    ],
  },
  {
    // „Halve the value for a consumable item other than a Spell Scroll.“
    group: 'magic',
    sub: 'Magisches Verbrauchsgut (ohne Zauberschriftrollen)',
    rows: [
      [
        'consumable-common',
        'Magisches Verbrauchsgut, gewöhnlich',
        'Consumable Magic Item, Common',
        '50 GP',
      ],
      [
        'consumable-uncommon',
        'Magisches Verbrauchsgut, ungewöhnlich',
        'Consumable Magic Item, Uncommon',
        '200 GP',
      ],
      [
        'consumable-rare',
        'Magisches Verbrauchsgut, selten',
        'Consumable Magic Item, Rare',
        '2000 GP',
      ],
      [
        'consumable-very-rare',
        'Magisches Verbrauchsgut, sehr selten',
        'Consumable Magic Item, Very Rare',
        '20000 GP',
      ],
      [
        'consumable-legendary',
        'Magisches Verbrauchsgut, legendär',
        'Consumable Magic Item, Legendary',
        '100000 GP',
      ],
    ],
  },
];

/** Die ganze Ausrüstung des SRD 5.2.1 – in der Reihenfolge der Gruppen. */
export const SRD_EQUIPMENT: readonly SrdItem[] = SECTIONS.flatMap((section) =>
  section.rows.map(([slug, name, en, cost, lb]): SrdItem => ({
    id: `srd-${slug}`,
    name,
    en,
    group: section.group,
    sub: section.sub,
    price: srdCostToGold(cost),
    cost,
    lb: lb ?? null,
  })),
);
