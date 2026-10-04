import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, screen, waitFor, within
} from '@testing-library/react';
import {
  mockApiDelete, mockApiGet, mockApiPost, mockApiPut
} from '../../../api/clientMock-fixtures';
import { buildCustomReport } from '../../../api/customReports-fixtures';
import { ApiRequestError } from '../../../infrastructure';
import { changeField } from './customReport-fixtures';
import {
  REPORT_GONE, canvasBlockNames, canvasCard, canvasHandle, catalogItem, dragAndDrop, dropZone, renderCustomReportRoute, renderWithoutSavedReports,
  reportCanvas, reportsListPayload
} from './customReportPages-fixtures';

vi.mock('../../../api/client', () => import('../../../api/clientMock-fixtures'));
vi.mock('./CustomReportView', () => ({ CustomReportView: vi.fn(() => null) }));

const SAVED = buildCustomReport({
  id: 'report-board',
  title: 'Board pack',
  blocks: [{ type: 'sources_headline' }, { type: 'sentiment_trend' }],
  days: 30,
});

const WRITE_OPTIONS = { allowStructured4xx: true };

const SOURCES = 'Sources · Headline';
const SENTIMENT = 'Sentiment · Headline';

/** Opens the builder for a new report, names it "Launch recap" and adds `names` with their Add buttons. */
function setupNewReport(...names: string[]) {
  renderCustomReportRoute('/reports/custom/new');
  changeField('Report name', 'Launch recap');
  names.forEach((name) => fireEvent.click(screen.getByRole('button', { name: `Add ${name}` })));
}

async function setupSavedReport() {
  mockApiGet.mockResolvedValue(reportsListPayload(SAVED));
  renderCustomReportRoute('/reports/custom/report-board/edit');
  await screen.findByRole('heading', { name: 'Edit custom report' });
}

function setupSaveClick() {
  fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
}

describe('Building a new custom report', () => {
  it('adds a report section from the block list to the end of the report', () => {
    setupNewReport(SOURCES, SENTIMENT);

    expect(canvasBlockNames()).toStrictEqual([SOURCES, SENTIMENT]);
  });

  it('shows a report section as added once it is in the report', () => {
    setupNewReport(SOURCES);

    expect(screen.getByRole('button', { name: `Added ${SOURCES}` })).toBeDisabled();
  });

  it('adds a content block as many times as asked', () => {
    setupNewReport('Heading', 'Heading');

    expect(canvasBlockNames()).toStrictEqual(['Heading', 'Heading']);
  });

  it('moves a block down with its arrow', () => {
    setupNewReport(SOURCES, SENTIMENT);
    fireEvent.click(screen.getByRole('button', { name: `Move ${SOURCES} down` }));

    expect(canvasBlockNames()).toStrictEqual([SENTIMENT, SOURCES]);
  });

  it('removes a block with its remove button', () => {
    setupNewReport(SOURCES);
    fireEvent.click(screen.getByRole('button', { name: `Remove ${SOURCES}` }));

    expect(canvasBlockNames()).toStrictEqual([]);
  });

  it('adds a block dragged from the list onto the drop zone at the end', () => {
    setupNewReport('Heading');
    dragAndDrop(catalogItem(SENTIMENT), dropZone(), 1);

    expect(canvasBlockNames()).toStrictEqual(['Heading', SENTIMENT]);
  });

  it('adds a block dragged from the list before the block whose top half it is dropped on', () => {
    setupNewReport('Heading');
    dragAndDrop(catalogItem(SENTIMENT), canvasCard('Heading'), -1, reportCanvas());

    expect(canvasBlockNames()).toStrictEqual([SENTIMENT, 'Heading']);
  });

  it('moves a block dragged by its name after the block whose bottom half it is dropped on', () => {
    setupNewReport(SOURCES, SENTIMENT);
    dragAndDrop(canvasHandle(SOURCES), canvasCard(SENTIMENT), 1, reportCanvas());

    expect(canvasBlockNames()).toStrictEqual([SENTIMENT, SOURCES]);
  });

  it('saves the report and opens it', async () => {
    mockApiPost.mockResolvedValue({ report: buildCustomReport({ id: 'report-new' }) });
    setupNewReport(SOURCES);
    setupSaveClick();

    await waitFor(() => expect(screen.getByLabelText('Current location')).toHaveTextContent('/reports/custom/report-new'));
    expect(mockApiPost).toHaveBeenCalledWith('/custom-reports', {
      title: 'Launch recap',
      blocks: [{ type: 'sources_headline' }],
      days: 90,
    }, WRITE_OPTIONS);
  });

  it('asks for a name before saving and sends nothing', () => {
    renderCustomReportRoute('/reports/custom/new');
    fireEvent.click(screen.getByRole('button', { name: `Add ${SOURCES}` }));
    setupSaveClick();

    expect(screen.getByRole('alert')).toHaveTextContent('Give the report a name.');
    expect(mockApiPost).not.toHaveBeenCalledWith('/custom-reports', expect.anything(), WRITE_OPTIONS);
  });

  it('shows the problem of an unfinished content block when a save is refused', () => {
    setupNewReport('Image');
    setupSaveClick();

    expect(screen.getByRole('alert')).toHaveTextContent('Block 1 (Image): Add the image link.');
    expect(screen.getByLabelText('Image link')).toHaveAttribute('aria-invalid', 'true');
  });

  it('explains the limit when 50 reports are already saved', async () => {
    mockApiPost.mockRejectedValue(new ApiRequestError('limit_reached', {
      statusCode: 409,
      responseMessage: 'limit_reached',
      field: 'reports',
    }));
    setupNewReport(SOURCES);
    setupSaveClick();

    expect(await screen.findByRole('alert')).toHaveTextContent('There are already 50 saved reports. Delete one to save another.');
  });
});

