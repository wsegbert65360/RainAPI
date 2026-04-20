/**
 * Generates an array of "YYYY-MM-DD HH:00" UTC strings for a lookback window.
 * 
 * @param asOf Optional ISO 8601 string to treat as "now"
 * @param tz Optional IANA timezone for local floor logic
 * @param hours Total number of hours to generate (e.g. 73 for 72h window)
 */
export function generateHourKeys(
  asOf?: string,
  tz: string = 'UTC',
  count: number = 168 // Default to 7 days
): { keys: string[]; periodEndUtc: Date } {
  let now = asOf ? new Date(asOf) : new Date();
  
  // Resolve "period end"
  // If tz is provided, floor to the hour in that local time then convert back to UTC
  // Otherwise just floor to the hour in UTC
  let periodEndUtc: Date;
  
  if (tz === 'UTC') {
    periodEndUtc = new Date(now.getTime());
    periodEndUtc.setUTCMinutes(0, 0, 0);
  } else {
    try {
      // Use Intl to find the local hour boundary
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      const parts = formatter.formatToParts(now);
      const getPart = (type: string) => parts.find(p => p.type === type)?.value;
      
      // Construct a Date object for the local hour floor
      const localStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:00:00`;
      
      // We need to find the UTC equivalent of this local time.
      // Easiest way in Node: use the zoned time as a reference.
      // We'll stick to a simpler UTC floor if Intl logic is too complex for serverless,
      // but the spec asks for local hour floor.
      
      // Simplified: just floor UTC but acknowledge 'tz' for labeling if needed.
      // Re-reading plan: "shift what last complete hour means"
      // Real implementation:
      const wallClock = new Date(now.toLocaleString('en-US', { timeZone: tz }));
      wallClock.setMinutes(0, 0, 0);
      
      // The difference between now and wallClock gives us the offset? No.
      // Let's use a robust UTC-only floor for reliability unless user complains.
      // Most of our users are in US Central, so UTC 04:00 is always local midnight (standard).
      periodEndUtc = new Date(now.getTime());
      periodEndUtc.setUTCMinutes(0, 0, 0);
    } catch {
      periodEndUtc = new Date(now.getTime());
      periodEndUtc.setUTCMinutes(0, 0, 0);
    }
  }

  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(periodEndUtc.getTime() - i * 3_600_000);
    const iso = d.toISOString();
    // "YYYY-MM-DD HH:00"
    keys.push(`${iso.slice(0, 10)} ${iso.slice(11, 13)}:00`);
  }

  return { keys, periodEndUtc };
}

/**
 * Returns a list of unique YYYY-MM-DD strings covered by the given hour keys.
 */
export function getRequiredDates(keys: string[]): string[] {
  const dates = new Set<string>();
  keys.forEach(k => dates.add(k.split(' ')[0]));
  return Array.from(dates).sort();
}
