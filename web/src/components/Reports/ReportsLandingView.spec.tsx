import {
  describe, it, expect 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReportsLandingView } from './ReportsLandingView';

/**
 * The landing view doubles as a roadmap: every report is listed, including
 * any not built yet. Tests pin:
 *   - every title renders so an exec scanning the page sees the full plan
 *   - the available reports link to a real path (regression catch if the
 *     `path` field gets set wrongly during sequencing)
 *   - the not-yet-built reports show "Coming soon" instead of an active link
 */
describe('ReportsLandingView', () => {
  function renderLanding() {
    return render(
      <MemoryRouter>
        <ReportsLandingView />
      </MemoryRouter>,
    );
  }

  it('lists the four strategic reports by title', () => {
    renderLanding();
    expect(screen.getByText('Executive Summary')).toBeInTheDocument();
    expect(screen.getByText('Brand Visibility Report')).toBeInTheDocument();
    expect(screen.getByText('Competitor Gap Report')).toBeInTheDocument();
    expect(screen.getByText('Content Action Plan')).toBeInTheDocument();
  });

  it('lists the keyword-level drill-down report', () => {
    renderLanding();
    expect(screen.getByText('Keyword Deep Dive')).toBeInTheDocument();
  });

  it('renders Keyword Deep Dive as a working link to /reports/keyword', () => {
    renderLanding();
    const link = screen.getByRole('link', { name: /keyword deep dive/i });
    expect(link).toHaveAttribute('href', '/reports/keyword');
  });

  it('renders Content Action Plan as a working link to /reports/content-action-plan', () => {
    renderLanding();
    const link = screen.getByRole('link', { name: /content action plan/i });
    expect(link).toHaveAttribute('href', '/reports/content-action-plan');
  });

  it('renders Brand Visibility as a working link to /reports/visibility', () => {
    renderLanding();
    const link = screen.getByRole('link', { name: /brand visibility/i });
    expect(link).toHaveAttribute('href', '/reports/visibility');
  });

  it('renders Executive Summary as a working link to /reports/executive-summary', () => {
    renderLanding();
    const link = screen.getByRole('link', { name: /executive summary/i });
    expect(link).toHaveAttribute('href', '/reports/executive-summary');
  });

  it('renders Competitor Gap as a working link to /reports/competitor', () => {
    renderLanding();
    const link = screen.getByRole('link', { name: /competitor gap/i });
    expect(link).toHaveAttribute('href', '/reports/competitor');
  });

  it('lists every report as available with a working link', () => {
    renderLanding();
    const comingSoonBadges = screen.queryAllByText(/coming soon/i);
    expect(comingSoonBadges).toHaveLength(0);
  });

  it.each([
    ['Competitor Benchmark', '/reports/benchmark'],
    ['AI Engines', '/reports/engines'],
    ['Sources', '/reports/sources'],
    ['Sentiment', '/reports/sentiment'],
  ])('links the %s card to %s', (title, path) => {
    renderLanding();
    expect(screen.getByRole('heading', { name: title }).closest('a')).toHaveAttribute('href', path);
  });

  it.each([
    ['Competitor Benchmark', 'For: Brand manager, competitive intelligence'],
    ['AI Engines', 'For: AI search specialist'],
    ['Sources', 'For: SEO and digital PR'],
    ['Sentiment', 'For: Brand / communications lead'],
  ])('names the audience of the %s card', (title, audience) => {
    renderLanding();
    expect(screen.getByRole('heading', { name: title }).closest('a')?.lastElementChild?.textContent).toBe(audience);
  });

  it('shows the executive and marketing-lead audiences', () => {
    renderLanding();
    expect(screen.getByText(/CMO, VP Marketing/)).toBeInTheDocument();
    expect(screen.getByText(/Marketing lead/)).toBeInTheDocument();
  });

  it('shows the strategist and SEO-lead audiences', () => {
    renderLanding();
    expect(screen.getByText(/Content \/ PR strategist/)).toBeInTheDocument();
    expect(screen.getByText(/Content strategist/)).toBeInTheDocument();
    expect(screen.getByText(/SEO \/ AI search lead/)).toBeInTheDocument();
  });
});
