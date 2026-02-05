# Options Tracker Architecture

This document describes the architectural patterns used in this application, intended as a reference for building similar applications.

## Tech Stack

- **Frontend**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Hosting**: Vercel (with serverless functions)
- **Cloud Storage**: Google Sheets API
- **Authentication**: Google OAuth 2.0

## Project Structure

```
src/
├── components/          # Reusable UI components
├── contexts/            # React contexts for state management
│   ├── AuthContext.tsx      # Google OAuth state
│   └── StorageContext.tsx   # Data persistence & sync
├── services/            # External API integrations
│   ├── googleAuth.ts        # Google OAuth service
│   ├── googleSheets.ts      # Google Sheets API
│   ├── sheetsDataMapper.ts  # Data transformation for Sheets
│   └── syncManager.ts       # Sync state machine
├── utils/               # Utility functions
│   ├── storage.ts           # Local storage operations
│   └── tradeParser.ts       # Domain-specific parsing
├── types/               # TypeScript type definitions
├── config/              # Configuration files
│   └── google.ts            # Google API config
├── App.tsx              # Main application component
└── main.tsx             # Entry point

public/                  # Static files
api/                     # Vercel serverless functions
```

## Core Architectural Patterns

### 1. Offline-First Data Storage

Data is always saved to localStorage first, then synced to cloud storage. This ensures the app works offline and feels fast.

```typescript
// Storage flow:
// 1. User action → update state
// 2. State change → save to localStorage
// 3. Sync manager → push to Google Sheets (debounced)
```

**Key files:**
- `src/utils/storage.ts` - localStorage operations, data rehydration
- `src/contexts/StorageContext.tsx` - React context wrapping storage

### 2. Context-Based State Management

Uses React Context for global state instead of external libraries (Redux, Zustand). Each domain has its own context:

```typescript
// AuthContext - authentication state
const { isSignedIn, signIn, signOut } = useAuth();

// StorageContext - app data and sync state
const { appData, updateAppData, syncStatus } = useStorage();
```

**Pattern:**
- Context provides state and actions
- Provider wraps the app in `main.tsx`
- Custom hook (`useAuth`, `useStorage`) for consuming

### 3. Google Sheets as Database

Uses Google Sheets API as a simple cloud database. Benefits:
- Free storage
- User owns their data
- Easy to inspect/edit manually
- No backend needed

**Structure:**
- One spreadsheet per user (stored in their Google Drive)
- Multiple sheets (tabs) for different data types
- Row-based storage with headers

**Key files:**
- `src/services/googleSheets.ts` - CRUD operations
- `src/services/sheetsDataMapper.ts` - Transform app data ↔ sheet rows
- `src/config/google.ts` - Sheet names, headers, schema version

**Data Mapper Pattern:**
```typescript
// App data → Sheet rows (for saving)
export function appDataToSheetRows(appData: AppData): SheetData

// Sheet rows → App data (for loading)
export function sheetRowsToAppData(rows: SheetData): AppData
```

### 4. Google OAuth Authentication

Uses Google Identity Services (GIS) for authentication and authorization.

**Key files:**
- `src/services/googleAuth.ts` - OAuth service singleton
- `src/contexts/AuthContext.tsx` - React context wrapper

**Flow:**
1. User clicks "Sign in with Google"
2. Google OAuth popup → user grants permission
3. Receive access token
4. Token stored in memory (auto-refreshes)
5. Token used for Sheets API calls

**Scopes:**
```typescript
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',      // Create/edit files we create
  'https://www.googleapis.com/auth/spreadsheets',    // Read/write spreadsheets
];
```

### 5. Sync State Machine

Manages synchronization between local and cloud data with conflict detection.

**States:**
- `idle` - No sync needed
- `syncing` - Sync in progress
- `synced` - Successfully synced
- `error` - Sync failed
- `conflict` - Local and cloud data differ

**Key files:**
- `src/services/syncManager.ts` - Sync logic and state machine
- `src/components/SyncStatusIndicator.tsx` - UI feedback

**Debouncing:**
Changes are debounced (e.g., 2 seconds) before syncing to avoid excessive API calls.

### 6. Data Rehydration

When loading from storage (localStorage or Sheets), dates are stored as ISO strings and must be converted back to Date objects.

