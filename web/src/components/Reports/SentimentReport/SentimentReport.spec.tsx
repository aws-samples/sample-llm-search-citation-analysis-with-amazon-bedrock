import {
  describe, it, expect, vi
} from 'vitest';
import { within } from '@testing-library/react';
import { SentimentSections } from './SentimentReport';
import {
  sectionTable, sectionTitled, statFigure, statFootnote
} from '../layout/reportQueries-fixtures';
import {
  buildScopeReport, renderSections, reportWithTrends, reportWithVisibility
} from '../scopeReport/scopeReport-fixtures';
import {
  buildLatestBrands, buildPeriodChange, buildTrendPoint
} from '../layout/reportPayload-fixtures';
import { buildKpis } from '../BrandVisibilityReport/groupKpiHistory-fixtures';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

const NO_SENTIMENT = buildKpis({
  sentiment_split: {
    positive: 0,
    neutral: 0,
    negative: 0,
    mixed: 0,
  },
});

describe('Sentiment headline', () => {
  it('shows your net sentiment', () => {
    renderSections(<SentimentSections report={buildScopeReport()} />);

    expect(statFigure('Net sentiment').textContent).toBe('+15.0');
  });

  it('notes the change in net sentiment since each keyword\'s previous run', () => {
    renderSections(<SentimentSections report={reportWithVisibility({ change: buildPeriodChange() })} />);

    expect(statFootnote('Net sentiment')).toBe('+10.0 pts vs previous run (3 keywords)');
  });

  it.each([
    ['Positive mentions', '5', '41.7% of 12 mentions with a sentiment'],
    ['Negative mentions', '1', '8.3% of 12 mentions with a sentiment'],
    ['Neutral or mixed', '6', '50.0% of 12 mentions with a sentiment'],
  ])('counts the %s with their share of the labelled mentions', (label, figure, note) => {
    renderSections(<SentimentSections report={buildScopeReport()} />);

    expect([statFigure(label).textContent, statFootnote(label)]).toStrictEqual([figure, note]);
  });

  it('says when no mention has a sentiment yet', () => {
    renderSections(<SentimentSections report={reportWithVisibility({ kpis: NO_SENTIMENT })} />);

    expect(statFootnote('Positive mentions')).toBe('No mention with a sentiment yet');
  });

  it('states the split of every engine together in the chart caption', () => {
    renderSections(<SentimentSections report={buildScopeReport()} />);

    expect(within(sectionTitled('Headline')).getByText(/^Sentiment of the labelled mentions/).textContent).toBe(
      'Sentiment of the labelled mentions per row, stacked to 100%. '
      + 'All engines: 41.7% positive, 33.3% neutral, 16.7% mixed, 8.3% negative of 12 labelled mentions.',
    );
  });
});

describe('Sentiment over time', () => {
  it('states the net sentiment of the latest period in the chart caption', () => {
    renderSections(<SentimentSections report={buildScopeReport()} />);

    expect(within(sectionTitled('Net sentiment over time')).getByText(/^Net sentiment over 2 periods/).textContent).toBe(
      'Net sentiment over 2 periods from 2026-09-01 to 2026-09-08, from −100 (all negative) to +100 (all positive). Latest (2026-09-08): +15.0.',
    );
  });

  it('describes the period and the scale under the heading', () => {
    renderSections(<SentimentSections report={buildScopeReport({
      days: 180,
      period: 'week',
    })} />);

    expect(within(sectionTitled('Net sentiment over time')).getByText(/^Your brand's net sentiment/).textContent)
      .toBe('Your brand\'s net sentiment per week over the last 180 days, from −100 (all negative) to +100 (all positive).');
  });

  it('writes an unknown latest net sentiment as a dash', () => {
    renderSections(<SentimentSections report={reportWithTrends({ trend_data: [buildTrendPoint('2026-09-08', { kpis: buildKpis({ net_sentiment: null }) })] })} />);

    expect(within(sectionTitled('Net sentiment over time')).getByText(/^Net sentiment over 1 period/).textContent).toMatch(/Latest \(2026-09-08\): —\.$/);
  });
});

describe('Sentiment per engine', () => {
  it('states each engine\'s split in the chart caption', () => {
    renderSections(<SentimentSections report={buildScopeReport()} />);

    expect(within(sectionTitled('Sentiment per engine')).getByText(/^Sentiment of the labelled mentions/).textContent).toMatch(/Google Gemini: .* OpenAI: /);
  });
});

describe('Sentiment per brand', () => {
  it('heads the brand, its net sentiment, mentions and mention rate', () => {
    renderSections(<SentimentSections report={buildScopeReport()} />);

    expect(sectionTable('Net sentiment per brand')[0]).toStrictEqual(['Brand', 'Net sentiment', 'Mentions', 'Mention rate']);
  });

  it.each([
    [1, ['Nike', '+15.0', '12', '60.0%']],
    [2, ['Adidas', '+5.0', '10', '50.0%']],
    [3, ['Puma', '—', '6', '30.0%']],
  ])('shows row %s with the brand\'s net sentiment', (index, row) => {
    renderSections(<SentimentSections report={reportWithVisibility({ brands: buildLatestBrands() })} />);

    expect(sectionTable('Net sentiment per brand')[index]).toStrictEqual(row);
  });

  it('highlights your brand\'s row', () => {
    renderSections(<SentimentSections report={buildScopeReport()} />);

    expect(within(sectionTitled('Net sentiment per brand')).getAllByRole('row')[1]).toHaveClass('bg-emerald-50');
  });

  it('says so when the answers name no brand', () => {
    renderSections(<SentimentSections report={reportWithVisibility({ brands: [] })} />);

    expect(within(sectionTitled('Net sentiment per brand')).getByText('The answers name no brand yet.')).toBeInTheDocument();
  });
});
