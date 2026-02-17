import {
  useEffect, useRef 
} from 'react';
import {
  Chart, registerables 
} from 'chart.js';
import type { ProviderStat } from '../../types';

Chart.register(...registerables);

interface ProviderChartProps {data: ProviderStat[];}

export const ProviderChart = ({ data }: ProviderChartProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !data?.length) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? 'rgb(209, 213, 219)' : 'rgb(75, 85, 99)';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';

    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map((d) => d.provider),
        datasets: [
          {
            label: 'Citations',
            data: data.map((d) => d.citation_count),
            backgroundColor: [
              'rgba(200, 162, 200, 0.85)',
              'rgba(100, 149, 237, 0.85)',
              'rgba(134, 239, 172, 0.85)',
              'rgba(251, 146, 60, 0.85)',
            ],
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {legend: { display: false },},
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: { color: textColor },
          },
          x: {
            grid: { display: false },
            ticks: { color: textColor },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, [data]);

  const hasData = data && data.length > 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-900">Citations by Provider</h3>
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
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <p className="text-sm">No data available</p>
              <p className="text-xs mt-1">Run an analysis to see provider stats</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
