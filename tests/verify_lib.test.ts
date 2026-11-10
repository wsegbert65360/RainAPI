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

test('time: asOf floor', () => {
  const { periodEndUtc } = generateHourKeys('2026-03-17T14:37:00Z');
  assert.strictEqual(periodEndUtc.toISOString(), '2026-03-17T14:00:00.000Z');
});

test('time: asOf on-the-hour', () => {
  const { periodEndUtc } = generateHourKeys('2026-03-17T14:00:00Z');
  assert.strictEqual(periodEndUtc.toISOString(), '2026-03-17T14:00:00.000Z');
});

test('aggregate: window math', () => {
  const { keys } = generateHourKeys('2026-03-17T14:00:00Z', 'UTC', 72);
  const map = new Map<string, number>();

  // Fill with 1, 2, 3... 72 (most recent = 1)
  for (let i = 0; i < 72; i++) {
    map.set(keys[i], i + 1);
  }

  const result = aggregateRain(map, keys);
  // Sum 1..12 = (12*13)/2 = 78
  assert.strictEqual(result['12h'].inches, 78);
  // Sum 1..24 = (24*25)/2 = 300
  assert.strictEqual(result['24h'].inches, 300);
  // Sum 1..72 = (72*73)/2 = 2628
  assert.strictEqual(result['72h'].inches, 2628);
});

test('aggregate: missing warning', () => {
  const { keys } = generateHourKeys('2026-03-17T14:00:00Z', 'UTC', 12);
  const map = new Map<string, number>();

  // 3 of 12 hours missing exceeds the >10% threshold (ceil(12 * 0.1) = 2).
  for (let i = 0; i < 9; i++) {
    map.set(keys[i], 1);
  }

  const result = aggregateRain(map, keys);
  assert.ok(result.dataWarning?.includes('12h window'));
  assert.strictEqual(result['12h'].inches, 9);
  assert.strictEqual(result['12h'].missingHours, 3);
  assert.strictEqual(result['12h'].hasWarning, true);
});
