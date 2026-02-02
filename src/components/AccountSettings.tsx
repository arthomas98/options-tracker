// Account Settings Panel
// Shows Google account status and sync settings

import { useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useStorage } from '../contexts/StorageContext';
import { useSchwab } from '../contexts/SchwabContext';
import { isConfigured as isSchwabConfigured } from '../services/schwabApi';
import { loadAppData, saveAppData, rebuildTradeHistoryFromTrades } from '../utils/storage';

interface AccountSettingsProps {
  onClose: () => void;
}

export function AccountSettings({ onClose }: AccountSettingsProps) {
  const { isSignedIn, isConfigured, signIn, signOut, isLoading: authLoading } = useAuth();
  const {
    syncStatus,
    lastSyncTime,
    spreadsheetInfo,
    forceSync,
    enableCloudSync,
    refreshFromCloud,
    updateAppData,
  } = useStorage();

  const {
    isEnabled: schwabEnabled,
    isSignedIn: schwabSignedIn,
    isLoading: schwabLoading,
    authError: schwabAuthError,
    accounts: schwabAccounts,
    enable: enableSchwab,
    disable: disableSchwab,
    signIn: schwabSignIn,
    signOut: schwabSignOut,
    updateAccountNickname,
  } = useSchwab();

  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [nicknameInput, setNicknameInput] = useState('');

  const [isActionPending, setIsActionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSignIn = () => {
    setError(null);
    signIn();
  };

  const handleSignOut = () => {
    setError(null);
    signOut();
  };

  const handleEnableSync = async () => {
    setIsActionPending(true);
    setError(null);
    setSuccess(null);

    try {
      await enableCloudSync();
      setSuccess('Cloud sync enabled! Your data will now sync to Google Sheets.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable sync');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleForceSync = async () => {
    setIsActionPending(true);
    setError(null);
    setSuccess(null);

    try {
      await forceSync();
      setSuccess('Data synced successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleRefresh = async () => {
    setIsActionPending(true);
    setError(null);
    setSuccess(null);

    try {
      await refreshFromCloud();
      setSuccess('Data refreshed from cloud!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setIsActionPending(false);
    }
  };

  // Export data as JSON file
  const handleExport = () => {
    setError(null);
    setSuccess(null);

    try {
      const data = localStorage.getItem('options-tracker-data');
      if (!data) {
        setError('No data to export');
        return;
      }

      // Create blob and download
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `options-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess('Data exported successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  // Trigger file picker for import
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  // Handle file selection for import
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setSuccess(null);

    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Basic validation
      if (!data.services || !Array.isArray(data.services)) {
        throw new Error('Invalid backup file format');
      }

      // Confirm before overwriting
      const serviceCount = data.services.length;
      let positionCount = 0;
      let tradeCount = 0;
      for (const service of data.services) {
        positionCount += service.portfolio?.positions?.length || 0;
        for (const pos of service.portfolio?.positions || []) {
          tradeCount += pos.trades?.length || 0;
        }
      }

      const confirmed = confirm(
        `Import ${serviceCount} services, ${positionCount} positions, and ${tradeCount} trades?\n\nThis will replace all current data.`
      );

      if (!confirmed) {
        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      // Save to localStorage and update app state
      saveAppData(data);
      const rehydrated = loadAppData();
      updateAppData(rehydrated);

      setSuccess(`Imported ${serviceCount} services, ${positionCount} positions, ${tradeCount} trades`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed - invalid file');
    }

    // Reset file input for future imports
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-4xl w-full shadow-xl max-h-[90vh] flex flex-col">
        {/* Sticky Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-700 sticky top-0 bg-gray-800 rounded-t-lg">
          <h2 className="text-xl font-semibold text-white">Account Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto">
          {/* Google Configuration Warning */}
          {!isConfigured && (
            <div className="bg-yellow-900/50 border border-yellow-700 rounded-lg p-4 mb-4">
              <p className="text-sm text-yellow-300">
                Google OAuth is not configured. Set VITE_GOOGLE_CLIENT_ID in your environment to enable cloud sync.
              </p>
            </div>
          )}

          {/* Status Messages */}
          {error && (
            <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {success && (
            <div className="bg-green-900/50 border border-green-700 rounded-lg p-3 mb-4">
              <p className="text-sm text-green-300">{success}</p>
            </div>
          )}

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Column */}
            <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">Google Account</h3>

            {authLoading ? (
              <div className="flex items-center gap-2 text-gray-400">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading...
              </div>
            ) : isSignedIn ? (
              <div className="flex items-center justify-between bg-gray-700 rounded-lg p-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white text-sm">Signed in</p>
                    <p className="text-gray-400 text-xs">with Google</p>
                  </div>
                </div>
                <button
                  onClick={handleSignOut}
                  className="px-3 py-1.5 text-sm text-gray-300 hover:text-white hover:bg-gray-600 rounded transition-colors"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={handleSignIn}
                disabled={!isConfigured}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-gray-800 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Sign in with Google
              </button>
            )}
          </div>

          {/* Sync Section (only show when signed in) */}
          {isSignedIn && (
            <>
              <hr className="border-gray-700" />

              <div>
                <h3 className="text-sm font-medium text-gray-300 mb-2">Cloud Sync</h3>

                {spreadsheetInfo ? (
                  <div className="space-y-3">
                    <div className="bg-gray-700 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-white text-sm">Sync Enabled</span>
                      </div>
                      <p className="text-xs text-gray-400">
                        Spreadsheet: {spreadsheetInfo.title}
                      </p>
                      {lastSyncTime && (
                        <p className="text-xs text-gray-400">
                          Last sync: {lastSyncTime.toLocaleString()}
                        </p>
                      )}
                      <p className="text-xs text-gray-400">
                        Status: {syncStatus}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={handleForceSync}
                        disabled={isActionPending || syncStatus === 'syncing'}
                        className="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                      >
                        {syncStatus === 'syncing' ? 'Syncing...' : 'Sync Now'}
                      </button>
                      <button
                        onClick={handleRefresh}
                        disabled={isActionPending}
                        className="flex-1 px-3 py-2 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-500 transition-colors disabled:opacity-50"
                      >
                        Refresh from Cloud
                      </button>
                    </div>

                    <a
                      href={spreadsheetInfo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center text-sm text-blue-400 hover:text-blue-300"
                    >
                      Open Spreadsheet in Google Sheets →
                    </a>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-400">
                      Cloud sync is not enabled. Enable it to back up your data to Google Sheets and sync across devices.
                    </p>
                    <button
                      onClick={handleEnableSync}
                      disabled={isActionPending}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {isActionPending ? 'Enabling...' : 'Enable Cloud Sync'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Local Data Section */}
          <hr className="border-gray-700" />

          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">Local Data</h3>
            <p className="text-xs text-gray-400 mb-3">
              Export your data as a backup file, or import from a previous backup.
            </p>

            <div className="flex gap-2">
              <button
                onClick={handleExport}
                className="flex-1 px-3 py-2 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-500 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export
              </button>
              <button
                onClick={handleImportClick}
                className="flex-1 px-3 py-2 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-500 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          </div>
            </div>

            {/* Right Column */}
            <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">Trade History</h3>
            <p className="text-xs text-gray-400 mb-3">
              Rebuild trade string history from existing trades. Use this once to populate history from trades entered before this feature existed.
            </p>
            <button
              onClick={() => {
                const data = loadAppData();
                const tradeCount = data.services.reduce(
                  (sum, s) => sum + s.portfolio.positions.reduce(
                    (psum, p) => psum + p.trades.length, 0
                  ), 0
                );
                const confirmed = confirm(
                  `Rebuild trade history from ${tradeCount} existing trades?\n\nThis will replace any current trade history.`
                );
                if (confirmed) {
                  const updated = rebuildTradeHistoryFromTrades(data);
                  saveAppData(updated);
                  updateAppData(updated);
                  setSuccess(`Trade history rebuilt from ${updated.tradeHistory?.length || 0} trades`);
                }
              }}
              className="w-full px-3 py-2 text-sm bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
            >
              Rebuild Trade History
            </button>
          </div>

          {/* Schwab Integration Section */}
          <div className="pt-4 border-t border-gray-700">
            <h3 className="text-sm font-medium text-gray-300 mb-2">Schwab Integration</h3>
            <p className="text-xs text-gray-400 mb-3">
              Connect to Schwab to automatically fetch Net Liquidation values for your positions.
            </p>

            {/* Schwab Configuration Warning */}
            {!isSchwabConfigured() && (
              <div className="bg-yellow-900/50 border border-yellow-700 rounded-lg p-3 mb-3">
                <p className="text-sm text-yellow-300">
                  Schwab API is not configured. Set VITE_SCHWAB_CLIENT_ID in your environment to enable Schwab integration.
                </p>
              </div>
            )}

            {/* Schwab Auth Error */}
            {schwabAuthError && (
              <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 mb-3">
                <p className="text-sm text-red-300">{schwabAuthError}</p>
              </div>
            )}

            {!schwabEnabled ? (
              <button
                onClick={() => {
                  enableSchwab();
                  setSuccess('Schwab integration enabled. Sign in to connect your accounts.');
                }}
                className="w-full px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Enable Schwab Integration
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-gray-700 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-white text-sm">Schwab Enabled</span>
                  </div>
                  <button
                    onClick={() => {
                      disableSchwab();
                      setSuccess('Schwab integration disabled.');
                    }}
                    className="px-3 py-1.5 text-sm text-gray-300 hover:text-white hover:bg-gray-600 rounded transition-colors"
                  >
                    Disable
                  </button>
                </div>

                {schwabLoading ? (
                  <div className="flex items-center gap-2 text-gray-400">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Loading...
                  </div>
                ) : schwabSignedIn ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-300">Connected Accounts:</span>
                      <button
                        onClick={() => {
                          schwabSignOut();
                          setSuccess('Signed out of Schwab.');
                        }}
                        className="text-xs text-gray-400 hover:text-white"
                      >
                        Sign Out
                      </button>
                    </div>
                    <div className="bg-gray-700 rounded-lg p-2 space-y-2">
                      {schwabAccounts.map((account) => (
                        <div key={account.accountId} className="flex items-center justify-between text-sm">
                          {editingAccountId === account.accountId ? (
                            <div className="flex items-center gap-2 flex-1">
                              <input
                                type="text"
                                value={nicknameInput}
                                onChange={(e) => setNicknameInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    updateAccountNickname(account.accountId, nicknameInput);
                                    setEditingAccountId(null);
                                  } else if (e.key === 'Escape') {
                                    setEditingAccountId(null);
                                  }
                                }}
                                placeholder={account.displayName}
                                className="flex-1 px-2 py-1 text-sm bg-gray-600 text-white border border-gray-500 rounded focus:outline-none focus:border-blue-500"
                                autoFocus
                              />
                              <button
                                onClick={() => {
                                  updateAccountNickname(account.accountId, nicknameInput);
                                  setEditingAccountId(null);
                                }}
                                className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingAccountId(null)}
                                className="px-2 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-500"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <>
                              <span
                                className="text-white cursor-pointer hover:text-blue-400"
                                onClick={() => {
                                  setEditingAccountId(account.accountId);
                                  setNicknameInput(account.nickname || '');
                                }}
                                title="Click to edit nickname"
                              >
                                {account.nickname || account.displayName}
                              </span>
                              <span className="text-gray-400 text-xs">{account.accountNumber}</span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500">
                      Click an account name to set a custom nickname.
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={async () => {
                      setError(null);
                      await schwabSignIn();
                      // Note: signIn() redirects to Schwab, so the success message won't show
                      // The callback handler will complete the flow
                    }}
                    disabled={isActionPending || schwabLoading || !isSchwabConfigured()}
                    className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Sign in to Schwab
                  </button>
                )}

                <p className="text-xs text-gray-500">
                  Schwab integration uses OAuth to securely connect to your accounts. Your credentials are never stored by this app.
                </p>
              </div>
            )}
          </div>

          {/* Info Section */}
          <div className="text-xs text-gray-500 pt-4 border-t border-gray-700">
            <p className="mb-1">
              Your data is always stored locally in your browser. Cloud sync is optional and creates a backup in your Google Drive.
            </p>
            <p>
              Data remains private - only you can access it with your Google account.
            </p>
          </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
