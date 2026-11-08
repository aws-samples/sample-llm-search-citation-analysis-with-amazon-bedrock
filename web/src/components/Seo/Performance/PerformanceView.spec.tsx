import {
  screen, waitFor
} from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  checkIndexNowKeyFile, createIndexNowKey, fetchAuditPageUrls, fetchIndexNowSetup, fetchLighthouseRun, startLighthouse,
  startLighthouseBatch, submitIndexNow
} from '../../../api/seoPerformance';
import {
  AUDIT_ID, PAGE, buildRun, buildSetup, buildSite, buildStartRunResponse
} from '../../../api/seoPerformance-fixtures';
import { getSeoNotSetUpElement } from '../../../test/seoNotSetUp';
import {
  CRAWLED_PAGES, measurePage, mockBrandSettings, mockPerformanceAnswers, openIndexNow, renderLoadedPerformance,
  renderPerformance, renderUnconfiguredPerformance, renderWithPageUrlFocused, withinRegion
} from './PerformanceView-fixtures';
import {
  chooseExportFormat, mockStartExport
} from '../../../test/exportsApiMock';
import {
  getSettingsLinkElement, suggestionsOf
} from '../LocalSeo/settingsDefaults-fixtures';

vi.mock('../../../api/seo', () => import('../../../test/seoApiMock'));
vi.mock('../../../api/seoPerformance');
vi.mock('../../../api/exports', () => import('../../../test/exportsApiMock'));
vi.mock('../../../hooks/useIsAdmin', () => import('../../../test/useIsAdminMock'));
vi.mock('../../../hooks/useSeoSettings');

beforeEach(() => {
  mockPerformanceAnswers();
});

describe('PerformanceView setup', () => {
  it('shows the not-set-up state when the SEO API URL is missing', () => {
    renderUnconfiguredPerformance();

    expect(getSeoNotSetUpElement()).toBeInTheDocument();
  });

  it('buys nothing when the page opens', async () => {
    await renderLoadedPerformance();

    expect([vi.mocked(startLighthouse).mock.calls, vi.mocked(startLighthouseBatch).mock.calls]).toStrictEqual([[], []]);
  });
});

describe('Lighthouse tab', () => {
  it('starts one run for the typed page and device', async () => {
    await measurePage(PAGE, 'desktop');

    expect(startLighthouse).toHaveBeenCalledWith({
      url: PAGE,
      device: 'desktop'
    });
  });

  it('shows the four category scores, a missing one as a dash', async () => {
    await measurePage();

    const scores = ['Performance', 'Accessibility', 'Best practices', 'SEO']
      .map((label) => screen.getByLabelText(`${label} score`).textContent);
    expect(scores).toStrictEqual(['42', '95', '75', '–']);
  });

  it('rates the largest contentful paint against its thresholds', async () => {
    await measurePage();

    const row = screen.getByRole('rowheader', { name: /Largest Contentful Paint/ }).closest('tr');
    expect(row).toHaveTextContent('4.6 sPoorgood ≤ 2.5 s · poor > 4.0 s');
  });

  it('says a metric the lab run could not measure was not measured', async () => {
    await measurePage();

    const row = screen.getByRole('rowheader', { name: /Interaction to Next Paint/ }).closest('tr');
    expect(row).toHaveTextContent('Not measured');
  });

  it('lists the top opportunity with its estimated saving', async () => {
    await measurePage();

    expect(screen.getByText('saves ~350 ms · 150 KB')).toBeInTheDocument();
  });
});

describe('Lighthouse export', () => {
  it('exports the stored result of the page and device from the server', async () => {
    await measurePage();

    await chooseExportFormat('xlsx');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'seo-lighthouse',
      params: {
        device: 'mobile',
        run_id: buildRun().run_id,
        url: PAGE,
      },
      format: 'xlsx',
    });
  });

  it('offers no export before the page is measured', async () => {
    const run = buildRun({ results: [null] });
    vi.mocked(startLighthouse).mockResolvedValue(buildStartRunResponse(run));
    vi.mocked(fetchLighthouseRun).mockResolvedValue(run);
    await measurePage();
    await screen.findByText('Waiting to be measured…');

    expect(screen.queryByRole('button', { name: 'Export all' })).not.toBeInTheDocument();
  });
});

describe('Lighthouse URL from Settings', () => {
  it('starts the URL at the homepage of the brand\'s own domain', async () => {
    await renderLoadedPerformance();

    expect(screen.getByLabelText('Page URL')).toHaveValue('https://example.com/');
  });

  it('measures the brand\'s homepage when Run Lighthouse is pressed without typing', async () => {
    const user = await renderLoadedPerformance();

    await user.click(screen.getByRole('button', { name: 'Run Lighthouse' }));

    expect(startLighthouse).toHaveBeenCalledWith({
      url: 'https://example.com/',
      device: 'mobile'
    });
  });

  it('keeps a URL the user emptied empty instead of refilling the homepage', async () => {
    const user = await renderLoadedPerformance();

    await user.clear(screen.getByLabelText('Page URL'));

    expect(screen.getByLabelText('Page URL')).toHaveValue('');
  });

  it('links to Settings › Brand Tracking when the brand has no own domain', async () => {
    mockBrandSettings({ ownedDomains: [] });

    await renderLoadedPerformance();

    expect(getSettingsLinkElement('Brand Tracking')).toHaveAttribute('href', '/settings/brand');
  });

  it('leaves the URL empty when the brand has no own domain', async () => {
    mockBrandSettings({ ownedDomains: [] });

    await renderLoadedPerformance();

    expect(screen.getByLabelText('Page URL')).toHaveValue('');
  });
});

