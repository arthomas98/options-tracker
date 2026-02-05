// Storage Context
// Provides unified storage abstraction layer for localStorage and Google Sheets

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { AppData } from '../types';
import { loadAppData, saveAppData } from '../utils/storage';
import { useAuth } from './AuthContext';
import { syncManager, type SyncState, type SyncStatus, type ConflictInfo } from '../services/syncManager';
import { readAppData, getStoredSpreadsheetId, type SpreadsheetInfo } from '../services/googleSheets';
import { googleAuth } from '../services/googleAuth';

// Debug logging
const DEBUG_STORAGE = true;
function storageLog(message: string, data?: unknown): void {
  if (DEBUG_STORAGE) {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    if (data !== undefined) {
      console.log(`[STORAGE ${timestamp}] ${message}`, data);
    } else {
      console.log(`[STORAGE ${timestamp}] ${message}`);
    }
  }
}

// Helper to check if an error is an authentication error (401)
function isAuthError(err: unknown): boolean {
  // Check GAPI error format: { status: 401, result: { error: { code: 401, status: 'UNAUTHENTICATED' } } }
  if (typeof err === 'object' && err !== null) {
    const e = err as { status?: number; result?: { error?: { code?: number; status?: string } } };
    if (e.status === 401) return true;
    if (e.result?.error?.code === 401) return true;
    if (e.result?.error?.status === 'UNAUTHENTICATED') return true;
  }
  // Check Error instance
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('401') || msg.includes('unauthenticated') || msg.includes('unauthorized');
  }
  return false;
}

// Handle auth errors by marking session as expired
function handleAuthError(err: unknown): boolean {
  if (isAuthError(err)) {
    googleAuth.markSessionExpired();
    return true;
  }
  return false;
}

// ============================================================================
// Types
// ============================================================================

export interface StorageContextValue {
  // Data
  appData: AppData | null;
  isLoading: boolean;

  // Operations
  updateAppData: (data: AppData) => void;
  updateAppDataImmediate: (data: AppData) => Promise<void>; // Force immediate sync (for critical changes like trade entry)
  refreshFromCloud: () => Promise<void>;

  // Sync state
  syncStatus: SyncStatus;
  syncState: SyncState;
  lastSyncTime: Date | null;
  spreadsheetInfo: SpreadsheetInfo | null;

  // Sync controls
  forceSync: () => Promise<void>;
  enableCloudSync: () => Promise<void>;

  // Migration
  hasPendingMigration: boolean;
  migrateToCloud: () => Promise<void>;
  skipMigration: () => void;

  // Error handling
  error: string | null;
  clearError: () => void;
}

const StorageContext = createContext<StorageContextValue | null>(null);

// ============================================================================
// Provider Component
// ============================================================================

interface StorageProviderProps {
  children: ReactNode;
}

