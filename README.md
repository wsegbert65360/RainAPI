# Rain API

A Vercel serverless API providing rainfall totals (12h, 24h, 72h, 168h) from IEM Stage IV radar data for any CONUS location. Also supports field-level queries via AcreLedger Supabase.

## Features

- **Coordinate Lookup**: `GET /rain?lat=...&lon=...` — IEM Stage IV radar data
- **Polygon Lookup**: `POST /rain` with polygon body — computes centroid, queries IEM
- **Field Lookup**: `GET /rain?lat=...&lon=...&field_id=UUID` — merges IEM + Supabase (MAX)
- **Custom Date Range**: `GET /rain?field_id=UUID&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` — single rainfall total for any date range (field ID required)
- **Timezone Aware**: Optional `tz` and `asOf` parameters for custom lookback windows
- **CORS Support**: Browser callers may send `Authorization` (`Access-Control-Allow-Headers` includes it)
- **Sign-in required**: Every data request needs `Authorization: Bearer <Supabase access token>`. See [Access gate](#access-gate).

## API Usage

### Coordinate Lookup

```http
GET /rain?lat=38.5319&lon=-93.5331
Authorization: Bearer <Supabase access token>
```

`tz` and `asOf` are optional (`tz=America/Chicago`, `asOf=2026-04-17T06:00:00Z`).

### Polygon Lookup

```http
POST /rain
Authorization: Bearer <Supabase access token>
Content-Type: application/json

{"polygon": [[-93.65, 42.02], [-93.60, 42.02], [-93.60, 42.05], [-93.65, 42.05], [-93.65, 42.02]]}
```

### Custom Date Range (field_id required)

```http
GET /rain?field_id=550e8400-e29b-41d4-a716-446655440000&start_date=2026-04-01&end_date=2026-04-15
Authorization: Bearer <Supabase access token>
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

*Note: Data requests need `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`. Without them the handler returns 503 and does not serve rainfall.*

**Run the test suite** (dev server must be running in another terminal):

```powershell
npx tsx tests/run-tests.ts
```

**Type-check**:

```powershell
npm run typecheck
```

## Deployment

Push to `main` branch for automatic Vercel deployment. Do that only after the [deploy order](#deploy-order) checks. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must already be set on the Rain API project. Without either one, every data request returns `503`.

## Security notes

- `.env.vercel` (Vercel CLI `VERCEL_OIDC_TOKEN`) was committed in early history. The token **expired on 2026-03-28** and the file is now untracked and gitignored. Refresh with `vercel env pull`; never commit `.env*` files.
- Data routes require a signed-in Supabase user. A request with no token, or with a token the auth server rejects, gets `401` and no rainfall. A field UUID alone is not enough to read that field's stored totals.
- The API reads Supabase with the service-role key. Do not log that key or bearer tokens. Denial logs are reason, status, and field id only.
- Rolling-window database totals are exact-hour sums of `field_rainfall_hourly` (finalized or Pass 2 rows), with the `get_rainfall_stats` RPC as fallback. Those reads run only after the access check allows the request.
- Successful data responses send `Cache-Control: private, no-store` and `Vary: Authorization`.

## Access gate

Sign-in is always required on GET and POST, including custom date ranges and the path that returns stored totals. There is no mode that serves rainfall without a successful allow decision.

`RAIN_API_AUTH` does not turn the gate off.

| Value | Behavior |
|---|---|
| Unset, empty, `off`, `enforce`, or anything else | Enforce. A denial is logged and returned. No rainfall is served. |
| `log` | Same rejection and the same denial log, with `mode` set to `log`. The request is still rejected. |

What an allow requires:

1. `Authorization: Bearer <Supabase access token>`, checked with `auth.getUser(token)` on the service-role client. Missing or invalid token: `401` `{ "error": "Sign in required" }`.
2. When `field_id` is present: the field exists, `fields.deleted_at` is null, and `profiles.farm_id` for the signed-in user equals `fields.farm_id`. Otherwise `403` `{ "error": "Field not found for this farm" }`. The lookup is `id, farm_id, lat, lng, deleted_at` from `fields`.
3. When `field_id` is present: the request point (`lat`/`lon`, or the POST polygon centroid) is within 10 km (haversine) of that field's stored `lat`/`lng`. No stored coordinates, or a point farther than 10 km: `403` `{ "error": "Coordinates do not match this field" }`. A `field_id` request with no coordinates (custom date range) uses the field's stored coordinates for the IEM lookup.
4. When `field_id` is present: `rainfall_field_hourly_allowed(p_field_id)` must return true. That function is true for Pro and complimentary farms, and for every farm while entitlements are not enforced. False (a free farm): `403` `{ "error": "premium_required:rainfall" }`.
5. When `field_id` is absent (a GPS point or a drawn boundary): the caller still needs a valid JWT and a farm. If entitlements are enforced and the farm is on the free plan, the response is `403` `{ "error": "premium_required:rainfall" }`. This path does not skip sign-in.

The check fails closed. If the Supabase client is not configured, `getUser` throws or returns a 5xx or transport error, or a profile, field, or RPC lookup fails, the response is `503` `{ "error": "Rainfall access check unavailable" }`. Nothing from IEM or the rainfall tables is returned. That is true for `log` and for an unset `RAIN_API_AUTH`.

Denial logs are JSON (`event`, `mode`, `reason`, `status`, `fieldId`) via `console.warn`. Tokens and secrets are never logged. CORS allows the `Authorization` header.

### Environment variables

Both are required for every data request. If either is missing, the handler returns `503` instead of rainfall.

| Variable | Required |
|---|---|
| `SUPABASE_URL` | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes |

The service-role key is what calls `auth.getUser`, `rainfall_field_hourly_allowed`, and `get_rainfall_stats`, and what reads `profiles` and `fields`. Apply AcreLedger migration `20261107060000_rainfall_hourly_field_allowed.sql` before deploy so the entitlement RPC exists. If that function is missing, requests get `503`.

`RAIN_API_AUTH` is optional. Leaving it unset enforces sign-in. Do not set it to `off` expecting the old open behavior. `off` is enforced too.

### Deploy order

The AcreLedger web app on main already sends `Authorization: Bearer <Supabase access token>` on every rainfall call, and it sends `field_id`. Confirm two things before this API revision is deployed. There is no `log` or `off` stage that still returns rainfall to anonymous callers.

1. Confirm the Rain API project already has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. If either is missing, every data request returns `503` after deploy.
2. Confirm the iPhone build that users actually have sends the bearer token. The last recorded App Store/TestFlight build is 3.6.1 (Nov 3). The login header landed later in the free-tier work (Nov 12). An older iPhone build that omits the token will get `401` and lose rainfall. Web callers that send the token keep working.

Deploy only after those checks. Anonymous calls that today return stored totals will get `401`. Signed-in app calls continue when they send the token and the Supabase env is set.