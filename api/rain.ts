import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { calculateCentroid } from '../lib/centroid';
import { generateHourKeys, getRequiredDates } from '../lib/time';
import { fetchIemMultipleDays, fetchIemCustomRange } from '../lib/iem';
import { aggregateRain } from '../lib/aggregate';

let _supabase: any = null;
function getSupabase() {
  if (!_supabase && process.env.SUPABASE_URL) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
    );
  }
  return _supabase;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    let lat: number = 0;
    let lon: number = 0;
    let type: 'point' | 'polygon' = 'point';
    const fieldId = (req.query.field_id as string) || (req.body?.field_id as string);

    // 2. Resolve Coordinates (Point or Polygon)
    if (req.method === 'POST') {
      const body = req.body || {};
      const polygon = body.polygon || (body.type === 'Polygon' ? body.coordinates[0] : null);
      
      if (polygon) {
        const cent = calculateCentroid(polygon);
        lat = cent.lat;
        lon = cent.lon;
        type = 'polygon';
      }
    } else {
      const qLat = parseFloat(req.query.lat as string);
      const qLon = parseFloat(req.query.lon as string);
      
      if (!isNaN(qLat) && !isNaN(qLon)) {
        lat = qLat;
        lon = qLon;
        type = 'point';
      }
    }

    // 3. Time Logic
    const tz = (req.query.tz as string) || 'UTC';
    const asOf = (req.query.asOf as string);
    const startDate = (req.query.start_date as string);
    const { keys, periodEndUtc } = generateHourKeys(asOf, tz, 169);
    const endDate = (req.query.end_date as string) || periodEndUtc.toISOString().split('T')[0];

    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return res.status(400).json({ error: 'Invalid start_date', detail: 'Expected YYYY-MM-DD format' });
    }
    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({ error: 'Invalid end_date', detail: 'Expected YYYY-MM-DD format' });
    }
    if (startDate && !fieldId && !(lat && lon)) {
      return res.status(400).json({ error: 'start_date requires field_id or lat/lon', detail: 'Custom date ranges need field_id or coordinates to fetch data.' });
    }

    // 4. Mode A: IEM Radar Data (Hourly High-Resolution)
    let iemTotals = null;
    if (lat && lon && !startDate) {
      const dates = getRequiredDates(keys);
      const hourMap = await fetchIemMultipleDays(lat, lon, dates);
      iemTotals = aggregateRain(hourMap, keys);
    }

    // 5. Mode B: Supabase Fallback (Daily Archives)
    let dbTotals = { '24h': 0, '72h': 0, '168h': 0 };
    let fallbackAvailable = false;

    const fetchDb = async (start: string, end: string) => {
      const supabase = getSupabase();
      if (!supabase) return 0;
      const { data, error } = await supabase.rpc('get_rainfall_stats' as any, {
        p_field_id: fieldId,
        p_start_date: start,
        p_end_date: end
      });
      if (error) return 0;
      const row = Array.isArray(data) ? data[0] : data;
      return Number(row?.total_inches || 0);
    };

    // 5b. Custom range mode: IEM radar + Supabase, take MAX
    if (startDate) {
      const [iemTotal, dbTotal] = await Promise.all([
        (lat && lon) ? fetchIemCustomRange(lat, lon, startDate, endDate) : Promise.resolve(0),
        fetchDb(startDate, endDate)
      ]);

      const total = Math.max(iemTotal, dbTotal);

      let dataWarning: string | undefined;
      if (dbTotal > iemTotal + 0.05) {
        dataWarning = `Merged: Radar ${iemTotal.toFixed(2)}" + ${((dbTotal - iemTotal).toFixed(2))}" from historical database`;
      }

      res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
      return res.status(200).json({
        location: {
          type,
          ...(type === 'polygon' ? { centroidLat: lat, centroidLon: lon } : { lat, lon }),
          fieldId
        },
        periodEndUtc: periodEndUtc.toISOString(),
        units: 'in',
        rain: { total },
        rainMm: { total: Number((total * 25.4).toFixed(2)) },
        ...(dataWarning ? { dataWarning } : {})
      });
    }

    if (fieldId) {
      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({
          error: 'Supabase not configured',
          detail: 'SUPABASE_URL environment variable is not set on this deployment.'
        });
      }

      const date24h = new Date(periodEndUtc.getTime() - 1 * 86400000).toISOString().split('T')[0];
      const date72h = new Date(periodEndUtc.getTime() - 3 * 86400000).toISOString().split('T')[0];
      const date168h = new Date(periodEndUtc.getTime() - 7 * 86400000).toISOString().split('T')[0];

      const [sum24, sum72, sum168] = await Promise.all([
        fetchDb(date24h, endDate),
        fetchDb(date72h, endDate),
        fetchDb(date168h, endDate)
      ]);

      dbTotals = { '24h': sum24, '72h': sum72, '168h': sum168 };
      fallbackAvailable = true;
    }

    // 6. Aggressive Hybrid Merge (Take the MAX of both sources)
    const iem = iemTotals || { '12h': { inches: 0 }, '24h': { inches: 0 }, '72h': { inches: 0 }, '168h': { inches: 0 } };
    
    const finalRain = {
      '12h': iem['12h'].inches, // 12h only from Radar (best res)
      '24h': Math.max(iem['24h'].inches, dbTotals['24h']),
      '72h': Math.max(iem['72h'].inches, dbTotals['72h']),
      '168h': Math.max(iem['168h'].inches, dbTotals['168h'])
    };

    // 7. Data Quality & Warning Strategy
    let dataWarning = iemTotals?.dataWarning || '';
    if (fallbackAvailable) {
        const diff = finalRain['168h'] - (iemTotals?.['168h'].inches || 0);
        if (diff > 0.05) {
            dataWarning = `Merged: Radar + ${diff.toFixed(2)}" from historical database`;
        }
    }

    // 8. Response Construction
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
    
    return res.status(200).json({
      location: {
        type,
        ...(type === 'polygon' ? { centroidLat: lat, centroidLon: lon } : { lat, lon }),
        fieldId
      },
      periodEndUtc: periodEndUtc.toISOString(),
      units: 'in',
      rain: finalRain,
      rainMm: Object.fromEntries(Object.entries(finalRain).map(([k, v]) => [k, Number((v * 25.4).toFixed(2))])),
      dataWarning: dataWarning || undefined
    });

  } catch (err: any) {
    console.error('Rain API Error:', err);
    return res.status(500).json({
      error: 'Internal Server Error'
    });
  }
}
