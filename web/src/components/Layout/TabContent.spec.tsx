import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type { Keyword } from '../../types';
import { TabContent } from './TabContent';
import { buildTabContentProps } from './TabContent-fixtures';

vi.mock('../ContentStudio', () => ({
  ContentStudioView: ({ keywords }: { keywords: Keyword[] }) => (
    <div>Content Studio keywords: {keywords.map((keyword) => keyword.keyword).join(', ')}</div>
  ),
}));
vi.mock('../Dashboard/ProviderChart', () => ({ ProviderChart: () => <div>Provider chart marker</div> }));
vi.mock('../Dashboard/BrandChart', () => ({ BrandChart: () => <div>Brand chart marker</div> }));
vi.mock('../Dashboard/AlertsPanel', () => ({ AlertsPanel: () => <section>Alerts panel marker</section> }));

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
