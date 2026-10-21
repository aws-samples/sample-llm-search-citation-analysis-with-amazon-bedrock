import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type { Keyword } from '../../types';
import { TabContent } from './TabContent';
import {
  APPROXIMATE_STATS, buildTabContentProps, FIRST_CITATIONS_PAGE, RECENT_SEARCH
} from './TabContent-fixtures';
import { APPROXIMATE_COUNT_NOTE } from '../Dashboard/StatCard';
import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import {
  buildMarketSelectionMock, renderWithMarketSelection
} from '../Markets/markets-fixtures';
import {
  answerChileanPanels, COMBINED_PANELS
} from '../../hooks/useMarketDashboard-fixtures';

vi.mock('../ContentStudio', () => ({
  ContentStudioView: ({ keywords }: { keywords: Keyword[] }) => (
    <div>Content Studio keywords: {keywords.map((keyword) => keyword.keyword).join(', ')}</div>
  ),
}));
vi.mock('../Dashboard/ProviderChart', () => ({ ProviderChart: () => <div>Provider chart marker</div> }));
vi.mock('../Dashboard/BrandChart', () => ({ BrandChart: () => <div>Brand chart marker</div> }));
vi.mock('../Dashboard/AlertsPanel', () => ({ AlertsPanel: () => <section>Alerts panel marker</section> }));
vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));

/** The dashboard over `COMBINED_PANELS` with `market` picked in the header; the market reads answer Chile's figures. */
function renderDashboardFor(market: string | null) {
  answerChileanPanels();
  return renderWithMarketSelection(
    <TabContent {...buildTabContentProps({
      activeTab: 'dashboard',
      ...COMBINED_PANELS,
    })} />,
    buildMarketSelectionMock({ selectedMarketId: market }),
  );
}

describe('TabContent dashboard market', () => {
  it('shows the combined totals without a market note when every market is shown', () => {
    renderDashboardFor(null);

    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.queryByText(/Totals and charts ·/)).not.toBeInTheDocument();
    expect(mockAuthenticatedFetch).not.toHaveBeenCalled();
  });

  it('names the picked market above the totals', async () => {
    renderDashboardFor('cl-es');
    await screen.findByText('21');

    expect(screen.getByText('Totals and charts · Chile (Spanish)')).toBeInTheDocument();
  });

  it('shows the picked market totals instead of the combined ones', async () => {
    renderDashboardFor('cl-es');

    expect(await screen.findByText('21')).toBeInTheDocument();
    expect(screen.queryByText('120')).not.toBeInTheDocument();
  });
});

describe('TabContent content studio wiring', () => {
  it('passes the existing dashboard keywords to Content Studio', async () => {
    render(<TabContent {...buildTabContentProps()} />);

    expect(await screen.findByText('Content Studio keywords: Alpha keyword')).toBeInTheDocument();
  });
});

describe('TabContent dashboard composition', () => {
  it('places alerts after charts and before quick actions', () => {
    render(<TabContent {...buildTabContentProps({ activeTab: 'dashboard' })} />);
    const chartMarker = screen.getByText('Brand chart marker');
    const alertsMarker = screen.getByText('Alerts panel marker');
    const quickActions = screen.getByText('Quick Actions');

    expect(chartMarker.compareDocumentPosition(alertsMarker)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(alertsMarker.compareDocumentPosition(quickActions)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('counts every cited URL of the scope on the citations quick action, not just the first page', () => {
    render(<TabContent {...buildTabContentProps({
      activeTab: 'dashboard',
      citations: FIRST_CITATIONS_PAGE,
    })} />);

    expect(screen.getByText('View Citations (4,210)')).toBeInTheDocument();
  });

  it('counts the listed URLs on the citations quick action when the payload has no scope total', () => {
    render(<TabContent {...buildTabContentProps({
      activeTab: 'dashboard',
      citations: COMBINED_PANELS.citations,
    })} />);

    expect(screen.getByText('View Citations (0)')).toBeInTheDocument();
  });
});

describe('TabContent dashboard totals', () => {
  it('marks every stat card approximate when the stats say the counts are estimates', () => {
    render(<TabContent {...buildTabContentProps({
      activeTab: 'dashboard',
      stats: APPROXIMATE_STATS,
    })} />);

    expect(screen.getAllByTitle(APPROXIMATE_COUNT_NOTE)).toHaveLength(4);
  });

  it('marks no stat card approximate when the stats are exact counts', () => {
    render(<TabContent {...buildTabContentProps({
      activeTab: 'dashboard',
      ...COMBINED_PANELS,
    })} />);

    expect(screen.queryAllByTitle(APPROXIMATE_COUNT_NOTE)).toStrictEqual([]);
  });
});

describe('TabContent recent searches', () => {
  it('offers the older searches when the dashboard load has a next page', async () => {
    render(<TabContent {...buildTabContentProps({
      activeTab: 'searches',
      searches: [RECENT_SEARCH],
      searchesNextToken: 'older-searches',
    })} />);

    expect(await screen.findByRole('button', { name: 'Load older searches' })).toBeInTheDocument();
  });

  it('offers no older searches when the dashboard load holds the last page', async () => {
    render(<TabContent {...buildTabContentProps({
      activeTab: 'searches',
      searches: [RECENT_SEARCH],
    })} />);
    await screen.findByText(RECENT_SEARCH.keyword);

    expect(screen.queryByRole('button', { name: 'Load older searches' })).not.toBeInTheDocument();
  });
});
