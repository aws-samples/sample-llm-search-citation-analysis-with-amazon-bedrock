import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import {
  chooseExportFormat, mockStartExport
} from '../../test/exportsApiMock';
import { ApiRequestError } from '../../infrastructure';
import { ExportAllButton } from './ExportAllButton';

vi.mock('../../api/exports', () => import('../../test/exportsApiMock'));

describe('ExportAllButton', () => {
  it('starts the view export with its filters and no paging params', async () => {
    render(<ExportAllButton view="citations" params={{
      group_id: 'g1',
      sort: 'citation_count',
      limit: 25,
      next_token: 'abc',
      market_id: null,
    }} />);

    await chooseExportFormat('xlsx');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'citations',
      params: {
        group_id: 'g1',
        sort: 'citation_count',
      },
      format: 'xlsx',
    });
  });

  it('starts a CSV export when CSV is chosen', async () => {
    render(<ExportAllButton view="alerts" params={{ status: 'open' }} />);

    await chooseExportFormat('csv');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'alerts',
      params: { status: 'open' },
      format: 'csv',
    });
  });

  it('is disabled while the view has nothing to export yet', () => {
    render(<ExportAllButton view="citations" params={null} />);

    expect(screen.getByRole('button', { name: 'Export all' })).toBeDisabled();
  });

  it('says the export started outside the Exports center', async () => {
    render(<ExportAllButton view="citations" params={{}} />);

    await chooseExportFormat('xlsx');

    expect(await screen.findByRole('status')).toHaveTextContent('Export started — find it on the Exports page.');
  });

  it('shows the API refusal when the export cannot start', async () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    mockStartExport.mockRejectedValueOnce(new ApiRequestError('At most 5 exports may run at once', {
      statusCode: 429,
      responseMessage: 'At most 5 exports may run at once',
    }));
    render(<ExportAllButton view="citations" params={{}} />);

    await chooseExportFormat('xlsx');

    expect(await screen.findByRole('alert')).toHaveTextContent('At most 5 exports may run at once');
  });
});
