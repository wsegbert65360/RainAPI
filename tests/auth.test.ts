import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler, { __test_resetSupabase, __test_setSupabase } from '../api/rain';
import { __test_resetIemMocks, __test_setIemMocks } from '../lib/iem';
import { decideRainAccess, haversineKm, readBearerToken, readRainAuthMode } from '../lib/auth';
import { generateHourKeys } from '../lib/time';

const FIELD = '11111111-1111-4111-8111-111111111111';
const FIELD_LAT = 38.46;
const FIELD_LNG = -93.53;

interface Fake {
  user?: { id: string } | null;
  userError?: { status?: number } | null;
  profileFarm?: string | null;
  profileError?: boolean;
  fieldFarm?: string | null;
  fieldLat?: number | null;
  fieldLng?: number | null;
  deletedAt?: string | null;
  fieldMissing?: boolean;
  fieldError?: boolean;
  allowed?: boolean | null;
  rpcError?: boolean;
  throwOnAuth?: boolean;
  throwOnLookup?: boolean;
}

function fakeSupabase(f: Fake) {
  const selects: string[] = [];
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  let seenToken: string | undefined;
  const client = {
    selects,
    rpcCalls,
    get seenToken() {
      return seenToken;
    },
    auth: {
      getUser: async (token: string) => {
        seenToken = token;
        if (f.throwOnAuth) throw new Error('network');
        return { data: { user: f.user === undefined ? { id: 'u1' } : f.user }, error: f.userError ?? null };
      },
    },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: () => ({
          maybeSingle: async () => {
            selects.push(`${table}:${columns}`);
            if (f.throwOnLookup) throw new Error('lookup down');
            if (table === 'profiles') {
              if (f.profileError) return { data: null, error: { message: 'profile down' } };
              return {
                data: { farm_id: f.profileFarm === undefined ? 'farm-a' : f.profileFarm },
                error: null,
              };
            }
            if (f.fieldError) return { data: null, error: { message: 'field down' } };
            if (f.fieldMissing) return { data: null, error: null };
            return {
              data: {
                id: FIELD,
                farm_id: f.fieldFarm === undefined ? 'farm-a' : f.fieldFarm,
                lat: f.fieldLat === undefined ? FIELD_LAT : f.fieldLat,
                lng: f.fieldLng === undefined ? FIELD_LNG : f.fieldLng,
                deleted_at: f.deletedAt ?? null,
              },
              error: null,
            };
          },
        }),
      }),
    }),
    rpc: async (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      if (name === 'rainfall_field_hourly_allowed') {
        return f.rpcError ? { data: null, error: { message: 'rpc down' } } : { data: f.allowed ?? true, error: null };
      }
      return { data: [{ total_inches: 0.4 }], error: null };
    },
  };
  return client;
}

const decide = (
  f: Fake,
  authorization: unknown = 'Bearer tok',
  fieldId: string | undefined = FIELD,
  point: { lat?: number; lon?: number } = { lat: FIELD_LAT, lon: FIELD_LNG }
) => decideRainAccess({
  supabase: fakeSupabase(f) as never,
  authorization,
  fieldId,
  lat: point.lat,
  lon: point.lon,
});

function northOf(lat: number, lon: number, km: number): number {
  const perDegree = haversineKm(lat, lon, lat + 1, lon);
  return lat + km / perDegree;
}

