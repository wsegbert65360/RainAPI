# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rain API is a Vercel serverless function that provides rainfall totals for locations and AcreLedger fields. It has two independent query modes:
- **Coordinate mode** (`lat`/`lon`): Queries IEM Stage IV radar data directly (CONUS only, ~1-2hr lag)
- **Field ID mode** (`field_id`): Queries AcreLedger Supabase via RPC `get_rainfall_stats`

No API key is required. Coordinate mode works with zero environment variables.

**Request methods**: GET for point lookups (`lat`/`lon` query params) and POST for polygon lookups (JSON body with coordinate array or GeoJSON polygon). Polygon requests compute the area-weighted centroid for IEM queries.

**Response windows**: Always returns 12h, 24h, 72h (and 168h) accumulations in both inches (`rain`) and mm (`rainMm`). The period end is the last complete UTC hour (or `asOf` truncated to the hour). Optional `tz` parameter controls how lookback windows are calculated but IEM always uses UTC.

**Error codes**: 400 (invalid input; with `enforce` also a missing `field_id`), 401/403/503 (only when `RAIN_API_AUTH=enforce`; 503 = access check unavailable, fails closed), 405, 502 (IEM timeout/failure or no radar data, e.g. non-CONUS, with `retryAfterSeconds`). There is no 404.

## Commands

```bash
npm run dev          # Start local dev server on port 3000 (field mode needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env)
npm run typecheck    # TypeScript strict type-check (no emit)
npm test             # Unit/handler tests (node:test via tsx, mocks IEM and Supabase; no server needed)
npx tsx tests/run-tests.ts  # Live smoke script against the dev server (must be running separately)
```

No linter or formatter is configured.

## Architecture

**Single handler pattern**: `api/rain.ts` is the entire Vercel serverless function. Route rewrites in `vercel.json` map `/rain` and `/rainfall` to `/api/rain`.

**Library modules** in `lib/`:
- `time.ts` — Timezone-aware period calculation, generates hour keys for lookback windows, handles `asOf` parameter
- `aggregate.ts` — Aggregates hourly precipitation into time windows, missing data detection (>10% threshold), inches→mm conversion
- `iem.ts` — Fetches IEM Stage IV radar data with parallel date fetching, 8s timeout, retry with exponential backoff
- `centroid.ts` — Polygon centroid calculation for field boundaries (area-weighted)
- `validate.ts` — Query/body validation helpers (UUID, dates, timezone, polygon normalization)
- `auth.ts` — Optional access gate controlled by `RAIN_API_AUTH` (off|log|enforce). `enforce` needs a bearer token, a `field_id` on the caller's farm, coordinates within 10 km of the field, and the rainfall entitlement; it fails closed (503) on infrastructure errors. Full rules in README "Access gate"

**Data flow**: Request → parse params → resolve lat/lon (direct or field lookup or centroid) → fetch IEM hourly data → aggregate into windows → return JSON

**Caching**: Via `Cache-Control` headers — coordinate mode gets 5min CDN cache with stale-while-revalidate; field ID mode is `no-store`.

**Vercel Hobby constraint**: 10-second execution limit. IEM fetches use an 8-second hard timeout to return a clean 502 instead of a raw Vercel timeout. No persistent in-memory state between invocations (stateless).

**Supabase access**: `get_rainfall_stats` RPC (custom date ranges, and fallback for rolling windows) plus one read-only query of `field_rainfall_hourly` for exact rolling 24h/72h/168h database windows (same finalized-or-Pass-2 filter as the RPC). Auth lookups read `profiles`/`fields` and call `rainfall_field_hourly_allowed`.

**Concurrency**: In the rolling-window path radar and database are fetched concurrently (Promise.all) to stay inside the 10s limit.

**AcreLedger contract (do not break)**: keep the response keys `rain`/`rainMm` (`12h/24h/72h/168h`; `total` for custom ranges), `location`, `periodEndUtc`, `units`, `sourceStatus`, optional `dataWarning`, and the 502 `retryAfterSeconds` body. `tests/rain.handler.test.ts` pins these; run `npm test` and `npm run typecheck` after any change.

**Secrets**: Never commit `.env*` files. `.env.vercel` (Vercel CLI `VERCEL_OIDC_TOKEN`) was committed once; the token expired 2026-03-28 and the file is now untracked. Refresh with `vercel env pull`.

## Environment Variables

| Variable | Required | Used by |
|----------|----------|---------|
| `SUPABASE_URL` | Field ID mode / auth gate | Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | Field ID mode / auth gate | Supabase client (`api/rain.ts` reads this, not the anon key) |
| `RAIN_API_AUTH` | No (default `off`) | `off`, `log` or `enforce` access gate |

## Deployment

Push to `main` → automatic Vercel deployment. Ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in Vercel project settings.

## TypeScript

Strict mode, CommonJS modules, ES2022 target. Source is in `api/`, `lib/`, and `tests/` (covered by `tsconfig.json` `include`).
