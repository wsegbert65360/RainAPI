# AcreLedger — Blueprint

**Data source:** Supabase (PostgreSQL) — sole authoritative source of truth.
**Hosting:** Vercel Hobby (free tier, serverless, Git-push deploy).

## File Structure

```
src/
├── types/farm.ts            # All data model interfaces
├── lib/mappers.ts           # DB ↔ UI mapping (snake_case ↔ camelCase)
├── services/RainService.ts  # Supabase RPC rainfall service
└── hooks/usePlantRecords.ts # Zustand store with optimistic UI
```

---

## 1. Data Models

All interfaces live in `src/types/farm.ts`. Every field below MUST exist in the code AND the Supabase schema. Mappers in `src/lib/mappers.ts` handle every field bidirectionally.

### 1.1 Farm

| Field | Type | DB Column |
|-------|------|-----------|
| `id` | `string` (UUID) | `id` |
| `name` | `string` | `name` |
| `location` | `string \| null` | `location` |
| `totalAcreage` | `number \| null` | `total_acreage` |
| `createdAt` | `string` | `created_at` |
| `updatedAt` | `string` | `updated_at` |

### 1.2 Field

| Field | Type | DB Column |
|-------|------|-----------|
| `id` | `string` (UUID) | `id` |
| `farmId` | `string` (UUID) | `farm_id` |
| `name` | `string` | `name` |
| `acreage` | `number \| null` | `acreage` |
| `boundary` | `object \| null` | `boundary` |
| `centroidLat` | `number \| null` | `centroid_lat` |
| `centroidLon` | `number \| null` | `centroid_lon` |
| `currentCrop` | `string \| null` | `current_crop` |
| `createdAt` | `string` | `created_at` |
| `updatedAt` | `string` | `updated_at` |

### 1.3 SavedSeed

| Field | Type | DB Column |
|-------|------|-----------|
| `id` | `string` (UUID) | `id` |
| `name` | `string` | `name` |
| `farmId` | `string` (UUID) | `farm_id` |
| `crop` | `string \| null` | `crop` |
| `variety` | `string \| null` | `variety` |
| `supplier` | `string \| null` | `supplier` |
| `lotNumber` | `string \| null` | `lot_number` |
| `year` | `number \| null` | `year` |
| `createdAt` | `string` | `created_at` |
| `updatedAt` | `string` | `updated_at` |

### 1.4 SprayRecord

| Field | Type | DB Column |
|-------|------|-----------|
| `id` | `string` (UUID) | `id` |
| `fieldId` | `string` (UUID) | `field_id` |
| `farmId` | `string` (UUID) | `farm_id` |
| `productName` | `string` | `product_name` |
| `epaRegistrationNumber` | `string \| null` | `epa_registration_number` |
| `applicationDate` | `string` | `application_date` |
| `treatedAreaSize` | `number \| null` | `treated_area_size` |
| `totalAmountApplied` | `number \| null` | `total_amount_applied` |
| `applicationUnit` | `string \| null` | `application_unit` |
| `applicationMethod` | `string \| null` | `application_method` |
| `windSpeed` | `number \| null` | `wind_speed` |
| `windDirection` | `string \| null` | `wind_direction` |
| `temperature` | `number \| null` | `temperature` |
| `applicator` | `string \| null` | `applicator` |
| `notes` | `string \| null` | `notes` |
| `isCompliant` | `boolean \| null` | `is_compliant` |
| `createdAt` | `string` | `created_at` |
| `updatedAt` | `string` | `updated_at` |

> **String/Number handling:** `treatedAreaSize` and `totalAmountApplied` are stored as `numeric` in the database but may be captured as `string` in the UI for input flexibility. The mappers use `coerceNumeric()` to handle both representations safely.

### 1.5 PlantRecord

| Field | Type | DB Column |
|-------|------|-----------|
| `id` | `string` (UUID) | `id` |
| `fieldId` | `string` (UUID) | `field_id` |
| `farmId` | `string` (UUID) | `farm_id` |
| `seedId` | `string \| null` | `seed_id` |
| `crop` | `string` | `crop` |
| `variety` | `string \| null` | `variety` |
| `population` | `number \| null` | `population` |
| `plantingDate` | `string` | `planting_date` |
| `targetHarvestDate` | `string \| null` | `target_harvest_date` |
| `notes` | `string \| null` | `notes` |
| `createdAt` | `string` | `created_at` |
| `updatedAt` | `string` | `updated_at` |

### 1.6 RainfallRecord

Stored in `field_rainfall_hourly` table, accessed via `get_rainfall_stats` RPC. NOT fetched from any external API.

| Field | Type | DB Column |
|-------|------|-----------|
| `fieldId` | `string` (UUID) | `field_id` |
| `date` | `string` | `date` |
| `hour` | `string` | `hour` |
| `precipInches` | `number` | `precip_inches` |
| `isValidated` | `boolean` | `is_validated` |

### 1.7 RainfallStats

Returned by the `get_rainfall_stats` Supabase RPC.

| Field | Type | DB Column |
|-------|------|-----------|
| `fieldId` | `string` | `field_id` |
| `totalInches` | `number` | `total_inches` |
| `startDate` | `string` | `start_date` |
| `endDate` | `string` | `end_date` |
| `dataPoints` | `number` | `data_points` |
| `hasGaps` | `boolean` | `has_gaps` |

