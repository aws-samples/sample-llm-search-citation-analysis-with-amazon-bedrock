import {
  describe, expect, it
} from 'vitest';
import { render } from '@testing-library/react';
import { buildInsight } from '../../../types/domain/insights-fixtures';
import { sectionTitles } from '../layout/reportQueries-fixtures';
import {
  describeInsightsSectionPlaceholders, expectEmptySection, insightLines, loadedInsights
} from './insightSections-fixtures';
import {
  INSIGHTS_SUMMARY_EMPTY, INSIGHTS_SUMMARY_TITLE, InsightsSummarySection, TOP_INSIGHTS
} from './InsightsSummarySection';

function renderSummary(slice = loadedInsights()) {
  return render(<InsightsSummarySection {...slice} />);
}

describe('InsightsSummarySection', () => {
  it('is titled Top insights', () => {
    renderSummary();

    expect(sectionTitles()).toStrictEqual([INSIGHTS_SUMMARY_TITLE]);
  });

  it('reads out the first six insights in the order the API lists them, each led by its severity', () => {
    renderSummary();

    expect(insightLines(INSIGHTS_SUMMARY_TITLE)).toStrictEqual([
      'highOpenAI: ranked first in 40.0% of answers, links to a tracked domain in 80.0%. Play: get ranked first.',
      'highAurora Miles: named in 9 answers at average position 4.78 (2.70 places behind your best brand), net sentiment +55.6 (36.3 points behind your best brand).',
      'mediumGoogle Gemini: ranked first in 60.0% of answers, links to a tracked domain in 20.0%. Play: get cited.',
      'mediumcheap flights to Lima: placed between 1.50 and 5.00 over 3 runs, a swing of 3.50 places, with 1 mention flip.',
      'mediumOpenAI: cites Borealis Air\'s site 52 times, yours 28 times.',
      'mediumOpenAI: cites your documents 36 times, your web pages 26 times.',
    ]);
  });

  it(`reads out at most ${TOP_INSIGHTS} insights`, () => {
    const many = Array.from({ length: TOP_INSIGHTS + 3 }, (_unused, index) => buildInsight({ id: `engine_play:engine-${index}` }));
    renderSummary(loadedInsights({ insights: many }));

    expect(insightLines(INSIGHTS_SUMMARY_TITLE)).toHaveLength(TOP_INSIGHTS);
  });

  it('says there is no insight, without a list, when the scope raises none', () => {
    renderSummary(loadedInsights({ insights: [] }));

    expectEmptySection(INSIGHTS_SUMMARY_TITLE, INSIGHTS_SUMMARY_EMPTY);
    expect(insightLines(INSIGHTS_SUMMARY_TITLE)).toStrictEqual([]);
  });

  describeInsightsSectionPlaceholders(InsightsSummarySection);
});
