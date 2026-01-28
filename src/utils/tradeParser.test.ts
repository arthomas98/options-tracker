import { parseThinkorswimTrade } from './tradeParser';

const testCases = [
  {
    input: 'BUY +2 BE 100 15 JAN 27 50 CALL @52.60 LMT',
    expected: {
      action: 'BUY',
      totalQuantity: 2,
      symbol: 'BE',
      multiplier: 100,
      spreadType: 'SINGLE',
      price: 52.60,
      legsCount: 1,
    },
  },
  {
    input: 'SELL -7 2/2/-1/-1 CUSTOM GOOGL 100 (Weeklys) 6 FEB 26/6 FEB 26/30 JAN 26/30 JAN 26 355/295/355/295 CALL/PUT/CALL/PUT @11.99 LMT GTC',
    expected: {
      action: 'SELL',
      totalQuantity: 7,
      symbol: 'GOOGL',
      multiplier: 100,
      spreadType: 'CUSTOM',
      price: 11.99,
      isWeekly: true,
      isGTC: true,
      legsCount: 4,
    },
  },
  {
    input: 'SELL -4 CALENDAR SHOP 100 (Weeklys) 13 FEB 26/16 JAN 26 160 PUT @6.75 LMT',
    expected: {
      action: 'SELL',
      totalQuantity: 4,
      symbol: 'SHOP',
      spreadType: 'CALENDAR',
      price: 6.75,
      isWeekly: true,
      legsCount: 2,
    },
  },
  {
    input: 'SELL -20 VERT ROLL RUT 100 (Weeklys) 20 FEB 26/30 JAN 26 2730/2740/2730/2740 CALL @.40 LMT',
    expected: {
      action: 'SELL',
      totalQuantity: 20,
      symbol: 'RUT',
      spreadType: 'ROLL',
      price: 0.40,
      legsCount: 4,
    },
  },
  {
    input: 'SELL -4 CALENDAR SHOP 100 15 MAY 26/13 FEB 26 160 PUT @7.15 LMT',
    expected: {
      action: 'SELL',
      totalQuantity: 4,
      symbol: 'SHOP',
      spreadType: 'CALENDAR',
      price: 7.15,
      legsCount: 2,
    },
  },
  {
    input: 'SELL -2 CL 100 20 MAR 26 85 CALL @3.55 LMT',
    expected: {
      action: 'SELL',
      totalQuantity: 2,
      symbol: 'CL',
      spreadType: 'SINGLE',
      price: 3.55,
      legsCount: 1,
    },
  },
  {
    input: 'BUY +10 HIMS 100 18 SEP 26 40 CALL @5.45 LMT',
    expected: {
      action: 'BUY',
      totalQuantity: 10,
      symbol: 'HIMS',
      spreadType: 'SINGLE',
      price: 5.45,
      legsCount: 1,
    },
  },
  {
    input: 'SELL -2 1/3 BACKRATIO AMZN 100 16 JAN 26 247.5/260 CALL @-1.49 LMT',
    expected: {
      action: 'SELL',
      totalQuantity: 2,
      symbol: 'AMZN',
      spreadType: 'BACKRATIO',
      price: -1.49,
      legsCount: 2,
    },
  },
];

export function runParserTests(): { passed: number; failed: number; results: string[] } {
  let passed = 0;
  let failed = 0;
  const results: string[] = [];

  for (const testCase of testCases) {
    const trade = parseThinkorswimTrade(testCase.input);

    if (!trade) {
      results.push(`FAIL: Could not parse: ${testCase.input}`);
      failed++;
      continue;
    }

    const errors: string[] = [];

    if (trade.action !== testCase.expected.action) {
      errors.push(`action: got ${trade.action}, expected ${testCase.expected.action}`);
    }
    if (trade.totalQuantity !== testCase.expected.totalQuantity) {
      errors.push(`quantity: got ${trade.totalQuantity}, expected ${testCase.expected.totalQuantity}`);
    }
    if (trade.symbol !== testCase.expected.symbol) {
      errors.push(`symbol: got ${trade.symbol}, expected ${testCase.expected.symbol}`);
    }
    if (trade.spreadType !== testCase.expected.spreadType) {
      errors.push(`spreadType: got ${trade.spreadType}, expected ${testCase.expected.spreadType}`);
    }
    if (trade.price !== testCase.expected.price) {
      errors.push(`price: got ${trade.price}, expected ${testCase.expected.price}`);
    }
    if (trade.legs.length !== testCase.expected.legsCount) {
      errors.push(`legs: got ${trade.legs.length}, expected ${testCase.expected.legsCount}`);
    }
    if (testCase.expected.isWeekly !== undefined && trade.isWeekly !== testCase.expected.isWeekly) {
      errors.push(`isWeekly: got ${trade.isWeekly}, expected ${testCase.expected.isWeekly}`);
    }
    if (testCase.expected.isGTC !== undefined && trade.isGTC !== testCase.expected.isGTC) {
      errors.push(`isGTC: got ${trade.isGTC}, expected ${testCase.expected.isGTC}`);
    }

    if (errors.length === 0) {
      results.push(`PASS: ${trade.symbol} ${trade.spreadType}`);
      passed++;
    } else {
      results.push(`FAIL: ${testCase.input.substring(0, 50)}...`);
      errors.forEach(e => results.push(`  - ${e}`));
      failed++;
    }
  }

  return { passed, failed, results };
}
