import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseURL = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseURL || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

const supabase = createClient(supabaseURL, supabaseKey);

async function run() {
  const { data, error } = await supabase.from('fields').select('id, name, lat, lng, boundary').limit(10);
  if (error) {
    console.error('ERROR:', error);
  } else {
    console.log('FIELDS_COUNT:', data?.length);
    data?.forEach(f => {
      console.log(`FIELD: ${f.name} ID: ${f.id} LAT: ${f.lat} LNG: ${f.lng}`);
    });
  }
}

run().catch(console.error);
