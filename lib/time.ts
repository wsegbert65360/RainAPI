/**
 * Generates an array of "YYYY-MM-DD HH:00" UTC strings for a lookback window.
 * periodEndUtc is always the UTC-hour floor of asOf (or now); tz is accepted for
 * API compatibility but does not affect the absolute hour represented.
 */
export function generateHourKeys(
  asOf?: string,
  _tz: string = 'UTC',
  count: number = 168
): { keys: string[]; periodEndUtc: Date } {
  const now = asOf ? new Date(asOf) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error('Invalid asOf value');
  }

  const periodEndUtc = new Date(now.getTime());
  periodEndUtc.setUTCMinutes(0, 0, 0);

  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(periodEndUtc.getTime() - i * 3_600_000);
    const iso = d.toISOString();
    keys.push(`${iso.slice(0, 10)} ${iso.slice(11, 13)}:00`);
  }

  return { keys, periodEndUtc };
}

/**
 * Returns a list of unique YYYY-MM-DD strings covered by the given hour keys.
 */
export function getRequiredDates(keys: string[]): string[] {
  const dates = new Set<string>();
  keys.forEach((key) => dates.add(key.split(' ')[0]));
  return Array.from(dates).sort();
}
