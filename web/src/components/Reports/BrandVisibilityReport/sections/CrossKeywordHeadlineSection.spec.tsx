import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { CrossKeywordHeadlineSection } from './CrossKeywordHeadlineSection';
import { buildTrendView } from '../../layout/reportPayload-fixtures';
import {
  cardFigure, plainStatCard, statFigure
} from '../../layout/reportQueries-fixtures';
import { settledTrends } from '../../layout/reportSlice-fixtures';
import { buildKpis } from '../groupKpiHistory-fixtures';

const EMPTY = 'No aggregate trend data yet. Run an analysis to populate.';

describe('CrossKeywordHeadlineSection', () => {
  it('shows the KPIs over each keyword\'s latest period', () => {
    render(<CrossKeywordHeadlineSection {...settledTrends(buildTrendView({ latest: buildKpis({ share_of_voice: 33.33 }) }))} />);

    expect(statFigure('Share of voice').textContent).toBe('33.3%');
  });

  it('counts the keywords by the trend of their visibility score', () => {
    const overall = {
      improving_count: 5,
      declining_count: 0,
      stable_count: 2,
    };
    render(<CrossKeywordHeadlineSection {...settledTrends(buildTrendView({ overall }))} />);

    expect(['Improving', 'Declining', 'Stable'].map((label) => cardFigure(plainStatCard(label)).textContent)).toStrictEqual(['5', '0', '2']);
  });

  it.each([
    ['no trend answer yet', null],
    ['no keyword with data', buildTrendView({ keywords_with_data: 0 })],
  ])('asks for an analysis when there is %s', (_label, trends) => {
    render(<CrossKeywordHeadlineSection {...settledTrends(trends)} />);

    expect(screen.getByText(EMPTY)).toBeInTheDocument();
  });
});
