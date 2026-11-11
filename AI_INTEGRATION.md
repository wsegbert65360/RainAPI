# Rain API Integration Guide for AI Agents

This document provides all the technical details necessary for an AI coding agent to integrate the **Rain API** into a larger system.

## Overview

The Rain API is a Vercel serverless function that provides rainfall totals (12h, 24h, 72h, 168h windows) for a given location or field. It supports **four independent query modes**:

| Mode | Method | Input | Data Source |
|------|--------|-------|-------------|
| **Coordinate lookup** | `GET` | `lat` + `lon` | IEM Stage IV radar (direct, always current) |
| **Polygon lookup** | `POST` | `polygon` body | IEM Stage IV radar (centroid computed, then queried) |
| **Field ID lookup** | `GET` or `POST` | `field_id` | AcreLedger Supabase RPC `get_rainfall_stats` |
| **Custom date range** | `GET` | `field_id` OR `lat`/`lon` + `start_date` + `end_date` | Hybrid: IEM radar + Supabase historical data (MAX of both) |

When both coordinate and `field_id` inputs are provided, results are merged (MAX of both sources).

> **Recommended for new integrations:** Use **coordinate mode** (`lat`/`lon`). It queries IEM Stage IV directly and is not dependent on the Supabase ingestion pipeline being up to date.

## Core Components

- **`api/rain.ts`**: The main entry point and request handler.
- **IEM Stage IV**: `https://mesonet.agron.iastate.edu/json/stage4.py` — radar-derived hourly precipitation for any CONUS point.
- **Supabase RPC**: `get_rainfall_stats(p_field_id, p_start_date, p_end_date)` — pre-aggregated field data from AcreLedger.

---

## API Documentation

### Base URL

```
https://rain-api.vercel.app
```

Available at `/api/rain`, `/rain`, and `/rainfall` (all route to the same handler via `vercel.json`).

---

### Mode A: Coordinate Lookup (GET)

Fetch rainfall for a GPS coordinate. Queries IEM Stage IV directly.

**Endpoint:** `GET /rain`

**Query Parameters:**

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `lat` | number | **Yes** | Latitude in decimal degrees (-90 to 90) |
| `lon` | number | **Yes** | Longitude in decimal degrees (-180 to 180) |
| `tz` | string | No | IANA timezone (e.g. `America/Chicago`). Affects how lookback windows are calculated. Default: `UTC`. |
| `asOf` | string | No | ISO 8601 timestamp to treat as "now". Otherwise uses current time. |
| `field_id` | string (UUID) | No | AcreLedger field UUID. When provided, Supabase data is merged with IEM (MAX of both). |

**Examples:**

```http
GET /rain?lat=38.5319&lon=-93.5331
GET /rain?lat=38.5319&lon=-93.5331&tz=America/Chicago
GET /rain?lat=38.5319&lon=-93.5331&asOf=2026-04-17T06:00:00Z
```

---

### Mode B: Polygon Lookup (POST)

Fetch rainfall for a field boundary. Computes the centroid and queries IEM Stage IV at that point.

**Endpoint:** `POST /rain`

**Content-Type:** `application/json`

**Body — coordinate array:**

```json
{
  "polygon": [[-93.65, 42.02], [-93.60, 42.02], [-93.60, 42.05], [-93.65, 42.05], [-93.65, 42.02]]
}
```

**Body — GeoJSON polygon:**

```json
{
  "type": "Polygon",
  "coordinates": [[[-93.65, 42.02], [-93.60, 42.02], [-93.60, 42.05], [-93.65, 42.05], [-93.65, 42.02]]]
}
```

**Query parameters** (`tz`, `asOf`, `field_id`) can also be passed on POST requests.

---

### Mode C: Field ID Lookup (Supabase)

Fetch rainfall for a specific AcreLedger field. Combine with `lat`/`lon` to merge radar and database data (recommended; AcreLedger does this). Used alone, only database totals are returned and `rain.12h` is `0` because the database fallback has no 12h window.

