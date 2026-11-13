import { generateHourKeys } from '../lib/time';
import { calculateCentroid } from '../lib/centroid';
import { aggregateRain } from '../lib/aggregate';
import assert from 'node:assert';
import { test } from 'node:test';

test('centroid: open ring', () => {
  const poly = [[-93.65, 42.02], [-93.60, 42.02], [-93.60, 42.05], [-93.65, 42.05]];
  const c = calculateCentroid(poly);
  assert.strictEqual(c.lon, -93.625);
  assert.strictEqual(c.lat, 42.035);
});

test('centroid: closed ring', () => {
  const poly = [[-93.65, 42.02], [-93.60, 42.02], [-93.60, 42.05], [-93.65, 42.05], [-93.65, 42.02]];
  const c = calculateCentroid(poly);
  assert.strictEqual(c.lon, -93.625);
  assert.strictEqual(c.lat, 42.035);
});

test('centroid: small field far from origin keeps precision', () => {
  const poly = [[-93.5400, 38.4600], [-93.5390, 38.4600], [-93.5390, 38.4608], [-93.5400, 38.4608]];
  const c = calculateCentroid(poly);
  assert.strictEqual(c.lon, -93.5395);
  assert.strictEqual(c.lat, 38.4604);
});

test('time: asOf floor', () => {
  const { periodEndUtc } = generateHourKeys('2026-03-17T14:37:00Z');
  assert.strictEqual(periodEndUtc.toISOString(), '2026-03-17T14:00:00.000Z');
});

test('time: asOf on-the-hour', () => {
  const { periodEndUtc } = generateHourKeys('2026-03-17T14:00:00Z');
  assert.strictEqual(periodEndUtc.toISOString(), '2026-03-17T14:00:00.000Z');
});

test('aggregate: window math', () => {
  const { keys } = generateHourKeys('2026-03-17T14:00:00Z', 'UTC', 169);
  const map = new Map<string, number>();

  // Fill with 1, 2, 3... 72 (most recent = 1)
  for (let i = 0; i < 72; i++) {
    map.set(keys[i], i + 1);
  }

  const result = aggregateRain(map, keys);
  assert.strictEqual(result['12h'].inches, 78); // 1..12
  assert.strictEqual(result['24h'].inches, 300); // 1..24
  assert.strictEqual(result['72h'].inches, 2628); // 1..72
});

test('aggregate: missing warning', () => {
  const { keys } = generateHourKeys('2026-03-17T14:00:00Z', 'UTC', 169);
  const map = new Map<string, number>();

  // Only fill the first 8 of the 12h window (4 missing > 10% threshold)
  for (let i = 0; i < 8; i++) {
    map.set(keys[i], 1);
  }

  const result = aggregateRain(map, keys);
  assert.ok(result.dataWarning?.includes('12h window'));
  assert.strictEqual(result['12h'].inches, 8);
});

test('iem custom range: huge span only requests the recent radar window', async () => {
  const { __test_setIemMocks, __test_resetIemMocks, fetchIemCustomRange, IEM_RADAR_RECENT_DAYS } =
    await import('../lib/iem');
  let requested: string[] = [];
  __test_setIemMocks({
    fetchIemMultipleDays: async (_lat, _lon, dates) => {
      requested = dates;
      return {
        hourMap: new Map([['2026-03-17 12:00', 0.5]]),
        requestedDates: dates,
        successfulDates: dates,
        failedDates: [],
        hasUsableData: true,
      };
    },
  });
  try {
    const result = await fetchIemCustomRange(38.46, -93.53, '0001-01-01', '2026-03-17');
    assert.strictEqual(requested.length, IEM_RADAR_RECENT_DAYS);
    assert.strictEqual(requested[requested.length - 1], '2026-03-17');
    assert.strictEqual(result.partialCoverage, true);
    assert.strictEqual(result.total, 0.5);
  } finally {
    __test_resetIemMocks();
  }
});

test('iem custom range: short span is requested in full', async () => {
  const { __test_setIemMocks, __test_resetIemMocks, fetchIemCustomRange } = await import('../lib/iem');
  let requested: string[] = [];
  __test_setIemMocks({
    fetchIemMultipleDays: async (_lat, _lon, dates) => {
      requested = dates;
      return {
        hourMap: new Map([['2026-03-02 12:00', 0.25]]),
        requestedDates: dates,
        successfulDates: dates,
        failedDates: [],
        hasUsableData: true,
      };
    },
  });
  try {
    const result = await fetchIemCustomRange(38.46, -93.53, '2026-03-01', '2026-03-03');
    assert.deepStrictEqual(requested, ['2026-03-01', '2026-03-02', '2026-03-03']);
    assert.strictEqual(result.partialCoverage, false);
    assert.strictEqual(result.dataWarning, undefined);
  } finally {
    __test_resetIemMocks();
  }
});

test('iem coverage warning: a UTC day that just started is not reported as missing', async () => {
  const { partialCoverageWarning } = await import('../lib/iem');
  const justAfterMidnight = new Date('2026-11-13T00:10:00Z');
  assert.equal(partialCoverageWarning(['2026-11-13'], justAfterMidnight), undefined);
  assert.equal(
    partialCoverageWarning(['2026-11-11', '2026-11-13'], justAfterMidnight),
    'Radar data unavailable for 1 day(s): 2026-11-11.',
  );
  const laterThatDay = new Date('2026-11-13T05:00:00Z');
  assert.equal(
    partialCoverageWarning(['2026-11-13'], laterThatDay),
    'Radar data unavailable for 1 day(s): 2026-11-13.',
  );
});
