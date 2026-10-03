import {
  Routes, Route, Navigate,
} from 'react-router-dom';
import {
  lazy, Suspense 
} from 'react';
import { Spinner } from '../ui/Spinner';
import { ErrorBoundary } from '../ErrorBoundary';
import { ReportsLandingView } from './ReportsLandingView';
import type { Keyword } from '../../types';

/**
 * Reports load lazily so a user who never opens the Reporting section doesn't
 * pay the bundle cost. Each report's data hooks pull a fair amount of code
 * (chart libraries, persona logic, etc.), so the lazy boundary is per-report.
 */
const KeywordDeepDiveReport = lazy(() =>
  import('./KeywordDeepDiveReport').then((m) => ({default: m.KeywordDeepDiveReport,})),
);

const ContentActionPlanReport = lazy(() =>
  import('./ContentActionPlanReport').then((m) => ({default: m.ContentActionPlanReport,})),
);

const BrandVisibilityReport = lazy(() =>
  import('./BrandVisibilityReport').then((m) => ({default: m.BrandVisibilityReport,})),
);

const ExecutiveSummaryReport = lazy(() =>
  import('./ExecutiveSummaryReport').then((m) => ({default: m.ExecutiveSummaryReport,})),
);

const CompetitorGapReport = lazy(() =>
  import('./CompetitorGapReport').then((m) => ({default: m.CompetitorGapReport,})),
);

const CompetitorBenchmarkReport = lazy(() =>
  import('./CompetitorBenchmarkReport').then((m) => ({default: m.CompetitorBenchmarkReport,})),
);

const AiEnginesReport = lazy(() =>
  import('./AiEnginesReport').then((m) => ({default: m.AiEnginesReport,})),
);

const SourcesReport = lazy(() =>
  import('./SourcesReport').then((m) => ({default: m.SourcesReport,})),
);

const SentimentReport = lazy(() =>
  import('./SentimentReport').then((m) => ({default: m.SentimentReport,})),
);

const CustomReportBuilder = lazy(() =>
  import('./customReport/CustomReportBuilder').then((m) => ({default: m.CustomReportBuilder,})),
);

const CustomReportView = lazy(() =>
  import('./customReport/CustomReportView').then((m) => ({default: m.CustomReportView,})),
);

interface Props {readonly keywords: ReadonlyArray<Keyword>;}

function ReportFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <Spinner size="lg" />
    </div>
  );
}

/**
 * Sub-router for `/reports/*` paths.
 *
 * Lives parallel to the dashboard's `TabContent` rather than inside it because
 * reports use parameterised URLs (`/reports/keyword/:keyword?`) and need the
 * full `react-router-dom` `Routes` machinery, while `TabContent` is a switch
 * over a flat tab id.
 *
 * As each new report ships it gets a `<Route>` here. The catch-all redirects
 * unknown sub-paths back to the landing view so old links don't 404.
 */
export function ReportsRouter({ keywords }: Props) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<ReportFallback />}>
        <Routes>
          <Route path="/reports" element={<ReportsLandingView />} />
          <Route
            path="/reports/keyword"
            element={<KeywordDeepDiveReport keywords={keywords} />}
          />
          <Route
            path="/reports/keyword/:keyword"
            element={<KeywordDeepDiveReport keywords={keywords} />}
          />
          <Route
            path="/reports/content-action-plan"
            element={<ContentActionPlanReport />}
          />
          <Route
            path="/reports/visibility"
            element={<BrandVisibilityReport keywords={keywords} />}
          />
          <Route
            path="/reports/visibility/:keyword"
            element={<BrandVisibilityReport keywords={keywords} />}
          />
          <Route
            path="/reports/executive-summary"
            element={<ExecutiveSummaryReport />}
          />
          <Route
            path="/reports/competitor"
            element={<CompetitorGapReport />}
          />
          <Route
            path="/reports/competitor/:competitor"
            element={<CompetitorGapReport />}
          />
          <Route
            path="/reports/benchmark"
            element={<CompetitorBenchmarkReport keywords={keywords} />}
          />
          <Route
            path="/reports/engines"
            element={<AiEnginesReport keywords={keywords} />}
          />
          <Route
            path="/reports/sources"
            element={<SourcesReport keywords={keywords} />}
          />
          <Route
            path="/reports/sentiment"
            element={<SentimentReport keywords={keywords} />}
          />
          <Route path="/reports/custom/new" element={<CustomReportBuilder />} />
          <Route path="/reports/custom/:id/edit" element={<CustomReportBuilder />} />
          <Route
            path="/reports/custom/:id"
            element={<CustomReportView keywords={keywords} />}
          />
          <Route path="*" element={<Navigate to="/reports" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
