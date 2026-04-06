// =============================================================================
// AcreLedger — Database ↔ UI Mappers
// =============================================================================
// Strict two-way mapping between Supabase column names (snake_case) and
// TypeScript interface field names (camelCase). Every model in
// src/types/farm.ts MUST have a corresponding pair of mapper functions.
// =============================================================================

import type {
  SavedSeed,
  SprayRecord,
  Field,
  Farm,
  RainfallRecord,
  RainfallStats,
  PlantRecord,
} from '../types/farm';

// =============================================================================
// Generic Helpers
// =============================================================================

/**
 * Convert a snake_case database row to a camelCase TypeScript object.
 * Handles common edge cases: null passthrough, numeric string coercion.
 */
function toCamelCase(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

/**
 * Convert a camelCase TypeScript object to a snake_case database row.
 * Only includes keys present in the source object (partial updates supported).
 */
function toSnakeCase(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    result[snakeKey] = value;
  }
  return result;
}

// =============================================================================
// SavedSeed Mappers
// =============================================================================

/**
 * Map a Supabase `saved_seeds` row to a SavedSeed TypeScript interface.
 *
 * Database columns expected:
 *   id, name, farm_id, crop, variety, supplier, lot_number, year,
 *   created_at, updated_at
 */
export function mapDbToSavedSeed(row: Record<string, any>): SavedSeed {
  const camel = toCamelCase(row);
  return {
    id: String(camel.id ?? ''),
    name: String(camel.name ?? ''),
    farmId: String(camel.farmId ?? ''),
    crop: camel.crop != null ? String(camel.crop) : null,
    variety: camel.variety != null ? String(camel.variety) : null,
    supplier: camel.supplier != null ? String(camel.supplier) : null,
    lotNumber: camel.lotNumber != null ? String(camel.lotNumber) : null,
    year: camel.year != null ? Number(camel.year) : null,
    createdAt: String(camel.createdAt ?? ''),
    updatedAt: String(camel.updatedAt ?? ''),
  };
}

/**
 * Map a SavedSeed TypeScript interface to a Supabase `saved_seeds` insert/update row.
 * Omits `id`, `createdAt`, and `updatedAt` (handled by Supabase defaults / triggers).
 */
export function mapSavedSeedToDb(seed: Partial<SavedSeed>): Record<string, any> {
  const clean: Record<string, any> = {};
  if (seed.name !== undefined) clean.name = seed.name;
  if (seed.farmId !== undefined) clean.farm_id = seed.farmId;
  if (seed.crop !== undefined) clean.crop = seed.crop;
  if (seed.variety !== undefined) clean.variety = seed.variety;
  if (seed.supplier !== undefined) clean.supplier = seed.supplier;
  if (seed.lotNumber !== undefined) clean.lot_number = seed.lotNumber;
  if (seed.year !== undefined) clean.year = seed.year;
  return clean;
}

// =============================================================================
// SprayRecord Mappers
// =============================================================================

/**
 * Map a Supabase `spray_records` row to a SprayRecord TypeScript interface.
 *
 * Database columns expected:
 *   id, field_id, farm_id, product_name, epa_registration_number,
 *   application_date, treated_area_size, total_amount_applied,
 *   application_unit, application_method, wind_speed, wind_direction,
 *   temperature, applicator, notes, is_compliant, created_at, updated_at
 *
 * Note: `treatedAreaSize` and `totalAmountApplied` are stored as `numeric`
 * in the database but may arrive as strings from certain Postgres drivers.
 * These mappers handle both representations.
 */
export function mapDbToSprayRecord(row: Record<string, any>): SprayRecord {
  const camel = toCamelCase(row);
  return {
    id: String(camel.id ?? ''),
    fieldId: String(camel.fieldId ?? ''),
    farmId: String(camel.farmId ?? ''),
    productName: String(camel.productName ?? ''),
    epaRegistrationNumber: camel.epaRegistrationNumber != null
      ? String(camel.epaRegistrationNumber)
      : null,
    applicationDate: String(camel.applicationDate ?? ''),
    treatedAreaSize: coerceNumeric(camel.treatedAreaSize),
    totalAmountApplied: coerceNumeric(camel.totalAmountApplied),
    applicationUnit: camel.applicationUnit != null ? String(camel.applicationUnit) : null,
    applicationMethod: camel.applicationMethod != null ? String(camel.applicationMethod) : null,
    windSpeed: coerceNumeric(camel.windSpeed),
    windDirection: camel.windDirection != null ? String(camel.windDirection) : null,
    temperature: coerceNumeric(camel.temperature),
    applicator: camel.applicator != null ? String(camel.applicator) : null,
    notes: camel.notes != null ? String(camel.notes) : null,
    isCompliant: camel.isCompliant ?? null,
    createdAt: String(camel.createdAt ?? ''),
    updatedAt: String(camel.updatedAt ?? ''),
  };
}

