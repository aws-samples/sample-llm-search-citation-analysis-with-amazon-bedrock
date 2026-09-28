import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import { kpiColumn } from './kpiColumn';
import { ReportTable } from './ReportTable';
import { KPI_DEFINITIONS } from '../../../constants/kpiDefinitions';

interface Row {
  readonly name: string;
  readonly rate: number;
}

const ROW: Row = {
  name: 'hotel sol spa',
  rate: 42,
};

describe('kpiColumn', () => {
  it('heads the column with the KPI label by default', () => {
    expect(kpiColumn<Row>('mention_rate', vi.fn()).header).toBe('Mention rate');
  });

  it('heads the column with a custom header when given one', () => {
    expect(kpiColumn<Row>('mentions', vi.fn(), 'Answers mentioning').header).toBe('Answers mentioning');
  });

  it.each([['mention_rate'], ['average_position'], ['net_sentiment']] as const)('explains the %s column with the KPI definition', (id) => {
    expect(kpiColumn<Row>(id, vi.fn()).info).toBe(KPI_DEFINITIONS[id].definition);
  });

  it('renders each cell with the given render function', () => {
    const renderCell = vi.fn((row: Row) => `${row.rate}%`);

    expect(kpiColumn('mention_rate', renderCell).render(ROW)).toBe('42%');
    expect(renderCell).toHaveBeenCalledWith(ROW);
  });
});

describe('ReportTable header tooltips', () => {
  const columns = [
    {
      header: 'Keyword',
      render: (row: Row) => row.name,
    },
    kpiColumn('mention_rate', (row: Row) => `${row.rate}%`),
  ];

  it('explains a column with an info text in a tooltip next to its heading', () => {
    render(<ReportTable columns={columns} rows={[ROW]} rowKey={(row) => row.name} />);

    expect(within(screen.getByRole('columnheader', { name: /^Mention rate/ })).getByRole('button', { name: 'About Mention rate' }))
      .toHaveAccessibleDescription(KPI_DEFINITIONS.mention_rate.definition);
  });

  it('adds no tooltip to a column without an info text', () => {
    render(<ReportTable columns={columns} rows={[ROW]} rowKey={(row) => row.name} />);

    expect(within(screen.getByRole('columnheader', { name: 'Keyword' })).queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the cells of a KPI column', () => {
    render(<ReportTable columns={columns} rows={[ROW]} rowKey={(row) => row.name} />);

    expect(screen.getByRole('cell', { name: '42%' })).toBeInTheDocument();
  });
});

describe('ReportTable cell alignment', () => {
  const styledColumns = [{
    header: 'Keyword',
    cellClassName: 'font-medium',
    render: (row: Row) => row.name,
  }];

  it('top-aligns every body cell when asked to', () => {
    render(<ReportTable columns={styledColumns} rows={[ROW]} rowKey={(row) => row.name} alignTop />);

    expect(screen.getByRole('cell', { name: ROW.name })).toHaveClass('align-top', 'font-medium');
  });

  it('keeps body cells vertically centred by default', () => {
    render(<ReportTable columns={styledColumns} rows={[ROW]} rowKey={(row) => row.name} />);

    expect(screen.getByRole('cell', { name: ROW.name })).not.toHaveClass('align-top');
  });
});
