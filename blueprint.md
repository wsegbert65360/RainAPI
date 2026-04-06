# AcreLedger — Blueprint

**Purpose:** Comprehensive architectural blueprint for the AcreLedger farm management system. Covers data models, service layer, state management, offline strategy, rainfall data pipeline, and compliance requirements.

**Data source:** AcreLedger Supabase (PostgreSQL) — the sole authoritative source of truth for all persistent data.

**Hosting:** Vercel Hobby (free tier, serverless, Git-push deploy).

---

## 1. Data Models

All data models are defined as TypeScript interfaces in `src/types/farm.ts`. Every field documented below MUST exist in both the type definition and the corresponding Supabase database table. All mappers in `src/lib/mappers.ts` must handle every field bidirectionally (DB ↔ UI).

### 1.1 Farm

| Field | Type | DB Column | Description |
|-------|------|-----------|-------------|
| `id` | `string` (UUID) | `id` | Primary key |
| `name` | `string` | `name` | User-given farm name |
| `location` | `string \| null` | `location` | General location description (free text) |
| `totalAcreage` | `number \| null` | `total_acreage` | Total acreage across all fields |
| `createdAt` | `string` (ISO 8601) | `created_at` | Record creation timestamp |
| `updatedAt` | `string` (ISO 8601) | `updated_at` | Last modification timestamp |

### 1.2 Field

| Field | Type | DB Column | Description |
|-------|------|-----------|-------------|
| `id` | `string` (UUID) | `id` | Primary key |
| `farmId` | `string` (UUID) | `farm_id` | Foreign key to `farms` |
| `name` | `string` | `name` | User-given field name (e.g. "North 80") |
| `acreage` | `number \| null` | `acreage` | Total acreage of the field |
| `boundary` | `object \| null` | `boundary` | GeoJSON polygon boundary (lon/lat ring) |
| `centroidLat` | `number \| null` | `centroid_lat` | Computed centroid latitude |
| `centroidLon` | `number \| null` | `centroid_lon` | Computed centroid longitude |
| `currentCrop` | `string \| null` | `current_crop` | Crop currently planted |
| `createdAt` | `string` (ISO 8601) | `created_at` | Record creation timestamp |
| `updatedAt` | `string` (ISO 8601) | `updated_at` | Last modification timestamp |

### 1.3 SavedSeed

Represents a seed product saved to a user's account. The core fields (`id`, `name`, `farmId`) have been in production since initial launch. The extended fields (`crop`, `variety`, `supplier`, `lotNumber`, `year`) were added in the v2 data model migration and are now fully implemented in both the type system and mappers.

| Field | Type | DB Column | Status | Description |
|-------|------|-----------|--------|-------------|
| `id` | `string` (UUID) | `id` | **Core** | Primary key |
| `name` | `string` | `name` | **Core** | Display name given by the user |
| `farmId` | `string` (UUID) | `farm_id` | **Core** | Foreign key to `farms` |
| `crop` | `string \| null` | `crop` | **Extended** | Crop type (e.g. "Corn", "Soybeans") |
| `variety` | `string \| null` | `variety` | **Extended** | Variety/brand (e.g. "Dekalb", "Pioneer") |
| `supplier` | `string \| null` | `supplier` | **Extended** | Supplier/vendor name |
| `lotNumber` | `string \| null` | `lot_number` | **Extended** | Lot/batch number from seed tag |
| `year` | `number \| null` | `year` | **Extended** | Production year |
| `createdAt` | `string` (ISO 8601) | `created_at` | **Core** | Record creation timestamp |
| `updatedAt` | `string` (ISO 8601) | `updated_at` | **Core** | Last modification timestamp |

> **Migration Note:** The extended fields (`crop`, `variety`, `supplier`, `lotNumber`, `year`) were identified as a planned extension in a prior review and are now fully implemented. No further migration is needed.

### 1.4 SprayRecord

Represents a pesticide/herbicide/fungicide application record. Compliance tracking is built into this model — records missing an EPA Registration Number are automatically flagged as non-compliant.

