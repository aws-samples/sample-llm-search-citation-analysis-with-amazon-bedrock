import {
  describe, it, expect, vi
} from 'vitest';
import {
  screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BenchmarkSections } from './CompetitorBenchmarkReport';
import {
  buildScopeReport, reportWithTrends, reportWithVisibility, sectionsRenderer
} from '../scopeReport/scopeReport-fixtures';
import {
  headerTooltips, sectionTable, sectionTitled, statFigure, statFootnote
} from '../layout/reportQueries-fixtures';
import {
  buildBrandRow, buildLatestBrands, buildPeriodChange
} from '../layout/reportPayload-fixtures';
import { NO_PREVIOUS_RUN } from '../layout/periodComparison';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

const renderBenchmark = sectionsRenderer(BenchmarkSections);

const NIKE = buildBrandRow('Nike', { classification: 'first_party' });
const ADIDAS = buildBrandRow('Adidas');
const LATEST_BRANDS = reportWithVisibility({ brands: buildLatestBrands() });

describe('Competitor Benchmark headline', () => {
  it('shows your share of voice', () => {
    renderBenchmark();

    expect(statFigure('Share of voice').textContent).toBe('25.0%');
  });

  it('notes the change in share of voice since each keyword\'s previous run', () => {
    renderBenchmark(reportWithVisibility({ change: buildPeriodChange() }));

    expect(statFootnote('Share of voice')).toBe('+5.0 pts vs previous run (3 keywords)');
  });

  it('says there is nothing to compare with before a second run', () => {
    renderBenchmark();

    expect(statFootnote('Share of voice')).toBe(NO_PREVIOUS_RUN);
  });

  it.each([
    ['#1 of 2', [NIKE, buildBrandRow('Adidas')]],
    ['#2 of 2', [buildBrandRow('Adidas'), NIKE]],
    ['—', [buildBrandRow('Adidas')]],
  ])('ranks your brand %s among the brands named', (rank, brands) => {
    renderBenchmark(reportWithVisibility({ brands }));

    expect(statFigure('Your rank').textContent).toBe(rank);
  });

  it.each([
    ['By visibility score', [NIKE, ADIDAS]],
    ['No answer names your brand', [ADIDAS]],
  ])('footnotes your rank with "%s"', (footnote, brands) => {
    renderBenchmark(reportWithVisibility({ brands }));

    expect(statFootnote('Your rank')).toBe(footnote);
  });

  it.each([
    ['Adidas', '31.5% share of voice', [buildBrandRow('Nike', {
      classification: 'first_party',
      share_of_voice: 20,
    }), buildBrandRow('Adidas', { share_of_voice: 31.5 })]],
    ['—', 'No brand has a share of voice yet', [buildBrandRow('Nike', {
      classification: 'first_party',
      share_of_voice: null,
    })]],
  ])('names %s as the brand leading the share of voice, footnoted "%s"', (leader, footnote, brands) => {
    renderBenchmark(reportWithVisibility({ brands }));

    expect([statFigure('Leading brand').textContent, statFootnote('Leading brand')]).toStrictEqual([leader, footnote]);
  });

  it.each([
    ['Your rank', 'Your brand\'s place among every brand the answers name, by visibility score (1 = the most visible).'],
    ['Leading brand', 'The brand with the largest share of voice: the largest share of all brand mentions in the answers.'],
    ['Brands named', 'How many distinct brands the answers name: yours, competitors\' and others\'.'],
  ])('explains the %s card in its tooltip', (label, text) => {
    renderBenchmark();

    expect(within(sectionTitled('Headline')).getByRole('button', { name: `About ${label}` })).toHaveAccessibleDescription(text);
  });

  it('counts the brands named', () => {
    renderBenchmark(LATEST_BRANDS);

    expect(statFigure('Brands named').textContent).toBe('3');
  });
});

describe('Competitor Benchmark share of voice', () => {
  it('states each brand\'s share in the donut caption', () => {
    renderBenchmark(LATEST_BRANDS);

    expect(within(sectionTitled('Share of voice')).getByText(/^Share of voice: /).textContent).toBe('Share of voice: Nike 25.0%, Adidas 20.8% and Puma 12.5%.');
  });
});

