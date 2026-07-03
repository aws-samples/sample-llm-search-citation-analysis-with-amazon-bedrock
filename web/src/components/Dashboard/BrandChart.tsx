import {
  useEffect, useMemo, useRef 
} from 'react';
import {
  Chart, registerables 
} from 'chart.js';
import type { BrandStat } from '../../types';
import { useTheme } from '../../hooks/useTheme';
import { getChartTheme } from '../ui/chartTheme';

Chart.register(...registerables);

interface BrandChartProps {data: BrandStat[];}

// Distinct qualitative palette so adjacent slices never blend. Readable on
// both light and dark backgrounds. Sized to cover the top brands shown.
const BRAND_PALETTE = [
  'rgba(239, 68, 68, 0.9)',   // red
  'rgba(245, 158, 11, 0.9)',  // amber
  'rgba(59, 130, 246, 0.9)',  // blue
  'rgba(168, 85, 247, 0.9)',  // purple
  'rgba(16, 185, 129, 0.9)',  // emerald
  'rgba(236, 72, 153, 0.9)',  // pink
  'rgba(20, 184, 166, 0.9)',  // teal
  'rgba(249, 115, 22, 0.9)',  // orange
  'rgba(132, 204, 22, 0.9)',  // lime
  'rgba(99, 102, 241, 0.9)',  // indigo
];

// Slices we never want to plot on the brand donut. "Other" is the long tail of
// third-party citation domains and swamps the tracked brands, so exclude it.
const EXCLUDED_LABELS = new Set(['other']);

// Only show the top N brands so the donut stays readable.
const MAX_SLICES = 10;

export const BrandChart = ({ data }: BrandChartProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const { isDark } = useTheme();

  // Drop the "Other" long tail, rank by mentions, and cap the slice count so
  // the tracked brands are clearly comparable.
  const chartData = useMemo(
    () => (data ?? [])
      .filter((d) => d.brand && !EXCLUDED_LABELS.has(d.brand.toLowerCase()))
      .sort((a, b) => b.mention_count - a.mention_count)
      .slice(0, MAX_SLICES),
    [data],
  );

  useEffect(() => {
    if (!canvasRef.current || !chartData.length) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const theme = getChartTheme(isDark);

    chartRef.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: chartData.map((d) => d.brand),
        datasets: [
          {
            data: chartData.map((d) => d.mention_count),
            backgroundColor: chartData.map((_, i) => BRAND_PALETTE[i % BRAND_PALETTE.length]),
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              boxWidth: 12,
              padding: 16,
              font: { size: 11 },
              color: theme.textColor,
            },
          },
          tooltip: {
            backgroundColor: theme.tooltipBackground,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
          },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, [chartData, isDark]);

  const hasData = chartData.length > 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-900">Brand Mentions</h3>
      </div>
      <div style={{
        height: '280px',
        position: 'relative' 
      }}>
        <canvas ref={canvasRef} style={{ display: hasData ? 'block' : 'none' }} />
        {!hasData && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-center">
            <div>
              <svg
                className="w-10 h-10 mx-auto mb-3 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
                />
              </svg>
              <p className="text-sm">No data available</p>
              <p className="text-xs mt-1">Run an analysis to see brand stats</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
