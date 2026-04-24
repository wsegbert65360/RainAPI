/**
 * Service for fetching IEM Stage IV radar data.
 * The endpoint is: https://mesonet.agron.iastate.edu/json/stage4.py?lat=...&lon=...&valid=YYYY-MM-DD&tz=UTC
 */

const IEM_BASE_URL = 'https://mesonet.agron.iastate.edu/json/stage4.py';

export interface IEMHour {
  end_valid: string;
  precip_in: number | null;
}

export interface IEMResponse {
  data: IEMHour[];
}

/**
 * Fetches Stage IV hourly precipitation for a specific Point + UTC Date.
 * Includes a simple retry mechanism for better resilience.
 */
export async function fetchIemDay(
  lat: number,
  lon: number,
  dateStr: string,
  abortSignal?: AbortSignal,
  retries: number = 2
): Promise<Map<string, number>> {
  const url = `${IEM_BASE_URL}?lat=${lat}&lon=${lon}&valid=${dateStr}&tz=UTC`;
  const hourMap = new Map<string, number>();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: abortSignal });
      if (!res.ok) {
          if (attempt < retries) continue;
          console.error(`IEM Fetch Error: ${res.status} for ${url}`);
          return hourMap;
      }
      
      const json = await res.json() as IEMResponse;
      if (Array.isArray(json?.data)) {
        json.data.forEach(h => {
          if (h.end_valid && h.precip_in != null) {
            const key = h.end_valid.slice(0, 10) + ' ' + h.end_valid.slice(11, 13) + ':00';
            hourMap.set(key, Number(h.precip_in));
          }
        });
        return hourMap; // Success
      }
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      if (attempt < retries) {
          // Simple exponential backoff
          await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
          continue;
      }
      console.error(`IEM Fetch Failure for ${url}:`, err);
    }
  }

  return hourMap;
}

/**
 * Fetches multiple IEM dates in parallel.
 * Returns a single unified Map of hourly precipitation.
 */
export async function fetchIemMultipleDays(
  lat: number,
  lon: number,
  dates: string[],
  timeoutMs: number = 8000
): Promise<Map<string, number>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const results = await Promise.all(
      dates.map(date => fetchIemDay(lat, lon, date, controller.signal))
    );

    const unifiedMap = new Map<string, number>();
    results.forEach(m => {
      m.forEach((val, key) => {
        unifiedMap.set(key, val);
      });
    });

    return unifiedMap;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches IEM radar data for a custom date range and returns total inches.
 * Generates the date array from startDate to endDate, fetches all days in parallel,
 * and sums all hourly values.
 */
export async function fetchIemCustomRange(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
  timeoutMs: number = 15000
): Promise<number> {
  const dates: string[] = [];
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  if (dates.length === 0) return 0;
  if (dates.length > 365) dates.splice(0, dates.length - 365);

  const hourMap = await fetchIemMultipleDays(lat, lon, dates, timeoutMs);
  let total = 0;
  hourMap.forEach(val => { total += val; });
  return Number(total.toFixed(3));
}
