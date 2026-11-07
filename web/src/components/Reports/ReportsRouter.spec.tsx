import {
  describe, it, expect, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReportsRouter } from './ReportsRouter';
import {
  buildScopeReport, SCOPE_KEYWORDS, SCOPE_REPORTS
} from './scopeReport/scopeReport-fixtures';
import { buildKeywordGroupsHookResult } from '../../hooks/useKeywordGroups-fixtures';

vi.mock('./scopeReport/useScopeReportData', () => ({ useScopeReportData: vi.fn() }));
vi.mock('../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));
vi.mock('chart.js', () => import('../Dashboard/chartJs-fixtures'));
vi.mock('../../api/seo', () => import('../../hooks/useSeoAccount-fixtures'));
vi.mock('../../hooks/usePrintMode', () => ({ usePrintMode: vi.fn(() => ({ isPrintMode: false })) }));

import { useScopeReportData } from './scopeReport/useScopeReportData';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';

vi.mocked(useScopeReportData).mockReturnValue(buildScopeReport());
vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupsHookResult([]));

function renderReportsAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ReportsRouter keywords={SCOPE_KEYWORDS} />
    </MemoryRouter>,
  );
}

describe('ReportsRouter', () => {
  it.each(SCOPE_REPORTS)('opens the %s report at %s', async (title, path) => {
    renderReportsAt(path);

    expect(await screen.findByRole('heading', {
      level: 1,
      name: title,
    })).toBeInTheDocument();
  });

  it('opens the SEO vs GEO report at /reports/seo-geo', async () => {
    renderReportsAt('/reports/seo-geo');

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'SEO vs GEO',
    })).toBeInTheDocument();
  });

  it('opens the custom report builder at /reports/custom/new', async () => {
    renderReportsAt('/reports/custom/new');

    // The builder's lazy chunk carries every block of the catalogue; a cold import takes a few seconds.
    expect(await screen.findByRole('heading', { name: 'Create a custom report' }, { timeout: 5000 })).toBeInTheDocument();
  });
});
