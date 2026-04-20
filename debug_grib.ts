import { decode } from 'fast-png';
import axios from 'axios';
import { gunzipSync } from 'zlib';

async function debug() {
    const url = 'https://mtarchive.geol.iastate.edu/2026/03/27/mrms/ncep/MultiSensor_QPE_01H_Pass2/MultiSensor_QPE_01H_Pass2_00.00_20260327-180000.grib2.gz';
    console.log(`Fetching ${url}...`);
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const data = gunzipSync(response.data);
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

    if (!section5 || section7Offset === -1) {
        console.error('Failed to find sections');
        return;
    }

    const pngData = data.slice(section7Offset);
    try {
        const decoded = decode(pngData);
        const pixels = decoded.data;
        const { ref, exp, decimal } = section5;
        const multiplier = (Math.pow(2, exp) / Math.pow(10, decimal)) * 0.0393701;

        const MRMS_GRID = {
            latStart: 54.995,
            lonStart: -129.995,
            latStep: -0.01,
            lonStep: 0.01,
            rows: 3500,
            cols: 7000
        };

        const fields = [
            { name: "Shoemaker/Bottom", lat: 40.063, lng: -88.002 },
            { name: "Behind Grandma", lat: 40.065, lng: -87.998 }
        ];

        console.log('\n--- Field Checks (March 27 18:00 UTC) ---');
        for (const f of fields) {
            const row = Math.round((MRMS_GRID.latStart - f.lat) / Math.abs(MRMS_GRID.latStep));
            const col = Math.round((f.lng - MRMS_GRID.lonStart) / MRMS_GRID.lonStep);
            const index = row * MRMS_GRID.cols + col;
            const raw = (pixels as any)[index];
            const rain = Math.max(0, (ref + raw) * multiplier);
            console.log(`${f.name}: row=${row}, col=${col}, raw=${raw}, rain_in=${rain.toFixed(4)}`);
        }

    } catch (e: any) {
        console.error("PNG Decoding failed: " + e.message);
    }
}

debug();
