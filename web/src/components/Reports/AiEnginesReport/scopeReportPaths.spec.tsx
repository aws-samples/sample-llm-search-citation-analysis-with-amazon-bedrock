import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import type { ReactElement } from 'react';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter, Route, Routes
} from 'react-router-dom';
import { AiEnginesReport } from './AiEnginesReport';
import { SourcesReport } from '../SourcesReport';
import { SentimentReport } from '../SentimentReport';
import {
  buildScopeReport, HOTEL_SOL_GROUP, SCOPE_KEYWORDS
} from '../scopeReport/scopeReport-fixtures';
import { buildKeywordGroupsHookResult } from '../../../hooks/useKeywordGroups-fixtures';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));
vi.mock('../scopeReport/useScopeReportData', () => ({ useScopeReportData: vi.fn() }));
vi.mock('../../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));

import { useScopeReportData } from '../scopeReport/useScopeReportData';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';

/** The AI Engines, Sources and Sentiment reports, each with the route its scope selector opens. */
const ROUTED_REPORTS: ReadonlyArray<readonly [string, () => ReactElement]> = [
  ['/reports/engines', () => <AiEnginesReport keywords={SCOPE_KEYWORDS} />],
  ['/reports/sources', () => <SourcesReport keywords={SCOPE_KEYWORDS} />],
  ['/reports/sentiment', () => <SentimentReport keywords={SCOPE_KEYWORDS} />],
];

describe.each(ROUTED_REPORTS)('the report routed at %s', (path, report) => {
  beforeEach(() => {
    vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupsHookResult([HOTEL_SOL_GROUP]));
    vi.mocked(useScopeReportData).mockReturnValue(buildScopeReport());
  });

  it('opens its own route for the scope picked in the selector, wherever it was opened', async () => {
    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={report()} />
          <Route path={path} element={<p>The report route</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.selectOptions(screen.getByLabelText('Scope'), 'group:hotel-sol');

    expect(screen.getByText('The report route')).toBeInTheDocument();
  });
});