describe('Competitor Benchmark brands over time', () => {
  it('charts the share of voice per day by default', () => {
    renderBenchmark();

    expect(within(sectionTitled('Brands over time')).getByText(/of your brand and its leading competitors/).textContent)
      .toBe('Share of voice of your brand and its leading competitors, per day over the last 30 days.');
  });

  it('charts weekly points over a 90-day period', () => {
    renderBenchmark(buildScopeReport({
      days: 90,
      period: 'week',
    }));

    expect(screen.getByText(/per week over the last 90 days/)).toBeInTheDocument();
  });

  it.each([
    ['Mention rate'],
    ['Visibility score'],
  ])('switches the chart to the %s', async (label) => {
    renderBenchmark();

    await userEvent.click(screen.getByRole('button', { name: label }));

    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(`${label} of your brand and its leading competitors, per day over the last 30 days.`)).toBeInTheDocument();
  });

  it('marks the share of voice as the only chosen metric before any choice', () => {
    renderBenchmark();

    expect(within(screen.getByRole('group', { name: 'Metric' })).getAllByRole('button').map((button) => button.getAttribute('aria-pressed')))
      .toStrictEqual(['true', 'false', 'false']);
  });

  it.each([
    ['Nike', [ADIDAS, NIKE]],
    ['Your brand', [ADIDAS]],
  ])('labels your brand\'s line %s after the latest leaderboard', (name, brands) => {
    renderBenchmark(reportWithTrends({ latest_brands: brands }));

    expect(within(sectionTitled('Brands over time')).getByText(new RegExp(`^Share of voice of ${name}, `))).toBeInTheDocument();
  });
});

describe('Competitor Benchmark leaderboard', () => {
  it('lists every brand in leaderboard order', () => {
    renderBenchmark(LATEST_BRANDS);

    expect(sectionTable('Leaderboard').slice(1).map(([brand]) => brand)).toStrictEqual(['Nike', 'Adidas', 'Puma']);
  });

  it('heads a column for every per-brand KPI', () => {
    renderBenchmark();

    expect(sectionTable('Leaderboard')[0]).toStrictEqual([
      'Brand', 'Visibility score', 'Mention rate', 'Share of voice', 'Average position', 'Best position', 'Net sentiment', 'Engines', 'Keywords',
    ]);
  });

  it('shows every KPI of a brand', () => {
    renderBenchmark(LATEST_BRANDS);

    expect(sectionTable('Leaderboard')[3]).toStrictEqual(['Puma', '22.7', '30.0%', '12.5%', '3.00', '2', '—', 'OpenAI', '1']);
  });

  it('explains every KPI column in a tooltip', () => {
    renderBenchmark();

    expect(headerTooltips('Leaderboard').map(([header]) => header)).toStrictEqual(sectionTable('Leaderboard')[0].slice(1));
  });

  it.each([
    ['Best position', 'The earliest place the brand reached in any answer (1 = named first); answers without a known place are left out.'],
    ['Engines', 'The AI engines whose answers name the brand.'],
    ['Keywords', 'How many keywords have an answer naming the brand.'],
  ])('explains the %s column in its tooltip', (column, text) => {
    renderBenchmark();

    expect(headerTooltips('Leaderboard').find(([header]) => header === column)).toStrictEqual([column, text]);
  });

  it('shows a dash for a brand without a known best position', () => {
    renderBenchmark(reportWithVisibility({ brands: [buildBrandRow('Asics', { best_position: null })] }));

    expect(sectionTable('Leaderboard')[1][5]).toBe('—');
  });

  it('lists every engine naming a brand, comma separated', () => {
    renderBenchmark();

    expect(sectionTable('Leaderboard')[1][7]).toBe('Google Gemini, OpenAI');
  });

  it('highlights your brand\'s row only', () => {
    renderBenchmark();
    const [nike, adidas] = within(sectionTitled('Leaderboard')).getAllByRole('row').slice(1);

    expect(nike).toHaveClass('bg-emerald-50');
    expect(adidas.getAttribute('class')).toBe('');
  });

  it('badges each brand with whose it is', () => {
    const brands = [NIKE, ADIDAS, buildBrandRow('Asics', { classification: 'other' })];
    renderBenchmark(reportWithVisibility({ brands }));

    expect(within(sectionTitled('Leaderboard')).getAllByText(/^(Your brand|Competitor|Other)$/).map((badge) => badge.textContent))
      .toStrictEqual(['Your brand', 'Competitor', 'Other']);
  });

  it('says so when the answers name no brand', () => {
    renderBenchmark(reportWithVisibility({ brands: [] }));

    expect(within(sectionTitled('Leaderboard')).getByText('The answers name no brand yet.')).toBeInTheDocument();
  });
});
