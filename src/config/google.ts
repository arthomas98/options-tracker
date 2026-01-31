// Google API Configuration
// To set up your own Google Cloud project:
// 1. Go to https://console.cloud.google.com/
// 2. Create a new project or select existing
// 3. Enable Google Sheets API and Google Drive API
// 4. Configure OAuth consent screen (External)
// 5. Create OAuth 2.0 Client ID (Web application)
// 6. Add authorized JavaScript origins:
//    - http://localhost:5173 (development)
//    - https://yourusername.github.io (production)
// 7. Copy the Client ID below

// Client ID from Google Cloud Console
// Replace with your own Client ID
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// OAuth scopes required for the app
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets', // Read/write spreadsheets
  'https://www.googleapis.com/auth/drive.file',   // Create/access files created by app
].join(' ');

// API Discovery documents
export const DISCOVERY_DOCS = [
  'https://sheets.googleapis.com/$discovery/rest?version=v4',
  'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
];

// Spreadsheet configuration
export const SPREADSHEET_CONFIG = {
  // Name of the spreadsheet created in user's Drive
  title: 'Options Tracker Data',

  // Sheet (tab) names
  sheets: {
    metadata: 'Metadata',
    services: 'Services',
    positions: 'Positions',
    trades: 'Trades',
    legs: 'Legs',
    tradeHistory: 'TradeHistory',
  },

  // Current schema version for migrations
  schemaVersion: 1,
};

// Sync configuration
export const SYNC_CONFIG = {
  // Debounce delay for writes (ms)
  debounceMs: 500,

  // Rate limit: max requests per minute (Google's limit is 60)
  maxRequestsPerMinute: 50,

  // Retry configuration
  maxRetries: 3,
  retryDelayMs: 1000,

  // Offline queue max size
  maxQueueSize: 100,
};

// Storage keys for localStorage
export const STORAGE_KEYS = {
  // Google auth token info
  tokenExpiry: 'options-tracker-token-expiry',

  // Spreadsheet ID (once created/found)
  spreadsheetId: 'options-tracker-spreadsheet-id',

  // Sync state
  lastSyncTime: 'options-tracker-last-sync',
  pendingChanges: 'options-tracker-pending-changes',

  // User preferences
  syncEnabled: 'options-tracker-sync-enabled',
};

// Validate configuration
export function isGoogleConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID.length > 0);
}