/**
 * Map a SprayRecord TypeScript interface to a Supabase `spray_records` insert/update row.
 * Automatically flags records as non-compliant if EPA Registration Number is missing.
 */
export function mapSprayRecordToDb(record: Partial<SprayRecord>): Record<string, any> {
  const clean: Record<string, any> = {};
  if (record.fieldId !== undefined) clean.field_id = record.fieldId;
  if (record.farmId !== undefined) clean.farm_id = record.farmId;
  if (record.productName !== undefined) clean.product_name = record.productName;
  if (record.epaRegistrationNumber !== undefined) {
    clean.epa_registration_number = record.epaRegistrationNumber;
  }
  if (record.applicationDate !== undefined) clean.application_date = record.applicationDate;
  if (record.treatedAreaSize !== undefined) clean.treated_area_size = record.treatedAreaSize;
  if (record.totalAmountApplied !== undefined) clean.total_amount_applied = record.totalAmountApplied;
  if (record.applicationUnit !== undefined) clean.application_unit = record.applicationUnit;
  if (record.applicationMethod !== undefined) clean.application_method = record.applicationMethod;
  if (record.windSpeed !== undefined) clean.wind_speed = record.windSpeed;
  if (record.windDirection !== undefined) clean.wind_direction = record.windDirection;
  if (record.temperature !== undefined) clean.temperature = record.temperature;
  if (record.applicator !== undefined) clean.applicator = record.applicator;
  if (record.notes !== undefined) clean.notes = record.notes;
  // Auto-flag non-compliance when EPA number is missing
  if (record.epaRegistrationNumber === null || record.epaRegistrationNumber === undefined) {
    clean.is_compliant = false;
  } else if (record.isCompliant !== undefined) {
    clean.is_compliant = record.isCompliant;
  }
  return clean;
}

// =============================================================================
// Field Mappers
// =============================================================================

/**
 * Map a Supabase `fields` row to a Field TypeScript interface.
 */
export function mapDbToField(row: Record<string, any>): Field {
  const camel = toCamelCase(row);
  return {
    id: String(camel.id ?? ''),
    farmId: String(camel.farmId ?? ''),
    name: String(camel.name ?? ''),
    acreage: coerceNumeric(camel.acreage),
    boundary: camel.boundary ?? null,
    centroidLat: coerceNumeric(camel.centroidLat),
    centroidLon: coerceNumeric(camel.centroidLon),
    currentCrop: camel.currentCrop != null ? String(camel.currentCrop) : null,
    createdAt: String(camel.createdAt ?? ''),
    updatedAt: String(camel.updatedAt ?? ''),
  };
}

/**
 * Map a Field TypeScript interface to a Supabase `fields` insert/update row.
 */
export function mapFieldToDb(field: Partial<Field>): Record<string, any> {
  const clean: Record<string, any> = {};
  if (field.farmId !== undefined) clean.farm_id = field.farmId;
  if (field.name !== undefined) clean.name = field.name;
  if (field.acreage !== undefined) clean.acreage = field.acreage;
  if (field.boundary !== undefined) clean.boundary = field.boundary;
  if (field.centroidLat !== undefined) clean.centroid_lat = field.centroidLat;
  if (field.centroidLon !== undefined) clean.centroid_lon = field.centroidLon;
  if (field.currentCrop !== undefined) clean.current_crop = field.currentCrop;
  return clean;
}

// =============================================================================
// Farm Mappers
// =============================================================================

/**
 * Map a Supabase `farms` row to a Farm TypeScript interface.
 */
export function mapDbToFarm(row: Record<string, any>): Farm {
  const camel = toCamelCase(row);
  return {
    id: String(camel.id ?? ''),
    name: String(camel.name ?? ''),
    location: camel.location != null ? String(camel.location) : null,
    totalAcreage: coerceNumeric(camel.totalAcreage),
    createdAt: String(camel.createdAt ?? ''),
    updatedAt: String(camel.updatedAt ?? ''),
  };
}

