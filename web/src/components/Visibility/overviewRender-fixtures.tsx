import type { ComponentProps } from 'react';
import { vi } from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisibilityOverview } from './VisibilityOverview';
import {
  buildTrendsResponse, buildVisibility
} from './visibilityOverview-fixtures';

type OverviewProps = ComponentProps<typeof VisibilityOverview>;

/** The "Hotel Sol" group overview with its 30-day trends unless overridden. */
export function renderOverview(overrides: Partial<OverviewProps> = {}) {
  const props: OverviewProps = {
    visibility: buildVisibility(),
    trends: buildTrendsResponse(),
    trendsError: null,
    scopeLabel: 'Hotel Sol',
    rangeDays: 30,
    onRangeChange: vi.fn(),
    ...overrides,
  };
  return {
    props,
    ...render(<VisibilityOverview {...props} />),
  };
}

/** Clicks the overview's "Export to Excel" button. */
export async function clickExportToExcel(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));
}
