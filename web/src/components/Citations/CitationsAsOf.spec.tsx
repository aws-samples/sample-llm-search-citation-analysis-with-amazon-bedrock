import {
  describe, it, expect
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { CitationsAsOf } from './CitationsAsOf';
import { buildCitationsPage } from '../../hooks/useMarketCitations-fixtures';
import { formatDate } from '../../formatting/dateFormatter';

describe('CitationsAsOf', () => {
  it('says when the rollup that answered was built', () => {
    render(<CitationsAsOf totals={buildCitationsPage({
      source: 'rollup',
      as_of: '2026-11-05T10:00:00Z',
      stale: false,
    })} />);

    expect(screen.getByText(`Figures as of ${formatDate('2026-11-05T10:00:00Z')}.`)).toBeInTheDocument();
  });

  it('says the page was read live while a stale rollup is rebuilt', () => {
    render(<CitationsAsOf totals={buildCitationsPage({
      source: 'live',
      as_of: null,
      stale: true,
    })} />);

    expect(screen.getByText(/being refreshed; this page was read live/)).toBeInTheDocument();
  });

  it('shows nothing for a live page of an up-to-date scope', () => {
    const { container } = render(<CitationsAsOf totals={buildCitationsPage({
      source: 'live',
      as_of: null,
      stale: false,
    })} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing before the first page arrives', () => {
    const { container } = render(<CitationsAsOf totals={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
