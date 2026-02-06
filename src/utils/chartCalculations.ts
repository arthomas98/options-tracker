// Chart data calculation utilities for P&L visualizations

import type { Position } from '../types/trade';
import { calculatePositionPnL } from './calculations';

export type ChartType = 'line' | 'bar';
export type ChartPeriod = 'last30' | 'currentYear' | 'previousYear' | 'all';
export type ChartSegment = 'month' | 'week';

export interface ChartDataPoint {
  label: string;
  date: Date;
  value: number;
}

interface ClosedPositionPnL {
  closeDate: Date;
  pnl: number;
}

// Get all closed positions with their P&L and close date
function getClosedPositionPnLs(positions: Position[]): ClosedPositionPnL[] {
  return positions
    .filter((p) => !p.isOpen && p.closeDate)
    .map((p) => ({
      closeDate: p.closeDate!,
      pnl: calculatePositionPnL(p),
    }))
    .sort((a, b) => a.closeDate.getTime() - b.closeDate.getTime());
}

// Get date range for period
function getDateRangeForPeriod(period: ChartPeriod): { start: Date; end: Date } {
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
      const start = new Date(currentYear, 0, 1);
      return { start, end: now };
    }
    case 'previousYear': {
      const start = new Date(currentYear - 1, 0, 1);
      const end = new Date(currentYear - 1, 11, 31, 23, 59, 59, 999);
      return { start, end };
    }
    case 'all':
    default:
      return { start: new Date(0), end: now };
  }
}

// Filter positions by date range
function filterByDateRange(
  data: ClosedPositionPnL[],
  start: Date,
  end: Date
): ClosedPositionPnL[] {
  return data.filter((d) => d.closeDate >= start && d.closeDate <= end);
}

// Format date as YYYY-MM-DD
function formatDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Format date as MMM YYYY
function formatMonthKey(date: Date): string {
  return `${date.toLocaleString('default', { month: 'short' })} ${date.getFullYear()}`;
}

// Get short month label (Jan, Feb, etc.)
function formatShortMonth(date: Date): string {
  return date.toLocaleString('default', { month: 'short' });
}

// Generate all days in range
function generateDaysInRange(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);

  while (current <= end) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

// Generate all months in range
function generateMonthsInRange(start: Date, end: Date): Date[] {
  const months: Date[] = [];
  const current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= end) {
    months.push(new Date(current));
    current.setMonth(current.getMonth() + 1);
  }
  return months;
}

// Get the Monday of the week containing this date
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Format week as "M/D" (start of week)
function formatWeekKey(date: Date): string {
  const weekStart = getWeekStart(date);
  return `${weekStart.getMonth() + 1}/${weekStart.getDate()}/${weekStart.getFullYear()}`;
}

// Format week label as "M/D"
function formatWeekLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// Generate all weeks in range (returns Monday of each week)
function generateWeeksInRange(start: Date, end: Date): Date[] {
  const weeks: Date[] = [];
  const current = getWeekStart(start);

  while (current <= end) {
    weeks.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }
  return weeks;
}

// Calculate cumulative P&L by day for line chart
export function getCumulativePnLByDay(
  positions: Position[],
  period: ChartPeriod
): ChartDataPoint[] {
  const closedPnLs = getClosedPositionPnLs(positions);
  const { start, end } = getDateRangeForPeriod(period);
  const filteredPnLs = filterByDateRange(closedPnLs, start, end);

  // Group P&L by day
  const pnlByDay = new Map<string, number>();
  for (const item of filteredPnLs) {
    const key = formatDateKey(item.closeDate);
    pnlByDay.set(key, (pnlByDay.get(key) || 0) + item.pnl);
  }

  // Calculate P&L before the period started (for cumulative)
  let prePeriodPnL = 0;
  for (const item of closedPnLs) {
    if (item.closeDate < start) {
      prePeriodPnL += item.pnl;
    }
  }

  // Generate data points for each day (or sampled if too many)
  const days = generateDaysInRange(start, end);

  // Sample days if there are too many (for line chart readability)
  let sampledDays = days;
  if (days.length > 60) {
    // Sample every nth day to get roughly 30-60 points
    const step = Math.ceil(days.length / 30);
    sampledDays = days.filter((_, idx) => idx % step === 0 || idx === days.length - 1);
  }

  let cumulative = prePeriodPnL;
  const dataPoints: ChartDataPoint[] = [];
  let dayIdx = 0;

  for (const day of sampledDays) {
    // Add all P&L up to this day
    while (dayIdx < days.length && days[dayIdx] <= day) {
      const key = formatDateKey(days[dayIdx]);
      cumulative += pnlByDay.get(key) || 0;
      dayIdx++;
    }

    dataPoints.push({
      label: period === 'last30'
        ? `${day.getMonth() + 1}/${day.getDate()}`
        : formatShortMonth(day) + (day.getDate() === 1 || day === sampledDays[0] ? ` '${day.getFullYear().toString().slice(2)}` : ''),
      date: day,
      value: cumulative,
    });
  }

  return dataPoints;
}

