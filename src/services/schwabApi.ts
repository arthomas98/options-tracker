// Schwab API Service with OAuth Flow
// Implements real Schwab Trader API integration

import type { Position } from '../types/trade';

// ============================================================================
// Configuration
// ============================================================================

const SCHWAB_CLIENT_ID = import.meta.env.VITE_SCHWAB_CLIENT_ID || '';
// Must match exactly what's registered in Schwab developer portal (no www)
const REDIRECT_URI = 'https://cleared4theoption.com/auth/schwab/callback';

// Schwab OAuth endpoints
const SCHWAB_AUTH_URL = 'https://api.schwabapi.com/v1/oauth/authorize';
const SCHWAB_API_BASE = 'https://api.schwabapi.com/trader/v1';

// Our serverless function handles token exchange to avoid CORS and protect client secret
const TOKEN_PROXY_URL = '/api/schwab-token';

// Storage keys
const TOKEN_STORAGE_KEY = 'schwab-tokens';
const OAUTH_STATE_KEY = 'schwab-oauth-state';

// ============================================================================
// Types
// ============================================================================

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp
  token_type: string;
  scope: string;
}

export interface SchwabAccount {
  accountId: string;
  accountNumber: string;
  displayName: string;
}

export interface SchwabOptionPosition {
  symbol: string;
  optionSymbol: string;
  quantity: number;
  marketValue: number;
  optionType: 'CALL' | 'PUT';
  strikePrice: number;
  expirationDate: string;
}

export interface SchwabAccountPositions {
  accountId: string;
  positions: SchwabOptionPosition[];
  fetchedAt: Date;
}

// ============================================================================
// Token Management
// ============================================================================

function getStoredTokens(): TokenData | null {
  try {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore errors
  }
  return null;
}

function storeTokens(tokens: TokenData): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
}

function clearTokens(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function isTokenExpired(tokens: TokenData): boolean {
  // Add 60 second buffer
  return Date.now() >= (tokens.expires_at - 60000);
}

// ============================================================================
// Authentication
// ============================================================================

export function isConfigured(): boolean {
  return Boolean(SCHWAB_CLIENT_ID && SCHWAB_CLIENT_ID.length > 0);
}

export function isAuthenticated(): boolean {
  const tokens = getStoredTokens();
  return tokens !== null && !isTokenExpired(tokens);
}

// Generate a cryptographically random state value for CSRF protection
function generateOAuthState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function signIn(): Promise<void> {
  if (!isConfigured()) {
    throw new Error('Schwab API is not configured. Set VITE_SCHWAB_CLIENT_ID environment variable.');
  }

  // Generate and store state for CSRF protection
  const state = generateOAuthState();
  sessionStorage.setItem(OAUTH_STATE_KEY, state);

  // Build authorization URL with state parameter
  const params = new URLSearchParams({
    client_id: SCHWAB_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state: state,
  });

  // Redirect to Schwab authorization page
  window.location.href = `${SCHWAB_AUTH_URL}?${params.toString()}`;
}

// Validate the OAuth state parameter to prevent CSRF attacks
export function validateOAuthState(receivedState: string | null): boolean {
  const storedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  // Clear the stored state regardless of result (one-time use)
  sessionStorage.removeItem(OAUTH_STATE_KEY);

  if (!storedState || !receivedState) {
    console.error('OAuth state validation failed: missing state');
    return false;
  }

  if (storedState !== receivedState) {
    console.error('OAuth state validation failed: state mismatch');
    return false;
  }

  return true;
}

export async function handleOAuthCallback(authCode: string): Promise<void> {
  // Exchange authorization code for tokens via our serverless function
  const response = await fetch(TOKEN_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('Token exchange failed:', errorData);
    throw new Error(errorData.error_description || errorData.error || `Failed to exchange authorization code: ${response.status}`);
  }

  const data = await response.json();

  // Calculate expiration time
  const expiresAt = Date.now() + (data.expires_in * 1000);

  const tokens: TokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    token_type: data.token_type,
    scope: data.scope,
  };

  storeTokens(tokens);
}

