import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { calculateCentroid } from '../lib/centroid';
import { generateHourKeys, getRequiredDates } from '../lib/time';
import {
  COORD_CUSTOM_RANGE_MAX_DAYS,
  fetchIemCustomRange,
  fetchIemMultipleDays,
  IemFetchError,
} from '../lib/iem';
import { aggregateRain } from '../lib/aggregate';
import {
  daysBetweenInclusive,
  isValidCalendarDate,
  isValidIsoDateTime,
  isValidTimezone,
  isValidUuid,
  normalizePolygon,
  parseOptionalFloat,
} from '../lib/validate';

type SourceStatus = 'ok' | 'unavailable';

interface SourceState {
  radar: SourceStatus;
  database: SourceStatus;
}

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (
    !_supabase &&
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabase;
}

function setCors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function badRequest(res: VercelResponse, error: string, detail: string) {
  return res.status(400).json({ error, detail });
}

function methodNotAllowed(res: VercelResponse) {
  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return res.status(405).json({ error: 'Method Not Allowed' });
}

function setCacheControl(
  res: VercelResponse,
  options: { fieldId?: string; customRange?: boolean }
) {
  if (options.fieldId || options.customRange) {
    res.setHeader('Cache-Control', 'private, no-store');
  } else {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  }
}

function inchesToMmMap(values: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, Number((value * 25.4).toFixed(2))])
  );
}

async function fetchDbTotal(
  fieldId: string,
  start: string,
  end: string
): Promise<{ total: number; ok: boolean }> {
  const supabase = getSupabase();
  if (!supabase) return { total: 0, ok: false };

  const { data, error } = await supabase.rpc('get_rainfall_stats', {
    p_field_id: fieldId,
    p_start_date: start,
    p_end_date: end,
  });

  if (error) return { total: 0, ok: false };
  const row = Array.isArray(data) ? data[0] : data;
  return { total: Number(row?.total_inches || 0), ok: true };
}