| Field | Type | DB Column | Description |
|-------|------|-----------|-------------|
| `id` | `string` (UUID) | `id` | Primary key |
| `fieldId` | `string` (UUID) | `field_id` | Foreign key to `fields` |
| `farmId` | `string` (UUID) | `farm_id` | Foreign key to `farms` |
| `productName` | `string` | `product_name` | Product name as it appears on the label |
| `epaRegistrationNumber` | `string \| null` | `epa_registration_number` | EPA Registration Number from label |
| `applicationDate` | `string` (YYYY-MM-DD) | `application_date` | Date of application |
| `treatedAreaSize` | `number \| null` | `treated_area_size` | Area treated in acres |
| `totalAmountApplied` | `number \| null` | `total_amount_applied` | Total product amount applied |
| `applicationUnit` | `string \| null` | `application_unit` | Unit of measurement (e.g. "oz", "fl oz", "lbs") |
| `applicationMethod` | `string \| null` | `application_method` | Method (e.g. "Ground Sprayer", "Aerial") |
| `windSpeed` | `number \| null` | `wind_speed` | Wind speed in mph at time of application |
| `windDirection` | `string \| null` | `wind_direction` | Wind direction (e.g. "N", "NE", "SSW") |
| `temperature` | `number \| null` | `temperature` | Temperature in Fahrenheit |
| `applicator` | `string \| null` | `applicator` | Applicator name or license number |
| `notes` | `string \| null` | `notes` | Free-form notes |
| `isCompliant` | `boolean \| null` | `is_compliant` | Auto-flagged when EPA # is missing |
| `createdAt` | `string` (ISO 8601) | `created_at` | Record creation timestamp |
| `updatedAt` | `string` (ISO 8601) | `updated_at` | Last modification timestamp |

> **String/Number Handling:** `treatedAreaSize` and `totalAmountApplied` are stored as `numeric` (number) in the Supabase database for calculation accuracy. However, they may be captured as `string` values in the UI for input flexibility — for example, when a user is mid-entry and has typed "120." before completing the value. The mappers in `src/lib/mappers.ts` use a `coerceNumeric()` helper that safely handles both `string` and `number` representations, converting them to `number | null` for the TypeScript interface. All downstream calculations and exports use the numeric form.

### 1.5 PlantRecord

Represents a planting event tied to a field.

| Field | Type | DB Column | Description |
|-------|------|-----------|-------------|
| `id` | `string` (UUID) | `id` | Primary key |
| `fieldId` | `string` (UUID) | `field_id` | Foreign key to `fields` |
| `farmId` | `string` (UUID) | `farm_id` | Foreign key to `farms` |
| `seedId` | `string \| null` | `seed_id` | Foreign key to `saved_seeds` |
| `crop` | `string` | `crop` | Crop type planted |
| `variety` | `string \| null` | `variety` | Variety planted |
| `population` | `number \| null` | `population` | Planting population (seeds per acre) |
| `plantingDate` | `string` (YYYY-MM-DD) | `planting_date` | Date of planting |
| `targetHarvestDate` | `string \| null` | `target_harvest_date` | Target harvest date |
| `notes` | `string \| null` | `notes` | Free-form notes |
| `createdAt` | `string` (ISO 8601) | `created_at` | Record creation timestamp |
| `updatedAt` | `string` (ISO 8601) | `updated_at` | Last modification timestamp |

### 1.6 RainfallRecord

Represents a single hourly rainfall data point for a field. These records are stored in the Supabase `field_rainfall_hourly` table and are ingested by the primary AcreLedger rainfall pipeline (not by this repository).

| Field | Type | DB Column | Description |
|-------|------|-----------|-------------|
| `fieldId` | `string` (UUID) | `field_id` | Foreign key to `fields` |
| `date` | `string` (YYYY-MM-DD) | `date` | Date of the reading |
| `hour` | `string` (HH:00) | `hour` | Hour of the reading |
| `precipInches` | `number` | `precip_inches` | Precipitation amount in inches |
| `isValidated` | `boolean` | `is_validated` | Whether the reading has been "Pass 2" hardened |

### 1.7 RainfallStats

Aggregated rainfall statistics returned by the `get_rainfall_stats` Supabase RPC.

| Field | Type | DB Column (RPC return) | Description |
|-------|------|------------------------|-------------|
| `fieldId` | `string` (UUID) | `field_id` | UUID of the field |
| `totalInches` | `number` | `total_inches` | Total rainfall in inches over the period |
| `startDate` | `string` (YYYY-MM-DD) | `start_date` | Start of the aggregation period |
| `endDate` | `string` (YYYY-MM-DD) | `end_date` | End of the aggregation period |
| `dataPoints` | `number` | `data_points` | Number of hours with data in the period |
| `hasGaps` | `boolean` | `has_gaps` | Whether any hours were missing |