async function refreshAccessToken(): Promise<void> {
  const tokens = getStoredTokens();
  if (!tokens?.refresh_token) {
    throw new Error('No refresh token available');
  }

  // Refresh token via our serverless function
  const response = await fetch(TOKEN_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!response.ok) {
    clearTokens();
    throw new Error('Failed to refresh token. Please sign in again.');
  }

  const data = await response.json();
  const expiresAt = Date.now() + (data.expires_in * 1000);

  const newTokens: TokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: expiresAt,
    token_type: data.token_type,
    scope: data.scope || tokens.scope,
  };

  storeTokens(newTokens);
}

export function signOut(): void {
  clearTokens();
}

// ============================================================================
// API Requests
// ============================================================================

async function getAccessToken(): Promise<string> {
  let tokens = getStoredTokens();
  if (!tokens) {
    throw new Error('Not authenticated with Schwab');
  }

  if (isTokenExpired(tokens)) {
    await refreshAccessToken();
    tokens = getStoredTokens();
    if (!tokens) {
      throw new Error('Failed to refresh authentication');
    }
  }

  return tokens.access_token;
}

async function apiRequest<T>(endpoint: string): Promise<T> {
  const accessToken = await getAccessToken();

  const response = await fetch(`${SCHWAB_API_BASE}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });

  if (response.status === 401) {
    // Token might be invalid, try refresh
    await refreshAccessToken();
    const newToken = await getAccessToken();

    const retryResponse = await fetch(`${SCHWAB_API_BASE}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${newToken}`,
        'Accept': 'application/json',
      },
    });

    if (!retryResponse.ok) {
      throw new Error(`API request failed: ${retryResponse.status}`);
    }

    return retryResponse.json();
  }

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// Account Data
// ============================================================================

interface SchwabAccountResponse {
  securitiesAccount: {
    accountId: string;
    type: string;
    positions?: SchwabPositionResponse[];
  };
}

interface SchwabPositionResponse {
  shortQuantity: number;
  longQuantity: number;
  averagePrice: number;
  currentDayProfitLoss: number;
  currentDayProfitLossPercentage: number;
  marketValue: number;
  instrument: {
    assetType: string;
    cusip: string;
    symbol: string;
    description?: string;
    putCall?: 'PUT' | 'CALL';
    underlyingSymbol?: string;
    optionExpirationDate?: string;
    strikePrice?: number;
  };
}

export async function getAccounts(): Promise<SchwabAccount[]> {
  // First get account numbers
  const accountNumbersResponse = await apiRequest<Array<{ accountNumber: string; hashValue: string }>>('/accounts/accountNumbers');

  const accounts: SchwabAccount[] = [];

  for (const acct of accountNumbersResponse) {
    // Get account details
    try {
      const accountResponse = await apiRequest<SchwabAccountResponse>(`/accounts/${acct.hashValue}`);
      const lastFour = acct.accountNumber.slice(-4);
      const accountType = accountResponse.securitiesAccount.type || 'Account';
      accounts.push({
        accountId: acct.hashValue,
        accountNumber: `****${lastFour}`,
        displayName: `${accountType} ****${lastFour}`,
      });
    } catch (error) {
      console.error(`Failed to fetch account ${acct.accountNumber}:`, error);
    }
  }

  return accounts;
}

// Normalize symbol for matching (handle variants like SPXW -> SPX)
function normalizeSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  // SPXW (SPX Weeklies) should match SPX
  if (upper === 'SPXW') return 'SPX';
  // Add other mappings as needed (e.g., RUTW -> RUT, NDXP -> NDX)
  if (upper === 'RUTW') return 'RUT';
  if (upper === 'NDXP' || upper === 'NDXW') return 'NDX';
  return upper;
}

// Parse option symbol to extract expiration and strike
// Format: "SYMBOL YYMMDD[C/P]SSSSSSSS" e.g., "TSLA 260821C00520000"
function parseOptionSymbol(optionSymbol: string): { expiration: string; strike: number } | null {
  // Match pattern: letters/numbers, space, 6 digits, C or P, 8 digits
  const match = optionSymbol.match(/\s(\d{6})[CP](\d{8})$/);
  if (!match) {
    return null;
  }

  const dateStr = match[1]; // YYMMDD
  const strikeStr = match[2]; // 8 digits, divide by 1000

  // Parse date: YYMMDD -> YYYY-MM-DD
  const year = 2000 + parseInt(dateStr.substring(0, 2), 10);
  const month = dateStr.substring(2, 4);
  const day = dateStr.substring(4, 6);
  const expiration = `${year}-${month}-${day}`;

  // Parse strike: divide by 1000
  const strike = parseInt(strikeStr, 10) / 1000;

  return { expiration, strike };
}

export async function getAccountPositions(accountId: string): Promise<SchwabAccountPositions> {
  const response = await apiRequest<SchwabAccountResponse>(`/accounts/${accountId}?fields=positions`);

  const positions: SchwabOptionPosition[] = [];

  if (response.securitiesAccount.positions) {
    for (const pos of response.securitiesAccount.positions) {
      // Only include option positions
      if (pos.instrument.assetType === 'OPTION' && pos.instrument.putCall) {
        const quantity = pos.longQuantity - pos.shortQuantity;
        if (quantity !== 0) {
          // Parse strike and expiration from option symbol
          const parsed = parseOptionSymbol(pos.instrument.symbol);

          // Get underlying symbol, stripping any "$" prefix (Schwab uses $SPX for SPX index)
          let underlying = pos.instrument.underlyingSymbol || pos.instrument.symbol.split(' ')[0];
          if (underlying.startsWith('$')) {
            underlying = underlying.substring(1);
          }

          positions.push({
            symbol: underlying,
            optionSymbol: pos.instrument.symbol,
            quantity,
            marketValue: pos.marketValue,
            optionType: pos.instrument.putCall,
            strikePrice: parsed?.strike || 0,
            expirationDate: parsed?.expiration || '',
          });
        }
      }
    }
  }

  return {
    accountId,
    positions,
    fetchedAt: new Date(),
  };
}

// ============================================================================
// Position Matching
// ============================================================================

export function matchPositionToSchwab(
  position: Position,
  schwabPositions: SchwabOptionPosition[]
): { netLiq: number; matchedLegs: number; totalLegs: number } {
  // Build a map of our position's net legs
  const legMap = new Map<string, { quantity: number; optionType: string; strike: number; expiration: Date }>();

  for (const trade of position.trades) {
    for (const leg of trade.legs) {
      // Handle both Date objects and date strings
      const expDate = leg.expiration instanceof Date ? leg.expiration : new Date(leg.expiration);
      const expStr = expDate.toISOString().split('T')[0];
      const key = `${position.symbol}-${expStr}-${leg.optionType}-${leg.strike}`;

      const existing = legMap.get(key);
      if (existing) {
        existing.quantity += leg.quantity;
      } else {
        legMap.set(key, {
          quantity: leg.quantity,
          optionType: leg.optionType,
          strike: leg.strike,
          expiration: expDate,
        });
      }
    }
  }

  // Filter to non-zero legs (active positions)
  const activeLegs = Array.from(legMap.entries()).filter(([, v]) => v.quantity !== 0);
  const totalLegs = activeLegs.length;

  if (totalLegs === 0) {
    return { netLiq: 0, matchedLegs: 0, totalLegs: 0 };
  }

  let netLiq = 0;
  let matchedLegs = 0;

  for (const [, leg] of activeLegs) {
    const expStr = leg.expiration.toISOString().split('T')[0];

    // Find matching Schwab position (normalize symbols for comparison)
    const normalizedPositionSymbol = normalizeSymbol(position.symbol);
    const schwabMatch = schwabPositions.find(sp =>
      normalizeSymbol(sp.symbol) === normalizedPositionSymbol &&
      sp.expirationDate === expStr &&
      sp.optionType === leg.optionType &&
      sp.strikePrice === leg.strike &&
      Math.sign(sp.quantity) === Math.sign(leg.quantity)
    );

    if (schwabMatch) {
      netLiq += schwabMatch.marketValue;
      matchedLegs++;
    }
  }

  return {
    netLiq: Math.round(netLiq * 100) / 100,
    matchedLegs,
    totalLegs,
  };
}
