import type {
  ComponentType, ReactElement
} from 'react';
import { render } from '@testing-library/react';
import {
  MemoryRouter, Route, Routes, useLocation
} from 'react-router-dom';
import type {
  HistoricalTrendsResponse, Keyword, VisibilityResponse
} from '../../../types';
import { buildKeywordGroup } from '../../../hooks/useKeywordGroups-fixtures';
import {
  buildTrendView, buildVisibility
} from '../layout/reportPayload-fixtures';
import { CompetitorBenchmarkReport } from '../CompetitorBenchmarkReport';
import { AiEnginesReport } from '../AiEnginesReport';
import { SourcesReport } from '../SourcesReport';
import { SentimentReport } from '../SentimentReport';
import { ALL_SCOPE } from '../../ui/reportScope';
import type { ReportSlice } from '../layout/sectionGate';
import type { ScopeReportData } from './useScopeReportData';
import type { ScopeSectionProps } from './scopeSectionGate';

/**
 * Report data for the specs of the Competitor Benchmark, AI Engines,
 * Sources and Sentiment reports: the Nike world of `reportPayload-fixtures`
 * (`buildVisibility()` and `buildTrendView()`) over 30 days, unless
 * overridden.
 */

export const NETWORK_ERROR = 'Network down';

/** A fetch that settled with `data`. */
export function settledSlice<T>(data: T): ReportSlice<T> {
  return {
    data,
    loading: false,
    error: null,
  };
}

/** A fetch in flight. */
export const IN_FLIGHT = {
  data: null,
  loading: true,
  error: null,
} as const;

/** A fetch that failed with NETWORK_ERROR. */
export const FAILED = {
  data: null,
  loading: false,
  error: NETWORK_ERROR,
} as const;

/** Both fetches settled with the Nike world for every keyword, over the last 30 days per day, unless overridden. */
export function buildScopeReport(overrides: Partial<ScopeReportData> = {}): ScopeReportData {
  return {
    scope: ALL_SCOPE,
    visibility: settledSlice(buildVisibility()),
    trends: settledSlice(buildTrendView()),
    days: 30,
    period: 'day',
    ready: true,
    ...overrides,
  };
}

/** The report with `/visibility` answering `buildVisibility(overrides)`. */
export function reportWithVisibility(overrides: Partial<VisibilityResponse>): ScopeReportData {
  return buildScopeReport({ visibility: settledSlice(buildVisibility(overrides)) });
}

/** The report with `/trends` answering `buildTrendView(overrides)`. */
export function reportWithTrends(overrides: Partial<HistoricalTrendsResponse>): ScopeReportData {
  return buildScopeReport({ trends: settledSlice(buildTrendView(overrides)) });
}

/** Both fetches in flight. */
export function loadingScopeReport(): ScopeReportData {
  return buildScopeReport({
    visibility: IN_FLIGHT,
    trends: IN_FLIGHT,
    ready: false,
  });
}

/** Both fetches failed with NETWORK_ERROR. */
export function failedScopeReport(): ScopeReportData {
  return buildScopeReport({
    visibility: FAILED,
    trends: FAILED,
  });
}

/** A scope whose keywords have no answered run, in the window or ever. */
export function unansweredScopeReport(): ScopeReportData {
  return buildScopeReport({
    visibility: settledSlice(buildVisibility({ keywords_with_data: 0 })),
    trends: settledSlice(buildTrendView({ trend_data: [] })),
  });
}

/** The tracked keywords the reports offer in their scope selector. */
export const SCOPE_KEYWORDS: Keyword[] = [{
  id: 'kw-1',
  keyword: 'best running shoes',
  created_at: '2026-01-01T00:00:00Z',
}];

/** The keyword group the reports offer in their scope selector. */
export const HOTEL_SOL_GROUP = buildKeywordGroup({
  id: 'hotel-sol',
  name: 'Hotel Sol',
});

/** Renders report sections inside a router, for the sections that link elsewhere. */
export function renderSections(sections: ReactElement) {
  return render(<MemoryRouter>{sections}</MemoryRouter>);
}

/** A renderer of a report's `Sections` inside a router, fed `buildScopeReport()` unless given a report. */
export function sectionsRenderer(sections: ComponentType<ScopeSectionProps>) {
  const Sections = sections;
  return (report: ScopeReportData = buildScopeReport()) => renderSections(<Sections report={report} />);
}

type ReportElement = (keywords: Keyword[]) => ReactElement;

/** A scope report: its title, its route, the element and its section titles in order. */
export type ScopeReportCase = readonly [string, string, ReportElement, readonly string[]];

export const SCOPE_REPORTS: readonly ScopeReportCase[] = [
  [
    'Competitor Benchmark',
    '/reports/benchmark',
    (keywords) => <CompetitorBenchmarkReport keywords={keywords} />,
    ['Headline', 'Share of voice', 'Brands over time', 'Leaderboard'],
  ],
  [
    'AI Engines',
    '/reports/engines',
    (keywords) => <AiEnginesReport keywords={keywords} />,
    ['Headline', 'KPIs per engine', 'Every KPI per engine', 'Sentiment per engine'],
  ],
  [
    'Sources',
    '/reports/sources',
    (keywords) => <SourcesReport keywords={keywords} />,
    ['Headline', 'Most cited domains', 'Cited domains'],
  ],
  [
    'Sentiment',
    '/reports/sentiment',
    (keywords) => <SentimentReport keywords={keywords} />,
    ['Headline', 'Net sentiment over time', 'Sentiment per engine', 'Net sentiment per brand'],
  ],
];

/** The router's current path and query, read by its label "Current location". */
export function CurrentLocation() {
  const {
    pathname, search
  } = useLocation();
  return <output aria-label="Current location">{`${pathname}${search}`}</output>;
}

/**
 * Renders `report` routed at `route` (`path` unless given, e.g. `*` to mount
 * it away from its own route), opened at `path` + `search`, with the current
 * location beside it.
 */
export function renderScopeReport(report: ReportElement, path: string, search = '', route = path) {
  return render(
    <MemoryRouter initialEntries={[`${path}${search}`]}>
      <Routes>
        <Route path={route} element={<>{report(SCOPE_KEYWORDS)}<CurrentLocation /></>} />
      </Routes>
    </MemoryRouter>,
  );
}
