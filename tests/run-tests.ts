import axios from 'axios';
import 'dotenv/config';

const BASE = 'http://localhost:3000';
const LAT = 38.4626783;
const LON = -93.5373719;

async function run() {
  console.log('=== Rain API - Lat/Lon Mode Test ===');
  console.log(`Target: lat=${LAT}, lon=${LON}\n`);

  const tests = [
    {
      name: 'TEST 1 - Last 7 days (default)',
      url: `/rain?lat=${LAT}&lon=${LON}`,
    },
    {
      name: 'TEST 2 - Explicit days=7',
      url: `/rain?lat=${LAT}&lon=${LON}&days=7`,
    },
    {
      name: 'TEST 3 - Single date (2026-03-27, expected 0.22")',
      url: `/rain?lat=${LAT}&lon=${LON}&date=2026-03-27`,
    },
    {
      name: 'TEST 4 - Date range start/end',
      url: `/rain?lat=${LAT}&lon=${LON}&start_date=2026-03-22&end_date=2026-03-28`,
    },
    {
      name: 'TEST 5 - Bad lat (400 expected)',
      url: `/rain?lat=999&lon=${LON}`,
      expectStatus: 400,
    },
    {
      name: 'TEST 6 - No params (400 expected)',
      url: `/rain`,
      expectStatus: 400,
    },
  ];

  for (const t of tests) {
    try {
      const res = await axios.get(`${BASE}${t.url}`, { validateStatus: () => true });
      const ok = res.status === (t.expectStatus || 200);
      console.log(`${ok ? '✅' : '❌'} ${t.name}`);
      console.log(`   Status: ${res.status}`);
      if (res.status === 200) {
        const d = res.data;
        console.log(`   Rainfall: ${d.rainfall}" over ${d.period?.days} day(s)`);
        if (d.breakdown) {
          const rainyDays = Object.entries(d.breakdown)
            .filter(([, v]) => (v as number) > 0)
            .map(([k, v]) => `${k}:${v}"`);
          console.log(`   Days with rain: ${rainyDays.length > 0 ? rainyDays.join(', ') : 'none'}`);
        }
      } else {
        console.log(`   Response: ${JSON.stringify(res.data)}`);
      }
    } catch (e: any) {
      console.log(`❌ ${t.name}: FAILED - ${e.message}`);
    }
    console.log();
  }

  console.log('=== Done ===');
}

run();
