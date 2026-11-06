import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type { Keyword } from '../../types';
import { TabContent } from './TabContent';
import {
  APPROXIMATE_STATS,
  buildTabContentProps,
  CITATIONS_RETRYING_PANELS,
  CITATIONS_TIMED_OUT_PANELS,
  FIRST_CITATIONS_PAGE,
  RECENT_SEARCH,
  SEARCHES_FAILED_PANELS,
} from './TabContent-fixtures';
import { IDLE_PANEL_STATES } from '../../hooks/dashboardPanels';
import { APPROXIMATE_COUNT_NOTE } from '../Dashboard/StatCard';
import { queryLoadOlderSearchesElement } from '../Searches/SearchesView-fixtures';
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

/** The Recent Searches tab over `RECENT_SEARCH`. */
function renderSearchesTab(overrides: Parameters<typeof buildTabContentProps>[0] = {}) {
  return render(<TabContent {...buildTabContentProps({
    activeTab: 'searches',
    searches: [RECENT_SEARCH],
    ...overrides,
  })} />);
}

describe('TabContent recent searches', () => {
  it('offers the older searches when the dashboard load has a next page', async () => {
    renderSearchesTab({ searchesNextToken: 'older-searches' });
    await screen.findByText(RECENT_SEARCH.keyword);

    expect(queryLoadOlderSearchesElement()).toBeInTheDocument();
  });

  it('offers no older searches when the dashboard load holds the last page', async () => {
    renderSearchesTab();
    await screen.findByText(RECENT_SEARCH.keyword);

    expect(queryLoadOlderSearchesElement()).not.toBeInTheDocument();
  });

  it('shows the searches failure above Recent Searches when /searches failed', async () => {
    renderSearchesTab({ panels: SEARCHES_FAILED_PANELS });

    expect(await screen.findByText('Recent searches did not load: Server error occurred.')).toBeInTheDocument();
  });
});

/** The Dashboard tab with the dashboard read's per-panel outcome `panels`. */
function renderDashboardPanels(overrides: Parameters<typeof buildTabContentProps>[0] = {}) {
  return render(<TabContent {...buildTabContentProps({
    activeTab: 'dashboard',
    panels: CITATIONS_TIMED_OUT_PANELS,
    ...overrides,
  })} />);
}

describe('TabContent per-panel load errors', () => {
  it('shows the citations timeout next to the charts when /citations timed out', () => {
    renderDashboardPanels();

    expect(screen.getByRole('alert')).toHaveTextContent('Citation and brand charts did not load: Request timed out.');
  });

  it('keeps showing the loaded totals when only the citations panel failed', () => {
    renderDashboardPanels({ stats: APPROXIMATE_STATS });

    expect(screen.getByText('250,000')).toBeInTheDocument();
  });

  it('retries the citations panel when its Retry button is clicked', () => {
    const retryPanel = vi.fn();
    renderDashboardPanels({ retryPanel });

    screen.getByRole('button', { name: 'Retry' }).click();

    expect(retryPanel).toHaveBeenCalledWith('citations');
  });

  it('disables the button and says Retrying while the citations retry runs', () => {
    renderDashboardPanels({ panels: CITATIONS_RETRYING_PANELS });

    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
  });

  it('shows no panel error when every panel loaded', () => {
    renderDashboardPanels({ panels: IDLE_PANEL_STATES });

    expect(screen.queryByText(/did not load/)).not.toBeInTheDocument();
  });

  it('hides the combined-view panel errors while a market is picked', async () => {
    answerChileanPanels();
    renderWithMarketSelection(
      <TabContent {...buildTabContentProps({
        activeTab: 'dashboard',
        panels: CITATIONS_TIMED_OUT_PANELS,
      })} />,
      buildMarketSelectionMock({ selectedMarketId: 'cl-es' }),
    );
    await screen.findByText('21');

    expect(screen.queryByText(/did not load/)).not.toBeInTheDocument();
  });
});
