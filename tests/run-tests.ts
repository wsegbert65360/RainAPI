import axios from 'axios';
import 'dotenv/config';

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('--- Rain API Test Suite (Supabase Refactor) ---');

  const tests = [
    { 
      name: 'TEST A - Field Rainfall (Past Date)', 
      url: '/rain?field_id=550e8400-e29b-41d4-a716-446655440000&date=2026-03-20' 
    },
    { 
      name: 'TEST B - Field Rainfall (Today)', 
      url: `/rain?field_id=550e8400-e29b-41d4-a716-446655440000&date=${new Date().toISOString().split('T')[0]}` 
    },
    { 
      name: 'TEST C - Missing field_id', 
      url: '/rain?date=2026-03-27', 
      expectedStatus: 400 
    },
    { 
      name: 'TEST D - Missing date', 
      url: '/rain?field_id=550e8400-e29b-41d4-a716-446655440000', 
      expectedStatus: 400 
    },
  ];

  for (const t of tests) {
    try {
      const res = await axios.get(`${BASE_URL}${t.url}`, { validateStatus: () => true });
      const statusMatch = res.status === (t.expectedStatus || 200);
      console.log(`${t.name}: status ${res.status} ${statusMatch ? '✅' : '❌'}`);
      
      if (res.status === 200) {
          console.log(`  Rainfall: ${res.data.rainfall} total_in`);
          console.log(`  Cache-Control: ${res.headers['cache-control']}`);
      } else {
          console.log(`  Error: ${res.data.error} - ${res.data.detail}`);
      }
    } catch (err: any) {
      console.log(`${t.name}: FAILED - ${err.message} ❌`);
    }
  }

  console.log('\n--- Test Suite Complete ---');
}

runTests();
