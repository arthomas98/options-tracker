// Migration Service
// Handles data migration from localStorage to Google Sheets

import type { AppData, Service, Position, Trade } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface MigrationResult {
  success: boolean;
  servicesCount: number;
  positionsCount: number;
  tradesCount: number;
  errors: string[];
}

export interface MergeResult {
  merged: AppData;
  stats: {
    servicesKept: number;
    servicesAdded: number;
    positionsKept: number;
    positionsAdded: number;
  };
}

// ============================================================================
// Migration Functions
// ============================================================================

/**
 * Count items in AppData for migration preview
 */
export function getMigrationPreview(data: AppData): {
  services: number;
  positions: number;
  trades: number;
} {
  let positions = 0;
  let trades = 0;

  for (const service of data.services) {
    positions += service.portfolio.positions.length;
    for (const position of service.portfolio.positions) {
      trades += position.trades.length;
    }
  }

  return {
    services: data.services.length,
    positions,
    trades,
  };
}

/**
 * Validate data before migration
 */
export function validateForMigration(data: AppData): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!data.services) {
    errors.push('Missing services array');
    return { valid: false, errors };
  }

  for (const service of data.services) {
    if (!service.id) {
      errors.push(`Service missing ID: ${service.name || 'unnamed'}`);
    }
    if (!service.portfolio) {
      errors.push(`Service ${service.name} missing portfolio`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Merge local data with cloud data
 * Strategy: Add any services/positions from local that don't exist in cloud
 */
export function mergeData(local: AppData, cloud: AppData): MergeResult {
  const merged: AppData = {
    services: [...cloud.services],
    appTitle: cloud.appTitle || local.appTitle,
  };

  const stats = {
    servicesKept: cloud.services.length,
    servicesAdded: 0,
    positionsKept: 0,
    positionsAdded: 0,
  };

  // Count cloud positions
  for (const service of cloud.services) {
    stats.positionsKept += service.portfolio.positions.length;
  }

  // Build set of existing service IDs
  const existingServiceIds = new Set(cloud.services.map(s => s.id));

  // Add services from local that don't exist in cloud
  for (const localService of local.services) {
    if (!existingServiceIds.has(localService.id)) {
      merged.services.push(localService);
      stats.servicesAdded++;
      stats.positionsAdded += localService.portfolio.positions.length;
    } else {
      // Service exists - check for positions to merge
      const cloudService = merged.services.find(s => s.id === localService.id);
      if (cloudService) {
        const existingPositionIds = new Set(cloudService.portfolio.positions.map(p => p.id));

        for (const localPosition of localService.portfolio.positions) {
          if (!existingPositionIds.has(localPosition.id)) {
            cloudService.portfolio.positions.push(localPosition);
            stats.positionsAdded++;

            // Update nextPositionId if needed
            if (localPosition.id >= cloudService.portfolio.nextPositionId) {
              cloudService.portfolio.nextPositionId = localPosition.id + 1;
            }
          }
        }
      }
    }
  }

  return { merged, stats };
}

/**
 * Check if data needs migration
 * Returns true if local has meaningful data and cloud is empty/different
 */
export function needsMigration(local: AppData, cloud: AppData | null): boolean {
  // Local has data
  const localHasData = local.services.length > 0 ||
    local.services.some(s => s.portfolio.positions.length > 0);

  if (!localHasData) {
    return false;
  }

  // Cloud is empty
  if (!cloud || cloud.services.length === 0) {
    return true;
  }

  // Cloud has data - check if local has additional services
  const cloudServiceIds = new Set(cloud.services.map(s => s.id));
  const localHasAdditional = local.services.some(s => !cloudServiceIds.has(s.id));

  return localHasAdditional;
}

/**
 * Create a deep copy of AppData for safe manipulation
 */
export function cloneAppData(data: AppData): AppData {
  return JSON.parse(JSON.stringify(data, (_, value) => {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  }), (_key, value) => {
    // Rehydrate dates
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      return new Date(value);
    }
    return value;
  });
}

/**
 * Generate a unique ID for new services
 */
export function generateServiceId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Ensure all required fields have default values
 */
export function normalizeAppData(data: AppData): AppData {
  return {
    services: data.services.map(normalizeService),
    appTitle: data.appTitle,
  };
}

function normalizeService(service: Service): Service {
  return {
    ...service,
    id: service.id || generateServiceId(),
    name: service.name || 'Unnamed Service',
    createdAt: service.createdAt || new Date(),
    portfolio: {
      positions: service.portfolio?.positions?.map(normalizePosition) || [],
      nextPositionId: service.portfolio?.nextPositionId || 1,
    },
  };
}

function normalizePosition(position: Position): Position {
  return {
    ...position,
    id: position.id || 1,
    symbol: position.symbol || '',
    structure: position.structure || 'SINGLE',
    isOpen: position.isOpen !== false,
    openDate: position.openDate || new Date(),
    trades: position.trades?.map(normalizeTrade) || [],
  };
}

function normalizeTrade(trade: Trade): Trade {
  return {
    ...trade,
    id: trade.id || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    tradeDate: trade.tradeDate || new Date(),
    legs: trade.legs || [],
  };
}