/**
 * Map a Farm TypeScript interface to a Supabase `farms` insert/update row.
 */
export function mapFarmToDb(farm: Partial<Farm>): Record<string, any> {
  const clean: Record<string, any> = {};
  if (farm.name !== undefined) clean.name = farm.name;
  if (farm.location !== undefined) clean.location = farm.location;
  if (farm.totalAcreage !== undefined) clean.total_acreage = farm.totalAcreage;
  return clean;
}

// =============================================================================
// Rainfall Mappers
// =============================================================================

/**
 * Map a Supabase `field_rainfall_hourly` row to a RainfallRecord interface.
 */
export function mapDbToRainfallRecord(row: Record<string, any>): RainfallRecord {
  const camel = toCamelCase(row);
  return {
    fieldId: String(camel.fieldId ?? ''),
    date: String(camel.date ?? ''),
    hour: String(camel.hour ?? ''),
    precipInches: Number(camel.precipInches ?? 0),
    isValidated: Boolean(camel.isValidated ?? false),
  };
}

/**
 * Map the result of the `get_rainfall_stats` RPC to a RainfallStats interface.
 */
export function mapDbToRainfallStats(row: Record<string, any>): RainfallStats {
  const camel = toCamelCase(row);
  return {
    fieldId: String(camel.fieldId ?? ''),
    totalInches: Number(camel.totalInches ?? 0),
    startDate: String(camel.startDate ?? ''),
    endDate: String(camel.endDate ?? ''),
    dataPoints: Number(camel.dataPoints ?? 0),
    hasGaps: Boolean(camel.hasGaps ?? false),
  };
}

// =============================================================================
// PlantRecord Mappers
// =============================================================================

/**
 * Map a Supabase `plant_records` row to a PlantRecord TypeScript interface.
 */
export function mapDbToPlantRecord(row: Record<string, any>): PlantRecord {
  const camel = toCamelCase(row);
  return {
    id: String(camel.id ?? ''),
    fieldId: String(camel.fieldId ?? ''),
    farmId: String(camel.farmId ?? ''),
    seedId: camel.seedId != null ? String(camel.seedId) : null,
    crop: String(camel.crop ?? ''),
    variety: camel.variety != null ? String(camel.variety) : null,
    population: coerceNumeric(camel.population),
    plantingDate: String(camel.plantingDate ?? ''),
    targetHarvestDate: camel.targetHarvestDate != null ? String(camel.targetHarvestDate) : null,
    notes: camel.notes != null ? String(camel.notes) : null,
    createdAt: String(camel.createdAt ?? ''),
    updatedAt: String(camel.updatedAt ?? ''),
  };
}

/**
 * Map a PlantRecord TypeScript interface to a Supabase `plant_records` insert/update row.
 */
export function mapPlantRecordToDb(record: Partial<PlantRecord>): Record<string, any> {
  const clean: Record<string, any> = {};
  if (record.fieldId !== undefined) clean.field_id = record.fieldId;
  if (record.farmId !== undefined) clean.farm_id = record.farmId;
  if (record.seedId !== undefined) clean.seed_id = record.seedId;
  if (record.crop !== undefined) clean.crop = record.crop;
  if (record.variety !== undefined) clean.variety = record.variety;
  if (record.population !== undefined) clean.population = record.population;
  if (record.plantingDate !== undefined) clean.planting_date = record.plantingDate;
  if (record.targetHarvestDate !== undefined) clean.target_harvest_date = record.targetHarvestDate;
  if (record.notes !== undefined) clean.notes = record.notes;
  return clean;
}

// =============================================================================
// CSV Export Safety — Formula Injection Sanitizer
// =============================================================================

/**
 * Sanitize a single cell value to prevent CSV formula injection.
 * Prefixes dangerous leading characters with a single quote.
 *
 * Dangerous characters: `=`, `+`, `-`, `@`, `\t`, `\r`, `\n`
 *
 * This MUST be applied to every cell value before CSV export.
 */
export function sanitizeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/^[=+\-@\t\r\n]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

// =============================================================================
// Internal Utilities
// =============================================================================

/**
 * Coerce a value to number | null.
 * Handles string representations from Postgres numeric columns,
 * null/undefined passthrough, and NaN safety.
 */
function coerceNumeric(value: any): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return isNaN(num) ? null : num;
}
