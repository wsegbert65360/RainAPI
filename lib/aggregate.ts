/**
 * Accumulates hourly values from a Map using an ordered list of keys.
 */
export interface RainWindow {
  inches: number;
  mm: number;
  missingHours: number;
  hasWarning: boolean;
}

export function aggregateRain(
  hourMap: Map<string, number>,
  keys: string[]
): {
  '12h': RainWindow;
  '24h': RainWindow;
  '72h': RainWindow;
  '168h': RainWindow;
  dataWarning?: string;
} {
  const getWindow = (n: number): RainWindow => {
    let sum = 0;
    let missing = 0;
    
    // We only take the first n keys from our ordered list
    for (let i = 0; i < n && i < keys.length; i++) {
      const val = hourMap.get(keys[i]);
      if (val === undefined) {
        missing++;
      } else {
        sum += val;
      }
    }
    
    // Proportional missing hour warning (threshold: >10%)
    const threshold = Math.ceil(n * 0.1);
    const hasWarning = missing > threshold;
    
    return {
      inches: Number(sum.toFixed(3)),
      mm: Number((sum * 25.4).toFixed(2)),
      missingHours: missing,
      hasWarning
    };
  };

  const win12 = getWindow(12);
  const win24 = getWindow(24);
  const win72 = getWindow(72);
  const win168 = getWindow(168);

  const warnings: string[] = [];
  if (win12.hasWarning) warnings.push('12h window is incomplete.');
  if (win24.hasWarning) warnings.push('24h window is incomplete.');
  if (win72.hasWarning) warnings.push('72h window is incomplete.');
  if (win168.hasWarning) warnings.push('7-day window is incomplete.');

  return {
    '12h': win12,
    '24h': win24,
    '72h': win72,
    '168h': win168,
    dataWarning: warnings.length > 0 ? warnings.join(' ') : undefined
  };
}
