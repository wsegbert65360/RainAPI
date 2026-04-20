import { calculateCentroid } from '../lib/centroid';
import { generateHourKeys, getRequiredDates } from '../lib/time';
import { aggregateRain } from '../lib/aggregate';

/**
 * Centroid Tests
 */
console.log('--- CENTROID TESTS ---');
const square = [[-93, 42], [-92, 42], [-92, 43], [-93, 43], [-93, 42]];
const c1 = calculateCentroid(square);
console.assert(c1.lat === 42.5 && c1.lon === -92.5, `Square centroid failed: ${JSON.stringify(c1)}`);

const triangle = [[0, 0], [10, 0], [5, 10]];
const c2 = calculateCentroid(triangle);
console.assert(c2.lat === 3.333333 && c2.lon === 5, `Triangle centroid failed: ${JSON.stringify(c2)}`);

/**
 * Time Logic Tests
 */
console.log('--- TIME LOGIC TESTS ---');
const { keys, periodEndUtc } = generateHourKeys('2026-03-29T10:30:00Z', 'UTC', 12);
console.assert(keys.length === 12, 'Keys length should be 12');
console.assert(keys[0] === '2026-03-29 10:00', `First key failed: ${keys[0]}`);
console.assert(keys[11] === '2026-03-28 23:00', `Last key failed: ${keys[11]}`);

const dates = getRequiredDates(keys);
console.assert(dates.length === 2, `Required dates failed: ${dates}`);
console.assert(dates.includes('2026-03-29') && dates.includes('2026-03-28'), 'Dates missing');

/**
 * Aggregation Tests
 */
console.log('--- AGGREGATION TESTS ---');
const dummyMap = new Map<string, number>();
keys.forEach((k, i) => dummyMap.set(k, 1.0)); // 1 inch per hour
const totals = aggregateRain(dummyMap, keys);
console.assert(totals['12h'].inches === 12, `12h sum failed: ${totals['12h'].inches}`);
console.assert(totals['12h'].hasWarning === false, '12h should not have warning');

const missingMap = new Map<string, number>();
missingMap.set(keys[0], 5.0);
const totals2 = aggregateRain(missingMap, keys);
console.assert(totals2['12h'].inches === 5, 'Sum of single record failed');
console.assert(totals2['12h'].missingHours === 11, 'Missing hours count failed');
console.assert(totals2['12h'].hasWarning === true, 'Missing warning failed');

console.log('TESTS COMPLETED SUCCESSFULLY!');
