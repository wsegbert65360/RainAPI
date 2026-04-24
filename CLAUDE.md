# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rain API is a Vercel serverless function that provides rainfall totals for locations and AcreLedger fields. It has two independent query modes:
- **Coordinate mode** (`lat`/`lon`): Queries IEM Stage IV radar data directly (CONUS only, ~1-2hr lag)
- **Field ID mode** (`field_id`): Queries AcreLedger Supabase via RPC `get_rainfall_stats`

No API key is required. Coordinate mode works with zero environment variables.

**Request methods**: GET for point lookups (`lat`/`lon` query params) and POST for polygon lookups (JSON body with coordinate array or GeoJSON polygon). Polygon requests compute the centroid via arithmetic mean for IEM queries.

**Response windows**: Always returns 12h, 24h, 72h (and 168h) accumulations in both inches (`rain`) and mm (`rainMm`). The period end is the last complete UTC hour (or `asOf` truncated to the hour). Optional `tz` parameter controls how lookback windows are calculated but IEM always uses UTC.

**Error codes**: 400 (invalid input), 404 (non-CONUS location), 502 (IEM timeout/failure with `retryAfterSeconds`).

## Commands

```bash
npm run dev          # Start local dev server on port 3000 (requires SUPABASE_URL + SUPABASE_ANON_KEY in .env)
npm run typecheck    # TypeScript strict type-check (no emit)
npx tsx tests/run-tests.ts  # Run tests (dev server must be running separately)
```

No linter or formatter is configured.

## Architecture

**Single handler pattern**: `api/rain.ts` is the entire Vercel serverless function. Route rewrites in `vercel.json` map `/rain` and `/rainfall` to `/api/rain`.

**Library modules** in `lib/`:
- `time.ts` — Timezone-aware period calculation, generates hour keys for lookback windows, handles `asOf` parameter
- `aggregate.ts` — Aggregates hourly precipitation into time windows, missing data detection (>10% threshold), inches→mm conversion
- `iem.ts` — Fetches IEM Stage IV radar data with parallel date fetching, 8s timeout, retry with exponential backoff
- `centroid.ts` — Polygon centroid calculation for field boundaries (arithmetic mean of coordinates)

**Data flow**: Request → parse params → resolve lat/lon (direct or field lookup or centroid) → fetch IEM hourly data → aggregate into windows → return JSON

**Caching**: Via `Cache-Control` headers — coordinate mode gets 5min CDN cache with stale-while-revalidate; field ID mode is `no-store`.

**Vercel Hobby constraint**: 10-second execution limit. IEM fetches use an 8-second hard timeout to return a clean 502 instead of a raw Vercel timeout. No persistent in-memory state between invocations (stateless).

**Supabase access**: RPC calls only (`get_rainfall_stats`). No direct table queries.

## Environment Variables

| Variable | Required | Used by |
|----------|----------|---------|
| `SUPABASE_URL` | Field ID mode | Supabase client |
| `SUPABASE_ANON_KEY` | Field ID mode | Supabase client |
| `MOCK_IEM` | No (testing) | Disables real IEM calls in dev |

## Deployment

Push to `main` → automatic Vercel deployment. Ensure `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set in Vercel project settings.

## TypeScript

Strict mode, CommonJS modules, ES2022 target. Source is in `api/`, `lib/`, and `tests/` (covered by `tsconfig.json` `include`).
