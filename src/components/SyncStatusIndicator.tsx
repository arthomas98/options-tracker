// Sync Status Indicator
// Shows current sync status in the header

import { useStorage } from '../contexts/StorageContext';
import { useAuth } from '../contexts/AuthContext';

export function SyncStatusIndicator() {
  const { isSignedIn, isConfigured } = useAuth();
  const { syncStatus, lastSyncTime, error, spreadsheetInfo } = useStorage();

  // Don't show anything if Google isn't configured
  if (!isConfigured) {
    return null;
  }

  // Not signed in
  if (!isSignedIn) {
    return null;
  }

  // No spreadsheet yet
  if (!spreadsheetInfo) {
    return null;
  }

  const getStatusIcon = () => {
    switch (syncStatus) {
      case 'syncing':
        return (
          <svg
            className="w-4 h-4 animate-spin text-blue-500"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        );
      case 'idle':
        return (
          <svg
            className="w-4 h-4 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        );
      case 'pending':
        return (
          <svg
            className="w-4 h-4 text-yellow-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        );
      case 'offline':
        return (
          <svg
            className="w-4 h-4 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 5.636a9 9 0 010 12.728m-3.536-3.536a5 5 0 010-7.072M9.172 14.828a5 5 0 010-7.072m-3.536 3.536a9 9 0 010 12.728"
            />
          </svg>
        );
      case 'error':
        return (
          <svg
            className="w-4 h-4 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        );
      case 'conflict':
        return (
          <svg
            className="w-4 h-4 text-orange-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
            />
          </svg>
        );
      default:
        return null;
    }
  };

  const getStatusText = () => {
    switch (syncStatus) {
      case 'syncing':
        return 'Syncing...';
      case 'idle':
        return lastSyncTime
          ? `Synced ${formatTimeAgo(lastSyncTime)}`
          : 'Synced';
      case 'pending':
        return 'Saving...';
      case 'offline':
        return 'Offline';
      case 'error':
        return 'Sync error';
      case 'conflict':
        return 'Conflict';
      default:
        return '';
    }
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      {getStatusIcon()}
      <span className="text-gray-400 hidden sm:inline">{getStatusText()}</span>
      {error && (
        <span
          className="text-red-400 text-xs max-w-[150px] truncate"
          title={error}
        >
          {error}
        </span>
      )}
    </div>
  );
}

// Helper function to format time ago
function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) {
    return 'just now';
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
