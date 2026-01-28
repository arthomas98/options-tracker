// Google Authentication Service
// Uses Google Identity Services (GIS) Token Model for client-side OAuth

import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES, DISCOVERY_DOCS, STORAGE_KEYS } from '../config/google';

export interface AuthState {
  isSignedIn: boolean;
  isLoading: boolean;
  accessToken: string | null;
  error: string | null;
  userEmail?: string;
}

type AuthStateListener = (state: AuthState) => void;

class GoogleAuthService {
  private tokenClient: google.accounts.oauth2.TokenClient | null = null;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;
  private listeners: Set<AuthStateListener> = new Set();
  private gapiLoaded = false;
  private gisLoaded = false;
  private initPromise: Promise<void> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  // Refresh token 5 minutes before expiry
  private static readonly REFRESH_MARGIN_MS = 5 * 60 * 1000;

  // Current auth state
  private state: AuthState = {
    isSignedIn: false,
    isLoading: true,
    accessToken: null,
    error: null,
  };

  // Subscribe to auth state changes
  subscribe(listener: AuthStateListener): () => void {
    this.listeners.add(listener);
    // Immediately call with current state
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  // Notify all listeners of state change
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.state));
  }

  // Update state and notify
  private setState(updates: Partial<AuthState>): void {
    this.state = { ...this.state, ...updates };
    this.notifyListeners();
  }

  // Initialize Google APIs
  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    try {
      // Wait for Google API scripts to load (they're async)
      await this.waitForGoogleScripts();

      // Load GAPI client
      await this.loadGapiClient();

      // Initialize GIS token client
      this.initializeTokenClient();

      // Check for existing valid token
      await this.checkExistingToken();

      this.setState({ isLoading: false });
    } catch (error) {
      console.error('Failed to initialize Google Auth:', error);
      this.setState({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to initialize',
      });
    }
  }

  // Wait for Google scripts to load (they're loaded async in index.html)
  private waitForGoogleScripts(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if (window.google && window.gapi) {
        resolve();
        return;
      }

      // Poll for scripts to load (max 10 seconds)
      const maxWait = 10000;
      const interval = 100;
      let elapsed = 0;

      const checkScripts = setInterval(() => {
        elapsed += interval;

        if (window.google && window.gapi) {
          clearInterval(checkScripts);
          resolve();
        } else if (elapsed >= maxWait) {
          clearInterval(checkScripts);
          reject(new Error('Google API scripts failed to load. Check your internet connection.'));
        }
      }, interval);
    });
  }

  // Load GAPI client library
  private loadGapiClient(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.gapiLoaded) {
        resolve();
        return;
      }

      gapi.load('client', async () => {
        try {
          await gapi.client.init({
            discoveryDocs: DISCOVERY_DOCS,
          });
          this.gapiLoaded = true;
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  // Initialize Google Identity Services token client
  private initializeTokenClient(): void {
    if (this.gisLoaded) return;

    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPES,
      callback: (response) => this.handleTokenResponse(response),
      error_callback: (error) => this.handleTokenError(error),
    });

    this.gisLoaded = true;
  }

  // Handle successful token response
  private handleTokenResponse(response: google.accounts.oauth2.TokenResponse): void {
    if (response.error) {
      this.setState({
        isSignedIn: false,
        accessToken: null,
        error: response.error_description || response.error,
      });
      return;
    }

    // Verify we have all required scopes
    if (!google.accounts.oauth2.hasGrantedAllScopes(
      response,
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file'
    )) {
      this.setState({
        isSignedIn: false,
        accessToken: null,
        error: 'Required permissions not granted. Please allow all requested permissions.',
      });
      return;
    }

    this.accessToken = response.access_token;
    this.tokenExpiry = Date.now() + (response.expires_in * 1000);

    // Store token expiry
    localStorage.setItem(STORAGE_KEYS.tokenExpiry, this.tokenExpiry.toString());

    // Set token for GAPI client
    gapi.client.setToken({ access_token: response.access_token });

    // Schedule token refresh before expiry
    this.scheduleTokenRefresh(response.expires_in * 1000);

    this.setState({
      isSignedIn: true,
      accessToken: response.access_token,
      error: null,
    });
  }

  // Schedule automatic token refresh before expiry
  private scheduleTokenRefresh(expiresInMs: number): void {
    // Clear any existing timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    // Calculate when to refresh (5 minutes before expiry, but at least 1 minute from now)
    const refreshIn = Math.max(
      expiresInMs - GoogleAuthService.REFRESH_MARGIN_MS,
      60 * 1000 // Minimum 1 minute
    );

    this.refreshTimer = setTimeout(() => {
      this.refreshToken();
    }, refreshIn);
  }

  // Silently refresh the token
  private refreshToken(): void {
    if (!this.tokenClient) {
      return;
    }

    // Try silent refresh (no popup if user is still logged into Google)
    // This may fail if browser blocks popups - that's expected
    this.tokenClient.requestAccessToken({ prompt: '' });
  }

  // Handle token error
  private handleTokenError(error: google.accounts.oauth2.TokenError): void {
    // Silent refresh failures are expected - browsers block background popups
    // User will just need to click sign in again when token expires
    if (error.type === 'popup_failed_to_open' || error.type === 'popup_closed') {
      // Only log at debug level, not as an error
      console.debug('Silent token refresh not possible, user will need to re-authenticate');
      return;
    }

    console.error('Token error:', error);

    this.setState({
      isSignedIn: false,
      accessToken: null,
      error: error.message || 'Authentication failed',
    });
  }

  // Check for existing valid token on page load
  private async checkExistingToken(): Promise<void> {
    const storedExpiry = localStorage.getItem(STORAGE_KEYS.tokenExpiry);

    if (!storedExpiry) {
      return;
    }

    const expiry = parseInt(storedExpiry, 10);

    // Token expired
    if (Date.now() >= expiry) {
      localStorage.removeItem(STORAGE_KEYS.tokenExpiry);
      return;
    }

    // We have a non-expired token timestamp, but GIS doesn't persist tokens
    // User will need to re-authenticate, but we can prompt silently
    // This is a limitation of the token model
  }

  // Sign in - triggers OAuth popup
  signIn(): void {
    if (!this.tokenClient) {
      this.setState({ error: 'Auth not initialized' });
      return;
    }

    // Check if we might have a valid token (try silent first)
    const storedExpiry = localStorage.getItem(STORAGE_KEYS.tokenExpiry);
    if (storedExpiry && Date.now() < parseInt(storedExpiry, 10)) {
      // Try silent refresh
      this.tokenClient.requestAccessToken({ prompt: '' });
    } else {
      // Need user interaction
      this.tokenClient.requestAccessToken({ prompt: 'consent' });
    }
  }

  // Sign out
  signOut(): void {
    if (this.accessToken) {
      google.accounts.oauth2.revoke(this.accessToken, () => {
        console.log('Token revoked');
      });
    }

    this.accessToken = null;
    this.tokenExpiry = null;

    // Clear refresh timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    // Clear stored data
    localStorage.removeItem(STORAGE_KEYS.tokenExpiry);
    localStorage.removeItem(STORAGE_KEYS.spreadsheetId);

    // Clear GAPI token
    gapi.client.setToken(null);

    this.setState({
      isSignedIn: false,
      accessToken: null,
      error: null,
      userEmail: undefined,
    });
  }

  // Get current access token (refresh if needed)
  async getAccessToken(): Promise<string | null> {
    if (!this.accessToken) {
      return null;
    }

    // Check if token is about to expire (within 5 minutes)
    if (this.tokenExpiry && Date.now() >= this.tokenExpiry - 300000) {
      // Try silent refresh
      return new Promise((resolve) => {
        if (!this.tokenClient) {
          resolve(null);
          return;
        }

        const originalCallback = this.tokenClient.callback;
        this.tokenClient.callback = (response) => {
          this.handleTokenResponse(response);
          this.tokenClient!.callback = originalCallback;
          resolve(response.error ? null : response.access_token);
        };

        this.tokenClient.requestAccessToken({ prompt: '' });
      });
    }

    return this.accessToken;
  }

  // Check if signed in
  isSignedIn(): boolean {
    return this.state.isSignedIn;
  }

  // Get current state
  getState(): AuthState {
    return this.state;
  }

  // Mark session as expired (called when API returns 401)
  markSessionExpired(): void {
    if (!this.state.isSignedIn) return; // Already signed out

    this.accessToken = null;
    this.tokenExpiry = null;

    // Clear refresh timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    // Clear stored token expiry
    localStorage.removeItem(STORAGE_KEYS.tokenExpiry);

    // Clear GAPI token
    if (typeof gapi !== 'undefined' && gapi.client) {
      gapi.client.setToken(null);
    }

    this.setState({
      isSignedIn: false,
      accessToken: null,
      error: 'Session expired. Please sign in again.',
    });
  }
}

// Singleton instance
export const googleAuth = new GoogleAuthService();
