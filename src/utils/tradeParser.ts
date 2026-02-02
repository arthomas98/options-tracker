import type {
  Trade,
  TradeAction,
  OptionType,
  SpreadType,
  OrderType,
  OptionLeg,
  LegAction,
} from '../types/trade';

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function parseDate(day: string, month: string, year: string): Date | null {
  const monthNum = MONTHS[month.toUpperCase()];
  if (monthNum === undefined) {
    return null;
  }
  let yearNum = parseInt(year, 10);
  if (isNaN(yearNum)) {
    return null;
  }
  if (yearNum < 100) {
    yearNum += 2000;
  }
  const dayNum = parseInt(day, 10);
  if (isNaN(dayNum)) {
    return null;
  }
  return new Date(yearNum, monthNum, dayNum);
}

function detectSpreadType(input: string, legCount: number): SpreadType {
  const upperInput = input.toUpperCase();

  if (upperInput.includes('ROLL')) return 'ROLL';
  if (upperInput.includes('CALENDAR')) return 'CALENDAR';
  if (upperInput.includes('DIAGONAL')) return 'DIAGONAL';
  if (upperInput.includes('VERT')) return 'VERTICAL';
  if (upperInput.includes('BUTTERFLY') || upperInput.includes('FLY')) return 'BUTTERFLY';
  if (upperInput.includes('CONDOR')) return 'CONDOR';
  if (upperInput.includes('IRON CONDOR') || upperInput.includes('IC')) return 'IRON_CONDOR';
  if (upperInput.includes('STRADDLE')) return 'STRADDLE';
  if (upperInput.includes('STRANGLE')) return 'STRANGLE';
  if (upperInput.includes('CUSTOM')) return 'CUSTOM';
  if (upperInput.includes('BACKRATIO')) return 'BACKRATIO';
  if (upperInput.includes('RATIO')) return 'RATIO';

  if (legCount === 1) return 'SINGLE';
  if (legCount === 2) return 'VERTICAL';
  if (legCount === 4) return 'IRON_CONDOR';

  return 'CUSTOM';
}

