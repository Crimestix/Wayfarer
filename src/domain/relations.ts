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
  /** Ein Ort, an dem jemand wirkt (früher „ist verbunden mit“) – vom Ort aus „ist wichtig für“. */
  { key: 'resides', label: 'wirkt in', inverse: 'ist wichtig für', group: 'Ort und Besitz' },
  { key: 'owns', label: 'besitzt', inverse: 'gehört', group: 'Ort und Besitz' },
  /** Zwei Orte (oder Gegenden), die aneinanderstoßen. */
  { key: 'borders', label: 'grenzt an', inverse: 'grenzt an', group: 'Ort und Besitz' },
  {
    key: 'trades',
    label: 'treibt Handel mit',
    inverse: 'treibt Handel mit',
    group: 'Ort und Besitz',
  },
  /** Ein weiterer Sitz neben dem Feld „Sitz“ der Fraktion oder Familie. */
  { key: 'seat-of', label: 'ist Sitz von', inverse: 'hat seinen Sitz in', group: 'Ort und Besitz' },
  { key: 'speaks', label: 'spricht', inverse: 'wird gesprochen von', group: 'Wissen und Können' },
  { key: 'writes', label: 'schreibt', inverse: 'wird geschrieben von', group: 'Wissen und Können' },
  {
    key: 'has-ability',
    label: 'verfügt über',
    inverse: 'ist eine Fähigkeit von',
    group: 'Wissen und Können',
  },
  /** Ein Beruf, den eine Person ausübt (Art „Beruf“) – eine Person kann mehrere haben. */
  { key: 'practises', label: 'übt aus', inverse: 'wird ausgeübt von', group: 'Wissen und Können' },
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

// ── Beziehungen nach Art ───────────────────────────────────────────────────

/**
 * Wer eine Haltung haben kann – zur Gruppe, zu Gefährten, zu anderen: wer fühlt und entscheidet.
 * Ein Ort, ein Schwert, eine Sprache hat keine; dort bleibt die Haltung zugeklappt.
 */
const ATTITUDE_HOLDERS: ReadonlySet<string> = new Set(['person', 'faction', 'family', 'character']);

/** Kann ein Eintrag dieser Art (oder die Gruppe, `'party'`) eine Haltung haben? */
export function holdsAttitude(kind: string | null | undefined): boolean {
  return kind === 'party' || (!!kind && ATTITUDE_HOLDERS.has(kind));
}

/**
 * Steht bei diesem Eintrag eine Haltung da? Bei allen, die eine haben können, immer (auch
 * „Unbekannt“); bei allen anderen nur, wenn der Spielleiter trotzdem eine eingetragen hat –
 * Eingetragenes verschwindet nie.
 */
export function showsAttitude(kind: string | null | undefined, value: number | null): boolean {
  return holdsAttitude(kind) || value !== null;
}

/**
 * Steht die Haltungsskala einer Beziehung offen? Nur, wenn beide Seiten eine Haltung haben
 * können (Wesen, Gruppen, die Gruppe) – „Haus Baenre zu Menzoberranzan“ bleibt zugeklappt
 * („Haltung trotzdem eintragen“).
 */
export function attitudeOpen(fromKind: string, toKind: string): boolean {
  return holdsAttitude(fromKind) && holdsAttitude(toKind);
}

/** Die Haltung für eine Zeile: der Wert, wenn sie dasteht, sonst `undefined` (= keine Anzeige). */
export function shownAttitude(
  kind: string | null | undefined,
  value: number | null | undefined,
): number | null | undefined {
  const v = value ?? null;
  return showsAttitude(kind, v) ? v : undefined;
}

/** Eine Wahl im Dialog, gelesen von „diesem“ Eintrag aus: „beherrscht von“ ist `rules` rückwärts. */
export interface RelationChoice {
  /** `rules`, rückwärts `~rules`. */
  id: string;
  type: string;
  /** Die Beziehung geht vom Gegenüber aus (gespeichert mit `from` = Gegenüber). */
  reverse: boolean;
  /** Von diesem Eintrag aus gelesen: „wird beherrscht von“. */
  label: string;
}

type KindClass = 'being' | 'group' | 'place' | 'party' | 'item' | 'animal' | 'other';

const classOf = (kind: string): KindClass =>
  kind === 'person' || kind === 'character'
    ? 'being'
    : kind === 'faction' || kind === 'family'
      ? 'group'
      : kind === 'place' || kind === 'party' || kind === 'item' || kind === 'animal'
        ? kind
        : 'other';

/** Was zwischen Wesen und Wissen passt: wer eine Sprache spricht, eine Fähigkeit hat … */
const KNOWLEDGE: Record<string, string[]> = {
  language: ['speaks'],
  script: ['writes'],
  ability: ['has-ability'],
  profession: ['practises'],
};

const PERSON_TIES = [
  'friend',
  'lover',
  'family',
  'enemy',
  'rival',
  'serves',
  '~serves',
  'mentor',
  '~mentor',
  'ally',
  'knows',
  'owes',
  'fears',
  'seeks',
  'employs',
  '~employs',
];

/**
 * Passende Beziehungen je Paar, von `self` aus gelesen, in sinnvoller Reihenfolge – die erste ist
 * die Vorgabe. Nur eine Ordnung: Alle übrigen stehen unter „Weitere“, dazu die eigene Bezeichnung.
 */
