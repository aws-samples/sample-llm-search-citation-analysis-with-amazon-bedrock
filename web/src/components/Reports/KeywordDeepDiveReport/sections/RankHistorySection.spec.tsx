import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { RankHistorySection } from './RankHistorySection';
import {
  buildTrendHistory, buildTrendPoints 
} from './rankHistory-fixtures';

describe('RankHistorySection — sampling', () => {
  it('renders every row when point count is below the cap', () => {
    render(
      <RankHistorySection trends={buildTrendHistory(buildTrendPoints(5))} loading={false} error={null} />,
    );
    // 5 data rows + 1 header row.
    expect(screen.getAllByRole('row')).toHaveLength(6);
  });

  it('caps the table at 14 rows when point count exceeds the cap', () => {
    render(
      <RankHistorySection trends={buildTrendHistory(buildTrendPoints(30))} loading={false} error={null} />,
    );
    // 14 sampled data rows + 1 header row.
    expect(screen.getAllByRole('row')).toHaveLength(15);
  });

  it('keeps the first and last data points when sampling', () => {
    render(
      <RankHistorySection trends={buildTrendHistory(buildTrendPoints(30))} loading={false} error={null} />,
    );
    expect(screen.getByText('d-00')).toBeInTheDocument();
    expect(screen.getByText('d-29')).toBeInTheDocument();
  });
});

describe('RankHistorySection — placeholder states', () => {
  it('renders empty state when trend_data is empty', () => {
    render(
      <RankHistorySection
        trends={buildTrendHistory([])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText(/at least two analysis runs/i)).toBeInTheDocument();
  });

  it('renders empty state when trends is null', () => {
    render(
      <RankHistorySection trends={null} loading={false} error={null} />,
    );
    expect(screen.getByText(/at least two analysis runs/i)).toBeInTheDocument();
  });

  it('renders loading state when loading is true', () => {
    render(
      <RankHistorySection trends={null} loading error={null} />,
    );
    expect(screen.getByText(/Loading trend data/i)).toBeInTheDocument();
  });

  it('renders error message when error is set', () => {
    render(
      <RankHistorySection trends={null} loading={false} error="Network blew up" />,
    );
    expect(screen.getByText(/Network blew up/i)).toBeInTheDocument();
  });
});
