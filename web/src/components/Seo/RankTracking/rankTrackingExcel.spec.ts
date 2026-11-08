import {
  describe, expect, it
} from 'vitest';
import {
  buildRankCell, buildResultRow
} from '../../../api/seoRankTracking-fixtures';
import { excelTableRows } from '../../../exporters/tableExcel';
import { rankResultsColumns } from './rankTrackingExcel';

describe('rank results Excel columns', () => {
  it('names the columns of each tracked device after the keyword', () => {
    expect(rankResultsColumns(['mobile']).map((column) => column.header)).toStrictEqual([
      'Keyword', 'Mobile position', 'Mobile change', 'Mobile URL', 'Mobile SERP features',
    ]);
  });

  it('writes a change of previous minus current as a number, negative when the keyword fell', () => {
    const rows = [buildResultRow({
      desktop: buildRankCell({
        position: 9,
        previous_position: 4,
      }),
    })];

    expect(excelTableRows(rankResultsColumns(['desktop']), rows)).toStrictEqual([{
      'Keyword': 'cheap flights',
      'Desktop position': 9,
      'Desktop change': -5,
      'Desktop URL': 'https://example.com/flights',
      'Desktop SERP features': 'organic people_also_ask',
    }]);
  });

  it('writes new without a previous position and lost with an empty position after a miss', () => {
    const rows = [buildResultRow({
      desktop: buildRankCell({ previous_position: null }),
      mobile: buildRankCell({
        status: 'not_found',
        position: null,
        previous_position: 3,
        url: null,
        serp_features: [],
      }),
    })];

    expect(excelTableRows(rankResultsColumns(['desktop', 'mobile']), rows)).toStrictEqual([{
      'Keyword': 'cheap flights',
      'Desktop position': 4,
      'Desktop change': 'new',
      'Desktop URL': 'https://example.com/flights',
      'Desktop SERP features': 'organic people_also_ask',
      'Mobile position': '',
      'Mobile change': 'lost',
      'Mobile URL': '',
      'Mobile SERP features': '',
    }]);
  });

  it('leaves every device cell empty when the keyword was not checked', () => {
    const rows = [buildResultRow({
      keyword: '=cmd',
      desktop: null,
    })];

    const [written] = excelTableRows(rankResultsColumns(['desktop']), rows);

    expect(Object.values(written)).toStrictEqual(['=cmd', '', '', '', '']);
  });

  it('leaves the change empty for a miss of a keyword that never ranked', () => {
    const rows = [buildResultRow({
      desktop: buildRankCell({
        status: 'not_found',
        position: null,
        previous_position: null,
      }),
    })];

    expect(excelTableRows(rankResultsColumns(['desktop']), rows)[0]['Desktop change']).toBe('');
  });
});
