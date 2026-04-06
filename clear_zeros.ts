import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

async function clear() {
    console.log('Clearing zero-value rainfall data since March 20...');
    const { count, error } = await supabase.from('field_rainfall_hourly')
        .delete({ count: 'exact' })
        .gt('timestamp_utc', '2026-03-20T00:00:00Z')
        .eq('rainfall_in', 0);
    
    if (error) console.error('Error clearing data:', error.message);
    else console.log(`Deleted ${count} zero-value records.`);
}

clear();
