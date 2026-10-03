import {
  describe, it, expect
} from 'vitest';
import {
  render, within
} from '@testing-library/react';
import { BrandLeaderboard } from './BrandLeaderboard';
import {
  COMPETITOR_ROW, buildBrandRow
} from './visibilityOverview-fixtures';
import {
  aboutButton, bodyRowCells, columnHeadingTexts, panelTable, panelTitled
} from './visibilityTables-fixtures';
import { KPI_DEFINITIONS } from '../../constants/kpiDefinitions';

const LEADERBOARD = 'Brand leaderboard';

function renderLeaderboard(brands = [buildBrandRow()]) {
  return render(<BrandLeaderboard brands={brands} />);
}

describe('BrandLeaderboard', () => {
  it('heads the brand, four KPI, best position, engines, keywords and type columns', () => {
    renderLeaderboard();

    expect(columnHeadingTexts(panelTable(LEADERBOARD))).toStrictEqual([
      'Brand',
      'Visibility score',
      'Mention rate',
      'Share of voice',
      'Average position',
      'Best position',
      'Engines',
      'Keywords',
      'Type',
    ]);
  });

  it.each([
    ['Visibility score', KPI_DEFINITIONS.visibility_score.definition],
    ['Mention rate', KPI_DEFINITIONS.mention_rate.definition],
    ['Share of voice', KPI_DEFINITIONS.share_of_voice.definition],
    ['Average position', KPI_DEFINITIONS.average_position.definition],
    ['Best position', 'The best place the brand reached in any answer (1 = named first).'],
    ['Engines', 'The AI engines whose answers name the brand.'],
    ['Keywords', 'How many keywords\' answers name the brand.'],
  ])('explains the %s column heading in its tooltip', (heading, explanation) => {
    renderLeaderboard();

    expect(aboutButton(heading)).toHaveAccessibleDescription(explanation);
  });

  it('shows every figure of the tracked brand, formatted by unit', () => {
    renderLeaderboard();

    expect(bodyRowCells(panelTable(LEADERBOARD))).toStrictEqual([
      ['Hotel Sol', '52.4', '60.0%', '25.0%', '1.80', '1', 'geminiopenai', '2', 'first party'],
    ]);
  });

  it('shows a competitor with its own engines and classification', () => {
    renderLeaderboard([COMPETITOR_ROW]);

    expect(bodyRowCells(panelTable(LEADERBOARD))).toStrictEqual([
      ['Hotel Luna', '33.1', '40.0%', '16.7%', '2.50', '2', 'perplexity', '1', 'competitor'],
    ]);
  });

  it('shows dashes for unknown rates and positions', () => {
    renderLeaderboard([buildBrandRow({
      name: 'Hotel Mar',
      classification: 'other',
      mention_rate: null,
      share_of_voice: null,
      average_position: null,
      best_position: null,
      engines: [],
    })]);

    expect(bodyRowCells(panelTable(LEADERBOARD))).toStrictEqual([
      ['Hotel Mar', '52.4', '—', '—', '—', '—', '', '2', 'other'],
    ]);
  });

  it('shows each engine as its own chip', () => {
    renderLeaderboard();

    expect(within(panelTitled(LEADERBOARD)).getByText('gemini')).toHaveClass('bg-blue-100');
    expect(within(panelTitled(LEADERBOARD)).getByText('openai')).toHaveClass('bg-blue-100');
  });

  it('highlights first-party rows only', () => {
    renderLeaderboard([buildBrandRow(), COMPETITOR_ROW]);

    const [, tracked, competitor] = within(panelTitled(LEADERBOARD)).getAllByRole('row');

    expect(tracked).toHaveClass('bg-green-50');
    expect(competitor.className).toBe('');
  });

  it('says there is no brand data when no answer names a brand', () => {
    renderLeaderboard([]);

    expect(within(panelTitled(LEADERBOARD)).getByText('No brand data available.')).toBeInTheDocument();
    expect(within(panelTitled(LEADERBOARD)).queryByRole('table')).not.toBeInTheDocument();
  });
});
