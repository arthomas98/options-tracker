/**
 * Date Correction Script
 *
 * This script matches trades from the Options Tracker app against Schwab transaction history
 * to determine correct trade dates and generate corrections.
 *
 * Usage: node scripts/date-correction.js
 */

const fs = require('fs');
const path = require('path');

// File paths
const DOWNLOADS_DIR = '/Users/robthomas/Downloads';
const POSITIONS_FILE = path.join(DOWNLOADS_DIR, 'Options Tracker Data - Positions.csv');
const TRADES_FILE = path.join(DOWNLOADS_DIR, 'Options Tracker Data - Trades.csv');
const LEGS_FILE = path.join(DOWNLOADS_DIR, 'Options Tracker Data - Legs.csv');

// Schwab transaction files
const SCHWAB_FILES = [
  path.join(DOWNLOADS_DIR, 'Roth_Contributory_IRA_XXX368_Transactions_20260128-154925.csv'),
  path.join(DOWNLOADS_DIR, 'Rollover_IRA_XXX287_Transactions_20260128-154905.csv'),
  path.join(DOWNLOADS_DIR, 'Living_Trust_XXX913_Transactions_20260128-154837.csv'),
];

// Service ID to Account mapping (you may need to adjust these)
const SERVICE_ACCOUNT_MAP = {
  '1769399233869-dlkyrol': 'Rollover_IRA',      // Based on COST, SBUX, RUT trades
  '1769399242120-5c9z6xp': 'Rollover_IRA',      // Based on IBIT, GLD trades
  '1769399261497-2l7eyvx': 'Rollover_IRA',      // Based on YETI, TQQQ, etc
  '1769399284583-2fabyen': 'Rollover_IRA',      // Based on FRO, WMB trades
  '1769399337399-lyoaffo': 'Rollover_IRA',      // Based on GE, AAPL, GOOGL custom trades
  '1769399349083-ntq638m': 'Living_Trust',      // Based on SPX trades
  '1769399407794-msjt4hz': 'Rollover_IRA',      // Based on AMZN, BA trades
  '1769399422672-830lv5b': 'Rollover_IRA',      // Based on BE, MRK trades
  '1769491843922-5mct899': 'Rollover_IRA',      // Based on OIH, BX trades
};

// Parse CSV file
function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  return rows;
}

// Parse a single CSV line (handling quoted values)
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result;
}

// Parse Schwab date format (MM/DD/YYYY or "MM/DD/YYYY as of MM/DD/YYYY")
function parseSchwabDate(dateStr) {
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  return new Date(parseInt(match[3]), parseInt(match[1]) - 1, parseInt(match[2]));
}

// Parse option symbol from Schwab format
// Example: "TSLA 08/21/2026 520.00 C" -> { symbol: 'TSLA', expiration: Date, strike: 520, optionType: 'CALL' }
function parseSchwabOption(symbolStr) {
  const match = symbolStr.match(/^([A-Z]+)\s+(\d{2}\/\d{2}\/\d{4})\s+([\d.]+)\s+([CP])$/);
  if (!match) return null;

  return {
    symbol: match[1],
    expiration: parseSchwabDate(match[2]),
    strike: parseFloat(match[3]),
    optionType: match[4] === 'C' ? 'CALL' : 'PUT',
  };
}

// Extract symbol from trade raw input
function extractSymbol(rawInput) {
  // Try to find symbol in various patterns
  const patterns = [
    /(?:BUY|SELL)\s+[+-]?\d+\s+(?:\d+\/[\d/-]+\s+)?(?:~?(?:CUSTOM|VERT(?:ICAL)?|CALENDAR|DIAGONAL|BUTTERFLY|FLY|CONDOR|IC|STRADDLE|STRANGLE|BACKRATIO|RATIO|ROLL)\s+)?([A-Z]{1,5})\s+\d+/i,
    /(?:BUY|SELL)\s+[+-]?\d+\s+([A-Z]{1,5})\s+\d+/i,
  ];

  for (const pattern of patterns) {
    const match = rawInput.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

// Load all data
function loadData() {
  console.log('Loading data files...\n');

  // Load app data
  const positions = parseCSV(fs.readFileSync(POSITIONS_FILE, 'utf-8'));
  const trades = parseCSV(fs.readFileSync(TRADES_FILE, 'utf-8'));
  const legs = parseCSV(fs.readFileSync(LEGS_FILE, 'utf-8'));

  console.log(`Loaded ${positions.length} positions, ${trades.length} trades, ${legs.length} legs from app data\n`);

  // Load Schwab transactions
  const schwabTransactions = [];
  for (const file of SCHWAB_FILES) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const transactions = parseCSV(content);
      const accountName = path.basename(file).split('_')[0] + '_' + path.basename(file).split('_')[1];
      transactions.forEach(t => {
        t._account = accountName;
        t._date = parseSchwabDate(t.Date);
      });
      schwabTransactions.push(...transactions);
      console.log(`Loaded ${transactions.length} transactions from ${path.basename(file)}`);
    } catch (err) {
      console.error(`Error loading ${file}:`, err.message);
    }
  }

  console.log(`\nTotal Schwab transactions: ${schwabTransactions.length}\n`);

  return { positions, trades, legs, schwabTransactions };
}

