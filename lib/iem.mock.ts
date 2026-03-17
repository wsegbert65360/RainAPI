/**
 * Mock IEM Stage IV data provider.
 * Returns synthetic but realistic precipitation values.
 */

export class IEMError extends Error {
  constructor(message: string, public retryAfterSeconds: number = 60) {
    super(message);
    this.name = 'IEMError';
  }
}

export async function fetchIEMData(
  lat: number,
  lon: number,
  dates: string[]
): Promise<Map<string, number>> {
  const hourMap = new Map<string, number>();

  // Detect non-CONUS simulated point (London from Test I)
  if (lat === 51.5074 && lon === -0.1278) {
    // Return empty map to trigger the 404 logic
    return hourMap;
  }

  // Generate stable synthetic data based on lat/lon/date
  for (const date of dates) {
    for (let h = 0; h < 24; h++) {
      const hh = h.toString().padStart(2, '0');
      const key = `${date}T${hh}:00:00Z`;
      if (h === 0 && date === dates[dates.length - 1]) console.log('DEBUG MOCK: sample key:', key);
      
      // Pseudo-random but deterministic precip value
      // Uses lat/lon/date/hour to create some "rain"
      const seed = Math.abs(Math.floor(lat * 100) + Math.floor(lon * 10) + date.split('-').reduce((a, b) => a + parseInt(b), 0) + h);
      const isRaining = seed % 3 === 0; // Increased probability
      const val = isRaining ? ((seed % 10) + 1) / 100 : 0; // Ensure some value if raining
      
      hourMap.set(key, val);
    }
  }

  // Simulate a bit of network delay
  await new Promise(resolve => setTimeout(resolve, 200));

  return hourMap;
}
