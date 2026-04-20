import { fetchIemDay } from './lib/iem';

async function run() {
  const lat = 42.03;
  const lon = -93.63;
  const now = new Date();
  
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    const dateStr = d.toISOString().split('T')[0];
    console.log(`Checking IEM for ${dateStr}...`);
    const data = await fetchIemDay(lat, lon, dateStr);
    console.log(`  Records: ${data.size}`);
    if (data.size > 0) {
      const sum = Array.from(data.values()).reduce((a, b) => a + b, 0);
      console.log(`  Sum: ${sum.toFixed(3)} in`);
    } else {
        console.log(`  WARNING: No data found for ${dateStr}`);
    }
  }
}

run().catch(console.error);
