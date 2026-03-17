/**
 * Logic for period end time, date range calculation, and hourly keys.
 */

/**
 * Normalizes 'now' or a provided 'asOf' string to the last complete hour.
 * If tz is provided, the flooring happens in that local timezone.
 */
export function getPeriodEnd(asOf?: string, tz?: string): Date {
  let now = asOf ? new Date(asOf) : new Date();
  if (isNaN(now.getTime())) {
    throw new Error('Invalid asOf timestamp');
  }

  // If timezone is provided, floor to the hour in that local time
  if (tz && tz !== 'UTC') {
    try {
      // Create a formatter that extracts components in the target timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false,
      });

      const parts = formatter.formatToParts(now);
      const componentMap = Object.fromEntries(parts.map(p => [p.type, p.value]));

      // Create a date object with the same components but in UTC to easily floor minutes/seconds
      // then convert back to the original timezone's UTC representation.
      // A simpler way: construct a local date string "YYYY-MM-DD HH:00:00" in that TZ
      // and parse it as that timezone.
      
      const year = componentMap.year;
      const month = componentMap.month.padStart(2, '0');
      const day = componentMap.day.padStart(2, '0');
      const hour = componentMap.hour.padStart(2, '0');

      // This string represents the floored local time
      const localFlooredStr = `${year}-${month}-${day}T${hour}:00:00`;
      
      // We need to find the UTC time that corresponds to this local time.
      // Intl doesn't provide a direct "parse" function with timezone.
      // So we use a trick: find the offset.
      
      const localDate = new Date(now.toLocaleString('en-US', { timeZone: tz }));
      const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
      const offset = localDate.getTime() - utcDate.getTime();
      
      const flooredInLocal = new Date(localFlooredStr + 'Z'); // Treat as UTC temporarily
      return new Date(flooredInLocal.getTime() - offset);
    } catch (e) {
      throw new Error(`Invalid or unsupported timezone: ${tz}`);
    }
  }

  // UTC flooring (default)
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/**
 * Returns YYYY-MM-DD strings for the UTC calendar dates needed for a 72h window.
 */
export function getDatesNeeded(periodEnd: Date): string[] {
  const dates = new Set<string>();
  for (let i = 0; i < 73; i++) { // Check start, end, and all hours between
    const d = new Date(periodEnd.getTime() - i * 3_600_000);
    dates.add(d.toISOString().split('T')[0]);
  }
  return Array.from(dates).sort();
}

/**
 * Generates an ordered list of 72 UTC hour keys: "YYYY-MM-DDTHH:00:00Z".
 * Most recent (periodEnd) first.
 */
export function getHourKeys(periodEnd: Date): string[] {
  const keys: string[] = [];
  for (let i = 0; i < 72; i++) {
    const d = new Date(periodEnd.getTime() - i * 3_600_000);
    keys.push(`${d.toISOString().slice(0, 13)}:00:00Z`);
  }
  return keys;
}
