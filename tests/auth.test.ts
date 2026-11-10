import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler, { __test_resetSupabase, __test_setSupabase } from '../api/rain';
import { __test_resetIemMocks, __test_setIemMocks } from '../lib/iem';
import { decideRainAccess, readBearerToken, readRainAuthMode } from '../lib/auth';
import { generateHourKeys } from '../lib/time';

const FIELD = '11111111-1111-4111-8111-111111111111';

interface Fake {
  user?: { id: string } | null;
  userError?: { status?: number } | null;
  profileFarm?: string | null;
  fieldFarm?: string | null;
  allowed?: boolean | null;
  rpcError?: boolean;
  throwOnAuth?: boolean;
}

function fakeSupabase(f: Fake) {
  const row = (data: unknown) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) });
  return {
    auth: {
      getUser: async () => {
        if (f.throwOnAuth) throw new Error('network');
        return { data: { user: f.user === undefined ? { id: 'u1' } : f.user }, error: f.userError ?? null };
      },
    },
    from: (table: string) => row(table === 'profiles' ? { farm_id: f.profileFarm ?? 'farm-a' } : { farm_id: f.fieldFarm ?? 'farm-a' }),
    rpc: async (name: string) => {
      if (name === 'rainfall_field_hourly_allowed') {
        return f.rpcError ? { data: null, error: { message: 'x' } } : { data: f.allowed ?? true, error: null };
      }
      return { data: [{ total_inches: 0 }], error: null };
    },
  };
}

const decide = (f: Fake, authorization: unknown = 'Bearer tok', fieldId: string | undefined = FIELD) =>
  decideRainAccess({ supabase: fakeSupabase(f) as never, authorization, fieldId });

describe('rain auth helpers', () => {
  it('parses mode and bearer token', () => {
    assert.equal(readRainAuthMode(undefined), 'off');
    assert.equal(readRainAuthMode('garbage'), 'off');
    assert.equal(readRainAuthMode(' Enforce '), 'enforce');
    assert.equal(readRainAuthMode('log'), 'log');
    assert.equal(readBearerToken('Bearer abc'), 'abc');
    assert.equal(readBearerToken('bearer abc'), 'abc');
    assert.equal(readBearerToken('abc'), null);
    assert.equal(readBearerToken(undefined), null);
  });

  it('denies a missing or rejected token', async () => {
    assert.deepEqual(await decide({}, null), { allow: false, status: 401, error: 'Sign in required', reason: 'no_token' });
    const rejected = await decide({ user: null, userError: { status: 401 } });
    assert.equal(rejected.allow, false);
  });

  it('allows a paid/permitted field and denies a free farm field', async () => {
    assert.deepEqual(await decide({ allowed: true }), { allow: true });
    const denied = await decide({ allowed: false });
    assert.equal(denied.allow, false);
    assert.equal(!denied.allow && denied.status, 403);
    assert.equal(!denied.allow && denied.error, 'premium_required:rainfall');
  });

  it('denies a field that belongs to another farm', async () => {
    const d = await decide({ profileFarm: 'farm-a', fieldFarm: 'farm-b' });
    assert.equal(!d.allow && d.reason, 'wrong_farm');
  });

  it('coordinate-only requests need only a valid login', async () => {
    assert.deepEqual(await decide({}, 'Bearer tok', undefined), { allow: true });
  });

  it('fails open on infrastructure errors', async () => {
    assert.equal((await decide({ throwOnAuth: true })).allow, true);
    assert.equal((await decide({ userError: { status: 503 }, user: null })).allow, true);
    assert.equal((await decide({ rpcError: true })).allow, true);
    assert.equal((await decideRainAccess({ supabase: null, authorization: undefined, fieldId: FIELD })).allow, true);
  });
});

function mockRes() {
  let statusCode = 200;
  let body: unknown;
  const res = {
    setHeader() {},
    status(c: number) { statusCode = c; return res; },
    json(p: unknown) { body = p; return res; },
    end() { return res; },
  } as unknown as VercelResponse;
  return { res, get status() { return statusCode; }, get json() { return body as Record<string, unknown>; } };
}

function req(authorization?: string): VercelRequest {
  return {
    method: 'GET',
    query: { lat: '38.46', lon: '-93.53', field_id: FIELD, asOf: '2026-03-17T14:37:00Z' },
    headers: authorization ? { authorization } : {},
  } as unknown as VercelRequest;
}

describe('rain handler auth modes', () => {
  beforeEach(() => {
    __test_resetIemMocks();
    const { keys } = generateHourKeys('2026-03-17T14:37:00Z', 'UTC', 169);
    const map = new Map<string, number>(keys.map(k => [k, 0.1]));
    const dates = [...new Set(keys.map(k => k.split(' ')[0]))].sort();
    __test_setIemMocks({ fetchIemMultipleDays: async () => ({ hourMap: map, requestedDates: dates, successfulDates: dates, failedDates: [], hasUsableData: true }) as never } as never);
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

  it('off: serves with no token', async () => {
    __test_setSupabase(fakeSupabase({ allowed: false }) as never);
    const m = mockRes();
    await handler(req(), m.res);
    assert.equal(m.status, 200);
  });

  it('log: serves even when it would deny', async () => {
    process.env.RAIN_API_AUTH = 'log';
    __test_setSupabase(fakeSupabase({ allowed: false }) as never);
    const m = mockRes();
    await handler(req('Bearer tok'), m.res);
    assert.equal(m.status, 200);
  });

  it('enforce: 401 without a token, 403 for a free farm, 200 when allowed', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    __test_setSupabase(fakeSupabase({ allowed: true }) as never);
    let m = mockRes();
    await handler(req(), m.res);
    assert.equal(m.status, 401);

    __test_setSupabase(fakeSupabase({ allowed: false }) as never);
    m = mockRes();
    await handler(req('Bearer tok'), m.res);
    assert.equal(m.status, 403);
    assert.equal(m.json.error, 'premium_required:rainfall');

    __test_setSupabase(fakeSupabase({ allowed: true }) as never);
    m = mockRes();
    await handler(req('Bearer tok'), m.res);
    assert.equal(m.status, 200);
  });
});
