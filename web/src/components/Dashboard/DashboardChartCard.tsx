import type { RefObject } from 'react';

interface DashboardChartCardProps {
  readonly title: string;
  readonly canvasRef: RefObject<HTMLCanvasElement>;
  readonly hasData: boolean;
  /** Second line of the empty state, e.g. "Run an analysis to see brand stats". */
  readonly emptyHint: string;
  /** Heroicons-style outline `d` attributes drawn in the empty state. */
  readonly emptyIconPaths: readonly string[];
}

/**
 * Card shell shared by the dashboard charts: title, a fixed-height canvas and
 * an empty state that replaces the canvas while there is nothing to plot.
 */
export const DashboardChartCard = ({
  title,
  canvasRef,
  hasData,
  emptyHint,
  emptyIconPaths,
}: DashboardChartCardProps) => (
  <div className="bg-white rounded-lg border border-gray-200 p-6">
    <div className="mb-4">
      <h3 className="text-sm font-medium text-gray-900">{title}</h3>
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
              {emptyIconPaths.map((d) => (
                <path
                  key={d}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d={d}
                />
              ))}
            </svg>
            <p className="text-sm">No data available</p>
            <p className="text-xs mt-1">{emptyHint}</p>
          </div>
        </div>
      )}
    </div>
  </div>
);
