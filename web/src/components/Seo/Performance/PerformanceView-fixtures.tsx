/**
 * The page performance view with the SEO API answering from fixtures:
 *
 * ```ts
 * vi.mock('../../../api/seo', () => import('../../../test/seoApiMock'));
 * vi.mock('../../../api/seoPerformance');
 * vi.mock('../../../hooks/useIsAdmin', () => import('../../../test/useIsAdminMock'));
 * vi.mock('../../../hooks/useSeoSettings');
 * ```
 *
 * Brand Tracking names `example.com` as the brand's own domain unless a spec says otherwise.
 */
import {
  render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { isSeoApiConfigured } from '../../../api/seo';
import type { BrandSettings } from '../../../api/brandSettings';
import {
  checkIndexNowKeyFile, createIndexNowKey, fetchAuditPageUrls, fetchIndexNowSetup, fetchLighthouseRun,
  fetchLighthouseRuns, fetchLighthouseSample, startLighthouse, startLighthouseBatch, submitIndexNow
} from '../../../api/seoPerformance';
import {
  PAGE, buildKeyFileCheck, buildRun, buildSample, buildSetup, buildSite, buildStartRunResponse, buildSubmission
} from '../../../api/seoPerformance-fixtures';
import { mockAdminRole } from '../../../test/useIsAdminMock';
import { mockSettingsReads } from '../LocalSeo/settingsDefaults-fixtures';
import { PerformanceView } from './PerformanceView';

/** The crawled pages the latest audit answers for the URL suggestions. */
export const CRAWLED_PAGES = [PAGE, 'https://www.example.com/rooms', 'https://www.example.com/contact'];

/** Brand Tracking as read by the page: `example.com` owned unless `overrides` say otherwise. */
export function mockBrandSettings(overrides: Partial<BrandSettings> = {}): void {
  mockSettingsReads({
    brandNames: ['Example'],
    ownedDomains: ['example.com'],
    ...overrides,
  });
}

/** Every route answering its fixture; the viewer is an Admin only when `admin`. */
export function mockPerformanceAnswers(admin = false): void {
  mockBrandSettings();
  vi.mocked(fetchAuditPageUrls).mockResolvedValue(CRAWLED_PAGES);
  vi.mocked(isSeoApiConfigured).mockReturnValue(true);
  vi.mocked(startLighthouse).mockResolvedValue(buildStartRunResponse());
  vi.mocked(startLighthouseBatch).mockResolvedValue(buildStartRunResponse(buildRun({ kind: 'batch' })));
  vi.mocked(fetchLighthouseRun).mockResolvedValue(buildRun());
  vi.mocked(fetchLighthouseRuns).mockResolvedValue([]);
  vi.mocked(fetchLighthouseSample).mockResolvedValue(buildSample());
  vi.mocked(fetchIndexNowSetup).mockResolvedValue(buildSetup());
  vi.mocked(createIndexNowKey).mockResolvedValue({
    site: buildSite(),
    created: true
  });
  vi.mocked(checkIndexNowKeyFile).mockResolvedValue(buildKeyFileCheck());
  vi.mocked(submitIndexNow).mockResolvedValue({ submission: buildSubmission() });
  mockAdminRole(admin);
}

export function renderPerformance() {
  render(<MemoryRouter><PerformanceView /></MemoryRouter>);
  return userEvent.setup();
}

/** Renders the view with the SEO API URL missing from the build. */
export function renderUnconfiguredPerformance(): void {
  vi.mocked(isSeoApiConfigured).mockReturnValue(false);
  render(<MemoryRouter><PerformanceView /></MemoryRouter>);
}

/** Renders the view and waits until the audit sample has loaded. */
export async function renderLoadedPerformance() {
  const user = renderPerformance();
  await screen.findByRole('region', { name: 'Audit sample' });
  return user;
}

/** Queries scoped to the region labelled `name`. */
export function withinRegion(name: string) {
  return within(screen.getByRole('region', { name }));
}

/** Replaces the URL with `url` (default: the example homepage), picks `device` and presses Run Lighthouse. */
export async function measurePage(url = PAGE, device = 'mobile') {
  const user = renderPerformance();
  await user.clear(screen.getByLabelText('Page URL'));
  await user.type(screen.getByLabelText('Page URL'), url);
  await user.selectOptions(screen.getByLabelText('Device'), device);
  await user.click(screen.getByRole('button', { name: 'Run Lighthouse' }));
  return user;
}

/** Renders the view, waits for the audit sample and focuses the Page URL field (the crawled pages are read). */
export async function renderWithPageUrlFocused() {
  const user = await renderLoadedPerformance();
  await user.click(screen.getByLabelText('Page URL'));
  return user;
}

/** Opens the IndexNow tab once its setup has loaded. */
export async function openIndexNow() {
  const user = renderPerformance();
  await user.click(screen.getByRole('tab', { name: 'IndexNow' }));
  await screen.findByRole('region', { name: 'IndexNow keys' });
  return user;
}
