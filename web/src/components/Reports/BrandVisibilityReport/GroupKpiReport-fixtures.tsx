import { vi } from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type { GroupKpiHistoryResponse } from '../../../types/domain/groupKpiHistory';
import userEvent from '@testing-library/user-event';
import { GroupKpiReport } from './GroupKpiReport';
import { GroupKpiExportButton } from './GroupKpiExportButton';
import { buildHistory } from './groupKpiHistory-fixtures';
import { sectionTable } from '../layout/reportQueries-fixtures';

/** The keyword group every report fixture covers. */
export const HOTEL_SOL_SCOPE = {
  kind: 'group',
  groupId: 'hotel-sol',
} as const;

interface Options {
  readonly history?: GroupKpiHistoryResponse | null;
  readonly loading?: boolean;
  readonly error?: string | null;
}

/** Mount the per-group report (90 days) with `buildHistory()` unless told otherwise; returns the period callback. */
export function renderGroupKpiReport({
  history = buildHistory(), loading = false, error = null
}: Options = {}) {
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
