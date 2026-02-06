// P&L Chart Component
// Shows closed P&L as line chart (cumulative) or bar chart (per period)

import { useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import type { Position } from '../types/trade';
import { getChartData, getTradeStats, type ChartType, type ChartPeriod, type ChartSegment } from '../utils/chartCalculations';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface PnLChartProps {
  positions: Position[];
}

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  line: 'Cumulative',
  bar: 'Per Period',
};

const PERIOD_LABELS: Record<ChartPeriod, string> = {
  last30: 'Last 30 Days',
  currentYear: new Date().getFullYear().toString(),
  previousYear: (new Date().getFullYear() - 1).toString(),
  all: 'All Time',
};

const SEGMENT_LABELS: Record<ChartSegment, string> = {
  month: 'By Month',
  week: 'By Week',
};

export function PnLChart({ positions }: PnLChartProps) {
  const [chartType, setChartType] = useState<ChartType>('line');
  const [period, setPeriod] = useState<ChartPeriod>('currentYear');
  const [segment, setSegment] = useState<ChartSegment>('month');

  const chartData = useMemo(
    () => getChartData(positions, chartType, period, segment),
    [positions, chartType, period, segment]
  );

  const tradeStats = useMemo(
    () => getTradeStats(positions, period),
    [positions, period]
  );

  // Check if there's any data to show
  const hasData = chartData.some((d) => d.value !== 0);

  const formatCurrency = (value: number) => {
    const prefix = value >= 0 ? '' : '-';
    return `${prefix}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const labels = chartData.map((d) => d.label);
  const values = chartData.map((d) => d.value);

  // For bar charts, split into positive and negative for coloring
  const positiveValues = values.map((v) => (v >= 0 ? v : 0));
  const negativeValues = values.map((v) => (v < 0 ? v : 0));

  const lineChartData = {
    labels,
    datasets: [
      {
        label: 'Cumulative P&L',
        data: values,
        borderColor: values[values.length - 1] >= 0 ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)',
        backgroundColor: values[values.length - 1] >= 0
          ? 'rgba(34, 197, 94, 0.1)'
          : 'rgba(239, 68, 68, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: chartData.length > 30 ? 0 : 3,
        pointHoverRadius: 5,
      },
    ],
  };

  const barChartData = {
    labels,
    datasets: [
      {
        label: 'Profit',
        data: positiveValues,
        backgroundColor: 'rgba(34, 197, 94, 0.8)',
        borderColor: 'rgb(34, 197, 94)',
        borderWidth: 1,
      },
      {
        label: 'Loss',
        data: negativeValues,
        backgroundColor: 'rgba(239, 68, 68, 0.8)',
        borderColor: 'rgb(239, 68, 68)',
        borderWidth: 1,
      },
    ],
  };

  const formatCurrencyTick = (value: number | string) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (Math.abs(num) >= 1000) {
      return `$${(num / 1000).toFixed(0)}k`;
    }
    return `$${num}`;
  };

  const formatCurrencyTooltip = (value: number) => {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context: { raw: unknown }) => formatCurrencyTooltip(context.raw as number),
        },
      },
    },
    scales: {
      y: {
        ticks: {
          callback: formatCurrencyTick,
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.05)',
        },
      },
      x: {
        ticks: {
          maxRotation: 45,
          minRotation: 0,
          autoSkip: true,
          maxTicksLimit: 12,
        },
        grid: {
          display: false,
        },
      },
    },
  };

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context: { raw: unknown }) => {
            const value = context.raw as number;
            if (value === 0) return '';
            return formatCurrencyTooltip(value);
          },
        },
        filter: (item: { raw: unknown }) => (item.raw as number) !== 0,
      },
    },
    scales: {
      x: {
        stacked: true,
        ticks: {
          maxRotation: 45,
          minRotation: 0,
          autoSkip: true,
          maxTicksLimit: 12,
        },
        grid: {
          display: false,
        },
      },
      y: {
        stacked: true,
        ticks: {
          callback: formatCurrencyTick,
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.05)',
        },
      },
    },
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-6">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-semibold text-gray-700">Closed P&L</h2>
          {tradeStats.count > 0 && (
            <span className="text-xs text-gray-500">
              Trade Avg: <span className={tradeStats.avgPnL >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                {formatCurrency(tradeStats.avgPnL)}
              </span>
              <span className="text-gray-400 mx-2">|</span>
              Avg DIT: <span className="text-gray-700 font-medium">
                {tradeStats.avgDIT.toFixed(1)}
              </span>
              <span className="text-gray-400 ml-1">({tradeStats.count} trades)</span>
            </span>
          )}
        </div>

        <div className="flex gap-2 text-xs">
          {/* Chart Type Toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {(Object.keys(CHART_TYPE_LABELS) as ChartType[]).map((type) => (
              <button
                key={type}
                onClick={() => setChartType(type)}
                className={`px-2 py-1 rounded-md transition-colors ${
                  chartType === type
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                {CHART_TYPE_LABELS[type]}
              </button>
            ))}
          </div>

          {/* Period Selector */}
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as ChartPeriod)}
            className="px-2 py-1 bg-gray-100 rounded-lg text-gray-600 hover:text-gray-800 focus:outline-none cursor-pointer"
          >
            {(Object.keys(PERIOD_LABELS) as ChartPeriod[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>

          {/* Segment Selector (only show for non-last30 periods) */}
          {period !== 'last30' && (
            <select
              value={segment}
              onChange={(e) => setSegment(e.target.value as ChartSegment)}
              className="px-2 py-1 bg-gray-100 rounded-lg text-gray-600 hover:text-gray-800 focus:outline-none cursor-pointer"
            >
              {(Object.keys(SEGMENT_LABELS) as ChartSegment[]).map((s) => (
                <option key={s} value={s}>
                  {SEGMENT_LABELS[s]}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="h-48">
        {!hasData ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            No closed positions in this period
          </div>
        ) : chartType === 'line' ? (
          <Line data={lineChartData} options={lineOptions} />
        ) : (
          <Bar data={barChartData} options={barOptions} />
        )}
      </div>
    </div>
  );
}
