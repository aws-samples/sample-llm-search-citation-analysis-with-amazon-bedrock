import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, screen, waitFor
} from '@testing-library/react';
import { mockApiGet } from '../../../api/clientMock-fixtures';
import { buildCustomReport } from '../../../api/customReports-fixtures';
import { buildKeywordGroupsHookResult } from '../../../hooks/useKeywordGroups-fixtures';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';
import { usePrintMode } from '../../../hooks/usePrintMode';
import { useExecutiveSummary } from '../ExecutiveSummaryReport/useExecutiveSummary';
import { useKeywordDeepDive } from '../KeywordDeepDiveReport/useKeywordDeepDive';
import { useScopeReportData } from '../scopeReport/useScopeReportData';
import {
  buildScopeReport, HOTEL_SOL_GROUP, loadingScopeReport
} from '../scopeReport/scopeReport-fixtures';
import { buildHeadingBlock } from './customReport-fixtures';
import {
  REPORT_GONE, renderCustomReportRoute, renderWithoutSavedReports, reportsListPayload, sectionHeadingTexts
} from './customReportPages-fixtures';

vi.mock('../../../api/client', () => import('../../../api/clientMock-fixtures'));
vi.mock('../scopeReport/useScopeReportData', () => ({ useScopeReportData: vi.fn() }));
vi.mock('../ExecutiveSummaryReport/useExecutiveSummary', () => ({ useExecutiveSummary: vi.fn() }));
vi.mock('../KeywordDeepDiveReport/useKeywordDeepDive', () => ({ useKeywordDeepDive: vi.fn() }));
vi.mock('../../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));
vi.mock('../../../hooks/usePrintMode', () => ({ usePrintMode: vi.fn(() => ({ isPrintMode: false })) }));
vi.mock('./CustomReportBuilder', () => ({ CustomReportBuilder: vi.fn(() => null) }));
vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupsHookResult([HOTEL_SOL_GROUP]));

const REPORT_PATH = '/reports/custom/report-quarterly';

async function renderSavedReport(blocks: ReturnType<typeof buildCustomReport>['blocks'], search = '') {
  mockApiGet.mockResolvedValue(reportsListPayload(buildCustomReport({ blocks })));
  renderCustomReportRoute(`${REPORT_PATH}${search}`);
  await screen.findByRole('heading', {
    level: 1,
    name: 'Quarterly brand review',
  });
}

describe('CustomReportView', () => {
  beforeEach(() => {
    vi.mocked(useScopeReportData).mockReturnValue(buildScopeReport());
  });

  it('shows the blocks in their saved order', async () => {
    await renderSavedReport([buildHeadingBlock({ text: 'Where we stand' }), { type: 'sources_headline' }, { type: 'kpi_definitions' }]);

    expect(sectionHeadingTexts()).toStrictEqual([
      'Where we stand',
      'Headline',
      'How these KPIs are measured',
    ]);
  });

  it('names the report each section comes from', async () => {
    await renderSavedReport([{ type: 'sources_headline' }]);

    expect(screen.getByText('Sources')).toBeInTheDocument();
  });

  it('skips a block type the catalogue no longer offers', async () => {
    await renderSavedReport([{ type: 'retired_block' }, { type: 'sources_headline' }]);

    expect(sectionHeadingTexts()).toStrictEqual(['Headline']);
  });

  it('fetches the scope data for every keyword over the saved period', async () => {
    await renderSavedReport([{ type: 'sources_headline' }, { type: 'sentiment_trend' }]);

    expect(useScopeReportData).toHaveBeenCalledWith({ kind: 'all' }, 90);
    expect(useExecutiveSummary).not.toHaveBeenCalled();
  });

  it('opens on the keyword group and period in the URL', async () => {
    await renderSavedReport([{ type: 'sources_headline' }], '?group=hotel-sol&days=30');

    expect(useScopeReportData).toHaveBeenCalledWith({
      kind: 'group',
      groupId: 'hotel-sol',
    }, 30);
  });

  it('keeps the scope in the URL when the reader picks another period', async () => {
    await renderSavedReport([{ type: 'sources_headline' }], '?group=hotel-sol');
    fireEvent.change(screen.getByLabelText('Trend period'), { target: { value: '180' } });

    await waitFor(() => expect(screen.getByLabelText('Current location')).toHaveTextContent(`${REPORT_PATH}?group=hotel-sol&days=180`));
  });

  it('asks for a single keyword where a Keyword Deep Dive block cannot show every keyword', async () => {
    await renderSavedReport([{ type: 'keyword_personas' }]);

    expect(screen.getByText('Pick a single keyword above to show this block.')).toBeInTheDocument();
    expect(useKeywordDeepDive).not.toHaveBeenCalled();
  });

  it('is ready to print once every source has settled', async () => {
    await renderSavedReport([{ type: 'sources_headline' }]);

    expect(usePrintMode).toHaveBeenLastCalledWith({ ready: true });
  });

  it('waits to print while a source is still loading', async () => {
    vi.mocked(useScopeReportData).mockReturnValue(loadingScopeReport());
    await renderSavedReport([{ type: 'sources_headline' }]);

    expect(usePrintMode).toHaveBeenLastCalledWith({ ready: false });
  });

  it('opens the editor from its edit button', async () => {
    await renderSavedReport([{ type: 'sources_headline' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit report' }));

    expect(screen.getByLabelText('Current location')).toHaveTextContent(`${REPORT_PATH}/edit`);
  });

  it('says the report is gone when no saved report has the id', async () => {
    renderWithoutSavedReports('/reports/custom/report-missing');

    expect(await screen.findByText(REPORT_GONE)).toBeInTheDocument();
  });
});
