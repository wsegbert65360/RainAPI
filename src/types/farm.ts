// =============================================================================
// AcreLedger — Farm Data Type Definitions
// =============================================================================
// Canonical type definitions for all core AcreLedger domain models.
// Every field documented here MUST exist in the Supabase schema and
// must be mapped in src/lib/mappers.ts.
// =============================================================================

// -----------------------------------------------------------------------------
// SavedSeed — Represents a seed product saved to a user's account
// -----------------------------------------------------------------------------
export interface SavedSeed {
  /** Unique identifier (UUID) — primary key */
  id: string;
  /** Display name given by the user (e.g. "DKC 65-95") */
  name: string;
  /** UUID of the farm this seed belongs to */
  farmId: string;
  /** Crop type (e.g. "Corn", "Soybeans", "Wheat") */
  crop: string | null;
  /** Variety or brand identifier (e.g. "Dekalb", "Pioneer") */
  variety: string | null;
  /** Supplier/vendor name (e.g. "Stine Seed", "AgriGold") */
  supplier: string | null;
  /** Lot/batch number from the seed tag */
  lotNumber: string | null;
  /** Production year (e.g. 2026) */
  year: number | null;
  /** ISO 8601 timestamp of record creation */
  createdAt: string;
  /** ISO 8601 timestamp of last modification */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// SprayRecord — Pesticide / herbicide / fungicide application record
// -----------------------------------------------------------------------------
export interface SprayRecord {
  /** Unique identifier (UUID) — primary key */
  id: string;
  /** UUID of the field this application was made on */
  fieldId: string;
  /** UUID of the farm this field belongs to */
  farmId: string;
  /** Product name as it appears on the label */
  productName: string;
  /** EPA Registration Number from the product label */
  epaRegistrationNumber: string | null;
  /** Application date — ISO 8601 date string (YYYY-MM-DD) */
  applicationDate: string;
  /**
   * Area treated in acres.
   * Stored as `number` in the database for calculations.
   * May be captured as `string` in the UI for input flexibility
   * (e.g. user types "120.5" before parsing).
   */
  treatedAreaSize: number | null;
  /**
   * Total product amount applied.
   * Stored as `number` in the database for calculations and exports.
   * May be captured as `string` in the UI for input flexibility.
   */
  totalAmountApplied: number | null;
  /** Unit of measurement for totalAmountApplied (e.g. "oz", "fl oz", "lbs") */
  applicationUnit: string | null;
  /** Application method (e.g. "Ground Sprayer", "Aerial", "Chemigation") */
  applicationMethod: string | null;
  /** Wind speed in mph at time of application */
  windSpeed: number | null;
  /** Wind direction at time of application (e.g. "N", "NE", "SSW") */
  windDirection: string | null;
  /** Temperature in Fahrenheit at time of application */
  temperature: number | null;
  /** Applicator name or license number */
  applicator: string | null;
  /** Free-form notes about the application */
  notes: string | null;
  /** Whether the record is flagged as non-compliant (missing EPA #) */
  isCompliant: boolean | null;
  /** ISO 8601 timestamp of record creation */
  createdAt: string;
  /** ISO 8601 timestamp of last modification */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// Field — Represents a physical field / parcel within a farm
// -----------------------------------------------------------------------------
export interface Field {
  /** Unique identifier (UUID) — primary key */
  id: string;
  /** UUID of the farm this field belongs to */
  farmId: string;
  /** User-given name for the field (e.g. "North 80", "Home Quarter") */
  name: string;
  /** Total acreage of the field */
  acreage: number | null;
  /** GeoJSON polygon boundary (lon/lat coordinate ring) */
  boundary: object | null;
  /** Latitude (decimal degrees) */
  latitude: number | null;
  /** Longitude (decimal degrees) */
  longitude: number | null;
  /** Crop currently planted (if any) */
  currentCrop: string | null;
  /** ISO 8601 timestamp of record creation */
  createdAt: string;
  /** ISO 8601 timestamp of last modification */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// Farm — Top-level farm entity
// -----------------------------------------------------------------------------
export interface Farm {
  /** Unique identifier (UUID) — primary key */
  id: string;
  /** User-given farm name */
  name: string;
  /** General location description (free text) */
  location: string | null;
  /** Total acreage across all fields */
  totalAcreage: number | null;
  /** ISO 8601 timestamp of record creation */
  createdAt: string;
  /** ISO 8601 timestamp of last modification */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// RainfallRecord — Hourly rainfall data point for a field
// Stored in Supabase `field_rainfall_hourly` table.
// Data originates from MRMS MultiSensor QPE Pass 2 (NOAA) via the
// backfill pipeline (backfill_rain.ts). Also accessible via the
// `get_rainfall_stats` RPC for aggregated queries.
// -----------------------------------------------------------------------------
export interface RainfallRecord {
  /** UUID of the field this reading belongs to */
  fieldId: string;
  /** ISO 8601 UTC timestamp of the reading (e.g. "2026-03-21T14:00:00Z") */
  timestampUtc: string;
  /** Precipitation amount in inches */
  rainfallIn: number;
  /** Data source label (e.g. "Pass 2") */
  source: string;
  /** Whether this reading is finalized (backfill complete) */
  finalized: boolean;
}

// -----------------------------------------------------------------------------
// RainfallStats — Aggregated rainfall statistics returned by `get_rainfall_stats` RPC
// -----------------------------------------------------------------------------
export interface RainfallStats {
  /** UUID of the field */
  fieldId: string;
  /** Total rainfall in inches over the requested period */
  totalInches: number;
  /** Start date of the aggregation period */
  startDate: string;
  /** End date of the aggregation period */
  endDate: string;
  /** Number of hours with data in the period */
  dataPoints: number;
  /** Whether any hours were missing (data quality flag) */
  hasGaps: boolean;
}

// -----------------------------------------------------------------------------
// PlantRecord — A planting event tied to a field
// -----------------------------------------------------------------------------
export interface PlantRecord {
  /** Unique identifier (UUID) — primary key */
  id: string;
  /** UUID of the field where the planting occurred */
  fieldId: string;
  /** UUID of the farm this field belongs to */
  farmId: string;
  /** UUID of the SavedSeed used (if applicable) */
  seedId: string | null;
  /** Crop type planted */
  crop: string;
  /** Variety planted */
  variety: string | null;
  /** Planting population (seeds per acre) */
  population: number | null;
  /** Planting date — ISO 8601 date string */
  plantingDate: string;
  /** Target harvest date — ISO 8601 date string */
  targetHarvestDate: string | null;
  /** Free-form notes */
  notes: string | null;
  /** ISO 8601 timestamp of record creation */
  createdAt: string;
  /** ISO 8601 timestamp of last modification */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// Compliance Status — Enum for compliance checking
// -----------------------------------------------------------------------------
export enum ComplianceStatus {
  COMPLIANT = 'COMPLIANT',
  NON_COMPLIANT = 'NON-COMPLIANT',
  PENDING_REVIEW = 'PENDING_REVIEW',
}

// -----------------------------------------------------------------------------
// CSV Export Safety — Types for formula injection prevention
// -----------------------------------------------------------------------------
export interface CSVExportOptions {
  /** Whether to sanitize formula-injection characters */
  sanitizeFormulas: boolean;
  /** Whether to include non-compliant records in exports */
  includeNonCompliant: boolean;
  /** Date format for export (e.g. "MM/DD/YYYY", "YYYY-MM-DD") */
  dateFormat: string;
}
