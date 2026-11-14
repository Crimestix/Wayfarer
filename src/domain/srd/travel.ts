/**
 * Reisewerte der Reittiere, Fuhrwerke und Schiffe aus dem System Reference Document 5.2.1 – nur
 * Zahlen, keine Beschreibungen: Traglast der Reittiere (Tabelle „Mounts and Other Animals“), ihre
 * Bewegungsrate (aus den Werteblöcken), und für Schiffe Tempo, Besatzung, Mitreisende und Ladung
 * (Tabelle „Airborne and Waterborne Vehicles“). Fuhrwerke haben im SRD keine eigenen Werte – sie
 * reisen im Tempo der Gruppe. Gilt nur als Vorgabe beim Anlegen eines Fortbewegungsmittels; der
 * Spielleiter ändert jede Zahl. Namensnennung: `attribution.ts`.
 */
import type { MountKind } from '../schema';

export interface SrdTravel {
  kind: MountKind;
  /** Bewegungsrate in Fuß. */
  speed?: number;
  /** Traglast in Pfund. */
  capacity?: number;
  /** Tempo in Meilen je Stunde (Schiffe). */
  mph?: number;
  crew?: number;
  passengers?: number;
  /** Ladung in Tonnen. */
  cargo?: number;
  flies?: boolean;
}

/** Nach der Kennung im Nachschlagewerk (`srd-…`). */
export const SRD_TRAVEL: Readonly<Record<string, SrdTravel>> = {
  'srd-camel': { kind: 'mount', speed: 50, capacity: 450 },
  'srd-elephant': { kind: 'mount', speed: 40, capacity: 1320 },
  'srd-draft-horse': { kind: 'mount', speed: 40, capacity: 540 },
  'srd-riding-horse': { kind: 'mount', speed: 60, capacity: 480 },
  'srd-mastiff': { kind: 'mount', speed: 40, capacity: 195 },
  'srd-mule': { kind: 'mount', speed: 40, capacity: 420 },
  'srd-pony': { kind: 'mount', speed: 40, capacity: 225 },
  'srd-warhorse': { kind: 'mount', speed: 60, capacity: 540 },
  'srd-carriage': { kind: 'vehicle' },
  'srd-cart': { kind: 'vehicle' },
  'srd-chariot': { kind: 'vehicle' },
  'srd-sled': { kind: 'vehicle' },
  'srd-wagon': { kind: 'vehicle' },
  'srd-airship': { kind: 'ship', mph: 8, crew: 10, passengers: 20, cargo: 1, flies: true },
  'srd-galley': { kind: 'ship', mph: 4, crew: 80, cargo: 150 },
  'srd-keelboat': { kind: 'ship', mph: 1, crew: 1, passengers: 6, cargo: 0.5 },
  'srd-longship': { kind: 'ship', mph: 3, crew: 40, passengers: 150, cargo: 10 },
  'srd-rowboat': { kind: 'ship', mph: 1.5, crew: 1, passengers: 3 },
  'srd-sailing-ship': { kind: 'ship', mph: 2, crew: 20, passengers: 20, cargo: 100 },
  'srd-warship': { kind: 'ship', mph: 2.5, crew: 60, passengers: 60, cargo: 200 },
};
