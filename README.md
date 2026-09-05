# Rain API

A Vercel serverless API providing rainfall totals (12h, 24h, 72h, 168h) from IEM Stage IV radar data for any CONUS location. Also supports field-level queries via AcreLedger Supabase.

## Features

- **Coordinate Lookup**: `GET /rain?lat=...&lon=...` — IEM Stage IV radar data
- **Polygon Lookup**: `POST /rain` with polygon body — computes centroid, queries IEM
- **Field Lookup**: `GET /rain?lat=...&lon=...&field_id=UUID` — merges IEM + Supabase (MAX)
- **Custom Date Range**: `GET /rain?field_id=UUID&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` — single rainfall total for any date range (field ID required)
- **Timezone Aware**: Optional `tz` and `asOf` parameters for custom lookback windows
- **CORS Support**: Accessible from browser contexts
- **No API Key Required**: Coordinate/polygon modes work with zero environment variables

## API Usage

### Coordinate Lookup

```http
GET /rain?lat=38.5319&lon=-93.5331
GET /rain?lat=38.5319&lon=-93.5331&tz=America/Chicago
GET /rain?lat=38.5319&lon=-93.5331&asOf=2026-04-17T06:00:00Z
```

### Polygon Lookup

```http
POST /rain
Content-Type: application/json

{"polygon": [[-93.65, 42.02], [-93.60, 42.02], [-93.60, 42.05], [-93.65, 42.05], [-93.65, 42.02]]}
```

### Custom Date Range (field_id required)

```http
GET /rain?field_id=550e8400-e29b-41d4-a716-446655440000&start_date=2026-04-01&end_date=2026-04-15
```

Response:

```json
{
  "location": { "type": "point", "lat": 38.5319, "lon": -93.5331, "fieldId": "550e8400-..." },
  "periodEndUtc": "2026-04-20T12:00:00.000Z",
  "units": "in",
  "rain": { "total": 1.47 },
  "rainMm": { "total": 37.34 }
}
```

### Response Format

```json
{
  "location": { "type": "point", "lat": 38.5319, "lon": -93.5331, "fieldId": null },
  "periodEndUtc": "2026-04-20T12:00:00.000Z",
  "units": "in",
  "rain": { "12h": 0.0, "24h": 0.0, "72h": 2.32, "168h": 3.84 },
  "rainMm": { "12h": 0.0, "24h": 0.0, "72h": 58.93, "168h": 97.54 }
}
```

## Local Development

**Start the dev server**:

```powershell
npm run dev
```

*Note: Requires `SUPABASE_URL` and `SUPABASE_ANON_KEY` environment variables in `.env` (only needed for field ID mode).*

**Run the test suite** (dev server must be running in another terminal):

```powershell
npx tsx tests/run-tests.ts
```

**Type-check**:

```powershell
npm run typecheck
```

## Deployment

Push to `main` branch for automatic Vercel deployment. Ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_ANON_KEY`) are configured in the Vercel project settings if field ID mode is needed.