### 1.8 ComplianceStatus

Enum for compliance checking across all record types.

```typescript
enum ComplianceStatus {
  COMPLIANT = 'COMPLIANT',
  NON_COMPLIANT = 'NON-COMPLIANT',
  PENDING_REVIEW = 'PENDING_REVIEW',
}
```

### 1.9 CSVExportOptions

Configuration for CSV export behavior, particularly formula injection prevention.

```typescript
interface CSVExportOptions {
  sanitizeFormulas: boolean;    // Whether to sanitize dangerous characters
  includeNonCompliant: boolean; // Whether to include non-compliant records
  dateFormat: string;           // e.g. "MM/DD/YYYY", "YYYY-MM-DD"
}
```

---

## 2. Data Persistence — Rainfall

### 2.1 Authoritative Source

Rainfall data is **stored in Supabase** in the `field_rainfall_hourly` table and is accessed via the `get_rainfall_stats` RPC. This is the sole authoritative data source for rainfall within AcreLedger. The `RainService` in `src/services/RainService.ts` calls this RPC directly — no intermediate or external API is involved.

### 2.2 RPC: `get_rainfall_stats`

```typescript
const { data, error } = await supabase
  .rpc('get_rainfall_stats', {
    p_field_id: field_id,
    p_start_date: p_start_date,
    p_end_date: p_end_date
  });
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `p_field_id` | `UUID` | The field to query |
| `p_start_date` | `string` (YYYY-MM-DD) | Start of the date range |
| `p_end_date` | `string` (YYYY-MM-DD) | End of the date range |

**Returns:** Array of objects with `total_inches`, `field_id`, `start_date`, `end_date`, `data_points`, `has_gaps`.

### 2.3 RainService API

The `RainService` (`src/services/RainService.ts`) exposes three methods:

| Method | Description |
|--------|-------------|
| `getRainfallStats(params)` | Fetch aggregated stats via Supabase RPC |
| `getRainfallHistory(params)` | Fetch hourly records from `field_rainfall_hourly` table |
| `getRecentRainfall(fieldId, days)` | Convenience wrapper for last N days (default: 7) |

> **Critical:** The `RainService` does NOT call any external Vercel API (e.g. `rain-api.vercel.app`). All rainfall data flows through Supabase directly. Search the `/src` directory for `rain-api.vercel.app` — zero results must be found in any source file.

---

## 3. Mapper Conventions

All database ↔ UI mapping is handled by `src/lib/mappers.ts`. This file is the single source of truth for naming conversions, type coercion, and data transformations between the Supabase schema (snake_case) and the TypeScript interfaces (camelCase).

### 3.1 Naming Convention

- **Database columns:** `snake_case` (e.g. `farm_id`, `created_at`, `lot_number`)
- **TypeScript fields:** `camelCase` (e.g. `farmId`, `createdAt`, `lotNumber`)
- Every mapper function handles this conversion bidirectionally using `toCamelCase()` and `toSnakeCase()` helpers.

### 3.2 Mapper Pairs

For every data model in `src/types/farm.ts`, there MUST be two mapper functions:

| Model | DB → UI Mapper | UI → DB Mapper |
|-------|---------------|----------------|
| SavedSeed | `mapDbToSavedSeed()` | `mapSavedSeedToDb()` |
| SprayRecord | `mapDbToSprayRecord()` | `mapSprayRecordToDb()` |
| Field | `mapDbToField()` | `mapFieldToDb()` |
| Farm | `mapDbToFarm()` | `mapFarmToDb()` |
| RainfallRecord | `mapDbToRainfallRecord()` | — (read-only) |
| RainfallStats | `mapDbToRainfallStats()` | — (read-only) |
| PlantRecord | `mapDbToPlantRecord()` | `mapPlantRecordToDb()` |

### 3.3 Type Coercion

- **Numeric fields:** The `coerceNumeric()` helper handles `string | number | null` inputs. This is critical for `treatedAreaSize`, `totalAmountApplied`, `windSpeed`, `temperature`, `acreage`, and `population` which may arrive as strings from Postgres `numeric` columns depending on the driver configuration.
- **Null handling:** All nullable fields default to `null` when the database value is `null` or `undefined`. Empty strings from the database are NOT coerced to `null` — only actual `null`/`undefined` values.
- **Auto-compliance:** `mapSprayRecordToDb()` automatically sets `is_compliant = false` when `epaRegistrationNumber` is null or undefined. This ensures compliance flags are always computed, never manually set.

### 3.4 CSV Formula Injection Prevention

The `sanitizeCsvCell()` function MUST be applied to every cell value before CSV export. It prefixes values starting with `=`, `+`, `-`, `@`, `\t`, `\r`, or `\n` with a single quote to prevent spreadsheet formula injection. See Section 7 (Compliance & Safety) for the full policy.

---

## 4. State Management — Zustand & Optimistic UI

### 4.1 Pattern: Snapshot-Based Rollback

All writable Zustand stores in AcreLedger follow the **snapshot-based rollback pattern** for optimistic UI updates. The reference implementation is in `src/hooks/usePlantRecords.ts`. This pattern MUST be used for all future store creation.

#### How It Works

```
1. User triggers mutation (add / update / delete)
2. Take snapshot:  snapshotRef = JSON.parse(JSON.stringify(currentState))
3. Apply optimistic update to state immediately
4. Persist optimistic state to localStorage (for offline display)
5. Attempt Supabase write (insert / update / delete)
6a. On SUCCESS:
    → Update lastSyncedAt
    → Clear snapshotRef (snapshot = null)
    → Persist to localStorage