### 1.8 Supporting Types

```typescript
enum ComplianceStatus {
  COMPLIANT = 'COMPLIANT',
  NON_COMPLIANT = 'NON-COMPLIANT',
  PENDING_REVIEW = 'PENDING_REVIEW',
}

interface CSVExportOptions {
  sanitizeFormulas: boolean;
  includeNonCompliant: boolean;
  dateFormat: string;
}
```

---

## 2. Mapper Conventions

All mapping in `src/lib/mappers.ts`.

**Naming:** DB columns are `snake_case`, TypeScript fields are `camelCase`. DB → UI mappers use the `toCamelCase()` helper. UI → DB mappers use explicit field assignment (not `toSnakeCase()`) for clarity and control over which fields are included.

**Mapper pairs:**

| Model | DB → UI | UI → DB |
|-------|---------|---------|
| Farm | `mapDbToFarm()` | `mapFarmToDb()` |
| Field | `mapDbToField()` | `mapFieldToDb()` |
| SavedSeed | `mapDbToSavedSeed()` | `mapSavedSeedToDb()` |
| SprayRecord | `mapDbToSprayRecord()` | `mapSprayRecordToDb()` |
| PlantRecord | `mapDbToPlantRecord()` | `mapPlantRecordToDb()` |
| RainfallRecord | `mapDbToRainfallRecord()` | — (read-only) |
| RainfallStats | `mapDbToRainfallStats()` | — (read-only) |

**Type coercion:** `coerceNumeric()` handles `string | number | null` → `number | null` for fields like `treatedAreaSize`, `totalAmountApplied`, `acreage`, `population`, `windSpeed`, `temperature`.

**Auto-compliance:** `mapSprayRecordToDb()` automatically sets `is_compliant = false` when `epaRegistrationNumber` is null.

---

## 3. Rainfall — Data Persistence

Rainfall is stored in Supabase `field_rainfall_hourly` and accessed via the `get_rainfall_stats` RPC. The `RainService` (`src/services/RainService.ts`) calls Supabase directly — no external Vercel API is involved.

**RPC call:**

```typescript
const { data, error } = await supabase.rpc('get_rainfall_stats', {
  p_field_id: fieldId,
  p_start_date: startDate,
  p_end_date: endDate,
});
```

**RainService methods:**

| Method | Description |
|--------|-------------|
| `getRainfallStats(params)` | Aggregated stats via RPC |
| `getRainfallHistory(params)` | Hourly records from `field_rainfall_hourly` |
| `getRecentRainfall(fieldId, days)` | Last N days (default: 7) |

---

## 4. State Management — Zustand & Optimistic UI

Reference implementation: `src/hooks/usePlantRecords.ts`. All future stores MUST follow this pattern.

**Snapshot-based rollback flow:**

```
1. Snapshot current state (deep copy)
2. Apply optimistic update to state + localStorage
3. Attempt Supabase write
4. On success → clear snapshot, update lastSyncedAt
5. On failure → restore snapshot in state + localStorage, set error
```

**Store shape (every store MUST include):**

```typescript
// State
recordsByField: Record<string, ModelType[]>;
isLoading: boolean;
error: string | null;
lastSyncedAt: string | null;

// Actions
fetchRecordsByFarm(farmId: string): Promise<void>;
fetchRecordsByField(fieldId: string): Promise<void>;
addRecord(record: ModelType): Promise<void>;
updateRecord(id: string, updates: Partial<ModelType>): Promise<void>;
deleteRecord(id: string): Promise<void>;
restoreFromCache(): void;
```

---

## 5. Offline Strategy

`localStorage` is used for **stale-while-revalidate display only**. Supabase is the authoritative source — if they conflict, Supabase wins.

- **App load:** `restoreFromCache()` populates UI immediately; Supabase fetch runs in parallel and replaces cache on success.
- **Mutations:** Optimistic state is written to both memory and localStorage. On failure, both are rolled back from the snapshot.
- **Cache keys:** `acreledger_{entity}_records` and `acreledger_{entity}_records_synced_at`.
- **localStorage unavailable:** Fail gracefully — show nothing from cache, rely on live Supabase fetches.

---

## 6. Compliance & Safety

### 6.1 CSV Formula Injection Prevention

`sanitizeCsvCell()` in `src/lib/mappers.ts` MUST be applied to every cell value before CSV export. Values starting with `=`, `+`, `-`, `@`, `\t`, `\r`, or `\n` are prefixed with `'` to force text interpretation in spreadsheets.

### 6.2 EPA Registration Number Compliance

Records missing `epaRegistrationNumber` are flagged `NON-COMPLIANT` at three levels:
- **Mapper:** `mapSprayRecordToDb()` auto-sets `is_compliant = false` when EPA # is null.
- **UI:** All views MUST show a visible non-compliance indicator when `isCompliant === false`.
- **Export:** CSV/PDF MUST include compliance status; non-compliant records clearly marked.

### 6.3 API Key Protection

API keys and secrets MUST NEVER be logged to console in any environment. Log only `error.message`, never the full error object. Secrets stored only in Vercel environment variables, never committed to the repository.
