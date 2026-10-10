import {
  describe, expect, it
} from 'vitest';
import {
  fireEvent, screen
} from '@testing-library/react';
import { SHOW_ALL_ITEMS } from './pagination';
import {
  pageSizeOptionLabels, renderPaginationHeader
} from './PaginationHeader-fixtures';

describe('PaginationHeader', () => {
  it('displays the visible range and the total', () => {
    renderPaginationHeader();

    expect(screen.getByText('1-25 of 120')).toBeInTheDocument();
  });

  it('clips the range to the total on a short last page', () => {
    renderPaginationHeader({
      page: 5,
      total: 110,
    });

    expect(screen.getByText('101-110 of 110')).toBeInTheDocument();
  });

  it('displays the item count when the page size is All', () => {
    renderPaginationHeader({ pageSize: SHOW_ALL_ITEMS });

    expect(screen.getByText('All 120')).toBeInTheDocument();
  });

  it('offers 25, 50, 100 and All as page sizes', () => {
    renderPaginationHeader();

    expect(pageSizeOptionLabels()).toStrictEqual(['25', '50', '100', 'All (120)']);
  });

  it('offers the given page sizes instead of the defaults', () => {
    renderPaginationHeader({ pageSizeOptions: [10, 20] });

    expect(pageSizeOptionLabels()).toStrictEqual(['10', '20', 'All (120)']);
  });

  it('names the page-size select after the id prefix', () => {
    renderPaginationHeader({ idPrefix: 'citations' });

    const selector = screen.getByLabelText<HTMLSelectElement>('Show:');

    expect([
      selector.id,
      selector.labels?.[0]?.htmlFor,
      selector.name,
    ]).toStrictEqual([
      'citations-items-per-page',
      'citations-items-per-page',
      'citations-items-per-page',
    ]);
  });

  it.each([
    ['the chosen size', '50', 50],
    ['the show-all sentinel', String(SHOW_ALL_ITEMS), SHOW_ALL_ITEMS],
  ])('calls onPageSizeChange with %s when the option %s is picked', (_meaning, option, expected) => {
    const props = renderPaginationHeader();

    fireEvent.change(screen.getByLabelText('Show:'), { target: { value: option } });

    expect(props.onPageSizeChange).toHaveBeenCalledWith(expected);
  });

  it.each([
    ['First', 'page 1', 1],
    ['Prev', 'the previous page', 2],
    ['Next', 'the next page', 4],
    ['Last', 'the last page', 5],
  ])('calls onPageChange when the %s button is clicked on page 3 with %s', (button, _target, expectedPage) => {
    const props = renderPaginationHeader({ page: 3 });

    fireEvent.click(screen.getByRole('button', { name: button }));

    expect(props.onPageChange).toHaveBeenCalledWith(expectedPage);
  });

  it('disables First and Prev on the first page', () => {
    renderPaginationHeader({ page: 1 });

    expect(screen.getByRole('button', { name: 'First' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
  });

  it('disables Next and Last on the last page', () => {
    renderPaginationHeader({ page: 5 });

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Last' })).toBeDisabled();
  });

  it('displays the current page and the page count', () => {
    renderPaginationHeader({ page: 3 });

    expect(screen.getByText('3/5')).toBeInTheDocument();
  });

  it('rounds a partial last page up in the page count', () => {
    renderPaginationHeader({
      total: 101,
      pageSize: 50,
    });

    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('exposes the pager as a navigation landmark named by its label', () => {
    renderPaginationHeader({ label: 'Searches pagination' });

    expect(screen.getByRole('navigation', { name: 'Searches pagination' })).toBeInTheDocument();
  });

  it('hides the pager when everything fits on one page', () => {
    renderPaginationHeader({ total: 20 });

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'First' })).not.toBeInTheDocument();
  });

  it('hides the pager when the page size is All', () => {
    renderPaginationHeader({ pageSize: SHOW_ALL_ITEMS });

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
