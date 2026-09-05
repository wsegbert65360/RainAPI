import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { calculateCentroid } from '../lib/centroid';
import { generateHourKeys, getRequiredDates } from '../lib/time';
import { aggregateRain } from '../lib/aggregate';
import {
  fetchIemMultipleDays,
  IemFetchError,
  isValidIemObservation,
} from '../lib/iem';
import {
  daysBetweenInclusive,
  isValidCalendarDate,
  isValidTimezone,
  isValidUuid,
  readSingleQueryParam,
} from '../lib/validate';

describe('centroid', () => {
  it('computes area-weighted centroid for a square', () => {
    const square = [
      [-93, 42],
      [-92, 42],
      [-92, 43],
      [-93, 43],
      [-93, 42],
    ];
    const centroid = calculateCentroid(square);
    assert.equal(centroid.lat, 42.5);
    assert.equal(centroid.lon, -92.5);
  });
});

describe('time', () => {
  it('floors asOf to the UTC hour', () => {
    const { periodEndUtc } = generateHourKeys('2026-03-29T10:30:00Z', 'UTC', 12);
    assert.equal(periodEndUtc.toISOString(), '2026-03-29T10:00:00.000Z');
  });

  it('keeps asOf when already on the hour', () => {
    const { periodEndUtc } = generateHourKeys('2026-03-17T14:00:00Z', 'UTC', 12);
    assert.equal(periodEndUtc.toISOString(), '2026-03-17T14:00:00.000Z');
  });

  it('produces 14:00Z for 2026-03-17T14:37:00Z regardless of timezone', () => {
    for (const tz of ['UTC', 'America/Chicago', 'America/New_York', 'Europe/London']) {
      const { periodEndUtc } = generateHourKeys('2026-03-17T14:37:00Z', tz, 12);
      assert.equal(
        periodEndUtc.toISOString(),
        '2026-03-17T14:00:00.000Z',
        `expected UTC floor for tz=${tz}`
      );
    }
  });

  it('matches UTC floor for America/Chicago', () => {
    const asOf = '2026-03-17T14:37:00Z';
    const utc = generateHourKeys(asOf, 'UTC', 12);
    const chicago = generateHourKeys(asOf, 'America/Chicago', 12);
    assert.equal(chicago.periodEndUtc.toISOString(), utc.periodEndUtc.toISOString());
    assert.deepEqual(chicago.keys.slice(0, 3), utc.keys.slice(0, 3));
  });

  it('uses UTC floor across spring DST transition', () => {
    const asOf = '2026-03-08T08:30:00Z';
    const utc = generateHourKeys(asOf, 'UTC', 12);
    const chicago = generateHourKeys(asOf, 'America/Chicago', 12);
    assert.equal(utc.periodEndUtc.toISOString(), '2026-03-08T08:00:00.000Z');
    assert.equal(chicago.periodEndUtc.toISOString(), utc.periodEndUtc.toISOString());
  });

  it('uses UTC floor for both fall DST repeated-hour occurrences', () => {
    const firstOccurrence = generateHourKeys('2026-11-01T06:30:00Z', 'America/Chicago', 12);
    const secondOccurrence = generateHourKeys('2026-11-01T07:30:00Z', 'America/Chicago', 12);

    assert.equal(firstOccurrence.periodEndUtc.toISOString(), '2026-11-01T06:00:00.000Z');
    assert.equal(secondOccurrence.periodEndUtc.toISOString(), '2026-11-01T07:00:00.000Z');

    assert.equal(
      generateHourKeys('2026-11-01T06:30:00Z', 'UTC', 12).periodEndUtc.toISOString(),
      '2026-11-01T06:00:00.000Z'
    );
    assert.equal(
      generateHourKeys('2026-11-01T07:30:00Z', 'UTC', 12).periodEndUtc.toISOString(),
      '2026-11-01T07:00:00.000Z'
    );
  });

  it('supports timezone validation', () => {
    assert.equal(isValidTimezone('America/Chicago'), true);
  });

  it('returns required dates for hour keys', () => {
    const { keys } = generateHourKeys('2026-03-29T10:30:00Z', 'UTC', 12);
    const dates = getRequiredDates(keys);
    assert.equal(dates.length, 2);
    assert.ok(dates.includes('2026-03-29'));
    assert.ok(dates.includes('2026-03-28'));
  });
});

