import {
  describe, expect, it, vi
} from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  render, screen
} from '@testing-library/react';
import {
  TablePager, pageText, rangeText
} from './TablePager';

const SIZES = [50, 100] as const;

interface PagerOverrides {
  readonly page?: number;
  readonly hasMore?: boolean;
  readonly busy?: boolean;
}

/** Page `page` (2 by default) of 1,234 rows, 50 per page; returns the page and page-size callbacks. */
function renderPager({
  page = 2, hasMore = true, busy = false
}: PagerOverrides = {}) {
  const onPage = vi.fn<(page: number) => void>();
  const onPageSize = vi.fn<(size: 50 | 100) => void>();
  render(
    <TablePager page={page} pageSize={50} sizes={SIZES} totalCount={1234} rowCount={50}
      hasMore={hasMore} busy={busy} label="Keyword pages" onPage={onPage} onPageSize={onPageSize} />,
  );
  return {
    onPage,
    onPageSize,
  };
}

describe('rangeText', () => {
  it.each([
    ['the rows on screen and the total', [2, 50, 50, 1234], '51-100 of 1,234'],
    ['a short last page up to its last row', [25, 50, 34, 1234], '1,201-1,234 of 1,234'],
    ['the rows alone when the total is unknown', [1, 50, 50, null], 'Rows 1-50'],
    ['an empty page', [1, 50, 0, 0], 'No rows'],
  ] as const)('names %s', (_case, [page, size, rows, total], text) => {
    expect(rangeText(page, size, rows, total)).toBe(text);
  });
});

describe('pageText', () => {
  it.each([
    ['the pages of a known total', [2, 50, 1234], 'Page 2 of 25'],
    ['one page for an empty total', [1, 50, 0], 'Page 1 of 1'],
    ['the page alone when the total is unknown', [3, 50, null], 'Page 3'],
  ] as const)('counts %s', (_case, [page, size, total], text) => {
    expect(pageText(page, size, total)).toBe(text);
  });
});

describe('TablePager', () => {
  it.each([['Previous', 1], ['Next', 3]] as const)('asks %s for page %i', async (name, page) => {
    const { onPage } = renderPager();
    await userEvent.setup().click(screen.getByRole('button', { name }));

    expect(onPage).toHaveBeenCalledWith(page);
  });

  it.each([
    ['Previous', 'on the first page', { page: 1 }],
    ['Next', 'when there is no further page', { hasMore: false }],
    ['Next', 'while a page loads', { busy: true }],
  ] as const)('disables %s %s', (name, _when, overrides) => {
    renderPager(overrides);

    expect(screen.getByRole('button', { name })).toBeDisabled();
  });

  it('asks for the page size picked', async () => {
    const { onPageSize } = renderPager();
    await userEvent.setup().selectOptions(screen.getByLabelText('Rows'), '100');

    expect(onPageSize).toHaveBeenCalledWith(100);
  });

  it('names the page navigation', () => {
    renderPager();

    expect(screen.getByRole('navigation', { name: 'Keyword pages' })).toHaveTextContent('Page 2 of 25');
  });
});
