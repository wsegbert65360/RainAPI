# Rain API Integration Guide for AI Agents

This document provides all the technical details necessary for an AI coding agent to integrate the **Rain API** into a larger system.

## Overview

The Rain API is a Vercel serverless function that provides daily rainfall totals for specific fields. It serves data from the **AcreLedger Supabase instance** via a specialized RPC.

## Core Components

- **`api/rain.ts`**: The main entry point and request handler.
- **Supabase RPC**: `get_rainfall_stats(p_field_id, p_date)` provides the source data.

---

## API Documentation

### Base URL

When deployed to Vercel, the API is available at `/api/rain` (and aliased to `/rain` and `/rainfall` via `vercel.json`).

### 1. Field Rainfall Queries (GET)

Fetch rainfall for a specific field on a specific date.

**Endpoint:** `GET /api/rain`

**QueryParams:**
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `field_id` | UUID | Yes | The unique identifier for the field in AcreLedger. |
| `date` | string | Yes | The date in `YYYY-MM-DD` format. |

**Example:**
`GET /api/rain?field_id=550e8400-e29b-41d4-a716-446655440000&date=2026-03-27`

---

## Response Schema

A successful response (`200 OK`) returns:

```json
{
  "rainfall": 0.25
}
```

### Error Responses

- **`400 Bad Request`**: Missing `field_id` or `date`.
- **`500 Internal Server Error`**: Unexpected server-side failure or Supabase RPC error.

---

## Technical Integration Steps

### 1. Networking
The API includes CORS headers (`Access-Control-Allow-Origin: *`) allowing direct calls from a web browser. Use `fetch` or `axios`.

### 2. Caching Strategy
The API implements an internal caching strategy via `Cache-Control` headers:
- **Finalized Dates (Past)**: Cached for 1 hour (`s-maxage=3600`).
- **Current Day**: Cached for 5 minutes (`s-maxage=300`) to account for incoming near-real-time updates.

### 3. Deployment
The program is configured for **Vercel**.
- Required Environment Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

---

## Troubleshooting

### 1. Missing Parameters (400 Bad Request)
The API strictly requires both `field_id` and `date`. If either is missing, the API returns a `400 Bad Request` with a JSON body detailing the error.

**Example Error Response:**
```json
{
  "error": "Missing field_id or date",
  "detail": "Both field_id and date query parameters are required."
}
```

### 2. No Data (200 OK)
If the parameters are valid but no rainfall is recorded for that field on that date, the API returns `{"rainfall": 0}`. This is not an error; it simply indicates zero rainfall in the database for the specified window.
