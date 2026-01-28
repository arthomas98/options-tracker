import type { Trade, Position, PositionSummary, PortfolioSummary, Service, ServiceSummary, ClosedPnLByPeriod, MarkSource } from '../types/trade';

export type TimePeriod = 'all' | 'last30' | 'currentYear' | 'previousYear';

function getDateRangeForPeriod(period: TimePeriod): { start: Date; end: Date } {
  const now = new Date();
  const currentYear = now.getFullYear();

  switch (period) {
    case 'last30': {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      return { start, end: now };
    }
    case 'currentYear': {
      const start = new Date(currentYear, 0, 1); // Jan 1 of current year
      return { start, end: now };
    }
    case 'previousYear': {
      const start = new Date(currentYear - 1, 0, 1); // Jan 1 of previous year
      const end = new Date(currentYear - 1, 11, 31, 23, 59, 59, 999); // Dec 31 of previous year
      return { start, end };
    }
    case 'all':
    default:
      return { start: new Date(0), end: now };
  }
}

function isDateInRange(date: Date | undefined, start: Date, end: Date): boolean {
  if (!date || isNaN(date.getTime())) return false;
  return date >= start && date <= end;
}

export function calculateClosedPnLForPeriod(positions: Position[], period: TimePeriod): number {
  const { start, end } = getDateRangeForPeriod(period);

  const closedInPeriod = positions.filter(
    (p) => !p.isOpen && isDateInRange(p.closeDate, start, end)
  );

  return closedInPeriod.reduce(
    (total, pos) => total + calculatePositionPnL(pos),
    0
  );
}

export function getClosedPnLByPeriod(positions: Position[]): ClosedPnLByPeriod {
  return {
    all: calculateClosedPnLForPeriod(positions, 'all'),
    last30: calculateClosedPnLForPeriod(positions, 'last30'),
    currentYear: calculateClosedPnLForPeriod(positions, 'currentYear'),
    previousYear: calculateClosedPnLForPeriod(positions, 'previousYear'),
  };
}

// Taxable vs Non-taxable P&L breakdown
export interface TaxablePnLBreakdown {
  taxable: number;
  nonTaxable: number;
  total: number;
}

export function calculateClosedPnLByTaxStatus(positions: Position[], period: TimePeriod): TaxablePnLBreakdown {
  const { start, end } = getDateRangeForPeriod(period);
  const closedInPeriod = positions.filter(
    (p) => !p.isOpen && isDateInRange(p.closeDate, start, end)
  );

  let taxable = 0;
  let nonTaxable = 0;

  for (const pos of closedInPeriod) {
    const pnl = calculatePositionPnL(pos);
    if (pos.isTaxable === true) {
      taxable += pnl;
    } else {
      nonTaxable += pnl;
    }
  }

  return { taxable, nonTaxable, total: taxable + nonTaxable };
}

export function calculateCurrentPnLByTaxStatus(positions: Position[]): TaxablePnLBreakdown {
  const openPositions = positions.filter(p => p.isOpen);

  // Calculate total cost (trade P&L)
  const totalCost = openPositions.reduce(
    (total, pos) => total + calculatePositionPnL(pos),
    0
  );

  // Calculate total value (marks for marked, trade P&L for unmarked)
  const totalValue = openPositions.reduce(
    (total, pos) => total + getEffectiveValue(pos),
    0
  );

  // Calculate P&L based on whether portfolio is net credit or debit
  const calculatePnL = (cost: number, value: number) => {
    return cost >= 0 ? value : cost + value;
  };

  // Separate by tax status
  const taxablePositions = openPositions.filter(p => p.isTaxable === true);
  const nonTaxablePositions = openPositions.filter(p => p.isTaxable !== true);

  const taxableCost = taxablePositions.reduce((t, p) => t + calculatePositionPnL(p), 0);
  const taxableValue = taxablePositions.reduce((t, p) => t + getEffectiveValue(p), 0);
  const taxablePnL = calculatePnL(taxableCost, taxableValue);

  const nonTaxableCost = nonTaxablePositions.reduce((t, p) => t + calculatePositionPnL(p), 0);
  const nonTaxableValue = nonTaxablePositions.reduce((t, p) => t + getEffectiveValue(p), 0);
  const nonTaxablePnL = calculatePnL(nonTaxableCost, nonTaxableValue);

  // Total uses the combined cost/value for correct calculation
  const totalPnL = calculatePnL(totalCost, totalValue);

  return { taxable: taxablePnL, nonTaxable: nonTaxablePnL, total: totalPnL };
}

