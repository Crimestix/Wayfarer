/** Befehle zum Kalender, die in den Einstellungen und im Bereich „Kalender“ gebraucht werden. */
import type { CampaignDb } from '../../data/db';
import type { SeasonDef } from '../../domain/time/calendar';

/**
 * Legt die Jahreszeiten fest (je Jahreszeit Name und Monate). Eine leere Liste überlässt sie
 * wieder Wayfarer: vier gleiche Viertel um den wärmsten Monat.
 */
export function setSeasons(db: CampaignDb, seasons: readonly SeasonDef[]): void {
  const calendar = db.getSnapshot().campaign.calendar;
  db.setCampaign({
    calendar: {
      ...calendar,
      seasons: seasons.map((season) => ({ name: season.name, months: [...season.months] })),
    },
  });
}
