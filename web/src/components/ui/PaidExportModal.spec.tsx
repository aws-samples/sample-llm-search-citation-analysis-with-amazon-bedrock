import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import {
  screen, waitFor
} from '@testing-library/react';
import { mockStartExport } from '../../test/exportsApiMock';
import { exportPlan } from '../../exporters/paidExport';
import type { ExportsCenter } from '../../hooks/useExports';
import { ApiRequestError } from '../../infrastructure';
import {
  KEYWORD_LIST, getPriceLineElement, getRowsInputElement, getScreenExportElement, getStartElement, renderPaidExportModal,
  renderStartClicked, silenceExportFailures, typeRows
} from './PaidExportModal-fixtures';
import { BACKLINKS_EXPORT } from '../../api/seoBacklinks-fixtures';
import { LABS_EXPORT } from '../../api/seoDomains-fixtures';

vi.mock('../../api/exports', () => import('../../test/exportsApiMock'));

const PRICE_CHANGED = 'The price of this export is not the one confirmed. Open the export again to see its price.';

describe('PaidExportModal before the export starts', () => {
  it('names the table in its title', () => {
    renderPaidExportModal();

    expect(screen.getByRole('dialog', { name: 'Export ranked keywords' })).toBeInTheDocument();
  });

  it('says the rows are new, paid DataForSEO requests', () => {
    renderPaidExportModal();

    expect(screen.getByRole('dialog')).toHaveTextContent('the export makes new requests, and DataForSEO charges for the rows it returns');
  });

  it('says the file arrives on the Exports page', () => {
    renderPaidExportModal();

    expect(screen.getByRole('dialog')).toHaveTextContent('runs in the background: the file appears on the Exports page');
  });

  it('asks for 1000 rows by default', () => {
    renderPaidExportModal();

    expect(getRowsInputElement()).toHaveValue(1000);
  });

  it.each([
    ['Labs', LABS_EXPORT, 'Price: up to $0.14 · 1 DataForSEO request'],
    ['backlinks', BACKLINKS_EXPORT, 'Price: up to $0.06 · 1 DataForSEO request'],
  ])('prices 1000 %s rows as one request', (_family, pricing, price) => {
    renderPaidExportModal({ pricing });

    expect(getPriceLineElement()).toHaveTextContent(price);
  });

  it.each([
    ['Labs', LABS_EXPORT, 'Price: up to $0.34 · 3 DataForSEO requests'],
    ['backlinks', BACKLINKS_EXPORT, 'Price: up to $0.17 · 3 DataForSEO requests'],
  ])('updates the %s price as 2500 rows are typed', async (_family, pricing, price) => {
    const { user } = renderPaidExportModal({ pricing });
    await typeRows(user, '2500');

    expect(getPriceLineElement()).toHaveTextContent(price);
  });

  it('says a repeat export within the answer\'s 12-hour cache window is free', () => {
    renderPaidExportModal();

    expect(screen.getByText('Exporting the same rows again within 12 hours is free.')).toBeInTheDocument();
  });

  it('queues nothing while the rows are picked', async () => {
    const { user } = renderPaidExportModal();
    await typeRows(user, '3000');

    expect(mockStartExport.mock.calls).toStrictEqual([]);
  });
});

describe('PaidExportModal row count', () => {
  it.each([
    ['the list total', 120, '500', 120],
    ['10,000 when the list is longer', 50_000, '20000', 10_000],
  ])('caps the rows at %s', async (_cap, totalCount, typed, shown) => {
    const { user } = renderPaidExportModal({ totalCount });
    await typeRows(user, typed);

    expect(getRowsInputElement()).toHaveValue(shown);
  });

  it('defaults to the whole list when it holds under 1000 rows', () => {
    renderPaidExportModal({ totalCount: 120 });

    expect(getRowsInputElement()).toHaveValue(120);
  });

  it.each([
    [50_000, 'Up to 10,000 (50,000 in this list)'],
    [null, 'Up to 10,000'],
  ])('hints the cap and a list total of %s', (totalCount, hint) => {
    renderPaidExportModal({ totalCount });

    expect(screen.getByText(hint)).toBeInTheDocument();
  });

  it.each(['', '0'])('disables Start export for the row count "%s"', async (typed) => {
    const { user } = renderPaidExportModal();
    await typeRows(user, typed);

    expect(getStartElement()).toBeDisabled();
  });
});

describe('PaidExportModal Start export', () => {
  it('queues the list with the confirmed rows and their price, as Excel by default', async () => {
    await renderStartClicked('2500');

    await waitFor(() => {
      expect(mockStartExport).toHaveBeenCalledWith({
        view: 'seo-domain',
        params: {
          ...KEYWORD_LIST,
          rows: '2500',
          price_usd: String(exportPlan(2500, LABS_EXPORT).priceUsd),
        },
        format: 'xlsx',
      });
    });
  });

  it('queues a CSV file when CSV is chosen', async () => {
    const { user } = renderPaidExportModal();
    await user.selectOptions(screen.getByLabelText('File format'), 'csv');
    await user.click(getStartElement());

    await waitFor(() => {
      expect(mockStartExport.mock.lastCall?.[0].format).toBe('csv');
    });
  });

  it('says the export started when no Exports center is mounted', async () => {
    await renderStartClicked(null);

    expect(await screen.findByRole('status')).toHaveTextContent('Export started — find it on the Exports page.');
  });

  it('disables Start export once the export is queued', async () => {
    await renderStartClicked(null);
    await screen.findByRole('status');

    expect(getStartElement()).toBeDisabled();
  });
});

describe('PaidExportModal with the Exports center', () => {
  it('queues through the center and closes', async () => {
    const start = vi.fn<ExportsCenter['start']>(mockStartExport);
    const {
      user, onClose 
    } = renderPaidExportModal({}, start);
    await user.click(getStartElement());

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledWith();
    });
  });

  it('leaves the started toast to the center', async () => {
    const start = vi.fn<ExportsCenter['start']>(mockStartExport);
    const { user } = renderPaidExportModal({}, start);
    await user.click(getStartElement());
    await waitFor(() => {
      expect(start.mock.calls).toHaveLength(1);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('PaidExportModal errors', () => {
  beforeEach(silenceExportFailures);

  it('shows why the export could not start and stays open', async () => {
    mockStartExport.mockRejectedValueOnce(new ApiRequestError(PRICE_CHANGED, {
      statusCode: 400,
      responseMessage: PRICE_CHANGED,
    }));
    const { onClose } = await renderStartClicked(null);

    expect(await screen.findByRole('alert')).toHaveTextContent(PRICE_CHANGED);
    expect(onClose.mock.calls).toStrictEqual([]);
  });

  it('lets the user retry after an error', async () => {
    mockStartExport.mockRejectedValueOnce(new ApiRequestError(PRICE_CHANGED, { statusCode: 400 }));
    await renderStartClicked(null);
    await screen.findByRole('alert');

    expect(getStartElement()).toBeEnabled();
  });
});

describe('PaidExportModal rows on screen', () => {
  it('offers the rows on screen for free', () => {
    renderPaidExportModal();

    expect(getScreenExportElement()).toBeEnabled();
  });

  it('queues the page on screen without a row count or price', async () => {
    const { user } = renderPaidExportModal();
    await user.click(getScreenExportElement());

    await waitFor(() => {
      expect(mockStartExport).toHaveBeenCalledWith({
        view: 'seo-domain',
        params: {
          ...KEYWORD_LIST,
          page: '2',
          page_size: '50',
        },
        format: 'xlsx',
      });
    });
  });
});
