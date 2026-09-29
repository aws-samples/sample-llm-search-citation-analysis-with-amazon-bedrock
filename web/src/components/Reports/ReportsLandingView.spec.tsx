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

  it.each([
    [
      'Executive Summary',
      'One-page rollup of overall visibility, the trend over time, top wins, top gaps, and the next three actions to take. The report a marketing lead would print before a quarterly business review.',
    ],
    [
      'Brand Visibility Report',
      'Mention rate, share of voice, visibility score, citation rate and every other KPI with its change and trend, the brand leaderboard and the KPIs per day, scoped to a keyword, a keyword group or the full keyword set. Highlights regressions in red.',
    ],
    [
      'Competitor Benchmark',
      'Your share of voice and rank against every brand the AI answers name: the share-of-voice donut, the leading brands over time by share of voice, mention rate or visibility score, and the full leaderboard with every KPI per brand.',
    ],
    [
      'AI Engines',
      'How each AI engine treats your brand: which engines name you, mention rate, visibility score and citation rate per engine side by side, every KPI per engine, and how each engine words its mentions.',
    ],
    [
      'Sources',
      'Which websites the AI answers cite: your citations, citation rate and citation share, the most cited domains with your own highlighted, and every cited domain with its engines and keywords.',
    ],
    [
      'Sentiment',
      'How the AI answers word your brand: net sentiment with its change and split, the net sentiment over time, the split per AI engine, and the net sentiment of every brand named.',
    ],
    [
      'Competitor Gap Report',
      'For each tracked competitor: keywords where they outrank you, citation sources unique to them, and a prioritized outreach list ranked by potential visibility lift.',
    ],
    [
      'Content Action Plan',
      'Prioritized citation gaps paired with AI-generated content briefs from Content Studio. Closes the loop from "we have a gap" to "here is the asset to fill it".',
    ],
    [
      'Keyword Deep Dive',
      'Single-keyword drill-down: every KPI with its change, KPI history, persona impact, provider differences, top sources, sentiment examples, recommended actions, and an LLM-generated narrative explaining the current ranking.',
    ],
  ])('describes what the %s card covers', (title, description) => {
    renderLanding();
    expect(screen.getByRole('heading', { name: title }).closest('a')?.querySelector('p')?.textContent).toBe(description);
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
