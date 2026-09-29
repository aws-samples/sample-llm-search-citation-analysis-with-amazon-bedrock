import {
  describe, it, expect, vi
} from 'vitest';
import {
  screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BenchmarkSections } from './CompetitorBenchmarkReport';
import {
  buildScopeReport, renderSections, reportWithVisibility
} from '../scopeReport/scopeReport-fixtures';
import {
  headerTooltips, sectionTable, sectionTitled, statFigure, statFootnote
} from '../layout/reportQueries-fixtures';
import {
  buildBrandRow, buildLatestBrands, buildPeriodChange
} from '../layout/reportPayload-fixtures';
import { NO_PREVIOUS_RUN } from '../layout/periodComparison';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

const NIKE = buildBrandRow('Nike', { classification: 'first_party' });

describe('Competitor Benchmark headline', () => {
  it('shows your share of voice', () => {
    renderSections(<BenchmarkSections report={buildScopeReport()} />);

    expect(statFigure('Share of voice').textContent).toBe('25.0%');
  });

  it('notes the change in share of voice since each keyword\'s previous run', () => {
    renderSections(<BenchmarkSections report={reportWithVisibility({ change: buildPeriodChange() })} />);

    expect(statFootnote('Share of voice')).toBe('+5.0 pts vs previous run (3 keywords)');
  });

  it('says there is nothing to compare with before a second run', () => {
    renderSections(<BenchmarkSections report={buildScopeReport()} />);

    expect(statFootnote('Share of voice')).toBe(NO_PREVIOUS_RUN);
  });

  it.each([
    ['#1 of 2', [NIKE, buildBrandRow('Adidas')]],
    ['#2 of 2', [buildBrandRow('Adidas'), NIKE]],
    ['—', [buildBrandRow('Adidas')]],
  ])('ranks your brand %s among the brands named', (rank, brands) => {
    renderSections(<BenchmarkSections report={reportWithVisibility({ brands })} />);

    expect(statFigure('Your rank').textContent).toBe(rank);
  });

  it('says when no answer names your brand', () => {
    renderSections(<BenchmarkSections report={reportWithVisibility({ brands: [buildBrandRow('Adidas')] })} />);

    expect(statFootnote('Your rank')).toBe('No answer names your brand');
  });

  it('names the brand with the largest share of voice, with its share', () => {
    const brands = [buildBrandRow('Nike', {
      classification: 'first_party',
      share_of_voice: 20,
    }), buildBrandRow('Adidas', { share_of_voice: 31.5 })];
    renderSections(<BenchmarkSections report={reportWithVisibility({ brands })} />);

    expect([statFigure('Leading brand').textContent, statFootnote('Leading brand')]).toStrictEqual(['Adidas', '31.5% share of voice']);
  });

  it('counts the brands named', () => {
    renderSections(<BenchmarkSections report={reportWithVisibility({ brands: buildLatestBrands() })} />);

    expect(statFigure('Brands named').textContent).toBe('3');
  });
});

describe('Competitor Benchmark share of voice', () => {
  it('states each brand\'s share in the donut caption', () => {
    renderSections(<BenchmarkSections report={reportWithVisibility({ brands: buildLatestBrands() })} />);

    expect(within(sectionTitled('Share of voice')).getByText(/^Share of voice: /).textContent).toBe('Share of voice: Nike 25.0%, Adidas 20.8% and Puma 12.5%.');
  });
});

describe('Competitor Benchmark brands over time', () => {
  it('charts the share of voice per day by default', () => {
    renderSections(<BenchmarkSections report={buildScopeReport()} />);

    expect(within(sectionTitled('Brands over time')).getByText(/of your brand and its leading competitors/).textContent)
      .toBe('Share of voice of your brand and its leading competitors, per day over the last 30 days.');
  });

  it('charts weekly points over a 90-day period', () => {
    renderSections(<BenchmarkSections report={buildScopeReport({
      days: 90,
      period: 'week',
    })} />);

    expect(screen.getByText(/per week over the last 90 days/)).toBeInTheDocument();
  });

  it.each([
    ['Mention rate'],
    ['Visibility score'],
  ])('switches the chart to the %s', async (label) => {
    renderSections(<BenchmarkSections report={buildScopeReport()} />);

    await userEvent.click(screen.getByRole('button', { name: label }));

    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(`${label} of your brand and its leading competitors, per day over the last 30 days.`)).toBeInTheDocument();
  });

  it('marks the share of voice as the chosen metric before any choice', () => {
    renderSections(<BenchmarkSections report={buildScopeReport()} />);

    expect(screen.getByRole('button', { name: 'Share of voice' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('names your brand in the chart after the latest leaderboard', () => {
    renderSections(<BenchmarkSections report={buildScopeReport()} />);

    expect(within(sectionTitled('Brands over time')).getByText(/^Share of voice of Nike, /)).toBeInTheDocument();
  });
});

describe('Competitor Benchmark leaderboard', () => {
  it('lists every brand in leaderboard order', () => {
    renderSections(<BenchmarkSections report={reportWithVisibility({ brands: buildLatestBrands() })} />);

    expect(sectionTable('Leaderboard').slice(1).map(([brand]) => brand)).toStrictEqual(['Nike', 'Adidas', 'Puma']);
  });

  it('heads a column for every per-brand KPI', () => {
    renderSections(<BenchmarkSections report={buildScopeReport()} />);

    expect(sectionTable('Leaderboard')[0]).toStrictEqual([
      'Brand', 'Visibility score', 'Mention rate', 'Share of voice', 'Average position', 'Best position', 'Net sentiment', 'Engines', 'Keywords',
    ]);
  });

  it('shows every KPI of a brand', () => {
    renderSections(<BenchmarkSections report={reportWithVisibility({ brands: buildLatestBrands() })} />);

    expect(sectionTable('Leaderboard')[3]).toStrictEqual(['Puma', '22.7', '30.0%', '12.5%', '3.00', '2', '—', 'OpenAI', '1']);
  });

  it('explains every KPI column in a tooltip', () => {
    renderSections(<BenchmarkSections report={buildScopeReport()} />);

    expect(headerTooltips('Leaderboard').map(([header]) => header)).toStrictEqual(sectionTable('Leaderboard')[0].slice(1));
  });

  it('highlights your brand\'s row only', () => {
    renderSections(<BenchmarkSections report={buildScopeReport()} />);
    const [nike, adidas] = within(sectionTitled('Leaderboard')).getAllByRole('row').slice(1);

    expect(nike).toHaveClass('bg-emerald-50');
    expect(adidas).not.toHaveClass('bg-emerald-50');
  });

  it('badges each brand with whose it is', () => {
    renderSections(<BenchmarkSections report={buildScopeReport()} />);

    expect(within(sectionTitled('Leaderboard')).getAllByText(/^(Your brand|Competitor)$/).map((badge) => badge.textContent)).toStrictEqual(['Your brand', 'Competitor']);
  });

  it('says so when the answers name no brand', () => {
    renderSections(<BenchmarkSections report={reportWithVisibility({ brands: [] })} />);

    expect(within(sectionTitled('Leaderboard')).getByText('The answers name no brand yet.')).toBeInTheDocument();
  });
});