export function StorageProvider({ children }: StorageProviderProps) {
  const { isSignedIn, isLoading: authLoading } = useAuth();

  // State
  const [appData, setAppData] = useState<AppData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>(syncManager.getState());
  const [error, setError] = useState<string | null>(null);
  const [hasPendingMigration, setHasPendingMigration] = useState(false);
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);

  // Subscribe to sync manager state
  useEffect(() => {
    return syncManager.subscribe(setSyncState);
  }, []);

  // Set up conflict handler
  useEffect(() => {
    syncManager.setConflictHandler(async (conflict: ConflictInfo) => {
      // For now, use last-write-wins with a console warning
      // In the future, this could show a dialog
      console.warn('Sync conflict detected:', {
        localModified: conflict.localModified,
        remoteModified: conflict.remoteModified,
      });
      return 'local';
    });
  }, []);

  // Warn user if they try to close/refresh with pending changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (syncManager.hasPendingChanges()) {
        storageLog('WARNING: User trying to leave with pending changes!');
        // Modern browsers require both of these for the warning to show
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Helper to count actual data (not just empty services)
  const countActualData = (data: AppData): { services: number; positions: number; trades: number } => {
    let positions = 0;
    let trades = 0;
    for (const service of data.services) {
      positions += service.portfolio.positions.length;
      for (const pos of service.portfolio.positions) {
        trades += pos.trades.length;
      }
    }
    return { services: data.services.length, positions, trades };
  };

  // Initial data load
  useEffect(() => {
    if (authLoading || isMigrating) return;

    const loadData = async () => {
      setIsLoading(true);

      try {
        // Always load from localStorage first (offline-first)
        const localData = loadAppData();
        const localStats = countActualData(localData);
        setAppData(localData);

        // Check if user is signed in and has a spreadsheet
        if (isSignedIn) {
          const spreadsheetId = getStoredSpreadsheetId();

          if (spreadsheetId) {
            // Has existing cloud data - try to load it
            try {
              await syncManager.initialize();
              const cloudData = await readAppData(spreadsheetId);
              setCloudSyncEnabled(true);

              const cloudStats = countActualData(cloudData);

              // SAFETY: Local data is the source of truth (offline-first)
              // Only use cloud data if local is empty
              const localHasData = localStats.positions > 0 || localStats.trades > 0;
              const cloudHasData = cloudStats.positions > 0 || cloudStats.trades > 0;

              if (localHasData) {
                // Local has data - ALWAYS keep it and sync TO cloud
                // This handles: token expired, user added trades, signed back in
                console.log('Local has data - keeping local and syncing to cloud:', localStats);
                // Note: Don't sync immediately here - wait for user to make a change
                // or use the "Sync Now" button. This avoids race conditions with token refresh.
                // The data is safe in localStorage and will sync on next update.
              } else if (cloudHasData) {
                // Local is empty but cloud has data - use cloud
                console.log('Local empty, using cloud data:', cloudStats);
                setAppData(cloudData);
                saveAppData(cloudData); // Update local cache
              } else {
                // Both empty - just enable sync
                console.log('Both local and cloud are empty');
              }
            } catch (err) {
              if (handleAuthError(err)) {
                // Session expired - don't show error, user will see sign-in prompt
                console.debug('Session expired during cloud load');
              } else {
                console.error('Failed to load from cloud:', err);
                setError('Failed to load from Google Sheets. Using local data.');
              }
            }
          } else {
            // Signed in but no spreadsheet yet - check if local has data to migrate
            const localHasData = localStats.positions > 0 || localStats.trades > 0;
            if (localHasData) {
              // Only show migration dialog for first-time setup
              setHasPendingMigration(true);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load data:', err);
        setError('Failed to load data');
        setAppData({ services: [] }); // Fallback to empty
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [authLoading, isSignedIn, isMigrating]);

  // Update data handler (debounced sync)
  const updateAppData = useCallback((data: AppData) => {
    storageLog('updateAppData called (debounced sync)');
    setAppData(data);

    // Always save to localStorage (primary storage)
    saveAppData(data);
    storageLog('Saved to localStorage');

    // If cloud sync is enabled, schedule sync
    if (cloudSyncEnabled && isSignedIn) {
      syncManager.scheduleSync(data);
    }
  }, [cloudSyncEnabled, isSignedIn]);

  // Update data handler with immediate sync (for critical changes like trade entry)
  const updateAppDataImmediate = useCallback(async (data: AppData) => {
    storageLog('updateAppDataImmediate called (immediate sync)');
    setAppData(data);

    // Always save to localStorage (primary storage)
    saveAppData(data);
    storageLog('Saved to localStorage');

    // If cloud sync is enabled, force immediate sync
    if (cloudSyncEnabled && isSignedIn) {
      storageLog('Triggering immediate sync to Google Sheets...');
      await syncManager.forceSync(data);
      storageLog('Immediate sync completed');
    }
  }, [cloudSyncEnabled, isSignedIn]);

  // Refresh from cloud
  const refreshFromCloud = useCallback(async () => {
    if (!isSignedIn || !cloudSyncEnabled) {
      throw new Error('Cloud sync not enabled');
    }

    const cloudData = await syncManager.loadFromSheets();
    if (cloudData) {
      setAppData(cloudData);
      saveAppData(cloudData);
    }
  }, [isSignedIn, cloudSyncEnabled]);

  // Force sync
  const forceSync = useCallback(async () => {
    if (!isSignedIn || !cloudSyncEnabled || !appData) {
      throw new Error('Cannot sync');
    }

    await syncManager.forceSync(appData);
  }, [isSignedIn, cloudSyncEnabled, appData]);

  // Enable cloud sync (creates spreadsheet if needed)
  const enableCloudSync = useCallback(async () => {
    if (!isSignedIn) {
      throw new Error('Not signed in');
    }

    // Set migrating flag to prevent loadData race condition
    setIsMigrating(true);

    try {
      await syncManager.initialize();
      setCloudSyncEnabled(true);

      // If we have local data, sync it to cloud
      if (appData && appData.services.length > 0) {
        await syncManager.forceSync(appData);
      }
    } finally {
      setIsMigrating(false);
    }
  }, [isSignedIn, appData]);

  // Migrate local data to cloud
  const migrateToCloud = useCallback(async () => {
    if (!isSignedIn || !appData) {
      throw new Error('Cannot migrate');
    }

    // Set migrating flag to prevent loadData from running during migration
    setIsMigrating(true);

    try {
      // Initialize sync (creates spreadsheet)
      await syncManager.initialize();
      setCloudSyncEnabled(true);

      // Write current local data to cloud
      await syncManager.forceSync(appData);

      setHasPendingMigration(false);
    } finally {
      setIsMigrating(false);
    }
  }, [isSignedIn, appData]);

  // Skip migration
  const skipMigration = useCallback(() => {
    setHasPendingMigration(false);
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value: StorageContextValue = {
    appData,
    isLoading: isLoading || authLoading,

    updateAppData,
    updateAppDataImmediate,
    refreshFromCloud,

    syncStatus: syncState.status,
    syncState,
    lastSyncTime: syncState.lastSyncTime,
    spreadsheetInfo: syncState.spreadsheetInfo,

    forceSync,
    enableCloudSync,

    hasPendingMigration,
    migrateToCloud,
    skipMigration,

    error: error || syncState.error,
    clearError,
  };

  return (
    <StorageContext.Provider value={value}>
      {children}
    </StorageContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useStorage(): StorageContextValue {
  const context = useContext(StorageContext);
  if (!context) {
    throw new Error('useStorage must be used within a StorageProvider');
  }
  return context;
}
