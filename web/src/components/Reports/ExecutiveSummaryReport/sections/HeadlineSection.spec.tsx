import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { HeadlineSection } from './HeadlineSection';
import { buildData } from './HeadlineSection-fixtures';

describe('HeadlineSection — value rendering', () => {
  it('renders the overall visibility score as the first hero metric', () => {
    render(
      <HeadlineSection
        data={buildData({ overall_score: 65.4 })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('65.4')).toBeInTheDocument();
  });

  it('formats positive movement with a plus sign and percent', () => {
    render(
      <HeadlineSection
        data={buildData({
          change: 4.9,
          change_percent: 8.1 
        })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText(/\+4\.9 \(\+8\.1%\)/)).toBeInTheDocument();
  });

  it('formats negative movement without a plus sign', () => {
    render(
      <HeadlineSection
        data={buildData({
          change: -3.2,
          change_percent: -5.0 
        })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText(/-3\.2 \(-5\.0%\)/)).toBeInTheDocument();
  });

  it('renders "No change" when change is exactly zero', () => {
    render(
      <HeadlineSection
        data={buildData({
          change: 0,
          change_percent: 0 
        })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('No change')).toBeInTheDocument();
  });
});

describe('HeadlineSection — keyword breadth', () => {
  it('renders the improving fraction as "improving / total"', () => {
    render(
      <HeadlineSection
        data={buildData({
          summary: {
            improving_count: 3,
            declining_count: 2,
            stable_count: 5 
          },
        })}
        loading={false}
        error={null}
      />,
    );
    // 3 improving / (3+2+5) = 3/10
    expect(screen.getByText('3/10')).toBeInTheDocument();
  });

  it('shows the declining and stable counts in the breadth footnote', () => {
    render(
      <HeadlineSection
        data={buildData({
          summary: {
            improving_count: 1,
            declining_count: 4,
            stable_count: 5 
          },
        })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText(/4 declining, 5 stable/)).toBeInTheDocument();
  });
});

describe('HeadlineSection — placeholder states', () => {
  it('renders the loading placeholder when loading is true', () => {
    render(<HeadlineSection data={null} loading error={null} />);
    expect(
      screen.getByText(/Loading executive summary/i),
    ).toBeInTheDocument();
  });

  it('renders the error message when error is set', () => {
    render(<HeadlineSection data={null} loading={false} error="boom" />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('renders the empty placeholder when data is null and not loading', () => {
    render(<HeadlineSection data={null} loading={false} error={null} />);
    expect(screen.getByText(/Run an analysis/i)).toBeInTheDocument();
  });
});
