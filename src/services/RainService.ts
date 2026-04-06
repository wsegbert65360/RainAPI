// =============================================================================
// AcreLedger — Rainfall Service
// =============================================================================
// Fetches rainfall data DIRECTLY from AcreLedger Supabase via the
// `get_rainfall_stats` RPC. Supabase is the sole authoritative source.
// No external API endpoints are called.
// =============================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { RainfallStats, RainfallRecord } from '../types/farm';
import { mapDbToRainfallStats, mapDbToRainfallRecord } from '../lib/mappers';

// -----------------------------------------------------------------------------
// Client Singleton
// -----------------------------------------------------------------------------

let _supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        'RainService: SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required.'
      );
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export interface GetRainfallStatsParams {
  /** UUID of the field */
  fieldId: string;
  /** Start date in YYYY-MM-DD format */
  startDate: string;
  /** End date in YYYY-MM-DD format */
  endDate: string;
}

export interface GetRainfallHistoryParams {
  /** UUID of the field */
  fieldId: string;
  /** Start date in YYYY-MM-DD format */
  startDate: string;
  /** End date in YYYY-MM-DD format */
  endDate: string;
  /** Maximum number of records to return (default: 1000) */
  limit?: number;
}

/**
 * Fetch aggregated rainfall statistics for a field over a date range.
 *
 * This calls the Supabase RPC `get_rainfall_stats` directly — no
 * intermediate Vercel API is involved.
 *
 * @param params - fieldId, startDate, endDate
 * @returns Aggregated RainfallStats for the requested period
 * @throws Error if the Supabase RPC call fails
 */
export async function getRainfallStats(
  params: GetRainfallStatsParams
): Promise<RainfallStats> {
  const { fieldId, startDate, endDate } = params;
  const client = getSupabaseClient();

  const { data, error } = await client.rpc('get_rainfall_stats', {
    p_field_id: fieldId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    // DO NOT log the error to console if it contains sensitive info.
    // Only log the error message, not the full error object which may
    // contain connection details or API keys.
    console.error('RainService: RPC call failed:', error.message);
    throw new Error(`Failed to fetch rainfall stats: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return {
      fieldId,
      totalInches: 0,
      startDate,
      endDate,
      dataPoints: 0,
      hasGaps: false,
    };
  }

  return mapDbToRainfallStats(data[0]);
}

/**
 * Fetch hourly rainfall history for a field over a date range.
 *
 * Queries the `field_rainfall_hourly` table directly in Supabase.
 * This is the authoritative data source — no external API calls.
 *
 * @param params - fieldId, startDate, endDate, optional limit
 * @returns Array of RainfallRecord objects ordered by date and hour
 */
export async function getRainfallHistory(
  params: GetRainfallHistoryParams
): Promise<RainfallRecord[]> {
  const { fieldId, startDate, endDate, limit = 1000 } = params;
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('field_rainfall_hourly')
    .select('*')
    .eq('field_id', fieldId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })
    .order('hour', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('RainService: History query failed:', error.message);
    throw new Error(`Failed to fetch rainfall history: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  return data.map(mapDbToRainfallRecord);
}

/**
 * Get the most recent rainfall total for a field (last 7 days by default).
 * Convenience wrapper around getRainfallStats.
 *
 * @param fieldId - UUID of the field
 * @param days - Number of days to look back (default: 7)
 * @returns RainfallStats for the requested lookback period
 */
export async function getRecentRainfall(
  fieldId: string,
  days: number = 7
): Promise<RainfallStats> {
  const endDate = new Date().toISOString().split('T')[0];
  const start = new Date();
  start.setDate(start.getDate() - days + 1);
  const startDate = start.toISOString().split('T')[0];

  return getRainfallStats({ fieldId, startDate, endDate });
}
