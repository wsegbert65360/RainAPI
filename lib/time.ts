/**
 * Generates an array of "YYYY-MM-DD HH:00" UTC strings for a lookback window.
 */
export function generateHourKeys(
  asOf?: string,
  tz: string = 'UTC',
  count: number = 168
): { keys: string[]; periodEndUtc: Date } {
  const now = asOf ? new Date(asOf) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error('Invalid asOf value');
  }

  let periodEndUtc: Date;

  if (tz === 'UTC') {
    periodEndUtc = new Date(now.getTime());
    periodEndUtc.setUTCMinutes(0, 0, 0);
  } else {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const getPart = (type: string) => parts.find((part) => part.type === type)?.value;

    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    const hour = getPart('hour');

    const utcGuess = Date.parse(`${year}-${month}-${day}T${hour}:00:00Z`);
    const localized = new Date(utcGuess);
    const localizedAgain = new Date(
      localized.toLocaleString('en-US', { timeZone: tz })
    );
    const offsetMs = localized.getTime() - localizedAgain.getTime();
    periodEndUtc = new Date(utcGuess + offsetMs);
    periodEndUtc.setUTCMinutes(0, 0, 0);
  }

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
