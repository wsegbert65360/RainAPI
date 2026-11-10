import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler, { __test_resetSupabase, __test_setSupabase } from '../api/rain';
import {
  __test_resetIemMocks,
  __test_setIemMocks,
  IemFetchError,
  type CustomRangeRadarResult,
  type IemFetchResult,
} from '../lib/iem';
import { generateHourKeys } from '../lib/time';

const FIELD_ID = '11111111-1111-4111-8111-111111111111';

function createMockRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown;

  const res = {
    setHeader(key: string, value: string) {
      headers[key.toLowerCase()] = value;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
    end() {
      return res;
    },
  } as unknown as VercelResponse;

  return {
    res,
    get status() {
      return statusCode;
    },
    get json() {
      return body as Record<string, unknown>;
    },
    get headers() {
      return headers;
    },
  };
}

function createReq(
  method: string,
  query: Record<string, string | string[] | undefined> = {},
  body?: Record<string, unknown>,
  headers?: Record<string, string>
): VercelRequest {
  return {
    method,
    query,
    body,
    headers,
  } as VercelRequest;
}

function buildRadarMap(asOf = '2026-03-17T14:37:00Z'): Map<string, number> {
  const { keys } = generateHourKeys(asOf, 'UTC', 169);
  const map = new Map<string, number>();
  for (const key of keys) {
    map.set(key, 0.1);
  }
  return map;
}

function radarSuccessResult(asOf = '2026-03-17T14:37:00Z'): IemFetchResult {
  const hourMap = buildRadarMap(asOf);
  const dates = [...new Set([...hourMap.keys()].map((key) => key.split(' ')[0]))].sort();
  return {
    hourMap,
    requestedDates: dates,
    successfulDates: dates,
    failedDates: [],
    hasUsableData: true,
  };
}

function customRangeSuccessResult(): CustomRangeRadarResult {
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
}

function mockRadarSuccess() {
  __test_setIemMocks({
    fetchIemMultipleDays: async () => radarSuccessResult(),
    fetchIemCustomRange: async () => customRangeSuccessResult(),
  });
}

function mockRadarFailure() {
  __test_setIemMocks({
    fetchIemMultipleDays: async () => {
      throw new IemFetchError('radar down');
    },
    fetchIemCustomRange: async () => {
      throw new IemFetchError('radar down');
    },
  });
}

function mockEmptyRadar() {
  __test_setIemMocks({
    fetchIemMultipleDays: async () => {
      throw new IemFetchError('No usable radar observations for requested dates');
    },
    fetchIemCustomRange: async () => {
      throw new IemFetchError('No usable radar observations for requested dates');
    },
  });
}

function mockRadarWithZeros() {
  __test_setIemMocks({
    fetchIemMultipleDays: async () => {
      const { keys } = generateHourKeys('2026-03-17T14:37:00Z', 'UTC', 169);
      const hourMap = new Map<string, number>();
      keys.forEach((key) => hourMap.set(key, 0));
      const dates = [...new Set(keys.map((key) => key.split(' ')[0]))].sort();
      return {
        hourMap,
        requestedDates: dates,
        successfulDates: dates,
        failedDates: [],
        hasUsableData: true,
      };
    },
    fetchIemCustomRange: async () => customRangeSuccessResult(),
  });
}

function mockPartialRadarCoverage() {
  __test_setIemMocks({
    fetchIemMultipleDays: async () => {
      const full = radarSuccessResult();
      const failedDate = full.successfulDates[full.successfulDates.length - 1];
      return {
        ...full,
        successfulDates: full.successfulDates.slice(0, -1),
        failedDates: [failedDate],
        dataWarning: `Radar data unavailable for 1 day(s): ${failedDate}.`,
      };
    },
    fetchIemCustomRange: async () => customRangeSuccessResult(),
  });
}

function mockDbSuccess() {
  __test_setSupabase({
    rpc: async () => ({
      data: [{ total_inches: 0.75 }],
      error: null,
    }),
  } as never);
}

function mockDbFailure() {
  __test_setSupabase({
    rpc: async () => ({
      data: null,
      error: { message: 'db down' },
    }),
  } as never);
}