describe('Lighthouse URL suggestions', () => {
  it('suggests the audit sample pages before the URL field is focused', async () => {
    await renderLoadedPerformance();

    // The sample's pages arrive after the region renders: wait for them rather than read the list at once.
    await waitFor(() => {
      expect(suggestionsOf('Page URL')).toStrictEqual([PAGE, 'https://www.example.com/blog/first-great-post']);
    });
  });

  it('reads no crawled pages until the URL field is focused', async () => {
    await renderLoadedPerformance();

    expect(vi.mocked(fetchAuditPageUrls).mock.calls).toStrictEqual([]);
  });

  it('reads at most 50 crawled pages of the sample\'s audit once the URL field is focused', async () => {
    await renderWithPageUrlFocused();

    expect(fetchAuditPageUrls).toHaveBeenCalledWith(AUDIT_ID, 50, expect.anything());
  });

  it('adds the crawled pages to the suggestions without repeating a sample page', async () => {
    await renderWithPageUrlFocused();

    await vi.waitFor(() => {
      expect(suggestionsOf('Page URL')).toStrictEqual([PAGE, 'https://www.example.com/blog/first-great-post', ...CRAWLED_PAGES.slice(1)]);
    });
  });
});

describe('Lighthouse batch', () => {
  /** An Admin's page with the batch confirmation open. */
  async function setupBatchConfirmation() {
    mockPerformanceAnswers(true);
    const user = renderPerformance();
    await user.click(await screen.findByRole('button', { name: "Test the audit's sample pages" }));
    return user;
  }
  it('lists the audit sample pages and the batch run count', async () => {
    renderPerformance();

    expect(await screen.findByText(/4 runs\./)).toBeInTheDocument();
  });

  it('offers the batch to Admins only', async () => {
    await renderLoadedPerformance();

    expect(await screen.findByText('An Admin can run the batch.')).toBeInTheDocument();
  });

  it('names the paid calls of the batch, without a price, in its confirmation', async () => {
    await setupBatchConfirmation();

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'This starts 4 paid DataForSEO calls, one Lighthouse run per page and device. Asking again within 15 minutes reuses them. Continue?',
    );
  });

  it('runs the batch only after it is confirmed', async () => {
    const user = await setupBatchConfirmation();
    const before = vi.mocked(startLighthouseBatch).mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Start runs' }));

    expect([before, vi.mocked(startLighthouseBatch).mock.calls]).toStrictEqual([0, [[AUDIT_ID]]]);
  });
});

describe('IndexNow tab', () => {
  it('shows where to host the key file on both hosts', async () => {
    await openIndexNow();

    expect(withinRegion('IndexNow keys').getByText(`https://www.example.com/${buildSite().key ?? ''}.txt`)).toBeInTheDocument();
  });

  it('lets an Admin create the key of a domain without one', async () => {
    mockPerformanceAnswers(true);
    const keyless = buildSite({
      key: null,
      key_files: []
    });
    vi.mocked(fetchIndexNowSetup).mockResolvedValue(buildSetup({ sites: [keyless] }));
    const user = await openIndexNow();

    await user.click(screen.getByRole('button', { name: 'Create key for example.com' }));

    expect(createIndexNowKey).toHaveBeenCalledWith('example.com');
  });

  it('shows the fix for a host whose key file redirects', async () => {
    const user = await openIndexNow();

    await user.click(screen.getByRole('button', { name: 'Check key file' }));

    expect(await screen.findByText(/redirects\. Upload it to https:\/\/example\.com itself/)).toBeInTheDocument();
    expect(checkIndexNowKeyFile).toHaveBeenCalledWith('example.com');
  });

  it('submits the pasted URLs one per line', async () => {
    mockPerformanceAnswers(true);
    const user = await openIndexNow();

    await user.type(screen.getByLabelText('URLs (one per line)'), `${PAGE}\nhttps://www.example.com/a`);
    await user.click(screen.getByRole('button', { name: 'Submit 2 URLs' }));

    expect(submitIndexNow).toHaveBeenCalledWith({
      source: 'paste',
      urls: [PAGE, 'https://www.example.com/a']
    });
  });

  it('submits the pages of the latest audit', async () => {
    mockPerformanceAnswers(true);
    const user = await openIndexNow();

    await user.click(screen.getByRole('button', { name: 'Submit the pages of the latest audit' }));

    expect(submitIndexNow).toHaveBeenCalledWith({ source: 'audit' });
  });

  it("shows each engine's answer in the history", async () => {
    await openIndexNow();

    expect(withinRegion('Submission history').getByText(/Bing: HTTP 429/)).toBeInTheDocument();
  });

  it('links to Settings › Brand Tracking when the brand has no own domain to key', async () => {
    vi.mocked(fetchIndexNowSetup).mockResolvedValue(buildSetup({ sites: [] }));

    await openIndexNow();

    expect(withinRegion('IndexNow keys').getByRole('link')).toHaveTextContent('Open Settings › Brand Tracking');
  });

  it('hides the submit form from non-Admins', async () => {
    await openIndexNow();

    expect(screen.getByText('An Admin can submit changed pages to IndexNow.')).toBeInTheDocument();
  });
});
