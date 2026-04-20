import { createClient } from '@supabase/supabase-js';

const supabaseURL = 'https://rtzqswxscfubpkyuoczu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0enFzd3hzY2Z1YnpreXVvY3p1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxMDMwNDY1MSwiZXhwIjoyMDM2MjgwNjUxfQ.7A7xS5iKj6v9u42_Lw3a129e2AtDWmPVmPR0GO7sA';

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