```typescript
function rehydratePortfolio(data: Portfolio): Portfolio {
  return {
    ...data,
    positions: data.positions.map(pos => ({
      ...pos,
      openDate: new Date(pos.openDate),
      closeDate: pos.closeDate ? new Date(pos.closeDate) : undefined,
      // ... other date fields
    })),
  };
}
```

### 7. Vercel Serverless Functions

Used for operations that need server-side secrets (API keys, client secrets).

**Location:** `api/` directory

**Example:** Token exchange for OAuth flows that require client secrets.

```typescript
// api/example-token.ts
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const clientSecret = process.env.CLIENT_SECRET; // Server-side only
  // ... exchange tokens
}
```

## Configuration

### Environment Variables

**Client-side (Vite):**
```env
VITE_GOOGLE_CLIENT_ID=your-client-id
VITE_GOOGLE_API_KEY=your-api-key
```

**Server-side (Vercel):**
```env
CLIENT_SECRET=your-secret
```

### Google Cloud Console Setup

1. Create project at console.cloud.google.com
2. Enable APIs: Google Sheets API, Google Drive API
3. Create OAuth 2.0 credentials
4. Configure consent screen
5. Add authorized JavaScript origins and redirect URIs

## Type Definitions

Keep types in `src/types/` with clear interfaces for all data structures:

```typescript
export interface AppData {
  services: Service[];
  appTitle?: string;
  // ... other top-level fields
}

export interface Service {
  id: string;
  name: string;
  portfolio: Portfolio;
  createdAt: Date;
}
```

---

# Schwab Integration (Optional Module)

This section describes the Schwab brokerage integration, which is **optional** and can be excluded from new projects.

## Overview

Integrates with Schwab's Trader API to fetch account data and positions. Uses OAuth 2.0 for authentication.

## Files

```
src/
├── contexts/
│   └── SchwabContext.tsx    # Schwab state management
├── services/
│   └── schwabApi.ts         # Schwab API service
api/
└── schwab-token.ts          # Token exchange serverless function
```

## Architecture

### OAuth Flow

1. User clicks "Connect to Schwab"
2. Redirect to Schwab authorization page
3. User logs in and grants permission
4. Schwab redirects back with authorization code
5. Code exchanged for tokens via serverless function
6. Tokens stored in localStorage

**Important:** Redirect URI must exactly match what's registered in Schwab developer portal (watch for www vs non-www).

### Token Management

```typescript
interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}
```

- Tokens stored in localStorage
- Auto-refresh before expiration
- Token exchange happens server-side (to protect client secret)

### Auto-Refresh

Positions automatically refresh every 5 minutes when:
- User is signed in
- Tab is visible (uses `document.visibilityState`)

Also refreshes when tab becomes visible if >5 minutes since last refresh.

### Position Matching

Matches app positions to Schwab positions by:
- Symbol (with normalization, e.g., SPXW → SPX)
- Expiration date
- Strike price
- Option type (CALL/PUT)
- Quantity sign (+/-)

### Context API

```typescript
const {
  isEnabled,
  isSignedIn,
  accounts,
  refreshAllPositions,
  getNetLiqForPosition,
  lastRefresh,
} = useSchwab();
```

### Data Persistence

- Account nicknames stored in `appData.schwabAccountNicknames`
- Position's `autoMarkToMarket` flag stored on Position object
- Both sync to Google Sheets

## Environment Variables

```env
VITE_SCHWAB_CLIENT_ID=your-schwab-app-key
SCHWAB_CLIENT_SECRET=your-schwab-secret  # Server-side only
```

## Schwab Developer Portal Setup

1. Register at developer.schwab.com
2. Create an app
3. Set callback URL (must match exactly, including www or non-www)
4. Note the App Key (client ID) and Secret

## Removing Schwab Integration

To use this architecture without Schwab:

1. Delete `src/contexts/SchwabContext.tsx`
2. Delete `src/services/schwabApi.ts`
3. Delete `api/schwab-token.ts`
4. Remove `SchwabProvider` from `main.tsx`
5. Remove Schwab-related fields from types (`schwabAccountId`, `autoMarkToMarket`)
6. Remove Schwab-related UI components and hooks
7. Remove Schwab environment variables
