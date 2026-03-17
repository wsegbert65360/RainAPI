/**
 * Precipitation aggregation logic.
 */

export interface AggregationResult {
  rain: {
    '12h': number;
    '24h': number;
    '72h': number;
  };
  rainMm: {
    '12h': number;
    '24h': number;
    '72h': number;
  };
  dataWarning?: string;
  missingHours?: {
    '12h': number;
    '24h': number;
    '72h': number;
  };
}

export function aggregatePrecip(
  hourMap: Map<string, number>,
  hourKeys: string[]
): AggregationResult {
  const sum = (len: number) => {
    let total = 0;
    let missing = 0;
    for (let i = 0; i < len; i++) {
      const val = hourMap.get(hourKeys[i]);
      if (val === undefined) {
        missing++;
      } else {
        total += val;
      }
    }
    return { total, missing };
  };

  const r12 = sum(12);
  const r24 = sum(24);
  const r72 = sum(72);

  const rain = {
    '12h': Number(r12.total.toFixed(2)),
    '24h': Number(r24.total.toFixed(2)),
    '72h': Number(r72.total.toFixed(2)),
  };

  const rainMm = {
    '12h': Number((r12.total * 25.4).toFixed(1)),
    '24h': Number((r24.total * 25.4).toFixed(1)),
    '72h': Number((r72.total * 25.4).toFixed(1)),
  };

  const result: AggregationResult = { rain, rainMm };

  // Warning if missing hours exceed 10%
  const warnings: string[] = [];
  if (r12.missing > 1) warnings.push(`12h window has ${r12.missing} missing hours`);
  if (r24.missing > 2) warnings.push(`24h window has ${r24.missing} missing hours`);
  if (r72.missing > 7) warnings.push(`72h window has ${r72.missing} missing hours`);

  if (warnings.length > 0) {
    result.dataWarning = warnings.join('; ');
    result.missingHours = {
      '12h': r12.missing,
      '24h': r24.missing,
      '72h': r72.missing,
    };
  }

  return result;
}
