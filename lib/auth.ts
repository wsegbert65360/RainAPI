import type { SupabaseClient } from '@supabase/supabase-js';

// Rain API access gate for the AcreLedger free tier.
//
//   RAIN_API_AUTH=off      (default) no check; today's behavior, old app builds keep working.
//   RAIN_API_AUTH=log      run the check, log would-be denials as JSON, serve the request anyway.
//   RAIN_API_AUTH=enforce  refuse unauthenticated callers (401) and fields the farm may not have
//                          hourly rainfall for (403 premium_required:rainfall).
//
// Field requests are decided by the database function rainfall_field_hourly_allowed (the same rule the
// collectors use: free plan + enforce mode => not allowed). Coordinate-only requests cannot be tied to a
// farm plan, so they only need a valid login. Infrastructure errors fail open (logged) so a Supabase
// hiccup never turns off rainfall for paying farms.

export type RainAuthMode = 'off' | 'log' | 'enforce';

export type RainAuthDecision =
  | { allow: true; reason?: string }
  | { allow: false; status: 401 | 403; error: string; reason: string };

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

export async function decideRainAccess(args: {
  supabase: SupabaseClient | null;
  authorization: unknown;
  fieldId?: string;
}): Promise<RainAuthDecision> {
  const { supabase, authorization, fieldId } = args;
  if (!supabase) return { allow: true, reason: 'auth_unavailable' };

  const token = readBearerToken(authorization);
  if (!token) return { allow: false, status: 401, error: 'Sign in required', reason: 'no_token' };

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      // A rejected token is definitive; a transport failure is not.
      const status = (error as { status?: number } | null)?.status;
      if (status && status >= 500) return { allow: true, reason: 'auth_unavailable' };
      return { allow: false, status: 401, error: 'Sign in required', reason: 'invalid_token' };
    }
    if (!fieldId) return { allow: true };

    // Independent lookups: run together to conserve the 10s serverless budget.
    const [profile, field] = await Promise.all([
      supabase.from('profiles').select('farm_id').eq('id', data.user.id).maybeSingle(),
      supabase.from('fields').select('farm_id').eq('id', fieldId).maybeSingle(),
    ]);
    if (profile.error || field.error) return { allow: true, reason: 'lookup_failed' };

    const farmId = (profile.data as { farm_id?: string | null } | null)?.farm_id;
    const fieldFarmId = (field.data as { farm_id?: string | null } | null)?.farm_id;
    if (!farmId || !fieldFarmId || farmId !== fieldFarmId) {
      return { allow: false, status: 403, error: 'Field not found for this farm', reason: 'wrong_farm' };
    }

    const allowed = await supabase.rpc('rainfall_field_hourly_allowed', { p_field_id: fieldId });
    if (allowed.error) return { allow: true, reason: 'lookup_failed' };
    if (allowed.data !== true) {
      return { allow: false, status: 403, error: 'premium_required:rainfall', reason: 'premium_required' };
    }
    return { allow: true };
  } catch {
    return { allow: true, reason: 'auth_unavailable' };
  }
}
