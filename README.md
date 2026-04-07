# Rain API

A Vercel serverless API for rainfall totals with **two query modes**:

- **Coordinate mode** via IEM Stage IV radar (`lat` + `lon`) — recommended for new integrations
- **Field mode** via AcreLedger Supabase RPC (`field_id`)

## Features

- **Coordinate queries**: `GET /rain?lat=...&lon=...`
- **Field queries**: `GET /rain?field_id=UUID&date=YYYY-MM-DD`
- **Flexible date selection**:
  - coordinate mode supports `days`, `date`, or `start_date` + `end_date`
  - field mode supports `date` or `start_date` (+ optional `end_date`)
- **IEM Stage IV integration** for direct radar-based rainfall lookup
- **Supabase RPC integration** for AcreLedger field rainfall lookup
- **CORS support** for browser use
- **Route aliases**: available at `/api/rain`, `/rain`, and `/rainfall`

## API Usage

### Coordinate mode (recommended)

Use direct coordinates when you want current radar-derived rainfall independent of AcreLedger backfill state.

```http
GET /rain?lat=38.4626783&lon=-93.5373719
GET /rain?lat=38.4626783&lon=-93.5373719&days=7
GET /rain?lat=38.4626783&lon=-93.5373719&date=2026-03-27
GET /rain?lat=38.4626783&lon=-93.5373719&start_date=2026-03-21&end_date=2026-03-28
```

**Coordinate response example:**

```json
{
  "mode": "iem",
  "location": { "lat": 38.4626783, "lon": -93.5373719 },
  "period": { "start": "2026-03-22", "end": "2026-03-28", "days": 7 },
  "rainfall": 0.22,
  "breakdown": {
    "2026-03-22": 0,
    "2026-03-23": 0,
    "2026-03-24": 0,
    "2026-03-25": 0,
    "2026-03-26": 0,
    "2026-03-27": 0.22,
    "2026-03-28": 0
  },
  "units": "inches",
  "source": "IEM Stage IV"
}
```

### Field mode (AcreLedger / Supabase)

Use `field_id` when you want rainfall totals for a known AcreLedger field from the Supabase-side rollup.

```http
GET /rain?field_id=550e8400-e29b-41d4-a716-446655440000&date=2026-03-27
GET /rain?field_id=2284c948-212e-4ffb-8bf9-4c11fd08edd7&start_date=2026-03-21&end_date=2026-03-28
```

**Field response example:**

```json
{
  "rainfall": 0.25
}
```

## Parameter rules

### Coordinate mode
- Required: `lat`, `lon`
- Optional:
  - `days` (default `7`, max `30`)
  - `date`
  - `start_date` and `end_date`
- Date resolution priority:
  1. `start_date` + `end_date`
  2. `date`
  3. `days`

### Field mode
- Required: `field_id` and either `date` or `start_date`
- Optional: `end_date` (defaults to `date` or `start_date`)

## Caching behavior

- **Coordinate mode**: short-lived edge caching (`s-maxage=300, stale-while-revalidate=60`)
- **Field mode**: no-store / no-cache to keep Supabase-backed results fresh

## Local Development

**Start the dev server:**

```bash
npm run dev
```

### Environment variables

Field mode requires:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Coordinate mode does not require Supabase credentials.

**Run the test suite** (dev server must be running in another terminal):

```bash
npx tsx tests/run-tests.ts
```

## Deployment

Push to `main` for automatic Vercel deployment.

For field mode in production, configure these Vercel environment variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

## Notes

- Coordinate mode uses the public IEM Stage IV endpoint and is generally the best default for new integrations.
- Field mode may return `0` when the AcreLedger rainfall pipeline has gaps; in that case, coordinate mode is the better cross-check.
- IEM Stage IV is CONUS-focused and may return `0` outside expected coverage.