// Find matching Schwab transaction for a trade
function findMatchingSchwabTransaction(trade, legs, schwabTransactions) {
  const symbol = trade.symbol;
  const action = trade.action.toUpperCase();
  const quantity = parseInt(trade.totalQuantity);
  const price = parseFloat(trade.price);

  // Get the trade's legs for more precise matching
  const tradeLegs = legs.filter(l => l.tradeId === trade.id);

  // Look for matching transactions
  const candidates = schwabTransactions.filter(t => {
    // Skip non-option transactions
    if (!t.Symbol || !t.Symbol.includes('/')) return false;

    const optionInfo = parseSchwabOption(t.Symbol);
    if (!optionInfo || optionInfo.symbol !== symbol) return false;

    // Check action matches
    const schwabAction = t.Action.includes('Buy') ? 'BUY' : 'SELL';
    if (schwabAction !== action) return false;

    // Check quantity is close
    const schwabQty = parseInt(t.Quantity);
    if (Math.abs(schwabQty - quantity) > quantity * 0.5) return false;

    // Check price is close (within 20%)
    const schwabPrice = parseFloat(t.Price.replace('$', ''));
    if (Math.abs(schwabPrice - price) > price * 0.3) return false;

    return true;
  });

  if (candidates.length > 0) {
    // Sort by date (most recent first) and return the best match
    candidates.sort((a, b) => b._date - a._date);
    return candidates[0];
  }

  return null;
}

// Analyze and generate corrections
function analyzeAndCorrect(data) {
  const { positions, trades, legs, schwabTransactions } = data;

  console.log('='.repeat(80));
  console.log('TRADE DATE ANALYSIS');
  console.log('='.repeat(80));
  console.log();

  const corrections = [];
  const unmatched = [];

  // Group trades by position
  const tradesByPosition = {};
  trades.forEach(trade => {
    const key = `${trade.serviceId}-${trade.positionId}`;
    if (!tradesByPosition[key]) tradesByPosition[key] = [];
    tradesByPosition[key].push(trade);
  });

  // Process each position
  positions.forEach(position => {
    const posKey = `${position.serviceId}-${position.id}`;
    const posTrades = tradesByPosition[posKey] || [];

    if (posTrades.length === 0) return;

    console.log(`\nPosition ${position.id}: ${position.symbol} (${position.structure})`);
    console.log(`  Service: ${position.serviceId}`);
    console.log(`  Status: ${position.isOpen === 'TRUE' ? 'Open' : 'Closed'}`);
    console.log(`  Current Open Date: ${position.openDate}`);
    if (position.closeDate) console.log(`  Current Close Date: ${position.closeDate}`);

    let earliestTradeDate = null;
    let latestTradeDate = null;

    posTrades.forEach((trade, idx) => {
      const tradeLegs = legs.filter(l => l.tradeId === trade.id);
      console.log(`\n  Trade ${idx + 1}: ${trade.action} ${trade.totalQuantity} @ $${trade.price}`);
      console.log(`    Current Date: ${trade.tradeDate}`);
      console.log(`    Raw: ${trade.rawInput.substring(0, 60)}...`);

      // Try to find matching Schwab transaction
      const match = findMatchingSchwabTransaction(trade, tradeLegs, schwabTransactions);

      if (match) {
        console.log(`    MATCH FOUND: ${match.Date} - ${match.Action} ${match.Quantity} @ ${match.Price}`);
        console.log(`    Account: ${match._account}`);

        const correctDate = match._date;
        if (correctDate) {
          if (!earliestTradeDate || correctDate < earliestTradeDate) {
            earliestTradeDate = correctDate;
          }
          if (!latestTradeDate || correctDate > latestTradeDate) {
            latestTradeDate = correctDate;
          }

          corrections.push({
            type: 'trade',
            positionId: position.id,
            serviceId: position.serviceId,
            tradeId: trade.id,
            symbol: trade.symbol,
            currentDate: trade.tradeDate,
            correctDate: correctDate.toISOString(),
            schwabTransaction: match,
          });
        }
      } else {
        console.log(`    NO MATCH FOUND`);
        unmatched.push({
          positionId: position.id,
          tradeId: trade.id,
          symbol: trade.symbol,
          action: trade.action,
          quantity: trade.totalQuantity,
          price: trade.price,
        });
      }
    });

    // Position date corrections
    if (earliestTradeDate) {
      corrections.push({
        type: 'position_open',
        positionId: position.id,
        serviceId: position.serviceId,
        symbol: position.symbol,
        currentDate: position.openDate,
        correctDate: earliestTradeDate.toISOString(),
      });
    }

    if (position.isOpen === 'FALSE' && latestTradeDate) {
      corrections.push({
        type: 'position_close',
        positionId: position.id,
        serviceId: position.serviceId,
        symbol: position.symbol,
        currentDate: position.closeDate,
        correctDate: latestTradeDate.toISOString(),
      });
    }
  });

  // Output summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`\nMatched trades: ${corrections.filter(c => c.type === 'trade').length}`);
  console.log(`Unmatched trades: ${unmatched.length}`);
  console.log(`Position open date corrections: ${corrections.filter(c => c.type === 'position_open').length}`);
  console.log(`Position close date corrections: ${corrections.filter(c => c.type === 'position_close').length}`);

  if (unmatched.length > 0) {
    console.log('\nUnmatched trades (may need manual review):');
    unmatched.forEach(u => {
      console.log(`  - Position ${u.positionId}: ${u.symbol} ${u.action} ${u.quantity} @ $${u.price}`);
    });
  }

  // Save corrections to file
  const outputFile = path.join(DOWNLOADS_DIR, 'date-corrections.json');
  fs.writeFileSync(outputFile, JSON.stringify({ corrections, unmatched }, null, 2));
  console.log(`\nCorrections saved to: ${outputFile}`);

  return { corrections, unmatched };
}

// Main execution
function main() {
  console.log('Options Tracker Date Correction Tool');
  console.log('====================================\n');

  try {
    const data = loadData();
    analyzeAndCorrect(data);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
