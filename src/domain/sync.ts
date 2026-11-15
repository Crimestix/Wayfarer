/**
 * Abgleich: die reine Rechnung, welche Datei wohin muss. Kein Netz, keine Dateien – nur Listen
 * von Kennungen (Git-Blob-Kennung je Pfad) für drei Stände:
 *   G – der gemeinsame Stand (was beim letzten Abgleich auf beiden Seiten gleich war),
 *   H – hier (der Kampagnenordner),
 *   D – dort (die Ablage bei GitHub).
 *
 * Die Tabelle steht im Entwurf `docs/abgleich/abgleich-entwurf-fertig.md`, Abschnitt 3.4.
 * Geprüft wird in dieser Reihenfolge: erst H = D, dann H = G, dann D = G, dann der Rest – so
 * bereinigt sich ein abgebrochener Lauf beim nächsten Mal von selbst.
 */

export type Sha = string;

/**
 * Abgeglichen wird eine Datei genau dann, wenn ihr Pfad auf dieses Muster passt:
 * `campaign.json`, `state.json` oder `<ordner>/<kennung>.json` (Ordner 1–32 Kleinbuchstaben,
 * Kennung 1–64 Zeichen aus A–Z a–z 0–9 _ -). Dasselbe Muster prüft die Rust-Seite
 * (`sync::local::is_synced_path`).
 */
const SYNCED_PATH = /^(?:campaign\.json|state\.json|[a-z]{1,32}\/[A-Za-z0-9_-]{1,64}\.json)$/;

export const isSyncedPath = (path: string): boolean => SYNCED_PATH.test(path);

/** Diese beiden werden nie gelöscht – in keiner Richtung. */
export const NEVER_DELETED = ['campaign.json', 'state.json'] as const;
const neverDeleted = (path: string) => (NEVER_DELETED as readonly string[]).includes(path);

/** Hex-Darstellung von Bytes. */
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Die Kennung eines Textes wie bei Git: SHA-1 über „blob <Länge in Bytes>\0“ und die
 * UTF-8-Bytes. Leer → e69de29bb2d1d6434b8b29ae775ad8c2e48c5391.
 */