function combineWarnings(...parts: Array<string | undefined>): string | undefined {
  const warnings = parts.filter((part): part is string => Boolean(part && part.trim()));
  return warnings.length > 0 ? warnings.join(' ') : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return methodNotAllowed(res);
  }

  try {
    let lat: number | undefined;
    let lon: number | undefined;
    let type: 'point' | 'polygon' = 'point';

    const fieldIdRaw =
      (req.query.field_id as string | undefined) || (req.body?.field_id as string | undefined);
    const fieldId = fieldIdRaw?.trim() || undefined;

    if (fieldId && !isValidUuid(fieldId)) {
      return badRequest(res, 'Invalid field_id', 'field_id must be a valid UUID.');
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const polygon =
        body.polygon || (body.type === 'Polygon' ? body.coordinates?.[0] : undefined);

      if (polygon) {
        try {
          const ring = normalizePolygon(polygon);
          const centroid = calculateCentroid(ring);
          lat = centroid.lat;
          lon = centroid.lon;
          type = 'polygon';
        } catch (err: unknown) {
          const detail = err instanceof Error ? err.message : 'Invalid polygon';
          return badRequest(res, 'Invalid polygon', detail);
        }
      }
    } else {
      const parsedLat = parseOptionalFloat(req.query.lat);
      const parsedLon = parseOptionalFloat(req.query.lon);

      if (Number.isNaN(parsedLat)) {
        return badRequest(res, 'Invalid latitude', 'lat must be a number.');
      }
      if (Number.isNaN(parsedLon)) {
        return badRequest(res, 'Invalid longitude', 'lon must be a number.');
      }

      if (parsedLat !== undefined || parsedLon !== undefined) {
        if (parsedLat === undefined || parsedLon === undefined) {
          return badRequest(res, 'Missing coordinates', 'lat and lon must be provided together.');
        }
        if (parsedLat < -90 || parsedLat > 90) {
          return badRequest(res, 'Invalid latitude', 'lat must be between -90 and 90.');
        }
        if (parsedLon < -180 || parsedLon > 180) {
          return badRequest(res, 'Invalid longitude', 'lon must be between -180 and 180.');
        }
        lat = parsedLat;
        lon = parsedLon;
        type = 'point';
      }
    }

    const tz = ((req.query.tz as string) || 'UTC').trim();
    if (!isValidTimezone(tz)) {
      return badRequest(res, 'Invalid timezone', 'tz must be a valid IANA timezone.');
    }

    const asOf = (req.query.asOf as string | undefined)?.trim();
    if (asOf && !isValidIsoDateTime(asOf)) {
      return badRequest(res, 'Invalid asOf', 'asOf must be a valid ISO 8601 datetime.');
    }

    const startDate = (req.query.start_date as string | undefined)?.trim();
    const endDateQuery = (req.query.end_date as string | undefined)?.trim();

    if (endDateQuery && !startDate) {
      return badRequest(
        res,
        'Missing start_date',
        'end_date requires start_date.'
      );
    }

    let keys: string[];
    let periodEndUtc: Date;
    try {
      const generated = generateHourKeys(asOf, tz, 169);
      keys = generated.keys;
      periodEndUtc = generated.periodEndUtc;
    } catch {
      return badRequest(res, 'Invalid asOf', 'asOf must be a valid ISO 8601 datetime.');
    }

    const endDate = endDateQuery || periodEndUtc.toISOString().split('T')[0];

    if (startDate && !isValidCalendarDate(startDate)) {
      return badRequest(res, 'Invalid start_date', 'Expected YYYY-MM-DD calendar date.');
    }
    if (endDate && !isValidCalendarDate(endDate)) {
      return badRequest(res, 'Invalid end_date', 'Expected YYYY-MM-DD calendar date.');
    }
    if (startDate && endDate && startDate > endDate) {
      return badRequest(res, 'Invalid date range', 'start_date must be on or before end_date.');
    }
    if (startDate && !fieldId && (lat === undefined || lon === undefined)) {
      return badRequest(
        res,
        'start_date requires field_id or lat/lon',
        'Custom date ranges need field_id or coordinates to fetch data.'
      );
    }

    if (!startDate && lat === undefined && lon === undefined && !fieldId) {
      return badRequest(
        res,
        'Missing location',
        'Provide lat/lon, a polygon body, or field_id.'
      );
    }

    if (startDate) {
      const rangeDays = daysBetweenInclusive(startDate, endDate);
      if (!fieldId && rangeDays > COORD_CUSTOM_RANGE_MAX_DAYS) {
        return badRequest(
          res,
          'Date range too large',
          `Coordinate-only custom ranges are limited to ${COORD_CUSTOM_RANGE_MAX_DAYS} days.`
        );
      }

      const sourceStatus: SourceState = { radar: 'unavailable', database: 'unavailable' };
      let total = 0;
      const warnings: string[] = [];

      const radarPromise =
        lat !== undefined && lon !== undefined
          ? fetchIemCustomRange(lat, lon, startDate, endDate).then(
              (result) => ({ ok: true as const, result }),
              () => ({ ok: false as const, result: null })
            )
          : Promise.resolve({ ok: false as const, result: null });

      const dbPromise = fieldId
        ? fetchDbTotal(fieldId, startDate, endDate).then((result) => result)
        : Promise.resolve({ total: 0, ok: false });

      const [radarOutcome, dbOutcome] = await Promise.all([radarPromise, dbPromise]);

      if (radarOutcome.ok && radarOutcome.result) {
        sourceStatus.radar = 'ok';
        total = radarOutcome.result.total;
        if (radarOutcome.result.partialCoverage) {
          warnings.push(
            `Radar verification covers ${radarOutcome.result.radarStartDate} to ${radarOutcome.result.radarEndDate} only.`
          );
        }
      }

      if (dbOutcome.ok) {
        sourceStatus.database = 'ok';
        total = sourceStatus.radar === 'ok'
          ? Math.max(total, dbOutcome.total)
          : dbOutcome.total;
      } else if (fieldId && sourceStatus.radar !== 'ok') {
        return res.status(502).json({
          error: 'Upstream data unavailable',
          detail: 'Radar and database rainfall sources are unavailable.',
          retryAfterSeconds: 60,
        });
      } else if (!fieldId && sourceStatus.radar !== 'ok') {
        return res.status(502).json({
          error: 'Upstream data unavailable',
          detail: 'Radar rainfall data is unavailable.',
          retryAfterSeconds: 60,
        });
      }

      if (sourceStatus.radar === 'ok' && sourceStatus.database === 'unavailable' && fieldId) {
        warnings.push('Historical database data was unavailable; using radar totals.');
      }
      if (sourceStatus.database === 'ok' && sourceStatus.radar === 'unavailable' && lat !== undefined) {
        warnings.push('Radar data was unavailable; using historical database totals.');
      }

      setCacheControl(res, { fieldId, customRange: true });
      return res.status(200).json({
        location: {
          type,
          ...(type === 'polygon'
            ? { centroidLat: lat, centroidLon: lon }
            : lat !== undefined && lon !== undefined
              ? { lat, lon }
              : {}),
          ...(fieldId ? { fieldId } : {}),
        },
        periodEndUtc: periodEndUtc.toISOString(),
        units: 'in',
        rain: { total },
        rainMm: { total: Number((total * 25.4).toFixed(2)) },
        ...(combineWarnings(...warnings) ? { dataWarning: combineWarnings(...warnings) } : {}),
        sourceStatus,
      });
    }

    const sourceStatus: SourceState = { radar: 'unavailable', database: 'unavailable' };
    let iemTotals: ReturnType<typeof aggregateRain> | null = null;

    if (lat !== undefined && lon !== undefined) {
      try {
        const dates = getRequiredDates(keys);
        const hourMap = await fetchIemMultipleDays(lat, lon, dates);
        iemTotals = aggregateRain(hourMap, keys);
        sourceStatus.radar = 'ok';
      } catch (err: unknown) {
        if (!(err instanceof IemFetchError) && !(err instanceof Error)) {
          throw err;
        }
      }
    }

    let dbTotals = { '24h': 0, '72h': 0, '168h': 0 };
    if (fieldId) {
      const supabase = getSupabase();
      if (!supabase) {
        if (sourceStatus.radar !== 'ok') {
          return res.status(502).json({
            error: 'Upstream data unavailable',
            detail: 'Database is not configured and radar data is unavailable.',
            retryAfterSeconds: 60,
          });
        }
      } else {
        const date24h = new Date(periodEndUtc.getTime() - 1 * 86_400_000).toISOString().split('T')[0];
        const date72h = new Date(periodEndUtc.getTime() - 3 * 86_400_000).toISOString().split('T')[0];
        const date168h = new Date(periodEndUtc.getTime() - 7 * 86_400_000).toISOString().split('T')[0];

        const [sum24, sum72, sum168] = await Promise.all([
          fetchDbTotal(fieldId, date24h, endDate),
          fetchDbTotal(fieldId, date72h, endDate),
          fetchDbTotal(fieldId, date168h, endDate),
        ]);

        if (sum24.ok && sum72.ok && sum168.ok) {
          sourceStatus.database = 'ok';
          dbTotals = {
            '24h': sum24.total,
            '72h': sum72.total,
            '168h': sum168.total,
          };
        }
      }
    }

    if (sourceStatus.radar !== 'ok' && sourceStatus.database !== 'ok') {
      return res.status(502).json({
        error: 'Upstream data unavailable',
        detail: 'Radar and database rainfall sources are unavailable.',
        retryAfterSeconds: 60,
      });
    }

    if (!fieldId && sourceStatus.radar !== 'ok') {
      return res.status(502).json({
        error: 'Upstream data unavailable',
        detail: 'Radar rainfall data is unavailable.',
        retryAfterSeconds: 60,
      });
    }

    const iem = iemTotals || {
      '12h': { inches: 0 },
      '24h': { inches: 0 },
      '72h': { inches: 0 },
      '168h': { inches: 0 },
    };

    const finalRain = {
      '12h': sourceStatus.radar === 'ok' ? iem['12h'].inches : 0,
      '24h':
        sourceStatus.radar === 'ok' && sourceStatus.database === 'ok'
          ? Math.max(iem['24h'].inches, dbTotals['24h'])
          : sourceStatus.radar === 'ok'
            ? iem['24h'].inches
            : dbTotals['24h'],
      '72h':
        sourceStatus.radar === 'ok' && sourceStatus.database === 'ok'
          ? Math.max(iem['72h'].inches, dbTotals['72h'])
          : sourceStatus.radar === 'ok'
            ? iem['72h'].inches
            : dbTotals['72h'],
      '168h':
        sourceStatus.radar === 'ok' && sourceStatus.database === 'ok'
          ? Math.max(iem['168h'].inches, dbTotals['168h'])
          : sourceStatus.radar === 'ok'
            ? iem['168h'].inches
            : dbTotals['168h'],
    };

    const warnings: string[] = [];
    if (iemTotals?.dataWarning) warnings.push(iemTotals.dataWarning);
    if (sourceStatus.radar === 'ok' && sourceStatus.database === 'unavailable' && fieldId) {
      warnings.push('Historical database data was unavailable; using radar totals.');
    }
    if (sourceStatus.database === 'ok' && sourceStatus.radar === 'unavailable') {
      warnings.push('Radar data was unavailable; using historical database totals.');
    }
    if (
      sourceStatus.radar === 'ok' &&
      sourceStatus.database === 'ok' &&
      finalRain['168h'] - iem['168h'].inches > 0.05
    ) {
      warnings.push(
        `Merged: Radar + ${(finalRain['168h'] - iem['168h'].inches).toFixed(2)}" from historical database`
      );
    }

    setCacheControl(res, { fieldId });

    return res.status(200).json({
      location: {
        type,
        ...(type === 'polygon'
          ? { centroidLat: lat, centroidLon: lon }
          : lat !== undefined && lon !== undefined
            ? { lat, lon }
            : {}),
        ...(fieldId ? { fieldId } : {}),
      },
      periodEndUtc: periodEndUtc.toISOString(),
      units: 'in',
      rain: finalRain,
      rainMm: inchesToMmMap(finalRain),
      ...(combineWarnings(...warnings) ? { dataWarning: combineWarnings(...warnings) } : {}),
      sourceStatus,
    });
  } catch (err: unknown) {
    console.error('Rain API Error:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
    });
  }
}

// Test hooks
export function __test_resetSupabase(): void {
  _supabase = null;
}

export function __test_setSupabase(client: SupabaseClient | null): void {
  _supabase = client;
}
