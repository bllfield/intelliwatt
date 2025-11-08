import { DateTime } from "luxon";

/**
 * Calculate expected number of 15-minute intervals for a given date in America/Chicago.
 * Accounts for DST transitions:
 * - Normal day: 96 intervals (24 hours * 4)
 * - Spring forward (loses 1 hour): 92 intervals (23 hours * 4)
 * - Fall back (gains 1 hour): 100 intervals (25 hours * 4)
 * 
 * @param dateISO - Date string in YYYY-MM-DD format
 * @returns Expected number of 15-minute intervals for that day
 */
export function expectedIntervalsForDateISO(dateISO: string): number {
  const zone = "America/Chicago";
  const date = DateTime.fromISO(dateISO, { zone });
  
  if (!date.isValid) {
    // Fallback to 96 if date is invalid
    return 96;
  }
  
  // Get the start and end of the day in the timezone
  const startOfDay = date.startOf("day");
  const nextDayStart = startOfDay.plus({ days: 1 });
  
  // Calculate the duration in minutes
  const duration = nextDayStart.diff(startOfDay, "minutes");
  const minutes = duration.minutes;
  
  // Each interval is 15 minutes
  // Normal day: 1440 minutes / 15 = 96 intervals
  // Spring forward (loses 1 hour): 1380 minutes / 15 = 92 intervals
  // Fall back (gains 1 hour): 1500 minutes / 15 = 100 intervals
  return Math.round(minutes / 15);
}

