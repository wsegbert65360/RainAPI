# Rain API — Implementation Plan (Revised)

Implement the spec in `blueprint.md` as a Vercel serverless API using Node.js + TypeScript.

---

## Target Shape

- **Endpoint:** `GET /api/rain` (point) and `POST /api/rain` (polygon)
- **Output:** `rain.{12h,24h,72h}` (inches) plus `rainMm` (mm)
- **Provider:** IEM Stage IV point query:
  `https://mesonet.agron.iastate.edu/json/stage4.py?lat=...&lon=...&valid=YYYY-MM-DD&tz=UTC`
- **Constraints:** Vercel Hobby 10 s timeout; IEM fetches must be parallel; 8 s upstream abort.

---

## Files to Add / Update

### `package.json`
- Dependencies: TypeScript, `@types/node`, `@vercel/node`. No runtime HTTP client needed — use native `fetch` (Node 18+).
- Scripts: `dev` (via `vercel dev`), `build` (`tsc --noEmit`), `lint` (optional).

### `tsconfig.json`
- Target: `ES2022`, module: `Node16` or `NodeNext`.
- `strict: true`. `outDir` not needed — Vercel compiles in-process.

### `vercel.json`
- Rewrites `/rain` and `/rainfall` → `/api/rain`.
- Add `"headers"` block for CORS (see CORS section below).

### `api/rain.ts`
Single handler for GET + POST:
1. Handle `OPTIONS` preflight (CORS).
2. Validate inputs (see Validation section).
3. Compute centroid if polygon.
4. Compute `periodEndUtc` — applying `tz` to shift "last complete hour" if provided (see Timezone section).
5. Compute required UTC dates for 72h window.
6. Fetch IEM dates in parallel with 8 s abort.
7. Aggregate 12/24/72h totals.
8. Return JSON with `Cache-Control` header.

### `lib/time.ts`
- Parse `asOf` (ISO 8601); validate and reject if unparseable.
- Compute last complete hour — see **Off-by-one rule** below.
- Apply `tz` offset to determine period end — see **Timezone** section.
- Compute required UTC calendar dates for the 72h window (up to 4 dates).
- Generate ordered list of UTC hour keys: `"YYYY-MM-DD HH:00"` × 72.

### `lib/centroid.ts`
- Accept raw coordinate array `[lon, lat][]` or GeoJSON Polygon.
- Normalize GeoJSON by extracting `coordinates[0]`.
- Strip closing point if `first === last` before averaging.
- Return `{ lat: number; lon: number }`.

### `lib/iem.ts`
- **Before writing this module:** make a manual `curl` or browser request to the live IEM endpoint for a known recent date and log the raw JSON. Confirm the exact current field names (`end_valid` vs `utc_valid`, `precip_in` vs other variants) before coding the parser. Do not assume the schema — it has changed across IEM releases.
- Fetch Stage IV for a given UTC date string.
- Set an `AbortController` timeout of 8 000 ms; on abort return a typed error so the handler can return a clean `502`.
- Parse: build a `Map<string, number>` keyed by `"YYYY-MM-DD HH:00"` (UTC). Support whichever field names the live endpoint actually uses (confirmed above).
- Treat `null`, missing, or negative precip values as `0`.

### `lib/aggregate.ts`
- Accept the hour map and the ordered 72-key list.
- Sum trailing 12, 24, and 72 values using the same ordered key list — no independent slicing.
- **Missing-hour warning:** flag if missing hours exceed **10% of the window being reported** (i.e. >1 missing in 12h, >2 in 24h, >7 in 72h). Return a `dataWarning` string if any window exceeds its threshold. This is proportional, not a flat count.
- Multiply inch totals by 25.4 for mm; round to 2 decimal places.

### `README.md`
- Quickstart for local dev (`vercel dev`, then `curl` examples).
- **Explicit base URL guidance for Acreledger:**
  - Production canonical URL: `https://your-project.vercel.app/rain` (via rewrite)
  - Direct path also works: `https://your-project.vercel.app/api/rain`
  - Recommend Acreledger hardcode `/rain` (the stable alias) rather than `/api/rain` in case the internal path changes.
