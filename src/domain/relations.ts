/** Beziehungsarten und die Haltungsskala. */

export interface RelationType {
  key: string;
  /** Aus Sicht von `from`: „dient“ … */
  label: string;
  /** Aus Sicht von `to`: „wird gedient von“ … */
  inverse: string;
  group:
    'Bindung' | 'Konflikt' | 'Rangordnung' | 'Ort und Besitz' | 'Wissen und Können' | 'Sonstiges';
}

export const RELATION_TYPES: RelationType[] = [
  { key: 'knows', label: 'kennt', inverse: 'ist bekannt bei', group: 'Bindung' },
  { key: 'friend', label: 'befreundet mit', inverse: 'befreundet mit', group: 'Bindung' },
  { key: 'ally', label: 'verbündet mit', inverse: 'verbündet mit', group: 'Bindung' },
  { key: 'family', label: 'verwandt mit', inverse: 'verwandt mit', group: 'Bindung' },
  { key: 'lover', label: 'liiert mit', inverse: 'liiert mit', group: 'Bindung' },
  { key: 'mentor', label: 'lehrt', inverse: 'lernt von', group: 'Bindung' },
  { key: 'rival', label: 'rivalisiert mit', inverse: 'rivalisiert mit', group: 'Konflikt' },
  { key: 'enemy', label: 'verfeindet mit', inverse: 'verfeindet mit', group: 'Konflikt' },
  { key: 'fears', label: 'fürchtet', inverse: 'wird gefürchtet von', group: 'Konflikt' },
  { key: 'seeks', label: 'sucht', inverse: 'wird gesucht von', group: 'Konflikt' },
  {
    key: 'owes',
    label: 'steht in der Schuld von',
    inverse: 'hat etwas gut bei',
    group: 'Konflikt',
  },
  { key: 'serves', label: 'dient', inverse: 'gebietet über', group: 'Rangordnung' },
  { key: 'leads', label: 'führt', inverse: 'wird geführt von', group: 'Rangordnung' },
  { key: 'member', label: 'gehört zu', inverse: 'hat als Mitglied', group: 'Rangordnung' },
  { key: 'employs', label: 'beschäftigt', inverse: 'arbeitet für', group: 'Rangordnung' },
  { key: 'rules', label: 'herrscht über', inverse: 'wird beherrscht von', group: 'Ort und Besitz' },
  {
    key: 'resides',
    label: 'ist verbunden mit',
    inverse: 'ist wichtig für',
    group: 'Ort und Besitz',
  },
  { key: 'owns', label: 'besitzt', inverse: 'gehört', group: 'Ort und Besitz' },
  { key: 'speaks', label: 'spricht', inverse: 'wird gesprochen von', group: 'Wissen und Können' },
  { key: 'writes', label: 'schreibt', inverse: 'wird geschrieben von', group: 'Wissen und Können' },
  {
    key: 'has-ability',
    label: 'verfügt über',
    inverse: 'ist eine Fähigkeit von',
    group: 'Wissen und Können',
  },
  /** Ein Tier oder Wesen, das mit der Gruppe oder einem Gefährten zieht (Art „Begleiter“). */
  { key: 'companion', label: 'begleitet', inverse: 'wird begleitet von', group: 'Bindung' },
  /** Eine zweite Gestalt eines Gefährten oder einer Person: ein eigener Eintrag mit eigenem Namen. */
  {
    key: 'persona',
    label: 'ist die zweite Gestalt von',
    inverse: 'hat als zweite Gestalt',
    group: 'Sonstiges',
  },
  { key: 'custom', label: 'eigene Bezeichnung', inverse: 'eigene Bezeichnung', group: 'Sonstiges' },
];

const byKey = new Map(RELATION_TYPES.map((t) => [t.key, t]));

export function relationType(key: string): RelationType {
  return byKey.get(key) ?? byKey.get('custom')!;
}

