import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ---------------------------------------------------------------------------
// Supabase client (used for field_id mode)
// ---------------------------------------------------------------------------
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ---------------------------------------------------------------------------
// IEM Stage IV helper — fetches hourly precip for one UTC calendar date
// Returns an array of { utc_valid: string, precip_in: number }
// ---------------------------------------------------------------------------
const IEM_TIMEOUT_MS = 8000;

async function fetchIemDay(lat: number, lon: number, dateStr: string): Promise<number> {
  const url = `https://mesonet.agron.iastate.edu/json/stage4.py?lat=${lat}&lon=${lon}&valid=${dateStr}&tz=UTC`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IEM_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return 0;
    const json: any = await res.json();
    if (!Array.isArray(json?.data)) return 0;
    return json.data.reduce((sum: number, h: any) => sum + (Number(h.precip_in) || 0), 0);
  } catch {
    return 0; // timeout or network error — treat as 0
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Build the list of YYYY-MM-DD strings for the last N days (inclusive today)
// ---------------------------------------------------------------------------
function lastNDays(n: number): string[] {
  const dates: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Parse a date-range string list into YYYY-MM-DD strings between start/end
// ---------------------------------------------------------------------------
function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const s = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  for (const d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { lat, lon, field_id, date, start_date, end_date, days } = req.query as {
      lat?: string;
      lon?: string;
      field_id?: string;
      date?: string;
      start_date?: string;
      end_date?: string;
      days?: string;
    };

    // -----------------------------------------------------------------------
    // MODE A: lat + lon  →  IEM Stage IV direct query
    // -----------------------------------------------------------------------
    if (lat !== undefined && lon !== undefined) {
      const latNum = parseFloat(lat);
      const lonNum = parseFloat(lon);

      if (isNaN(latNum) || latNum < -90 || latNum > 90) {
        return res.status(400).json({ error: 'Invalid lat value. Must be -90 to 90.' });
      }
      if (isNaN(lonNum) || lonNum < -180 || lonNum > 180) {
        return res.status(400).json({ error: 'Invalid lon value. Must be -180 to 180.' });
      }

      // Determine date list: explicit range, explicit date, or last N days (default 7)
      let datesToFetch: string[];
      if (start_date && end_date) {
        datesToFetch = dateRange(start_date, end_date);
      } else if (date) {
        datesToFetch = [date];
      } else {
        const lookback = Math.min(Math.max(parseInt(days || '7', 10), 1), 30);
        datesToFetch = lastNDays(lookback);
      }

      // Fetch all dates in parallel
      const totals = await Promise.all(datesToFetch.map(d => fetchIemDay(latNum, lonNum, d)));
      const totalInches = totals.reduce((a, b) => a + b, 0);

      // Build per-day breakdown
      const breakdown: Record<string, number> = {};
      datesToFetch.forEach((d, i) => {
        breakdown[d] = Math.round(totals[i] * 1000) / 1000;
      });

      // Don't cache lat/lon responses — IEM data can update throughout the day
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

      return res.status(200).json({
        mode: 'iem',
        location: { lat: latNum, lon: lonNum },
        period: {
          start: datesToFetch[0],
          end: datesToFetch[datesToFetch.length - 1],
          days: datesToFetch.length,
        },
        rainfall: Math.round(totalInches * 1000) / 1000,
        breakdown,
        units: 'inches',
        source: 'IEM Stage IV',
      });
    }

    // -----------------------------------------------------------------------
    // MODE B: field_id  →  Supabase RPC
    // -----------------------------------------------------------------------
    if (field_id) {
      if (!date && !start_date) {
        return res.status(400).json({
          error: 'Missing required parameters',
          detail: 'When using field_id, provide date or start_date.',
        });
      }

      const p_start_date = start_date || date;
      const p_end_date = end_date || date || start_date;

      const { data, error } = await supabase.rpc('get_rainfall_stats', {
        p_field_id: field_id,
        p_start_date,
        p_end_date,
      });

      if (error) {
        console.error('Supabase RPC error:', error);
        return res.status(500).json({ error: error.message });
      }

      res.setHeader('Cache-Control', 's-maxage=0, no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const rainfall = (data && data.length > 0) ? data[0].total_inches : 0;
      return res.status(200).json({ rainfall });
    }

    // -----------------------------------------------------------------------
    // Neither lat/lon nor field_id provided
    // -----------------------------------------------------------------------
    return res.status(400).json({
      error: 'Missing required parameters',
      detail: 'Provide lat & lon for coordinate-based lookup, or field_id for database lookup.',
      examples: [
        '/rain?lat=38.4626783&lon=-93.5373719',
        '/rain?lat=38.4626783&lon=-93.5373719&days=7',
        '/rain?field_id=<uuid>&date=2026-03-27',
      ],
    });

  } catch (err: any) {
    console.error('Rain API error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      detail: err.message || 'Unknown error',
    });
  }
}