Database windows are summed over **exact hourly windows** from `field_rainfall_hourly` (rows with `finalized = true` or `source = 'Pass 2'`): a row stamped at `periodEndUtc - i hours` counts toward every window longer than `i` hours. If the hourly query fails, the API falls back to calendar-day totals from the `get_rainfall_stats` RPC.

**Query Parameters:**

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `field_id` | string (UUID) | **Yes** | The AcreLedger field UUID |

---

### Mode D: Custom Date Range

Fetch total rainfall for a specific field or coordinate over a custom date range. Performs a hybrid merge (MAX) of IEM radar and Supabase data if both a coordinate/polygon and `field_id` are provided.

**Endpoint:** `GET /rain`

**Query Parameters:**

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `start_date` | string (YYYY-MM-DD) | **Yes** | Start of the date range (inclusive) |
| `end_date` | string (YYYY-MM-DD) | No | End of the date range (inclusive). Defaults to period end. |
| `field_id` | string (UUID) | No* | The AcreLedger field UUID. |
| `lat` / `lon` | number | No* | Coordinates for radar data. |

*\*Requires at least `field_id` or `lat`/`lon`.*

**Example:**

```http
GET /rain?field_id=550e8400-e29b-41d4-a716-446655440000&start_date=2026-03-15&end_date=2026-04-21
```

**Response — custom date range differs from standard response:**

```json
{
  "location": {
    "type": "point",
    "lat": 38.5319,
    "lon": -93.5331,
    "fieldId": "550e8400-e29b-41d4-a716-446655440000"
  },
  "periodEndUtc": "2026-04-21T12:00:00.000Z",
  "units": "in",
  "rain": {
    "total": 1.47
  },
  "rainMm": {
    "total": 37.34
  }
}
```

> **Important:** The custom range response uses `rain.total` and `rainMm.total` instead of the standard `12h/24h/72h/168h` keys. Integrators must check for `data.rain.total` (not `data.rainfall`).

---

## Response Schema

**Success (200):**

```json
{
  "location": {
    "type": "point",
    "lat": 38.5319,
    "lon": -93.5331,
    "fieldId": null
  },
  "periodEndUtc": "2026-04-20T12:00:00.000Z",
  "units": "in",
  "rain": {
    "12h": 0.00,
    "24h": 0.00,
    "72h": 2.32,
    "168h": 3.84
  },
  "rainMm": {
    "12h": 0.00,
    "24h": 0.00,
    "72h": 58.93,
    "168h": 97.54
  }
}
```

For polygon requests, `location` uses `centroidLat`/`centroidLon` instead of `lat`/`lon`:

```json
{
  "location": {
    "type": "polygon",
    "centroidLat": 42.035,
    "centroidLon": -93.625,
    "fieldId": null
  }
}
```

**Also returned:** `sourceStatus` — `{ "radar": "ok" | "unavailable", "database": "ok" | "unavailable" }`, showing which sources contributed.

**Optional `dataWarning` field** (string) — present when more than 10% of hourly data is missing in a window, when a source was unavailable, or when Supabase data was merged and added rain beyond what IEM reported.

| Field | Type | Description |
|-------|------|-------------|
| `location.type` | string | `"point"` or `"polygon"` |
| `location.lat` / `location.lon` | number | Point coordinates (omitted for polygon) |
| `location.centroidLat` / `location.centroidLon` | number | Polygon centroid (omitted for point) |
| `location.fieldId` | string or null | Field UUID if provided |
| `periodEndUtc` | string | ISO 8601 timestamp of the period end (last complete UTC hour) |
| `units` | string | Always `"in"` |
| `rain.12h` | number | 12-hour accumulation in inches |
| `rain.24h` | number | 24-hour accumulation in inches |
| `rain.72h` | number | 72-hour accumulation in inches |
| `rain.168h` | number | 7-day (168-hour) accumulation in inches |
| `rain.total` | number | Total accumulation for custom date range (Mode D only) |
| `rainMm.*` | number | Same windows in millimeters |

---

## Error Responses

