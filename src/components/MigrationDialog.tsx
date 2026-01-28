// Migration Dialog
// Prompts user to migrate localStorage data to Google Sheets

import { useState } from 'react';
import { useStorage } from '../contexts/StorageContext';
import { getMigrationPreview } from '../services/migration';

interface MigrationDialogProps {
  onClose: () => void;
}

export function MigrationDialog({ onClose }: MigrationDialogProps) {
  const { appData, migrateToCloud, skipMigration } = useStorage();
  const [isMigrating, setIsMigrating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = appData ? getMigrationPreview(appData) : null;

  const handleMigrate = async () => {
    setIsMigrating(true);
    setError(null);

    try {
      await migrateToCloud();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Migration failed');
    } finally {
      setIsMigrating(false);
    }
  };

  const handleSkip = () => {
    skipMigration();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-md w-full p-6 shadow-xl">
        <h2 className="text-xl font-semibold text-white mb-4">
          Sync to Google Sheets?
        </h2>

        <p className="text-gray-300 mb-4">
          You have existing data that can be synced to Google Sheets for cloud
          backup and multi-device access.
        </p>

        {preview && (
          <div className="bg-gray-700 rounded-lg p-4 mb-4">
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              Data to sync:
            </h3>
            <ul className="text-sm text-gray-400 space-y-1">
              <li>
                <span className="text-white font-medium">{preview.services}</span>{' '}
                {preview.services === 1 ? 'service' : 'services'}
              </li>
              <li>
                <span className="text-white font-medium">{preview.positions}</span>{' '}
                {preview.positions === 1 ? 'position' : 'positions'}
              </li>
              <li>
                <span className="text-white font-medium">{preview.trades}</span>{' '}
                {preview.trades === 1 ? 'trade' : 'trades'}
              </li>
            </ul>
          </div>
        )}

        <p className="text-sm text-gray-400 mb-6">
          A new spreadsheet called "Options Tracker Data" will be created in
          your Google Drive. Your data will be synced automatically.
        </p>

        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 mb-4">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleSkip}
            disabled={isMigrating}
            className="flex-1 px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            Not Now
          </button>
          <button
            onClick={handleMigrate}
            disabled={isMigrating}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isMigrating ? (
              <>
                <svg
                  className="w-4 h-4 animate-spin"
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
                Syncing...
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                Sync to Cloud
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
