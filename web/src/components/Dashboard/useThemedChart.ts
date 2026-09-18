import {
  useEffect, useRef 
} from 'react';
import {
  Chart, registerables 
} from 'chart.js';
import type {
  ChartConfiguration, ChartType 
} from 'chart.js';
import { useTheme } from '../../hooks/useTheme';
import { getChartTheme } from '../ui/chartTheme';
import type { ChartTheme } from '../ui/chartTheme';

Chart.register(...registerables);

export type ChartConfigurationBuilder<TItem, TType extends ChartType> = (
  items: TItem[],
  theme: ChartTheme,
  isDark: boolean,
) => ChartConfiguration<TType>;

/**
 * Owns the Chart.js lifecycle for a dashboard canvas: (re)builds the chart
 * whenever the items or the colour theme change and destroys it on unmount.
 * `buildConfiguration` must be a stable (module-level) function.
 */
export function useThemedChart<TItem, TType extends ChartType>(
  items: TItem[],
  buildConfiguration: ChartConfigurationBuilder<TItem, TType>,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<TType> | null>(null);
  const { isDark } = useTheme();

  useEffect(() => {
    if (!canvasRef.current || !items?.length) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    chartRef.current = new Chart(ctx, buildConfiguration(items, getChartTheme(isDark), isDark));

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, [items, isDark, buildConfiguration]);

  const hasData = items && items.length > 0;

  return {
    canvasRef,
    hasData,
  };
}
