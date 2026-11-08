import {
  screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  describe, expect, it
} from 'vitest';
import {
  buildFruits, renderFruitTable
} from './DataTable-fixtures';

describe('DataTable headings', () => {
  it('names the table by its caption', () => {
    renderFruitTable(buildFruits(2));

    expect(screen.getByRole('table', { name: 'Fruit prices' })).toBeInTheDocument();
  });

  it('marks the sorted column with aria-sort', () => {
    renderFruitTable(buildFruits(2));

    expect(screen.getByRole('columnheader', { name: /Price/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('leaves the other sortable columns without aria-sort', () => {
    renderFruitTable(buildFruits(2));

    expect(screen.getByRole('columnheader', { name: /Name/ })).not.toHaveAttribute('aria-sort');
  });

  it('asks for the column key when a sortable heading is clicked', async () => {
    const { onSort } = renderFruitTable(buildFruits(2));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Name' }));

    expect(onSort).toHaveBeenCalledWith('name');
  });

  it('draws no sort button on a column without a sort key', () => {
    renderFruitTable(buildFruits(2));

    expect(screen.queryByRole('button', { name: 'Note' })).not.toBeInTheDocument();
  });
});

describe('DataTable rows', () => {
  it('right-aligns numeric cells', () => {
    renderFruitTable(buildFruits(1));

    expect(screen.getByRole('cell', { name: '0.50' })).toHaveClass('text-right');
  });

  it('shows one row per item in order', () => {
    renderFruitTable(buildFruits(3));
    const [, ...bodyRows] = screen.getAllByRole('row');

    expect(bodyRows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toStrictEqual(['fruit-1', 'fruit-2', 'fruit-3']);
  });

  it('shows the empty text across every column in place of rows', () => {
    renderFruitTable([]);

    expect(screen.getByRole('cell', { name: 'No rows match.' })).toHaveAttribute('colspan', '3');
  });

  it.each([[16, true], [15, false]])('scrolls a table of %i rows inside its card: %s', (count, scrolls) => {
    const { container } = renderFruitTable(buildFruits(count));

    expect(container.firstElementChild?.classList.contains('max-h-[70vh]')).toBe(scrolls);
  });

  it('draws the rows a caller adds under a row', () => {
    renderFruitTable(buildFruits(1), { renderAfter: (row) => <tr><td colSpan={3}>{`${row.name} details`}</td></tr> });

    expect(screen.getByRole('cell', { name: 'fruit-1 details' })).toBeInTheDocument();
  });

  it('names the leading column for screen readers only', () => {
    renderFruitTable(buildFruits(1), {
      leading: {
        label: 'Expand',
        render: () => '+',
      },
    });

    expect(screen.getByRole('columnheader', { name: 'Expand' })).toBeInTheDocument();
  });
});
