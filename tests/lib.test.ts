import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateCentroid } from '../lib/centroid';
import { generateHourKeys, getRequiredDates } from '../lib/time';
import { aggregateRain } from '../lib/aggregate';
import {
  daysBetweenInclusive,
  isValidCalendarDate,
  isValidTimezone,
  isValidUuid,
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
  it('floors asOf to the hour', () => {
    const { periodEndUtc } = generateHourKeys('2026-03-29T10:30:00Z', 'UTC', 12);
    assert.equal(periodEndUtc.toISOString(), '2026-03-29T10:00:00.000Z');
  });

  it('keeps asOf when already on the hour', () => {
    const { periodEndUtc } = generateHourKeys('2026-03-17T14:00:00Z', 'UTC', 12);
    assert.equal(periodEndUtc.toISOString(), '2026-03-17T14:00:00.000Z');
  });

  it('supports timezone validation and DST transition date', () => {
    assert.equal(isValidTimezone('America/Chicago'), true);
    const { periodEndUtc } = generateHourKeys('2026-03-09T08:30:00Z', 'America/Chicago', 12);
    assert.equal(periodEndUtc instanceof Date, true);
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
});