// Statistics for closed positions in a period
export interface ClosedPositionStats {
  count: number;
  totalCost: number;
  totalPnL: number;
  avgCost: number;
  avgPnL: number;
  avgDaysHeld: number;
  avgAnnualROI: number; // As a percentage
}

export function getClosedPositionsForPeriod(positions: Position[], period: TimePeriod): Position[] {
  const { start, end } = getDateRangeForPeriod(period);
  return positions.filter(
    (p) => !p.isOpen && isDateInRange(p.closeDate, start, end)
  );
}

export function calculateClosedPositionStats(positions: Position[], period: TimePeriod): ClosedPositionStats {
  const closedPositions = getClosedPositionsForPeriod(positions, period);

  if (closedPositions.length === 0) {
    return {
      count: 0,
      totalCost: 0,
      totalPnL: 0,
      avgCost: 0,
      avgPnL: 0,
      avgDaysHeld: 0,
      avgAnnualROI: 0,
    };
  }

  let totalCost = 0;
  let totalPnL = 0;
  let totalDaysHeld = 0;

  for (const pos of closedPositions) {
    const pnl = calculatePositionPnL(pos);

    // Cost is the absolute value of the FIRST trade (initial premium paid or received)
    // This represents your initial capital at risk
    const firstTradePnL = pos.trades.length > 0 ? calculateTradePnL(pos.trades[0]) : 0;
    const cost = Math.abs(firstTradePnL);

    totalPnL += pnl;
    totalCost += cost;

    // Calculate days held
    if (pos.openDate && pos.closeDate) {
      const daysHeld = Math.max(1, Math.ceil(
        (pos.closeDate.getTime() - pos.openDate.getTime()) / (1000 * 60 * 60 * 24)
      ));
      totalDaysHeld += daysHeld;
    }
  }

  const count = closedPositions.length;
  const avgDaysHeld = totalDaysHeld / count;

  // Calculate portfolio-level annualized ROI
  // ROI = total P&L / total cost, then annualize based on average holding period
  let avgAnnualROI = 0;
  if (totalCost > 0 && avgDaysHeld > 0) {
    const totalROI = totalPnL / totalCost; // e.g., -0.05 for -5% return
    avgAnnualROI = totalROI * (365 / avgDaysHeld) * 100; // Convert to percentage
  }

  return {
    count,
    totalCost,
    totalPnL,
    avgCost: totalCost / count,
    avgPnL: totalPnL / count,
    avgDaysHeld,
    avgAnnualROI,
  };
}

export function calculateTradePnL(trade: Trade): number {
  // For options: BUY is a debit (negative), SELL is a credit (positive)
  const sign = trade.action === 'BUY' ? -1 : 1;
  return sign * trade.price * trade.totalQuantity * trade.multiplier;
}

export function calculatePositionPnL(position: Position): number {
  return position.trades.reduce((total, trade) => total + calculateTradePnL(trade), 0);
}

export function getEarliestExpiration(position: Position): Date | null {
  let earliest: Date | null = null;

  for (const trade of position.trades) {
    for (const leg of trade.legs) {
      if (!earliest || leg.expiration < earliest) {
        earliest = leg.expiration;
      }
    }
  }

  return earliest;
}

// Get the latest expiration date from legs that are still open (net quantity != 0)
export function getLatestExpirationFromNetPosition(position: Position): Date | null {
  // Aggregate legs by unique key (expiration + strike + optionType)
  const legMap = new Map<string, { quantity: number; expiration: Date }>();

  for (const trade of position.trades) {
    for (const leg of trade.legs) {
      const key = `${leg.expiration.toISOString()}-${leg.strike}-${leg.optionType}`;
      const existing = legMap.get(key);
      if (existing) {
        existing.quantity += leg.quantity;
      } else {
        legMap.set(key, { quantity: leg.quantity, expiration: leg.expiration });
      }
    }
  }

  // Find the latest expiration among legs with non-zero quantity
  let latest: Date | null = null;
  for (const leg of legMap.values()) {
    if (leg.quantity !== 0) {
      if (!latest || leg.expiration > latest) {
        latest = leg.expiration;
      }
    }
  }

  return latest;
}

