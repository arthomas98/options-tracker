// Google Sheets API Wrapper
// Provides high-level operations for reading/writing the Options Tracker spreadsheet

import { SPREADSHEET_CONFIG, STORAGE_KEYS } from '../config/google';
import type { AppData } from '../types';
import {
  appDataToSheetRows,
  sheetRowsToAppData,
  getEmptySheetData,
  HEADERS,
} from './sheetsDataMapper';

// Sheet names for convenience
const SHEETS = SPREADSHEET_CONFIG.sheets;

// ============================================================================
// Types
// ============================================================================

export interface SheetsError {
  code: number;
  message: string;
  status?: string;
}

export interface SpreadsheetInfo {
  id: string;
  title: string;
  url: string;
}

// ============================================================================
// Spreadsheet Management
// ============================================================================

/**
 * Find existing Options Tracker spreadsheet in user's Drive
 */
export async function findExistingSpreadsheet(): Promise<SpreadsheetInfo | null> {
  try {
    // Check if we have a stored spreadsheet ID
    const storedId = localStorage.getItem(STORAGE_KEYS.spreadsheetId);
    if (storedId) {
      // Verify it still exists and is accessible
      try {
        const response = await gapi.client.sheets.spreadsheets.get({
          spreadsheetId: storedId,
        });
        return {
          id: response.result.spreadsheetId,
          title: response.result.properties.title,
          url: response.result.spreadsheetUrl,
        };
      } catch {
        // Stored ID is invalid, clear it
        localStorage.removeItem(STORAGE_KEYS.spreadsheetId);
      }
    }

    // Search in Drive for existing spreadsheet
    const response = await gapi.client.drive.files.list({
      q: `name='${SPREADSHEET_CONFIG.title}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
      spaces: 'drive',
      fields: 'files(id, name)',
      pageSize: 1,
    });

    const files = response.result.files;
    if (files && files.length > 0) {
      const file = files[0];
      // Store the ID for future use
      localStorage.setItem(STORAGE_KEYS.spreadsheetId, file.id);

      // Get full spreadsheet info
      const sheetResponse = await gapi.client.sheets.spreadsheets.get({
        spreadsheetId: file.id,
      });

      return {
        id: file.id,
        title: sheetResponse.result.properties.title,
        url: sheetResponse.result.spreadsheetUrl,
      };
    }

    return null;
  } catch (error) {
    console.error('Error finding spreadsheet:', error);
    throw error;
  }
}

/**
 * Create a new Options Tracker spreadsheet with the required sheets
 */
export async function createSpreadsheet(): Promise<SpreadsheetInfo> {
  try {
    const emptyData = getEmptySheetData();

    // Create spreadsheet with all required sheets
    const response = await gapi.client.sheets.spreadsheets.create({
      resource: {
        properties: {
          title: SPREADSHEET_CONFIG.title,
        },
        sheets: [
          {
            properties: { title: SHEETS.metadata, index: 0 },
            data: [{ startRow: 0, startColumn: 0, rowData: rowsToGridData(emptyData.metadata) }],
          },
          {
            properties: { title: SHEETS.services, index: 1 },
            data: [{ startRow: 0, startColumn: 0, rowData: rowsToGridData(emptyData.services) }],
          },
          {
            properties: { title: SHEETS.positions, index: 2 },
            data: [{ startRow: 0, startColumn: 0, rowData: rowsToGridData(emptyData.positions) }],
          },
          {
            properties: { title: SHEETS.trades, index: 3 },
            data: [{ startRow: 0, startColumn: 0, rowData: rowsToGridData(emptyData.trades) }],
          },
          {
            properties: { title: SHEETS.legs, index: 4 },
            data: [{ startRow: 0, startColumn: 0, rowData: rowsToGridData(emptyData.legs) }],
          },
          {
            properties: { title: SHEETS.tradeHistory, index: 5 },
            data: [{ startRow: 0, startColumn: 0, rowData: rowsToGridData(emptyData.tradeHistory) }],
          },
        ],
      },
    });

    const spreadsheet = response.result;
    const info: SpreadsheetInfo = {
      id: spreadsheet.spreadsheetId,
      title: spreadsheet.properties.title,
      url: spreadsheet.spreadsheetUrl,
    };

    // Store the ID
    localStorage.setItem(STORAGE_KEYS.spreadsheetId, info.id);

    return info;
  } catch (error) {
    console.error('Error creating spreadsheet:', error);
    throw error;
  }
}

/**
 * Helper to convert row arrays to GridData format for sheet creation
 */
function rowsToGridData(rows: unknown[][]): RowData[] {
  return rows.map(row => ({
    values: row.map(cell => ({
      userEnteredValue: {
        stringValue: cell === null || cell === undefined ? '' : String(cell),
      },
    })),
  }));
}

/**
 * Get or create the Options Tracker spreadsheet
 */
export async function getOrCreateSpreadsheet(): Promise<SpreadsheetInfo> {
  const existing = await findExistingSpreadsheet();
  if (existing) {
    // Validate sheet structure
    await validateAndRepairSheets(existing.id);
    return existing;
  }
  return createSpreadsheet();
}

/**
 * Validate spreadsheet has all required sheets and repair if needed
 */
async function validateAndRepairSheets(spreadsheetId: string): Promise<void> {
  const response = await gapi.client.sheets.spreadsheets.get({
    spreadsheetId,
  });

  const existingSheets = response.result.sheets.map(s => s.properties.title);
  const requiredSheets = Object.values(SHEETS);
  const missingSheets = requiredSheets.filter(name => !existingSheets.includes(name));

  if (missingSheets.length > 0) {
    // Add missing sheets
    const requests = missingSheets.map((title, index) => ({
      addSheet: {
        properties: {
          title,
          index: existingSheets.length + index,
        },
      },
    }));

    await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests },
    });

    // Add headers to new sheets
    const emptyData = getEmptySheetData();
    const updates: { range: string; values: unknown[][] }[] = [];

    for (const sheetName of missingSheets) {
      const key = Object.keys(SHEETS).find(
        k => SHEETS[k as keyof typeof SHEETS] === sheetName
      ) as keyof typeof HEADERS;

      if (key && emptyData[key]) {
        updates.push({
          range: `${sheetName}!A1`,
          values: [HEADERS[key]],
        });
      }
    }

    if (updates.length > 0) {
      await gapi.client.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        resource: {
          valueInputOption: 'RAW',
          data: updates,
        },
      });
    }
  }
}

// ============================================================================
// Data Operations
// ============================================================================

/**
 * Read all data from the spreadsheet and convert to AppData
 */
export async function readAppData(spreadsheetId: string): Promise<AppData> {
  try {
    const ranges = [
      `${SHEETS.metadata}!A:B`,
      `${SHEETS.services}!A:D`,
      `${SHEETS.positions}!A:K`,
      `${SHEETS.trades}!A:N`,
      `${SHEETS.legs}!A:G`,
      `${SHEETS.tradeHistory}!A:E`,
    ];

    const response = await gapi.client.sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges,
    });

    const valueRanges = response.result.valueRanges || [];

    // Extract values, defaulting to headers only if empty
    const metadata = valueRanges[0]?.values || [HEADERS.metadata];
    const services = valueRanges[1]?.values || [HEADERS.services];
    const positions = valueRanges[2]?.values || [HEADERS.positions];
    const trades = valueRanges[3]?.values || [HEADERS.trades];
    const legs = valueRanges[4]?.values || [HEADERS.legs];
    const tradeHistory = valueRanges[5]?.values || [HEADERS.tradeHistory];

    return sheetRowsToAppData(metadata, services, positions, trades, legs, tradeHistory);
  } catch (error) {
    console.error('Error reading app data:', error);
    throw error;
  }
}

/**
 * Write all AppData to the spreadsheet
 * This is a full overwrite - use for initial sync or full refresh
 */
export async function writeAppData(spreadsheetId: string, data: AppData): Promise<void> {
  try {
    const sheetData = appDataToSheetRows(data);

    // Clear all sheets first
    const clearRanges = [
      `${SHEETS.metadata}!A:Z`,
      `${SHEETS.services}!A:Z`,
      `${SHEETS.positions}!A:Z`,
      `${SHEETS.trades}!A:Z`,
      `${SHEETS.legs}!A:Z`,
      `${SHEETS.tradeHistory}!A:Z`,
    ];

    // Clear sheets (batch clear not available, do sequentially)
    for (const range of clearRanges) {
      await gapi.client.sheets.spreadsheets.values.clear({
        spreadsheetId,
        range,
      });
    }

    // Write all data
    const updates = [
      { range: `${SHEETS.metadata}!A1`, values: sheetData.metadata },
      { range: `${SHEETS.services}!A1`, values: sheetData.services },
      { range: `${SHEETS.positions}!A1`, values: sheetData.positions },
      { range: `${SHEETS.trades}!A1`, values: sheetData.trades },
      { range: `${SHEETS.legs}!A1`, values: sheetData.legs },
      { range: `${SHEETS.tradeHistory}!A1`, values: sheetData.tradeHistory },
    ];

    await gapi.client.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      resource: {
        valueInputOption: 'RAW',
        data: updates,
      },
    });

    // Update last sync time
    localStorage.setItem(STORAGE_KEYS.lastSyncTime, new Date().toISOString());
  } catch (error) {
    console.error('Error writing app data:', error);
    throw error;
  }
}

// ============================================================================
// Incremental Updates (for efficiency)
// ============================================================================

/**
 * Update only the metadata sheet (for quick sync timestamp updates)
 */
export async function updateMetadata(
  spreadsheetId: string,
  appTitle?: string
): Promise<void> {
  const metadata = [
    HEADERS.metadata,
    ['appTitle', appTitle || ''],
    ['schemaVersion', String(SPREADSHEET_CONFIG.schemaVersion)],
    ['lastModified', new Date().toISOString()],
  ];

  await gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEETS.metadata}!A1`,
    valueInputOption: 'RAW',
    resource: { values: metadata },
  });
}

/**
 * Get the last modified timestamp from the sheet
 */
export async function getLastModified(spreadsheetId: string): Promise<Date | null> {
  try {
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEETS.metadata}!A:B`,
    });

    const rows = response.result.values || [];
    for (const row of rows) {
      if (row[0] === 'lastModified' && row[1]) {
        return new Date(String(row[1]));
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if the Google Sheets API is ready to use
 */
export function isSheetsApiReady(): boolean {
  return Boolean(
    window.gapi &&
    gapi.client &&
    gapi.client.sheets &&
    gapi.client.drive
  );
}

/**
 * Get the stored spreadsheet ID
 */
export function getStoredSpreadsheetId(): string | null {
  return localStorage.getItem(STORAGE_KEYS.spreadsheetId);
}

/**
 * Clear the stored spreadsheet ID (for account switching)
 */
export function clearStoredSpreadsheetId(): void {
  localStorage.removeItem(STORAGE_KEYS.spreadsheetId);
}
