import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { ReportTable } from './ReportTable';
import { SectionPlaceholder } from './SectionPlaceholder';

interface Row {
  readonly name: string;
  readonly count: number;
}

const COLUMNS = [
  {
    header: 'Name',
    render: (row: Row) => row.name,
  },
  {
    header: 'Count',
    numeric: true,
    render: (row: Row) => row.count,
  },
];

describe('ReportTable', () => {
  it('right-aligns the heading and cells of a numeric column only', () => {
    render(<ReportTable columns={COLUMNS} rows={[{
      name: 'reddit.com',
      count: 12,
    }]} rowKey={(row) => row.name} />);

    expect(screen.getByRole('columnheader', { name: 'Count' })).toHaveClass('text-right');
    expect(screen.getByRole('cell', { name: '12' })).toHaveClass('text-right', 'tabular-nums');
    expect(screen.getByRole('cell', { name: 'reddit.com' })).toHaveClass('text-left');
  });

  it('keeps a table that fits its card out of the tab order', () => {
    render(<ReportTable columns={COLUMNS} rows={[]} rowKey={(row) => row.name} />);

    expect(screen.getByRole('table').parentElement).not.toHaveAttribute('tabindex');
  });
});

describe('SectionPlaceholder', () => {
  it.each(['stats', 'chart', 'table', 'block'] as const)('announces a %s skeleton with its loading message', (shape) => {
    render(<SectionPlaceholder variant="loading" message="Loading the latest runs…" shape={shape} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading the latest runs…');
  });

  it('shows the reason of an error as text', () => {
    render(<SectionPlaceholder variant="error" message="Request failed" />);

    expect(screen.getByText('Request failed')).toHaveClass('text-red-700');
  });
});
