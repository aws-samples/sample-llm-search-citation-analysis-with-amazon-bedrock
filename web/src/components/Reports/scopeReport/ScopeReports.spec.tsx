import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  buildScopeReport, failedScopeReport, HOTEL_SOL_GROUP, loadingScopeReport, NETWORK_ERROR, renderScopeReport, SCOPE_REPORTS,
  unansweredScopeReport
} from './scopeReport-fixtures';
import {
  definitionTerms, sectionTitles
} from '../layout/reportQueries-fixtures';
import {
  ALL_SCOPE, groupScope, keywordScope
} from '../../ui/reportScope-fixtures';
import { buildKeywordGroupsHookResult } from '../../../hooks/useKeywordGroups-fixtures';
import { VISIBILITY_DEFINITIONS } from '../../../constants/kpiDefinitions';
import {
  NO_ANSWERED_RUN, noTrendMessage
} from './scopeSectionGate';

vi.mock('./useScopeReportData', () => ({ useScopeReportData: vi.fn() }));
vi.mock('../../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));
vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));
vi.mock('../../../hooks/usePrintMode', () => ({ usePrintMode: vi.fn(() => ({ isPrintMode: false })) }));

import { useScopeReportData } from './useScopeReportData';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';
import { usePrintMode } from '../../../hooks/usePrintMode';

const mockReportData = vi.mocked(useScopeReportData);

describe.each(SCOPE_REPORTS)('%s report', (title, path, report, sections) => {
  beforeEach(() => {
    mockReportData.mockReturnValue(buildScopeReport());
    vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupsHookResult([HOTEL_SOL_GROUP]));
  });

  it('carries the report title as its page heading', () => {
    renderScopeReport(report, path);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(title);
  });

  it('lists its sections in order and ends with the definitions', () => {
    renderScopeReport(report, path);

    expect(sectionTitles()).toStrictEqual([...sections, 'How these KPIs are measured']);
  });

  it('defines every KPI and the trend rule at the end', () => {
    renderScopeReport(report, path);

    expect(definitionTerms()).toStrictEqual(VISIBILITY_DEFINITIONS.map((entry) => entry.label));
  });

  it('covers every keyword over the last 30 days at its bare path', () => {
    renderScopeReport(report, path);

    expect(mockReportData).toHaveBeenCalledWith(ALL_SCOPE, 30);
  });

  it('covers the keyword named in the URL', () => {
    renderScopeReport(report, path, '?keyword=best%20running%20shoes');

    expect(mockReportData).toHaveBeenCalledWith(keywordScope('best running shoes'), 30);
  });

  it('covers the group and the period named in the URL', () => {
    renderScopeReport(report, path, '?group=hotel-sol&days=90');

    expect(mockReportData).toHaveBeenCalledWith(groupScope('hotel-sol'), 90);
  });

  it('switches to the keyword group picked in the scope selector', async () => {
    renderScopeReport(report, path, '?days=180');

    await userEvent.selectOptions(screen.getByLabelText('Scope'), 'group:hotel-sol');

    expect(mockReportData).toHaveBeenLastCalledWith(groupScope('hotel-sol'), 180);
  });

  it('keeps the scope when another trend period is picked', async () => {
    renderScopeReport(report, path, '?keyword=best%20running%20shoes');

    await userEvent.selectOptions(screen.getByLabelText('Trend period'), '180');

    expect(mockReportData).toHaveBeenLastCalledWith(keywordScope('best running shoes'), 180);
  });

  it('names the group from the group list while the latest runs load', () => {
    mockReportData.mockReturnValue(loadingScopeReport());
    renderScopeReport(report, path, '?group=hotel-sol');

    expect(screen.getByText(/"Hotel Sol"/)).toBeInTheDocument();
  });

  it('names the scope as the API labels it once the latest runs answered', () => {
    renderScopeReport(report, path);

    expect(screen.getByText(/"best running shoes"/)).toBeInTheDocument();
  });

  it('lets the page print once both fetches settled', () => {
    renderScopeReport(report, path);

    expect(usePrintMode).toHaveBeenLastCalledWith({ ready: true });
  });

  it('holds printing while a fetch is in flight', () => {
    mockReportData.mockReturnValue(loadingScopeReport());
    renderScopeReport(report, path);

    expect(usePrintMode).toHaveBeenLastCalledWith({ ready: false });
  });

  it('keeps every section heading while the data loads', () => {
    mockReportData.mockReturnValue(loadingScopeReport());
    renderScopeReport(report, path);

    expect(sectionTitles()).toStrictEqual([...sections, 'How these KPIs are measured']);
  });

  it('shows a loading message in every section while the data loads', () => {
    mockReportData.mockReturnValue(loadingScopeReport());
    renderScopeReport(report, path);

    expect(screen.getAllByText(/^Loading the/)).toHaveLength(sections.length);
  });

  it('shows the error in every section when both fetches fail', () => {
    mockReportData.mockReturnValue(failedScopeReport());
    renderScopeReport(report, path);

    expect(screen.getAllByText(NETWORK_ERROR)).toHaveLength(sections.length);
  });

  it('explains in every section that a scope without runs has nothing to show', () => {
    mockReportData.mockReturnValue(unansweredScopeReport());
    renderScopeReport(report, path);

    expect([...screen.queryAllByText(NO_ANSWERED_RUN), ...screen.queryAllByText(noTrendMessage(30))]).toHaveLength(sections.length);
  });
});
