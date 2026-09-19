import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { expectRendersNothing } from '../../../../test/renderNothing';
import { PerKeywordTableSection } from './PerKeywordTableSection';
import { buildKeywordTrends } from '../keywordTrends-fixtures';

describe('PerKeywordTableSection — ordering', () => {
  it('orders rows by current_score descending', () => {
    render(
      <PerKeywordTableSection
        trends={buildKeywordTrends([
          {
            keyword: 'low',
            current_score: 20,
            change: 0 
          },
          {
            keyword: 'high',
            current_score: 80,
            change: 0 
          },
          {
            keyword: 'mid',
            current_score: 50,
            change: 0 
          },
        ])}
        loading={false}
        error={null}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('high');
    expect(rows[2]).toHaveTextContent('mid');
    expect(rows[3]).toHaveTextContent('low');
  });
});

describe('PerKeywordTableSection — mover highlight', () => {
  it.each([
    ['positive-mover', 6, 'emerald'],
    ['negative-mover', -7, 'red'],
  ])('applies the %s class when change is %d', (_label, change, tint) => {
    render(
      <PerKeywordTableSection
        trends={buildKeywordTrends([
          {
            keyword: 'mover',
            change 
          },
        ])}
        loading={false}
        error={null}
      />,
    );
    const row = screen.getByText('mover').closest('tr');
    expect(row?.className).toContain(tint);
  });

  it('does NOT highlight rows with change magnitude below the +/-5 threshold', () => {
    render(
      <PerKeywordTableSection
        trends={buildKeywordTrends([
          {
            keyword: 'tiny-up',
            change: 3 
          },
          {
            keyword: 'tiny-down',
            change: -3 
          },
        ])}
        loading={false}
        error={null}
      />,
    );
    const upRow = screen.getByText('tiny-up').closest('tr');
    const downRow = screen.getByText('tiny-down').closest('tr');
    expect(upRow?.className).not.toContain('emerald');
    expect(downRow?.className).not.toContain('red');
  });
});

describe('PerKeywordTableSection — empty + placeholder states', () => {
  it('returns null when keyword_trends is empty', () => {
    expectRendersNothing(<PerKeywordTableSection trends={buildKeywordTrends([])} loading={false} error={null} />);
  });

  it('renders loading placeholder when loading is true', () => {
    render(
      <PerKeywordTableSection trends={null} loading error={null} />,
    );
    expect(
      screen.getByText(/Loading per-keyword rankings/i),
    ).toBeInTheDocument();
  });

  it('renders error message when error is set', () => {
    render(
      <PerKeywordTableSection
        trends={null}
        loading={false}
        error="Network down"
      />,
    );
    expect(screen.getByText('Network down')).toBeInTheDocument();
  });
});

describe('PerKeywordTableSection — change formatting', () => {
  it.each([
    ['a plus sign', 4, '+4.0'],
    ['a minus sign', -4, '-4.0'],
  ])('renders the change with %s when change is %d', (_label, change, expected) => {
    render(
      <PerKeywordTableSection
        trends={buildKeywordTrends([
          {
            keyword: 'kw',
            change 
          },
        ])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
