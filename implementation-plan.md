# Rain API — Historical Implementation Plan

This file is **not the current API contract**.

It contains an older/revised implementation plan for a broader Rain API shape (including ideas like POST polygon support, `tz`, and `asOf`) that does **not** match the currently deployed handler.

## Use these as the real source of truth instead

- `api/rain.ts` — actual handler behavior
- `README.md` — current public usage guide
- `AI_INTEGRATION.md` — current integration guidance for other programs

## Current implemented API shape

### Supported query modes

1. **Coordinate mode**
   - `GET /rain?lat=...&lon=...`
   - optional: `days`, `date`, `start_date`, `end_date`
   - source: **IEM Stage IV**

2. **Field mode**
   - `GET /rain?field_id=...&date=...`
   - or `GET /rain?field_id=...&start_date=...&end_date=...`
   - source: **Supabase RPC** (`get_rainfall_stats`)

### Supported routes

- `/api/rain`
- `/rain`
- `/rainfall`

## Not currently implemented

The following ideas may appear in older planning notes below or in git history, but they are **not part of the live API contract** unless/until the code changes:

- `POST /rain`
- polygon request bodies
- `tz`
- `asOf`
- 12h/24h/72h structured rainfall windows
- `rainMm`
- centroid polygon processing in the API handler

## Why this note exists

This file was kept so planning context is not lost, but it should not be used by other programs as usage documentation.

If you are integrating another program with Rain API, use `README.md` or `AI_INTEGRATION.md`, and verify against `api/rain.ts` if anything is ambiguous.