describe('rain handler', () => {
  beforeEach(() => {
    __test_resetIemMocks();
    __test_resetSupabase();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    mockRadarSuccess();
  });

  afterEach(() => {
    __test_resetIemMocks();
    __test_resetSupabase();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('handles valid coordinate-only request', async () => {
    const mock = createMockRes();
    await handler(createReq('GET', { lat: '38.46', lon: '-93.53', asOf: '2026-03-17T14:37:00Z' }), mock.res);
    assert.equal(mock.status, 200);
    assert.equal(typeof mock.json.rain, 'object');
    assert.equal(typeof (mock.json.rain as Record<string, number>)['24h'], 'number');
    assert.equal(typeof mock.json.rainMm, 'object');
    assert.equal(typeof mock.json.periodEndUtc, 'string');
    assert.equal(mock.json.periodEndUtc, '2026-03-17T14:00:00.000Z');
    assert.match(mock.headers['cache-control'] || '', /s-maxage=300/);
  });

  it('accepts latitude equal to zero', async () => {
    const mock = createMockRes();
    await handler(createReq('GET', { lat: '0', lon: '10' }), mock.res);
    assert.equal(mock.status, 200);
  });

  it('accepts longitude equal to zero', async () => {
    const mock = createMockRes();
    await handler(createReq('GET', { lat: '10', lon: '0' }), mock.res);
    assert.equal(mock.status, 200);
  });

  it('handles valid field UUID request', async () => {
    mockDbSuccess();
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '38.46',
        lon: '-93.53',
        field_id: FIELD_ID,
        asOf: '2026-03-17T14:37:00Z',
      }),
      mock.res
    );
    assert.equal(mock.status, 200);
    assert.equal(mock.headers['cache-control'], 'private, no-store');
    assert.equal((mock.json.sourceStatus as { database: string }).database, 'ok');
  });

  it('handles valid custom range', async () => {
    mockDbSuccess();
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '38.46',
        lon: '-93.53',
        field_id: FIELD_ID,
        start_date: '2026-03-01',
        end_date: '2026-03-17',
      }),
      mock.res
    );
    assert.equal(mock.status, 200);
    assert.equal((mock.json.rain as { total: number }).total, 1.25);
    assert.equal((mock.json.rainMm as { total: number }).total, 31.75);
  });

  it('preserves the database total when it exceeds the radar total', async () => {
    __test_setSupabase({
      rpc: async () => ({
        data: [{ total_inches: 2.5 }],
        error: null,
      }),
    } as never);
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '38.46',
        lon: '-93.53',
        field_id: FIELD_ID,
        start_date: '2026-03-01',
        end_date: '2026-03-17',
      }),
      mock.res
    );
    assert.equal(mock.status, 200);
    assert.equal((mock.json.rain as { total: number }).total, 2.5);
  });

  it('returns 400 when location is missing', async () => {
    const mock = createMockRes();
    await handler(createReq('GET', {}), mock.res);
    assert.equal(mock.status, 400);
  });

  it('returns 400 for invalid latitude', async () => {
    const mock = createMockRes();
    await handler(createReq('GET', { lat: '999', lon: '10' }), mock.res);
    assert.equal(mock.status, 400);
  });

  it('returns 400 for invalid longitude', async () => {
    const mock = createMockRes();
    await handler(createReq('GET', { lat: '10', lon: '999' }), mock.res);
    assert.equal(mock.status, 400);
  });

  it('returns 400 for invalid field UUID', async () => {
    const mock = createMockRes();
    await handler(createReq('GET', { lat: '10', lon: '10', field_id: 'weather-overview' }), mock.res);
    assert.equal(mock.status, 400);
  });

  it('returns 400 for invalid calendar date', async () => {
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '10',
        lon: '10',
        start_date: '2026-02-30',
        end_date: '2026-03-01',
      }),
      mock.res
    );
    assert.equal(mock.status, 400);
  });

  it('returns 400 when start date is after end date', async () => {
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '10',
        lon: '10',
        start_date: '2026-03-10',
        end_date: '2026-03-01',
      }),
      mock.res
    );
    assert.equal(mock.status, 400);
  });

  it('returns 400 when end_date is supplied without start_date', async () => {
    const mock = createMockRes();
    await handler(
      createReq('GET', { lat: '10', lon: '10', end_date: '2026-03-01' }),
      mock.res
    );
    assert.equal(mock.status, 400);
  });

  it('returns 400 for partially numeric coordinates', async () => {
    const mock = createMockRes();
    await handler(createReq('GET', { lat: '10abc', lon: '10' }), mock.res);
    assert.equal(mock.status, 400);
  });

  it('returns 400 for invalid asOf', async () => {
    const mock = createMockRes();
    await handler(createReq('GET', { lat: '10', lon: '10', asOf: 'not-a-date' }), mock.res);
    assert.equal(mock.status, 400);
  });

  it('returns 400 for invalid timezone', async () => {
    const mock = createMockRes();
    await handler(createReq('GET', { lat: '10', lon: '10', tz: 'Not/AZone' }), mock.res);
    assert.equal(mock.status, 400);
  });

  it('returns 405 for unsupported HTTP method', async () => {
    const mock = createMockRes();
    await handler(createReq('PUT', { lat: '10', lon: '10' }), mock.res);
    assert.equal(mock.status, 405);
    assert.equal(mock.headers.allow, 'GET, POST, OPTIONS');
  });

  it('returns 400 for invalid polygon', async () => {
    const mock = createMockRes();
    await handler(createReq('POST', {}, { polygon: [[1]] }), mock.res);
    assert.equal(mock.status, 400);
  });

  it('returns partial success when radar succeeds and database fails', async () => {
    mockDbFailure();
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '38.46',
        lon: '-93.53',
        field_id: FIELD_ID,
        asOf: '2026-03-17T14:37:00Z',
      }),
      mock.res
    );
    assert.equal(mock.status, 200);
    assert.match(String(mock.json.dataWarning), /database/i);
    assert.equal((mock.json.sourceStatus as { radar: string }).radar, 'ok');
    assert.equal((mock.json.sourceStatus as { database: string }).database, 'unavailable');
  });

  it('returns partial success when database succeeds and radar fails', async () => {
    mockRadarFailure();
    mockDbSuccess();
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '38.46',
        lon: '-93.53',
        field_id: FIELD_ID,
        asOf: '2026-03-17T14:37:00Z',
      }),
      mock.res
    );
    assert.equal(mock.status, 200);
    assert.match(String(mock.json.dataWarning), /radar/i);
    assert.equal((mock.json.sourceStatus as { database: string }).database, 'ok');
    assert.equal((mock.json.sourceStatus as { radar: string }).radar, 'unavailable');
  });

  it('returns 502 when both sources fail', async () => {
    mockRadarFailure();
    mockDbFailure();
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '38.46',
        lon: '-93.53',
        field_id: FIELD_ID,
        asOf: '2026-03-17T14:37:00Z',
      }),
      mock.res
    );
    assert.equal(mock.status, 502);
  });

  it('returns 502 for coordinate-only requests when radar has no usable data', async () => {
    mockEmptyRadar();
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '38.46',
        lon: '-93.53',
        asOf: '2026-03-17T14:37:00Z',
      }),
      mock.res
    );
    assert.equal(mock.status, 502);
    assert.equal((mock.json.sourceStatus as { radar?: string } | undefined), undefined);
  });

  it('falls back to database when radar is empty and database is available', async () => {
    mockEmptyRadar();
    mockDbSuccess();
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '38.46',
        lon: '-93.53',
        field_id: FIELD_ID,
        asOf: '2026-03-17T14:37:00Z',
      }),
      mock.res
    );
    assert.equal(mock.status, 200);
    assert.match(String(mock.json.dataWarning), /radar/i);
    assert.equal((mock.json.sourceStatus as { radar: string }).radar, 'unavailable');
    assert.equal((mock.json.sourceStatus as { database: string }).database, 'ok');
  });

  it('returns genuine zero rainfall when radar supplies valid zero observations', async () => {
    mockRadarWithZeros();
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '38.46',
        lon: '-93.53',
        asOf: '2026-03-17T14:37:00Z',
      }),
      mock.res
    );
    assert.equal(mock.status, 200);
    assert.equal((mock.json.rain as Record<string, number>)['24h'], 0);
    assert.equal((mock.json.sourceStatus as { radar: string }).radar, 'ok');
    assert.equal(mock.json.dataWarning, undefined);
  });

  it('returns partial-coverage warning when some radar days are missing', async () => {
    mockPartialRadarCoverage();
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '38.46',
        lon: '-93.53',
        asOf: '2026-03-17T14:37:00Z',
      }),
      mock.res
    );
    assert.equal(mock.status, 200);
    assert.match(String(mock.json.dataWarning), /unavailable for 1 day/i);
    assert.equal((mock.json.sourceStatus as { radar: string }).radar, 'ok');
  });

  it('marks radar unavailable when all radar days are missing', async () => {
    mockRadarFailure();
    mockDbSuccess();
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '38.46',
        lon: '-93.53',
        field_id: FIELD_ID,
        asOf: '2026-03-17T14:37:00Z',
      }),
      mock.res
    );
    assert.equal(mock.status, 200);
    assert.equal((mock.json.sourceStatus as { radar: string }).radar, 'unavailable');
  });

  it('does not return an unwarned zero for empty custom-range radar payloads', async () => {
    __test_setIemMocks({
      fetchIemCustomRange: async () => {
        throw new IemFetchError('No usable radar observations for requested dates');
      },
    });
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '38.46',
        lon: '-93.53',
        start_date: '2026-03-01',
        end_date: '2026-03-17',
      }),
      mock.res
    );
    assert.equal(mock.status, 502);
  });

  it('falls back to database for empty custom-range radar payloads on field requests', async () => {
    __test_setIemMocks({
      fetchIemCustomRange: async () => {
        throw new IemFetchError('No usable radar observations for requested dates');
      },
    });
    mockDbSuccess();
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '38.46',
        lon: '-93.53',
        field_id: FIELD_ID,
        start_date: '2026-03-01',
        end_date: '2026-03-17',
      }),
      mock.res
    );
    assert.equal(mock.status, 200);
    assert.match(String(mock.json.dataWarning), /radar/i);
    assert.equal((mock.json.sourceStatus as { radar: string }).radar, 'unavailable');
    assert.equal((mock.json.rain as { total: number }).total, 0.75);
  });

  for (const param of ['field_id', 'lat', 'lon', 'tz', 'asOf', 'start_date', 'end_date']) {
    it(`returns 400 for repeated ${param} query parameter`, async () => {
      const mock = createMockRes();
      await handler(
        createReq('GET', {
          lat: '10',
          lon: '10',
          [param]: ['first', 'second'],
        }),
        mock.res
      );
      assert.equal(mock.status, 400);
      assert.match(
        String(mock.json.detail),
        new RegExp(`${param} must appear only once`, 'i')
      );
    });
  }

  it('keeps the standard response shape unchanged', async () => {
    const mock = createMockRes();
    await handler(createReq('GET', { lat: '38.46', lon: '-93.53', asOf: '2026-03-17T14:37:00Z' }), mock.res);
    assert.equal(mock.status, 200);
    for (const key of ['12h', '24h', '72h', '168h']) {
      assert.equal(typeof (mock.json.rain as Record<string, number>)[key], 'number');
      assert.equal(typeof (mock.json.rainMm as Record<string, number>)[key], 'number');
    }
    assert.equal(mock.json.units, 'in');
    assert.equal((mock.json.location as { type: string }).type, 'point');
  });

  it('keeps the custom-range response shape unchanged', async () => {
    mockDbSuccess();
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '38.46',
        lon: '-93.53',
        field_id: FIELD_ID,
        start_date: '2026-03-01',
        end_date: '2026-03-17',
      }),
      mock.res
    );
    assert.equal(mock.status, 200);
    assert.equal(typeof (mock.json.rain as { total: number }).total, 'number');
    assert.equal(typeof (mock.json.rainMm as { total: number }).total, 'number');
    assert.equal(typeof mock.json.periodEndUtc, 'string');
  });

  it('returns 204 for OPTIONS preflight', async () => {
    const mock = createMockRes();
    await handler(createReq('OPTIONS', {}), mock.res);
    assert.equal(mock.status, 204);
  });
});

