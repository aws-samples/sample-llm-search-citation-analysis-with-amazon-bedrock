import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { expectRendersNothing } from '../../../../test/renderNothing';
import { TrendHistorySection } from './TrendHistorySection';
import {
  buildTrendView, LATEST_PERIOD, PREVIOUS_PERIOD
} from '../../layout/reportPayload-fixtures';
import { sectionTable } from '../../layout/reportQueries-fixtures';
import { RUN_1 } from '../groupKpiHistory-fixtures';

describe('TrendHistorySection', () => {
  it('lists every period of the trend, oldest first', () => {
    render(<TrendHistorySection trends={buildTrendView()} loading={false} error={null} />);

    expect(sectionTable('Trend history').slice(1).map(([period]) => period)).toStrictEqual([PREVIOUS_PERIOD, LATEST_PERIOD]);
  });

  it('says the KPIs are per period of the window, from its first day', () => {
    render(<TrendHistorySection trends={buildTrendView({ period_type: 'week' })} loading={false} error={null} />);

    expect(screen.getByText(`Every KPI per week since ${new Date(RUN_1).toLocaleDateString()}, over every answer in the week.`))
      .toBeInTheDocument();
  });

  it('drops out of the report when the window holds no period', () => {
    expectRendersNothing(<TrendHistorySection trends={buildTrendView({ trend_data: [] })} loading={false} error={null} />);
  });

  it('shows the loading state', () => {
    render(<TrendHistorySection trends={null} loading error={null} />);

    expect(screen.getByText('Loading trend history…')).toBeInTheDocument();
  });

  it('shows the error', () => {
    render(<TrendHistorySection trends={null} loading={false} error="boom" />);

    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});
