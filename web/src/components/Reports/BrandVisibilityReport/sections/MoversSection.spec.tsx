import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen, within 
} from '@testing-library/react';
import { expectRendersNothing } from '../../../../test/renderNothing';
import { MoversSection } from './MoversSection';
import { buildKeywordTrends } from '../keywordTrends-fixtures';

function getColumnElement(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  const column = heading.closest('div');
  expect(column).not.toBeNull();
  return column as HTMLElement;
}

describe('MoversSection — improver list', () => {
  it('lists keywords with positive change in the Improving column', () => {
    render(
      <MoversSection
        trends={buildKeywordTrends([
          {
            keyword: 'up-a',
            change: 3 
          },
          {
            keyword: 'down-a',
            change: -2 
          },
        ])}
        loading={false}
        error={null}
      />,
    );
    const column = getColumnElement('Improving');
    expect(within(column).getByText('up-a')).toBeInTheDocument();
    expect(within(column).queryByText('down-a')).not.toBeInTheDocument();
  });

  it('orders improvers by change descending', () => {
    render(
      <MoversSection
        trends={buildKeywordTrends([
          {
            keyword: 'small-up',
            change: 1 
          },
          {
            keyword: 'big-up',
            change: 9 
          },
          {
            keyword: 'medium-up',
            change: 5 
          },
        ])}
        loading={false}
        error={null}
      />,
    );
    const items = within(getColumnElement('Improving')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('big-up');
    expect(items[1]).toHaveTextContent('medium-up');
    expect(items[2]).toHaveTextContent('small-up');
  });

  it('caps each direction at five entries', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      keyword: `up-${i}`,
      change: i + 1,
    }));
    render(
      <MoversSection
        trends={buildKeywordTrends(rows)}
        loading={false}
        error={null}
      />,
    );
    expect(within(getColumnElement('Improving')).getAllByRole('listitem')).toHaveLength(5);
  });
});

describe('MoversSection — decliner list and empty handling', () => {
  it('orders decliners by change ascending (most negative first)', () => {
    render(
      <MoversSection
        trends={buildKeywordTrends([
          {
            keyword: 'small-down',
            change: -1 
          },
          {
            keyword: 'big-down',
            change: -9 
          },
          {
            keyword: 'medium-down',
            change: -5 
          },
        ])}
        loading={false}
        error={null}
      />,
    );
    const items = within(getColumnElement('Declining')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('big-down');
    expect(items[1]).toHaveTextContent('medium-down');
    expect(items[2]).toHaveTextContent('small-down');
  });

  it('shows the "no improvers" empty copy when only decliners exist', () => {
    render(
      <MoversSection
        trends={buildKeywordTrends([
          {
            keyword: 'down-a',
            change: -3 
          },
        ])}
        loading={false}
        error={null}
      />,
    );
    expect(
      screen.getByText(/No keywords moved in this direction/i),
    ).toBeInTheDocument();
  });

  it('returns null (no section rendered) when keyword_trends is empty', () => {
    expectRendersNothing(<MoversSection trends={buildKeywordTrends([])} loading={false} error={null} />);
  });

  it('returns null when no keyword has a non-zero change', () => {
    const { container } = render(
      <MoversSection
        trends={buildKeywordTrends([
          {
            keyword: 'flat-a',
            change: 0 
          },
          {
            keyword: 'flat-b',
            change: 0 
          },
        ])}
        loading={false}
        error={null}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('MoversSection — placeholder states', () => {
  it('renders loading placeholder when loading is true', () => {
    render(<MoversSection trends={null} loading error={null} />);
    expect(screen.getByText(/Computing movers/i)).toBeInTheDocument();
  });

  it('renders error message when error is set', () => {
    render(<MoversSection trends={null} loading={false} error="boom" />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});
