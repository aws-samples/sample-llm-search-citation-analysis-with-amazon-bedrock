import type { ReactElement } from 'react';
import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, within
} from '@testing-library/react';
import { BrandRankingsSection } from '../BrandVisibilityReport/sections/BrandRankingsSection';
import { CrossKeywordHeadlineSection } from '../BrandVisibilityReport/sections/CrossKeywordHeadlineSection';
import { MoversSection } from '../BrandVisibilityReport/sections/MoversSection';
import { PerKeywordTableSection } from '../BrandVisibilityReport/sections/PerKeywordTableSection';
import { TrendHistorySection } from '../BrandVisibilityReport/sections/TrendHistorySection';
import { TrendSnapshotSection } from '../ExecutiveSummaryReport/sections/TrendSnapshotSection';
import { EngineKpisSection } from '../KeywordDeepDiveReport/sections/EngineKpisSection';
import { SentimentExamplesSection } from '../KeywordDeepDiveReport/sections/SentimentExamplesSection';
import { sectionTitled } from './reportQueries-fixtures';
import type { SectionFetchState } from './sectionGate';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

/** Sections gated on one fetch, without its payload: name, element, title and loading message. */
const GATED_SECTIONS: ReadonlyArray<readonly [string, (state: SectionFetchState) => ReactElement, string, string]> = [
  ['BrandRankingsSection', (state) => <BrandRankingsSection brands={null} {...state} />, 'Brand rankings', 'Loading brand rankings…'],
  ['CrossKeywordHeadlineSection', (state) => <CrossKeywordHeadlineSection trends={null} {...state} />, 'Headline', 'Loading aggregate trends…'],
  ['MoversSection', (state) => <MoversSection trends={null} {...state} />, 'Top movers', 'Loading movers…'],
  ['PerKeywordTableSection', (state) => <PerKeywordTableSection trends={null} {...state} />, 'Per-keyword leaderboard', 'Loading per-keyword rankings…'],
  ['TrendHistorySection', (state) => <TrendHistorySection trends={null} {...state} />, 'Trend history', 'Loading trend history…'],
  ['EngineKpisSection', (state) => <EngineKpisSection visibility={null} {...state} />, 'KPIs per AI engine', 'Loading AI engine KPIs…'],
  ['SentimentExamplesSection', (state) => <SentimentExamplesSection mentions={null} {...state} />, 'Sentiment examples', 'Loading sentiment data…'],
  ['TrendSnapshotSection', (state) => <TrendSnapshotSection data={null} {...state} />, 'Trend and share of voice', 'Loading the KPI trend…'],
];

describe('sections gated on one fetch, before it settles', () => {
  it.each(GATED_SECTIONS)('%s shows its loading message under its title', (_name, element, title, message) => {
    render(element({
      loading: true,
      error: null,
    }));

    expect(within(sectionTitled(title)).getByText(message)).toBeInTheDocument();
  });

  it.each(GATED_SECTIONS)('%s shows the error of its fetch under its title', (_name, element, title) => {
    render(element({
      loading: false,
      error: 'Network down',
    }));

    expect(within(sectionTitled(title)).getByText('Network down')).toBeInTheDocument();
  });
});
