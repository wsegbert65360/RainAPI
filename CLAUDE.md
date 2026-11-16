# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rain API is a Vercel serverless function that provides rainfall totals for locations and AcreLedger fields. It has two independent query modes:
- **Coordinate mode** (`lat`/`lon`): Queries IEM Stage IV radar data directly (CONUS only, ~1-2hr lag)
- **Field ID mode** (`field_id`): Queries AcreLedger Supabase via RPC `get_rainfall_stats`

Every data route requires a Supabase user JWT. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required; if either is missing the handler returns 503 and does not serve rainfall.

**Request methods**: GET for point lookups (`lat`/`lon` query params) and POST for polygon lookups (JSON body with coordinate array or GeoJSON polygon). Polygon requests compute the area-weighted centroid for IEM queries.

**Response windows**: Always returns 12h, 24h, 72h (and 168h) accumulations in both inches (`rain`) and mm (`rainMm`). The period end is the last complete UTC hour (or `asOf` truncated to the hour). Optional `tz` parameter controls how lookback windows are calculated but IEM always uses UTC.

**Error codes**: 400 (invalid input), 401 (missing or invalid Supabase bearer token), 403 (field ownership, soft-delete, coordinate match, or rainfall entitlement), 503 (access check unavailable, fails closed — including missing Supabase env), 405, 502 (IEM timeout/failure or no radar data, e.g. non-CONUS, with `retryAfterSeconds`). There is no 404. Sign-in is always required. `RAIN_API_AUTH` unset, `off`, or unknown means enforce. `log` denies as well.

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
- `auth.ts` — Access gate on every data route. Requires a bearer token, and either a `field_id` on the caller's farm (not soft-deleted, coordinates within 10 km, `rainfall_field_hourly_allowed`) or a signed-in location-only caller with a farm. Fails closed (503) on infrastructure errors. Unset `RAIN_API_AUTH` enforces. Full rules in README "Access gate"

**Data flow**: Request → parse params → resolve lat/lon (direct or field lookup or centroid) → fetch IEM hourly data → aggregate into windows → return JSON

**Caching**: Data responses are `Cache-Control: private, no-store` and `Vary: Authorization`.

**Vercel Hobby constraint**: 10-second execution limit. IEM fetches use an 8-second hard timeout to return a clean 502 instead of a raw Vercel timeout. No persistent in-memory state between invocations (stateless).

**Supabase access**: `get_rainfall_stats` RPC (custom date ranges, and fallback for rolling windows) plus one read-only query of `field_rainfall_hourly` for exact rolling 24h/72h/168h database windows (same finalized-or-Pass-2 filter as the RPC). Auth lookups read `profiles`/`fields` and call `rainfall_field_hourly_allowed`.

**Concurrency**: In the rolling-window path radar and database are fetched concurrently (Promise.all) to stay inside the 10s limit.

**AcreLedger contract (do not break)**: keep the response keys `rain`/`rainMm` (`12h/24h/72h/168h`; `total` for custom ranges), `location`, `periodEndUtc`, `units`, `sourceStatus`, optional `dataWarning`, and the 502 `retryAfterSeconds` body. `tests/rain.handler.test.ts` pins these; run `npm test` and `npm run typecheck` after any change.

**Secrets**: Never commit `.env*` files. `.env.vercel` (Vercel CLI `VERCEL_OIDC_TOKEN`) was committed once; the token expired 2026-03-28 and the file is now untracked. Refresh with `vercel env pull`.

## Environment Variables

| Variable | Required | Used by |
|----------|----------|---------|
| `SUPABASE_URL` | Yes | Supabase client. Missing → 503, not an open API |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase client (`api/rain.ts` reads this, not the anon key). Missing → 503 |
| `RAIN_API_AUTH` | No | Unset, `off`, or unknown enforces sign-in. `log` logs the denial and still rejects |

## Deployment

Push to `main` → automatic Vercel deployment. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must already be set. Confirm the shipped iPhone build sends the bearer token before deploy (see README "Deploy order"). Do not treat unset `RAIN_API_AUTH` as off.

## TypeScript

Strict mode, CommonJS modules, ES2022 target. Source is in `api/`, `lib/`, and `tests/` (covered by `tsconfig.json` `include`).