// Calculate P&L by day for bar chart (last 30 days)
export function getPnLByDay(
  positions: Position[],
  period: 'last30'
): ChartDataPoint[] {
  const closedPnLs = getClosedPositionPnLs(positions);
  const { start, end } = getDateRangeForPeriod(period);
  const filteredPnLs = filterByDateRange(closedPnLs, start, end);

  // Group P&L by day
  const pnlByDay = new Map<string, number>();
  for (const item of filteredPnLs) {
    const key = formatDateKey(item.closeDate);
    pnlByDay.set(key, (pnlByDay.get(key) || 0) + item.pnl);
  }

  // Generate data points for each day
  const days = generateDaysInRange(start, end);
  return days.map((day) => ({
    label: `${day.getMonth() + 1}/${day.getDate()}`,
    date: day,
    value: pnlByDay.get(formatDateKey(day)) || 0,
  }));
}

// Calculate cumulative P&L by month for line chart
export function getCumulativePnLByMonth(
  positions: Position[],
  period: ChartPeriod
): ChartDataPoint[] {
  const closedPnLs = getClosedPositionPnLs(positions);
  const { start, end } = getDateRangeForPeriod(period);
  const filteredPnLs = filterByDateRange(closedPnLs, start, end);

  // Group P&L by month
  const pnlByMonth = new Map<string, number>();
  for (const item of filteredPnLs) {
    const key = formatMonthKey(item.closeDate);
    pnlByMonth.set(key, (pnlByMonth.get(key) || 0) + item.pnl);
  }

  // Calculate P&L before the period started (for cumulative)
  let prePeriodPnL = 0;
  for (const item of closedPnLs) {
    if (item.closeDate < start) {
      prePeriodPnL += item.pnl;
    }
  }

  // Generate data points for each month
  const months = generateMonthsInRange(start, end);
  let cumulative = prePeriodPnL;

  return months.map((month) => {
    const key = formatMonthKey(month);
    cumulative += pnlByMonth.get(key) || 0;
    return {
      label: formatShortMonth(month) + (month.getMonth() === 0 ? ` '${month.getFullYear().toString().slice(2)}` : ''),
      date: month,
      value: cumulative,
    };
  });
}

// Calculate P&L by month for bar chart
export function getPnLByMonth(
  positions: Position[],
  period: ChartPeriod
): ChartDataPoint[] {
  const closedPnLs = getClosedPositionPnLs(positions);
  const { start, end } = getDateRangeForPeriod(period);
  const filteredPnLs = filterByDateRange(closedPnLs, start, end);

  // Group P&L by month
  const pnlByMonth = new Map<string, number>();
  for (const item of filteredPnLs) {
    const key = formatMonthKey(item.closeDate);
    pnlByMonth.set(key, (pnlByMonth.get(key) || 0) + item.pnl);
  }

  // Generate data points for each month
  const months = generateMonthsInRange(start, end);
  return months.map((month) => {
    const key = formatMonthKey(month);
    return {
      label: formatShortMonth(month) + (month.getMonth() === 0 ? ` '${month.getFullYear().toString().slice(2)}` : ''),
      date: month,
      value: pnlByMonth.get(key) || 0,
    };
  });
}

