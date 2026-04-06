// =============================================================================
// AcreLedger — usePlantRecords Hook
// =============================================================================
// Zustand-backed store for plant records with:
//   - Optimistic UI updates (write to state immediately, sync to Supabase async)
//   - Snapshot-based rollback on failure (previousRef/snapshotRef pattern)
//   - localStorage persistence for "Stale-While-Revalidate" offline display
//   - Supabase as the authoritative source of truth
// =============================================================================

import type { PlantRecord } from '../types/farm';
import { mapDbToPlantRecord, mapPlantRecordToDb } from '../lib/mappers';

// -----------------------------------------------------------------------------
// Store State Shape
// -----------------------------------------------------------------------------

export interface PlantRecordsState {
  /** All plant records keyed by field ID */
  recordsByField: Record<string, PlantRecord[]>;
  /** Whether a Supabase fetch is in progress */
  isLoading: boolean;
  /** Last fetch error, if any */
  error: string | null;
  /** ISO 8601 timestamp of the last successful Supabase sync */
  lastSyncedAt: string | null;
}

export interface PlantRecordsActions {
  /** Fetch all plant records for a farm from Supabase and update state */
  fetchRecordsByFarm: (farmId: string) => Promise<void>;
  /** Fetch plant records for a specific field */
  fetchRecordsByField: (fieldId: string) => Promise<void>;
  /** Add a plant record (optimistic — updates UI immediately) */
  addRecord: (record: PlantRecord) => Promise<void>;
  /** Update a plant record (optimistic — updates UI immediately) */
  updateRecord: (id: string, updates: Partial<PlantRecord>) => Promise<void>;
  /** Delete a plant record (optimistic — removes from UI immediately) */
  deleteRecord: (id: string) => Promise<void>;
  /** Restore state from localStorage (for offline / cold-start display) */
  restoreFromCache: () => void;
}

// -----------------------------------------------------------------------------
// LocalStorage Cache Keys
// -----------------------------------------------------------------------------

const CACHE_KEY = 'acreledger_plant_records';
const SYNC_KEY = 'acreledger_plant_records_synced_at';

// -----------------------------------------------------------------------------
// Snapshot Ref for Rollback
// -----------------------------------------------------------------------------
// The `previousRef` / `snapshotRef` pattern:
// Before every optimistic mutation, we snapshot the current state.
// If the Supabase call fails, we rollback to the snapshot.
// This prevents the UI from showing data that was never persisted.
// -----------------------------------------------------------------------------

function takeSnapshot(state: PlantRecordsState): PlantRecordsState {
  return JSON.parse(JSON.stringify(state));
}

function saveToCache(state: PlantRecordsState): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state.recordsByField));
    if (state.lastSyncedAt) {
      localStorage.setItem(SYNC_KEY, state.lastSyncedAt);
    }
  } catch {
    // localStorage may be full or unavailable — fail silently.
    // The UI will simply not have offline data, which is acceptable.
  }
}

function loadFromCache(): { recordsByField: PlantRecordsState['recordsByField']; lastSyncedAt: string | null } {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    const syncedAt = localStorage.getItem(SYNC_KEY);
    return {
      recordsByField: cached ? JSON.parse(cached) : {},
      lastSyncedAt: syncedAt,
    };
  } catch {
    return { recordsByField: {}, lastSyncedAt: null };
  }
}

// -----------------------------------------------------------------------------
// Supabase Client (lazy init — matches RainService pattern)
// -----------------------------------------------------------------------------

// Note: In a real React/React Native app, this would use Zustand's `create`.
// This implementation shows the full pattern as a reference implementation
// for future store creation.

interface PlantRecordsStore extends PlantRecordsState, PlantRecordsActions {
  _snapshot: PlantRecordsState | null;
}

/**
 * Creates a PlantRecordsStore instance.
 *
 * In production, this would be:
 *   `export const usePlantRecords = create<PlantRecordsStore>((set, get) => ({ ... }))`
 *
 * The snapshot/rollback pattern works as follows:
 *   1. Before any optimistic write, call `_snapshot = takeSnapshot(get())`
 *   2. Apply the optimistic update via `set(...)`
 *   3. Attempt the Supabase write
 *   4. On failure: `set(get()._snapshot)` to rollback
 *   5. On success: update `lastSyncedAt` and persist to localStorage
 */
