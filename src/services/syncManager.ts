// Sync Manager
// Handles synchronization between localStorage and Google Sheets

// Debug logging - set to true to see sync operations in console
const DEBUG_SYNC = true;

function syncLog(message: string, data?: unknown): void {
  if (DEBUG_SYNC) {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    if (data !== undefined) {
      console.log(`[SYNC ${timestamp}] ${message}`, data);
    } else {
      console.log(`[SYNC ${timestamp}] ${message}`);
    }
  }
}

import type { AppData } from '../types';
import { SYNC_CONFIG, STORAGE_KEYS } from '../config/google';
import {
  getStoredSpreadsheetId,
  readAppData,
  writeAppData,
  getLastModified,
  getOrCreateSpreadsheet,
  type SpreadsheetInfo,
} from './googleSheets';
import { googleAuth } from './googleAuth';

// ============================================================================
// Types
// ============================================================================

export type SyncStatus =
  | 'idle'           // No sync in progress, all synced
  | 'syncing'        // Sync in progress
  | 'pending'        // Changes pending, waiting for debounce
  | 'offline'        // Network unavailable
  | 'error'          // Sync failed
  | 'conflict';      // Conflict detected

export interface SyncState {
  status: SyncStatus;
  lastSyncTime: Date | null;
  pendingChanges: number;
  error: string | null;
  spreadsheetInfo: SpreadsheetInfo | null;
}

export interface ConflictInfo {
  localModified: Date;
  remoteModified: Date;
  localData: AppData;
  remoteData: AppData;
}

type SyncStateListener = (state: SyncState) => void;
type ConflictHandler = (conflict: ConflictInfo) => Promise<'local' | 'remote' | 'merge'>;

// ============================================================================
// Sync Manager Class
// ============================================================================

class SyncManager {
  private listeners: Set<SyncStateListener> = new Set();
  private conflictHandler: ConflictHandler | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingData: AppData | null = null;
  private isSyncing = false;
  private offlineQueue: AppData[] = [];
  private requestTimestamps: number[] = [];

  private state: SyncState = {
    status: 'idle',
    lastSyncTime: null,
    pendingChanges: 0,
    error: null,
    spreadsheetInfo: null,
  };

