import {
  describe, it, expect
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { CitationsAsOf } from './CitationsAsOf';
import { buildCitationsPage } from '../../hooks/useMarketCitations-fixtures';
import { formatDate } from '../../formatting/dateFormatter';

const SNAPSHOT_BUILT_AT = '2026-10-12T07:14:05Z';

/** Renders the note over a citations page whose totals carry `envelope`. */
function renderAsOf(envelope: Parameters<typeof buildCitationsPage>[0]) {
  return render(<CitationsAsOf totals={buildCitationsPage(envelope)} />);
}

describe('CitationsAsOf', () => {
  it('says when the rollup that answered was built', () => {
    renderAsOf({
      source: 'rollup',
      as_of: '2026-11-05T10:00:00Z',
      stale: false,
    });

    expect(screen.getByText(`Figures as of ${formatDate('2026-11-05T10:00:00Z')}.`)).toBeInTheDocument();
  });

  it('says a stale snapshot is updating and when its figures are from', () => {
    renderAsOf({
      source: 'snapshot',
      as_of: SNAPSHOT_BUILT_AT,
      stale: true,
      refreshing: true,
    });

    expect(screen.getByRole('status')).toHaveTextContent(`Updating to the latest keyword changes… These figures are from ${formatDate(SNAPSHOT_BUILT_AT)}.`);
  });

  it('says when the scope snapshot that answered was built', () => {
    renderAsOf({
      as_of: SNAPSHOT_BUILT_AT,
      source: 'snapshot',
      stale: false,
    });

    expect(screen.getByText(`Figures as of ${formatDate(SNAPSHOT_BUILT_AT)}.`)).toBeInTheDocument();
  });

  it('says the page was read live while a stale rollup is rebuilt', () => {
    renderAsOf({
      source: 'live',
      as_of: null,
      stale: true,
    });

    expect(screen.getByText(/being refreshed; this page was read live/)).toBeInTheDocument();
  });

  it('shows nothing for a live page of an up-to-date scope', () => {
    const { container } = renderAsOf({
      source: 'live',
      as_of: null,
      stale: false,
    });

    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing before the first page arrives', () => {
    const { container } = render(<CitationsAsOf totals={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