export async function blobSha(text: string): Promise<Sha> {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.byteLength}\0`);
  const all = new Uint8Array(head.byteLength + body.byteLength);
  all.set(head, 0);
  all.set(body, head.byteLength);
  return hex(await crypto.subtle.digest('SHA-1', all));
}

/** Liegen im Ordner schon Teile eines Spielstands? (Startbildschirm: „Neu beginnen“ verweigern) */
export function hasCampaignFiles(paths: readonly string[]): boolean {
  return paths.some(isSyncedPath);
}

/** Die Kennung eines Eintrags aus seinem Pfad („events/abc.json“ → „abc“), sonst null. */
export function idOfPath(path: string): string | null {
  const match = /^[a-z]{1,32}\/([A-Za-z0-9_-]{1,64})\.json$/.exec(path);
  return match ? match[1]! : null;
}

// ── Der Plan ─────────────────────────────────────────────────────────────────

export interface SyncLists {
  base: ReadonlyMap<string, Sha> | null;
  local: ReadonlyMap<string, Sha>;
  remote: ReadonlyMap<string, Sha>;
  /** Ausgelassen (unlesbar, Groß/Klein, zu groß, strittig …): bleibt in diesem Lauf, wie es ist. */
  hold: ReadonlySet<string>;
  /** Der Text der Dateien hier – nur für „verweist“ (Zeile 10). */
  localTexts: ReadonlyMap<string, string>;
  /** Modus „nur holen“: Ein älteres Programm holt, lädt aber nichts hoch. */
  older: boolean;
}

export type SyncStep =
  /** Zeilen 2–4: beide Seiten sind gleich; nur der gemeinsame Stand wird nachgezogen. */
  | { do: 'settle'; path: string; sha: Sha | null }
  /** Zeilen 5, 6: hochladen. */
  | { do: 'push'; path: string }
  /** Zeile 7: in der Ablage löschen. */
  | { do: 'pushDelete'; path: string }
  /** Zeilen 8, 9: holen. */
  | { do: 'pull'; path: string }
  /** Zeile 10: hier löschen. */
  | { do: 'pullDelete'; path: string }
  /** Zeilen 11, 12: zusammenführen (oder fragen). */
  | { do: 'merge'; path: string }
  /** Zeilen 13, 14 und „verweist“: der Spielleiter entscheidet. */
  | { do: 'clash'; path: string; kind: 'deletedThere' | 'deletedHere' | 'referenced'; by?: string }
  /** Ausgelassen, nur holen, oder „sehr viel auf einmal“ wartet auf eine Antwort. */
  | { do: 'hold'; path: string; why: 'frozen' | 'older' | 'mass' };

export interface MassGroup {
  /** deleteHere: hier fehlen viele; deleteThere: dort fehlen viele; changeHere: hier viel geändert. */
  kind: 'deleteHere' | 'deleteThere' | 'changeHere';
  paths: string[];
  /** Gilt für genau diese Pfadmenge; kommt etwas dazu, wird neu gefragt. */
  key: string;
}

export interface SyncPlan {
  steps: SyncStep[];
  mass: MassGroup[];
  /** Ein Pfad, der nie gelöscht werden darf, sollte gelöscht werden – er wartet. */
  broken: string | null;
}

/** Ab so vielen Zeilen 7 bzw. 10 (mehr als) wird gefragt. */
export const MASS_DELETE = 20;
/** Ab so vielen Zeilen 6 (mehr als) wird gefragt. */
export const MASS_CHANGE = 100;

/** Prüfsumme einer Pfadliste (FNV-1a, 64 Bit) – nur, um dieselbe Menge wiederzuerkennen. */
function checksum(text: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= BigInt(byte);
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/** Schlüssel einer Gruppe „sehr viel auf einmal“: Art und Prüfsumme der sortierten Pfade. */
export function massKey(kind: MassGroup['kind'], paths: readonly string[]): string {
  return `*mass:${kind}:${checksum([...paths].sort().join('\n'))}`;
}

type Row = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

/** Die Zeile der Tabelle für einen Pfad. */
function rowOf(g: Sha | undefined, h: Sha | undefined, d: Sha | undefined): Row {
  if (h === d) {
    if (g === h) return 1;
    if (g === undefined) return 2;
    if (h === undefined) return 4;
    return 3;
  }
  if (h === g) {
    if (d === undefined) return 10;
    return g === undefined ? 8 : 9;
  }
  if (d === g) {
    if (h === undefined) return 7;
    return g === undefined ? 5 : 6;
  }
  if (g === undefined) return 12;
  if (d === undefined) return 13;
  if (h === undefined) return 14;
  return 11;
}

/** Was ein älteres Programm darf: nur holen (und Gleiches nachziehen). */
const OLDER_ALLOWED = new Set<Row>([1, 2, 3, 4, 8, 9, 10]);

/**
 * Der Plan je Pfad. `massOk` sind die Schlüssel der Gruppen „sehr viel auf einmal“, die der
 * Spielleiter mit „Stimmt“ bestätigt hat. Ohne gemeinsamen Stand gilt die Tabelle nicht –
 * dann ist es ein erster Abgleich (`compareWithoutBase`), und `planSync` wirft.
 */
export function planSync(lists: SyncLists, massOk: ReadonlySet<string>): SyncPlan {
  const { base, local, remote, hold, localTexts, older } = lists;
  if (!base)
    throw new Error('Ohne gemeinsamen Stand wird nicht geplant – das ist ein erster Abgleich.');
  const paths = [...new Set([...base.keys(), ...local.keys(), ...remote.keys()])].sort();
  const rows = new Map<string, Row>();
  let broken: string | null = null;
  const steps = new Map<string, SyncStep>();

  for (const path of paths) {
    const row = rowOf(base.get(path), local.get(path), remote.get(path));
    if (row === 1) continue;
    rows.set(path, row);
    if (hold.has(path)) {
      steps.set(path, { do: 'hold', path, why: 'frozen' });
      continue;
    }
    if (neverDeleted(path) && (row === 4 || row === 7 || row === 10 || row === 13 || row === 14)) {
      broken ??= path;
      steps.set(path, { do: 'hold', path, why: 'frozen' });
      continue;
    }
    if (older && !OLDER_ALLOWED.has(row)) {
      steps.set(path, { do: 'hold', path, why: 'older' });
      continue;
    }
    switch (row) {
      case 2:
      case 3:
      case 4:
        steps.set(path, { do: 'settle', path, sha: local.get(path) ?? null });
        break;
      case 5:
      case 6:
        steps.set(path, { do: 'push', path });
        break;
      case 7:
        steps.set(path, { do: 'pushDelete', path });
        break;
      case 8:
      case 9:
        steps.set(path, { do: 'pull', path });
        break;
      case 10:
        steps.set(path, { do: 'pullDelete', path });
        break;
      case 11:
      case 12:
        steps.set(path, { do: 'merge', path });
        break;
      case 13:
        steps.set(path, { do: 'clash', path, kind: 'deletedThere' });
        break;
      case 14:
        steps.set(path, { do: 'clash', path, kind: 'deletedHere' });
        break;
    }
  }

  // „Verweist“: Dort gelöscht, aber etwas hier Neues oder Geändertes nennt seine Kennung.
  const changedHere = [...steps.values()]
    .filter((s) => {
      const row = rows.get(s.path);
      return row === 5 || row === 6 || row === 11 || row === 13;
    })
    .map((s) => s.path);
  for (const step of [...steps.values()]) {
    if (step.do !== 'pullDelete') continue;
    const id = idOfPath(step.path);
    if (!id) continue;
    const needle = `"${id}"`;
    const by = changedHere.find((p) => localTexts.get(p)?.includes(needle));
    if (by) steps.set(step.path, { do: 'clash', path: step.path, kind: 'referenced', by });
  }

  // Sehr viel auf einmal: lieber einmal fragen als still ausführen.
  const mass: MassGroup[] = [];
  const groups: { kind: MassGroup['kind']; rows: Row[]; limit: number }[] = [
    { kind: 'deleteHere', rows: [7], limit: MASS_DELETE },
    { kind: 'deleteThere', rows: [10], limit: MASS_DELETE },
    { kind: 'changeHere', rows: [6], limit: MASS_CHANGE },
  ];
  for (const group of groups) {
    const members = [...steps.values()]
      .filter((s) => s.do !== 'hold' && group.rows.includes(rows.get(s.path)!))
      .map((s) => s.path)
      .sort();
    if (members.length <= group.limit) continue;
    const key = massKey(group.kind, members);
    if (massOk.has(key)) continue;
    mass.push({ kind: group.kind, paths: members, key });
    for (const path of members) steps.set(path, { do: 'hold', path, why: 'mass' });
  }

  return { steps: paths.flatMap((p) => (steps.has(p) ? [steps.get(p)!] : [])), mass, broken };
}

/** Erster Abgleich (kein gemeinsamer Stand): was gleich, nur hier, nur dort, verschieden ist. */
export function compareWithoutBase(
  local: ReadonlyMap<string, Sha>,
  remote: ReadonlyMap<string, Sha>,
): { same: string[]; onlyLocal: string[]; onlyRemote: string[]; different: string[] } {
  const same: string[] = [];
  const onlyLocal: string[] = [];
  const onlyRemote: string[] = [];
  const different: string[] = [];
  for (const path of [...new Set([...local.keys(), ...remote.keys()])].sort()) {
    const h = local.get(path);
    const d = remote.get(path);
    if (h === undefined) onlyRemote.push(path);
    else if (d === undefined) onlyLocal.push(path);
    else if (h === d) same.push(path);
    else different.push(path);
  }
  return { same, onlyLocal, onlyRemote, different };
}

export interface ChangeCounts {
  changed: number;
  added: number;
  removed: number;
}

/** Wie viele Einträge hochgeladen (`up`) und übernommen (`down`) werden. */
export function countChanges(
  steps: readonly SyncStep[],
  base: ReadonlyMap<string, Sha>,
): { up: ChangeCounts; down: ChangeCounts } {
  const up: ChangeCounts = { changed: 0, added: 0, removed: 0 };
  const down: ChangeCounts = { changed: 0, added: 0, removed: 0 };
  for (const step of steps) {
    const known = base.has(step.path);
    if (step.do === 'push') up[known ? 'changed' : 'added']++;
    else if (step.do === 'pushDelete') up.removed++;
    else if (step.do === 'pull') down[known ? 'changed' : 'added']++;
    else if (step.do === 'pullDelete') down.removed++;
    else if (step.do === 'merge') {
      up.changed++;
      down.changed++;
    }
  }
  return { up, down };
}
