import {
  describe, expect, it
} from 'vitest';
import {
  buildRankCell, buildResultRow
} from '../../../api/seoRankTracking-fixtures';
import {
  featureLabels, inMarketText, positionDisplay, sortByPosition
} from './rankTrackingFormat';

describe('positionDisplay', () => {
  it('shows a dash for a keyword that was not checked', () => {
    expect(positionDisplay(buildRankCell({
      status: 'not_checked',
      position: null 
    }))).toStrictEqual({
      text: '–',
      tone: 'muted' 
    });
  });

  it('shows a rise as previous to current in the up tone', () => {
    expect(positionDisplay(buildRankCell({
      position: 3,
      previous_position: 8 
    }))).toStrictEqual({
      text: '8 → 3',
      tone: 'up' 
    });
  });

  it('shows a fall in the down tone', () => {
    expect(positionDisplay(buildRankCell({
      position: 9,
      previous_position: 2 
    })).tone).toBe('down');
  });

  it('shows the position alone without a previous one', () => {
    expect(positionDisplay(buildRankCell({
      position: 5,
      previous_position: null 
    }))).toStrictEqual({
      text: '5',
      tone: 'same' 
    });
  });

  it('shows a confirmed miss of a ranked keyword as lost', () => {
    const cell = buildRankCell({
      status: 'not_found',
      position: null,
      previous_position: 4 
    });

    expect(positionDisplay(cell)).toStrictEqual({
      text: '4 → lost',
      tone: 'lost' 
    });
  });

  it('shows an unconfirmed miss without calling it lost', () => {
    const cell = buildRankCell({
      status: 'not_found_unconfirmed',
      position: null,
      previous_position: 4 
    });

    expect(positionDisplay(cell)).toStrictEqual({
      text: 'Not found (unconfirmed)',
      tone: 'muted' 
    });
  });

  it('shows a miss of a keyword that never ranked as not found', () => {
    expect(positionDisplay(buildRankCell({
      status: 'not_found',
      position: null,
      previous_position: null 
    })).text).toBe('Not found');
  });
});

describe('sortByPosition', () => {
  it('puts keywords without a position last', () => {
    const rows = [
      buildResultRow({
        keyword_id: 'a',
        keyword: 'a',
        desktop: buildRankCell({ position: null }) 
      }),
      buildResultRow({
        keyword_id: 'b',
        keyword: 'b',
        desktop: buildRankCell({ position: 9 }) 
      }),
      buildResultRow({
        keyword_id: 'c',
        keyword: 'c',
        desktop: buildRankCell({ position: 2 }) 
      }),
    ];

    expect(sortByPosition(rows, 'desktop').map((row) => row.keyword)).toStrictEqual(['c', 'b', 'a']);
  });
});

describe('feature labels', () => {
  it('labels known SERP features and skips organic results', () => {
    expect(featureLabels(['organic', 'ai_overview', 'people_also_ask', 'unknown_type'])).toStrictEqual(['AI', 'PAA']);
  });
});

describe('market phrase', () => {
  it('reads "in" a configured market', () => {
    expect(inMarketText('Chile (Spanish)')).toBe('in Chile (Spanish)');
  });

  it('reads "without a market" for the keywords without one', () => {
    expect(inMarketText('No market')).toBe('without a market');
  });
});
