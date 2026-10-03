import {
  useId, type ReactNode
} from 'react';
import {
  useNavigate, useSearchParams
} from 'react-router-dom';
import { usePrintMode } from '../../../hooks/usePrintMode';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';
import type {
  Keyword, KeywordGroup, ReportScope
} from '../../../types';
import { VISIBILITY_DEFINITIONS } from '../../../constants/kpiDefinitions';
import { KeywordScopeSelector } from '../../ui/KeywordScopeSelector';
import { describeReportScope } from '../../ui/reportScope';
import { ReportLayout } from '../layout/ReportLayout';
import { KpiDefinitionsSection } from '../layout/KpiDefinitionsSection';
import {
  daysFromSearch, SCOPE_REPORT_PERIODS, scopeFromSearch, scopeReportPath, type ScopeReportDays
} from './scopeReportRoute';
import {
  useScopeReportData, type ScopeReportData
} from './useScopeReportData';

interface Props {
  readonly title: string;
  /** The report's route, e.g. `/reports/benchmark`; the scope and period ride in its query. */
  readonly basePath: string;
  readonly keywords: ReadonlyArray<Keyword>;
  /** The subtitle, given the scope's name ("All keywords", a group's or a keyword's). */
  readonly subtitle: (scopeLabel: string) => string;
  /** The report's sections, between the header and the definitions block. */
  readonly children: (report: ScopeReportData) => ReactNode;
}

/** The scope's name: the API's once the latest runs answered for it, the group list's before. */
export function scopeLabelOf(report: ScopeReportData, scope: ReportScope, groups: KeywordGroup[]): string {
  const answered = report.visibility.loading ? null : report.visibility.data;
  return answered?.scope.label ?? describeReportScope(scope, groups);
}

interface PeriodSelectorProps {
  readonly days: ScopeReportDays;
  readonly onChange: (days: ScopeReportDays) => void;
}

const PERIOD_OPTIONS = SCOPE_REPORT_PERIODS.map((period) => <option key={period} value={period}>{`Last ${period} days`}</option>);

/** The trend period picker of the scope reports, and of custom reports. */
export function PeriodSelector({
  days, onChange
}: PeriodSelectorProps) {
  const id = useId();
  const pick = (value: string) => onChange(SCOPE_REPORT_PERIODS.find((period) => String(period) === value) ?? days);
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-500 mb-1.5">Trend period</label>
      <select
        id={id}
        value={days}
        onChange={(event) => pick(event.target.value)}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50"
      >
        {PERIOD_OPTIONS}
      </select>
    </div>
  );
}

/**
 * The frame of the Competitor Benchmark, AI Engines, Sources and Sentiment
 * reports: the header with the scope selector (every keyword, a keyword
 * group or one keyword) and the trend period (30, 90 or 180 days), both
 * kept in the URL and hidden in print; the report's sections; and the
 * definitions of every KPI. Printing waits until both fetches settled.
 */
export function ScopeReport({
  title, basePath, keywords, subtitle, children
}: Props) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { groups } = useKeywordGroups();
  const scope = scopeFromSearch(searchParams);
  const days = daysFromSearch(searchParams);
  const report = useScopeReportData(scope, days);

  usePrintMode({ ready: report.ready });

  return (
    <ReportLayout
      title={title}
      subtitle={subtitle(scopeLabelOf(report, scope, groups))}
      actions={(
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <KeywordScopeSelector
            keywords={[...keywords]}
            groups={groups}
            value={scope}
            onChange={(next) => navigate(scopeReportPath(basePath, next, days))}
            className="min-w-[16rem]"
          />
          <PeriodSelector days={days} onChange={(next) => navigate(scopeReportPath(basePath, scope, next))} />
        </div>
      )}
    >
      {children(report)}
      <KpiDefinitionsSection definitions={VISIBILITY_DEFINITIONS} />
    </ReportLayout>
  );
}
