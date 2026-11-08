import {
  describe, expect, it, vi
} from 'vitest';
import { createElement } from 'react';
import {
  render, screen
} from '@testing-library/react';
import { buildSeoGeoState } from '../../../../hooks/useSeoGeo-fixtures';
import {
  chooseExportFormat, mockStartExport
} from '../../../../test/exportsApiMock';
import { SeoGeoTableSection } from './SeoGeoTableSection';
import { SeoGeoTrafficSection } from './SeoGeoTrafficSection';

vi.mock('chart.js', () => import('../../../Dashboard/chartJs-fixtures'));
vi.mock('../../../../api/exports', () => import('../../../../test/exportsApiMock'));

describe.each([
  {
    name: 'SeoGeoTableSection',
    section: SeoGeoTableSection,
    table: 'Keywords',
  },
  {
    name: 'SeoGeoTrafficSection',
    section: SeoGeoTrafficSection,
    table: 'Traffic share',
  },
])('$name export', ({
  section, table
}) => {
  it('exports its table of the report market and group from the server', async () => {
    render(createElement(section, {
      state: buildSeoGeoState(),
      exportScope: {
        market_id: 'es',
        group_id: 'g1',
      },
    }));

    await chooseExportFormat('xlsx');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'seo-geo',
      params: {
        group_id: 'g1',
        market_id: 'es',
        table,
      },
      format: 'xlsx',
    });
  });

  it('keeps the export button out of the printed report', () => {
    render(createElement(section, {
      state: buildSeoGeoState(),
      exportScope: {},
    }));

    expect(screen.getByRole('button', { name: 'Export all' }).parentElement?.parentElement).toHaveClass('print-hidden');
  });

  it('offers no export without the report scope (a custom report block)', () => {
    render(createElement(section, { state: buildSeoGeoState() }));

    expect(screen.queryByRole('button', { name: 'Export all' })).not.toBeInTheDocument();
  });
});
