/**
 * Calculates the area-weighted centroid of a polygon ring.
 * Supports raw [lon, lat][] arrays or GeoJSON Polygons.
 */
export function calculateCentroid(coordsOrPolygon: unknown): { lat: number; lon: number } {
  let coords: [number, number][];

  if (
    coordsOrPolygon &&
    typeof coordsOrPolygon === 'object' &&
    (coordsOrPolygon as { type?: string }).type === 'Polygon' &&
    Array.isArray((coordsOrPolygon as { coordinates?: unknown }).coordinates)
  ) {
    coords = (coordsOrPolygon as { coordinates: [number, number][][] }).coordinates[0];
  } else if (Array.isArray(coordsOrPolygon)) {
    coords = coordsOrPolygon as [number, number][];
  } else {
    throw new Error('Invalid coordinate format. Expected [lon, lat][] or GeoJSON Polygon.');
  }

  if (coords.length < 3) {
    throw new Error('Polygon must have at least 3 points.');
  }

  const lastIdx = coords.length - 1;
  const isClosed =
    coords[0][0] === coords[lastIdx][0] && coords[0][1] === coords[lastIdx][1];
  const ring = isClosed ? coords.slice(0, -1) : coords;

  if (ring.length < 3) {
    throw new Error('Polygon must have at least 3 points.');
  }

  let area = 0;
  let centroidLon = 0;
  let centroidLat = 0;

  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    centroidLon += (x0 + x1) * cross;
    centroidLat += (y0 + y1) * cross;
  }

  area *= 0.5;
  if (Math.abs(area) < 1e-12) {
    throw new Error('Polygon area is too small to compute a centroid.');
  }

  return {
    lon: Number((centroidLon / (6 * area)).toFixed(6)),
    lat: Number((centroidLat / (6 * area)).toFixed(6)),
  };
}
