import type { RefObject } from 'react';
import { StrokeIcon } from '../ui/StrokeIcon';
import { SeeAllLink } from '../ui/SeeAllLink';

interface DashboardChartCardProps {
  readonly title: string;
  /** One line under the title saying what the chart counts. */
  readonly description?: string;
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly hasData: boolean;
  /** Second line of the empty state, e.g. "Run an analysis to see brand stats". */
  readonly emptyHint: string;
  /** Heroicons-style outline `d` attributes drawn in the empty state. */
  readonly emptyIconPaths: readonly string[];
  /** The full view behind the chart ("See all"), e.g. `/citations`. */
  readonly seeAll?: {
    readonly to: string;
    readonly label: string;
  };
}

/**
 * Card shell shared by the dashboard charts: title, a fixed-height canvas and
 * an empty state that replaces the canvas while there is nothing to plot.
 */
export const DashboardChartCard = ({
  title,
  description,
  canvasRef,
  hasData,
  emptyHint,
  emptyIconPaths,
  seeAll,
}: DashboardChartCardProps) => (
  <div className="bg-white rounded-lg border border-gray-200 p-6">
    <div className="mb-4 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-gray-900">{title}</h3>
        {description !== undefined && <p className="mt-1 text-xs text-gray-500">{description}</p>}
      </div>
      {seeAll && <SeeAllLink to={seeAll.to}>{seeAll.label}</SeeAllLink>}
    </div>
    <div style={{
      height: '280px',
      position: 'relative' 
    }}>
      <canvas ref={canvasRef} style={{ display: hasData ? 'block' : 'none' }} />
      {!hasData && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-center">
          <div>
            <StrokeIcon className="w-10 h-10 mx-auto mb-3 text-gray-500" paths={emptyIconPaths} />
            <p className="text-sm">No data available</p>
            <p className="text-xs mt-1">{emptyHint}</p>
          </div>
        </div>
      )}
    </div>
  </div>
);