6b. On FAILURE:
    → Restore state from snapshotRef
    → Persist restored state to localStorage
    → Set error state for UI notification
    → Clear snapshotRef
```

#### Key Implementation Details

- **Deep copy required:** The snapshot must be a deep copy (`JSON.parse(JSON.stringify(...))`), not a shallow reference. Zustand state objects contain nested arrays and objects that would otherwise be mutated in place.
- **Snapshot cleared on success:** The snapshot is only held for the duration of the async Supabase call. Once the write succeeds, the snapshot is set to `null` to free memory.
- **Error propagation:** The error from Supabase is caught and stored in the store's `error` field so the UI can display a toast or inline message. The user sees their data revert automatically.
- **Idempotency:** If the user triggers the same mutation while a previous one is in-flight, the snapshot should be refreshed to capture the current optimistic state, preventing stale rollbacks.

### 4.2 Store Shape Convention

Every Zustand store in AcreLedger MUST include these fields:

```typescript
interface StoreState {
  // Domain-specific data
  recordsByField: Record<string, ModelType[]>;
  // Loading state
  isLoading: boolean;
  // Last error message
  error: string | null;
  // Last successful Supabase sync timestamp
  lastSyncedAt: string | null;
}

interface StoreActions {
  fetchRecordsByFarm: (farmId: string) => Promise<void>;
  fetchRecordsByField: (fieldId: string) => Promise<void>;
  addRecord: (record: ModelType) => Promise<void>;
  updateRecord: (id: string, updates: Partial<ModelType>) => Promise<void>;
  deleteRecord: (id: string) => Promise<void>;
  restoreFromCache: () => void;
}
```

The `restoreFromCache()` action reads from localStorage and populates the store, enabling immediate display of stale data while a fresh Supabase fetch runs in the background.

---

## 5. Offline Strategy

### 5.1 localStorage as Stale-While-Revalidate Cache

AcreLedger uses `localStorage` for a "Stale-While-Revalidate" display pattern. The strategy is:

1. **On app load / cold start:** Call `restoreFromCache()` to immediately populate the UI with the last known state from localStorage. This gives the user instant access to their data even with no network connection.
2. **In parallel:** Initiate a Supabase fetch. When it completes, replace the localStorage cache with fresh data and update the UI.
3. **On mutation:** Apply the optimistic update to both the in-memory store AND localStorage. This ensures that if the app is closed and reopened before the Supabase write completes, the user's intended state is still visible.
4. **On mutation failure:** The rollback (see Section 4.1) also restores the localStorage cache to the pre-mutation snapshot.

### 5.2 Supabase Is the Authoritative Source of Truth

**localStorage is a display cache ONLY.** It is NOT a backup, NOT a sync mechanism, and NOT a replacement for Supabase. The authoritative state is always what is stored in Supabase. If there is a conflict between localStorage and Supabase, Supabase wins unconditionally.

Key rules:

- `lastSyncedAt` in the store tracks when the last successful Supabase sync occurred. The UI should display a subtle indicator (e.g. "Last synced: 2 minutes ago" or "Showing cached data") when `Date.now() - lastSyncedAt` exceeds a threshold (e.g. 5 minutes).
- If a Supabase fetch fails entirely (network error), the stale localStorage data remains displayed. The UI must show a clear "Offline" or "Unable to sync" indicator.
- localStorage values are stored as JSON strings under namespaced keys: `acreledger_{entity}_records` and `acreledger_{entity}_records_synced_at`.
- If localStorage is full or unavailable (e.g. private browsing on some browsers), the app must fail gracefully — no data is displayed from cache, and all data comes from live Supabase fetches.

### 5.3 Data Freshness Indicators

| Condition | UI Indicator | Behavior |
|-----------|-------------|----------|
| Fresh (synced < 5 min ago) | None (or subtle green dot) | Normal operation |
| Stale (synced 5–60 min ago) | "Showing cached data" banner | Background refresh triggered |
| Offline (Supabase unreachable) | "Offline — changes will sync later" | Optimistic writes allowed, queued |
| Conflict detected | "Sync conflict — tap to review" | Supabase value wins; user notified |

---

## 6. Rain API — Vercel Serverless Endpoint

This section documents the Rain API Vercel deployment that serves as a proxy endpoint for external consumers. Note: AcreLedger's own client code does NOT call this endpoint — it uses the Supabase RPC directly (see Section 2).

### 6.1 API Contract

**Endpoint:** `GET /api/rain` (coordinate mode and field_id mode)

**Modes:**

| Mode | Input | Data Source |
|------|-------|-------------|
| Coordinate mode | `lat` + `lon` | IEM Stage IV radar (direct query) |
| Field ID mode | `field_id` + `date`/`start_date` | Supabase RPC `get_rainfall_stats` |

### 6.2 Implementation

The main handler lives at `api/rain.ts`. It supports two modes:

- **Mode A (lat/lon):** Queries IEM Stage IV directly for coordinate-based rainfall lookups with date range support.
- **Mode B (field_id):** Proxies to the Supabase `get_rainfall_stats` RPC for database-backed field queries.

### 6.3 File Structure

```
acreledger/
├── api/
│   └── rain.ts              # Vercel serverless function (dual-mode proxy)
├── src/
│   ├── types/
│   │   └── farm.ts           # All data model interfaces
│   ├── lib/
│   │   └── mappers.ts        # DB ↔ UI mapping functions
│   ├── services/
│   │   └── RainService.ts    # Supabase RPC rainfall service
│   └── hooks/
│       └── usePlantRecords.ts # Zustand store with optimistic UI
├── lib/                      # Utility libraries (empty, reserved)
├── tests/                    # Test suite
├── blueprint.md              # This file
├── vercel.json               # CORS and routing config
├── tsconfig.json             # TypeScript configuration
└── package.json              # Dependencies and scripts
```

---

## 7. Compliance & Safety

This section codifies the non-negotiable compliance and safety requirements that apply to all AcreLedger code. These rules were established through a formal security and compliance review and MUST be followed without exception.

### 7.1 CSV Formula Injection Prevention

All CSV exports MUST sanitize cell values to prevent formula injection in spreadsheet applications (Excel, Google Sheets, Apple Numbers). The `sanitizeCsvCell()` function in `src/lib/mappers.ts` implements this protection.

**Rule:** Any cell value starting with `=`, `+`, `-`, `@`, `\t`, `\r`, or `\n` MUST be prefixed with a single quote (`'`) before being written to the CSV. This forces the spreadsheet application to interpret the value as a text string rather than a formula.