describe('aggregate', () => {
  it('sums windows and flags missing data', () => {
    const { keys } = generateHourKeys('2026-03-29T10:30:00Z', 'UTC', 12);
    const map = new Map<string, number>();
    keys.forEach((key) => map.set(key, 1.0));
    const totals = aggregateRain(map, keys);
    assert.equal(totals['12h'].inches, 12);
    assert.equal(totals['12h'].hasWarning, false);
  });

  it('treats explicit zero rainfall as valid data', () => {
    const { keys } = generateHourKeys('2026-03-29T10:30:00Z', 'UTC', 12);
    const map = new Map<string, number>();
    keys.forEach((key) => map.set(key, 0));
    const totals = aggregateRain(map, keys);
    assert.equal(totals['12h'].inches, 0);
    assert.equal(totals['12h'].hasWarning, false);
  });
});

describe('iem validation', () => {
  it('accepts finite non-negative rainfall with a valid timestamp', () => {
    assert.equal(isValidIemObservation({ end_valid: '2026-03-17T14:00:00', precip_in: 0 }), true);
    assert.equal(isValidIemObservation({ end_valid: '2026-03-17T14:00:00', precip_in: 0.25 }), true);
  });

  it('rejects missing, negative, or invalid observations', () => {
    assert.equal(isValidIemObservation({ end_valid: '', precip_in: 0 }), false);
    assert.equal(isValidIemObservation({ end_valid: '2026-03-17T14:00:00', precip_in: null }), false);
    assert.equal(isValidIemObservation({ end_valid: '2026-03-17T14:00:00', precip_in: -0.1 }), false);
    assert.equal(isValidIemObservation({ end_valid: 'bad', precip_in: 0.1 }), false);
    assert.equal(isValidIemObservation({ end_valid: '2026-02-30T14:00:00', precip_in: 0.1 }), false);
    assert.equal(isValidIemObservation({ end_valid: '2026-03-17T24:00:00', precip_in: 0.1 }), false);
  });
});

describe('iem fetch coverage', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('accepts explicit zero observations as usable radar data', async () => {
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ end_valid: '2026-03-17T14:00:00Z', precip_in: 0 }],
        }),
      }) as Response;

    const result = await fetchIemMultipleDays(38.46, -93.53, ['2026-03-17']);
    assert.equal(result.hasUsableData, true);
    assert.deepEqual(result.successfulDates, ['2026-03-17']);
    assert.deepEqual(result.failedDates, []);
    assert.equal(result.hourMap.get('2026-03-17 14:00'), 0);
  });

  it('rejects an entirely empty successful radar response', async () => {
    globalThis.fetch = async () =>
      ({ ok: true, status: 200, json: async () => ({ data: [] }) }) as Response;

    await assert.rejects(
      () => fetchIemMultipleDays(38.46, -93.53, ['2026-03-17']),
      IemFetchError
    );
  });

  it('keeps usable days and warns about empty days', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      const date = new URL(url).searchParams.get('valid');
      return {
        ok: true,
        status: 200,
        json: async () =>
          date === '2026-03-17'
            ? { data: [{ end_valid: '2026-03-17T14:00:00Z', precip_in: 0.25 }] }
            : { data: [] },
      } as Response;
    };

    const result = await fetchIemMultipleDays(
      38.46,
      -93.53,
      ['2026-03-17', '2026-03-18']
    );
    assert.deepEqual(result.successfulDates, ['2026-03-17']);
    assert.deepEqual(result.failedDates, ['2026-03-18']);
    assert.match(result.dataWarning || '', /2026-03-18/);
    assert.equal(result.hourMap.get('2026-03-17 14:00'), 0.25);
  });
});

describe('validate', () => {
  it('validates UUIDs and calendar dates', () => {
    assert.equal(
      isValidUuid('11111111-1111-4111-8111-111111111111'),
      true
    );
    assert.equal(isValidUuid('weather-overview'), false);
    assert.equal(isValidCalendarDate('2026-02-28'), true);
    assert.equal(isValidCalendarDate('2026-02-30'), false);
    assert.equal(daysBetweenInclusive('2026-03-01', '2026-03-03'), 3);
  });

  it('reads single query parameters and rejects repeated values', () => {
    assert.deepEqual(readSingleQueryParam({ tz: 'UTC' }, 'tz'), { ok: true, value: 'UTC' });
    assert.deepEqual(readSingleQueryParam({ tz: '  UTC  ' }, 'tz'), { ok: true, value: 'UTC' });
    assert.deepEqual(readSingleQueryParam({}, 'tz'), { ok: true, value: undefined });
    assert.deepEqual(readSingleQueryParam({ tz: ['UTC', 'America/Chicago'] }, 'tz'), {
      ok: false,
      detail: 'tz must appear only once in the query string.',
    });
  });
});
