import type { Trade, Position, Portfolio, Service, AppData, MarkSource } from '../types/trade';

const STORAGE_KEY = 'options-tracker-data';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function rehydratePortfolio(data: Portfolio): Portfolio {
  return {
    ...data,
    positions: data.positions.map((pos: Position) => ({
      ...pos,
      openDate: new Date(pos.openDate),
      closeDate: pos.closeDate ? new Date(pos.closeDate) : undefined,
      markDate: pos.markDate ? new Date(pos.markDate) : undefined,
      // Support both old markPrice and new markValue during migration
      markValue: pos.markValue ?? pos.markPrice,
      // Default isTaxable to false
      isTaxable: pos.isTaxable === true,
      trades: pos.trades.map((trade: Trade) => ({
        ...trade,
        tradeDate: new Date(trade.tradeDate),
        legs: trade.legs.map((leg) => ({
          ...leg,
          expiration: new Date(leg.expiration),
        })),
      })),
    })),
  };
}

function rehydrateService(data: Service): Service {
  return {
    ...data,
    createdAt: new Date(data.createdAt),
    portfolio: rehydratePortfolio(data.portfolio),
  };
}

export function loadAppData(): AppData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      return {
        services: data.services.map(rehydrateService),
        appTitle: data.appTitle,
      };
    }
  } catch (error) {
    console.error('Failed to load app data:', error);
  }
  return { services: [] };
}

export function saveAppData(data: AppData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save app data:', error);
  }
}

export function createService(appData: AppData, name: string): AppData {
  const newService: Service = {
    id: generateId(),
    name,
    portfolio: { positions: [], nextPositionId: 1 },
    createdAt: new Date(),
  };

  return {
    ...appData,
    services: [...appData.services, newService],
  };
}

export function updateService(appData: AppData, serviceId: string, portfolio: Portfolio): AppData {
  return {
    ...appData,
    services: appData.services.map((s) =>
      s.id === serviceId ? { ...s, portfolio } : s
    ),
  };
}

export function renameService(appData: AppData, serviceId: string, newName: string): AppData {
  return {
    ...appData,
    services: appData.services.map((s) =>
      s.id === serviceId ? { ...s, name: newName } : s
    ),
  };
}

export function deleteService(appData: AppData, serviceId: string): AppData {
  return {
    ...appData,
    services: appData.services.filter((s) => s.id !== serviceId),
  };
}

export function updateAppTitle(appData: AppData, title: string): AppData {
  return {
    ...appData,
    appTitle: title,
  };
}

export function addTradeToPosition(
  portfolio: Portfolio,
  trade: Trade,
  positionId: number
): Portfolio {
  const existingPosition = portfolio.positions.find((p) => p.id === positionId);

  if (existingPosition) {
    // Add trade to existing position
    if (existingPosition.symbol !== trade.symbol) {
      throw new Error(
        `Symbol mismatch: position is for ${existingPosition.symbol}, trade is for ${trade.symbol}`
      );
    }
    if (!existingPosition.isOpen) {
      throw new Error('Cannot add trade to a closed position');
    }

    const updatedPositions = portfolio.positions.map((pos) =>
      pos.id === positionId
        ? { ...pos, trades: [...pos.trades, { ...trade, positionId }] }
        : pos
    );

    return { ...portfolio, positions: updatedPositions };
  } else {
    // Create new position
    const newPosition: Position = {
      id: positionId,
      symbol: trade.symbol,
      trades: [{ ...trade, positionId }],
      isOpen: true,
      openDate: trade.tradeDate,
      structure: trade.spreadType,
    };

    const nextId = Math.max(portfolio.nextPositionId, positionId + 1);

    return {
      positions: [...portfolio.positions, newPosition],
      nextPositionId: nextId,
    };
  }
}

export function closePosition(portfolio: Portfolio, positionId: number, closeDateInput?: Date): Portfolio {
  const updatedPositions = portfolio.positions.map((pos) => {
    if (pos.id !== positionId) return pos;

    // Use provided date, or fall back to most recent trade's date, or today
    let closeDate = closeDateInput || new Date();
    if (!closeDateInput && pos.trades.length > 0) {
      const mostRecentTrade = pos.trades.reduce((latest, trade) =>
        trade.tradeDate > latest.tradeDate ? trade : latest
      );
      closeDate = mostRecentTrade.tradeDate;
    }

    return {
      ...pos,
      isOpen: false,
      closeDate,
      // Clear mark-to-market values since final P&L is now known
      markValue: undefined,
      markDate: undefined,
      markSource: undefined,
    };
  });

  return { ...portfolio, positions: updatedPositions };
}

export function reopenPosition(portfolio: Portfolio, positionId: number): Portfolio {
  const updatedPositions = portfolio.positions.map((pos) =>
    pos.id === positionId
      ? { ...pos, isOpen: true, closeDate: undefined }
      : pos
  );

  return { ...portfolio, positions: updatedPositions };
}

export function deletePosition(portfolio: Portfolio, positionId: number): Portfolio {
  return {
    ...portfolio,
    positions: portfolio.positions.filter((p) => p.id !== positionId),
  };
}

export function deleteTrade(
  portfolio: Portfolio,
  positionId: number,
  tradeId: string
): Portfolio {
  const updatedPositions = portfolio.positions
    .map((pos) => {
      if (pos.id !== positionId) return pos;

      const updatedTrades = pos.trades.filter((t) => t.id !== tradeId);

      // If no trades left, remove the position
      if (updatedTrades.length === 0) {
        return null;
      }

      return { ...pos, trades: updatedTrades };
    })
    .filter((pos): pos is Position => pos !== null);

  return { ...portfolio, positions: updatedPositions };
}

export function updatePositionMark(
  portfolio: Portfolio,
  positionId: number,
  markValue: number | undefined,
  markSource: MarkSource = 'manual'
): Portfolio {
  const updatedPositions = portfolio.positions.map((pos) =>
    pos.id === positionId
      ? {
          ...pos,
          markValue,
          markDate: markValue !== undefined ? new Date() : undefined,
          markSource: markValue !== undefined ? markSource : undefined,
        }
      : pos
  );

  return { ...portfolio, positions: updatedPositions };
}

export function updatePositionDates(
  portfolio: Portfolio,
  positionId: number,
  openDate?: Date,
  closeDate?: Date
): Portfolio {
  const updatedPositions = portfolio.positions.map((pos) =>
    pos.id === positionId
      ? {
          ...pos,
          openDate: openDate !== undefined ? openDate : pos.openDate,
          closeDate: closeDate !== undefined ? closeDate : pos.closeDate,
        }
      : pos
  );

  return { ...portfolio, positions: updatedPositions };
}

export function updatePositionTaxable(
  portfolio: Portfolio,
  positionId: number,
  isTaxable: boolean
): Portfolio {
  const updatedPositions = portfolio.positions.map((pos) =>
    pos.id === positionId
      ? { ...pos, isTaxable }
      : pos
  );

  return { ...portfolio, positions: updatedPositions };
}
