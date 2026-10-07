import { render } from '@testing-library/react';
import {
  describe, expect, it
} from 'vitest';
import { buildPortfolioBrand } from '../../../types/domain/insights-fixtures';
import { KPI_DEFINITIONS } from '../../../constants/kpiDefinitions';
import {
  BRAND_PORTFOLIO_TITLE, BrandPortfolioSection, PORTFOLIO_EMPTY
} from './BrandPortfolioSection';
import {
  columnTooltip, describeInsightsSectionPlaceholders, expectEmptySection, insightLines, insightsWithFacts, loadedInsights, sectionColumnHeadings,
  sectionRows
} from './insightSections-fixtures';

function renderPortfolio(slice = loadedInsights()) {
  return render(<BrandPortfolioSection {...slice} />);
}

describe('BrandPortfolioSection', () => {
  it('heads the brand, its KPIs and the two gaps', () => {
    renderPortfolio();

    expect(sectionColumnHeadings(BRAND_PORTFOLIO_TITLE)).toStrictEqual([
      'Brand', 'Mentions', 'Average position', 'Net sentiment', 'Citations', 'Position gap', 'Sentiment gap',
    ]);
  });

  it('explains the KPI columns with their definitions', () => {
    renderPortfolio();

    expect(columnTooltip('Average position')).toHaveAccessibleDescription(KPI_DEFINITIONS.average_position.definition);
    expect(columnTooltip('Citations')).toHaveAccessibleDescription(KPI_DEFINITIONS.citations.definition);
  });

  it('explains each gap by what it trails and the threshold that marks a brand weak', () => {
    renderPortfolio();

    expect(columnTooltip('Position gap')).toHaveAccessibleDescription('Places behind the best-placed of your brands; 2 or more marks the brand weak.');
    expect(columnTooltip('Sentiment gap')).toHaveAccessibleDescription('Points behind the best net sentiment of your brands; 30 or more marks the brand weak.');
  });

  it('lists each brand with its figures, an unknown citation count as a dash, and marks the trailing one weak', () => {
    renderPortfolio();

    expect(sectionRows(BRAND_PORTFOLIO_TITLE)).toStrictEqual([
      ['Aurora Airways', '20', '2.08', '+91.9', '7', '0.00', '0.0'],
      ['Aurora MilesWeak', '9', '4.78', '+55.6', '—', '2.70', '36.3'],
    ]);
  });

  it('writes an unknown position, sentiment and gap as dashes', () => {
    const unknown = buildPortfolioBrand({
      name: 'Aurora Travel',
      average_position: null,
      net_sentiment: null,
      position_gap: null,
      sentiment_gap: null,
      weak: false,
    });
    renderPortfolio(insightsWithFacts({ portfolio: [buildPortfolioBrand(), unknown] }));

    expect(sectionRows(BRAND_PORTFOLIO_TITLE)[1]).toStrictEqual(['Aurora Travel', '9', '—', '—', '—', '—', '—']);
  });

  it('reads out the weak-brand insight above the table, and no other insight', () => {
    renderPortfolio();

    expect(insightLines(BRAND_PORTFOLIO_TITLE)).toStrictEqual([
      'Aurora Miles: named in 9 answers at average position 4.78 (2.70 places behind your best brand), net sentiment +55.6 (36.3 points behind your best brand).',
    ]);
  });

  it('says what the portfolio needs, without a table, while fewer than two brands qualify', () => {
    renderPortfolio(insightsWithFacts({ portfolio: [] }));

    expectEmptySection(BRAND_PORTFOLIO_TITLE, PORTFOLIO_EMPTY);
  });

  describeInsightsSectionPlaceholders(BrandPortfolioSection);
});