- Request/response examples matching the blueprint exactly.

---

## Key Implementation Decisions

### Timezone (`tz` parameter) — not decorative

The `tz` parameter **does** shift what "last complete hour" means. This matters for Acreledger users:

> A farmer in `America/Chicago` querying at 11 PM local (05:00 UTC next day) would get a very different "last 24 hours" window depending on which clock is used.

**Behavior:**
- If `tz` is omitted or `UTC`: period end = last complete UTC hour (`floor(now, 1h)` in UTC).
- If `tz` is provided: convert "now" to that timezone, floor to the last complete hour in local time, then convert back to UTC for the period end.
  - Example: `tz=America/Chicago`, now = `2026-03-17T05:37:00Z` (11:37 PM CDT).
    Local last complete hour = 11:00 PM CDT = `2026-03-17T04:00:00Z`. Period end = `04:00 UTC`.
- Validate `tz` against `Intl.supportedValuesOf('timeZone')`. Return `400` for unrecognized values.
- The response always reports `periodEndUtc` in UTC regardless of `tz`.

This is a small amount of extra code (`Intl.DateTimeFormat` or a tiny helper) and makes the API correct for its actual users.

### Aggregation window — off-by-one rule

The 72h window is defined as:

```
[periodEnd - 71 hours, periodEnd]  inclusive  → 72 hourly buckets
```

The implementation must build a single ordered array of 72 UTC hour keys derived from `periodEndUtc`, then slice the first 12 (most recent 12 hours) and first 24 from the same array. Do **not** compute the three windows independently — they must share the same ordered key list to stay consistent.

Correct key generation (most-recent-first, then reverse for summing):

```ts
// periodEndUtc is already floored to the hour, e.g. "2026-03-17T14:00:00Z"
const keys: string[] = [];
for (let i = 0; i < 72; i++) {
  const d = new Date(periodEndUtc.getTime() - i * 3_600_000);
  const iso = d.toISOString(); // "2026-03-17T14:00:00.000Z"
  keys.push(`${iso.slice(0, 10)} ${iso.slice(11, 13)}:00`); // "YYYY-MM-DD HH:00"
}
// keys[0] = periodEnd hour, keys[71] = 71 hours earlier
// sum keys[0..11] for 12h, keys[0..23] for 24h, keys[0..71] for 72h
```

Unit test: build a map of 72 sequential values (1, 2, ... 72), confirm 12h = 78, 24h = 300, 72h = 2628.

### `asOf` on-the-hour edge case

When `asOf` is exactly on an hour boundary (e.g. `2026-03-17T14:00:00Z`), "last complete hour" must resolve to `14:00`, **not** `13:00`. The logic is `floor(asOf)` — if the minutes and seconds are already zero, no subtraction is applied.

Add a specific unit test: `asOf = "2026-03-17T14:00:00Z"` → `periodEndUtc = "2026-03-17T14:00:00Z"`.

### Polygon strategy
Centroid only (per blueprint). Multi-point is a future option.

### IEM missing data
Treat missing/null precip as `0`. Apply proportional `dataWarning` per window as described in `lib/aggregate.ts` above.

### Caching
Set `Cache-Control: s-maxage=900, stale-while-revalidate=300` on all `200` responses. Stage IV data is hourly so 15-minute CDN caching is safe and reduces IEM load.

---

## CORS

Add CORS headers so Acreledger can call the API from a browser context now or in future without code changes.

**`vercel.json` headers block:**

```json
{
  "headers": [
    {
      "source": "/api/rain",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET, POST, OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Content-Type" }
      ]
    }
  ]
}
```

Handle `OPTIONS` preflight in `api/rain.ts`:

```ts
if (req.method === 'OPTIONS') {
  res.status(204).end();
  return;
}
```

---

## Input Validation

Return `400` with a descriptive `error` string for any of the following:

| Input | Rule |
|-------|------|
| `lat` | Required for GET. Finite number, -90 to 90. |
| `lon` | Required for GET. Finite number, -180 to 180. |
| `polygon` | Required for POST. Array of at least 3 points (4 if closed ring). Each point must be `[number, number]`. |
| `tz` | Optional. Must be a valid IANA timezone name if provided. |
| `asOf` | Optional. Must parse as a valid ISO 8601 datetime if provided. |

Never hit IEM before all inputs are validated.

---

## Verification

### Unit tests (before integration)

| Test | What to confirm |
|------|----------------|
| `centroid` — open ring | Mean of vertices. |
| `centroid` — closed ring | Closing point stripped before mean. |
| `centroid` — GeoJSON input | `coordinates[0]` unwrapped correctly. |
| `time` — `asOf` on-the-hour | `"14:00:00Z"` → period end `14:00`, not `13:00`. |
| `time` — date range near midnight | Period end `01:00 UTC` on day D spans 4 calendar dates. |
| `time` — `tz` shift | `America/Chicago` at `05:37 UTC` → period end `04:00 UTC`. |
| `aggregate` — window math | 72 sequential values; 12h = 78, 24h = 300, 72h = 2628. |
| `aggregate` — missing warning | 2 missing in 12h window triggers warning; 1 missing does not. |
| `aggregate` — all zero | Returns `0.00` for all windows, no warning. |

### Manual smoke tests (local via `vercel dev`)

```bash
# Point — basic
curl "http://localhost:3000/rain?lat=42.03&lon=-93.62"

# Point — with timezone
curl "http://localhost:3000/rain?lat=42.03&lon=-93.62&tz=America/Chicago"

# Point — asOf on-the-hour
curl "http://localhost:3000/rain?lat=42.03&lon=-93.62&asOf=2026-03-17T14:00:00Z"

# Point — asOf near midnight UTC (spans 4 dates)
curl "http://localhost:3000/rain?lat=42.03&lon=-93.62&asOf=2026-03-17T01:30:00Z"

# Polygon — coordinate array
curl -X POST http://localhost:3000/rain \
  -H "Content-Type: application/json" \
  -d '{"polygon":[[-93.65,42.02],[-93.60,42.02],[-93.60,42.05],[-93.65,42.05],[-93.65,42.02]]}'

# Polygon — GeoJSON
curl -X POST http://localhost:3000/rain \
  -H "Content-Type: application/json" \
  -d '{"type":"Polygon","coordinates":[[[-93.65,42.02],[-93.60,42.02],[-93.60,42.05],[-93.65,42.05],[-93.65,42.02]]]}'

# Rewrite aliases
curl "http://localhost:3000/rainfall?lat=42.03&lon=-93.62"

# Error cases
curl "http://localhost:3000/rain"                          # 400 missing lat/lon
curl "http://localhost:3000/rain?lat=999&lon=-93.62"       # 400 invalid lat
curl "http://localhost:3000/rain?lat=42.03&lon=-93.62&tz=Fake/Zone"  # 400 invalid tz
```

### Pre-coding IEM schema check

Before writing `lib/iem.ts`, run this manually and save the raw output:

```bash
curl "https://mesonet.agron.iastate.edu/json/stage4.py?lat=42.03&lon=-93.62&valid=2026-03-15&tz=UTC"
```

Confirm:
- Exact field name for the timestamp (`utc_valid`, `end_valid`, or other).
- Exact field name for precipitation (`precip_in` or other).
- Format of the timestamp string (does it include seconds? a trailing `Z`?).
- Shape of the top-level object (`data` array or flat array or other).

Document the confirmed schema as a comment at the top of `lib/iem.ts` before writing the parser.

---

## Deploy

1. Push repo to GitHub.
2. Vercel dashboard → New Project → import repo → Framework: **Other**.
3. No environment variables required for base IEM endpoint.
4. Verify both `/api/rain` and `/rain` aliases resolve after first deploy.
5. Confirm CORS headers present on response: `curl -I "https://your-project.vercel.app/rain?lat=42.03&lon=-93.62"`.
