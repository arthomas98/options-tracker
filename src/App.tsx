import { useState, useEffect, useCallback, useRef } from 'react';
import { parseThinkorswimTrade, formatCurrency, formatDate, getDaysToExpiration } from './utils/tradeParser';
import {
  createService,
  updateService,
  deleteService,
  renameService,
  updateAppTitle,
  addTradeToPosition,
  closePosition,
  reopenPosition,
  deletePosition,
  deleteTrade,
  updatePositionMark,
  updatePositionDates,
  updatePositionTaxable,
  updatePositionSchwabAccount,
  updatePositionAutoMarkToMarket,
  addTradeHistoryEntry,
  getTradeHistoryForService,
  movePosition,
} from './utils/storage';
import {
  getPositionSummary,
  getPortfolioSummary,
  getServiceSummary,
  getTotalSummary,
  calculateTradePnL,
  getClosedPnLByPeriod,
  getMarkInfo,
  calculateTotalEffectiveValue,
  calculateTotalCurrentPnL,
  calculateClosedPositionStats,
  calculateClosedPnLByTaxStatus,
  calculateCurrentPnLByTaxStatus,
  type TimePeriod,
} from './utils/calculations';
import { useStorage } from './contexts/StorageContext';
import { useAuth } from './contexts/AuthContext';
import { useSchwab } from './contexts/SchwabContext';
import { SyncStatusIndicator } from './components/SyncStatusIndicator';
import { MigrationDialog } from './components/MigrationDialog';
import { AccountSettings } from './components/AccountSettings';
import { PnLChart } from './components/PnLChart';
import type { AppData, Service, Portfolio, Position, ClosedPnLByPeriod, TradeStringEntry } from './types/trade';

type ViewMode = 'open' | 'closed';
type Page = 'summary' | 'service';
type ClosedPnLPeriod = 'all' | 'last30' | 'currentYear' | 'previousYear';

const PERIOD_LABELS: Record<ClosedPnLPeriod, string> = {
  all: 'All Time',
  last30: 'Last 30 Days',
  currentYear: new Date().getFullYear().toString(),
  previousYear: (new Date().getFullYear() - 1).toString(),
};

interface ClosedPnLDisplayProps {
  closedPnL: ClosedPnLByPeriod;
  selectedPeriod: ClosedPnLPeriod;
  onPeriodChange: (period: ClosedPnLPeriod) => void;
  compact?: boolean;
}

interface EditableTextProps {
  value: string;
  onSave: (newValue: string) => void;
  className?: string;
  placeholder?: string;
}

function EditableText({ value, onSave, className = '', placeholder = 'Click to edit' }: EditableTextProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(value);
    setIsEditing(true);
  };

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditValue(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={`${className} bg-white border-2 border-blue-500 rounded px-2 py-1 focus:outline-none`}
        autoFocus
      />
    );
  }

  return (
    <span
      onClick={handleStartEdit}
      className={`${className} cursor-pointer hover:bg-gray-100 rounded px-1 -mx-1`}
      title="Click to edit"
    >
      {value || placeholder}
    </span>
  );
}

