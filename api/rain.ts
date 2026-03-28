import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// SUPABASE_URL and SUPABASE_ANON_KEY must be set in Vercel environment variables
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return;
  }

  // Set default CORS header for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { field_id, date, start_date, end_date } = req.query as { 
      field_id: string; 
      date?: string; 
      start_date?: string; 
      end_date?: string; 
    };

    if (!field_id || (!date && !start_date)) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        detail: 'field_id and either date or start_date query parameters are required.' 
      });
    }

    const p_start_date = start_date || date;
    const p_end_date = end_date || date || start_date;

    // The RPC get_rainfall_stats(uuid, date, date) returns a table.
    const { data, error } = await supabase
      .rpc('get_rainfall_stats', { 
        p_field_id: field_id, 
        p_start_date: p_start_date,
        p_end_date: p_end_date
      });

    if (error) {
      console.error('Supabase RPC error:', error);
      return res.status(500).json({ error: error.message });
    }

    // Caching: 1 hour for finalized dates, 5 minutes for the current day
    const todayStr = new Date().toISOString().split('T')[0];
    const isToday = p_end_date === todayStr;
    const cacheControl = isToday 
      ? 's-maxage=300, stale-while-revalidate=60' 
      : 's-maxage=3600, stale-while-revalidate=600';

    res.setHeader('Cache-Control', cacheControl);

    // The RPC returns a table, so data is an array of rows.
    // We want total_inches from the first row.
    const rainfall = (data && data.length > 0) ? data[0].total_inches : 0;

    return res.status(200).json({ rainfall });

  } catch (err: any) {
    console.error('Rain API error:', err);
    return res.status(500).json({ 
      error: 'Internal server error', 
      detail: err.message || 'Unknown error' 
    });
  }
}
