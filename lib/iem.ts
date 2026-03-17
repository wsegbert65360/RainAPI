/**
 * IEM Stage IV data fetching and parsing.
 */

export class IEMError extends Error {
  constructor(message: string, public retryAfterSeconds: number = 60) {
    super(message);
    this.name = 'IEMError';
  }
}

/**
 * Helper for a single fetch attempt for one day.
 */
async function fetchIemDayOnce(
  lat: number,
  lon: number,
  date: string,
  hourMap: Map<string, number>
): Promise<void> {
  const url = `https://mesonet.agron.iastate.edu/json/stage4.py?lat=${lat}&lon=${lon}&valid=${date}&tz=UTC`;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'rain-api/1.0 (acreledger; contact@yourdomain.com)',
        'Accept': 'application/json',
        'Connection': 'close',
      },
    });

    if (!response.ok) {
      throw new IEMError(`IEM returned HTTP ${response.status} for ${date}`);
    }

    const json: any = await response.json();
    if (json.data && Array.isArray(json.data)) {
      for (const hour of json.data) {
        const val = typeof hour.precip_in === 'number' ? Math.max(0, hour.precip_in) : 0;
        let key = hour.end_valid;
        if (key && !key.includes('T')) {
          key = key.replace(' ', 'T') + ':00Z';
        }
        if (key) {
          hourMap.set(key, val);
        }
      }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new IEMError(`IEM timed out for date ${date}`);
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Fetches Stage IV hourly precipitation from IEM for multiple dates in parallel.
 * Includes retries for transient ECONNRESET errors.
 */
export async function fetchIEMData(
  lat: number,
  lon: number,
  dates: string[]
): Promise<Map<string, number>> {
  const hourMap = new Map<string, number>();

  const fetchWithRetry = async (date: string, attempt = 1) => {
    try {
      await fetchIemDayOnce(lat, lon, date, hourMap);
    } catch (err: any) {
      const isReset = err.message?.includes('ECONNRESET') || err.code === 'ECONNRESET';
      if (isReset && attempt === 1) {
        // Wait 500ms and retry once
        await new Promise(resolve => setTimeout(resolve, 500));
        return fetchWithRetry(date, 2);
      }
      throw err;
    }
  };

  await Promise.all(dates.map(date => fetchWithRetry(date)));
  return hourMap;
}
