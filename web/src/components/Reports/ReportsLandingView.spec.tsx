import {
  describe, it, expect, vi
} from 'vitest';
import {
  fireEvent, render, screen, within
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReportsLandingView } from './ReportsLandingView';
import { mockApiGet } from '../../api/clientMock-fixtures';
import { reportsListPayload } from './customReport/customReportPages-fixtures';
import { CurrentLocation } from './scopeReport/scopeReport-fixtures';

vi.mock('../../api/client', () => import('../../api/clientMock-fixtures'));

/**
 * The landing view lists every report under the question it answers, as a
 * card linking to it, then the saved custom reports. Tests pin:
 *   - every report links to a real path (regression catch for a wrong `path`)
 *   - the grouping by question, the one-line question and the audience
 *   - "New custom report" as the page's action
 */
describe('ReportsLandingView', () => {
  function renderLanding() {
    mockApiGet.mockResolvedValue(reportsListPayload());
    return render(
      <MemoryRouter initialEntries={['/reports']}>
        <ReportsLandingView />
        <CurrentLocation />
      </MemoryRouter>,
    );
  }

  it('opens the custom report builder from New custom report', async () => {
    renderLanding();
    fireEvent.click(await screen.findByRole('button', { name: 'New custom report' }));

    expect(screen.getByLabelText('Current location')).toHaveTextContent('/reports/custom/new');
  });

  it.each([
    ['Executive Summary', '/reports/executive-summary'],
    ['Brand Visibility', '/reports/visibility'],
    ['Competitor Benchmark', '/reports/benchmark'],
    ['Competitor Gap', '/reports/competitor'],
    ['Sentiment', '/reports/sentiment'],
    ['AI Engines', '/reports/engines'],
    ['Sources', '/reports/sources'],
    ['SEO vs GEO', '/reports/seo-geo'],
    ['Content Action Plan', '/reports/content-action-plan'],
    ['Keyword Deep Dive', '/reports/keyword'],
  ])('links the %s card to %s', (title, path) => {
    renderLanding();
    expect(screen.getByRole('heading', { name: title }).closest('a')).toHaveAttribute('href', path);
  });

  it('makes each of the ten report cards a link', () => {
    renderLanding();
    expect(screen.getAllByRole('link')).toHaveLength(10);
  });

  it.each([
    ['How visible are we?', ['Executive Summary', 'Brand Visibility']],
    ['How do we compare?', ['Competitor Benchmark', 'Competitor Gap', 'Sentiment']],
    ['Where do the answers come from?', ['AI Engines', 'Sources', 'SEO vs GEO']],
    ['What should we do next?', ['Content Action Plan', 'Keyword Deep Dive']],
  ])('lists under "%s" the reports that answer it', (question, titles) => {
    renderLanding();
    const group = screen.getByRole('region', { name: question });
    expect(within(group).getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toStrictEqual(titles);
  });

  it.each([
    ['Executive Summary', 'Where do we stand overall, what changed, and what are the next three actions?', 'For CMO, VP Marketing'],
    ['Competitor Benchmark', 'How does our share of voice compare with every brand the answers name?', 'For Brand manager, competitive intelligence'],
    ['Sources', 'Which websites do the answers cite, and are ours among them?', 'For SEO and digital PR'],
    ['Keyword Deep Dive', 'Why does one keyword rank the way it does, and how do we improve it?', 'For SEO / AI search lead'],
  ])('says which question the %s card answers, and for whom', (title, question, audience) => {
    renderLanding();
    const card = screen.getByRole('heading', { name: title }).closest('a');
    expect([...(card?.querySelectorAll('p') ?? [])].map((line) => line.textContent)).toStrictEqual([question, audience]);
  });

  it('lists the saved custom reports under the report groups', async () => {
    renderLanding();
    expect(await screen.findByRole('region', { name: 'Your custom reports' })).toBeInTheDocument();
  });
});