export function parseThinkorswimTrade(input: string): Trade | null {
  try {
    let raw = input.trim();
    if (!raw) return null;

    // Strip any text before BUY or SELL (e.g., "(Replacing #1005300447572) SELL...")
    const buyOrSellIndex = raw.search(/\b(BUY|SELL)\s+/i);
    if (buyOrSellIndex > 0) {
      raw = raw.substring(buyOrSellIndex);
    }

    // Normalize backslash escapes
    const normalized = raw.replace(/\\([+-])/g, '$1');

    // Extract action (BUY/SELL)
    const actionMatch = normalized.match(/^(BUY|SELL)\s+/i);
    if (!actionMatch) return null;
    const action = actionMatch[1].toUpperCase() as TradeAction;

    // Extract quantity (e.g., +2, -7)
    const qtyMatch = normalized.match(/(?:BUY|SELL)\s+([+-]?\d+)/i);
    if (!qtyMatch) return null;
    const totalQuantity = Math.abs(parseInt(qtyMatch[1], 10));

    // Check for ratio pattern (e.g., 1/3, 2/2/-1/-1, 1/3/2)
    // Ratio appears immediately after BUY/SELL quantity and before spread type
    // Ratio numbers are small (1-2 digits), not strike prices
    // ~BUTTERFLY indicates unbalanced butterfly
    const ratioMatch = normalized.match(/(?:BUY|SELL)\s+[+-]?\d+\s+(-?\d{1,2}\/-?\d{1,2}(?:\/-?\d{1,2})*)\s+~?(?:CUSTOM|BACKRATIO|RATIO|BUTTERFLY|FLY)/i);
    const ratios = ratioMatch ? ratioMatch[1].split('/').map(r => parseInt(r, 10)) : null;

    // Extract price (@52.60 or @-1.49 for credits)
    const priceMatch = normalized.match(/@(-?\d*\.?\d+)/);
    if (!priceMatch) return null;
    const price = parseFloat(priceMatch[1]);

    // Check for GTC
    const isGTC = /\bGTC\b/i.test(normalized);

    // Extract order type
    let orderType: OrderType = 'LMT';
    if (/\bMKT\b/i.test(normalized)) orderType = 'MKT';
    else if (/\bSTP LMT\b/i.test(normalized)) orderType = 'STP LMT';
    else if (/\bSTP\b/i.test(normalized)) orderType = 'STP';

    // Check for weeklys
    const isWeekly = /\(Weeklys?\)/i.test(normalized);

    // Extract multiplier (usually 100, but futures use format like 1/50)
    // Futures format: 1/50 means multiplier of 50
    // Equity format: 100 means multiplier of 100
    let multiplier = 100;
    const futuresMultiplierMatch = normalized.match(/\b(\d+)\/(\d+)\s+(?:\d{1,2}\s+[A-Z]{3}\s+\d{2})/i);
    if (futuresMultiplierMatch) {
      multiplier = parseInt(futuresMultiplierMatch[2], 10);
    } else {
      const equityMultiplierMatch = normalized.match(/\b(\d+)\s+(?:\(Weeklys?\)\s+)?(?:\d{1,2}\s+[A-Z]{3}\s+\d{2})/i);
      if (equityMultiplierMatch) {
        multiplier = parseInt(equityMultiplierMatch[1], 10);
      }
    }

    // Extract symbol - it comes after the quantity/ratio/spread-type and before the multiplier
    // Pattern: after BUY/SELL +N [ratio] [spread-type] SYMBOL 100 or SYMBOL 1/50
    // Supports both equity symbols (AAPL, GOOGL) and futures symbols (/ES, /ESZ25)
    let symbol = '';

    // Symbol pattern: either /LETTERS+NUMBERS (futures) or LETTERS only (equity)
    // Futures: /ES, /ESZ25, /CLX24
    // Equity: AAPL, GOOGL, SPY
    const symbolRegex = '(\\/[A-Z]+[A-Z0-9]*|[A-Z]{1,5})';

    // Try to match symbol patterns
    // Note: ~ prefix indicates unbalanced spread (e.g., ~BUTTERFLY)
    const symbolPatterns = [
      // Custom spread: SELL -7 2/2/-1/-1 CUSTOM GOOGL 100 or BUY +2 1/-2/2 CUSTOM /ESZ25 1/50
      new RegExp(`~?(?:CUSTOM|VERT|VERTICAL|CALENDAR|DIAGONAL|BUTTERFLY|FLY|CONDOR|STRADDLE|STRANGLE|BACKRATIO|RATIO|ROLL)\\s+${symbolRegex}\\s+\\d+`, 'i'),
      // Simple spread with type: SELL -4 CALENDAR SHOP 100 or SELL -2 1/3 BACKRATIO AMZN 100
      new RegExp(`[+-]?\\d+\\s+(?:\\d+\\/[\\d/]+\\s+)?~?(?:VERT(?:ICAL)?|CALENDAR|DIAGONAL|BUTTERFLY|FLY|CONDOR|IC|STRADDLE|STRANGLE|BACKRATIO|RATIO)\\s+(?:ROLL\\s+)?${symbolRegex}\\s+\\d+`, 'i'),
      // Roll pattern: SELL -20 VERT ROLL RUT 100
      new RegExp(`ROLL\\s+${symbolRegex}\\s+\\d+`, 'i'),
      // Simple option: BUY +2 BE 100 or BUY +2 /ESZ25 1/50
      new RegExp(`(?:BUY|SELL)\\s+[+-]?\\d+\\s+${symbolRegex}\\s+\\d+`, 'i'),
    ];

    for (const pattern of symbolPatterns) {
      const match = normalized.match(pattern);
      if (match) {
        symbol = match[1].toUpperCase();
        break;
      }
    }

    if (!symbol) {
      // Fallback: find symbol between quantity and multiplier
      const fallbackMatch = normalized.match(new RegExp(`[+-]?\\d+\\s+(?:\\d+\\/[^\\s]+\\s+)?(?:CUSTOM\\s+)?${symbolRegex}\\s+\\d+`, 'i'));
      if (fallbackMatch) {
        symbol = fallbackMatch[1].toUpperCase();
      }
    }

    if (!symbol) return null;

    // Extract dates, strikes, and option types
    // Date format: DD MMM YY (e.g., 15 JAN 27, 6 FEB 26)
    const datePattern = /(\d{1,2})\s+([A-Z]{3})\s+(\d{2})/gi;
    const dates: Date[] = [];
    let dateMatch;
    while ((dateMatch = datePattern.exec(normalized)) !== null) {
      const parsedDate = parseDate(dateMatch[1], dateMatch[2], dateMatch[3]);
      if (parsedDate) {
        dates.push(parsedDate);
      }
    }

    // Extract strikes - numbers that appear after dates and before CALL/PUT
    // Look for the strike pattern after the last date (handles decimals like 247.5)
    // Also handles [AM] or [PM] suffix on dates (e.g., "18 JUN 26 [AM]")
    const strikesMatch = normalized.match(/\d{2}(?:\s+\[(?:AM|PM)\])?\s+([\d.]+(?:\/[\d.]+)*)\s+(?:CALL|PUT)/i);
    const strikes = strikesMatch
      ? strikesMatch[1].split('/').map(s => parseFloat(s))
      : [];

    // Extract option types (CALL/PUT)
    const optionTypesMatch = normalized.match(/((?:CALL|PUT)(?:\/(?:CALL|PUT))*)/i);
    const optionTypes: OptionType[] = optionTypesMatch
      ? optionTypesMatch[1].toUpperCase().split('/') as OptionType[]
      : [];

    // Detect spread type early for leg quantity calculation
    const spreadType = detectSpreadType(normalized, Math.max(dates.length, strikes.length, optionTypes.length, ratios?.length || 1));

    // Build legs
    const legs: OptionLeg[] = [];
    const legCount = Math.max(dates.length, strikes.length, optionTypes.length, ratios?.length || 1);

    // Check if ratios have explicit signs (any negative values)
    const ratiosHaveExplicitSigns = ratios?.some(r => r < 0) ?? false;
    const actionSign = action === 'BUY' ? 1 : -1;

    for (let i = 0; i < legCount; i++) {
      let legQty: number;
      if (ratios) {
        const ratio = ratios[i % ratios.length];
        if (ratiosHaveExplicitSigns) {
          // Ratios have explicit signs (e.g., 2/2/-1/-1)
          // The signs represent the spread structure; action determines if we're buying or selling it
          // BUY: use ratios as-is; SELL: flip all signs
          legQty = ratio * actionSign;
        } else if (spreadType === 'BACKRATIO') {
          // BACKRATIO (back spread): sell lower strike, buy more of higher strike
          // Ratio like 1/3 means sell 1 of lower, buy 3 of higher
          // BUY backratio: -first, +second (opening the spread)
          // SELL backratio: +first, -second (closing the spread)
          legQty = (i === 0 ? -ratio : ratio) * actionSign;
        } else if (spreadType === 'BUTTERFLY') {
          // BUTTERFLY with ratios (e.g., 1/3/2 for unbalanced)
          // Pattern: buy wings (+), sell body (-)
          // BUY BUTTERFLY: +first, -middle, +last
          // SELL BUTTERFLY: -first, +middle, -last
          const isWing = i === 0 || i === ratios.length - 1;
          if (action === 'BUY') {
            legQty = isWing ? ratio : -ratio;
          } else {
            legQty = isWing ? -ratio : ratio;
          }
        } else {
          // Other spreads without explicit signs: apply action sign
          legQty = ratio * actionSign;
        }
      } else if (spreadType === 'CALENDAR' || spreadType === 'DIAGONAL') {
        // CALENDAR/DIAGONAL: dates are listed far-term first, near-term second
        // SELL calendar: sell far (-), buy near (+) - rolling forward
        // BUY calendar: buy far (+), sell near (-) - opening calendar
        // Leg 0 = far-term, Leg 1 = near-term
        if (action === 'SELL') {
          legQty = i === 0 ? -1 : 1;  // sell far, buy near
        } else {
          legQty = i === 0 ? 1 : -1;  // buy far, sell near
        }
      } else if (spreadType === 'ROLL') {
        // ROLL: rolling a vertical spread to new expiration (4 legs)
        // Pattern: new position (far date) then close old position (near date)
        // SELL ROLL: open new short vertical, close old short vertical
        //   Leg 0 (far, lower strike): -1 (sell to open)
        //   Leg 1 (far, higher strike): +1 (buy to open)
        //   Leg 2 (near, lower strike): +1 (buy to close)
        //   Leg 3 (near, higher strike): -1 (sell to close)
        // BUY ROLL: opposite signs
        const rollPattern = action === 'SELL' ? [-1, 1, 1, -1] : [1, -1, -1, 1];
        legQty = rollPattern[i % rollPattern.length];
      } else if (spreadType === 'BUTTERFLY' && legCount === 3) {
        // Balanced BUTTERFLY without explicit ratios: 1/2/1 pattern
        // BUY BUTTERFLY: +1, -2, +1 (buy wings, sell 2x body)
        // SELL BUTTERFLY: -1, +2, -1 (sell wings, buy 2x body)
        const isWing = i === 0 || i === 2;
        if (action === 'BUY') {
          legQty = isWing ? 1 : -2;
        } else {
          legQty = isWing ? -1 : 2;
        }
      } else if (spreadType === 'VERTICAL' && legCount === 2) {
        // VERTICAL spread: buy one strike, sell the other
        // BUY VERTICAL (debit spread): +lower, -higher
        // SELL VERTICAL (credit spread): -lower, +higher
        if (action === 'BUY') {
          legQty = i === 0 ? 1 : -1;
        } else {
          legQty = i === 0 ? -1 : 1;
        }
      } else {
        legQty = actionSign;
      }

      // Determine expiration for this leg
      let expiration: Date;
      if (dates.length === 0) {
        expiration = new Date();
      } else if (spreadType === 'ROLL' && dates.length === 2 && legCount === 4) {
        // ROLL: first 2 legs use far date, last 2 legs use near date
        expiration = i < 2 ? dates[0] : dates[1];
      } else {
        expiration = dates[i % dates.length] || dates[0];
      }

      // Determine if this leg is opening or closing a position
      let legAction: LegAction | undefined;
      if (spreadType === 'ROLL') {
        // ROLL: first 2 legs (far date) are opening, last 2 legs (near date) are closing
        legAction = i < 2 ? 'OPEN' : 'CLOSE';
      } else if (spreadType === 'CALENDAR' || spreadType === 'DIAGONAL') {
        // CALENDAR/DIAGONAL SELL: far leg opens, near leg closes
        // CALENDAR/DIAGONAL BUY: far leg opens, near leg opens (new position)
        if (action === 'SELL') {
          legAction = i === 0 ? 'OPEN' : 'CLOSE';
        }
      }

      legs.push({
        quantity: legQty * totalQuantity,
        expiration,
        strike: strikes[i % strikes.length] || strikes[0] || 0,
        optionType: optionTypes[i % optionTypes.length] || optionTypes[0] || 'CALL',
        legAction,
      });
    }

    return {
      id: generateId(),
      rawInput: raw,
      action,
      totalQuantity,
      symbol,
      multiplier,
      isWeekly,
      spreadType,
      legs,
      price,
      orderType,
      isGTC,
      tradeDate: new Date(),
    };
  } catch (error) {
    console.error('Failed to parse trade:', input, error);
    return null;
  }
}

export function calculateTradeCost(trade: Trade): number {
  const sign = trade.action === 'BUY' ? -1 : 1;
  return sign * trade.price * trade.totalQuantity * trade.multiplier;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: Date): string {
  if (!date || isNaN(date.getTime())) {
    return 'Invalid Date';
  }
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  }).format(date);
}

export function getDaysToExpiration(date: Date): number {
  if (!date || isNaN(date.getTime())) {
    return 0;
  }
  const now = new Date();
  const diffTime = date.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
