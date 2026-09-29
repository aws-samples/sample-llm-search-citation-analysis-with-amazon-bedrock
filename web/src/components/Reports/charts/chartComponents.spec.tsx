import {
  render, screen
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import { Chart } from 'chart.js';
import {
  DRAWN_CHARTS, EMPTY_CHARTS, REDRAWN_CHARTS
} from './chartComponents-fixtures';
import {
  CANVAS_CONTEXT, stubCanvasContext
} from './charts-fixtures';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

describe('report chart components', () => {
  it.each(DRAWN_CHARTS)('%s draws a figure captioned with its figures in words', (_name, chart, _type, caption) => {
    stubCanvasContext();
    render(chart());

    expect(screen.getByRole('figure')).toHaveTextContent(caption);
  });

  it.each(DRAWN_CHARTS)('%s keeps its caption for screen readers only', (_name, chart) => {
    stubCanvasContext();
    const { container } = render(chart());

    expect(container.querySelector('figcaption')).toHaveClass('sr-only');
  });

  it.each(DRAWN_CHARTS)('%s draws its canvas in a fixed-height box', (_name, chart) => {
    stubCanvasContext();
    const { container } = render(chart());

    expect(container.querySelector('figure > div')?.className).toMatch(/^relative h-\d+$/);
  });

  it.each(DRAWN_CHARTS)('%s constructs a Chart.js chart of its type', (_name, chart, type) => {
    stubCanvasContext();
    render(chart());

    expect(Chart).toHaveBeenCalledWith(CANVAS_CONTEXT, expect.objectContaining({ type }));
  });

  it.each(EMPTY_CHARTS)('%s says there is nothing to draw', (_name, chart, emptyText) => {
    render(chart());

    expect(screen.getByText(emptyText)).toBeInTheDocument();
  });

  it.each(EMPTY_CHARTS)('%s draws no figure when there is nothing to draw', (_name, chart) => {
    render(chart());

    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });

  it.each(EMPTY_CHARTS)('%s constructs no chart when there is nothing to draw', (_name, chart) => {
    stubCanvasContext();
    render(chart());

    expect(Chart).not.toHaveBeenCalledWith(CANVAS_CONTEXT, expect.anything());
  });

  it.each(REDRAWN_CHARTS)('%s redraws the chart of its new props when they change', (_name, first, second, data) => {
    stubCanvasContext();
    const { rerender } = render(first());
    rerender(second());

    expect(Chart).toHaveBeenLastCalledWith(CANVAS_CONTEXT, expect.objectContaining({ data }));
  });
});
