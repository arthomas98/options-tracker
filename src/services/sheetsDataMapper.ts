// Sheets Data Mapper
// Transforms AppData ↔ Spreadsheet rows

import type {
  AppData,
  Service,
  Position,
  Trade,
  OptionLeg,
  SpreadType,
  TradeAction,
  OptionType,
  OrderType,
  LegAction,
  MarkSource,
} from '../types';
import { SPREADSHEET_CONFIG } from '../config/google';

// ============================================================================
// Type definitions for spreadsheet data
// ============================================================================

export interface MetadataRow {
  key: string;
  value: string;
}

export interface ServiceRow {
  id: string;
  name: string;
  createdAt: string; // ISO date string
  nextPositionId: number;
}

export interface PositionRow {
  id: number;
  serviceId: string;
  symbol: string;
  structure: SpreadType;
  isOpen: boolean;
  openDate: string; // ISO date string
  closeDate: string; // ISO date string or empty
}

export interface TradeRow {
  id: string;
  positionId: number;
  serviceId: string;
  rawInput: string;
  action: TradeAction;
  totalQuantity: number;
  symbol: string;
  multiplier: number;
  isWeekly: boolean;
  spreadType: SpreadType;
  price: number;
  orderType: OrderType;
  isGTC: boolean;
  tradeDate: string; // ISO date string
}

export interface LegRow {
  tradeId: string;
  legIndex: number;
  quantity: number;
  expiration: string; // ISO date string
  strike: number;
  optionType: OptionType;
  legAction: string; // 'OPEN' | 'CLOSE' | ''
}

// ============================================================================
// Column headers for each sheet
// ============================================================================

export const HEADERS = {
  metadata: ['key', 'value'],
  services: ['id', 'name', 'createdAt', 'nextPositionId'],
  positions: ['id', 'serviceId', 'symbol', 'structure', 'isOpen', 'openDate', 'closeDate', 'markValue', 'markDate', 'markSource', 'isTaxable'],
  trades: [
    'id', 'positionId', 'serviceId', 'rawInput', 'action', 'totalQuantity',
    'symbol', 'multiplier', 'isWeekly', 'spreadType', 'price', 'orderType',
    'isGTC', 'tradeDate',
  ],
  legs: ['tradeId', 'legIndex', 'quantity', 'expiration', 'strike', 'optionType', 'legAction'],
};

// ============================================================================
// Helper functions
// ============================================================================

function dateToString(date: Date | undefined | null): string {
  if (!date) return '';
  return date instanceof Date ? date.toISOString() : String(date);
}

function stringToDate(str: string): Date {
  return new Date(str);
}

function boolToString(val: boolean): string {
  return val ? 'TRUE' : 'FALSE';
}

function stringToBool(str: string | boolean): boolean {
  if (typeof str === 'boolean') return str;
  return str === 'TRUE' || str === 'true' || str === '1';
}

// ============================================================================
// AppData → Spreadsheet rows
// ============================================================================

export function appDataToSheetRows(data: AppData): {
  metadata: unknown[][];
  services: unknown[][];
  positions: unknown[][];
  trades: unknown[][];
  legs: unknown[][];
} {
  const metadata: unknown[][] = [
    HEADERS.metadata,
    ['appTitle', data.appTitle || ''],
    ['schemaVersion', String(SPREADSHEET_CONFIG.schemaVersion)],
    ['lastModified', new Date().toISOString()],
  ];

  const services: unknown[][] = [HEADERS.services];
  const positions: unknown[][] = [HEADERS.positions];
  const trades: unknown[][] = [HEADERS.trades];
  const legs: unknown[][] = [HEADERS.legs];

  for (const service of data.services) {
    // Service row
    services.push([
      service.id,
      service.name,
      dateToString(service.createdAt),
      service.portfolio.nextPositionId,
    ]);

    // Positions for this service
    for (const position of service.portfolio.positions) {
      positions.push([
        position.id,
        service.id,
        position.symbol,
        position.structure,
        boolToString(position.isOpen),
        dateToString(position.openDate),
        dateToString(position.closeDate),
        position.markValue ?? '',
        dateToString(position.markDate),
        position.markSource ?? '',
        boolToString(position.isTaxable === true), // Default to false
      ]);

      // Trades for this position
      for (const trade of position.trades) {
        trades.push([
          trade.id,
          position.id,
          service.id,
          trade.rawInput,
          trade.action,
          trade.totalQuantity,
          trade.symbol,
          trade.multiplier,
          boolToString(trade.isWeekly),
          trade.spreadType,
          trade.price,
          trade.orderType,
          boolToString(trade.isGTC),
          dateToString(trade.tradeDate),
        ]);

        // Legs for this trade
        trade.legs.forEach((leg, index) => {
          legs.push([
            trade.id,
            index,
            leg.quantity,
            dateToString(leg.expiration),
            leg.strike,
            leg.optionType,
            leg.legAction || '',
          ]);
        });
      }
    }
  }

  return { metadata, services, positions, trades, legs };
}

// ============================================================================
// Spreadsheet rows → AppData
// ============================================================================

