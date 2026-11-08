import {
  describe, it, expect
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { buildOverview } from '../../../api/seoBacklinks-fixtures';
import { BacklinksOverviewPanel } from './BacklinksOverviewPanel';

describe('BacklinksOverviewPanel history note', () => {
  it('asks to retry a history that failed', () => {
    render(<BacklinksOverviewPanel overview={buildOverview({ history_failed: true })} />);

    expect(screen.getByText(/could not be loaded this time/)).toBeInTheDocument();
  });

  it('says the daily limit stopped the history, which a retry today cannot load', () => {
    render(<BacklinksOverviewPanel overview={buildOverview({
      history_failed: true,
      history_limit_reached: true,
    })} />);

    expect(screen.getByText(/reached today's limit of paid DataForSEO calls/)).toBeInTheDocument();
  });
});
