/** A small fruit price list drawn by `DataTable`, for `DataTable.spec.tsx`. */
import { render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { vi } from 'vitest';
import {
  DataTable, type DataColumn
} from './DataTable';

interface FruitRow {
  readonly name: string;
  readonly price: number;
}

type FruitSort = 'name' | 'price';

const FRUIT_COLUMNS: ReadonlyArray<DataColumn<FruitRow, FruitSort>> = [
  {
    id: 'name',
    header: 'Name',
    sortKey: 'name',
    render: (row) => row.name,
  },
  {
    id: 'price',
    header: 'Price',
    help: 'Price per kilogram',
    sortKey: 'price',
    numeric: true,
    render: (row) => row.price.toFixed(2),
  },
  {
    id: 'note',
    header: 'Note',
    render: () => 'fresh',
  },
];

export function buildFruits(count: number): FruitRow[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `fruit-${index + 1}`,
    price: index + 0.5,
  }));
}

type FruitTableProps = ComponentProps<typeof DataTable<FruitRow, FruitSort>>;

/** The fruit table sorted by price, largest first; `overrides` replace any prop. */
export function renderFruitTable(rows: readonly FruitRow[], overrides: Partial<FruitTableProps> = {}) {
  const onSort = vi.fn<(key: FruitSort) => void>();
  const view = render(
    <DataTable rows={rows} columns={FRUIT_COLUMNS} rowKey={(row) => row.name} caption="Fruit prices"
      sort={{
        key: 'price',
        order: 'desc',
      }}
      onSort={onSort} {...overrides} />,
  );
  return {
    ...view,
    onSort,
  };
}
