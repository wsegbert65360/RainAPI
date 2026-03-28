# Rain API Integration Guide for AI Agents

This document provides all the technical details necessary for an AI coding agent to integrate the **Rain API** into a larger system.

## Overview

The Rain API is a Vercel serverless function that provides rainfall totals for a given location or field. It supports **two independent query modes**:

| Mode | Input | Data Source |
|------|-------|-------------|
| **Coordinate mode** | `lat` + `lon` | IEM Stage IV radar (direct, always current) |
| **Field ID mode** | `field_id` | AcreLedger Supabase RPC (`get_rainfall_stats`) |

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

### Mode A: Coordinate Lookup (Recommended)

Fetch rainfall for a GPS coordinate over a date window. Queries IEM Stage IV directly.

**Endpoint:** `GET /rain`

**Query Parameters:**

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `lat` | number | **Yes** | Latitude in decimal degrees (-90 to 90) |
| `lon` | number | **Yes** | Longitude in decimal degrees (-180 to 180) |
| `days` | integer | No | Number of past days to sum (default: `7`, max: `30`) |
| `date` | string | No | Single date `YYYY-MM-DD` — overrides `days` |
| `start_date` | string | No | Start of explicit date range `YYYY-MM-DD` |
| `end_date` | string | No | End of explicit date range `YYYY-MM-DD` (use with `start_date`) |

**Date resolution priority:** `start_date`+`end_date` → `date` → `days` (default 7).

**Examples:**

```http
GET /rain?lat=38.4626783&lon=-93.5373719
GET /rain?lat=38.4626783&lon=-93.5373719&days=7
GET /rain?lat=38.4626783&lon=-93.5373719&date=2026-03-27
GET /rain?lat=38.4626783&lon=-93.5373719&start_date=2026-03-01&end_date=2026-03-28
```

**Success Response (200):**

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

---

### Mode B: Field ID Lookup (AcreLedger / Supabase)

Fetch rainfall for a specific AcreLedger field from the Supabase database.

**Endpoint:** `GET /rain`

**Query Parameters:**

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `field_id` | UUID | **Yes** | The AcreLedger field UUID |
| `date` | string | Yes* | Single date `YYYY-MM-DD` |
| `start_date` | string | Yes* | Start date for a range query |
| `end_date` | string | No | End date for range (defaults to `start_date`) |

*Either `date` or `start_date` is required.

**Example:**

```http
GET /rain?field_id=2284c948-212e-4ffb-8bf9-4c11fd08edd7&start_date=2026-03-21&end_date=2026-03-28
```

**Success Response (200):**

```json
{
  "rainfall": 0.22
}
```

> **Note:** Returns `{ "rainfall": 0 }` if the field has no data in the database for the requested window. This is not an error — it may indicate the ingestion pipeline has a gap. Use coordinate mode to cross-check.

---

## Response Schema Reference

| Field | Mode | Description |
|-------|------|-------------|
| `mode` | A only | Always `"iem"` for coordinate mode |
| `location` | A only | `{ lat, lon }` echo of input coords |
| `period` | A only | `{ start, end, days }` of the query window |
| `rainfall` | Both | Total inches over the query window (rounded to 3 decimal places) |
| `breakdown` | A only | Per-day inches dictionary (`YYYY-MM-DD` keys) |
| `units` | A only | Always `"inches"` |
| `source` | A only | Always `"IEM Stage IV"` |

---

## Error Responses

| Code | Condition |
|------|-----------|
| `400` | Missing required params, invalid lat/lon range, or missing `field_id`+`date` |
| `500` | Supabase RPC error (field ID mode) or unexpected server failure |

**400 example (no params):**
```json
{
  "error": "Missing required parameters",
  "detail": "Provide lat & lon for coordinate-based lookup, or field_id for database lookup.",
  "examples": [
    "/rain?lat=38.4626783&lon=-93.5373719",
    "/rain?lat=38.4626783&lon=-93.5373719&days=7",
    "/rain?field_id=<uuid>&date=2026-03-27"
  ]
}
```

**400 example (invalid lat):**
```json
{ "error": "Invalid lat value. Must be -90 to 90." }
```

---

## Technical Integration Notes

### 1. Networking
CORS headers (`Access-Control-Allow-Origin: *`) are set on all responses — safe to call directly from a browser with `fetch` or `axios`. No API key required.

### 2. Caching Strategy
- **Coordinate mode (IEM):** `Cache-Control: s-maxage=300, stale-while-revalidate=60` — cached 5 minutes at the CDN edge.
- **Field ID mode (Supabase):** `Cache-Control: no-store` — caching disabled to ensure backfill data is always fresh.

### 3. Deployment
Configured for **Vercel** serverless. Required environment variables (for field ID mode only):
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Coordinate mode requires no environment variables — IEM is a public endpoint.

### 4. IEM Data Availability
IEM Stage IV covers the contiguous US (CONUS) only. Locations outside CONUS will return `0` rather than an error. Data typically lags real-time by 1–2 hours.

---

## Troubleshooting

### Rainfall shows 0 in field ID mode but you expect rain
The Supabase `field_rainfall_hourly` ingestion pipeline may have a gap. Cross-check with coordinate mode using the field's lat/lon — if coordinate mode returns rain, the pipeline missed that event and needs a backfill.

### IEM returns 0 for a known rain event
IEM Stage IV may have a short processing delay (usually < 2 hours). Try again later, or query with `date=<yesterday>` to ensure the day is fully processed.

### 400 on field ID mode
Both `field_id` and either `date` or `start_date` are required. Check that all parameters are present.