export function sheetRowsToAppData(
  metadataRows: unknown[][],
  serviceRows: unknown[][],
  positionRows: unknown[][],
  tradeRows: unknown[][],
  legRows: unknown[][]
): AppData {
  // Parse metadata (skip header row)
  const metadata = new Map<string, string>();
  for (let i = 1; i < metadataRows.length; i++) {
    const row = metadataRows[i];
    if (row && row[0] !== undefined) {
      metadata.set(String(row[0]), String(row[1] || ''));
    }
  }

  // Parse legs into a map by tradeId
  const legsByTradeId = new Map<string, OptionLeg[]>();
  for (let i = 1; i < legRows.length; i++) {
    const row = legRows[i];
    if (!row || row.length < 6) continue;

    const tradeId = String(row[0]);
    const leg: OptionLeg = {
      quantity: Number(row[2]),
      expiration: stringToDate(String(row[3])),
      strike: Number(row[4]),
      optionType: row[5] as OptionType,
      legAction: row[6] ? (row[6] as LegAction) : undefined,
    };

    if (!legsByTradeId.has(tradeId)) {
      legsByTradeId.set(tradeId, []);
    }
    // Insert at correct index
    const legs = legsByTradeId.get(tradeId)!;
    const legIndex = Number(row[1]);
    legs[legIndex] = leg;
  }

  // Parse trades into a map by positionId+serviceId
  const tradesByPositionKey = new Map<string, Trade[]>();
  for (let i = 1; i < tradeRows.length; i++) {
    const row = tradeRows[i];
    if (!row || row.length < 14) continue;

    const tradeId = String(row[0]);
    const positionId = Number(row[1]);
    const serviceId = String(row[2]);

    const trade: Trade = {
      id: tradeId,
      rawInput: String(row[3]),
      action: row[4] as TradeAction,
      totalQuantity: Number(row[5]),
      symbol: String(row[6]),
      multiplier: Number(row[7]),
      isWeekly: stringToBool(String(row[8])),
      spreadType: row[9] as SpreadType,
      legs: legsByTradeId.get(tradeId) || [],
      price: Number(row[10]),
      orderType: row[11] as OrderType,
      isGTC: stringToBool(String(row[12])),
      positionId,
      tradeDate: stringToDate(String(row[13])),
    };

    const key = `${serviceId}:${positionId}`;
    if (!tradesByPositionKey.has(key)) {
      tradesByPositionKey.set(key, []);
    }
    tradesByPositionKey.get(key)!.push(trade);
  }

  // Parse positions into a map by serviceId
  const positionsByServiceId = new Map<string, Position[]>();
  for (let i = 1; i < positionRows.length; i++) {
    const row = positionRows[i];
    if (!row || row.length < 6) continue;

    const positionId = Number(row[0]);
    const serviceId = String(row[1]);
    const key = `${serviceId}:${positionId}`;

    const position: Position = {
      id: positionId,
      symbol: String(row[2]),
      structure: row[3] as SpreadType,
      isOpen: stringToBool(String(row[4])),
      openDate: stringToDate(String(row[5])),
      closeDate: row[6] ? stringToDate(String(row[6])) : undefined,
      trades: tradesByPositionKey.get(key) || [],
      markValue: row[7] !== undefined && row[7] !== '' ? Number(row[7]) : undefined,
      markDate: row[8] ? stringToDate(String(row[8])) : undefined,
      markSource: row[9] ? (row[9] as MarkSource) : undefined,
      isTaxable: row[10] !== undefined && row[10] !== '' ? stringToBool(String(row[10])) : false, // Default to false
    };

    if (!positionsByServiceId.has(serviceId)) {
      positionsByServiceId.set(serviceId, []);
    }
    positionsByServiceId.get(serviceId)!.push(position);
  }

  // Parse services
  const services: Service[] = [];
  for (let i = 1; i < serviceRows.length; i++) {
    const row = serviceRows[i];
    if (!row || row.length < 4) continue;

    const serviceId = String(row[0]);
    const service: Service = {
      id: serviceId,
      name: String(row[1]),
      createdAt: stringToDate(String(row[2])),
      portfolio: {
        positions: positionsByServiceId.get(serviceId) || [],
        nextPositionId: Number(row[3]),
      },
    };
    services.push(service);
  }

  return {
    services,
    appTitle: metadata.get('appTitle') || undefined,
  };
}

// ============================================================================
// Validate sheet structure
// ============================================================================

export function validateSheetHeaders(
  sheet: string,
  actualHeaders: unknown[]
): { valid: boolean; missing: string[] } {
  const expected = HEADERS[sheet as keyof typeof HEADERS];
  if (!expected) {
    return { valid: false, missing: ['unknown sheet'] };
  }

  const missing: string[] = [];
  for (const header of expected) {
    if (!actualHeaders.includes(header)) {
      missing.push(header);
    }
  }

  return { valid: missing.length === 0, missing };
}

// ============================================================================
// Get default empty data
// ============================================================================

export function getEmptySheetData(): {
  metadata: unknown[][];
  services: unknown[][];
  positions: unknown[][];
  trades: unknown[][];
  legs: unknown[][];
} {
  return {
    metadata: [
      HEADERS.metadata,
      ['appTitle', ''],
      ['schemaVersion', String(SPREADSHEET_CONFIG.schemaVersion)],
      ['lastModified', new Date().toISOString()],
    ],
    services: [HEADERS.services],
    positions: [HEADERS.positions],
    trades: [HEADERS.trades],
    legs: [HEADERS.legs],
  };
}
