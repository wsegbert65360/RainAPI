import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

async function check() {
    console.log('--- Database Check ---');
    const fieldId = '2284c948-212e-4ffb-8bf9-4c11fd08edd7';
    const apiUrl = `https://rain-api.vercel.app/rain?field_id=${fieldId}&start_date=2026-03-24&end_date=2026-03-27`;
    console.log(`\n--- Fetching Live API: ${apiUrl} ---`);
    const apiRes = await fetch(apiUrl);
    const apiData = await apiRes.json();
    console.log('API Response:', JSON.stringify(apiData, null, 2));
    
    if (apiData.rainfall > 0) {
        console.log('SUCCESS: API is now returning non-zero rainfall!');
    } else {
        console.log('STILL ZERO: API is still returning 0. Check RPC or caching again.');
    }

    console.log('\n--- Triggering Daily Rollups ---');
    const start = new Date('2026-03-21');
    const today = new Date();
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        console.log(`Rolling up ${dateStr}...`);
        const { error } = await supabase.rpc('rollup_all_farms_daily', { p_date: dateStr });
        if (error) console.error(`Error rolling up ${dateStr}:`, error.message);
    }
    console.log('Rollups complete!');
}

check();
