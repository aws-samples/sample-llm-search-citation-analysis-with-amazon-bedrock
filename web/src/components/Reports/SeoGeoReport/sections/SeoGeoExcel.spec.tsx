import {
  describe, expect, it, vi
} from 'vitest';
import { createElement } from 'react';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { exportTableToExcel } from '../../../../exporters/tableExcel';
import {
  buildSeoGeoResponse, buildSeoGeoState
} from '../../../../hooks/useSeoGeo-fixtures';
import { EXPORT_EXCEL_LABEL } from '../../../ui/ExportExcelButton';
import { SeoGeoTableSection } from './SeoGeoTableSection';
import { SeoGeoTrafficSection } from './SeoGeoTrafficSection';

vi.mock('chart.js', () => import('../../../Dashboard/chartJs-fixtures'));
vi.mock('../../../../exporters/tableExcel', () => import('../../../../test/tableExcelMock'));

const RESPONSE = buildSeoGeoResponse();

describe.each([
  {
    name: 'SeoGeoTableSection',
    section: SeoGeoTableSection,
    rows: RESPONSE.rows,
    sheetName: 'SEO vs GEO keywords',
    filePrefix: 'seo-vs-geo',
  },
  {
    name: 'SeoGeoTrafficSection',
    section: SeoGeoTrafficSection,
    rows: RESPONSE.traffic_comparison,
    sheetName: 'SEO vs GEO traffic',
    filePrefix: 'seo-vs-geo-traffic',
  },
])('$name Excel export', ({
  section, rows, sheetName, filePrefix
}) => {
  it('exports every row of the table', async () => {
    render(createElement(section, {
      state: buildSeoGeoState(),
      scopeLabel: 'All keywords',
    }));

    await userEvent.click(screen.getByRole('button', { name: EXPORT_EXCEL_LABEL }));

    expect(vi.mocked(exportTableToExcel).mock.lastCall?.[0].rows).toStrictEqual(rows);
  });

  it('names the file after the report scope', async () => {
    render(createElement(section, {
      state: buildSeoGeoState(),
      scopeLabel: 'Geneva routes',
    }));

    await userEvent.click(screen.getByRole('button', { name: EXPORT_EXCEL_LABEL }));
    const table = vi.mocked(exportTableToExcel).mock.lastCall?.[0];

    expect([table?.sheetName, table?.filePrefix, table?.scopeLabel]).toStrictEqual([sheetName, filePrefix, 'Geneva routes']);
  });

  it('keeps the export button out of the printed report', () => {
    render(createElement(section, { state: buildSeoGeoState() }));

    expect(screen.getByRole('button', { name: EXPORT_EXCEL_LABEL }).parentElement).toHaveClass('print-hidden');
  });
});