| Code | Condition | Body |
|------|-----------|------|
| `400` | Invalid or missing input: bad `lat`/`lon`, `field_id` not a UUID, bad `tz`/`asOf`/dates, repeated query params, invalid polygon, malformed JSON body, no location given | `{ "error": "...", "detail": "..." }` |
| `401` | `RAIN_API_AUTH=enforce` and no valid Supabase bearer token | `{ "error": "Sign in required" }` |
| `403` | `RAIN_API_AUTH=enforce` and the field belongs to another farm (`Field not found for this farm`) or the farm lacks the rainfall entitlement (`premium_required:rainfall`) | `{ "error": "..." }` |
| `405` | Method other than GET, POST, OPTIONS | `{ "error": "Method Not Allowed" }` |
| `502` | No usable data: radar timeout/failure, non-CONUS location (no radar data), or radar and database both unavailable | `{ "error": "Upstream data unavailable", "detail": "...", "retryAfterSeconds": 60 }` |
| `500` | Unhandled error | `{ "error": "Internal Server Error" }` |

> **Note:** Field mode degrades gracefully. If only one of radar or database works, the API returns `200` with `sourceStatus` showing which source was unavailable and a `dataWarning`. Non-CONUS coordinates return `502` (not zeros and not `404`).

---

## Technical Integration Notes

### 1. Networking
CORS headers (`Access-Control-Allow-Origin: *`) are set on all responses — safe to call directly from a browser with `fetch` or `axios`. No API key required.

### 2. Caching Strategy
- Coordinate/polygon requests: `Cache-Control: s-maxage=300, stale-while-revalidate=60` (5 minutes at the CDN).
- Field ID requests and custom date ranges: `private, no-store`.
- When `RAIN_API_AUTH=enforce`, every successful response is `private, no-store` with `Vary: Authorization`.

### 3. Deployment
Configured for **Vercel** serverless (Hobby: 10-second function limit; radar uses an 8s timeout and radar/database are queried concurrently). Environment variables:
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — field ID mode and the auth gate. The handler reads the service-role key (not the anon key).
- `RAIN_API_AUTH` — optional: `off` (default), `log`, or `enforce`. See the README "Access gate" section. The gate relies on the database function `rainfall_field_hourly_allowed`; if it is missing or errors, the gate fails open.

Coordinate and polygon modes require no environment variables — IEM is a public endpoint.

### 4. IEM Data Availability
IEM Stage IV covers the contiguous US (CONUS) only. Locations without radar data return `502`. Data typically lags real-time by 1–2 hours, so the newest one or two hourly keys are often missing (not flagged unless more than 10% of a window is missing).

### 5. Hybrid Merge
When both coordinate/polygon data and a `field_id` are provided, the API takes the MAX of IEM radar and Supabase values for each of the 24h/72h/168h windows (12h is radar only). This ensures maximum coverage if radar data is missing or if the Supabase ingestion pipeline experienced a lag. If the merged 7-day total exceeds the radar total by more than 0.05", a `dataWarning` is included.

### 6. Access gate (`RAIN_API_AUTH`)
When `enforce`, callers must send `Authorization: Bearer <Supabase access token>`. Field requests are also checked against the caller's farm and plan. See README for the rollout order (`log` first, then `enforce`).

### 7. Local credentials note
`.env.vercel` (a Vercel CLI development token, `VERCEL_OIDC_TOKEN`) was previously committed. It **expired 2026-03-28** and is now untracked and gitignored. Refresh with `vercel env pull` when needed; never commit `.env*` files.

---

## Troubleshooting

### Rainfall shows 0 for a known rain event (coordinate mode)
IEM Stage IV may have a short processing delay (usually < 2 hours). Try again later, or check with `asOf` set to a time after the data was processed.

### Rainfall shows 0 in field ID mode but you expect rain
The Supabase `field_rainfall_hourly` ingestion pipeline may have a gap. Cross-check with coordinate mode using the field's lat/lon — if coordinate mode returns rain, the pipeline missed that event and needs a backfill.

### 500 error on all requests
Previously caused by missing `SUPABASE_URL` env var crashing the Supabase client at module load. Fixed: Supabase client is now lazily initialized only when `field_id` is provided.
