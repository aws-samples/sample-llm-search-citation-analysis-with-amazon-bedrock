import { createElement } from 'react';
import {
  describe, it, vi
} from 'vitest';
import { expectRendersNothing } from '../../../../test/renderNothing';
import { MoversSection } from './MoversSection';
import { PerKeywordTableSection } from './PerKeywordTableSection';
import { TrendHistorySection } from './TrendHistorySection';
import {
  buildTrendView, trendViewOf
} from '../../layout/reportPayload-fixtures';
import { settledTrends } from '../../layout/reportSlice-fixtures';

vi.mock('chart.js', () => import('../../../Dashboard/chartJs-fixtures'));

describe('trend sections with nothing to show', () => {
  it.each([
    ['MoversSection', 'there is no keyword', MoversSection, trendViewOf([])],
    ['PerKeywordTableSection', 'there is no keyword', PerKeywordTableSection, trendViewOf([])],
    ['TrendHistorySection', 'the window holds no period', TrendHistorySection, buildTrendView({ trend_data: [] })],
  ] as const)('%s drops out of the report when %s', (_name, _condition, section, trends) => {
    expectRendersNothing(createElement(section, settledTrends(trends)));
  });
});
