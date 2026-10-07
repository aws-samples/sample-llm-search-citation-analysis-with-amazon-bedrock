import {
  describe, expect, it
} from 'vitest';
import { render } from '@testing-library/react';
import { buildCaveatRow } from '../../../types/domain/insightFacts-fixtures';
import {
  CAVEATS_EMPTY, COMPETITOR_CAVEATS_TITLE, CompetitorCaveatsSection
} from './CompetitorCaveatsSection';
import {
  columnTooltip, describeInsightsSectionPlaceholders, expectEmptySection, insightLines, insightsWithFacts, loadedInsights, sectionColumnHeadings,
  sectionRows
} from './insightSections-fixtures';

function renderCaveats(slice = loadedInsights()) {
  return render(<CompetitorCaveatsSection {...slice} />);
}

describe('CompetitorCaveatsSection', () => {
  it('heads the competitor, its mentions, the mixed and negative ones, their share and the reasons', () => {
    renderCaveats();

    expect(sectionColumnHeadings(COMPETITOR_CAVEATS_TITLE)).toStrictEqual(['Competitor', 'Mentions', 'Mixed', 'Negative', 'Caveat share', 'Reasons']);
  });

  it('explains the caveat share with the thresholds that mark a caveat', () => {
    renderCaveats();

    expect(columnTooltip('Caveat share')).toHaveAccessibleDescription(
      'Mixed and negative mentions out of all its mentions; 30% or more over 5 mentions or more marks a caveat.',
    );
  });

  it('lists each competitor with its counts, marking the one an insight flags, its reasons one per line', () => {
    renderCaveats();

    expect(sectionRows(COMPETITOR_CAVEATS_TITLE)).toStrictEqual([
      ['Borealis AirCaveat', '31', '17', '2', '61.3%', 'Extra fees for carry-on bagsFrequent delays'],
      ['Cirrus Jet', '4', '1', '0', '25.0%', '—'],
    ]);
  });

  it('reads out the competitor-caveat insight above the table, and no other insight', () => {
    renderCaveats();

    expect(insightLines(COMPETITOR_CAVEATS_TITLE)).toStrictEqual(['Borealis Air: worded mixed or negative in 61.3% of 31 mentions (17 mixed, 2 negative).']);
  });

  it('writes an unknown caveat share as a dash', () => {
    renderCaveats(insightsWithFacts({
      competitor_caveats: [buildCaveatRow({
        name: 'Nimbus',
        caveat_share: null 
      })] 
    }));

    expect(sectionRows(COMPETITOR_CAVEATS_TITLE)[0][4]).toBe('—');
  });

  it('says no competitor is named, without a table, when there is none', () => {
    renderCaveats(insightsWithFacts({ competitor_caveats: [] }));

    expectEmptySection(COMPETITOR_CAVEATS_TITLE, CAVEATS_EMPTY);
  });

  describeInsightsSectionPlaceholders(CompetitorCaveatsSection);
});
