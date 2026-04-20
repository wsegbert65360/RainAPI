/**
 * Calculates the centroid (arithmetic mean) of a set of coordinates.
 * Supports raw [lon, lat][] arrays or GeoJSON Polygons.
 */
export function calculateCentroid(coordsOrPolygon: any): { lat: number; lon: number } {
  let coords: [number, number][];

  // Normalize GeoJSON Polygon
  if (coordsOrPolygon.type === 'Polygon' && Array.isArray(coordsOrPolygon.coordinates)) {
    coords = coordsOrPolygon.coordinates[0];
  } else if (Array.isArray(coordsOrPolygon)) {
    coords = coordsOrPolygon;
  } else {
    throw new Error('Invalid coordinate format. Expected [lon, lat][] or GeoJSON Polygon.');
  }

  if (coords.length < 3) {
    throw new Error('Polygon must have at least 3 points.');
  }

  // Strip closing point if first equals last
  const lastIdx = coords.length - 1;
  const isClosed = coords[0][0] === coords[lastIdx][0] && coords[0][1] === coords[lastIdx][1];
  const pts = isClosed ? coords.slice(0, -1) : coords;

  const sum = pts.reduce(
    (acc, [lon, lat]) => ({
      lon: acc.lon + lon,
      lat: acc.lat + lat,
    }),
    { lon: 0, lat: 0 }
  );

  return {
    lon: Number((sum.lon / pts.length).toFixed(6)),
    lat: Number((sum.lat / pts.length).toFixed(6)),
  };
}
