const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SingleQueryParamResult =
  | { ok: true; value: string | undefined }
  | { ok: false; detail: string };

export function readSingleQueryParam(
  query: Record<string, unknown>,
  name: string
): SingleQueryParamResult {
  const raw = query[name];
  if (raw === undefined) {
    return { ok: true, value: undefined };
  }
  if (Array.isArray(raw)) {
    return {
      ok: false,
      detail: `${name} must appear only once in the query string.`,
    };
  }
  return { ok: true, value: String(raw).trim() };
}

export function parseOptionalFloat(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidIsoDateTime(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

export function daysBetweenInclusive(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function normalizePolygon(input: unknown): [number, number][] {
  let coords: unknown;

  if (Array.isArray(input)) {
    coords = input;
  } else if (
    input &&
    typeof input === 'object' &&
    (input as { type?: string }).type === 'Polygon' &&
    Array.isArray((input as { coordinates?: unknown }).coordinates)
  ) {
    coords = (input as { coordinates: unknown[] }).coordinates[0];
  } else {
    throw new Error('Invalid polygon format');
  }

  if (!Array.isArray(coords) || coords.length < 3) {
    throw new Error('Polygon must have at least 3 points');
  }

  const points: [number, number][] = [];
  for (const point of coords) {
    if (!Array.isArray(point) || point.length < 2) {
      throw new Error('Polygon coordinates must be [lon, lat] pairs');
    }
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error('Polygon coordinates must be numeric');
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error('Polygon coordinates out of range');
    }
    points.push([lon, lat]);
  }

  return points;
}
