// Schwab API Service with OAuth PKCE Flow
// Implements real Schwab Trader API integration

import type { Position } from '../types/trade';

// ============================================================================
// Configuration
// ============================================================================

const SCHWAB_CLIENT_ID = import.meta.env.VITE_SCHWAB_CLIENT_ID || '';
const REDIRECT_URI = `${window.location.origin}/auth/schwab/callback`;

// Schwab OAuth endpoints
const SCHWAB_AUTH_URL = 'https://api.schwabapi.com/v1/oauth/authorize';
const SCHWAB_TOKEN_URL = 'https://api.schwabapi.com/v1/oauth/token';
const SCHWAB_API_BASE = 'https://api.schwabapi.com/trader/v1';

// Storage keys
const TOKEN_STORAGE_KEY = 'schwab-tokens';
const PKCE_VERIFIER_KEY = 'schwab-pkce-verifier';

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
// PKCE Utilities
// ============================================================================

function generateRandomString(length: number): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues, (v) => charset[v % charset.length]).join('');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  // Convert to base64url format
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
  localStorage.removeItem(PKCE_VERIFIER_KEY);
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

export async function signIn(): Promise<void> {
  if (!isConfigured()) {
    throw new Error('Schwab API is not configured. Set VITE_SCHWAB_CLIENT_ID environment variable.');
  }

  // Generate PKCE code verifier and challenge
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Store verifier for later use in token exchange
  localStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);

  // Build authorization URL
  const params = new URLSearchParams({
    client_id: SCHWAB_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'readonly', // Read-only access to accounts and positions
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  // Redirect to Schwab authorization page
  window.location.href = `${SCHWAB_AUTH_URL}?${params.toString()}`;
}

export async function handleOAuthCallback(authCode: string): Promise<void> {
  const codeVerifier = localStorage.getItem(PKCE_VERIFIER_KEY);
  if (!codeVerifier) {
    throw new Error('PKCE verifier not found. Please try signing in again.');
  }

  // Exchange authorization code for tokens
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: SCHWAB_CLIENT_ID,
    code: authCode,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const response = await fetch(SCHWAB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Token exchange failed:', errorText);
    throw new Error(`Failed to exchange authorization code: ${response.status}`);
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
  localStorage.removeItem(PKCE_VERIFIER_KEY);
}

async function refreshAccessToken(): Promise<void> {
  const tokens = getStoredTokens();
  if (!tokens?.refresh_token) {
    throw new Error('No refresh token available');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: SCHWAB_CLIENT_ID,
    refresh_token: tokens.refresh_token,
  });

  const response = await fetch(SCHWAB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
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
      accounts.push({
        accountId: acct.hashValue,
        accountNumber: `****${acct.accountNumber.slice(-4)}`,
        displayName: accountResponse.securitiesAccount.type || 'Account',
      });
    } catch (error) {
      console.error(`Failed to fetch account ${acct.accountNumber}:`, error);
    }
  }

  return accounts;
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
          positions.push({
            symbol: pos.instrument.underlyingSymbol || pos.instrument.symbol.split('_')[0],
            optionSymbol: pos.instrument.symbol,
            quantity,
            marketValue: pos.marketValue,
            optionType: pos.instrument.putCall,
            strikePrice: pos.instrument.strikePrice || 0,
            expirationDate: pos.instrument.optionExpirationDate?.split('T')[0] || '',
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
      const expStr = leg.expiration.toISOString().split('T')[0];
      const key = `${position.symbol}-${expStr}-${leg.optionType}-${leg.strike}`;

      const existing = legMap.get(key);
      if (existing) {
        existing.quantity += leg.quantity;
      } else {
        legMap.set(key, {
          quantity: leg.quantity,
          optionType: leg.optionType,
          strike: leg.strike,
          expiration: leg.expiration,
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

    // Find matching Schwab position
    const schwabMatch = schwabPositions.find(sp =>
      sp.symbol.toUpperCase() === position.symbol.toUpperCase() &&
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