describe('rain auth helpers', () => {
  it('parses mode and bearer token', () => {
    assert.equal(readRainAuthMode(undefined), 'off');
    assert.equal(readRainAuthMode(''), 'off');
    assert.equal(readRainAuthMode('garbage'), 'off');
    assert.equal(readRainAuthMode('off'), 'off');
    assert.equal(readRainAuthMode(' Enforce '), 'enforce');
    assert.equal(readRainAuthMode('log'), 'log');
    assert.equal(readBearerToken('Bearer abc'), 'abc');
    assert.equal(readBearerToken('bearer abc'), 'abc');
    assert.equal(readBearerToken(['Bearer abc']), 'abc');
    assert.equal(readBearerToken('abc'), null);
    assert.equal(readBearerToken('Bearer'), null);
    assert.equal(readBearerToken(undefined), null);
  });

  it('denies a missing or rejected token', async () => {
    assert.deepEqual(await decide({}, null), {
      allow: false,
      status: 401,
      error: 'Sign in required',
      reason: 'no_token',
    });
    const rejected = await decide({ user: null, userError: { status: 401 } });
    assert.equal(rejected.allow, false);
    assert.equal(!rejected.allow && rejected.status, 401);
    assert.equal(!rejected.allow && rejected.reason, 'invalid_token');
  });

  it('requires field_id after a valid login', async () => {
    const missing = await decideRainAccess({
      supabase: fakeSupabase({}) as never,
      authorization: 'Bearer tok',
      lat: FIELD_LAT,
      lon: FIELD_LNG,
    });
    assert.deepEqual(missing, {
      allow: false,
      status: 400,
      error: 'field_id required',
      reason: 'field_id_required',
    });
  });

  it('allows a paid field inside 10 km and denies a free farm field', async () => {
    const client = fakeSupabase({ allowed: true });
    const allowed = await decideRainAccess({
      supabase: client as never,
      authorization: 'Bearer tok',
      fieldId: FIELD,
      lat: FIELD_LAT,
      lon: FIELD_LNG,
    });
    assert.deepEqual(allowed, { allow: true, fieldLat: FIELD_LAT, fieldLng: FIELD_LNG });
    assert.equal(client.seenToken, 'tok');
    assert.ok(client.selects.includes('fields:id, farm_id, lat, lng, deleted_at'));
    assert.deepEqual(
      client.rpcCalls.find((call) => call.name === 'rainfall_field_hourly_allowed'),
      { name: 'rainfall_field_hourly_allowed', args: { p_field_id: FIELD } }
    );

    const denied = await decide({ allowed: false });
    assert.equal(denied.allow, false);
    assert.equal(!denied.allow && denied.status, 403);
    assert.equal(!denied.allow && denied.error, 'premium_required:rainfall');
  });

  it('denies a field that belongs to another farm, is missing, or is soft-deleted', async () => {
    const otherFarm = await decide({ profileFarm: 'farm-a', fieldFarm: 'farm-b' });
    assert.equal(!otherFarm.allow && otherFarm.status, 403);
    assert.equal(!otherFarm.allow && otherFarm.error, 'Field not found for this farm');
    assert.equal(!otherFarm.allow && otherFarm.reason, 'wrong_farm');

    const missing = await decide({ fieldMissing: true });
    assert.equal(!missing.allow && missing.error, 'Field not found for this farm');

    const deleted = await decide({ deletedAt: '2026-01-01T00:00:00Z' });
    assert.equal(!deleted.allow && deleted.status, 403);
    assert.equal(!deleted.allow && deleted.error, 'Field not found for this farm');
    assert.equal(!deleted.allow && deleted.reason, 'field_deleted');
  });

  it('compares the request point with the stored field lat/lng', async () => {
    const near = await decide({}, 'Bearer tok', FIELD, { lat: northOf(FIELD_LAT, FIELD_LNG, 10), lon: FIELD_LNG });
    assert.equal(near.allow, true);

    const far = await decide({}, 'Bearer tok', FIELD, { lat: northOf(FIELD_LAT, FIELD_LNG, 10.2), lon: FIELD_LNG });
    assert.equal(far.allow, false);
    assert.equal(!far.allow && far.status, 403);
    assert.equal(!far.allow && far.error, 'Coordinates do not match this field');
    assert.equal(!far.allow && far.reason, 'coords_too_far');

    const noStored = await decide({ fieldLat: null, fieldLng: null }, 'Bearer tok', FIELD, {});
    assert.equal(!noStored.allow && noStored.error, 'Coordinates do not match this field');
    assert.equal(!noStored.allow && noStored.reason, 'coords_missing');
  });

  it('returns the stored point when the request has no coordinates', async () => {
    const decision = await decide({}, 'Bearer tok', FIELD, {});
    assert.deepEqual(decision, { allow: true, fieldLat: FIELD_LAT, fieldLng: FIELD_LNG });
  });

  it('fails closed on infrastructure errors', async () => {
    assert.deepEqual(await decide({ throwOnAuth: true }), {
      allow: false,
      status: 503,
      error: 'Rainfall access check unavailable',
      reason: 'auth_unavailable',
    });
    const serverError = await decide({ userError: { status: 503 }, user: null });
    assert.equal(serverError.allow, false);
    assert.equal(!serverError.allow && serverError.status, 503);

    const transport = await decide({ userError: {}, user: null });
    assert.equal(!transport.allow && transport.status, 503);

    assert.equal((await decide({ rpcError: true })).allow, false);
    assert.equal((await decide({ profileError: true })).allow, false);
    assert.equal((await decide({ fieldError: true })).allow, false);
    assert.equal((await decide({ throwOnLookup: true })).allow, false);

    const unconfigured = await decideRainAccess({
      supabase: null,
      authorization: 'Bearer tok',
      fieldId: FIELD,
      lat: FIELD_LAT,
      lon: FIELD_LNG,
    });
    assert.equal(unconfigured.allow, false);
    assert.equal(!unconfigured.allow && unconfigured.status, 503);
    assert.equal(!unconfigured.allow && unconfigured.error, 'Rainfall access check unavailable');
  });
});

