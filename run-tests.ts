import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('--- Rain API Test Suite (Node.js Runner) ---');

  const tests = [
    { name: 'TEST A - Iowa farmland', url: '/rain?lat=42.03&lon=-93.62' },
    { name: 'TEST B - Kansas City', url: '/rain?lat=39.0997&lon=-94.5786&tz=America/Chicago' },
    { name: 'TEST C - Seattle', url: '/rain?lat=47.6062&lon=-122.3321&tz=America/Los_Angeles' },
    { name: 'TEST D - Miami', url: '/rain?lat=25.7617&lon=-80.1918' },
    { name: 'TEST E - Historical asOf (exact)', url: '/rain?lat=42.03&lon=-93.62&asOf=2026-03-10T14:00:00Z' },
    { name: 'TEST F - Historical asOf (mid-hour)', url: '/rain?lat=42.03&lon=-93.62&asOf=2026-03-10T01:37:00Z' },
    { name: 'TEST I - Non-CONUS point', url: '/rain?lat=51.5074&lon=-0.1278', expectedStatus: 404 },
  ];

  for (const t of tests) {
    try {
      const res = await axios.get(`${BASE_URL}${t.url}`, { validateStatus: () => true });
      console.log(`${t.name}: status ${res.status} ${res.status === (t.expectedStatus || 200) ? '✅' : '❌'}`);
      if (res.status === 200) {
          console.log(`  Rain (72h): ${res.data.rain?.['72h']} in / ${res.data.rainMm?.['72h']} mm`);
      }
    } catch (err: any) {
      console.log(`${t.name}: FAILED - ${err.message} ❌`);
    }
  }

  // Polygon Tests
  const polygon = [
    [-93.65, 42.02],
    [-93.60, 42.02],
    [-93.60, 42.05],
    [-93.65, 42.05],
    [-93.65, 42.02]
  ];

  console.log('TEST G - Polygon input');
  try {
    const resG = await axios.post(`${BASE_URL}/rain`, { polygon }, { validateStatus: () => true });
    console.log(`  Status ${resG.status} ${resG.status === 200 ? '✅' : '❌'}`);
    console.log(`  Centroid: ${resG.data.location?.centroidLat}, ${resG.data.location?.centroidLon}`);
  } catch (err: any) {
    console.log(`  FAILED - ${err.message} ❌`);
  }

  console.log('TEST H - GeoJSON polygon');
  const geojson = {
    type: 'Polygon',
    coordinates: [polygon]
  };
  try {
    const resH = await axios.post(`${BASE_URL}/rain`, geojson, { validateStatus: () => true });
    console.log(`  Status ${resH.status} ${resH.status === 200 ? '✅' : '❌'}`);
    console.log(`  Centroid (must match G): ${resH.data.location?.centroidLat}, ${resH.data.location?.centroidLon}`);
  } catch (err: any) {
    console.log(`  FAILED - ${err.message} ❌`);
  }
}

runTests();