**Example:**
```
User input:  "=SUM(A1:A100)"
CSV output:  "'=SUM(A1:A100)"
```

This applies to ALL exported data fields without exception — product names, applicator names, notes, EPA numbers, etc. The `CSVExportOptions.sanitizeFormulas` flag exists for testing purposes only; in production, sanitization is always enabled and cannot be disabled.

### 7.2 EPA Registration Number Compliance

Pesticide application records that are missing an EPA Registration Number MUST be flagged as `NON-COMPLIANT` in all UI views and exports. This is enforced at two levels:

1. **Mapper level:** `mapSprayRecordToDb()` in `src/lib/mappers.ts` automatically sets `is_compliant = false` when `epaRegistrationNumber` is null or undefined. This ensures the database always reflects the correct compliance state.
2. **UI level:** All list views, detail views, and dashboard cards that display spray records MUST show a visible non-compliance indicator (e.g. a red badge, warning icon, or "NON-COMPLIANT" label) when `isCompliant === false`.
3. **Export level:** CSV and PDF exports MUST include the compliance status. Records flagged as non-compliant MUST be clearly marked in the export (e.g. a "Compliance" column with "NON-COMPLIANT" value). Exports may optionally exclude non-compliant records when `CSVExportOptions.includeNonCompliant` is set to `false`.

