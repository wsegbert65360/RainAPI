import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const TARGET_LAT = 38.4626783;
const TARGET_LON = -93.5373719;

const today = new Date();
const startDate = new Date(today);
startDate.setDate(today.getDate() - 6);

const p_start = startDate.toISOString().split('T')[0];
const p_end = today.toISOString().split('T')[0];

async function step(label: string, fn: () => Promise<void>) {
  process.stdout.write(`\n[${label}]\n`);
  try { await fn(); } catch(e: any) { process.stdout.write(`ERROR: ${e.message}\n`); }
}

async function main() {
  process.stdout.write(`Rain API Coordinate Diagnostic\n`);
  process.stdout.write(`Lat: ${TARGET_LAT}  Lon: ${TARGET_LON}\n`);
  process.stdout.write(`Range: ${p_start} to ${p_end}\n`);

  // Step 1: find field
  let fieldId: string | null = null;
  let fieldName: string | null = null;

  await step('1. Find field by coordinates', async () => {
    const { data, error } = await supabase.from('fields').select('id,name,latitude,longitude');
    if (error) { process.stdout.write(`fields query failed: ${error.message}\n`); return; }
    if (!data || data.length === 0) { process.stdout.write(`No fields in table\n`); return; }
    
    const closest = data.reduce((best: any, f: any) => {
      const dist = Math.hypot((f.latitude||0) - TARGET_LAT, (f.longitude||0) - TARGET_LON);
      return (!best || dist < best.dist) ? { ...f, dist } : best;
    }, null);

    fieldId = closest.id;
    fieldName = closest.name;
    const miles = (closest.dist * 69).toFixed(2);
    process.stdout.write(`Closest field: "${fieldName}" id=${fieldId}\n`);
    process.stdout.write(`Field coords: lat=${closest.latitude} lon=${closest.longitude}\n`);
    process.stdout.write(`Distance: ~${miles} miles\n`);
  });

  if (!fieldId) {
    process.stdout.write(`\nFATAL: Cannot proceed without a field_id.\n`);
    process.stdout.write(`Check that the 'fields' table exists and has lat/lon columns.\n`);
    return;
  }

  // Step 2: RPC rainfall stats
  await step('2. RPC get_rainfall_stats (7-day total)', async () => {
    const { data, error } = await supabase.rpc('get_rainfall_stats', {
      p_field_id: fieldId,
      p_start_date: p_start,
      p_end_date: p_end,
    });
    if (error) { process.stdout.write(`RPC error: ${error.message}\n`); return; }
    const total = data && data[0] ? data[0].total_inches : 0;
    process.stdout.write(`7-day total: ${total} inches\n`);
    process.stdout.write(total > 0 ? 'RAIN DETECTED\n' : 'WARNING: 0 inches returned\n');
    if (data) process.stdout.write(`Raw: ${JSON.stringify(data)}\n`);
  });

  // Step 3: Raw hourly records
  await step('3. Raw rainfall_hourly records', async () => {
    const { data, error } = await supabase
      .from('rainfall_hourly')
      .select('recorded_at,inches')
      .eq('field_id', fieldId)
      .gte('recorded_at', p_start)
      .lte('recorded_at', p_end + 'T23:59:59')
      .order('recorded_at', { ascending: false })
      .limit(30);
    
    if (error) { process.stdout.write(`hourly error: ${error.message}\n`); return; }
    const rows = data || [];
    const nonZero = rows.filter((r: any) => r.inches > 0);
    process.stdout.write(`Rows in range: ${rows.length} total, ${nonZero.length} with rain\n`);
    nonZero.slice(0, 15).forEach((r: any) => {
      process.stdout.write(`  ${r.recorded_at}: ${r.inches}"\n`);
    });
  });

  // Step 4: Production API call
  await step('4. Production API (rain-api.vercel.app)', async () => {
    const url = `https://rain-api.vercel.app/rain?field_id=${fieldId}&start_date=${p_start}&end_date=${p_end}`;
    process.stdout.write(`GET ${url}\n`);
    const resp = await fetch(url);
    const json: any = await resp.json();
    process.stdout.write(`Status: ${resp.status}\n`);
    process.stdout.write(`Response: ${JSON.stringify(json)}\n`);
    process.stdout.write(json.rainfall > 0 ? 'PASS: prod API sees rain\n' : 'FAIL: prod API is returning 0\n');
  });

  process.stdout.write(`\nDone.\n`);
}

main().catch(e => process.stdout.write(`FATAL: ${e.message}\n`));
