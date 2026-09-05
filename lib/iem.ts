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

export interface IemFetchResult {
  hourMap: Map<string, number>;
  requestedDates: string[];
  successfulDates: string[];
  failedDates: string[];
  hasUsableData: boolean;
  dataWarning?: string;
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
  hasUsableData: boolean;
  requestedDates: string[];
  successfulDates: string[];
  failedDates: string[];
  dataWarning?: string;
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

function hourKeyFromEndValid(endValid: string): string | null {
  if (typeof endValid !== 'string' || endValid.length < 13) return null;
  const datePart = endValid.slice(0, 10);
  const hourPart = endValid.slice(11, 13);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(datePart) ||
    !/^\d{2}$/.test(hourPart) ||
    !['T', ' '].includes(endValid[10])
  ) {
    return null;
  }

  const [year, month, day] = datePart.split('-').map(Number);
  const hour = Number(hourPart);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    hour < 0 ||
    hour > 23
  ) {
    return null;
  }

  return `${datePart} ${hourPart}:00`;
}

export function isValidIemObservation(hour: IEMHour): boolean {
  if (!hourKeyFromEndValid(hour.end_valid)) return false;
  const precip = hour.precip_in;
  if (precip === null || precip === undefined) return false;
  const value = Number(precip);
  return Number.isFinite(value) && value >= 0;
}

function parseIemDayPayload(json: unknown): Map<string, number> {
  const hourMap = new Map<string, number>();
  if (!json || typeof json !== 'object' || !Array.isArray((json as IEMResponse).data)) {
    return hourMap;
  }

  for (const hour of (json as IEMResponse).data) {
    if (!isValidIemObservation(hour)) continue;
    const key = hourKeyFromEndValid(hour.end_valid);
    if (key) {
      hourMap.set(key, Number(hour.precip_in));
    }
  }
  return hourMap;
}

function partialCoverageWarning(failedDates: string[]): string | undefined {
  if (failedDates.length === 0) return undefined;
  return `Radar data unavailable for ${failedDates.length} day(s): ${failedDates.join(', ')}.`;
}

async function fetchSingleDay(
  lat: number,
  lon: number,
  dateStr: string,
  abortSignal?: AbortSignal,
  retries = 2
): Promise<Map<string, number>> {
  const url = `${IEM_BASE_URL}?lat=${lat}&lon=${lon}&valid=${dateStr}&tz=UTC`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: abortSignal });
      if (!res.ok) {
        if (attempt < retries) continue;
        throw new IemFetchError(`IEM returned ${res.status} for ${dateStr}`);
      }

      const json = (await res.json()) as unknown;
      return parseIemDayPayload(json);
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

  return new Map();
}

export async function fetchIemDay(
  lat: number,
  lon: number,
  dateStr: string,
  abortSignal?: AbortSignal,
  retries = 2
): Promise<Map<string, number>> {
  return fetchSingleDay(lat, lon, dateStr, abortSignal, retries);
}

async function fetchIemMultipleDaysImpl(
  lat: number,
  lon: number,
  dates: string[],
  timeoutMs = 8000
): Promise<IemFetchResult> {
  if (dates.length === 0) {
    throw new IemFetchError('No radar dates requested');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const successfulDates: string[] = [];
  const failedDates: string[] = [];
  const unifiedMap = new Map<string, number>();

  try {
    for (let i = 0; i < dates.length; i += IEM_MAX_PARALLEL_DAYS) {
      const chunk = dates.slice(i, i + IEM_MAX_PARALLEL_DAYS);
      const results = await Promise.all(
        chunk.map(async (date) => {
          try {
            const dayMap = await fetchSingleDay(lat, lon, date, controller.signal);
            return { date, dayMap, error: null as Error | null };
          } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error('IEM fetch failed');
            return { date, dayMap: new Map<string, number>(), error };
          }
        })
      );

      for (const { date, dayMap, error } of results) {
        if (error || dayMap.size === 0) {
          failedDates.push(date);
        } else {
          successfulDates.push(date);
          dayMap.forEach((value, key) => unifiedMap.set(key, value));
        }
      }
    }

    if (successfulDates.length === 0) {
      throw new IemFetchError('No usable radar observations for requested dates');
    }

    return {
      hourMap: unifiedMap,
      requestedDates: [...dates],
      successfulDates,
      failedDates,
      hasUsableData: true,
      dataWarning: partialCoverageWarning(failedDates),
    };
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
): Promise<IemFetchResult> {
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

  const fetchResult = await fetchIemMultipleDays(lat, lon, radarDates, timeoutMs);
  let total = 0;
  fetchResult.hourMap.forEach((value) => {
    total += value;
  });

  const dateRangePartial =
    radarDates.length < requestedDates.length ||
    radarDates[0] !== startDate ||
    radarDates[radarDates.length - 1] !== endDate;

  const warnings: string[] = [];
  if (fetchResult.dataWarning) warnings.push(fetchResult.dataWarning);
  if (dateRangePartial) {
    warnings.push(
      `Radar verification covers ${radarDates[0]} to ${radarDates[radarDates.length - 1]} only.`
    );
  }

  return {
    total: Number(total.toFixed(3)),
    radarStartDate: radarDates[0] ?? startDate,
    radarEndDate: radarDates[radarDates.length - 1] ?? endDate,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    partialCoverage: dateRangePartial || fetchResult.failedDates.length > 0,
    hasUsableData: fetchResult.hasUsableData,
    requestedDates: fetchResult.requestedDates,
    successfulDates: fetchResult.successfulDates,
    failedDates: fetchResult.failedDates,
    dataWarning: warnings.length > 0 ? warnings.join(' ') : undefined,
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
