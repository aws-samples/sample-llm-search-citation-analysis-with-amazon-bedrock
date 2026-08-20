import {
  useEffect, useRef 
} from 'react';
import {
  Chart, registerables 
} from 'chart.js';
import type { BrandStat } from '../../types';
import { useTheme } from '../../hooks/useTheme';
import {
  getChartTheme, themedTooltip
} from '../ui/chartTheme';

Chart.register(...registerables);

interface BrandChartProps {data: BrandStat[];}

const BRAND_PALETTE_LIGHT = [
  'rgba(17, 24, 39, 0.9)',
  'rgba(55, 65, 81, 0.9)',
  'rgba(251, 191, 36, 0.85)',
  'rgba(167, 139, 250, 0.85)',
  'rgba(156, 163, 175, 0.9)',
];

const BRAND_PALETTE_DARK = [
  'rgba(229, 231, 235, 0.9)',
  'rgba(156, 163, 175, 0.9)',
  'rgba(251, 191, 36, 0.85)',
  'rgba(167, 139, 250, 0.85)',
  'rgba(107, 114, 128, 0.9)',
];

export const BrandChart = ({ data }: BrandChartProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const { isDark } = useTheme();

  useEffect(() => {
    if (!canvasRef.current || !data?.length) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const theme = getChartTheme(isDark);
    const palette = isDark ? BRAND_PALETTE_DARK : BRAND_PALETTE_LIGHT;

    chartRef.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.map((d) => d.brand),
        datasets: [
          {
            data: data.map((d) => d.mention_count),
            backgroundColor: palette,
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
          tooltip: themedTooltip(theme),
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, [data, isDark]);

  const hasData = data && data.length > 0;

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
