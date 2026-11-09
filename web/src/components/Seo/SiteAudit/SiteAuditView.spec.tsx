import {
  screen, waitFor, within
} from '@testing-library/react';
import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import { isSeoApiConfigured } from '../../../api/seo';
import {
  cancelAudit, fetchAudit, fetchIssuePages, startAudit
} from '../../../api/seoAudits';
import {
  AUDIT_ID, PAGE_URL, buildAuditDetail, buildSiteAudit
} from '../../../api/seoAudits-fixtures';
import {
  emitLive, liveSubscriberCount, resetLiveEvents
} from '../../../test/liveEventsMock';
import { getSeoNotSetUpElement } from '../../../test/seoNotSetUp';
import { findBrandTrackingLinkElement } from '../settingsDomains-fixtures';
import {
  openAffectedPages, renderSiteAudit, setupSiteAudit
} from './SiteAuditView-fixtures';
import {
  chooseExportFormat, mockStartExport
} from '../../../test/exportsApiMock';

vi.mock('../../../api/exports', () => import('../../../test/exportsApiMock'));
vi.mock('../../../api/seo', () => import('../../../test/seoApiMock'));
vi.mock('../../../api/seoAudits');
vi.mock('../../../hooks/useIsAdmin', () => import('../../../test/useIsAdminMock'));
vi.mock('../../../infrastructure/liveEvents', () => import('../../../test/liveEventsMock'));

const RUNNING = buildAuditDetail({
  status: 'running',
  phase: 'crawl',
  pages_crawled: 40,
  pages_total: 200,
  summary: null,
  ai_readiness: null,
});

beforeEach(() => {
  vi.mocked(isSeoApiConfigured).mockReturnValue(true);
  setupSiteAudit();
});

afterEach(() => {
  vi.useRealTimers();
  resetLiveEvents();
});

describe('SiteAuditView setup', () => {
  it('shows the not-set-up state when the SEO API URL is missing', () => {
    vi.mocked(isSeoApiConfigured).mockReturnValue(false);
    renderSiteAudit();

    expect(getSeoNotSetUpElement()).toBeInTheDocument();
  });

  it('hides the start form from a user who is not an admin', async () => {
    setupSiteAudit({ admin: false });
    renderSiteAudit();

    await screen.findByText('Health score');

    expect(screen.queryByRole('button', { name: 'Start audit' })).not.toBeInTheDocument();
  });
});

