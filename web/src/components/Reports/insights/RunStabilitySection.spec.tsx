import {
  describe, expect, it
} from 'vitest';
import { render } from '@testing-library/react';
import { buildStabilityRow } from '../../../types/domain/insights-fixtures';
import {
  columnTooltip, describeInsightsSectionPlaceholders, expectEmptySection, insightLines, insightsWithFacts, loadedInsights, sectionColumnHeadings,
  sectionRows
} from './insightSections-fixtures';
import {
  RUN_STABILITY_TITLE, RunStabilitySection, STABILITY_EMPTY
} from './RunStabilitySection';

function renderStability(slice = loadedInsights()) {
  return render(<RunStabilitySection {...slice} />);
}

describe('RunStabilitySection', () => {
  it('heads the keyword, its runs, its best and worst positions, the range and the flips', () => {
    renderStability();

    expect(sectionColumnHeadings(RUN_STABILITY_TITLE)).toStrictEqual([
      'Keyword', 'Runs', 'Best position', 'Worst position', 'Position range', 'Mention flips',
    ]);
  });

  it('explains the range and the flips with the thresholds that mark a keyword unstable', () => {
    renderStability();

    expect(columnTooltip('Position range')).toHaveAccessibleDescription('Worst minus best position; 3 places or more marks the keyword unstable.');
    expect(columnTooltip('Mention flips')).toHaveAccessibleDescription(
      'The runs in which your brand\'s mention was gained or lost since the previous run; one or more marks the keyword unstable.',
    );
  });

  it('lists each keyword with its positions to two decimals and marks the swinging one unstable', () => {
    renderStability();

    expect(sectionRows(RUN_STABILITY_TITLE)).toStrictEqual([
      ['Best airline to fly from Europe to South America', '2', '3.67', '4.33', '0.66', '0'],
      ['cheap flights to LimaUnstable', '3', '1.50', '5.00', '3.50', '1'],
    ]);
  });

  it('reads out the unstable-keyword insight above the table, and no other insight', () => {
    renderStability();

    expect(insightLines(RUN_STABILITY_TITLE)).toStrictEqual([
      'cheap flights to Lima: placed between 1.50 and 5.00 over 3 runs, a swing of 3.50 places, with 1 mention flip.',
    ]);
  });

  it('keeps a keyword with a single run in the table once another has a second', () => {
    const singleRun = buildStabilityRow({
      keyword: 'flights to Santiago',
      runs: 1,
      position_min: 2,
      position_max: 2,
      position_range: 0,
    });
    renderStability(insightsWithFacts({ stability: [buildStabilityRow(), singleRun] }));

    expect(sectionRows(RUN_STABILITY_TITLE)[1]).toStrictEqual(['flights to Santiago', '1', '2.00', '2.00', '0.00', '0']);
  });

  it.each([
    ['no keyword has a run', []],
    ['every keyword has a single run', [buildStabilityRow({
      runs: 1,
      position_max: 3.67,
      position_range: 0,
    })]],
  ])('asks for a second run, without a table, when %s', (_condition, stability) => {
    renderStability(insightsWithFacts({ stability }));

    expectEmptySection(RUN_STABILITY_TITLE, STABILITY_EMPTY);
  });

  describeInsightsSectionPlaceholders(RunStabilitySection);
});
