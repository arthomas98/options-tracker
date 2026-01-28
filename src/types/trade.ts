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
