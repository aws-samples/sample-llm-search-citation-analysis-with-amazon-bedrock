import { createElement } from 'react';
import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, within
} from '@testing-library/react';
import { expectRendersNothing } from '../../../../test/renderNothing';
import { CrossKeywordHeadlineSection } from './CrossKeywordHeadlineSection';
import { MoversSection } from './MoversSection';
import { PerKeywordTableSection } from './PerKeywordTableSection';
import { TrendHistorySection } from './TrendHistorySection';
import {
  buildTrendView, trendViewOf
} from '../../layout/reportPayload-fixtures';
import { sectionTitled } from '../../layout/reportQueries-fixtures';
import { settledTrends } from '../../layout/reportSlice-fixtures';

vi.mock('chart.js', () => import('../../../Dashboard/chartJs-fixtures'));

/** Every Brand Visibility section that reads `/trends` alone: its name, component, title and loading message. */
const TREND_SECTIONS = [
  ['CrossKeywordHeadlineSection', CrossKeywordHeadlineSection, 'Headline', 'Loading aggregate trends…'],
  ['MoversSection', MoversSection, 'Top movers', 'Loading movers…'],
  ['PerKeywordTableSection', PerKeywordTableSection, 'Per-keyword leaderboard', 'Loading per-keyword rankings…'],
  ['TrendHistorySection', TrendHistorySection, 'Trend history', 'Loading trend history…'],
] as const;

describe('trend sections while the trends load or fail', () => {
  it.each(TREND_SECTIONS)('%s shows its loading message under its title', (_name, section, title, message) => {
    render(createElement(section, {
      trends: null,
      loading: true,
      error: null,
    }));

    expect(within(sectionTitled(title)).getByText(message)).toBeInTheDocument();
  });

  it.each(TREND_SECTIONS)('%s shows the error under its title', (_name, section, title) => {
    render(createElement(section, {
      trends: null,
      loading: false,
      error: 'Network down',
    }));

    expect(within(sectionTitled(title)).getByText('Network down')).toBeInTheDocument();
  });
});

describe('trend sections with nothing to show', () => {
  it.each([
    ['MoversSection', 'there is no keyword', MoversSection, trendViewOf([])],
    ['PerKeywordTableSection', 'there is no keyword', PerKeywordTableSection, trendViewOf([])],
    ['TrendHistorySection', 'the window holds no period', TrendHistorySection, buildTrendView({ trend_data: [] })],
  ] as const)('%s drops out of the report when %s', (_name, _condition, section, trends) => {
    expectRendersNothing(createElement(section, settledTrends(trends)));
  });
});
