# Rain API

A Vercel serverless API providing rainfall totals (12h, 24h, 72h, 168h) from IEM Stage IV radar data for any CONUS location. Also supports field-level queries via AcreLedger Supabase.

## Features

- **Coordinate Lookup**: `GET /rain?lat=...&lon=...` — IEM Stage IV radar data
- **Polygon Lookup**: `POST /rain` with polygon body — computes centroid, queries IEM
- **Field Lookup**: `GET /rain?lat=...&lon=...&field_id=UUID` — merges IEM + Supabase (MAX)
- **Custom Date Range**: `GET /rain?field_id=UUID&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` — single rainfall total for any date range (field ID required)
- **Timezone Aware**: Optional `tz` and `asOf` parameters for custom lookback windows
- **CORS Support**: Accessible from browser contexts
- **No API Key Required by default**: Coordinate and polygon modes work with zero environment variables while `RAIN_API_AUTH` is `off` (the default). See [Access gate](#access-gate-rain_api_auth).

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

Push to `main` branch for automatic Vercel deployment. Field ID mode needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the Vercel project settings. Leave `RAIN_API_AUTH` unset so the access gate stays `off` until the deploy order below.

## Access gate (RAIN_API_AUTH)

AcreLedger's free tier does not use this API for hourly rainfall. Free farms read daily totals from AcreLedger's own database. Pro and complimentary farms may use this API, and so may every farm while the app's `ENTITLEMENTS_MODE` is not `enforce`. The gate stays off until you set it. Unset or any value other than `log` or `enforce` means `off`.

| Value | Behavior |
|---|---|
| `off` (default) | No check. Coordinate-only, polygon, and field requests behave exactly as they do today. Old and new app builds work. |
| `log` | Computes the same decision as `enforce`, writes one `rain_auth_denied` JSON line for each would-be denial, and still serves the request. |
| `enforce` | Applies the decision. A denial returns no rainfall data. |

What `enforce` requires, on GET and POST, including custom date ranges:

1. `Authorization: Bearer <Supabase access token>`, checked with `auth.getUser(token)` on the service-role client. Missing or invalid token: `401` `{ "error": "Sign in required" }`.
2. `field_id` on every request. Coordinate-only or polygon-only calls: `400` `{ "error": "field_id required" }`.
3. The field exists, `fields.deleted_at` is null, and `profiles.farm_id` for the signed-in user equals `fields.farm_id`. Otherwise `403` `{ "error": "Field not found for this farm" }`. The lookup is `id, farm_id, lat, lng, deleted_at` from `fields`.
4. The request point (`lat`/`lon`, or the POST polygon centroid) is within 10 km (haversine) of that field's stored `lat`/`lng`. No stored coordinates, or a point farther than 10 km: `403` `{ "error": "Coordinates do not match this field" }`. A `field_id` request with no coordinates (custom date range) uses the field's stored coordinates for the IEM lookup.
5. `rainfall_field_hourly_allowed(p_field_id)` must return true. That function is true for Pro and complimentary farms, and for every farm while entitlements are not enforced. False (a free farm): `403` `{ "error": "premium_required:rainfall" }`.

`enforce` fails closed. If the Supabase client is not configured, `getUser` throws or returns a 5xx or transport error, or a profile, field, or RPC lookup fails, the response is `503` `{ "error": "Rainfall access check unavailable" }`. Nothing from IEM or the rainfall tables is returned. In `log`, that same denial is logged and the request is served as it would be with the gate off. In `off`, the gate does not run.

Denial logs are JSON (`event`, `mode`, `reason`, `status`, `fieldId`) via `console.warn`. Tokens and secrets are never logged. CORS allows the `Authorization` header.

### Environment variables

`log` and `enforce` need both of these. Field lookups already use them for `get_rainfall_stats`.

| Variable | `off` | `log` and `enforce` |
|---|---|---|
| `SUPABASE_URL` | Only for field ID mode | Required |
| `SUPABASE_SERVICE_ROLE_KEY` | Only for field ID mode | Required |

Apply AcreLedger migration `20261107060000_rainfall_hourly_field_allowed.sql` before turning the gate on. The service-role key is what calls `rainfall_field_hourly_allowed` and reads `profiles` and `fields`.

### App version and deploy order

AcreLedger **3.6.1** (the free-tier `RainService` build) sends `field_id` and `Authorization: Bearer <Supabase access token>` on rainfall requests. Older builds omit the token and can omit `field_id`.

1. Deploy this API with `RAIN_API_AUTH=log`. Leave it unset to keep the default `off`.
2. Ship AcreLedger 3.6.1 so clients send `field_id` and the access token.
3. Watch the `rain_auth_denied` logs.
4. Set `RAIN_API_AUTH=enforce` only after those logs look right.

Do not set `enforce` before that app build is what callers use. `enforce` rejects coordinate-only calls and any request without a valid token.