export function getDaysToExpiration(date: Date | null): number {
  if (!date || isNaN(date.getTime())) {
    return 0;
  }
  const now = new Date();
  const diffTime = date.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function calculateTotalContracts(position: Position): number {
  // Sum all leg quantities across all trades
  // Positive = net long, Negative = net short
  let total = 0;
  for (const trade of position.trades) {
    for (const leg of trade.legs) {
      total += leg.quantity;
    }
  }
  return total;
}

// Get the multiplier for a position (from the first trade)
export function getPositionMultiplier(position: Position): number {
  if (position.trades.length === 0) return 100;
  return position.trades[0].multiplier;
}

// Calculate unrealized P&L based on current mark value
// markValue = Net Liquidation Value (what you'd receive to close, can be negative if you'd pay)
// P&L = tradePnL + markValue (always)
export function calculateUnrealizedPnL(position: Position): number | null {
  const markValue = position.markValue;
  if (markValue === undefined || markValue === null) {
    return null;
  }

  const tradePnL = calculatePositionPnL(position);
  return tradePnL + markValue;
}

// Get mark info for display
export interface MarkInfo {
  markValue: number | null;      // Total current value of position
  markDate: Date | null;
  markSource: MarkSource | null;
  unrealizedPnL: number | null;  // P&L if closed at mark
  isDebitPosition: boolean;      // Whether this is a debit (long) position
}

export function getMarkInfo(position: Position): MarkInfo {
  const markValue = position.markValue ?? null;
  const markDate = position.markDate ?? null;
  const markSource = position.markSource ?? null;
  const tradePnL = calculatePositionPnL(position);
  const isDebitPosition = tradePnL < 0;

  const unrealizedPnL = calculateUnrealizedPnL(position);

  return {
    markValue,
    markDate,
    markSource,
    unrealizedPnL,
    isDebitPosition,
  };
}

// Get effective value for a position: use mark value if set, otherwise use trade P&L
export function getEffectiveValue(position: Position): number {
  const tradePnL = calculatePositionPnL(position);
  const markValue = position.markValue;

  // If we have a mark value, use it
  // Otherwise fall back to trade P&L
  return markValue !== undefined && markValue !== null ? markValue : tradePnL;
}

// Calculate total effective value for open positions
export function calculateTotalEffectiveValue(positions: Position[]): number {
  return positions
    .filter(p => p.isOpen)
    .reduce((total, pos) => total + getEffectiveValue(pos), 0);
}

// Calculate total current P&L for open positions
// Logic depends on whether portfolio is net credit or net debit:
// - Net credit (Cost >= 0): P&L = Value (credits are "banked")
// - Net debit (Cost < 0): P&L = Cost + Value
export function calculateTotalCurrentPnL(positions: Position[]): number {
  const openPositions = positions.filter(p => p.isOpen);

  // Calculate total cost (trade P&L)
  const totalCost = openPositions.reduce(
    (total, pos) => total + calculatePositionPnL(pos),
    0
  );

  // Calculate total value (marks for marked, trade P&L for unmarked)
  const totalValue = openPositions.reduce(
    (total, pos) => total + getEffectiveValue(pos),
    0
  );

  // If net credit, P&L = Value (the credits are already received)
  // If net debit, P&L = Cost + Value
  if (totalCost >= 0) {
    return totalValue;
  } else {
    return totalCost + totalValue;
  }
}

// Bucket for a category of positions
export interface PositionBucket {
  count: number;
  markedCount: number;
  cost: number;           // Total trade P&L
  markedValue: number;    // Total mark values for marked positions only
  markedPnL: number;      // P&L for marked positions
  unmarkedCost: number;   // Cost of unmarked positions
}

// Breakdown of open positions by type and origin
export interface PositionBreakdown {
  // True long positions: opened with BUY, still net negative (paid more than received)
  long: PositionBucket;
  // True short positions: opened with SELL, still net positive (received more than paid)
  short: PositionBucket;
  // Positions that started long but flipped to net positive (took profits, small position remains)
  closedOutLong: PositionBucket;
  // Positions that started short but flipped to net negative (bought back more than sold)
  closedOutShort: PositionBucket;
  totalPnL: number;
}

function getFirstTradeAction(position: Position): 'BUY' | 'SELL' | null {
  if (position.trades.length === 0) return null;
  return position.trades[0].action;
}

export function calculatePositionBreakdown(positions: Position[]): PositionBreakdown {
  const openPositions = positions.filter(p => p.isOpen);

  const emptyBucket = (): PositionBucket => ({
    count: 0, markedCount: 0, cost: 0, markedValue: 0, markedPnL: 0, unmarkedCost: 0
  });

  const breakdown: PositionBreakdown = {
    long: emptyBucket(),
    short: emptyBucket(),
    closedOutLong: emptyBucket(),
    closedOutShort: emptyBucket(),
    totalPnL: 0,
  };

  for (const pos of openPositions) {
    const tradePnL = calculatePositionPnL(pos);
    const markValue = pos.markValue;
    const hasMarkValue = markValue !== undefined && markValue !== null;
    const firstAction = getFirstTradeAction(pos);

    // Determine current state and original state
    const isCurrentlyPositive = tradePnL >= 0;
    const openedWithBuy = firstAction === 'BUY';

    // Classify into the right bucket
    let bucket: PositionBucket;

    if (openedWithBuy && !isCurrentlyPositive) {
      // True long: opened BUY, still net negative
      bucket = breakdown.long;
    } else if (!openedWithBuy && isCurrentlyPositive) {
      // True short: opened SELL, still net positive
      bucket = breakdown.short;
    } else if (openedWithBuy && isCurrentlyPositive) {
      // Closed-out long: opened BUY, now net positive (took profits)
      bucket = breakdown.closedOutLong;
    } else {
      // Closed-out short: opened SELL, now net negative (bought back too much)
      bucket = breakdown.closedOutShort;
    }

    bucket.count++;
    bucket.cost += tradePnL;

    if (hasMarkValue) {
      bucket.markedCount++;
      bucket.markedValue += markValue;
      // P&L = tradePnL + markValue (markValue is net liquidation value)
      const pnl = tradePnL + markValue;
      bucket.markedPnL += pnl;
      breakdown.totalPnL += pnl;
    } else {
      bucket.unmarkedCost += tradePnL;
      breakdown.totalPnL += tradePnL;
    }
  }

  return breakdown;
}

export function getPositionSummary(position: Position): PositionSummary {
  const pnl = calculatePositionPnL(position);
  const latestExp = getLatestExpirationFromNetPosition(position);
  const dte = getDaysToExpiration(latestExp);

  // Count adjustments (trades after the first one)
  const adjustmentCount = Math.max(0, position.trades.length - 1);

  // Calculate total open contracts
  const totalContracts = calculateTotalContracts(position);

  return {
    positionId: position.id,
    symbol: position.symbol,
    structure: position.structure,
    runningPnL: pnl,
    daysToExpiration: dte,
    adjustmentCount,
    isOpen: position.isOpen,
    totalContracts,
  };
}

export function getPortfolioSummary(positions: Position[]): PortfolioSummary {
  const openPositions = positions.filter((p) => p.isOpen);
  const closedPositions = positions.filter((p) => !p.isOpen);

  const openPnL = openPositions.reduce(
    (total, pos) => total + calculatePositionPnL(pos),
    0
  );

  const closedPnL = closedPositions.reduce(
    (total, pos) => total + calculatePositionPnL(pos),
    0
  );

  const totalTrades = positions.reduce(
    (total, pos) => total + pos.trades.length,
    0
  );

  return {
    totalPositionCount: positions.length,
    activePositionCount: openPositions.length,
    totalTradeCount: totalTrades,
    openPnL,
    closedPnL,
  };
}

export function getServiceSummary(service: Service): ServiceSummary {
  const portfolioSummary = getPortfolioSummary(service.portfolio.positions);

  return {
    id: service.id,
    name: service.name,
    totalPositionCount: portfolioSummary.totalPositionCount,
    activePositionCount: portfolioSummary.activePositionCount,
    totalTradeCount: portfolioSummary.totalTradeCount,
    openPnL: portfolioSummary.openPnL,
    closedPnL: portfolioSummary.closedPnL,
  };
}

export function getTotalSummary(services: Service[]): PortfolioSummary {
  const allPositions = services.flatMap((s) => s.portfolio.positions);
  return getPortfolioSummary(allPositions);
}
