import { createClient } from '@supabase/supabase-js';
import { decode } from 'fast-png';
import axios from 'axios';
import { gunzipSync } from 'zlib';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

const MRMS_GRID = {
  latStart: 54.995,
  lonStart: -129.995,
  latStep: -0.01,
  lonStep: 0.01,
  rows: 3500,
  cols: 7000
};

async function getFields() {
  const { data, error } = await supabase.from('fields').select('id, lat, lng');
  if (error) throw error;
  return data;
}

function extractRainfall(data: Buffer, coords: any[]) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 16; 
    let section5: any = null;
    let section7Offset = -1;

    while (offset < data.length - 4) {
        if (data[offset] === 0x37 && data[offset+1] === 0x37 && data[offset+2] === 0x37 && data[offset+3] === 0x37) break;
        const sectLen = view.getInt32(offset);
        const sectNum = view.getUint8(offset + 4);

        if (sectNum === 5) {
            section5 = {
                ref: view.getFloat32(offset + 11),
                exp: view.getInt16(offset + 15),
                decimal: view.getInt16(offset + 17),
                bits: view.getUint8(offset + 19)
            };
        } else if (sectNum === 7) {
            section7Offset = offset + 5;
            break;
        }
        if (sectLen <= 0) break; 
        offset += sectLen;
    }

    if (!section5 || section7Offset === -1) return coords.map(() => 0);

    const { ref, exp, decimal } = section5;
    const pngData = data.slice(section7Offset);
    
    let pixels: any;
    try {
        const decoded = decode(pngData);
        pixels = decoded.data;
    } catch (e: any) {
        return coords.map(() => 0);
    }

    const multiplier = (Math.pow(2, exp) / Math.pow(10, decimal)) * 0.0393701; // mm to inches
    
    let rainCount = 0;
    const results = coords.map(coord => {
        const row = Math.round((MRMS_GRID.latStart - coord.lat) / Math.abs(MRMS_GRID.latStep));
        const col = Math.round((coord.lng - MRMS_GRID.lonStart) / MRMS_GRID.lonStep);
        if (row < 0 || row >= MRMS_GRID.rows || col < 0 || col >= MRMS_GRID.cols) return 0;
        const index = row * MRMS_GRID.cols + col;
        if (index >= pixels.length) return 0;
        const val = Math.max(0, (ref + pixels[index]) * multiplier);
        if (val > 0) rainCount++;
        return val;
    });
    return { results, rainCount };
}

async function backfill() {
  const fields = await getFields();
  console.log(`Starting backfill for ${fields.length} fields...`);

  // Start from March 21 (when data stopped)
  const startDate = new Date('2026-03-21T00:00:00Z');
  const endDate = new Date();

  for (let d = new Date(startDate); d <= endDate; d.setHours(d.getHours() + 1)) {
    const ts = new Date(d);
    ts.setMinutes(0, 0, 0);
    const tsIso = ts.toISOString();
    
    const Y = ts.getUTCFullYear();
    const M = String(ts.getUTCMonth() + 1).padStart(2, '0');
    const D = String(ts.getUTCDate()).padStart(2, '0');
    const H = String(ts.getUTCHours()).padStart(2, '0');
    
    const tsStr = `${Y}${M}${D}-${H}0000`;
    const archiveUrl = `https://mtarchive.geol.iastate.edu/${Y}/${M}/${D}/mrms/ncep/MultiSensor_QPE_01H_Pass2/MultiSensor_QPE_01H_Pass2_00.00_${tsStr}.grib2.gz`;
    const liveUrl = `https://mrms.ncep.noaa.gov/2D/MultiSensor_QPE_01H_Pass2/MRMS_MultiSensor_QPE_01H_Pass2_00.00_${tsStr}.grib2.gz`;

    try {
      let response;
      try {
          response = await axios.get(archiveUrl, { responseType: 'arraybuffer' });
      } catch (e) {
          response = await axios.get(liveUrl, { responseType: 'arraybuffer' });
      }

      const decompressed = gunzipSync(response.data);
      const { results: values, rainCount } = extractRainfall(Buffer.from(decompressed), fields);
      
      const records = fields.map((f, i) => ({
        field_id: f.id,
        timestamp_utc: tsIso,
        rainfall_in: parseFloat(values[i].toFixed(4)), // Limit precision for DB
        source: 'Pass 2',
        finalized: true
      }));

      const { error } = await supabase.from('field_rainfall_hourly').upsert(records, { onConflict: 'field_id, timestamp_utc' });
      if (error) console.error(`[${tsIso}] DB Error:`, error.message);
      else console.log(`[${tsIso}] Processed. Rain found in ${rainCount} fields.`);
      
    } catch (err: any) {
      console.log(`[${tsIso}] Skipped: ${err.message}`);
    }
  }
  console.log('Backfill complete!');
}

backfill();