/** Bezeichnung der Beziehung aus Sicht der einen oder der anderen Seite. */
export function relationLabel(
  relation: { type: string; label: string },
  perspective: 'from' | 'to',
): string {
  if (relation.type === 'custom' || !byKey.has(relation.type))
    return relation.label || 'verbunden mit';
  const type = relationType(relation.type);
  return perspective === 'from' ? type.label : type.inverse;
}

export interface AttitudeLevel {
  value: number;
  label: string;
  /** Was die Stufe am Tisch bedeutet – ein Satz, der mit dem Namen der Figur beginnen könnte. */
  hint: string;
  /** Einordnung nach D&D 2024: feindselig, gleichgültig, freundlich. */
  rules: 'hostile' | 'indifferent' | 'friendly';
}

export const ATTITUDE_MIN = -5;
export const ATTITUDE_MAX = 5;

/** Elf Stufen von Todfeind bis Ergeben; 0 ist die neutrale Mitte. */
export const ATTITUDES: AttitudeLevel[] = [
  {
    value: -5,
    label: 'Todfeind',
    hint: 'Will schaden, koste es, was es wolle – auch unter eigenen Opfern.',
    rules: 'hostile',
  },
  {
    value: -4,
    label: 'Hasserfüllt',
    hint: 'Hasst und arbeitet aktiv dagegen, sobald sich eine Gelegenheit bietet.',
    rules: 'hostile',
  },
  {
    value: -3,
    label: 'Feindselig',
    hint: 'Stellt sich offen dagegen, droht oder greift an, wenn es sich lohnt.',
    rules: 'hostile',
  },
  {
    value: -2,
    label: 'Ablehnend',
    hint: 'Will nichts damit zu tun haben, verweigert Hilfe und redet schlecht.',
    rules: 'hostile',
  },
  {
    value: -1,
    label: 'Misstrauisch',
    hint: 'Bleibt auf Abstand und hilft nur gegen Sicherheiten oder guten Lohn.',
    rules: 'indifferent',
  },
  {
    value: 0,
    label: 'Neutral',
    hint: 'Keine besondere Meinung – hilft oder schadet, wie es gerade passt.',
    rules: 'indifferent',
  },
  {
    value: 1,
    label: 'Aufgeschlossen',
    hint: 'Hört zu und hilft bei Kleinigkeiten, die nichts kosten.',
    rules: 'indifferent',
  },
  {
    value: 2,
    label: 'Wohlgesonnen',
    hint: 'Mag sie und hilft, solange es wenig kostet und nichts riskiert.',
    rules: 'friendly',
  },
  {
    value: 3,
    label: 'Befreundet',
    hint: 'Setzt sich ein, gibt Rat und Auskunft und nimmt Mühe auf sich.',
    rules: 'friendly',
  },
  {
    value: 4,
    label: 'Treu',
    hint: 'Steht auch in schweren Zeiten dazu und geht dafür Risiken ein.',
    rules: 'friendly',
  },
  {
    value: 5,
    label: 'Ergeben',
    hint: 'Würde alles geben – auch gegen die eigenen Interessen.',
    rules: 'friendly',
  },
];

/** Name der CSS-Farbe einer Stufe: `--att-n5` … `--att-0` … `--att-p5`. */
export const attitudeToken = (value: number): string =>
  `--att-${value < 0 ? 'n' + -value : value > 0 ? 'p' + value : '0'}`;

export const RULES_ATTITUDE_LABEL: Record<AttitudeLevel['rules'], string> = {
  hostile: 'Feindselig',
  indifferent: 'Gleichgültig',
  friendly: 'Freundlich',
};

export function attitudeLevel(value: number | null): AttitudeLevel | null {
  if (value === null) return null;
  return ATTITUDES.find((a) => a.value === value) ?? null;
}

export function attitudeLabel(value: number | null): string {
  return attitudeLevel(value)?.label ?? 'Unbekannt';
}