### 7.3 API Key Protection

API keys, Supabase tokens, and any other secret credentials MUST NEVER be logged to the console in any environment — including development. This is a security requirement, not a best practice suggestion.

**Allowed:** Logging error messages (`error.message`), status codes, and generic failure descriptions.
**Prohibited:** Logging the full error object (which may contain connection strings), environment variable values, or any string containing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VERCEL_OIDC_TOKEN`, or similar secret identifiers.

The `RainService.ts` implements this by only logging `error.message` from Supabase errors, never the full error object:

```typescript
// CORRECT
console.error('RainService: RPC call failed:', error.message);

// PROHIBITED — may leak connection details
console.error('RainService: RPC call failed:', error);
```

### 7.4 Environment Variable Handling

All secrets (Supabase credentials, API tokens) MUST be:

1. Stored only in Vercel environment variables (configured via dashboard or CLI).
2. Accessed exclusively via `process.env.VARIABLE_NAME`.
3. NEVER committed to the repository in plain text.
4. NEVER included in client-side bundles (verified by `src/` being server-only code).

The `.env.vercel` file in the repository root is gitignored and used only for local development. It MUST NOT contain production credentials.

---

## 8. Error Handling and Resilience

### 8.1 Supabase RPC Errors

The `RainService` handles Supabase RPC errors gracefully:

1. Check for `error` in the Supabase response.
2. Log only the error message (never the full error object — see Section 7.3).
3. Throw a descriptive error for the caller to handle.
4. Return a zero-value `RainfallStats` object (not `null`) when no data is found — this prevents null-check cascading in the UI.

### 8.2 Optimistic UI Rollback

See Section 4.1 for the full snapshot-based rollback pattern. Key points:

- The snapshot is taken BEFORE any state mutation.
- On Supabase failure, the snapshot is restored atomically (single `set()` call).
- The user sees a brief flash of the new data, then it reverts to the original, accompanied by an error message.
- localStorage is also rolled back to maintain cache consistency.

### 8.3 Input Validation

All user-facing inputs are validated before being sent to Supabase:

- **UUIDs:** Must match the UUID v4 format.
- **Dates:** Must be valid ISO 8601 date strings (YYYY-MM-DD).
- **Numeric fields:** Must be finite numbers within expected ranges.
- **String fields:** Maximum length checks prevent database constraint violations.

---

## 9. Deployment

### 9.1 Vercel Configuration

```json
{
  "rewrites": [
    { "source": "/rain", "destination": "/api/rain" },
    { "source": "/rainfall", "destination": "/api/rain" }
  ],
  "headers": [
    {
      "source": "/api/rain",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET, OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Content-Type" }
      ]
    }
  ]
}
```

### 9.2 Environment Variables

| Variable | Required For | Description |
|----------|-------------|-------------|
| `SUPABASE_URL` | Field ID mode, RainService | Supabase project URL |
| `SUPABASE_ANON_KEY` | Field ID mode, RainService | Supabase anonymous key |

### 9.3 Deploy Workflow

1. Push to `main` branch → Vercel auto-deploys.
2. Environment variables must be configured in Vercel dashboard → Project → Settings → Environment Variables.
3. Verify both `/api/rain` and `/rain` aliases resolve after deploy.

---

## 10. Summary

| Item | Decision |
|------|----------|
| **Data models** | Defined in `src/types/farm.ts` |
| **Mapper layer** | `src/lib/mappers.ts` — snake_case ↔ camelCase, all models |
| **Rainfall source** | Supabase `get_rainfall_stats` RPC — NOT external Vercel API |
| **State management** | Zustand with snapshot-based optimistic UI rollback |
| **Offline strategy** | localStorage stale-while-revalidate; Supabase is authoritative |
| **Compliance** | CSV formula sanitization, EPA # auto-flagging, API key protection |
| **Hosting** | Vercel Hobby (free tier, serverless) |
| **Deploy workflow** | Git push to main → Vercel auto-deploys |
