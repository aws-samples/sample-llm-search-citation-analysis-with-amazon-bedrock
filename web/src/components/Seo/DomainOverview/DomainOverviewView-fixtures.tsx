/**
 * The Domain Overview page under the market selection, with the SEO API answering from fixtures.
 */
import {
  screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  expect, vi
} from 'vitest';
import { EXPORT_EXCEL_LABEL } from '../../ui/ExportExcelButton';
import {
  fetchDomainKeywords, fetchDomainOverview, fetchDomainPages, fetchDomainSnapshots, fetchSerpCompetitors, takeDomainSnapshot
} from '../../../api/seoDomains';
import {
  buildDomainKeywords, buildDomainOverview, buildDomainPages, buildDomainSnapshots, buildSerpCompetitors, SNAPSHOT_STARTED
} from '../../../api/seoDomains-fixtures';
import { mockAdminRole } from '../../../test/useIsAdminMock';
import {
  buildMarketSelectionMock, renderWithMarketSelection
} from '../../Markets/markets-fixtures';
import { MemoryRouter } from 'react-router-dom';
import { DomainOverviewView } from './DomainOverviewView';
import { mockBrandSettings } from '../settingsDomains-fixtures';
import {
  exportTableToExcel, type ExcelTableColumn, type TableExport
} from '../../../exporters/tableExcel';

export const SWISS_MARKET_ID = 'ch-de';

/** A refusal of the SEO API, as `seoErrorMessage` shows it. */
export class SeoRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeoRefusal';
  }
}

/** Every paid lookup answering its fixture; the user is an Admin only when `admin`. */
export function mockDomainAnswers(admin = false): void {
  vi.mocked(fetchDomainOverview).mockResolvedValue(buildDomainOverview());
  vi.mocked(fetchDomainKeywords).mockResolvedValue(buildDomainKeywords());
  vi.mocked(fetchDomainPages).mockResolvedValue(buildDomainPages());
  vi.mocked(fetchSerpCompetitors).mockResolvedValue(buildSerpCompetitors());
  vi.mocked(takeDomainSnapshot).mockResolvedValue(SNAPSHOT_STARTED);
  vi.mocked(fetchDomainSnapshots).mockResolvedValue(buildDomainSnapshots());
  mockAdminRole(admin);
  mockBrandSettings();
}

/** The page with Switzerland picked in the header. */
export function renderDomainOverview() {
  return renderWithMarketSelection(<MemoryRouter><DomainOverviewView /></MemoryRouter>, buildMarketSelectionMock({ selectedMarketId: SWISS_MARKET_ID }));
}

/** Renders the page, types `target` and presses Analyze, without waiting for the answers. */
export async function submitDomain(target = 'example.com') {
  renderDomainOverview();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Domain or URL'), target);
  await user.click(screen.getByRole('button', { name: 'Analyze' }));
  return user;
}

/** Renders the page, types `target`, presses Analyze and waits for the ranked keyword on screen. */
export async function analyzeDomain(target = 'example.com') {
  const user = await submitDomain(target);
  await screen.findByText('cheap flights');
  return user;
}

/** A control the page specs click, by role and accessible name. */
export interface DomainClick {
  readonly role: 'button' | 'tab';
  readonly name: string | RegExp;
}

/** Analyzes example.com, then clicks each control named in `clicks` (buttons, tabs) in order. */
export async function analyzeAndClick(...clicks: readonly DomainClick[]) {
  const user = await analyzeDomain();
  for (const click of clicks) {
    await user.click(screen.getByRole(click.role, { name: click.name }));
  }
  return user;
}

/** The request the `call`-th call of a mocked lookup sent. */
export function sentRequest<TRequest>(lookup: (request: TRequest) => Promise<unknown>, call = 0): TRequest | undefined {
  return vi.mocked(lookup).mock.calls[call]?.[0];
}

/** Analyzes example.com, clicks `clicks`, then the export titled `title`; returns what the (mocked) exporter got. */
export async function exportedTable(title: string, ...clicks: readonly DomainClick[]) {
  const user = await analyzeAndClick(...clicks);
  await user.click(await screen.findByTitle(title));
  return vi.mocked(exportTableToExcel).mock.lastCall?.[0];
}

/** Analyzes example.com, clicks `clicks`, then the visible paged list's "Export to Excel": the export dialog is open. */
export async function openPagedExport(...clicks: readonly DomainClick[]) {
  const user = await analyzeAndClick(...clicks);
  await user.click(await screen.findByRole('button', { name: EXPORT_EXCEL_LABEL }));
  return user;
}

/** Opens the paged export after `clicks`, then presses `button` in the dialog; returns what the (mocked) exporter got. */
export async function pagedExportVia(button: string, ...clicks: readonly DomainClick[]) {
  const user = await openPagedExport(...clicks);
  await user.click(screen.getByRole('button', { name: button }));
  await waitFor(() => {
    expect(vi.mocked(exportTableToExcel).mock.calls).toHaveLength(1);
  });
  return vi.mocked(exportTableToExcel).mock.lastCall?.[0];
}

/** The export of `rows` of example.com under `columns`. */
export function buildExampleExport<TRow>(
  columns: ReadonlyArray<ExcelTableColumn<TRow>>, rows: readonly TRow[], sheetName: string, filePrefix: string
): TableExport<TRow> {
  return {
    columns,
    rows,
    sheetName,
    filePrefix,
    scopeLabel: 'example.com',
  };
}
