/**
 * Polygon centroid calculation.
 */

export interface Point {
  lat: number;
  lon: number;
}

export function calculateCentroid(polygon: any): Point {
  let coords: [number, number][] = [];

  if (Array.isArray(polygon)) {
    // Check if it's an array of points [[lon, lat], ...]
    if (Array.isArray(polygon[0])) {
      coords = polygon;
    } else {
      throw new Error('Invalid polygon format: expected array of [lon, lat] pairs');
    }
  } else if (polygon?.type === 'Polygon' && Array.isArray(polygon.coordinates)) {
    // GeoJSON Polygon - we use the outer ring (first element)
    coords = polygon.coordinates[0];
  } else {
    throw new Error('Invalid polygon format: expected array or GeoJSON Polygon');
  }

  if (coords.length < 3) {
    throw new Error('Polygon must have at least 3 points');
  }

  // Remove closing vertex if it exists (first == last)
  const first = coords[0];
  const last = coords[coords.length - 1];
  
  let pts = coords;
  if (first[0] === last[0] && first[1] === last[1] && coords.length > 3) {
    pts = coords.slice(0, -1);
  }

  const lon = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
  const lat = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;

  return { lat, lon };
}