describe('SiteAuditView start', () => {
  it('preselects the first owned domain of Brand Tracking as the site', async () => {
    setupSiteAudit({ sites: ['brand.example', 'shop.brand.example'] });
    renderSiteAudit();

    expect(await screen.findByLabelText('Site')).toHaveValue('brand.example');
  });

  it('links to Settings › Brand Tracking instead of the form when the brand has no own domain', async () => {
    setupSiteAudit({ sites: [] });
    renderSiteAudit();

    expect(await findBrandTrackingLinkElement()).toHaveAttribute('href', '/settings/brand');
  });

  it('shows no empty site field when the brand has no own domain', async () => {
    setupSiteAudit({ sites: [] });
    renderSiteAudit();
    await findBrandTrackingLinkElement();

    expect(screen.queryByLabelText('Site')).not.toBeInTheDocument();
  });

  it('starts nothing until the confirmation is accepted', async () => {
    const { user } = renderSiteAudit();
    await user.click(await screen.findByRole('button', { name: 'Start audit' }));

    expect(screen.getByText(/crawls up to 500 pages of example.com at one request a second/)).toBeInTheDocument();
    expect(startAudit).not.toHaveBeenCalledWith(expect.anything());
  });

  it('starts the chosen site and page limit after confirming', async () => {
    vi.mocked(startAudit).mockResolvedValue({ audit: buildSiteAudit({ status: 'queued' }) });
    const { user } = renderSiteAudit();
    await user.selectOptions(await screen.findByLabelText('Max pages'), '100');
    await user.click(screen.getByRole('button', { name: 'Start audit' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start audit' }));

    expect(startAudit).toHaveBeenCalledWith({
      start_url: 'example.com',
      max_pages: 100 
    });
  });
});

describe('SiteAuditView completed audit', () => {
  it('shows the health score and the severity counts', async () => {
    renderSiteAudit();

    expect(await screen.findByText('82')).toBeInTheDocument();
    expect(screen.getByLabelText('Critical issue count')).toHaveTextContent('1');
  });

  it('shows each AI crawler with its access in the AI readiness panel', async () => {
    renderSiteAudit();
    const panel = await screen.findByRole('region', { name: 'AI readiness' });

    expect(within(panel).getByRole('row', { name: /GPTBot/ })).toHaveTextContent('Blocked');
    expect(within(panel).getByText('llms.txt: Not published')).toBeInTheDocument();
  });

  it('groups issues by severity with explanation and how to fix', async () => {
    renderSiteAudit();
    const critical = await screen.findByRole('region', { name: 'Critical issues' });

    expect(within(critical).getByText('Missing title tag')).toBeInTheDocument();
    expect(within(critical).getByText('Add a unique, descriptive <title>.')).toBeInTheDocument();
  });

  it('lists the affected pages when View pages is pressed', async () => {
    const { dialog } = await openAffectedPages();

    expect(within(dialog).getByRole('link', { name: PAGE_URL })).toHaveAttribute('href', PAGE_URL);
    expect(fetchIssuePages).toHaveBeenCalledWith(AUDIT_ID, 'missing-title', null, expect.anything());
  });

  it('shows a failed audit with its phase and error code', async () => {
    setupSiteAudit({
      detail: buildAuditDetail({
        status: 'failed',
        phase: 'crawl',
        error_code: 'step_timeout',
        summary: null 
      }) 
    });
    renderSiteAudit();

    expect(await screen.findByRole('alert')).toHaveTextContent('failed during crawl (step_timeout)');
  });
});

describe('SiteAuditView running audit', () => {
  it('shows the crawl progress', async () => {
    setupSiteAudit({ detail: RUNNING });
    renderSiteAudit();

    expect(await screen.findByText('40 of 200 pages crawled (limit 500)')).toBeInTheDocument();
  });

  it('reads the audit again when a step of it ran, and not for another audit', async () => {
    setupSiteAudit({ detail: RUNNING });
    renderSiteAudit();
    await screen.findByText('Crawling pages');
    await waitFor(() => {
      expect(fetchAudit).toHaveBeenCalledTimes(2);
    });
    await emitLive('seo', {
      type: 'seo-job.changed',
      feature: 'audit',
      id: 'another-audit' 
    });
    await emitLive('seo', {
      type: 'seo-job.changed',
      feature: 'audit',
      id: AUDIT_ID 
    });

    await waitFor(() => {
      expect(fetchAudit).toHaveBeenCalledTimes(3);
    });
  });

  it('stops listening when the view unmounts', async () => {
    setupSiteAudit({ detail: RUNNING });
    const { unmount } = renderSiteAudit();
    await screen.findByText('Crawling pages');
    unmount();

    expect(liveSubscriberCount('seo')).toBe(0);
  });

  it('lets an admin cancel a running audit', async () => {
    vi.mocked(cancelAudit).mockResolvedValue({ audit: buildSiteAudit({ status: 'cancelled' }) });
    setupSiteAudit({ detail: RUNNING });
    const { user } = renderSiteAudit();
    await user.click(await screen.findByRole('button', { name: 'Cancel audit' }));

    expect(cancelAudit).toHaveBeenCalledWith(AUDIT_ID);
  });
});

describe('SiteAuditView export', () => {
  it('exports the finished audit from the server', async () => {
    renderSiteAudit();

    await chooseExportFormat('csv');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'seo-site-audit',
      params: { audit_id: AUDIT_ID },
      format: 'csv',
    });
  });

  it('offers no export while the audit runs', async () => {
    setupSiteAudit({ detail: RUNNING });
    renderSiteAudit();
    await screen.findByRole('button', { name: 'Cancel audit' });

    expect(screen.queryByRole('button', { name: 'Export all' })).not.toBeInTheDocument();
  });

  it('offers no export inside the affected pages dialog', async () => {
    const { dialog } = await openAffectedPages();

    expect(within(dialog).queryByRole('button', { name: 'Export all' })).not.toBeInTheDocument();
  });
});