// Calculate cumulative P&L by week for line chart
export function getCumulativePnLByWeek(
  positions: Position[],
  period: ChartPeriod
): ChartDataPoint[] {
  const closedPnLs = getClosedPositionPnLs(positions);
  const { start, end } = getDateRangeForPeriod(period);
  const filteredPnLs = filterByDateRange(closedPnLs, start, end);

  // Group P&L by week
  const pnlByWeek = new Map<string, number>();
  for (const item of filteredPnLs) {
    const key = formatWeekKey(item.closeDate);
    pnlByWeek.set(key, (pnlByWeek.get(key) || 0) + item.pnl);
  }

  // Calculate P&L before the period started (for cumulative)
  let prePeriodPnL = 0;
  for (const item of closedPnLs) {
    if (item.closeDate < start) {
      prePeriodPnL += item.pnl;
    }
  }

  // Generate data points for each week
  const weeks = generateWeeksInRange(start, end);
  let cumulative = prePeriodPnL;

  return weeks.map((week) => {
    const key = formatWeekKey(week);
    cumulative += pnlByWeek.get(key) || 0;
    return {
      label: formatWeekLabel(week),
      date: week,
      value: cumulative,
    };
  });
}

// Calculate P&L by week for bar chart
export function getPnLByWeek(
  positions: Position[],
  period: ChartPeriod
): ChartDataPoint[] {
  const closedPnLs = getClosedPositionPnLs(positions);
  const { start, end } = getDateRangeForPeriod(period);
  const filteredPnLs = filterByDateRange(closedPnLs, start, end);

  // Group P&L by week
  const pnlByWeek = new Map<string, number>();
  for (const item of filteredPnLs) {
    const key = formatWeekKey(item.closeDate);
    pnlByWeek.set(key, (pnlByWeek.get(key) || 0) + item.pnl);
  }

  // Generate data points for each week
  const weeks = generateWeeksInRange(start, end);
  return weeks.map((week) => {
    const key = formatWeekKey(week);
    return {
      label: formatWeekLabel(week),
      date: week,
      value: pnlByWeek.get(key) || 0,
    };
  });
}

// Get trade statistics for a period (count, total P&L, average P&L, average days in trade)
export function getTradeStats(
  positions: Position[],
  period: ChartPeriod
): { count: number; totalPnL: number; avgPnL: number; avgDIT: number } {
  const { start, end } = getDateRangeForPeriod(period);

  // Filter closed positions by close date within period
  const closedInPeriod = positions.filter(
    (p) => !p.isOpen && p.closeDate && p.closeDate >= start && p.closeDate <= end
  );

  const count = closedInPeriod.length;
  const totalPnL = closedInPeriod.reduce((sum, p) => sum + calculatePositionPnL(p), 0);
  const avgPnL = count > 0 ? totalPnL / count : 0;

  // Calculate average days in trade
  let totalDays = 0;
  for (const pos of closedInPeriod) {
    if (pos.openDate && pos.closeDate) {
      const msPerDay = 1000 * 60 * 60 * 24;
      const days = Math.round((pos.closeDate.getTime() - pos.openDate.getTime()) / msPerDay);
      totalDays += Math.max(0, days); // Ensure non-negative
    }
  }
  const avgDIT = count > 0 ? totalDays / count : 0;

  return { count, totalPnL, avgPnL, avgDIT };
}

// Main function to get chart data based on type, period, and segment
export function getChartData(
  positions: Position[],
  chartType: ChartType,
  period: ChartPeriod,
  segment: ChartSegment = 'month'
): ChartDataPoint[] {
  if (chartType === 'line') {
    // Line chart shows cumulative P&L
    if (period === 'last30') {
      return getCumulativePnLByDay(positions, period);
    }
    if (segment === 'week') {
      return getCumulativePnLByWeek(positions, period);
    }
    return getCumulativePnLByMonth(positions, period);
  } else {
    // Bar chart shows P&L per period
    if (period === 'last30') {
      return getPnLByDay(positions, period);
    }
    if (segment === 'week') {
      return getPnLByWeek(positions, period);
    }
    return getPnLByMonth(positions, period);
  }
}
