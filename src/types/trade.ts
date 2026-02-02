export type TradeAction = 'BUY' | 'SELL';

export type OptionType = 'CALL' | 'PUT';

export type SpreadType =
  | 'SINGLE'
  | 'VERTICAL'
  | 'CALENDAR'
  | 'DIAGONAL'
  | 'STRADDLE'
  | 'STRANGLE'
  | 'BUTTERFLY'
  | 'CONDOR'
  | 'IRON_CONDOR'
  | 'RATIO'
  | 'BACKRATIO'
  | 'CUSTOM'
  | 'ROLL';

export type OrderType = 'LMT' | 'MKT' | 'STP' | 'STP LMT';

export type LegAction = 'OPEN' | 'CLOSE';

export interface OptionLeg {
  quantity: number;
  expiration: Date;
  strike: number;
  optionType: OptionType;
  legAction?: LegAction;
}

export interface Trade {
  id: string;
  rawInput: string;
  action: TradeAction;
  totalQuantity: number;
  symbol: string;
  multiplier: number;
  isWeekly: boolean;
  spreadType: SpreadType;
  legs: OptionLeg[];
  price: number;
  orderType: OrderType;
  isGTC: boolean;
  positionId?: number;
  tradeDate: Date;
}

export type MarkSource = 'manual' | 'schwab';

export interface Position {
  id: number;
  symbol: string;
  trades: Trade[];
  isOpen: boolean;
  openDate: Date;
  closeDate?: Date;
  structure: SpreadType;
  // Mark-to-market fields
  markValue?: number;       // Current total value of position (manual entry)
  markPrice?: number;       // Current mid-price per contract (for API-based marks)
  markDate?: Date;          // When the mark was last updated
  markSource?: MarkSource;  // How the mark was obtained
  // Tax tracking
  isTaxable?: boolean;      // Whether P&L is taxable (default true)
  // Schwab integration
  schwabAccountId?: string; // Which Schwab account this position is in
}

export interface Portfolio {
  positions: Position[];
  nextPositionId: number;
}

export interface Service {
  id: string;
  name: string;
  portfolio: Portfolio;
  createdAt: Date;
}

export interface ServiceSummary {
  id: string;
  name: string;
  totalPositionCount: number;
  activePositionCount: number;
  totalTradeCount: number;
  openPnL: number;
  closedPnL: number;
}

export interface AppData {
  services: Service[];
  appTitle?: string;
  tradeHistory?: TradeStringEntry[];
}

export interface PositionSummary {
  positionId: number;
  symbol: string;
  structure: SpreadType;
  runningPnL: number;
  daysToExpiration: number;
  adjustmentCount: number;
  isOpen: boolean;
  totalContracts: number;
}

export interface PortfolioSummary {
  totalPositionCount: number;
  activePositionCount: number;
  totalTradeCount: number;
  openPnL: number;
  closedPnL: number;
}

export interface ClosedPnLByPeriod {
  all: number;
  last30: number;
  currentYear: number;
  previousYear: number;
}

export interface TradeStringEntry {
  id: string;
  serviceId: string;
  tradeString: string;
  enteredDate: Date;
  positionId: number;
}

// Schwab Integration Types
export interface SchwabAccount {
  accountId: string;
  accountNumber: string;  // Masked account number for display (e.g., "****1234")
  displayName: string;    // User-friendly name
}

export interface SchwabSettings {
  enabled: boolean;
  accounts: SchwabAccount[];
}

export interface SchwabPositionLeg {
  symbol: string;
  quantity: number;
  marketValue: number;
  optionType?: 'CALL' | 'PUT';
  strikePrice?: number;
  expirationDate?: string;
}

export interface SchwabNetLiqResult {
  netLiq: number;
  timestamp: Date;
  matchedLegs: number;
  totalLegs: number;
}