function ClosedPnLDisplay({ closedPnL, selectedPeriod, onPeriodChange, compact = false }: ClosedPnLDisplayProps) {
  const value = closedPnL[selectedPeriod];

  if (compact) {
    return (
      <div className="text-right">
        <div className={`text-xs font-semibold ${value >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {formatCurrency(value)}
        </div>
        <select
          value={selectedPeriod}
          onChange={(e) => onPeriodChange(e.target.value as ClosedPnLPeriod)}
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-gray-500 bg-transparent border-none cursor-pointer hover:text-gray-700 focus:outline-none text-right"
        >
          {Object.entries(PERIOD_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className={`text-lg font-bold ${value >= 0 ? 'text-green-600' : 'text-red-600'}`}>
        {formatCurrency(value)}
      </div>
      <div className="flex items-center justify-center gap-1">
        <span className="text-xs text-gray-500">Closed P&L</span>
        <select
          value={selectedPeriod}
          onChange={(e) => onPeriodChange(e.target.value as ClosedPnLPeriod)}
          className="text-xs text-gray-500 bg-transparent border-none cursor-pointer hover:text-gray-700 focus:outline-none"
        >
          {Object.entries(PERIOD_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function App() {
  const { appData: storedAppData, updateAppData, updateAppDataImmediate, isLoading, hasPendingMigration } = useStorage();
  const { isSignedIn, isConfigured, signIn, isLoading: authLoading } = useAuth();

  const [currentPage, setCurrentPage] = useState<Page>('summary');
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showMigration, setShowMigration] = useState(false);

  // Use stored data or default
  const appData = storedAppData || { services: [] };

  // Keep a ref to latest appData for stable callbacks
  const appDataRef = useRef(appData);
  appDataRef.current = appData;

  // Show migration dialog when needed
  useEffect(() => {
    if (hasPendingMigration && isSignedIn) {
      setShowMigration(true);
    }
  }, [hasPendingMigration, isSignedIn]);

  // Stable setAppData that doesn't change when appData changes
  const setAppData = useCallback((newData: AppData | ((prev: AppData) => AppData)) => {
    if (typeof newData === 'function') {
      updateAppData(newData(appDataRef.current));
    } else {
      updateAppData(newData);
    }
  }, [updateAppData]);

  // Immediate sync version for critical operations (trade entry)
  const setAppDataImmediate = useCallback(async (newData: AppData | ((prev: AppData) => AppData)) => {
    const data = typeof newData === 'function' ? newData(appDataRef.current) : newData;
    await updateAppDataImmediate(data);
  }, [updateAppDataImmediate]);

  const handleSelectService = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setCurrentPage('service');
  };

  const handleBackToSummary = () => {
    setCurrentPage('summary');
    setSelectedServiceId(null);
  };

  const handleCreateService = (name: string) => {
    setAppData((prev) => createService(prev, name));
  };

  const handleDeleteService = (serviceId: string) => {
    if (confirm('Are you sure you want to delete this service and all its positions?')) {
      setAppData((prev) => deleteService(prev, serviceId));
    }
  };

  const handleRenameService = useCallback((serviceId: string, newName: string) => {
    setAppData((prev) => renameService(prev, serviceId, newName));
  }, [setAppData]);

  const handleUpdateAppTitle = useCallback((title: string) => {
    setAppData((prev) => updateAppTitle(prev, title));
  }, [setAppData]);

  const handleUpdatePortfolio = useCallback((serviceId: string, portfolio: Portfolio) => {
    setAppData((prev) => updateService(prev, serviceId, portfolio));
  }, [setAppData]);

  // Immediate sync version for critical operations
  const handleUpdatePortfolioImmediate = useCallback(async (serviceId: string, portfolio: Portfolio) => {
    await setAppDataImmediate((prev) => updateService(prev, serviceId, portfolio));
  }, [setAppDataImmediate]);

  const selectedService = appData.services.find((s) => s.id === selectedServiceId);

  const handleUpdateSelectedServicePortfolio = useCallback((portfolio: Portfolio) => {
    if (selectedServiceId) {
      handleUpdatePortfolio(selectedServiceId, portfolio);
    }
  }, [selectedServiceId, handleUpdatePortfolio]);

  const handleUpdateSelectedServicePortfolioImmediate = useCallback(async (portfolio: Portfolio) => {
    if (selectedServiceId) {
      await handleUpdatePortfolioImmediate(selectedServiceId, portfolio);
    }
  }, [selectedServiceId, handleUpdatePortfolioImmediate]);

  const handleRenameSelectedService = useCallback((newName: string) => {
    if (selectedServiceId) {
      handleRenameService(selectedServiceId, newName);
    }
  }, [selectedServiceId, handleRenameService]);

  // Sync Schwab account nicknames with appData (persisted to Google Sheet)
  const { accountNicknames, loadNicknamesFromExternal, accounts: schwabAccounts } = useSchwab();

  // Load nicknames from appData when it becomes available
  useEffect(() => {
    if (appData.schwabAccountNicknames) {
      loadNicknamesFromExternal(appData.schwabAccountNicknames);
    }
  }, [appData.schwabAccountNicknames, loadNicknamesFromExternal]);

  // Save nicknames to appData when they change
  useEffect(() => {
    // Only save if we have accounts and there are nicknames to save
    if (schwabAccounts.length > 0 && Object.keys(accountNicknames).length > 0) {
      // Check if nicknames have changed
      const existingNicknames = appData.schwabAccountNicknames || {};
      const hasChanges = JSON.stringify(existingNicknames) !== JSON.stringify(accountNicknames);
      if (hasChanges) {
        setAppData((prev) => ({ ...prev, schwabAccountNicknames: accountNicknames }));
      }
    }
  }, [accountNicknames, schwabAccounts.length]);

  // One-time migration: enable autoMarkToMarket for positions that have a Schwab account linked
  // Uses localStorage flag to only run once ever
  useEffect(() => {
    const migrationKey = 'autoMarkToMarket-migration-v4'; // v4: re-run after security deploys
    if (localStorage.getItem(migrationKey)) return; // Already ran
    if (appData.services.length === 0) return; // Wait for data to load

    let hasChanges = false;
    const updatedServices = appData.services.map(service => {
      const updatedPositions = service.portfolio.positions.map(pos => {
        // If position is open and has Schwab account linked, enable auto-update
        if (pos.isOpen && pos.schwabAccountId && !pos.autoMarkToMarket) {
          hasChanges = true;
          return { ...pos, autoMarkToMarket: true };
        }
        return pos;
      });
      if (updatedPositions !== service.portfolio.positions) {
        return { ...service, portfolio: { ...service.portfolio, positions: updatedPositions } };
      }
      return service;
    });

    if (hasChanges) {
      // Use immediate sync to ensure migration data is saved to cloud right away
      console.log('[MIGRATION] Running autoMarkToMarket migration v3...');
      const updatedData = { ...appData, services: updatedServices };
      (async () => {
        await setAppDataImmediate(updatedData);
        console.log('[MIGRATION] Migration v3 completed and synced');
        localStorage.setItem(migrationKey, 'true');
      })();
    } else {
      // No changes needed, just mark as complete
      localStorage.setItem(migrationKey, 'true');
    }
  }, [appData.services, setAppDataImmediate]); // Re-run when services load

  // Loading state
  if (isLoading || authLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Header component with auth and sync controls
  const Header = (
    <div className="bg-white border-b mb-6">
      <div className="max-w-4xl mx-auto px-6 py-3 flex justify-between items-center">
        <SyncStatusIndicator />
        <div className="flex items-center gap-3">
          <SchwabRefreshButton />
          <a
            href="/help.html"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Help
          </a>
          {isConfigured && !isSignedIn && (
            <button
              onClick={signIn}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Sign in
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Settings"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );

  if (currentPage === 'service' && selectedService) {
    return (
      <>
        {Header}
        <ServiceDetailPage
          service={selectedService}
          appData={appData}
          onBack={handleBackToSummary}
          onUpdatePortfolio={handleUpdateSelectedServicePortfolio}
          onUpdatePortfolioImmediate={handleUpdateSelectedServicePortfolioImmediate}
          onRenameService={handleRenameSelectedService}
          onUpdateAppData={setAppData}
        />
        {showSettings && <AccountSettings onClose={() => setShowSettings(false)} />}
        {showMigration && <MigrationDialog onClose={() => setShowMigration(false)} />}
      </>
    );
  }

  return (
    <>
      {Header}
      <SummaryPage
        appData={appData}
        onSelectService={handleSelectService}
        onCreateService={handleCreateService}
        onDeleteService={handleDeleteService}
        onRenameService={handleRenameService}
        onUpdateAppTitle={handleUpdateAppTitle}
      />
      {showSettings && <AccountSettings onClose={() => setShowSettings(false)} />}
      {showMigration && <MigrationDialog onClose={() => setShowMigration(false)} />}
    </>
  );
}

// ============== SUMMARY PAGE ==============

interface SummaryPageProps {
  appData: AppData;
  onSelectService: (serviceId: string) => void;
  onCreateService: (name: string) => void;
  onDeleteService: (serviceId: string) => void;
  onRenameService: (serviceId: string, newName: string) => void;
  onUpdateAppTitle: (title: string) => void;
}

function SummaryPage({ appData, onSelectService, onCreateService, onDeleteService, onRenameService, onUpdateAppTitle }: SummaryPageProps) {
  const [newServiceName, setNewServiceName] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [closedPnLPeriod, setClosedPnLPeriod] = useState<ClosedPnLPeriod>('all');
  const [showPnLChart, setShowPnLChart] = useState(false);

  const totalSummary = getTotalSummary(appData.services);
  const allPositions = appData.services.flatMap((s) => s.portfolio.positions);
  const totalClosedPnL = getClosedPnLByPeriod(allPositions);
  const totalEffectiveValue = calculateTotalEffectiveValue(allPositions);
  const totalCurrentPnL = calculateTotalCurrentPnL(allPositions);
  const currentPnLByTax = calculateCurrentPnLByTaxStatus(allPositions);
  const closedPnLByTax = calculateClosedPnLByTaxStatus(allPositions, closedPnLPeriod as TimePeriod);

  const handleAddService = () => {
    if (newServiceName.trim()) {
      onCreateService(newServiceName.trim());
      setNewServiceName('');
      setShowAddForm(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-baseline gap-3 mb-6">
          <h1 className="text-3xl font-bold text-gray-900">
            <EditableText
              value={appData.appTitle || 'Options Trade Tracker'}
              onSave={onUpdateAppTitle}
            />
          </h1>
          <span className="text-sm text-gray-400">v{__APP_VERSION__}</span>
        </div>

        {/* Total Summary */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <h2 className="text-base font-semibold mb-3 text-gray-700">Total Portfolio</h2>
          <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
            <div className="text-center">
              <div className="text-lg font-bold text-gray-700">{totalSummary.totalPositionCount}</div>
              <div className="text-xs text-gray-500">Total Positions</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-blue-600">{totalSummary.activePositionCount}</div>
              <div className="text-xs text-gray-500">Open Positions</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-gray-700">{totalSummary.totalTradeCount}</div>
              <div className="text-xs text-gray-500">Total Trades</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${totalSummary.openPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(totalSummary.openPnL)}
              </div>
              <div className="text-xs text-gray-500">Open Cost</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${totalEffectiveValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(totalEffectiveValue)}
              </div>
              <div className="text-xs text-gray-500">Open Value</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${totalCurrentPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(totalCurrentPnL)}
              </div>
              <div className="text-xs text-gray-500">Open P&L</div>
            </div>
            <ClosedPnLDisplay
              closedPnL={totalClosedPnL}
              selectedPeriod={closedPnLPeriod}
              onPeriodChange={setClosedPnLPeriod}
            />
          </div>

          {/* Taxable Breakdown */}
          <div className="mt-3 pt-3 border-t border-gray-200">
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <div className="text-gray-500 mb-1">Current P&L Breakdown</div>
                <div className="flex gap-4">
                  <div>
                    <span className="text-gray-500">Taxable: </span>
                    <span className={`font-semibold ${currentPnLByTax.taxable >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(currentPnLByTax.taxable)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Non-taxable: </span>
                    <span className={`font-semibold ${currentPnLByTax.nonTaxable >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(currentPnLByTax.nonTaxable)}
                    </span>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-gray-500 mb-1">Closed P&L Breakdown ({closedPnLPeriod === 'all' ? 'All Time' : closedPnLPeriod === 'last30' ? 'Last 30 Days' : closedPnLPeriod === 'currentYear' ? 'Current Year' : 'Previous Year'})</div>
                <div className="flex gap-4">
                  <div>
                    <span className="text-gray-500">Taxable: </span>
                    <span className={`font-semibold ${closedPnLByTax.taxable >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(closedPnLByTax.taxable)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Non-taxable: </span>
                    <span className={`font-semibold ${closedPnLByTax.nonTaxable >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(closedPnLByTax.nonTaxable)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* P&L Chart - Collapsible */}
        <div className="mb-4">
          <button
            onClick={() => setShowPnLChart(!showPnLChart)}
            className="w-full flex items-center justify-between px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <span className="text-sm font-medium text-gray-700">Closed P&L Chart</span>
            <span className="text-gray-500">{showPnLChart ? '▼' : '▶'}</span>
          </button>
          {showPnLChart && (
            <div className="mt-2">
              <PnLChart positions={allPositions} />
            </div>
          )}
        </div>

        {/* Services Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800">Services</h2>
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Add Service
            </button>
          )}
        </div>

        {/* Add Service Form */}
        {showAddForm && (
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <div className="flex gap-3">
              <input
                type="text"
                value={newServiceName}
                onChange={(e) => setNewServiceName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddService()}
                placeholder="Service name (e.g., 'Alpha Picks', 'Options Profit')"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <button
                onClick={handleAddService}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Create
              </button>
              <button
                onClick={() => { setShowAddForm(false); setNewServiceName(''); }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Service Cards - 2-column grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {appData.services.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500 md:col-span-2">
              No services yet. Click "Add Service" to create one.
            </div>
          ) : (
            appData.services.map((service) => {
              const summary = getServiceSummary(service);
              const serviceClosedPnL = getClosedPnLByPeriod(service.portfolio.positions);
              const effectiveValue = calculateTotalEffectiveValue(service.portfolio.positions);
              const currentPnL = calculateTotalCurrentPnL(service.portfolio.positions);
              const hasExpiredOpenPosition = service.portfolio.positions.some(
                pos => pos.isOpen && getPositionSummary(pos).daysToExpiration < 0
              );
              return (
                <div
                  key={service.id}
                  className={`rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer ${hasExpiredOpenPosition ? 'bg-red-50' : 'bg-white'}`}
                  onClick={() => onSelectService(service.id)}
                >
                  <div className="p-2">
                    {/* Title row with fixed height */}
                    <div className="flex justify-between items-start mb-2 min-h-[40px]">
                      <div className="flex-1 min-w-0 pr-2">
                        <h3 className="text-base font-bold text-gray-800 flex items-center gap-1">
                          <span className="truncate">
                            <EditableText
                              value={service.name}
                              onSave={(newName) => onRenameService(service.id, newName)}
                            />
                          </span>
                          <span className="text-gray-400 flex-shrink-0">▼</span>
                        </h3>
                        <p className="text-xs text-gray-500">
                          {summary.totalPositionCount} positions ({summary.activePositionCount} open) · {summary.totalTradeCount} trades
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteService(service.id); }}
                          className="text-gray-400 hover:text-red-600 p-1"
                          title="Delete service"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                    {/* Stats row - always aligned */}
                    <div className="flex items-center justify-between text-xs border-t pt-2">
                      <div className="text-center flex-1">
                        <div className={`font-semibold ${summary.openPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(summary.openPnL)}
                        </div>
                        <div className="text-gray-500">Open Cost</div>
                      </div>
                      <div className="text-center flex-1">
                        <div className={`font-semibold ${effectiveValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(effectiveValue)}
                        </div>
                        <div className="text-gray-500">Open Value</div>
                      </div>
                      <div className="text-center flex-1">
                        <div className={`font-semibold ${currentPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(currentPnL)}
                        </div>
                        <div className="text-gray-500">Open P&L</div>
                      </div>
                      <div className="flex-1">
                        <ClosedPnLDisplay
                          closedPnL={serviceClosedPnL}
                          selectedPeriod={closedPnLPeriod}
                          onPeriodChange={setClosedPnLPeriod}
                          compact
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ============== SCHWAB REFRESH BUTTON ==============

function SchwabRefreshButton() {
  const { isEnabled, isSignedIn, isRefreshing, lastRefresh, refreshAllPositions } = useSchwab();

  if (!isEnabled || !isSignedIn) {
    return null;
  }

  const formatLastRefresh = () => {
    if (!lastRefresh) return 'Never';
    const mins = Math.floor((Date.now() - lastRefresh.getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins === 1) return '1 min ago';
    return `${mins} min ago`;
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => refreshAllPositions()}
        disabled={isRefreshing}
        className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors disabled:opacity-50 flex items-center gap-1"
      >
        {isRefreshing ? (
          <>
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Refreshing...
          </>
        ) : (
          'Refresh from Schwab'
        )}
      </button>
      <span className="text-xs text-gray-400">
        {formatLastRefresh()}
      </span>
    </div>
  );
}

// ============== SERVICE DETAIL PAGE ==============

interface ServiceDetailPageProps {
  service: Service;
  appData: AppData;
  onBack: () => void;
  onUpdatePortfolio: (portfolio: Portfolio) => void;
  onUpdatePortfolioImmediate: (portfolio: Portfolio) => Promise<void>;
  onRenameService: (newName: string) => void;
  onUpdateAppData: (appData: AppData) => void;
}

function ServiceDetailPage({ service, appData, onBack, onUpdatePortfolio, onUpdatePortfolioImmediate, onRenameService, onUpdateAppData }: ServiceDetailPageProps) {
  const [portfolio, setPortfolio] = useState<Portfolio>(service.portfolio);
  const [tradeInput, setTradeInput] = useState('');
  const [positionIdInput, setPositionIdInput] = useState('');
  const [tradeDateInput, setTradeDateInput] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('open');
  const [expandedPositions, setExpandedPositions] = useState<Set<number>>(new Set());
  const [closedPnLPeriod, setClosedPnLPeriod] = useState<ClosedPnLPeriod>('all');
  const [showClosedStats, setShowClosedStats] = useState(false);
  const [showTradeHistory, setShowTradeHistory] = useState(false);
  const [showTradeHelp, setShowTradeHelp] = useState(false);
  const [showPnLChart, setShowPnLChart] = useState(false);

  // Sync portfolio changes back to parent
  useEffect(() => {
    onUpdatePortfolio(portfolio);
  }, [portfolio, onUpdatePortfolio]);

  // Schwab context for auto-update
  const { lastRefresh: schwabLastRefresh, getNetLiqForPosition, isEnabled: schwabEnabled, isSignedIn: schwabSignedIn } = useSchwab();

  // Auto-update marks when Schwab refreshes
  useEffect(() => {
    if (!schwabLastRefresh || !schwabEnabled || !schwabSignedIn) return;

    // Find positions with autoMarkToMarket enabled
    const positionsToUpdate = portfolio.positions.filter(
      (pos) => pos.isOpen && pos.autoMarkToMarket && pos.schwabAccountId
    );

    if (positionsToUpdate.length === 0) return;

    // Update marks for each position
    let updatedPortfolio = portfolio;
    for (const position of positionsToUpdate) {
      const schwabResult = getNetLiqForPosition(position);
      if (schwabResult && schwabResult.netLiq !== null) {
        updatedPortfolio = updatePositionMark(updatedPortfolio, position.id, schwabResult.netLiq, 'schwab');
      }
    }

    // Only update if something changed
    if (updatedPortfolio !== portfolio) {
      setPortfolio(updatedPortfolio);
    }
  }, [schwabLastRefresh]); // Only re-run when lastRefresh changes

  const handleAddTrade = async () => {
    if (!tradeInput.trim()) return;

    try {
      const trade = parseThinkorswimTrade(tradeInput);
      if (!trade) {
        setParseError('Could not parse trade. Please check the format.');
        return;
      }

      // Override trade date if specified
      if (tradeDateInput.trim()) {
        const parsedDate = new Date(tradeDateInput);
        if (!isNaN(parsedDate.getTime())) {
          trade.tradeDate = parsedDate;
        }
      }

      const positionId = positionIdInput.trim()
        ? parseInt(positionIdInput, 10)
        : portfolio.nextPositionId;

      if (isNaN(positionId) || positionId < 1) {
        setParseError('Invalid position number. Please enter a positive number.');
        return;
      }

      const updatedPortfolio = addTradeToPosition(portfolio, trade, positionId);
      setPortfolio(updatedPortfolio);

      // Save to trade history (successful parse)
      const updatedAppData = addTradeHistoryEntry(appData, service.id, tradeInput.trim(), positionId);
      onUpdateAppData(updatedAppData);

      // CRITICAL: Force immediate sync to Google Sheets for trade entry
      // This prevents data loss if the user refreshes before debounced sync completes
      console.log('[TRADE] Trade entered, triggering immediate sync...');
      await onUpdatePortfolioImmediate(updatedPortfolio);
      console.log('[TRADE] Immediate sync completed');

      setTradeInput('');
      setPositionIdInput('');
      setTradeDateInput('');
      setParseError(null);
      setExpandedPositions((prev) => new Set([...prev, positionId]));
    } catch (err) {
      setParseError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAddTrade();
    }
  };

  const togglePositionExpanded = (positionId: number) => {
    setExpandedPositions((prev) => {
      const next = new Set(prev);
      if (next.has(positionId)) {
        next.delete(positionId);
      } else {
        next.add(positionId);
      }
      return next;
    });
  };

  const handleClosePosition = (positionId: number, closeDate?: Date) => {
    setPortfolio(closePosition(portfolio, positionId, closeDate));
  };

  const handleReopenPosition = (positionId: number) => {
    setPortfolio(reopenPosition(portfolio, positionId));
  };

  const handleDeletePosition = (positionId: number) => {
    if (confirm('Are you sure you want to delete this position and all its trades?')) {
      setPortfolio(deletePosition(portfolio, positionId));
    }
  };

  const handleDeleteTrade = (positionId: number, tradeId: string) => {
    if (confirm('Are you sure you want to delete this trade?')) {
      setPortfolio(deleteTrade(portfolio, positionId, tradeId));
    }
  };

  const handleUpdateMark = (positionId: number, markPrice: number | undefined) => {
    setPortfolio(updatePositionMark(portfolio, positionId, markPrice));
  };

  const handleUpdateDates = (positionId: number, openDate?: Date, closeDate?: Date) => {
    setPortfolio(updatePositionDates(portfolio, positionId, openDate, closeDate));
  };

  const handleUpdateTaxable = (positionId: number, isTaxable: boolean) => {
    setPortfolio(updatePositionTaxable(portfolio, positionId, isTaxable));
  };

  const handleMovePosition = (positionId: number, toServiceId: string) => {
    const updatedAppData = movePosition(appData, positionId, service.id, toServiceId);
    onUpdateAppData(updatedAppData);
    // Update local portfolio state to reflect the removal
    setPortfolio({
      ...portfolio,
      positions: portfolio.positions.filter((p) => p.id !== positionId),
    });
  };

  const handleUpdateSchwabAccount = (positionId: number, schwabAccountId: string | undefined) => {
    setPortfolio(updatePositionSchwabAccount(portfolio, positionId, schwabAccountId));
  };

  const handleUpdateAutoMarkToMarket = (positionId: number, autoMarkToMarket: boolean) => {
    setPortfolio(updatePositionAutoMarkToMarket(portfolio, positionId, autoMarkToMarket));
  };

  // Services available to move positions to (excluding current service)
  const otherServices = appData.services.filter((s) => s.id !== service.id);

  const filteredPositions = portfolio.positions.filter((p) =>
    viewMode === 'open' ? p.isOpen : !p.isOpen
  );

  const summary = getPortfolioSummary(portfolio.positions);
  const closedPnL = getClosedPnLByPeriod(portfolio.positions);
  const effectiveValue = calculateTotalEffectiveValue(portfolio.positions);
  const currentPnL = calculateTotalCurrentPnL(portfolio.positions);
  const closedStats = calculateClosedPositionStats(portfolio.positions, closedPnLPeriod as TimePeriod);

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header with Back Button */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={onBack}
            className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-3xl font-bold text-gray-900">
            <EditableText
              value={service.name}
              onSave={onRenameService}
            />
          </h1>
        </div>

        {/* Portfolio Summary */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
            <div className="text-center">
              <div className="text-lg font-bold text-gray-700">{summary.totalPositionCount}</div>
              <div className="text-xs text-gray-500">Total Positions</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-blue-600">{summary.activePositionCount}</div>
              <div className="text-xs text-gray-500">Open Positions</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-gray-700">{summary.totalTradeCount}</div>
              <div className="text-xs text-gray-500">Total Trades</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${summary.openPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(summary.openPnL)}
              </div>
              <div className="text-xs text-gray-500">Open Cost</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${effectiveValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(effectiveValue)}
              </div>
              <div className="text-xs text-gray-500">Open Value</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${currentPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(currentPnL)}
              </div>
              <div className="text-xs text-gray-500">Open P&L</div>
            </div>
            <div
              className="text-center cursor-pointer hover:bg-gray-50 rounded p-1 -m-1"
              onClick={() => setShowClosedStats(!showClosedStats)}
              title="Click for details"
            >
              <ClosedPnLDisplay
                closedPnL={closedPnL}
                selectedPeriod={closedPnLPeriod}
                onPeriodChange={setClosedPnLPeriod}
              />
              <div className="text-xs text-gray-400 mt-1">{showClosedStats ? '▲' : '▼'}</div>
            </div>
          </div>

          {/* Expanded Closed Position Stats */}
          {showClosedStats && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="text-sm font-semibold text-gray-600 mb-3">
                Closed Position Statistics ({PERIOD_LABELS[closedPnLPeriod]})
              </div>
              {closedStats.count === 0 ? (
                <div className="text-xs text-gray-500 italic">No closed positions in this period</div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="text-center">
                    <div className="text-base font-bold text-gray-700">{closedStats.count}</div>
                    <div className="text-xs text-gray-500">Positions Closed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-base font-bold text-gray-700">{formatCurrency(closedStats.avgCost)}</div>
                    <div className="text-xs text-gray-500">Avg Cost</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-base font-bold ${closedStats.avgPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(closedStats.avgPnL)}
                    </div>
                    <div className="text-xs text-gray-500">Avg P&L</div>
                  </div>
                  <div className="text-center">
                    <div className="text-base font-bold text-gray-700">{closedStats.avgDaysHeld.toFixed(1)}</div>
                    <div className="text-xs text-gray-500">Avg Days Held</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-base font-bold ${closedStats.avgAnnualROI >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {closedStats.avgAnnualROI.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-500">Avg Annual ROI</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* P&L Chart - Collapsible */}
        <div className="mb-4">
          <button
            onClick={() => setShowPnLChart(!showPnLChart)}
            className="w-full flex items-center justify-between px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <span className="text-sm font-medium text-gray-700">Closed P&L Chart</span>
            <span className="text-gray-500">{showPnLChart ? '▼' : '▶'}</span>
          </button>
          {showPnLChart && (
            <div className="mt-2">
              <PnLChart positions={portfolio.positions} />
            </div>
          )}
        </div>

        {/* Trade Input */}
        <div className="bg-white rounded-lg shadow p-4 mb-4">
          <h2 className="text-sm font-semibold mb-2">Add Trade</h2>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={tradeInput}
                onChange={(e) => setTradeInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Paste Thinkorswim trade string..."
                className="flex-1 px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <label className="text-xs text-gray-600">Position #:</label>
              <input
                type="number"
                value={positionIdInput}
                onChange={(e) => setPositionIdInput(e.target.value)}
                placeholder={`${portfolio.nextPositionId} (new)`}
                min="1"
                className="w-28 px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <label className="text-xs text-gray-600">Trade Date:</label>
              <input
                type="date"
                value={tradeDateInput}
                onChange={(e) => setTradeDateInput(e.target.value)}
                className="px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleAddTrade}
                className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Add Trade
              </button>
              <button
                onClick={() => setShowTradeHelp(true)}
                className="w-6 h-6 text-xs bg-blue-100 text-blue-700 rounded-full hover:bg-blue-200 transition-colors font-semibold"
                title="How to copy trade strings from Thinkorswim"
              >
                ?
              </button>
              <div className="flex-1" />
              <button
                onClick={() => setShowTradeHistory(true)}
                className="px-4 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                title="View trade string history"
              >
                History
              </button>
            </div>
          </div>
          {parseError && (
            <p className="mt-2 text-red-600 text-xs">{parseError}</p>
          )}
        </div>

        {/* Trade History Modal */}
        {showTradeHistory && (
          <TradeHistoryModal
            entries={getTradeHistoryForService(appData, service.id)}
            onClose={() => setShowTradeHistory(false)}
          />
        )}

        {/* Trade Help Modal */}
        {showTradeHelp && (
          <TradeHelpModal onClose={() => setShowTradeHelp(false)} />
        )}

        {/* Position Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setViewMode('open')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              viewMode === 'open'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            Open Positions ({portfolio.positions.filter((p) => p.isOpen).length})
          </button>
          <button
            onClick={() => setViewMode('closed')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              viewMode === 'closed'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            Closed Positions ({portfolio.positions.filter((p) => !p.isOpen).length})
          </button>
        </div>

        {/* Positions - 2-column grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredPositions.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500 md:col-span-2">
              No {viewMode} positions
            </div>
          ) : (
            filteredPositions.map((position) => (
              <PositionCard
                key={position.id}
                position={position}
                isExpanded={expandedPositions.has(position.id)}
                onToggleExpand={() => togglePositionExpanded(position.id)}
                onClose={(closeDate) => handleClosePosition(position.id, closeDate)}
                onReopen={() => handleReopenPosition(position.id)}
                onDelete={() => handleDeletePosition(position.id)}
                onMove={(toServiceId) => handleMovePosition(position.id, toServiceId)}
                otherServices={otherServices}
                onDeleteTrade={(tradeId) => handleDeleteTrade(position.id, tradeId)}
                onUpdateMark={(markPrice) => handleUpdateMark(position.id, markPrice)}
                onUpdateDates={(openDate, closeDate) => handleUpdateDates(position.id, openDate, closeDate)}
                onUpdateTaxable={(isTaxable) => handleUpdateTaxable(position.id, isTaxable)}
                onUpdateSchwabAccount={(schwabAccountId) => handleUpdateSchwabAccount(position.id, schwabAccountId)}
                onUpdateAutoMarkToMarket={(autoMarkToMarket) => handleUpdateAutoMarkToMarket(position.id, autoMarkToMarket)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============== TRADE HELP MODAL ==============

interface TradeHelpModalProps {
  onClose: () => void;
}

function TradeHelpModal({ onClose }: TradeHelpModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="text-lg font-semibold">How to Copy Trade Strings from Thinkorswim</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-sm text-gray-700">
            On the Thinkorswim <strong>Activity & Positions</strong> tab, under the <strong>Filled Orders</strong> section,
            or in the <strong>Account Statement</strong> tab under the <strong>Order History</strong> section,
            select the icon in the leftmost column of the row:
          </p>

          <div className="flex justify-center">
            <img
              src="/help/tos-icon.png"
              alt="Thinkorswim order row icon"
              className="border rounded shadow-sm max-w-full"
            />
          </div>

          <p className="text-sm text-gray-700">
            to get this dialog box:
          </p>

          <div className="flex justify-center">
            <img
              src="/help/tos-dialog.png"
              alt="Thinkorswim Edit thinkLog Note dialog"
              className="border rounded shadow-sm max-w-full"
            />
          </div>

          <p className="text-sm text-gray-700">
            Copy this string and paste it into the Add Trade field.
          </p>
        </div>
        <div className="p-4 border-t">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== TRADE HISTORY MODAL ==============

interface TradeHistoryModalProps {
  entries: TradeStringEntry[];
  onClose: () => void;
}

function TradeHistoryModal({ entries, onClose }: TradeHistoryModalProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (entry: TradeStringEntry) => {
    try {
      await navigator.clipboard.writeText(entry.tradeString);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="text-lg font-semibold">Trade String History</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {entries.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              No trade history yet. Trade strings will appear here after successful pastes.
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <div key={entry.id} className="border rounded-lg p-3 hover:bg-gray-50">
                  <div className="flex justify-between items-start mb-2">
                    <div className="text-xs text-gray-500">
                      {entry.enteredDate.toLocaleDateString()} {entry.enteredDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      <span className="ml-2 text-gray-400">Position #{entry.positionId}</span>
                    </div>
                    <button
                      onClick={() => handleCopy(entry)}
                      className={`px-2 py-1 text-xs rounded transition-colors ${
                        copiedId === entry.id
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {copiedId === entry.id ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className="font-mono text-xs text-gray-700 bg-gray-50 p-2 rounded break-all">
                    {entry.tradeString}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== POSITION CARD ==============

interface PositionCardProps {
  position: Position;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onClose: (closeDate?: Date) => void;
  onReopen: () => void;
  onDelete: () => void;
  onMove: (toServiceId: string) => void;
  otherServices: Array<{ id: string; name: string }>;
  onDeleteTrade: (tradeId: string) => void;
  onUpdateMark: (markPrice: number | undefined) => void;
  onUpdateDates: (openDate?: Date, closeDate?: Date) => void;
  onUpdateTaxable: (isTaxable: boolean) => void;
  onUpdateSchwabAccount: (schwabAccountId: string | undefined) => void;
  onUpdateAutoMarkToMarket: (autoMarkToMarket: boolean) => void;
}

// Helper to aggregate legs across all trades in a position
function getNetLegs(position: Position): Array<{
  key: string;
  quantity: number;
  optionType: string;
  strike: number;
  expiration: Date;
}> {
  const legMap = new Map<string, {
    quantity: number;
    optionType: string;
    strike: number;
    expiration: Date;
  }>();

  for (const trade of position.trades) {
    for (const leg of trade.legs) {
      // Create a unique key for each leg type
      const key = `${leg.expiration.toISOString()}-${leg.strike}-${leg.optionType}`;
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

  // Convert to array and sort by expiration, then strike
  return Array.from(legMap.entries())
    .map(([key, data]) => ({ key, ...data }))
    .sort((a, b) => {
      const dateDiff = a.expiration.getTime() - b.expiration.getTime();
      if (dateDiff !== 0) return dateDiff;
      return a.strike - b.strike;
    });
}

function PositionCard({
  position,
  isExpanded,
  onToggleExpand,
  onClose,
  onReopen,
  onDelete,
  onMove,
  otherServices,
  onDeleteTrade,
  onUpdateMark,
  onUpdateDates,
  onUpdateTaxable,
  onUpdateSchwabAccount,
  onUpdateAutoMarkToMarket,
}: PositionCardProps) {
  const summary = getPositionSummary(position);
  const markInfo = getMarkInfo(position);
  const netLegs = isExpanded ? getNetLegs(position) : [];
  const [isEditingMark, setIsEditingMark] = useState(false);
  const [markInputValue, setMarkInputValue] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [closeDateInput, setCloseDateInput] = useState('');
  const [isMoving, setIsMoving] = useState(false);
  const [isEditingOpenDate, setIsEditingOpenDate] = useState(false);
  const [isEditingCloseDate, setIsEditingCloseDate] = useState(false);
  const [openDateInput, setOpenDateInput] = useState('');
  const [closeDateEditInput, setCloseDateEditInput] = useState('');

  // Schwab integration - use cached data
  const { isEnabled: schwabEnabled, isSignedIn: schwabSignedIn, accounts: schwabAccounts, getNetLiqForPosition, lastRefresh } = useSchwab();

  // Get Net Liq from cache (instant, no API call)
  const schwabResult = position.isOpen && position.schwabAccountId
    ? getNetLiqForPosition(position)
    : null;
  const schwabNetLiq = schwabResult?.netLiq ?? null;
  const schwabMatchInfo = schwabResult
    ? `${schwabResult.matchedLegs}/${schwabResult.totalLegs} legs`
    : null;

  // Check if all expirations are in the past (for open positions)
  const isExpired = position.isOpen && summary.daysToExpiration < 0;

  return (
    <div className={`rounded-lg shadow overflow-hidden ${isExpired ? 'bg-red-50' : 'bg-white'}`}>
      {/* Position Summary Header */}
      <div
        className={`p-2 cursor-pointer transition-colors ${isExpired ? 'hover:bg-red-100' : 'hover:bg-gray-50'}`}
        onClick={onToggleExpand}
      >
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-400">#{position.id}</span>
            <span className="text-base font-bold">{position.symbol}</span>
            <span className="px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
              {position.structure}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="text-right">
              <div className={`text-sm font-semibold ${summary.runningPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(summary.runningPnL)}
              </div>
              <div className="text-gray-500">Cost</div>
            </div>
            {position.isOpen && markInfo.markValue !== null && (
              <div className="text-right">
                <div className={`text-sm font-semibold ${markInfo.markValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(markInfo.markValue)}
                </div>
                <div className="text-gray-500">Value</div>
              </div>
            )}
            <div className="text-right">
              <div className={`text-sm font-semibold ${summary.totalContracts >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {summary.totalContracts > 0 ? '+' : ''}{summary.totalContracts}
              </div>
              <div className="text-gray-500">Ctrs</div>
            </div>
            <div className="text-right">
              {position.isOpen ? (
                <>
                  <div className={`text-sm font-semibold ${summary.daysToExpiration <= 7 ? 'text-red-600' : 'text-gray-700'}`}>
                    {summary.daysToExpiration}
                  </div>
                  <div className="text-gray-500">DTE</div>
                </>
              ) : (
                <>
                  <div className="text-sm font-semibold text-gray-700">
                    {position.openDate && position.closeDate
                      ? Math.ceil((position.closeDate.getTime() - position.openDate.getTime()) / (1000 * 60 * 60 * 24))
                      : '-'}
                  </div>
                  <div className="text-gray-500">Held</div>
                </>
              )}
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold text-gray-700">{summary.adjustmentCount}</div>
              <div className="text-gray-500">Adj</div>
            </div>
            <span className="text-gray-400">{isExpanded ? '▲' : '▼'}</span>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t">
          {/* Action Buttons */}
          <div className="p-2 bg-gray-50 border-b flex gap-1 items-center flex-wrap">
            {position.isOpen ? (
              isClosing ? (
                <div className="flex items-center gap-1">
                  <label className="text-xs text-gray-600">Close Date:</label>
                  <input
                    type="date"
                    value={closeDateInput}
                    onChange={(e) => setCloseDateInput(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="px-2 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const closeDate = closeDateInput ? new Date(closeDateInput) : undefined;
                      onClose(closeDate);
                      setIsClosing(false);
                      setCloseDateInput('');
                    }}
                    className="px-2 py-0.5 text-xs bg-orange-600 text-white rounded hover:bg-orange-700"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setIsClosing(false); setCloseDateInput(''); }}
                    className="px-2 py-0.5 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const today = new Date();
                    setCloseDateInput(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
                    setIsClosing(true);
                  }}
                  className="px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
                >
                  Close
                </button>
              )
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onReopen(); }}
                className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
              >
                Reopen
              </button>
            )}
            <div className="flex gap-1 ml-8">
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
              >
                Delete
              </button>
              {otherServices.length > 0 && (
                isMoving ? (
                  <div className="flex items-center gap-1">
                    <select
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        if (e.target.value) {
                          onMove(e.target.value);
                          setIsMoving(false);
                        }
                      }}
                      className="px-1 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      defaultValue=""
                    >
                      <option value="" disabled>Select service...</option>
                      {otherServices.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={(e) => { e.stopPropagation(); setIsMoving(false); }}
                      className="px-1.5 py-0.5 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setIsMoving(true); }}
                    className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                  >
                    Move
                </button>
              )
            )}
            </div>

            {/* Schwab Net Liq Section */}
            {position.isOpen && (
              <div className="flex items-center gap-2 ml-2 px-2 py-1 bg-gray-100 rounded" onClick={(e) => e.stopPropagation()}>
                <span className="text-xs text-gray-600">Schwab:</span>
                {schwabEnabled && schwabSignedIn ? (
                  <>
                    <select
                      value={position.schwabAccountId || ''}
                      onChange={(e) => onUpdateSchwabAccount(e.target.value || undefined)}
                      className="px-1 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                    >
                      <option value="">Select Account</option>
                      {schwabAccounts.map((account) => (
                        <option key={account.accountId} value={account.accountId}>
                          {account.nickname || account.displayName}
                        </option>
                      ))}
                    </select>
                    {position.schwabAccountId && (
                      <>
                        <span className={`text-xs font-medium ${schwabNetLiq !== null ? (schwabNetLiq >= 0 ? 'text-green-600' : 'text-red-600') : 'text-gray-400'}`}>
                          {schwabNetLiq !== null ? formatCurrency(schwabNetLiq) : (lastRefresh ? '--' : 'Click Refresh')}
                        </span>
                        {schwabMatchInfo && (
                          <span className="text-xs text-gray-400" title="Matched legs">
                            ({schwabMatchInfo})
                          </span>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-gray-400 italic">
                    {schwabEnabled ? 'Sign in to Schwab' : 'Not enabled'}
                  </span>
                )}
              </div>
            )}
            <div className="ml-auto text-xs text-gray-500 text-right">
              {position.openDate && (
                <div className="flex items-center justify-end gap-1">
                  {isEditingOpenDate ? (
                    <>
                      <span>Opened:</span>
                      <input
                        type="date"
                        value={openDateInput}
                        onChange={(e) => setOpenDateInput(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="px-1 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (openDateInput) {
                            onUpdateDates(new Date(openDateInput), undefined);
                          }
                          setIsEditingOpenDate(false);
                          setOpenDateInput('');
                        }}
                        className="px-1.5 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setIsEditingOpenDate(false); setOpenDateInput(''); }}
                        className="px-1.5 py-0.5 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        const d = position.openDate;
                        setOpenDateInput(d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '');
                        setIsEditingOpenDate(true);
                      }}
                      className="cursor-pointer hover:text-blue-600 hover:underline"
                    >
                      Opened: {formatDate(position.openDate)}
                    </span>
                  )}
                </div>
              )}
              {!position.isOpen && position.closeDate && (
                <div className="flex items-center justify-end gap-1">
                  {isEditingCloseDate ? (
                    <>
                      <span>Closed:</span>
                      <input
                        type="date"
                        value={closeDateEditInput}
                        onChange={(e) => setCloseDateEditInput(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="px-1 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (closeDateEditInput) {
                            onUpdateDates(undefined, new Date(closeDateEditInput));
                          }
                          setIsEditingCloseDate(false);
                          setCloseDateEditInput('');
                        }}
                        className="px-1.5 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setIsEditingCloseDate(false); setCloseDateEditInput(''); }}
                        className="px-1.5 py-0.5 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        const d = position.closeDate;
                        setCloseDateEditInput(d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '');
                        setIsEditingCloseDate(true);
                      }}
                      className="cursor-pointer hover:text-blue-600 hover:underline"
                    >
                      Closed: {formatDate(position.closeDate)}
                    </span>
                  )}
                </div>
              )}
              {/* Taxable Toggle */}
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={position.isTaxable === true}
                    onChange={(e) => {
                      e.stopPropagation();
                      onUpdateTaxable(e.target.checked);
                    }}
                    className="w-3 h-3"
                  />
                  <span className="text-xs text-gray-600">Taxable</span>
                </label>
              </div>
            </div>
          </div>

          {/* Mark-to-Market Section (only for open positions) */}
          {position.isOpen && (
            <div className="p-2 border-b bg-yellow-50">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-gray-600">Mark-to-Market</div>
                {markInfo.markDate && (
                  <div className="text-xs text-gray-400">
                    Updated: {markInfo.markDate.toLocaleDateString()} {markInfo.markDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
              <div className="mt-1 flex items-center gap-3">
                {isEditingMark ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      Net Liq: $
                    </span>
                    <input
                      type="number"
                      step="1"
                      value={markInputValue}
                      onChange={(e) => setMarkInputValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const value = parseFloat(markInputValue);
                          onUpdateMark(isNaN(value) ? undefined : value);
                          setIsEditingMark(false);
                        } else if (e.key === 'Escape') {
                          setIsEditingMark(false);
                        }
                      }}
                      className="w-24 px-2 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="0"
                      autoFocus
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const value = parseFloat(markInputValue);
                        onUpdateMark(isNaN(value) ? undefined : value);
                        setIsEditingMark(false);
                      }}
                      className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setIsEditingMark(false); }}
                      className="px-2 py-0.5 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    {markInfo.markValue !== null ? (
                      <>
                        <span className="text-xs text-gray-600">
                          Net Liq: <span className="font-medium">{formatCurrency(markInfo.markValue)}</span>
                        </span>
                        <span className="text-xs">
                          P&L: <span className={`font-medium ${(markInfo.unrealizedPnL || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(markInfo.unrealizedPnL || 0)}
                          </span>
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400 italic">No mark set</span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        // Pre-populate with Schwab Net Liq if available, otherwise use existing mark
                        const defaultValue = schwabNetLiq !== null ? schwabNetLiq.toString() : (markInfo.markValue?.toString() || '');
                        setMarkInputValue(defaultValue);
                        setIsEditingMark(true);
                      }}
                      className="px-2 py-0.5 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    >
                      {markInfo.markValue !== null ? 'Update' : 'Set Mark'}
                    </button>
                    {markInfo.markValue !== null && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onUpdateMark(undefined); }}
                        className="px-2 py-0.5 text-xs text-gray-400 hover:text-red-600"
                        title="Clear mark"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
              </div>
              {/* Auto-update checkbox (only show when Schwab account is linked) */}
              {position.schwabAccountId && schwabEnabled && schwabSignedIn && (
                <div className="mt-2 flex items-center gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={position.autoMarkToMarket || false}
                      onChange={(e) => {
                        e.stopPropagation();
                        onUpdateAutoMarkToMarket(e.target.checked);
                      }}
                      className="w-3 h-3"
                    />
                    <span className="text-xs text-gray-600">Auto-update from Schwab</span>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Net Position Summary */}
          <div className="p-2 border-b bg-blue-50">
            <div className="text-xs font-semibold text-gray-600 mb-1">Net Position</div>
            {netLegs.length === 0 || netLegs.every(leg => leg.quantity === 0) ? (
              <div className="text-xs text-gray-500 italic">Position fully closed</div>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {netLegs.filter(leg => leg.quantity !== 0).map((leg) => (
                    <tr key={leg.key}>
                      <td className={`pr-2 font-medium ${leg.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {leg.quantity > 0 ? '+' : ''}{leg.quantity}
                      </td>
                      <td className="pr-2">{leg.optionType}</td>
                      <td className="pr-2 text-gray-600">{leg.strike}</td>
                      <td className="pr-2 text-gray-500">
                        {formatDate(leg.expiration)}
                        {getDaysToExpiration(leg.expiration) < 0 && <span className="text-red-500 ml-1">(expired)</span>}
                      </td>
                      <td className="text-gray-400 text-right">
                        {getDaysToExpiration(leg.expiration) < 0 ? '' : `${getDaysToExpiration(leg.expiration)}d`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Trades - newest first */}
          <div className="p-2 space-y-2">
            {[...position.trades].reverse().map((trade) => {
              const originalIdx = position.trades.findIndex(t => t.id === trade.id);
              return (
              <div key={trade.id} className="border rounded p-2 text-xs">
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400">
                      {originalIdx === 0 ? 'Open' : `#${originalIdx}`}
                    </span>
                    <span className={`px-1 py-0.5 rounded font-medium ${
                      trade.action === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {trade.action}
                    </span>
                    <span className="text-gray-600">{trade.spreadType}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${calculateTradePnL(trade) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(calculateTradePnL(trade))}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteTrade(trade.id); }}
                      className="text-gray-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Legs - compact table */}
                <div className="bg-gray-50 rounded p-1">
                  <table className="w-full text-xs">
                    <tbody>
                      {trade.legs.map((leg, legIdx) => (
                        <tr key={legIdx}>
                          <td className={`pr-1 ${leg.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {leg.quantity > 0 ? '+' : ''}{leg.quantity}
                          </td>
                          <td className="pr-1">{leg.optionType}</td>
                          <td className="pr-1 text-gray-600">{leg.strike}</td>
                          <td className="pr-1 text-gray-500">
                            {formatDate(leg.expiration)}
                            {getDaysToExpiration(leg.expiration) < 0 && <span className="text-red-500 ml-1">(exp)</span>}
                          </td>
                          <td className="text-gray-400 text-right">
                            {getDaysToExpiration(leg.expiration) < 0 ? '' : `${getDaysToExpiration(leg.expiration)}d`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
