import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen
} from '@testing-library/react';
import { TabContent } from './TabContent';
import {
  APPROXIMATE_STATS, buildTabContentProps, CITATIONS_TIMED_OUT_PANELS, SEARCHES_FAILED_PANELS
} from './TabContent-fixtures';
import {
  buildMarketSelectionMock, renderWithMarketSelection
} from '../Markets/markets-fixtures';
import { answerChileanPanels } from '../../hooks/useMarketDashboard-fixtures';

vi.mock('../Dashboard/ProviderChart', () => ({ ProviderChart: () => <div>Provider chart marker</div> }));
vi.mock('../Dashboard/BrandChart', () => ({ BrandChart: () => <div>Brand chart marker</div> }));
vi.mock('../Dashboard/AlertsPanel', () => ({ AlertsPanel: () => <section>Alerts panel marker</section> }));
vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));

describe('TabContent per-panel load errors', () => {
  it('shows the citations timeout next to the charts when /citations timed out', () => {
    render(<TabContent {...buildTabContentProps({
      activeTab: 'dashboard',
      panels: CITATIONS_TIMED_OUT_PANELS,
    })} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Citation and brand charts did not load: Request timed out.');
  });

  it('keeps showing the loaded totals when only the citations panel failed', () => {
    render(<TabContent {...buildTabContentProps({
      activeTab: 'dashboard',
      stats: APPROXIMATE_STATS,
      panels: CITATIONS_TIMED_OUT_PANELS,
    })} />);

    expect(screen.getByText('250,000')).toBeInTheDocument();
  });

  it('retries the citations panel when its Retry button is clicked', () => {
    const retryPanel = vi.fn();
    render(<TabContent {...buildTabContentProps({
      activeTab: 'dashboard',
      panels: CITATIONS_TIMED_OUT_PANELS,
      retryPanel,
    })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(retryPanel).toHaveBeenCalledWith('citations');
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

  it('shows the searches failure above Recent Searches when /searches failed', async () => {
    render(<TabContent {...buildTabContentProps({
      activeTab: 'searches',
      panels: SEARCHES_FAILED_PANELS,
    })} />);

    expect(await screen.findByText('Recent searches did not load: Server error occurred.')).toBeInTheDocument();
  });
});
