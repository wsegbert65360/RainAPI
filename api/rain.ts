import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPeriodEnd, getDatesNeeded, getHourKeys } from '../lib/time';
import { calculateCentroid } from '../lib/centroid';
import { aggregatePrecip } from '../lib/aggregate';
// Note: fetchIEMData and IEMError will be dynamically imported to support mocking
let iemModule: any;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!iemModule) {
    iemModule = process.env.MOCK_IEM === 'true'
      ? await import('../lib/iem.mock')
      : await import('../lib/iem');
  }
  const { fetchIEMData, IEMError } = iemModule;

  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    let lat: number;
    let lon: number;
    let locationType: 'point' | 'polygon';

    // 2. Input Validation and Normalization
    const { tz, asOf } = req.query as Record<string, string>;

    if (req.method === 'POST') {
      let polygonRaw = req.body.polygon;
      
      // Support GeoJSON Polygon
      if (!polygonRaw && req.body.type === 'Polygon' && Array.isArray(req.body.coordinates)) {
        polygonRaw = req.body.coordinates[0];
      }

      if (!polygonRaw) {
        return res.status(400).json({ error: 'polygon or GeoJSON Polygon is required for POST' });
      }
      try {
        const centroid = calculateCentroid(polygonRaw);
        lat = centroid.lat;
        lon = centroid.lon;
        locationType = 'polygon';
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }
    } else if (req.method === 'GET') {
      const qLat = parseFloat(req.query.lat as string);
      const qLon = parseFloat(req.query.lon as string);

      if (isNaN(qLat) || isNaN(qLon)) {
        return res.status(400).json({ error: 'lat and lon are required and must be numbers' });
      }
      if (qLat < -90 || qLat > 90 || qLon < -180 || qLon > 180) {
        return res.status(400).json({ error: 'lat or lon out of range' });
      }
      lat = qLat;
      lon = qLon;
      locationType = 'point';
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // 3. Time Logic
    let periodEnd: Date;
    try {
      periodEnd = getPeriodEnd(asOf, tz);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }

    const dates = getDatesNeeded(periodEnd);
    const hourKeys = getHourKeys(periodEnd);

    // 4. Fetch Data
    const hourMap = await fetchIEMData(lat, lon, dates);

    // 5. Aggregate
    const result = aggregatePrecip(hourMap, hourKeys);

    // 6. Handle non-CONUS (no data) points
    // If even the 12h window is 100% missing, it's likely outside coverage
    if (result.missingHours && result.missingHours['12h'] === 12) {
        return res.status(404).json({ error: 'No Stage IV data for this location' });
    }

    // 7. Response
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
    
    const responseBody: any = {
      location: locationType === 'point' ? { type: 'point', lat, lon } : { type: 'polygon', centroidLat: lat, centroidLon: lon },
      periodEndUtc: periodEnd.toISOString(),
      units: 'in',
      ...result
    };

    return res.status(200).json(responseBody);

  } catch (err: any) {
    const message = err.message || 'Unknown error';
    const isConnectError = message.includes('ECONNRESET') || 
                          message.includes('ENOTFOUND') || 
                          message.includes('ETIMEDOUT') ||
                          err.name === 'IEMError';

    if (isConnectError) {
      return res.status(502).json({
        error: 'IEM request failed',
        detail: 'Could not connect to or timed out from IEM server',
        retryAfterSeconds: err.retryAfterSeconds || 60,
      });
    }

    return res.status(500).json({ error: 'Internal server error', detail: message });
  }
}
