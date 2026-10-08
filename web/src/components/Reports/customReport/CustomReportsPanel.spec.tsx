import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { mockApiGet } from '../../../api/clientMock-fixtures';
import type { CustomReport } from '../../../api/customReports';
import { buildCustomReport } from '../../../api/customReports-fixtures';
import { ApiRequestError } from '../../../infrastructure';
import { CurrentLocation } from '../scopeReport/scopeReport-fixtures';
import { CustomReportsPanel } from './CustomReportsPanel';
import { reportsListPayload } from './customReportPages-fixtures';

vi.mock('../../../api/client', () => import('../../../api/clientMock-fixtures'));

const BOARD_PACK = buildCustomReport({
  id: 'report-board',
  title: 'Board pack',
});

function setupListing(...reports: CustomReport[]) {
  mockApiGet.mockResolvedValue(reportsListPayload(...reports));
}

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={['/reports']}>
      <CustomReportsPanel />
      <CurrentLocation />
    </MemoryRouter>,
  );
}

describe('CustomReportsPanel', () => {
  it.each([
    ['links every saved report to its page', 'Board pack', '/reports/custom/report-board'],
    ['links every saved report to its editor', 'Edit Board pack', '/reports/custom/report-board/edit'],
  ])('%s', async (_outcome, name, href) => {
    setupListing(BOARD_PACK);
    renderPanel();

    expect(await screen.findByRole('link', { name })).toHaveAttribute('href', href);
  });

  it('says how many blocks and which period a report has, and who changed it last', async () => {
    setupListing(buildCustomReport({
      blocks: [{ type: 'sources_headline' }],
      days: 30,
      updated_by: 'ana@example.com',
    }));
    renderPanel();

    expect(await screen.findByText(/^1 block · last 30 days · updated .+ by ana@example\.com$/u)).toBeInTheDocument();
  });

  it('invites the reader to create one when none is saved', async () => {
    setupListing();
    renderPanel();

    expect(await screen.findByText('No custom report yet. Create one from the sections of every report below.')).toBeInTheDocument();
  });

  it('shows why the list could not load', async () => {
    mockApiGet.mockRejectedValue(new ApiRequestError('You do not have permission to perform this action', {
      statusCode: 403,
      responseMessage: 'You do not have permission to perform this action',
    }));
    renderPanel();

    expect(await screen.findByText('You do not have permission to perform this action')).toBeInTheDocument();
  });

  it('holds a saved-report row placeholder while the list loads', () => {
    mockApiGet.mockImplementation(() => new Promise(vi.fn()));
    renderPanel();

    expect(screen.getByText('Loading your reports')).toBeInTheDocument();
  });

  it('opens the builder from its create button', async () => {
    setupListing();
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Create custom report' }));

    expect(screen.getByLabelText('Current location')).toHaveTextContent('/reports/custom/new');
  });
});