describe('Editing a saved custom report', () => {
  it('opens with the saved name and blocks in their order', async () => {
    await setupSavedReport();

    expect(screen.getByLabelText('Report name')).toHaveValue('Board pack');
    expect(canvasBlockNames()).toStrictEqual([SOURCES, 'Sentiment · Net sentiment over time']);
  });

  it('saves the changes over the saved report', async () => {
    mockApiPut.mockResolvedValue({ report: SAVED });
    await setupSavedReport();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sentiment · Net sentiment over time' }));
    setupSaveClick();

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledWith('/custom-reports/report-board', {
      title: 'Board pack',
      blocks: [{ type: 'sources_headline' }],
      days: 30,
    }, WRITE_OPTIONS));
  });

  it('saves a copy as a new report', async () => {
    mockApiPost.mockResolvedValue({ report: buildCustomReport({ id: 'report-copy' }) });
    await setupSavedReport();
    fireEvent.click(screen.getByRole('button', { name: 'Save as new report' }));

    await waitFor(() => expect(screen.getByLabelText('Current location')).toHaveTextContent('/reports/custom/report-copy'));
    expect(mockApiPut).not.toHaveBeenCalledWith('/custom-reports/report-board', expect.anything(), WRITE_OPTIONS);
  });

  it('deletes the report once confirmed and returns to the reports', async () => {
    mockApiDelete.mockResolvedValue({ deleted: 'report-board' });
    await setupSavedReport();
    fireEvent.click(screen.getByRole('button', { name: 'Delete report' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete report' }));

    await waitFor(() => expect(screen.getByLabelText('Current location')).toHaveTextContent(/^\/reports$/u));
    expect(mockApiDelete).toHaveBeenCalledWith('/custom-reports/report-board', WRITE_OPTIONS);
  });

  it('offers the way back to Reports when the report is gone', async () => {
    renderWithoutSavedReports('/reports/custom/report-missing/edit');

    expect(await screen.findByRole('link', { name: 'Back to Reports' })).toBeInTheDocument();
  });

  it('shows the load failure without the way back when the reports cannot be read', async () => {
    mockApiGet.mockRejectedValue(new ApiRequestError('HTTP 500', 500));
    renderCustomReportRoute('/reports/custom/report-board/edit');

    expect(await screen.findByText('Server error occurred')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to Reports' })).not.toBeInTheDocument();
  });

  it('says the report is gone when no saved report has the id', async () => {
    renderWithoutSavedReports('/reports/custom/report-missing/edit');

    expect(await screen.findByText(REPORT_GONE)).toBeInTheDocument();
  });
});