const AUTH_TOKEN = 'Bearer super-secret-token';
const FIELD_LAT = 38.46;
const FIELD_LNG = -93.53;

interface AuthFake {
  user?: { id: string } | null;
  userError?: { status?: number } | null;
  profileFarm?: string | null;
  fieldFarm?: string | null;
  fieldLat?: number | null;
  fieldLng?: number | null;
  deletedAt?: string | null;
  fieldMissing?: boolean;
  allowed?: boolean | null;
  rpcError?: boolean;
  throwOnAuth?: boolean;
}

function authFake(f: AuthFake = {}) {
  return {
    auth: {
      getUser: async () => {
        if (f.throwOnAuth) throw new Error('network');
        return {
          data: { user: f.user === undefined ? { id: 'u1' } : f.user },
          error: f.userError ?? null,
        };
      },
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'profiles') {
              return {
                data: { farm_id: f.profileFarm === undefined ? 'farm-a' : f.profileFarm },
                error: null,
              };
            }
            if (f.fieldMissing) return { data: null, error: null };
            return {
              data: {
                id: FIELD_ID,
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
    rpc: async (name: string) => {
      if (name === 'rainfall_field_hourly_allowed') {
        return f.rpcError
          ? { data: null, error: { message: 'rpc down' } }
          : { data: f.allowed ?? true, error: null };
      }
      return { data: [{ total_inches: 0.4 }], error: null };
    },
  };
}

function captureAuthWarnings() {
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

describe('rain handler access gate', () => {
  beforeEach(() => {
    __test_resetIemMocks();
    __test_resetSupabase();
    mockRadarSuccess();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    delete process.env.RAIN_API_AUTH;
  });

  afterEach(() => {
    __test_resetIemMocks();
    __test_resetSupabase();
    delete process.env.RAIN_API_AUTH;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('off mode is unchanged for a coordinate-only request', async () => {
    let authCalls = 0;
    __test_setSupabase({
      auth: {
        getUser: async () => {
          authCalls += 1;
          throw new Error('should not run');
        },
      },
      from() {
        throw new Error('should not run');
      },
      rpc: async () => {
        throw new Error('should not run');
      },
    } as never);
    const warn = captureAuthWarnings();
    try {
      const mock = createMockRes();
      await handler(
        createReq('GET', { lat: '38.46', lon: '-93.53', asOf: '2026-03-17T14:37:00Z' }),
        mock.res
      );
      assert.equal(mock.status, 200);
      assert.equal(typeof (mock.json.rain as Record<string, number>)['24h'], 'number');
      assert.equal(authCalls, 0);
      assert.equal(warn.denials().length, 0);
    } finally {
      warn.restore();
    }
  });

  it('enforce: 401 when the bearer token is missing', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    __test_setSupabase(authFake({ allowed: true }) as never);
    const mock = createMockRes();
    await handler(
      createReq('GET', {
        lat: '38.46',
        lon: '-93.53',
        field_id: FIELD_ID,
        asOf: '2026-03-17T14:37:00Z',
      }),
      mock.res
    );
    assert.equal(mock.status, 401);
    assert.deepEqual(mock.json, { error: 'Sign in required' });
  });

  it('enforce: 400 when the request has coordinates but no field_id', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    __test_setSupabase(authFake({ allowed: true }) as never);
    const mock = createMockRes();
    await handler(
      createReq(
        'GET',
        { lat: '38.46', lon: '-93.53', asOf: '2026-03-17T14:37:00Z' },
        undefined,
        { authorization: AUTH_TOKEN }
      ),
      mock.res
    );
    assert.equal(mock.status, 400);
    assert.deepEqual(mock.json, { error: 'field_id required' });
  });

  it('enforce: 400 for a polygon with no field_id', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    __test_setSupabase(authFake({ allowed: true }) as never);
    const mock = createMockRes();
    await handler(
      createReq(
        'POST',
        {},
        {
          polygon: [
            [-93.54, 38.45],
            [-93.52, 38.45],
            [-93.52, 38.47],
            [-93.54, 38.47],
            [-93.54, 38.45],
          ],
        },
        { authorization: AUTH_TOKEN }
      ),
      mock.res
    );
    assert.equal(mock.status, 400);
    assert.deepEqual(mock.json, { error: 'field_id required' });
  });

  it('enforce: 403 when the field belongs to another farm', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    __test_setSupabase(authFake({ fieldFarm: 'farm-b', allowed: true }) as never);
    const mock = createMockRes();
    await handler(
      createReq(
        'GET',
        { lat: '38.46', lon: '-93.53', field_id: FIELD_ID, asOf: '2026-03-17T14:37:00Z' },
        undefined,
        { authorization: AUTH_TOKEN }
      ),
      mock.res
    );
    assert.equal(mock.status, 403);
    assert.equal(mock.json.error, 'Field not found for this farm');
  });

  it('enforce: 403 when the field is soft-deleted', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    __test_setSupabase(authFake({ deletedAt: '2026-04-01T00:00:00Z', allowed: true }) as never);
    const mock = createMockRes();
    await handler(
      createReq(
        'GET',
        { lat: '38.46', lon: '-93.53', field_id: FIELD_ID, asOf: '2026-03-17T14:37:00Z' },
        undefined,
        { authorization: AUTH_TOKEN }
      ),
      mock.res
    );
    assert.equal(mock.status, 403);
    assert.equal(mock.json.error, 'Field not found for this farm');
    assert.equal(mock.json.rain, undefined);
  });

  it('enforce: 403 when coordinates are more than 10 km from the field', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    __test_setSupabase(authFake({ fieldLat: 41.5, fieldLng: -93.53, allowed: true }) as never);
    const mock = createMockRes();
    await handler(
      createReq(
        'GET',
        { lat: '38.46', lon: '-93.53', field_id: FIELD_ID, asOf: '2026-03-17T14:37:00Z' },
        undefined,
        { authorization: AUTH_TOKEN }
      ),
      mock.res
    );
    assert.equal(mock.status, 403);
    assert.equal(mock.json.error, 'Coordinates do not match this field');
  });

  it('enforce: 403 for a free plan and 200 for Pro', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    const query = { lat: '38.46', lon: '-93.53', field_id: FIELD_ID, asOf: '2026-03-17T14:37:00Z' };

    __test_setSupabase(authFake({ allowed: false }) as never);
    let mock = createMockRes();
    await handler(createReq('GET', query, undefined, { authorization: AUTH_TOKEN }), mock.res);
    assert.equal(mock.status, 403);
    assert.deepEqual(mock.json, { error: 'premium_required:rainfall' });

    __test_setSupabase(authFake({ allowed: true }) as never);
    mock = createMockRes();
    await handler(createReq('GET', query, undefined, { authorization: AUTH_TOKEN }), mock.res);
    assert.equal(mock.status, 200);
    assert.equal(typeof (mock.json.rain as Record<string, number>)['24h'], 'number');
    assert.equal((mock.json.location as { fieldId?: string }).fieldId, FIELD_ID);
  });

  it('enforce: 503 when Supabase is not configured', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    __test_resetSupabase();
    const mock = createMockRes();
    await handler(
      createReq(
        'GET',
        { lat: '38.46', lon: '-93.53', field_id: FIELD_ID, asOf: '2026-03-17T14:37:00Z' },
        undefined,
        { authorization: AUTH_TOKEN }
      ),
      mock.res
    );
    assert.equal(mock.status, 503);
    assert.deepEqual(mock.json, { error: 'Rainfall access check unavailable' });
  });

  it('enforce: 503 when the plan RPC errors', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    __test_setSupabase(authFake({ rpcError: true, allowed: true }) as never);
    const mock = createMockRes();
    await handler(
      createReq(
        'GET',
        { lat: '38.46', lon: '-93.53', field_id: FIELD_ID, asOf: '2026-03-17T14:37:00Z' },
        undefined,
        { authorization: AUTH_TOKEN }
      ),
      mock.res
    );
    assert.equal(mock.status, 503);
    assert.equal(mock.json.error, 'Rainfall access check unavailable');
    assert.equal(mock.json.rain, undefined);
  });

  it('log mode serves a coordinate request when Supabase is not configured', async () => {
    process.env.RAIN_API_AUTH = 'log';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    __test_resetSupabase();
    const warn = captureAuthWarnings();
    try {
      const mock = createMockRes();
      await handler(
        createReq(
          'GET',
          { lat: '38.46', lon: '-93.53', asOf: '2026-03-17T14:37:00Z' },
          undefined,
          { authorization: AUTH_TOKEN }
        ),
        mock.res
      );
      assert.equal(mock.status, 200);
      assert.equal(warn.denials()[0]?.reason, 'auth_unavailable');
      assert.equal(warn.denials()[0]?.status, 503);
      assert.equal(JSON.stringify(warn.lines).includes('super-secret-token'), false);
    } finally {
      warn.restore();
    }
  });

  it('log mode does not replace a field-only custom range with stored coordinates', async () => {
    process.env.RAIN_API_AUTH = 'log';
    let radarCalls = 0;
    __test_setIemMocks({
      fetchIemCustomRange: async () => {
        radarCalls += 1;
        return customRangeSuccessResult();
      },
    });
    __test_setSupabase(authFake({ allowed: true }) as never);
    const mock = createMockRes();
    await handler(
      createReq(
        'GET',
        { field_id: FIELD_ID, start_date: '2026-03-01', end_date: '2026-03-17' },
        undefined,
        { authorization: AUTH_TOKEN }
      ),
      mock.res
    );
    assert.equal(mock.status, 200);
    assert.equal(radarCalls, 0);
    assert.equal((mock.json.rain as { total: number }).total, 0.4);
  });

  it('log mode serves the request and logs the would-be denial', async () => {
    process.env.RAIN_API_AUTH = 'log';
    __test_setSupabase(authFake({ allowed: false }) as never);
    const warn = captureAuthWarnings();
    try {
      const mock = createMockRes();
      await handler(
        createReq(
          'GET',
          { lat: '38.46', lon: '-93.53', field_id: FIELD_ID, asOf: '2026-03-17T14:37:00Z' },
          undefined,
          { authorization: AUTH_TOKEN }
        ),
        mock.res
      );
      assert.equal(mock.status, 200);
      assert.equal(typeof (mock.json.rain as Record<string, number>)['24h'], 'number');
      const denial = warn.denials()[0];
      assert.equal(denial?.mode, 'log');
      assert.equal(denial?.reason, 'premium_required');
      assert.equal(denial?.fieldId, FIELD_ID);
      assert.equal(JSON.stringify(warn.lines).includes('super-secret-token'), false);
    } finally {
      warn.restore();
    }
  });

  it('enforce uses stored field coordinates when a custom range has no request point', async () => {
    process.env.RAIN_API_AUTH = 'enforce';
    let seen: { lat?: number; lon?: number } = {};
    __test_setIemMocks({
      fetchIemCustomRange: async (lat: number, lon: number) => {
        seen = { lat, lon };
        return customRangeSuccessResult();
      },
    });
    __test_setSupabase(authFake({ allowed: true }) as never);
    const mock = createMockRes();
    await handler(
      createReq(
        'GET',
        { field_id: FIELD_ID, start_date: '2026-03-01', end_date: '2026-03-17' },
        undefined,
        { authorization: AUTH_TOKEN }
      ),
      mock.res
    );
    assert.equal(mock.status, 200);
    assert.equal(seen.lat, FIELD_LAT);
    assert.equal(seen.lon, FIELD_LNG);
    assert.equal((mock.json.rain as { total: number }).total, 1.25);
  });
});
