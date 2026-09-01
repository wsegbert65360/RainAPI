/**
 * Service for fetching IEM Stage IV radar data.
 */

const IEM_BASE_URL = 'https://mesonet.agron.iastate.edu/json/stage4.py';

export const IEM_MAX_PARALLEL_DAYS = 4;
export const IEM_RADAR_RECENT_DAYS = 365;
export const COORD_CUSTOM_RANGE_MAX_DAYS = 90;

export interface IEMHour {
  end_valid: string;
  precip_in: number | null;
}

export interface IEMResponse {
  data: IEMHour[];
}

export class IemFetchError extends Error {
  constructor(message: string, public readonly retryAfterSeconds = 60) {
    super(message);
    this.name = 'IemFetchError';
  }
}

type IemTestMocks = {
  fetchIemMultipleDays?: typeof fetchIemMultipleDaysImpl;
  fetchIemCustomRange?: typeof fetchIemCustomRangeImpl;
};

let iemTestMocks: IemTestMocks = {};

export function __test_setIemMocks(mocks: IemTestMocks): void {
  iemTestMocks = mocks;
}

export function __test_resetIemMocks(): void {
  iemTestMocks = {};
}

export interface CustomRangeRadarResult {
  total: number;
  radarStartDate: string;
  radarEndDate: string;
  requestedStartDate: string;
  requestedEndDate: string;
  partialCoverage: boolean;
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

async function fetchChunk(
  lat: number,
  lon: number,
  dates: string[],
  abortSignal?: AbortSignal,
  retries = 2
): Promise<Map<string, number>> {
  const hourMap = new Map<string, number>();

  for (const dateStr of dates) {
    const url = `${IEM_BASE_URL}?lat=${lat}&lon=${lon}&valid=${dateStr}&tz=UTC`;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, { signal: abortSignal });
        if (!res.ok) {
          if (attempt < retries) continue;
          throw new IemFetchError(`IEM returned ${res.status} for ${dateStr}`);
        }

        const json = (await res.json()) as IEMResponse;
        if (!Array.isArray(json?.data)) {
          if (attempt < retries) continue;
          throw new IemFetchError(`IEM returned invalid payload for ${dateStr}`);
        }

        json.data.forEach((hour) => {
          if (hour.end_valid && hour.precip_in != null) {
            const key =
              hour.end_valid.slice(0, 10) + ' ' + hour.end_valid.slice(11, 13) + ':00';
            hourMap.set(key, Number(hour.precip_in));
          }
        });
        break;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') throw err;
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
          continue;
        }
        if (err instanceof IemFetchError) throw err;
        throw new IemFetchError(`IEM fetch failed for ${dateStr}`);
      }
    }
  }

  return hourMap;
}

export async function fetchIemDay(
  lat: number,
  lon: number,
  dateStr: string,
  abortSignal?: AbortSignal,
  retries = 2
): Promise<Map<string, number>> {
  return fetchChunk(lat, lon, [dateStr], abortSignal, retries);
}

async function fetchIemMultipleDaysImpl(
  lat: number,
  lon: number,
  dates: string[],
  timeoutMs = 8000
): Promise<Map<string, number>> {
  if (dates.length === 0) return new Map();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const unifiedMap = new Map<string, number>();
    for (let i = 0; i < dates.length; i += IEM_MAX_PARALLEL_DAYS) {
      const chunk = dates.slice(i, i + IEM_MAX_PARALLEL_DAYS);
      const results = await Promise.all(
        chunk.map((date) => fetchChunk(lat, lon, [date], controller.signal))
      );
      results.forEach((result) => {
        result.forEach((value, key) => unifiedMap.set(key, value));
      });
    }
    return unifiedMap;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new IemFetchError('IEM request timed out', 60);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchIemMultipleDays(
  lat: number,
  lon: number,
  dates: string[],
  timeoutMs = 8000
): Promise<Map<string, number>> {
  if (iemTestMocks.fetchIemMultipleDays) {
    return iemTestMocks.fetchIemMultipleDays(lat, lon, dates, timeoutMs);
  }
  return fetchIemMultipleDaysImpl(lat, lon, dates, timeoutMs);
}

async function fetchIemCustomRangeImpl(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
  timeoutMs = 8000
): Promise<CustomRangeRadarResult> {
  const requestedDates = enumerateDates(startDate, endDate);
  const radarDates =
    requestedDates.length > IEM_RADAR_RECENT_DAYS
      ? requestedDates.slice(requestedDates.length - IEM_RADAR_RECENT_DAYS)
      : requestedDates;

  const hourMap = await fetchIemMultipleDays(lat, lon, radarDates, timeoutMs);
  let total = 0;
  hourMap.forEach((value) => {
    total += value;
  });

  return {
    total: Number(total.toFixed(3)),
    radarStartDate: radarDates[0] ?? startDate,
    radarEndDate: radarDates[radarDates.length - 1] ?? endDate,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    partialCoverage:
      radarDates.length < requestedDates.length ||
      radarDates[0] !== startDate ||
      radarDates[radarDates.length - 1] !== endDate,
  };
}

export async function fetchIemCustomRange(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
  timeoutMs = 8000
): Promise<CustomRangeRadarResult> {
  if (iemTestMocks.fetchIemCustomRange) {
    return iemTestMocks.fetchIemCustomRange(lat, lon, startDate, endDate, timeoutMs);
  }
  return fetchIemCustomRangeImpl(lat, lon, startDate, endDate, timeoutMs);
}