  constructor() {
    // Load last sync time from storage
    const lastSync = localStorage.getItem(STORAGE_KEYS.lastSyncTime);
    if (lastSync) {
      this.state.lastSyncTime = new Date(lastSync);
    }

    // Listen for online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());

      // Check initial state
      if (!navigator.onLine) {
        this.setState({ status: 'offline' });
      }
    }
  }

  // Subscribe to state changes
  subscribe(listener: SyncStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  // Set conflict handler
  setConflictHandler(handler: ConflictHandler): void {
    this.conflictHandler = handler;
  }

  // Update state and notify listeners
  private setState(updates: Partial<SyncState>): void {
    this.state = { ...this.state, ...updates };
    this.listeners.forEach(listener => listener(this.state));
  }

  // Get current state
  getState(): SyncState {
    return this.state;
  }

  // Check if an error is an authentication error (401)
  private isAuthError(error: unknown): boolean {
    // Check GAPI error format: { status: 401, result: { error: { code: 401 } } }
    if (typeof error === 'object' && error !== null) {
      const e = error as { status?: number; result?: { error?: { code?: number; status?: string } } };
      if (e.status === 401) return true;
      if (e.result?.error?.code === 401) return true;
      if (e.result?.error?.status === 'UNAUTHENTICATED') return true;
    }
    // Check Error instance
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return msg.includes('401') || msg.includes('unauthenticated') || msg.includes('unauthorized');
    }
    return false;
  }

  // ============================================================================
  // Sync Operations
  // ============================================================================

  /**
   * Initialize sync - find or create spreadsheet
   */
  async initialize(): Promise<SpreadsheetInfo> {
    syncLog('Initializing sync...');
    try {
      this.setState({ status: 'syncing' });
      const spreadsheetInfo = await getOrCreateSpreadsheet();
      syncLog('Sync initialized', { spreadsheetId: spreadsheetInfo.id });
      this.setState({
        status: 'idle',
        spreadsheetInfo,
        error: null,
      });
      return spreadsheetInfo;
    } catch (error) {
      if (this.isAuthError(error)) {
        googleAuth.markSessionExpired();
        this.setState({ status: 'idle', error: null });
        throw error; // Still throw so caller knows it failed
      }

      const message = error instanceof Error ? error.message : 'Failed to initialize sync';
      this.setState({ status: 'error', error: message });
      throw error;
    }
  }

  /**
   * Load data from Google Sheets
   */
  async loadFromSheets(): Promise<AppData | null> {
    const spreadsheetId = getStoredSpreadsheetId();
    if (!spreadsheetId) {
      syncLog('loadFromSheets: No spreadsheet ID found');
      return null;
    }

    syncLog('Loading data from Google Sheets...');
    try {
      this.setState({ status: 'syncing' });

      // Rate limiting check
      await this.checkRateLimit();

      const data = await readAppData(spreadsheetId);

      const positionCount = data.services.reduce((sum, s) => sum + s.portfolio.positions.length, 0);
      const tradeCount = data.services.reduce((sum, s) =>
        sum + s.portfolio.positions.reduce((psum, p) => psum + p.trades.length, 0), 0);
      syncLog('Loaded from Sheets', { services: data.services.length, positions: positionCount, trades: tradeCount });

      this.setState({
        status: 'idle',
        lastSyncTime: new Date(),
        error: null,
      });

      localStorage.setItem(STORAGE_KEYS.lastSyncTime, new Date().toISOString());
      return data;
    } catch (error) {
      if (this.isAuthError(error)) {
        googleAuth.markSessionExpired();
        this.setState({ status: 'idle', error: null });
        return null;
      }

      const message = error instanceof Error ? error.message : 'Failed to load from Sheets';
      this.setState({ status: 'error', error: message });
      throw error;
    }
  }

  /**
   * Save data to Google Sheets with debouncing
   */
  scheduleSync(data: AppData): void {
    const positionCount = data.services.reduce((sum, s) => sum + s.portfolio.positions.length, 0);
    const tradeCount = data.services.reduce((sum, s) =>
      sum + s.portfolio.positions.reduce((psum, p) => psum + p.trades.length, 0), 0);
    syncLog('Scheduling sync (debounced)', { services: data.services.length, positions: positionCount, trades: tradeCount });

    this.pendingData = data;

    // Don't sync if offline
    if (!navigator.onLine) {
      syncLog('Offline - queueing for later');
      this.offlineQueue.push(data);
      this.setState({
        status: 'offline',
        pendingChanges: this.offlineQueue.length,
      });
      return;
    }

    this.setState({
      status: 'pending',
      pendingChanges: 1,
    });

    // Clear existing timer
    if (this.debounceTimer) {
      syncLog('Resetting debounce timer');
      clearTimeout(this.debounceTimer);
    }

    // Set new debounce timer
    syncLog(`Will sync in ${SYNC_CONFIG.debounceMs}ms...`);
    this.debounceTimer = setTimeout(() => {
      this.executeSync();
    }, SYNC_CONFIG.debounceMs);
  }

  /**
   * Execute the actual sync to Google Sheets
   */
  private async executeSync(): Promise<void> {
    if (this.isSyncing) {
      syncLog('executeSync: Already syncing, skipping');
      return;
    }
    if (!this.pendingData) {
      syncLog('executeSync: No pending data, skipping');
      return;
    }

    const spreadsheetId = getStoredSpreadsheetId();
    if (!spreadsheetId) {
      syncLog('executeSync: No spreadsheet ID, skipping');
      return;
    }

    const positionCount = this.pendingData.services.reduce((sum, s) => sum + s.portfolio.positions.length, 0);
    const tradeCount = this.pendingData.services.reduce((sum, s) =>
      sum + s.portfolio.positions.reduce((psum, p) => psum + p.trades.length, 0), 0);
    syncLog('Executing sync to Google Sheets...', { services: this.pendingData.services.length, positions: positionCount, trades: tradeCount });

    this.isSyncing = true;
    this.setState({ status: 'syncing' });

    try {
      // Rate limiting check
      await this.checkRateLimit();

      // Check for conflicts
      const remoteModified = await getLastModified(spreadsheetId);
      const localLastSync = this.state.lastSyncTime;

      if (remoteModified && localLastSync && remoteModified > localLastSync) {
        // Potential conflict - remote was modified since our last sync
        syncLog('Conflict detected', { remoteModified, localLastSync });
        await this.handleConflict(spreadsheetId, this.pendingData, remoteModified);
      } else {
        // No conflict, write directly
        syncLog('No conflict, writing to Sheets...');
        await writeAppData(spreadsheetId, this.pendingData);
      }

      syncLog('Sync completed successfully');
      this.setState({
        status: 'idle',
        lastSyncTime: new Date(),
        pendingChanges: 0,
        error: null,
      });

      this.pendingData = null;
    } catch (error) {
      // Check if this is an auth error (401) - don't retry, user needs to sign in again
      const isAuthError = this.isAuthError(error);

      if (isAuthError) {
        // Auth errors: don't retry, mark session as expired
        // Data is safe in localStorage, will sync when user signs back in
        syncLog('Sync failed - auth error (session expired)', error);
        googleAuth.markSessionExpired();
        this.setState({
          status: 'idle',
          error: null,
        });
        this.pendingData = null;
      } else {
        const message = error instanceof Error ? error.message : 'Sync failed';
        syncLog('Sync failed - will retry', { error: message });
        this.setState({
          status: 'error',
          error: message,
        });
        // Only retry non-auth errors
        this.scheduleRetry();
      }
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Handle conflict between local and remote data
   */
  private async handleConflict(
    spreadsheetId: string,
    localData: AppData,
    remoteModified: Date
  ): Promise<void> {
    if (!this.conflictHandler) {
      // Default: last write wins
      await writeAppData(spreadsheetId, localData);
      return;
    }

    const remoteData = await readAppData(spreadsheetId);

    const conflict: ConflictInfo = {
      localModified: this.state.lastSyncTime || new Date(0),
      remoteModified,
      localData,
      remoteData,
    };

    this.setState({ status: 'conflict' });

    const resolution = await this.conflictHandler(conflict);

    switch (resolution) {
      case 'local':
        await writeAppData(spreadsheetId, localData);
        break;
      case 'remote':
        // Don't write, just update our local sync time
        break;
      case 'merge':
        // For now, merge means prefer local (could be smarter)
        await writeAppData(spreadsheetId, localData);
        break;
    }
  }

  /**
   * Force immediate sync (skip debounce)
   */
  async forceSync(data: AppData): Promise<void> {
    syncLog('Force sync requested (immediate, no debounce)');
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.pendingData = data;
    await this.executeSync();
  }

  /**
   * Check if there are unsaved changes pending
   */
  hasPendingChanges(): boolean {
    return this.pendingData !== null || this.state.status === 'pending' || this.debounceTimer !== null;
  }

  // ============================================================================
  // Rate Limiting
  // ============================================================================

  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Clean old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(t => t > oneMinuteAgo);

    // Check if we're at the limit
    if (this.requestTimestamps.length >= SYNC_CONFIG.maxRequestsPerMinute) {
      // Wait until we can make another request
      const oldestInWindow = this.requestTimestamps[0];
      const waitTime = oldestInWindow + 60000 - now + 100; // Add 100ms buffer
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.requestTimestamps.push(Date.now());
  }

  // ============================================================================
  // Retry Logic
  // ============================================================================

  private retryCount = 0;

  private scheduleRetry(): void {
    if (this.retryCount >= SYNC_CONFIG.maxRetries) {
      this.retryCount = 0;
      return;
    }

    this.retryCount++;
    const delay = SYNC_CONFIG.retryDelayMs * Math.pow(2, this.retryCount - 1);

    setTimeout(() => {
      if (this.pendingData) {
        this.executeSync();
      }
    }, delay);
  }

  // ============================================================================
  // Online/Offline Handling
  // ============================================================================

  private handleOnline(): void {
    // Process offline queue
    if (this.offlineQueue.length > 0) {
      // Use the most recent data from queue
      const latestData = this.offlineQueue[this.offlineQueue.length - 1];
      this.offlineQueue = [];
      this.scheduleSync(latestData);
    } else {
      this.setState({ status: 'idle' });
    }
  }

  private handleOffline(): void {
    // Cancel pending sync
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.pendingData) {
      this.offlineQueue.push(this.pendingData);
    }

    this.setState({
      status: 'offline',
      pendingChanges: this.offlineQueue.length,
    });
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  reset(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.pendingData = null;
    this.offlineQueue = [];
    this.retryCount = 0;
    this.isSyncing = false;

    this.setState({
      status: 'idle',
      lastSyncTime: null,
      pendingChanges: 0,
      error: null,
      spreadsheetInfo: null,
    });
  }
}

// Singleton instance
export const syncManager = new SyncManager();
