import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen, waitFor, within
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  mockApiDelete, mockApiGet
} from '../../../api/clientMock-fixtures';
import type { CustomReport } from '../../../api/customReports';
import { buildCustomReport } from '../../../api/customReports-fixtures';
import { ApiRequestError } from '../../../infrastructure';
import { CurrentLocation } from '../scopeReport/scopeReport-fixtures';
import { CustomReportsPanel } from './CustomReportsPanel';
import {
  confirmReportDeletion, reportsListPayload
} from './customReportPages-fixtures';

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

async function setupOpenActionsMenu(title: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Actions for ${title}` }));
  return screen.getByRole('menu', { name: `Actions for ${title}` });
}

/** Lists the board pack, renders the panel and picks `item` from the report's menu. */
async function setupBoardPackChoice(item: string) {
  setupListing(BOARD_PACK);
  renderPanel();
  fireEvent.click(within(await setupOpenActionsMenu('Board pack')).getByRole('menuitem', { name: item }));
}

describe('CustomReportsPanel', () => {
  it('links every saved report to its page', async () => {
    setupListing(BOARD_PACK);
    renderPanel();

    expect(await screen.findByRole('link', { name: 'Board pack' })).toHaveAttribute('href', '/reports/custom/report-board');
  });

  it('offers to open, edit or delete a report from its menu', async () => {
    setupListing(BOARD_PACK);
    renderPanel();
    const menu = await setupOpenActionsMenu('Board pack');

    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toStrictEqual(['Open', 'Edit', 'Delete']);
  });

  it.each([
    ['Open', '/reports/custom/report-board'],
    ['Edit', '/reports/custom/report-board/edit'],
  ])('goes to the report from %s', async (item, path) => {
    await setupBoardPackChoice(item);

    expect(screen.getByLabelText('Current location')).toHaveTextContent(path);
  });

  it('says how many blocks and which period a report has, and when it changed, without naming who changed it', async () => {
    setupListing(buildCustomReport({
      blocks: [{ type: 'sources_headline' }],
      days: 30,
      updated_by: 'ana@example.com',
    }));
    renderPanel();

    expect(await screen.findByText(/^1 block · last 30 days · updated \S+$/u)).toBeInTheDocument();
    expect(screen.queryByText(/ana@example\.com/u)).not.toBeInTheDocument();
  });

  it('deletes a report once the reader confirms, then lists the reports again', async () => {
    mockApiDelete.mockResolvedValue({});
    await setupBoardPackChoice('Delete');
    setupListing();
    confirmReportDeletion();

    await waitFor(() => expect(screen.queryByRole('link', { name: 'Board pack' })).not.toBeInTheDocument());
    expect(mockApiDelete).toHaveBeenCalledWith('/custom-reports/report-board', { allowStructured4xx: true });
  });

  it('keeps the report when the reader cancels the delete', async () => {
    await setupBoardPackChoice('Delete');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect(mockApiDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Board pack' })).toBeInTheDocument();
  });

  it('says why a delete failed', async () => {
    mockApiDelete.mockRejectedValue(new ApiRequestError('Report is locked', {
      statusCode: 409,
      responseMessage: 'Report is locked',
    }));
    await setupBoardPackChoice('Delete');
    confirmReportDeletion();

    expect((await screen.findByRole('alert')).textContent).toBe('Report is locked');
  });

  it('invites the reader to create one when none is saved', async () => {
    setupListing();
    renderPanel();

    expect(await screen.findByText(/^No custom report yet\. Use New custom report/u)).toBeInTheDocument();
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
});
