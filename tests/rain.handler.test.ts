import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler, { __test_resetSupabase, __test_setSupabase } from '../api/rain';
import { __test_resetIemMocks, __test_setIemMocks, IemFetchError } from '../lib/iem';

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
  query: Record<string, string | undefined> = {},
  body?: Record<string, unknown>
): VercelRequest {
  return {
    method,
    query,
    body,
  } as VercelRequest;
}

function mockRadarSuccess() {
  __test_setIemMocks({
    fetchIemMultipleDays: async () => {
      const map = new Map<string, number>();
      map.set('2026-03-17 14:00', 0.1);
      map.set('2026-03-17 13:00', 0.2);
      map.set('2026-03-17 12:00', 0.3);
      map.set('2026-03-17 11:00', 0.4);
      return map;
    },
    fetchIemCustomRange: async () => ({
      total: 1.25,
      radarStartDate: '2026-03-01',
      radarEndDate: '2026-03-17',
      requestedStartDate: '2026-03-01',
      requestedEndDate: '2026-03-17',
      partialCoverage: false,
    }),
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
