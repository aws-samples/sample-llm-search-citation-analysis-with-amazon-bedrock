import {
  describe, expect, it, vi
} from 'vitest';
import { SeoGeoTableSection } from './SeoGeoTableSection';
import {
  render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeoGeoTrafficSection } from './SeoGeoTrafficSection';
import { SeoRecommendationsSection } from './SeoRecommendationsSection';
import {
  BEYOND_TOP_ROW, buildSeoGeoResponse, buildSeoGeoState
} from '../../../../hooks/useSeoGeo-fixtures';
import { buildSeoRecommendation } from '../../../../api/seoDomains-fixtures';
import { buildInsightsState } from './seoRecommendations-fixtures';

vi.mock('chart.js', () => import('../../../Dashboard/chartJs-fixtures'));

const BEYOND_TOP_STATE = buildSeoGeoState({ data: buildSeoGeoResponse({ rows: [BEYOND_TOP_ROW] }) });

describe('SeoGeoTableSection estimated traffic columns', () => {
  it.each([
    ['the snapshot position', '14 (snapshot)'],
    ['the rounded-sm estimated traffic', '35'],
  ])('shows %s of a keyword beyond the top 10', (_what, text) => {
    render(<SeoGeoTableSection state={BEYOND_TOP_STATE} />);

    expect(within(screen.getByRole('row', { name: /example air lounge access/ })).getByText(text)).toBeInTheDocument();
  });
});

describe('SeoGeoTrafficSection', () => {
  it('lists the traffic share of each brand', () => {
    render(<SeoGeoTrafficSection state={buildSeoGeoState()} />);

    expect(within(screen.getByRole('row', { name: /Acme/ })).getByText('60.0%')).toBeInTheDocument();
  });

  it('says the traffic is estimated, not measured', () => {
    render(<SeoGeoTrafficSection state={buildSeoGeoState()} />);

    expect(screen.getByText(/Estimated by DataForSEO from weekly domain snapshots \(your latest snapshot 2026-10-19\); not measured clicks/))
      .toBeInTheDocument();
  });
});

describe('SeoRecommendationsSection', () => {
  it('lists each recommendation with its title', () => {
    render(<SeoRecommendationsSection insights={buildInsightsState()} />);

    expect(screen.getByRole('heading', { name: 'Ranks on Google but AI answers rarely name you' })).toBeInTheDocument();
  });

  it('saves a new status through the Action Center status control', async () => {
    const insights = buildInsightsState();
    render(<SeoRecommendationsSection insights={insights} />);

    await userEvent.selectOptions(screen.getByLabelText('Status of Ranks on Google but AI answers rarely name you'), 'done');

    expect(insights.updateStatus).toHaveBeenCalledWith(buildSeoRecommendation(), 'done');
  });

  it('says there is nothing to recommend for an empty scope', () => {
    render(<SeoRecommendationsSection insights={buildInsightsState({ recommendations: [] })} />);

    expect(screen.getByText(/nothing to recommend yet/)).toBeInTheDocument();
  });

  it('shows the not-deployed notice when the SEO stack is missing', () => {
    const { container } = render(<SeoRecommendationsSection insights={buildInsightsState({ notConfigured: true })} />);

    expect(container.textContent).toContain('The SEO stack is not deployed');
  });
});
