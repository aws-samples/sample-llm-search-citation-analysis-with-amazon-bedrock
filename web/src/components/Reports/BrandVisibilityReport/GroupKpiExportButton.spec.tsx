import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildHistory } from './groupKpiHistory-fixtures';
import {
  BRAND_MENTIONS_AT_RUN, WorkbookWriteError as WorkbookError
} from './groupKpiExport-fixtures';
import {
  clickGroupKpiExport as clickExport, HOTEL_SOL_SCOPE
} from './GroupKpiReport-fixtures';
import { fetchBrandMentionsAtRun } from '../../../api/brandMentions';
import { exportGroupKpiReport } from './groupKpiExport';
import { ApiRequestError } from '../../../infrastructure';

vi.mock('../../../api/brandMentions', () => ({ fetchBrandMentionsAtRun: vi.fn() }));
vi.mock('./groupKpiExport', () => ({ exportGroupKpiReport: vi.fn() }));

const HISTORY = buildHistory();
const RUN = HISTORY.runs[1];

describe('GroupKpiExportButton', () => {
  beforeEach(() => {
    vi.mocked(fetchBrandMentionsAtRun).mockResolvedValue(BRAND_MENTIONS_AT_RUN);
  });

  it('fetches the brand mentions of the selected run', async () => {
    await clickExport();

    expect(fetchBrandMentionsAtRun).toHaveBeenCalledWith(HOTEL_SOL_SCOPE, RUN.timestamp);
  });

  it('exports the history, the run and its brand mentions', async () => {
    await clickExport();

    await waitFor(() => expect(exportGroupKpiReport).toHaveBeenCalledWith(HISTORY, 'Hotel Sol', RUN, BRAND_MENTIONS_AT_RUN));
  });

  it('still exports, without the brand mentions sheet, when they cannot be read', async () => {
    vi.mocked(fetchBrandMentionsAtRun).mockRejectedValue(new ApiRequestError('Server error', 500));

    await clickExport();

    await waitFor(() => expect(exportGroupKpiReport).toHaveBeenCalledWith(HISTORY, 'Hotel Sol', RUN, null));
    expect(screen.getByRole('status')).toHaveTextContent('Exported without the brand mentions sheet: Failed to load brand mentions');
  });

  it('clears the previous notice when exporting again', async () => {
    vi.mocked(fetchBrandMentionsAtRun).mockRejectedValueOnce(new ApiRequestError('Server error', 500)).mockReturnValueOnce(new Promise(vi.fn()));

    await clickExport();
    await screen.findByRole('status');
    await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('reports a workbook that could not be written', async () => {
    vi.mocked(exportGroupKpiReport).mockRejectedValue(new WorkbookError('disk full'));

    await clickExport();

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Excel export failed: /);
  });

  it('holds the button while the workbook is being built', async () => {
    vi.mocked(fetchBrandMentionsAtRun).mockReturnValue(new Promise(vi.fn()));

    await clickExport();

    expect(screen.getByRole('button', { name: 'Exporting…' })).toBeDisabled();
  });

  describe('once the workbook is written', () => {
    beforeEach(async () => {
      vi.mocked(exportGroupKpiReport).mockResolvedValue(undefined);
      await clickExport();
    });

    it('frees the button', async () => {
      expect(await screen.findByRole('button', { name: 'Export to Excel' })).toBeEnabled();
    });

    it('shows no notice after a complete export', async () => {
      await screen.findByRole('button', { name: 'Export to Excel' });

      expect([screen.queryByRole('status'), screen.queryByRole('alert')]).toStrictEqual([null, null]);
    });
  });
});
