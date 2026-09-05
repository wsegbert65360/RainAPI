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
  body?: Record<string, unknown>
): VercelRequest {
  return {
    method,
    query,
    body,
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
