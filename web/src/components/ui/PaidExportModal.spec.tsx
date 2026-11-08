import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import {
  waitFor, screen
} from '@testing-library/react';
import {
  askedWindows, fakeFailingFetch, fakeStalledFetch, listRows, WINDOWS_OF_2500
} from '../../exporters/paidExport-fixtures';
import {
  clickCancel, getDownloadElement, getPriceLineElement, getRowsInputElement, renderDownloadClicked, renderPaidExportModal,
  settle, silenceExportFailures, typeRows
} from './PaidExportModal-fixtures';
import { BACKLINKS_EXPORT } from '../../api/seoBacklinks-fixtures';
import { LABS_EXPORT } from '../../api/seoDomains-fixtures';
import type { FetchChunk } from '../../exporters/paidExport';

vi.mock('../../api/seo', () => import('../../test/seoApiMock'));

const UNAVAILABLE = 'DataForSEO is unavailable';

describe('PaidExportModal before Download', () => {
  it('names the table in its title', () => {
    renderPaidExportModal();

    expect(screen.getByRole('dialog', { name: 'Export ranked keywords to Excel' })).toBeInTheDocument();
  });

  it('says the rows are a new, paid DataForSEO request', () => {
    renderPaidExportModal();

    expect(screen.getByRole('dialog')).toHaveTextContent('the export is a new request, and DataForSEO charges for the rows it returns');
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

  it('says a repeat export within 6 hours is free', () => {
    renderPaidExportModal();

    expect(screen.getByText('Exporting the same rows again within 6 hours is free.')).toBeInTheDocument();
  });

  it('makes no request while the rows are picked', async () => {
    const rendered = renderPaidExportModal();
    await typeRows(rendered.user, '3000');

    expect(rendered.fetchChunk.mock.calls).toStrictEqual([]);
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

  it.each(['', '0'])('disables Download for the row count "%s"', async (typed) => {
    const { user } = renderPaidExportModal();
    await typeRows(user, typed);

    expect(getDownloadElement()).toBeDisabled();
  });
});

describe('PaidExportModal Download', () => {
  it('asks the chunks one after the other, the last one the remainder', async () => {
    const rendered = await renderDownloadClicked('2500');
    await waitFor(() => {
      expect(rendered.onDownload.mock.calls).toHaveLength(1);
    });

    expect(askedWindows(rendered.fetchChunk)).toStrictEqual(WINDOWS_OF_2500);
  });

  it('downloads every fetched row in order', async () => {
    const { onDownload } = await renderDownloadClicked('2500');

    await waitFor(() => {
      expect(onDownload).toHaveBeenCalledWith(listRows(2500, 0, 2500));
    });
  });

  it('closes once the file is written', async () => {
    const { onClose } = await renderDownloadClicked(null);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledWith();
    });
  });

  it('shows which rows are being fetched', async () => {
    await renderDownloadClicked('2500', { fetchChunk: fakeStalledFetch() });

    expect(await screen.findByText('Fetching rows 1–1,000 of 2,500…')).toBeInTheDocument();
  });

  it('disables Download while the rows are fetched', async () => {
    await renderDownloadClicked(null, { fetchChunk: fakeStalledFetch() });

    expect(getDownloadElement()).toBeDisabled();
  });
});

describe('PaidExportModal cancel and errors', () => {
  beforeEach(silenceExportFailures);

  it('asks no further chunk once Cancel is pressed mid-export', async () => {
    const answers: Array<(rows: number[]) => void> = [];
    const fetchChunk = vi.fn<FetchChunk<number>>(() => new Promise((resolve) => {
      answers.push(resolve);
    }));
    const rendered = await renderDownloadClicked('2500', { fetchChunk });
    await clickCancel(rendered.user);
    answers[0](listRows(2500, 0, 1000));
    await settle();

    expect(rendered.onClose).toHaveBeenCalledWith();
    expect([fetchChunk.mock.calls.length, rendered.onDownload.mock.calls.length]).toStrictEqual([1, 0]);
  });

  it('aborts the request in flight on Cancel', async () => {
    const fetchChunk = fakeStalledFetch();
    const { user } = await renderDownloadClicked(null, { fetchChunk });
    await clickCancel(user);

    expect(fetchChunk.mock.calls[0][2].aborted).toBe(true);
  });

  it('shows the error of a failed request and exports nothing', async () => {
    const rendered = await renderDownloadClicked(null, { fetchChunk: fakeFailingFetch(UNAVAILABLE) });

    expect(await screen.findByRole('alert')).toHaveTextContent(UNAVAILABLE);
    expect([rendered.onDownload.mock.calls.length, rendered.onClose.mock.calls.length]).toStrictEqual([0, 0]);
  });

  it('lets the user retry after an error', async () => {
    await renderDownloadClicked(null, { fetchChunk: fakeFailingFetch(UNAVAILABLE) });
    await screen.findByRole('alert');

    expect(getDownloadElement()).toBeEnabled();
  });
});

describe('PaidExportModal rows on screen', () => {
  const SCREEN_DOWNLOAD = {
    role: 'button',
    name: 'Download the 50 rows on screen (free)',
  } as const;

  it('offers the rows on screen for free', () => {
    renderPaidExportModal();

    expect(screen.getByRole(SCREEN_DOWNLOAD.role, { name: SCREEN_DOWNLOAD.name })).toBeEnabled();
  });

  it('downloads the rows on screen without any request', async () => {
    const rendered = renderPaidExportModal();
    await rendered.user.click(screen.getByRole(SCREEN_DOWNLOAD.role, { name: SCREEN_DOWNLOAD.name }));

    expect([rendered.onDownloadScreen.mock.calls.length, rendered.fetchChunk.mock.calls.length]).toStrictEqual([1, 0]);
  });
});
