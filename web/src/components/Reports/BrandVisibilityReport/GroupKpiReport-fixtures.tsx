import { vi } from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type {
  GroupKpiHistoryResponse, KeywordRun
} from '../../../types/domain/groupKpiHistory';
import userEvent from '@testing-library/user-event';
import { GroupKpiReport } from './GroupKpiReport';
import { GroupKpiExportButton } from './GroupKpiExportButton';
import {
  buildDetail, buildHistory, detailWithKeywordRun, historyWithKeywordRun, RUN_1
} from './groupKpiHistory-fixtures';
import type { GroupKpiDetail } from './groupKpiDetail';
import { stubGroupDetail } from './groupKpiDetail-fixtures';
import { sectionTable } from '../layout/reportQueries-fixtures';

/** A headline card footnote of `buildHistory()`'s latest group run: the change since RUN_1. */
export function groupRunFootnote(change: string): string {
  return `${change} since ${new Date(RUN_1).toLocaleString()}`;
}

/** The keyword group every report fixture covers. */
export const HOTEL_SOL_SCOPE = {
  kind: 'group',
  groupId: 'hotel-sol',
} as const;

interface Options {
  readonly history?: GroupKpiHistoryResponse | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  /** What the drivers and keyword detail sections read on demand (the spec mocks `hooks/useGroupKpiDetail`). */
  readonly detail?: GroupKpiDetail;
  /** The on-demand reads still loading, or failed with `error`. */
  readonly detailState?: {
    readonly loading?: boolean;
    readonly error?: string | null 
  };
}

/**
 * Mount the per-group report (90 days) with `buildHistory()` and
 * `buildDetail()` unless told otherwise; returns the period callback.
 */
export function renderGroupKpiReport({
  history = buildHistory(), loading = false, error = null, detail = buildDetail(), detailState = {}
}: Options = {}) {
  stubGroupDetail(detail, detailState);
  const onDaysChange = vi.fn<(days: number) => void>();
  render(
    <GroupKpiReport
      scope={HOTEL_SOL_SCOPE}
      scopeLabel="Hotel Sol"
      history={history}
      loading={loading}
      error={error}
      days={90}
      onDaysChange={onDaysChange}
    />,
  );
  return { onDaysChange };
}

/** The report of a group whose only keyword, "k", has the single run `run`. */
export function withKeywordRun(run: KeywordRun): Options {
  return {
    history: historyWithKeywordRun(run),
    detail: detailWithKeywordRun(run),
  };
}

/** The report while its history loads. */
export const LOADING_HISTORY: Options = {
  history: null,
  loading: true,
};

/** The report of a period without any run. */
export const NO_RUN_HISTORY: Options = { history: buildHistory({ runs: [] }) };

/** The report whose history request failed with `error`. */
export function failedHistory(error: string): Options {
  return {
    history: null,
    error,
  };
}

/** Mount the report on `buildHistory()` and pick the run at `timestamp`. */
export async function renderGroupKpiReportAt(timestamp: string): Promise<void> {
  renderGroupKpiReport();
  await userEvent.selectOptions(screen.getByLabelText('Run'), timestamp);
}

/** The "Brand mentioned" cell of each body row of the keyword detail table, top to bottom. */
export function keywordDetailMentions(): string[] {
  return sectionTable('Keyword detail').slice(1).map((row) => row[1]);
}

/** Mount the export button on the second run of `buildHistory()` and click it. */
export async function clickGroupKpiExport(): Promise<void> {
  const history = buildHistory();
  render(<GroupKpiExportButton scope={HOTEL_SOL_SCOPE} scopeLabel="Hotel Sol" history={history} run={history.runs[1]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));
}