export function createPlantRecordsStore(
  supabaseClient: any // SupabaseClient — typed loosely to avoid hard dependency
): PlantRecordsStore {
  let state: PlantRecordsState = {
    recordsByField: {},
    isLoading: false,
    error: null,
    lastSyncedAt: null,
  };

  let snapshot: PlantRecordsState | null = null;

  function getState(): PlantRecordsStore {
    return { ...state, _snapshot: snapshot, ...actions };
  }

  // --- Actions ---

  const actions: PlantRecordsActions = {
    async fetchRecordsByFarm(farmId: string) {
      state.isLoading = true;
      state.error = null;
      // In a real Zustand store: set({ isLoading: true, error: null })

      try {
        const { data, error } = await supabaseClient
          .from('plant_records')
          .select('*')
          .eq('farm_id', farmId)
          .order('planting_date', { ascending: false });

        if (error) throw error;

        const records = (data || []).map(mapDbToPlantRecord);

        // Group by fieldId
        const recordsByField: Record<string, PlantRecord[]> = {};
        for (const record of records) {
          if (!recordsByField[record.fieldId]) {
            recordsByField[record.fieldId] = [];
          }
          recordsByField[record.fieldId].push(record);
        }

        state.recordsByField = recordsByField;
        state.lastSyncedAt = new Date().toISOString();
        saveToCache(state);
        // set({ recordsByField, isLoading: false, lastSyncedAt: ... })
      } catch (err: any) {
        state.error = err.message || 'Failed to fetch plant records';
        // set({ isLoading: false, error: ... })
      } finally {
        state.isLoading = false;
      }
    },

    async fetchRecordsByField(fieldId: string) {
      state.isLoading = true;
      state.error = null;

      try {
        const { data, error } = await supabaseClient
          .from('plant_records')
          .select('*')
          .eq('field_id', fieldId)
          .order('planting_date', { ascending: false });

        if (error) throw error;

        const records = (data || []).map(mapDbToPlantRecord);
        state.recordsByField = { ...state.recordsByField, [fieldId]: records };
        state.lastSyncedAt = new Date().toISOString();
        saveToCache(state);
      } catch (err: any) {
        state.error = err.message || 'Failed to fetch field plant records';
      } finally {
        state.isLoading = false;
      }
    },

    async addRecord(record: PlantRecord) {
      // 1. Take snapshot for potential rollback
      snapshot = takeSnapshot(state);

      // 2. Optimistic update — add to local state immediately
      const fieldRecords = state.recordsByField[record.fieldId] || [];
      const updatedRecords = [record, ...fieldRecords];
      state.recordsByField = { ...state.recordsByField, [record.fieldId]: updatedRecords };
      saveToCache(state);

      // 3. Persist to Supabase
      try {
        const dbRow = mapPlantRecordToDb(record);
        const { error } = await supabaseClient
          .from('plant_records')
          .insert(dbRow);

        if (error) throw error;

        state.lastSyncedAt = new Date().toISOString();
        snapshot = null; // Clear snapshot — mutation succeeded
      } catch (err: any) {
        // 4. Rollback to snapshot on failure
        if (snapshot) {
          state.recordsByField = snapshot.recordsByField;
          state.lastSyncedAt = snapshot.lastSyncedAt;
          saveToCache(state);
          snapshot = null;
        }
        state.error = err.message || 'Failed to add plant record';
      }
    },

    async updateRecord(id: string, updates: Partial<PlantRecord>) {
      snapshot = takeSnapshot(state);

      // Optimistic update
      const updatedByField: Record<string, PlantRecord[]> = {};
      for (const [fieldId, records] of Object.entries(state.recordsByField)) {
        updatedByField[fieldId] = records.map(r =>
          r.id === id ? { ...r, ...updates, updatedAt: new Date().toISOString() } : r
        );
      }
      state.recordsByField = updatedByField;
      saveToCache(state);

      try {
        const dbRow = mapPlantRecordToDb({ ...updates, updatedAt: new Date().toISOString() });
        const { error } = await supabaseClient
          .from('plant_records')
          .update(dbRow)
          .eq('id', id);

        if (error) throw error;

        state.lastSyncedAt = new Date().toISOString();
        snapshot = null;
      } catch (err: any) {
        if (snapshot) {
          state.recordsByField = snapshot.recordsByField;
          state.lastSyncedAt = snapshot.lastSyncedAt;
          saveToCache(state);
          snapshot = null;
        }
        state.error = err.message || 'Failed to update plant record';
      }
    },

    async deleteRecord(id: string) {
      snapshot = takeSnapshot(state);

      // Optimistic delete
      const updatedByField: Record<string, PlantRecord[]> = {};
      for (const [fieldId, records] of Object.entries(state.recordsByField)) {
        updatedByField[fieldId] = records.filter(r => r.id !== id);
      }
      state.recordsByField = updatedByField;
      saveToCache(state);

      try {
        const { error } = await supabaseClient
          .from('plant_records')
          .delete()
          .eq('id', id);

        if (error) throw error;

        state.lastSyncedAt = new Date().toISOString();
        snapshot = null;
      } catch (err: any) {
        if (snapshot) {
          state.recordsByField = snapshot.recordsByField;
          state.lastSyncedAt = snapshot.lastSyncedAt;
          saveToCache(state);
          snapshot = null;
        }
        state.error = err.message || 'Failed to delete plant record';
      }
    },

    restoreFromCache() {
      const cached = loadFromCache();
      state.recordsByField = cached.recordsByField;
      state.lastSyncedAt = cached.lastSyncedAt;
      state.error = null;
      state.isLoading = false;
    },
  };

  return { ...state, _snapshot: snapshot, ...actions };
}
