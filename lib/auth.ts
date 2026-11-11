import type { SupabaseClient } from '@supabase/supabase-js';

// Rain API access gate for the AcreLedger free tier.
//
//   RAIN_API_AUTH=off      (default) no check; today's behavior, old app builds keep working.
//   RAIN_API_AUTH=log      run the check, log would-be denials as JSON, serve the request anyway.
//   RAIN_API_AUTH=enforce  apply the decision. Fail closed: a Supabase or lookup failure is a 503,
//                          never a served rainfall total.
//
// Enforce requires a Supabase bearer token, a field_id that belongs to the caller's farm and is not
// soft-deleted, request coordinates within FIELD_MATCH_RADIUS_KM of the field's stored lat/lng
// (or the stored point when the request has none), and rainfall_field_hourly_allowed(p_field_id).
// Do not log tokens or secrets. The handler logs only the denial reason.

export type RainAuthMode = 'off' | 'log' | 'enforce';

export type RainAuthDecision =
  | { allow: true; reason?: string; fieldLat?: number; fieldLng?: number }
  | { allow: false; status: 400 | 401 | 403 | 503; error: string; reason: string };

export const FIELD_MATCH_RADIUS_KM = 10;

const EARTH_RADIUS_KM = 6371;
// One meter of slack so a point on the 10 km circle is not rejected by floating-point error.
const FIELD_MATCH_EPSILON_KM = 0.001;
const UNAVAILABLE_ERROR = 'Rainfall access check unavailable';

interface FieldAccessRow {
  id?: string;
  farm_id?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  deleted_at?: string | null;
}

export function readRainAuthMode(raw: string | undefined = process.env.RAIN_API_AUTH): RainAuthMode {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'log' || value === 'enforce' ? value : 'off';
}

export function readBearerToken(header: unknown): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  return match ? match[1] : null;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(Math.max(0, a)), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_KM * c;
}

function deny(
  status: 400 | 401 | 403 | 503,
  error: string,
  reason: string
): RainAuthDecision {
  return { allow: false, status, error, reason };
}

function unavailable(reason: string): RainAuthDecision {
  return deny(503, UNAVAILABLE_ERROR, reason);
}

function isDefinitiveAuthRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

function readStoredCoordinate(value: unknown, kind: 'lat' | 'lng'): number | null {
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return null;
  if (kind === 'lat' && (parsed < -90 || parsed > 90)) return null;
  if (kind === 'lng' && (parsed < -180 || parsed > 180)) return null;
  return parsed;
}

export async function decideRainAccess(args: {
  supabase: SupabaseClient | null;
  authorization: unknown;
  fieldId?: string;
  lat?: number;
  lon?: number;
}): Promise<RainAuthDecision> {
  const { supabase, authorization, fieldId, lat, lon } = args;

  if (!supabase) return unavailable('auth_unavailable');

  const token = readBearerToken(authorization);
  if (!token) return deny(401, 'Sign in required', 'no_token');

  let userId: string;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) {
      if (error && !isDefinitiveAuthRejection(error)) return unavailable('auth_unavailable');
      return deny(401, 'Sign in required', 'invalid_token');
    }
    userId = data.user.id;
  } catch {
    return unavailable('auth_unavailable');
  }

  if (!fieldId) return deny(400, 'field_id required', 'field_id_required');

  try {
    // Independent lookups: run together to conserve the 10s serverless budget.
    const [profile, field] = await Promise.all([
      supabase.from('profiles').select('farm_id').eq('id', userId).maybeSingle(),
      supabase
        .from('fields')
        .select('id, farm_id, lat, lng, deleted_at')
        .eq('id', fieldId)
        .maybeSingle(),
    ]);
    if (profile.error || field.error) return unavailable('lookup_failed');

    const farmId = (profile.data as { farm_id?: string | null } | null)?.farm_id ?? null;
    const fieldRow = (field.data as FieldAccessRow | null) ?? null;
    const fieldFarmId = fieldRow?.farm_id ?? null;
    // Same public error for a missing field, a wrong farm, and a soft-deleted field.
    // Farm is checked first so a deleted field on another farm is not labeled as deleted in the log.
    if (!fieldRow || !farmId || !fieldFarmId || farmId !== fieldFarmId) {
      return deny(403, 'Field not found for this farm', 'wrong_farm');
    }
    if (fieldRow.deleted_at != null) {
      return deny(403, 'Field not found for this farm', 'field_deleted');
    }

    const fieldLat = readStoredCoordinate(fieldRow.lat, 'lat');
    const fieldLng = readStoredCoordinate(fieldRow.lng, 'lng');
    if (fieldLat === null || fieldLng === null) {
      return deny(403, 'Coordinates do not match this field', 'coords_missing');
    }

    const hasRequestPoint =
      lat !== undefined && lon !== undefined && Number.isFinite(lat) && Number.isFinite(lon);
    if (hasRequestPoint && haversineKm(lat, lon, fieldLat, fieldLng) > FIELD_MATCH_RADIUS_KM + FIELD_MATCH_EPSILON_KM) {
      return deny(403, 'Coordinates do not match this field', 'coords_too_far');
    }

    const allowed = await supabase.rpc('rainfall_field_hourly_allowed', { p_field_id: fieldId });
    if (allowed.error) return unavailable('lookup_failed');
    if (allowed.data !== true) {
      return deny(403, 'premium_required:rainfall', 'premium_required');
    }

    return { allow: true, fieldLat, fieldLng };
  } catch {
    return unavailable('lookup_failed');
  }
}