function mockRes() {
  let statusCode = 200;
  let body: unknown;
  const res = {
    setHeader() {},
    status(code: number) { statusCode = code; return res; },
    json(payload: unknown) { body = payload; return res; },
    end() { return res; },
  } as unknown as VercelResponse;
  return { res, get status() { return statusCode; }, get json() { return body as Record<string, unknown>; } };
}

function req(
  query: Record<string, string> = {},
  authorization?: string,
  body?: Record<string, unknown>
): VercelRequest {
  return {
    method: body ? 'POST' : 'GET',
    query,
    body,
    headers: authorization ? { authorization } : {},
  } as unknown as VercelRequest;
}

const TOKEN = 'Bearer super-secret-token';

function captureWarn() {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  };
  return {
    lines,
    restore() {
      console.warn = original;
    },
    denials() {
      return lines
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is Record<string, unknown> => entry?.event === 'rain_auth_denied');
    },
  };
}

describe('rain handler auth modes', () => {
  beforeEach(() => {
    __test_resetIemMocks();
    const { keys } = generateHourKeys('2026-03-17T14:37:00Z', 'UTC', 169);
    const map = new Map<string, number>(keys.map((key) => [key, 0.1]));
    const dates = [...new Set(keys.map((key) => key.split(' ')[0]))].sort();
    __test_setIemMocks({
      fetchIemMultipleDays: async () => ({
        hourMap: map,
        requestedDates: dates,
        successfulDates: dates,
        failedDates: [],
        hasUsableData: true,
      }),
      fetchIemCustomRange: async () => ({
        total: 1.25,
        radarStartDate: '2026-03-01',
        radarEndDate: '2026-03-17',
        requestedStartDate: '2026-03-01',
        requestedEndDate: '2026-03-17',
        partialCoverage: false,
        hasUsableData: true,
        requestedDates: ['2026-03-01', '2026-03-17'],
        successfulDates: ['2026-03-01', '2026-03-17'],
        failedDates: [],
      }),
    } as never);
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  afterEach(() => {
    __test_resetIemMocks();
    __test_resetSupabase();
    delete process.env.RAIN_API_AUTH;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('off: serves a coordinate-only request and does not run the gate', async () => {
    let authCalls = 0;
    __test_setSupabase({
      auth: {
        getUser: async () => {
          authCalls += 1;
          throw new Error('should not be called');
        },
      },
      from() {
        throw new Error('should not be called');
      },
      rpc: async () => {
        throw new Error('should not be called');
      },
    } as never);
    const warn = captureWarn();
    try {
      const m = mockRes();
      await handler(req({ lat: '38.46', lon: '-93.53', asOf: '2026-03-17T14:37:00Z' }), m.res);
      assert.equal(m.status, 200);
      assert.equal(authCalls, 0);
      assert.equal(warn.denials().length, 0);
    } finally {
      warn.restore();
    }
  });

  it('log: serves a would-be denial and logs it without the token', async () => {
    process.env.RAIN_API_AUTH = 'log';
    __test_setSupabase(fakeSupabase({ allowed: false }) as never);
    const warn = captureWarn();
    try {
      const m = mockRes();
      await handler(
        req({ lat: '38.46', lon: '-93.53', field_id: FIELD, asOf: '2026-03-17T14:37:00Z' }, TOKEN),
        m.res
      );
      assert.equal(m.status, 200);
      assert.equal(typeof (m.json.rain as Record<string, number>)['24h'], 'number');
      const denial = warn.denials()[0];
      assert.equal(denial?.mode, 'log');
      assert.equal(denial?.reason, 'premium_required');
      assert.equal(denial?.status, 403);
      assert.equal(JSON.stringify(warn.lines).includes('super-secret-token'), false);
      assert.equal(JSON.stringify(warn.lines).includes('service-role-key'), false);
    } finally {
      warn.restore();
    }
  });

  it('enforce: 401 without a token', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    __test_setSupabase(fakeSupabase({ allowed: true }) as never);
    const m = mockRes();
    await handler(
      req({ lat: '38.46', lon: '-93.53', field_id: FIELD, asOf: '2026-03-17T14:37:00Z' }),
      m.res
    );
    assert.equal(m.status, 401);
    assert.deepEqual(m.json, { error: 'Sign in required' });
  });

  it('enforce: 400 for coordinate-only and polygon-only requests', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    __test_setSupabase(fakeSupabase({ allowed: true }) as never);
    let m = mockRes();
    await handler(req({ lat: '38.46', lon: '-93.53', asOf: '2026-03-17T14:37:00Z' }, TOKEN), m.res);
    assert.equal(m.status, 400);
    assert.deepEqual(m.json, { error: 'field_id required' });

    m = mockRes();
    await handler(
      req({}, TOKEN, {
        polygon: [[-93.54, 38.45], [-93.52, 38.45], [-93.52, 38.47], [-93.54, 38.47], [-93.54, 38.45]],
      }),
      m.res
    );
    assert.equal(m.status, 400);
    assert.deepEqual(m.json, { error: 'field_id required' });
  });

  it('enforce: 403 for another farm, a soft-deleted field, and coordinates beyond 10 km', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    const point = { lat: '38.46', lon: '-93.53', field_id: FIELD, asOf: '2026-03-17T14:37:00Z' };

    __test_setSupabase(fakeSupabase({ fieldFarm: 'farm-b' }) as never);
    let m = mockRes();
    await handler(req(point, TOKEN), m.res);
    assert.equal(m.status, 403);
    assert.equal(m.json.error, 'Field not found for this farm');

    __test_setSupabase(fakeSupabase({ deletedAt: '2026-04-01T00:00:00Z' }) as never);
    m = mockRes();
    await handler(req(point, TOKEN), m.res);
    assert.equal(m.status, 403);
    assert.equal(m.json.error, 'Field not found for this farm');

    __test_setSupabase(fakeSupabase({ fieldLat: 41.5, fieldLng: -93.53 }) as never);
    m = mockRes();
    await handler(req(point, TOKEN), m.res);
    assert.equal(m.status, 403);
    assert.equal(m.json.error, 'Coordinates do not match this field');
    assert.equal(m.json.rain, undefined);
  });

  it('enforce: 403 for a free farm and 200 for Pro', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    const point = { lat: '38.46', lon: '-93.53', field_id: FIELD, asOf: '2026-03-17T14:37:00Z' };

    __test_setSupabase(fakeSupabase({ allowed: false }) as never);
    let m = mockRes();
    await handler(req(point, TOKEN), m.res);
    assert.equal(m.status, 403);
    assert.deepEqual(m.json, { error: 'premium_required:rainfall' });

    __test_setSupabase(fakeSupabase({ allowed: true }) as never);
    m = mockRes();
    await handler(req(point, TOKEN), m.res);
    assert.equal(m.status, 200);
    assert.equal(typeof (m.json.rain as Record<string, number>)['24h'], 'number');
  });

  it('enforce: 503 when Supabase is missing or the plan RPC fails', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    __test_resetSupabase();
    let m = mockRes();
    await handler(
      req({ lat: '38.46', lon: '-93.53', field_id: FIELD, asOf: '2026-03-17T14:37:00Z' }, TOKEN),
      m.res
    );
    assert.equal(m.status, 503);
    assert.deepEqual(m.json, { error: 'Rainfall access check unavailable' });

    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    __test_setSupabase(fakeSupabase({ rpcError: true }) as never);
    m = mockRes();
    await handler(
      req({ lat: '38.46', lon: '-93.53', field_id: FIELD, asOf: '2026-03-17T14:37:00Z' }, TOKEN),
      m.res
    );
    assert.equal(m.status, 503);
    assert.equal(m.json.error, 'Rainfall access check unavailable');
    assert.equal(m.json.rain, undefined);
  });

  it('enforce: uses stored field coordinates for a custom range with no request point', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    let seen: { lat?: number; lon?: number } = {};
    __test_setIemMocks({
      fetchIemCustomRange: async (lat: number, lon: number) => {
        seen = { lat, lon };
        return {
          total: 1.25,
          radarStartDate: '2026-03-01',
          radarEndDate: '2026-03-17',
          requestedStartDate: '2026-03-01',
          requestedEndDate: '2026-03-17',
          partialCoverage: false,
          hasUsableData: true,
          requestedDates: ['2026-03-01', '2026-03-17'],
          successfulDates: ['2026-03-01', '2026-03-17'],
          failedDates: [],
        };
      },
    } as never);
    __test_setSupabase(fakeSupabase({ allowed: true }) as never);
    const m = mockRes();
    await handler(
      req({ field_id: FIELD, start_date: '2026-03-01', end_date: '2026-03-17' }, TOKEN),
      m.res
    );
    assert.equal(m.status, 200);
    assert.equal(seen.lat, FIELD_LAT);
    assert.equal(seen.lon, FIELD_LNG);
    assert.equal((m.json.rain as { total: number }).total, 1.25);
  });
});
