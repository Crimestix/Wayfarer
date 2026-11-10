/**
 * Den Kalender an einem bestimmten Tag öffnen – etwa aus einem Datum, das in einem Artikel steht.
 * Der Tag wird vorgemerkt; der Kalender nimmt ihn beim Öffnen und zeigt Monat und Tag.
 */
let pending: number | null = null;

/** Merkt den Tag (Tagesindex seit Beginn der Zeitrechnung) für das nächste Öffnen vor. */
export function focusCalendarOn(day: number): void {
  pending = day;
}

/** Der vorgemerkte Tag, falls es einen gibt. */
export const pendingCalendarFocus = (): number | null => pending;

/** Vergisst den vorgemerkten Tag – sobald der Kalender ihn zeigt. */
export function clearCalendarFocus(): void {
  pending = null;
}
