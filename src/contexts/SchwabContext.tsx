// Schwab Integration Context
// Manages Schwab authentication, account data, and position caching

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { SchwabAccount, SchwabSettings, Position } from '../types';
import * as schwabApi from '../services/schwabApi';
import type { SchwabAccountPositions } from '../services/schwabApi';

interface SchwabContextType {
  // Auth state
  isEnabled: boolean;
  isSignedIn: boolean;
  isLoading: boolean;
  authError: string | null;

  // Account data
  accounts: SchwabAccount[];

  // Cached positions
  positionsCache: Map<string, SchwabAccountPositions>;
  lastRefresh: Date | null;
  isRefreshing: boolean;

  // Actions
  enable: () => void;
  disable: () => void;
  signIn: () => Promise<void>;
  signOut: () => void;
  updateAccountNickname: (accountId: string, nickname: string) => void;

  // Data fetching
  refreshAllPositions: () => Promise<void>;
  getNetLiqForPosition: (position: Position) => { netLiq: number; matchedLegs: number; totalLegs: number } | null;

  // Helpers
  getAccountDisplayName: (accountId: string) => string;
}

const SchwabContext = createContext<SchwabContextType | null>(null);

const STORAGE_KEY = 'options-tracker-schwab';

export function SchwabProvider({ children }: { children: ReactNode }) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<SchwabAccount[]>([]);
  const [positionsCache, setPositionsCache] = useState<Map<string, SchwabAccountPositions>>(new Map());
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Save settings to localStorage
  const saveSettings = useCallback((enabled: boolean, accts: SchwabAccount[]) => {
    const settings: SchwabSettings = { enabled, accounts: accts };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, []);

  // Handle OAuth callback - check URL for auth code on mount
  useEffect(() => {
    const handleOAuthCallback = async () => {
      const url = new URL(window.location.href);

      // Check if this is a Schwab OAuth callback
      if (url.pathname === '/auth/schwab/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        // Clear the URL (remove code from browser history)
        window.history.replaceState({}, '', '/');

        if (error) {
          console.error('Schwab OAuth error:', error, errorDescription);
          setAuthError(errorDescription || error);
          setIsLoading(false);
          return;
        }

        if (code) {
          try {
            // Exchange the authorization code for tokens
            await schwabApi.handleOAuthCallback(code);

            // Fetch accounts after successful auth
            const fetchedAccounts = await schwabApi.getAccounts();

            // Preserve nicknames from previously saved accounts
            let existingAccounts: SchwabAccount[] = [];
            try {
              const stored = localStorage.getItem(STORAGE_KEY);
              if (stored) {
                const settings: SchwabSettings = JSON.parse(stored);
                existingAccounts = settings.accounts || [];
              }
            } catch {
              // Ignore errors reading existing settings
            }

            // Merge nicknames onto fetched accounts
            const mergedAccounts = fetchedAccounts.map(account => {
              const existing = existingAccounts.find(a => a.accountId === account.accountId);
              return existing?.nickname
                ? { ...account, nickname: existing.nickname }
                : account;
            });

            setAccounts(mergedAccounts);
            setIsSignedIn(true);
            setIsEnabled(true);
            saveSettings(true, mergedAccounts);
          } catch (err) {
            console.error('Failed to complete Schwab OAuth:', err);
            setAuthError(err instanceof Error ? err.message : 'OAuth failed');
          }
        }

        setIsLoading(false);
        return;
      }

      // Normal load - restore settings from localStorage
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const settings: SchwabSettings = JSON.parse(stored);
          setIsEnabled(settings.enabled);
          setAccounts(settings.accounts);
          // Check if we have a valid session
          if (settings.enabled && schwabApi.isAuthenticated()) {
            setIsSignedIn(true);
          }
        }
      } catch (error) {
        console.error('Failed to load Schwab settings:', error);
      }
      setIsLoading(false);
    };

    handleOAuthCallback();
  }, [saveSettings]);

  const enable = useCallback(() => {
    setIsEnabled(true);
    saveSettings(true, accounts);
  }, [accounts, saveSettings]);

  const disable = useCallback(() => {
    setIsEnabled(false);
    setIsSignedIn(false);
    setAccounts([]);
    setPositionsCache(new Map());
    setLastRefresh(null);
    setAuthError(null);
    schwabApi.signOut();
    saveSettings(false, []);
  }, [saveSettings]);

  const signIn = useCallback(async () => {
    if (!schwabApi.isConfigured()) {
      setAuthError('Schwab API is not configured');
      return;
    }
    setAuthError(null);
    // This will redirect to Schwab's OAuth page
    // When the user returns, the useEffect above will handle the callback
    await schwabApi.signIn();
  }, []);

  const signOut = useCallback(() => {
    schwabApi.signOut();
    setIsSignedIn(false);
    // Don't clear accounts from state or localStorage - preserve nicknames
    // Just clear the positions cache and auth state
    setPositionsCache(new Map());
    setLastRefresh(null);
    setAuthError(null);
    // Note: accounts with nicknames remain in localStorage for next sign-in
  }, []);

  // Fetch positions from all accounts and cache them
  const refreshAllPositions = useCallback(async () => {
    if (!isEnabled || !isSignedIn || accounts.length === 0) {
      return;
    }

    setIsRefreshing(true);
    try {
      const newCache = new Map<string, SchwabAccountPositions>();

      // Fetch positions from all accounts in parallel
      const results = await Promise.all(
        accounts.map(account => schwabApi.getAccountPositions(account.accountId))
      );

      for (const result of results) {
        newCache.set(result.accountId, result);
      }

      setPositionsCache(newCache);
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Failed to refresh Schwab positions:', error);
      throw error;
    } finally {
      setIsRefreshing(false);
    }
  }, [isEnabled, isSignedIn, accounts]);

  // Get Net Liq for a position from cached data
  const getNetLiqForPosition = useCallback((position: Position) => {
    if (!isEnabled || !isSignedIn || !position.schwabAccountId) {
      return null;
    }

    const accountPositions = positionsCache.get(position.schwabAccountId);
    if (!accountPositions) {
      return null;
    }

    return schwabApi.matchPositionToSchwab(position, accountPositions.positions);
  }, [isEnabled, isSignedIn, positionsCache]);

  // Update account nickname
  const updateAccountNickname = useCallback((accountId: string, nickname: string) => {
    const updatedAccounts = accounts.map(account =>
      account.accountId === accountId
        ? { ...account, nickname: nickname.trim() || undefined }
        : account
    );
    setAccounts(updatedAccounts);
    saveSettings(isEnabled, updatedAccounts);
  }, [accounts, isEnabled, saveSettings]);

  // Get display name for an account (nickname if set, otherwise default)
  const getAccountDisplayName = useCallback((accountId: string) => {
    const account = accounts.find(a => a.accountId === accountId);
    if (!account) return 'Unknown Account';
    return account.nickname || account.displayName;
  }, [accounts]);

  return (
    <SchwabContext.Provider
      value={{
        isEnabled,
        isSignedIn,
        isLoading,
        authError,
        accounts,
        positionsCache,
        lastRefresh,
        isRefreshing,
        enable,
        disable,
        signIn,
        signOut,
        updateAccountNickname,
        refreshAllPositions,
        getNetLiqForPosition,
        getAccountDisplayName,
      }}
    >
      {children}
    </SchwabContext.Provider>
  );
}

export function useSchwab() {
  const context = useContext(SchwabContext);
  if (!context) {
    throw new Error('useSchwab must be used within a SchwabProvider');
  }
  return context;
}
