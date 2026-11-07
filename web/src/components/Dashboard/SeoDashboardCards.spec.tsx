import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { within } from '@testing-library/react';
import {
  fetchRankTrackers, fetchRankTrend, startRankRun
} from '../../api/seoRankTracking';
import {
  buildRankTrend, buildTrackerList, buildTrendPoint
} from '../../api/seoRankTracking-fixtures';
import {
  mockFetchSeoGeo, mockIsSeoApiConfigured
} from '../../hooks/useSeoAccount-fixtures';
import { buildSeoGeoResponse } from '../../hooks/useSeoGeo-fixtures';
import {
  getCardElement, renderSeoCards
} from './SeoDashboardCards-fixtures';

vi.mock('../../api/seo', () => import('../../hooks/useSeoAccount-fixtures'));
vi.mock('../../api/seoRankTracking');

beforeEach(() => {
  mockIsSeoApiConfigured.mockReturnValue(true);
  mockFetchSeoGeo.mockResolvedValue(buildSeoGeoResponse());
  vi.mocked(fetchRankTrackers).mockResolvedValue(buildTrackerList());
  vi.mocked(fetchRankTrend).mockResolvedValue(buildRankTrend([buildTrendPoint({
    total: 12,
    top3: 3,
    top4_10: 4,
  })]));
});

describe('SeoDashboardCards', () => {
  it('renders nothing and reads nothing when the SEO stack is not deployed', () => {
    mockIsSeoApiConfigured.mockReturnValue(false);

    const { container } = renderSeoCards();

    expect(container).toBeEmptyDOMElement();
    expect(mockFetchSeoGeo).not.toHaveBeenCalledWith({});
  });

  it('shows the quadrant counts of the SEO vs GEO comparison', async () => {
    renderSeoCards();

    expect(await within(getCardElement('SEO vs GEO')).findByText('Both strong')).toBeInTheDocument();
  });

  it('links the SEO vs GEO card to its report', () => {
    renderSeoCards();

    expect(within(getCardElement('SEO vs GEO')).getByRole('link')).toHaveAttribute('href', '/reports/seo-geo');
  });

  it('shows the tracked keywords in the top 10 of the newest check', async () => {
    renderSeoCards();

    expect((await within(getCardElement('Rankings')).findByText('Top 10')).nextElementSibling).toHaveTextContent('7');
  });

  it('links the Rankings card to the Rank Tracking page', () => {
    renderSeoCards();

    expect(within(getCardElement('Rankings')).getByRole('link')).toHaveAttribute('href', '/seo/rank-tracking');
  });

  it('starts no paid rank check when the cards load', async () => {
    renderSeoCards();
    await within(getCardElement('Rankings')).findByText('Top 10');

    expect(startRankRun).not.toHaveBeenCalledWith(expect.anything());
  });

  it('says so when no tracker exists in the market', async () => {
    vi.mocked(fetchRankTrackers).mockResolvedValue(buildTrackerList({ trackers: [] }));
    renderSeoCards();

    expect(await within(getCardElement('Rankings')).findByText('No rank tracker in this market yet.')).toBeInTheDocument();
  });
});