function fittingIds(self: string, other: string): string[] {
  const a = classOf(self);
  const b = classOf(other);
  if (b === 'party')
    return a === 'being' || a === 'group'
      ? ['knows', 'ally', 'serves', 'employs', 'owes', 'seeks', 'fears', 'enemy']
      : [];
  if (a === 'place' && b === 'place')
    return ['borders', 'trades', '~rules', 'rules', '~owns', 'owns'];
  if (a === 'place' && b === 'group') return ['~rules', '~owns', 'seat-of', '~resides', 'trades'];
  if (a === 'place' && b === 'being') return ['~resides', '~rules', '~owns', 'seat-of'];
  if (a === 'group' && b === 'place') return ['rules', 'owns', '~seat-of', 'resides', 'trades'];
  if (a === 'being' && b === 'place') return ['resides', 'rules', 'owns', '~seat-of'];
  if (a === 'being' && b === 'being')
    return self === 'character' || other === 'character'
      ? [...PERSON_TIES, self === 'character' ? '~persona' : 'persona']
      : PERSON_TIES;
  if (a === 'being' && b === 'group')
    return ['member', 'leads', 'serves', '~employs', 'ally', 'enemy', 'owes', 'knows', 'seeks'];
  if (a === 'group' && b === 'being')
    return ['~member', '~leads', '~serves', 'employs', 'ally', 'enemy', 'seeks', 'knows'];
  if (a === 'group' && b === 'group')
    return ['ally', 'enemy', 'rival', 'trades', 'member', '~member', 'rules', '~rules', 'serves'];
  if ((a === 'being' || a === 'group') && b === 'item') return ['owns', 'seeks', 'fears'];
  if (a === 'item' && (b === 'being' || b === 'group' || b === 'place')) return ['~owns', '~seeks'];
  if (a === 'place' && b === 'item') return ['owns'];
  if ((a === 'being' || a === 'group') && b === 'animal')
    return ['~companion', 'owns', 'fears', 'seeks'];
  if (a === 'animal' && (b === 'being' || b === 'group')) return ['companion', '~owns', 'fears'];
  if (a === 'being' && KNOWLEDGE[other]) return KNOWLEDGE[other];
  if (KNOWLEDGE[self] && b === 'being') return KNOWLEDGE[self].map((key) => `~${key}`);
  return [];
}

function choiceOf(id: string): RelationChoice | null {
  const reverse = id.startsWith('~');
  const type = byKey.get(reverse ? id.slice(1) : id);
  if (!type || type.key === 'custom') return null;
  // Was in beide Richtungen gleich heißt („grenzt an“), gibt es nur vorwärts.
  if (reverse && type.label === type.inverse) return null;
  return { id, type: type.key, reverse, label: reverse ? type.inverse : type.label };
}

const CUSTOM: RelationChoice = {
  id: 'custom',
  type: 'custom',
  reverse: false,
  label: 'eigene Bezeichnung',
};

export interface RelationChoices {
  /** Was zu diesem Paar passt – die erste ist die Vorgabe. */
  fitting: RelationChoice[];
  /** Alles Übrige, vorwärts gelesen. Nie weggefiltert. */
  more: RelationChoice[];
  /** Die Vorgabe: die erste passende, sonst die eigene Bezeichnung (nie „Ort kennt Person“). */
  preset: RelationChoice;
  /** Zwei Orte: „liegt in“ ist keine Beziehung, sondern das Feld „Liegt in“ (der Ort darüber). */
  inPlaceField: boolean;
}

/**
 * Die Beziehungen zur Wahl zwischen zwei Arten (`'party'` für die Gruppe), von `self` aus.
 * Passendes zuerst, alles andere unter „Weitere“ – nie eingeschränkt.
 */
export function relationChoices(self: string, other: string): RelationChoices {
  const fitting = fittingIds(self, other)
    .map(choiceOf)
    .filter((c): c is RelationChoice => c !== null);
  const taken = new Set(fitting.filter((c) => !c.reverse).map((c) => c.type));
  const more = RELATION_TYPES.filter((t) => t.key !== 'custom' && !taken.has(t.key)).map((t) =>
    choiceOf(t.key)!,
  );
  return {
    fitting,
    more,
    preset: fitting[0] ?? CUSTOM,
    inPlaceField: self === 'place' && other === 'place',
  };
}

/** Eine Wahl zurück aus ihrer Kennung („~rules“, „custom“). */
export function choiceById(id: string): RelationChoice {
  return choiceOf(id) ?? CUSTOM;
}

/**
 * Die Arten in der Reihenfolge für eine Richtung (`from` → `to`): was vorwärts passt zuerst,
 * dann alles andere – für den ausführlichen Dialog, der je Richtung schreibt.
 */
export function typeOrder(fromKind: string, toKind: string): { fitting: string[]; more: string[] } {
  const fitting = relationChoices(fromKind, toKind)
    .fitting.filter((c) => !c.reverse)
    .map((c) => c.type);
  return {
    fitting,
    more: RELATION_TYPES.map((t) => t.key).filter((k) => k !== 'custom' && !fitting.includes(k)),
  };
}

/** Die Vorgabe für eine neue Richtung `from` → `to`: die erste vorwärts passende, sonst eigene. */
export function presetType(fromKind: string, toKind: string): string {
  return typeOrder(fromKind, toKind).fitting[0] ?? 'custom';
}

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
