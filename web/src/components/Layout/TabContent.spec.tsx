import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type { Keyword } from '../../types';
import { TabContent } from './TabContent';
import { buildTabContentProps } from './TabContent-fixtures';
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
});
